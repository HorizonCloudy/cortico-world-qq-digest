# Changelog

## 0.2.1 (2026-11-18)

按仓主 2026-11-18「UI 被损坏了，每一块都窄一些」的反馈修面板布局。**只改 `src/webui/client.js` 与 `tests/panel.test.ts`，不动后端、不动契约、不动 `PLAN.md`**。

### 原缺陷（真实浏览器实测）

0.2.0 的表格 7 列无列宽约束，长 mono 会话键 / 消息 id 把表格撑到 1953px（宿主卡片只有 1040px），后四列与操作按钮跑到屏幕外；`ui.rowbar()` 的 `flex-wrap:wrap` 在操作列里把「填入建档」压成 37px 宽 × 94px 高的竖条，行高 179px。卡片在当前宿主主题下只有一条分隔线，看不出边界。

### 修复

- 每张卡 `max-width:880px` 居中，恢复 1px 边框与内边距，成为清晰的一块。
- 所有表格 `table-layout:fixed` + 声明列宽；扫描表与记录表由 7 列收敛为 5 列（状态与操作合并、消息 id 并入会话键单元格）。
- 长标识单行省略，完整值放 `title`；「条数·最近」只显示 `条数 · HH:mm`，入口列显示短名（`title` 保留裸 worldId）。
- 操作单元格改 `flex-wrap:nowrap`，按钮 `white-space:nowrap`，不再竖排。
- `minimalUi()` 降级路径同步以上约束。

### 验证

- `npx vitest run`：12 files / **128 passed**；`tsc --noEmit` 退 0；平台 `describe:extension` / `check:extension` 退 0；契约门禁 5 项 ALLOW；安全裸扫零命中。
- 真实浏览器 CDP 量测（拦截面板资源后重载）：卡片 880px；四个表格 `scrollWidth == clientWidth`（830/830、840/840 ×3）；「填入建档」76×34px；行高 47–57px；扫描表 5 列。
- **宿主把面板脚本按版本缓存在进程内存**（`cortico/src/web/server.ts:2432`：发加载时读进内存的字节，不读磁盘）。装完 0.2.1 后刷新浏览器无效，**必须重启宿主**才能看到新面板。0.2.0 交付说明里「刷新页面即可」的判断有误，以此条为准。

## 0.2.0 (2026-11-18)

按仓主 2026-11-18「这没法操作啊，重新设计」的明确指令重做 WebUI 面板。**只改交互层与面板 RPC，不动 `PLAN.md` 定案、不动契约 C1–C10**，`plan_sha256` 保持不变；改前已补跑 `check_contract_approval.py`，10 项全 ALLOW。

### 原缺陷

0.1.1 的 `src/webui/client.js` 只用裸 `document.createElement`，没用宿主 `ctx.ui` 原语，在宿主里渲染成五行纯文字：按钮没有边框样式（「刷新」「导出整表」连成一坨认不出来），「逐群开关」「记录」两个标题下全空。更致命的是**空数据死锁**：群表只有被登记过的群才会出现，而记录又只能在开群后由模型写入；`0 条记录 / 0 个群` 时面板没有任何可以点的第一步，也没把 QQ 插件推入的事件接进来，人无从下手。

### 重设计

- 面板改用宿主 `ctx.ui` 原语（`sheet` / `rowbar` / `button` / `input` / `select` / `textarea` / `table` / `pill` / `checkbox` / `confirm`），按钮、输入框、表格、卡片、空态全部走宿主主题样式；宿主不提供 `ctx.ui` 时有带内联样式的原生 DOM 降级，不会再退化成纯文字。
- 五张卡按操作顺序排：概览与工具条 → ① 扫描 QQ 插件推入的会话 → ② 逐群开关（含手工登记会话键）→ ③ 记录本（搜索 / 类别筛选 / 只看未完成 / 就地改摘录与类别 / 完成 / 删除）→ ④ 从一条真实消息建档 + 四入口字段对照。
- **打开面板即自动扫描**：`scanIngest` 只读宿主事件库里四个 QQ 入口最近 7 天的事件，用 `deriveConvKey` 按会话键聚合，列出 source / conv / 最新 message_id / 条数 / 时间 / 登记状态。空记录本也有明确第一步，不再死锁。
- 三个新面板 RPC：
  - `scanIngest`（GET-safe，只读，**不返回任何 `ev.text`**）
  - `upsertGroup`（只登记关闭群，产出性质候选 + 置信；**绝不写 `enabled`**）
  - `addRecord`（人工分类写入，复用 `qqd_add` 的同一条 `addHandler`）
- `addHandler` 从 `createTools` 抽出为单一真源：模型通道 `qqd_add` 与人工通道 `addRecord` 共用「群未开 → `group-disabled` → 回查三元组 → 审计 → `store.add` → 去重回执」，门禁不会各自漂移。
- 开群仍然只能由人点：`upsertGroup` 不接受 `enabled` 参数，开启必须另点 `setGroupEnabled`（C1）。扫描行给「人工开启此群」，群表给「人工开启 / 关闭此群」，手工登记给「登记为关闭 / 登记并人工开启」。
- 扫描行可「填入建档」，自动带出真实三元组，人选类别、写一句最小摘录后核验写入；编造的三元组仍回 `source-unknown`，群未开仍回 `group-disabled`（C2/C7）。
- 所有外部文本（群名、昵称、摘录）仍只进 `textContent`；无 `innerHTML`、无 `fetch` / 动态导入 / 构建链（C9）。

