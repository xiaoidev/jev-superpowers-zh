# jev-gate 门禁手册（阈值与退出码单一事实源）

`bash scripts/jev-gate [--project <dir>] <子命令> [透传参数...]` 是 6 个 jev 门禁技能调用原生命令的**统一入口**：加载就绪状态、执行原生命令、解析判定、按宽松/严格模式分流。本文所有数字均与 [scripts/jev-gate](../scripts/jev-gate) 源码一致；配套置信度策略见 [CONFIDENCE.zh.md](CONFIDENCE.zh.md)。

## 1. 两类失败（先理解，再看阈值）

| 类别 | 含义 | 宽松模式（默认 `strict:false`） | 严格模式（`strict:true`） |
|---|---|---|---|
| **环境型失败** | 工具没装、后端不可达、钩子超时 | 打印 `[门禁降级]` 后 **exit 0**（门被跳过，不等于通过），并提示转用对应标准中文技能 | **exit 2** 阻断 |
| **判定型失败** | 门成功执行，但结论否决（置信度低、FAIL、block 等） | **exit 2，一律不软放行** | **exit 2** |

例外：`pick` 的人工破平区间返回 **exit 3**（既非通过也非否决）；`limpet` 门不要求后端（[scripts/jev-gate L128-130](../scripts/jev-gate#L128-L130)）。

## 2. 通用退出码

| 退出码 | 含义 |
|---|---|
| 0 | 判定通过；或宽松模式下环境型降级 |
| 2 | 判定型否决；或严格模式下环境型失败；就绪状态不可解析时保守阻断 |
| 3 | `pick` 人工破平（0.50–0.80） |
| 64 | 参数错误（未知选项/子命令、缺 `--project` 参数） |

## 3. 八个子命令

### 3.1 pick —— 构思权衡（jev-axi pick）

- **用途**：在多个方案间按置信度选择，用于头脑风暴阶段。
- **输入**：jev-axi pick 的原生参数（如候选、文本、状态等）原样透传，jev-gate 不解释。
- **解析**：从输出中取**最后一个** `confidence: N`（兼容全角 `：`），要求 `0 ≤ c ≤ 1`；越界、不可解析、无输出同罪否决（[L207-227](../scripts/jev-gate#L207-L227)）。
- **阈值**：
  - `c ≥ 0.80` → exit 0（A 档自动通过）
  - `0.50 ≤ c < 0.80` → **exit 3**，打印中文人工破平提示，由人类拍板
  - `c < 0.50` → exit 2，要求补充需求/上下文后重新探测
- **缺工具**：`jev-axi` 缺失或后端 `none` → 环境型分流；安装：`npm install -g jev-axi`。

### 3.2 scout —— 依赖核实（jev-scout）

- **用途**：核实第三方依赖在目标生态中真实存在，防止凭想象选型。
- **判定**：原生命令非零退出 → exit 2。输出命中以下任一确定硬失败信号即否决（[L242-255](../scripts/jev-gate#L242-L255)）：
  - `0 verified crates`
  - `0 matching candidates`
  - `0 candidates`
  - `GATE FAILED`

  数字 0 带前导边界匹配，`10/20/100 verified` 不会被误判。
- **不在 gate 硬编码的阈值**：Fit ≥ 2.0 / ≥ 4.0 的分级采纳、Noul > 0.50 的风险提示，由规划阶段的 agent 按 `jev-writing-plans` 技能正文执行。
- **缺工具**：`cargo install jev-scout`。

### 3.3 guard —— 命令安全（jev-guard）

- **用途**：执行 shell 命令前判定风险。
- **判定**（[L197-205](../scripts/jev-gate#L197-L205)）：
  - 输出含 `verdict: block`（大小写不敏感）→ **永远否决**，该命令必须人工确认，任何模式都不自动执行；
  - `PASS` 必须是**独立 token**（带字母边界）：`BYPASSED`、`password`、`trespass` 等含 pass 子串的输出不会放行；真实输出如 `PASS (destructive: 0.01)` 正常通过；
  - 既无 PASS 也无 block、无法识别 → **保守否决**，请人工确认。
- **缺工具**：`npm install -g jev-guard`。

### 3.4 commit —— 提交门禁（git jev check）

- **用途**：pre-commit 钩子调用，提交前验证。
- **判定**（[L191-195](../scripts/jev-gate#L191-L195)）：
  - `git jev check` 非零退出，或输出中找不到**字面 `[PASS]`**（`grep -F` 精确匹配）→ exit 2；
  - 非零退出与缺 `[PASS]` 均属判定型失败，FAIL 永不软放行。
- **置信度联动**：上游策略要求 `[PASS]` 且 p < 0.10 才提交，见 [CONFIDENCE.zh.md](CONFIDENCE.zh.md)。
- **缺工具**：`git jev install`（git-jev）。

### 3.5 triage —— 失败分诊（jev-axi triage）

- **用途**：调试时对 diff / 日志分诊，定位失败方向。
- **判定**（[L310-313](../scripts/jev-gate#L310-L313)）：stdin 原样继承管道透传，**以原生命令退出码为准**：0 通过，非 0 exit 2。gate 不解析其输出内容。
- **缺工具**：`npm install -g jev-axi`。

### 3.6 check-hypothesis —— 假设验证（jev-axi check）

- **用途**：系统化调试中验证根因假设，防止盲修。
- **解析**：从输出提取所有 `probability: N` 或独立 token `p: N`（兼容全角冒号），取**最大值**。
- **阈值**（[L230-240](../scripts/jev-gate#L230-L240)）：
  - **最大 p > 0.70（严格大于）** → exit 0，可按最高概率假设动手；
  - p = 0.70 本身**不通过**（边界值仍需取证）；
  - 解析不到任何概率值 → exit 2，禁止盲修，继续取证。
- **缺工具**：`npm install -g jev-axi`。

### 3.7 quality —— 质量审计（supercov quality）

- **用途**：完成前的静态质量门。
- **判定**（[L257-302](../scripts/jev-gate#L257-L302)，按字段名逐行锚定）：
  - 原生命令非零退出 → exit 2；
  - `weak files`、`unhandled_errors`、`duplicated_logic` 的数字 **> 0** 即否决（0 容忍类）；
  - `deep_nesting` 数值**严格 > 0.90** 才否决，**0.90 本身通过**；
  - 同一行同时出现 `critical` 与任一反模式名（unhandled_errors / deep_nesting / duplicated_logic）→ 否决（覆盖 `unhandled_errors (critical)` 这类无数字输出）。
- **缺工具**：`npm install -g supercov`。

### 3.8 limpet —— 收束校验（limpet check）

- **用途**：Stop 钩子调用，会话结束前核实验收标准全部满足。
- **判定**（[L305-308](../scripts/jev-gate#L305-L308)）：`limpet check` 退出码 0 即通过，非 0 exit 2；**不依赖后端**，本地离线照常工作。
- **缺工具**：`cargo install limpet`（或直接用 `python3 ~/limpet/limpet.py`）。

## 4. 就绪检测：四态与配置

`bash scripts/jev-readiness [--project <dir>] [--json] [--cached] [--mark-notified]`，就绪脚本自身**退出码恒 0**（参数错误 64）。

**探测的 6 个工具**：jev-axi、jev-scout、jev-guard、git-jev（用 `git jev --version` 探测）、supercov、limpet。

**四态**（[scripts/jev-readiness L280-292](../scripts/jev-readiness#L280-L292)）：

| 状态 | 条件 |
|---|---|
| **FULL** | 6 工具无缺失，后端为 cloud 或 laya |
| **LOCAL** | 6 工具无缺失，后端为 heuristic（本地零依赖回退桥） |
| **PARTIAL** | 部分工具缺失；或工具齐但后端为 none |
| **DEGRADED** | `backend:"off"`，或 6 个工具全部缺失 |

**后端四值**：`cloud` / `laya` / `heuristic` / `none`。云端仅对 `https://api.typesafe.ai/` 做 2 秒存活探测（显式 `TYPESAFE_BASE_URL` 时探该地址）；本地桥探 `<baseUrl>/health` 并以 `laya_installed` 区分 laya / heuristic。真实云密钥 = 非空且不等于字符串 `local`。

**配置优先级**：环境变量 > 项目根 `.jevzh.json` > 默认值。

- `JEVZH_BACKEND` / `backend`：`auto|cloud|local|off`，非法值回落 `auto`；
- `JEVZH_STRICT` / `strict`：真值词 `1|true|yes|on`（大小写不敏感），其余按假；
- `TYPESAFE_BASE_URL` / `baseUrl`：默认 `http://127.0.0.1:8000`，须通过 http(s) scheme 白名单；
- `TYPESAFE_API_KEY`：上游原生命令的云端密钥。

状态缓存：系统临时目录下 `jevzh-<项目绝对路径 sha256>.state`，字段 `state / missingTools[] / backend / strict / notified / ts`；`--cached` 命中时零探测。

## 5. 三钩子接线矩阵

仅 Claude Code 与 Cursor 自动接线；其余 24 款宿主只装技能，门禁由 agent 按技能正文手动执行。

| 钩子 | Claude（hooks.json） | Cursor（hooks-cursor.json，v1 小写） | 动作 |
|---|---|---|---|
| 会话开始 | SessionStart，matcher `startup\|clear\|compact`，经 `run-hook.cmd session-start` | sessionStart | 就绪提示与降级告知（每会话醒目一次，不静默降级） |
| 命令前 | PreToolUse，matcher `Bash` → `hooks/pre-commit` | preToolUse（同） | 仅 `git commit` / `git push` 进门，其余 exit 0 快路径 |
| 停止 | Stop（matcher 空）→ `hooks/stop` | stop | 三段收束检查 |

**pre-commit**（[hooks/pre-commit](../hooks/pre-commit)）：

1. stdin 最多读 1MB（1048577 字节），超限或空 stdin fail-closed 进门；非提交命令 exit 0；
2. 经 `scripts/jev-gate commit` 执行，外层 **30 秒超时**（`JEVZH_HOOK_TIMEOUT` 可调）；超时码 124/137 按环境型处理：soft WARN exit 0，strict exit 2；
3. 环境型失败 soft exit 0 / strict exit 2；判定型失败任何模式 exit 2。

**stop**（[hooks/stop](../hooks/stop)）依次跑三段：

1. 工作区有未提交变更（`git status --porcelain` 非空）；
2. `./scripts/test.sh` 存在且执行失败；
3. `limpet` 收束门（30 秒超时）。

前两段：soft 逐条 WARN exit 0，strict 收集全部命中后统一 exit 2；第三段 **limpet 判定型否决即使 soft 也 exit 2**，limpet 环境缺失才按 strict/soft 分流。

## 6. 故障排查

| 现象 | 处理 |
|---|---|
| 门禁一直 `[门禁降级]` 跳过 | 跑 `bash scripts/jev-readiness` 看缺失工具与安装行；需要真实门就装工具，需要阻断就开 `strict` |
| 离线但想让门真跑 | 启动本地桥 `python scripts/serve-laya.py`（heuristic 零依赖即可用），见 [FOSS_LAYA.zh.md](FOSS_LAYA.zh.md) |
| 云端不生效 | 确认 `TYPESAFE_API_KEY` 非空且不为 `local`；网络可达 `https://api.typesafe.ai/`（探测 2 秒超时） |
| `pick` 返回 exit 3 | 这是人工破平区间，不是错误：由人类权衡后显式决定继续或补需求 |
| commit 门被挡但看不到原因 | 手动跑 `git jev check` 与 `bash scripts/jev-gate commit` 看完整输出；缺 `[PASS]` 一律先修 |
| 钩子在 Windows 不触发 | 确认装了 Git for Windows，钩子经 `hooks/run-hook.cmd` → Git Bash 执行；Node 需 ≥ 20 |
| 怀疑读到旧状态 | 删临时目录的 `jevzh-*.state`，或不带 `--cached` 重跑就绪检测 |
