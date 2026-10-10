# jev-superpowers-zh 整合设计

- 日期：2026-10-03
- 状态：已批准（头脑风暴三节设计均获用户确认）
- 上游来源：
  - <https://github.com/AkashPriyadarshii/jev-superpowers>（英文，jev 门禁层，master，基线 SHA：`4e5f569653a4fdb321afe1ef7f4a3c23ef7130a9`）
  - <https://github.com/jnMetaCode/superpowers-zh>（中文社区版，main，基线 SHA：`c6eccb1d0588c69d94146733c5bf20f6311406be`）
  - 共同方法论上游：<https://github.com/obra/superpowers>

## 1. 背景与目标

两个项目同源于 obra/superpowers，但增强方向正交：

- **jev-superpowers** 在 11 个英文标准技能之外提供 6 个 `jev-*` 薄门禁技能（每个约 2KB），在构思/计划/执行/调试/完成五个阶段强制接入外部 System One 决策工具链（jev-axi / jev-scout / jev-guard / git-jev / supercov / limpet），后端为 TypeSafe 云（jev-1.13.0）或本地 Laya（ModernBERT-large 421M，Apache-2.0）。分发方式为 `install.sh` / `install.ps1`，无 `TYPESAFE_API_KEY` 即硬失败；钩子含 SessionStart / PreToolUse / Stop 三道。
- **superpowers-zh** 是 obra/superpowers 的完整中文社区版：21 个技能（15 翻译 + 4 中国原创 + 2 上游历史保留）、npm 包与 1799 行一键安装器适配 26 款 AI 编程工具、成熟的上游保真审计（audit.sh）与大测试套；钩子仅 SessionStart。

**目标**：整合为 **jev-superpowers-zh**——以 superpowers-zh 的中文方法论与 26 工具分发为底座，叠加 6 个汉化的 jev 门禁技能与可软降级的本地/云端决策层，发布为一个可安装的 npm 包。

### 1.1 已确认的关键决策

| # | 决策点 | 结论 |
|---|---|---|
| 1 | 整合拓扑 | zh 为底座 + jev 增量层（方案一：同仓分层 + 增量显式标注） |
| 2 | 门禁默认策略 | 默认开启但软降级：检测不到 key/工具时降级为纯方法论，每会话提示一次；另提供严格模式 |
| 3 | 命名分发 | npm 包名 `jev-superpowers-zh`，CLI 短名 `jevzh`；技能目录保留英文 slug（含 `jev-` 前缀），正文中文 |
| 4 | 首期范围 | 最小可发布版：27 技能 + 安装器 + 钩子 + 文档 + 测试；不含站点/CI/发版流水线 |
| 5 | 配置机制 | `.jevzh.json` + 环境变量双通道，`backend: auto` 本地 Laya 桥优先 |
| 6 | 与已装竞品的兼容 | 技能同名零覆盖仅补缺；router/hook 默认备份后自动接管；plugin 形态硬阻断不可绕过；备份可 restore（详见 §7.7） |

## 2. 总体架构

### 2.1 定位

**jev-superpowers-zh = superpowers-zh 完整中文方法论（21 技能 + 26 工具分发）为底座，叠加 6 个汉化 jev 门禁技能与可软降级的本地/云端 System One 决策层。**

### 2.2 三层结构

```
┌─────────────────────────────────────────────────────────────┐
│  分发层  jevzh 安装器（fork superpowers-zh 1799 行安装器）     │
│  npx jev-superpowers-zh · 26 工具 · 项目级/全局/卸载/幂等     │
├─────────────────────────────────────────────────────────────┤
│  内容层  skills/ 共 27 个，分两个带归属的区                     │
│  ├─ 21 个 zh 技能（15 翻译 + 4 中国原创 + 2 历史保留）原样承接 │
│  └─ 6 个 jev-* 技能：正文汉化、硬 STOP 改写为经 jev-gate 判定 │
├─────────────────────────────────────────────────────────────┤
│  门禁层  hooks + scripts/jev-gate（新增统一门禁入口）           │
│  SessionStart 路由注入 · PreToolUse 提交门禁 · Stop 完成门禁   │
│  就绪检测 → 严格则阻断 / 默认软降级（警告+放行），每会话一次    │
└─────────────────────────────────────────────────────────────┘
```

**关键边界**：

1. zh 技能不直接调用任何 jev 工具，保证底座可独立工作，且 audit 对 zh 区的上游保真规则不被破坏；
2. jev 技能通过唯一入口 `scripts/jev-gate` 访问外部工具链，门禁策略集中一处，6 个技能保持薄；
3. jev 门禁仅对支持钩子机制的工具自动接线（Claude Code / Cursor），其余工具靠技能正文的手动步骤指引。

## 3. 目标目录结构（首期范围）

