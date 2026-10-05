# jev-superpowers-zh — Codex CLI 安装指南

## 项目级安装位置：`.agents/skills`（不是 `.codex/skills`）

官方文档（developers.openai.com/codex/skills，现 308 跳 learn.chatgpt.com/docs/build-skills）给出的扫描目录**完整清单**是：

```
$CWD/.agents/skills
$CWD/../.agents/skills
$REPO_ROOT/.agents/skills
$HOME/.agents/skills
/etc/codex/skills
```

**没有 `.codex/skills`。** jevzh 的项目级安装直接落到 `.agents/skills`（Codex 实际扫描的位置）；全局装到 `~/.agents/skills`。重装时会自动清掉旧 superpowers-zh 装在 `.codex/skills` 里的副本（你自己放在该目录下的内容不动）：

```bash
cd /your/project
npx jevzh --tool codex
```

> 顺带说明：`.agents/skills` 与 Antigravity 共用，这是 Agent Skills 开放约定，不是冲突。装过其中一个，另一个也能读到。

在 Codex 中使用 jev-superpowers-zh 的完整指南。

## 快速安装

告诉 Codex：

```
Fetch and follow instructions from https://raw.githubusercontent.com/xiaoidev/jev-superpowers-zh/refs/heads/main/.codex/INSTALL.md
```

## Codex 原生插件安装

Codex CLI 自带插件管理，可以直接把本仓库注册为 marketplace 安装，不需要 Node.js / npm（已在 codex-cli 0.147.0、0.154.0 上实测）：

```bash
codex plugin marketplace add https://github.com/xiaoidev/jev-superpowers-zh.git
codex plugin add jev-superpowers-zh@jev-superpowers-zh
codex plugin list   # 应显示 jev-superpowers-zh@jev-superpowers-zh  installed, enabled
```

安装后 27 个 skills 全部可被发现；插件清单声明了空 `hooks`，不会注册仅适用于 Claude Code 的 SessionStart hook。

**更新：**

```bash
codex plugin marketplace upgrade jev-superpowers-zh
codex plugin add jev-superpowers-zh@jev-superpowers-zh
```

**卸载：**

```bash
codex plugin remove jev-superpowers-zh@jev-superpowers-zh
codex plugin marketplace remove jev-superpowers-zh   # 可选：连同 marketplace 一起移除
```

## 手动安装

### 前置条件

- OpenAI Codex CLI
- Git

### 步骤

1. 克隆仓库：
   ```bash
   git clone https://github.com/xiaoidev/jev-superpowers-zh.git ~/.codex/jev-superpowers-zh
   ```

2. 创建 skills 符号链接：
   ```bash
   mkdir -p ~/.agents/skills
   ln -s ~/.codex/jev-superpowers-zh/skills ~/.agents/skills/jev-superpowers-zh
   ```

3. 重启 Codex。

4. **子代理 skills（可选）：** `dispatching-parallel-agents` 和 `subagent-driven-development` 需要 Codex 的多代理功能。在 Codex 配置中添加：
   ```toml
   [features]
   multi_agent = true
   ```

### Windows

使用 junction 代替符号链接（无需开发者模式）：

```powershell
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.agents\skills"
cmd /c mklink /J "$env:USERPROFILE\.agents\skills\jev-superpowers-zh" "$env:USERPROFILE\.codex\jev-superpowers-zh\skills"
```

## 工作原理

Codex 原生支持 skill 发现——启动时扫描 `~/.agents/skills/` 目录，解析 SKILL.md 的 frontmatter，按需加载 skills。通过一个符号链接即可注册所有 skills：

```
~/.agents/skills/jev-superpowers-zh/ → ~/.codex/jev-superpowers-zh/skills/
```

`jev-using-superpowers` 路由技能会随技能目录一起被发现，任务匹配时统一约束「先选技能、再动手」的使用纪律——无需额外配置。

## 使用

Skills 自动发现。Codex 在以下情况激活 skills：
- 你提到 skill 名称（如 "use brainstorming"）
- 任务匹配 skill 的描述
- `jev-using-superpowers` 路由技能指示 Codex 使用某个 skill

## 更新

```bash
cd ~/.codex/jev-superpowers-zh && git pull
```

Skills 通过符号链接即时更新。

## 卸载

```bash
rm ~/.agents/skills/jev-superpowers-zh
```

**Windows (PowerShell):**
```powershell
Remove-Item "$env:USERPROFILE\.agents\skills\jev-superpowers-zh"
```

可选：删除克隆的仓库 `rm -rf ~/.codex/jev-superpowers-zh`

## 获取帮助

- 提交 Issue：https://github.com/xiaoidev/jev-superpowers-zh/issues
- 项目主页：https://github.com/xiaoidev/jev-superpowers-zh
