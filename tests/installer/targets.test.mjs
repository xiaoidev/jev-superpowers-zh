// tests/installer/targets.test.mjs — 26 工具 TARGETS 元数据与源逐一对应、
// 哨兵品牌、零第三方依赖静态断言。
//
// EXPECTED_TARGETS 快照逐字提取自 fork 基座
// D:\\S\\0\\superpowers-zh\\bin\\superpowers-zh.js（v1.7.13，SHA 见
// .upstream-sync.json 的 zh 源）：name / dir / detect / global 四组载体
// 字段必须与源完全一致；jevzh 新增的能力字段（hooks 等）在归一化时剔除。
import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { BIN, ROOT_URL } from './helpers.mjs';

const mod = await import(pathToFileURL(BIN).href);
const { TARGETS, TOOL_ALIASES, SENTINEL_BEGIN, SENTINEL_END, ZH_SENTINEL_BEGIN } = mod;

const EXPECTED_TARGETS = [
  { name: 'Claude Code', dir: '.claude/skills', detect: ['.claude'], global: { dir: '.claude/skills', dirWin: null, detect: ['.claude'] }, hooks: '.claude/hooks' },
  { name: 'Cursor', dir: '.cursor/skills', detect: ['.cursor', '.cursorrules'], hooks: '.cursor/hooks' },
  { name: 'Codex CLI', dir: '.agents/skills', detect: ['.codex'], global: { dir: '.agents/skills', dirWin: null, detect: ['.codex'] } },
  { name: 'Kiro', dir: '.kiro/skills', detect: ['.kiro'] },
  { name: 'DeerFlow', dir: 'skills/custom', detect: ['skills/public', 'deer_flow'] },
  { name: 'Trae', dir: '.trae/skills', detect: ['.trae'] },
  { name: 'TRAE CN', dir: null, detect: [], editionOf: 'Trae', noProjectReason: '<present>', global: { dir: '.trae-cn/skills', dirWin: null, detect: ['.trae-cn'] } },
  { name: 'Antigravity', dir: '.agents/skills', detect: ['.agents'] },
  { name: 'VS Code', dir: '.github/superpowers', detect: ['.github/copilot-instructions.md', '.github/instructions'] },
  { name: 'OpenClaw', dir: 'skills', detect: ['.openclaw'], global: { dir: '.openclaw/skills', dirWin: null, detect: ['.openclaw'] } },
  { name: 'Windsurf', dir: '.windsurf/skills', detect: ['.windsurf'], global: { dir: '.codeium/windsurf/skills', dirWin: null, detect: ['.codeium'] } },
  { name: 'Gemini CLI', dir: '.gemini/skills', detect: ['GEMINI.md'] },
  { name: 'Aider', dir: '.aider/skills', detect: ['.aider.conf.yml', '.aider.chat.history.md', '.aider.tags.cache.v3', '.aider'] },
  { name: 'OpenCode', dir: '.opencode/skills', detect: ['.opencode'], global: { dir: '.config/opencode/skills', dirWin: null, detect: ['.config/opencode'] } },
  { name: 'Qwen Code', dir: '.qwen/skills', detect: ['.qwen'], global: { dir: '.qwen/skills', dirWin: null, detect: ['.qwen'] } },
  { name: 'Hermes Agent', dir: '.hermes/skills', detect: ['.hermes', 'HERMES.md', '.hermes.md'], global: { dir: '.hermes/skills', dirWin: null, detect: ['.hermes'] } },
  { name: 'Claw Code', dir: '.claw/skills', detect: ['.claw', 'CLAW.md'] },
  { name: 'Qoder', dir: '.qoder/skills', detect: ['.qoder'], global: { dir: '.qoder/skills', dirWin: null, detect: ['.qoder'] } },
  { name: 'CodeBuddy', dir: '.codebuddy/skills', detect: ['.codebuddy', 'CODEBUDDY.md'], global: { dir: '.codebuddy/skills', dirWin: null, detect: ['.codebuddy'] } },
  { name: 'CodeArts', dir: '.codeartsdoer/skills', detect: ['.codeartsdoer'], global: { dir: '.codeartsdoer/skills', dirWin: null, detect: ['.codeartsdoer'] } },
  { name: 'Reasonix', dir: '.reasonix/skills', detect: ['.reasonix', 'reasonix.toml'], global: { dir: '.reasonix/skills', dirWin: 'AppData/Roaming/reasonix/skills', detect: ['.reasonix'] } },
  { name: 'DeepSeek Harness', dir: '.dsh/skills', detect: ['.dsh', 'dsh.json'], global: { dir: '.dsh/skills', dirWin: null, detect: ['.dsh'] } },
  { name: 'ZCode', dir: null, detect: [], global: { dir: '.zcode/skills', dirWin: null, detect: ['.zcode'] } },
  { name: 'Crush', dir: '.crush/skills', detect: ['.crush', 'crush.json', '.crush.json'], global: { dir: '.config/crush/skills', dirWin: 'AppData/Local/crush/skills', detect: ['.config/crush'] } },
  { name: 'Cline', dir: '.cline/skills', detect: ['.clinerules'] },
  { name: 'Kilo Code', dir: '.kilocode/skills', detect: ['.kilocode', '.kilo', 'kilo.jsonc'] },
];

