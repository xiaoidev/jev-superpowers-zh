// tests/coexistence/coexistence.test.mjs — 任务 7 九类用例之 1-6 + 开关矩阵：
//
//  1. 纯净项目 ADD（--detect-only 矩阵 + 零写盘 sha256）
//  2. 本包已装 SKIP（幂等）+ 本包旧版自升级 MIGRATE
//  3. zh 旧版同名技能默认 SKIP（来源注明）
//  4. 英文 jev 同名技能 SKIP+显著警告（硬 STOP 旧版）
//  5. obra 同名技能 SKIP+显著警告
//  6. 插件形态 BLOCK（--force 不绕过、零写盘）
//  另：未知来源最保守 SKIP+WARN；--adopt-skills 备份后覆盖；--keep-router 不动旧段；
//  本包品牌插件启用记录不得误判为竞品（边界防护）。
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  run, mkFixture, rmFixture, readText, exists, hashTree, listFiles,
  putCompetitorSkill, skillText,
} from './helpers.mjs';

test('用例 1：纯净项目 --detect-only 报告 27 个 ADD，exit 0，零写盘（树 sha256 不变）', () => {
  const dir = mkFixture('jevzh-coex-clean-');
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  try {
    const before = hashTree(dir);
    const beforeList = listFiles(dir);
    const r = run(['--tool', 'claude', '--detect-only'], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const out = r.stdout + r.stderr;
    const addLines = out.split(/\r?\n/).filter((l) => /\[ADD\]/.test(l));
    assert.equal(addLines.length, 27, `期望 27 行 ADD，实际:\n${out}`);
    assert.match(out, /brainstorming/);
    // 纯补缺/跳过不产生备份；detect-only 连 .jevzh/ 都不建。
    assert.equal(hashTree(dir), before, 'detect-only 发生了写盘');
    assert.deepEqual(listFiles(dir), beforeList);
    assert.ok(!exists(path.join(dir, '.jevzh')));
  } finally {
    rmFixture(dir);
  }
});

test('用例 2：本包已装 -> SKIP/幂等；旧版本包 meta -> MIGRATE 自升级覆盖', () => {
  const dir = mkFixture('jevzh-coex-ours-');
  try {
    const r1 = run(['--tool', 'claude'], { cwd: dir });
    assert.equal(r1.status, 0, r1.stdout + r1.stderr);

    const r2 = run(['--tool', 'claude', '--detect-only'], { cwd: dir });
    assert.equal(r2.status, 0, r2.stdout + r2.stderr);
    assert.match(r2.stdout + r2.stderr, /\[SKIP\].*brainstorming/);

    // 把 meta 改写成更旧版本 -> 自升级处置（MIGRATE），真实安装后内容被覆盖、meta 更新
    const skillDir = path.join(dir, '.claude', 'skills', 'brainstorming');
    const metaPath = path.join(skillDir, '.jevzh-meta.json');
    fs.writeFileSync(
      metaPath,
      JSON.stringify({
        pkg: 'jev-superpowers-zh', version: '0.0.1', date: '2020-01-01',
        scope: 'project', target: 'Claude Code',
      }, null, 2),
    );
    fs.rmSync(path.join(skillDir, 'SKILL.md'));
    const r3 = run(['--tool', 'claude', '--detect-only'], { cwd: dir });
    assert.equal(r3.status, 0, r3.stdout + r3.stderr);
    assert.match(r3.stdout + r3.stderr, /\[MIGRATE\][\s\S]*brainstorming[\s\S]*自升级/);

    const r4 = run(['--tool', 'claude'], { cwd: dir });
    assert.equal(r4.status, 0, r4.stdout + r4.stderr);
    const meta = JSON.parse(readText(metaPath));
    assert.equal(meta.version, '0.1.0');
    assert.ok(exists(path.join(skillDir, 'SKILL.md')));
  } finally {
    rmFixture(dir);
  }
});

test('用例 3：zh 旧版同名技能 -> SKIP，注明 superpowers-zh 来源，内容不动', () => {
  const dir = mkFixture('jevzh-coex-zh-');
  const skillDir = putCompetitorSkill(dir, 'zh');
  const original = skillText('zh');
  try {
    const r = run(['--tool', 'claude', '--detect-only'], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const out = r.stdout + r.stderr;
    assert.match(out, /\[SKIP\][\s\S]*brainstorming[\s\S]*superpowers-zh/);

    const r2 = run(['--tool', 'claude'], { cwd: dir });
    assert.equal(r2.status, 0, r2.stdout + r2.stderr);
    assert.equal(readText(path.join(skillDir, 'SKILL.md')), original);
    assert.ok(!exists(path.join(skillDir, '.jevzh-meta.json')), 'zh 技能不得被写本包 meta');
  } finally {
    rmFixture(dir);
  }
});

test('用例 4：英文 TypeSafe Jev 同名技能 -> SKIP 且显著标红硬 STOP 旧版', () => {
  const dir = mkFixture('jevzh-coex-jeven-');
  const skillDir = putCompetitorSkill(dir, 'jev-en');
  const original = skillText('jev-en');
  try {
    const r = run(['--tool', 'claude'], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const out = r.stdout + r.stderr;
    assert.match(out, /\[SKIP\][\s\S]*brainstorming/);
    assert.match(out, /jev-superpowers|TypeSafe|英文/);
    assert.match(out, /STOP|接管|adopt-skills/);
    assert.equal(readText(path.join(skillDir, 'SKILL.md')), original);
    assert.ok(!exists(path.join(skillDir, '.jevzh-meta.json')));
  } finally {
    rmFixture(dir);
  }
});

test('用例 5：obra 原版同名技能 -> SKIP 且显著标红（superpowers: 前缀特征）', () => {
  const dir = mkFixture('jevzh-coex-obra-');
  const skillDir = putCompetitorSkill(dir, 'obra');
  const original = skillText('obra');
  try {
    const r = run(['--tool', 'claude'], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const out = r.stdout + r.stderr;
    assert.match(out, /\[SKIP\][\s\S]*brainstorming/);
    assert.match(out, /obra/);
    assert.equal(readText(path.join(skillDir, 'SKILL.md')), original);
  } finally {
    rmFixture(dir);
  }
});

test('未知来源同名目录 -> 最保守 SKIP+WARN，绝不覆盖、不写 meta', () => {
  const dir = mkFixture('jevzh-coex-unknown-');
  const skillDir = path.join(dir, '.claude', 'skills', 'brainstorming');
  fs.mkdirSync(skillDir, { recursive: true });
  const custom = '---\nname: brainstorming\n---\n# 完全无法识别来源的用户自建内容 MARKER-UNOWNED-7F\n';
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), custom);
  try {
    const r = run(['--tool', 'claude'], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const out = r.stdout + r.stderr;
    assert.match(out, /\[WARN\][\s\S]*brainstorming|brainstorming[\s\S]*\[WARN\]/);
    assert.match(out, /未知|无法识别|用户/);
    assert.equal(readText(path.join(skillDir, 'SKILL.md')), custom.replace(/\r?\n/g, '\n'));
    assert.ok(!exists(path.join(skillDir, '.jevzh-meta.json')));
  } finally {
    rmFixture(dir);
  }
});

test('用例 6：插件形态启用竞品 -> BLOCK exit 2；--force 仍 2；目标零写盘', () => {
  const dir = mkFixture('jevzh-coex-plugin-');
  fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude-plugin', 'enabled.json'), '{"superpowers-zh":true}');
  try {
    for (const args of [['--tool', 'claude'], ['--tool', 'claude', '--force'], ['--tool', 'claude', '--detect-only']]) {
      const before = hashTree(dir);
      const r = run(args, { cwd: dir });
      assert.equal(r.status, 2, `${args.join(' ')} 应 exit 2:\n${r.stdout}${r.stderr}`);
      assert.match(r.stdout + r.stderr, /\[BLOCK\]|BLOCK/);
      assert.match(r.stdout + r.stderr, /plugin|插件/);
      assert.equal(hashTree(dir), before, `${args.join(' ')} 发生了写盘`);
    }
    assert.ok(!exists(path.join(dir, '.claude', 'skills')));
    assert.ok(!exists(path.join(dir, 'CLAUDE.md')));
    assert.ok(!exists(path.join(dir, '.jevzh')));
  } finally {
    rmFixture(dir);
  }
});

test('误判防护：启用记录只含本包品牌 jev-superpowers-zh -> 不 BLOCK，正常安装', () => {
  const dir = mkFixture('jevzh-coex-plugin-own-');
  fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude-plugin', 'enabled.json'), '{"jev-superpowers-zh":true}');
  try {
    const r = run(['--tool', 'claude'], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout + r.stderr, /\[BLOCK\]/);
    assert.ok(exists(path.join(dir, '.claude', 'skills', 'jev-verification', 'SKILL.md')));
  } finally {
    rmFixture(dir);
  }
});

test('--adopt-skills：zh 同名技能备份后被本包完整替代（内容+meta），备份含原文', () => {
  const dir = mkFixture('jevzh-coex-adopt-');
  const skillDir = putCompetitorSkill(dir, 'zh');
  try {
    const r = run(['--tool', 'claude', '--adopt-skills'], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /MIGRATE|adopt|接管/);
    // 被 adopt 的技能现在与源字节一致且带本包 meta
    assert.equal(
      readText(path.join(skillDir, 'SKILL.md')),
      readText(path.join(path.resolve('skills'), 'brainstorming', 'SKILL.md')),
    );
    const meta = JSON.parse(readText(path.join(skillDir, '.jevzh-meta.json')));
    assert.equal(meta.pkg, 'jev-superpowers-zh');
    assert.equal(meta.target, 'Claude Code');
    // 备份树中必须能找到被接管前的原始内容（restore 依据）
    const backupsRoot = path.join(dir, '.jevzh', 'backups');
    assert.ok(exists(backupsRoot));
    const found = require_fs_walk(backupsRoot, '本节是 superpowers-zh 的增量内容');
    assert.ok(found, '备份中找不到被 adopt 技能的原始内容');
  } finally {
    rmFixture(dir);
  }
});

test('--keep-router：旧 zh 哨兵 CLAUDE.md 逐字不动，不写入本包哨兵；技能照补', () => {
  const dir = mkFixture('jevzh-coex-keeprouter-');
  const existing = `# 我的项目

用户自有引导内容 KEEP-K1。

<!-- superpowers-zh:begin (do not edit between these markers) -->
# Superpowers-ZH 中文增强版

旧 superpowers-zh 区块。
<!-- superpowers-zh:end -->

结尾用户内容 KEEP-K2。
`;
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), existing);
  try {
    const r = run(['--tool', 'claude', '--keep-router'], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(readText(path.join(dir, 'CLAUDE.md')), existing.replace(/\r?\n/g, '\n'));
    assert.ok(!readText(path.join(dir, 'CLAUDE.md')).includes('jev-superpowers-zh:begin'));
    // 技能仍然补缺
    assert.ok(exists(path.join(dir, '.claude', 'skills', 'jev-verification', 'SKILL.md')));
    // 纯补缺 + 未接管 router -> 无备份
    assert.ok(!exists(path.join(dir, '.jevzh', 'backups')));
  } finally {
    rmFixture(dir);
  }
});

// 小工具：递归找文本（避免在测试文件顶部引入额外只在一处用的依赖）。
function require_fs_walk(rootDir, needle) {
  const stack = [rootDir];
  while (stack.length) {
    const d = stack.pop();
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) stack.push(p);
      else {
        try {
          if (fs.readFileSync(p, 'utf8').includes(needle)) return true;
        } catch { /* 忽略不可读文件 */ }
      }
    }
  }
  return false;
}
