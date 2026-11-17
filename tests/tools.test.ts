/**
 * C1 / C2 / C3 / C4: the four qqd_* tools, host.store.range verification,
 * package-side dedup receipts, and the three self-checks the runtime will not do.
 */
import type { ToolCallContext, ToolDef } from 'cortico/core/types.ts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TOOL_DECLS, TOOL_NAMES, createTools, verifySource } from '../src/tools.ts';
import type { AddArgs, IngestEvent } from '../src/types.ts';
import { NOW, makeToolsHarness, type ToolsHarness } from './helpers/fake-host.ts';
import { removeDir } from './helpers/tmpdir.ts';

const CONV = 'qq-official.group:G1';
const RAW = 'RAW GROUP TEXT 请勿外泄 123';
const ONEBOT_CONV = 'onebot.group:456';

const officialEvent: IngestEvent = {
  source: 'qq-official.message',
  senderKey: CONV,
  meta: { message_id: 'M-1', author_id: 'u1' },
  text: RAW,
};
const onebotEvent: IngestEvent = {
  source: 'onebot-bridge.message',
  meta: { raw: { group_id: 456, message_id: 'M-2', user_id: 789 } },
  text: RAW,
};
const ADD: AddArgs = {
  source: 'qq-official.message', conv: CONV, message_id: 'M-1',
  category: 'todo', content: '写周报',
};
const ONEBOT_ADD: AddArgs = {
  source: 'onebot-bridge.message', conv: ONEBOT_CONV, message_id: 'M-2',
  category: 'insight', content: '见解 A',
};

const callCtx = {} as ToolCallContext;

async function call(tools: ToolDef[], name: string, args: object): Promise<string> {
  const tool = tools.find((t) => t.name === name)!;
  return (await tool.handler(args as Record<string, unknown>, callCtx)) as string;
}

let h: ToolsHarness;

beforeEach(() => { h = makeToolsHarness([officialEvent, onebotEvent]); });
afterEach(() => { removeDir(h.dir); });

describe('C4: three self-checks the platform does not perform', () => {
  it('#1 the full tool name table is exactly the four approved names', () => {
    expect([...TOOL_NAMES]).toEqual(['qqd_add', 'qqd_update', 'qqd_list', 'qqd_remove']);
    expect(TOOL_DECLS.map((d) => d.name)).toEqual([...TOOL_NAMES]);
    expect(createTools(h.deps).map((t) => t.name)).toEqual([...TOOL_NAMES]);
  });

  it('#2 no duplicate tool names inside the package', () => {
    const names = createTools(h.deps).map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(TOOL_DECLS.map((d) => d.name)).size).toBe(TOOL_DECLS.length);
  });

  it('#3 every tool carries parameters / handler / tags with the right shapes', () => {
    for (const t of createTools(h.deps)) {
      expect(t.parameters).toBeTypeOf('object');
      expect(t.parameters).not.toBeNull();
      expect(t.handler).toBeTypeOf('function');
      expect(Array.isArray(t.tags)).toBe(true);
      expect(t.tags.length).toBeGreaterThan(0);
      expect(t.description).toBeTypeOf('string');
    }
  });

  it('no barrierAfter and no streamsOutput on any tool (PLAN §4)', () => {
    for (const t of createTools(h.deps)) {
      expect(t.barrierAfter).toBeUndefined();
      expect(t.streamsOutput).toBeUndefined();
    }
  });

  it('every tool name uses the qqd_ prefix and a read/write tag', () => {
    for (const t of TOOL_DECLS) {
      expect(t.name.startsWith('qqd_')).toBe(true);
      expect(['read', 'write']).toContain(t.tags[0]);
    }
  });
});

describe('C2: verifySource reads the host event store before any write', () => {
  it('a real (source, conv, message_id) triple is accepted', () => {
    const r = verifySource(h.deps, ADD);
    expect(r.ok).toBe(true);
    expect(h.ranges).toHaveLength(1);
    expect(h.ranges[0]).toMatchObject({ source: ADD.source, toTs: NOW, limit: 1000 });
    expect(typeof h.ranges[0].fromTs).toBe('string');
  });

  it('a non-QQ source is refused as not-qq without querying the store', () => {
    const r = verifySource(h.deps, { ...ADD, source: 'telegram.message' });
    expect(r).toMatchObject({ ok: false, reason: 'not-qq' });
    expect(h.ranges).toHaveLength(0);
  });

  it('a fabricated message_id is refused as source-unknown', () => {
    const r = verifySource(h.deps, { ...ADD, message_id: 'NEVER-EXISTED' });
    expect(r).toMatchObject({ ok: false, reason: 'source-unknown' });
  });

  it('onebot: a message_id from another group cannot pass the second filter', () => {
    const otherGroup: IngestEvent = {
      source: 'onebot-bridge.message',
      meta: { raw: { group_id: 999, message_id: 'M-2', user_id: 789 } },
    };
    h.setEvents([otherGroup]);
    expect(verifySource(h.deps, ONEBOT_ADD).ok).toBe(false);
    h.setEvents([onebotEvent]);
    expect(verifySource(h.deps, ONEBOT_ADD).ok).toBe(true);
  });
});