function normalize(list) {
  return list.map((t) => {
    const o = {
      name: t.name,
      dir: t.dir ?? null,
      detect: Array.isArray(t.detect) ? t.detect : [t.detect],
    };
    if (t.editionOf) o.editionOf = t.editionOf;
    if (t.noProjectReason) o.noProjectReason = '<present>';
    if (t.global) {
      o.global = {
        dir: t.global.dir,
        dirWin: t.global.dirWin ?? null,
        detect: Array.isArray(t.global.detect) ? t.global.detect : [t.global.detect],
      };
    }
    return o;
  });
}

test('TARGETS 恰为 26 项且名称无重复', () => {
  assert.equal(TARGETS.length, 26);
  const names = TARGETS.map((t) => t.name);
  assert.equal(new Set(names).size, 26);
});

test('TARGETS 载体元数据与 superpowers-zh 源逐一对应（允许新增字段）', () => {
  assert.deepEqual(normalize(TARGETS), EXPECTED_TARGETS.map(({ hooks, ...rest }) => rest));
});

test('hooks 能力只授予 Claude Code 与 Cursor（spec §5.4）', () => {
  const withHooks = TARGETS.filter((t) => t.hooks).map((t) => t.name).sort();
  assert.deepEqual(withHooks, ['Claude Code', 'Cursor']);
  assert.equal(TARGETS.find((t) => t.name === 'Claude Code').hooks, '.claude/hooks');
  assert.equal(TARGETS.find((t) => t.name === 'Cursor').hooks, '.cursor/hooks');
});

test('每个 TARGET 至少有一个别名且别名全部可解析', () => {
  const names = new Set(TARGETS.map((t) => t.name));
  for (const target of TARGETS) {
    const aliases = Object.entries(TOOL_ALIASES)
      .filter(([, v]) => v === target.name)
      .map(([k]) => k);
    assert.ok(aliases.length >= 1, `${target.name} 缺少别名`);
  }
  for (const v of Object.values(TOOL_ALIASES)) {
    assert.ok(names.has(v), `别名指向未知 TARGET: ${v}`);
  }
});

test('jevzh 哨兵成对、含品牌且不与 superpowers-zh 哨兵串用', () => {
  assert.match(SENTINEL_BEGIN, /jev-superpowers-zh:begin/);
  assert.match(SENTINEL_END, /jev-superpowers-zh:end/);
  // 剥掉 jev- 品牌后不得还能匹配到裸 zh 哨兵串（两个哨兵不得混用）
  const stripped = SENTINEL_BEGIN.replace(/jev-superpowers-zh/g, '');
  assert.doesNotMatch(stripped, /superpowers-zh:begin/);
  assert.ok(ZH_SENTINEL_BEGIN.includes('superpowers-zh:begin'));
  assert.notEqual(SENTINEL_BEGIN, ZH_SENTINEL_BEGIN);
});

test('bin/jevzh.js 零第三方依赖（仅 node: 内置模块与相对路径）', () => {
  const src = fs.readFileSync(BIN, 'utf8');
  const specifiers = [
    ...src.matchAll(/(?:^|\s)(?:import|export)\s+(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/g),
    ...src.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g),
    ...src.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g),
  ].map((m) => m[1]);
  assert.ok(specifiers.length >= 3, `未解析到 import，正则可能失效: ${specifiers.join(',')}`);
  for (const spec of specifiers) {
    assert.ok(
      spec.startsWith('node:') || spec.startsWith('.') || spec.startsWith('/'),
      `发现第三方模块说明符: ${spec}`,
    );
  }
});

test('文件头保留 MIT 与 fork 自 jnMetaCode/superpowers-zh 的归属声明', () => {
  const head = fs.readFileSync(BIN, 'utf8').slice(0, 1200);
  assert.match(head, /MIT/);
  assert.match(head, /jnMetaCode\/superpowers-zh/);
  assert.match(head, /fork|Fork|派生|分叉/i);
});

test('package.json 无运行时第三方依赖且 files 含运行时目录', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('package.json', ROOT_URL), 'utf8'));
  assert.deepEqual(pkg.dependencies ?? {}, {});
  assert.deepEqual(pkg.devDependencies ?? {}, {});
  for (const entry of ['bin/', 'skills/', 'hooks/', 'scripts/']) {
    assert.ok(pkg.files.includes(entry), `files 缺少 ${entry}`);
  }
});