```
jev-superpowers-zh/
├── bin/jevzh.js                 # 由 superpowers-zh.js 改造：品牌 + jev 参数 + 钩子安装
├── index.js                     # 原样（opencode 插件入口）
├── package.json                 # name=jev-superpowers-zh, bin: jevzh
├── skills/                      # 27 个技能（见 §6）
├── hooks/
│   ├── hooks.json               # 合并：SessionStart + PreToolUse + Stop
│   ├── hooks-cursor.json        # 同上的 cursor 变体
│   ├── session-start            # zh 版（含 Muse 分支）+ 门禁就绪路由
│   ├── run-hook.cmd             # 原样（Windows polyglot 适配）
│   ├── pre-commit               # jev 版改为经 jev-gate，支持软降级
│   └── stop                     # jev 版：通用检查 + 经 jev-gate 的 limpet 检查
├── scripts/
│   ├── jev-gate                 # 【新增·核心】统一门禁入口（bash）
│   ├── jev-readiness            # 【新增】后端/工具就绪检测，结果按会话缓存
│   ├── serve-laya.py            # 迁自 jev（本地 System One 桥）
│   ├── audit.sh                 # fork zh 审计：升级为双上游对齐
│   ├── bump-version.sh          # 迁自 zh
│   └── sync-plugin-version.js   # 迁自 zh
├── docs/
│   ├── README.<26 工具>.md      # 迁自 zh，品牌/命令替换
│   ├── jev-gate.md              # 【新增】门禁机制、配置、故障排查
│   ├── FOSS_LAYA.zh.md          # 译自 jev FOSS_LAYA.md（本地部署，国内核心场景）
│   └── CONFIDENCE.zh.md         # 译自 jev CONFIDENCE.md（置信度阈值策略）
├── tests/                       # zh 测试套品牌化 + 新增 tests/jev-gate/、tests/coexistence/
├── .gitignore                   # 含 .jevzh/、node_modules/
├── .jevzh.json.example          # 配置模板（实际配置由安装器生成，不入库）
├── .upstream-sync.json          # 扩展为双源（zh + jev）
├── .claude-plugin/ .cursor-plugin/ .codex-plugin/ .kimi-plugin/
├── .opencode/ .pi/ gemini-extension.json   # 清单品牌化（集合以 zh 为准）
├── assets/superpowers-small.svg # 仅保留中性 logo；赞助商/二维码不迁
├── CLAUDE.md AGENTS.md GEMINI.md
├── README.md  RELEASE-NOTES.zh.md  LICENSE
└── .github/                     # 仅保留 issue 模板；workflows 属二期，首期不迁
```

运行时（不入库）：`.jevzh/backups/<时间戳>/`（安装接管前的备份，见 §7.7）、系统临时目录 `jevzh-<项目hash>.state`（就绪缓存，见 §5.2）。

**首期明确不迁入**：

- jev 的 `install.sh` / `install.ps1`（被 jevzh 安装器取代）；
- jev 的 `site/` 与 `docs/PRD.md`、`DESIGN.md`、`HANDOFF.md`、`ARCHITECTURE.md`、`DESIGN-site.md`、`USAGE.md`（其项目自身开发/营销文档；USAGE 的调用契约已吸收进本设计与汉化技能）；
- jev 独有的 `.devin-plugin`（zh 的 26 工具口径不含 Devin，迁入破坏工具计数一致性）；
- jev 的 `memory/DECISIONS.md`、`STATE.md`、`CHANGELOG.md`、`SECURITY.md`、`vercel.json`；
- zh 的赞助商资产、微信群/公众号二维码、课程广告、`README.zh-Hant.md`、官网构建（site/）、CI workflows、发版脚本 `verify-release.sh`、`make-og-image.sh`、`assets/RECORDING-GUIDE.md`。

## 4. 门禁调用契约（忠实上游）

### 4.1 调用全表

命令、参数、阈值数值零改动地保留；技能正文为中文。

| 阶段 | 工具 | 原生命令 | 判定阈值 |
|---|---|---|---|
| 构思 | `jev-axi pick` | `jev-axi pick "<权衡问题>" --options "a,b,c" --text "<上下文>"` | confidence ≥0.80 act；0.50–0.80 人工破平；<0.50 补充需求 |
| 计划 | `jev-scout` | `jev-scout "<依赖需求>" --ecosystem crates\|github\|all`（支持 `--json`） | Fit ≥2.0/4.0；Noul 维护概率 >0.50；须粘贴真实安装命令；0 候选即门失败 |
| 执行 | `jev-guard` | `jev-guard "<待执行命令>"` | `PASS (destructive: 0.01)` 放行；`verdict: block` 永远人工确认，任何模式不自动执行 |
| 提交 | `git-jev` | `git jev check`（前置 `git add <files>`） | 输出含 `[PASS]`；secrets p<0.10、payload p<0.10；FAIL 永不提交 |
| 调试 | `jev-axi triage` | `<测试/构建输出> 2>&1 \| jev-axi triage`（stdin 管道） | 输出 domain / root_cause / fix_direction |
| 调试 | `jev-axi check` | `jev-axi check "<假设>?" --state "<trace & diff>"` | 取 p>0.70 最高假设；全部 <0.70 继续取证，禁止盲修 |
| 完成 | `supercov quality` | `supercov quality <src-dir>` | 0 个 weak files（`unhandled_errors` / `deep_nesting > 0.90` / `duplicated_logic`） |
| 完成 | `limpet` | Stop 钩子自动拦截；手动 `limpet check` / `python3 ~/limpet/limpet.py suggest` | 对照 `~/.limpet/rules.md`，验收标准未证实则阻止结束 |

