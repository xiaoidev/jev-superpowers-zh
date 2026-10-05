# jev-superpowers-zh — Kiro 安装指南

在 [Kiro](https://kiro.dev)（Amazon AI IDE）中使用 jev-superpowers-zh 的完整指南。

## steering 里只有索引（旧布局迁移）

旧 superpowers-zh 曾把 27 个 skills 的**正文**直接装进 `.kiro/steering/`。而 [Kiro 官方文档](https://kiro.dev/docs/steering/)明确：`.kiro/steering/` 下的文件默认 `inclusion: always`，会被 "loaded into every Kiro interaction automatically"。

实测那个布局是 **47 个 md、335 KB，每一轮对话全量进上下文**。不是不能用，是每轮都在烧 token。

jevzh 采用索引式布局：**4.4 KB**（76 倍差距）。重装即可，安装器会自动清掉旧布局：

```bash
cd /your/project
npx jevzh@latest --tool kiro
```

会看到：

```
🧹 Kiro: 清理旧布局 27 个 skills 目录 <- .kiro/steering/
✅ Kiro: steering 索引 -> .kiro/steering/jevzh.md
```

**你自己写的 steering 文件不会被动** —— 只清理与我们 skill 同名的那些目录。

## 快速安装

```bash
cd /your/project
npx jevzh --tool kiro
```

装两样东西：

| 位置 | 内容 | 是否每轮常驻 |
|---|---|---|
| `.kiro/steering/jevzh.md` | 索引：核心规则 + 27 个 skills 的触发条件表（约 4.4 KB） | **是**（`inclusion: always`） |
| `.kiro/skills/<name>/SKILL.md` | skill 正文 | 否，按需读取 |

## 工作原理

Kiro 用 **Steering** 机制管理 AI 行为规则。关键的三件事：

- **目录**：`.kiro/steering/`（项目级）、`~/.kiro/steering/`（全局）
- **默认行为**：**没写 `inclusion` 的文件默认就是 always** —— 每次交互自动加载
- **frontmatter 键**（这是 Kiro 自己的，别和 Cursor 系搞混）：

  | 键 | 含义 |
  |---|---|
  | `inclusion: always` | 每次交互都加载（**默认值**） |
  | `inclusion: fileMatch` + `fileMatchPattern` | 匹配特定文件时加载 |
  | `inclusion: manual` | 仅在聊天里用 `#steering-file-name` 引用时加载 |
  | `inclusion: auto` | 按 `description` 与请求匹配时自动加载 |

> 📌 注意：`alwaysApply` / `globs` 是 Cursor / Trae 系约定，**Kiro 不支持这两个键**，请勿照抄。

### 为什么正文不放 steering 里

因为 steering 是常驻开销。这跟我们对 Cline、Kilo Code 的处理是同一个道理：**常驻的位置只放索引，正文按需读取。**

索引里明确告诉 Kiro：任务匹配某个 skill 时，去读 `.kiro/skills/<skill-name>/SKILL.md` 并遵循其流程。

## 手动安装

```bash
git clone https://github.com/xiaoidev/jev-superpowers-zh.git
mkdir -p /your/project/.kiro/skills
cp -r jev-superpowers-zh/skills/* /your/project/.kiro/skills/
```

> 手动复制不会生成 `.kiro/steering/jevzh.md` 索引，Kiro 不会知道这些 skill 的存在，你需要自己写一份索引。建议优先用 `npx jevzh --tool kiro`。
>
> **不要**把正文直接拷进 `.kiro/steering/` —— 那正是本次修掉的问题。

## 使用

装好重启 Kiro 后：

- 直接描述任务即可，索引会引导它去匹配 skill：「帮我加一个导出功能」应触发 brainstorming
- 也可以点名：「用 brainstorming 分析这个需求」
- 手动引用索引本身：在聊天里输入 `#jev-superpowers-zh`

## 卸载

```bash
npx jevzh --uninstall
```

会删除 `.kiro/skills/` 下装过的 skill 和 `.kiro/steering/jevzh.md`，并顺带清理旧布局残留。你自己的 steering 文件保留。

## 更新

```bash
npx jevzh@latest --tool kiro
```

## 获取帮助

- 提交 Issue：https://github.com/xiaoidev/jev-superpowers-zh/issues
- Kiro Steering 文档：https://kiro.dev/docs/steering/
