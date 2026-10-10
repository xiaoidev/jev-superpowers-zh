---
name: jev-executing-plans
description: 执行书面实现计划时使用——指导逐步骤 TDD 执行，并以 jev-guard 强制命令安全、以 git-jev 在提交前筛查 diff；工具或后端缺失时软降级回标准中文技能 executing-plans
---

派生自 jev-superpowers，汉化 + 软降级改造。

# Jev 计划执行：安全且经核验的执行

遵循 `executing-plans` 的纪律化执行循环，但在危险动作与提交之前插入确定性的 System One 安全门。工作树隔离沿用 `using-git-worktrees`。

## 执行循环

### 1. 加载计划并严格审查

- 阅读 `docs/superpowers/plans/` 下的计划文件。
- 如适用，验证工作树隔离（`using-git-worktrees`）。
- 建立清晰的任务检查清单。

### 2. 命令安全门（jev-guard）

执行任何潜在破坏性的 shell 命令之前（批量删除、递归文件改动、分支操作、schema 迁移），必须先过 `jev-guard` 筛查：

```bash
jev-guard "<待执行命令>"
```

真实输出示例（输出主体为英文原样、逐字保留；`#` 开头行为中文说明）：

```text
# 安全命令：即时放行（<80ms）
PASS (destructive: 0.01)

# 危险命令：被拦截并拒绝
verdict: block
top_hazard: destructive (0.96)
[BLOCKED] Destructive command requires explicit user confirmation.
```

只要输出出现 `verdict: block` 或命令被标记为破坏性 / 不安全：停止并请求用户明确人工确认，任何模式都不得自动执行。

**就绪检查**：若本会话状态为 DEGRADED，或 `jev-guard` 不在就绪清单中 → 不要执行该命令，向用户说明缺失项及安装方式（随 `npm install -g jev-axi` 一并安装，亦可独立安装；后端需有效的 `TYPESAFE_API_KEY` 或可达的 `TYPESAFE_BASE_URL`），转标准中文技能「`executing-plans`」继续；若命令已执行但结论为否决（`verdict: block`）→ 无论是否严格模式（strict）都停止并请求人工确认，按阈值表处理，不得假装通过。

### 3. 提交前反射门（git-jev）

任何任务提交或 git push 之前：

1. 暂存改动：`git add <files>`
2. 用 git-jev 筛查 diff：

   ```bash
   git jev check
   ```

3. 确认：
   - 无未脱敏密钥或私有令牌泄露（p < 0.10）。
   - 无破坏性 payload 或后门模式（p < 0.10）。
4. 仅在输出含 `[PASS]` 后才可提交；FAIL 永不提交。

真实输出示例（以下为英文原样输出，逐字保留）：

```text
✔ No secrets detected (p=0.02)
✔ No destructive payloads detected (p=0.01)
[PASS] Commit diff verified by git-jev.
```

**就绪检查**：若本会话状态为 DEGRADED，或 git-jev 不在就绪清单中（`git jev --version` 探测失败）→ 不要执行 `git jev check`，向用户说明缺失项及安装方式（`git jev install`），转标准中文技能「`executing-plans`」的流程继续；若命令已执行但结论为否决（输出无 `[PASS]`、secrets 概率 p ≥ 0.10、或 payload 概率 p ≥ 0.10）→ 无论是否严格模式都阻断，先修复再提交，不得假装通过。

### 4. 遇阻即停

测试意外失败或指令含糊时：

- 立即停止。
- 不要强行改动，不要盲目对症修补。
- 转 `jev-systematic-debugging`（其标准中文技能为 `systematic-debugging`）。

## 经统一入口调用

**本节是 jev-superpowers-zh 的增量内容。** 本项目中 agent 通过 `bash scripts/jev-gate guard "<命令>"` 与 `bash scripts/jev-gate commit`（在 `git add` 之后调用，内部执行 `git jev check`）调用，由统一入口完成就绪探测与两类失败分流；原生命令、p < 0.10 阈值与 `PASS (destructive: 0.01)` / `verdict: block` / `[PASS]` 判定逐字不变。

## 失效模式

阈值表见 docs/CONFIDENCE.zh.md，两类失败严格区分：

- **环境型失败**（`jev-guard` / git-jev 不在 PATH、key 缺失、后端不可达）：软降级模式（soft）显著告知 + 跳过该门 + 转标准中文技能「`executing-plans`」；严格模式按上游硬 STOP（exit 2 / 打印安装指引）。
- **判定型失败**（门跑了但否决：`verdict: block`、`git jev check` 无 `[PASS]`、secrets 或 payload 概率 p ≥ 0.10）：任何模式都阻断或转人工，软降级绝不放行。

降级提示每会话醒目告知一次，绝不静默降级。
