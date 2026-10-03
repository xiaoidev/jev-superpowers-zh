---
name: jev-systematic-debugging
description: 遇到任何 bug、测试失败或构建错误时使用——强制先做根因调查，以 jev-axi triage 经 stdin 管道分诊构建错误、以 jev-axi check 对假设排序；工具或后端缺失时软降级回标准 systematic-debugging
---

派生自 jev-superpowers，汉化 + 软降级改造。

# Jev 系统化调试：带 Jev 分诊的根因调查

继承 `systematic-debugging` 的铁律（英文原文逐字保留）：

```text
NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST
```

中文铁律：**无根因调查，不修复。** 对症补丁就是失败；每个修复都必须针对已验证的根因。

## 调试阶段

### 阶段 1：自动失败分诊（jev-axi triage）

测试或构建失败时不要猜错误。把原始编译器 / 测试输出经 stdin 管道喂给 `jev-axi triage`：

```bash
cargo test 2>&1 | jev-axi triage
# 或：npm test 2>&1 | jev-axi triage
```

通用形式：`<测试/构建输出> 2>&1 | jev-axi triage`。

`jev-axi triage` 分类失败 domain（语法、类型系统、逻辑回归、flaky 时序、环境），并指出精确的失败边界。真实输出示例（以下为英文原样输出，逐字保留）：

```text
domain: type_mismatch
root_cause: Expected `u64` but found `usize` in buffer offset calculation at src/lib.rs:42
fix_direction: Cast index using `as u64` or modify struct field to `usize`.
```

**就绪检查**：若本会话状态为 DEGRADED，或 `jev-axi` 不在就绪清单中 → 不要执行该命令，向用户说明缺失项及安装方式（`npm install -g jev-axi`；云端需设置有效的 `TYPESAFE_API_KEY`，本地桥需 `TYPESAFE_BASE_URL` 可达），转标准技能「`systematic-debugging`」继续；若命令已执行但拿不到 domain / root_cause / fix_direction 结论 → 无论是否严格模式都停止，继续手工取证，按阈值表处理，不得假装通过。

### 阶段 2：假设生成与 Jev 评分

对根因为何发生生成 2-3 个合理假设。对每个假设，依据错误 trace 与最近 git diff 评估其合理性：

```bash
jev-axi check "Does this stack trace support the hypothesis: <假设>?" --state "<stack trace 与 diff 片段>"
```

选取经验证概率最高的假设（p > 0.70）作为修复方向。若全部假设均 p < 0.70，继续收集证据，禁止盲修。

**就绪检查**：若本会话状态为 DEGRADED，或 `jev-axi` 不在就绪清单中 → 不要执行该命令，向用户说明缺失项及安装方式，转标准技能「`systematic-debugging`」继续；若命令已执行但所有假设均低于 0.70 → 无论是否严格模式都回到取证循环，不得选取低置信假设硬修，不得假装通过。

### 阶段 3：最小复现测试用例

写能触发该 bug 的最小失败测试，运行并确认它确实失败。

### 阶段 4：根因修复与绿色验证

在根因处实施修复；运行测试套确认全绿，再对所有调用方跑回归检查。

## 经统一入口调用

**本节是 jev-superpowers-zh 的增量内容。** 本项目中 agent 通过 `bash scripts/jev-gate triage`（stdin 透传，形如 `<测试/构建输出> 2>&1 | bash scripts/jev-gate triage`）与 `bash scripts/jev-gate check-hypothesis "<假设>?" --state "<trace & diff>"` 调用，由统一入口完成就绪探测与两类失败分流；原生 `jev-axi triage` / `jev-axi check` 命令、stdin 管道形式、`--state` 参数与 p > 0.70 阈值逐字不变。

## 失效模式

阈值表见 docs/CONFIDENCE.zh.md，两类失败严格区分：

- **环境型失败**（`jev-axi` 不在 PATH / key 缺失 / 后端不可达）：soft 模式显著告知 + 跳过该门 + 转标准技能「`systematic-debugging`」；strict 模式按上游硬 STOP（exit 2 / 打印安装指引）。
- **判定型失败**（门跑了但否决：全部假设 p < 0.70，或 triage 无法定位 root_cause）：任何模式都阻断或转人工，继续取证，软降级绝不放行。

降级提示每会话醒目告知一次，绝不静默降级。
