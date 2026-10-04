// tests/installer/cli.test.mjs — CLI 品牌、帮助、版本与参数退出码
import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { BIN, ROOT_URL, run, mkFixture, rmFixture } from './helpers.mjs';

const pkg = JSON.parse(
  fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
);

test('--help 输出 jevzh 品牌、新开关并保留上游鸣谢链接', () => {
  const dir = mkFixture('jevzh-cli-help-');
  try {
    const r = run(['--help'], { cwd: dir });
    assert.equal(r.status, 0, r.stderr);
    const out = r.stdout;
    assert.match(out, /jevzh/);
    assert.match(out, /npx jevzh/);
    assert.match(out, /--no-jev/);
    assert.match(out, /--strict/);
    assert.match(out, /--global/);
    assert.match(out, /--uninstall/);
    // 上游归属链接保留（鸣谢，不是自指）
    assert.match(out, /jnMetaCode\/superpowers-zh/);
    assert.match(out, /obra\/superpowers/);
    // 不得再用旧 CLI 名自指
    assert.doesNotMatch(out, /npx superpowers-zh/);
  } finally {
    rmFixture(dir);
  }
});

test('-h 与 --version/-v 等价且版本取自 package.json', () => {
  const dir = mkFixture('jevzh-cli-ver-');
  try {
    assert.match(run(['-h'], { cwd: dir }).stdout, /jevzh/);
    const v1 = run(['--version'], { cwd: dir });
    const v2 = run(['-v'], { cwd: dir });
    assert.equal(v1.status, 0);
    assert.equal(v1.stdout.trim(), pkg.version);
    assert.equal(v2.stdout.trim(), pkg.version);
  } finally {
    rmFixture(dir);
  }
});

test('未知参数退出码 64（与 jev-gate 参数错误风格一致）', () => {
  const dir = mkFixture('jevzh-cli-unknown-');
  try {
    const r = run(['--bogus'], { cwd: dir });
    assert.equal(r.status, 64, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /未知参数|--bogus/);
  } finally {
    rmFixture(dir);
  }
});

test('--tool 缺工具名退出码 64', () => {
  const dir = mkFixture('jevzh-cli-noarg-');
  try {
    const r = run(['--tool'], { cwd: dir });
    assert.equal(r.status, 64);
  } finally {
    rmFixture(dir);
  }
});

test('--tool 未知工具名退出码 64', () => {
  const dir = mkFixture('jevzh-cli-badtool-');
  try {
    const r = run(['--tool', 'no-such-tool-xyz'], { cwd: dir });
    assert.equal(r.status, 64);
    assert.match(r.stdout + r.stderr, /未知工具/);
  } finally {
    rmFixture(dir);
  }
});

test('不支持的安装模式退出码 64：zcode 项目级 / cursor 全局', () => {
  const dir = mkFixture('jevzh-cli-mode-');
  try {
    const r1 = run(['--tool', 'zcode'], { cwd: dir });
    assert.equal(r1.status, 64, r1.stdout + r1.stderr);
    const env = {
      HOME: `${dir}/home`,
      USERPROFILE: `${dir}/home`,
      APPDATA: `${dir}/home/AppData/Roaming`,
      LOCALAPPDATA: `${dir}/home/AppData/Local`,
    };
    const r2 = run(['--global', '--tool', 'cursor'], { cwd: dir, env });
    assert.equal(r2.status, 64, r2.stdout + r2.stderr);
  } finally {
    rmFixture(dir);
  }
});

test('bin/jevzh.js 存在且在 package.json 注册', () => {
  assert.ok(fs.existsSync(BIN));
  assert.equal(pkg.bin.jevzh, 'bin/jevzh.js');
  assert.equal(pkg.name, 'jev-superpowers-zh');
});

test('ROOT_URL 指向仓库根（夹具自检）', () => {
  assert.ok(fs.existsSync(new URL('skills/using-superpowers/SKILL.md', ROOT_URL)));
});
