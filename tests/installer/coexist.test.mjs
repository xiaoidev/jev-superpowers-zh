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

test('CLAUDE.md 已含 superpowers-zh 哨兵区块：WARN 且整文件不动', () => {
  const dir = mkFixture('jevzh-coexist-sentinel-');
  const existing = `# 我的项目

用户自有引导内容。

<!-- superpowers-zh:begin (do not edit between these markers) -->
# Superpowers-ZH 中文增强版

旧 superpowers-zh 区块内容。
<!-- superpowers-zh:end -->

结尾的用户内容。
`;
  try {
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), existing);
    const r = run(['--tool', 'claude'], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const out = r.stdout + r.stderr;
    assert.match(out, /WARN/);
    // 文件字节级保持（归一化 CRLF 后逐字相等）
    assert.equal(readText(path.join(dir, 'CLAUDE.md')), existing.replace(/\r?\n/g, '\n'));
    assert.ok(!readText(path.join(dir, 'CLAUDE.md')).includes('jev-superpowers-zh:begin'));
  } finally {
    rmFixture(dir);
  }
});

test('Trae 已装 zh 独立规则文件：jevzh 写自己的文件，WARN 且不动 zh 文件', () => {
  const dir = mkFixture('jevzh-coexist-rule-');
  try {
    const zhRuleDir = path.join(dir, '.trae', 'rules');
    fs.mkdirSync(zhRuleDir, { recursive: true });
    fs.writeFileSync(path.join(zhRuleDir, 'superpowers-zh.md'), '# ZH-RULE-MARKER\n');
    fs.mkdirSync(path.join(dir, '.trae'), { recursive: true });

    const r = run(['--tool', 'trae'], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const out = r.stdout + r.stderr;
    assert.match(out, /WARN/);
    assert.equal(readText(path.join(zhRuleDir, 'superpowers-zh.md')), '# ZH-RULE-MARKER\n');
    assert.ok(exists(path.join(zhRuleDir, 'jevzh.md')));
  } finally {
    rmFixture(dir);
  }
});
