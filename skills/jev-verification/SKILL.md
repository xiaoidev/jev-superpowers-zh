---
name: jev-verification
description: 在宣称工作完成、已修复或测试通过之前使用——强制要求新鲜测试证据、supercov quality 反模式审计与 limpet 停止策略检查；工具或后端缺失时软降级回标准中文技能 verification-before-completion
---

派生自 jev-superpowers，汉化 + 软降级改造。

# Jev 完成验证：基于证据的完成门禁

继承 `verification-before-completion` 的铁律（英文原文逐字保留）：

```text
NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE
```

中文铁律：**无新鲜证据，不宣称完成。** 绝不基于假设、未运行的代码或 LLM 的乐观情绪说「我做完了」「修复完成」。

## 验证门禁

### 步骤 1：执行新鲜测试命令

运行完整、未 mock 的测试命令：

- 验证退出码为 0。
- 验证 0 个失败测试、0 个编译器警告。

### 步骤 2：代码质量与反模式审计（supercov）

宣称功能就绪之前，用由 jev-1.13.0 驱动的 `supercov quality` 审计修改过的源文件：

```bash
supercov quality <src-dir>
```

**质量标准：**

- **0 个 weak files**：任何文件都不得带有 critical 反模式标记（`unhandled_errors`、`deep_nesting > 0.90`、`duplicated_logic`）。
- 命中反模式时，先根治代码异味，再谈完成。

**就绪检查**：若本会话状态为 DEGRADED，或 `supercov` 不在就绪清单中 → 不要执行该命令，向用户说明缺失项及安装方式（`npm install -g supercov`；后端需有效的 `TYPESAFE_API_KEY` 或可达的 `TYPESAFE_BASE_URL`），转标准中文技能「`verification-before-completion`」继续——但步骤 1 的新鲜测试证据不依赖该门，门禁跳过不等于证据豁免；若命令已执行但结论为否决（存在 weak files，命中 `unhandled_errors` / `deep_nesting > 0.90` / `duplicated_logic`）→ 无论是否严格模式（strict）都阻断，先修复反模式，不得假装通过。

### 步骤 3：停止策略核验（limpet）

核验初始用户需求中的每条要求都已测试并满足。若安装了 limpet（https://github.com/noplan-inc/limpet），它作为自动化代理 Stop 钩子运行，在满足既定停止标准之前阻止代理提前结束回合：

```bash
# 自动钩子：在 Claude Code / Codex / Antigravity 拦截 Stop 事件
# 依据 ~/.limpet/rules.md 由 TypeSafe Jev 判定规则满足情况
limpet check

# 手动回放 / 校准对话记录：
python3 ~/limpet/limpet.py suggest
```

仅当所有测试命令通过、`supercov quality` 以 0 个 critical 反模式通过、且所有需求均被证实时，才可宣布任务完成。对照 `~/.limpet/rules.md` 尚有验收标准未证实，即 limpet 判未满足，阻止结束。

**就绪检查**：若本会话状态为 DEGRADED，或 `limpet` 不在就绪清单中 → 不要声称钩子已拦截，向用户说明缺失项及安装方式（`cargo install limpet`，并编写 `~/.limpet/rules.md`），转标准中文技能「`verification-before-completion`」逐条手工核对验收标准；若 `limpet check` 或 `python3 ~/limpet/limpet.py suggest` 已执行但判未满足 → 无论是否严格模式都阻断，继续补齐证据，不得假装通过。

## 经统一入口调用

**本节是 jev-superpowers-zh 的增量内容。** 本项目中 agent 通过 `bash scripts/jev-gate quality <src-dir>` 与 `bash scripts/jev-gate limpet` 调用，由统一入口完成就绪探测与两类失败分流；原生 `supercov quality`、`limpet check`、`python3 ~/limpet/limpet.py suggest` 与 `deep_nesting > 0.90` 等阈值逐字不变。

## 失效模式

阈值表见 docs/CONFIDENCE.zh.md，两类失败严格区分：

- **环境型失败**（`supercov` / `limpet` 不在 PATH、key 缺失、后端不可达）：软降级模式（soft）显著告知 + 跳过该门 + 转标准中文技能「`verification-before-completion`」，但新鲜测试证据等不依赖该门的验证项一律不得豁免；严格模式按上游硬 STOP（exit 2 / 打印安装指引）。
- **判定型失败**（门跑了但否决：supercov 命中 critical 反模式、limpet 对照 `~/.limpet/rules.md` 判验收未满足、测试退出码非 0）：任何模式都阻断或转人工，软降级绝不放行。

降级提示每会话醒目告知一次，绝不静默降级。
