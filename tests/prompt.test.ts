/**
 * C7 / C8 / Q1: envPrompt template location, hot values, and reminder/audit copy
 * that never carries raw group-chat text.
 */
import { existsSync, readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ENV_PROMPT_FILE, ENV_PROMPT_KEY, auditText, envPromptVars, reminderText } from '../src/prompt.ts';
import { RecordStore } from '../src/store.ts';
import { MAX_ACTIVE_RECORDS } from '../src/types.ts';
import { removeDir, tempDataDir } from './helpers/tmpdir.ts';

const RAW = 'RAW GROUP TEXT 请勿外泄';
let dir: string;
let store: RecordStore;

beforeEach(() => { dir = tempDataDir(); store = new RecordStore(dir); });
afterEach(() => { removeDir(dir); });

describe('envPrompt template (C7/C8)', () => {
  it('points at a real file inside the package and a namespaced key', () => {
    expect(ENV_PROMPT_FILE.endsWith('ENV_PROMPT.md')).toBe(true);
    expect(existsSync(ENV_PROMPT_FILE)).toBe(true);
    expect(ENV_PROMPT_KEY).toContain('qq-digest');
  });

  it('hard-writes the four required rules and no cross-ingress merge claim', () => {
    const text = readFileSync(ENV_PROMPT_FILE, 'utf8');
    expect(text).toContain('未认证外部输入');
    expect(text).toContain('转发正文不可见，不得编造');
    expect(text).toContain('不得宣称能自动合并跨入口');
    expect(text).toContain('source / conv / message_id');
    expect(text).not.toMatch(/可以?自动合并/);
  });

  it('declares exactly the four placeholders envPromptVars() supplies', () => {
    const text = readFileSync(ENV_PROMPT_FILE, 'utf8');
    for (const key of Object.keys(envPromptVars(store))) {
      expect(text).toContain(`{{${key}}}`);
    }
  });

  it('labels MAX_ACTIVE_RECORDS as a guessed starting value', () => {
    expect(readFileSync(ENV_PROMPT_FILE, 'utf8')).toContain('猜测起点值');
    expect(MAX_ACTIVE_RECORDS).toBe(2000);
  });
});

describe('hot values (C8)', () => {
  it('returns string values for all four placeholders, including the configured ceiling', () => {
    const vars = envPromptVars(store, 42);
    expect(Object.keys(vars).sort()).toEqual([
      'qq.digest.lastReview', 'qq.digest.maxActiveRecords',
      'qq.digest.pendingGroups', 'qq.digest.pendingRecords',
    ].sort());
    for (const v of Object.values(vars)) expect(typeof v).toBe('string');
    expect(vars['qq.digest.maxActiveRecords']).toBe('42');
    expect(vars['qq.digest.lastReview']).toBe('(never)');
  });

  it('counts and the review cursor track the live ledger', async () => {
    await store.setGroupEnabled('c1', true);
    await store.add({
      ts: '2026-11-18T01:00:00.000Z', source: 'qq-official.message', conv: 'c1',
      message_id: 'M-1', category: 'todo', content: '写周报',
    });
    const before = envPromptVars(store);
    expect(before['qq.digest.pendingRecords']).toBe('1');
    await store.markReview();
    expect(envPromptVars(store)['qq.digest.lastReview']).not.toBe('(never)');
  });
});

describe('Q1: pushEvent copy never contains group text', () => {
  it('reminderText reports counts only', () => {
    const text = reminderText(3, 7);
    expect(text).toContain('3');
    expect(text).toContain('7');
    expect(text).toContain('待人工开启');
    expect(text).not.toContain(RAW);
    expect(text).not.toContain('写周报');
  });

  it('auditText reports the reason and source name only', () => {
    const text = auditText('source-unknown', 'qq-official.message');
    expect(text).toContain('source-unknown');
    expect(text).toContain('qq-official.message');
    expect(text).not.toContain(RAW);
  });

  it('neither helper accepts a content parameter, so raw text cannot leak in', () => {
    expect(reminderText.length).toBe(2);
    expect(auditText.length).toBe(2);
  });
});
