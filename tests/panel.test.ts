/**
 * C9 / PLAN §7: the hand-written WebUI panel, 0.2.0 redesign.
 * The host supplies ctx.ui; the fake below reproduces just the primitives the
 * panel uses, so we can assert that controls are real controls (not bare text),
 * that an empty ledger still has a first action, and that all writes go
 * through custom invoke. Untrusted strings are still text-only (C9).
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
  textContent: string;
  children: FakeNode[] = [];
  handlers: Record<string, Array<(arg?: unknown) => void>> = {};
  type = '';
  href = '';
  download = '';
  value = '';
  checked = false;
  placeholder = '';
  rows = 0;
  className = '';
  title = '';
  style: { cssText: string } = { cssText: '' };
  classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
  variant = '';
  colSpan = 1;
  constructor(tag: string, text = '') { this.tag = tag; this.textContent = text; }
  append(...nodes: FakeNode[]): void { this.children.push(...nodes); }
  replaceChildren(...nodes: FakeNode[]): void { this.children = [...nodes]; }
  addEventListener(ev: string, fn: (arg?: unknown) => void): void {
    (this.handlers[ev] ??= []).push(fn);
  }
  click(): void { for (const fn of this.handlers.click ?? []) fn(); }
  fire(ev: string, arg?: unknown): void { for (const fn of this.handlers[ev] ?? []) fn(arg); }
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

const text = (v: unknown): string => (v === undefined || v === null ? '' : String(v));

/** Minimal stand-in for the host's ctx.ui primitives. */
function fakeUi() {
  const node = (tag: string, value = '') => new FakeNode(tag, value);
  const cell = (c: unknown): FakeNode => {
    const td = node('td');
    if (c === null || c === undefined) return td;
    if (typeof c === 'object') {
      const obj = c as { el?: FakeNode; text?: unknown };
      if (obj.el) td.append(obj.el);
      else if ('text' in obj) td.textContent = text(obj.text);
      else td.append(c as FakeNode);
      return td;
    }
    td.textContent = text(c);
    return td;
  };
  return {
    h: (tag: string, _cls?: string | null, value?: string | null) => node(tag, value === null ? '' : value ?? ''),
    sheet(opts: { title: string; desc?: string }) {
      const el = node('section');
      const body = node('div');
      el.append(node('h3', opts.title));
      if (opts.desc) el.append(node('p', opts.desc));
      el.append(body);
      return { el, body, note: node('span'), desc: null };
    },
    section(title: string, description?: string) {
      const el = node('div');
      el.append(node('h4', title));
      if (description) el.append(node('p', description));
      return el;
    },
    rowbar: () => node('div'),
    button(label: string, opts: { variant?: string; size?: string; onClick?: () => void } = {}) {
      const b = node('button', label);
      b.variant = opts.variant ?? '';
      if (opts.onClick) b.addEventListener('click', opts.onClick);
      return b;
    },
    input(opts: { value?: string; placeholder?: string; onChange?: (v: string) => void; onCommit?: (v: string) => void } = {}) {
      const n = node('input');
      n.value = opts.value ?? '';
      n.placeholder = opts.placeholder ?? '';
      if (opts.onChange) n.addEventListener('change', () => opts.onChange!(n.value));
      if (opts.onCommit) n.addEventListener('keydown', () => opts.onCommit!(n.value));
      return n;
    },
    textarea(opts: { value?: string; placeholder?: string } = {}) {
      const n = node('textarea');
      n.value = opts.value ?? '';
      n.placeholder = opts.placeholder ?? '';
      return n;
    },
    select(opts: { options?: readonly (string | { value: string; label?: string })[]; value?: string; onInput?: (v: string) => void } = {}) {
      const n = node('select');
      for (const o of opts.options ?? []) {
        const item = typeof o === 'string' ? { value: o, label: o } : o;
        const opt = node('option', item.label ?? item.value);
        opt.value = item.value;
        n.append(opt);
      }
      n.value = opts.value ?? '';
      if (opts.onInput) n.addEventListener('change', () => opts.onInput!(n.value));
      return n;
    },
    pill: (label: string) => node('span', label),
    msgline: (label = '') => node('div', label),
    placeholder: (label: string) => node('div', label),
    checkbox(label: string, opts: { checked?: boolean; onChange?: (v: boolean) => void } = {}) {
      const el = node('label');
      const input = node('input');
      input.checked = !!opts.checked;
      if (opts.onChange) input.addEventListener('change', () => opts.onChange!(input.checked));
      el.append(input, node('span', ' ' + label));
      return { el, input, checked: !!opts.checked, setChecked(v: boolean) { input.checked = v; } };
    },
    table(opts: { head?: readonly string[] } = {}) {
      const el = node('div');
      const t = node('table');
      const thead = node('thead');
      const hr = node('tr');
      for (const h of opts.head ?? []) hr.append(node('th', h));
      thead.append(hr);
      const body = node('tbody');
      t.append(thead, body);
      el.append(t);
      return {
        el, body,
        addRow(cells: readonly unknown[]) {
          const tr = node('tr');
          for (const c of cells) tr.append(cell(c));
          body.append(tr);
          return tr;
        },
        clear(empty?: string) {
          body.replaceChildren();
          if (empty) {
            const tr = node('tr');
            tr.append(node('td', empty));
            body.append(tr);
          }
        },
      };
    },
    confirm: async () => true,
  };
}

