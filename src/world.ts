/**
 * A0 assembly: the live World. Owns the ledger, the four tools, the WebUI
 * surface and the prompt template. No model calls, no network, no secrets.
 */
import { Buffer } from 'node:buffer';
import type { ToolDef, World, WorldHost, WorldWebUiDecl } from 'cortico/core/types.ts';
import type { WorldContext } from 'cortico/world.ts';
import { nowIso } from 'cortico/core/util.ts';
import type { QqDigestConfigSection } from './config.ts';
import { QQD_CONFIG_GROUP } from './config.ts';
import { RecordStore } from './store.ts';
import { addHandler, createTools, type ToolsDeps } from './tools.ts';
import { deriveConvKey } from './conv.ts';
import { assertAdvisoryOnly, suggestGroupNature } from './classify.ts';
import { ENV_PROMPT_FILE, ENV_PROMPT_KEY, ENV_PROMPT_VAR_DECLS, envPromptVars, reminderText } from './prompt.ts';
import { CATEGORIES, PANEL_METHODS, PANEL_READ_METHODS, QQ_SOURCES } from './types.ts';
import type { Category, IngestCandidate, IngestEvent, PanelInvokeMethod, UpdatePatch } from './types.ts';

const WORLD_ID = 'qq-digest';
const PANEL_ID = 'records';

const asCategory = (v: unknown): Category | null =>
  (typeof v === 'string' && (CATEGORIES as readonly string[]).includes(v) ? v as Category : null);

export class QqDigestWorld implements World {
  readonly id = WORLD_ID;
  readonly store: RecordStore;
  private host: WorldHost | null = null;

  constructor(private readonly ctx: WorldContext<QqDigestConfigSection>) {
    this.store = new RecordStore(ctx.dataDir, ctx.cfg.maxActiveRecords);
  }

  /** C8: hot values are read on every prefix rebuild. */
  envPromptVars(): Record<string, string> {
    return envPromptVars(this.store, this.ctx.cfg.maxActiveRecords);
  }

  tools(): ToolDef[] {
    return createTools(this.panelDeps());
  }

  /**
   * Shared by the four model tools and the panel RPCs. `host` is read at call
   * time: webUi() can be declared before start(host) has run.
   */
  private panelDeps(): ToolsDeps {
    return {
      store: this.store,
      // C2: the raw event store is shared; we only read it.
      range: (q) => (this.host ? this.host.store.range(q) : []) as readonly IngestEvent[],
      audit: async (type, text) => {
        if (!this.host) return;
        // Q1: always external; the copy never carries group text.
        await this.host.pushEvent({
          type, ts: nowIso(this.ctx.timezone), source: WORLD_ID,
          origin: 'external', senderKey: WORLD_ID, text,
        });
      },
      now: () => nowIso(this.ctx.timezone),
    };
  }

