// tests/installer/empty-skill-adopt.test.mjs — R2 空技能目录接管自愈。
//
// 安装中途失败（权限/杀软/磁盘）可能留下「目录已建、内容没写」的空技能壳：
// 旧逻辑因读不到本包 meta 把它永久判为「非本包管理」，之后重跑只 WARN 不再补缺。
// 新口径：目录存在但 readdirSync 长度为 0 -> 视为可接管，正常复制技能内容并写
// meta（输出接管提示）；目录内有任何文件（如 .gitkeep）则仍是用户目录，WARN 不动。
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  run, mkFixture, rmFixture, readText, exists, SKILLS_SRC,
} from './helpers.mjs';

test('R2/a：预置完全为空的 skills/brainstorming -> 安装接管补齐 SKILL.md+meta 并提示，重跑幂等', () => {
  const dir = mkFixture('jevzh-empty-skill-adopt-');
  const emptySkill = path.join(dir, '.claude', 'skills', 'brainstorming');
  try {
    fs.mkdirSync(emptySkill, { recursive: true });
    assert.deepEqual(fs.readdirSync(emptySkill), [], '前置：目录确实为空');

    const r = run(['--tool', 'claude'], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const out = r.stdout + r.stderr;
    assert.match(out, /接管空目录/);

    // 真的补齐了：SKILL.md 与源字节一致，meta 落盘。
    const skillMd = path.join(emptySkill, 'SKILL.md');
    const metaPath = path.join(emptySkill, '.jevzh-meta.json');
    assert.ok(exists(skillMd));
    assert.ok(exists(metaPath));
    assert.equal(
      readText(skillMd),
      readText(path.join(SKILLS_SRC, 'brainstorming', 'SKILL.md')),
    );
    const meta = JSON.parse(readText(metaPath));
    assert.equal(meta.pkg, 'jev-superpowers-zh');
    assert.equal(meta.target, 'Claude Code');
    assert.equal(meta.scope, 'project');

    // 27 个技能目录齐全（接管的空壳也算一个，不再永久缺额）。
    assert.equal(
      fs
        .readdirSync(path.join(dir, '.claude', 'skills'), { withFileTypes: true })
        .filter((e) => e.isDirectory()).length,
      27,
    );

    // 幂等：再跑一次按本包已装处理，不再提示接管。
    const r2 = run(['--tool', 'claude'], { cwd: dir });
    assert.equal(r2.status, 0, r2.stdout + r2.stderr);
    assert.doesNotMatch(r2.stdout + r2.stderr, /接管空目录/);
    assert.ok(exists(skillMd));
    assert.ok(exists(metaPath));
  } finally {
    rmFixture(dir);
  }
});

test('R2/b：同名目录内有任意文件（.gitkeep + 用户 SKILL.md）但无 meta -> 仍 WARN 不动，其余 26 个照常补齐', () => {
  const dir = mkFixture('jevzh-nonempty-skill-keep-');
  const userSkill = path.join(dir, '.claude', 'skills', 'brainstorming');
  try {
    fs.mkdirSync(userSkill, { recursive: true });
    fs.writeFileSync(path.join(userSkill, '.gitkeep'), '');
    fs.writeFileSync(path.join(userSkill, 'SKILL.md'), '---\nname: brainstorming\n---\nUSER-CONTENT-7F\n');

    const r = run(['--tool', 'claude'], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const out = r.stdout + r.stderr;
    assert.match(out, /WARN/);
    assert.match(out, /非本包管理/);
    assert.doesNotMatch(out, /接管空目录/);

    // 用户内容原样，安装器不得写入 meta「漂白」归属。
    assert.equal(readText(path.join(userSkill, '.gitkeep')), '');
    assert.match(readText(path.join(userSkill, 'SKILL.md')), /USER-CONTENT-7F/);
    assert.ok(!exists(path.join(userSkill, '.jevzh-meta.json')), '非空用户目录不得被写 meta');

    // 其余 26 个本包技能照常落位（总数 27 = 用户 1 + 本包 26）。
    assert.ok(exists(path.join(dir, '.claude', 'skills', 'jev-verification', 'SKILL.md')));
    assert.ok(exists(path.join(dir, '.claude', 'skills', 'test-driven-development', 'SKILL.md')));
    assert.equal(
      fs
        .readdirSync(path.join(dir, '.claude', 'skills'), { withFileTypes: true })
        .filter((e) => e.isDirectory()).length,
      27,
    );
  } finally {
    rmFixture(dir);
  }
});
