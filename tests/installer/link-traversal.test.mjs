// tests/installer/link-traversal.test.mjs — I-1 目标侧链接穿越防护。
//
// Windows junction 在 Node lstat 下报 isSymbolicLink()=true，且通常不需要
// SeCreateSymbolicLinkPrivilege；POSIX 用 dir 型 symlink（无需特权）。
// 链接创建失败时用例显式 skip 并打印原因，绝不静默假过。
//
// 覆盖：
//   1. 技能容器（.claude/skills）本身是链接 -> 安装 WARN+失败、不写外部；
//      卸载只摘链接本身，外部目录文件无损。
//   2. 已装技能子目录被替换成链接（外部甚至伪造本包 meta）-> 卸载保留链接、
//      不穿透读 meta、外部无损，其余正常技能照常清理。
//   3. hooks 容器是链接 -> 卸载只摘链不递归，外部无损，scripts 正常清理。
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  run, mkFixture, rmFixture, exists, listFiles, hashTree,
  makeDirLinkOrSkip, unlinkQuiet,
} from './helpers.mjs';

function lstatIsLink(p) {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

test('I-1/1：技能容器是链接时安装失败不写外部；卸载只摘链，外部无损', (t) => {
  const proj = mkFixture('jevzh-link-container-proj-');
  const outside = mkFixture('jevzh-link-container-out-');
  const extSkills = path.join(outside, 'ext-skills');
  const linkSkills = path.join(proj, '.claude', 'skills');
  try {
    fs.mkdirSync(path.join(proj, '.claude'), { recursive: true });
    fs.mkdirSync(extSkills, { recursive: true });
    // 外部目录预置内容；再放一个同名技能子目录，诱导旧逻辑往里写。
    fs.writeFileSync(path.join(extSkills, 'EXTERNAL-MARKER.txt'), 'external-do-not-touch\n');
    fs.mkdirSync(path.join(extSkills, 'brainstorming'), { recursive: true });
    fs.writeFileSync(path.join(extSkills, 'brainstorming', 'SKILL.md'), '---\nname: brainstorming\n---\nEXTERNAL\n');
    if (!makeDirLinkOrSkip(t, extSkills, linkSkills)) return;
    const extBefore = hashTree(extSkills);

    // 安装：任务 7 起链接容器硬阻断（exit 2、[BLOCK]），外部一字节不动，bootstrap/配置也未生成。
    const r1 = run(['--tool', 'claude'], { cwd: proj });
    assert.notEqual(r1.status, 0, `安装应失败: ${r1.stdout}${r1.stderr}`);
    assert.match(r1.stdout + r1.stderr, /BLOCK/);
    assert.match(r1.stdout + r1.stderr, /符号链接|junction/);
    assert.equal(hashTree(extSkills), extBefore, '安装写入了链接目标（外部目录被污染）');
    assert.deepEqual(listFiles(extSkills), ['EXTERNAL-MARKER.txt', 'brainstorming/SKILL.md']);
    assert.ok(lstatIsLink(linkSkills), '安装不应摘除容器链接');
    assert.ok(!exists(path.join(proj, 'CLAUDE.md')));
    assert.ok(!exists(path.join(proj, '.jevzh.json')));

    // 卸载：只摘链接本身，外部目录与文件完整保留。
    const r2 = run(['--uninstall', '--tool', 'claude'], { cwd: proj });
    assert.equal(r2.status, 0, r2.stdout + r2.stderr);
    assert.match(r2.stdout + r2.stderr, /WARN/);
    assert.equal(hashTree(extSkills), extBefore, '卸载删除了链接目标内文件');
    assert.ok(exists(path.join(extSkills, 'EXTERNAL-MARKER.txt')));
    assert.ok(exists(path.join(extSkills, 'brainstorming', 'SKILL.md')));
    assert.ok(!lstatIsLink(linkSkills), '卸载应只摘除容器链接本身');
    assert.ok(!exists(linkSkills), '摘链后链接路径不应再存在');
  } finally {
    unlinkQuiet(linkSkills);
    rmFixture(proj);
    rmFixture(outside);
  }
});

test('I-1/2：已装技能目录被替换成链接时卸载保留链接，其余技能照常清理', (t) => {
  const proj = mkFixture('jevzh-link-skill-proj-');
  const outside = mkFixture('jevzh-link-skill-out-');
  const extSkill = path.join(outside, 'brainstorming-ext');
  const linkSkill = path.join(proj, '.claude', 'skills', 'brainstorming');
  try {
    // 正常安装 27 个技能。
    const r0 = run(['--tool', 'claude'], { cwd: proj });
    assert.equal(r0.status, 0, r0.stdout + r0.stderr);
    assert.ok(exists(path.join(proj, '.claude', 'skills', 'jev-verification', 'SKILL.md')));

    // 外部目录放真实内容，并伪造本包 meta —— 旧逻辑穿透读到 meta 会递归删掉外部。
    fs.mkdirSync(extSkill, { recursive: true });
    fs.writeFileSync(path.join(extSkill, 'SKILL.md'), '---\nname: brainstorming\n---\nEXTERNAL-CONTENT-6B\n');
    fs.writeFileSync(
      path.join(extSkill, '.jevzh-meta.json'),
      JSON.stringify({ pkg: 'jev-superpowers-zh', version: '0.1.0' }),
    );
    const extBefore = hashTree(extSkill);

    // 用链接顶替已装技能目录。
    fs.rmSync(linkSkill, { recursive: true, force: true });
    if (!makeDirLinkOrSkip(t, extSkill, linkSkill)) return;

    const r = run(['--uninstall', '--tool', 'claude'], { cwd: proj });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const out = r.stdout + r.stderr;
    assert.match(out, /WARN/);
    assert.match(out, /符号链接|junction/);

    // 链接保留、外部无损（meta 未被穿透读取，递归删除未发生）。
    assert.ok(lstatIsLink(linkSkill), '技能子目录链接应被保留');
    assert.equal(hashTree(extSkill), extBefore, '链接目标（外部）内容被删除');
    assert.ok(exists(path.join(extSkill, 'SKILL.md')));
    assert.ok(exists(path.join(extSkill, '.jevzh-meta.json')));

    // 其余本包技能与 hooks/scripts 照常清理。
    assert.ok(!exists(path.join(proj, '.claude', 'skills', 'jev-verification')));
    assert.ok(!exists(path.join(proj, '.claude', 'hooks')));
    assert.ok(!exists(path.join(proj, '.claude', 'scripts')));
    // 容器因仍含被保留的链接而不被删除。
    assert.ok(exists(path.join(proj, '.claude', 'skills')));
  } finally {
    unlinkQuiet(linkSkill);
    rmFixture(proj);
    rmFixture(outside);
  }
});

test('I-1/3：hooks 容器是链接时卸载只摘链不递归，scripts 正常清理', (t) => {
  const proj = mkFixture('jevzh-link-hooks-proj-');
  const outside = mkFixture('jevzh-link-hooks-out-');
  const extHooks = path.join(outside, 'ext-hooks');
  const linkHooks = path.join(proj, '.claude', 'hooks');
  try {
    const r0 = run(['--tool', 'claude'], { cwd: proj });
    assert.equal(r0.status, 0, r0.stdout + r0.stderr);
    assert.ok(exists(path.join(linkHooks, 'hooks.json')));

    fs.mkdirSync(extHooks, { recursive: true });
    fs.writeFileSync(path.join(extHooks, 'EXTERNAL-HOOKS.txt'), 'external-hooks\n');
    fs.writeFileSync(path.join(extHooks, 'hooks.json'), '{"external": true}\n');
    const extBefore = hashTree(extHooks);

    fs.rmSync(linkHooks, { recursive: true, force: true });
    if (!makeDirLinkOrSkip(t, extHooks, linkHooks)) return;

    const r = run(['--uninstall', '--tool', 'claude'], { cwd: proj });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /WARN/);
    // 容器链接被摘除但外部目标无损。
    assert.ok(!lstatIsLink(linkHooks), 'hooks 容器链接应被摘除');
    assert.equal(hashTree(extHooks), extBefore, 'hooks 链接目标内容被删除');
    assert.ok(exists(path.join(extHooks, 'EXTERNAL-HOOKS.txt')));
    assert.equal(
      fs.readFileSync(path.join(extHooks, 'hooks.json'), 'utf8'),
      '{"external": true}\n',
    );
    // 同级真实 scripts 目录照常清理。
    assert.ok(!exists(path.join(proj, '.claude', 'scripts')));
  } finally {
    unlinkQuiet(linkHooks);
    rmFixture(proj);
    rmFixture(outside);
  }
});