describe('C1 + C2 + C3: qqd_add receipts, in the contract order', () => {
  it('invalid arguments are rejected before touching the store', async () => {
    const tools = createTools(h.deps);
    expect(await call(tools, 'qqd_add', { ...ADD, content: '' })).toBe('invalid');
    expect(await call(tools, 'qqd_add', { ...ADD, category: 'nonsense' })).toBe('invalid');
    expect(h.ranges).toHaveLength(0);
  });

  it('an unopened group returns group-disabled and skips the range lookup', async () => {
    const tools = createTools(h.deps);
    expect(await call(tools, 'qqd_add', ADD)).toBe('group-disabled');
    expect(h.ranges).toHaveLength(0);
    expect(h.store.list({})).toEqual([]);
  });

  it('an unverified source returns source-unknown and writes one external audit event', async () => {
    const tools = createTools(h.deps);
    await h.store.setGroupEnabled(CONV, true);
    h.setEvents([]);
    expect(await call(tools, 'qqd_add', ADD)).toBe('source-unknown');
    expect(h.audits).toHaveLength(1);
    expect(h.audits[0].type).toBe('qq-digest.audit');
    expect(h.audits[0].text).not.toContain(RAW);
    expect(h.audits[0].text).toContain('source-unknown');
    expect(h.store.list({})).toEqual([]);
  });

  it('a verified write returns added #<id>, a repeat returns duplicate of #<id>', async () => {
    const tools = createTools(h.deps);
    await h.store.setGroupEnabled(CONV, true);
    expect(await call(tools, 'qqd_add', ADD)).toBe('added #1');
    expect(await call(tools, 'qqd_add', ADD)).toBe('duplicate of #1');
    expect(h.store.list({})).toHaveLength(1);
  });

  it('closing the group again blocks every write tool', async () => {
    const tools = createTools(h.deps);
    await h.store.setGroupEnabled(CONV, true);
    await call(tools, 'qqd_add', ADD);
    await h.store.setGroupEnabled(CONV, false);
    expect(await call(tools, 'qqd_add', { ...ADD, message_id: 'M-2' })).toBe('group-disabled');
    expect(await call(tools, 'qqd_update', { id: 1, done: true })).toBe('group-disabled');
    expect(await call(tools, 'qqd_remove', { id: 1 })).toBe('group-disabled');
    expect(h.store.list({})).toHaveLength(1);
  });
});

describe('qqd_update / qqd_list / qqd_remove', () => {
  beforeEach(async () => {
    await h.store.setGroupEnabled(CONV, true);
  });

  it('list is newest-first and readable while the group is open', async () => {
    const tools = createTools(h.deps);
    expect(await call(tools, 'qqd_list', {})).toBe('no records');
    await call(tools, 'qqd_add', ADD);
    expect(await call(tools, 'qqd_list', {})).toContain('#1 [todo]');
    expect(await call(tools, 'qqd_list', { conv: 'other' })).toBe('no records');
  });

  it('update and remove only mutate the package ledger by id', async () => {
    const tools = createTools(h.deps);
    await call(tools, 'qqd_add', ADD);
    expect(await call(tools, 'qqd_update', { id: 1, done: true, content: '写周报（改）' })).toBe('updated #1');
    expect(h.store.list({})[0]!.done).toBe(true);
    expect(await call(tools, 'qqd_update', { id: 99, done: true })).toBe('not-found');
    expect(await call(tools, 'qqd_remove', { id: 1 })).toBe('removed #1');
    expect(h.store.list({})).toEqual([]);
    expect(await call(tools, 'qqd_remove', { id: 99 })).toBe('not-found');
  });

  it('bad ids are rejected with invalid / not-found, never with an exception', async () => {
    const tools = createTools(h.deps);
    expect(await call(tools, 'qqd_update', { id: 0 })).toBe('invalid');
    expect(await call(tools, 'qqd_remove', { id: 'abc' })).toBe('invalid');
  });
});
