# Changelog

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
