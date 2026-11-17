import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Each test gets its own real dataDir; no fs mocking in the pure tests. */
export function tempDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'qq-digest-test-'));
}

export function removeDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}
