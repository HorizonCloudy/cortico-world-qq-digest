/**
 * C7/C8/Q1: envPrompt template location, hot values and reminder copy.
 * Reminder events are always external and never contain group-chat text.
 */
import { fileURLToPath } from 'node:url';
import type { EnvPromptVars, StoreApi } from './types.ts';
import { MAX_ACTIVE_RECORDS } from './types.ts';
import type { RecordStore } from './store.ts';

export const ENV_PROMPT_FILE = fileURLToPath(new URL('./ENV_PROMPT.md', import.meta.url));
export const ENV_PROMPT_KEY = 'worlds.qq-digest.envPrompt';

/**
 * Platform template placeholders allow only [\w.] in a name (core/template.ts:9),
 * so a hyphenated world id must never appear here. Single source for the template,
 * the runtime values and the WebUI variable declarations.
 */
export const ENV_PROMPT_VAR_DECLS: ReadonlyArray<{ name: string; description: string }> = [
  { name: 'qq.digest.pendingGroups', description: '尚未人工开启的群数' },
  { name: 'qq.digest.pendingRecords', description: '尚未确认的记录数' },
  { name: 'qq.digest.lastReview', description: '上次回看游标' },
  { name: 'qq.digest.maxActiveRecords', description: '每群记录上限（猜测起点值）' },
];

export function envPromptVars(store: StoreApi & Pick<RecordStore, 'reviewCursor'>, max = MAX_ACTIVE_RECORDS): EnvPromptVars {
  const s = store.stats();
  return {
    'qq.digest.pendingGroups': String(s.pendingGroups),
    'qq.digest.pendingRecords': String(s.pendingRecords),
    'qq.digest.lastReview': store.reviewCursor(),
    'qq.digest.maxActiveRecords': String(max),
  };
}

/** Q1: only counts, never the original group text. `origin` is never set to internal. */
export function reminderText(pendingGroups: number, pendingRecords: number): string {
  return `QQ 群消息摘要：${pendingGroups} 个群待人工开启，${pendingRecords} 条记录待确认。`;
}

export function auditText(reason: string, source: string): string {
  return `QQ 群消息摘要：拒绝写入（${reason}），来源 ${source}。`;
}