### 4.2 后端协议

- 云端：`TYPESAFE_API_KEY`（jev-1.13.0，console.typesafe.ai 免费额度）。
- 本地：`TYPESAFE_BASE_URL=http://127.0.0.1:8000` + `TYPESAFE_API_KEY=local`；桥端点 `POST /v1/systemone`，健康检查 `GET /health`，模型声明 `GET /v1/models`。
- 决策原语三种：`choice`（选项概率分布 + confidence）、`score`（期望值打分）、`noul`（维护/风险概率）。
- `scripts/serve-laya.py` 自带**零依赖 heuristic 回退**：未 `pip install laya` 时自动以 `laya-heuristic-fallback` 引擎运行，`/health` 返回 `laya_installed:false`。这是 auto 模式本地优先、零云依赖可用的落点。

### 4.3 两类失败的区分（核心原则，不可混淆）

- **环境型失败**（工具不在 PATH / key 缺失 / 后端不可达）：
  - `strict: false`（默认）→ 显著告知 + 跳过该门 + 转对应标准中文技能；
  - `strict: true` → 按上游硬 STOP（exit 2 / 阻断并打印安装指引）。
- **判定型失败**（门成功执行但结论否决：置信度 <0.50、guard 判 block、git-jev FAIL、假设全 <0.70、scout 0 候选、supercov 命中 critical 反模式、limpet 判未满足）：
  - **任何模式下都阻断或转人工，软降级绝不放行。**

即「门没跑成」可降级，「门跑了说不行」永远有效。软降级必须每会话醒目提示一次，绝不假装门检通过（保留上游 "never degrade silently" 的精神）。

## 5. 门禁机制详细设计

### 5.1 配置：`.jevzh.json` + 环境变量

`.jevzh.json`（项目根，实际配置不入库，仅提供 `.jevzh.json.example`）：

```json
{
  "backend": "auto",
  "strict": false,
  "baseUrl": "http://127.0.0.1:8000",
  "tools": {}
}
```

- `backend`: `auto` | `cloud` | `local` | `off`。
- `strict`: 默认 `false`。
- 环境变量：`JEVZH_BACKEND`、`JEVZH_STRICT`（`1`/`true` 为真），以及上游原生 `TYPESAFE_API_KEY`、`TYPESAFE_BASE_URL`。
- 优先级：**环境变量 > .jevzh.json > 默认值**。

### 5.2 就绪探测（`scripts/jev-readiness`）

bash 实现，经 `hooks/run-hook.cmd` 在 Windows 上复用 Git for Windows bash（与 zh hooks 同构）。SessionStart 每会话执行一次，结果缓存到系统临时目录 `jevzh-<项目路径hash>.state`（含 `notified:false` 标记；不入库、不污染项目目录）。

探测顺序：

1. 逐工具 `command -v`：`jev-axi`、`jev-scout`、`jev-guard`、`git-jev`（以 `git jev --version` 探测）、`supercov`、`limpet`。各门独立，缺一个不连坐其他门。
2. 后端（`backend=auto`）：已设 `TYPESAFE_BASE_URL` → 探 `$BASE_URL/health`（2s 超时）；否则存在真实 key（非 `local`）→ 探云端；都没有 → 探 `127.0.0.1:8000/health`。
3. 输出四态：
   - **FULL**：工具齐 + 云或 Laya 421M 后端可达；
   - **LOCAL**：工具齐 + 本地 heuristic 桥可达；
   - **PARTIAL**：部分工具/后端缺失，state 中带逐工具清单，各门按清单独立降级；
   - **DEGRADED**：工具全缺或 `backend:off`，所有门禁转标准技能。

state 文件 JSON 字段：`state`、`missingTools[]`、`backend`（cloud/laya/heuristic/none）、`strict`、`notified`、`ts`。

### 5.3 统一门禁入口（`scripts/jev-gate`）

子命令形式包装各原生调用，集中实现两类失败策略：

```
jev-gate pick|scout|guard|commit|triage|check-hypothesis|quality|limpet [参数透传...]
```

行为约定：

1. 读配置（env > .jevzh.json > 默认）与 readiness state；
2. 本门所需工具缺失/后端不可达：strict → 打印中文错误与安装命令并以退出码 2 阻断；soft → 打印 `[门禁降级]` 警告（含缺失项与安装方式、转用的标准技能名）后以退出码 0 跳过；
3. 工具存在则透传执行原生命令，解析结论：判定否决一律退出码 2（strict/soft 相同），判定通过退出码 0；
4. 结论解析规则对齐上游：commit 门要求输出含 `[PASS]`；guard 以 `verdict: block` 为否决；其余以各工具 JSON/文本输出中的 confidence/概率字段与 §4.1 阈值比较。

### 5.4 三个钩子

