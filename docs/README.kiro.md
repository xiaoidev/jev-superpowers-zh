# jev-superpowers-zh — Kiro 安装指南

在 [Kiro](https://kiro.dev)（Amazon AI IDE）中使用 jev-superpowers-zh 的完整指南。

## steering 里只有索引（旧布局迁移）

旧 superpowers-zh（v1.7.9 及更早）曾把 20 个 skill 的**正文**直接装进 `.kiro/steering/`。而 [Kiro 官方文档](https://kiro.dev/docs/steering/)明确：`.kiro/steering/` 下的文件默认 `inclusion: always`，会被 "loaded into every Kiro interaction automatically"。

实测那个布局是 **47 个 md、335 KB，每一轮对话全量进上下文**。不是不能用，是每轮都在烧 token。

jevzh 采用索引式布局：索引文件约 **4.4 KB**（76 倍差距），正文放到 `.kiro/skills/` 按需读取：

```bash
cd /your/project
npx jevzh@latest --tool kiro
```

> 📌 **jevzh 不会删除旧 steering 目录。** 旧版留下的 `.kiro/steering/<skill>/` 子目录属于你或其他发行版（superpowers-zh）的内容，安装器一律不删不动，**重装也不会自动清理**。安装器只会接管同名的旧**索引文件** `.kiro/steering/superpowers-zh.md`（默认备份后移除）。要回收旧布局占用的常驻 token，请按下面的命令手动清理。

安装成功时与 steering 相关的输出只有类似两行（**没有**「清理旧布局 N 个 skills 目录」之类的动作）：

```
✅ Kiro [项目]: 新装 27 个 / 已装 0 个 skills -> /your/project/.kiro/skills
✅ Kiro: bootstrap rule -> /your/project/.kiro/steering/jevzh.md
```

若检测到旧版索引文件，还会多一行 MIGRATE（先备份再移除）：

```
🔄 [MIGRATE] Kiro: 备份后移除旧 superpowers-zh 规则文件 -> /your/project/.kiro/steering/superpowers-zh.md
```

想保留新旧两份索引可加 `--keep-router`（两份常驻规则可能同时生效，安装器会给出 WARN）。

### 手动清理旧版 steering 技能目录

先**列出** `.kiro/steering/` 下的子目录逐个确认（旧版把每个 skill 建成一个子目录；正常的 steering 规则都是平铺的 `.md` 文件）：

Windows PowerShell：

```powershell
# 1) 列出待删的旧技能目录，先确认
Get-ChildItem .kiro\steering -Directory | Select-Object Name

# 2) 确认无误后再删（只删子目录，jevzh.md 等 .md 文件不受影响）
Get-ChildItem .kiro\steering -Directory | Remove-Item -Recurse -Force
```

bash / macOS / Linux：

```bash
# 1) 列出待删内容，先确认
find .kiro/steering -mindepth 1 -maxdepth 1 -type d -print

# 2) 确认无误后再删（只删子目录，保留 jevzh.md 等 .md 文件）
find .kiro/steering -mindepth 1 -maxdepth 1 -type d -exec rm -rf {} +
```

删除后重启 Kiro（或开新会话）即生效。拿不准就先备份整个 `.kiro/steering/` 目录。

## 快速安装

```bash
cd /your/project
npx jevzh --tool kiro
```

jevzh 只支持 Kiro 的**项目级**安装（Kiro 没有通用 `--global` 能覆盖的用户级 skills 路径，`--global --tool kiro` 会被安装器直接拒绝）。装两样东西：

| 位置 | 内容 | 是否每轮常驻 |
|---|---|---|
| `.kiro/steering/jevzh.md` | 索引：核心规则 + 27 个 skills（21 中文 + 6 个 jev-*）的触发条件表（约 4.4 KB） | **是**（`inclusion: always`） |
| `.kiro/skills/<name>/SKILL.md` | skill 正文（每个目录带 `.jevzh-meta.json` 归属标记） | 否，按需读取 |

## 工作原理

Kiro 用 **Steering** 机制管理 AI 行为规则。关键的三件事：

- **目录**：`.kiro/steering/`（项目级）、`~/.kiro/steering/`（全局，jevzh 不往这里安装）
- **默认行为**：**没写 `inclusion` 的文件默认就是 always** —— 每次交互自动加载；全局与项目规则冲突时 Kiro 以项目规则为准
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
> **不要**把正文直接拷进 `.kiro/steering/` —— 那正是旧版布局烧 token 的原因。

## 使用

装好重启 Kiro 后：

- 直接描述任务即可，索引会引导它去匹配 skill：「帮我加一个导出功能」应触发 brainstorming
- 也可以点名：「用 brainstorming 分析这个需求」
- 手动引用索引本身：在聊天里输入 `#jevzh`（即 `.kiro/steering/jevzh.md`，manual 引用语法是 `#` 加文件名）

## 卸载

```bash
# 只卸 Kiro（推荐，不碰其他工具）
npx jevzh --uninstall --tool kiro

# 或在项目目录全量卸载所有已装目标
npx jevzh --uninstall
```

卸载器会删除：

- `.kiro/skills/` 下**本包安装的** skill 目录（目录里带本包 `.jevzh-meta.json` 归属标记的才删；你或其他工具的同名目录一律保留并给 WARN；容器空了才会顺带移除 `.kiro/skills/` 本身）；
- `.kiro/steering/jevzh.md`（本包索引文件）；
- `.kiro/steering/superpowers-zh.md`（旧 superpowers-zh 索引文件，迁移支持）。

**不会**删除旧版 v1.7.9 装进 `.kiro/steering/<skill>/` 的 20 个技能目录，也不碰你自己写的 steering 文件 —— 那些内容请按上文[「手动清理旧版 steering 技能目录」](#手动清理旧版-steering-技能目录)处理。

## 更新

```bash
npx jevzh@latest --tool kiro
```

更新同样不会清理旧 steering 布局；升级后若仍嫌旧目录每轮占上下文，按上文的手动清理步骤处理。

## 获取帮助

- 提交 Issue：https://github.com/xiaoidev/jev-superpowers-zh/issues
- Kiro Steering 文档：https://kiro.dev/docs/steering/
