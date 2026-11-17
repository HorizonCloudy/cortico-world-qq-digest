/** C5: four-branch conversation key derivation. All values are String()-ified. */
import type { ConvKey, IngestEvent, QqSource } from './types.ts';
import { QQ_SOURCES } from './types.ts';

const str = (v: unknown): string => (v === undefined || v === null ? '' : String(v));

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
    base.conv = str(ev.senderKey);
    base.message_id = str(ev.meta?.message_id ?? ev.meta?.id ?? ev.meta?.dedupKey);
    base.author_id = str(ev.meta?.author_id ?? ev.meta?.user_openid ?? ev.senderKey);
    base.display_name = str(ev.meta?.sender_name ?? base.author_id);
    base.group_id = base.conv.includes(':') ? base.conv.split(':').slice(1).join(':') : '';
  } else if (source === 'onebot-bridge') {
    // senderKey is a PERSON key and may be undefined; group and message ids live in meta.raw.
    base.group_id = str(raw.group_id);
    base.conv = `onebot.group:${base.group_id}`;
    base.message_id = str(raw.message_id);
    base.author_id = str(raw.user_id ?? ev.senderKey);
    const sender = (raw.sender && typeof raw.sender === 'object')
      ? raw.sender as Record<string, unknown> : {};
    base.display_name = str(sender.card ?? sender.nickname ?? base.author_id);
  } else if (source === 'astrbot') {
    // Three-segment UMO; first segment (platform name) varies and kind is a trigger enum.
    const umo = ev.meta?.conv ?? ev.meta?.umo ?? ev.senderKey;
    const parts = str(umo).split(':');
    base.conv = `astrbot.${parts.length >= 3 ? parts.slice(2).join(':') : str(umo)}`;
    base.message_id = str(raw.message_id ?? ev.meta?.message_id);
    base.author_id = str(raw.user_id ?? ev.meta?.sender_id ?? ev.senderKey);
    base.display_name = str(ev.meta?.sender_name ?? base.author_id);
  } else {
    // Built-in qq world: meta.conv = { kind, id }.
    base.conv = `qq.${str(conv.kind)}:${str(conv.id)}`;
    base.group_id = str(conv.id);
    base.message_id = str(ev.meta?.message_id);
    base.author_id = str(ev.meta?.user_id ?? ev.senderKey);
    base.display_name = str(ev.meta?.sender_name ?? base.author_id);
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
