# 置信度策略（中文，单一事实源）

> 本文译自上游 jev-superpowers 的 `docs/CONFIDENCE.md`，阈值数字一字未改；
> jev-superpowers-zh 的门禁实现（[scripts/jev-gate](../scripts/jev-gate)）与本文逐行对应，完整退出码见 [jev-gate.md](jev-gate.md)。

每个 jev 判定都门控在**校准后的置信度**上，而不是只看选中了哪个选项。阈值如下；要调只在本文调，别处不得另立数字。

| 场景 | 执行（直接做） | 确认（请人类定夺） | 停止（不得行动） |
|---|---|---|---|
| `pick` 方案推荐 | **≥ 0.80** | **0.50–0.80**，由人类破平（jev-gate 返回 exit 3） | **< 0.50**，补充需求后重新探测 |
| 危险 shell（`jev-guard`） | 风险 clear 才放行 | flagged（有风险标记）→ 必须显式确认 | 始终需要确认的命令**永不自动执行**；`verdict: block` 任何模式都否决 |
| 提交门（`git jev`） | 输出含 **`[PASS]` 且 p < 0.10** | 任何 flag → 先修复 | **FAIL 永不提交**；无 `[PASS]` 即 exit 2 |
| 调试假设（`jev-axi check`） | **p > 0.70**（严格大于）且为最高概率项 | 全部 < 0.70 → 继续收集证据 | **永不盲修**；解析不到概率值同否决 |
| 缺工具 / 缺密钥 / 离线 | — | — | **STOP**，打印安装行（见下） |

## 规则

- 置信度衡量的是**单题答案分布的集中度**，不是许可；即使有明显赢家，接近平局（例如 **0.56 / 0.44**）仍属低置信度，按人工破平处理。
- **未知分支忽略，不参与门控**（上游原文：Unknown branches are ignored, never gated）：工具输出中策略未定义的分支/字段不当作失败信号。但要区分另一种情况——**判定结论本身无法解析**时本仓 gate 采取保守否决（fail-closed）：例如 guard 输出里既找不到 PASS 也找不到 `verdict: block`、pick 的 confidence 越界（< 0、> 1）或根本不可解析，一律 exit 2。「忽略未知分支」针对的是明确输出里的多余信息，「保守否决」针对的是连结论都读不出来。
- 阈值是起始值：在你自己评审过的案例上持续校准。

## 缺工具 / 离线：STOP 并打印安装行

门禁所需工具缺失或后端不可用时，**不得伪造判定**。jev-gate 会打印缺失工具与安装方式：

| 工具 | 安装方式 |
|---|---|
| jev-scout | `cargo install jev-scout` |
| jev-axi | `npm install -g jev-axi` |
| git-jev | `git jev install` |
| jev-guard | `npm install -g jev-guard` |
| supercov | `npm install -g supercov` |
| limpet | `cargo install limpet`（或 `python3 ~/limpet/limpet.py`） |

在 jev-superpowers-zh 的**宽松模式**（默认）下，环境型失败会软降级：打印 `[门禁降级]` 与安装行后跳过本门（exit 0），并提示转用对应标准中文技能继续流程——这不是判定通过。**严格模式**（`.jevzh.json` 的 `strict:true` 或 `JEVZH_STRICT=1`）下环境型失败同样 exit 2。注意：判定型失败（置信度不足、FAIL、block）在任何模式下都不软放行。

离线时可运行 `python scripts/serve-laya.py` 启动本地桥（heuristic 零依赖即可用），详见 [FOSS_LAYA.zh.md](FOSS_LAYA.zh.md)。
