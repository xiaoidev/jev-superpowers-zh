#!/usr/bin/env node
/*
 * bin/jevzh.js — jev-superpowers-zh 多工具安装器（CLI：jevzh / npx jevzh）
 *
 * 本文件 fork（派生/分叉）自 jnMetaCode/superpowers-zh 的
 * bin/superpowers-zh.js（MIT License，Copyright (c) jnMetaCode contributors，
 * 项目：https://github.com/jnMetaCode/superpowers-zh），完整保留其 26 工具
 * TARGETS 矩阵、项目级/全局安装、哨兵式 bootstrap 与卸载逻辑，并改造为：
 *   - 品牌切换为 jevzh / jev-superpowers-zh，哨兵改为 jev-superpowers-zh 成对标记；
 *   - 默认安装 27 个技能 + hooks（仅 Claude Code/Cursor）+ 生成 .jevzh.json；
 *   - --no-jev 仅安装 21 个中文技能；--strict 控制新配置 strict 默认值；
 *   - 同名技能/区块零覆盖仅补缺，非本包管理的内容只 WARN 不动（任务 7 再做
 *     preflight、来源识别、备份接管与事务）；
 *   - 卸载兼容精确清理旧 superpowers-zh 哨兵段（迁移支持）。
 *
 * 共同方法论上游（鸣谢）：
 *   - obra/superpowers            https://github.com/obra/superpowers
 *   - jnMetaCode/superpowers-zh   https://github.com/jnMetaCode/superpowers-zh
 *   - AkashPriyadarshii/jev-superpowers（门禁技能来源）
 *
 * SPDX-License-Identifier: MIT
 */

