/**
 * Regression for "the software cannot recognise the variables".
 * cortico/core/template.ts:9 accepts placeholder names matching [\w.] only, so a
 * hyphenated world id leaves {{...}} literally in the system prefix. This test
 * renders through the platform function itself, not through a local mimic.
 */
import { readFileSync } from 'node:fs';
import { renderTemplate, templateVarNames, unknownVarNames } from 'cortico/core/template.ts';
import { describe, expect, it } from 'vitest';
import { ENV_PROMPT_FILE, ENV_PROMPT_VAR_DECLS, envPromptVars } from '../src/prompt.ts';
import { RecordStore } from '../src/store.ts';
import { QqDigestWorld } from '../src/world.ts';
import { fakeWorldContext } from './helpers/fake-host.ts';
import { removeDir, tempDataDir } from './helpers/tmpdir.ts';

const TEMPLATE = readFileSync(ENV_PROMPT_FILE, 'utf8');
const DECLARED = ENV_PROMPT_VAR_DECLS.map((v) => v.name);

function vars(): Record<string, string> {
  const dir = tempDataDir();
  try {
    return envPromptVars(new RecordStore(dir), 42);
  } finally {
    removeDir(dir);
  }
}

describe('envPrompt placeholders are renderable by cortico', () => {
  it('every placeholder name matches the platform [\\w.] grammar', () => {
    const names = templateVarNames(TEMPLATE);
    expect(names).toHaveLength(4);
    for (const name of names) expect(name).toMatch(/^[\w.]+$/);
    expect(names.sort()).toEqual([...DECLARED].sort());
  });

  it('the WebUI declares exactly the names the runtime supplies', () => {
    const dir = tempDataDir();
    try {
      const world = new QqDigestWorld(fakeWorldContext(dir));
      const doc = world.webUi().promptDocs?.find((d) => d.role === 'envPrompt');
      expect(doc?.vars?.map((v) => v.name).sort()).toEqual([...DECLARED].sort());
    } finally {
      removeDir(dir);
    }
  });

  it('unknownVarNames reports nothing: template and declarations agree', () => {
    expect(unknownVarNames(TEMPLATE, DECLARED)).toEqual([]);
  });

  it('renderTemplate substitutes all values and leaves no literal placeholder', () => {
    const v = vars();
    const rendered = renderTemplate(TEMPLATE, v);
    expect(rendered).not.toContain('{{');
    expect(rendered).toContain(v['qq.digest.pendingGroups']!);
    expect(rendered).toContain(v['qq.digest.pendingRecords']!);
    expect(rendered).toContain(v['qq.digest.lastReview']!);
    expect(rendered).toContain('42');
  });

  it('negative control: a hyphenated name is invisible to the renderer', () => {
    const broken = TEMPLATE.replace('{{qq.digest.pendingGroups}}', '{{qq-digest.pendingGroups}}');
    expect(renderTemplate(broken, vars())).toContain('{{qq-digest.pendingGroups}}');
    expect(templateVarNames(broken)).not.toContain('qq-digest.pendingGroups');
    expect(templateVarNames(broken)).toHaveLength(3);
  });
});
