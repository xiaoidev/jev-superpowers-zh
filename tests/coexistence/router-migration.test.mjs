// tests/coexistence/router-migration.test.mjs — router/hook 接管（用例 7 的 router 部分）：
// zh 新旧哨兵/固定标题段备份后切除并写入本包成对哨兵；用户内容保留；
// 独立规则文件竞品副本备份后移除；悬空 begin 哨兵 WARN 不接管；
// S-9 多目标共享 AGENTS.md 区块共存；--uninstall --tool 仅切本目标区块（R-3）。
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  run, mkFixture, rmFixture, readText, exists, listBackups, backupHasContent,
} from './helpers.mjs';

test('zh 哨兵段：备份整文件 -> 精确切除 -> 写入本包成对哨兵；用户前后内容保留', () => {
  const dir = mkFixture('jevzh-router-zhsentinel-');
  const existing = `# 我的项目

区块前的用户内容 KEEP-ROUTER-A。

<!-- superpowers-zh:begin (do not edit between these markers) -->
# Superpowers-ZH 中文增强版

旧 superpowers-zh 自动写入的引导。
<!-- superpowers-zh:end -->

区块后的用户内容 KEEP-ROUTER-B。
`;
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), existing);
  try {
    const r = run(['--tool', 'claude'], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /\[MIGRATE\]|MIGRATE/);
    const after = readText(path.join(dir, 'CLAUDE.md'));
    assert.ok(!after.includes('<!-- superpowers-zh:begin'), '旧 zh begin 哨兵应已切除（新 jevzh 哨兵含同后缀不算残留）');
    assert.ok(!after.includes('旧 superpowers-zh 自动写入的引导'));
    assert.match(after, /<!-- jev-superpowers-zh:begin/);
    assert.match(after, /<!-- jev-superpowers-zh:end/);
    assert.equal((after.match(/jev-superpowers-zh:begin/g) ?? []).length, 1);
    assert.equal((after.match(/jev-superpowers-zh:end/g) ?? []).length, 1);
    assert.match(after, /KEEP-ROUTER-A/);
    assert.match(after, /KEEP-ROUTER-B/);

    // 备份存在且内容是原始整文件
    const backups = listBackups(dir);
    assert.equal(backups.length, 1);
    assert.ok(backupHasContent(dir, backups[0], 'superpowers-zh:begin'));
    assert.ok(backupHasContent(dir, backups[0], 'KEEP-ROUTER-A'));
  } finally {
    rmFixture(dir);
  }
});

test('v1.1.x 无哨兵旧 zh 固定标题段同样按高置信特征切除，本包段接管', () => {
  const dir = mkFixture('jevzh-router-legacyh1-');
  const doc = `# 我的项目

前文 KEEP-ROUTER-C。

# Superpowers-ZH 工作方法论

旧版安装器写入的引导正文。
当你认为哪怕 1% 可能适用时，你必须调用该 skill 检查。

# 用户后续章节

后文 KEEP-ROUTER-D。
`;
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), doc);
  try {
    const r = run(['--tool', 'claude'], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const after = readText(path.join(dir, 'CLAUDE.md'));
    assert.ok(!after.includes('# Superpowers-ZH'), `旧标题残留:\n${after}`);
    // 注意：本包新段尾也有同义尾句「你必须调用该 skill 检查。」，这里精确匹配旧段原句。
    assert.ok(!after.includes('当你认为哪怕 1% 可能适用时，你必须调用该 skill 检查。'));
    assert.match(after, /KEEP-ROUTER-C/);
    assert.match(after, /# 用户后续章节/);
    assert.match(after, /KEEP-ROUTER-D/);
    assert.match(after, /jev-superpowers-zh:begin/);
  } finally {
    rmFixture(dir);
  }
});

