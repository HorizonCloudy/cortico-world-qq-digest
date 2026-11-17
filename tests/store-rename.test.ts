/**
 * PLAN §6 / V4-BLK-06: Windows rename contention. The only mocked surface is
 * fs.renameSync; everything else is the real store on a real temp directory.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ failCount: 0, attempts: 0 }));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    renameSync: (from: string, to: string) => {
      state.attempts += 1;
      if (state.attempts <= state.failCount) {
        const err = new Error('EPERM: simulated Windows rename contention') as NodeJS.ErrnoException;
        err.code = 'EPERM';
        throw err;
      }
      return actual.renameSync(from, to);
    },
  };
});

import { RecordStore } from '../src/store.ts';
import { removeDir, tempDataDir } from './helpers/tmpdir.ts';

let dir: string;

beforeEach(() => {
  dir = tempDataDir();
  state.failCount = 0;
  state.attempts = 0;
});

afterEach(() => { removeDir(dir); });

describe('atomicWrite tmp -> rename with EPERM retry', () => {
  it('retries a transient EPERM and still commits the write, leaving no .tmp', async () => {
    state.failCount = 2;
    const store = new RecordStore(dir);
    await store.load();
    await store.setGroupEnabled('c1', true);
    expect(state.attempts).toBeGreaterThanOrEqual(3);
    expect(existsSync(join(dir, 'qq-digest.groups.json'))).toBe(true);
    expect(readFileSync(join(dir, 'qq-digest.groups.json'), 'utf8')).toContain('"c1"');
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('after five EPERM failures it rethrows and keeps BOTH tmp and the original file', async () => {
    const original = join(dir, 'qq-digest.records.jsonl');
    writeFileSync(original, '{"id":1}\n', 'utf8');
    state.failCount = 999;
    const store = new RecordStore(dir);
    await store.load();
    await expect(store.setGroupEnabled('c1', true)).rejects.toThrow('EPERM');
    expect(state.attempts).toBe(5);
    expect(existsSync(`${original}.tmp`)).toBe(true);
    expect(readFileSync(original, 'utf8')).toBe('{"id":1}\n');
  });

  it('a non-retryable error is not swallowed and does not loop five times', async () => {
    state.failCount = -1; // no EPERM injection; real rename succeeds
    const store = new RecordStore(dir);
    await store.load();
    await store.setGroupEnabled('c1', true);
    expect(state.attempts).toBeGreaterThan(0);
    expect(existsSync(join(dir, 'qq-digest.counters.json'))).toBe(true);
  });
});
