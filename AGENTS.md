# AGENTS.md · cortico-world-qq-digest

给接手这个包的编码 Agent 的硬约束。开工前先读 `README.md` 与 `PLAN.md`。

## 不许动

- `PLAN.md`、`contract-approval.json`：只读。`plan_sha256` 锁着定案，改了准奏作废。
- `C:/Users/54301/qq-digest-research-20261117/CONTRACT.md`、`V1..V7*.md`：只读上游证据。
- 宿主（端口 17788 / 7797）：默认只读、优先 GET。**仅当仓主显式授权安装时**才允许 `POST /api/extensions/install` 与 `POST /api/extensions/registry`（临时切官方源，装完还原）；不擅自 PUT / 删除 / 重启。activation、真人群消息只有仓主能做。
- 不替仓主 `git commit` / push / 改仓库可见性，除非被明确要求。

## 写码前门禁

```bash
python -I C:/Users/54301/coopanion-forge-publish/skills/coopanion-forge/scripts/check_contract_approval.py \
  --approval C:/Users/54301/qq-digest/contract-approval.json <要写的相对路径…>
```

`REFUSE` 就停手。scope 只有 `package.json`、`pnpm-workspace.yaml`、`tsconfig.json`、`vitest.config.ts`、`describe.json`、`README.md`、`CHANGELOG.md`、`AGENTS.md`、`CLAUDE.md`、`.gitignore`、`src/**`、`tests/**`。

## 不许重开设计

- 四个工具就是 `qqd_add` / `qqd_update` / `qqd_list` / `qqd_remove`；四类就是 `todo` / `goal` / `prompt` / `insight`。
- 不标 `barrierAfter`；写工具不标 `streamsOutput`。
- 判而不开：规则层只写 `suggested` / `confidence` / `reasons`，`enabled=true` 只能来自 `setGroupEnabled`（人工面板）或模型请示人后落定。
- `pushEvent` 一律 `origin: 'external'`，文案不含群聊原文。
- 去重是包内唯一键 `(conv, message_id, category, sha256(content)[0:12])`；**不要写「平台 snapshot 标签只留最后一次回执」**，那假设已被 REFUTED。
- 不承诺自动合并跨入口同群；转发正文不可见不得编造。
- `MAX_ACTIVE_RECORDS = 2000` 是**猜的起点值**，代码注释与 README 都要标明，别当平台常量。

## 安全红线（闸 5 裸扫零命中）

`src/` 里不许出现 `fetch(`、`XMLHttpRequest`、`net.connect`、`child_process`、`ctx.secret`、`speak`、`act`（字面子串，注释也算）。不用 `storeSecret`，不提供 `speak`/`act` 工具，面板禁 `innerHTML`，外部文本一律 `textContent`。

## 测试与验收

```bash
cd C:/Users/54301/qq-digest
npx vitest run                 # 闸 1，node 环境，不碰宿主、不 mock 平台
pnpm exec tsc --noEmit          # 闸 2
pnpm -C C:/Users/54301/forge-refresh-20261116/fresh/Cortico describe:extension C:/Users/54301/qq-digest
pnpm -C C:/Users/54301/forge-refresh-20261116/fresh/Cortico check:extension C:/Users/54301/qq-digest
```

- 测试用真实临时目录上的 `RecordStore`；只有 `tests/store-rename.test.ts` 为模拟 Windows EPERM 而 mock 了 `fs.renameSync`。
- `describe.json` 由平台脚本生成，不要手改；改了 `src/` 里的工具描述 / 参数 / ENV_PROMPT.md 就要重新生成，否则 `check:extension` 的自描述一致性闸会红。
- 平台脚本在 Cortico 检出根跑；本机 npm 走 npmmirror 加 `--ignore-scripts`。