test('R3：hooks 容器本身是链接 -> 安装不打 hooks ✅ 成功行、改打 SKIP，外部无损，scripts 正常落位', (t) => {
  const proj = mkFixture('jevzh-link-hooks-install-proj-');
  const outside = mkFixture('jevzh-link-hooks-install-out-');
  const extHooks = path.join(outside, 'ext-hooks');
  const linkHooks = path.join(proj, '.claude', 'hooks');
  try {
    fs.mkdirSync(path.join(proj, '.claude'), { recursive: true });
    fs.mkdirSync(extHooks, { recursive: true });
    // 外部预置内容，诱导旧逻辑 mkdir 后穿透覆盖 hooks.json。
    fs.writeFileSync(path.join(extHooks, 'EXTERNAL-HOOKS.txt'), 'external-hooks\n');
    fs.writeFileSync(path.join(extHooks, 'hooks.json'), '{"external": true}\n');
    if (!makeDirLinkOrSkip(t, extHooks, linkHooks)) return;
    const extBefore = hashTree(extHooks);

    const r = run(['--tool', 'claude'], { cwd: proj });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const out = r.stdout + r.stderr;
    // 旧逻辑 existsSync(hookDest) 对 junction 为真，误打 ✅ 成功行与 WARN 自相矛盾。
    assert.doesNotMatch(out, /hooks 运行时 ->/, '不得出现该目标的 hooks ✅ 成功行');
    assert.match(out, /跳过 hooks 运行时/, '必须有一致的 hooks 跳过说明');
    assert.match(out, /符号链接|junction/);
    // 链接目标一字节不动。
    assert.equal(hashTree(extHooks), extBefore, '安装写入了 hooks 链接目标（外部被污染）');
    assert.equal(
      fs.readFileSync(path.join(extHooks, 'hooks.json'), 'utf8'),
      '{"external": true}\n',
    );
    assert.ok(exists(path.join(extHooks, 'EXTERNAL-HOOKS.txt')));
    assert.ok(lstatIsLink(linkHooks), 'hooks 容器链接应保留');
    // 技能与独立的 scripts 容器（真实目录）照常安装。
    assert.ok(exists(path.join(proj, '.claude', 'skills', 'brainstorming', 'SKILL.md')));
    assert.ok(exists(path.join(proj, '.claude', 'scripts', 'jev-gate')));
  } finally {
    unlinkQuiet(linkHooks);
    rmFixture(proj);
    rmFixture(outside);
  }
});

