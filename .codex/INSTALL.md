# 为 Codex 安装 jev-superpowers-zh

通过原生 skill 发现机制在 Codex 中启用 jev-superpowers-zh 的 27 个 skills（21 个中文方法论技能 + 6 个汉化 jev 门禁技能）。只需克隆并创建符号链接。

## 前置条件

- Git
- Node.js ≥ 20（仅 jevzh 安装器/门禁脚本需要；纯 skills 方式本身不依赖）

## 安装步骤

1. **克隆 jev-superpowers-zh 仓库：**
   ```bash
   git clone https://github.com/xiaoidev/jev-superpowers-zh.git ~/.codex/jev-superpowers-zh
   ```

2. **创建 skills 符号链接：**
   ```bash
   mkdir -p ~/.agents/skills
   ln -s ~/.codex/jev-superpowers-zh/skills ~/.agents/skills/jev-superpowers-zh
   ```

   **Windows (PowerShell)：**
   ```powershell
   New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.agents\skills"
   cmd /c mklink /J "$env:USERPROFILE\.agents\skills\jev-superpowers-zh" "$env:USERPROFILE\.codex\jev-superpowers-zh\skills"
   ```

3. **重启 Codex**（退出并重新启动 CLI）以发现 skills。

> Codex 只扫描 `.agents/skills`，从不扫描 `.codex/skills`。也可以改用官方插件市场：`codex plugin marketplace add https://github.com/xiaoidev/jev-superpowers-zh.git` 后 `codex plugin add jev-superpowers-zh@jev-superpowers-zh`。

## 从旧版 superpowers-zh 迁移

如果你之前安装过 superpowers-zh（jnMetaCode）或英文版 superpowers，需要：

1. **更新/替换仓库：** 重新克隆本仓库（见步骤 1）。
2. **创建 skills 符号链接**（上面的步骤 2）。
3. **移除旧的引导代码块**——删除 `~/.codex/AGENTS.md` 中引用旧 `superpowers-codex bootstrap` / `superpowers-zh` 哨兵的代码块，已不再需要；jevzh 的卸载器也能精确识别旧哨兵并切除。
4. **重启 Codex。**

## 验证

```bash
ls -la ~/.agents/skills/jev-superpowers-zh
```

你应该看到一个符号链接（Windows 上为目录连接），指向 jev-superpowers-zh 的 skills 目录。

## 更新

```bash
cd ~/.codex/jev-superpowers-zh && git pull
```

Skills 通过符号链接即时更新。

## 卸载

```bash
rm ~/.agents/skills/jev-superpowers-zh
```

可选：删除克隆的仓库：`rm -rf ~/.codex/jev-superpowers-zh`。
