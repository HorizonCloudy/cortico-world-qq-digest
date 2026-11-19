/* Hand-written WebUI panel, no build chain. Default export follows
   docs/extensions.md: { panels: { <id>: { mount(ctx) } } }.

   0.2.0 replaced the bare-DOM panel with host UI primitives and added a
   QQ-ingress scan, so an empty ledger is no longer a dead end.

   0.2.1 fixes the layout damage seen in the host: seven unconstrained columns
   plus long mono ids pushed a real table to ~1950px inside a ~1040px card.
   Operation buttons were squeezed into 37px-wide, 94px-tall vertical strips
   and the last four columns sat off-screen. Now every card is capped at
   CARD_MAX, every table is fixed-layout with declared column widths, long
   identifiers are one-line ellipsis with the full value in title, and the
   operation cells never wrap their buttons.

   C9: untrusted group names, nicknames and excerpts only ever reach
   textContent. No markup strings are built anywhere in this file.

   C1/C2/C7: opening a group is always a human click on setGroupEnabled;
   adding a record goes through the same source verification as qqd_add;
   raw group text from the host event store is never shown here. */

export function methodNames() {
  return [
    'listRecords', 'listGroups', 'setGroupEnabled', 'updateRecord',
    'removeRecord', 'exportTable', 'stat', 'clear',
    'scanIngest', 'upsertGroup', 'addRecord',
  ];
}

export function readMethods() {
  return ['listRecords', 'listGroups', 'exportTable', 'stat', 'scanIngest'];
}

const CATEGORIES = ['todo', 'goal', 'prompt', 'insight'];
const CATEGORY_LABEL = {
  todo: '待办', goal: '目标', prompt: '提示词参考', insight: '建议与见解',
};
const CATEGORY_OPTIONS = CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }));

const SOURCE_LABEL = {
  'qq-official': 'qq-official · 官方机器人',
  'onebot-bridge': 'onebot-bridge · OneBot',
  astrbot: 'astrbot · AstrBot',
  qq: 'qq · 内置',
};
/** Short labels keep the narrow first column readable; title keeps the worldId. */
const SOURCE_SHORT = {
  'qq-official': '官方机器人', 'onebot-bridge': 'OneBot', astrbot: 'AstrBot', qq: '内置',
};
const SOURCE_OPTIONS = Object.keys(SOURCE_LABEL).map((s) => ({ value: s, label: SOURCE_LABEL[s] }));
const KIND_LABEL = { work: '工作群', chat: '闲聊群', unknown: '待判断' };

/** Cards are deliberately narrower than the host's 1120px content width. */
const CARD_MAX = 880;
const CARD_FIT = `max-width:${CARD_MAX}px;margin-left:auto;margin-right:auto;`
  + 'box-sizing:border-box;border:1px solid var(--line,#d8dad8);border-radius:12px;'
  + 'padding:16px 18px;background:var(--sheet,#fff);margin-bottom:16px';
const NOWRAP_ROW = 'display:flex;flex-wrap:nowrap;gap:6px;align-items:center';
const BTN_FIT = 'white-space:nowrap;flex:none';

const str = (v) => (v === undefined || v === null ? '' : String(v));
const errText = (err) => (err instanceof Error ? err.message : String(err));
const shortTime = (ts) => {
  const s = str(ts);
  const m = /T(\d\d:\d\d)/.exec(s);
  return m ? m[1] : (s.slice(0, 10) || '—');
};

/**
 * Defensive fallback: the host always supplies ctx.ui, but if a future/older
 * host does not, produce visibly styled controls instead of unstyled text.
 * Uses CSS variables from the host theme with light-theme fallbacks.
 */