test('R1：直接父目录是链接（.claude 为 junction、skills 容器尚不存在）-> exit 0、父级链接披露、技能落在链接目标', (t) => {
  const proj = mkFixture('jevzh-link-parent-proj-');
  const outside = mkFixture('jevzh-link-parent-out-');
  const realClaude = path.join(outside, 'claude-real');
  const linkClaude = path.join(proj, '.claude');
  try {
    fs.mkdirSync(realClaude, { recursive: true });
    fs.writeFileSync(path.join(realClaude, 'EXTERNAL-MARKER.txt'), 'external-keep\n');
    if (!makeDirLinkOrSkip(t, realClaude, linkClaude)) return;

    const r = run(['--tool', 'claude'], { cwd: proj });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const out = r.stdout + r.stderr;
    assert.match(out, /WARN/);
    assert.match(out, /直接父目录.*(符号链接|junction)/);
    assert.match(out, /实际写入链接目标/);
    assert.match(out, /不阻断/);

    // 技能/hooks 确实落在链接目标（外部真实目录）内。
    assert.ok(exists(path.join(realClaude, 'skills', 'brainstorming', 'SKILL.md')));
    assert.ok(exists(path.join(realClaude, 'skills', 'brainstorming', '.jevzh-meta.json')));
    assert.ok(exists(path.join(realClaude, 'skills', 'jev-verification', 'SKILL.md')));
    assert.ok(exists(path.join(realClaude, 'hooks', 'hooks.json')));
    // 表面路径经 junction 同样可见；容器本身是目标侧新建的真实目录（不是链接）。
    assert.ok(exists(path.join(linkClaude, 'skills', 'brainstorming', 'SKILL.md')));
    assert.equal(lstatIsLink(path.join(linkClaude, 'skills')), false, 'skills 容器应是真实目录而非链接');
    // 外部既有内容保留。
    assert.equal(
      fs.readFileSync(path.join(realClaude, 'EXTERNAL-MARKER.txt'), 'utf8'),
      'external-keep\n',
    );
  } finally {
    unlinkQuiet(linkClaude);
    rmFixture(proj);
    rmFixture(outside);
  }
});
