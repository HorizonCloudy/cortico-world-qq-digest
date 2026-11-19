/**
 * Six-module interface specification for cortico-world-qq-digest.
 * Every exported shape names the C1-C10 item it carries.
 * Source: PLAN.md + CONTRACT.md in C:/Users/54301/qq-digest/.
 */

/** C2/C5: the four QQ ingress prefixes. Everything else is not our input. */
export type QqSource = 'qq-official' | 'onebot-bridge' | 'astrbot' | 'qq';
export const QQ_SOURCES: readonly QqSource[] = ['qq-official', 'onebot-bridge', 'astrbot', 'qq'];

/** C2: minimum read-only projection of a host EventEnvelope (ToolCallContext carries no event). */
export interface IngestEvent {
  type?: string;
  ts?: string;
  source?: string;
  senderKey?: string;
  text?: string;
  meta?: Record<string, unknown>;
}

/** C5: every field is String()-ified; no numeric assumptions survive storage. */
export interface ConvKey {
  conv: string;
  message_id: string;
  author_id: string;
  source: string;
  /** C2: onebot needs a second filter on raw.group_id; other branches leave it ''. */
  group_id: string;
  /** C5: sender.card missing falls back to user_id. */
  display_name: string;
}

export type Category = 'todo' | 'goal' | 'prompt' | 'insight';
export const CATEGORIES: readonly Category[] = ['todo', 'goal', 'prompt', 'insight'];

/** C7/C8: only a reference plus a minimal excerpt; raw group text stays in the host event store. */
export interface RecordRec {
  id: number;
  ts: string;
  source: string;
  conv: string;
  message_id: string;
  category: Category;
  content: string;
  ref_message_id?: string;
  done: boolean;
  updated_at?: string;
  /** C3: (conv, message_id, category, sha256(content)[0:12]) — package-side, not a platform promise. */
  dedup: string;
}

/** C1: advisory only. `enabled` is never written by this layer. */
export interface ClassifySuggestion {
  kind: 'work' | 'chat' | 'unknown';
  confidence: number;
  reasons: string[];
}

/** C1/C8: enabled=true can only come from a panel invoke or a human-approved model request. */
export interface GroupRec {
  conv: string;
  name?: string;
  suggested: ClassifySuggestion;
  enabled: boolean;
  provenance: 'manual' | 'suggested';
  updated_at: string;
}

/** C2: outcome of the host.store.range verification performed before any write. */
export interface VerifyResult {
  ok: boolean;
  reason?: 'source-unknown' | 'conv-mismatch' | 'not-qq';
  matched?: IngestEvent;
}

/** C4: the four tool argument shapes. */
export interface AddArgs {
  source: string;
  conv: string;
  message_id: string;
  category: Category;
  content: string;
  ref_message_id?: string;
}
export interface UpdateArgs { id: number; content?: string; category?: Category; done?: boolean }
export interface ListArgs { conv?: string; category?: Category; limit?: number }
export interface RemoveArgs { id: number }

/** C2/C3: deterministic handler result, surfaced verbatim as the tool receipt. */
export type AddResult =
  | { ok: true; record: RecordRec }
  | { ok: false; reason: 'duplicate' | 'group-disabled' | 'source-unknown' | 'invalid'; duplicateOf?: number };

export interface ListQuery { conv?: string; category?: Category; limit?: number }
export interface UpdatePatch { content?: string; category?: Category; done?: boolean }

/** C8: one async write queue, atomic tmp -> rename, dataDir files prefixed qq-digest. */
export interface StoreApi {
  load(): Promise<void>;
  add(input: Omit<RecordRec, 'id' | 'dedup' | 'done'>): Promise<AddResult>;
  update(id: number, patch: UpdatePatch): Promise<RecordRec | null>;
  list(q: ListQuery): RecordRec[];
  remove(id: number): Promise<boolean>;
  groups(): GroupRec[];
  getGroup(conv: string): GroupRec | undefined;
  setGroupEnabled(conv: string, enabled: boolean): Promise<GroupRec>;
  suggestGroup(conv: string, s: ClassifySuggestion, name?: string): Promise<GroupRec>;
  stats(): StoreStats;
  flush(): Promise<void>;
  clear(): Promise<void>;
}

export interface StoreStats {
  records: number;
  groups: number;
  pendingGroups: number;
  pendingRecords: number;
  bytes: number;
}

/** C9: a QQ conversation surfaced from the host event store. Never carries ev.text. */
export interface IngestCandidate {
  conv: string;
  source: QqSource;
  /** A real message id from the newest event of this conversation. */
  message_id: string;
  count: number;
  lastTs: string;
  display_name: string;
  registered: boolean;
  enabled: boolean;
}

/** C9: every custom panel RPC method; read methods are listed in getMethods. */
export const PANEL_METHODS = [
  'listRecords', 'listGroups', 'setGroupEnabled', 'updateRecord',
  'removeRecord', 'exportTable', 'stat', 'clear',
  // 0.2.0: the panel needs a first action even with an empty ledger. These three
  // are read-only discovery / closed-group registration / human-classified add.
  'scanIngest', 'upsertGroup', 'addRecord',
] as const;
export type PanelInvokeMethod = typeof PANEL_METHODS[number];
export const PANEL_READ_METHODS: readonly PanelInvokeMethod[] = [
  'listRecords', 'listGroups', 'exportTable', 'stat', 'scanIngest',
];

/** C8: hot values rendered into the envPrompt template. World.envPromptVars wants Record<string,string>. */
export interface EnvPromptVars {
  [key: string]: string;
  'qq.digest.pendingGroups': string;
  'qq.digest.pendingRecords': string;
  'qq.digest.lastReview': string;
  'qq.digest.maxActiveRecords': string;
}

/** C8: GUESS / starting point, not a platform constant. Label it as such in code and README. */
export const MAX_ACTIVE_RECORDS = 2000;
