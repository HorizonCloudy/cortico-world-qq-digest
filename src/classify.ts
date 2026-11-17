/**
 * C1: advisory group-nature layer. It can only emit a candidate + confidence + reasons.
 * It never writes `enabled`. Default is closed: a wrong-open is worse than a missed-open
 * (V6-c12). A prior human mark is sticky and outranks any rule output.
 */
import type { ClassifySuggestion, GroupRec, IngestEvent } from './types.ts';

const WORK_WORDS = ['工作', '项目', '需求', '开发', '交付', '排期', '会议', '工单', '上线', '迭代'];
const CHAT_WORDS = ['闲聊', '水群', '摸鱼', '灌水', '聊天', '日常'];

export interface ClassifyInput {
  conv: string;
  groupName?: string;
  /** Events already in the host store for this conversation, used only for coarse frequency. */
  events?: readonly IngestEvent[];
  /** Set when a human already decided; rules must not overwrite it. */
  prior?: GroupRec;
}

export function suggestGroupNature(input: ClassifyInput): ClassifySuggestion {
  if (input.prior?.provenance === 'manual') {
    return {
      kind: input.prior.suggested.kind,
      confidence: 1,
      reasons: ['human mark is sticky; rules do not overwrite it'],
    };
  }
  const reasons: string[] = [];
  let score = 0;
  const name = input.groupName ?? '';
  for (const w of WORK_WORDS) {
    if (name.includes(w)) { score += 2; reasons.push(`group name contains "${w}"`); break; }
  }
  for (const w of CHAT_WORDS) {
    if (name.includes(w)) { score -= 2; reasons.push(`group name contains "${w}"`); break; }
  }
  const count = input.events?.length ?? 0;
  if (count >= 20) { score += 1; reasons.push(`message frequency bucket high (${count})`); }
  else if (count > 0) reasons.push(`message frequency bucket low (${count})`);
  if (!name) reasons.push('group name unavailable on this ingress');
  reasons.push('conv kind alone cannot separate work from chat');

  const kind = score >= 2 ? 'work' : score <= -2 ? 'chat' : 'unknown';
  const confidence = kind === 'unknown' ? Math.min(0.4, 0.1 + count / 100) : Math.min(0.85, 0.4 + score / 10);
  return { kind, confidence: Number(confidence.toFixed(2)), reasons };
}

/** C1: assert the advisory-only rule at runtime, so code changes cannot silently open a group. */
export function assertAdvisoryOnly(s: ClassifySuggestion): void {
  if ('enabled' in s) throw new Error('classify output must not contain enabled');
}
