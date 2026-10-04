// tests/coexistence/foreign-section-cut.test.mjs — I-1：无哨兵英文 jev/obra 段切除
// 必须按「其后第一个同级/更高级 ATX 标题（无论标题文本）」定界，绝不吞掉竞品段
// 之后的用户内容；多个竞品段一次扫描逐段判定；三级段包含四级子段；代码围栏内的
// markdown 标题不算边界；无品牌特征普通 H1 不切（任务 6 S-1 规则不回归）。
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { run, mkFixture, rmFixture, readText } from './helpers.mjs';
import { BIN } from '../installer/helpers.mjs';

const mod = await import(pathToFileURL(BIN).href);
const { cutForeignMarkedSections, scanAtxHeadings } = mod;

// 端到端：安装接管 CLAUDE.md（英文 obra/jev 旧段 -> 切除并写本包哨兵）。
function migrateClaude(doc) {
  const dir = mkFixture('jevzh-fc-');
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), doc);
  return dir;
}

test('I-1 a：## Superpowers (obra) 段后的用户 ## 章节与标记串必须保留', () => {
  const doc = `# 我的项目

前文 KEEP-FC-PRE-A。

## Superpowers (obra)

会话开始先走 superpowers:using-superpowers；任何跳步都要先查 Failure Modes。

## My other section

用户自己写的章节正文 FC-USER-A-MARKER，与竞品无关。
`;
  const dir = migrateClaude(doc);
  try {
    const r = run(['--tool', 'claude'], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /MIGRATE/);
    const after = readText(path.join(dir, 'CLAUDE.md'));
    assert.ok(!after.includes('Superpowers (obra)'), `竞品标题残留:\n${after}`);
    assert.ok(!after.includes('superpowers:using-superpowers'), '竞品正文残留');
    assert.match(after, /## My other section/);
    assert.match(after, /FC-USER-A-MARKER/);
    assert.match(after, /KEEP-FC-PRE-A/);
    assert.match(after, /jev-superpowers-zh:begin/);
    assert.match(after, /jev-superpowers-zh:end/);
  } finally {
    rmFixture(dir);
  }
});

test('I-1 b：竞品段是文件最后一段（无后续标题）-> 合法切到 EOF，前文保留', () => {
  const doc = `# 我的项目

前文 KEEP-FC-PRE-B。

## Superpowers (obra)

最后一段：superpowers:using-superpowers 与 Failure Modes 都在这里，之后没有任何标题。
`;
  const dir = migrateClaude(doc);
  try {
    const r = run(['--tool', 'claude'], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const after = readText(path.join(dir, 'CLAUDE.md'));
    assert.ok(!after.includes('Superpowers (obra)'), `竞品段残留:\n${after}`);
    assert.ok(!after.includes('Failure Modes'));
    assert.match(after, /KEEP-FC-PRE-B/);
    assert.match(after, /jev-superpowers-zh:begin/);
  } finally {
    rmFixture(dir);
  }
});

test('I-1 c：三级竞品标题含四级子段一起切，二级用户标题是边界须保留', () => {
  const doc = `# 我的项目

KEEP-FC-PRE-C。

### TypeSafe Jev 门禁（Superpowers）

入门先读 jev-using-superpowers，上线前看 docs/CONFIDENCE.md。

#### Failure Modes 子段

四级子段正文 FC-CHILD-C，归属三级竞品段应一起切除。

## 用户二级标题

FC-USER-C-MARKER：二级标题终止三级竞品段，本章节保留。
`;
  const dir = migrateClaude(doc);
  try {
    const r = run(['--tool', 'claude'], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const after = readText(path.join(dir, 'CLAUDE.md'));
    assert.ok(!after.includes('TypeSafe Jev 门禁'), `三级竞品标题残留:\n${after}`);
    assert.ok(!after.includes('Failure Modes 子段'), '四级子标题应随父段切除');
    assert.ok(!after.includes('FC-CHILD-C'), '四级子段正文应随父段切除');
    assert.ok(!after.includes('docs/CONFIDENCE.md'));
    assert.match(after, /## 用户二级标题/);
    assert.match(after, /FC-USER-C-MARKER/);
    assert.match(after, /KEEP-FC-PRE-C/);
  } finally {
    rmFixture(dir);
  }
});

test('I-1 d：两个竞品段夹一个用户段：两竞品段全切，用户段与首尾保留', () => {
  const doc = `# 我的项目

KEEP-FC-PRE-D。

## Superpowers (obra) 第一段

先调用 superpowers:using-superpowers，并遵守 Failure Modes 清单。

## 用户夹段

FC-USER-MIDDLE-D：这是用户自己的内容。

## Superpowers (obra) 第二段

再次出现：superpowers:using-superpowers 与 Failure Modes。

## 最后用户段

FC-USER-TAIL-D：结尾用户内容。
`;
  const dir = migrateClaude(doc);
  try {
    const r = run(['--tool', 'claude'], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const after = readText(path.join(dir, 'CLAUDE.md'));
    assert.equal((after.match(/Superpowers \(obra\)/g) ?? []).length, 0, `竞品段残留:\n${after}`);
    assert.ok(!after.includes('Failure Modes'));
    assert.match(after, /## 用户夹段/);
    assert.match(after, /FC-USER-MIDDLE-D/);
    assert.match(after, /## 最后用户段/);
    assert.match(after, /FC-USER-TAIL-D/);
    assert.match(after, /KEEP-FC-PRE-D/);
    // 只写入一个本包区块
    assert.equal((after.match(/jev-superpowers-zh:begin/g) ?? []).length, 1);
  } finally {
    rmFixture(dir);
  }
});

test('I-1 e（端到端）：无品牌特征的普通同名 H1 -> 整文件保留并 WARN（S-1 规则不回归）', () => {
  const userDoc = `# 我的项目

一些项目介绍 KEEP-FC-E。

# Superpowers-ZH 中文增强版

这是我自己整理的中文增强笔记，和任何安装器发行版都没有关系；
既没有品牌串，也没有旧版尾句。

# 其他章节

FC-TAIL-E。
`;
  const dir = migrateClaude(userDoc);
  try {
    const r = run(['--uninstall', '--tool', 'claude'], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /WARN/);
    assert.equal(readText(path.join(dir, 'CLAUDE.md')), userDoc.replace(/\r?\n/g, '\n'));
    assert.match(readText(path.join(dir, 'CLAUDE.md')), /FC-TAIL-E/);
  } finally {
    rmFixture(dir);
  }
});

test('I-1 单元：竞品段后用户标题（无品牌词）就是边界，不吞到 EOF', () => {
  const doc = `${'# Project\n\n'}## Superpowers (obra)\n\nUse superpowers:using-superpowers and Failure Modes.\n\n## Notes\n\nFC-UNIT-NOTES.\n`;
  const r = cutForeignMarkedSections(doc);
  assert.equal(r.unresolvable, false);
  assert.equal(r.cut, true);
  assert.ok(!r.text.includes('Superpowers (obra)'));
  assert.match(r.text, /## Notes/);
  assert.match(r.text, /FC-UNIT-NOTES/);
});

test('I-1 单元：有特征串但无品牌标题 -> unresolvable，原文不动', () => {
  const doc = '# My plain guide\n\nRandom mention of Failure Modes without any branded heading.\n';
  const r = cutForeignMarkedSections(doc);
  assert.equal(r.unresolvable, true);
  assert.equal(r.cut, false);
  assert.equal(r.text, doc);
});

test('I-1 单元：段内不足 2 个高置信特征 -> unresolvable，整文件保留', () => {
  const doc = '## Superpowers (obra)\n\nOnly superpowers:using-superpowers here.\n\n## User\n\nFC-WEAK-KEEP.\n';
  const r = cutForeignMarkedSections(doc);
  assert.equal(r.unresolvable, true);
  assert.equal(r.text, doc);
});

test('I-1 单元：代码围栏内的 ## 标题既不是候选也不是边界，围栏外切除仍精确', () => {
  const doc = [
    '# Project',
    '',
    'KEEP-FENCE-PRE.',
    '',
    '```markdown',
    '## Superpowers (obra)',
    'superpowers:using-superpowers Failure Modes',
    '```',
    '',
    '## Superpowers (obra)',
    'real superpowers:using-superpowers plus Failure Modes body.',
    '',
    '## User section',
    'FC-FENCE-MARKER.',
    '',
  ].join('\n');
  const titles = scanAtxHeadings(doc).map(h => h.text);
  assert.deepEqual(titles, ['Project', 'Superpowers (obra)', 'User section']);
  const r = cutForeignMarkedSections(doc);
  assert.equal(r.unresolvable, false, JSON.stringify(r.text.slice(0, 200)));
  assert.match(r.text, /KEEP-FENCE-PRE/);
  // 围栏及其内的「假竞品段」位于真实竞品段之前，原样保留
  assert.match(r.text, /```markdown/);
  assert.match(r.text, /FC-FENCE-MARKER/);
  assert.match(r.text, /## User section/);
  assert.ok(!/^## Superpowers \(obra\)$/m.test(r.text.split('```')[2] || ''));
});
