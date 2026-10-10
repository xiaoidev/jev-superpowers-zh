# jev-superpowers-zh — DeerFlow 安装指南

在 [DeerFlow](https://github.com/bytedance/deer-flow)（字节跳动开源 SuperAgent）中使用 jev-superpowers-zh 的完整指南。

## 快速安装

在你的 **DeerFlow 仓库根目录**下运行：

```bash
cd /your/deer-flow
npx jevzh --tool deerflow
```

skills 会装到 `skills/custom/`。

> 📌 自动检测认的是 DeerFlow 2.0 的固定目录标记 `skills/public/`（DeerFlow 顶层没有 `deer_flow/` 目录，实际是 `backend/` `frontend/` `skills/` `docker/` 等）；检测不到时请手动 `--tool deerflow`。旧 superpowers-zh 的 `deer_flow/` 标记仅作历史兼容。

## 工作原理

[DeerFlow 官方文档](https://bytedance-deer-flow.mintlify.app/concepts/skills)明确了两个**固定**目录：

| 目录 | 用途 | 是否进 git |
|---|---|---|
| `skills/public/` | DeerFlow 自带的 skill，社区维护 | 是 |
| `skills/custom/` | 用户自建或安装的 skill | 否，默认被 gitignore |

加载方式是**自动扫描这两个目录**，找每个子目录里的 `SKILL.md`：

```python
for base_dir in ["skills/public", "skills/custom"]:
    for skill_dir in os.listdir(base_dir):
        ...
```

**无需任何配置**，也没有可改路径的配置项 —— 这两个目录名是写死的。所以我们装到 `skills/custom/`，装完即被发现。

### 容器挂载

DeerFlow 的 skill 在沙箱容器里执行，两个目录会挂到容器内的 `/mnt/skills/`：

```
/mnt/skills/
├── public/
└── custom/
```

所以 skill 内部若要引用自己的附属脚本，路径要写容器内的形式，例如 `python /mnt/skills/custom/my-skill/scripts/process.py`。

> jev-superpowers-zh 的 27 个 skills 以 Markdown 指令为主，`brainstorming` 带的 `scripts/` 是给宿主机 harness 用的可视化伴侣服务，在 DeerFlow 的容器沙箱里不适用 —— 这部分能力在 DeerFlow 上不可用，其余 skill 的方法论正常生效。

## 手动安装

```bash
cd /your/deer-flow
mkdir -p skills/custom
cp -r /path/to/jev-superpowers-zh/skills/* skills/custom/
```

装到别处的 DeerFlow 检出时，用绝对路径即可：

```bash
cp -r /path/to/jev-superpowers-zh/skills/* /path/to/deer-flow/skills/custom/
```

> 📌 DeerFlow **没有** `DEERFLOW_SKILLS_DIR` 环境变量（官方文档中不存在），skill 目录是写死的 `skills/public/` 与 `skills/custom/`，请勿照抄旧文档里的 export 写法。

## 使用

装好后在 DeerFlow 对话中直接描述任务，或点名 skill：

- 「使用头脑风暴来分析这个需求」
- 「用测试驱动开发来实现这个功能」
- 「按系统化调试流程排查这个 bug」

DeerFlow 按 skill frontmatter 里的 `description` 匹配并加载，所以 `description` 写得越具体，被正确选中的概率越高 —— 这也是官方文档强调的一点。

## 卸载

```bash
cd /your/deer-flow
npx jevzh --uninstall
```

只删除我们装进 `skills/custom/` 的那些 skill 目录，`skills/public/` 和你自己的 custom skill 不动。

## 获取帮助

- 提交 Issue：https://github.com/xiaoidev/jev-superpowers-zh/issues
- DeerFlow 仓库：https://github.com/bytedance/deer-flow
- DeerFlow Skills 文档：https://bytedance-deer-flow.mintlify.app/concepts/skills
