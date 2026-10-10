---
name: jev-using-superpowers
description: 在开始任何非平凡工程对话时使用——确立 jev 门禁版技能调用路由，在构思、计划、执行、调试、完成五个阶段强制接入 TypeSafe System One 判定、依赖核验与完成门禁，并说明四态就绪、软降级与严格模式规则
---

派生自 jev-superpowers，汉化 + 软降级改造。

# Jev 超级能力总路由：带 System One 门禁的系统化工程

以 70–120ms 级、确定性的 TypeSafe Jev System One 判定，替换工程流程中的 LLM 幻觉与任意猜测，增强本仓 21 个标准中文技能。

<EXTREMELY-IMPORTANT>
若任务涉及规划、架构、库选择、命令执行或调试：你必须调用对应的 jev 门禁技能。
</EXTREMELY-IMPORTANT>

## 五阶段路由矩阵

| 阶段 | 标准中文技能（裸 slug） | jev 门禁技能 | 核心门禁增强 |
|---|---|---|---|
| **构思 / 架构** | `brainstorming` | `jev-brainstorming` | `jev-axi pick` 权衡收敛，校准置信度 ≥ 0.80 才直接建议 |
| **实现计划** | `writing-plans` | `jev-writing-plans` | `jev-scout` 零幻觉 crate 与仓库核验 |
| **执行循环** | `executing-plans`（工作树隔离见 `using-git-worktrees`） | `jev-executing-plans` | `jev-guard` 命令安全 + `git jev check` 提交反射门 |
| **根因调试** | `systematic-debugging` | `jev-systematic-debugging` | `jev-axi triage` 错误分析 + `jev-axi check` 假设排序（p > 0.70） |
| **完成门禁** | `verification-before-completion` | `jev-verification` | `limpet` Stop 钩子 + `supercov quality` 反模式打分 |

## 全量 27 技能路由清单

**本节是 jev-superpowers-zh 的增量内容。** skills/ 下共 27 个技能：21 个中文底座技能 + 6 个 jev 门禁技能。

**15 个翻译标准技能：**

- `brainstorming`、`diagnosing-superpowers`、`dispatching-parallel-agents`、`executing-plans`、`finishing-a-development-branch`
- `receiving-code-review`、`requesting-code-review`、`subagent-driven-development`、`systematic-debugging`、`test-driven-development`
- `using-git-worktrees`、`using-superpowers`、`verification-before-completion`、`writing-plans`、`writing-skills`

**4 个中国原创技能：** `chinese-code-review`、`chinese-commit-conventions`、`chinese-documentation`、`chinese-git-workflow`（按各自 description 中的显式触发条件调用）。

**2 个上游历史保留技能：** `mcp-builder`、`workflow-runner`（仍可直接调用）。

**6 个 jev 门禁技能：** `jev-using-superpowers`（本技能）、`jev-brainstorming`、`jev-writing-plans`、`jev-executing-plans`、`jev-systematic-debugging`、`jev-verification`。

未列入五阶段矩阵的其余标准技能——如 `test-driven-development`、`dispatching-parallel-agents`、`subagent-driven-development`、`finishing-a-development-branch`、`receiving-code-review`、`requesting-code-review`、`writing-skills`、`diagnosing-superpowers`，以及 4 个 `chinese-*` 技能与 `mcp-builder`、`workflow-runner`——不依赖任何 jev 门禁，在任何就绪态下都按其正文直接调用。

## 后端与前置工具（就绪分支，非无条件硬 STOP）

**本节是 jev-superpowers-zh 的增量内容。** 全部 jev 门禁依赖以下本地工具与 System One 后端：

| 工具 | 用途 | 安装命令 |
|---|---|---|
| `jev-scout` | 零幻觉 crate 与仓库核验 | `cargo install jev-scout` |
| `jev-axi` | 70–120ms System One 判定（pick / triage / check） | `npm install -g jev-axi` |
| `git-jev` | 提交前反射门，以 `git jev check` 调用 | `git jev install` |
| `jev-guard` | 破坏性 shell 命令过滤 | 随 `jev-axi` 一并安装，亦可独立安装 |
| `supercov` | jev 驱动的质量与反模式审计 | `npm install -g supercov` |
| `limpet` | 代理 Stop 钩子完成策略门 | `cargo install limpet` |