import {
  existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync,
  copyFileSync, lstatSync, realpathSync, rmSync, chmodSync, renameSync,
} from 'node:fs';
import { resolve, dirname, join, sep, basename, isAbsolute } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { homedir, tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';

// 手动递归复制：跨 Node 版本和操作系统行为一致。
// 不使用 cpSync —— 在 Windows + npx 缓存（含 junction）下不稳定（沿用基座经验）。
// POSIX 上保留源文件 mode（脚本可执行位）；Windows chmod 仅影响只读位，尽力而为。
function copyDirSync(src, dest) {
  // 解析 junction/symlink，避免 Windows npx 缓存路径下 readdir 返回空
  let realSrc = src;
  try { realSrc = realpathSync(src); } catch {}

  mkdirSync(dest, { recursive: true });
  const entries = readdirSync(realSrc, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '.DS_Store') continue;
    const srcPath = join(realSrc, entry.name);
    const destPath = join(dest, entry.name);
    let stat;
    try { stat = lstatSync(srcPath); } catch { continue; }
    if (stat.isSymbolicLink()) {
      // 取消引用后按实际类型处理
      try {
        const real = realpathSync(srcPath);
        const realStat = lstatSync(real);
        if (realStat.isDirectory()) copyDirSync(real, destPath);
        else copyFileWithMode(real, destPath, realStat);
      } catch {}
    } else if (stat.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else if (stat.isFile()) {
      copyFileWithMode(srcPath, destPath, stat);
    }
  }
}

function copyFileWithMode(srcPath, destPath, srcStat) {
  copyFileSync(srcPath, destPath);
  let stat = srcStat;
  if (!stat) {
    try { stat = lstatSync(srcPath); } catch { return; }
  }
  try {
    const mode = stat.mode & 0o777;
    if (mode) chmodSync(destPath, mode);
  } catch {
    // Windows：chmod 只能切换只读位，可执行位不被文件系统跟踪——忽略。
  }
}

// 原子写：同目录 crypto 随机临时文件写完整后 rename 覆盖。零第三方依赖；
// 任一步失败都清理临时文件并抛出，避免半成品被读者看到或留下 *.tmp 残留。
// 覆盖既有文件时保留其权限位（POSIX 可执行位等）。
function atomicWriteFileSync(filePath, data) {
  const dir = dirname(filePath);
  const tmp = join(dir, `.${basename(filePath)}.${randomBytes(8).toString('hex')}.tmp`);
  try {
    writeFileSync(tmp, data);
    try {
      const st = lstatSync(filePath);
      if (st.isFile()) chmodSync(tmp, st.mode & 0o777);
    } catch {
      // 目标原本不存在：沿用进程 umask 下的默认权限即可。
    }
    renameSync(tmp, filePath);
  } catch (err) {
    try { rmSync(tmp, { force: true }); } catch {}
    throw err;
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PKG = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf8'));
const SKILLS_SRC = resolve(__dirname, '..', 'skills');
const HOOKS_SRC = resolve(__dirname, '..', 'hooks');
const SCRIPTS_SRC = resolve(__dirname, '..', 'scripts');
const PROJECT_DIR = process.cwd();

// 历史遗留 agent 文件名 —— 用于 --uninstall 清理已装用户机器上的旧版残留
// （superpowers-zh v1.2.x 曾安装 code-reviewer.md）。
const LEGACY_AGENT_FILENAMES = ['code-reviewer.md'];

// 每个工具：项目级 dir（相对 cwd）+ 可选 global 配置。
// global 存在 = 该工具有稳定的「用户级 skills 目录」，可全局安装（所有项目共享）：
//   global.dir     用户级 skills 目录（相对 home）
//   global.detect  home 下用于自动检测该工具是否安装的标记目录
// hooks 为 jevzh 新增能力字段：该工具支持 SessionStart/PreToolUse/Stop 钩子接线时，
//   给出钩子运行时落位目录（spec §5.4：仅 Claude Code、Cursor；其余 24 款只装技能）。
const TARGETS = [
  { name: 'Claude Code',   dir: '.claude/skills',           detect: '.claude',                        hooks: '.claude/hooks', global: { dir: '.claude/skills',         detect: '.claude' } },
  // Cursor 经官方文档核实（cursor.com/docs/skills）：.cursor/skills/<name>/SKILL.md。
  { name: 'Cursor',        dir: '.cursor/skills',           detect: ['.cursor', '.cursorrules'],     hooks: '.cursor/hooks' },
  // Codex 扫的是 .agents/skills，从不扫 .codex/skills；与 Antigravity 共用是开放约定。
  { name: 'Codex CLI',     dir: '.agents/skills',           detect: '.codex',                         global: { dir: '.agents/skills',         detect: '.codex' } },
  // Kiro steering 每轮常驻，skills 放 .kiro/skills/ 按需读，steering 只放索引。
  { name: 'Kiro',          dir: '.kiro/skills',              detect: '.kiro' },
  // DeerFlow 自动扫描 skills/public 与 skills/custom；custom 默认 gitignore。
  { name: 'DeerFlow',      dir: 'skills/custom',             detect: ['skills/public', 'deer_flow'] },
  // Trae 国际版/国内版项目级路径相同（.trae/skills）；全局只有国内版有据，单列 TRAE CN。
  { name: 'Trae',          dir: '.trae/skills',              detect: '.trae' },
  { name: 'TRAE CN',       dir: null,                        detect: [],                                editionOf: 'Trae', global: { dir: '.trae-cn/skills',        detect: '.trae-cn' },
    noProjectReason: `        TRAE CN 的项目级技能目录与国际版 TRAE 相同（.trae/skills/），
        已经由 Trae 这一条覆盖，请直接用：
          npx jevzh --tool trae
        本条目只用于 TRAE CN 独有的**全局**目录（~/.trae-cn/skills）。` },
  { name: 'Antigravity',   dir: '.agents/skills',            detect: '.agents' },
  // VS Code Copilot 自动读 .github/instructions/*.instructions.md（applyTo: "**"）。
  { name: 'VS Code',       dir: '.github/superpowers',       detect: ['.github/copilot-instructions.md', '.github/instructions'] },
  { name: 'OpenClaw',      dir: 'skills',                     detect: '.openclaw',                     global: { dir: '.openclaw/skills',       detect: '.openclaw' } },
  // Windsurf 用户级目录是 ~/.codeium/windsurf/skills（不是 ~/.windsurf/skills）。
  { name: 'Windsurf',      dir: '.windsurf/skills',          detect: '.windsurf',                      global: { dir: '.codeium/windsurf/skills', detect: '.codeium' } },
  // Gemini 全局走扩展目录，通用 --global 覆盖不了，只做项目级。
  { name: 'Gemini CLI',    dir: '.gemini/skills',            detect: 'GEMINI.md' },
  // Aider 不创建 .aider/，留下 .aider. 前缀产物；CONVENTIONS.md 需 --read 才加载。
  { name: 'Aider',         dir: '.aider/skills',             detect: ['.aider.conf.yml', '.aider.chat.history.md', '.aider.tags.cache.v3', '.aider'] },
  // OpenCode 项目 .opencode/skills，全局 ~/.config/opencode/skills，自动发现。
  { name: 'OpenCode',      dir: '.opencode/skills',          detect: '.opencode',                      global: { dir: '.config/opencode/skills', detect: '.config/opencode' } },
  // Qwen Code = QwenLM/qwen-code（Gemini CLI 的 fork），不是通义灵码。
  { name: 'Qwen Code',     dir: '.qwen/skills',             detect: '.qwen',                           global: { dir: '.qwen/skills',           detect: '.qwen' } },
  // Hermes 只自动加载 ~/.hermes/skills；项目级需在 config.yaml 登记 external_dirs。
  { name: 'Hermes Agent',  dir: '.hermes/skills',            detect: ['.hermes', 'HERMES.md', '.hermes.md'], global: { dir: '.hermes/skills',         detect: '.hermes' } },
  // Claw Code 技能目录 .claw/skills；根指令 CLAUDE.md > CLAW.md > AGENTS.md。
  { name: 'Claw Code',     dir: '.claw/skills',              detect: ['.claw', 'CLAW.md'] },
  { name: 'Qoder',         dir: '.qoder/skills',             detect: '.qoder',                         global: { dir: '.qoder/skills',          detect: '.qoder' } },
  // CodeBuddy 全局与项目级同构：~/.codebuddy/skills 与 .codebuddy/skills。
  { name: 'CodeBuddy',     dir: '.codebuddy/skills',         detect: ['.codebuddy', 'CODEBUDDY.md'], global: { dir: '.codebuddy/skills',      detect: '.codebuddy' } },
  // 华为云码道 CodeArts Doer：~/.codeartsdoer/skills 与 ./.codeartsdoer/skills。
  { name: 'CodeArts',      dir: '.codeartsdoer/skills',      detect: '.codeartsdoer', global: { dir: '.codeartsdoer/skills',   detect: '.codeartsdoer' } },
  // Reasonix Windows 全局在 %APPDATA%\reasonix（dirWin），Unix 在 ~/.reasonix。
  { name: 'Reasonix',      dir: '.reasonix/skills',          detect: ['.reasonix', 'reasonix.toml'],    global: { dir: '.reasonix/skills',       dirWin: 'AppData/Roaming/reasonix/skills', detect: '.reasonix' } },
  // DeepSeek Harness（dsh）：项目 .dsh/skills，全局 ~/.dsh/skills。
  { name: 'DeepSeek Harness', dir: '.dsh/skills',              detect: ['.dsh', 'dsh.json'],              global: { dir: '.dsh/skills',            detect: '.dsh' } },
  // ZCode 只有全局路径有官方出处（~/.zcode/skills），项目级不暴露磁盘路径。
  { name: 'ZCode',         dir: null,                        detect: [],                                global: { dir: '.zcode/skills',          detect: '.zcode' } },
  // Crush 项目 .crush/skills；Windows 全局 %LOCALAPPDATA%\crush\skills。
  { name: 'Crush',         dir: '.crush/skills',             detect: ['.crush', 'crush.json', '.crush.json'], global: { dir: '.config/crush/skills', dirWin: 'AppData/Local/crush/skills', detect: '.config/crush' } },
  // Cline / Kilo Code 加载 rules（每轮常驻），skills 放各自 skills/，rules 只放索引。
  { name: 'Cline',         dir: '.cline/skills',             detect: '.clinerules' },
  { name: 'Kilo Code',     dir: '.kilocode/skills',          detect: ['.kilocode', '.kilo', 'kilo.jsonc'] },
];

// 全局 skills 目录：少数工具在 Windows 上不走 ~/ 下的同名路径（dirWin）。
// dirWin 形如 'AppData/Roaming/<app>/...'（Roaming 类）或 'AppData/Local/<app>/...'
// （Local 类）：优先用进程环境里的 APPDATA / LOCALAPPDATA（组策略/重定向可能把它们
// 指到 USERPROFILE 之外），缺失才回退 ~/AppData/Roaming|/Local。返回绝对路径；
// 调用方 resolve(baseDir, abs) 在 Windows/POSIX 都原样取该绝对路径。
function globalRelDir(target) {
  const g = target.global;
  if (!g) return null;
  if (process.platform === 'win32' && g.dirWin) {
    const roaming = /^AppData[\\/]Roaming[\\/](.+)$/i.exec(g.dirWin);
    if (roaming) {
      const base = process.env.APPDATA || resolve(homedir(), 'AppData', 'Roaming');
      return resolve(base, roaming[1]);
    }
    const local = /^AppData[\\/]Local[\\/](.+)$/i.exec(g.dirWin);
    if (local) {
      const base = process.env.LOCALAPPDATA || resolve(homedir(), 'AppData', 'Local');
      return resolve(base, local[1]);
    }
    return g.dirWin;
  }
  return g.dir;
}

// S-7：全局 dirWin 目标（Reasonix/Crush）的技能根在 APPDATA/LOCALAPPDATA 被重定向到
// home 之外时，事务/护栏根必须切到该目标自己的文件根（dirWin 技能根的上一级，例如
// %APPDATA%/reasonix）；未重定向（仍在 home 下）或非 dirWin 目标则仍用 home。
function globalTargetFileBase(target, isGlobal, baseDir) {
  if (!isGlobal) return baseDir;
  const gAbs = globalRelDir(target);
  if (gAbs && isAbsolute(gAbs) && !isInsideDir(baseDir, gAbs)) return resolve(gAbs, '..');
  return baseDir;
}

// restore：按 manifest 条目所属 target 把 relPath 解析回当前环境的绝对路径。
// 重定向环境产生的备份（rel 形如 skills/brainstorming/...）落在 dirWin 文件根；
// 普通条目仍相对 home/baseDir。
function restoreEntryAbs(baseDir, targetName, rel) {
  const homeAbs = resolve(baseDir, rel);
  if (isInsideDir(baseDir, homeAbs)) return homeAbs;
  const t = TARGETS.find(x => x.name === targetName);
  if (t && t.global && process.platform === 'win32' && t.global.dirWin) {
    const gAbs = globalRelDir(t);
    if (gAbs && isAbsolute(gAbs)) {
      const root = resolve(gAbs, '..');
      const cand = resolve(root, rel);
      if (isInsideDir(root, cand)) return cand;
    }
  }
  return homeAbs;
}

function countDirs(dir) {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory()).length;
}

function scanSkillEntries(skillsDir, names = null) {
  const allow = names === null ? null : new Set(names);
  const entries = [];
  if (!existsSync(skillsDir)) return entries;
  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (allow && !allow.has(entry.name)) continue;
    const skillFile = resolve(skillsDir, entry.name, 'SKILL.md');
    if (!existsSync(skillFile)) continue;
    const content = readFileSync(skillFile, 'utf8');
    const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!fmMatch) continue;
    const nameMatch = fmMatch[1].match(/^name:\s*(.+)$/m);
    const descMatch = fmMatch[1].match(/^description:\s*["']?(.+?)["']?\s*$/m);
    if (nameMatch) {
      entries.push({
        name: nameMatch[1].trim(),
        desc: descMatch ? descMatch[1].trim() : '',
      });
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------
// 技能集合：默认 27（21 中文 + 6 jev-*），--no-jev 时 21（排除 jev-* 前缀）
// ---------------------------------------------------------------------------
function listSourceSkillNames() {
  return readdirSync(SKILLS_SRC, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .sort();
}

function selectedSkillNames(noJev) {
  const all = listSourceSkillNames();
  return noJev ? all.filter(n => !n.startsWith('jev-')) : all;
}

// ---------------------------------------------------------------------------
// 哨兵：jevzh 成对标记（自 v0.1.0 起）。旧 superpowers-zh 哨兵仅用于卸载时
// 精确识别/清理（迁移支持），安装时绝不写入。
// ---------------------------------------------------------------------------
const SENTINEL_BEGIN = '<!-- jev-superpowers-zh:begin (do not edit between these markers) -->';
const SENTINEL_END = '<!-- jev-superpowers-zh:end -->';
const ZH_SENTINEL_BEGIN = '<!-- superpowers-zh:begin (do not edit between these markers) -->';
const ZH_SENTINEL_END = '<!-- superpowers-zh:end -->';

// 旧版 zh bootstrap 的固定标题（v1.1.x 无哨兵）与段尾兜底短语。
const ZH_SECTION_MARKERS = [
  '# Superpowers-ZH 中文增强版',
  '# Superpowers-ZH 工作方法论',
];
const FALLBACK_TAIL_HINTS = [
  '你必须调用该 skill 检查。',
  '严格遵循其流程。',
];

// 其他发行版（superpowers-zh / jev-superpowers）占用同一 bootstrap 文件的特征。
// obra 无哨兵无固定标记，任务 7 preflight 再做短语级识别；任务 6 只覆盖可精确
// 判定的 zh / jev 痕迹，命中即 WARN 不动。
function containsCompetitorSection(text) {
  if (text.includes(ZH_SENTINEL_BEGIN) || text.includes(ZH_SENTINEL_END)) return true;
  if (ZH_SECTION_MARKERS.some(m => text.includes(m))) return true;
  if (text.includes('superpowers-zh')) return true;
  if (text.includes('jev-using-superpowers') || text.includes('TypeSafe Jev')) return true;
  return false;
}

function wrapWithSentinel(body) {
  return `${SENTINEL_BEGIN}\n${body.replace(/\n+$/, '')}\n${SENTINEL_END}\n`;
}

// 默认模式下追加到每份 bootstrap 的门禁路由入口；--no-jev 时为空。
function routerLine(noJev) {
  if (noJev) return '';
  return [
    '',
    '> **统一入口**：会话开始先加载 **jev-using-superpowers** 技能（27 技能路由 +',
    '> jev 门禁软降级）；门禁工具或后端缺失时自动转标准中文技能，方法论始终可用。',
    '',
  ].join('\n');
}

function skillTableFor(noJev) {
  const entries = scanSkillEntries(SKILLS_SRC, selectedSkillNames(noJev));
  return entries.map(s => `| ${s.name} | ${s.desc} |`).join('\n');
}

function skillListFor(noJev) {
  const entries = scanSkillEntries(SKILLS_SRC, selectedSkillNames(noJev));
  return entries.map(s => `- **${s.name}**: ${s.desc}`).join('\n');
}

function skillCount(noJev) {
  return selectedSkillNames(noJev).length;
}

// 往用户共享文件追加本包哨兵区块（事务感知）：
//   - 已有同 target 本包区块 -> 幂等跳过；
//   - 竞品旧段 -> 默认备份整文件后精确切除并写入本包成对哨兵（MIGRATE）；
//     --keep-router 时保留不动（WARN）；
//   - 悬空 begin（无配对 end）-> WARN，不接管不追加；
//   - 多 target 共享文件（S-9）：顺序追加带 target 属性的成对区块。
// 无活动事务时（不应出现的直调路径）退回任务 6 的保守「WARN 不动」行为。
function appendSentinelSection(filePath, content, label) {
  if (ACTIVE_TX) {
    ACTIVE_TX.appendShared(filePath, content, label);
    return;
  }
  mkdirSync(dirname(filePath), { recursive: true });
  if (existsSync(filePath)) {
    const existing = readFileSync(filePath, 'utf8');
    if (existing.match(OUR_BEGIN_RE)) {
      console.log(`  ✅ ${label}: 已包含 jevzh 引导区块，跳过 -> ${filePath}`);
      return;
    }
    if (containsCompetitorSection(existing)) {
      console.warn(`  ⚠️ WARN ${label}: ${filePath} 已含其他发行版（superpowers-zh / jev）的引导区块，本次保留不动。`);
      return;
    }
    atomicWriteFileSync(filePath, existing.replace(/\s+$/, '') + '\n\n' + wrapWithSentinel(content));
  } else {
    atomicWriteFileSync(filePath, wrapWithSentinel(content));
  }
}

// 独立规则文件（文件名带 jevzh 品牌，天然不与旧 zh 文件冲突）。
// 默认备份后移除旧 superpowers-zh 同名机制文件（MIGRATE）；--keep-router 保留双份。
function writeStandaloneRule(filePath, content, label, legacyZhPath) {
  if (ACTIVE_TX) {
    ACTIVE_TX.writeStandalone(filePath, content, label, legacyZhPath);
    return;
  }
  mkdirSync(dirname(filePath), { recursive: true });
  atomicWriteFileSync(filePath, content);
  if (legacyZhPath && existsSync(legacyZhPath)) {
    console.warn(`  ⚠️ WARN ${label}: 检测到旧 superpowers-zh 规则文件 ${legacyZhPath}，已保留不动。`);
  }
}

function generateTraeBootstrapRule(projectDir, opts) {
  const noJev = !!opts.noJev;
  const rulesDir = resolve(projectDir, '.trae', 'rules');
  const rule = `---
alwaysApply: true
---

# jev-superpowers-zh 中文增强版

你已加载 jev-superpowers-zh 技能框架（${skillCount(noJev)} 个 skills）。
${routerLine(noJev)}
## 核心规则

1. **收到任务时，先检查是否有匹配的 skill** — 哪怕只有 1% 的可能性也要检查
2. **设计先于编码** — 收到功能需求时，先用 brainstorming skill 做需求分析
3. **测试先于实现** — 写代码前先写测试（TDD）
4. **验证先于完成** — 声称完成前必须运行验证命令

## 可用 Skills

Skills 位于 \`.trae/skills/\` 目录，每个 skill 有独立的 \`SKILL.md\` 文件。

| Skill | 触发条件 |
|-------|---------|
${skillTableFor(noJev)}

## 如何使用

当任务匹配某个 skill 的触发条件时，读取对应的 \`.trae/skills/<skill-name>/SKILL.md\` 并严格遵循其流程。
`;
  writeStandaloneRule(
    resolve(rulesDir, 'jevzh.md'), rule, 'Trae',
    resolve(rulesDir, 'superpowers-zh.md'),
  );
}

function generateClineBootstrapRule(projectDir, opts) {
  const noJev = !!opts.noJev;
  const rulesDir = resolve(projectDir, '.clinerules');
  const rule = `# jev-superpowers-zh 中文增强版

你已加载 jev-superpowers-zh 技能框架（${skillCount(noJev)} 个 skills）。
${routerLine(noJev)}
## 核心规则

1. **收到任务时，先检查是否有匹配的 skill** — 哪怕只有 1% 的可能性也要检查
2. **设计先于编码** — 收到功能需求时，先用 brainstorming skill 做需求分析
3. **测试先于实现** — 写代码前先写测试（TDD）
4. **验证先于完成** — 声称完成前必须运行验证命令

## 可用 Skills

Skills 位于 \`.cline/skills/\` 目录，每个 skill 有独立的 \`SKILL.md\` 文件。

| Skill | 触发条件 |
|-------|---------|
${skillTableFor(noJev)}

## 如何使用

当任务匹配某个 skill 的触发条件时，用读文件工具打开对应的
\`.cline/skills/<skill-name>/SKILL.md\`，并严格遵循其流程。

**不要**把 skill 正文复制到本文件 —— \`.clinerules/\` 里的内容每轮都进 prompt，
按需读取才能把常驻开销控制在这张索引表。
`;
  writeStandaloneRule(
    resolve(rulesDir, 'jevzh.md'), rule, 'Cline',
    resolve(rulesDir, 'superpowers-zh.md'),
  );
}

function generateKiroSteeringIndex(projectDir, opts) {
  const noJev = !!opts.noJev;
  const steeringDir = resolve(projectDir, '.kiro', 'steering');
  // 注意：基座会在此清理 v1.7.9 旧布局（.kiro/steering/<skill>/）。jevzh 视其为
  // superpowers-zh 管理的竞品内容，任务 6 不删不动（任务 7 迁移时处理）。
  const rule = `---
inclusion: always
---

# jev-superpowers-zh 中文增强版

你已加载 jev-superpowers-zh 技能框架（${skillCount(noJev)} 个 skills）。
${routerLine(noJev)}
## 核心规则

1. **收到任务时，先检查是否有匹配的 skill** — 哪怕只有 1% 的可能性也要检查
2. **设计先于编码** — 收到功能需求时，先用 brainstorming skill 做需求分析
3. **测试先于实现** — 写代码前先写测试（TDD）
4. **验证先于完成** — 声称完成前必须运行验证命令

## 可用 Skills

Skills 位于 \`.kiro/skills/\` 目录，每个 skill 有独立的 \`SKILL.md\` 文件。

| Skill | 触发条件 |
|-------|---------|
${skillTableFor(noJev)}

## 如何使用

当任务匹配某个 skill 的触发条件时，用读文件工具打开对应的
\`.kiro/skills/<skill-name>/SKILL.md\`，并严格遵循其流程。

**不要**把 skill 正文复制到本文件 —— \`.kiro/steering/\` 里的内容每轮都进 prompt，
按需读取才能把常驻开销控制在这张索引表。
`;
  writeStandaloneRule(
    resolve(steeringDir, 'jevzh.md'), rule, 'Kiro',
    resolve(steeringDir, 'superpowers-zh.md'),
  );
}

function generateKiloCodeBootstrapRule(projectDir, opts) {
  const noJev = !!opts.noJev;
  const rulesDir = resolve(projectDir, '.kilocode', 'rules');
  const rule = `# jev-superpowers-zh 中文增强版

你已加载 jev-superpowers-zh 技能框架（${skillCount(noJev)} 个 skills）。
${routerLine(noJev)}
## 核心规则

1. **收到任务时，先检查是否有匹配的 skill** — 哪怕只有 1% 的可能性也要检查
2. **设计先于编码** — 收到功能需求时，先用 brainstorming skill 做需求分析
3. **测试先于实现** — 写代码前先写测试（TDD）
4. **验证先于完成** — 声称完成前必须运行验证命令

## 可用 Skills

Skills 位于 \`.kilocode/skills/\` 目录，每个 skill 有独立的 \`SKILL.md\` 文件。

| Skill | 触发条件 |
|-------|---------|
${skillTableFor(noJev)}

## 如何使用

当任务匹配某个 skill 的触发条件时，用读文件工具打开对应的
\`.kilocode/skills/<skill-name>/SKILL.md\`，并严格遵循其流程。

**不要**把 skill 正文复制到本文件 —— rules 每轮都进 prompt，按需读取才能把
常驻开销控制在这张索引表。
`;
  writeStandaloneRule(
    resolve(rulesDir, 'jevzh.md'), rule, 'Kilo Code',
    resolve(rulesDir, 'superpowers-zh.md'),
  );
}

function generateQoderBootstrap(baseDir, isGlobal, opts) {
  const noJev = !!opts.noJev;
  const rulesDir = resolve(baseDir, '.qoder', 'rules');
  const scope = isGlobal ? '你已全局加载 jev-superpowers-zh 技能框架，所有项目共享' : '你已加载 jev-superpowers-zh 技能框架';
  const skillsRef = isGlobal ? '~/.qoder/skills/' : '.qoder/skills/';
  const rule = `---
trigger: always_on
alwaysApply: true
---

# jev-superpowers-zh 中文增强版

${scope}（${skillCount(noJev)} 个 skills）。
${routerLine(noJev)}
## 核心规则

1. **收到任务时，先检查是否有匹配的 skill** — 哪怕只有 1% 的可能性也要检查
2. **设计先于编码** — 收到功能需求时，先用 brainstorming skill 做需求分析
3. **测试先于实现** — 写代码前先写测试（TDD）
4. **验证先于完成** — 声称完成前必须运行验证命令

## 可用 Skills

Skills 位于 \`${skillsRef}\` 目录，每个 skill 有独立的 \`SKILL.md\` 文件。

| Skill | 触发条件 |
|-------|---------|
${skillTableFor(noJev)}

## 如何使用

当任务匹配某个 skill 的触发条件时，读取对应的 \`${skillsRef}<skill-name>/SKILL.md\` 并严格遵循其流程。也可输入 \`/<skill-name>\` 显式调用。
`;
  writeStandaloneRule(
    resolve(rulesDir, 'jevzh.md'), rule, 'Qoder',
    resolve(rulesDir, 'superpowers-zh.md'),
  );
}

function generateAntigravityBootstrap(baseDir, isGlobal, opts) {
  const noJev = !!opts.noJev;
  const scope = isGlobal ? '已全局安装 jev-superpowers-zh 技能框架，所有项目共享' : '本项目已安装 jev-superpowers-zh 技能框架';
  const skillsRef = isGlobal ? '~/.agents/skills/' : '.agents/skills/';
  const content = `# jev-superpowers-zh 中文增强版

${scope}（${skillCount(noJev)} 个 skills）。
${routerLine(noJev)}
## 核心规则

1. **收到任务时，先检查是否有匹配的 skill** — 哪怕只有 1% 的可能性也要检查
2. **设计先于编码** — 收到功能需求时，先用 brainstorming skill 做需求分析
3. **测试先于实现** — 写代码前先写测试（TDD）
4. **验证先于完成** — 声称完成前必须运行验证命令

## 可用 Skills

Skills 位于 \`${skillsRef}\` 目录，每个 skill 有独立的 \`SKILL.md\` 文件。

${skillListFor(noJev)}

## 如何使用

当任务匹配某个 skill 时，读取对应的 \`${skillsRef}<skill-name>/SKILL.md\` 并严格遵循其流程。
`;
  // 基座曾整体覆写 .agents/rules.md（会丢用户内容）；jevzh 改为哨兵追加。
  appendSentinelSection(resolve(baseDir, '.agents', 'rules.md'), content, 'Antigravity');
}

function generateAiderBootstrap(projectDir, opts) {
  const noJev = !!opts.noJev;
  const content = `# jev-superpowers-zh 工作方法论

本项目使用 jev-superpowers-zh 技能框架（${skillCount(noJev)} 个 skills）。
${routerLine(noJev)}
## 核心规则

1. **收到任务时，先检查是否有匹配的 skill** — 哪怕只有 1% 的可能性也要检查
2. **设计先于编码** — 收到功能需求时，先用 brainstorming skill 做需求分析
3. **测试先于实现** — 写代码前先写测试（TDD）
4. **验证先于完成** — 声称完成前必须运行验证命令

## 可用 Skills

Skills 位于 \`.aider/skills/\` 目录，每个 skill 有独立的 \`SKILL.md\` 文件。

${skillListFor(noJev)}

## 如何使用

当任务匹配某个 skill 时，读取对应的 \`.aider/skills/<skill-name>/SKILL.md\` 并严格遵循其流程。
`;
  appendSentinelSection(resolve(projectDir, 'CONVENTIONS.md'), content, 'Aider');

  // 激活提示。不替用户改 .aider.conf.yml —— 那是他们的配置文件。
  console.log('');
  console.log('  ⚠️  Aider 不会自动加载 CONVENTIONS.md，还需一步才生效：');
  console.log('');
  console.log('     每次启动时带上：');
  console.log('        aider --read CONVENTIONS.md');
  console.log('');
  console.log('     或写进 .aider.conf.yml 一劳永逸：');
  console.log('');
  console.log('        read: CONVENTIONS.md');
  console.log('');
}

function genericBootstrapContent({ title, scope, skillsRef, noJev, extra = '' }) {
  return `# jev-superpowers-zh 中文增强版

${scope}（${skillCount(noJev)} 个 skills）。
${routerLine(noJev)}
## 核心规则

1. **收到任务时，先检查是否有匹配的 skill** — 哪怕只有 1% 的可能性也要检查
2. **设计先于编码** — 收到功能需求时，先用 brainstorming skill 做需求分析
3. **测试先于实现** — 写代码前先写测试（TDD）
4. **验证先于完成** — 声称完成前必须运行验证命令

## 可用 Skills

Skills 位于 \`${skillsRef}\` 目录，每个 skill 有独立的 \`SKILL.md\` 文件。

${skillListFor(noJev)}
${extra}
## 如何使用

当任务匹配某个 skill 时，读取对应的 \`${skillsRef}<skill-name>/SKILL.md\` 并严格遵循其流程。
`;
}

function generateGeminiBootstrap(baseDir, isGlobal, opts) {
  const scope = isGlobal ? '已全局安装 jev-superpowers-zh 技能框架，所有项目共享' : '本项目已安装 jev-superpowers-zh 技能框架';
  const skillsRef = isGlobal ? '~/.gemini/skills/' : '.gemini/skills/';
  const content = genericBootstrapContent({ scope, skillsRef, noJev: !!opts.noJev });
  const geminiPath = isGlobal ? resolve(baseDir, '.gemini', 'GEMINI.md') : resolve(baseDir, 'GEMINI.md');
  appendSentinelSection(geminiPath, content, 'Gemini CLI');
}

function generateQwenBootstrap(baseDir, isGlobal, opts) {
  const scope = isGlobal ? '已全局安装 jev-superpowers-zh 技能框架，所有项目共享' : '本项目已安装 jev-superpowers-zh 技能框架';
  const skillsRef = isGlobal ? '~/.qwen/skills/' : '.qwen/skills/';
  const content = genericBootstrapContent({ scope, skillsRef, noJev: !!opts.noJev });
  const qwenPath = isGlobal ? resolve(baseDir, '.qwen', 'QWEN.md') : resolve(baseDir, 'QWEN.md');
  appendSentinelSection(qwenPath, content, 'Qwen Code');
}

function generateVSCodeBootstrap(projectDir, opts) {
  const noJev = !!opts.noJev;
  const instrDir = resolve(projectDir, '.github', 'instructions');
  const rule = `---
applyTo: "**"
name: jev-superpowers-zh
description: jev-superpowers-zh 技能框架的索引与触发规则
---

# jev-superpowers-zh 中文增强版

本项目已安装 jev-superpowers-zh 技能框架（${skillCount(noJev)} 个 skills）。
${routerLine(noJev)}
## 核心规则

1. **收到任务时，先检查是否有匹配的 skill** — 哪怕只有 1% 的可能性也要检查
2. **设计先于编码** — 收到功能需求时，先用 brainstorming skill 做需求分析
3. **测试先于实现** — 写代码前先写测试（TDD）
4. **验证先于完成** — 声称完成前必须运行验证命令

## 可用 Skills

Skills 位于 \`.github/superpowers/\` 目录，每个 skill 有独立的 \`SKILL.md\` 文件。

| Skill | 触发条件 |
|-------|---------|
${skillTableFor(noJev)}

## 如何使用

当任务匹配某个 skill 的触发条件时，读取对应的
\`.github/superpowers/<skill-name>/SKILL.md\` 并严格遵循其流程。

**不要**把 skill 正文复制到本文件 —— 本文件对每个请求都生效，按需读取才能把
常驻开销控制在这张索引表。
`;
  writeStandaloneRule(
    resolve(instrDir, 'jevzh.instructions.md'), rule, 'VS Code',
    resolve(instrDir, 'superpowers-zh.instructions.md'),
  );
}

function generateClawBootstrap(projectDir, opts) {
  const content = genericBootstrapContent({
    scope: '本项目已安装 jev-superpowers-zh 技能框架',
    skillsRef: '.claw/skills/',
    noJev: !!opts.noJev,
  });
  appendSentinelSection(resolve(projectDir, 'CLAW.md'), content, 'Claw Code');

  // claw 的根指令文件优先级是 CLAUDE.md > CLAW.md。项目里若已有 CLAUDE.md，
  // 说清楚，别让人以为装了没生效。
  if (existsSync(resolve(projectDir, 'CLAUDE.md'))) {
    console.log('  ℹ️  检测到项目里已有 CLAUDE.md。claw 的根指令文件优先级是');
    console.log('     CLAUDE.md > CLAW.md > AGENTS.md，CLAUDE.md 可能压过刚写的 CLAW.md。');
    console.log('     如果 skill 不触发，跑一次 `npx jevzh --tool claude` 让 CLAUDE.md 也带上引导。');
  }
}

function generateHermesBootstrap(projectDir, isGlobal, opts) {
  // 全局安装不写 bootstrap：~/.hermes/skills 靠 name/description 被自动发现。
  if (isGlobal) {
    console.log('  ℹ️  Hermes 全局安装不写 bootstrap 文件（其用户级指令文件约定未证实）。');
    console.log('     skills 已在 ~/.hermes/skills/，可用 skills_list / skill_view 发现。');
    console.log('     想让它在项目里自动触发，在该项目跑一次项目级安装以生成 AGENTS.md。');
    return;
  }
  const noJev = !!opts.noJev;
  const content = `# jev-superpowers-zh 中文增强版

本项目已安装 jev-superpowers-zh 技能框架（${skillCount(noJev)} 个 skills）。
${routerLine(noJev)}
## 核心规则

1. **收到任务时，先检查是否有匹配的 skill** — 哪怕只有 1% 的可能性也要检查
2. **设计先于编码** — 收到功能需求时，先用 brainstorming skill 做需求分析
3. **测试先于实现** — 写代码前先写测试（TDD）
4. **验证先于完成** — 声称完成前必须运行验证命令

## 工具映射

技能中引用的 Claude Code 工具名称对应 Hermes Agent 的等价工具：
- \`Read\` → \`read_file\`
- \`Write\` → \`write_file\`
- \`Edit\` → \`patch\`
- \`Bash\` → \`terminal\`
- \`Grep\` / \`Glob\` → \`search_files\`
- \`Skill\` → \`skill_view\`
- \`Task\`（子智能体） → \`delegate_task\`
- \`WebSearch\` → \`web_search\`
- \`WebFetch\` → \`web_extract\`
- \`TodoWrite\` → \`todo\`

## 可用 Skills

Skills 位于 \`.hermes/skills/\` 目录，每个 skill 有独立的 \`SKILL.md\` 文件。

${skillListFor(noJev)}

## 如何使用

当任务匹配某个 skill 时，使用 \`skill_view\` 加载对应 skill 并严格遵循其流程。
`;
  appendSentinelSection(resolve(projectDir, 'AGENTS.md'), content, 'Hermes Agent');

  // 项目级安装 Hermes 认不到 —— 必须显式登记到 config.yaml（不替用户改配置）。
  const abs = resolve(projectDir, '.hermes', 'skills');
  console.log('');
  console.log('  ⚠️  Hermes 只自动扫描 ~/.hermes/skills/，不会发现项目级目录。');
  console.log('     二选一让它生效：');
  console.log('');
  console.log('     A) 改用全局安装（推荐，装完即生效）：');
  console.log('        npx jevzh --global --tool hermes');
  console.log('');
  console.log('     B) 保留项目级，把这段加进 ~/.hermes/config.yaml：');
  console.log('');
  console.log('        skills:');
  console.log('          external_dirs:');
  console.log(`            - ${abs}`);
  console.log('');
}

function generateClaudeCodeBootstrap(baseDir, isGlobal, opts) {
  const noJev = !!opts.noJev;
  const scope = isGlobal ? '已全局安装 jev-superpowers-zh 技能框架，所有项目共享' : '本项目已安装 jev-superpowers-zh 技能框架';
  const skillsRef = isGlobal ? '~/.claude/skills/' : '.claude/skills/';
  const content = `# jev-superpowers-zh 中文增强版

${scope}（${skillCount(noJev)} 个 skills）。
${routerLine(noJev)}
## 核心规则

1. **收到任务时，先检查是否有匹配的 skill** — 哪怕只有 1% 的可能性也要检查
2. **设计先于编码** — 收到功能需求时，先用 brainstorming skill 做需求分析
3. **测试先于实现** — 写代码前先写测试（TDD）
4. **验证先于完成** — 声称完成前必须运行验证命令

## 可用 Skills

Skills 位于 \`${skillsRef}\` 目录，每个 skill 有独立的 \`SKILL.md\` 文件。

${skillListFor(noJev)}

## 如何使用

当任务匹配某个 skill 时，使用 \`Skill\` 工具加载对应 skill 并严格遵循其流程。绝不要用 Read 工具读取 SKILL.md 文件。

如果你认为哪怕只有 1% 的可能性某个 skill 适用于你正在做的事情，你必须调用该 skill 检查。
`;
  const mdPath = isGlobal ? resolve(baseDir, '.claude', 'CLAUDE.md') : resolve(baseDir, 'CLAUDE.md');
  appendSentinelSection(mdPath, content, 'Claude Code');
}

function generateReasonixBootstrap(projectDir, opts) {
  const content = genericBootstrapContent({
    scope: '本项目已安装 jev-superpowers-zh 技能框架',
    skillsRef: '.reasonix/skills/',
    noJev: !!opts.noJev,
  });
  appendSentinelSection(resolve(projectDir, 'REASONIX.md'), content, 'Reasonix');
}

function generateDeepSeekHarnessBootstrap(baseDir, isGlobal, opts) {
  const scope = isGlobal ? '已全局安装 jev-superpowers-zh 技能框架，所有项目共享' : '本项目已安装 jev-superpowers-zh 技能框架';
  const skillsRef = isGlobal ? '~/.dsh/skills/' : '.dsh/skills/';
  const content = genericBootstrapContent({ scope, skillsRef, noJev: !!opts.noJev });
  const mdPath = isGlobal ? resolve(baseDir, '.dsh', 'AGENTS.md') : resolve(baseDir, 'AGENTS.md');
  appendSentinelSection(mdPath, content, 'DeepSeek Harness');
}

function generateCodeBuddyBootstrap(baseDir, isGlobal, opts) {
  const scope = isGlobal ? '已全局安装 jev-superpowers-zh 技能框架，所有项目共享' : '本项目已安装 jev-superpowers-zh 技能框架';
  const skillsRef = isGlobal ? '~/.codebuddy/skills/' : '.codebuddy/skills/';
  const content = genericBootstrapContent({ scope, skillsRef, noJev: !!opts.noJev });
  const mdPath = isGlobal ? resolve(baseDir, '.codebuddy', 'CODEBUDDY.md') : resolve(baseDir, 'CODEBUDDY.md');
  appendSentinelSection(mdPath, content, 'CodeBuddy');
}

// ---------------------------------------------------------------------------
// hooks 接线（spec §5.4：仅 Claude Code / Cursor；--no-jev 不接线）
// 任务 6 只把运行时落到目标目录（hooks 六文件 + scripts 三文件）；
// settings.json/.cursor/hooks.json 的读改写合并在任务 7 实现。
// ---------------------------------------------------------------------------
const HOOK_FILES = [
  'hooks.json', 'hooks-cursor.json', 'session-start', 'pre-commit', 'stop', 'run-hook.cmd',
];
const GATE_SCRIPT_FILES = ['jev-readiness', 'jev-gate', 'serve-laya.py'];

function filesEqual(a, b) {
  try {
    return readFileSync(a).equals(readFileSync(b));
  } catch {
    return false;
  }
}

// lstat 判定路径本身（不跟随）是否为符号链接；Windows junction 在 Node 下也报 true。
function isSymlinkPath(p) {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

// 只安装我们自己拥有、且目标处缺失或与源字节一致的文件；目标处存在但内容
// 不同的文件视为用户/他方内容，WARN 且不动。
// 返回 { installed, linkSkipped }：linkSkipped=true 表示容器本身是链接被整目录
// 跳过（调用方不得再当成功打印 ✅）。
function installOwnedFiles(srcDir, destDir, fileNames, label, onAdded = null) {
  if (ACTIVE_TX) ACTIVE_TX.ensureDir(destDir);
  else mkdirSync(destDir, { recursive: true });
  // 容器本身是链接（含 Windows junction）：写入会落到链接目标（可能在项目/家目录
  // 之外）——整目录跳过防穿越。
  if (isSymlinkPath(destDir)) {
    console.warn(`  ⚠️ WARN ${label}: 目标目录 ${destDir} 是符号链接/junction，为防目标侧穿越，`
      + '本次不向其写入任何文件（链接目标未触及）。');
    return { installed: 0, linkSkipped: true };
  }
  let installed = 0;
  for (const name of fileNames) {
    const src = resolve(srcDir, name);
    const dst = resolve(destDir, name);
    if (!existsSync(src)) continue;
    let dstStat;
    try { dstStat = lstatSync(dst); } catch { dstStat = null; }
    if (dstStat) {
      // 同名文件是链接：copyFileSync 会穿透写链接目标，必须跳过。
      if (dstStat.isSymbolicLink()) {
        console.warn(`  ⚠️ WARN ${label}: ${dst} 是符号链接/junction，为防穿越保留不动（链接目标未触及）。`);
        continue;
      }
      if (filesEqual(src, dst)) continue;
      console.warn(`  ⚠️ WARN ${label}: ${dst} 已存在且内容与本包不同，保留不动（零覆盖非本管文件）。`);
      continue;
    }
    let stat;
    try { stat = lstatSync(src); } catch { continue; }
    copyFileWithMode(src, dst, stat);
    if (typeof onAdded === 'function') onAdded(dst);
    installed++;
  }
  return { installed, linkSkipped: false };
}

// installHooksForTarget 的任务 7 事务化版本见文件后部（R-1 宿主过滤 + 事务跟踪）。

// ---------------------------------------------------------------------------
// .jevzh.json：项目根配置，首次生成，已存在绝不覆盖。字段契约与
// .jevzh.json.example / scripts/jev-readiness 解析口径一致。
// ---------------------------------------------------------------------------
function defaultConfig(strict) {
  return {
    backend: 'auto',
    strict: strict === true,
    baseUrl: 'http://127.0.0.1:8000',
    tools: {},
  };
}

function ensureProjectConfig(baseDir, strict) {
  const cfgPath = resolve(baseDir, '.jevzh.json');
  if (existsSync(cfgPath)) {
    let existingStrict;
    let parsed = true;
    try {
      existingStrict = JSON.parse(readFileSync(cfgPath, 'utf8')).strict;
    } catch {
      parsed = false;
      console.warn(`  ⚠️ WARN ${cfgPath} 不是合法 JSON（解析失败）：本次按默认配置在内存中取值运行，`
        + '且不会覆盖这个坏文件；请手工修复其 JSON 语法或删除后重跑安装。');
    }
    console.log(`  ℹ️  已存在 .jevzh.json：保留用户配置不覆盖（strict 等字段均取自既有文件`
      + `${parsed && existingStrict !== undefined ? `，当前 strict=${existingStrict}` : ''}；`
      + `本次${strict ? '的 --strict ' : ''}不改写它，可用 JEVZH_STRICT=1 临时开启严格模式）。`);
    return;
  }
  writeFileSync(cfgPath, JSON.stringify(defaultConfig(strict), null, 2) + '\n', 'utf8');
  console.log(`  ✅ 生成默认配置 -> ${cfgPath}（strict=${strict === true}；backend=auto，软降级开启）`);
}

// ---------------------------------------------------------------------------
// 技能安装：零覆盖仅补缺。目标同名目录：
//   - 含本包 .jevzh-meta.json -> 本包旧版（任务 6 跳过；任务 7 支持自升级覆盖）
//   - 否则 -> 用户/他方内容，WARN 且完全不动
// ---------------------------------------------------------------------------
function isOurManaged(skillDir) {
  try {
    const meta = JSON.parse(readFileSync(resolve(skillDir, '.jevzh-meta.json'), 'utf8'));
    return meta !== null && typeof meta === 'object' && meta.pkg === PKG.name;
  } catch {
    return false;
  }
}

// 目录完全为空（readdir 长度 0）才算空；任何文件/子目录（含 .gitkeep、
// .DS_Store）都视为非空。lstat/读失败按非空处理（保守，不擅自接管）。
function isDirEmpty(dir) {
  try {
    return lstatSync(dir).isDirectory() && readdirSync(dir).length === 0;
  } catch {
    return false;
  }
}

function writeSkillMeta(destSkillDir, target, isGlobal) {
  const meta = {
    pkg: PKG.name,
    version: PKG.version,
    date: new Date().toISOString().slice(0, 10),
    scope: isGlobal ? 'global' : 'project',
    target: target.name,
  };
  atomicWriteFileSync(resolve(destSkillDir, '.jevzh-meta.json'), JSON.stringify(meta, null, 2) + '\n');
}

// ===========================================================================
// 任务 7：共存预检（五级处置）、四来源识别、按目标事务、备份/轮转、
// doctor / restore、hooks settings 读改写合并。零第三方依赖。
// ===========================================================================

// --- 哨兵：本包 begin 支持 target="..." 归属属性（S-9 多目标共享文件区块共存）---
const OUR_BEGIN_PREFIX = '<!-- jev-superpowers-zh:begin (do not edit between these markers)';
const OUR_BEGIN_RE = /<!--\s*jev-superpowers-zh:begin\b[^>]*?-->/g;

function ourBeginMarker(targetName) {
  return targetName ? `${OUR_BEGIN_PREFIX} target="${targetName}" -->` : SENTINEL_BEGIN;
}

function wrapWithSentinelTarget(body, targetName) {
  return `${ourBeginMarker(targetName)}\n${String(body).replace(/\n+$/, '')}\n${SENTINEL_END}\n`;
}

function markerTargetName(markerText) {
  const m = /target="([^"]*)"/.exec(markerText);
  return m ? m[1] : null;
}

function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let n = 0;
  let i = haystack.indexOf(needle);
  while (i !== -1) { n++; i = haystack.indexOf(needle, i + needle.length); }
  return n;
}

// 成对哨兵切除（支持字符串或正则 begin、按 target 归属过滤）。
// 区间内再出现同目标 begin（嵌套/双 begin 单 end）-> malformed，整文件保留。
function cutPairedSections(content, beginLike, end, options = {}) {
  const onlyTarget = options.onlyTarget || null;
  // 单目标模式下，是否允许同时切除「无 target 属性的旧 begin」：
  // 仅当文件中不存在其他 target 的区块时为 true（旧 begin 是多 target 化之前的遗物，
  // 例如 CLAUDE.md 只可能属于 Claude）；S-9 那种多 target 共存文件不适用。
  const cutUntargeted = !!onlyTarget && !!options.cutUntargeted;
  const findBegin = (s, from) => {
    if (typeof beginLike === 'string') {
      const i = s.indexOf(beginLike, from);
      return i === -1 ? null : { index: i, text: beginLike };
    }
    const flags = (beginLike.flags || '').replace('g', '') + 'g';
    const re = new RegExp(beginLike.source, flags);
    re.lastIndex = from;
    const m = re.exec(s);
    return m ? { index: m.index, text: m[0] } : null;
  };

  let text = content;
  let cut = false;
  for (;;) {
    let cursor = 0;
    let b = null;
    for (;;) {
      const cand = findBegin(text, cursor);
      if (!cand) break;
      if (onlyTarget) {
        const tn = markerTargetName(cand.text);
        const matches = tn === onlyTarget || (cutUntargeted && tn === null);
        if (!matches) {
          cursor = cand.index + cand.text.length;
          continue;
        }
      }
      b = cand;
      break;
    }
    if (!b) break;
    const j = text.indexOf(end, b.index + b.text.length);
    if (j === -1) break;
    const inner = findBegin(text, b.index + b.text.length);
    if (inner && inner.index < j) {
      // 任何 begin 出现在当前 begin..end 之间都是嵌套/交叉（正常多区块必然顺序成对，
      // 无论同 target、其他 target 还是无属性旧 begin），一律畸形整文件保留。
      return { text: content, cut: false, malformed: true };
    }
    text = text.slice(0, b.index) + text.slice(j + end.length);
    cut = true;
  }
  return { text, cut, malformed: false };
}

// --- 四来源识别（ours / zh / jev / obra / unknown / empty）---
const CJK_RE = /[\u3400-\u9fff\uf900-\ufaff]/;
const FORK_MARK = '本节是 superpowers-zh 的增量内容';
const JEV_EN_FEATURES = ['TypeSafe Jev', 'Failure Modes', 'docs/CONFIDENCE.md'];

function readSkillBody(skillDir) {
  try {
    return readFileSync(resolve(skillDir, 'SKILL.md'), 'utf8');
  } catch {
    return null;
  }
}

function readSkillMeta(skillDir) {
  try {
    const m = JSON.parse(readFileSync(resolve(skillDir, '.jevzh-meta.json'), 'utf8'));
    return m && typeof m === 'object' ? m : null;
  } catch {
    return undefined; // undefined = 无/坏 meta；null = 有但非法
  }
}

// 正文分类（不含 meta 判断）。
function classifySkillText(text) {
  if (text == null) return null;
  // 1) 本包显式增量标记（本包 jev 技能均带此句）。
  if (text.includes('本节是 jev-superpowers-zh 的增量内容')) return 'ours';
  // 2) 英文 jev：TypeSafe 三特征且全文无 CJK 汉字——必须排在裸品牌串之前，
  //    因为英文 jev 文档可能在描述中提及 "jev-superpowers-zh"（不等于归属）。
  const hasJevFeature = JEV_EN_FEATURES.some(f => text.includes(f));
  if (hasJevFeature && !CJK_RE.test(text)) return 'jev';
  // 3) 本包品牌串（meta 之外的兜底品牌证据；走到这里的英文三特征文本已在 2 拦截）。
  if (text.includes(PKG.name)) return 'ours';
  // 4) 同源中文版：FORK_MARK / 旧哨兵 / superpowers-zh 品牌
  //    （词边界：不得把 jev-superpowers-zh 误算成旧中文版）。
  if (text.includes(FORK_MARK) || /(?<!jev-)superpowers-zh/.test(text)) return 'zh';
  // 5) obra：superpowers:<slug> 调用前缀
  if (/superpowers:[a-z]/i.test(text)) return 'obra';
  return null;
}

// 技能目录分类。返回 {source, version?, reason}。
// 入参既可能是目录路径（字符串），也可能是技能正文字符串：以「路径是否存在」区分——
// 存在则按目录（读 meta + SKILL.md），否则把字符串本身当正文分类。
function classifySkillSource(skillDirOrText) {
  let skillDir = null;
  if (typeof skillDirOrText === 'string') {
    try {
      if (existsSync(skillDirOrText)) skillDir = skillDirOrText;
    } catch { skillDir = null; }
    if (!skillDir) return { source: classifySkillText(skillDirOrText) || 'unknown' };
  } else {
    skillDir = skillDirOrText;
  }
  const meta = readSkillMeta(skillDir);
  if (meta && meta.pkg === PKG.name) return { source: 'ours', version: meta.version };
  if (meta && typeof meta.pkg === 'string' && meta.pkg) {
    // 有合法 meta 但 pkg 不匹配：不得被正文特征漂白
    return { source: 'unknown', reason: `meta.pkg=${meta.pkg}` };
  }
  const body = readSkillBody(skillDir);
  if (body == null || body.trim() === '') return { source: 'empty' };
  const byText = classifySkillText(body);
  if (byText === 'ours') return { source: 'ours' };
  if (byText) return { source: byText };
  return { source: 'unknown' };
}

function compareVersions(a, b) {
  const pa = String(a || '0.0.0').split('.').map(n => Number.parseInt(n, 10) || 0);
  const pb = String(b || '0.0.0').split('.').map(n => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

// --- 竞品插件启用记录检测（精确词边界，本包 jev-superpowers-zh 不得误判）---
const PLUGIN_COMPETITOR_PATTERNS = [
  { label: 'superpowers-zh', re: /(^|[^A-Za-z0-9-])superpowers-zh(?=$|[^A-Za-z0-9-])/i },
  { label: 'jev-superpowers（英文 jev 插件）', re: /(^|[^A-Za-z0-9-])jev-superpowers(?=$|[^A-Za-z0-9-])/i },
  { label: 'superpowers（obra 原版插件）', re: /(^|[^A-Za-z0-9-])superpowers(?=$|[^A-Za-z0-9-])/i },
];

function scanPluginCompetitors(baseDir, target) {
  const pluginDirs = target.name === 'Cursor' ? ['.cursor-plugin'] : ['.claude-plugin'];
  const hits = [];
  for (const d of pluginDirs) {
    const dir = resolve(baseDir, d);
    let ents;
    try { ents = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const ent of ents) {
      if (!ent.isFile() || !/\.json$/i.test(ent.name)) continue;
      let raw;
      try { raw = readFileSync(resolve(dir, ent.name), 'utf8'); } catch { continue; }
      for (const p of PLUGIN_COMPETITOR_PATTERNS) {
        if (p.re.test(raw) && !hits.some(h => h.file === `${d}/${ent.name}` && h.name === p.label)) {
          hits.push({ file: `${d}/${ent.name}`, name: p.label });
        }
      }
    }
  }
  return hits;
}

// --- 每个 target 的 router 描述符（与各 bootstrap 生成器路径严格一致）---
const ROUTER_DESCRIPTORS = {
  project: {
    'Claude Code': { shared: ['CLAUDE.md'] },
    'Gemini CLI': { shared: ['GEMINI.md'] },
    'Qwen Code': { shared: ['QWEN.md'] },
    'Claw Code': { shared: ['CLAW.md'] },
    'Aider': { shared: ['CONVENTIONS.md'] },
    'CodeBuddy': { shared: ['CODEBUDDY.md'] },
    'Hermes Agent': { shared: ['AGENTS.md'] },
    'DeepSeek Harness': { shared: ['AGENTS.md'] },
    'Antigravity': { shared: ['.agents/rules.md'] },
    'Reasonix': { shared: ['REASONIX.md'] },
    'Trae': { standalone: [{ oursRel: '.trae/rules/jevzh.md', legacyRel: '.trae/rules/superpowers-zh.md' }] },
    'Cline': { standalone: [{ oursRel: '.clinerules/jevzh.md', legacyRel: '.clinerules/superpowers-zh.md' }] },
    'Kilo Code': { standalone: [{ oursRel: '.kilocode/rules/jevzh.md', legacyRel: '.kilocode/rules/superpowers-zh.md' }] },
    'Kiro': { standalone: [{ oursRel: '.kiro/steering/jevzh.md', legacyRel: '.kiro/steering/superpowers-zh.md' }] },
    'Qoder': { standalone: [{ oursRel: '.qoder/rules/jevzh.md', legacyRel: '.qoder/rules/superpowers-zh.md' }] },
    'VS Code': { standalone: [{ oursRel: '.github/instructions/jevzh.instructions.md', legacyRel: '.github/instructions/superpowers-zh.instructions.md' }] },
  },
  global: {
    'Claude Code': { shared: ['.claude/CLAUDE.md'] },
    'Gemini CLI': { shared: ['.gemini/GEMINI.md'] },
    'Qwen Code': { shared: ['.qwen/QWEN.md'] },
    'CodeBuddy': { shared: ['.codebuddy/CODEBUDDY.md'] },
    'DeepSeek Harness': { shared: ['.dsh/AGENTS.md'] },
    'Qoder': { standalone: [{ oursRel: '.qoder/rules/jevzh.md', legacyRel: '.qoder/rules/superpowers-zh.md' }] },
  },
};

function routerDescriptor(target, isGlobal) {
  return (ROUTER_DESCRIPTORS[isGlobal ? 'global' : 'project'] || {})[target.name] || null;
}

// router 正文状态分析（悬空/本包区块/竞品痕迹）。
function analyzeRouterText(text) {
  const oursMarkers = [...text.matchAll(new RegExp(OUR_BEGIN_RE.source, 'g'))].map(m => m[0]);
  const oursBegin = oursMarkers.length;
  const oursEnd = countOccurrences(text, SENTINEL_END);
  const zhBegin = countOccurrences(text, ZH_SENTINEL_BEGIN);
  const zhEnd = countOccurrences(text, ZH_SENTINEL_END);
  // 竞品判定必须先剔除本包成对区块：区块内的技能表天然含有
  // jev-using-superpowers / TypeSafe Jev 等字样，不能据此判自己为竞品
  // （否则 S-9 多 target 共享文件时第二个 target 会被误挡、无法追加区块）。
  const stripped = cutPairedSections(text, OUR_BEGIN_RE, SENTINEL_END).text;
  return {
    oursBegin,
    oursEnd,
    danglingOurs: oursBegin !== oursEnd,
    zhBegin,
    zhEnd,
    danglingZh: zhBegin !== zhEnd,
    oursTargets: oursMarkers.map(markerTargetName),
    hasCompetitor: containsCompetitorSection(stripped)
      || /superpowers:[a-z]/i.test(stripped)
      || (stripped.includes('TypeSafe Jev') && !CJK_RE.test(stripped)),
  };
}

function installSkillsForTarget(target, baseDir, isGlobal, opts, plan = null, run = null) {
  const relDir = isGlobal ? globalRelDir(target) : target.dir;
  const dest = resolve(baseDir, relDir);
  const names = selectedSkillNames(opts.noJev);

  // R1：容器本身不存在、但其直接父目录本身是符号链接/junction（如企业环境把
  // .claude 整体重定向到共享盘/其他分区，容器 .claude/skills 尚不存在）：
  // mkdir -p 会在链接目标侧创建容器，安装随之写穿到表面路径之外。不阻断
  // （父级重定向是企业常见部署），仅在写盘前明确披露实际落点，请用户确认来源可信。
  // 注意：容器本身是链接仍由下方 I-1 硬处理（失败/跳过），本项只针对父级。
  let destStat;
  try { destStat = lstatSync(dest); } catch { destStat = null; }
  if (!destStat) {
    const parent = dirname(dest);
    let parentStat;
    try { parentStat = lstatSync(parent); } catch { parentStat = null; }
    if (parentStat && parentStat.isSymbolicLink()) {
      let realParent = parent;
      try { realParent = realpathSync(parent); } catch {}
      console.warn(`  ⚠️ WARN ${target.name}: 技能容器 ${dest} 尚不存在，但其直接父目录 ${parent} 是符号链接/junction，`
        + `新建的 skills/hooks 等文件将实际写入链接目标 ${realParent}（而非表面路径）。`
        + '请确认该链接来源可信（企业环境把 .claude 等目录重定向到共享盘属常见场景）；本次不阻断安装。');
    }
  }

  if (ACTIVE_TX) ACTIVE_TX.ensureDir(dest);
  else mkdirSync(dest, { recursive: true });

  // I-1：技能容器本身是符号链接/junction（Windows npx 缓存、用户手工 junction 都可能
  // 命中），继续写入会落到链接目标、穿越到项目/家目录之外。整个 target 判失败，不写任何文件。
  if (isSymlinkPath(dest)) {
    const msg = `技能目标目录 ${dest} 是符号链接/junction，为防目标侧穿越，已跳过整个 ${target.name} target`
      + '（未向链接目标写入任何文件）。';
    console.warn(`  ⚠️ WARN ${msg}`);
    throw new Error(msg);
  }

  // 预检动作表（任务 7 事务化安装）：未提供 plan 时沿用旧的就地判定（向后兼容）。
  const actionByName = new Map();
  if (plan) {
    for (const s of plan.skills) actionByName.set(s.name, s);
  }

  let added = 0;
  let already = 0;
  let warned = 0;
  let upgraded = 0;
  for (const name of names) {
    const src = resolve(SKILLS_SRC, name);
    const dst = resolve(dest, name);
    const planned = actionByName.get(name);
    const rel = relFromBase(baseDir, dst);
    // 先 lstat（不跟随）：技能子目录是链接时绝不能穿透复制/写 meta，也不能穿透读 meta。
    let dstStat;
    try { dstStat = lstatSync(dst); } catch { dstStat = null; }
    if (dstStat) {
      if (dstStat.isSymbolicLink()) {
        console.warn(`  ⚠️ WARN 技能目标 ${dst} 是符号链接/junction，为防目标侧穿越跳过该技能`
          + '（不写入、不读取链接目标）。');
        warned++;
        continue;
      }
      if (planned && planned.action === 'skip') {
        warned++;
        continue;
      }
      if (planned && planned.action === 'skip-ours') {
        already++;
        continue;
      }
      if (planned && (planned.action === 'upgrade' || planned.action === 'adopt')) {
        // 本包旧版自升级 / --adopt-skills 接管：先备份整目录再覆盖（事务可回滚）。
        if (ACTIVE_TX && run) ACTIVE_TX.backupAndReplaceDir(dst, rel);
        else rmSync(dst, { recursive: true, force: true });
        copyDirSync(src, dst);
        writeSkillMeta(dst, target, isGlobal);
        upgraded++;
        continue;
      }
      if (isOurManaged(dst)) {
        already++;
        continue;
      }
      if (isDirEmpty(dst)) {
        // R2：目录存在但完全为空（无 SKILL.md、无 meta）——典型是上次安装中途
        // 失败（权限/杀软/磁盘）留下的空壳。空目录里没有任何用户内容可损失，
        // 安全接管：补齐技能内容并写本包 meta。
        console.log(`  ℹ️  接管空目录 ${dst}（目录存在但完全为空，疑似上次安装失败的残留）：补齐技能内容并写本包 meta。`);
        if (ACTIVE_TX) ACTIVE_TX.noteExistingEmptyDir(rel);
        copyDirSync(src, dst);
        writeSkillMeta(dst, target, isGlobal);
        if (ACTIVE_TX) ACTIVE_TX.trackCreatedDir(dst, rel, { wasEmpty: true });
        added++;
        continue;
      }
      console.warn(`  ⚠️ WARN 同名技能 ${name} 已存在于 ${dst} 且非本包管理（无本包 .jevzh-meta.json），`
        + '判定为用户/他方内容，保留不动（零覆盖；确认可替换请用 --adopt-skills 接管）。');
      warned++;
      continue;
    }
    copyDirSync(src, dst);
    writeSkillMeta(dst, target, isGlobal);
    if (ACTIVE_TX) ACTIVE_TX.trackCreatedDir(dst, rel, { wasEmpty: false });
    added++;
  }

  const presentNow = names.filter(n => existsSync(resolve(dest, n))).length;
  if (names.length > 0 && presentNow === 0) {
    throw new Error(
      `复制 skills 失败：源目录 ${SKILLS_SRC} 有 ${names.length} 个待装 skill，但目标 ${dest} 为空。`
      + `\n  这通常是缓存目录权限或路径问题。请尝试：\n`
      + `    1. 清理缓存后重试: npm cache clean --force && npx jevzh\n`
      + `    2. 或全局安装: npm i -g jev-superpowers-zh && jevzh\n`
      + `    3. 或手动克隆复制: 见 https://github.com/xiaoidev/jev-superpowers-zh`,
    );
  }

  const scopeTag = isGlobal ? '[全局]' : '[项目]';
  console.log(`  ✅ ${target.name} ${scopeTag}: 新装 ${added} 个 / 已装 ${already} 个`
    + `${upgraded ? ` / 升级接管 ${upgraded} 个` : ''} skills -> ${dest}`
    + (warned ? `（${warned} 个同名他方技能跳过，见 SKIP/WARN）` : ''));
  return { added, already, warned, upgraded };
}

// --- 路径护栏：任何事务/恢复操作都必须落在 baseDir 之内 ---
function relFromBase(baseDir, abs) {
  const b = resolve(baseDir);
  const p = resolve(abs);
  if (p === b) return '';
  if (!p.startsWith(b + sep)) throw new Error(`路径越界护栏：${p} 不在 ${b} 之内`);
  return p.slice(b.length + 1).split(sep).join('/');
}

function isInsideDir(baseDir, abs) {
  const b = resolve(baseDir);
  const p = resolve(abs);
  return p === b || p.startsWith(b + sep);
}

// 朴素 ATX 标题扫描（围栏感知）：
//   - 识别 0~3 空格缩进的 1~6 级 ATX 标题，返回相对原文的字符下标；
//   - 跳过 ``` / ~~~ 代码围栏内的行（围栏长度 >=3、同类围栏且长度不短于开围栏
//     才算闭合，闭合围栏不得带 info string），避免把代码示例里的 markdown 标题
//     误当边界；
//   - 已知限制：不解析跨行 inline code 反引号段（极少见），这类行理论上可能被
//     误判为标题；与 cutPairedSections / cutLegacyZhMarkedSection 同属保守的
//     行级扫描，切除前仍有「段内 >=2 高置信特征」门槛兜底。
function scanAtxHeadings(content) {
  const heads = [];
  const fenceRe = /^[ \t]{0,3}(`{3,}|~{3,})(.*)$/;
  const lines = content.split('\n');
  let offset = 0;
  let fence = null; // { char: '`' | '~', len: number }
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    if (fence) {
      const fm = fenceRe.exec(line);
      if (fm && fm[1][0] === fence.char && fm[1].length >= fence.len && fm[2].trim() === '') {
        fence = null;
      }
    } else {
      const fm = fenceRe.exec(line);
      if (fm) {
        fence = { char: fm[1][0], len: fm[1].length };
      } else {
        const hm = /^[ \t]{0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/.exec(line);
        if (hm) {
          const text = String(hm[2] || '').replace(/[ \t]+#+[ \t]*$/, '').trim();
          heads.push({ index: offset, level: hm[1].length, text });
        }
      }
    }
    offset += raw.length + 1; // \n 本身占 1 字符（raw 保留可能的 \r）
  }
  return heads;
}

// 有边界的英文 jev / obra 旧段切除（保守）：品牌匹配标题 + 段内至少 2 个高置信特征。
// 下边界 = 其后第一个层级不深于该标题（同级/更高级）的【任意】ATX 标题（不看标题
// 文本）；其后再无同级以上标题时才合法切到 EOF。多个竞品段一次扫描、逐段独立判定
// 边界；任一段证据不足（hits<2）-> unresolvable，调用方 WARN 整文件保留。
const FOREIGN_SECTION_FEATURES = [
  'TypeSafe Jev', 'Failure Modes', 'jev-using-superpowers',
  'docs/CONFIDENCE.md', 'superpowers:using-superpowers', 'jev-superpowers',
];
function cutForeignMarkedSections(content) {
  if (!FOREIGN_SECTION_FEATURES.some(f => content.includes(f))) return { text: content, cut: false, unresolvable: false };
  const all = scanAtxHeadings(content);
  const brandRe = /superpowers|typesafe\s*jev/i;
  const candidates = all.filter(h => brandRe.test(h.text));
  if (candidates.length === 0) return { text: content, cut: false, unresolvable: true };
  // 先在【原始文本】上为每个候选段独立计算 [start,end)：只在全部标题序列里找
  // 边界，用户自写标题（无品牌词）同样能终止切除，绝不一路吞到 EOF。
  const ranges = candidates.map((h) => {
    const pos = all.indexOf(h);
    let end = content.length; // 其后无同级/更高级标题 -> 文件尾是唯一合法边界
    for (let j = pos + 1; j < all.length; j++) {
      if (all[j].level <= h.level) { end = all[j].index; break; }
    }
    return { start: h.index, end };
  });
  // 任一段高置信特征不足 -> 边界/归属存疑，保守整文件保留（不做部分切除）。
  for (const r of ranges) {
    const section = content.slice(r.start, r.end);
    const hits = FOREIGN_SECTION_FEATURES.filter(f => section.includes(f)).length;
    if (hits < 2) return { text: content, cut: false, unresolvable: true };
  }
  let text = content;
  let cut = false;
  // 区间按标题嵌套关系必然互斥或包含；从后往前切下标不失效。
  for (let i = ranges.length - 1; i >= 0; i--) {
    text = text.slice(0, ranges[i].start) + text.slice(ranges[i].end);
    cut = true;
  }
  return { text, cut, unresolvable: false };
}

// --- hooks 运行时（R-1：按宿主过滤；Claude 不落 hooks-cursor.json，反之亦然）---
function hookRuntimeFiles(target) {
  if (target.name === 'Claude Code') return HOOK_FILES.filter(f => f !== 'hooks-cursor.json');
  if (target.name === 'Cursor') {
    return ['hooks-cursor.json', 'session-start', 'pre-commit', 'stop', 'run-hook.cmd'];
  }
  return [];
}

function installHooksForTarget(target, baseDir, tx = null) {
  if (!target.hooks) return;
  const hookDest = resolve(baseDir, target.hooks);
  const scriptDest = resolve(baseDir, dirname(target.hooks), 'scripts');
  const onHookAdded = tx ? (dst) => tx.trackCreatedFile(dst) : null;
  const hooks = installOwnedFiles(
    HOOKS_SRC, hookDest, hookRuntimeFiles(target), `${target.name} hooks`, onHookAdded,
  );
  const onScriptAdded = tx ? (dst) => tx.trackCreatedFile(dst) : null;
  const scripts = installOwnedFiles(
    SCRIPTS_SRC, scriptDest, GATE_SCRIPT_FILES, `${target.name} scripts`, onScriptAdded,
  );
  if (tx) {
    tx.pruneRoots.add(hookDest);
    tx.pruneRoots.add(scriptDest);
  }
  if (hooks.linkSkipped) {
    console.warn(`  ⚠️ SKIP ${target.name}: 跳过 hooks 运行时（目标目录是符号链接/junction）-> ${hookDest}`
      + '（未写入任何 hooks 文件，链接目标未触及）。');
    if (scripts.installed > 0) {
      console.log(`  ✅ ${target.name}: 门禁脚本 -> ${scriptDest}（与 hooks 容器相互独立，已正常落位）`);
    }
    return;
  }
  if (hooks.installed > 0 || existsSync(hookDest)) {
    console.log(`  ✅ ${target.name}: hooks 运行时 -> ${hookDest}`);
    console.log(`     门禁脚本 -> ${scriptDest}（session-start/pre-commit/stop 经 run-hook.cmd 调用）`);
    if (process.platform === 'win32') {
      console.log('     ℹ️  Windows 不跟踪可执行位：钩子统一由 run-hook.cmd 调 Git for Windows bash，无需 chmod +x。');
    }
  }
}

// --- hooks settings 读改写合并（Claude settings.json(.local) / Cursor hooks.json）---
const HOOK_EVENTS = [
  { event: 'SessionStart', arg: 'session-start', matcher: 'startup|clear|compact' },
  { event: 'PreToolUse', arg: 'pre-commit', matcher: 'Bash' },
  { event: 'Stop', arg: 'stop', matcher: '' },
];
const CURSOR_EVENT_KEYS = { SessionStart: 'sessionStart', PreToolUse: 'preToolUse', Stop: 'stop' };

function settingsHostsForTarget(target) {
  if (target.name === 'Claude Code') {
    return [{
      schema: 'claude',
      hooksRel: '.claude/hooks',
      candidates: ['.claude/settings.json', '.claude/settings.local.json'],
    }];
  }
  if (target.name === 'Cursor') {
    return [{ schema: 'cursor', hooksRel: '.cursor/hooks', candidates: ['.cursor/hooks.json'] }];
  }
  return [];
}

function toFwd(p) { return p.split(sep).join('/'); }

function oursHookCommand(hooksAbsDir, schema, arg) {
  if (schema === 'cursor') return `./hooks/run-hook.cmd ${arg}`;
  return `"${toFwd(resolve(hooksAbsDir, 'run-hook.cmd'))}" ${arg}`;
}

function normCmd(cmd) { return String(cmd || '').replace(/\\/g, '/'); }
function cmdIsOurs(cmd, arg) {
  const n = normCmd(cmd);
  return n.includes('run-hook.cmd') && n.includes(arg);
}
function cmdIsCompetitorJev(cmd) {
  const n = normCmd(cmd);
  if (!/(^|[^A-Za-z0-9-])jev-superpowers(?=\/|$|[^A-Za-z0-9-])/.test(n)) return null;
  for (const e of HOOK_EVENTS) if (n.includes(e.arg)) return e.event;
  return null;
}

// 遍历两种 schema 下的 command 字符串：fn(commandString, event, entry, group)
// 可就地改写 command；返回 true 表示发生改写。
function walkHookCommands(cfg, schema, fn) {
  let changed = false;
  const hooks = (cfg && typeof cfg === 'object' && cfg.hooks && typeof cfg.hooks === 'object') ? cfg.hooks : {};
  for (const e of HOOK_EVENTS) {
    const key = schema === 'cursor' ? CURSOR_EVENT_KEYS[e.event] : e.event;
    const list = hooks[key];
    if (!Array.isArray(list)) continue;
    if (schema === 'claude') {
      for (const group of list) {
        if (!group || typeof group !== 'object' || !Array.isArray(group.hooks)) continue;
        for (const h of group.hooks) {
          if (h && typeof h === 'object' && typeof h.command === 'string') {
            const before = h.command;
            if (fn(h.command, e.event, h, group)) changed = true;
            if (h.command !== before) changed = true;
          }
        }
      }
    } else {
      for (const entry of list) {
        const h = typeof entry === 'string' ? null : entry;
        const cmdBefore = h ? h.command : entry;
        if (typeof cmdBefore === 'string') {
          let obj = h;
          if (typeof entry === 'string') {
            // 字符串形态就地升级为对象
            const idx = list.indexOf(entry);
            obj = { command: entry };
            list[idx] = obj;
            changed = true;
          }
          const before = obj.command;
          if (fn(obj.command, e.event, obj, null)) changed = true;
          if (obj.command !== before) changed = true;
        }
      }
    }
  }
  return changed;
}

function wiredEvents(cfg, schema) {
  const wired = new Set();
  walkHookCommands(cfg, schema, (cmd, event) => {
    if (HOOK_EVENTS.some(e => e.event === event && cmdIsOurs(cmd, e.arg))) wired.add(event);
    return false;
  });
  return wired;
}

function buildOurHookEntry(schema, event, hooksAbsDir) {
  const arg = HOOK_EVENTS.find(e => e.event === event).arg;
  const matcher = HOOK_EVENTS.find(e => e.event === event).matcher;
  const command = oursHookCommand(hooksAbsDir, schema, arg);
  if (schema === 'cursor') {
    return event === 'PreToolUse' ? { matcher, command } : { command };
  }
  return { matcher, hooks: [{ type: 'command', command, shell: 'bash', async: false }] };
}

// 读改写合并：保留未知键与既有条目，去重，改写 jev 上游引用，追加缺失事件。
function mergeHooksConfig(cfg0, schema, hooksAbsDir) {
  const cfg = cfg0 && typeof cfg0 === 'object' ? cfg0 : {};
  if (!cfg.hooks || typeof cfg.hooks !== 'object') cfg.hooks = {};
  const rewrites = [];
  walkHookCommands(cfg, schema, (cmd, event, hookEntry) => {
    const jevEvent = cmdIsCompetitorJev(cmd);
    if (jevEvent) {
      const arg = HOOK_EVENTS.find(e => e.event === jevEvent).arg;
      hookEntry.command = oursHookCommand(hooksAbsDir, schema, arg);
      rewrites.push(jevEvent);
      return true;
    }
    return false;
  });
  const wired = wiredEvents(cfg, schema);
  const appended = [];
  for (const e of HOOK_EVENTS) {
    const key = schema === 'cursor' ? CURSOR_EVENT_KEYS[e.event] : e.event;
    if (wired.has(e.event)) continue;
    if (!Array.isArray(cfg.hooks[key])) cfg.hooks[key] = [];
    cfg.hooks[key].push(buildOurHookEntry(schema, e.event, hooksAbsDir));
    appended.push(e.event);
  }
  return { cfg, rewrites, appended, wired: new Set([...wired, ...appended, ...rewrites]) };
}

// 选择实际接线文件：优先已含 hook 配置/本包或 jev 引用的候选；否则第一个（主文件）。
function chooseSettingsCandidate(baseDir, host) {
  const existing = host.candidates
    .map(rel => ({ rel, abs: resolve(baseDir, rel) }))
    .filter(x => existsSync(x.abs));
  for (const x of existing) {
    try {
      const cfg = JSON.parse(readFileSync(x.abs, 'utf8'));
      const raw = JSON.stringify(cfg || {});
      if (raw.includes('run-hook.cmd') || /jev-superpowers(?!-zh)/.test(raw)) return x;
    } catch { /* 坏文件在 preflight 已阻断 */ }
  }
  for (const x of existing) {
    try {
      const cfg = JSON.parse(readFileSync(x.abs, 'utf8'));
      if (cfg && cfg.hooks && typeof cfg.hooks === 'object') return x;
    } catch {}
  }
  return { rel: host.candidates[0], abs: resolve(baseDir, host.candidates[0]) };
}

// --- 预检（preflight）：收集五级处置矩阵，不做任何写盘 ---
function preflightTarget(target, baseDir, isGlobal, opts) {
  const plan = { target, isGlobal, blocks: [], errors: [], skills: [], router: [], hosts: [] };

  // 1) 竞品插件启用记录（硬阻断，--force 不绕过）
  for (const hit of scanPluginCompetitors(baseDir, target)) {
    plan.blocks.push({ kind: 'plugin', file: hit.file, name: hit.name });
  }

  // 2) 同名技能来源识别
  const relDir = isGlobal ? globalRelDir(target) : target.dir;
  if (relDir) {
    const dest = resolve(baseDir, relDir);
    let destStat;
    try { destStat = lstatSync(dest); } catch { destStat = null; }
    if (destStat && destStat.isSymbolicLink()) {
      plan.errors.push({ kind: 'link-container', path: dest });
    } else {
      for (const name of selectedSkillNames(!!opts.noJev)) {
        const dst = resolve(dest, name);
        let st;
        try { st = lstatSync(dst); } catch { st = null; }
        if (!st) { plan.skills.push({ name, action: 'add' }); continue; }
        if (st.isSymbolicLink()) { plan.skills.push({ name, action: 'skip', warn: 'link' }); continue; }
        const c = classifySkillSource(dst);
        const skillReady = existsSync(resolve(dst, 'SKILL.md'))
          && readSkillBody(dst) && readSkillBody(dst).trim().length > 0;
        if (c.source === 'ours') {
          const oldVer = c.version;
          const stale = oldVer && compareVersions(oldVer, PKG.version) < 0;
          if (stale) {
            // meta 明确指向更旧版本：即使文件已损坏也按自升级处置（覆盖即修复）。
            plan.skills.push({ name, action: 'upgrade', reason: 'self', from: oldVer, to: PKG.version,
              detail: `本包旧版自升级（v${oldVer} -> v${PKG.version}${skillReady ? '' : '；同时修复损坏/缺失文件'}）` });
          } else if (!skillReady) {
            plan.skills.push({ name, action: 'upgrade', reason: 'repair', detail: '本包技能损坏（SKILL.md 缺失/为空），修复重装' });
          } else if (!oldVer) {
            plan.skills.push({ name, action: 'upgrade', reason: 'brand', detail: '识别为本包旧版（品牌特征、无 meta），补齐元数据覆盖' });
          } else {
            plan.skills.push({ name, action: 'skip-ours', version: oldVer });
          }
          continue;
        }
        if (c.source === 'empty' || isDirEmpty(dst)) { plan.skills.push({ name, action: 'add', empty: true }); continue; }
        if (opts.adoptSkills) {
          plan.skills.push({ name, action: 'adopt', source: c.source, detail: `--adopt-skills 备份后接管（来源：${sourceLabel(c.source)}）` });
        } else {
          plan.skills.push({ name, action: 'skip', source: c.source });
        }
      }
    }
  }

  // 3) router（只评估已存在文件；新文件创建不打处置标签）
  const desc = routerDescriptor(target, isGlobal);
  if (desc) {
    for (const rel of desc.shared || []) {
      const abs = resolve(baseDir, rel);
      if (!existsSync(abs)) continue;
      let text;
      try { text = readFileSync(abs, 'utf8'); } catch { continue; }
      const st = analyzeRouterText(text);
      if (st.danglingOurs || st.danglingZh) {
        plan.router.push({ kind: 'shared', rel, status: 'dangling' });
      } else if (st.oursTargets.includes(target.name)) {
        plan.router.push({ kind: 'shared', rel, status: 'ours' });
      } else if (st.hasCompetitor) {
        plan.router.push({ kind: 'shared', rel, status: opts.keepRouter ? 'keep' : 'migrate' });
      } else {
        plan.router.push({ kind: 'shared', rel, status: 'clean' });
      }
    }
    for (const s of desc.standalone || []) {
      const legacyAbs = resolve(baseDir, s.legacyRel);
      if (existsSync(legacyAbs)) {
        plan.router.push({ kind: 'standalone', rel: s.legacyRel, oursRel: s.oursRel,
          status: opts.keepRouter ? 'keep' : 'migrate' });
      }
    }
  }

  // 4) hooks settings（损坏 JSON 硬阻断 BLOCK）
  if (!opts.noJev) {
    for (const host of settingsHostsForTarget(target)) {
      let corrupt = null;
      for (const rel of host.candidates) {
        const abs = resolve(baseDir, rel);
        if (!existsSync(abs)) continue;
        try {
          JSON.parse(readFileSync(abs, 'utf8'));
        } catch {
          corrupt = rel;
          break;
        }
      }
      if (corrupt) {
        plan.blocks.push({ kind: 'settings-corrupt', file: corrupt });
        plan.hosts.push({ ...host, status: 'blocked', file: corrupt });
        continue;
      }
      if (opts.keepRouter) { plan.hosts.push({ ...host, status: 'keep' }); continue; }
      const chosen = chooseSettingsCandidate(baseDir, host);
      let status = 'create';
      let rewrites = [];
      if (existsSync(chosen.abs)) {
        const cfg = JSON.parse(readFileSync(chosen.abs, 'utf8'));
        const wired = wiredEvents(cfg, host.schema);
        const r = mergeHooksConfig(JSON.parse(readFileSync(chosen.abs, 'utf8')), host.schema, resolve(baseDir, host.hooksRel));
        rewrites = r.rewrites;
        status = wired.size === HOOK_EVENTS.length ? 'wired' : (rewrites.length ? 'rewrite' : 'merge');
      }
      plan.hosts.push({ ...host, status, chosen: chosen.rel });
    }
  }

  return plan;
}

function sourceLabel(source) {
  return {
    zh: 'superpowers-zh（同源中文版，行为基本等价）',
    jev: '英文 TypeSafe Jev 硬 STOP 旧版（jev-superpowers；软降级不生效）',
    obra: 'obra/superpowers 英文原版（不路由中文/jev 技能）',
    unknown: '来源不明（用户/他方内容）',
  }[source] || source;
}

function printPlanMatrix(plan, opts) {
  const scopeTag = plan.isGlobal ? '全局' : '项目级';
  console.log(`\n  ── 预检矩阵：${plan.target.name}（${scopeTag}${opts.detectOnly ? '；--detect-only 只报告不写盘' : ''}）──`);
  for (const s of plan.skills) {
    if (s.action === 'add') {
      console.log(`  [ADD]     ${s.name}：补缺安装${s.empty ? '（接管空目录）' : ''}`);
    } else if (s.action === 'skip-ours') {
      console.log(`  [SKIP]    ${s.name}：本包已安装（v${s.version || PKG.version}），幂等跳过`);
    } else if (s.action === 'upgrade') {
      console.log(`  [MIGRATE] ${s.name}：${s.detail}`);
    } else if (s.action === 'adopt') {
      console.log(`  [MIGRATE] ${s.name}：${s.detail}`);
    } else if (s.warn === 'link') {
      console.log(`  [WARN]    ${s.name}：目标是符号链接/junction，防穿越跳过`);
    } else if (s.source === 'unknown') {
      console.log(`  [WARN]    ${s.name}：同名目录来源不明（用户/他方内容，无法识别发行版），最保守保留不动（零覆盖；确认可替换用 --adopt-skills 接管）`);
    } else if (s.source === 'jev') {
      console.log(`  [SKIP]    ${s.name}：同名技能已存在，来源：${sourceLabel('jev')}；默认保留，--adopt-skills 可接管`);
    } else if (s.source) {
      console.log(`  [SKIP]    ${s.name}：同名技能已存在，来源：${sourceLabel(s.source)}；默认保留，--adopt-skills 可接管`);
    }
  }
  for (const r of plan.router) {
    if (r.status === 'migrate') {
      console.log(`  [MIGRATE] ${r.rel}：检测到旧发行版引导段，将备份整文件后精确切除并写入本包成对哨兵（用户内容保留）`);
    } else if (r.status === 'dangling') {
      console.log(`  [WARN]    ${r.rel}：哨兵 begin 无配对 end（悬空/畸形），不接管不追加，请手工修复标记`);
    } else if (r.status === 'keep') {
      console.log(`  [SKIP]    ${r.rel}：--keep-router 保留旧引导段/规则文件不动`);
    } else if (r.status === 'ours') {
      console.log(`  [SKIP]    ${r.rel}：本包引导区块已在位，幂等跳过`);
    }
  }
  for (const h of plan.hosts) {
    if (h.status === 'blocked') {
      console.log(`  [BLOCK]   ${h.file}：hooks 设置文件不是合法 JSON（静默覆盖会丢配置）`);
    } else if (h.status === 'keep') {
      console.log(`  [SKIP]    ${h.candidates[0]}：--keep-router 不做 hooks 接线合并`);
    } else if (h.status === 'rewrite') {
      console.log(`  [MIGRATE] ${h.chosen}：检测到 jev-superpowers 旧 hooks 引用，将备份后改写为本包 run-hook.cmd 接线`);
    } else if (h.status === 'merge') {
      console.log(`  [MIGRATE] ${h.chosen}：hooks 接线读改写合并（保留未知键与既有 hook 条目，不重复追加），改前备份`);
    } else if (h.status === 'wired') {
      console.log(`  [SKIP]    ${h.chosen}：本包 hooks 已接线，幂等跳过`);
    }
  }
  for (const e of plan.errors) {
    if (e.kind === 'link-container') {
      console.log(`  [BLOCK]   ${e.path}：技能容器是符号链接/junction，防穿越禁止写入该目标`);
    }
  }
  for (const b of plan.blocks) {
    if (b.kind === 'plugin') {
      console.log(`  [BLOCK]   检测到竞品插件启用记录 ${b.file} -> ${b.name}：插件与文件安装会重复生效，必须先卸载/禁用插件`);
    } else if (b.kind === 'settings-corrupt') {
      // 已在 hosts 行打印
    }
  }
}

// --- 共存环境 WARN（规格 §7.7.1）：全局 npm 旧包 + 项目/全局交叉副本，均 best-effort ---

// 定位 PATH 上 npm.cmd 旁的 npm-cli.js（仅 Windows 需要）。
function findNpmCliJs() {
  const pathSep = process.platform === 'win32' ? ';' : ':';
  for (const d of (process.env.PATH || '').split(pathSep).filter(Boolean)) {
    try {
      const cli = resolve(d, 'node_modules', 'npm', 'bin', 'npm-cli.js');
      if (existsSync(cli)) return cli;
    } catch {}
  }
  return null;
}

// best-effort 取 npm root -g（3s 超时；shell:false；npm 不存在/超时/异常 -> null 静默）。
// Windows 上 npm 是 npm.cmd，shell:false 直 spawn 会 ENOENT/EINVAL（Node 安全收紧），
// 改用当前 node 直跑 npm-cli.js（不经 shell，无 argv 注入面）。
// JEVZH_TEST_NPM_ROOT_G：测试夹具/排障注入接缝（与 JEVZH_FAULT 同性质，生产环境无此变量）。
function npmGlobalRoot() {
  const injected = process.env.JEVZH_TEST_NPM_ROOT_G;
  if (injected !== undefined) return injected.trim() || null;
  const args = ['root', '-g'];
  let r = null;
  try {
    r = spawnSync('npm', args, { encoding: 'utf8', timeout: 3000, shell: false, windowsHide: true });
  } catch { r = null; }
  if ((!r || r.error || r.status !== 0) && process.platform === 'win32') {
    const cli = findNpmCliJs();
    if (cli) {
      try {
        r = spawnSync(process.execPath, [cli, ...args],
          { encoding: 'utf8', timeout: 3000, shell: false, windowsHide: true });
      } catch { r = null; }
    }
  }
  if (!r || r.error || r.status !== 0) return null;
  const line = String(r.stdout || '').trim().split(/\r?\n/).filter(Boolean).pop();
  return line || null;
}

// 文件是否含任一发行版（jevzh / 旧 superpowers-zh）痕迹：两类哨兵或品牌/增量标记。
function fileHasDistroMark(abs) {
  let t;
  try { t = readFileSync(abs, 'utf8'); } catch { return false; }
  return t.includes(SENTINEL_BEGIN) || t.includes(ZH_SENTINEL_BEGIN)
    || t.includes(PKG.name) || t.includes(FORK_MARK);
}

// 技能目录是否含本包 meta 或 zh/jevzh 旧标记技能（限量只读扫描，best-effort 不拖累）。
function dirHasDistroSkills(skillsAbs, maxCheck = 40) {
  let ents;
  try { ents = readdirSync(skillsAbs, { withFileTypes: true }); } catch { return false; }
  for (const ent of ents.slice(0, maxCheck)) {
    if (!ent.isDirectory()) continue;
    const d = resolve(skillsAbs, ent.name);
    try { if (existsSync(resolve(d, '.jevzh-meta.json'))) return true; } catch {}
    const skill = resolve(d, 'SKILL.md');
    if (existsSync(skill)) {
      try {
        const t = readFileSync(skill, 'utf8');
        if (t.includes(FORK_MARK) || t.includes(PKG.name) || /(?<!jev-)superpowers-zh/.test(t)) return true;
      } catch {}
    }
  }
  return false;
}

// 在给定作用域（project/global）的典型落位找发行版痕迹，返回命中位置说明（少量、去重）。
function detectScopeCopy(scope, baseDir) {
  const hits = [];
  const add = (s) => { if (!hits.includes(s)) hits.push(s); };
  const descMap = ROUTER_DESCRIPTORS[scope] || {};
  for (const [targetName, desc] of Object.entries(descMap)) {
    for (const rel of desc.shared || []) {
      const abs = resolve(baseDir, rel);
      if (fileHasDistroMark(abs)) add(rel);
    }
    for (const s of desc.standalone || []) {
      const abs = resolve(baseDir, s.oursRel);
      if (fileHasDistroMark(abs)) add(s.oursRel);
    }
    const t = TARGETS.find(x => x.name === targetName);
    if (!t) continue;
    const skillsRel = scope === 'global' ? globalRelDir(t) : t.dir;
    if (!skillsRel) continue;
    const skillsAbs = isAbsolute(skillsRel) ? skillsRel : resolve(baseDir, skillsRel);
    if (dirHasDistroSkills(skillsAbs)) {
      add(scope === 'global' ? skillsRel.split(sep).join('/').replace(/^[A-Za-z]:/, '') : skillsRel);
    }
  }
  return hits;
}

let coexistWarnCache = null;
// 返回本次安装的纯咨询 WARN 文案列表（不阻断、不改退出码）；结果按运行参数缓存。
function detectCoexistWarnings(isGlobal, projectDir) {
  const key = `${isGlobal ? 'global' : 'project'}:${resolve(projectDir)}`;
  if (coexistWarnCache && coexistWarnCache.key === key) return coexistWarnCache.out;
  const out = [];
  try {
    const root = npmGlobalRoot();
    if (root) {
      const pkgJson = resolve(root, 'node_modules', 'superpowers-zh', 'package.json');
      if (existsSync(pkgJson)) {
        out.push(`检测到全局 npm 旧包 superpowers-zh（${pkgJson}）：它与 jevzh 的 CLI 名不同`
          + '（superpowers-zh vs jevzh），可以共存，但建议先卸载旧全局包避免误用：'
          + 'npm uninstall -g superpowers-zh（本条仅提示，不阻断安装）。');
      }
    }
  } catch {}
  try {
    if (isGlobal) {
      const hits = detectScopeCopy('project', projectDir);
      if (hits.length) {
        out.push(`当前项目已存在项目级 superpowers-zh/jevzh 副本（${hits.slice(0, 4).join('、')}）：`
          + '本次全局安装后，在该项目内开会话时【项目级副本优先级高于全局副本】，可能双重生效/路由并存；'
          + '若只想保留全局一套，可在该项目目录执行 npx jevzh --uninstall 清理项目级副本。');
      }
    } else if (resolve(projectDir) !== resolve(homedir())) {
      const hits = detectScopeCopy('global', homedir());
      if (hits.length) {
        out.push(`检测到用户主目录已有全局 superpowers-zh/jevzh 副本（${hits.slice(0, 4).join('、')}）：`
          + '本次项目级安装后，在当前项目内【项目级副本优先于全局副本】，其他项目仍走全局副本，'
          + '两套可能路由并存；如不希望混用，可在主目录执行 npx jevzh --global --uninstall 移除全局副本。');
      }
    }
  } catch {}
  coexistWarnCache = { key, out };
  return out;
}

function printCoexistWarnings(isGlobal, projectDir) {
  const warns = detectCoexistWarnings(isGlobal, projectDir);
  for (const w of warns) console.warn(`  ⚠️ [WARN] 共存提示：${w}`);
  return warns.length;
}

// --- 备份轮次：.jevzh/backups/<ts>/，整文件/整目录首拍快照 + manifest ---
function makeBackupTs(when = new Date()) {
  const p2 = n => String(n).padStart(2, '0');
  const ymd = `${when.getFullYear()}${p2(when.getMonth() + 1)}${p2(when.getDate())}`;
  // 毫秒必须补满 3 位（p2 只有 2 位，会生成 8 位尾部导致时间戳正则不匹配、轮转漏删）。
  const ms = String(when.getMilliseconds()).padStart(3, '0');
  const hms = `${p2(when.getHours())}${p2(when.getMinutes())}${p2(when.getSeconds())}${ms}`;
  return `${ymd}T${hms}-${randomBytes(2).toString('hex')}`;
}
const BACKUP_KEEP = 3;
const BACKUP_TS_RE = /^\d{8}T\d{9}-[0-9a-f]+$/;

function backupsRootFor(baseDir) {
  return resolve(baseDir, '.jevzh', 'backups');
}

// 文件载荷完整性指纹：size（字节）+ sha256（hex）。restore 预演/写后两次核对。
function fileIntegrity(abs) {
  const buf = readFileSync(abs);
  return { size: buf.length, sha256: createHash('sha256').update(buf).digest('hex') };
}

// 目录载荷清单：载荷目录内全部文件相对路径（正斜杠、字典序）。
// 目录不强制整体哈希，restore 时按此清单逐项核对存在性。
function listPayloadFiles(payloadAbs) {
  const out = [];
  const walk = (d, rel) => {
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      const p = resolve(d, ent.name);
      if (ent.isDirectory()) walk(p, r);
      else if (ent.isFile()) out.push(r);
    }
  };
  walk(payloadAbs, '');
  return out.sort();
}

function createBackupRun(baseDir, isGlobal, kind = 'install', extra = {}) {
  const ts = makeBackupTs();
  const root = resolve(backupsRootFor(baseDir), ts);
  let seq = 0;
  let fsReady = false;
  const payloadByRel = new Map(); // rel -> {kind, payload, existed, size?, sha256?, files?}
  const targetEntries = new Map();

  const ensureFs = () => {
    if (!fsReady) { mkdirSync(root, { recursive: true }); fsReady = true; }
  };
  const register = (targetName, rel, kindEntry, existed, info) => {
    if (!targetEntries.has(targetName)) targetEntries.set(targetName, []);
    const list = targetEntries.get(targetName);
    const integrity = info.payload
      ? {
          payload: info.payload,
          ...(typeof info.size === 'number' ? { size: info.size } : {}),
          ...(info.sha256 ? { sha256: info.sha256 } : {}),
          ...(Array.isArray(info.files) ? { files: info.files } : {}),
        }
      : { payload: info.payload };
    if (!list.some(e => e.relPath === rel)) {
      list.push({ relPath: rel.split(sep).join('/'), kind: kindEntry, existed, ...integrity });
    } else {
      const old = list.find(e => e.relPath === rel);
      // 同一 target 内先记 new 后记 existed：以更保守的 existed 为准，并同步指纹。
      if (existed) { old.existed = true; Object.assign(old, integrity); }
    }
  };

  const api = {
    ts,
    root,
    kind,
    droppedTargets: new Set(),
    hasCapture(rel) { return payloadByRel.has(rel); },
    captureFile(targetName, abs, rel, existed) {
      if (!payloadByRel.has(rel)) {
        ensureFs();
        seq += 1;
        const payload = `files/${String(seq).padStart(4, '0')}`;
        const dst = resolve(root, payload);
        mkdirSync(dirname(dst), { recursive: true });
        copyFileSync(abs, dst);
        // 对落盘后的载荷算指纹（而非源文件）：备份自损（截断/拷贝异常）也能在
        // restore 预演时暴露。
        payloadByRel.set(rel, { kind: 'file', payload, existed, ...fileIntegrity(dst) });
      }
      const info = payloadByRel.get(rel);
      register(targetName, rel, 'file', existed, info);
      return { ...info, firstCapture: true };
    },
    noteFile(targetName, rel, existed, kindEntry = 'file') {
      if (!payloadByRel.has(rel)) payloadByRel.set(rel, { kind: kindEntry, payload: null, existed });
      const info = payloadByRel.get(rel);
      register(targetName, rel, kindEntry, existed, info);
    },
    captureDir(targetName, abs, rel) {
      if (!payloadByRel.has(rel)) {
        ensureFs();
        seq += 1;
        const payload = `dirs/${String(seq).padStart(4, '0')}`;
        const dst = resolve(root, payload);
        mkdirSync(dst, { recursive: true });
        copyDirSync(abs, dst);
        payloadByRel.set(rel, { kind: 'dir', payload, existed: true, files: listPayloadFiles(dst) });
      }
      const info = payloadByRel.get(rel);
      register(targetName, rel, 'dir', true, info);
      return info;
    },
    payloadFor(rel) { return payloadByRel.get(rel) || null; },
    dropTarget(targetName) { this.droppedTargets.add(targetName); },
    finalize() {
      const committed = [...targetEntries.entries()]
        .filter(([t]) => !this.droppedTargets.has(t))
        .map(([target, entries]) => ({ target, entries }));
      const destructive = committed.some(t => t.entries.some(e => e.existed === true));
      if (!destructive) {
        try { rmSync(root, { recursive: true, force: true }); } catch {}
        pruneBackupRoot(baseDir);
        return null;
      }
      // 清理无引用载荷
      const referenced = new Set();
      for (const t of committed) for (const e of t.entries) if (e.payload) referenced.add(e.payload);
      for (const [, info] of payloadByRel) {
        if (info.payload && !referenced.has(info.payload)) {
          try { rmSync(resolve(root, info.payload), { recursive: true, force: true }); } catch {}
        }
      }
      const manifest = {
        schema: 1,
        kind,
        ts,
        date: new Date().toISOString(),
        pkg: PKG.name,
        version: PKG.version,
        scope: isGlobal ? 'global' : 'project',
        targets: committed,
        ...extra,
      };
      atomicWriteFileSync(resolve(root, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
      rotateBackups(backupsRootFor(baseDir));
      return ts;
    },
  };
  return api;
}

function pruneBackupRoot(baseDir) {
  const bkRoot = backupsRootFor(baseDir);
  try {
    if (readdirSync(bkRoot).length === 0) {
      rmSync(bkRoot, { recursive: true, force: true });
      const jevzh = resolve(baseDir, '.jevzh');
      if (existsSync(jevzh) && readdirSync(jevzh).length === 0) rmSync(jevzh, { recursive: true, force: true });
    }
  } catch {}
}

// Windows 下刚写出的目录可能被杀软/索引器短暂占用，rmSync 偶发 EPERM/EBUSY；
// 轮转删除做几次短重试，避免「应留 3 份实际 4 份」的非确定性失败。
function rmWithRetries(target, attempts = 4, delayMs = 40) {
  for (let i = 0; i < attempts; i++) {
    try {
      rmSync(target, { recursive: true, force: true });
      return true;
    } catch (e) {
      if (i === attempts - 1) return false;
      // 同步短眠（无第三方依赖）：SharedArrayBuffer + Atomics.wait
      const sab = new SharedArrayBuffer(4);
      Atomics.wait(new Int32Array(sab), 0, 0, delayMs * (i + 1));
    }
  }
  return false;
}

function rotateBackups(bkRoot) {
  let entries;
  try { entries = readdirSync(bkRoot, { withFileTypes: true }); } catch { return; }
  const dirs = entries.filter(e => e.isDirectory() && BACKUP_TS_RE.test(e.name)).map(e => e.name).sort();
  while (dirs.length > BACKUP_KEEP) {
    const old = dirs.shift();
    if (!rmWithRetries(resolve(bkRoot, old))) {
      // 持续占用删不掉时停止继续轮转（保留多份总比误判安全；下次安装会再次尝试）。
      break;
    }
  }
}

// --- 按目标事务 ---
let ACTIVE_TX = null;

function createTargetTransaction(run, target, baseDir, isGlobal, opts) {
  const tx = {
    run,
    target,
    baseDir,
    isGlobal,
    opts,
    undo: [],
    emptyDirs: [],
    pruneRoots: new Set(),
    warnings: [],
    // 事务开始前就已存在的目录（如夹具/用户预置的 .claude 容器）：回滚剪空时
    // 绝不能移除——否则自动检测在重跑时会丢失目标标记（用例 8 自愈前提）。
    preExistingDirs: new Set(),
    // 事务内唯一允许的建目录入口：mkdir -p，同时把已存在祖先登记为 pre-existing。
    ensureDir(abs) {
      let d = resolve(abs);
      const chain = [];
      for (let guard = 0; guard < 32; guard++) {
        let st;
        try { st = lstatSync(d); } catch { st = null; }
        if (st) {
          // 命中已存在祖先：它本身及向上全部祖先都是事务前存量
          if (st.isDirectory()) this.preExistingDirs.add(d);
          let a = dirname(d);
          while (isInsideDir(baseDir, a) || a === resolve(baseDir)) {
            this.preExistingDirs.add(a);
            if (a === resolve(baseDir)) break;
            a = dirname(a);
          }
          break;
        }
        chain.push(d);
        if (d === resolve(baseDir)) break;
        d = dirname(d);
      }
      mkdirSync(abs, { recursive: true });
      return chain;
    },
    trackCreatedFile(abs) {
      const rel = relFromBase(baseDir, abs);
      run.noteFile(target.name, rel, false);
      this.undo.push({ type: 'file-delete', rel });
      this.pruneRoots.add(dirname(resolve(baseDir, rel)));
    },
    noteExistingEmptyDir(rel) {
      this.emptyDirs.push(rel);
    },
    trackCreatedDir(abs, rel) {
      run.noteFile(target.name, rel, false, 'dir');
      this.undo.push({ type: 'dir-delete', rel });
      this.pruneRoots.add(dirname(resolve(baseDir, rel)));
    },
    backupAndReplaceDir(abs, rel) {
      run.captureDir(target.name, abs, rel);
      let st;
      try { st = lstatSync(abs); } catch { st = null; }
      if (st && !st.isSymbolicLink()) rmSync(abs, { recursive: true, force: true });
      else if (st) rmSync(abs, { force: true });
      this.undo.push({ type: 'dir-restore', rel, payload: run.payloadFor(rel).payload });
      mkdirSync(abs, { recursive: true });
    },
    modifyOrCreateFile(abs, rel, data) {
      let existed = false;
      try { existed = lstatSync(abs).isFile(); } catch {}
      if (existed) {
        // 幂等短路：字节级一致则不写盘、不备份（否则连跑会产生「空备份」并破坏指纹）
        if (readFileSync(abs, 'utf8') === data) return true;
        run.captureFile(target.name, abs, rel, true);
        this.undo.push({ type: 'file-restore', rel, payload: run.payloadFor(rel).payload });
      } else {
        this.ensureDir(dirname(abs));
        run.noteFile(target.name, rel, false);
        this.undo.push({ type: 'file-delete', rel });
      }
      atomicWriteFileSync(abs, data);
      return existed;
    },
    appendShared(abs, body, label) {
      const rel = relFromBase(baseDir, abs);
      let st;
      try { st = lstatSync(abs); } catch { st = null; }
      if (st && st.isSymbolicLink()) {
        const msg = `${label}: ${abs} 是符号链接/junction，防穿越保留不动。`;
        console.warn(`  ⚠️ WARN ${msg}`);
        this.warnings.push(msg);
        return;
      }
      this.ensureDir(dirname(abs));
      if (!st) {
        atomicWriteFileSync(abs, wrapWithSentinelTarget(body, target.name));
        run.noteFile(target.name, rel, false);
        this.undo.push({ type: 'file-delete', rel });
        console.log(`  ✅ ${label}: bootstrap -> ${abs}`);
        return;
      }
      const original = readFileSync(abs, 'utf8');
      const state = analyzeRouterText(original);
      if (state.danglingOurs || state.danglingZh) {
        const msg = `${label}: ${abs} 存在悬空哨兵（begin 无配对 end），边界不可判定，本次不接管也不追加，请手工修复标记。`;
        console.warn(`  ⚠️ WARN ${msg}`);
        this.warnings.push(msg);
        return;
      }
      if (state.oursTargets.includes(target.name)) {
        console.log(`  ✅ ${label}: 已包含本 target 的 jevzh 引导区块，跳过 -> ${abs}`);
        return;
      }
      if (state.hasCompetitor) {
        if (opts.keepRouter) {
          const msg = `${label}: ${abs} 已含其他发行版引导区块，--keep-router 保留旧段不动（同名路由可能并存，注意实际生效归属）。`;
          console.warn(`  ⚠️ WARN ${msg}`);
          this.warnings.push(msg);
          return;
        }
        let text = original;
        const zhPair = cutPairedSections(text, ZH_SENTINEL_BEGIN, ZH_SENTINEL_END);
        if (zhPair.malformed) {
          const msg = `${label}: ${abs} 旧 superpowers-zh 哨兵畸形（嵌套/无法配对），整文件保留请手工处理。`;
          console.warn(`  ⚠️ WARN ${msg}`);
          this.warnings.push(msg);
          return;
        }
        text = zhPair.text;
        const legacy = cutLegacyZhMarkedSection(text);
        if (legacy.unresolvable) {
          const msg = `${label}: ${abs} 旧 superpowers-zh 区段边界不可识别，整文件保留请手工处理。`;
          console.warn(`  ⚠️ WARN ${msg}`);
          this.warnings.push(msg);
          return;
        }
        text = legacy.text;
        const foreign = cutForeignMarkedSections(text);
        if (foreign.unresolvable) {
          const msg = `${label}: ${abs} 含英文 jev/obra 旧引导但边界不可判定，整文件保留请手工处理。`;
          console.warn(`  ⚠️ WARN ${msg}`);
          this.warnings.push(msg);
          return;
        }
        text = foreign.text;
        if (analyzeRouterText(text).hasCompetitor || text === original) {
          const msg = `${label}: ${abs} 含竞品引导痕迹但无法安全精确切除，整文件保留（可手工删除旧段后重跑）。`;
          console.warn(`  ⚠️ WARN ${msg}`);
          this.warnings.push(msg);
          return;
        }
        run.captureFile(target.name, abs, rel, true);
        const next = `${text.replace(/\s+$/, '')}\n\n${wrapWithSentinelTarget(body, target.name)}`;
        atomicWriteFileSync(abs, next);
        this.undo.push({ type: 'file-restore', rel, payload: run.payloadFor(rel).payload });
        console.log(`  🔄 [MIGRATE] ${label}: 备份并切除旧发行版引导段，写入本包成对哨兵 -> ${abs}`);
        return;
      }
      // 干净用户文件（可能已含其他 target 区块）：纯追加本 target 区块。
      const next = `${original.replace(/\s+$/, '')}\n\n${wrapWithSentinelTarget(body, target.name)}`;
      atomicWriteFileSync(abs, next);
      this.undo.push({ type: 'section-remove', rel, target: target.name });
      console.log(`  ✅ ${label}: 追加 skills 引用 -> ${abs}`);
    },
    writeStandalone(abs, body, label, legacyAbs) {
      const rel = relFromBase(baseDir, abs);
      let st;
      try { st = lstatSync(abs); } catch { st = null; }
      if (st && st.isSymbolicLink()) {
        console.warn(`  ⚠️ WARN ${label}: ${abs} 是符号链接/junction，防穿越保留不动。`);
        return;
      }
      this.ensureDir(dirname(abs));
      const oursReady = existsSync(abs) && readFileSync(abs, 'utf8') === body;
      if (!existsSync(abs)) {
        run.noteFile(target.name, rel, false);
        this.undo.push({ type: 'file-delete', rel });
        atomicWriteFileSync(abs, body);
      } else if (!oursReady) {
        // 本管文件被改动：也备份后覆盖（restore 可回退）。
        run.captureFile(target.name, abs, rel, true);
        this.undo.push({ type: 'file-restore', rel, payload: run.payloadFor(rel).payload });
        atomicWriteFileSync(abs, body);
      }
      console.log(`  ✅ ${label}: bootstrap rule -> ${abs}`);
      if (legacyAbs && existsSync(legacyAbs)) {
        const relLegacy = relFromBase(baseDir, legacyAbs);
        let lst;
        try { lst = lstatSync(legacyAbs); } catch { lst = null; }
        if (lst && lst.isSymbolicLink()) {
          console.warn(`  ⚠️ WARN ${label}: 旧规则文件 ${legacyAbs} 是符号链接，保留不动。`);
          return;
        }
        if (lst && lst.isDirectory()) {
          console.warn(`  ⚠️ WARN ${label}: 旧规则路径 ${legacyAbs} 是目录而非文件，保留不动。`);
          return;
        }
        if (opts.keepRouter) {
          console.warn(`  ⚠️ WARN ${label}: --keep-router 保留旧规则文件 ${legacyAbs}（双份常驻规则可能同时生效）。`);
          return;
        }
        run.captureFile(target.name, legacyAbs, relLegacy, true);
        rmSync(legacyAbs, { force: true });
        this.undo.push({ type: 'file-restore', rel: relLegacy, payload: run.payloadFor(relLegacy).payload });
        console.log(`  🔄 [MIGRATE] ${label}: 备份后移除旧 superpowers-zh 规则文件 -> ${legacyAbs}`);
      }
    },
    checkFault(stage) {
      const v = process.env.JEVZH_FAULT;
      if (!v) return;
      const [s, alias] = v.split(':');
      if (s !== stage || !alias) return;
      const wanted = TOOL_ALIASES[alias.toLowerCase()];
      if (wanted && wanted === target.name) {
        throw new Error(`JEVZH_FAULT 注入：${stage} 阶段故意失败（${target.name}）`);
      }
    },
    async rollback(err) {
      console.warn(`  ↩️  [回滚] ${target.name} 事务失败（${err && err.message ? err.message : err}）：恢复该目标改动前状态…`);
      for (const change of [...this.undo].reverse()) {
        try {
          const abs = resolve(baseDir, change.rel);
          if (!isInsideDir(baseDir, abs)) continue;
          if (change.type === 'file-delete') {
            let s;
            try { s = lstatSync(abs); } catch { s = null; }
            if (s && (s.isFile() || s.isSymbolicLink())) rmSync(abs, { force: true });
          } else if (change.type === 'file-restore') {
            const src = resolve(run.root, change.payload);
            mkdirSync(dirname(abs), { recursive: true });
            copyFileSync(src, abs);
          } else if (change.type === 'dir-restore') {
            let s;
            try { s = lstatSync(abs); } catch { s = null; }
            if (s) {
              if (s.isSymbolicLink()) rmSync(abs, { force: true });
              else rmSync(abs, { recursive: true, force: true });
            }
            copyDirSync(resolve(run.root, change.payload), abs);
          } else if (change.type === 'dir-delete') {
            let s;
            try { s = lstatSync(abs); } catch { s = null; }
            if (s) {
              if (s.isSymbolicLink()) rmSync(abs, { force: true });
              else rmSync(abs, { recursive: true, force: true });
            }
          } else if (change.type === 'section-remove') {
            if (existsSync(abs) && lstatSync(abs).isFile()) {
              const text = readFileSync(abs, 'utf8');
              const cut = cutPairedSections(text, OUR_BEGIN_RE, SENTINEL_END, { onlyTarget: change.target });
              if (cut.cut && !cut.malformed) writeOrDelete(abs, cut.text, '');
            }
          }
        } catch (e) {
          console.warn(`  ⚠️ [回滚] 恢复 ${change.rel} 失败：${e.message}（请从 .jevzh/backups 手工恢复）`);
        }
      }
      for (const rel of this.emptyDirs) {
        try {
          const abs = resolve(baseDir, rel);
          if (!existsSync(abs)) mkdirSync(abs, { recursive: true });
        } catch {}
      }
      run.dropTarget(target.name);
      // 清空本事务产生的空目录（向上修剪但绝不越过 baseDir）
      const roots = [...this.pruneRoots];
      for (const change of this.undo) {
        const d = dirname(resolve(baseDir, change.rel));
        if (!roots.includes(d)) roots.push(d);
      }
      for (let d0 of roots) {
        let d = d0;
        for (let guard = 0; guard < 12; guard++) {
          if (!isInsideDir(baseDir, d) || resolve(d) === resolve(baseDir)) break;
          if (this.preExistingDirs.has(resolve(d))) break; // 事务前存量目录保留
          try {
            if (existsSync(d) && lstatSync(d).isDirectory() && readdirSync(d).length === 0) {
              // Windows 下 recursive:false 删目录会抛 EISDIR（POSIX 为 EPERM）；
              // 已确认目录为空，recursive:true 等价于 rmdir 且跨平台可用。
              rmSync(d, { recursive: true, force: true });
            } else break;
          } catch { break; }
          d = dirname(d);
        }
      }
    },
    validate() {
      // 哨兵成对、JSON 可解析、无半写临时文件。
      for (const change of this.undo) {
        const abs = resolve(baseDir, change.rel);
        if (change.rel.endsWith('.md') && existsSync(abs)) {
          const text = readFileSync(abs, 'utf8');
          const b = (text.match(new RegExp(OUR_BEGIN_RE.source, 'g')) || []).length;
          const e2 = countOccurrences(text, SENTINEL_END);
          if (b !== e2) throw new Error(`校验失败：${change.rel} 哨兵不成对（begin=${b}, end=${e2}）`);
        }
        if (/settings.*\.json$|hooks\.json$/.test(change.rel) && existsSync(abs)) {
          JSON.parse(readFileSync(abs, 'utf8'));
        }
        const dirOf = dirname(abs);
        if (existsSync(dirOf)) {
          for (const junk of readdirSync(dirOf)) {
            if (/^\.[^.]+\.[0-9a-f]{16}\.tmp$/.test(junk)) throw new Error(`校验失败：残留临时文件 ${resolve(dirOf, junk)}`);
          }
        }
      }
    },
  };
  return tx;
}

// hooks settings 接线阶段（事务内；--keep-router/--no-jev 跳过）。
function installSettingsForTarget(tx, plan) {
  const { target, baseDir, isGlobal, opts, run } = tx;
  if (opts.noJev || opts.keepRouter) return;
  for (const host of plan.hosts) {
    if (host.status === 'blocked' || host.status === 'keep') continue;
    const chosen = chooseSettingsCandidate(baseDir, host);
    const hooksAbsDir = resolve(baseDir, host.hooksRel);
    let cfg = {};
    if (existsSync(chosen.abs)) cfg = JSON.parse(readFileSync(chosen.abs, 'utf8'));
    const merged = mergeHooksConfig(cfg, host.schema, hooksAbsDir);
    const data = JSON.stringify(merged.cfg, null, 2) + '\n';
    const existed = tx.modifyOrCreateFile(chosen.abs, relFromBase(baseDir, chosen.abs), data);
    // 校验：三类事件均已接线且 JSON 可解析
    JSON.parse(data);
    const wired = wiredEvents(merged.cfg, host.schema);
    if (wired.size !== HOOK_EVENTS.length) {
      throw new Error(`校验失败：${chosen.rel} hooks 接线不完整（${[...wired].join(',') || '无'}）`);
    }
    console.log(`  🔄 ${target.name}: hooks 已${existed ? '合并接线' : '接线（新建）'} -> ${chosen.abs}${merged.rewrites.length ? `（改写 ${merged.rewrites.length} 条 jev 旧引用）` : ''}`);
  }
}

// 故障点常量在各阶段之间触发（JEVZH_FAULT=<stage>:<alias>，仅测试注入）。
function runBootstrapsForTarget(target, baseDir, isGlobal, opts) {
  if (target.name === 'Trae') generateTraeBootstrapRule(baseDir, opts);
  if (target.name === 'Qoder') generateQoderBootstrap(baseDir, isGlobal, opts);
  if (target.name === 'Antigravity') generateAntigravityBootstrap(baseDir, isGlobal, opts);
  if (target.name === 'Aider') generateAiderBootstrap(baseDir, opts);
  if (target.name === 'Gemini CLI') generateGeminiBootstrap(baseDir, isGlobal, opts);
  if (target.name === 'Qwen Code') generateQwenBootstrap(baseDir, isGlobal, opts);
  if (target.name === 'VS Code') generateVSCodeBootstrap(baseDir, opts);
  if (target.name === 'Claw Code') generateClawBootstrap(baseDir, opts);
  if (target.name === 'Hermes Agent') generateHermesBootstrap(baseDir, isGlobal, opts);
  if (target.name === 'Claude Code') generateClaudeCodeBootstrap(baseDir, isGlobal, opts);
  if (target.name === 'CodeBuddy') generateCodeBuddyBootstrap(baseDir, isGlobal, opts);
  if (target.name === 'DeepSeek Harness') generateDeepSeekHarnessBootstrap(baseDir, isGlobal, opts);
  if (target.name === 'Reasonix' && !isGlobal) generateReasonixBootstrap(baseDir, opts);
  if (target.name === 'Kiro') generateKiroSteeringIndex(baseDir, opts);
  if (target.name === 'Cline') generateClineBootstrapRule(baseDir, opts);
  if (target.name === 'Kilo Code') generateKiloCodeBootstrapRule(baseDir, opts);
}

async function runTargetTransaction(plan, baseDir, opts, run) {
  const { target, isGlobal } = plan;
  // S-7：重定向的 dirWin 全局目标，事务护栏根/技能 rel 根切到目标文件根；
  // router/hooks 仍走 home（这两个 target 本就没有这些载体，传 home 为空操作）。
  const txBase = globalTargetFileBase(target, isGlobal, baseDir);
  const tx = createTargetTransaction(run, target, txBase, isGlobal, opts);
  ACTIVE_TX = tx;
  try {
    // 阶段 1：技能
    installSkillsForTarget(target, txBase, isGlobal, opts, plan, run);
    tx.checkFault('post-skills');
    // 阶段 2：router/bootstrap
    runBootstrapsForTarget(target, baseDir, isGlobal, opts);
    tx.checkFault('post-router');
    // 阶段 3：hooks 运行时 + settings 接线
    if (!opts.noJev) {
      installHooksForTarget(target, baseDir, tx);
      installSettingsForTarget(tx, plan);
      tx.checkFault('post-settings');
    }
    tx.validate();
    return { ok: true, tx };
  } catch (err) {
    await tx.rollback(err);
    return { ok: false, tx, error: err };
  } finally {
    ACTIVE_TX = null;
  }
}

// ===========================================================================
// doctor：只读诊断（竞品来源 / router 归属 / SKIP 残留 / hooks / 就绪 / 备份）
// ===========================================================================
async function doctor(forceToolName, opts) {
  const isGlobal = !!opts.isGlobal;
  const baseDir = isGlobal ? homedir() : PROJECT_DIR;
  const plans = [];
  let pool;
  if (forceToolName) {
    const t = TARGETS.find(x => x.name === forceToolName);
    if (!t) return 64;
    pool = [t];
  } else {
    pool = (isGlobal ? GLOBAL_TARGETS : PROJECT_TARGETS).filter(t => {
      const dm = isGlobal ? t.global.detect : t.detect;
      const ds = Array.isArray(dm) ? dm : [dm];
      return ds.some(d => existsSync(resolve(baseDir, d)));
    });
  }
  console.log(`\n  jevzh doctor v${PKG.version}（${isGlobal ? '全局' : '项目级'}；只读，不写盘）  目标: ${baseDir}\n`);
  if (pool.length === 0) {
    console.log('  未检测到任何已知工具标记；可指定：npx jevzh doctor --tool claude');
    return 0;
  }

  let hasBlock = false;
  let hasWarn = false;

  for (const target of pool) {
    const plan = preflightTarget(target, baseDir, isGlobal, { noJev: !!opts.noJev });
    plans.push(plan);
    console.log(`  ── ${target.name} ──`);

    for (const b of plan.blocks) {
      if (b.kind === 'plugin') {
        hasBlock = true;
        console.log(`  [BLOCK] 竞品插件启用记录：${b.file} -> ${b.name}`);
        console.log(`          请先在宿主内卸载/禁用该插件（例如 Claude Code 会话内执行：/plugin uninstall ${b.name.split('（')[0]}；`
          + 'Cursor 在扩展/MCP 管理页禁用），再重跑 npx jevzh。');
      }
      if (b.kind === 'settings-corrupt') {
        // doctor 分级：插件启用才是 exit 2；坏 JSON 是可修复的安装阻断项，exit 1。
        hasWarn = true;
        console.log(`  [问题] hooks 设置文件损坏：${b.file} 不是合法 JSON（安装时该目标会 BLOCK 不写盘）`);
        console.log(`          修复 JSON 后重跑 npx jevzh --tool ${shortestAlias(target.name) || 'claude'}（安装器会读改写合并，绝不静默覆盖）。`);
      }
    }
    for (const e of plan.errors) {
      if (e.kind === 'link-container') {
        hasWarn = true;
        console.log(`  [WARN] 技能容器是符号链接/junction：${e.path}（防穿越，安装器不会写入）`);
      }
    }

    // 技能来源与完整性
    const relDir = isGlobal ? globalRelDir(target) : target.dir;
    const skillsDir = relDir ? resolve(baseDir, relDir) : null;
    if (skillsDir && existsSync(skillsDir)) {
      let oursCount = 0;
      for (const name of listSourceSkillNames()) {
        const d = resolve(skillsDir, name);
        if (!existsSync(d)) continue;
        const c = classifySkillSource(d);
        if (c.source === 'ours') {
          oursCount++;
          const body = readSkillBody(d);
          if (!body || body.trim() === '') {
            hasWarn = true;
            console.log(`  [WARN] 本包技能 ${name} 不完整：SKILL.md 缺失/为空（meta 与文件不符）`);
            console.log(`          修复：npx jevzh --tool ${shortestAlias(target.name) || 'claude'}（预检会判定自升级并修复重装）`);
          } else if (c.version && compareVersions(c.version, PKG.version) < 0) {
            hasWarn = true;
            console.log(`  [WARN] 本包技能 ${name} 版本陈旧：v${c.version} < v${PKG.version}，建议 npx jevzh 重跑自升级`);
          }
        } else if (c.source === 'zh' || c.source === 'jev' || c.source === 'obra') {
          hasWarn = true;
          console.log(`  [SKIP 残留] ${name}：来源 ${sourceLabel(c.source)}（未接管；--adopt-skills 可备份后接管）`);
        } else if (c.source === 'unknown') {
          let st;
          try { st = lstatSync(d); } catch { st = null; }
          if (st && st.isDirectory() && !st.isSymbolicLink() && readdirSync(d).length > 0) {
            hasWarn = true;
            console.log(`  [SKIP 残留] ${name}：来源不明的同名目录（最保守保留；确认可替换用 --adopt-skills）`);
          }
        }
      }
      if (oursCount > 0) console.log(`  [OK]   本管技能 ${oursCount} 个，归属：jev-superpowers-zh -> ${relDir}`);
    }

    // router 归属（含悬空 R8）
    const desc = routerDescriptor(target, isGlobal);
    if (desc) {
      for (const rel of desc.shared || []) {
        const abs = resolve(baseDir, rel);
        if (!existsSync(abs)) continue;
        const st = analyzeRouterText(readFileSync(abs, 'utf8'));
        if (st.danglingOurs || st.danglingZh) {
          hasWarn = true;
          console.log(`  [WARN] router 文件 ${rel}：存在悬空哨兵（begin 有、end 缺/不配对），安装器不会接管该文件`);
          console.log('          请手工补齐/删除成对标记后重跑 npx jevzh；卸载切除同样会跳过畸形文件。');
        } else if (st.oursTargets.length) {
          console.log(`  [OK]   router 归属 jev-superpowers-zh：${rel}（target 区块：${st.oursTargets.join('、') || '未标注'}）`);
        }
        if (st.hasCompetitor && !st.danglingOurs && !st.danglingZh) {
          hasWarn = true;
          console.log(`  [SKIP 残留] router 文件 ${rel}：仍含竞品引导段（superpowers-zh/jev/obra）`);
          console.log(`          接管：npx jevzh --tool ${shortestAlias(target.name) || 'claude'}（备份后切除，用户内容保留）；保留现状加 --keep-router`);
        }
      }
      for (const s of desc.standalone || []) {
        if (existsSync(resolve(baseDir, s.legacyRel))) {
          hasWarn = true;
          console.log(`  [SKIP 残留] 旧规则文件 ${s.legacyRel}（重跑安装可备份后移除；--keep-router 保留）`);
        }
        if (existsSync(resolve(baseDir, s.oursRel))) {
          console.log(`  [OK]   router 归属 jev-superpowers-zh：${s.oursRel}`);
        }
      }
    }

    // hooks：运行时 + 配置合法性/合并状态
    if (target.hooks && !opts.noJev) {
      const hookDest = resolve(baseDir, target.hooks);
      if (existsSync(hookDest)) {
        const present = hookRuntimeFiles(target).filter(f => existsSync(resolve(hookDest, f)));
        console.log(`  [OK]   hooks 运行时：${target.hooks}（${present.length}/${hookRuntimeFiles(target).length} 个文件）`);
      }
      for (const host of settingsHostsForTarget(target)) {
        for (const rel of host.candidates) {
          const abs = resolve(baseDir, rel);
          if (!existsSync(abs)) continue;
          try {
            const cfg = JSON.parse(readFileSync(abs, 'utf8'));
            const wired = wiredEvents(cfg, host.schema);
            if (wired.size === HOOK_EVENTS.length) {
              console.log(`  [OK]   hooks 已接线：${rel}（session-start/pre-commit/stop 三类事件齐全）`);
            } else {
              hasWarn = true;
              console.log(`  [WARN] hooks 未完全接线：${rel}（已接：${[...wired].join(',') || '无'}），重跑 npx jevzh 自动合并`);
            }
          } catch {
            hasWarn = true;
            console.log(`  [问题] ${rel} JSON 不合法（安装时该目标会因此 BLOCK，避免覆盖你的配置）：修复后重跑 npx jevzh`);
          }
        }
      }
    }
  }

  // 项目配置 .jevzh.json 健康度（R-1：computeReadinessFallback 对坏 JSON 静默按默认
  // 取值，doctor 必须把该问题显式报告出来：门禁将按默认配置运行，exit 走 WARN 级）。
  if (!isGlobal) {
    const cfgPath = resolve(baseDir, '.jevzh.json');
    if (existsSync(cfgPath)) {
      try {
        const c = JSON.parse(readFileSync(cfgPath, 'utf8'));
        if (!c || typeof c !== 'object' || Array.isArray(c)) throw new Error('顶层不是 JSON 对象');
      } catch (e) {
        hasWarn = true;
        console.log(`  [问题] 配置文件损坏：${cfgPath} 不是合法 JSON（${e.message}）。`);
        console.log('          门禁将按默认配置运行（backend=auto、软降级开启，不会读取其中的 strict/baseUrl）；'
          + `修复 JSON 语法或删除该文件后重跑 npx jevzh 可重新生成。`);
      }
    }
  }

  // 就绪四态（spawn bash 仓内 scripts/jev-readiness --json；bash 缺失优雅降级 Node 版）
  if (!opts.noJev) {
    const r = await probeReadiness(baseDir, isGlobal, !!opts.strict);
    console.log(`  ── 门禁就绪（${r.source}）──`);
    console.log(`  状态：${r.data.state}；后端：${r.data.backend}；strict=${r.data.strict ? 'true' : 'false'}`);
    const missing = r.data.missingTools || [];
    if (missing.length) console.log(`  缺失门禁工具：${missing.join(', ')}（软降级；各门独立转标准中文技能）`);
    else console.log('  门禁工具：6/6 就绪');
  }

  // 备份清单
  const bkRoot = backupsRootFor(baseDir);
  let bks = [];
  try {
    bks = readdirSync(bkRoot, { withFileTypes: true })
      .filter(e => e.isDirectory() && BACKUP_TS_RE.test(e.name))
      .map(e => e.name).sort();
  } catch {}
  console.log('  ── 备份与恢复 ──');
  if (!bks.length) {
    console.log('  暂无接管备份（纯补缺/幂等运行不产生备份）。');
  } else {
    for (const ts of bks) {
      let m = null;
      try { m = JSON.parse(readFileSync(resolve(bkRoot, ts, 'manifest.json'), 'utf8')); } catch {}
      const kind = m ? m.kind : '?';
      const targets = m ? m.targets.map(t => t.target).join(',') : '?';
      console.log(`  · ${ts}  [${kind}]  targets: ${targets}`);
    }
    console.log(`  恢复：npx jevzh restore ${bks[bks.length - 1]}（先列清单：npx jevzh restore --list）`);
  }

  if (hasBlock) {
    console.log('\n  doctor 结论：存在 BLOCK 项（见上），必须先处理后才能安装该目标。\n');
    return 2;
  }
  if (hasWarn) {
    console.log('\n  doctor 结论：存在 WARN/SKIP 残留项（见上），按建议命令处理；不影响现有方法论使用。\n');
    return 1;
  }
  console.log('\n  doctor 结论：已安装目标健康。\n');
  return 0;
}

// ===========================================================================
// restore：离线恢复（恢复前自动再备一份当前状态；不依赖网络）
// ===========================================================================
function listBackups(baseDir) {
  const bkRoot = backupsRootFor(baseDir);
  let entries;
  try {
    entries = readdirSync(bkRoot, { withFileTypes: true })
      .filter(e => e.isDirectory() && BACKUP_TS_RE.test(e.name))
      .map(e => e.name).sort();
  } catch { entries = []; }
  return entries;
}

function printBackupList(baseDir) {
  const bks = listBackups(baseDir);
  console.log(`\n  备份目录：${backupsRootFor(baseDir)}\n`);
  if (!bks.length) {
    console.log('  （暂无备份）');
    return;
  }
  for (const ts of bks) {
    let m = null;
    try { m = JSON.parse(readFileSync(resolve(backupsRootFor(baseDir), ts, 'manifest.json'), 'utf8')); } catch {}
    const kind = m ? m.kind : 'manifest 不可读';
    const version = m ? m.version : '?';
    const targets = m ? m.targets.map(t => `${t.target}(${t.entries.length} 项)`).join(', ') : '?';
    console.log(`  ${ts}  [${kind}] v${version}  ${targets}`);
  }
  console.log(`\n  恢复命令：npx jevzh restore <时间戳>`);
}

// restore 预演校验：只读取备份目录，绝不触碰活文件（在 pre-restore 自动备份与任何
// 删除之前调用）。
//   - 新备份（file 条目带 sha256）：载荷存在 + 类型正确 + size + sha256 全核对；
//   - legacy 备份（条目无 sha256，旧版升级后留存）：legacyWeak=true，能核对 size
//     就核对，.json 目标额外 JSON.parse 校验——绝不因兼容旧备份而跳过所有校验；
//   - dir 条目：载荷目录存在，manifest 声明的 files 清单逐个存在。
// 返回 { legacyWeak, failures }；failures[0] 即首个不符项（中文报告用）。
function verifyBackupPayloads(src, entries) {
  const failures = [];
  let legacyWeak = false;
  for (const e of entries) {
    if (e.existed !== true) continue;
    const relPath = e.relPath;
    if (!e.payload) {
      failures.push({ relPath, reason: '备份缺少载荷路径（manifest 声明 existed 却无 payload）' });
      continue;
    }
    const payloadAbs = resolve(src, e.payload);
    let st;
    try { st = lstatSync(payloadAbs); } catch { st = null; }
    if (!st) { failures.push({ relPath, reason: `载荷不存在：${e.payload}` }); continue; }
    if (e.kind === 'dir') {
      if (!st.isDirectory()) { failures.push({ relPath, reason: `载荷类型不符：${e.payload} 不是目录` }); continue; }
      if (Array.isArray(e.files)) {
        const missing = e.files.find(f => !existsSync(resolve(payloadAbs, f)));
        if (missing) failures.push({ relPath, reason: `目录载荷不完整，缺少：${e.payload}/${missing}` });
      }
      continue;
    }
    if (!st.isFile()) { failures.push({ relPath, reason: `载荷类型不符：${e.payload} 不是文件` }); continue; }
    if (e.sha256) {
      const got = fileIntegrity(payloadAbs);
      if (typeof e.size === 'number' && got.size !== e.size) {
        failures.push({ relPath, reason: `载荷大小不匹配：期望 ${e.size} 字节，实际 ${got.size} 字节` });
        continue;
      }
      if (got.sha256 !== e.sha256) {
        failures.push({
          relPath,
          reason: `载荷 sha256 不匹配：期望 ${e.sha256.slice(0, 16)}…，实际 ${got.sha256.slice(0, 16)}…`,
        });
      }
    } else {
      legacyWeak = true; // 旧备份：无完整性哈希，仅做弱校验
      if (typeof e.size === 'number' && st.size !== e.size) {
        failures.push({ relPath, reason: `载荷大小不匹配（弱校验）：期望 ${e.size} 字节，实际 ${st.size} 字节` });
        continue;
      }
      if (/\.json$/i.test(relPath)) {
        try { JSON.parse(readFileSync(payloadAbs, 'utf8')); }
        catch (err) { failures.push({ relPath, reason: `JSON 目标无法解析（弱校验）：${err.message}` }); }
      }
    }
  }
  return { legacyWeak, failures };
}

// restore 写后复核：每个 existed 条目按其声明的完整性重新核对活文件；
// 新备份比 sha256（+size），legacy 仅比 size，目录比文件清单齐全。
function verifyRestoredEntries(absFor, entries) {
  const failures = [];
  for (const e of entries) {
    if (e.existed !== true) continue;
    const abs = absFor(e);
    let st;
    try { st = lstatSync(abs); } catch { st = null; }
    if (!st) { failures.push({ rel: e.relPath, reason: '恢复后目标不存在' }); continue; }
    if (e.kind === 'dir') {
      if (!st.isDirectory()) { failures.push({ rel: e.relPath, reason: '恢复后目标不是目录' }); continue; }
      if (Array.isArray(e.files)) {
        const missing = e.files.find(f => !existsSync(resolve(abs, f)));
        if (missing) failures.push({ rel: e.relPath, reason: `恢复后目录不完整，缺少：${missing}` });
      }
      continue;
    }
    if (!st.isFile()) { failures.push({ rel: e.relPath, reason: '恢复后目标不是文件' }); continue; }
    const got = fileIntegrity(abs);
    if (e.sha256) {
      if (got.sha256 !== e.sha256) {
        failures.push({
          rel: e.relPath,
          reason: `写后 sha256 不一致：期望 ${e.sha256.slice(0, 16)}…，实际 ${got.sha256.slice(0, 16)}…`,
        });
      }
    } else if (typeof e.size === 'number' && got.size !== e.size) {
      failures.push({ rel: e.relPath, reason: `写后大小不一致（弱校验）：期望 ${e.size} 字节，实际 ${got.size} 字节` });
    }
  }
  return failures;
}

function restore(tsArg, opts) {
  const isGlobal = !!opts.isGlobal;
  const baseDir = isGlobal ? homedir() : PROJECT_DIR;
  if (!tsArg || tsArg === '--list') {
    printBackupList(baseDir);
    return 0;
  }
  if (!BACKUP_TS_RE.test(tsArg)) {
    console.error(`  ❌ 时间戳格式不合法：${tsArg}（用 npx jevzh restore --list 查看可用备份）`);
    return 64;
  }
  const bkRoot = backupsRootFor(baseDir);
  const src = resolve(bkRoot, tsArg);
  if (!existsSync(src)) {
    console.error(`  ❌ 找不到备份：${src}`);
    printBackupList(baseDir);
    return 1;
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(resolve(src, 'manifest.json'), 'utf8'));
  } catch (e) {
    console.error(`  ❌ 备份 manifest 损坏：${e.message}`);
    return 1;
  }

  const onlyTarget = opts.toolArg ? (TOOL_ALIASES[String(opts.toolArg).toLowerCase()] || null) : null;
  const targetGroups = manifest.targets.filter(t => !onlyTarget || t.target === onlyTarget);
  if (!targetGroups.length) {
    console.error(`  ❌ 备份 ${tsArg} 中没有目标 ${opts.toolArg || ''} 的条目。`);
    return 1;
  }

  const entries = [];
  for (const g of targetGroups) {
    for (const e of g.entries) {
      if (!entries.some(x => x.relPath === e.relPath)) entries.push({ ...e, target: g.target });
    }
  }

  // ── 预演校验（任何删除/自动备份之前；只读备份目录，活文件零触碰）──
  const verify = verifyBackupPayloads(src, entries);
  if (verify.legacyWeak) {
    console.warn('  ⚠️ WARN 旧备份无完整性哈希（sha256），仅做弱校验（size 核对 + JSON 目标可解析）；'
      + '弱校验无法识别同尺寸篡改。');
  }
  if (verify.failures.length > 0) {
    const f = verify.failures[0];
    console.error(`  ❌ 备份完整性校验失败：${f.relPath} ${f.reason}`);
    console.error('     恢复已整体中止：未删除/覆盖任何活文件（也未创建 pre-restore 备份）。'
      + '请修复备份后重试，或改用其他时间戳：npx jevzh restore --list');
    return 1;
  }

  // 恢复前再备一份当前状态（pre-restore 安全网，轮转保留最近 3 份）。
  const safety = createBackupRun(baseDir, isGlobal, 'pre-restore', { restoreOf: tsArg });
  for (const e of entries) {
    if (e.existed) {
      const abs = restoreEntryAbs(baseDir, e.target, e.relPath);
      if (existsSync(abs) || lstatSafe(abs)) {
        // 目录条目必须走 captureDir（captureFile 的 copyFileSync 遇目录会 EPERM/EISDIR）。
        if (e.kind === 'dir') safety.captureDir(e.target, abs, e.relPath);
        else safety.captureFile(e.target, abs, e.relPath, true);
      }
    }
  }
  const safetyTs = safety.finalize();

  const absFor = (e) => restoreEntryAbs(baseDir, e.target, e.relPath);
  const entryRootFor = (abs, e) => {
    const homeRoot = resolve(baseDir);
    if (isInsideDir(homeRoot, abs)) return homeRoot;
    const t = TARGETS.find(x => x.name === e.target);
    if (t && t.global && process.platform === 'win32' && t.global.dirWin) {
      const gAbs = globalRelDir(t);
      if (gAbs && isAbsolute(gAbs)) return resolve(gAbs, '..');
    }
    return homeRoot;
  };

  console.log(`\n  恢复 ${tsArg}（${entries.length} 项；恢复前已再备一份当前状态）→ ${baseDir}\n`);
  let restored = 0;
  for (const e of entries) {
    const abs = absFor(e);
    const entryRoot = entryRootFor(abs, e);
    if (!isInsideDir(entryRoot, abs)) {
      console.warn(`  ⚠️ 跳过越界路径：${e.relPath}`);
      continue;
    }
    let st;
    try { st = lstatSync(abs); } catch { st = null; }
    if (st && st.isSymbolicLink()) {
      console.warn(`  ⚠️ ${e.relPath} 当前是符号链接/junction，保留不恢复（防穿越）。`);
      continue;
    }
    if (e.existed === true) {
      const payloadAbs = resolve(src, e.payload);
      if (e.kind === 'dir') {
        if (st) rmSync(abs, { recursive: true, force: true });
        mkdirSync(abs, { recursive: true });
        copyDirSync(payloadAbs, abs);
      } else {
        // 先在内存读入已通过预演校验的载荷，原子 rename 覆盖活文件，
        // 避免「先删后拷」窗口被中断留下半截文件。
        const buf = readFileSync(payloadAbs);
        mkdirSync(dirname(abs), { recursive: true });
        if (st && st.isDirectory()) rmSync(abs, { recursive: true, force: true });
        atomicWriteFileSync(abs, buf);
      }
      console.log(`  ✅ 还原 ${e.relPath}`);
      restored++;
    } else {
      // 安装时新建的文件/目录：恢复即删除
      if (st) {
        if (st.isDirectory()) rmSync(abs, { recursive: true, force: true });
        else rmSync(abs, { force: true });
        console.log(`  ✅ 删除安装时新建 ${e.relPath}`);
        restored++;
      }
    }
  }
  // 修剪清空目录（重定向 dirWin 条目按其文件根向上修剪，不越过该根）
  for (const e of entries) {
    const abs = absFor(e);
    const root = entryRootFor(abs, e);
    let d = dirname(abs);
    for (let i = 0; i < 8; i++) {
      if (resolve(d) === root || !isInsideDir(root, d)) break;
      try {
        if (existsSync(d) && lstatSync(d).isDirectory() && readdirSync(d).length === 0) {
          // 已确认空目录；Windows 下 recursive:false 删目录抛 EISDIR。
          rmSync(d, { recursive: true, force: true });
        } else break;
      } catch { break; }
      d = dirname(d);
    }
  }

  // ── 写后复核：活文件必须与备份声明一致；不符 rc=1 并指向 pre-restore 回退 ──
  const postFailures = verifyRestoredEntries(absFor, entries);
  if (postFailures.length > 0) {
    const f = postFailures[0];
    console.error(`\n  ❌ 恢复后完整性复核失败：${f.relPath} ${f.reason}`);
    if (safetyTs) {
      console.error('     恢复前的当前状态已自动备份，可立即回退：'
        + `npx jevzh restore ${safetyTs}\n`);
    }
    return 1;
  }
  console.log(`\n  恢复完成：${restored} 项（写后完整性复核通过）。当前状态备份可在不满意时再次 restore。\n`);
  return 0;
}

function lstatSafe(p) {
  try { return lstatSync(p); } catch { return null; }
}

// ===========================================================================
// 就绪探测三修（S-10/S-11）：spawn bash 仓内 jev-readiness --json、整体超时、
// 非 JSON 200 不判 laya、输出 URL 抹除 userinfo。
// ===========================================================================
function classifyHealth(health) {
  if (!health || typeof health !== 'object') return 'none';
  if (health.laya_installed === true) return 'laya';
  if (health.laya_installed === false) return 'heuristic';
  return 'none';
}

function redactUrl(urlString) {
  let u;
  try { u = new URL(urlString); } catch {
    return String(urlString).replace(/(^[a-z]+:\/\/)[^/@]*@/i, '$1***@');
  }
  if (u.username || u.password) {
    u.username = '***';
    u.password = '***';
  }
  return u.toString();
}

function readinessScriptPath() {
  // JEVZH_TEST_READINESS_SCRIPT：仅供测试把权威脚本替换为可注入的 stub（生产
  // 环境未设置时恒为仓内 scripts/jev-readiness）。
  return process.env.JEVZH_TEST_READINESS_SCRIPT
    ? resolve(process.env.JEVZH_TEST_READINESS_SCRIPT)
    : resolve(__dirname, '..', 'scripts', 'jev-readiness');
}

// Git for Windows 固定安装路径（与 hooks/run-hook.cmd 的查找顺序一致）：
// 企业环境 PATH 上常常只有 WSL 的 bash.exe 存根（未装发行版时退出 127），
// 直接 spawn 'bash' 会误判「不可用」。
const GIT_BASH_FIXED_PATHS = [
  'C:\\Program Files\\Git\\bin\\bash.exe',
  'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
];
// 权威脚本实测冷启动 5.7~6.0s（node 多次自举）；旧 4s 超时会把成功运行误降级。
const READINESS_TIMEOUT_MS = Number(process.env.JEVZH_TEST_READINESS_TIMEOUT_MS) || 15000;
// 探活单次 5s（Git Bash 冷启动实测 0.2~0.5s；留足高负载余量），失败再重试 1 次：
// 机器被并发任务打满时单次 spawn 可能超过 3s，重试可避免偶发误降级。
const BASH_PROBE_TIMEOUT_MS = 5000;
const BASH_PROBE_ATTEMPTS = 2;
const BASH_PROBE_MARKER = 'jevzh-bash-ok';

// bash 候选（按优先级）：
//   Windows：Git for Windows 两个固定路径 -> PATH 上的 bash；
//   POSIX：PATH 上的 bash。
// JEVZH_TEST_BASH：测试/排障注入，强制只使用给定可执行文件。
function bashCandidates() {
  const forced = process.env.JEVZH_TEST_BASH;
  // '__none__' 测试约定：强制「无任何候选 bash」，用于覆盖 not-found 分支。
  if (forced === '__none__') return [];
  if (forced) return [forced];
  const list = [];
  if (process.platform === 'win32') {
    for (const p of GIT_BASH_FIXED_PATHS) {
      try { if (existsSync(p)) list.push(p); } catch {}
    }
  }
  if (process.platform !== 'win32' || isOnPath('bash')) list.push('bash');
  return list;
}

// JEVZH_TEST_BASH_ARGV：测试专用接缝——把「解释器 + 包装脚本」整体伪装成 bash
// （Windows 下 spawn 不能 shell:false 直跑 .cmd，而 node 需要脚本前缀才能应答 -c）。
// 值为 JSON argv 数组，如 ["<node.exe>","<fake-bash.mjs>"]；生产环境不设置即零行为。
// 返回 { exe, prefix } 或 null（未配置/配置非法）。
function forcedBashSpawn() {
  const raw = process.env.JEVZH_TEST_BASH_ARGV;
  if (!raw) return null;
  try {
    const a = JSON.parse(raw);
    if (Array.isArray(a) && a.length >= 2 && a.every(x => typeof x === 'string' && x.length > 0)) {
      return { exe: a[0], prefix: a.slice(1) };
    }
  } catch {}
  return null;
}

// 探活：-c 输出固定标记且退出码 0。PATH 上的 WSL 存根（无发行版 -> 127）、
// 任何非 bash 可执行文件都过不了这一关。prefix 为测试包装脚本前缀（生产恒为空）。
function probeBashLiveness(exe, prefix = []) {
  for (let attempt = 1; attempt <= BASH_PROBE_ATTEMPTS; attempt++) {
    let r;
    try {
      r = spawnSync(exe, [...prefix, '-c', `echo ${BASH_PROBE_MARKER}`], {
        encoding: 'utf8',
        timeout: BASH_PROBE_TIMEOUT_MS,
        windowsHide: true,
      });
    } catch {
      continue;
    }
    if (r && !r.error && r.status === 0 && String(r.stdout || '').includes(BASH_PROBE_MARKER)) {
      return true;
    }
  }
  return false;
}

// 返回首个探活通过的 bash；全失败时给出三态之一原因：
//   not-found     固定路径与 PATH 都没有 bash
//   probe-failed  候选存在但探活非 0/超时（WSL 存根等）
function resolveUsableBash() {
  const forcedSpawn = forcedBashSpawn();
  if (forcedSpawn) {
    const { exe, prefix } = forcedSpawn;
    if (isAbsolute(exe)) {
      try { if (!existsSync(exe)) return { ok: false, reason: 'probe-failed', candidates: [exe] }; }
      catch { return { ok: false, reason: 'probe-failed', candidates: [exe] }; }
    }
    if (probeBashLiveness(exe, prefix)) return { ok: true, exe, prefixArgs: prefix, candidates: [exe] };
    return { ok: false, reason: 'probe-failed', candidates: [exe] };
  }
  const candidates = bashCandidates();
  if (!candidates.length) return { ok: false, reason: 'not-found', candidates };
  for (const exe of candidates) {
    // 绝对路径候选必须真实存在；'bash'（PATH 查找）交给 spawn。
    if (exe !== 'bash' && isAbsolute(exe)) {
      try { if (!existsSync(exe)) continue; } catch { continue; }
    }
    if (probeBashLiveness(exe)) return { ok: true, exe, prefixArgs: [], candidates };
  }
  return { ok: false, reason: 'probe-failed', candidates };
}

// 优先 spawn bash 仓内权威脚本；区分三态降级文案：未找到 bash / bash 探活失败 /
// 脚本执行超时；输出非法时也回退 Node 轻量探测。
// 本次执行实际使用的就绪脚本超时（env 每次读取，便于测试注入）。
function readinessTimeoutMs() {
  return Number(process.env.JEVZH_TEST_READINESS_TIMEOUT_MS) || READINESS_TIMEOUT_MS;
}

async function probeReadiness(baseDir, isGlobal, strict) {
  const fallback = await computeReadinessFallback(baseDir, isGlobal, strict);
  const timeoutMs = readinessTimeoutMs();
  const found = resolveUsableBash();
  if (!found.ok) {
    const detail = found.reason === 'not-found'
      ? '未找到 bash（Git for Windows 固定路径与 PATH 均无 bash，跳过权威脚本）'
      : 'bash 探活失败（PATH 上可能是 WSL 存根/退出码非 0/探活超时，跳过权威脚本）';
    return { source: `Node 轻量探测（${detail}）`, data: fallback };
  }
  let bash;
  try {
    bash = spawnSync(found.exe,
      [...(found.prefixArgs || []), readinessScriptPath(), '--project', baseDir, '--json'], {
      encoding: 'utf8',
      timeout: timeoutMs,
      windowsHide: true,
    });
  } catch {
    return { source: 'Node 轻量探测（bash 就绪脚本启动异常）', data: fallback };
  }
  if (bash && bash.error && bash.error.code === 'ETIMEDOUT') {
    return {
      source: `Node 轻量探测（bash 就绪脚本执行超时（>${Math.round(timeoutMs / 1000)}s），改用 Node 同口径探测）`,
      data: fallback,
    };
  }
  if (!bash || bash.error || bash.status !== 0 || !bash.stdout) {
    return { source: 'Node 轻量探测（bash 就绪脚本执行失败）', data: fallback };
  }
  const lines = bash.stdout.split(/\r?\n/).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const j = JSON.parse(lines[i]);
      if (j && typeof j === 'object' && ['FULL', 'LOCAL', 'PARTIAL', 'DEGRADED'].includes(j.state)) {
        return {
          source: 'scripts/jev-readiness（bash 权威口径）',
          data: {
            ...fallback,
            state: j.state,
            backend: j.backend || fallback.backend,
            strict: typeof j.strict === 'boolean' ? j.strict : fallback.strict,
            missingTools: Array.isArray(j.missingTools) ? j.missingTools : fallback.missingTools,
          },
        };
      }
    } catch {}
  }
  return { source: 'Node 轻量探测（就绪脚本输出无法解析）', data: fallback };
}

// CLI 工具的可执行文件名 —— 检测落空时扫 PATH 给出针对性建议。
const CLI_PROBES = {
  'Claude Code':  ['claude', 'copilot'],
  'Codex CLI':    ['codex'],
  'Gemini CLI':   ['gemini'],
  'OpenCode':     ['opencode'],
  'Aider':        ['aider'],
  'Qwen Code':    ['qwen'],
  'OpenClaw':     ['openclaw'],
  'Claw Code':    ['claw'],
  'Crush':        ['crush'],
  'Hermes Agent': ['hermes'],
};

function isOnPath(bin) {
  const pathSep = process.platform === 'win32' ? ';' : ':';
  const dirs = (process.env.PATH || '').split(pathSep).filter(Boolean);
  const exts = process.platform === 'win32'
    ? ['', ...(process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)]
    : [''];
  for (const d of dirs) {
    for (const ext of exts) {
      try { if (existsSync(join(d, bin + ext))) return true; } catch {}
    }
  }
  return false;
}

function shortestAlias(toolName) {
  return Object.keys(TOOL_ALIASES)
    .filter(a => TOOL_ALIASES[a] === toolName)
    .sort((a, b) => a.length - b.length)[0];
}

// 工具名称别名映射（用户输入 -> TARGETS.name）
const TOOL_ALIASES = {
  'claude':       'Claude Code',
  'claude-code':  'Claude Code',
  'claudecode':   'Claude Code',
  'copilot':      'Claude Code',
  'copilot-cli':  'Claude Code',
  'cursor':       'Cursor',
  'codex':        'Codex CLI',
  'kiro':         'Kiro',
  'deerflow':     'DeerFlow',
  'trae':         'Trae',
  'trae-cn':      'TRAE CN',
  'traecn':       'TRAE CN',
  'trae-china':   'TRAE CN',
  'antigravity':  'Antigravity',
  'vscode':       'VS Code',
  'vs-code':      'VS Code',
  'openclaw':     'OpenClaw',
  'windsurf':     'Windsurf',
  'gemini':       'Gemini CLI',
  'gemini-cli':   'Gemini CLI',
  'aider':        'Aider',
  'opencode':     'OpenCode',
  'qwen':         'Qwen Code',
  'qwen-code':    'Qwen Code',
  'hermes':       'Hermes Agent',
  'hermes-agent': 'Hermes Agent',
  'claw':         'Claw Code',
  'claw-code':    'Claw Code',
  'clawcode':     'Claw Code',
  'qoder':        'Qoder',
  'codebuddy':    'CodeBuddy',
  'codebuddy-code': 'CodeBuddy',
  'codebuddycode': 'CodeBuddy',
  'codebuddy-cn': 'CodeBuddy',
  'codearts':     'CodeArts',
  'codeartsdoer': 'CodeArts',
  'codearts-doer': 'CodeArts',
  'huawei':       'CodeArts',
  'cline':        'Cline',
  'crush':        'Crush',
  'reasonix':     'Reasonix',
  'dsh':          'DeepSeek Harness',
  'deepseek':     'DeepSeek Harness',
  'deepseek-harness': 'DeepSeek Harness',
  'zcode':        'ZCode',
  'z-code':       'ZCode',
  'kilocode':     'Kilo Code',
  'kilo':         'Kilo Code',
  'kilo-code':    'Kilo Code',
};

function showHelp() {
  console.log(`
  jevzh v${PKG.version} — jev-superpowers-zh：中文超能力技能集 + jev 门禁（默认软降级）

  用法：
    npx jevzh                   项目级：自动检测工具并装到当前目录（27 技能 + hooks + .jevzh.json）
    npx jevzh --global          全局：装到用户级目录（如 ~/.claude/skills），所有项目共享
    npx jevzh --tool cursor     指定工具安装（检测不到时使用）
    npx jevzh --global -t claude 全局 + 指定工具
    npx jevzh --no-jev          纯中文技能形态：仅 21 个中文技能，不装 hooks、不生成 .jevzh.json
    npx jevzh --strict          新生成的 .jevzh.json 默认 strict:true（已存在的配置不覆盖）
    npx jevzh --uninstall       卸载当前目录（加 --global 卸载全局；.jevzh.json 默认保留）
    npx jevzh --force           允许在用户主目录(~)做项目级安装（默认拒绝）
    npx jevzh --detect-only      只做共存预检并打印五级处置矩阵，绝不写盘（有 BLOCK 时 exit 2）
    npx jevzh --adopt-skills     备份后接管同名他方技能（superpowers-zh/jev/obra/未知）
    npx jevzh --keep-router      保留旧发行版引导段/规则文件，不切除不合并 hooks 配置
    npx jevzh doctor             只读诊断（竞品/归属/SKIP 残留/hooks/就绪/备份）
    npx jevzh restore --list     列出接管备份（.jevzh/backups/<时间戳>，自动轮转留 3 份）
    npx jevzh restore <时间戳>   离线恢复（恢复前自动再备一份当前状态）
    npx jevzh --help            显示帮助
    npx jevzh --version         显示版本

  支持的工具名：
    ${Object.keys(TOOL_ALIASES).join(', ')}

  支持全局安装的工具（其余工具规则为项目级，--global 会提示改用项目级）：
    ${TARGETS.filter(t => t.global).map(t => t.name).join('、')}

  说明：
    默认安装：27 个 skills（21 个中文技能 + 6 个 jev-* 汉化门禁技能）+
              Claude Code/Cursor 的 hooks 运行时 + 项目根默认 .jevzh.json。
              同名技能/引导区块零覆盖仅补缺；检测到他方内容只 WARN 不动。
    --no-jev：仅 21 个中文技能，不接线 hooks、不生成配置（可再跑默认安装补缺）。
    项目级优先、全局兜底，二者可共存。

    卸载：
      npx jevzh --uninstall            清理当前项目（本包哨兵区块与本包技能副本）
      npx jevzh --global --uninstall   清理全局安装
      （.jevzh.json 默认保留；旧 superpowers-zh 哨兵段会被精确切除）

  项目与上游归属：
    jev-superpowers-zh  https://github.com/xiaoidev/jev-superpowers-zh
    安装器/中文方法论底座（fork）  https://github.com/jnMetaCode/superpowers-zh
    共同方法论上游               https://github.com/obra/superpowers
    门禁技能来源                 https://github.com/AkashPriyadarshii/jev-superpowers
`);
}

function installForTarget(target, baseDir, isGlobal, opts) {
  installSkillsForTarget(target, baseDir, isGlobal, opts);

  if (target.name === 'Trae') generateTraeBootstrapRule(baseDir, opts);
  if (target.name === 'Qoder') generateQoderBootstrap(baseDir, isGlobal, opts);
  if (target.name === 'Antigravity') generateAntigravityBootstrap(baseDir, isGlobal, opts);
  if (target.name === 'Aider') generateAiderBootstrap(baseDir, opts);
  if (target.name === 'Gemini CLI') generateGeminiBootstrap(baseDir, isGlobal, opts);
  if (target.name === 'Qwen Code') generateQwenBootstrap(baseDir, isGlobal, opts);
  if (target.name === 'VS Code') generateVSCodeBootstrap(baseDir, opts);
  if (target.name === 'Claw Code') generateClawBootstrap(baseDir, opts);
  if (target.name === 'Hermes Agent') generateHermesBootstrap(baseDir, isGlobal, opts);
  if (target.name === 'Claude Code') generateClaudeCodeBootstrap(baseDir, isGlobal, opts);
  if (target.name === 'CodeBuddy') generateCodeBuddyBootstrap(baseDir, isGlobal, opts);
  if (target.name === 'DeepSeek Harness') generateDeepSeekHarnessBootstrap(baseDir, isGlobal, opts);
  if (target.name === 'Reasonix' && !isGlobal) generateReasonixBootstrap(baseDir, opts);
  if (target.name === 'Kiro') generateKiroSteeringIndex(baseDir, opts);
  if (target.name === 'Cline') generateClineBootstrapRule(baseDir, opts);
  if (target.name === 'Kilo Code') generateKiloCodeBootstrapRule(baseDir, opts);

  if (!opts.noJev) installHooksForTarget(target, baseDir);
}

function isHomeDir(p) {
  const home = homedir();
  if (!home) return false;
  try {
    return realpathSync(p) === realpathSync(home);
  } catch { return resolve(p) === resolve(home); }
}

// 系统目录护栏（沿用基座 issue #125 经验）：管理员 PowerShell 默认 cwd 是
// System32，不拦就会把技能写进系统目录。不提供 --force 绕过。
function isSystemDir(p) {
  let real;
  try { real = realpathSync(p); } catch { real = resolve(p); }
  const home = (() => { try { return realpathSync(homedir()); } catch { return homedir(); } })();
  if (home && (real === home || real.startsWith(home + sep))) return false;

  try {
    const tmp = realpathSync(tmpdir());
    if (real === tmp || real.startsWith(tmp + sep)) return false;
  } catch {}

  const roots = process.platform === 'win32'
    ? [process.env.SystemRoot || 'C:\\Windows', process.env.ProgramFiles || 'C:\\Program Files',
       process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', process.env.ProgramData || 'C:\\ProgramData']
    : ['/usr', '/etc', '/bin', '/sbin', '/var', '/opt', '/System', '/Library', '/private/etc'];

  const norm = x => {
    let v = String(x).replace(/\\/g, '/').replace(/\/+$/, '');
    return process.platform === 'win32' ? v.toLowerCase() : v;
  };
  const r = norm(real);
  if (r === '') return true;
  if (process.platform === 'win32' && /^[a-z]:$/.test(r)) return true;
  return roots.some(root => {
    let rootReal;
    try { rootReal = realpathSync(root); } catch { rootReal = root; }
    const rr = norm(rootReal);
    return rr && (r === rr || r.startsWith(rr + '/'));
  });
}

// ---------------------------------------------------------------------------
// 卸载
// ---------------------------------------------------------------------------

// 本包独立规则文件（文件名带 jevzh，整文件删除安全）
const OUR_BOOTSTRAP_DELETE_PROJECT = [
  '.github/instructions/jevzh.instructions.md',
  '.trae/rules/jevzh.md',
  '.qoder/rules/jevzh.md',
  '.clinerules/jevzh.md',
  '.kilocode/rules/jevzh.md',
  '.kiro/steering/jevzh.md',
];
const OUR_BOOTSTRAP_DELETE_GLOBAL = ['.qoder/rules/jevzh.md'];

// 旧 superpowers-zh 独立规则文件：卸载时一并清理（迁移支持，spec §7.1）。
// 例外：.agents/rules.md 不在整删名单——它是多发行版共享的通用文件，且本包
// 安装已改为哨兵追加（见 installAgentsRules）；卸载只走下方 BOOTSTRAP_CLEAN
// 的哨兵/旧标题切除，用户自有内容必须保留（I-1：整删会误删从未装过 jevzh 的文件）。
const LEGACY_ZH_BOOTSTRAP_DELETE_PROJECT = [
  '.github/instructions/superpowers-zh.instructions.md',
  '.trae/rules/superpowers-zh.md',
  '.qoder/rules/superpowers-zh.md',
  '.clinerules/superpowers-zh.md',
  '.kilocode/rules/superpowers-zh.md',
  '.kiro/steering/superpowers-zh.md',
];
const LEGACY_ZH_BOOTSTRAP_DELETE_GLOBAL = ['.qoder/rules/superpowers-zh.md'];

// 需要按哨兵/标记切除区块的共享引导文件
const BOOTSTRAP_CLEAN_SECTION_PROJECT = [
  'CLAUDE.md',
  'GEMINI.md',
  'QWEN.md',
  'CLAW.md',
  'HERMES.md',
  'CONVENTIONS.md',
  'CODEBUDDY.md',
  'AGENTS.md',
  'REASONIX.md',
  '.agents/rules.md',
];
const BOOTSTRAP_CLEAN_SECTION_GLOBAL = [
  '.claude/CLAUDE.md',
  '.qwen/QWEN.md',
  '.codebuddy/CODEBUDDY.md',
  '.dsh/AGENTS.md',
];

function writeOrDelete(filePath, head, tail) {
  const headTrim = head.replace(/\s+$/, '');
  const tailTrim = tail.replace(/^\s+/, '');
  let body = headTrim;
  if (headTrim && tailTrim) body += '\n\n' + tailTrim;
  else body += tailTrim;
  body = body.replace(/\s+$/, '');
  if (body.length === 0) {
    rmSync(filePath);
  } else {
    atomicWriteFileSync(filePath, body + '\n');
  }
}

// 切除一段 begin/end 哨兵（精确配对）；返回切除后的文本与是否切除。
// S-2：配对区间内若再出现 begin（畸形嵌套/双 begin 单 end），无法判定用户内容边界，
// 返回 malformed=true，由调用方 WARN 并整文件保留，绝不吞掉区间里的用户内容。
function cutSentinelPair(content, begin, end) {
  let text = content;
  let cut = false;
  for (;;) {
    const i = text.indexOf(begin);
    if (i === -1) break;
    const j = text.indexOf(end, i + begin.length);
    if (j === -1) break;
    if (text.indexOf(begin, i + begin.length) !== -1
      && text.indexOf(begin, i + begin.length) < j) {
      return { text: content, cut: false, malformed: true };
    }
    text = text.slice(0, i) + text.slice(j + end.length);
    cut = true;
  }
  return { text, cut: cut || text !== content, malformed: false };
}

// v1.1.x 旧 zh 安装无哨兵，凭固定标题 + 段尾兜底识别切除（沿用基座逻辑）。
// S-1：除标题行本身外，切除区间还必须含至少一个高置信 zh 特征（品牌串 superpowers-zh
// 或 FALLBACK_TAIL_HINTS 尾句之一）；用户自写同名 H1 但无 zh 特征时不切，交 WARN 手工处理。
function cutLegacyZhMarkedSection(content) {
  let idx = -1;
  let matchedMarker = null;
  for (const marker of ZH_SECTION_MARKERS) {
    const i = content.indexOf(marker);
    if (i !== -1 && (idx === -1 || i < idx)) {
      idx = i;
      matchedMarker = marker;
    }
  }
  if (idx === -1) return { text: content, cut: false, unresolvable: false };

  let end = -1;
  const nextHeading = content.indexOf('\n# ', idx + 1);
  if (nextHeading !== -1) end = nextHeading + 1;

  if (end === -1) {
    for (const hint of FALLBACK_TAIL_HINTS) {
      const i = content.lastIndexOf(hint);
      if (i > idx) {
        const nl = content.indexOf('\n', i + hint.length);
        const after = nl !== -1 ? nl + 1 : content.length;
        if (after > end) end = after;
      }
    }
  }

  if (end === -1) return { text: content, cut: false, unresolvable: true };

  // 只检查标题行之后的区间，标题自身的 "Superpowers-ZH" 不算高置信特征。
  const region = content.slice(idx + matchedMarker.length, end);
  const hasHighConfidenceZh = region.toLowerCase().includes('superpowers-zh')
    || FALLBACK_TAIL_HINTS.some(hint => region.includes(hint));
  if (!hasHighConfidenceZh) return { text: content, cut: false, unresolvable: true };

  return { text: content.slice(0, idx) + content.slice(end), cut: true, unresolvable: false };
}

// onlyTarget 非空（R-3 单工具卸载）：只切 target 属性匹配的本包区块；
// 旧无属性本包段/旧 zh 段仅在文件不含其他 target 属性区块时一并清理（见函数内说明）。
function cleanBootstrapFile(filePath, onlyTarget = null) {
  if (!existsSync(filePath)) return false;
  const original = readFileSync(filePath, 'utf8');
  let text = original;
  let changed = false;

  // 单目标卸载：先看文件里是否存在「其他 target」的属性化区块。若存在（多 target 共存
  // 文件，如 S-9 的 AGENTS.md），只精确切除本 target 区块；若不存在，则文件里的无属性
  // 旧 begin / 旧 zh 哨兵 / 旧标题段都是多 target 化之前的遗物（如 CLAUDE.md 只可能
  // 属于 Claude），按全量口径一并清理，保持任务 6 的卸载兼容性。
  let attributedOther = false;
  if (onlyTarget) {
    const beginRe = new RegExp(OUR_BEGIN_RE.source, 'g');
    for (const m of original.matchAll(beginRe)) {
      const tn = markerTargetName(m[0]);
      if (tn && tn !== onlyTarget) { attributedOther = true; break; }
    }
  }
  const cutUntargeted = !!onlyTarget && !attributedOther;

  const ours = cutPairedSections(text, OUR_BEGIN_RE, SENTINEL_END, { onlyTarget, cutUntargeted });
  if (ours.malformed) {
    console.warn(`  ⚠️ WARN ${filePath}: jevzh 哨兵标记畸形（begin 重复/嵌套且无法可靠配对），`
      + '为避免误删用户内容已整文件跳过，请手工检查哨兵后重试。');
    return false;
  }
  text = ours.text;
  changed = changed || ours.cut;

  if (!onlyTarget || cutUntargeted) {
    const legacy = cutSentinelPair(text, ZH_SENTINEL_BEGIN, ZH_SENTINEL_END);
    if (legacy.malformed) {
      console.warn(`  ⚠️ WARN ${filePath}: 旧 superpowers-zh 哨兵标记畸形（begin 重复/嵌套且无法可靠配对），`
        + '为避免误删用户内容已整文件跳过，请手工检查哨兵后重试。');
      return false;
    }
    text = legacy.text;
    changed = changed || legacy.cut;

    const marked = cutLegacyZhMarkedSection(text);
    if (marked.unresolvable) {
      console.warn(`  ⚠️ WARN ${filePath}: 无法可靠识别旧 superpowers-zh 区段（同名标题但缺少品牌串/尾句等高置信特征，`
        + '或段尾不可判定），已跳过以避免数据丢失，请手动检查以 "Superpowers-ZH" 开头的整段。');
      return false;
    }
    text = marked.text;
    changed = changed || marked.cut;
  }

  if (!changed) return false;
  writeOrDelete(filePath, text, '');
  return true;
}

function uninstallSkillsForTarget(target, baseDir, isGlobal) {
  const relDir = isGlobal ? globalRelDir(target) : target.dir;
  if (!relDir) return 0;
  const dest = resolve(baseDir, relDir);
  // 用 lstat（不跟随）：悬空链接 existsSync 报 false，但链接本身仍在。
  let destStat;
  try { destStat = lstatSync(dest); } catch { return 0; }
  // 容器本身是链接（如 .claude/skills 是 junction 指向别处）：只摘链接本身，
  // 绝不 recursive —— 否则会删掉链接目标（可能在家目录/项目之外）里的全部文件。
  if (destStat.isSymbolicLink()) {
    console.warn(`  ⚠️ WARN ${target.name} 技能容器 ${dest} 本身是符号链接/junction：`
      + '仅摘除该链接（未使用递归），链接目标内的文件一律未触及，请自行确认目标内容。');
    rmSync(dest, { force: true });
    return 0;
  }
  const names = listSourceSkillNames();
  let removed = 0;
  for (const name of names) {
    const skillDir = resolve(dest, name);
    let skillStat;
    try { skillStat = lstatSync(skillDir); } catch { continue; }
    // 技能子目录是链接：WARN 并保留，绝不递归删外部；也不穿透读 meta 误判归属。
    if (skillStat.isSymbolicLink()) {
      console.warn(`  ⚠️ WARN ${skillDir} 是符号链接/junction，卸载保留该链接（不递归、不触及链接目标）。`);
      continue;
    }
    // 只删本包安装（带本包 meta）的同名技能副本；用户/他方同名目录绝不删。
    if (!isOurManaged(skillDir)) {
      console.warn(`  ⚠️ WARN ${skillDir} 非本包管理（无本包 .jevzh-meta.json），卸载保留不动。`);
      continue;
    }
    rmSync(skillDir, { recursive: true, force: true });
    removed++;
  }
  try {
    if (existsSync(dest)) {
      const left = readdirSync(dest).filter(n => n !== '.DS_Store');
      if (left.length === 0) rmSync(dest, { recursive: true, force: true });
    }
  } catch {}
  return removed;
}

// 卸载 hooks/scripts：只删与本包源字节一致的已安装文件，不同则 WARN 保留。
function uninstallOwnedDir(srcDir, destDir, fileNames, label) {
  let destStat;
  try { destStat = lstatSync(destDir); } catch { return; }
  // 容器（hooks/scripts）本身是链接：只摘链接本身，绝不递归触及目标。
  if (destStat.isSymbolicLink()) {
    console.warn(`  ⚠️ WARN ${label}: 目录 ${destDir} 本身是符号链接/junction：`
      + '仅摘除该链接（未使用递归），链接目标内的文件一律未触及。');
    rmSync(destDir, { force: true });
    return;
  }
  for (const name of fileNames) {
    const dst = resolve(destDir, name);
    let dstStat;
    try { dstStat = lstatSync(dst); } catch { continue; }
    // 同名条目是链接：保留链接本身（rm 虽只摘链，也不替用户决定），不穿透比较。
    if (dstStat.isSymbolicLink()) {
      console.warn(`  ⚠️ WARN ${label}: ${dst} 是符号链接/junction，卸载保留该链接（不触及链接目标）。`);
      continue;
    }
    const src = resolve(srcDir, name);
    if (existsSync(src) && filesEqual(src, dst)) {
      rmSync(dst, { force: true });
    } else {
      console.warn(`  ⚠️ WARN ${label}: ${dst} 已被改动或非本包文件，卸载保留不动。`);
    }
  }
  try {
    if (readdirSync(destDir).filter(n => n !== '.DS_Store').length === 0) {
      rmSync(destDir, { recursive: true, force: true });
    }
  } catch {}
}

function uninstallHooksForTarget(target, baseDir) {
  if (!target.hooks) return;
  // R-1：运行时文件按宿主过滤（Claude 不碰 hooks-cursor.json，Cursor 不碰 hooks.json）。
  const runtimeFiles = hookRuntimeFiles(target).length ? hookRuntimeFiles(target) : HOOK_FILES;
  uninstallOwnedDir(HOOKS_SRC, resolve(baseDir, target.hooks), runtimeFiles, `${target.name} hooks`);
  uninstallOwnedDir(SCRIPTS_SRC, resolve(baseDir, dirname(target.hooks), 'scripts'), GATE_SCRIPT_FILES, `${target.name} scripts`);
}

function uninstall(isGlobal, force = false, toolName = null) {
  const baseDir = isGlobal ? homedir() : PROJECT_DIR;
  console.log(`\n  jevzh v${PKG.version} — jev-superpowers-zh 卸载（${isGlobal ? '全局' : '项目级'}${toolName ? `；仅 ${toolName}` : '；全部已装目标'}）\n`);
  console.log(`  目标: ${baseDir}\n`);

  // I-2：卸载与安装共用同一套家目录/系统目录护栏（此前只在安装侧拦）。
  // 系统目录一律拒绝（--force 也不绕过）；家目录默认拒绝，--force 可显式绕过；
  // 全局卸载（homedir 基址）是正常路径，不受此限。
  if (!isGlobal && isSystemDir(PROJECT_DIR)) {
    console.error(
`  ⚠️  当前目录是系统目录: ${PROJECT_DIR}

    jevzh 不会在系统目录执行项目级卸载 —— 递归清理在这里可能误删系统文件，
    且管理员 PowerShell/cmd 的默认 cwd（C:\\Windows\\System32）本来就不是项目目录。

    请先切到你的项目目录再卸载：
      cd D:\\path\\to\\your\\project
      npx jevzh --uninstall

    若要清理用户级安装，用全局卸载（正常路径，不受此限）：
      npx jevzh --global --uninstall
`);
    return 1;
  }
  if (!isGlobal && !force && isHomeDir(PROJECT_DIR)) {
    console.error(
`  ⚠️  当前目录是用户主目录: ${PROJECT_DIR}

  jevzh 项目级卸载会按相对路径清理 .claude/.trae 等目录，在 ~/ 下执行可能
  误删你全局工具的共享配置与技能。

  - 清理全局安装请用（正常路径）：
      npx jevzh --global --uninstall   （等价 -g -u）
  - 若确实要在主目录按项目级方式清理，显式加 --force：
      npx jevzh --uninstall --force
`);
    return 1;
  }

  if (!existsSync(SKILLS_SRC)) {
    console.error('  ❌ 错误：skills 源目录不存在，无法识别要卸载的 skill 名单。');
    return 1;
  }

  // R-3：指定 --tool 时只处理该目标；技能/hooks/独立规则/共享区块全部按目标过滤。
  const scopeTarget = toolName ? TARGETS.find(t => t.name === toolName) : null;
  const pool = scopeTarget ? [scopeTarget] : (isGlobal ? GLOBAL_TARGETS : PROJECT_TARGETS);
  let totalSkills = 0;
  for (const target of pool) {
    const removed = uninstallSkillsForTarget(target, baseDir, isGlobal);
    if (removed > 0) {
      const relDir = isGlobal ? globalRelDir(target) : target.dir;
      console.log(`  ✅ ${target.name}: 移除 ${removed} 个 skills <- ${resolve(baseDir, relDir)}`);
      totalSkills += removed;
    }
    uninstallHooksForTarget(target, baseDir);
  }

  // 旧版 .claude/agents 残留（superpowers-zh v1.2.x）：仅全量卸载或 Claude 单工具卸载时处理。
  if (!scopeTarget || scopeTarget.name === 'Claude Code') {
  const agentsDest = resolve(baseDir, '.claude', 'agents');
  if (existsSync(agentsDest)) {
    let agentsRemoved = 0;
    for (const entry of readdirSync(agentsDest)) {
      if (!LEGACY_AGENT_FILENAMES.includes(entry)) continue;
      const legacyPath = resolve(agentsDest, entry);
      // R7：逐项 lstat 护栏 —— 仅删普通文件/链接本身；同名条目意外是目录
      // （如用户手工建的 code-reviewer.md/ 目录）时 WARN 跳过，绝不递归删除，
      // 与 S-6 整删名单的目录护栏同口径。
      let legacyStat;
      try { legacyStat = lstatSync(legacyPath); } catch { continue; }
      if (legacyStat.isDirectory()) {
        console.warn(`  ⚠️ WARN ${legacyPath} 是目录而非旧版残留文件：已跳过（不递归删除），请手工检查该目录。`);
        continue;
      }
      rmSync(legacyPath, { force: true });
      agentsRemoved++;
    }
    if (agentsRemoved > 0) console.log(`  ✅ Claude Code agents: 移除 ${agentsRemoved} 个旧版残留 -> ${agentsDest}`);
    try {
      const left = readdirSync(agentsDest).filter(n => n !== '.DS_Store');
      if (left.length === 0) rmSync(agentsDest, { recursive: true, force: true });
    } catch {}
  }
  } // if (!scopeTarget || Claude)

  let bootstrapsRemoved = 0;
  // R-3：单工具卸载时，独立文件名单与共享文件清单都只取该 target 自己的描述符。
  let ourDelete;
  let legacyDelete;
  let cleanList;
  if (scopeTarget) {
    const d = routerDescriptor(scopeTarget, isGlobal);
    ourDelete = d && d.standalone ? d.standalone.map(s => s.oursRel) : [];
    legacyDelete = d && d.standalone ? d.standalone.map(s => s.legacyRel) : [];
    cleanList = d && d.shared ? d.shared : [];
  } else {
    ourDelete = isGlobal ? OUR_BOOTSTRAP_DELETE_GLOBAL : OUR_BOOTSTRAP_DELETE_PROJECT;
    legacyDelete = isGlobal ? LEGACY_ZH_BOOTSTRAP_DELETE_GLOBAL : LEGACY_ZH_BOOTSTRAP_DELETE_PROJECT;
    cleanList = isGlobal ? BOOTSTRAP_CLEAN_SECTION_GLOBAL : BOOTSTRAP_CLEAN_SECTION_PROJECT;
  }

  // S-6：整删名单逐项 lstat —— 只删普通文件/链接本身；条目意外是目录（如用户把
  // .trae/rules/jevzh.md 建成了目录）时 WARN 跳过并继续后续清单，避免 EISDIR 中断，
  // 也绝不递归删目录。
  const removeIfFile = (full, okLog) => {
    let st;
    try { st = lstatSync(full); } catch { return; }
    if (st.isDirectory()) {
      console.warn(`  ⚠️ WARN ${full} 是目录而非本包文件：已跳过（不递归删除），请手工检查该目录。`);
      return;
    }
    rmSync(full, { force: true });
    console.log(okLog);
    bootstrapsRemoved++;
  };
  for (const rel of ourDelete) {
    const full = resolve(baseDir, rel);
    removeIfFile(full, `  ✅ 删除 bootstrap: ${full}`);
  }
  for (const rel of legacyDelete) {
    const full = resolve(baseDir, rel);
    removeIfFile(full, `  ✅ 清理旧 superpowers-zh 痕迹: ${full}`);
  }
  for (const rel of cleanList) {
    const full = resolve(baseDir, rel);
    if (cleanBootstrapFile(full, scopeTarget ? scopeTarget.name : null)) {
      console.log(`  ✅ 清理 bootstrap 区块: ${full}（${scopeTarget ? `仅 ${scopeTarget.name} 本包区块` : '含本包/旧 superpowers-zh 哨兵段'}）`);
      bootstrapsRemoved++;
    }
  }

  // .jevzh.json 默认保留（共享配置，卸载不连带删除）
  if (!isGlobal) {
    const cfgPath = resolve(baseDir, '.jevzh.json');
    if (existsSync(cfgPath)) {
      console.log(`  ℹ️  已保留配置文件 ${cfgPath}（含你的 backend/strict/tools 设置；确认不再需要可手动删除）。`);
    }
  }

  if (totalSkills === 0 && bootstrapsRemoved === 0) {
    console.log(`  ⚠️  未在${isGlobal ? '用户主目录' : '当前目录'}找到 jev-superpowers-zh 安装痕迹。`);
  } else {
    console.log(`\n  卸载完成。共移除 ${totalSkills} 个 skill 目录、${bootstrapsRemoved} 个 bootstrap 文件。\n`);
  }
  return 0;
}

// 支持全局安装的工具（有稳定的用户级 skills 目录）
const GLOBAL_TARGETS = TARGETS.filter(t => t.global);
// 只有用户级路径有官方出处的工具（如 ZCode）不进项目级安装池。
const PROJECT_TARGETS = TARGETS.filter(t => t.dir);

// ---------------------------------------------------------------------------
// 安装末就绪报告（与 scripts/jev-readiness 同口径的 Node 轻量版；/health 2s 超时）
// ---------------------------------------------------------------------------
const READY_TOOLS = [
  { name: 'jev-axi', bin: 'jev-axi', hint: 'npm install -g jev-axi' },
  { name: 'jev-scout', bin: 'jev-scout', hint: 'cargo install jev-scout' },
  { name: 'jev-guard', bin: 'jev-guard', hint: 'npm install -g jev-guard' },
  { name: 'git-jev', bin: null, hint: 'git jev install' },
  { name: 'supercov', bin: 'supercov', hint: 'npm install -g supercov' },
  { name: 'limpet', bin: 'limpet', hint: 'cargo install limpet（或 python3 ~/limpet/limpet.py）' },
];

function gitJevAvailable() {
  try {
    const r = spawnSync('git', ['jev', '--version'], { stdio: 'ignore', timeout: 1500 });
    return !r.error && r.status === 0;
  } catch {
    return false;
  }
}

function httpProbe(urlString, timeoutMs = 2000) {
  return new Promise(resolve => {
    let url;
    try { url = new URL(urlString); } catch { return resolve(null); }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return resolve(null);
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.get(url, { timeout: timeoutMs }, res => {
      res.resume();
      if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
        resolve(null);
        return;
      }
      let body = '';
      let done = false;
      res.on('data', c => { body += c; });
      res.on('end', () => {
        if (done) return;
        done = true;
        // S-10：200 但 body 非 JSON（被网关/代理劫持成 HTML 等）不得当作健康证据，
        // 返回 null 走「无后端」口径，避免误报 Laya/FULL。
        try { resolve(JSON.parse(body)); } catch { resolve(null); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

// JEVZH_STRICT 真值词，与 scripts/jev-readiness 的 bool_word 同口径。
const STRICT_TRUTH_WORDS = new Set(['1', 'true', 'yes', 'on']);
function strictBoolWord(v) {
  return STRICT_TRUTH_WORDS.has(String(v ?? '').trim().toLowerCase());
}

// 严格模式有效值口径（与 scripts/jev-readiness 一致）：
//   env JEVZH_STRICT（只要变量被设置即生效，真值词 1/true/yes/on，其余词按 false）
//   > .jevzh.json 的 strict 布尔 > false。
function resolveStrict(cfgStrict) {
  if (Object.prototype.hasOwnProperty.call(process.env, 'JEVZH_STRICT')) {
    return { value: strictBoolWord(process.env.JEVZH_STRICT), fromEnv: true };
  }
  return { value: cfgStrict === true, fromEnv: false };
}

async function computeReadinessFallback(baseDir, isGlobal, strict) {
  const missing = [];
  for (const t of READY_TOOLS) {
    const ok = t.bin ? isOnPath(t.bin) : gitJevAvailable();
    if (!ok) missing.push(t);
  }

  let backendCfg = 'auto';
  let baseUrl = 'http://127.0.0.1:8000';
  let cfgStrict = false;
  if (!isGlobal) {
    try {
      const c = JSON.parse(readFileSync(resolve(baseDir, '.jevzh.json'), 'utf8'));
      if (c && typeof c === 'object') {
        if (typeof c.backend === 'string') backendCfg = c.backend;
        if (typeof c.baseUrl === 'string') baseUrl = c.baseUrl;
        cfgStrict = c.strict === true;
      }
    } catch {}
  }
  if (process.env.JEVZH_BACKEND) backendCfg = process.env.JEVZH_BACKEND;
  if (process.env.TYPESAFE_BASE_URL) baseUrl = process.env.TYPESAFE_BASE_URL;
  if (!['auto', 'cloud', 'local', 'off'].includes(backendCfg)) backendCfg = 'auto';
  // 项目级：配置文件在就绪报告前已生成（--strict 新写入即 strict:true，既有配置不覆盖）；
  // 文件意外缺失时退回 CLI 标志。全局：无项目配置，直接取 CLI 标志。
  const cliFallback = isGlobal
    ? strict === true
    : strict === true && !existsSync(resolve(baseDir, '.jevzh.json'));
  const strictState = resolveStrict(cfgStrict || cliFallback);

  let backend = 'none';
  if (backendCfg !== 'off') {
    const health = await httpProbeSafe(baseUrl.replace(/\/+$/, '') + '/health');
    // S-10/S-11：只有 JSON 明确给出 laya_installed 布尔时才下结论；
    // 非 JSON 200 / 无该字段一律 'none'，绝不误判 laya。
    backend = classifyHealth(health);
  }

  let state;
  if (backendCfg === 'off' || missing.length === READY_TOOLS.length) state = 'DEGRADED';
  else if (missing.length === 0) state = (backend === 'cloud' || backend === 'laya') ? 'FULL' : backend === 'heuristic' ? 'LOCAL' : 'PARTIAL';
  else state = 'PARTIAL';

  return {
    state,
    backend,
    backendCfg,
    baseUrl,
    strict: strictState.value,
    strictFromEnv: strictState.fromEnv,
    missingTools: missing.map(t => t.name),
  };
}

async function readinessReport(baseDir, isGlobal, strict) {
  // 优先仓内权威脚本 scripts/jev-readiness（spawn bash，整体超时）；
  // bash 缺失/超时/输出非法时降级到 Node 轻量探测（同口径）。
  const r = await probeReadiness(baseDir, isGlobal, strict);
  const d = r.data;
  const stateDesc = {
    FULL: '全量就绪：工具齐 + 云端/Laya 后端可达',
    LOCAL: '本地就绪：工具齐 + 本地 heuristic 桥可达',
    PARTIAL: '部分就绪：各门独立降级，缺失的门转标准中文技能',
    DEGRADED: '已降级：工具全缺或 backend=off，门禁转标准中文技能（方法论仍可独立使用）',
  };

  console.log(`\n  ── 门禁就绪检测（${r.source}）──`);
  console.log(`  总体状态：${d.state}（${stateDesc[d.state]}）`);
  for (const t of READY_TOOLS) {
    if (d.missingTools.includes(t.name)) {
      console.log(`    [缺失] ${t.name.padEnd(9)} 安装：${t.hint}`);
    } else {
      console.log(`    [就绪] ${t.name}`);
    }
  }
  console.log(`  后端：${d.backend}（backend=${d.backendCfg}，baseUrl=${redactUrl(d.baseUrl)}）`);
  if (d.strict) {
    console.log('  严格模式：开启（strict=true，环境型失败 exit 2'
      + `${d.strictFromEnv ? '；来自 JEVZH_STRICT 环境变量' : ''}）`);
  } else {
    console.log(`  严格模式：关闭（软降级；JEVZH_STRICT=1 可开启${d.strictFromEnv ? '；当前值来自 JEVZH_STRICT 环境变量' : ''}）`);
  }
  console.log('  ────────────────────────────────────────────────────');
}

async function httpProbeSafe(url) {
  try {
    return await httpProbe(url, 2000);
  } catch {
    return null;
  }
}

async function install(forceToolName, opts) {
  const {
    force = false, isGlobal = false, noJev = false, strict = false,
    detectOnly = false, adoptSkills = false, keepRouter = false,
  } = opts;
  const effOpts = { noJev, strict, detectOnly, adoptSkills, keepRouter };

  console.log(`\n  jevzh v${PKG.version} — jev-superpowers-zh：中文超能力 + jev 门禁软降级\n`);

  if (!existsSync(SKILLS_SRC)) {
    console.error('  ❌ 错误：skills 源目录不存在，请重新安装 jev-superpowers-zh。');
    return 1;
  }

  const baseDir = isGlobal ? homedir() : PROJECT_DIR;

  if (!isGlobal && isSystemDir(PROJECT_DIR)) {
    console.error(
`  ⚠️  当前目录是系统目录: ${PROJECT_DIR}

    jevzh 不会把 skills 装到系统目录 —— 那需要管理员权限、会污染系统，
    而且你的 AI 编程工具也不会去那里找 skills。

    常见原因：用管理员权限打开的 PowerShell / cmd 默认在 C:\\Windows\\System32。
    正确做法 —— 先切到你的项目目录：
      cd D:\\path\\to\\your\\project
      npx jevzh

    或者装到用户级、所有项目共享：
      npx jevzh --global
`);
    return 1;
  }

  if (!isGlobal && !force && isHomeDir(PROJECT_DIR)) {
    console.error(
`  ⚠️  当前目录是用户主目录: ${PROJECT_DIR}

  jevzh 项目级安装应该装到具体项目目录，而不是 ~/。
  在主目录安装会把 skills 和 bootstrap 文件写入 home，污染所有项目。

  如果你想让 skills 对所有项目生效，用全局安装（推荐）：
    npx jevzh --global
    npx jevzh --global --tool claude

  或先 cd 到项目目录做项目级安装：
    cd /path/to/your/project && npx jevzh

  如果你确实要在主目录做项目级安装（不推荐），加 --force：
    npx jevzh --force
`);
    return 1;
  }

  console.log(`  源: ${skillCount(noJev)} 个 skills${noJev ? '（--no-jev 纯中文形态，不含 6 个 jev-* 技能）' : '（21 中文 + 6 jev-*）'}`);
  console.log(`  模式: ${isGlobal ? '全局（所有项目共享，装到用户级目录）' : '项目级'}`
    + `${noJev ? '；不接线 hooks、不生成 .jevzh.json' : ''}${!noJev && strict ? '；新配置 strict=true' : ''}`
    + `${detectOnly ? '；--detect-only 只预检不写盘' : ''}${adoptSkills ? '；--adopt-skills 接管同名他方技能' : ''}${keepRouter ? '；--keep-router 保留旧引导' : ''}`);
  console.log(`  目标: ${baseDir}\n`);

  // 选定目标（自动检测结果必须在任何写盘前一次性算完）。
  let chosen = [];
  const pool = isGlobal ? GLOBAL_TARGETS : PROJECT_TARGETS;
  if (forceToolName) {
    const target = TARGETS.find(t => t.name === forceToolName);
    if (!isGlobal && !target.dir) {
      console.log(`
      ❌ ${target.name} 不支持项目级安装。

${target.noProjectReason || `        其官方文档只给出用户级技能目录，项目级导入是应用内的 UI 动作、不暴露磁盘路径。
        猜一个路径装进去只会「装了不生效」，所以这里直接拒绝。`}
        请改用全局安装：
          npx jevzh --global --tool ${shortestAlias(target.name) || target.name.toLowerCase()}
    `);
      return 64;
    }
    if (isGlobal && !target.global) {
      const docSlug = { 'Gemini CLI': 'gemini-cli', 'Antigravity': 'antigravity', 'Trae': 'trae', 'Aider': 'aider', 'Hermes Agent': 'hermes', 'Kiro': 'kiro', 'Cline': 'cline', 'Kilo Code': 'kilocode' }[target.name];
      console.error(
`  ❌ ${target.name} 不支持通用全局安装（--global）。

  该工具没有通用 --global 能覆盖的稳定用户级 skills 路径${docSlug ? `（可能有专属全局方式，见 docs/README.${docSlug}.md）` : '（规则为项目级或存于应用内设置）'}。
  请改用项目级安装：
    cd /path/to/your/project && npx jevzh --tool ${shortestAlias(target.name) || forceToolName.toLowerCase().replace(/ .*/, '')}

  支持通用全局安装的工具：${GLOBAL_TARGETS.map(t => t.name).join('、')}
`);
      return 64;
    }
    chosen = [target];
  } else {
    for (const target of pool) {
      const dm = isGlobal ? target.global.detect : target.detect;
      const ds = Array.isArray(dm) ? dm : [dm];
      if (ds.some(d => existsSync(resolve(baseDir, d)))) chosen.push(target);
    }
  }

  if (chosen.length === 0) {
    const where = isGlobal ? '你的用户主目录(~)' : '当前目录';
    const flag = isGlobal ? '--global ' : '';
    console.log(`  ⚠️  未在${where}检测到任何已知 AI 编程工具的标记。\n`);

    const onPath = Object.entries(CLI_PROBES)
      .filter(([toolName]) => !isGlobal || pool.some(t => t.name === toolName))
      .filter(([, bins]) => bins.some(isOnPath));

    if (onPath.length) {
      console.log('  不过在 PATH 里找到了这些已安装的 CLI，你要装的应该是其中之一：\n');
      for (const [toolName] of onPath) {
        console.log(`    npx jevzh ${flag}--tool ${shortestAlias(toolName).padEnd(13)}# ${toolName}`);
      }
      console.log('\n  为避免装错，未自动安装 —— PATH 上装了不代表这个项目要用它。\n');
    } else {
      console.log('  为避免装错工具，未做任何安装。请用 --tool 显式指定你的工具，例如：\n');
      console.log(`    npx jevzh ${flag}--tool claude        # Claude Code / Copilot CLI`);
      if (isGlobal) {
        console.log(`    npx jevzh ${flag}--tool codex         # Codex CLI`);
        console.log(`    npx jevzh ${flag}--tool qoder         # Qoder\n`);
      } else {
        console.log(`    npx jevzh ${flag}--tool antigravity   # Google Antigravity`);
        console.log(`    npx jevzh ${flag}--tool trae          # Trae`);
        console.log(`    npx jevzh ${flag}--tool cursor        # Cursor\n`);
      }
    }

    if (isGlobal) {
      console.log(`  支持全局安装的工具：${GLOBAL_TARGETS.map(t => t.name).join('、')}\n`);
    } else {
      console.log(`  全部可用别名：${Object.keys(TOOL_ALIASES).join(', ')}\n`);
    }
    return 1;
  }

  // ── 共存环境 WARN（规格 §7.7.1；best-effort 只读、纯咨询不阻断）──
  // 项目侧恒按实际 cwd（PROJECT_DIR）扫描：全局安装时 baseDir 是 homedir()，
  // 但「当前目录已有项目副本」的交叉风险必须看运行目录。
  printCoexistWarnings(isGlobal, PROJECT_DIR);

  // ── 预检（纯只读）：五级处置矩阵 + 插件/坏 JSON/链接容器硬阻断 ──
  const plans = chosen.map(target => preflightTarget(target, baseDir, isGlobal, effOpts));
  for (const plan of plans) printPlanMatrix(plan, effOpts);

  const blockedPlans = plans.filter(p => p.blocks.length > 0 || p.errors.length > 0);
  const blockedNames = new Set(blockedPlans.map(p => p.target.name));

  if (detectOnly) {
    if (blockedPlans.length > 0) {
      console.log('\n  --detect-only 结论：存在 BLOCK 项（见上）。解除前安装器不会写任何文件；退出码 2。\n');
      return 2;
    }
    const addN = plans.reduce((n, p) => n + p.skills.filter(s => s.action === 'add').length, 0);
    console.log(`\n  --detect-only 结论：${plans.length} 个目标可安装（补缺 ${addN} 个技能）；未做任何写盘。\n`);
    return 0;
  }

  if (blockedPlans.length > 0) {
    console.log(`\n  ⛔ ${blockedPlans.length} 个目标被 BLOCK（${[...blockedNames].join('、')}）：`
      + '插件启用记录/hooks 坏 JSON/链接容器必须先处理（--force 也不绕过）；其余目标继续。\n');
  }

  // ── 共享备份轮次 + 逐目标事务（失败仅回滚当前目标，不影响其他目标）──
  const run = createBackupRun(baseDir, isGlobal, 'install');
  let okCount = 0;
  let failCount = 0;
  for (const plan of plans) {
    if (blockedNames.has(plan.target.name)) continue;
    const res = await runTargetTransaction(plan, baseDir, effOpts, run);
    if (res.ok) okCount++;
    else failCount++;
  }
  run.finalize(); // 全部条目均为新建（无破坏性接管）时连备份目录一起不留

  // 所有目标都被 BLOCK/失败时绝不补写 .jevzh.json（BLOCK 要求目标零写盘）。
  if (!isGlobal && !noJev && okCount > 0) ensureProjectConfig(baseDir, strict);
  if (!noJev && (okCount > 0 || failCount > 0)) await readinessReport(baseDir, isGlobal, strict);

  if (blockedPlans.length > 0) {
    console.log(`\n  汇总：${okCount} 个目标完成，${blockedPlans.length} 个 BLOCK 未安装${failCount ? `，${failCount} 个事务失败已回滚` : ''}。`
      + '请按上方 [BLOCK] 行处理后重跑；退出码 2。\n');
    return 2;
  }
  if (failCount > 0) {
    console.log(`\n  汇总：${okCount} 个目标完成，${failCount} 个目标失败且已回滚到安装前状态（见 ↩️ 行）；退出码 1。\n`);
    return 1;
  }
  console.log('\n  安装完成！重启你的 AI 编程工具即可生效。\n');
  return 0;
}

// ---------------------------------------------------------------------------
// CLI 入口。退出码：0 成功；64 参数错误（与 jev-gate 风格一致）；1 IO/环境失败。
// ---------------------------------------------------------------------------
const KNOWN_FLAGS = new Set([
  '--help', '-h', '--version', '-v',
  '--uninstall', '-u', '--force', '-f', '--global', '-g', '--tool', '-t',
  '--no-jev', '--strict',
  // 任务 7 共存处置开关与子命令开关
  '--detect-only', '--adopt-skills', '--keep-router', '--list',
]);

const SUBCOMMANDS = new Set(['doctor', 'restore']);

function parseArgs(argv) {
  const opts = {
    help: argv.includes('--help') || argv.includes('-h'),
    version: argv.includes('--version') || argv.includes('-v'),
    uninstall: argv.includes('--uninstall') || argv.includes('-u'),
    force: argv.includes('--force') || argv.includes('-f'),
    isGlobal: argv.includes('--global') || argv.includes('-g'),
    noJev: argv.includes('--no-jev'),
    strict: argv.includes('--strict'),
    detectOnly: argv.includes('--detect-only'),
    adoptSkills: argv.includes('--adopt-skills'),
    keepRouter: argv.includes('--keep-router'),
    list: argv.includes('--list'),
  };
  const toolIdx = argv.findIndex(a => a === '--tool' || a === '-t');
  if (toolIdx !== -1) opts.toolArg = argv[toolIdx + 1];
  opts.toolIdx = toolIdx;
  // 位置参数：doctor / restore [timestamp]（restore 的时间戳不以 - 开头）。
  const positionals = argv.filter((a, i) => {
    if (a.startsWith('-')) return false;
    if (i === toolIdx + 1 && toolIdx !== -1) return false; // --tool 的值
    return true;
  });
  if (positionals.length > 0 && SUBCOMMANDS.has(positionals[0])) {
    opts.command = positionals[0];
    if (opts.command === 'restore') opts.restoreTs = positionals[1] || null;
  }
  return opts;
}

async function main() {
  const argv = process.argv.slice(2);

  // --tool 的值不算未知参数；其余以 - 开头的 token 必须在白名单。
  const toolIdx = argv.findIndex(a => a === '--tool' || a === '-t');
  for (let i = 0; i < argv.length; i++) {
    if (i === toolIdx + 1 && toolIdx !== -1) continue;
    const a = argv[i];
    if (a.startsWith('-') && !KNOWN_FLAGS.has(a)) {
      console.error(`  ❌ 未知参数: ${a}\n`);
      showHelp();
      return 64;
    }
  }

  const opts = parseArgs(argv);

  if (opts.help) {
    showHelp();
    return 0;
  }
  if (opts.version) {
    console.log(PKG.version);
    return 0;
  }

  // 子命令：doctor（只读诊断）/ restore（离线恢复）。
  if (opts.command === 'doctor') {
    let toolName = null;
    if (opts.toolIdx !== -1) {
      if (!opts.toolArg) {
        console.error('  ❌ --tool 需要指定工具名，例如: doctor --tool cursor\n');
        return 64;
      }
      toolName = TOOL_ALIASES[opts.toolArg.toLowerCase()];
      if (!toolName) {
        console.error(`  ❌ 未知工具: ${opts.toolArg}`);
        console.error(`  支持的工具: ${Object.keys(TOOL_ALIASES).join(', ')}\n`);
        return 64;
      }
    }
    return doctor(toolName, opts);
  }
  if (opts.command === 'restore') {
    if (opts.toolIdx !== -1) {
      if (!opts.toolArg) {
        console.error('  ❌ --tool 需要指定工具名，例如: restore --tool cursor <时间戳>\n');
        return 64;
      }
      if (!TOOL_ALIASES[opts.toolArg.toLowerCase()]) {
        console.error(`  ❌ 未知工具: ${opts.toolArg}\n`);
        return 64;
      }
    }
    return restore(opts.list ? null : opts.restoreTs, opts);
  }

  if (opts.toolIdx !== -1) {
    if (!opts.toolArg) {
      console.error('  ❌ --tool 需要指定工具名，例如: --tool cursor\n');
      showHelp();
      return 64;
    }
    const toolName = TOOL_ALIASES[opts.toolArg.toLowerCase()];
    if (!toolName) {
      console.error(`  ❌ 未知工具: ${opts.toolArg}`);
      console.error(`  支持的工具: ${Object.keys(TOOL_ALIASES).join(', ')}\n`);
      return 64;
    }
    if (opts.uninstall) {
      return uninstall(opts.isGlobal, opts.force, toolName);
    }
    return install(toolName, opts);
  }

  if (opts.uninstall) {
    return uninstall(opts.isGlobal, opts.force, null);
  }

  return install(undefined, opts);
}

// 仅在作为脚本直接执行时运行 CLI；被测试 import 时只导出符号。
const invokedAsMain = !!process.argv[1] && resolve(process.argv[1]) === __filename;

if (invokedAsMain) {
  main()
    .then(code => {
      process.exitCode = code ?? 0;
    })
    .catch(err => {
      console.error(`  ❌ 安装失败：${err && err.message ? err.message : err}`);
      process.exitCode = 1;
    });
}

export {
  TARGETS,
  TOOL_ALIASES,
  GLOBAL_TARGETS,
  PROJECT_TARGETS,
  SENTINEL_BEGIN,
  SENTINEL_END,
  ZH_SENTINEL_BEGIN,
  ZH_SENTINEL_END,
  isSystemDir,
  atomicWriteFileSync,
  strictBoolWord,
  classifySkillSource,
  classifyHealth,
  redactUrl,
  // 任务 7 审查修复的测试接缝（纯函数/只读探测，无副作用）
  scanAtxHeadings,
  cutForeignMarkedSections,
  verifyBackupPayloads,
  verifyRestoredEntries,
  probeReadiness,
  bashCandidates,
  resolveUsableBash,
  READINESS_TIMEOUT_MS,
  detectCoexistWarnings,
};
