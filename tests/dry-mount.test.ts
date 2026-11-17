/**
 * Gate 6: mount through the platform's own dryMountWorld (src/extensions/dry-mount.ts).
 * No guesses about the entry point: the function is imported from cortico@0.2.16.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dryMountWorld } from 'cortico/extensions/dry-mount.ts';
import type { WorldDefinition, WorldSection } from 'cortico/world.ts';
import { afterAll, describe, expect, it } from 'vitest';
import { QQ_DIGEST } from '../src/definition.ts';

const scratchDir = mkdtempSync(join(tmpdir(), 'qq-digest-dry-mount-'));

afterAll(() => { rmSync(scratchDir, { recursive: true, force: true }); });

describe('dryMountWorld (cortico@0.2.16)', () => {
  it('mounts with zero failures and registers all four qqd_* tools', async () => {
    const report = await dryMountWorld(QQ_DIGEST as unknown as WorldDefinition<WorldSection>, {
      scratchDir,
      packageDir: process.cwd(),
      repoRoot: process.cwd(),
      language: 'zh',
      hasWebUiClient: true,
      takenToolNames: new Map<string, string>(),
    });
    expect(report.failures).toEqual([]);
    expect(report.ok.join('\n')).toContain('qqd_add');
    expect(report.ok.join('\n')).toContain('qqd_update');
    expect(report.ok.join('\n')).toContain('qqd_list');
    expect(report.ok.join('\n')).toContain('qqd_remove');
    expect(report.failures.join('\n')).not.toContain('Duplicate tool name');
  });
});
