/**
 * PLAN §3 / C5: the four-branch conversation key table, String()-ification,
 * and the onebot raw.group_id second filter that stops cross-group leakage.
 */
import { describe, expect, it } from 'vitest';
import { authorIdOf, deriveConvKey, matchesEvent, messageIdOf, sourceOf } from '../src/conv.ts';
import { QQ_SOURCES } from '../src/types.ts';
import type { IngestEvent } from '../src/types.ts';

const official: IngestEvent = {
  source: 'qq-official.message',
  senderKey: 'qq-official.group:OPENID-1',
  meta: { message_id: 'M-1', author_id: 12345, sender_name: 'Alice', ref: 'R-1' },
  text: 'RAW GROUP TEXT',
};

const onebot: IngestEvent = {
  source: 'onebot-bridge.message',
  senderKey: '789',
  meta: {
    raw: {
      group_id: 456, message_id: 'M-2', user_id: 789,
      sender: { card: 'Bob' },
    },
  },
  text: 'RAW GROUP TEXT',
};

const astrbot: IngestEvent = {
  source: 'astrbot.message',
  meta: {
    conv: 'aiocqhttp:GroupMessage:777',
    raw: { message_id: 'M-3', user_id: 'u-3' },
    sender_name: 'Carol',
  },
};

const builtin: IngestEvent = {
  source: 'qq.message',
  meta: { conv: { kind: 'group', id: '888' }, message_id: 'M-4', user_id: 'u-4' },
};

describe('sourceOf: exactly the four QQ ingress prefixes', () => {
  it('recognizes every approved prefix and its sub-event names', () => {
    for (const p of QQ_SOURCES) {
      expect(sourceOf({ source: p })).toBe(p);
      expect(sourceOf({ source: `${p}.message` })).toBe(p);
      expect(sourceOf({ source: `${p}.group.message` })).toBe(p);
    }
  });

  it('rejects anything else, including lookalike prefixes', () => {
    for (const s of ['telegram.message', 'qq-officialx.message', 'qqbot', '', undefined]) {
      expect(sourceOf({ source: s })).toBeNull();
    }
    expect(sourceOf({})).toBeNull();
  });

  it('returns null from deriveConvKey for a non-QQ event', () => {
    expect(deriveConvKey({ source: 'telegram.message', senderKey: 'x' })).toBeNull();
    expect(messageIdOf({ source: 'telegram.message' })).toBe('');
    expect(authorIdOf({ source: 'telegram.message' })).toBe('');
  });
});

describe('branch 1: qq-official — senderKey IS the conversation key', () => {
  it('derives conv, message id, author and display name; every value is a string', () => {
    const k = deriveConvKey(official)!;
    expect(k).toEqual({
      conv: 'qq-official.group:OPENID-1',
      message_id: 'M-1',
      author_id: '12345',
      source: 'qq-official.message',
      group_id: 'OPENID-1',
      display_name: 'Alice',
    });
    for (const v of Object.values(k)) expect(typeof v).toBe('string');
    expect(messageIdOf(official)).toBe('M-1');
    expect(authorIdOf(official)).toBe('12345');
  });

  it('c2c private chat: conversation key and person key are the same value', () => {
    const c2c: IngestEvent = {
      source: 'qq-official.c2c',
      senderKey: 'qq-official.c2c:USER-OPENID',
      meta: { message_id: 'M-9', user_openid: 'qq-official.c2c:USER-OPENID' },
    };
    const k = deriveConvKey(c2c)!;
    expect(k.conv).toBe(c2c.senderKey);
    expect(k.author_id).toBe(k.conv);
    expect(k.display_name).toBe(k.conv);
  });

  it('falls back through dedupKey and senderKey when the usual ids are absent', () => {
    const k = deriveConvKey({
      source: 'qq-official.message',
      senderKey: 'qq-official.group:G',
      meta: { dedupKey: 'DEDUP-STR' },
    })!;
    expect(k.message_id).toBe('DEDUP-STR');
    expect(k.author_id).toBe('qq-official.group:G');
    expect(k.display_name).toBe('qq-official.group:G');
  });
});