- **session-start**：以 zh 版为基座（保留 Cursor / Claude / Copilot / Muse 平台输出分支），注入汉化版 `jev-using-superpowers/SKILL.md` 全文（而非标准 using-superpowers），并追加**动态就绪段**：当前状态、缺失工具及安装命令、降级去向、开启严格模式的方法。每会话仅完整提示一次（读 state 的 `notified`，提示后置真）。
- **pre-commit**：保留上游「输入 JSON 中命令非 `git commit`/`git push` 一律 exit 0」；命中提交命令时调用 `git jev check`，无 `[PASS]` 即阻断（退出码 2）。环境型失败：strict 下 exit 2；soft 下输出中文 WARN 后 exit 0。
- **stop**：上游三段检查——工作区有未提交变更、`./scripts/test.sh` 存在且失败、`limpet check` 否决。strict 下任一命中 exit 2；soft 下统一降级为 WARN + exit 0（未提交变更与 test.sh 失败属环境/执行状态，按软降级策略不阻断收束；limpet 否决仅在 limpet 可用时成立）。
- 钩子仅随支持钩子机制的目标安装：Claude Code → `hooks/hooks.json`，Cursor → `hooks/hooks-cursor.json`；其余 24 款工具只装技能。安装器按 TARGETS 能力过滤，README 与 docs/jev-gate.md 提供「各工具钩子支持矩阵」明示。

### 5.5 本地桥

`scripts/serve-laya.py` 原样迁入（含 heuristic 回退、三种原语、/health、/v1/models）。`docs/FOSS_LAYA.zh.md` 在译文基础上补充国内场景：pip 镜像安装、无 GPU/Apple Silicon 时 heuristic 模式的能力边界说明、与 `JEVZH_BACKEND=local` 的配合。

## 6. 内容层：27 个技能

### 6.1 21 个 zh 技能

原样承接，仅做**自指品牌替换**（`superpowers-zh` → `jev-superpowers-zh`，含增量标记文本、using-superpowers 的「中国特色技能路由」段）。不改正文方法论，不插入任何 jev 调用。

- 15 个翻译技能：brainstorming、diagnosing-superpowers、dispatching-parallel-agents、executing-plans、finishing-a-development-branch、receiving-code-review、requesting-code-review、subagent-driven-development、systematic-debugging、test-driven-development、using-git-worktrees、using-superpowers、verification-before-completion、writing-plans、writing-skills；
- 4 个中国原创：chinese-code-review、chinese-commit-conventions、chinese-documentation、chinese-git-workflow；
- 2 个上游历史保留：mcp-builder、workflow-runner。

### 6.2 6 个 jev 技能（汉化 + 软降级改写）

| 技能目录（保留英文 slug） | 继承的中文底座 | 保留的调用契约 |
|---|---|---|
| `jev-using-superpowers` | `using-superpowers` | 路由矩阵扩成 27 技能；前置工具清单改为就绪分支 |
| `jev-brainstorming` | `brainstorming` | `jev-axi pick` + 0.80/0.50 阈值 |
| `jev-writing-plans` | `writing-plans` | `jev-scout --ecosystem` + Fit 2.0 / Noul 0.50 |
| `jev-executing-plans` | `executing-plans` | `jev-guard` + `git jev check`（p<0.10） |
| `jev-systematic-debugging` | `systematic-debugging` | `jev-axi triage`（stdin 管道）+ `check`（p>0.70） |
| `jev-verification` | `verification-before-completion` | `supercov quality` + `limpet` |

统一汉化规则：

1. frontmatter `name` 保留英文 jev- 前缀（与 26 工具的技能发现机制兼容），`description` 中文化；
2. 首行加派生声明：「派生自 jev-superpowers，汉化 + 软降级改造」；
3. 保留全部原生命令、输出示例、阈值数字；正文中对标准技能的继承引用改为 zh 实际裸 slug（去掉上游 ``superpowers:xxx`` 前缀，与 zh 既有规则一致）；
4. 每处调用步骤增加统一分支句式：
   > **就绪检查**：若本会话状态为 DEGRADED，或 `<本步工具>` 不在就绪清单中 → 不要执行该命令，告知用户缺失项及安装方式，转「标准技能 X」继续；若命令已执行但结论为否决（低置信 / block / FAIL）→ 不论严格与否，停止并按阈值表处理。
5. 所有相对上游新增的章节统一打标记 **「本节是 jev-superpowers-zh 的增量内容」**；
6. 文末 Failure Modes 统一改写为 §4.3 两类失败表述，并引用 `docs/CONFIDENCE.zh.md`。

## 7. 安装器 `bin/jevzh.js`

fork superpowers-zh 的 `bin/superpowers-zh.js`（1799 行，TARGETS 26 工具矩阵、项目级/全局、哨兵式 bootstrap、卸载逻辑均保留），改造点：

1. **品牌**：包名、CLI 名（`jevzh`）、哨兵注释改为 `<!-- jev-superpowers-zh:begin (do not edit between these markers) -->` / `<!-- jev-superpowers-zh:end -->`；卸载时兼容清理旧 `superpowers-zh` 哨兵段（支持从 zh 迁移，保留用户自有内容原则不变）；
2. **新参数**：
   - `--no-jev`：仅安装 21 个标准技能，不复制门禁钩子、不生成 `.jevzh.json`；
   - `--strict`：生成 `strict: true` 的 `.jevzh.json`；
   - 默认：安装全部 27 技能 + 钩子（按目标能力）+ 生成默认 `.jevzh.json`（已存在则不覆盖）；
   - 共存迁移相关开关 `--adopt-skills` / `--keep-router` / `--detect-only` 与 `doctor` / `restore` 子命令见 §7.7；