### 验证

- `npx vitest run`：12 files / **123 passed**（0.1.1 为 11 files / 108 passed）；`pnpm exec tsc --noEmit` 退 0。
- 新增 `tests/panel-actions.test.ts`（9 例）：四入口聚合且不泄漏原文、`upsertGroup` 不开群、`addRecord` 的 group-disabled / source-unknown / 外部审计 / 写入后 `qqd_add` 去重。
- 重写 `tests/panel.test.ts`（14 例）：FakeUi 复现宿主原语，断言按钮是真 `button` 且带 `primary`、空态有下一步引导、扫描→开群→建档链路、降级路径不抛错。
- `tests/world.test.ts` 的 `PANEL_METHODS` 数量断言 8 → 11；`PANEL_READ_METHODS` 增加 `scanIngest`。

## 0.1.1 (2026-11-18)

修复两处会让本包在真实宿主里失效的缺陷，不改 `PLAN.md` 的设计与契约 C1–C10。

- **envPrompt 变量不可渲染**：平台 `core/template.ts:9` 的占位符名只允许 `[\w.]`，原先的 `qq-digest.*` 含连字符，四个 `{{...}}` 会原样进入 system 前缀。变量名统一改为 `qq.digest.*`，并收敛到 `ENV_PROMPT_VAR_DECLS` 单一真源；新增 `tests/env-template.test.ts` 用平台 `renderTemplate` 真渲染并做负向控制。
- **与 QQ 插件联动断裂**：四个 QQ World 推事件时 `source` 是裸 worldId（`qq-official` / `onebot-bridge` / `astrbot` / `qq`），`.message` 只是 `type` 里的事件种类；`EventStore.range` 对 source 做全等比较（`event-store.ts:272,290`）。原实现拿调用方传入的完整 type 去查，必然零命中，`qqd_add` 永远回执 `source-unknown`。现改为按裸 worldId 查询，并把记录里的 source 也存成裸 worldId 以便三元组复查。
- 按已装插件源码补齐四入口字段：`qq-official` 读 `meta.messageId`（驼峰）、`meta.target` / `meta.author`；`astrbot` 读 `meta.platformMsgId`；`onebot-bridge` 读 `meta.raw`；内置 `qq` 读 `meta.message_id` / `meta.conv`。原有字段顺序保留为兼容回退。
- `ENV_PROMPT.md` 与 `qqd_add` 的 `source` 参数描述写明四入口取值、type 与 source 的区别、以及 conv / message_id 的取法；`qqd_add` 的 description 不再把 `qq-official.message` 当成 source 示例。
- 新增 `tests/live-qq.test.ts`：四入口真实事件形状 + 模拟宿主精确匹配，验证 `verifySource` 与 `qqd_add` 能写入；含「完整 type 查不到」的负向控制。测试总数 92 → 108。
- `package.json` 的 `repository` 改成对象形式，消除 `npm publish` 的自动规范化警告。
- 交付口径按仓主 2026-11-18 后续指令更新：GitHub 公开仓库 → npm 公开包 → 从 npm 安装进宿主；**不进索引仓**。0.1.0 的「本地可安装包、不发 npm」是当时的裁决原文，作为历史记录保留在下节。

## 0.1.0 (2026-11-18)

首个本地可安装版本。设计定案于 `PLAN.md`（`plan_sha256` 锁定），契约准奏附必改 C1–C10，实现阶段不重开设计。

- 四分支会话键派生：`qq-official`（senderKey 即会话键）、`onebot-bridge`（`meta.raw.group_id`）、`astrbot`（三段 UMO）、内置 `qq`（`meta.conv`）。所有入库值一律 `String()` 化。
- 四个轮内工具 `qqd_add` / `qqd_update` / `qqd_list` / `qqd_remove`；不标 `barrierAfter`，写工具不标 `streamsOutput`。
- 四类记录 `todo` / `goal` / `prompt` / `insight`；模型在对话轮里调工具分类，World 不调模型、不出网、不做后台批处理。
- 开群两步制：规则层只产出候选 + 置信 + 依据，`enabled=true` 只能由面板人工标记；未开群所有写操作回执 `group-disabled`。
- 包侧入参核验：`host.store.range` 回查 `(source, conv, message_id)`，onebot 再按 `raw.group_id` 二次过滤；不命中回执 `source-unknown` 并记不含原文的审计事件。
- 包内去重唯一键 `(conv, message_id, category, sha256(content)[0:12])`，重复调用回执 `duplicate of #<id>`。
- 包内记录本落 `ctx.dataDir` 的 `qq-digest.*`，原子写 tmp → rename、Windows EPERM 重试、单异步写队列、`storage.clear` 只清本包文件。
- 手写 WebUI 面板（无构建链）：逐群开关、记录浏览与纠正、`$binary` 导出、两盏导航灯、`StoragePart(stat/clear)`；所有外部文本走 `textContent`。
- `role=envPrompt` 模板与四个热值；提醒与审计事件一律 `origin: 'external'`，文案不含群聊原文。
- `MAX_ACTIVE_RECORDS = 2000` 为**猜测的起点值**，非平台既定数，可在配置中修改。

交付形态：本地目录安装，不发 npm、不进索引仓。需仓主手动完成的步骤：activation、真人群消息验证、推包。宿主 17788 / 7797 本机只允许 GET，本次未执行任何 POST / 重启。
