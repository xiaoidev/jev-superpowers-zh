// tests/installer/uninstall.test.mjs — 卸载：本哨兵区块/本包副本清除，
// 用户文件与非本包管理的同名技能保留，.jevzh.json 默认保留，可干净重装。
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  run, mkFixture, rmFixture, readText, exists, ALL_SKILLS,
} from './helpers.mjs';

test('Claude 项目级：装 -> 卸 -> 用户文件保留 / 本包清除 / 配置保留 -> 干净重装', () => {
  const dir = mkFixture('jevzh-un-claude-');
  const userClaudeMd = '# 我的项目\n\n这是用户自己写的引导。\n';
  const userNotes = '# NOTES\n\n与安装器无关的用户文件。\n';
  const userBrainstorm = '---\nname: brainstorming\n---\n\n# USER-BRAINSTORM-9D21 用户同名技能\n';
  try {
    // 预置：用户 CLAUDE.md、用户同名技能、无关文件
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), userClaudeMd);
    fs.writeFileSync(path.join(dir, 'NOTES.md'), userNotes);
    const userSkillDir = path.join(dir, '.claude', 'skills', 'brainstorming');
    fs.mkdirSync(userSkillDir, { recursive: true });
    fs.writeFileSync(path.join(userSkillDir, 'SKILL.md'), userBrainstorm);

    const r1 = run(['--tool', 'claude'], { cwd: dir });
    assert.equal(r1.status, 0, r1.stdout + r1.stderr);
    // 同名用户技能被跳过，其余 26 个为本包安装
    assert.equal(
      fs
        .readdirSync(path.join(dir, '.claude', 'skills'), { withFileTypes: true })
        .filter((e) => e.isDirectory()).length,
      27,
    );

    const r2 = run(['--uninstall', '--tool', 'claude'], { cwd: dir });
    assert.equal(r2.status, 0, r2.stdout + r2.stderr);

    // 用户文件原样
    assert.equal(readText(path.join(dir, 'CLAUDE.md')).trim(), userClaudeMd.trim());
    assert.equal(readText(path.join(dir, 'NOTES.md')), userNotes.replace(/\r?\n/g, '\n'));
    assert.equal(
      readText(path.join(userSkillDir, 'SKILL.md')),
      userBrainstorm.replace(/\r?\n/g, '\n'),
    );

    // 本包技能副本、hooks、scripts 全部清除（目录只剩用户同名技能）
    const skillsDir = path.join(dir, '.claude', 'skills');
    assert.deepEqual(
      fs.readdirSync(skillsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name),
      ['brainstorming'],
    );
    assert.ok(!exists(path.join(dir, '.claude', 'hooks')));
    assert.ok(!exists(path.join(dir, '.claude', 'scripts')));

    // 哨兵不再残留
    assert.ok(!readText(path.join(dir, 'CLAUDE.md')).includes('jev-superpowers-zh'));

    // 配置默认保留并有提示
    assert.ok(exists(path.join(dir, '.jevzh.json')));
    assert.match(r2.stdout + r2.stderr, /保留|\.jevzh\.json/);

    // 干净重装：26 个本包技能重新补齐
    const r3 = run(['--tool', 'claude'], { cwd: dir });
    assert.equal(r3.status, 0, r3.stdout + r3.stderr);
    assert.equal(
      fs
        .readdirSync(skillsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory()).length,
      27,
    );
    for (const name of ALL_SKILLS) {
      if (name === 'brainstorming') continue;
      assert.ok(exists(path.join(skillsDir, name, 'SKILL.md')), `重装后缺 ${name}`);
    }
  } finally {
    rmFixture(dir);
  }
});