3. **安装末就绪报告**：跑一次 Node 版就绪探测（与 jev-readiness 同口径，/health 2s 超时），打印中文门禁状态报告（FULL/LOCAL/PARTIAL/DEGRADED、缺失工具及安装命令）；
4. **钩子与引导**：按 TARGETS 能力决定是否复制 hooks；各工具 bootstrap 指向 `jev-using-superpowers` 路由；
5. **计数口径**：工具数仍断言 26（jev 层是同一包内能力，不新增「工具」口径）；
6. `package.json`：`name: jev-superpowers-zh`、`bin: { "jevzh": "bin/jevzh.js" }`，`files` 清单加入 jev 钩子/scripts/docs，发布前需 `npm view jev-superpowers-zh` 确认包名未被占用。

### 7.7 与已装竞品的共存、迁移与稳定性

安装时机器上可能已存在 **obra/superpowers 原版**、**superpowers-zh**、**jev-superpowers**。zh 安装器现状是 `copyDirSync` 静默合并覆盖、无检测、无备份、无回滚——不能直接沿用。

**设计原则（用户已确认的策略）**：

1. **技能文件共存、仅补缺**：同名技能目录默认**跳过不覆盖**，只安装目标缺失的技能；
2. **会话入口唯一**：router（bootstrap 路由段 / SessionStart 注入 / pre-commit、stop 硬钩子）一个会话只能有一个生效，检测到竞品占用时**默认备份后自动接管**；
3. **plugin 形态硬阻断**：插件目录不在文件级安装器管辖内，任何开关不可绕过；
4. **全程可回滚、非交互友好、不动用户无关内容**。

#### 7.7.1 预检（preflight）

安装主流程写盘前先预检当前安装范围（`--tool` 指定目标或自动检测到的全部目标；项目级查项目目录、全局查 home）：

| 检测对象 | 识别方式 |
|---|---|
| 竞品技能目录 | 目标 skills 目录中命中 27 名单的目录，按**来源识别**分类（见 7.7.2） |
| bootstrap 路由段 | zh 新旧哨兵（`<!-- superpowers-zh:begin/end -->`、`# Superpowers-ZH` 固定标记 + FALLBACK 尾句）、obra 无哨兵段（特征短语）、jev 无 bootstrap（install.sh 只 cp 技能，但若存在引用 jev-using-superpowers 的段同样识别） |
| hooks 占用 | `.claude/settings.json` / `settings.local.json`、Cursor 配置中已有的 SessionStart/PreToolUse/Stop 条目，特别是 jev 上游 `pre-commit`/`stop` 路径引用 |
| plugin 形态 | 各工具插件配置中已启用的 superpowers / superpowers-zh / jev-superpowers（Claude Code marketplace、Cursor plugin 等） |
| npm 全局包 | best-effort 探测 `superpowers-zh`（及未来 `jev-superpowers-zh` 自身旧版） |
| 既有配置 | 项目根 `.jevzh.json`、`TYPESAFE_*` 环境变量（共享资产，不动） |

预检报告分级：**BLOCK**（必须中止）/ **MIGRATE**（将自动接管项）/ **SKIP**（同名跳过项，注明来源与行为差异）/ **ADD**（补缺项）/ **WARN**（npm 包共存、项目级与全局副本交叉的生效优先级说明）。退出码：0 成功，2 存在 BLOCK，1 其他错误。

#### 7.7.2 同名技能的来源识别与处置

逐个同名目录读 frontmatter/正文特征判定：

- **本包旧版**：含 jev-superpowers-zh 品牌串，或目录内有本包写入的 `.jevzh-meta.json`（安装时随技能写入，字段：pkg、version、date、scope、target，合法 JSON 以便通过 audit 的 JSON 校验）→ 视为**自升级**，默认覆盖（不属竞品冲突）；
- **superpowers-zh**：含「本节是 superpowers-zh 的增量内容」或 zh 品牌串 → 跳过（与 jevzh 底座同源同版本，行为基本等价，差异仅品牌与路由）；
- **jev-superpowers**：`jev-*` 正文含英文 `TypeSafe Jev` / `Failure Modes` / 引用 `docs/CONFIDENCE.md` → 跳过并**显著标红**：该同名技能是英文**硬 STOP** 旧版，软降级语义不会生效，可用 `--adopt-skills` 接管；
- **obra 原版**：英文正文 + `superpowers:` 前缀引用特征 → 跳过并标红：英文旧版不会路由到中文/jev 技能；
- **无法识别**（用户自建同名目录）：按用户内容处理——跳过 + WARN，**绝不覆盖**。

补缺安装的技能照常写入 `.jevzh-meta.json`。

#### 7.7.3 处置矩阵

