// tests/coexistence/coexist-warn.test.mjs — S-2：共存环境纯咨询 WARN
// 1) 全局 npm 旧包 superpowers-zh：JEVZH_TEST_NPM_ROOT_G 注入 + PATH npm-cli.js
//    stub（Windows 回退路径，shell:false 直跑 node，不依赖 cmd）；
// 2) 项目级安装发现 HOME 全局副本 / 全局安装发现项目副本：给出双重生效说明；
// 3) 干净环境不刷 WARN；WARN 不阻断、不改退出码（detect-only 仍 0）。
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { run, mkFixture, rmFixture } from './helpers.mjs';

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

// 在 home 造一份「已全局安装过 zh/jevzh」的痕迹（router 双哨兵 + 带 meta 的技能）。
function plantGlobalCopy(home) {
  const claude = path.join(home, '.claude');
  fs.mkdirSync(path.join(claude, 'skills', 'brainstorming'), { recursive: true });
  fs.writeFileSync(path.join(claude, 'CLAUDE.md'), [
    '# user router',
    '<!-- superpowers-zh:begin (do not edit between these markers) -->',
    '旧版 superpowers-zh 内容',
    '<!-- superpowers-zh:end -->',
    '<!-- jev-superpowers-zh:begin (do not edit between these markers) -->',
    'jev-superpowers-zh 内容',
    '<!-- jev-superpowers-zh:end -->',
  ].join('\n'));
  fs.writeFileSync(
    path.join(claude, 'skills', 'brainstorming', '.jevzh-meta.json'),
    JSON.stringify({ pkg: 'jev-superpowers-zh' }),
  );
}

// 在项目根造一份项目级副本痕迹。
function plantProjectCopy(projectDir) {
  const claude = path.join(projectDir, '.claude');
  fs.mkdirSync(path.join(claude, 'skills', 'brainstorming'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'CLAUDE.md'), [
    '# project router',
    '<!-- jev-superpowers-zh:begin (do not edit between these markers) -->',
    'jev-superpowers-zh 项目级内容',
    '<!-- jev-superpowers-zh:end -->',
  ].join('\n'));
  fs.writeFileSync(
    path.join(claude, 'skills', 'brainstorming', '.jevzh-meta.json'),
    JSON.stringify({ pkg: 'jev-superpowers-zh' }),
  );
}

