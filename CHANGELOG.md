# Changelog

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
