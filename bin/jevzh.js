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
  copyFileSync, lstatSync, realpathSync, rmSync, chmodSync,
} from 'node:fs';
import { resolve, dirname, join, sep } from 'node:path';
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
function globalRelDir(target) {
  const g = target.global;
  if (!g) return null;
  if (process.platform === 'win32' && g.dirWin) return g.dirWin;
  return g.dir;
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

// 往用户共享文件追加本包哨兵区块：已有本包区块则幂等跳过；检测到竞品区块则
// WARN 且完全不动文件（任务 7 再做备份后接管）。
function appendSentinelSection(filePath, content, label) {
  mkdirSync(dirname(filePath), { recursive: true });
  if (existsSync(filePath)) {
    const existing = readFileSync(filePath, 'utf8');
    if (existing.includes(SENTINEL_BEGIN)) {
      console.log(`  ✅ ${label}: 已包含 jevzh 引导区块，跳过 -> ${filePath}`);
      return;
    }
    if (containsCompetitorSection(existing)) {
      console.warn(`  ⚠️ WARN ${label}: ${filePath} 已含其他发行版（superpowers-zh / jev）的引导区块，`
        + `本次保留不动（同名路由仅允许一个生效；任务 7 将支持备份后接管迁移）。`);
      return;
    }
    writeFileSync(filePath, existing.replace(/\s+$/, '') + '\n\n' + wrapWithSentinel(content), 'utf8');
    console.log(`  ✅ ${label}: 追加 skills 引用 -> ${filePath}`);
  } else {
    writeFileSync(filePath, wrapWithSentinel(content), 'utf8');
    console.log(`  ✅ ${label}: bootstrap -> ${filePath}`);
  }
}

// 独立规则文件（文件名带 jevzh 品牌，天然不与旧 zh 文件冲突）。
// 检测到旧 superpowers-zh 同名机制文件时只 WARN 不动。
function writeStandaloneRule(filePath, content, label, legacyZhPath) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf8');
  console.log(`  ✅ ${label}: bootstrap rule -> ${filePath}`);
  if (legacyZhPath && existsSync(legacyZhPath)) {
    console.warn(`  ⚠️ WARN ${label}: 检测到旧 superpowers-zh 规则文件 ${legacyZhPath}，已保留不动；`
      + `两份常驻规则可能同时生效，任务 7 将支持备份后接管。`);
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

// 只安装我们自己拥有、且目标处缺失或与源字节一致的文件；目标处存在但内容
// 不同的文件视为用户/他方内容，WARN 且不动。
function installOwnedFiles(srcDir, destDir, fileNames, label) {
  mkdirSync(destDir, { recursive: true });
  let installed = 0;
  for (const name of fileNames) {
    const src = resolve(srcDir, name);
    const dst = resolve(destDir, name);
    if (!existsSync(src)) continue;
    if (existsSync(dst)) {
      if (filesEqual(src, dst)) continue;
      console.warn(`  ⚠️ WARN ${label}: ${dst} 已存在且内容与本包不同，保留不动（任务 7 将做读改写合并）。`);
      continue;
    }
    let stat;
    try { stat = lstatSync(src); } catch { continue; }
    copyFileWithMode(src, dst, stat);
    installed++;
  }
  return installed;
}

function installHooksForTarget(target, baseDir) {
  if (!target.hooks) return;
  const hookDest = resolve(baseDir, target.hooks);
  const scriptDest = resolve(baseDir, dirname(target.hooks), 'scripts');
  const n1 = installOwnedFiles(HOOKS_SRC, hookDest, HOOK_FILES, `${target.name} hooks`);
  const n2 = installOwnedFiles(SCRIPTS_SRC, scriptDest, GATE_SCRIPT_FILES, `${target.name} scripts`);
  if (n1 > 0 || existsSync(hookDest)) {
    console.log(`  ✅ ${target.name}: hooks 运行时 -> ${hookDest}`);
    console.log(`     门禁脚本 -> ${scriptDest}（session-start/pre-commit/stop 经 run-hook.cmd 调用）`);
    console.log('     ℹ️  settings 自动接线（读改写合并）将在后续版本完成；当前先落运行时文件。');
    if (process.platform === 'win32') {
      console.log('     ℹ️  Windows 不跟踪可执行位：钩子统一由 run-hook.cmd 调 Git for Windows bash，无需 chmod +x。');
    }
  }
  void n2;
}

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
    try {
      existingStrict = JSON.parse(readFileSync(cfgPath, 'utf8')).strict;
    } catch {}
    console.log(`  ℹ️  已存在 .jevzh.json：保留用户配置不覆盖（strict 等字段均取自既有文件`
      + `${existingStrict !== undefined ? `，当前 strict=${existingStrict}` : ''}；`
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

function writeSkillMeta(destSkillDir, target, isGlobal) {
  const meta = {
    pkg: PKG.name,
    version: PKG.version,
    date: new Date().toISOString().slice(0, 10),
    scope: isGlobal ? 'global' : 'project',
    target: target.name,
  };
  writeFileSync(resolve(destSkillDir, '.jevzh-meta.json'), JSON.stringify(meta, null, 2) + '\n', 'utf8');
}

function installSkillsForTarget(target, baseDir, isGlobal, opts) {
  const relDir = isGlobal ? globalRelDir(target) : target.dir;
  const dest = resolve(baseDir, relDir);
  const names = selectedSkillNames(opts.noJev);
  mkdirSync(dest, { recursive: true });

  let added = 0;
  let already = 0;
  let warned = 0;
  for (const name of names) {
    const src = resolve(SKILLS_SRC, name);
    const dst = resolve(dest, name);
    if (existsSync(dst)) {
      if (isOurManaged(dst)) {
        already++;
      } else {
        console.warn(`  ⚠️ WARN 同名技能 ${name} 已存在于 ${dst} 且非本包管理（无本包 .jevzh-meta.json），`
          + '判定为用户/他方内容，保留不动（零覆盖；任务 7 将提供 --adopt-skills 接管）。');
        warned++;
      }
      continue;
    }
    copyDirSync(src, dst);
    writeSkillMeta(dst, target, isGlobal);
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
  console.log(`  ✅ ${target.name} ${scopeTag}: 新装 ${added} 个 / 已装 ${already} 个 skills -> ${dest}`
    + (warned ? `（${warned} 个同名他方技能跳过，见 WARN）` : ''));
  return { added, already, warned };
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
    writeFileSync(filePath, body + '\n', 'utf8');
  }
}

// 切除一段 begin/end 哨兵（精确配对）；返回切除后的文本与是否切除。
function cutSentinelPair(content, begin, end) {
  let text = content;
  let cut = false;
  for (;;) {
    const i = text.indexOf(begin);
    if (i === -1) break;
    const j = text.indexOf(end, i + begin.length);
    if (j === -1) break;
    text = text.slice(0, i) + text.slice(j + end.length);
    cut = true;
  }
  return { text, cut: cut || text !== content };
}

// v1.1.x 旧 zh 安装无哨兵，凭固定标题 + 段尾兜底识别切除（沿用基座逻辑）。
function cutLegacyZhMarkedSection(content) {
  let idx = -1;
  for (const marker of ZH_SECTION_MARKERS) {
    const i = content.indexOf(marker);
    if (i !== -1 && (idx === -1 || i < idx)) idx = i;
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
  return { text: content.slice(0, idx) + content.slice(end), cut: true, unresolvable: false };
}

function cleanBootstrapFile(filePath) {
  if (!existsSync(filePath)) return false;
  const original = readFileSync(filePath, 'utf8');
  let text = original;
  let changed = false;

  const ours = cutSentinelPair(text, SENTINEL_BEGIN, SENTINEL_END);
  text = ours.text;
  changed = changed || ours.cut;

  const legacy = cutSentinelPair(text, ZH_SENTINEL_BEGIN, ZH_SENTINEL_END);
  text = legacy.text;
  changed = changed || legacy.cut;

  const marked = cutLegacyZhMarkedSection(text);
  if (marked.unresolvable) {
    console.warn(`  ⚠️ WARN ${filePath}: 无法可靠识别旧 superpowers-zh 段尾，已跳过以避免数据丢失，`
      + '请手动删除以 "Superpowers-ZH" 开头的整段。');
    return false;
  }
  text = marked.text;
  changed = changed || marked.cut;

  if (!changed) return false;
  writeOrDelete(filePath, text, '');
  return true;
}

function uninstallSkillsForTarget(target, baseDir, isGlobal) {
  const relDir = isGlobal ? globalRelDir(target) : target.dir;
  if (!relDir) return 0;
  const dest = resolve(baseDir, relDir);
  if (!existsSync(dest)) return 0;
  const names = listSourceSkillNames();
  let removed = 0;
  for (const name of names) {
    const skillDir = resolve(dest, name);
    if (!existsSync(skillDir)) continue;
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
  if (!existsSync(destDir)) return;
  for (const name of fileNames) {
    const dst = resolve(destDir, name);
    if (!existsSync(dst)) continue;
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
  uninstallOwnedDir(HOOKS_SRC, resolve(baseDir, target.hooks), HOOK_FILES, `${target.name} hooks`);
  uninstallOwnedDir(SCRIPTS_SRC, resolve(baseDir, dirname(target.hooks), 'scripts'), GATE_SCRIPT_FILES, `${target.name} scripts`);
}

function uninstall(isGlobal) {
  const baseDir = isGlobal ? homedir() : PROJECT_DIR;
  console.log(`\n  jevzh v${PKG.version} — jev-superpowers-zh 卸载（${isGlobal ? '全局' : '项目级'}）\n`);
  console.log(`  目标: ${baseDir}\n`);

  if (!existsSync(SKILLS_SRC)) {
    console.error('  ❌ 错误：skills 源目录不存在，无法识别要卸载的 skill 名单。');
    return 1;
  }

  const pool = isGlobal ? GLOBAL_TARGETS : PROJECT_TARGETS;
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

  // 旧版 .claude/agents 残留（superpowers-zh v1.2.x）
  const agentsDest = resolve(baseDir, '.claude', 'agents');
  if (existsSync(agentsDest)) {
    let agentsRemoved = 0;
    for (const entry of readdirSync(agentsDest)) {
      if (LEGACY_AGENT_FILENAMES.includes(entry)) {
        rmSync(resolve(agentsDest, entry), { recursive: true, force: true });
        agentsRemoved++;
      }
    }
    if (agentsRemoved > 0) console.log(`  ✅ Claude Code agents: 移除 ${agentsRemoved} 个旧版残留 -> ${agentsDest}`);
    try {
      const left = readdirSync(agentsDest).filter(n => n !== '.DS_Store');
      if (left.length === 0) rmSync(agentsDest, { recursive: true, force: true });
    } catch {}
  }

  let bootstrapsRemoved = 0;
  const ourDelete = isGlobal ? OUR_BOOTSTRAP_DELETE_GLOBAL : OUR_BOOTSTRAP_DELETE_PROJECT;
  const legacyDelete = isGlobal ? LEGACY_ZH_BOOTSTRAP_DELETE_GLOBAL : LEGACY_ZH_BOOTSTRAP_DELETE_PROJECT;
  const cleanList = isGlobal ? BOOTSTRAP_CLEAN_SECTION_GLOBAL : BOOTSTRAP_CLEAN_SECTION_PROJECT;

  for (const rel of ourDelete) {
    const full = resolve(baseDir, rel);
    if (existsSync(full)) {
      rmSync(full, { force: true });
      console.log(`  ✅ 删除 bootstrap: ${full}`);
      bootstrapsRemoved++;
    }
  }
  for (const rel of legacyDelete) {
    const full = resolve(baseDir, rel);
    if (existsSync(full)) {
      rmSync(full, { force: true });
      console.log(`  ✅ 清理旧 superpowers-zh 痕迹: ${full}`);
      bootstrapsRemoved++;
    }
  }
  for (const rel of cleanList) {
    const full = resolve(baseDir, rel);
    if (cleanBootstrapFile(full)) {
      console.log(`  ✅ 清理 bootstrap 区块: ${full}（含本包/旧 superpowers-zh 哨兵段）`);
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
        try { resolve(JSON.parse(body)); } catch { resolve({}); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

async function readinessReport(baseDir, isGlobal, strict) {
  const missing = [];
  for (const t of READY_TOOLS) {
    const ok = t.bin ? isOnPath(t.bin) : gitJevAvailable();
    if (!ok) missing.push(t);
  }

  let backendCfg = 'auto';
  let baseUrl = 'http://127.0.0.1:8000';
  if (!isGlobal) {
    try {
      const c = JSON.parse(readFileSync(resolve(baseDir, '.jevzh.json'), 'utf8'));
      if (c && typeof c === 'object') {
        if (typeof c.backend === 'string') backendCfg = c.backend;
        if (typeof c.baseUrl === 'string') baseUrl = c.baseUrl;
      }
    } catch {}
  }
  if (process.env.JEVZH_BACKEND) backendCfg = process.env.JEVZH_BACKEND;
  if (process.env.TYPESAFE_BASE_URL) baseUrl = process.env.TYPESAFE_BASE_URL;
  if (!['auto', 'cloud', 'local', 'off'].includes(backendCfg)) backendCfg = 'auto';

  let backend = 'none';
  if (backendCfg !== 'off') {
    const health = await httpProbeSafe(baseUrl.replace(/\/+$/, '') + '/health');
    if (health) {
      backend = health.laya_installed === false ? 'heuristic' : 'laya';
    }
  }

  let state;
  if (backendCfg === 'off' || missing.length === READY_TOOLS.length) state = 'DEGRADED';
  else if (missing.length === 0) state = (backend === 'cloud' || backend === 'laya') ? 'FULL' : backend === 'heuristic' ? 'LOCAL' : 'PARTIAL';
  else state = 'PARTIAL';

  const stateDesc = {
    FULL: '全量就绪：工具齐 + 云端/Laya 后端可达',
    LOCAL: '本地就绪：工具齐 + 本地 heuristic 桥可达',
    PARTIAL: '部分就绪：各门独立降级，缺失的门转标准中文技能',
    DEGRADED: '已降级：工具全缺或 backend=off，门禁转标准中文技能（方法论仍可独立使用）',
  };

  console.log('\n  ── 门禁就绪检测（与 scripts/jev-readiness 同口径）──');
  console.log(`  总体状态：${state}（${stateDesc[state]}）`);
  for (const t of READY_TOOLS) {
    if (missing.some(m => m.name === t.name)) {
      console.log(`    [缺失] ${t.name.padEnd(9)} 安装：${t.hint}`);
    } else {
      console.log(`    [就绪] ${t.name}`);
    }
  }
  console.log(`  后端：${backend}（backend=${backendCfg}，baseUrl=${baseUrl}）`);
  console.log(`  严格模式：${strict ? '开启（strict=true，环境型失败 exit 2）' : '关闭（软降级；JEVZH_STRICT=1 可开启）'}`);
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
  const { force = false, isGlobal = false, noJev = false, strict = false } = opts;

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
  console.log(`  模式: ${isGlobal ? '全局（所有项目共享，装到用户级目录）' : '项目级'}${noJev ? '；不接线 hooks、不生成 .jevzh.json' : ''}${strict ? '；新配置 strict=true' : ''}`);
  console.log(`  目标: ${baseDir}\n`);

  const subOpts = { noJev, strict };

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
    installForTarget(target, baseDir, isGlobal, subOpts);
    if (!isGlobal && !noJev) ensureProjectConfig(baseDir, strict);
    if (!noJev) await readinessReport(baseDir, isGlobal, strict);
    console.log('\n  安装完成！重启你的 AI 编程工具即可生效。\n');
    return 0;
  }

  // 自动检测：检测结果在写盘前一次性算完（避免边装边判互相误触发）。
  let installed = 0;
  const pool = isGlobal ? GLOBAL_TARGETS : PROJECT_TARGETS;
  const detectedBefore = new Map();
  for (const target of pool) {
    const dm = isGlobal ? target.global.detect : target.detect;
    const ds = Array.isArray(dm) ? dm : [dm];
    detectedBefore.set(target.name, ds.some(d => existsSync(resolve(baseDir, d))));
  }

  for (const target of pool) {
    if (detectedBefore.get(target.name)) {
      installForTarget(target, baseDir, isGlobal, subOpts);
      installed++;
    }
  }

  if (installed === 0) {
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

  if (!isGlobal && !noJev) ensureProjectConfig(baseDir, strict);
  if (!noJev) await readinessReport(baseDir, isGlobal, strict);
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
]);

function parseArgs(argv) {
  const opts = {
    help: argv.includes('--help') || argv.includes('-h'),
    version: argv.includes('--version') || argv.includes('-v'),
    uninstall: argv.includes('--uninstall') || argv.includes('-u'),
    force: argv.includes('--force') || argv.includes('-f'),
    isGlobal: argv.includes('--global') || argv.includes('-g'),
    noJev: argv.includes('--no-jev'),
    strict: argv.includes('--strict'),
  };
  const toolIdx = argv.findIndex(a => a === '--tool' || a === '-t');
  if (toolIdx !== -1) opts.toolArg = argv[toolIdx + 1];
  opts.toolIdx = toolIdx;
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
      return uninstall(opts.isGlobal);
    }
    return install(toolName, opts);
  }

  if (opts.uninstall) {
    return uninstall(opts.isGlobal);
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
};
