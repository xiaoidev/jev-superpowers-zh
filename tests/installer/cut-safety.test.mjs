// tests/installer/cut-safety.test.mjs — S-1 旧 zh 标题兜底切除的高置信特征门槛，
// 以及 S-2 畸形哨兵（双 begin 单 end）整文件保留。
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  run, mkFixture, rmFixture, readText,
} from './helpers.mjs';

const CLAUDE = (body) => path.join(body, 'CLAUDE.md');

test('S-1：用户自写同名 H1 但无 zh 高置信特征 -> 卸载保留全文并 WARN 手工处理', () => {
  const dir = mkFixture('jevzh-cut-userh1-');
  const userDoc = `# 我的项目

一些项目介绍。

# Superpowers-ZH 中文增强版

这是我自己整理的中文增强笔记，和任何安装器发行版都没有关系；
这里既没有品牌串，也没有旧版尾句。

# 其他章节

结尾内容 KEEP-TAIL-A1。
`;
  try {
    fs.writeFileSync(CLAUDE(dir), userDoc);
    const r = run(['--uninstall', '--tool', 'claude'], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const out = r.stdout + r.stderr;
    assert.match(out, /WARN/);
    assert.match(out, /Superpowers-ZH|手工/);
    // 文件逐字保留（CRLF 归一化后比较）。
    assert.equal(readText(CLAUDE(dir)), userDoc.replace(/\r?\n/g, '\n'));
    assert.match(readText(CLAUDE(dir)), /KEEP-TAIL-A1/);
  } finally {
    rmFixture(dir);
  }
});

test('S-1：真旧段（同名标题 + 尾句高置信特征 + 后续用户章节）-> 仅切除旧段', () => {
  const dir = mkFixture('jevzh-cut-legacyreal-');
  const doc = `# 我的项目

区块前文 KEEP-HEAD-B2。

# Superpowers-ZH 工作方法论

旧版安装器写入的引导正文（无品牌串，仅靠尾句识别）。
当你认为哪怕 1% 可能适用时，你必须调用该 skill 检查。

# 用户后续章节

区块后文 KEEP-TAIL-B2。
`;
  try {
    fs.writeFileSync(CLAUDE(dir), doc);
    const r = run(['--uninstall', '--tool', 'claude'], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const after = readText(CLAUDE(dir));
    assert.ok(!after.includes('Superpowers-ZH'), `旧标题残留:\n${after}`);
    assert.ok(!after.includes('你必须调用该 skill 检查。'), '旧尾句残留');
    assert.ok(!after.includes('旧版安装器写入的引导正文'));
    assert.match(after, /KEEP-HEAD-B2/);
    assert.match(after, /# 用户后续章节/);
    assert.match(after, /KEEP-TAIL-B2/);
  } finally {
    rmFixture(dir);
  }
});

test('S-1：含品牌串 superpowers-zh 的旧段（无尾句）同样可识别切除', () => {
  const dir = mkFixture('jevzh-cut-legacybrand-');
  const doc = `# 我的项目

前文 KEEP-HEAD-C3。

# Superpowers-ZH 中文增强版

更多说明见 superpowers-zh 项目文档。

# 用户后续章节

后文 KEEP-TAIL-C3。
`;
  try {
    fs.writeFileSync(CLAUDE(dir), doc);
    const r = run(['--uninstall', '--tool', 'claude'], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const after = readText(CLAUDE(dir));
    assert.ok(!after.toLowerCase().includes('superpowers-zh'), `品牌串残留:\n${after}`);
    assert.match(after, /KEEP-HEAD-C3/);
    assert.match(after, /# 用户后续章节/);
    assert.match(after, /KEEP-TAIL-C3/);
  } finally {
    rmFixture(dir);
  }
});

test('S-2：双 begin 单 end（畸形嵌套）-> 整文件原样保留并 WARN', () => {
  const dir = mkFixture('jevzh-cut-malformed-');
  const doc = `# 我的项目

用户前文 KEEP-HEAD-D4。

<!-- jev-superpowers-zh:begin (do not edit between these markers) -->
区块一内容（旧逻辑会从第一个 begin 删到唯一 end，吞掉第二个 begin 与用户内容）。
<!-- jev-superpowers-zh:begin (do not edit between these markers) -->
区块二内容 KEEP-NESTED-D4。
<!-- jev-superpowers-zh:end -->

用户后文 KEEP-TAIL-D4。
`;
  try {
    fs.writeFileSync(CLAUDE(dir), doc);
    const r = run(['--uninstall', '--tool', 'claude'], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const out = r.stdout + r.stderr;
    assert.match(out, /WARN/);
    assert.match(out, /畸形|哨兵/);
    assert.equal(readText(CLAUDE(dir)), doc.replace(/\r?\n/g, '\n'));
    assert.match(readText(CLAUDE(dir)), /KEEP-NESTED-D4/);
    // 两个 begin 与 end 均原样保留。
    const after = readText(CLAUDE(dir));
    assert.equal(after.match(/jev-superpowers-zh:begin/g).length, 2);
    assert.equal(after.match(/jev-superpowers-zh:end/g).length, 1);
  } finally {
    rmFixture(dir);
  }
});

test('S-2：两对完整哨兵 -> 干净全切，夹在中间与前后的用户内容保留', () => {
  const dir = mkFixture('jevzh-cut-twopairs-');
  const doc = `# 我的项目
<!-- jev-superpowers-zh:begin (do not edit between these markers) -->
区块 A 内容。
<!-- jev-superpowers-zh:end -->
中间用户内容 KEEP-MIDDLE-E5。
<!-- jev-superpowers-zh:begin (do not edit between these markers) -->
区块 B 内容。
<!-- jev-superpowers-zh:end -->
结尾用户内容 KEEP-TAIL-E5。
`;
  try {
    fs.writeFileSync(CLAUDE(dir), doc);
    const r = run(['--uninstall', '--tool', 'claude'], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const after = readText(CLAUDE(dir));
    assert.ok(!after.includes('jev-superpowers-zh:begin'), `begin 残留:\n${after}`);
    assert.ok(!after.includes('jev-superpowers-zh:end'));
    assert.ok(!after.includes('区块 A 内容'));
    assert.ok(!after.includes('区块 B 内容'));
    assert.match(after, /# 我的项目/);
    assert.match(after, /KEEP-MIDDLE-E5/);
    assert.match(after, /KEEP-TAIL-E5/);
  } finally {
    rmFixture(dir);
  }
});