  /** C1/C9: panel RPC, read methods are GET-safe; export uses $binary. */
  webUi(): WorldWebUiDecl {
    const store = this.store;
    const stats = store.stats();
    return {
      lamps: [
        {
          label: `${stats.pendingGroups} 群待开`,
          state: stats.pendingGroups > 0 ? 'loading' : 'online',
          hint: '开群只能由人工在面板里标记',
        },
        {
          label: `${stats.pendingRecords} 条待确认`,
          state: stats.pendingRecords > 0 ? 'loading' : 'online',
          hint: '待办与见解需要人工确认',
        },
      ],
      badges: [
        { label: '记录', value: stats.records },
        { label: '群', value: stats.groups },
      ],
      panels: [{
        id: PANEL_ID,
        title: 'QQ 群消息摘要',
        description: '先「扫描 QQ 事件」看到插件推入的会话 → 人工开启群 → 从真实消息建档；下方还能纠正、筛选、导出。未开启的群拒绝一切写入。',
        getMethods: [...PANEL_READ_METHODS],
      }],
      promptDocs: [{
        key: ENV_PROMPT_KEY,
        title: 'QQ 群消息摘要 · 环境提示词',
        description: '进入 system 前缀的那一段；热值由 envPromptVars() 提供。',
        path: ENV_PROMPT_FILE,
        role: 'envPrompt',
        vars: ENV_PROMPT_VAR_DECLS.map((v) => ({ ...v })),
      }],
      storage: [{
        key: 'qq-digest.ledger',
        label: 'QQ 群消息摘要记录本',
        kind: 'disk',
        location: this.ctx.dataDir,
        danger: true,
        note: '只清本包 dataDir 下的 qq-digest.* 文件；宿主事件库原件不受影响。',
        stat: () => `${store.stats().records} 条记录 / ${store.stats().bytes} 字节`,
        clear: async () => { await store.clear(); return '记录本已清空'; },
      }],
      config: [QQD_CONFIG_GROUP],
      invoke: async (panel: string, method: string, args: unknown[]) => {
        if (panel !== PANEL_ID) throw new Error('unknown panel');
        if (!(PANEL_METHODS as readonly string[]).includes(method)) throw new Error('unknown method');
        const m = method as PanelInvokeMethod;
        const first = (i: number): unknown => args[i];
        switch (m) {
          case 'listRecords': {
            const conv = first(0);
            const category = asCategory(first(1));
            return store.list({
              ...(typeof conv === 'string' ? { conv } : {}),
              ...(category ? { category } : {}),
            });
          }
          case 'listGroups': return store.groups();
          case 'setGroupEnabled': {
            const conv = first(0);
            if (typeof conv !== 'string' || typeof first(1) !== 'boolean') throw new Error('bad args');
            return store.setGroupEnabled(conv, first(1) as boolean);
          }
          case 'updateRecord': {
            const id = Number(first(0));
            if (!Number.isInteger(id)) throw new Error('bad id');
            const p = first(1) && typeof first(1) === 'object'
              ? first(1) as Record<string, unknown> : {};
            const category = asCategory(p.category);
            const patch: UpdatePatch = {
              ...(typeof p.content === 'string' ? { content: p.content } : {}),
              ...(category ? { category } : {}),
              ...(typeof p.done === 'boolean' ? { done: p.done } : {}),
            };
            return store.update(id, patch);
          }
          case 'removeRecord': {
            const id = Number(first(0));
            if (!Number.isInteger(id)) throw new Error('bad id');
            return { removed: await store.remove(id) };
          }
          case 'exportTable': {
            const body = store.list({ limit: 1000 }).map((r) => JSON.stringify(r)).join('\n') + '\n';
            return { $binary: { mime: 'application/x-ndjson', base64: Buffer.from(body, 'utf8').toString('base64') } };
          }
          case 'stat': return store.stats();
          case 'clear': { await store.clear(); return 'cleared'; }
          /** 0.2.0: read the four QQ ingresses so an empty ledger still has a first action. */
          case 'scanIngest': {
            const deps = this.panelDeps();
            const toTs = deps.now();
            const fromTs = new Date(new Date(toTs).getTime() - 7 * 24 * 3600_000).toISOString();
            const byConv = new Map<string, IngestCandidate>();
            for (const src of QQ_SOURCES) {
              for (const ev of deps.range({ source: src, fromTs, toTs, limit: 1000 })) {
                const key = deriveConvKey(ev);
                if (!key || !key.conv || !key.message_id) continue;
                const g = store.getGroup(key.conv);
                const prev = byConv.get(key.conv);
                if (prev) {
                  prev.count += 1;
                  if ((ev.ts ?? '') >= prev.lastTs) {
                    prev.lastTs = ev.ts ?? '';
                    prev.message_id = key.message_id;
                  }
                  continue;
                }
                byConv.set(key.conv, {
                  conv: key.conv, source: src, message_id: key.message_id,
                  count: 1, lastTs: ev.ts ?? '', display_name: key.display_name,
                  registered: !!g, enabled: !!g?.enabled,
                });
              }
            }
            // C7: no ev.text leaves this method — ids, keys and counts only.
            return [...byConv.values()].sort((a, b) => b.lastTs.localeCompare(a.lastTs)).slice(0, 100);
          }
          /** C1: register a closed group. Only setGroupEnabled may open it. */
          case 'upsertGroup': {
            const conv = first(0);
            if (typeof conv !== 'string' || !conv.trim()) throw new Error('bad conv');
            const rawName = first(1);
            const name = typeof rawName === 'string' && rawName.trim() ? rawName.trim() : undefined;
            const suggestion = suggestGroupNature({
              conv, groupName: name, prior: store.getGroup(conv),
            });
            assertAdvisoryOnly(suggestion);
            return store.suggestGroup(conv, suggestion, name);
          }
          /** Human-classified add: same gate, verification and audit as qqd_add. */
          case 'addRecord': {
            const p = first(0) && typeof first(0) === 'object'
              ? first(0) as Record<string, unknown> : {};
            const receipt = await addHandler(this.panelDeps())(p);
            return { receipt, ok: receipt.startsWith('added #') || receipt.startsWith('duplicate of #') };
          }
        }
      },
    };
  }

  async start(host: WorldHost): Promise<void> {
    this.host = host;
    await this.store.load();
    const s = this.store.stats();
    // Q1: external reminder, counts only, no group text.
    await host.pushEvent({
      type: 'qq-digest.reminder',
      ts: nowIso(this.ctx.timezone),
      source: WORLD_ID,
      origin: 'external',
      senderKey: WORLD_ID,
      text: reminderText(s.pendingGroups, s.pendingRecords),
    });
  }

  /** C8: Core grants only 20s for stop(); bound the flush so shutdown cannot hang. */
  async stop(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const bounded = new Promise<void>((resolve) => { timer = setTimeout(resolve, 8000); });
    try {
      await Promise.race([this.store.flush(), bounded]);
    } finally {
      // Otherwise an 8s timer would keep the process alive after every stop().
      if (timer) clearTimeout(timer);
    }
    await this.store.markReview();
    this.host = null;
  }
}
