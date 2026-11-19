/**
 * A0 assembly: WorldDefinition shape, WebUI declaration, panel RPC,
 * external-only pushEvent, bounded stop(), and the four tools wired to the host store.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ToolCallContext } from 'cortico/core/types.ts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { QQ_DIGEST } from '../src/definition.ts';
import type { QqDigestWorld } from '../src/world.ts';
import { PANEL_METHODS, PANEL_READ_METHODS } from '../src/types.ts';
import { fakeWorldContext, fakeWorldHost, type FakeWorldHost } from './helpers/fake-host.ts';
import { removeDir, tempDataDir } from './helpers/tmpdir.ts';

const CONV = 'qq-official.group:G1';
const RAW = 'RAW GROUP TEXT 请勿外泄';
const EVENT = {
  source: 'qq-official.message', senderKey: CONV,
  meta: { message_id: 'M-1', author_id: 'u1' }, text: RAW,
};

let dir: string;
let world: QqDigestWorld;
let fake: FakeWorldHost;

beforeEach(() => {
  dir = tempDataDir();
  world = QQ_DIGEST.create(fakeWorldContext(dir)) as QqDigestWorld;
  fake = fakeWorldHost([EVENT]);
});

afterEach(() => { removeDir(dir); });

describe('WorldDefinition (C8/C10)', () => {
  it('id is qq-digest and defaults() is a fresh, disabled section', () => {
    expect(QQ_DIGEST.id).toBe('qq-digest');
    expect(world.id).toBe('qq-digest');
    const a = QQ_DIGEST.defaults();
    expect(a.enabled).toBe(false);
    expect(a.maxActiveRecords).toBe(2000);
    expect(a).not.toBe(QQ_DIGEST.defaults());
  });

  it('self-describes all four tools and the two event types', () => {
    expect(QQ_DIGEST.describe!.tools.map((t) => t.name)).toEqual([
      'qqd_add', 'qqd_update', 'qqd_list', 'qqd_remove',
    ]);
    expect(QQ_DIGEST.describe!.events.map((e) => e.type)).toEqual([
      'qq-digest.reminder', 'qq-digest.audit',
    ]);
  });

  it('every declared config path exists in defaults() under worlds.qq-digest.', () => {
    const group = world.webUi().config![0]!;
    expect(group.owner).toBe('world:qq-digest');
    const defaults = QQ_DIGEST.defaults() as unknown as Record<string, unknown>;
    for (const path of Object.keys(group.schema.properties ?? {})) {
      expect(path.startsWith('worlds.qq-digest.')).toBe(true);
      expect(defaults[path.slice('worlds.qq-digest.'.length)]).toBeDefined();
    }
  });
});

describe('webUi() declaration (C9)', () => {
  it('two lamps ( <= MODULE_LAMP_MAX ), read methods on the panel, StoragePart with stat/clear', () => {
    const decl = world.webUi();
    expect(decl.lamps!.length).toBe(2);
    expect(decl.lamps!.length).toBeLessThanOrEqual(7);
    expect(decl.panels![0]!.id).toBe('records');
    expect([...(decl.panels![0]!.getMethods ?? [])]).toEqual([...PANEL_READ_METHODS]);
    expect(decl.storage).toHaveLength(1);
    expect(decl.storage![0]!.key).toContain('qq-digest');
    expect(decl.storage![0]!.stat).toBeTypeOf('function');
    expect(decl.storage![0]!.clear).toBeTypeOf('function');
    expect(decl.storage![0]!.note).toContain('宿主事件库');
  });

  it('the envPrompt template exists and its vars match envPromptVars()', () => {
    const doc = world.webUi().promptDocs![0]!;
    expect(doc.role).toBe('envPrompt');
    expect(existsSync(doc.path)).toBe(true);
    expect(doc.vars!.map((v) => v.name).sort()).toEqual(Object.keys(world.envPromptVars()).sort());
  });
});

describe('panel invoke RPC', () => {
  it('rejects an unknown panel or method', async () => {
    const invoke = world.webUi().invoke!;
    await expect(invoke('other', 'listRecords', [])).rejects.toThrow('unknown panel');
    await expect(invoke('records', 'notAMethod', [])).rejects.toThrow('unknown method');
    expect([...PANEL_METHODS]).toHaveLength(11);
  });

  it('only setGroupEnabled can open a group, and it is marked manual', async () => {
    const invoke = world.webUi().invoke!;
    await world.store.load();
    // The rules layer has no panel RPC that could open a group.
    await expect(invoke('records', 'suggestGroup', [CONV])).rejects.toThrow('unknown method');
    const g = await invoke('records', 'setGroupEnabled', [CONV, true]) as { enabled: boolean; provenance: string };
    expect(g.enabled).toBe(true);
    expect(g.provenance).toBe('manual');
    expect((await invoke('records', 'listGroups', []) as unknown[])).toHaveLength(1);
  });

  it('listRecords/updateRecord/removeRecord exercise the package ledger only', async () => {
    const invoke = world.webUi().invoke!;
    await world.store.load();
    await invoke('records', 'setGroupEnabled', [CONV, true]);
    const addTool = world.tools().find((t) => t.name === 'qqd_add')!;
    // tools() range is empty until start(host); use the store directly for the record.
    await world.store.add({
      ts: '2026-11-18T01:00:00.000Z', source: EVENT.source, conv: CONV,
      message_id: 'M-1', category: 'todo', content: '写周报',
    });
    expect(addTool.name).toBe('qqd_add');
    expect((await invoke('records', 'listRecords', []) as unknown[])).toHaveLength(1);
    expect((await invoke('records', 'updateRecord', [1, { done: true }]) as { done: boolean }).done).toBe(true);
    expect(await invoke('records', 'removeRecord', [1])).toEqual({ removed: true });
    expect((await invoke('records', 'listRecords', []) as unknown[])).toHaveLength(0);
  });

  it('exportTable returns $binary NDJSON, stat reports counts, clear deletes package files', async () => {
    const invoke = world.webUi().invoke!;
    await world.store.load();
    await invoke('records', 'setGroupEnabled', [CONV, true]);
    await world.store.add({
      ts: '2026-11-18T01:00:00.000Z', source: EVENT.source, conv: CONV,
      message_id: 'M-1', category: 'todo', content: '写周报',
    });
    const out = await invoke('records', 'exportTable', []) as { $binary: { mime: string; base64: string } };
    expect(out.$binary.mime).toBe('application/x-ndjson');
    expect(Buffer.from(out.$binary.base64, 'base64').toString('utf8')).toContain('"category":"todo"');
    expect((await invoke('records', 'stat', []) as { records: number }).records).toBe(1);
    expect(await invoke('records', 'clear', [])).toBe('cleared');
    expect(readdirSync(dir).filter((f) => f.startsWith('qq-digest.'))).toEqual([]);
  });
});

describe('start() / stop() (Q1/C8)', () => {
  it('start pushes exactly one external reminder with counts only', async () => {
    await world.start(fake.host);
    expect(fake.pushed).toHaveLength(1);
    const e = fake.pushed[0]!;
    expect(e.type).toBe('qq-digest.reminder');
    expect(e.origin).toBe('external');
    expect(e.source).toBe('qq-digest');
    expect(String(e.text)).not.toContain(RAW);
    expect(String(e.text)).toContain('QQ 群消息摘要');
  });

  it('after start(), tools() can verify a source through host.store.range', async () => {
    await world.start(fake.host);
    await world.store.load();
    await world.store.setGroupEnabled(CONV, true);
    const add = world.tools().find((t) => t.name === 'qqd_add')!;
    const out = await add.handler({
      source: EVENT.source, conv: CONV, message_id: 'M-1',
      category: 'todo', content: '写周报',
    }, {} as ToolCallContext);
    expect(out).toBe('added #1');
    expect(fake.rangeCalls.length).toBeGreaterThan(0);
  });

  it('stop() flushes, records a review cursor and releases the host promptly', async () => {
    await world.start(fake.host);
    await world.store.load();
    const started = Date.now();
    await world.stop();
    expect(Date.now() - started).toBeLessThan(1000);
    expect(world.store.reviewCursor()).not.toBe('(never)');
    expect(existsSync(join(dir, 'qq-digest.counters.json'))).toBe(true);
  });
});
