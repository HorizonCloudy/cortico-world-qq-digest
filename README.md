# cortico-world-qq-digest

把四个 QQ 入口（`qq-official.*`、`onebot-bridge.*`、`astrbot.*`、内置 `qq.*`）收到的群消息，在**对话轮里由模型调工具**分成四类记录（待办 `todo` / 目标 `goal` / 提示词参考 `prompt` / 建议与见解 `insight`），存在本包 `ctx.dataDir` 的记录本里，用 WebUI 面板浏览、纠正、逐群开关。

- 形态：World 扩展（`cortico.kind=world`，`cortico.api=6`），World id `qq-digest`。
- 平台：cortico@0.2.16（本机宿主 0.2.21）。
- 交付：npm 公开包 `cortico-world-qq-digest`（源码 `HorizonCloudy/cortico-world-qq-digest`），从 npm 装进宿主；不进索引仓。0.1.0 的裁决原文是「本地可安装包，不发 npm」，仓主 2026-11-18 后续指令改为 GitHub → npm → 从 npm 安装，见 `CHANGELOG.md`。
- 运行时不做：后台批处理、World 调模型、任何出网、跨入口同一物理群的自动合并、转发正文读取（一期只落占位记录）。设计已定案（`PLAN.md` + `CONTRACT.md` + `contract-approval.json`），改动设计需重新送审，不要在这个包里重开设计。

## 与 QQ 插件怎么联动

本包**不直连 QQ**：四个 QQ World（`cortico-world-qqbot` / `onebot-bridge` / `astrbot-bridge` / 内置 `qq`）把消息推进宿主事件库，模型在对话轮里看到事件后调 `qqd_add`，本包再用 `host.store.range` 回查三元组 `source / conv / message_id` 真实存在才落盘。事件的 `source` 是裸 worldId，`type` 才是 `qq-official.message` 这种带事件种类的字符串——`range` 对 source 做全等比较，所以回查一律按裸 worldId 做。四个入口的 conv 与 message_id 字段表写在 `src/ENV_PROMPT.md`，会随环境前缀一起交给模型。

## 怎么装

> 宿主是 `http://127.0.0.1:17788`。安装走 `POST /api/extensions/install`；**重启宿主与 activation 由仓主决定**，装完只是 `pending-restart`，不重启不会加载新代码。

1. 依赖就绪（写码时已验过，Node 22.22.2 / pnpm 12.18.0）：

   ```bash
   cd C:/Users/54301/qq-digest
   pnpm install --registry=https://registry.npmmirror.com --ignore-scripts
   ```

   本机 npmjs TLS 不稳，固定走 npmmirror。

2. 从 npm 安装（宿主扩展源若指向未同步的镜像，先在 WebUI / `POST /api/extensions/registry` 临时切到 `https://registry.npmjs.org/`，装完还原）：

   ```bash
   # 或等价地让宿主执行：
   curl -X POST -H 'Content-Type: application/json' \
     -d '{"name":"cortico-world-qq-digest","version":"0.1.1"}' \
     http://127.0.0.1:17788/api/extensions/install
   ```

   `package.json` 的 `files` 已包含 `describe.json`、`LICENSE` 与面板产物 `src/webui/client.js`；声明了的产物不在包内会 `check:extension` 失败。

3. **重启宿主后确认 activation**：本包 `defaults().enabled = false`，装完只是 `pending-restart`。重启后在 WebUI 里启用 `qq-digest`，或由仓主对宿主发 `POST /api/worlds/activation`。**`loaded` 不等于可用**，必须再确认 `enabled`。

4. 首次启用后所有群默认**关闭**。规则层只给候选 + 置信 + 依据，不会自动开群；请人在 WebUI 面板里逐群点「人工开启」，`qqd_add` / `qqd_update` / `qqd_remove` 才有写权限。未开群一律回执 `group-disabled`。

## 怎么验

写码阶段已跑过的八道闸（每条都留了命令与退出码在交付回奏里）：

