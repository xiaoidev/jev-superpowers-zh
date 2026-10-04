// tests/installer/nojev.test.mjs — --no-jev 纯中文技能形态，以及补缺语义。
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  run, mkFixture, rmFixture, readText, exists, listFiles,
  ZH_SKILLS, JEV_SKILLS,
} from './helpers.mjs';

test('--no-jev：仅 21 个中文技能，无 jev-*、无 hooks、无 .jevzh.json', () => {
  const dir = mkFixture('jevzh-nojev-');
  try {
    const r = run(['--tool', 'claude', '--no-jev'], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);

    const skillsDir = path.join(dir, '.claude', 'skills');
    const dirs = fs
      .readdirSync(skillsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    assert.deepEqual(dirs, [...ZH_SKILLS].sort());
    assert.equal(dirs.length, 21);
    for (const name of JEV_SKILLS) {
      assert.ok(!exists(path.join(skillsDir, name)), `jev 技能 ${name} 不应被安装`);
    }

    // 纯中文形态不装 hooks、不生成配置
    assert.ok(!exists(path.join(dir, '.claude', 'hooks')));
    assert.ok(!exists(path.join(dir, '.claude', 'scripts')));
    assert.ok(!exists(path.join(dir, '.jevzh.json')));

    // bootstrap 仍然安装（技能触发入口），路由不指向 jev 技能
    const claudeMd = readText(path.join(dir, 'CLAUDE.md'));
    assert.match(claudeMd, /<!-- jev-superpowers-zh:begin/);
    assert.match(claudeMd, /21 个 skills/);
    assert.doesNotMatch(claudeMd, /jev-using-superpowers/);
    assert.match(claudeMd, /using-superpowers/);
  } finally {
    rmFixture(dir);
  }
});

test('--no-jev 后再跑默认安装：补缺到 27 技能并补 hooks/配置，已装 21 个不动', () => {
  const dir = mkFixture('jevzh-nojev-fill-');
  try {
    const r1 = run(['--tool', 'claude', '--no-jev'], { cwd: dir });
    assert.equal(r1.status, 0, r1.stdout + r1.stderr);

    // 记录一个 zh 技能副本的全部文件（含 meta），补缺后必须原样未动
    const skillsDir = path.join(dir, '.claude', 'skills');
    const zhBefore = new Map();
    for (const f of listFiles(path.join(skillsDir, 'brainstorming'))) {
      zhBefore.set(f, fs.readFileSync(path.join(skillsDir, 'brainstorming', f)));
    }

    const r2 = run(['--tool', 'claude'], { cwd: dir });
    assert.equal(r2.status, 0, r2.stdout + r2.stderr);

    const dirs = fs
      .readdirSync(skillsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    assert.equal(dirs.length, 27);
    for (const name of JEV_SKILLS) assert.ok(dirs.includes(name), `补缺后仍缺 ${name}`);

    for (const [f, buf] of zhBefore) {
      assert.ok(
        fs.readFileSync(path.join(skillsDir, 'brainstorming', f)).equals(buf),
        `补缺安装改动了既有 zh 技能文件: ${f}`,
      );
    }

    for (const f of ['hooks/hooks.json', 'hooks/session-start', 'hooks/pre-commit', 'hooks/stop']) {
      assert.ok(exists(path.join(dir, '.claude', f)), `补缺后缺 .claude/${f}`);
    }
    assert.ok(exists(path.join(dir, '.jevzh.json')));
  } finally {
    rmFixture(dir);
  }
});

test('--no-jev 不改动已存在的 .jevzh.json', () => {
  const dir = mkFixture('jevzh-nojev-cfg-');
  try {
    const cfgPath = path.join(dir, '.jevzh.json');
    fs.writeFileSync(cfgPath, JSON.stringify({ backend: 'cloud', strict: true, baseUrl: 'x', tools: {} }));
    const before = readText(cfgPath);
    const r = run(['--tool', 'claude', '--no-jev'], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(readText(cfgPath), before);
  } finally {
    rmFixture(dir);
  }
});
