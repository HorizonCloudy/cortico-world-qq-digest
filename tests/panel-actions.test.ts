/**
 * 0.2.0 panel RPC regression: an empty ledger must have a first action,
 * but the new actions must not weaken C1 (human-only group opening),
 * C2 (source verification), C7 (no raw group text) or Q1 (external audits).
 */
import type { WorldHost } from 'cortico/core/types.ts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { QQ_DIGEST } from '../src/definition.ts';
import type { IngestCandidate, IngestEvent } from '../src/types.ts';
import { PANEL_READ_METHODS } from '../src/types.ts';
import type { QqDigestWorld } from '../src/world.ts';
import { NOW, fakeWorldContext } from './helpers/fake-host.ts';
import { removeDir, tempDataDir } from './helpers/tmpdir.ts';

const RAW = 'RAW GROUP TEXT 请勿外泄';
const CONV = 'qq-official.group:G1';

/** Event shapes transcribed from the four installed QQ worlds (see live-qq.test.ts). */
const EVENTS: IngestEvent[] = [
  {
    type: 'qq-official.message', source: 'qq-official', ts: NOW,
    senderKey: CONV, text: RAW,
    meta: { messageId: 'MSG-OFF-1', target: { kind: 'group', id: 'G1' }, author: { user_openid: 'U-1' } },
  },
  {
    type: 'onebot-bridge.message', source: 'onebot-bridge', ts: NOW,
    senderKey: 'U-2', text: RAW,
    meta: { kind: 'message', raw: { group_id: 456001, message_id: 9001, user_id: 2002, sender: { card: 'Bob' } } },
  },
  {
    type: 'astrbot.message', source: 'astrbot', ts: NOW, text: RAW,
    meta: {
      conv: 'aiocqhttp:GroupMessage:777001', sender: { id: 'U-3', name: 'Carol' },
      kind: 'group', platformMsgId: 'MSG-AST-1', raw: { message_id: 'MSG-AST-1' },
    },
  },
  {
    type: 'qq.message', source: 'qq', ts: NOW, text: RAW,
    meta: { message_id: 'MSG-QQ-1', user_id: 'U-4', sender_name: 'Dave', conv: { kind: 'group', id: '888001' } },
  },
];

interface HostHarness {
  host: WorldHost;
  pushed: Array<Record<string, unknown>>;
  rangeCalls: Array<Record<string, unknown>>;
}

function hostWith(events: readonly IngestEvent[]): HostHarness {
  const pushed: Array<Record<string, unknown>> = [];
  const rangeCalls: Array<Record<string, unknown>> = [];
  const host = {
    pushEvent: async (e: Record<string, unknown>) => {
      pushed.push(e);
      return { ...e, cursor: pushed.length };
    },
    store: {
      // Mimic the host: exact source equality (event-store.ts:272,290).
      range: (q: Record<string, unknown>) => {
        rangeCalls.push(q);
        return events.filter((e) => q.source === undefined || e.source === q.source);
      },
    },
    log: { debug() {}, info() {}, warn() {}, error() {} },
  } as unknown as WorldHost;
  return { host, pushed, rangeCalls };
}

let dir: string;
let world: QqDigestWorld;
let harness: HostHarness;

beforeEach(async () => {
  dir = tempDataDir();
  world = QQ_DIGEST.create(fakeWorldContext(dir)) as QqDigestWorld;
  harness = hostWith(EVENTS);
  await world.start(harness.host);
});

afterEach(() => { removeDir(dir); });

const invoke = (method: string, args: unknown[] = []) =>
  world.webUi().invoke!('records', method, args) as Promise<unknown>;