function minimalUi() {
  const doc = globalThis.document;
  const mk = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls) n.className = String(cls);
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  };
  const style = (n, css) => { if (n.style) n.style.cssText = css; return n; };
  const CARD = `border:1px solid var(--line,#d0d2d0);border-radius:10px;padding:14px;margin:10px auto;max-width:${CARD_MAX}px;background:var(--sheet,#fbfbfb);color:var(--ink,#1b1a1e)`;
  const BTN = 'border:1px solid var(--line-strong,#aeb0ae);border-radius:6px;padding:5px 12px;cursor:pointer;background:var(--sheet-2,#f2f3f2);color:inherit';
  const FIELD = 'border:1px solid var(--line-strong,#aeb0ae);border-radius:6px;padding:5px 8px;background:var(--sheet,#fbfbfb);color:inherit;min-width:160px';
  const CELL = 'padding:6px 8px;border-bottom:1px solid var(--line,#d0d2d0);vertical-align:top';

  const field = (tag, opts) => {
    const n = style(mk(tag), FIELD);
    if (opts.value !== undefined) n.value = String(opts.value);
    if (opts.placeholder) n.placeholder = opts.placeholder;
    if (opts.rows) n.rows = opts.rows;
    if (opts.onChange) n.addEventListener('change', () => opts.onChange(n.value));
    if (opts.onCommit) n.addEventListener('keydown', (e) => { if (e.key === 'Enter') opts.onCommit(n.value); });
    return n;
  };

  return {
    h: mk,
    sheet({ title, desc }) {
      const el = style(mk('section'), CARD);
      const body = mk('div');
      el.append(style(mk('h3', null, title), 'margin:0 0 6px;font-size:15px'));
      if (desc) el.append(style(mk('p', null, desc), 'color:var(--ink-dim,#8b8b8f);margin:0 0 10px;font-size:12px'));
      el.append(body);
      return { el, body, note: mk('span'), desc: null };
    },
    section(title, description) {
      const n = mk('div');
      n.append(style(mk('h4', null, title), 'margin:12px 0 4px;font-size:13px'));
      if (description) n.append(style(mk('p', null, description), 'color:var(--ink-dim,#8b8b8f);margin:0;font-size:12px'));
      return n;
    },
    rowbar() { return style(mk('div'), 'display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:8px 0'); },
    button(label, opts = {}) {
      const extra = opts.variant === 'primary'
        ? ';background:var(--accent,#00a870);color:var(--on-accent,#082a1e);border-color:transparent;font-weight:600'
        : opts.variant === 'danger' ? ';color:var(--danger,#b45950)' : '';
      const b = style(mk('button', null, label), BTN + extra);
      b.type = 'button';
      if (opts.onClick) b.addEventListener('click', opts.onClick);
      return b;
    },
    input(opts = {}) { const n = field('input', opts); n.type = 'text'; return n; },
    textarea(opts = {}) { return field('textarea', opts); },
    select(opts = {}) {
      const n = style(mk('select'), FIELD);
      for (const o of opts.options || []) {
        const item = typeof o === 'string' ? { value: o, label: o } : o;
        const opt = mk('option', null, item.label ?? item.value);
        opt.value = item.value;
        n.append(opt);
      }
      if (opts.value !== undefined) n.value = String(opts.value);
      if (opts.onInput) n.addEventListener('change', () => opts.onInput(n.value));
      return n;
    },
    pill(text, tone) {
      const border = tone === 'on' ? 'var(--ok,#19815e)'
        : tone === 'off' ? 'var(--warn,#96743b)' : 'var(--line-strong,#aeb0ae)';
      return style(mk('span', null, text), `display:inline-block;padding:2px 9px;border-radius:10px;border:1px solid ${border};font-size:12px;white-space:nowrap`);
    },
    msgline(text, bad) {
      return style(mk('div', null, text || ''), `margin:8px 0;font-size:12px;color:var(${bad ? '--danger,#b45950' : '--ink-dim,#8b8b8f'})`);
    },
    placeholder(text) {
      return style(mk('div', null, text), 'padding:14px;color:var(--ink-dim,#8b8b8f);font-size:12px');
    },
    checkbox(label, opts = {}) {
      const el = mk('label');
      const input = mk('input');
      input.type = 'checkbox';
      input.checked = !!opts.checked;
      if (opts.onChange) input.addEventListener('change', () => opts.onChange(!!input.checked));
      el.append(input, mk('span', null, ' ' + label));
      return { el, input, checked: !!opts.checked, setChecked(v) { input.checked = !!v; } };
    },
    table(opts = {}) {
      const el = style(mk('div'), `overflow:auto;max-height:${opts.maxHeight || '320px'}`);
      const t = style(mk('table'), 'width:100%;border-collapse:collapse;font-size:12px;table-layout:fixed');
      const head = opts.head || [];
      const thead = mk('thead');
      const hr = mk('tr');
      for (const h of head) hr.append(style(mk('th', null, h), 'text-align:left;padding:6px 8px;border-bottom:1px solid var(--line-strong,#aeb0ae);white-space:nowrap'));
      thead.append(hr);
      const body = mk('tbody');
      t.append(thead, body);
      el.append(t);
      const cell = (c) => {
        const td = style(mk('td'), CELL + ';overflow:hidden');
        if (c === null || c === undefined) return td;
        if (typeof c === 'object') {
          if (c.el) td.append(c.el);
          else if ('text' in c) td.textContent = str(c.text);
          else td.append(c);
          return td;
        }
        td.textContent = str(c);
        return td;
      };
      return {
        el, body,
        addRow(cells) { const tr = mk('tr'); for (const c of cells) tr.append(cell(c)); body.append(tr); return tr; },
        clear(empty) {
          body.replaceChildren();
          if (empty) {
            const tr = mk('tr');
            const td = style(mk('td'), 'padding:14px 8px;color:var(--ink-dim,#8b8b8f)');
            td.colSpan = head.length || 1;
            td.textContent = empty;
            tr.append(td);
            body.append(tr);
          }
        },
      };
    },
    async confirm(opts) {
      return typeof globalThis.confirm === 'function' ? globalThis.confirm(opts.body || opts.title) : true;
    },
  };
}

