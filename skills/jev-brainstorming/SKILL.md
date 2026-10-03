---
name: jev-brainstorming
description: 在任何创造性架构、功能设计或技术选型之前使用——探索需求、给出 2-3 个方案，并通过 TypeSafe Jev（jev-axi pick）收敛到最优技术决策；工具或后端缺失时软降级回标准中文技能 brainstorming
---

派生自 jev-superpowers，汉化 + 软降级改造。

# Jev 头脑风暴：带类型化收敛的系统化设计

继承 `brainstorming` 的全部需求探索与协作对话规则，但在架构权衡上用 TypeSafe Jev System One 消除无根据的 LLM 猜测。

## 工作流

### 1. 划分 Scope

- **Spike（探针）**：快速可行性问题，在对话中用 2-3 句话回答。
- **Bounded（有界）**：修改一个既有、可读的流程，在对话中给出简短设计。
- **Architectural（架构级）**：新子系统、技术栈选择或大型重构，走完整流程并产出书面规格。

### 2. 发散探索

- 只问最关键的 1-2 个澄清问题。
- 识别核心张力（延迟 vs 简单、SQLite vs Postgres、同步 vs 异步）。
- 给出 2-3 个可行技术方案，诚实列出利弊。

### 3. Jev 收敛门（强制）

在推荐方案或请用户拍板之前，运行 `jev-axi pick` 对架构决策做确定性评估：

```bash
jev-axi pick "<权衡问题>" \
  --options "<选项1>,<选项2>,<选项3>" \
  --text "<上下文、约束、用户画像、延迟与内存目标>"
```

真实输出示例（以下为英文原样输出，逐字保留）：

```text
picked: sqlite
confidence: 0.94
probabilities:
  sqlite: 0.88
  duckdb: 0.08
  sled: 0.03
  rocksdb: 0.01
```

**判定规则：**

1. **如实报告 Jev 输出**：说明 picked 选项、完整概率分布与校准置信度分数。
2. **置信度阈值**（完整阈值表见 docs/CONFIDENCE.zh.md）：
   - confidence ≥ 0.80（`act` 带）：作为强推荐方案呈现。
   - confidence 处于 0.50–0.80（`confirm` / `escalate` 带）：说明权衡为何接近，明确请人类伙伴破平（tie-break，打破平局）。
   - confidence < 0.50（Stop 带）：不猜，回去补充需求后重跑。

   注意：confidence 衡量的是选项概率分布的集中度，而非放行许可——选项概率接近平局（如 0.56/0.44）时，即使有表面赢家也按低置信度处理：落在 0.50–0.80 一律请人类伙伴破平；只有 confidence < 0.50 才回去补充需求后重跑。
3. **Ponytail 检查**：若某选项是标准库或已安装依赖，把上下文向 Rung 3/5 倾斜。

**就绪检查**：若本会话状态为 DEGRADED，或 `jev-axi` 不在就绪清单中 → 不要执行该命令，向用户说明缺失项及安装方式（`npm install -g jev-axi`；云端需设置有效的 `TYPESAFE_API_KEY`，本地桥需 `TYPESAFE_BASE_URL` 可达），转标准中文技能「`brainstorming`」继续；若命令已执行但结论为否决（confidence < 0.50，或处于 0.50–0.80 而人类尚未破平）→ 无论是否严格模式（strict）都停止，按阈值表处理，不得假装通过。

### 4. 人工批准门

在对话中给出经 Jev 评分的推荐。在人类伙伴明确说「同意」或选定另一方案之前，不要碰代码、不要写实现计划。

## 经统一入口调用

**本节是 jev-superpowers-zh 的增量内容。** 本项目中 agent 通过 `bash scripts/jev-gate pick "<权衡问题>" --options "..." --text "..."` 调用，由统一入口完成就绪探测、参数透传与两类失败分流；原生 `jev-axi pick` 命令、`--options` / `--text` 参数与 0.80 / 0.50 阈值逐字不变。

## 失效模式

阈值表见 docs/CONFIDENCE.zh.md，两类失败严格区分：

- **环境型失败**（`jev-axi` 不在 PATH / key 缺失 / 后端不可达）：软降级模式（soft）显著告知 + 跳过该门 + 转标准中文技能「`brainstorming`」；严格模式按上游硬 STOP（exit 2 / 打印安装指引）。
- **判定型失败**（门跑了但否决：confidence < 0.50，或处于 0.50–0.80 且人类未破平）：任何模式都阻断或转人工，软降级绝不放行。

降级提示每会话醒目告知一次，绝不静默降级。