interface PanelHarness {
  root: FakeNode;
  invokes: Array<{ method: string; args: unknown[] }>;
  links: FakeNode[];
}

const XSS = '<img src=x onerror=alert(1)>';
const GROUP_XSS = '<b>项目群</b>';

function mountPanel(opts: { empty?: boolean; withUi?: boolean } = {}): PanelHarness {
  installDom();
  const root = new FakeNode('div');
  const invokes: Array<{ method: string; args: unknown[] }> = [];
  const links: FakeNode[] = [];
  const empty = opts.empty ?? false;
  const ctx = {
    root,
    ...(opts.withUi === false ? {} : { ui: fakeUi() }),
    invoke: async (method: string, args: unknown[]) => {
      invokes.push({ method, args });
      switch (method) {
        case 'listRecords': return empty ? [] : [
          { id: 1, category: 'todo', content: XSS, conv: 'c1', message_id: 'M-1', done: false },
        ];
        case 'listGroups': return empty ? [] : [
          { conv: 'c1', name: GROUP_XSS, enabled: false, provenance: 'suggested', suggested: { kind: 'work', confidence: 0.7, reasons: [] } },
        ];
        case 'stat': return { records: empty ? 0 : 1, groups: empty ? 0 : 1, pendingRecords: empty ? 0 : 1, pendingGroups: 0, bytes: 128 };
        case 'scanIngest': return empty ? [] : [
          { conv: 'c1', source: 'qq-official', message_id: 'M-1', count: 3, lastTs: '2026-11-18T02:00:00.000Z', display_name: 'Alice', registered: true, enabled: false },
        ];
        case 'exportTable': return { $binary: { mime: 'application/x-ndjson', base64: 'IyByZWNvcmRz' } };
        case 'addRecord': return { receipt: 'added #2', ok: true };
        case 'upsertGroup': return { conv: 'c1', enabled: false };
        case 'setGroupEnabled': return { conv: 'c1', enabled: true };
        case 'updateRecord': return { id: 1 };
        case 'removeRecord': return { removed: true };
        default: return null;
      }
    },
  };
  client.panels.records.mount(ctx);
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

const tick = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 40); });
const button = (root: FakeNode, label: string): FakeNode | undefined =>
  allNodes(root).find((n) => n.tag === 'button' && n.textContent === label);

