// tests/installer/coexist.test.mjs — 任务 6 共存红线（基础版）：
// 同名技能零覆盖仅补缺 + WARN；非本哨兵管理的同名 bootstrap 区块/文件 WARN 且不动。
// 硬阻断（plugin 形态）、来源识别、备份接管、--adopt-skills 等留待任务 7。
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { run, mkFixture, rmFixture, readText, exists } from './helpers.mjs';

test('预存同名用户技能内容不被覆盖，输出 WARN，且不写入本包 meta', () => {
  const dir = mkFixture('jevzh-coexist-skill-');
  const marker = `---
name: brainstorming
description: 用户自己改写过的版本
---

# USER-CONTENT-MARKER-7F3A 用户自有内容，绝不能被覆盖
`;
  try {
    const userSkill = path.join(dir, '.claude', 'skills', 'brainstorming');
    fs.mkdirSync(userSkill, { recursive: true });
    fs.writeFileSync(path.join(userSkill, 'SKILL.md'), marker);

    const r = run(['--tool', 'claude'], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const out = r.stdout + r.stderr;
    assert.match(out, /WARN/);
    assert.match(out, /brainstorming/);

    // 用户内容原样保留
    assert.equal(readText(path.join(userSkill, 'SKILL.md')), marker.replace(/\r?\n/g, '\n'));
    // 未被伪装成本包副本
    assert.ok(!exists(path.join(userSkill, '.jevzh-meta.json')));

    // 其余 26 个技能正常补缺
    const dirs = fs
      .readdirSync(path.join(dir, '.claude', 'skills'), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    assert.equal(dirs.length, 27);
    assert.ok(dirs.includes('jev-verification'));

    // 名单外的用户自建技能同样保留
    const ownerSkill = path.join(dir, '.claude', 'skills', 'owner-only');
    fs.mkdirSync(ownerSkill, { recursive: true });
    fs.writeFileSync(path.join(ownerSkill, 'SKILL.md'), '---\nname: owner-only\n---\n');
    // （下一次安装也不得动它）
    const r2 = run(['--tool', 'claude'], { cwd: dir });
    assert.equal(r2.status, 0);
    assert.ok(exists(path.join(ownerSkill, 'SKILL.md')));
  } finally {
    rmFixture(dir);
  }
});

test('CLAUDE.md 已含 superpowers-zh 哨兵区块：默认 MIGRATE 备份后切除旧段并写入本包哨兵；--keep-router 双份保留', () => {
  const dir = mkFixture('jevzh-coexist-sentinel-');
  const existing = `# 我的项目

用户自有引导内容 KEEP-SENTINEL-HEAD。

<!-- superpowers-zh:begin (do not edit between these markers) -->
# Superpowers-ZH 中文增强版

旧 superpowers-zh 区块内容 ZH-SECTION-BODY。
<!-- superpowers-zh:end -->

结尾的用户内容 KEEP-SENTINEL-TAIL。
`;
  try {
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), existing);
    const r = run(['--tool', 'claude'], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const out = r.stdout + r.stderr;
    // 任务 7：默认从「WARN 不动」升级为「备份后精确接管（MIGRATE）」
    assert.match(out, /MIGRATE/);
    const after = readText(path.join(dir, 'CLAUDE.md'));
    assert.ok(!after.includes('<!-- superpowers-zh:begin'), '旧 zh 哨兵应切除');
    assert.ok(!after.includes('ZH-SECTION-BODY'), '旧段正文应切除');
    assert.match(after, /<!-- jev-superpowers-zh:begin/);
    assert.match(after, /<!-- jev-superpowers-zh:end/);
    assert.equal((after.match(/jev-superpowers-zh:begin/g) ?? []).length, 1);
    assert.match(after, /KEEP-SENTINEL-HEAD/);
    assert.match(after, /KEEP-SENTINEL-TAIL/);
    // 接管属于破坏性操作，必须留下备份
    const bkRoot = path.join(dir, '.jevzh', 'backups');
    assert.ok(exists(bkRoot) && fs.readdirSync(bkRoot).length >= 1, 'MIGRATE 应产生备份');

    // --keep-router：共享 bootstrap 整文件保留（旧段不切、本包段也不追加）
    const dir2 = mkFixture('jevzh-coexist-sentinel-keep-');
    try {
      fs.writeFileSync(path.join(dir2, 'CLAUDE.md'), existing);
      const rk = run(['--tool', 'claude', '--keep-router'], { cwd: dir2 });
      assert.equal(rk.status, 0, rk.stdout + rk.stderr);
      assert.match(rk.stdout + rk.stderr, /WARN/);
      const kept = readText(path.join(dir2, 'CLAUDE.md'));
      assert.equal(kept, existing.replace(/\r?\n/g, '\n'), '--keep-router 应字节级不动');
      assert.match(kept, /<!-- superpowers-zh:begin/, '--keep-router 应保留旧 zh 哨兵');
      assert.match(kept, /ZH-SECTION-BODY/, '--keep-router 应保留旧段正文');
      assert.ok(!kept.includes('jev-superpowers-zh:begin'), '--keep-router 不追加本包段');
    } finally {
      rmFixture(dir2);
    }
  } finally {
    rmFixture(dir);
  }
});

test('Trae 已装 zh 独立规则文件：默认备份后移除旧文件并写 jevzh.md；--keep-router 双份保留', () => {
  const dir = mkFixture('jevzh-coexist-rule-');
  try {
    const zhRuleDir = path.join(dir, '.trae', 'rules');
    fs.mkdirSync(zhRuleDir, { recursive: true });
    fs.writeFileSync(path.join(zhRuleDir, 'superpowers-zh.md'), '# ZH-RULE-MARKER\n');

    const r = run(['--tool', 'trae'], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const out = r.stdout + r.stderr;
    assert.match(out, /MIGRATE/);
    assert.ok(!exists(path.join(zhRuleDir, 'superpowers-zh.md')), '旧规则文件应已备份后移除');
    assert.ok(exists(path.join(zhRuleDir, 'jevzh.md')));
    const bkRoot2 = path.join(dir, '.jevzh', 'backups');
    assert.ok(exists(bkRoot2) && fs.readdirSync(bkRoot2).length >= 1, '移除旧规则文件应产生备份');

    // --keep-router 分支：旧文件保留不动，本包文件并存
    const dir2 = mkFixture('jevzh-coexist-rule-keep-');
    try {
      const zhRuleDir2 = path.join(dir2, '.trae', 'rules');
      fs.mkdirSync(zhRuleDir2, { recursive: true });
      fs.writeFileSync(path.join(zhRuleDir2, 'superpowers-zh.md'), '# ZH-RULE-MARKER\n');
      const rk = run(['--tool', 'trae', '--keep-router'], { cwd: dir2 });
      assert.equal(rk.status, 0, rk.stdout + rk.stderr);
      assert.match(rk.stdout + rk.stderr, /WARN/);
      assert.equal(readText(path.join(zhRuleDir2, 'superpowers-zh.md')), '# ZH-RULE-MARKER\n');
      assert.ok(exists(path.join(zhRuleDir2, 'jevzh.md')));
    } finally {
      rmFixture(dir2);
    }
  } finally {
    rmFixture(dir);
  }
});
