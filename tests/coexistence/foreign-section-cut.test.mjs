// tests/coexistence/foreign-section-cut.test.mjs — I-1：无哨兵英文 jev/obra 段切除
// 必须按「其后第一个同级/更高级 ATX 标题（无论标题文本）」定界，绝不吞掉竞品段
// 之后的用户内容；多个竞品段一次扫描逐段判定；三级段包含四级子段；代码围栏内的
// markdown 标题不算边界；无品牌特征普通 H1 不切（任务 6 S-1 规则不回归）。
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { run, mkFixture, rmFixture, readText, exists } from './helpers.mjs';
import { BIN } from '../installer/helpers.mjs';

const mod = await import(pathToFileURL(BIN).href);
const {
  cutForeignMarkedSections,
  scanAtxHeadings,
  stripCodeBlocks,
  maskInlineCodeSpans,
  forEachMarkdownLine,
} = mod;

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

// ── I-1′ 复验残留：嵌套竞品标题（各自 hits>=2 的候选区间相互包含）────────────
// 修复前区间在原始文本上独立计算、从后往前按旧下标切，切掉内层后外层多删恰好
// 一个内层长度，竞品段之后的用户章节在默认安装路径被静默吞掉（rc=0、无 WARN）。
test('I-1′ a：外层 ## 竞品段内含 ### 竞品子段 -> 两段都消失，外层后的用户 ## 章节与标记保留', () => {
  const doc = `# 我的项目

前文 KEEP-FCP-A-PRE。

## Superpowers (obra)

会话开始先走 superpowers:using-superpowers；任何跳步都要先查 Failure Modes。

### Superpowers 失败模式清单

Failure Modes 细节另见 docs/CONFIDENCE.md。

## 我自己的部署章节

FC-FCP-A-DEPLOY-MARKER：这是竞品段之后用户自己写的部署章节，绝不能被吞。
`;
  const dir = migrateClaude(doc);
  try {
    const r = run(['--tool', 'claude'], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /MIGRATE/);
    const after = readText(path.join(dir, 'CLAUDE.md'));
    assert.ok(!after.includes('Superpowers (obra)'), `外层竞品标题残留:\n${after}`);
    assert.ok(!after.includes('Superpowers 失败模式清单'), '内层竞品标题残留');
    assert.ok(!after.includes('docs/CONFIDENCE.md'), '内层竞品正文残留');
    assert.ok(!after.includes('superpowers:using-superpowers'), '外层竞品正文残留');
    assert.match(after, /## 我自己的部署章节/);
    assert.match(after, /FC-FCP-A-DEPLOY-MARKER/);
    assert.match(after, /KEEP-FCP-A-PRE/);
    assert.match(after, /jev-superpowers-zh:begin/);
    assert.match(after, /jev-superpowers-zh:end/);
  } finally {
    rmFixture(dir);
  }
});

test('I-1′ b：# / ## / ### 三层嵌套品牌标题各自成候选 -> 整段合并切除，用户顶级章节保留', () => {
  const doc = `KEEP-FCP-B-PRE 开篇文字。

# Superpowers 总览

入口先走 superpowers:using-superpowers，Failure Modes 必读。

## Superpowers (obra)

正文涉及 jev-superpowers 与 docs/CONFIDENCE.md。

### Superpowers 失败模式清单

Failure Modes 详见 docs/CONFIDENCE.md。

# 我自己的顶级章节

FC-FCP-B-USER-MARKER：三层嵌套之后的用户内容必须保留。
`;
  const dir = migrateClaude(doc);
  try {
    const r = run(['--tool', 'claude'], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const after = readText(path.join(dir, 'CLAUDE.md'));
    assert.ok(!after.includes('Superpowers 总览'), `H1 竞品标题残留:\n${after}`);
    assert.ok(!after.includes('Superpowers (obra)'), 'H2 竞品标题残留');
    assert.ok(!after.includes('Superpowers 失败模式清单'), 'H3 竞品标题残留');
    assert.ok(!after.includes('docs/CONFIDENCE.md'));
    assert.match(after, /KEEP-FCP-B-PRE/);
    assert.match(after, /# 我自己的顶级章节/);
    assert.match(after, /FC-FCP-B-USER-MARKER/);
    assert.match(after, /jev-superpowers-zh:begin/);
  } finally {
    rmFixture(dir);
  }
});

test('I-1′ c：同级竞品区间在尾随空行处接壤 -> 行为与修复前逐字节一致（只修不错位的情况）', () => {
  const doc = `# Project

KEEP-FCP-C-PRE.

## Superpowers (obra)
superpowers:using-superpowers and Failure Modes body one.

## Superpowers Two
superpowers:using-superpowers and Failure Modes body two.

## User tail
FC-FCP-C-TAIL.
`;
  // 单元层锁定修复前实测基准：两个接壤区间合并切除 == 旧实现逐段切除的结果。
  const unit = cutForeignMarkedSections(doc.replace(/\r?\n/g, '\n'));
  assert.equal(unit.unresolvable, false);
  assert.equal(
    unit.text,
    '# Project\n\nKEEP-FCP-C-PRE.\n\n## User tail\nFC-FCP-C-TAIL.\n',
  );
  // 端到端落盘安装断言同样成立。
  const dir = migrateClaude(doc);
  try {
    const r = run(['--tool', 'claude'], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const after = readText(path.join(dir, 'CLAUDE.md'));
    assert.ok(!after.includes('Superpowers (obra)'), `接壤竞品段 1 残留:\n${after}`);
    assert.ok(!after.includes('Superpowers Two'), '接壤竞品段 2 残留');
    assert.match(after, /KEEP-FCP-C-PRE/);
    assert.match(after, /## User tail/);
    assert.match(after, /FC-FCP-C-TAIL/);
  } finally {
    rmFixture(dir);
  }
});

test('I-1′ d：嵌套但内层候选 hits<2 -> unresolvable，整文件保留并 WARN（沿用现状）', () => {
  const doc = `# 我的项目

KEEP-FCP-D-PRE。

## Superpowers (obra)

superpowers:using-superpowers 与 Failure Modes 都在这一段。

### Superpowers 备注

这里只是普通中文说明，没有任何第二个高置信特征串，内层段 hits 不足 2。

## 用户章节

FC-FCP-D-USER-MARKER：边界存疑时整文件保留，本章节当然也在。
`;
  // 单元：内层段证据不足 -> 整文件不切。
  const unit = cutForeignMarkedSections(doc.replace(/\r?\n/g, '\n'));
  assert.equal(unit.unresolvable, true);
  assert.equal(unit.cut, false);
  assert.equal(unit.text, doc.replace(/\r?\n/g, '\n'));
  // 端到端：默认安装路径检测到竞品但边界不可判定 -> WARN，CLAUDE.md 字节不动。
  const dir = migrateClaude(doc);
  try {
    const r = run(['--tool', 'claude'], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /WARN/);
    assert.match(r.stdout + r.stderr, /边界不可判定/);
    assert.equal(readText(path.join(dir, 'CLAUDE.md')), doc.replace(/\r?\n/g, '\n'));
    assert.match(readText(path.join(dir, 'CLAUDE.md')), /FC-FCP-D-USER-MARKER/);
    assert.doesNotMatch(readText(path.join(dir, 'CLAUDE.md')), /jev-superpowers-zh:begin/);
  } finally {
    rmFixture(dir);
  }
});

test('I-1′ e：内层品牌段之后、外层结束之前的用户三级章节 -> 归属竞品外层段一并切除（语义固化）', () => {
  // 取舍说明：### 我的笔记 在两个品牌标题之间、且位于外层 ## 候选区间内部；
  // 合并区间按「外层竞品段的下一个同级/更高级标题」定界，该三级章节在结构上
  // 属于竞品外层段（其上级是竞品 H2，而非用户 H2），故随外层段一并切除。
  // 代码依据：cutForeignMarkedSections 的区间并集为 [外层 H2 start, 用户 H2
  // start)，区间内任何标题/正文都不改变外层边界（只有 level<=2 的标题能终止）。
  const doc = `# 我的项目

KEEP-FCP-E-PRE。

## Superpowers (obra)

superpowers:using-superpowers 与 Failure Modes 外层正文。

### Superpowers 失败模式清单

Failure Modes 与 docs/CONFIDENCE.md 内层正文。

### 我的笔记

FC-FCP-E-NOTE：用户夹在品牌标题之间的三级章节，归属竞品外层段一并切除。

## 用户顶级章节

FC-FCP-E-USER-MARKER：外层竞品段结束后的用户章节必须保留。
`;
  const dir = migrateClaude(doc);
  try {
    const r = run(['--tool', 'claude'], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const after = readText(path.join(dir, 'CLAUDE.md'));
    assert.ok(!after.includes('Superpowers (obra)'), `外层竞品标题残留:\n${after}`);
    assert.ok(!after.includes('Superpowers 失败模式清单'), '内层竞品标题残留');
    assert.ok(!after.includes('### 我的笔记'), '外层区间内的用户三级章节应随外层段切除');
    assert.ok(!after.includes('FC-FCP-E-NOTE'), '外层区间内的用户三级章节正文应切除');
    assert.match(after, /KEEP-FCP-E-PRE/);
    assert.match(after, /## 用户顶级章节/);
    assert.match(after, /FC-FCP-E-USER-MARKER/);
    assert.match(after, /jev-superpowers-zh:begin/);
  } finally {
    rmFixture(dir);
  }
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

// ════════════════════════════════════════════════════════════════════════════
// R-3：竞品检测必须围栏/4 空格缩排块/行内 code span 感知——文档里【演示旧命令】
// 不等于文件被竞品接管。刻意取舍：检测侧用最简单的结构状态机（0-3 空格开栏、
// 同字符同长度 info 空闭栏、4+ 空格/Tab 行即缩排代码），不做 CommonMark 空行
// 与段落判定，宁可漏判（真竞品落在代码样式里也不切）也不误删用户文档。
// ════════════════════════════════════════════════════════════════════════════

test('R-3 单元：stripCodeBlocks 与原文【等长】且偏移一致（围栏/缩排/行内 span 掩码）', () => {
  const doc = [
    '# 标题 KEEP-R3U',
    '',
    '正文提到 `superpowers:using-superpowers` 行内 span。',
    '',
    '```js',
    '// TypeSafe Jev / Failure Modes / jev-superpowers 都在围栏里',
    'const x = "superpowers:using-superpowers";',
    '```',
    '',
    '    四个空格缩排：docs/CONFIDENCE.md jev-using-superpowers',
    '\tTab 缩排：TypeSafe Jev',
    '',
    '围栏外真命中：Failure Modes。',
    '',
  ].join('\n');
  const probe = stripCodeBlocks(doc);
  // 等长是「按原始下标切区间计数」正确性的前提。
  assert.equal(probe.length, doc.length, '正文视图必须与原文等长');
  assert.ok(!probe.includes('superpowers:using-superpowers'), '围栏/span 命中未掩码');
  assert.ok(!probe.includes('TypeSafe Jev'), '围栏/Tab 缩排命中未掩码');
  assert.ok(!probe.includes('docs/CONFIDENCE.md'), '4 空格缩排命中未掩码');
  assert.ok(!probe.includes('jev-using-superpowers'));
  assert.ok(!probe.includes('jev-superpowers'));
  // 正文（含围栏外真命中、普通文字、反引号外的中文）原样可见。
  assert.match(probe, /围栏外真命中：Failure Modes。/);
  assert.match(probe, /# 标题 KEEP-R3U/);
  assert.match(probe, /正文提到/);
  // 行内 span 只掩码 span 本身：反引号前后的中文仍在原位（偏移不变）。
  assert.equal(probe.indexOf('正文提到'), doc.indexOf('正文提到'));
  assert.equal(probe.indexOf('行内 span。'), doc.indexOf('行内 span。'));

  // forEachMarkdownLine 的 offset 与原文行首下标一致，inCode 标注符合预期。
  const seen = [];
  forEachMarkdownLine(doc, ({ line, offset, inCode }) => seen.push({ line, offset, inCode }));
  for (const s of seen) {
    // 直接按 offset 切片比对（indexOf 对空串恒为 0，不能用于空行）。
    assert.equal(doc.slice(s.offset, s.offset + s.line.length), s.line, `offset 错位: ${s.line}`);
  }
  assert.ok(seen.find(s => s.line.startsWith('const x'))?.inCode);
  assert.ok(seen.find(s => s.line.startsWith('    四个空格'))?.inCode);
  assert.ok(seen.find(s => s.line.startsWith('\tTab 缩排'))?.inCode);
  assert.equal(seen.find(s => s.line.startsWith('围栏外真命中'))?.inCode, false);
  assert.equal(seen.find(s => s.line.startsWith('正文提到'))?.inCode, false);
});

test('R-3 单元：maskInlineCodeSpans 等长掩码；等长 run 配对；未闭合 run 按字面保留', () => {
  const s1 = 'a `code` b';
  assert.equal(maskInlineCodeSpans(s1).length, s1.length);
  // 'a' + 反引号前原空格 + 6 个 span 字符掩码 + 闭反引号后原空格 + 'b' = 中间 8 空格。
  assert.match(maskInlineCodeSpans(s1), /^a {8}b$/);
  // 双反引号 run 内含单反引号：``a`b`` 是合法 span（7 字符），整体掩码且等长。
  const s2 = 'x ``a`b`` y';
  const paired = maskInlineCodeSpans(s2);
  assert.equal(paired.length, s2.length);
  assert.ok(!paired.includes('a`b'));
  assert.match(paired, /^x {9}y$/);
  // 未闭合 run：CommonMark 视为字面文本，原样返回（不扩大剔除面）。
  const unclosed = 'just `superpowers:using-superpowers no closing run';
  assert.equal(maskInlineCodeSpans(unclosed), unclosed);
  // 无反引号行恒等。
  assert.equal(maskInlineCodeSpans('普通正文 Failure Modes'), '普通正文 Failure Modes');
});

test('R-3 单元：scanAtxHeadings 跳过围栏/缩排块内标题；~~~ 与反引号围栏等价', () => {
  const doc = [
    '# H1 真标题',
    '',
    '~~~',
    '## 波浪围栏标题',
    '~~~',
    '',
    '    ## 四空格缩排不是标题',
    '\t## Tab 缩排不是标题',
    '',
    '## H2 真标题',
    '',
    '```',
    '### 反引号围栏标题',
    '', // 未闭合围栏：其后所有行持续 inCode，直到 EOF
  ].join('\n');
  const titles = scanAtxHeadings(doc).map(h => h.text);
  assert.deepEqual(titles, ['H1 真标题', 'H2 真标题']);
});

test('R-3 单元：竞品命中只存在于代码结构内 -> cut=false 且 unresolvable=false（干净路径）', () => {
  const doc = [
    '# Project',
    '',
    '文档演示旧命令：',
    '',
    '```',
    '## Superpowers (obra)',
    'superpowers:using-superpowers Failure Modes TypeSafe Jev',
    'jev-using-superpowers docs/CONFIDENCE.md jev-superpowers',
    '```',
    '',
    '    superpowers:using-superpowers Failure Modes（缩排块）',
    '',
    '正文也可提 `superpowers:using-superpowers` 行内 code。',
    '',
  ].join('\n');
  const r = cutForeignMarkedSections(doc);
  assert.equal(r.cut, false);
  assert.equal(r.unresolvable, false);
  assert.equal(r.text, doc);
});

test('R-3 a（端到端）：竞品串只在 ```js 围栏内 -> 干净追加路径，围栏字节原样保留', () => {
  const doc = [
    '# 我的项目',
    '',
    'KEEP-R3A-PRE 项目说明。',
    '',
    '```js',
    '// 旧文档示例（历史保留，勿删）：',
    '// invoke superpowers:using-superpowers, see Failure Modes',
    '// TypeSafe Jev / jev-using-superpowers / docs/CONFIDENCE.md / jev-superpowers',
    'const legacy = "R3A-FENCE-MARKER";',
    '```',
    '',
    'KEEP-R3A-TAIL 围栏之后的正文。',
    '',
  ].join('\n');
  const dir = migrateClaude(doc);
  try {
    const r = run(['--tool', 'claude'], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const out = r.stdout + r.stderr;
    assert.doesNotMatch(out, /\[MIGRATE\]/, '围栏内演示不得触发 MIGRATE');
    const after = readText(path.join(dir, 'CLAUDE.md'));
    // 围栏整块（含全部「竞品串」演示行与闭合标记）逐字节保留。
    assert.match(after, /R3A-FENCE-MARKER/);
    assert.match(after, /invoke superpowers:using-superpowers, see Failure Modes/);
    assert.match(after, /TypeSafe Jev \/ jev-using-superpowers \/ docs\/CONFIDENCE\.md \/ jev-superpowers/);
    assert.equal((after.match(/```js/g) ?? []).length, 1);
    assert.match(after, /KEEP-R3A-PRE/);
    assert.match(after, /KEEP-R3A-TAIL/);
    // 干净文件：本包 bootstrap 正常追加。
    assert.match(after, /jev-superpowers-zh:begin/);
    assert.equal((after.match(/jev-superpowers-zh:begin/g) ?? []).length, 1);
    assert.ok(exists(path.join(dir, '.claude', 'skills', 'using-superpowers', 'SKILL.md')), '技能正常安装');
  } finally {
    rmFixture(dir);
  }
});

test('R-3 b（端到端）：围栏内假竞品段保留 + 围栏外真竞品段精确切除（MIGRATE 只切真段）', () => {
  const doc = [
    '# 我的项目',
    '',
    'KEEP-R3B-PRE。',
    '',
    '```markdown',
    '## Superpowers (obra)',
    '围栏演示：superpowers:using-superpowers 与 Failure Modes 只是文档示例 R3B-FENCE-MARKER。',
    '```',
    '',
    '## Superpowers (obra)',
    '',
    'R3B-REAL-MARKER 真段正文：superpowers:using-superpowers plus Failure Modes。',
    '',
    '## 用户章节',
    '',
    'KEEP-R3B-USER：真竞品段之后的用户内容必须保留。',
    '',
  ].join('\n');
  const dir = migrateClaude(doc);
  try {
    const r = run(['--tool', 'claude'], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /\[MIGRATE\]/);
    const after = readText(path.join(dir, 'CLAUDE.md'));
    // 围栏整块原样保留（围栏里的假标题/假特征都在）。
    assert.match(after, /R3B-FENCE-MARKER/);
    assert.match(after, /围栏演示：superpowers:using-superpowers 与 Failure Modes/);
    assert.equal((after.match(/```markdown/g) ?? []).length, 1);
    // 围栏外真段切除。
    assert.ok(!after.includes('R3B-REAL-MARKER'), `真竞品段残留:\n${after}`);
    // 真段标题切了、围栏内标题文本保留（作为围栏内容出现 1 次）。
    const headingOccurrences = after.match(/## Superpowers \(obra\)/g) ?? [];
    assert.equal(headingOccurrences.length, 1, '应只剩围栏内那一处假标题');
    assert.match(after, /## 用户章节/);
    assert.match(after, /KEEP-R3B-USER/);
    assert.match(after, /KEEP-R3B-PRE/);
    assert.match(after, /jev-superpowers-zh:begin/);
  } finally {
    rmFixture(dir);
  }
});

test('R-3 c（端到端）：竞品串只在 4 空格缩排代码块内 -> 干净追加，缩排行字节保留', () => {
  const doc = [
    '# 我的项目',
    '',
    'KEEP-R3C-PRE。',
    '',
    '    superpowers:using-superpowers Failure Modes R3C-INDENT-MARKER',
    '    jev-using-superpowers docs/CONFIDENCE.md TypeSafe Jev jev-superpowers',
    '',
    'KEEP-R3C-TAIL。',
    '',
  ].join('\n');
  const dir = migrateClaude(doc);
  try {
    const r = run(['--tool', 'claude'], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout + r.stderr, /\[MIGRATE\]/);
    const after = readText(path.join(dir, 'CLAUDE.md'));
    assert.match(after, /R3C-INDENT-MARKER/);
    assert.match(after, / {4}jev-using-superpowers docs\/CONFIDENCE\.md/);
    assert.match(after, /KEEP-R3C-PRE/);
    assert.match(after, /KEEP-R3C-TAIL/);
    assert.match(after, /jev-superpowers-zh:begin/);
  } finally {
    rmFixture(dir);
  }
});

test('R-3 d（端到端）：竞品串只在行内 code span 内 -> 干净追加，原句逐字保留', () => {
  const doc = [
    '# 我的项目',
    '',
    'KEEP-R3D-PRE。',
    '',
    '排障时先读 `docs/CONFIDENCE.md`；旧命令 `superpowers:using-superpowers` 仅作历史参考；',
    '技能 `jev-using-superpowers` 已改名；英文品牌 `TypeSafe Jev` 与 `Failure Modes` R3D-SPAN-MARKER 不再出现于正文。',
    '',
    'KEEP-R3D-TAIL。',
    '',
  ].join('\n');
  const dir = migrateClaude(doc);
  try {
    const r = run(['--tool', 'claude'], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout + r.stderr, /\[MIGRATE\]/);
    const after = readText(path.join(dir, 'CLAUDE.md'));
    assert.match(after, /R3D-SPAN-MARKER/);
    assert.match(after, /`superpowers:using-superpowers`/);
    assert.match(after, /`TypeSafe Jev`/);
    assert.match(after, /KEEP-R3D-PRE/);
    assert.match(after, /KEEP-R3D-TAIL/);
    assert.match(after, /jev-superpowers-zh:begin/);
  } finally {
    rmFixture(dir);
  }
});

test('R-3 e（端到端）：品牌标题但段内特征不足 -> unresolvable：rc0 文件不动技能照装，stdout 明示路由未接管', () => {
  const doc = [
    '# 我的项目',
    '',
    'KEEP-R3E-PRE。',
    '',
    '## Superpowers (obra)',
    '',
    '本段只有 superpowers:using-superpowers 一个高置信特征，证据不足无法定界 R3E-WEAK。',
    '',
    '## 用户章节',
    '',
    'KEEP-R3E-USER。',
    '',
  ].join('\n');
  const dir = migrateClaude(doc);
  try {
    const r = run(['--tool', 'claude'], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr); // 退出码语义不变：unresolvable 仍 0
    const out = r.stdout + r.stderr;
    // stderr 详细 WARN 保留（I-1′ d 既有断言口径）。
    assert.match(out, /WARN/);
    assert.match(out, /边界不可判定/);
    // R-3：结局必须在 stdout 可见（不能只留 stderr 一句告警）。
    assert.match(r.stdout, /路由未接管/);
    assert.match(r.stdout, /需手工处理/);
    assert.match(r.stdout, /技能已安装/);
    assert.match(r.stdout, /CLAUDE\.md/);
    // 安装汇总点名。
    assert.match(r.stdout, /另有 1 个 router 文件路由未接管/);
    // 文件字节不动、本包区块绝不追加。
    assert.equal(readText(path.join(dir, 'CLAUDE.md')), doc);
    assert.match(readText(path.join(dir, 'CLAUDE.md')), /R3E-WEAK/);
    assert.doesNotMatch(readText(path.join(dir, 'CLAUDE.md')), /jev-superpowers-zh:begin/);
    // 技能照常安装（路由没接管不等于整单失败）。
    assert.ok(exists(path.join(dir, '.claude', 'skills', 'using-superpowers', 'SKILL.md')), '技能应已安装');
  } finally {
    rmFixture(dir);
  }
});