export default {
  panels: {
    records: {
      mount(ctx) {
        const ui = ctx.ui ?? minimalUi();
        const invoke = (method, args = []) => ctx.invoke(method, args);
        const state = {
          records: [], groups: [], candidates: [], scanned: false,
          q: '', category: '', onlyOpen: false,
        };

        // ---------- layout helpers ----------
        const css = (node, extra) => {
          if (node && node.style) node.style.cssText = (node.style.cssText || '') + ';' + extra;
          return node;
        };
        const fitSheet = (sheet) => css(sheet.el, CARD_FIT);

        /** Fixed layout keeps seven columns inside one narrow card. */
        const fitTable = (table, widths) => {
          const holder = table.el;
          const t = holder && (typeof holder.querySelector === 'function'
            ? holder.querySelector('table') : holder.children[0]);
          if (!t) return;
          css(t, 'table-layout:fixed;width:100%');
          const ths = typeof t.querySelectorAll === 'function'
            ? Array.from(t.querySelectorAll('thead th'))
            : (t.children[0] && t.children[0].children[0]
              ? Array.from(t.children[0].children[0].children) : []);
          ths.forEach((th, i) => css(th,
            (widths[i] ? `width:${widths[i]};` : '') + 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap'));
        };

        /** Long ids are clipped to one line; the full value stays in title. */
        const clip = (value, label) => {
          const s = str(value);
          const n = ui.h('span', 'mono', label === undefined ? s : label);
          n.title = s;
          return { el: css(n, 'display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap') };
        };
        const opsRow = () => css(ui.h('div'), NOWRAP_ROW);
        const smallBtn = (label, opts) => css(ui.button(label, { ...opts, size: 'sm' }), BTN_FIT);
        const fitField = (node, extra) => css(node, (extra || '') + ';min-width:0;box-sizing:border-box');

        // ---------- overview ----------
        const overview = ui.sheet({
          title: 'QQ 群消息摘要',
          en: 'qq-digest',
          desc: '本包不直连 QQ、不后台批处理。四个 QQ 入口把消息推进宿主事件库后，这里扫描会话、人工开群、按真实消息建档；群未人工开启时拒绝一切写入。',
        });
        fitSheet(overview);
        const stats = ui.rowbar();
        const bar = ui.rowbar();
        const msg = ui.msgline('正在读取记录本…');
        overview.body.append(stats, bar, msg);

        const report = (text, bad) => {
          msg.textContent = text;
          if (msg.classList && typeof msg.classList.add === 'function') {
            if (bad) msg.classList.add('bad'); else msg.classList.remove('bad');
          }
        };
        const run = async (fn, okText) => {
          try {
            const r = await fn();
            if (okText !== undefined) report(typeof okText === 'function' ? okText(r) : okText);
            else if (typeof r === 'string') report(r);
            return r;
          } catch (err) {
            report('操作失败：' + errText(err), true);
            return null;
          }
        };

        // ---------- 1. QQ ingress scan ----------
        const scanSheet = ui.sheet({
          title: '① 扫描 QQ 插件推入的会话',
          desc: '只读宿主事件库里四个 QQ 入口最近 7 天的事件，按会话键聚合。这里只显示会话键、消息 id、时间与计数，不展示群聊原文。',
        });
        fitSheet(scanSheet);
        const scanTable = ui.table({
          head: ['入口', '会话键 conv / 消息 id', '条数·最近', '登记状态', '操作'],
          maxHeight: '320px',
        });
        fitTable(scanTable, ['130px', 'auto', '150px', '110px', '210px']);
        scanSheet.body.append(scanTable.el);

        // ---------- 2. groups ----------
        const groupsSheet = ui.sheet({
          title: '② 逐群开关（人工）',
          desc: '规则层只给性质候选与置信，不会自动开群。开启必须由你点按钮；关闭同样由你决定。',
        });
        fitSheet(groupsSheet);
        const manualConv = fitField(ui.input({ placeholder: '会话键，例：qq-official.group:OPENID / onebot.group:123456', cls: 'mono' }), 'flex:1 1 260px');
        const manualName = fitField(ui.input({ placeholder: '群名（可选，仅面板显示）' }), 'flex:1 1 150px');
        const manualSource = fitField(ui.select({ options: SOURCE_OPTIONS, value: 'qq-official' }), 'flex:0 1 180px');
        const manualBar = ui.rowbar();
        manualBar.append(manualConv, manualName, manualSource);
        const groupsTable = ui.table({
          head: ['群 / 会话键', '性质 · 置信', '来源', '状态', '操作'],
          maxHeight: '300px',
        });
        fitTable(groupsTable, ['auto', '110px', '90px', '90px', '120px']);
        groupsSheet.body.append(
          ui.section('手工登记一个会话键', 'QQ 事件暂时扫不到时，可以先手工登记；登记默认是关闭的。'),
          manualBar,
          groupsTable.el,
        );

        // ---------- 3. records ----------
        const recordsSheet = ui.sheet({
          title: '③ 记录本',
          desc: '摘录与类别可直接改；改完失焦或回车即保存。只存最小摘录与引用，原文留在宿主事件库。',
        });
        fitSheet(recordsSheet);
        const search = fitField(ui.input({ type: 'search', placeholder: '搜索会话键 / 摘录 / 消息 id' }), 'flex:1 1 220px');
        const catFilter = fitField(ui.select({ options: [{ value: '', label: '全部类别' }, ...CATEGORY_OPTIONS], value: '' }), 'flex:0 1 130px');
        const onlyOpen = ui.checkbox('只看未完成');
        const filterBar = ui.rowbar();
        filterBar.append(search, catFilter, onlyOpen.el);
        const recordsTable = ui.table({
          head: ['#', '类别', '会话键 / 消息 id', '摘录（可直接改）', '状态与操作'],
          maxHeight: '420px',
        });
        fitTable(recordsTable, ['46px', '120px', '200px', 'auto', '210px']);
        recordsSheet.body.append(filterBar, recordsTable.el);

        // ---------- 4. human add + linkage notes ----------
        const addSheet = ui.sheet({
          title: '④ 从一条真实 QQ 消息建档',
          desc: '三元组必须从上面的扫描结果或本轮可见事件里取，不要自己编。写入前会回查宿主事件库核验；群未开启或三元组不存在都会拒绝。',
        });
        fitSheet(addSheet);
        const srcSel = fitField(ui.select({ options: SOURCE_OPTIONS, value: 'qq-official' }), 'flex:0 1 180px');
        const convIn = fitField(ui.input({ placeholder: '会话键 conv（点扫描行的「填入建档」自动带出）', cls: 'mono' }), 'flex:1 1 220px');
        const msgIn = fitField(ui.input({ placeholder: '消息 id（同一条真实消息）', cls: 'mono' }), 'flex:1 1 200px');
        const catSel = fitField(ui.select({ options: CATEGORY_OPTIONS, value: 'todo' }), 'flex:0 1 120px');
        const contentTa = css(ui.textarea({ rows: 2, placeholder: '只写一句最小摘录，不要粘贴群聊原文' }), 'width:100%;box-sizing:border-box');
        const addForm = ui.rowbar();
        addForm.append(srcSel, convIn, msgIn, catSel);
        const helpTable = ui.table({ head: ['入口 source', '会话键 conv', '消息 id 来源'] });
        fitTable(helpTable, ['150px', 'auto', 'auto']);
        const helpRows = [
          ['qq-official', 'senderKey：qq-official.group:<openid>', 'meta.messageId / meta.id'],
          ['onebot-bridge', 'onebot.group:<meta.raw.group_id>', 'meta.raw.message_id'],
          ['astrbot', 'astrbot.<UMO 第三段>', 'meta.platformMsgId'],
          ['qq（内置）', 'qq.<meta.conv.kind>:<meta.conv.id>', 'meta.message_id'],
        ];
        for (const row of helpRows) {
          helpTable.addRow(row.map((value) => clip(value)));
        }
        addSheet.body.append(
          addForm, contentTa,
          ui.section('四个 QQ 入口的字段对照', 'source 用事件的裸 worldId；type 里的 .message 是事件种类，不是 source。'),
          helpTable.el,
          ui.h('p', null, '提示词里可用的热值变量：qq.digest.pendingGroups / qq.digest.pendingRecords / qq.digest.lastReview / qq.digest.maxActiveRecords。模型通道仍是让模型在对话轮里调用 qqd_add；这里是给你用的人工通道，两者共用同一套校验。'),
        );

        // ---------- actions ----------
        const renderStats = (stat) => {
          const s = stat && typeof stat === 'object' ? stat : {};
          stats.replaceChildren(
            ui.pill('记录 ' + str(s.records ?? state.records.length), 'plain'),
            ui.pill('群 ' + str(s.groups ?? state.groups.length), 'plain'),
            ui.pill('待确认 ' + str(s.pendingRecords ?? '—'), 'off'),
            ui.pill('待开群 ' + str(s.pendingGroups ?? '—'), 'off'),
            ui.pill('占用 ' + str(s.bytes ?? 0) + ' B', 'plain'),
          );
        };

        const fillFrom = (c) => {
          srcSel.value = c.source;
          convIn.value = c.conv;
          msgIn.value = c.message_id;
          report('已填入扫描到的三元组。选类别、写一句最小摘录，再点「核验并加入」。');
        };

        const renderCandidates = () => {
          if (!state.candidates.length) {
            scanTable.clear(state.scanned
              ? '最近 7 天四个 QQ 入口没有可识别的群消息事件。可以点「刷新扫描」重试，或在 ② 里手工登记会话键。'
              : '还没有扫描结果。点右上角「扫描 QQ 事件」开始；这一步只读宿主事件库，不会写入任何数据。');
            return;
          }
          scanTable.clear();
          for (const c of state.candidates) {
            const ops = opsRow();
            if (!c.enabled) ops.append(smallBtn('人工开启此群', {
              variant: 'primary',
              onClick: () => { void openGroup(c.conv, c.display_name); },
            }));
            ops.append(smallBtn('填入建档', { onClick: () => fillFrom(c) }));
            const convCell = ui.h('div');
            convCell.append(clip(c.conv).el, clip(c.message_id, 'msg ' + c.message_id).el);
            scanTable.addRow([
              clip(c.source, SOURCE_SHORT[c.source] || c.source),
              { el: convCell },
              clip(c.lastTs, c.count + ' · ' + shortTime(c.lastTs)),
              c.registered ? (c.enabled ? ui.pill('已开启', 'on') : ui.pill('已登记·关闭', 'off')) : ui.pill('未登记', 'plain'),
              { el: ops },
            ]);
          }
        };

        const renderGroups = () => {
          if (!state.groups.length) {
            groupsTable.clear('还没有登记任何群。先在 ① 点「扫描 QQ 事件」，再点结果行的「人工开启此群」；或者在本卡上方手工填一个会话键。');
            return;
          }
          groupsTable.clear();
          for (const g of state.groups) {
            const s = g.suggested || { kind: 'unknown', confidence: 0 };
            const ops = opsRow();
            ops.append(smallBtn(g.enabled ? '关闭此群' : '人工开启', {
              variant: g.enabled ? 'danger' : 'primary',
              onClick: () => {
                void run(async () => {
                  await invoke('setGroupEnabled', [g.conv, !g.enabled]);
                  await loadAll();
                  await doScan();
                  return (g.enabled ? '已关闭 ' : '已人工开启 ') + g.conv;
                });
              },
            }));
            groupsTable.addRow([
              clip(g.name ? g.name + ' · ' + g.conv : g.conv),
              (KIND_LABEL[s.kind] || s.kind) + ' · ' + str(s.confidence),
              g.provenance === 'manual' ? '人工' : '规则候选',
              g.enabled ? ui.pill('已开启', 'on') : ui.pill('关闭', 'off'),
              { el: ops },
            ]);
          }
        };

        const save = (id, patch) => run(async () => {
          await invoke('updateRecord', [id, patch]);
          await loadAll();
          return '已更新 #' + id;
        });

        const removeRecord = (id) => run(async () => {
          const ok = await ui.confirm({
            title: '删除记录 #' + id,
            body: '只删本包记录本里的这一条，宿主事件库原件不受影响。',
            danger: true,
          });
          if (!ok) return '已取消删除';
          await invoke('removeRecord', [id]);
          await loadAll();
          return '已删除 #' + id;
        });

        const renderRecords = () => {
          const rows = state.records.filter((r) => {
            if (state.onlyOpen && r.done) return false;
            if (state.category && r.category !== state.category) return false;
            if (state.q && !(str(r.conv) + ' ' + str(r.content) + ' ' + str(r.message_id)).toLowerCase().includes(state.q)) return false;
            return true;
          });
          if (!rows.length) {
            recordsTable.clear(state.records.length
              ? '没有符合筛选条件的记录，换个关键词或类别试试。'
              : '记录本还是空的。先在 ①② 人工开启一个群，再到 ④ 用一条真实消息建档；也可以让模型在对话里调用 qqd_add。');
            return;
          }
          recordsTable.clear();
          for (const r of rows) {
            const contentField = css(ui.input({
              value: r.content, cls: 'mono',
              onChange: (v) => { void save(r.id, { content: v }); },
              onCommit: (v) => { void save(r.id, { content: v }); },
            }), 'width:100%');
            const catField = css(ui.select({
              options: CATEGORY_OPTIONS, value: r.category,
              onInput: (v) => { void save(r.id, { category: v }); },
            }), 'width:100%');
            const ops = opsRow();
            ops.append(smallBtn(r.done ? '恢复未完成' : '标记完成', {
              onClick: () => { void save(r.id, { done: !r.done }); },
            }));
            ops.append(smallBtn('删除', {
              variant: 'danger',
              onClick: () => { void removeRecord(r.id); },
            }));
            const idCell = ui.h('div');
            idCell.append(clip(r.conv).el, clip(r.message_id, 'msg ' + r.message_id).el);
            const tail = ui.h('div');
            tail.append(r.done ? ui.pill('已完成', 'on') : ui.pill('待确认', 'off'), ops);
            recordsTable.addRow([
              '#' + r.id,
              { el: catField },
              { el: idCell },
              { el: contentField },
              { el: tail },
            ]);
          }
        };

        const loadAll = () => run(async () => {
          const [records, groups, stat] = await Promise.all([
            invoke('listRecords', []), invoke('listGroups', []), invoke('stat', []),
          ]);
          state.records = Array.isArray(records) ? records : [];
          state.groups = Array.isArray(groups) ? groups : [];
          renderStats(stat);
          renderGroups();
          renderRecords();
          return '已载入 ' + state.records.length + ' 条记录 / ' + state.groups.length + ' 个群。';
        });

        const doScan = () => run(async () => {
          const out = await invoke('scanIngest', []);
          state.candidates = Array.isArray(out) ? out : [];
          state.scanned = true;
          renderCandidates();
          return state.candidates.length
            ? '扫描到 ' + state.candidates.length + ' 个 QQ 会话（只列会话键与消息 id，不含群聊原文）。点「人工开启此群」后就能建档。'
            : '最近 7 天四个 QQ 入口没有可识别的群消息事件。也可以手工登记会话键。';
        });

        const openGroup = (conv, name) => run(async () => {
          await invoke('upsertGroup', [conv, name || undefined]);
          await invoke('setGroupEnabled', [conv, true]);
          await loadAll();
          await doScan();
          return '已人工开启 ' + conv + '。现在可以从这个会话的真实消息建档。';
        });

        const PREFIX_HINT = {
          'qq-official': 'qq-official.group:',
          'onebot-bridge': 'onebot.group:',
          astrbot: 'astrbot.',
          qq: 'qq.',
        };

        const register = (open) => run(async () => {
          const conv = str(manualConv.value).trim();
          if (!conv) return '请先填会话键。';
          const name = str(manualName.value).trim();
          const expected = PREFIX_HINT[str(manualSource.value)] || '';
          const hint = expected && !conv.startsWith(expected)
            ? '（所选入口的会话键通常以 ' + expected + ' 开头，请核对）' : '';
          await invoke('upsertGroup', [conv, name || undefined]);
          if (open) await invoke('setGroupEnabled', [conv, true]);
          await loadAll();
          await doScan();
          return (open ? '已登记并人工开启 ' : '已登记（关闭）') + conv + hint;
        });

        const submitAdd = () => run(async () => {
          const args = {
            source: str(srcSel.value), conv: str(convIn.value).trim(),
            message_id: str(msgIn.value).trim(), category: str(catSel.value),
            content: str(contentTa.value).trim(),
          };
          if (!args.conv || !args.message_id || !args.content) {
            return '会话键、消息 id 与摘录都要填；三元组请从扫描结果或本轮可见事件里取。';
          }
          const out = await invoke('addRecord', [args]);
          await loadAll();
          const receipt = out && typeof out === 'object' ? str(out.receipt) : str(out);
          if (out && out.ok) contentTa.value = '';
          return '核验结果：' + receipt + (out && out.ok
            ? '（已写入记录本）'
            : '（未写入：检查群是否已人工开启、三元组是否真实存在）');
        });

        const exportAll = () => run(async () => {
          const out = await invoke('exportTable', []);
          const bin = out && out.$binary;
          if (!bin || !bin.base64) return '导出没有返回内容';
          const a = globalThis.document.createElement('a');
          a.href = 'data:' + (bin.mime || 'application/x-ndjson') + ';base64,' + bin.base64;
          a.download = 'qq-digest.records.jsonl';
          a.textContent = '下载记录';
          a.click();
          return '已生成导出文件';
        });

        // ---------- toolbar ----------
        bar.append(
          smallBtn('扫描 QQ 事件', { variant: 'primary', onClick: () => { void doScan(); } }),
          smallBtn('刷新扫描', { onClick: () => { void doScan(); } }),
          smallBtn('刷新记录', { onClick: () => { void loadAll(); } }),
          smallBtn('导出整表', { onClick: () => { void exportAll(); } }),
        );
        manualBar.append(
          smallBtn('登记为关闭', { onClick: () => { void register(false); } }),
          smallBtn('登记并人工开启', { variant: 'primary', onClick: () => { void register(true); } }),
        );
        addForm.append(smallBtn('核验并加入', { variant: 'primary', onClick: () => { void submitAdd(); } }));

        search.addEventListener('input', () => { state.q = str(search.value).toLowerCase(); renderRecords(); });
        catFilter.addEventListener('change', () => { state.category = str(catFilter.value); renderRecords(); });
        if (onlyOpen.input) {
          onlyOpen.input.addEventListener('change', () => {
            state.onlyOpen = !!onlyOpen.input.checked;
            renderRecords();
          });
        }

        ctx.root.append(overview.el, scanSheet.el, groupsSheet.el, recordsSheet.el, addSheet.el);

        // An empty ledger still gets a first action: load, then scan the four
        // QQ ingresses so candidates are visible without an extra click.
        void (async () => { await loadAll(); await doScan(); })();
      },
    },
  },
};