describe('branch 2: onebot-bridge — group and message ids live in meta.raw', () => {
  it('builds onebot.group:<id> even when senderKey is undefined', () => {
    const k = deriveConvKey(onebot)!;
    expect(k.conv).toBe('onebot.group:456');
    expect(k.group_id).toBe('456');
    expect(k.message_id).toBe('M-2');
    expect(k.author_id).toBe('789');
    expect(k.display_name).toBe('Bob');
    for (const v of Object.values(k)) expect(typeof v).toBe('string');
    expect(deriveConvKey({ ...onebot, senderKey: undefined })!.conv).toBe('onebot.group:456');
  });

  it('sender.card missing falls back to user_id (C5 display-name rule)', () => {
    const ev: IngestEvent = {
      source: 'onebot-bridge.message',
      meta: { raw: { group_id: 456, message_id: 'M-2', user_id: 790 } },
    };
    expect(deriveConvKey(ev)!.display_name).toBe('790');
    expect(deriveConvKey(ev)!.author_id).toBe('790');
  });

  it('numeric ids are String()-ified; no typeof number assumption', () => {
    const k = deriveConvKey(onebot)!;
    expect(k.group_id).toBe('456');
    expect(typeof k.group_id).toBe('string');
  });
});

describe('branch 3: astrbot — three-segment UMO, platform name varies', () => {
  it('drops the platform prefix and the trigger enum segment', () => {
    const k = deriveConvKey(astrbot)!;
    expect(k.conv).toBe('astrbot.777');
    expect(k.message_id).toBe('M-3');
    expect(k.author_id).toBe('u-3');
    expect(k.display_name).toBe('Carol');
    expect(k.conv).not.toContain('GroupMessage');
  });

  it('the leading platform name is not pinned', () => {
    const alt: IngestEvent = { ...astrbot, meta: { conv: 'onebotv11:GroupMessage:777', raw: { message_id: 'M-3' } } };
    expect(deriveConvKey(alt)!.conv).toBe('astrbot.777');
  });

  it('kind (mention/direct/group) is a trigger enum, never used as group nature', () => {
    const withKind: IngestEvent = {
      source: 'astrbot.message',
      meta: { conv: 'aiocqhttp:GroupMessage:777', kind: 'group', raw: { message_id: 'M-3' } },
    };
    expect(deriveConvKey(withKind)!.conv).toBe('astrbot.777');
  });
});

describe('branch 4: built-in qq — meta.conv = { kind, id }', () => {
  it('derives qq.<kind>:<id> and keeps the id as group_id', () => {
    const k = deriveConvKey(builtin)!;
    expect(k.conv).toBe('qq.group:888');
    expect(k.group_id).toBe('888');
    expect(k.message_id).toBe('M-4');
    expect(k.author_id).toBe('u-4');
  });
});

describe('matchesEvent: the onebot raw.group_id second filter (C2)', () => {
  it('matches a same-branch event with the same derived key', () => {
    expect(matchesEvent(onebot, deriveConvKey(onebot)!)).toBe(true);
    expect(matchesEvent(official, deriveConvKey(official)!)).toBe(true);
    expect(matchesEvent(astrbot, deriveConvKey(astrbot)!)).toBe(true);
    expect(matchesEvent(builtin, deriveConvKey(builtin)!)).toBe(true);
  });

  it('rejects a onebot event when the caller key has no raw.group_id', () => {
    const k = deriveConvKey(onebot)!;
    expect(matchesEvent(onebot, { ...k, group_id: '' })).toBe(false);
    expect(matchesEvent(onebot, { ...k, group_id: '999' })).toBe(false);
  });

  it('a same message_id from a different group does not match (no cross-group leak)', () => {
    const otherGroup: IngestEvent = {
      source: 'onebot-bridge.message',
      senderKey: '789',
      meta: { raw: { group_id: 999, message_id: 'M-2', user_id: 789 } },
    };
    expect(matchesEvent(otherGroup, deriveConvKey(onebot)!)).toBe(false);
  });

  it('non-onebot branches do not require a group_id filter', () => {
    const k = deriveConvKey(official)!;
    expect(matchesEvent(official, { ...k, group_id: '' })).toBe(true);
  });

  it('a non-QQ event never matches', () => {
    expect(matchesEvent({ source: 'telegram.message' }, deriveConvKey(onebot)!)).toBe(false);
  });
});