| 冲突对象 | 默认处置 | 可覆盖默认的开关 |
|---|---|---|
| plugin 形态任一竞品启用 | **BLOCK 中止**，打印对应卸载命令（如 `claude plugin uninstall superpowers-zh@superpowers-zh`） | 无（`--force` 也不绕过） |
| 竞品同名技能目录 | SKIP（不覆盖），来源入报告 | `--adopt-skills`：备份后覆盖同名技能（完整替代） |
| 目标缺失的名单内技能 | ADD（补缺，含 4 个 chinese-*、6 个汉化 jev-* 等） | — |
| 本包旧版技能（带 meta 标记） | 覆盖（自升级） | — |
| bootstrap 路由段 | MIGRATE：备份整文件 → 切除旧段（zh 哨兵精确切除；无哨兵段按特征边界切除，保留用户其他内容）→ 写入 jevzh 哨兵段 | `--keep-router`：不动旧段（接受新技能可能不可达，由 doctor 持续提示） |
| hooks 配置 | MIGRATE：**读改写合并**而非覆盖——保留用户既有 hook 条目，追加 jevzh 条目；已有的 jev 上游 pre-commit/stop 引用改为指向 jevzh 钩子（不重复追加）；改前整文件备份 | `--keep-router` |
| npm 全局 `superpowers-zh` | WARN：CLI 名不同（`superpowers-zh` vs `jevzh`）可共存，建议卸载避免误用 | — |
| 旧 `.jevzh.json` | 不覆盖；schema 缺字段时补默认值并报告 | — |
| 外部 jev 二进制工具链、`TYPESAFE_*` env | 共享资产，不动 | — |

#### 7.7.4 备份、事务与回滚

- 备份根：项目级安装 → `<项目>/.jevzh/backups/<时间戳>/`；全局安装 → `~/.jevzh/backups/<时间戳>/`；按目标工具分目录。`.jevzh/` 写入 `.gitignore`；
- 备份内容：被接管的 bootstrap 文件整份、被修改的 hooks/settings 文件整份、切除段的原文与位置、`--adopt-skills` 时被覆盖的技能目录；纯补缺/跳过不产生备份；
- **按目标工具一个事务**：暂存 → 备份 → 写技能/改段/合并 hooks → 校验（技能数非空、settings JSON 仍可 parse、哨兵成对存在）→ 任一步失败则从备份恢复该目标（已完成的其他目标不回滚，报告已完成项）；
- 备份轮转保留最近 3 份，更旧的自动清除；
- `jevzh restore <时间戳>`：从指定备份恢复对应文件/目录（手工触发；卸载不自动恢复）。

#### 7.7.5 CLI 开关与 `doctor`

- 默认（无开关）：补缺技能 + router/hook 备份后自动接管；
- `--no-jev` / `--strict`：见 7.7 之前的安装器设计；
- `--adopt-skills`：同名竞品技能也备份后覆盖（完整替代语义）；
- `--keep-router`：纯补缺，不接管 router/hook；
- `--detect-only`：只跑预检出报告，不写盘（供 CI/先评估）；
- `--force`：语义沿用 zh（主目录/系统目录护栏），**对 plugin BLOCK 无效**；
- `jevzh doctor`（新子命令）：展示当前安装范围内——检测到的竞品痕迹与来源、**当前实际生效的 router 属于哪一套**、同名 SKIP 残留清单及预期行为差异、hooks 接线状态、门禁就绪四态（复用 jev-readiness）、备份清单与 restore 命令。

#### 7.7.6 与 26 工具的关系

预检/接管只处理当前安装范围涉及的目标；router/hook 接管仅对具备 bootstrap/hook 机制的工具执行（Claude Code、Cursor 及安装器 TARGETS 中已有 bootstrap 生成器的工具），其余 24 款工具只做技能补缺，并在报告与 `doctor` 中提示其门禁靠技能正文手动步骤、不存在 router 冲突。

## 8. 质量设施

### 8.1 audit.sh 双上游改造

在 zh 现有 5 类检查（静态校验 / 安装器功能 / 上游对齐 / 交叉引用 / 工具计数）基础上：

1. **双 remote**：`upstream-zh`（jnMetaCode/superpowers-zh）、`upstream-jev`（AkashPriyadarshii/jev-superpowers）；`--no-upstream` 时两者均跳过；
2. **zh 区保真不变**：21 技能标题数（±3）、标识符漂移、禁 `superpowers:` 前缀、欠同步 warn 全部对 upstream-zh 生效；品牌替换串与新标记文本加入白名单（`identifierAllow`、FORK_MARK 参数化）避免误报；
3. **新增 jev 契约保真检查**（对 upstream-jev，借鉴标识符漂移机制）：6 个汉化技能必须逐字保留——
   - 命令与子命令：`jev-axi pick`、`jev-axi triage`、`jev-axi check`、`jev-scout`、`jev-guard`、`git jev check`、`supercov quality`、`limpet`；
   - 参数：`--options`、`--text`、`--state`、`--ecosystem`、`--json`；
   - 阈值数字：`0.80`、`0.50`、`0.70`、`2.0`、`0.10`、`0.90`；
   - 环境变量与端点：`TYPESAFE_API_KEY`、`TYPESAFE_BASE_URL`、`/v1/systemone`、`/health`；
   - 缺任一即 FAIL；
4. **`.upstream-sync.json` 双源化**：

