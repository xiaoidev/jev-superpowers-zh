// tests/installer/uninstall-guards.test.mjs — I-2 卸载侧家目录/系统目录护栏，
// 以及 S-6 整删名单条目是目录（EISDIR）时 WARN 跳过且不中断后续清理。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { isSystemDir } from '../../bin/jevzh.js';
import {
  run, mkFixture, rmFixture, readText, exists,
} from './helpers.mjs';

function fakeHomeEnv(home) {
  return {
    HOME: home,
    USERPROFILE: home,
    APPDATA: path.join(home, 'AppData', 'Roaming'),
    LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
  };
}

test('I-2：在伪造的用户主目录直接项目级卸载 -> exit 1 且文件无损', () => {
  const root = mkFixture('jevzh-un-guard-home-');
  const home = path.join(root, 'home');
  try {
    fs.mkdirSync(path.join(home, '.claude', 'skills', 'keepme-skill'), { recursive: true });
    fs.writeFileSync(path.join(home, '.claude', 'skills', 'keepme-skill', 'SKILL.md'), '---\nname: keepme-skill\n---\n');
    fs.writeFileSync(path.join(home, 'CLAUDE.md'), '# 我的主目录配置\n\n用户内容必须保留。\n');
    const env = fakeHomeEnv(home);

    const r = run(['--uninstall', '--tool', 'claude'], { cwd: home, env });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    const out = r.stdout + r.stderr;
    assert.match(out, /主目录/);
    assert.match(out, /--force|--global|-g/);

    assert.equal(readText(path.join(home, 'CLAUDE.md')), '# 我的主目录配置\n\n用户内容必须保留。\n');
    assert.ok(exists(path.join(home, '.claude', 'skills', 'keepme-skill', 'SKILL.md')));
  } finally {
    rmFixture(root);
  }
});

test('I-2：主目录项目级卸载加 --force 正常执行；先 --force 安装的内容被清理', () => {
  const root = mkFixture('jevzh-un-guard-force-');
  const home = path.join(root, 'home');
  try {
    fs.mkdirSync(home, { recursive: true });
    fs.mkdirSync(path.join(home, '.claude', 'skills', 'keepme-skill'), { recursive: true });
    fs.writeFileSync(path.join(home, '.claude', 'skills', 'keepme-skill', 'SKILL.md'), '---\nname: keepme-skill\n---\n');
    const env = fakeHomeEnv(home);

    const r1 = run(['--tool', 'claude', '--force'], { cwd: home, env });
    assert.equal(r1.status, 0, r1.stdout + r1.stderr);
    assert.ok(exists(path.join(home, '.claude', 'skills', 'jev-verification', 'SKILL.md')));

    const r2 = run(['--uninstall', '--force'], { cwd: home, env });
    assert.equal(r2.status, 0, r2.stdout + r2.stderr);
    // 本包技能被清，用户技能保留。
    assert.ok(!exists(path.join(home, '.claude', 'skills', 'jev-verification')));
    assert.ok(exists(path.join(home, '.claude', 'skills', 'keepme-skill', 'SKILL.md')));
  } finally {
    rmFixture(root);
  }
});

test('I-2：全局卸载（homedir 基址）不受家目录护栏限制', () => {
  const root = mkFixture('jevzh-un-guard-global-');
  const home = path.join(root, 'home');
  try {
    fs.mkdirSync(home, { recursive: true });
    const env = fakeHomeEnv(home);
    assert.equal(run(['--global', '--tool', 'claude'], { cwd: root, env }).status, 0);
    const r = run(['--global', '--uninstall'], { cwd: root, env });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout + r.stderr, /当前目录是用户主目录/);
  } finally {
    rmFixture(root);
  }
});

test('I-2：isSystemDir 系统目录/临时目录/家目录路径模式单元断言', () => {
  if (process.platform === 'win32') {
    const system32 = process.env.SystemRoot
      ? path.join(process.env.SystemRoot, 'System32')
      : 'C:\\Windows\\System32';
    assert.equal(isSystemDir(system32), true, 'System32 应判系统目录');
    assert.equal(isSystemDir('C:\\'), true, '盘符根应判系统目录');
    assert.equal(isSystemDir('C:\\Windows'), true);
  } else {
    assert.equal(isSystemDir('/'), true, 'POSIX 根应判系统目录');
    assert.equal(isSystemDir('/usr'), true);
    assert.equal(isSystemDir('/etc'), true);
  }
  const tmp = mkFixture('jevzh-sysdir-tmp-');
  try {
    assert.equal(isSystemDir(tmp), false, '临时夹具不应判系统目录');
    assert.equal(isSystemDir(os.tmpdir()), false, 'tmpdir 不应判系统目录');
    assert.equal(isSystemDir(os.homedir()), false, '家目录不应判系统目录');
  } finally {
    rmFixture(tmp);
  }
});

test('S-6：整删名单条目被造成目录 -> 卸载 exit 0、WARN 跳过、其余清理继续', () => {
  const dir = mkFixture('jevzh-un-eisdir-');
  const bogusDir = path.join(dir, '.trae', 'rules', 'jevzh.md');
  try {
    const r1 = run(['--tool', 'trae'], { cwd: dir });
    assert.equal(r1.status, 0, r1.stdout + r1.stderr);
    assert.ok(exists(path.join(dir, '.trae', 'rules', 'jevzh.md')));

    // 把本应是文件的条目替换成目录（内部放文件，验证绝不递归删）。
    fs.rmSync(path.join(dir, '.trae', 'rules', 'jevzh.md'), { force: true });
    fs.mkdirSync(bogusDir, { recursive: true });
    fs.writeFileSync(path.join(bogusDir, 'inside.txt'), '目录内容必须保留\n');

    const r2 = run(['--uninstall', '--tool', 'trae'], { cwd: dir });
    assert.equal(r2.status, 0, r2.stdout + r2.stderr);
    const out = r2.stdout + r2.stderr;
    assert.match(out, /WARN/);
    assert.match(out, /是目录/);

    // 目录及其内容保留；技能等其余清理照常完成。
    assert.ok(exists(path.join(bogusDir, 'inside.txt')));
    assert.equal(readText(path.join(bogusDir, 'inside.txt')), '目录内容必须保留\n');
    assert.ok(!exists(path.join(dir, '.trae', 'skills')), '其余清单应继续清理（skills 容器应删除）');
  } finally {
    rmFixture(dir);
  }
});
