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
      // R-1：经接缝注入 npm root -g，绝不在测试里真实 spawn npm——npm 11 即便
      // exit 0 也会写 %LOCALAPPDATA%/npm-cache/_logs/*-debug-0.log，破坏整树指纹。
      // 指向不存在的根：共存检测查无 node_modules/superpowers-zh，行为等价干净环境。
      JEVZH_TEST_NPM_ROOT_G: path.join(root, 'injected-empty-npm-root'),
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
    // R-1：三次运行都不得真实 spawn npm 而在夹具内落 npm 调试日志
    //（历史红因：%LOCALAPPDATA%/npm-cache/_logs/*-debug-0.log 每次新增）。
    const logs = listFiles(path.join(root, 'home')).filter((f) => f.includes('npm-cache'));
    assert.deepEqual(logs, []);
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

// S-7：APPDATA/LOCALAPPDATA 被重定向到 USERPROFILE 之外（组策略/自定义镜像常见）时，
// dirWin 目标必须落在重定向目录；USERPROFILE 下不得出现任何污染。
test('S-7 Windows：APPDATA/LOCALAPPDATA 重定向到 USERPROFILE 之外时全局落位重定向目录', { skip: process.platform !== 'win32' && '仅 Windows 走 APPDATA/LOCALAPPDATA 分支' }, () => {
  const root = mkFixture('jevzh-global-redirect-');
  const home = path.join(root, 'home');
  const roaming = path.join(root, 'redirected', 'Roaming');
  const local = path.join(root, 'redirected', 'Local');
  const env = {
    HOME: home, USERPROFILE: home, APPDATA: roaming, LOCALAPPDATA: local,
    JEVZH_TEST_NPM_ROOT_G: '',
  };
  try {
    fs.mkdirSync(home, { recursive: true });

    const r1 = run(['--global', '--tool', 'reasonix'], { cwd: root, env });
    assert.equal(r1.status, 0, r1.stdout + r1.stderr);
    assert.equal(
      fs.readdirSync(path.join(roaming, 'reasonix', 'skills'), { withFileTypes: true })
        .filter((e) => e.isDirectory()).length,
      27,
    );
    // 回退路径（~/AppData）与 POSIX 风格路径都不得出现。
    assert.ok(!exists(path.join(home, '.reasonix', 'skills')));
    assert.ok(!exists(path.join(home, 'AppData')));
    assert.deepEqual(listFiles(home), [], 'USERPROFILE 应零污染');

    const r2 = run(['--global', '--tool', 'crush'], { cwd: root, env });
    assert.equal(r2.status, 0, r2.stdout + r2.stderr);
    assert.equal(
      fs.readdirSync(path.join(local, 'crush', 'skills'), { withFileTypes: true })
        .filter((e) => e.isDirectory()).length,
      27,
    );
    assert.ok(!exists(path.join(home, '.config', 'crush')));
    assert.deepEqual(listFiles(home), [], 'USERPROFILE 应零污染');
  } finally {
    rmFixture(root);
  }
});