```json
{
  "sources": [
    { "name": "zh",  "repo": "https://github.com/jnMetaCode/superpowers-zh",
      "commit": "c6eccb1d0588c69d94146733c5bf20f6311406be", "version": "v1.7.14", "date": "2026-10-03",
      "trackedPaths": ["skills 下 21 个 zh 技能目录", "tests", "docs/README.*.md"] },
    { "name": "jev", "repo": "https://github.com/AkashPriyadarshii/jev-superpowers",
      "commit": "4e5f569653a4fdb321afe1ef7f4a3c23ef7130a9", "version": "master", "date": "2026-10-03",
      "trackedPaths": ["skills/jev-*", "scripts/serve-laya.py", "docs/CONFIDENCE.md"] }
  ],
  "declaredDivergences": [
    "hooks/hooks.json 与 hooks/hooks-cursor.json 为 jevzh 合并衍件（zh 仅 SessionStart，jev 三道），不属任一源的镜像",
    "hooks/session-start 以 zh 版为基座，有意改注入 jev-using-superpowers + 就绪段",
    "hooks/pre-commit、hooks/stop 迁自 jev，有意加软降级分支",
    "bin/jevzh.js fork 自 zh bin/superpowers-zh.js，有意改品牌/参数/钩子安装"
  ]
}
```

`declaredDivergences` 中的文件只跑欠同步 **warn**（人工评估是否跟上游新版本），不跑逐字一致 FAIL。

5. **计数与删除项**：技能总数由 21 增至 27 的文案断言同步更新；删除针对 `site/build.mjs` 的全部计数检查与 npm 发布一致性检查（首期不迁站点、不发包）；Category 2 安装器矩阵新增 `--no-jev`、`--strict` 装/卸载用例，工具数仍断言 26；
6. **新增共存能力静态检查**：安装器中必须存在 preflight、doctor、restore、`--adopt-skills`、`--keep-router`、`--detect-only` 标识（缺失即 FAIL，防止开关被删而文档仍宣称）；仓库 `.gitignore` 必须含 `.jevzh/`；仓库内任何技能目录不得误入 `.jevzh-meta.json`（那是安装期生成物，仅出现在用户目标目录）。

### 8.2 测试策略（全部离线可跑）

- 迁入 zh `tests/` 全套（brainstorm-server、claude-code、explicit-skill-requests、opencode、pi、kimi、skill-triggering、subagent-driven-dev 等），路径与品牌名替换；
- 新增 `tests/jev-gate/`（bash，Git Bash 下运行）：
  1. **就绪四态**：临时 PATH 注入 stub 工具 + 本地起 heuristic 桥，断言 FULL / LOCAL / PARTIAL / DEGRADED 与缺失清单；
  2. **pre-commit 矩阵**：非 git 命令 exit 0；stub `git jev check` 输出 `[PASS]` 放行、无 `[PASS]` 阻断；soft 工具缺失→WARN+exit 0；strict→exit 2；
  3. **stop 矩阵**：未提交变更 / `scripts/test.sh` 失败 / limpet stub 否决，strict 下 exit 2、soft 下 WARN+exit 0；
  4. **配置优先级**：env > `.jevzh.json` > 默认，逐组合断言；
  5. **每会话一次提示**：state 文件 `notified` 翻转行为；
  6. **契约保真单测**：与 8.1-3 同源的 grep 断言，提供不依赖 upstream remote 的快速反馈；
  7. **桥冒烟**：起 heuristic 模式，`GET /health` 返回 200 且可识别 `laya_installed:false`；
- 新增 `tests/coexistence/`（Node，直接驱动安装器函数/CLI，临时 HOME + 临时项目目录夹具）：
  1. **四套前置场景**：分别预置 obra 风格英文技能集、superpowers-zh 21 技能+新旧哨兵、jev-superpowers 17 技能于 `~/.agents/skills`、伪造的 plugin 启用记录；
  2. **仅补缺断言**：同名竞品技能内容 hash/mtime 不变；缺失技能（chinese-* 等）被补入且带 `.jevzh-meta.json`；补缺技能可被第二次安装幂等处理；
  3. **router 自动接管**：旧 bootstrap 段被备份且替换为 jevzh 哨兵段，用户自有段落保留；settings hooks 数组合并后用户既有条目仍在、jev 硬钩子引用被改写而非重复；
  4. **plugin BLOCK**：启用记录存在时退出码 2，`--force` 仍 2，目标目录零写入；
  5. **开关矩阵**：`--adopt-skills` 覆盖同名技能且备份可查；`--keep-router` 下旧段不动；`--detect-only` 零写盘；
  6. **来源识别**：本包旧版（带 meta）被升级覆盖；来源不明的同名用户目录被跳过且报告 WARN；
  7. **事务回滚**：人为令 hooks 合并后校验失败（注入坏 JSON 场景），断言该目标恢复到备份、报告列出已完成的其他目标；
  8. **restore**：`jevzh restore <ts>` 还原 bootstrap/settings/技能至安装前；备份轮转只保留 3 份；
  9. **doctor 输出**：router 归属、SKIP 残留、hooks 状态与就绪四态齐备；
- 不做：真实 TypeSafe 云调用、421M 模型下载集成测试、Windows 原生 CI（二期）；本地以 run-hook.cmd + Git Bash 覆盖 Windows 路径。