| 道 | 命令 | 过闸标准 |
|---|---|---|
| 1 | `npx vitest run`（包内） | 退 0；108 个用例覆盖 PLAN 每条硬约束、平台模板渲染与四入口真实事件形状 |
| 2 | `pnpm exec tsc --noEmit` | 退 0 |
| 3 | `pnpm -C C:/Users/54301/forge-refresh-20261116/fresh/Cortico describe:extension C:/Users/54301/qq-digest` | 退 0，生成 `describe.json` |
| 4 | `pnpm -C C:/Users/54301/forge-refresh-20261116/fresh/Cortico check:extension C:/Users/54301/qq-digest` | 退 0（`Extension check passed.`） |
| 5 | 对 `src/` 裸扫 `fetch(`、`XMLHttpRequest`、`net.connect`、`child_process`、`ctx.secret`、`speak`、`act` | 全部零命中 |
| 6 | `tests/dry-mount.test.ts` 用平台自己的 `cortico/extensions/dry-mount.ts` 的 `dryMountWorld` | `report.failures === []`，四工具全注册、无重名 |
| 7 | 从 npm 安装 + 重启宿主后 `GET http://127.0.0.1:17788/api/extensions` | `state == loaded`，再看 `enabled`；0.1.1 更新后仍需重启才加载新代码 |
| 8 | 真人在群里发一条消息 | 只有仓主能做，本次交付未执行 |

包内一键复跑前六道：

```bash
cd C:/Users/54301/qq-digest
npx vitest run
pnpm exec tsc --noEmit
```

第 7 道：0.1.0 已从 npm 装进宿主，宿主侧当前 `state=loaded` / `enabled=true`；**0.1.1 装完后新代码仍要重启才生效**。第 8 道只有仓主能做，**状态为「未核验」**，不写成通过。

## 存储与隐私

- 位置：`ctx.dataDir`，全部以 `qq-digest.` 前缀命名：
  - `qq-digest.records.jsonl` — 记录本（引用 + 最小摘录）
  - `qq-digest.groups.json` — 群表（`suggested` / `enabled` / `provenance`）
  - `qq-digest.counters.json` — id 计数器与上次回看游标
  - `qq-digest.archive.jsonl` — 超出上限时按时间归档的记录
- 原子写：同目录 `*.tmp` → `renameSync`，Windows 上 rename 被占用时重试 5 次，仍失败则抛错并**保留 tmp 与原文件**；所有写走单条异步写队列。
- **`MAX_ACTIVE_RECORDS = 2000` 是猜测的起点值，不是平台既定数**（CONTRACT Q7 / V4-C12 INFERRED）。可在面板配置里改 `worlds.qq-digest.maxActiveRecords`，超出后按 ts 归档最旧的记录。
- 记录本**只存引用 + 最小摘录**，不存群聊全文。**宿主事件库另有不可删的原文**：合法平台 API 没有删除事件原件的路径，本包也不碰事件库。面板的 `storage.clear` 只清本包 `qq-digest.*` 文件。
- 群内容一律按**未认证外部输入**对待；`pushEvent` 提醒与审计事件一律 `origin: 'external'`，文案只报计数 / 原因 / 来源名，不含群聊原文。
- 一期不宣称能自动合并跨入口的同一个物理群：官方 API 全链路只有 `group_openid`，与 onebot 数字群号没有可自动对齐的字段。转发正文不可见，不得编造。

## 运维红线

- **禁止双实例**：Core 只给 20 秒 `stop()` flush，两个强制实例会互相覆盖、丢更新。同一部署只挂一个 `qq-digest`。
- **卸载**：平台没有清理钩子。顺序是「先停用 → 面板 `storage.clear` → 手工删除 `dataDir` 下 `qq-digest.*`」。事件库原件按平台 API 无法删除，需按宿主的合规流程另行处理。
- 工具入参不可信：平台不校验，`ToolCallContext` 也不含本轮事件。`qqd_add` 落盘前用 `host.store.range` 回查 `(source, conv, message_id)`；onebot 路线再按 `meta.raw.group_id` 二次过滤，防止串群。不命中回执 `source-unknown` 并记一条不含原文的审计事件。
- 去重是**包内**唯一键 `(conv, message_id, category, sha256(content)[0:12])`，重复调用回执 `duplicate of #<id>`。不要写成「平台 snapshot 标签会自动只留最后一次回执」——那条假设已被 REFUTED，平台不读 `tags` 去重。

## 材料与契约

| 文件 | 作用 |
|---|---|
| `PLAN.md` | 定案（sha256 已被 `contract-approval.json` 锁定），只读 |
| `contract-approval.json` | 契约准奏记录，写码门禁真源，只读 |
| `C:/Users/54301/qq-digest-research-20261117/CONTRACT.md` | C1–C10 必改全文与 R1–R10 裁决 |
| `describe.json` | 由 `describe:extension` 从代码自描述生成，不要手改 |

动任何代码文件之前先跑门禁：

```bash
python -I C:/Users/54301/coopanion-forge-publish/skills/coopanion-forge/scripts/check_contract_approval.py \
  --approval C:/Users/54301/qq-digest/contract-approval.json <要写的相对路径…>
```
