# jev-superpowers-zh

**中文 AI 编程方法论 × jev 门禁，一个包、27 个技能、26 款宿主。**

jev-superpowers-zh 以 [superpowers-zh](https://github.com/jnMetaCode/superpowers-zh) 的 21 个中文技能与多工具安装器为底座，叠加 6 个汉化的 [jev-superpowers](https://github.com/AkashPriyadarshii/jev-superpowers) 门禁技能（`jev-*`），共同方法论上游为 [obra/superpowers](https://github.com/obra/superpowers)。门禁默认**软降级**：缺工具、离线时中文方法论照常工作，不阻断你的流程。

- **27 个技能 = 21 个中文方法论技能 + 6 个 jev 门禁技能**（路由/头脑风暴/规划/执行/调试/验证）
- **26 款 AI 编程宿主**：Claude Code、Cursor、Codex CLI、Kiro、Trae、Gemini CLI、OpenCode、Aider、Cline、Kilo Code 等，一条 `npx jevzh` 自动识别
- **零第三方依赖**：安装器与门禁全部用 Node 标准库 + bash 实现；Windows / macOS / Linux 均可
- **安全收口**：家目录护栏、备份轮转、哨兵式精确切除、提交/停止双钩子

## 快速开始

前置要求：**Node.js ≥ 20**。Windows 用户另需 **Git for Windows**（钩子经 `hooks/run-hook.cmd` 调 Git Bash 执行，WSL 也行但需其中自带 Node）。

```bash
# 项目级安装：自动检测当前目录用的是哪款工具，装 27 个技能 + hooks + .jevzh.json
npx jevzh

# 或全局安装后使用
npm install -g jev-superpowers-zh
jevzh
```

常用形态：

| 命令 | 作用 |
|---|---|
| `npx jevzh` | 项目级自动检测安装（27 技能 + hooks + `.jevzh.json`） |
| `npx jevzh --global` | 装到用户级目录，所有项目共享（仅部分宿主支持，见下表） |
| `npx jevzh --tool cursor` | 强制指定宿主（检测不到或多宿主并存时使用） |
| `npx jevzh --no-jev` | 纯中文技能形态：只装 21 个中文技能，不装 hooks、不生成 `.jevzh.json` |
| `npx jevzh --strict` | 新生成的配置默认 `strict:true`（已存在的 `.jevzh.json` 不覆盖） |
| `npx jevzh --adopt-skills` | 备份后接管同名的他方技能（superpowers-zh / jev / obra / 未知） |
| `npx jevzh --keep-router` | 保留旧发行版引导段/规则文件，不切除、不合并 hooks 配置 |
| `npx jevzh --detect-only` | 只做共存预检并打印五级处置矩阵，绝不写盘；有 BLOCK 时 exit 2 |
| `npx jevzh doctor` | 只读诊断：竞品痕迹/归属/SKIP 残留/hooks/就绪状态/备份 |
| `npx jevzh restore --list` | 列出接管备份（`.jevzh/backups/<时间戳>`，自动轮转留 3 份） |
| `npx jevzh restore <时间戳>` | 离线恢复（恢复前自动再备一份当前状态） |
| `npx jevzh --uninstall` | 卸载当前项目（加 `--global` 卸载全局；`.jevzh.json` 默认保留） |
| `npx jevzh --force` | 允许在用户主目录做项目级安装（默认拒绝，别轻易用） |

## 宿主与钩子矩阵

jevzh 安装器覆盖 26 个宿主目标。**仅 Claude Code 与 Cursor 自动接线 hooks**（SessionStart/PreToolUse/Stop 三类），其余宿主只装技能，门禁靠技能正文在流程中手动执行。

| 宿主 | 项目级技能目录 | 全局目录 | 自动 hooks |
|---|---|---|---|
| Claude Code | `.claude/skills/` | `~/.claude/skills/` | ✓ 三钩子 |
| Cursor | `.cursor/skills/` | — | ✓ 三钩子（v1 格式） |
| Codex CLI | `.agents/skills/` | `~/.agents/skills/` | — |
| Kiro | `.kiro/skills/`（+ `steering/jevzh.md` 索引） | — | — |
| DeerFlow | `skills/custom/` | — | — |
| Trae（国际/国内版项目级） | `.trae/skills/`（+ `.trae/rules/jevzh.md`） | — | — |
| TRAE CN | 项目级与 Trae 相同，用 `--tool trae` | `~/.trae-cn/skills/` | — |
| Antigravity | `.agents/skills/` | — | — |
| VS Code（Copilot） | `.github/superpowers/`（+ `instructions/jevzh.instructions.md`） | — | — |
| OpenClaw | `skills/` | `~/.openclaw/skills/` | — |
| Windsurf | `.windsurf/skills/` | `~/.codeium/windsurf/skills/` | — |
| Gemini CLI | `.gemini/skills/`（+ `GEMINI.md`） | 仅项目级 | — |
| Aider | `.aider/skills/`（+ `CONVENTIONS.md`） | — | — |
| OpenCode | `.opencode/skills/` | `~/.config/opencode/skills/` | —（另有插件形态，见下） |
| Qwen Code | `.qwen/skills/` | `~/.qwen/skills/` | — |
| Hermes Agent | `.hermes/skills/`（需登记 `external_dirs`） | `~/.hermes/skills/` | — |
| Claw Code | `.claw/skills/`（+ `CLAW.md`） | — | — |
| Qoder | `.qoder/skills/`（+ `.qoder/rules/jevzh.md`） | `~/.qoder/skills/` | — |
| CodeBuddy | `.codebuddy/skills/`（+ `CODEBUDDY.md`） | `~/.codebuddy/skills/` | — |
| CodeArts（码道 Doer） | `.codeartsdoer/skills/` | `~/.codeartsdoer/skills/` | — |
| Reasonix | `.reasonix/skills/` | `~/.reasonix/skills`（Windows 为 `%APPDATA%\reasonix\skills`） | — |
| DeepSeek Harness | `.dsh/skills/` | `~/.dsh/skills/` | — |
| ZCode | 不暴露项目级路径 | `~/.zcode/skills/` | — |
| Crush | `.crush/skills/` | `~/.config/crush/skills`（Windows 为 `%LOCALAPPDATA%\crush\skills`） | — |
| Cline | `.cline/skills/`（+ `.clinerules/jevzh.md` 索引） | — | — |
| Kilo Code | `.kilocode/skills/`（+ `.kilocode/rules/jevzh.md` 索引） | — | — |

另有两款宿主通过**原生插件清单**分发、不走目录安装：**Kimi Code**（`.kimi-plugin/plugin.json`，会话开始加载 `jev-using-superpowers`）与 **Pi**（`package.json` 的 `pi` 字段 + `.pi/extensions/superpowers.ts`，会话注入路由技能）；OpenCode 也提供 `.opencode/plugins/superpowers.js` 插件形态。

每个宿主的路径细节、bootstrap 文件名与故障排查见 [docs/README.&lt;宿主&gt;.md](docs/) 下 26 篇专属文档。

## 与已有超能力共存：五级处置

检测到旧发行版（superpowers-zh / 英文 jev / obra）痕迹时，安装器按 **BLOCK / MIGRATE / SKIP / ADD / WARN** 五级处置，一句话概括：**同名技能零覆盖、只补缺；检测到他方内容只 WARN 不动；需要接管先备份**。先跑 `npx jevzh --detect-only` 看矩阵，确认无误再正式安装；想接管旧技能用 `--adopt-skills`，想原样保留旧引导用 `--keep-router`。

## 门禁、就绪状态与两种失败

6 个门禁技能调用统一入口 `bash scripts/jev-gate <子命令>`（pick / scout / guard / commit / triage / check-hypothesis / quality / limpet），阈值与退出码的完整说明书见 [docs/jev-gate.md](docs/jev-gate.md)，置信度策略中文表见 [docs/CONFIDENCE.zh.md](docs/CONFIDENCE.zh.md)。

就绪检测 `bash scripts/jev-readiness` 输出四种状态：

- **FULL**：6 个门禁工具齐备，云端或本地 Laya 后端可达，全量门禁可用
- **LOCAL**：6 个工具齐备，本地 heuristic 回退桥可达，阈值判定不变
- **PARTIAL**：部分工具或后端缺失，各门独立降级，缺失的门转对应标准中文技能
- **DEGRADED**：工具全缺或 `backend:"off"`，全部门禁转标准中文技能（方法论仍可独立使用）

失败严格分两类，不可混淆：

1. **环境型失败**（工具没装、后端不可达、钩子超时）：宽松模式打印 `[门禁降级]` 后放行（exit 0，不代表门通过）；严格模式 exit 2 阻断。
2. **判定型失败**（门跑了但结论否决，如 confidence 不足、输出无 `[PASS]`、`verdict: block`）：**任何模式都 exit 2，绝不软放行**。

## 配置 `.jevzh.json`

项目根目录的 `.jevzh.json`（模板见 [.jevzh.json.example](.jevzh.json.example)）：

```json
{
  "backend": "auto",
  "strict": false,
  "baseUrl": "http://127.0.0.1:8000",
  "tools": {}
}
```

- `backend`：`auto`（默认，先探本地桥再探云）｜`cloud`｜`local`｜`off`；非法值回落 `auto`。
- `strict`：`true` 时环境型失败也阻断；默认 `false`（软降级）。
- `baseUrl`：本地 Laya 桥地址，默认 `http://127.0.0.1:8000`，必须是 http(s) URL。
- `tools`：各门工具的覆盖配置（一般无需填写）。

**优先级：环境变量 > `.jevzh.json` > 默认值。**

| 环境变量 | 作用 |
|---|---|
| `JEVZH_BACKEND` | 覆盖 `backend`（`auto|cloud|local|off`） |
| `JEVZH_STRICT` | 覆盖严格模式；真值词为 `1|true|yes|on`（大小写不敏感），其余按假 |
| `TYPESAFE_API_KEY` | 云端 TypeSafe 密钥；非空且不等于 `local` 才视为真实云密钥 |
| `TYPESAFE_BASE_URL` | 覆盖后端基址（本地桥或自建端点） |
| `JEVZH_HOOK_TIMEOUT` | 钩子内部门禁超时秒数（默认 30） |
| `JEVZH_PROJECT` | 指定项目目录（默认取 git 顶层 → 当前目录） |

就绪状态缓存在系统临时目录 `jevzh-<项目路径 sha256>.state`，包含 `state / missingTools[] / backend / strict / notified / ts` 字段。

## 离线与 FOSS：本地 Laya 引擎

不想用云端？本仓自带 [scripts/serve-laya.py](scripts/serve-laya.py)，**纯 Python 标准库、零 pip 依赖**即可启动 heuristic 回退桥，暴露与 TypeSafe 云端同构的 `/v1/systemone`；装上 Apache-2.0 开放权重的真 Laya 421M 模型后自动切换为真实推理。安装方式、能力边界与已知限制见 [docs/FOSS_LAYA.zh.md](docs/FOSS_LAYA.zh.md)。

```bash
python scripts/serve-laya.py --port 8000 --host 127.0.0.1
```

## 安全边界

- **家目录护栏**：默认拒绝在 `~` 做项目级安装，避免污染整个 home；确需如此必须显式 `--force`。
- **链接护栏**：卸载/接管不穿越符号链接，不删归属不明的文件；他方内容只 WARN。
- **备份与回滚**：任何接管动作先备份到 `.jevzh/backups/<时间戳>/`，自动轮转保留 3 份，`doctor` 可查、`restore` 可恢复。
- **精确切除**：对 `CLAUDE.md` 等引导文件只用成对哨兵 `<!-- jev-superpowers-zh:begin/end -->` 区间切除，代码围栏内的演示文本不误伤；旧 `superpowers-zh` 哨兵同样能精确识别。
- **提交钩子 fail-closed**：stdin 超过 1MB、JSON 不可判定时一律进门检查；门禁 30 秒超时按环境型处理，永不卡死提交。

## 卸载

```bash
npx jevzh --uninstall          # 清理当前项目的本包技能副本与哨兵区块
npx jevzh --global --uninstall # 清理全局安装
```

`.jevzh.json` 默认保留（含你的 backend/strict 选择）；旧 superpowers-zh 的哨兵段会被精确切除，你自己写的内容不动。

## 质量保障与双上游审计

```bash
npm test                 # node:test 全量（安装器/共存/技能契约/文档链接等）
npm run test:bash        # bash 离线套件统一入口（jev-gate 四件套、审计、
                         # brainstorm-server、pi/opencode/kimi 宿主套件）
npm run audit            # 双上游保真 + 契约/结构/安装矩阵全量审计
npm run audit:offline    # 同上但不读上游目录（--no-upstream，只跑仓内事实）
```

`scripts/audit.sh` 直接执行时还支持：`--quick`（跳过 26 宿主安装矩阵等重项）、`-h/--help`、未知参数返回退出码 2。退出码约定：**0** 全过（允许 WARN）；**1** 存在 FAIL；**2** 参数错误。

双上游目录与环境变量：

- `JEVZH_UPSTREAM_ZH`（默认 `upstream/zh`）—— jnMetaCode/superpowers-zh 基线或活检出；`JEVZH_UPSTREAM_ZH_MODE=baseline`（默认，差异 FAIL）或 `worktree`（活上游，差异仅 WARN）；`JEVZH_UPSTREAM_JEV`（默认 `upstream/jev`）—— jev 英文上游，缺失时只 WARN（23 个契约 token 的离线检查不受影响）。
- 21 个中文技能按品牌白名单（`npx superpowers-zh → npx jevzh`、`superpowers-zh → jev-superpowers-zh`）归一化后必须与 zh 上游逐字一致；fork 增量必须打「本节是 jev-superpowers-zh 的增量内容」标记。
- `upstream/` 已被 `.gitignore` 忽略，检出/导出目录不入库。

有意的 fork 分歧登记在 [scripts/audit-divergences.json](scripts/audit-divergences.json)（hooks 合并、installer 品牌化等 4 项，附 scope/upstream/reason/sourceText）。**只有在按规格主动改变这些衍件时**才同步更新该文件与 `.upstream-sync.json` 基线；任何未登记差异都会让审计 FAIL。

## 文档

- [docs/jev-gate.md](docs/jev-gate.md) —— 8 个门禁子命令的阈值、退出码与故障排查
- [docs/CONFIDENCE.zh.md](docs/CONFIDENCE.zh.md) —— 置信度策略单一事实源（中文）
- [docs/FOSS_LAYA.zh.md](docs/FOSS_LAYA.zh.md) —— 本地 Laya / heuristic 桥说明
- [docs/README.&lt;宿主&gt;.md](docs/) —— 26 篇宿主专属安装指南

## 上游归属与许可证

- [obra/superpowers](https://github.com/obra/superpowers) —— 共同方法论上游
- [jnMetaCode/superpowers-zh](https://github.com/jnMetaCode/superpowers-zh) —— 中文方法论与安装器底座
- [AkashPriyadarshii/jev-superpowers](https://github.com/AkashPriyadarshii/jev-superpowers) —— 门禁技能与本地决策层来源

[MIT](LICENSE)。版权声明并列 obra（superpowers）、jnMetaCode（superpowers-zh）、AkashPriyadarshii（jev-superpowers）与 jev-superpowers-zh contributors 四方。