describe('scanIngest (QQ linkage, read-only)', () => {
  it('is declared GET-safe alongside the other read methods', () => {
    expect(PANEL_READ_METHODS).toContain('scanIngest');
    expect([...world.webUi().panels![0]!.getMethods!]).toContain('scanIngest');
  });

  it('aggregates all four QQ ingresses without leaking raw group text', async () => {
    const out = await invoke('scanIngest', []) as IngestCandidate[];
    expect(out).toHaveLength(4);
    expect(out.map((c) => c.source).sort()).toEqual(['astrbot', 'onebot-bridge', 'qq', 'qq-official']);
    expect(JSON.stringify(out)).not.toContain(RAW);
    expect(JSON.stringify(out)).not.toContain('"text"');
    const official = out.find((c) => c.source === 'qq-official')!;
    expect(official).toMatchObject({ conv: CONV, message_id: 'MSG-OFF-1', count: 1, registered: false, enabled: false });
    const onebot = out.find((c) => c.source === 'onebot-bridge')!;
    expect(onebot.conv).toBe('onebot.group:456001');
    expect(harness.rangeCalls.map((q) => q.source).sort()).toEqual(['astrbot', 'onebot-bridge', 'qq', 'qq-official']);
  });

  it('reports registration state and is empty before start(host)', async () => {
    await invoke('upsertGroup', [CONV, '项目群']);
    await invoke('setGroupEnabled', [CONV, true]);
    const out = await invoke('scanIngest', []) as IngestCandidate[];
    const official = out.find((c) => c.conv === CONV)!;
    expect(official.registered).toBe(true);
    expect(official.enabled).toBe(true);

    const cold = QQ_DIGEST.create(fakeWorldContext(tempDataDir())) as QqDigestWorld;
    expect(await cold.webUi().invoke!('records', 'scanIngest', [])).toEqual([]);
  });
});

describe('upsertGroup (C1: register closed, never open)', () => {
  it('creates a closed group with an advisory suggestion', async () => {
    const g = await invoke('upsertGroup', [CONV, '项目群']) as {
      conv: string; enabled: boolean; provenance: string;
      suggested: { kind: string; confidence: number };
    };
    expect(g.conv).toBe(CONV);
    expect(g.enabled).toBe(false);
    expect(g.provenance).toBe('suggested');
    expect(g.suggested.kind).toBe('work');
    expect(world.store.getGroup(CONV)!.enabled).toBe(false);
  });

  it('rejects an empty conv and never accepts an enabled flag', async () => {
    await expect(invoke('upsertGroup', ['  '])).rejects.toThrow('bad conv');
    await invoke('upsertGroup', [CONV, undefined, true]);
    expect(world.store.getGroup(CONV)!.enabled).toBe(false);
  });
});

describe('addRecord (C1/C2/C3/Q1: same write path as qqd_add)', () => {
  const args = (over: Record<string, unknown> = {}) => ({
    source: 'qq-official.message', conv: CONV, message_id: 'MSG-OFF-1',
    category: 'todo', content: '最小摘录', ...over,
  });

  it('refuses to write before a human opens the group', async () => {
    const out = await invoke('addRecord', [args()]) as { receipt: string; ok: boolean };
    expect(out).toEqual({ receipt: 'group-disabled', ok: false });
    expect(world.store.list({})).toHaveLength(0);
  });

  it('refuses a fabricated triple and writes an external audit without group text', async () => {
    await invoke('setGroupEnabled', [CONV, true]);
    const before = harness.pushed.length;
    const out = await invoke('addRecord', [args({ message_id: 'NEVER-EXISTED' })]) as { receipt: string; ok: boolean };
    expect(out).toEqual({ receipt: 'source-unknown', ok: false });
    expect(world.store.list({})).toHaveLength(0);
    const audit = harness.pushed[before]!;
    expect(audit.type).toBe('qq-digest.audit');
    expect(audit.origin).toBe('external');
    expect(JSON.stringify(audit)).not.toContain(RAW);
  });

  it('writes a verified record with the bare worldId, then qqd_add dedups it', async () => {
    await invoke('setGroupEnabled', [CONV, true]);
    const out = await invoke('addRecord', [args()]) as { receipt: string; ok: boolean };
    expect(out).toEqual({ receipt: 'added #1', ok: true });
    const rows = world.store.list({});
    expect(rows).toHaveLength(1);
    expect(rows[0]!.source).toBe('qq-official');
    expect(rows[0]!.content).toBe('最小摘录');
    expect(await invoke('addRecord', [args()])).toEqual({ receipt: 'duplicate of #1', ok: true });

    const addTool = world.tools().find((t) => t.name === 'qqd_add')!;
    const receipt = await addTool.handler(args(), {} as never);
    expect(receipt).toBe('duplicate of #1');
  });

  it('rejects a malformed payload instead of writing a half-record', async () => {
    await invoke('setGroupEnabled', [CONV, true]);
    const out = await invoke('addRecord', [args({ content: '' })]) as { receipt: string; ok: boolean };
    expect(out).toEqual({ receipt: 'invalid', ok: false });
    expect(world.store.list({})).toHaveLength(0);
  });
});