test('Trae 独立规则文件：旧 superpowers-zh.md 备份后移除，jevzh.md 接管；--keep-router 保留双份', () => {
  const dir = mkFixture('jevzh-router-standalone-');
  fs.mkdirSync(path.join(dir, '.trae', 'rules'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.trae', 'rules', 'superpowers-zh.md'), '# ZH-STANDALONE-MARKER\n');
  try {
    const r = run(['--tool', 'trae'], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(!exists(path.join(dir, '.trae', 'rules', 'superpowers-zh.md')));
    assert.ok(exists(path.join(dir, '.trae', 'rules', 'jevzh.md')));
    const ts = listBackups(dir)[0];
    assert.ok(ts, '接管应产生备份');
    assert.ok(backupHasContent(dir, ts, 'ZH-STANDALONE-MARKER'));
  } finally {
    rmFixture(dir);
  }

  const dir2 = mkFixture('jevzh-router-standalone-keep-');
  fs.mkdirSync(path.join(dir2, '.trae', 'rules'), { recursive: true });
  fs.writeFileSync(path.join(dir2, '.trae', 'rules', 'superpowers-zh.md'), '# ZH-STANDALONE-MARKER\n');
  try {
    const r = run(['--tool', 'trae', '--keep-router'], { cwd: dir2 });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(readText(path.join(dir2, '.trae', 'rules', 'superpowers-zh.md')), '# ZH-STANDALONE-MARKER\n');
    assert.ok(exists(path.join(dir2, '.trae', 'rules', 'jevzh.md')));
  } finally {
    rmFixture(dir2);
  }
});

test('R8 悬空 begin 哨兵（begin 无 end）：WARN 且该文件不接管/不追加，技能照补', () => {
  const dir = mkFixture('jevzh-router-dangling-');
  const doc = `# 我的项目

用户前文 KEEP-DANGLING-1。

<!-- superpowers-zh:begin (do not edit between these markers) -->
旧段内容没有配对 end，边界不可判定 KEEP-DANGLING-2。

# 用户后续
`;
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), doc);
  try {
    const r = run(['--tool', 'claude'], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const out = r.stdout + r.stderr;
    assert.match(out, /WARN/);
    assert.match(out, /悬空|配对|哨兵/);
    // 文件逐字保留，本包段不追加（避免双 begin 混乱）
    assert.equal(readText(path.join(dir, 'CLAUDE.md')), doc.replace(/\r?\n/g, '\n'));
    assert.ok(!readText(path.join(dir, 'CLAUDE.md')).includes('jev-superpowers-zh:begin'));
    assert.ok(exists(path.join(dir, '.claude', 'skills', 'jev-verification', 'SKILL.md')));
  } finally {
    rmFixture(dir);
  }
});

test('S-9：Hermes + DeepSeek 同装时 AGENTS.md 共存两个 target 区块，幂等不重复', () => {
  const dir = mkFixture('jevzh-router-s9-');
  fs.mkdirSync(path.join(dir, '.hermes'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.dsh'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# 共享 AGENTS\n\n用户内容 KEEP-S9-0。\n');
  try {
    const r1 = run([], { cwd: dir });
    assert.equal(r1.status, 0, r1.stdout + r1.stderr);
    const after1 = readText(path.join(dir, 'AGENTS.md'));
    assert.equal((after1.match(/jev-superpowers-zh:begin/g) ?? []).length, 2, `应有两个 target 区块:\n${after1}`);
    assert.equal((after1.match(/jev-superpowers-zh:end/g) ?? []).length, 2);
    assert.match(after1, /Hermes Agent/);
    assert.match(after1, /DeepSeek Harness/);
    assert.match(after1, /KEEP-S9-0/);

    // 幂等：再跑一次区块数不变
    const r2 = run([], { cwd: dir });
    assert.equal(r2.status, 0, r2.stdout + r2.stderr);
    const after2 = readText(path.join(dir, 'AGENTS.md'));
    assert.equal((after2.match(/jev-superpowers-zh:begin/g) ?? []).length, 2);

    // R-3：仅卸载 Hermes -> Hermes 区块消失，DeepSeek 区块保留
    const r3 = run(['--uninstall', '--tool', 'hermes'], { cwd: dir });
    assert.equal(r3.status, 0, r3.stdout + r3.stderr);
    const after3 = readText(path.join(dir, 'AGENTS.md'));
    assert.equal((after3.match(/jev-superpowers-zh:begin/g) ?? []).length, 1);
    assert.doesNotMatch(after3, /target="Hermes Agent"/);
    assert.match(after3, /target="DeepSeek Harness"/);
    assert.match(after3, /KEEP-S9-0/);
  } finally {
    rmFixture(dir);
  }
});
