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

export function envPromptVars(store: StoreApi & Pick<RecordStore, 'reviewCursor'>, max = MAX_ACTIVE_RECORDS): EnvPromptVars {
  const s = store.stats();
  return {
    'qq-digest.pendingGroups': String(s.pendingGroups),
    'qq-digest.pendingRecords': String(s.pendingRecords),
    'qq-digest.lastReview': store.reviewCursor(),
    'qq-digest.maxActiveRecords': String(max),
  };
}

/** Q1: only counts, never the original group text. `origin` is never set to internal. */
export function reminderText(pendingGroups: number, pendingRecords: number): string {
  return `QQ 群消息摘要：${pendingGroups} 个群待人工开启，${pendingRecords} 条记录待确认。`;
}

export function auditText(reason: string, source: string): string {
  return `QQ 群消息摘要：拒绝写入（${reason}），来源 ${source}。`;
}
