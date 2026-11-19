/**
 * C2/C3/C4: the four qqd_* tools. No barrierAfter, no streamsOutput on any tool.
 * Tool names and shapes are NOT protected by the runtime (C4); the package tests
 * carry those three self-checks instead.
 */
import type { ToolDef } from 'cortico/core/types.ts';
import type {
  AddArgs, AddResult, Category, IngestEvent, ListArgs, RemoveArgs,
  StoreApi, UpdateArgs, VerifyResult,
} from './types.ts';
import { CATEGORIES } from './types.ts';
import { deriveConvKey, matchesEvent, sourceOf } from './conv.ts';
import { auditText } from './prompt.ts';

export const TOOL_NAMES = ['qqd_add', 'qqd_update', 'qqd_list', 'qqd_remove'] as const;

const enumSchema = { type: 'string', enum: [...CATEGORIES] } as const;

export const TOOL_DECLS: ReadonlyArray<Omit<ToolDef, 'handler'>> = [
  {
    name: 'qqd_add',
    description: 'Add one classified QQ message to the package ledger. Requires source, conv, message_id, category and a short content excerpt. Verifies the source event first.',
    tags: ['write'],
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        source: {
          type: 'string',
          description: 'Event source worldId, one of qq-official | onebot-bridge | astrbot | qq. A full event type such as qq-official.message is also accepted; the .message part is an event kind, not the source.',
        },
        conv: { type: 'string', description: 'Package conversation key from the four-branch derivation.' },
        message_id: { type: 'string', description: 'Platform message id, stringified.' },
        category: { ...enumSchema, description: 'todo | goal | prompt | insight.' },
        content: { type: 'string', description: 'Minimal excerpt or reference, not the raw group text.' },
        ref_message_id: { type: 'string', description: 'Optional id-only reference.' },
      },
      required: ['source', 'conv', 'message_id', 'category', 'content'],
    },
  },
  {
    name: 'qqd_update',
    description: 'Update one ledger record by id. Only content, category and done can change.',
    tags: ['write'],
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        id: { type: 'integer', minimum: 1 },
        content: { type: 'string' }, category: enumSchema, done: { type: 'boolean' },
      },
      required: ['id'],
    },
  },
  {
    name: 'qqd_list',
    description: 'List ledger records, newest first, optionally filtered by conv and category.',
    tags: ['read'],
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        conv: { type: 'string' }, category: enumSchema,
        limit: { type: 'integer', minimum: 1, maximum: 1000 },
      },
    },
  },
  {
    name: 'qqd_remove',
    description: 'Remove one ledger record by id. Does not touch the host event store.',
    tags: ['write'],
    parameters: {
      type: 'object', additionalProperties: false,
      properties: { id: { type: 'integer', minimum: 1 } },
      required: ['id'],
    },
  },
];

export interface RangeQuery {
  source?: string; fromTs?: string; toTs?: string; limit?: number;
}

export interface ToolsDeps {
  store: StoreApi;
  /** C2: host.store.range bound to the live WorldHost. */
  range: (q: RangeQuery) => readonly IngestEvent[];
  /** C2/Q1: audit events, always external, never containing group text. */
  audit: (type: string, text: string) => Promise<void>;
  now: () => string;
}

/** C2: verify (source, conv, message_id) really exists in the host event store. */
export function verifySource(deps: Pick<ToolsDeps, 'range' | 'now'>, args: AddArgs): VerifyResult {
  const canonical = sourceOf({ source: args.source });
  if (!canonical) return { ok: false, reason: 'not-qq' };
  const toTs = deps.now();
  const fromTs = new Date(new Date(toTs).getTime() - 7 * 24 * 3600_000).toISOString();
  // Host EventStore.range compares source by full equality (event-store.ts:272,290). QQ worlds
  // push with the bare worldId as source and put the kind in `type`, so querying with
  // a full type such as qq-official.message would never find anything.
  const events = deps.range({ source: canonical, fromTs, toTs, limit: 1000 });
  const groupId = canonical === 'onebot-bridge'
    ? args.conv.replace(/^onebot\.group:/, '') : '';
  const key = {
    conv: args.conv, message_id: args.message_id, source: canonical,
    group_id: groupId, author_id: '', display_name: '',
  };
  const matched = events.find((ev) => {
    if (!sourceOf(ev)) return false;
    if (!deriveConvKey(ev)) return false;
    return matchesEvent(ev, key);
  });
  return matched ? { ok: true, matched } : { ok: false, reason: 'source-unknown' };
}

