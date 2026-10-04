// tests/installer/global.test.mjs — 全局安装：伪造 HOME/USERPROFILE/APPDATA
// 夹具，绝不触碰真实用户目录；覆盖 Windows dirWin 分支与幂等。
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  run, mkFixture, rmFixture, readText, exists, listFiles, hashTree, ALL_SKILLS,
} from './helpers.mjs';

function fakeHomeEnv(root) {
  const home = path.join(root, 'home');
  fs.mkdirSync(home, { recursive: true });
  return {
    home,
    env: {
      HOME: home,
      USERPROFILE: home,
      APPDATA: path.join(home, 'AppData', 'Roaming'),
      LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
    },
  };
}

test('Claude Code 全局安装落到伪造 HOME 的 ~/.claude/skills，含全局 bootstrap/hooks', () => {
  const root = mkFixture('jevzh-global-claude-');
  const { home, env } = fakeHomeEnv(root);
  try {
    const r = run(['--global', '--tool', 'claude'], { cwd: root, env });
    assert.equal(r.status, 0, r.stdout + r.stderr);

    const skillsDir = path.join(home, '.claude', 'skills');
    const dirs = fs
      .readdirSync(skillsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    assert.deepEqual(dirs, [...ALL_SKILLS].sort());

    // 全局 bootstrap -> ~/.claude/CLAUDE.md
    const md = readText(path.join(home, '.claude', 'CLAUDE.md'));
    assert.match(md, /<!-- jev-superpowers-zh:begin/);
    assert.match(md, /全局/);
    assert.ok(exists(path.join(home, '.claude', 'hooks', 'hooks.json')));
    assert.ok(exists(path.join(home, '.claude', 'scripts', 'jev-readiness')));

    // 全局不生成项目级配置
    assert.ok(!exists(path.join(home, '.jevzh.json')));

    // 真实用户目录绝未被写入：home 夹具之外没有 .claude（cwd=root 下不应出现项目级产物）
    assert.ok(!exists(path.join(root, '.claude')));
    assert.ok(!exists(path.join(root, 'CLAUDE.md')));
  } finally {
    rmFixture(root);
  }
});

test('Windows dirWin 分支：Reasonix -> %APPDATA%/reasonix/skills，Crush -> %LOCALAPPDATA%/crush/skills', { skip: process.platform !== 'win32' && '仅在 Windows 验证 APPDATA 分支' }, () => {
  const root = mkFixture('jevzh-global-dirwin-');
  const { home, env } = fakeHomeEnv(root);
  try {
    const r1 = run(['--global', '--tool', 'reasonix'], { cwd: root, env });
    assert.equal(r1.status, 0, r1.stdout + r1.stderr);
    const reasonixDir = path.join(env.APPDATA, 'reasonix', 'skills');
    assert.equal(
      fs.readdirSync(reasonixDir, { withFileTypes: true }).filter((e) => e.isDirectory()).length,
      27,
    );
    assert.ok(!exists(path.join(home, '.reasonix', 'skills')));

    const r2 = run(['--global', '--tool', 'crush'], { cwd: root, env });
    assert.equal(r2.status, 0, r2.stdout + r2.stderr);
    const crushDir = path.join(env.LOCALAPPDATA, 'crush', 'skills');
    assert.equal(
      fs.readdirSync(crushDir, { withFileTypes: true }).filter((e) => e.isDirectory()).length,
      27,
    );
  } finally {
    rmFixture(root);
  }
});

test('全局安装幂等：重跑文件集合与内容指纹稳定', () => {
  const root = mkFixture('jevzh-global-idem-');
  const { env } = fakeHomeEnv(root);
  try {
    assert.equal(run(['--global', '--tool', 'claude'], { cwd: root, env }).status, 0);
    assert.equal(run(['--global', '--tool', 'claude'], { cwd: root, env }).status, 0);
    const files2 = listFiles(path.join(root, 'home'));
    const hash2 = hashTree(path.join(root, 'home'));
    assert.equal(run(['--global', '--tool', 'claude'], { cwd: root, env }).status, 0);
    assert.deepEqual(listFiles(path.join(root, 'home')), files2);
    assert.equal(hashTree(path.join(root, 'home')), hash2);
  } finally {
    rmFixture(root);
  }
});

test('全局卸载只删本包副本与本哨兵区块，用户自有 skill/内容保留', () => {
  const root = mkFixture('jevzh-global-uninstall-');
  const { home, env } = fakeHomeEnv(root);
  try {
    const skillsDir = path.join(home, '.claude', 'skills');
    fs.mkdirSync(path.join(skillsDir, 'keepme-skill'), { recursive: true });
    fs.writeFileSync(path.join(skillsDir, 'keepme-skill', 'SKILL.md'), '---\nname: keepme-skill\n---\n用户自有\n');

    assert.equal(run(['--global', '--tool', 'claude'], { cwd: root, env }).status, 0);
    assert.equal(run(['--global', '--uninstall'], { cwd: root, env }).status, 0);

    assert.ok(exists(path.join(skillsDir, 'keepme-skill', 'SKILL.md')));
    const left = fs
      .readdirSync(skillsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    assert.deepEqual(left, ['keepme-skill']);
    // 全局 bootstrap 被清空（原本不存在用户内容）-> 文件应被删除
    assert.ok(!exists(path.join(home, '.claude', 'CLAUDE.md')));
  } finally {
    rmFixture(root);
  }
});
