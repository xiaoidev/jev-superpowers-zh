---
name: jev-writing-plans
description: 当你已有多步骤任务的规格或需求、即将动手写代码之前使用——编写小步 TDD 计划，并用 jev-scout 核验真实 crate 与库，杜绝幻觉包；工具或后端缺失时软降级回标准 writing-plans
---

派生自 jev-superpowers，汉化 + 软降级改造。

# Jev 计划编写：零幻觉实现计划

继承 `writing-plans` 的小步任务粒度、DRY/YAGNI 原则与严格 TDD 顺序。

## 依赖核验铁律（强制）

LLM 在实现计划阶段经常幻觉出不存在的库、已死的 crate 或虚构 API。在 `jev-writing-plans` 中，**每个拟引入的外部依赖或库，写入计划之前必须经 `jev-scout` 核验**：

```bash
jev-scout "<库或 crate 需求>" --ecosystem <crates|github|all>
```

需要机器可读输出时可追加 `--json`，例如：

```bash
jev-scout "fast memory mapped ring buffer in rust" --ecosystem crates --json
```

**核验标准：**

- **Fit 分数**：对需求描述的得分必须 ≥ 2.0 / 4.0。
- **持续维护性（Noul）**：维护概率必须 > 0.50。
- **命令输出**：把 `jev-scout` 给出的真实 `cargo add <crate>` 或 `npm install <pkg>` 安装命令原样粘贴进任务步骤，绝不猜包名。
- **0 候选即门失败**：若代理虚构了如 `ringbuf-ultra-fast` 的假包，registry 返回 0 个候选（以下为英文原样输出，逐字保留）：

```text
[jev-scout] Searching crates.io for "ringbuf-ultra-fast"...
[jev-scout] 0 verified crates found.
[GATE FAILED] Cannot add unverified dependency to implementation plan.
```

此时必须改用已核验的替代方案（如真实存在的 crate 或标准库原语），不得把未核验依赖写进计划。

**就绪检查**：若本会话状态为 DEGRADED，或 `jev-scout` 不在就绪清单中 → 不要执行该命令，向用户说明缺失项及安装方式（`cargo install jev-scout`；云端需设置有效的 `TYPESAFE_API_KEY`，本地桥需 `TYPESAFE_BASE_URL` 可达），转标准技能「`writing-plans`」继续；若命令已执行但结论为否决（0 候选、Fit < 2.0、Noul ≤ 0.50，或拿不到可粘贴的真实安装命令）→ 无论是否严格模式都停止，按阈值表处理，不得假装通过。

## 任务结构与小步拆分

每个任务为 2-5 分钟工作量：

1. **任务头**：创建/修改的文件 + 经 `jev-scout` 核验的依赖。
2. **步骤 1（TDD 红）**：写一个失败测试。
3. **步骤 2（验证红）**：运行测试命令，确认按预期失败。
4. **步骤 3（TDD 绿）**：写最少的实现代码。
5. **步骤 4（验证绿）**：运行测试命令，确认 0 失败。
6. **步骤 5（提交）**：以 conventional message 提交（`feat:`、`fix:`）。

实现计划保存到 `docs/superpowers/plans/YYYY-MM-DD-<feature>.md`。

## 经统一入口调用

**本节是 jev-superpowers-zh 的增量内容。** 本项目中 agent 通过 `bash scripts/jev-gate scout "<依赖需求>" --ecosystem <crates|github|all> [--json]` 调用，由统一入口完成就绪探测、参数透传与两类失败分流；原生 `jev-scout` 命令、`--ecosystem` 与 `--json` 参数、Fit ≥ 2.0 / Noul > 0.50 阈值逐字不变。

## 失效模式

阈值表见 docs/CONFIDENCE.zh.md，两类失败严格区分：

- **环境型失败**（`jev-scout` 不在 PATH / key 缺失 / registry 或后端不可达）：soft 模式显著告知 + 跳过该门 + 转标准技能「`writing-plans`」；strict 模式按上游硬 STOP（exit 2 / 打印安装指引）。
- **判定型失败**（门跑了但否决：0 候选、Fit < 2.0、Noul 维护概率 ≤ 0.50、无真实安装命令）：任何模式都阻断或转人工，软降级绝不放行。

降级提示每会话醒目告知一次，绝不静默降级。
