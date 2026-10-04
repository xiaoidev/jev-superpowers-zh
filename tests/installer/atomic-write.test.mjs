// tests/installer/atomic-write.test.mjs — S-3 atomicWriteFileSync：
// 内容正确、覆盖既有文件、权限保留、失败清理临时文件；端到端安装/卸载后无 *.tmp 残留。
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { atomicWriteFileSync } from '../../bin/jevzh.js';
import {
  run, mkFixture, rmFixture, readText, exists, listFiles,
} from './helpers.mjs';

test('S-3 单元：新建/覆盖写入内容正确且无 *.tmp 残留；写失败也清理临时文件', () => {
  const dir = mkFixture('jevzh-atomic-unit-');
  try {
    const file = path.join(dir, 'a', 'jevzh.md');
    fs.mkdirSync(path.dirname(file), { recursive: true });

    atomicWriteFileSync(file, '第一次写入 V1\n');
    assert.equal(readText(file), '第一次写入 V1\n');

    atomicWriteFileSync(file, '第二次写入 V2\n');
    assert.equal(readText(file), '第二次写入 V2\n');
    assert.deepEqual(listFiles(dir), ['a/jevzh.md']);

    // 目标目录不存在 -> 写临时文件即失败，不得留下 *.tmp 或半成品目录。
    const missing = path.join(dir, 'no-such-dir', 'x.md');
    assert.throws(() => atomicWriteFileSync(missing, 'x\n'));
    assert.deepEqual(listFiles(dir), ['a/jevzh.md']);
  } finally {
    rmFixture(dir);
  }
});

test('S-3 单元：覆盖时保留既有文件权限位（POSIX）', { skip: process.platform === 'win32' && 'Windows 不跟踪完整 POSIX 权限位' }, () => {
  const dir = mkFixture('jevzh-atomic-mode-');
  try {
    const file = path.join(dir, 'rule.md');
    fs.writeFileSync(file, 'old\n', { mode: 0o700 });
    atomicWriteFileSync(file, 'new\n');
    assert.equal(fs.statSync(file).mode & 0o777, 0o700);
    assert.equal(readText(file), 'new\n');
  } finally {
    rmFixture(dir);
  }
});

test('S-3 端到端：安装两次 + 卸载全套流程后夹具内无任何 *.tmp 残留，内容幂等', () => {
  const dir = mkFixture('jevzh-atomic-e2e-');
  const findTmp = (root) => {
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(d, e.name);
      if (e.isDirectory()) return walk(p);
      return e.name.endsWith('.tmp') ? [p] : [];
    });
    try { return walk(root); } catch { return []; }
  };
  try {
    const r1 = run(['--tool', 'claude'], { cwd: dir });
    assert.equal(r1.status, 0, r1.stdout + r1.stderr);
    const r2 = run(['--tool', 'claude'], { cwd: dir });
    assert.equal(r2.status, 0, r2.stdout + r2.stderr);
    // 关键产物内容正确（原子写落地）。
    assert.match(readText(path.join(dir, 'CLAUDE.md')), /jev-superpowers-zh:begin/);
    assert.match(readText(path.join(dir, '.jevzh.json')), /"strict": false/);
    assert.equal(findTmp(dir).length, 0, `发现临时文件残留: ${findTmp(dir).join(', ')}`);

    const r3 = run(['--uninstall', '--tool', 'claude'], { cwd: dir });
    assert.equal(r3.status, 0, r3.stdout + r3.stderr);
    assert.ok(!exists(path.join(dir, '.claude', 'skills')));
    assert.equal(findTmp(dir).length, 0, `卸载后发现临时文件残留: ${findTmp(dir).join(', ')}`);
  } finally {
    rmFixture(dir);
  }
});
