/* Hand-written WebUI panel, no build chain. Default export follows
   docs/extensions.md: { panels: { <id>: { mount(ctx) } } }.
   C9: untrusted group names, nicknames and excerpts only ever reach
   textContent; HTML markup injection is never used. */
export function methodNames() {
  return ['listRecords', 'listGroups', 'setGroupEnabled', 'updateRecord',
    'removeRecord', 'exportTable', 'stat', 'clear'];
}

export function readMethods() {
  return ['listRecords', 'listGroups', 'exportTable', 'stat'];
}

function el(tag, text) {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = String(text);
  return n;
}

function button(label, fn) {
  const b = el('button', label);
  b.type = 'button';
  b.addEventListener('click', () => { void fn(); });
  return b;
}

async function refresh(ctx, recordsRoot, groupsRoot, status) {
  try {
    const [records, groups] = await Promise.all([
      ctx.invoke('listRecords', []), ctx.invoke('listGroups', []),
    ]);
    recordsRoot.replaceChildren();
    for (const r of records) {
      const row = el('div');
      row.append(el('span', `#${r.id}`), el('span', r.category), el('span', r.content));
      row.append(button('标记完成', async () => {
        await ctx.invoke('updateRecord', [r.id, { done: !r.done }]);
        await refresh(ctx, recordsRoot, groupsRoot, status);
      }));
      row.append(button('删除', async () => {
        await ctx.invoke('removeRecord', [r.id]);
        await refresh(ctx, recordsRoot, groupsRoot, status);
      }));
      recordsRoot.append(row);
    }
    groupsRoot.replaceChildren();
    for (const g of groups) {
      const row = el('div');
      row.append(el('span', g.name || g.conv), el('span', g.suggested.kind));
      row.append(button(g.enabled ? '关闭' : '人工开启', async () => {
        await ctx.invoke('setGroupEnabled', [g.conv, !g.enabled]);
        await refresh(ctx, recordsRoot, groupsRoot, status);
      }));
      groupsRoot.append(row);
    }
    status.textContent = `已载入 ${records.length} 条记录 / ${groups.length} 个群`;
  } catch (err) {
    status.textContent = `载入失败：${err instanceof Error ? err.message : String(err)}`;
  }
}

export default {
  panels: {
    records: {
      mount(ctx) {
        const wrap = el('div');
        const status = el('p', '载入中');
        const note = el('p', '开群只能由人工标记；规则层只给候选与置信。');
        const groupsRoot = el('div');
        const recordsRoot = el('div');
        wrap.append(note, status, el('h3', '逐群开关'), groupsRoot, el('h3', '记录'), recordsRoot);
        wrap.append(button('刷新', () => refresh(ctx, recordsRoot, groupsRoot, status)));
        wrap.append(button('导出整表', async () => {
          const out = await ctx.invoke('exportTable', []);
          if (out && out.$binary && out.$binary.base64) {
            const a = el('a', '下载记录');
            a.href = `data:${out.$binary.mime};base64,${out.$binary.base64}`;
            a.download = 'qq-digest.records.jsonl';
            a.click();
          }
        }));
        ctx.root.append(wrap);
        void refresh(ctx, recordsRoot, groupsRoot, status);
      },
    },
  },
};
