# jev-superpowers-zh 发布说明

## v0.1.0 — 首期整合版（整合开发中）

jev-superpowers-zh 以 [superpowers-zh](https://github.com/jnMetaCode/superpowers-zh) 的完整中文方法论与 26 款工具分发能力为底座，叠加 6 个汉化的 [jev-superpowers](https://github.com/AkashPriyadarshii/jev-superpowers) 门禁技能与可软降级的本地/云端决策层，两者共同的方法论上游为 [obra/superpowers](https://github.com/obra/superpowers)。

### 技能：21 + 6，共 27 个

- **21 个中文技能原样承接自 zh 底座**：15 个 obra 上游方法论技能的完整翻译、4 个中国原创技能（chinese-code-review、chinese-commit-conventions、chinese-documentation、chinese-git-workflow）与 2 个历史保留技能（mcp-builder、workflow-runner），目录 slug 与正文方法论保持不变。
- **6 个汉化 jev 门禁技能**：jev-using-superpowers、jev-brainstorming、jev-writing-plans、jev-executing-plans、jev-systematic-debugging、jev-verification。命令、参数、阈值与端点逐字保留上游契约，正文汉化，并将硬 STOP 改写为经统一门禁入口判定后的软降级/阻断行为。

### jevzh 安装器与 26 款工具分发

- 提供统一 CLI `jevzh`（npm 包名 `jev-superpowers-zh`），fork 自 zh 安装器并改造品牌、参数与钩子安装逻辑。
- 沿用 zh 底座的 26 款 AI 编程工具矩阵，支持项目级/全局安装、幂等重装与卸载；默认分发 27 个技能。
- `--no-jev` 仅安装 21 个中文技能且不接线门禁钩子；钩子自动接线仅面向支持钩子机制的 Claude Code / Cursor，其余目标安装技能并在正文提供手动门禁步骤。

### 默认软降级与 strict 模式

- 门禁默认开启但**软降级**：探测不到外部工具或后端时降级为纯方法论，警告后放行，每会话仅提示一次。
- `strict: true` 时环境型失败直接阻断并输出中文安装指导。
- 区分两类失败：环境型失败（工具/网络/密钥缺失）可软降级；**判定型失败**（如 guard block、commit 校验未出现 `[PASS]`）在任何模式下都阻断，不被软放行。

### 配置：`.jevzh.json` 与环境变量双通道

- 项目根 `.jevzh.json` 声明 `backend`、`strict`、`baseUrl`、`tools` 等配置；仓库提供 `.jevzh.json.example` 模板，实际配置由安装器生成、不入库。
- 环境变量 `JEVZH_BACKEND`、`JEVZH_STRICT`、`TYPESAFE_BASE_URL`、`TYPESAFE_API_KEY` 优先级高于文件，适配 CI 与本地切换。

### 本地 Laya heuristic 桥

- 迁入 jev 上游的 `scripts/serve-laya.py`（Python 标准库，无 pip 运行时依赖），提供 `/health`、`/v1/models`、`/v1/systemone`。
- `backend: auto` 优先使用本地桥：未安装 Laya（ModernBERT-large）时自动回落到内置 heuristic 判定，`/health` 在 `laya_installed: false` 时仍可用；无 GPU / Apple Silicon 环境也能离线工作。

### 与三家上游的共存迁移

面向已安装 obra/superpowers、superpowers-zh、jev-superpowers 的环境，安装器在写盘前执行 preflight，并按目标事务化写入、可回滚：

- **仅补缺**：同名技能零覆盖，只补入缺失技能；竞品文件内容与 mtime 不变。
- **router 备份接管**：对旧 bootstrap（router）整文件备份后切除可识别的旧哨兵段、写入成对 jev-superpowers-zh 标记，保留用户自有内容；hooks/settings 以 JSON 读改写方式合并，可用 `--keep-router` 跳过接管。
- **plugin 硬阻断**：检测到 plugin 形态的三家上游启用记录时退出码 2，`--force` 也不绕过、目标目录零写入。
- **doctor / restore**：`doctor` 报告竞品来源、生效 router、hooks 状态与就绪四态；每次接管的备份位于 `.jevzh/backups/<时间戳>/`（保留最近 3 份），`restore <时间戳>` 可恢复；卸载不自动恢复，并兼容清理旧 superpowers-zh 哨兵。

### 许可与归属

本项目采用 MIT 许可证，版权声明并列四方：obra (superpowers)、jnMetaCode (superpowers-zh)、AkashPriyadarshii (jev-superpowers) 与 jev-superpowers-zh contributors，详见 [LICENSE](LICENSE)。本地桥 `scripts/serve-laya.py` 保持其上游 Apache-2.0 声明不变（与 MIT 兼容）。