describe('static source assertions (C9/C10)', () => {
  it('is plain JS with a default export of { panels: { records: { mount } } }', () => {
    expect(Object.keys(client.panels)).toEqual(['records']);
    expect(client.panels.records.mount).toBeTypeOf('function');
    expect(CLIENT_PATH.endsWith('client.js')).toBe(true);
  });

  it('uses the host UI primitives and never assigns markup; dynamic text is text-only', () => {
    const source = readFileSync(CLIENT_PATH, 'utf8');
    expect(source).toContain('ctx.ui');
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

  it('exposes the QQ-ingress first actions in its declared method table', () => {
    const source = readFileSync(CLIENT_PATH, 'utf8');
    for (const m of ['scanIngest', 'upsertGroup', 'addRecord']) expect(source).toContain(m);
  });

  it('declares fixed-layout tables, capped cards and non-wrapping controls', () => {
    const source = readFileSync(CLIENT_PATH, 'utf8');
    for (const rule of [
      'max-width:${CARD_MAX}px', 'table-layout:fixed', 'flex-wrap:nowrap',
      'text-overflow:ellipsis', 'white-space:nowrap;flex:none',
    ]) expect(source).toContain(rule);
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

describe('0.2.0 redesign: a panel that can actually be operated', () => {
  it('auto-loads and auto-scans, so an empty ledger still shows QQ candidates', async () => {
    const { root, invokes } = mountPanel();
    await tick();
    const methods = invokes.map((i) => i.method);
    for (const m of ['listRecords', 'listGroups', 'stat', 'scanIngest']) expect(methods).toContain(m);
    // The final status line is the scan result, not a dead "0 records" line.
    expect(allNodes(root).some((n) => n.textContent.includes('载入失败') || n.textContent.includes('操作失败'))).toBe(false);
    expect(allNodes(root).some((n) => n.textContent.includes('扫描到 1 个 QQ 会话'))).toBe(true);
  });

  it('renders real themed buttons with a primary action, not unstyled text', async () => {
    const { root } = mountPanel();
    await tick();
    const scan = button(root, '扫描 QQ 事件')!;
    expect(scan).toBeTruthy();
    expect(scan.tag).toBe('button');
    expect(scan.variant).toBe('primary');
    for (const label of ['刷新记录', '导出整表', '登记并人工开启', '核验并加入', '人工开启此群', '填入建档']) {
      expect(button(root, label)).toBeTruthy();
    }
  });

  it('an empty state spells out the next action in every section', async () => {
    const { root } = mountPanel({ empty: true });
    await tick();
    const texts = allNodes(root).map((n) => n.textContent);
    expect(texts.some((t) => t.includes('最近 7 天四个 QQ 入口没有可识别的群消息事件'))).toBe(true);
    expect(texts.some((t) => t.includes('还没有登记任何群'))).toBe(true);
    expect(texts.some((t) => t.includes('记录本还是空的'))).toBe(true);
    expect(button(root, '扫描 QQ 事件')).toBeTruthy();
    expect(button(root, '登记并人工开启')).toBeTruthy();
  });

  it('renders untrusted strings as text only', async () => {
    const { root } = mountPanel();
    await tick();
    const nodes = allNodes(root);
    // The excerpt lives in an <input value>; the group name in a table cell.
    expect(nodes.some((n) => n.textContent === XSS || n.value === XSS)).toBe(true);
    expect(nodes.some((n) => n.textContent.includes(GROUP_XSS))).toBe(true);
    expect(nodes.some((n) => n.textContent.includes('载入失败') || n.textContent.includes('操作失败'))).toBe(false);
  });

  it('opening a scanned group is a human click that goes through upsertGroup + setGroupEnabled', async () => {
    const { root, invokes } = mountPanel();
    await tick();
    button(root, '人工开启此群')!.click();
    await tick();
    expect(invokes.some((i) => i.method === 'upsertGroup')).toBe(true);
    expect(invokes.some((i) => i.method === 'setGroupEnabled' && i.args[1] === true)).toBe(true);
  });

  it('filling the add form from a scan row produces a verified addRecord call', async () => {
    const { root, invokes } = mountPanel();
    await tick();
    button(root, '填入建档')!.click();
    const inputs = allNodes(root).filter((n) => n.tag === 'input');
    const conv = inputs.find((n) => n.placeholder.includes('会话键 conv'))!;
    const msg = inputs.find((n) => n.placeholder.startsWith('消息 id'))!;
    expect(conv.value).toBe('c1');
    expect(msg.value).toBe('M-1');
    const ta = allNodes(root).find((n) => n.tag === 'textarea')!;
    ta.value = '最小摘录';
    button(root, '核验并加入')!.click();
    await tick();
    const add = invokes.find((i) => i.method === 'addRecord');
    expect(add).toBeTruthy();
    expect(add!.args[0]).toMatchObject({ source: 'qq-official', conv: 'c1', message_id: 'M-1', content: '最小摘录' });
  });

  it('record correction and removal go through custom invoke, not direct storage', async () => {
    const { root, invokes } = mountPanel();
    await tick();
    button(root, '标记完成')!.click();
    await tick();
    expect(invokes.some((i) => i.method === 'updateRecord' && i.args[0] === 1)).toBe(true);
    button(root, '删除')!.click();
    await tick();
    expect(invokes.some((i) => i.method === 'removeRecord')).toBe(true);
  });

  it('exportTable is consumed as $binary, never as a raw URL', async () => {
    const { root, invokes, links } = mountPanel();
    await tick();
    button(root, '导出整表')!.click();
    await tick();
    expect(invokes.some((i) => i.method === 'exportTable')).toBe(true);
    expect(links.some((a) => a.href.startsWith('data:application/x-ndjson;base64,'))).toBe(true);
  });

  it('falls back to visibly styled native controls when ctx.ui is absent', async () => {
    const { root } = mountPanel({ withUi: false });
    await tick();
    const scan = button(root, '扫描 QQ 事件')!;
    expect(scan).toBeTruthy();
    expect(scan.tag).toBe('button');
    expect(button(root, '核验并加入')).toBeTruthy();
    expect(allNodes(root).some((n) => n.textContent.includes('操作失败'))).toBe(false);
  });
});

describe('0.2.1 layout: every block fits inside its card', () => {
  it('caps all five cards at 880px and gives each a visible boundary', async () => {
    const { root } = mountPanel();
    await tick();
    const sheets = root.children.filter((n) => n.tag === 'section');
    expect(sheets).toHaveLength(5);
    for (const s of sheets) {
      expect(s.style.cssText).toContain('max-width:880px');
      expect(s.style.cssText).toContain('border:1px solid');
    }
  });

  it('fixes every table layout and declares widths for the wide columns', async () => {
    const { root } = mountPanel();
    await tick();
    const tables = allNodes(root).filter((n) => n.tag === 'table');
    expect(tables).toHaveLength(4);
    for (const t of tables) expect(t.style.cssText).toContain('table-layout:fixed');
    const heads = tables.map((t) => t.children[0].children[0].children);
    expect(heads[0]).toHaveLength(5);   // scan: no more 7 unconstrained columns
    expect(heads[2]).toHaveLength(5);   // records: status and buttons share one column
    expect(heads[0][0].style.cssText).toContain('width:130px');
    expect(heads[0][4].style.cssText).toContain('width:210px');
  });

  it('keeps operation buttons on one line and clips ids without dropping their value', async () => {
    const { root } = mountPanel();
    await tick();
    const rows = allNodes(root).filter((n) => n.style.cssText.includes('flex-wrap:nowrap'));
    expect(rows.length).toBeGreaterThan(0);
    expect(button(root, '填入建档')!.style.cssText).toContain('white-space:nowrap');
    const clipped = allNodes(root).filter((n) => n.style.cssText.includes('text-overflow:ellipsis'));
    expect(clipped.length).toBeGreaterThan(0);
    expect(clipped.some((n) => n.title === 'c1' && n.textContent === 'c1')).toBe(true);
  });

  it('applies the same layout guarantees in the no-ui fallback', async () => {
    const { root } = mountPanel({ withUi: false });
    await tick();
    const sheets = root.children.filter((n) => n.tag === 'section');
    expect(sheets).toHaveLength(5);
    for (const s of sheets) expect(s.style.cssText).toContain('max-width:880px');
    const tables = allNodes(root).filter((n) => n.tag === 'table');
    for (const t of tables) expect(t.style.cssText).toContain('table-layout:fixed');
  });
});
