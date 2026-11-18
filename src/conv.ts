/** C5: four-branch conversation key derivation. All values are String()-ified. */
import type { ConvKey, IngestEvent, QqSource } from './types.ts';
import { QQ_SOURCES } from './types.ts';

const str = (v: unknown): string => (v === undefined || v === null ? '' : String(v));

/** First non-empty String() value; lets one branch accept several upstream field names. */
const first = (...vals: unknown[]): string => {
  for (const v of vals) {
    const s = str(v);
    if (s !== '') return s;
  }
  return '';
};

const objectOf = (v: unknown): Record<string, unknown> =>
  (v && typeof v === 'object' ? v as Record<string, unknown> : {});

export function sourceOf(ev: IngestEvent): QqSource | null {
  const s = str(ev.source);
  for (const p of QQ_SOURCES) {
    if (s === p || s.startsWith(`${p}.`)) return p;
  }
  return null;
}

const rawOf = (ev: IngestEvent): Record<string, unknown> =>
  (ev.meta?.raw && typeof ev.meta.raw === 'object'
    ? ev.meta.raw as Record<string, unknown>
    : {});

const convOf = (ev: IngestEvent): Record<string, unknown> =>
  (ev.meta?.conv && typeof ev.meta.conv === 'object'
    ? ev.meta.conv as Record<string, unknown>
    : {});

/** C5: convKey(source, ev) is the only primary-key source. */
export function deriveConvKey(ev: IngestEvent): ConvKey | null {
  const source = sourceOf(ev);
  if (!source) return null;
  const raw = rawOf(ev);
  const conv = convOf(ev);
  const base: ConvKey = {
    conv: '', message_id: '', author_id: '', source: str(ev.source),
    group_id: '', display_name: '',
  };

  if (source === 'qq-official') {
    // senderKey IS the conversation key: qq-official.group:<group_openid>.
    // c2c private chat has the same value for conversation and person key.
    // Live qqbot@0.4.2 puts the message id in meta.messageId (camelCase) and the
    // author in meta.author.user_openid / meta.data.author.user_openid.
    const data = objectOf(ev.meta?.data);
    const author = objectOf(ev.meta?.author ?? data.author);
    base.conv = str(ev.senderKey);
    base.message_id = first(
      ev.meta?.messageId, ev.meta?.message_id, ev.meta?.id,
      ev.meta?.dedupKey, data.id,
    );
    base.author_id = first(
      ev.meta?.author_id, ev.meta?.user_openid, author.user_openid, ev.senderKey,
    );
    base.display_name = first(ev.meta?.sender_name, author.username, base.author_id);
    base.group_id = first(
      objectOf(ev.meta?.target).id, ev.meta?.group_openid, data.group_openid,
      base.conv.includes(':') ? base.conv.split(':').slice(1).join(':') : '',
    );
  } else if (source === 'onebot-bridge') {
    // senderKey is a PERSON key and may be undefined; the bridge stores the whole
    // OneBot event in meta.raw, so group and message ids live there.
    base.group_id = str(raw.group_id);
    base.conv = `onebot.group:${base.group_id}`;
    base.message_id = first(raw.message_id, ev.meta?.messageId, ev.meta?.message_id);
    base.author_id = first(raw.user_id, ev.senderKey);
    const sender = objectOf(raw.sender);
    base.display_name = first(sender.card, sender.nickname, base.author_id);
  } else if (source === 'astrbot') {
    // Three-segment UMO; first segment (platform name) varies and kind is a trigger enum.
    // Live astrbot bridge names the message id meta.platformMsgId, not message_id.
    const rawUmo = ev.meta?.conv ?? ev.meta?.umo ?? ev.senderKey;
    const umoObj = objectOf(rawUmo);
    const umo = typeof rawUmo === 'object' && rawUmo !== null
      ? `${str(umoObj.kind)}:${str(umoObj.id)}` : str(rawUmo);
    const parts = umo.split(':');
    base.conv = `astrbot.${parts.length >= 3 ? parts.slice(2).join(':') : umo}`;
    base.message_id = first(ev.meta?.platformMsgId, raw.message_id, ev.meta?.message_id);
    base.author_id = first(raw.user_id, objectOf(ev.meta?.sender).id, ev.meta?.sender_id, ev.senderKey);
    base.display_name = first(ev.meta?.sender_name, objectOf(ev.meta?.sender).name, base.author_id);
  } else {
    // Built-in qq world: meta.conv = { kind, id }.
    base.conv = `qq.${str(conv.kind)}:${str(conv.id)}`;
    base.group_id = str(conv.id);
    base.message_id = first(ev.meta?.message_id, ev.meta?.msgId);
    base.author_id = first(ev.meta?.user_id, ev.senderKey);
    base.display_name = first(ev.meta?.sender_name, base.author_id);
  }
  return base;
}

/** C5/C2: same branch table for the message id. */
export function messageIdOf(ev: IngestEvent): string {
  return deriveConvKey(ev)?.message_id ?? '';
}

/** C5/C2: same branch table for the author id. */
export function authorIdOf(ev: IngestEvent): string {
  return deriveConvKey(ev)?.author_id ?? '';
}

/** C2: onebot needs a second filter on raw.group_id; filtering by senderKey would cross groups. */
export function matchesEvent(ev: IngestEvent, key: ConvKey): boolean {
  const derived = deriveConvKey(ev);
  if (!derived || derived.conv !== key.conv || derived.message_id !== key.message_id) return false;
  if (key.source.startsWith('onebot-bridge')) {
    return derived.group_id !== '' && derived.group_id === key.group_id;
  }
  return true;
}
