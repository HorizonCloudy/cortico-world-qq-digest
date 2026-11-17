/**
 * C9 / PLAN §7: the hand-written WebUI panel. Read methods listed in getMethods,
 * all RPC through custom invoke, $binary export, and no HTML markup injection.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import client, { methodNames, readMethods } from '../src/webui/client.js';
import { PANEL_METHODS, PANEL_READ_METHODS } from '../src/types.ts';
import { QqDigestWorld } from '../src/world.ts';
import { fakeWorldContext } from './helpers/fake-host.ts';
import { removeDir, tempDataDir } from './helpers/tmpdir.ts';

const CLIENT_PATH = fileURLToPath(new URL('../src/webui/client.js', import.meta.url));

class FakeNode {
  tag: string;
  textContent = '';
  children: FakeNode[] = [];
  handlers: Record<string, Array<() => void>> = {};
  type = '';
  href = '';
  download = '';
  constructor(tag: string) { this.tag = tag; }
  append(...nodes: FakeNode[]): void { this.children.push(...nodes); }
  replaceChildren(...nodes: FakeNode[]): void { this.children = [...nodes]; }
  addEventListener(ev: string, fn: () => void): void { (this.handlers[ev] ??= []).push(fn); }
  click(): void { for (const fn of this.handlers.click ?? []) fn(); }
}

/** Any attempt to assign HTML markup throws, so the test hard-fails on a C9 violation. */
Object.defineProperty(FakeNode.prototype, 'innerHTML', {
  get(): string { return ''; },
  set(_value: string): void { throw new Error('HTML markup injection is forbidden by C9'); },
});

function installDom(): void {
  (globalThis as unknown as { document: unknown }).document = {
    createElement: (tag: string) => new FakeNode(tag),
  };
}

function allNodes(node: FakeNode): FakeNode[] {
  return [node, ...node.children.flatMap(allNodes)];
}

interface PanelHarness {
  root: FakeNode;
  invokes: Array<{ method: string; args: unknown[] }>;
  links: FakeNode[];
}

function mountPanel(): PanelHarness {
  installDom();
  const root = new FakeNode('div');
  const invokes: Array<{ method: string; args: unknown[] }> = [];
  const links: FakeNode[] = [];
  const ctx = {
    root,
    invoke: async (method: string, args: unknown[]) => {
      invokes.push({ method, args });
      if (method === 'listRecords') {
        return [{ id: 1, category: 'todo', content: '<img src=x onerror=alert(1)>', done: false }];
      }
      if (method === 'listGroups') {
        return [{ conv: 'c1', name: '<b>项目群</b>', enabled: false, suggested: { kind: 'work', confidence: 0.7, reasons: [] } }];
      }
      if (method === 'exportTable') {
        return { $binary: { mime: 'application/x-ndjson', base64: 'IyByZWNvcmRz', filename: 'x' } };
      }
      return null;
    },
  };
  client.panels.records.mount(ctx);
  // Track anchor nodes created by the export handler.
  const originalCreate = (globalThis as unknown as {
    document: { createElement: (tag: string) => FakeNode };
  }).document.createElement;
  (globalThis as unknown as { document: unknown }).document = {
    createElement: (tag: string) => {
      const n = originalCreate(tag);
      if (tag === 'a') links.push(n);
      return n;
    },
  };
  return { root, invokes, links };
}

const tick = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 20); });

describe('static source assertions (C9/C10)', () => {
  it('is plain JS with a default export of { panels: { records: { mount } } }', () => {
    expect(Object.keys(client.panels)).toEqual(['records']);
    expect(client.panels.records.mount).toBeTypeOf('function');
    expect(CLIENT_PATH.endsWith('client.js')).toBe(true);
  });

  it('never assigns HTML markup; dynamic text uses textContent', () => {
    const source = readFileSync(CLIENT_PATH, 'utf8');
    expect(source.includes('innerHTML')).toBe(false);
    expect(/\.innerHTML\s*=/.test(source)).toBe(false);
    expect(source).toContain('textContent');
  });

  it('declares no network or build-chain machinery', () => {
    const source = readFileSync(CLIENT_PATH, 'utf8');
    for (const forbidden of ['fetch(', 'XMLHttpRequest', 'import(', 'require(']) {
      expect(source.includes(forbidden)).toBe(false);
    }
  });

  it('methodNames/readMethods match the package contract and webUi getMethods', () => {
    const dir = tempDataDir();
    try {
      expect(methodNames()).toEqual([...PANEL_METHODS]);
      expect(readMethods()).toEqual([...PANEL_READ_METHODS]);
      const world = new QqDigestWorld(fakeWorldContext(dir));
      const panel = world.webUi().panels![0]!;
      expect(panel.id).toBe('records');
      expect([...(panel.getMethods ?? [])]).toEqual([...PANEL_READ_METHODS]);
      for (const m of readMethods()) expect(panel.getMethods).toContain(m);
    } finally {
      removeDir(dir);
    }
  });
});

describe('mount() behaviour', () => {
  it('loads records and groups, and renders untrusted strings as text only', async () => {
    const { root, invokes } = mountPanel();
    await tick();
    expect(invokes.map((i) => i.method)).toEqual(['listRecords', 'listGroups']);
    const nodes = allNodes(root);
    expect(nodes.some((n) => n.textContent === '<img src=x onerror=alert(1)>')).toBe(true);
    expect(nodes.some((n) => n.textContent === '<b>项目群</b>')).toBe(true);
    expect(nodes.some((n) => n.textContent.includes('载入失败'))).toBe(false);
    expect(nodes.some((n) => n.textContent.includes('已载入 1 条记录 / 1 个群'))).toBe(true);
  });

  it('the only open-group control is a human click that calls setGroupEnabled', async () => {
    const { root, invokes } = mountPanel();
    await tick();
    const toggle = allNodes(root).find((n) => n.tag === 'button' && n.textContent === '人工开启')!;
    expect(toggle).toBeTruthy();
    toggle.click();
    await tick();
    expect(invokes.some((i) => i.method === 'setGroupEnabled' && i.args[1] === true)).toBe(true);
  });

  it('record correction and removal go through custom invoke, not direct storage', async () => {
    const { root, invokes } = mountPanel();
    await tick();
    const done = allNodes(root).find((n) => n.tag === 'button' && n.textContent === '标记完成')!;
    const del = allNodes(root).find((n) => n.tag === 'button' && n.textContent === '删除')!;
    expect(done).toBeTruthy();
    expect(del).toBeTruthy();
    done.click();
    await tick();
    expect(invokes.some((i) => i.method === 'updateRecord' && i.args[0] === 1)).toBe(true);
    del.click();
    await tick();
    expect(invokes.some((i) => i.method === 'removeRecord')).toBe(true);
  });

  it('exportTable is consumed as $binary, never as a raw URL', async () => {
    const { root, invokes, links } = mountPanel();
    await tick();
    const exportBtn = allNodes(root).find((n) => n.tag === 'button' && n.textContent === '导出整表')!;
    exportBtn.click();
    await tick();
    expect(invokes.some((i) => i.method === 'exportTable')).toBe(true);
    expect(links.some((a) => a.href.startsWith('data:application/x-ndjson;base64,'))).toBe(true);
  });
});
