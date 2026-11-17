# CLAUDE.md

本包的完整硬约束见同目录 `AGENTS.md`（门禁命令、只读文件、安全裸扫、验收闸、宿主边界）。以下只列 Claude Code 侧容易踩的几条。

- **设计已定案**：`PLAN.md` 的 sha256 被 `contract-approval.json` 锁定。不要「顺手优化」四个工具、四类记录、开群门槛或事件来源，那是重新送审的事。
- **动码前跑门禁**：
  `python -I C:/Users/54301/coopanion-forge-publish/skills/coopanion-forge/scripts/check_contract_approval.py --approval C:/Users/54301/qq-digest/contract-approval.json <相对路径…>`
- **Python 一律 `python -I`**（本机从不可信目录 import 会中招）；脚本放在被读目录之外。
- **宿主只读**：17788 / 7797 只允许 GET。不要 POST activation、不要重启、不要删宿主数据。activation 与真人群消息写进给仓主的说明书。
- **Node / npm**：本机 `node v22.22.2`、`pnpm 12.18.0`；npmjs TLS 不稳，装依赖走 `--registry=https://registry.npmmirror.com --ignore-scripts`。不要碰 Cortico 的 `tests/web/*`。
- **验收**：`npx vitest run` → `pnpm exec tsc --noEmit` → Cortico 检出根的 `describe:extension` → `check:extension`。`describe.json` 由脚本生成，别手改。
- **提交**：默认不 commit / push / tag，仓主明确要求才做；提交前排除 `node_modules/`、`data/`、`*.tmp`、`*.log`。