const asString = (v: unknown): string => (typeof v === 'string' ? v : '');
const asCategory = (v: unknown): Category | null =>
  (typeof v === 'string' && (CATEGORIES as readonly string[]).includes(v) ? v as Category : null);

function receipt(r: AddResult): string {
  if (r.ok) return `added #${r.record.id}`;
  if (r.reason === 'duplicate') return `duplicate of #${r.duplicateOf}`;
  return r.reason;
}

/**
 * The single write path for a classified record. Both the model tool (qqd_add)
 * and the human panel (addRecord) go through here, so group gating, source
 * verification, dedup and the audit receipt cannot drift apart (C1/C2/C3).
 */
export function addHandler(deps: ToolsDeps): (a: Record<string, unknown>) => Promise<string> {
  return async (a) => {
    const args: AddArgs = {
      source: asString(a.source), conv: asString(a.conv), message_id: asString(a.message_id),
      category: asCategory(a.category) as Category, content: asString(a.content),
      ...(typeof a.ref_message_id === 'string' ? { ref_message_id: a.ref_message_id } : {}),
    };
    if (!args.source || !args.conv || !args.message_id || !args.category || !args.content) return 'invalid';
    const group = deps.store.getGroup(args.conv);
    // C1: unopened groups refuse every write.
    if (!group || !group.enabled) return 'group-disabled';
    const verified = verifySource(deps, args);
    if (!verified.ok) {
      // Q1: audit copy carries the reason and the source name only, never group text.
      await deps.audit('qq-digest.audit', auditText(verified.reason ?? 'source-unknown', args.source));
      return 'source-unknown';
    }
    // Keep the ledger's source equal to the host event source so the triple can
    // be re-checked later with the same source query.
    const storedSource = sourceOf({ source: args.source })!;
    const result = await deps.store.add({
      ts: deps.now(), source: storedSource, conv: args.conv, message_id: args.message_id,
      category: args.category, content: args.content,
      ...(args.ref_message_id ? { ref_message_id: args.ref_message_id } : {}),
    });
    return receipt(result);
  };
}

export function createTools(deps: ToolsDeps): ToolDef[] {
  const byName = new Map(TOOL_DECLS.map((d) => [d.name, d]));

  const add: ToolDef = {
    ...byName.get('qqd_add')!,
    handler: addHandler(deps),
  };

  const update: ToolDef = {
    ...byName.get('qqd_update')!,
    handler: async (a) => {
      const id = Number(a.id);
      if (!Number.isInteger(id) || id < 1) return 'invalid';
      const old = deps.store.list({}).find((r) => r.id === id);
      if (!old) return 'not-found';
      const group = deps.store.getGroup(old.conv);
      if (!group || !group.enabled) return 'group-disabled';
      const patch = {
        ...(typeof a.content === 'string' ? { content: a.content } : {}),
        ...(asCategory(a.category) ? { category: asCategory(a.category)! } : {}),
        ...(typeof a.done === 'boolean' ? { done: a.done } : {}),
      };
      const r = await deps.store.update(id, patch);
      return r ? `updated #${id}` : 'not-found';
    },
  };

  const list: ToolDef = {
    ...byName.get('qqd_list')!,
    handler: async (a) => {
      const q: ListArgs = {
        ...(typeof a.conv === 'string' ? { conv: a.conv } : {}),
        ...(asCategory(a.category) ? { category: asCategory(a.category)! } : {}),
        ...(Number.isInteger(a.limit) ? { limit: Number(a.limit) } : {}),
      };
      const rows = deps.store.list(q);
      return rows.length
        ? rows.map((r) => `#${r.id} [${r.category}] ${r.conv} ${r.done ? 'done' : 'open'}: ${r.content}`).join('\n')
        : 'no records';
    },
  };

  const remove: ToolDef = {
    ...byName.get('qqd_remove')!,
    handler: async (a) => {
      const id = Number(a.id);
      if (!Number.isInteger(id) || id < 1) return 'invalid';
      const old = deps.store.list({}).find((r) => r.id === id);
      if (!old) return 'not-found';
      const group = deps.store.getGroup(old.conv);
      if (!group || !group.enabled) return 'group-disabled';
      return (await deps.store.remove(id)) ? `removed #${id}` : 'not-found';
    },
  };

  return [add, update, list, remove];
}
