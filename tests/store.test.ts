/**
 * PLAN §6 / C1 / C3 / C8: two-step group table, package-side dedup key,
 * atomic tmp -> rename persistence, bounded live records and StoragePart.clear.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RecordStore } from '../src/store.ts';
import type { ClassifySuggestion, RecordRec } from '../src/types.ts';
import { removeDir, tempDataDir } from './helpers/tmpdir.ts';

const CONV = 'qq-official.group:G1';
const BASE = {
  ts: '2026-11-18T01:00:00.000Z',
  source: 'qq-official.message',
  conv: CONV,
  message_id: 'M-1',
  category: 'todo' as const,
  content: '写周报',
};

const workSuggestion: ClassifySuggestion = {
  kind: 'work', confidence: 0.7, reasons: ['group name contains 项目'],
};

let dir: string;
let store: RecordStore;

beforeEach(async () => {
  dir = tempDataDir();
  store = new RecordStore(dir);
  await store.load();
});

afterEach(() => { removeDir(dir); });

const openGroup = async (): Promise<void> => { await store.setGroupEnabled(CONV, true); };

function jsonl(path: string): RecordRec[] {
  return readFileSync(path, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as RecordRec);
}

describe('C1: group table is a two-step mechanism, closed by default', () => {
  it('a brand-new group is closed and every write is refused', async () => {
    expect(store.getGroup(CONV)).toBeUndefined();
    expect(await store.add(BASE)).toEqual({ ok: false, reason: 'group-disabled' });
    expect(store.list({})).toEqual([]);
  });

  it('suggestGroup writes only suggested/confidence/reasons, never enabled', async () => {
    const g = await store.suggestGroup(CONV, workSuggestion, '项目群');
    expect(g.enabled).toBe(false);
    expect(g.provenance).toBe('suggested');
    expect(g.suggested).toEqual(workSuggestion);
    expect(g.name).toBe('项目群');
    expect(await store.add(BASE)).toEqual({ ok: false, reason: 'group-disabled' });
  });

  it('enabled=true comes only from setGroupEnabled and is marked manual', async () => {
    await store.suggestGroup(CONV, workSuggestion);
    const g = await store.setGroupEnabled(CONV, true);
    expect(g.enabled).toBe(true);
    expect(g.provenance).toBe('manual');
    expect(store.getGroup(CONV)!.suggested).toEqual(workSuggestion);
    expect((await store.add(BASE)).ok).toBe(true);
  });

  it('a group can be closed again by a human', async () => {
    await openGroup();
    await store.setGroupEnabled(CONV, false);
    expect(await store.add(BASE)).toEqual({ ok: false, reason: 'group-disabled' });
  });
});

describe('C3: package-side dedup key and duplicate receipt', () => {
  it('dedup = conv|message_id|category|sha256(content)[0:12]', async () => {
    await openGroup();
    const r = await store.add(BASE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const h = createHash('sha256').update(BASE.content).digest('hex').slice(0, 12);
    expect(r.record.dedup).toBe(`${CONV}|M-1|todo|${h}`);
  });

  it('an identical call returns duplicate with the original id, writing nothing new', async () => {
    await openGroup();
    const first = await store.add(BASE);
    const second = await store.add(BASE);
    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ ok: false, reason: 'duplicate', duplicateOf: 1 });
    expect(store.list({})).toHaveLength(1);
    expect(jsonl(join(dir, 'qq-digest.records.jsonl'))).toHaveLength(1);
  });

  it('different content / category / message_id each produce a new record', async () => {
    await openGroup();
    await store.add(BASE);
    expect((await store.add({ ...BASE, content: '写月报' })).ok).toBe(true);
    expect((await store.add({ ...BASE, category: 'goal' })).ok).toBe(true);
    expect((await store.add({ ...BASE, message_id: 'M-2' })).ok).toBe(true);
    expect(store.list({ limit: 1000 })).toHaveLength(4);
  });
});

describe('C8: atomic persistence, file names and bounded live records', () => {
  it('all four files are package-owned and prefixed qq-digest.', async () => {
    await openGroup();
    await store.add(BASE);
    expect(existsSync(join(dir, 'qq-digest.records.jsonl'))).toBe(true);
    expect(existsSync(join(dir, 'qq-digest.groups.json'))).toBe(true);
    expect(existsSync(join(dir, 'qq-digest.counters.json'))).toBe(true);
    expect(existsSync(join(dir, 'qq-digest.archive.jsonl'))).toBe(false);
  });

  it('no .tmp survives a successful tmp -> rename write', async () => {
    await openGroup();
    await store.add(BASE);
    await store.flush();
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('records survive a load() round-trip, including nextId and group state', async () => {
    await openGroup();
    await store.add(BASE);
    const reloaded = new RecordStore(dir);
    await reloaded.load();
    expect(reloaded.list({})).toHaveLength(1);
    expect(reloaded.getGroup(CONV)!.enabled).toBe(true);
    expect((await reloaded.add({ ...BASE, message_id: 'M-2' })).ok).toBe(true);
    expect(reloaded.list({ limit: 1000 }).map((r) => r.id).sort()).toEqual([1, 2]);
  });

  it('update / remove / list filters and ts ordering', async () => {
    await openGroup();
    await store.add(BASE);
    await store.add({ ...BASE, ts: '2026-11-18T03:00:00.000Z', message_id: 'M-2', category: 'goal', content: '目标 A' });
    expect(store.list({})[0]!.message_id).toBe('M-2');
    expect(store.list({ category: 'goal' })).toHaveLength(1);
    expect(store.list({ conv: 'other' })).toEqual([]);
    const updated = await store.update(1, { done: true, content: '写周报（改）' });
    expect(updated?.done).toBe(true);
    expect(updated?.updated_at).toBeTruthy();
    const newHash = createHash('sha256').update('写周报（改）').digest('hex').slice(0, 12);
    expect(updated?.dedup.endsWith(newHash)).toBe(true);
    expect(await store.update(999, { done: true })).toBeNull();
    expect(await store.remove(1)).toBe(true);
    expect(await store.remove(999)).toBe(false);
    expect(store.list({})).toHaveLength(1);
  });

  it('MAX ceiling archives the oldest records instead of dropping them', async () => {
    const bounded = new RecordStore(dir, 2);
    await bounded.load();
    await bounded.setGroupEnabled(CONV, true);
    for (let i = 1; i <= 3; i += 1) {
      await bounded.add({ ...BASE, ts: `2026-11-18T0${i}:00:00.000Z`, message_id: `M-${i}`, content: `内容 ${i}` });
    }
    expect(bounded.list({ limit: 1000 })).toHaveLength(2);
    expect(bounded.list({ limit: 1000 }).map((r) => r.id)).toEqual([3, 2]);
    const archived = jsonl(join(dir, 'qq-digest.archive.jsonl'));
    expect(archived).toHaveLength(1);
    expect(archived[0]!.id).toBe(1);
  });

  it('stats() reports the two reminder counts used by lamps and envPromptVars', async () => {
    await openGroup();
    await store.suggestGroup('other.conv', workSuggestion);
    await store.add(BASE);
    const s = store.stats();
    expect(s.records).toBe(1);
    expect(s.groups).toBe(2);
    expect(s.pendingGroups).toBe(1);
    expect(s.pendingRecords).toBe(1);
    expect(s.bytes).toBeGreaterThan(0);
  });
});

describe('StoragePart.clear (C9): package files only', () => {
  it('deletes qq-digest.* but leaves the host event store untouched', async () => {
    await openGroup();
    await store.add(BASE);
    writeFileSync(join(dir, 'host-event-store.jsonl'), '{"text":"RAW GROUP TEXT"}\n', 'utf8');
    await store.clear();
    expect(store.list({})).toEqual([]);
    expect(store.groups()).toEqual([]);
    for (const f of ['qq-digest.records.jsonl', 'qq-digest.groups.json', 'qq-digest.counters.json']) {
      expect(existsSync(join(dir, f))).toBe(false);
    }
    expect(readFileSync(join(dir, 'host-event-store.jsonl'), 'utf8')).toContain('RAW GROUP TEXT');
  });
});