后端二选一：

- **云端**：设置有效的 `TYPESAFE_API_KEY`（免费额度来自 `https://console.typesafe.ai`）。
- **本地桥（auto 模式默认优先）**：`TYPESAFE_BASE_URL=http://127.0.0.1:8000` 且 `TYPESAFE_API_KEY=local`；桥端点为 `POST /v1/systemone`，健康检查为 `GET /health`，另有 `GET /v1/models` 声明模型。本地桥由 `scripts/serve-laya.py` 提供；未安装 Laya 时以零依赖 heuristic 回退引擎运行，`GET /health` 返回 `laya_installed:false` 时仍可用。

**就绪检查**：若本会话状态为 DEGRADED，或本步所需工具不在就绪清单中 → 不要执行对应门禁命令，向用户说明缺失项及安装方式（用上表安装命令；云端需有效 `TYPESAFE_API_KEY`，本地需 `TYPESAFE_BASE_URL` 的 `/health` 可达），经 `using-superpowers` 的路由转对应标准中文技能继续。严禁在未告知用户的情况下，悄悄回退到未经验证的猜测。

## 四态就绪模型与软降级模式（soft）/ 严格模式（strict）

**本节是 jev-superpowers-zh 的增量内容。** 会话开始时由就绪探测给出四态之一：

- **FULL**：工具齐全，且云端或本地 Laya 421M 后端可达——全部门禁正常执行。
- **LOCAL**：工具齐全，本地 heuristic 桥可达（`http://127.0.0.1:8000/health`）——门禁全执行，判定来自 heuristic 引擎。
- **PARTIAL**：部分工具或后端缺失，state 中带逐工具清单——各门按清单独立降级，缺一个不连坐其他门。
- **DEGRADED**：工具全缺或 `backend:off`——所有门禁转对应标准中文技能。

模式由 `.jevzh.json` 的 `strict` 与环境变量 `JEVZH_STRICT` 控制（默认 `strict=false`，即软降级）：

- 软降级仅适用于**环境型失败**：显著告知 + 跳过该门 + 转对应标准中文技能；
- **判定型失败**（门成功执行但结论否决）在任何模式下都阻断或转人工，软降级绝不放行；
- 降级提示每会话醒目告知一次，绝不静默降级。

## 统一门禁入口 scripts/jev-gate

**本节是 jev-superpowers-zh 的增量内容。** 本项目约定：agent 不散落直连原生工具，而是通过统一入口调用：

```bash
bash scripts/jev-gate <子命令> [参数透传...]
```

| 子命令 | 透传的原生调用 | 使用阶段 |
|---|---|---|
| `pick` | `jev-axi pick` | `jev-brainstorming` |
| `scout` | `jev-scout` | `jev-writing-plans` |
| `guard` | `jev-guard` | `jev-executing-plans` |
| `commit` | `git jev check` | `jev-executing-plans` |
| `triage` | `jev-axi triage` | `jev-systematic-debugging` |
| `check-hypothesis` | `jev-axi check` | `jev-systematic-debugging` |
| `quality` | `supercov quality` | `jev-verification` |
| `limpet` | `limpet check` | `jev-verification` |

环境型失败时：软降级模式打印「门禁降级」警告（含缺失项、安装方式、转用的标准中文技能名）后以退出码 0 跳过；严格模式打印中文错误与安装命令并以退出码 2 阻断。判定型失败一律退出码 2，严格模式与软降级模式相同。

## 失效模式

阈值的权威表见 docs/CONFIDENCE.zh.md（后续任务迁入）。本项目把上游的失败明确区分为两类，不得混淆：

- **环境型失败**（工具不在 PATH / `TYPESAFE_API_KEY` 缺失 / `TYPESAFE_BASE_URL` 后端不可达）：软降级模式显著告知、跳过该门并转对应标准中文技能；严格模式按上游硬 STOP（exit 2 / 阻断并打印安装指引）。
- **判定型失败**（门跑了但否决：置信度落入 Stop 带、`verdict: block`、无 `[PASS]`、假设全部低于 0.70、scout 0 候选、supercov 命中 critical 反模式、limpet 判未满足）：任何模式都阻断或转人工，软降级绝不放行。

降级状态每会话醒目提示一次，绝不静默降级；永远不要把「门没跑成」伪装成「门检通过」。