test('S-2 npm：注入的全局 node_modules 含旧包 -> WARN 建议卸载，但不阻断（rc=0）', () => {
  const dir = mkFixture('jevzh-cw-npm-');
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  const npmRoot = path.join(dir, 'fake-npm-root');
  fs.mkdirSync(path.join(npmRoot, 'node_modules', 'superpowers-zh'), { recursive: true });
  fs.writeFileSync(
    path.join(npmRoot, 'node_modules', 'superpowers-zh', 'package.json'),
    JSON.stringify({ name: 'superpowers-zh', version: '0.0.1' }),
  );
  try {
    const r = run(['--tool', 'claude', '--detect-only'], {
      cwd: dir,
      env: { JEVZH_TEST_NPM_ROOT_G: npmRoot },
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const out = r.stdout + r.stderr;
    assert.match(out, /共存提示/);
    assert.match(out, /全局 npm 旧包 superpowers-zh/);
    assert.match(out, /npm uninstall -g superpowers-zh/);
    assert.match(out, /不阻断安装/);
  } finally {
    rmFixture(dir);
  }
});

test('S-2 npm：Windows 回退经 PATH 上 npm-cli.js 取 npm root -g（shell:false 也能命中）', { skip: process.platform !== 'win32' && '仅 Windows 验证 npm.cmd 回退' }, () => {
  const root = mkFixture('jevzh-cw-npmstub-');
  const project = path.join(root, 'proj');
  fs.mkdirSync(path.join(project, '.claude'), { recursive: true });
  const npmRoot = path.join(root, 'npm-root');
  fs.mkdirSync(path.join(npmRoot, 'node_modules', 'superpowers-zh'), { recursive: true });
  fs.writeFileSync(
    path.join(npmRoot, 'node_modules', 'superpowers-zh', 'package.json'),
    JSON.stringify({ name: 'superpowers-zh' }),
  );
  // PATH stub：npm.cmd 占位 + 其旁 node_modules/npm/bin/npm-cli.js（安装器实际回退入口）。
  const binDir = path.join(root, 'bin');
  fs.mkdirSync(path.join(binDir, 'node_modules', 'npm', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(binDir, 'npm.cmd'), '@echo stub npm, real entry is npm-cli.js\r\n');
  fs.writeFileSync(
    path.join(binDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    `if (process.argv[2] === 'root' && process.argv[3] === '-g') console.log(${JSON.stringify(npmRoot)});\n`,
  );
  try {
    const r = run(['--tool', 'claude', '--detect-only'], {
      cwd: project,
      env: { PATH: binDir },
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /全局 npm 旧包 superpowers-zh/);
  } finally {
    rmFixture(root);
  }
});

test('S-2 npm：干净全局 root 无旧包 -> 不刷该 WARN', () => {
  const dir = mkFixture('jevzh-cw-npmclean-');
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  const emptyRoot = path.join(dir, 'empty-npm-root');
  fs.mkdirSync(emptyRoot, { recursive: true });
  try {
    const r = run(['--tool', 'claude', '--detect-only'], {
      cwd: dir,
      env: { JEVZH_TEST_NPM_ROOT_G: emptyRoot },
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout + r.stderr, /全局 npm 旧包/);
  } finally {
    rmFixture(dir);
  }
});

test('S-2 交叉副本：项目级安装发现 HOME 全局副本 -> WARN 含优先级与双重生效说明', () => {
  const root = mkFixture('jevzh-cw-gcopy-');
  const { home, env } = fakeHomeEnv(root);
  plantGlobalCopy(home);
  const project = path.join(root, 'proj');
  fs.mkdirSync(path.join(project, '.claude'), { recursive: true });
  try {
    const r = run(['--tool', 'claude', '--detect-only'], {
      cwd: project,
      env: { ...env, JEVZH_TEST_NPM_ROOT_G: '' },
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const out = r.stdout + r.stderr;
    assert.match(out, /全局 superpowers-zh\/jevzh 副本/);
    assert.match(out, /\.claude\/CLAUDE\.md/);
    assert.match(out, /项目级副本优先于全局副本/);
  } finally {
    rmFixture(root);
  }
});

test('S-2 交叉副本：全局安装发现 cwd 项目副本 -> WARN 指明项目级优先与清理方式', () => {
  const root = mkFixture('jevzh-cw-pcopy-');
  const { env } = fakeHomeEnv(root);
  plantProjectCopy(root);
  try {
    const r = run(['--global', '--tool', 'claude', '--detect-only'], {
      cwd: root,
      env: { ...env, JEVZH_TEST_NPM_ROOT_G: '' },
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const out = r.stdout + r.stderr;
    assert.match(out, /当前项目已存在项目级 superpowers-zh\/jevzh 副本/);
    assert.match(out, /项目级副本优先级高于全局副本/);
    assert.match(out, /npx jevzh --uninstall/);
  } finally {
    rmFixture(root);
  }
});

test('S-2 干净环境：无全局包、无交叉副本 -> 不刷任何共存提示', () => {
  const root = mkFixture('jevzh-cw-clean-');
  const { env } = fakeHomeEnv(root);
  const project = path.join(root, 'proj');
  fs.mkdirSync(path.join(project, '.claude'), { recursive: true });
  try {
    const r = run(['--tool', 'claude', '--detect-only'], {
      cwd: project,
      env: { ...env, JEVZH_TEST_NPM_ROOT_G: '' },
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout + r.stderr, /共存提示/);
  } finally {
    rmFixture(root);
  }
});
