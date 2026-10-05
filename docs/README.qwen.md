# jev-superpowers-zh — Qwen Code 安装指南

在 [Qwen Code](https://github.com/QwenLM/qwen-code) 中使用 jev-superpowers-zh 的完整指南。

## ⚠️ 先说清楚是哪个产品

**Qwen Code 是 [`QwenLM/qwen-code`](https://github.com/QwenLM/qwen-code) 这个命令行工具**（Gemini CLI 的 fork），跑在终端里。

它**不是**通义灵码 —— 通义灵码是阿里的 IDE 插件，是另一个产品，配置路径完全不同（别照着通义灵码的教程配置 Qwen Code）。

## 安装

```bash
cd /your/project
npx jevzh --tool qwen
```

全局（所有项目共享）：

```bash
npx jevzh --global --tool qwen
```

装两样东西：

| 位置 | 内容 |
|---|---|
| `.qwen/skills/<name>/SKILL.md`（全局为 `~/.qwen/skills/`） | 27 个 skills 正文 |
| `QWEN.md`（全局为 `~/.qwen/QWEN.md`） | bootstrap：核心规则 + skill 清单，引导 AI 在恰当时机去读对应 SKILL.md |

> 📌 skills 与 bootstrap 同时安装：只复制 skills 虽然能被发现，但没有 `QWEN.md` 引导，skill 很少会在恰当时机被自动调用。

## 工作原理

Qwen Code 两套机制我们都用上了，各自的出处：

**① Skills —— 自动发现，无需配置**

[官方 Skills 文档](https://qwenlm.github.io/qwen-code-docs/en/users/features/skills/)：Qwen Code 从 `~/.qwen/skills/`（个人）和 `.qwen/skills/`（项目）自动发现 skill，每个 skill 是一个含 `SKILL.md` 的子目录，走 Agent Skills 开放标准（与 Claude Code、Gemini CLI 同一套）。

**② QWEN.md —— 分层记忆，自动拼接**

Qwen Code 的分层记忆系统默认上下文文件就是 `QWEN.md`，从当前目录逐层向上到项目根、以及全局 `~/.qwen/` 都会被扫描并拼接进上下文。文件名可用 `contextFileName` 设置改，默认 `QWEN.md`。

所以 bootstrap 写在 `QWEN.md` 里，每次会话自动加载；skill 正文留在 `.qwen/skills/` 按需读取，不占常驻开销。

### 已有 QWEN.md 怎么办

**追加，不覆盖。** 我们把内容包在哨兵注释之间，你自己写的部分原样保留；卸载时只切除我们那一段。已实测：装完再卸，你的 `QWEN.md` 逐字节恢复原状。

## Skill 加载优先级

| 位置 | 范围 |
|------|------|
| `.qwen/skills/` | 项目级，仅当前项目 |
| `~/.qwen/skills/` | 用户级，所有项目共享 |

同名时项目级优先。

## 手动安装

```bash
git clone https://github.com/xiaoidev/jev-superpowers-zh.git
mkdir -p /your/project/.qwen/skills
cp -r jev-superpowers-zh/skills/* /your/project/.qwen/skills/
```

> 手动复制不会生成 `QWEN.md` bootstrap，skill 会被发现但不会自动触发。建议优先用 `npx jevzh --tool qwen`。

## 使用

装好重启 Qwen Code：

- 直接描述任务，bootstrap 会引导它匹配 skill：「帮我加一个导出功能」应先触发 brainstorming 做需求分析，而不是直接写代码
- 也可以点名：「用 brainstorming 分析这个需求」
- 用 `/memory show` 可以查看当前拼接进上下文的内容，确认 bootstrap 是否被加载

## 卸载

```bash
npx jevzh --uninstall            # 项目级
npx jevzh --global --uninstall   # 全局
```

会删除装过的 skill 目录，并从 `QWEN.md` 中精确切除 jev-superpowers-zh 段（保留你自己写的内容）。实测全局卸载后 `~/` 下零残留。

## 获取帮助

- 提交 Issue：https://github.com/xiaoidev/jev-superpowers-zh/issues
- Qwen Code 仓库：https://github.com/QwenLM/qwen-code
- Qwen Code Skills 文档：https://qwenlm.github.io/qwen-code-docs/en/users/features/skills/
- Qwen Code 记忆文档：https://qwenlm.github.io/qwen-code-docs/en/users/features/memory/