test('卸载兼容精确清理旧 superpowers-zh 哨兵区块，用户上下文保留', () => {
  const dir = mkFixture('jevzh-un-legacy-');
  const withLegacy = `# 我的项目

区块前的用户内容。

<!-- superpowers-zh:begin (do not edit between these markers) -->
# Superpowers-ZH 中文增强版

旧版 superpowers-zh 自动写入的引导。
<!-- superpowers-zh:end -->

区块后的用户内容。
`;
  try {
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), withLegacy);
    // 安装（任务 7）：默认 MIGRATE 接管——备份后切除旧 zh 段、写入本包成对哨兵
    const r1 = run(['--tool', 'claude'], { cwd: dir });
    assert.equal(r1.status, 0, r1.stdout + r1.stderr);
    assert.match(r1.stdout + r1.stderr, /MIGRATE/);
    assert.ok(exists(path.join(dir, '.claude', 'skills', 'jev-verification')));
    const installed = readText(path.join(dir, 'CLAUDE.md'));
    assert.ok(!installed.includes('<!-- superpowers-zh:begin'), '安装时旧 zh 段应已被接管切除');
    assert.match(installed, /jev-superpowers-zh:begin/);

    // 卸载：切除本包哨兵段（旧 zh 段安装时已切，且有备份可 restore）
    const r2 = run(['--uninstall', '--tool', 'claude'], { cwd: dir });
    assert.equal(r2.status, 0, r2.stdout + r2.stderr);
    const after = readText(path.join(dir, 'CLAUDE.md'));
    assert.ok(!after.includes('superpowers-zh'), `仍有残留:\n${after}`);
    assert.ok(!after.includes('jev-superpowers-zh'), `本包哨兵残留:\n${after}`);
    assert.match(after, /区块前的用户内容/);
    assert.match(after, /区块后的用户内容/);
  } finally {
    rmFixture(dir);
  }
});

test('Trae：独立规则文件与技能随卸载移除，无关用户文件保留', () => {
  const dir = mkFixture('jevzh-un-trae-');
  try {
    fs.mkdirSync(path.join(dir, '.trae'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.trae', 'keep.txt'), '用户文件');

    assert.equal(run(['--tool', 'trae'], { cwd: dir }).status, 0);
    assert.ok(exists(path.join(dir, '.trae', 'rules', 'jevzh.md')));
    assert.equal(
      fs
        .readdirSync(path.join(dir, '.trae', 'skills'), { withFileTypes: true })
        .filter((e) => e.isDirectory()).length,
      27,
    );

    assert.equal(run(['--uninstall', '--tool', 'trae'], { cwd: dir }).status, 0);
    assert.ok(!exists(path.join(dir, '.trae', 'rules', 'jevzh.md')));
    assert.ok(!exists(path.join(dir, '.trae', 'skills')));
    assert.equal(readText(path.join(dir, '.trae', 'keep.txt')), '用户文件');
  } finally {
    rmFixture(dir);
  }
});

test('从未安装过的目录执行卸载退出码 0', () => {
  const dir = mkFixture('jevzh-un-empty-');
  try {
    const r = run(['--uninstall'], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally {
    rmFixture(dir);
  }
});

// I-1 回归：.agents/rules.md 是多发行版共享文件，卸载不得整删（曾误删从未装过
// jevzh 的用户文件）；本包区块只能经哨兵切除，用户内容保留。
test('I-1：从未安装的项目，用户自有 .agents/rules.md 在卸载后原样保留', () => {
  const dir = mkFixture('jevzh-un-agents-');
  const userRules = '# 团队规则\n\n- 这是用户手写内容，与 jevzh 无关。\n';
  try {
    fs.mkdirSync(path.join(dir, '.agents'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.agents', 'rules.md'), userRules);

    const r = run(['--uninstall', '--tool', 'antigravity'], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(exists(path.join(dir, '.agents', 'rules.md')), '.agents/rules.md 不应被整删');
    assert.equal(
      readText(path.join(dir, '.agents', 'rules.md')),
      userRules.replace(/\r?\n/g, '\n'),
    );
  } finally {
    rmFixture(dir);
  }
});

test('I-1：Antigravity 装后卸载仅切除本包哨兵段，.agents/rules.md 用户内容保留', () => {
  const dir = mkFixture('jevzh-un-agents2-');
  const userRules = '# 团队规则\n\n- 区块前的用户内容。\n';
  try {
    fs.mkdirSync(path.join(dir, '.agents'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.agents', 'rules.md'), userRules);

    const r1 = run(['--tool', 'antigravity'], { cwd: dir });
    assert.equal(r1.status, 0, r1.stdout + r1.stderr);
    const installed = readText(path.join(dir, '.agents', 'rules.md'));
    assert.match(installed, /jev-superpowers-zh:begin/);
    assert.match(installed, /团队规则/);

    const r2 = run(['--uninstall', '--tool', 'antigravity'], { cwd: dir });
    assert.equal(r2.status, 0, r2.stdout + r2.stderr);
    const after = readText(path.join(dir, '.agents', 'rules.md'));
    assert.ok(!after.includes('jev-superpowers-zh'), `哨兵残留:\n${after}`);
    assert.match(after, /团队规则/);
    assert.match(after, /区块前的用户内容/);
  } finally {
    rmFixture(dir);
  }
});