## 9. 文档

- **README.md（中文主，重写）**：定位；与 obra / jnMetaCode / Akash 三方关系与差异；27 技能表；双后端与软降级说明；快速开始（首期 `npm install -g .` 或 `npm link` 后 `jevzh`；npm 公开发布占位）；配置与严格模式；26 工具支持表含「钩子能力」列；**与已装 superpowers / superpowers-zh / jev-superpowers 的共存与迁移**（仅补缺、router 备份接管、plugin 先卸载、`--adopt-skills` / `--keep-router` / `--detect-only` / `doctor` / `restore` 用法、备份位置）；卸载（含旧 superpowers-zh 哨兵清理）；质量审计；贡献；归属；
- **docs/jev-gate.md（新增）**：门禁机制、两类失败、配置项、四态含义、各工具钩子支持矩阵、故障排查；
- **docs/CONFIDENCE.zh.md（译）**：阈值表带原文数字对照，数字不改；
- **docs/FOSS_LAYA.zh.md（译 + 增补）**：本地部署、pip 国内镜像、heuristic 模式能力边界；
- **docs/README.\<26 工具\>.md（迁入替换）**：命令/路径/品牌替换（`npx jev-superpowers-zh`、`.jevzh.json`），Trae 等具备钩子能力的工具补门禁说明；
- **RELEASE-NOTES.zh.md**：从 v0.1.0 起记首期整合内容；
- **LICENSE**：改回 MIT（见 §10）。

## 10. 归属与许可（合规）

- 当前工作区 LICENSE 为 Apache-2.0，但两个上游均为 MIT，整合作品无权自行更换许可。首期必须改回 **MIT**，版权声明并列三个来源（obra/superpowers、jnMetaCode/superpowers-zh、AkashPriyadarshii/jev-superpowers）及本项目；
- README 设「上游归属与差异」段并链接三个仓库；
- 6 个 jev-* 技能首行的派生声明、21 个 zh 技能的既有来源状态共同保证文件级可追溯；
- `serve-laya.py` 保持 Apache-2.0 其上游声明不变（文件头已注明 License: Apache 2.0，与项目 MIT 兼容）。

## 11. 完成定义（DoD）

1. `bash scripts/audit.sh --quick --no-upstream` 全绿（FAIL=0）；
2. `tests/jev-gate/` 全部通过（Git Bash）；迁入的 zh 测试套通过；
3. `jevzh` 安装器对 claude / cursor / trae 三类目标在临时目录完成 安装 → 幂等重装 → 卸载；`--no-jev` 只落 21 技能；`--strict` 生成 strict 配置；
4. `tests/coexistence/` 九类用例全部通过：obra / superpowers-zh / jev-superpowers 三套前置场景下同名技能零覆盖仅补缺、router/hook 备份后接管且可 restore、plugin 形态阻断（exit 2、`--force` 不绕过、零写入）、`--adopt-skills` 完整替代、事务失败回滚；
5. README 与 docs 无死链；LICENSE 为 MIT 且三方归属齐备；
6. 6 个 jev 技能契约保真检查通过。

## 12. 非目标（首期技术债登记）

- npm 公开发布与品牌占用核验（发布前 `npm view jev-superpowers-zh`）；
- 官网（site/）、CI workflows、多平台钩子自动化测试、繁中版；
- `jev-seo`（不在 6 技能调用链）、`.devin-plugin`；
- 外部 cargo/npm 二进制本身的分发（仅文档指引安装）；
- 双上游自动同步脚本（首期靠 audit warn + 手工按 `.upstream-sync.json` 基线同步）。

## 13. 风险与对策

| 风险 | 对策 |
|---|---|
| 外部 cargo/npm 工具国内安装门槛高 | 本地 heuristic 桥 + 软降级兜底；README/docs 给安装指引与镜像建议 |
| 钩子仅 Claude Code / Cursor 两类自动接线 | README 与 jev-gate.md 钩子支持矩阵明示；其余工具技能正文提供手动门禁步骤 |
| npm 包名 `jev-superpowers-zh` 可能被占用 | 发布前 `npm view` 核验，占用则以 scope 包（如 `@jev/jev-superpowers-zh`）兜底，CLI 名 jevzh 不变 |
| 汉化误改门禁命令/阈值 | audit jev 契约保真检查 + tests/jev-gate 契约单测双保险 |
| 双上游演进导致漂移 | `.upstream-sync.json` 双基线 + audit 欠同步 warn；二期做同步脚本 |
| 软降级被误认为「门已通过」 | 每会话醒目提示一次 + 判定型失败永不软放行 + state 中记录降级原因 |
| 与已装三套竞品混装导致双 router/双注入、旧硬 STOP 版残留 | 安装前 preflight 分级；plugin 形态硬阻断；router/hook 备份后接管（事务+restore）；同名技能仅补缺并由 doctor 明示差异；`--adopt-skills` 提供完整替代 |
| router 自动接管改变用户现有会话行为 | 接管前整文件备份、轮转 3 份、`jevzh restore` 一键回滚；安装报告逐项列出 MIGRATE 内容；`--keep-router` 提供不改入口的纯补缺 |
