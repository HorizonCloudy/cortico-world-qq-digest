/**
 * Linkage regression: the four QQ worlds installed in the live host push events
 * with a BARE worldId as `source` and put the kind in `type`. EventStore.range
 * matches source exactly (event-store.ts:272,290). A lookup made with the full
 * type (qq-official.message) therefore returns nothing and qqd_add can never
 * write. Event shapes below are transcribed from the installed package sources.
 */
import type { ToolCallContext, ToolDef } from 'cortico/core/types.ts';
import { describe, expect, it } from 'vitest';
import { deriveConvKey } from '../src/conv.ts';
import { TOOL_DECLS, createTools, verifySource, type RangeQuery, type ToolsDeps } from '../src/tools.ts';
import type { AddArgs, IngestEvent } from '../src/types.ts';
import { NOW, makeToolsHarness, type ToolsHarness } from './helpers/fake-host.ts';
import { removeDir } from './helpers/tmpdir.ts';

const official: IngestEvent = {
  type: 'qq-official.message', source: 'qq-official', ts: NOW,
  senderKey: 'qq-official.group:OPENID-LIVE',
  // qqbot@0.4.2: meta.messageId (camelCase), meta.target, meta.author / meta.data
  meta: { messageId: 'MSG-OFF-1', target: { kind: 'group', id: 'OPENID-LIVE' }, appId: 1001, author: { user_openid: 'U-OPENID' } },
};

const onebot: IngestEvent = {
  type: 'onebot-bridge.message', source: 'onebot-bridge', ts: NOW,
  senderKey: 'U-2',
  // onebot-bridge: meta = { kind, raw: <whole OneBot event> }
  meta: { kind: 'message', raw: { group_id: 456001, message_id: 9001, user_id: 2002, sender: { card: 'Bob' } } },
};

const astrbot: IngestEvent = {
  type: 'astrbot.message', source: 'astrbot', ts: NOW,
  // astrbot bridge metaForMsg: { conv, sender, kind, platformMsgId, raw }
  meta: {
    conv: 'aiocqhttp:GroupMessage:777001', sender: { id: 'U-3', name: 'Carol' },
    kind: 'group', platformMsgId: 'MSG-AST-1', raw: { message_id: 'MSG-AST-1' },
  },
};

const builtin: IngestEvent = {
  type: 'qq.message', source: 'qq', ts: NOW,
  // built-in src/worlds/qq/world.ts: meta = { message_id, user_id, sender_name, conv }
  meta: { message_id: 'MSG-QQ-1', user_id: 'U-4', sender_name: 'Dave', conv: { kind: 'group', id: '888001' } },
};

const CASES = [
  { name: 'qq-official (cortico-world-qqbot)', ev: official },
  { name: 'onebot-bridge', ev: onebot },
  { name: 'astrbot', ev: astrbot },
  { name: 'built-in qq', ev: builtin },
] as const;

/** Mimic the host: exact source equality plus the inclusive time window. */
function hostLikeRange(events: readonly IngestEvent[]) {
  return (q: RangeQuery): readonly IngestEvent[] => events.filter((e) => {
    if (q.source !== undefined && e.source !== q.source) return false;
    if (q.fromTs && e.ts && e.ts < q.fromTs) return false;
    if (q.toTs && e.ts && e.ts > q.toTs) return false;
    return true;
  });
}

function harness(events: readonly IngestEvent[]): ToolsHarness {
  const h = makeToolsHarness();
  h.deps.range = ((q: RangeQuery) => {
    h.ranges.push(q);
    return hostLikeRange(events)(q);
  }) as ToolsDeps['range'];
  return h;
}

function addArgs(ev: IngestEvent, source: string): AddArgs {
  const key = deriveConvKey(ev)!;
  return {
    source, conv: key.conv, message_id: key.message_id,
    category: 'todo', content: '最小摘录',
  };
}

async function call(tools: ToolDef[], name: string, args: object): Promise<string> {
  const tool = tools.find((t) => t.name === name)!;
  return (await tool.handler(args as Record<string, unknown>, {} as ToolCallContext)) as string;
}

describe('four live QQ ingress sources', () => {
  it('a full event type cannot be found by an exact source query (the original defect)', () => {
    for (const { ev } of CASES) expect(hostLikeRange([ev])({ source: ev.type })).toEqual([]);
  });

  it('the tool description names the bare worldIds, not a type as the example', () => {
    const desc = String((TOOL_DECLS[0]!.parameters as { properties: Record<string, { description?: string }> }).properties.source.description);
    for (const s of ['qq-official', 'onebot-bridge', 'astrbot', 'qq']) expect(desc).toContain(s);
    expect(desc).not.toContain('e.g. qq-official.message');
  });

  for (const { name, ev } of CASES) {
    it(`${name}: verifySource accepts both the full type and the bare worldId`, () => {
      const h = harness([ev]);
      try {
        const fromType = verifySource(h.deps, addArgs(ev, ev.type!));
        expect(fromType.ok).toBe(true);
        expect(h.ranges[0]!.source).toBe(ev.source);
        const bare = verifySource(h.deps, addArgs(ev, ev.source!));
        expect(bare.ok).toBe(true);
      } finally {
        removeDir(h.dir);
      }
    });

    it(`${name}: qqd_add writes through the real event shape`, async () => {
      const h = harness([ev]);
      try {
        const args = addArgs(ev, ev.type!);
        await h.store.setGroupEnabled(args.conv, true);
        const tools = createTools(h.deps);
        expect(await call(tools, 'qqd_add', args)).toBe('added #1');
        // The ledger keeps the bare worldId so the triple stays re-checkable.
        expect(h.store.list({})[0]!.source).toBe(ev.source);
        expect(await call(tools, 'qqd_add', args)).toBe('duplicate of #1');
      } finally {
        removeDir(h.dir);
      }
    });
  }

  it('a fabricated triple is still refused even when the source is right', () => {
    const h = harness([official]);
    try {
      const args = { ...addArgs(official, 'qq-official'), message_id: 'NEVER-EXISTED' };
      expect(verifySource(h.deps, args)).toMatchObject({ ok: false, reason: 'source-unknown' });
    } finally {
      removeDir(h.dir);
    }
  });
});
