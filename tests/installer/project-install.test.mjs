// tests/installer/project-install.test.mjs — 项目级默认安装：
// 27 技能（含嵌套文件）、哨兵 bootstrap、hooks 落位、幂等。
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  run, mkFixture, rmFixture, readText, exists, listFiles, hashTree,
  SKILLS_SRC, ALL_SKILLS, JEV_SKILLS, ZH_SKILLS, readMeta,
} from './helpers.mjs';

// R-1：hooks 运行时按宿主过滤，两套 schema 文件各归其主
const CLAUDE_HOOK_RUNTIME = ['hooks.json', 'session-start', 'pre-commit', 'stop', 'run-hook.cmd', 'run-hook.cjs'];
const CURSOR_HOOK_RUNTIME = ['hooks-cursor.json', 'session-start', 'pre-commit', 'stop', 'run-hook.cmd', 'run-hook.cjs'];
const GATE_SCRIPTS = ['jev-readiness', 'jev-gate', 'serve-laya.py'];

test('Claude Code 项目级默认安装：27 技能 + 嵌套文件 + 哨兵 + hooks + 配置', () => {
  const dir = mkFixture('jevzh-proj-claude-');
  try {
    const r = run(['--tool', 'claude'], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);

    const skillsDir = path.join(dir, '.claude', 'skills');
    const installed = fs
      .readdirSync(skillsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    assert.deepEqual(installed, [...ALL_SKILLS].sort());
    assert.equal(installed.length, 27);
    for (const name of JEV_SKILLS) assert.ok(installed.includes(name), `缺少 ${name}`);
    for (const name of ZH_SKILLS) assert.ok(installed.includes(name), `缺少 ${name}`);

    // 每个技能的全部文件（含 scripts/references/templates/examples 嵌套）字节一致
    for (const name of ALL_SKILLS) {
      const expectedFiles = listFiles(path.join(SKILLS_SRC, name));
      const actualFiles = new Set(
        listFiles(path.join(skillsDir, name)).filter((f) => f !== '.jevzh-meta.json'),
      );
      for (const f of expectedFiles) {
        assert.ok(actualFiles.has(f), `${name}/${f} 未安装`);
        assert.ok(
          fs
            .readFileSync(path.join(skillsDir, name, f))
            .equals(fs.readFileSync(path.join(SKILLS_SRC, name, f))),
          `${name}/${f} 字节内容被改动`,
        );
      }
    }

    // 本包管理标记：合法 JSON 且字段齐全（任务 7 来源识别据此自升级）
    const meta = readMeta(skillsDir, 'brainstorming');
    assert.equal(meta.pkg, 'jev-superpowers-zh');
    assert.equal(typeof meta.version, 'string');
    assert.match(meta.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(meta.scope, 'project');
    assert.equal(meta.target, 'Claude Code');

    // bootstrap：哨兵成对、恰好包裹一段、默认路由指向 jev-using-superpowers
    const claudeMd = readText(path.join(dir, 'CLAUDE.md'));
    const begins = claudeMd.match(/<!-- jev-superpowers-zh:begin/g) ?? [];
    const ends = claudeMd.match(/<!-- jev-superpowers-zh:end/g) ?? [];
    assert.equal(begins.length, 1);
    assert.equal(ends.length, 1);
    const bi = claudeMd.indexOf('jev-superpowers-zh:begin');
    const ei = claudeMd.indexOf('jev-superpowers-zh:end');
    assert.ok(bi < ei);
    assert.match(claudeMd.slice(bi, ei), /jev-using-superpowers/);
    assert.match(claudeMd.slice(bi, ei), /27 个 skills/);

    // hooks 运行时按能力落到 .claude/hooks，门禁脚本落到 .claude/scripts
    for (const f of CLAUDE_HOOK_RUNTIME) {
      assert.ok(exists(path.join(dir, '.claude', 'hooks', f)), `缺少 hooks/${f}`);
    }
    // R-1：Claude 宿主不得落 Cursor schema 文件
    assert.ok(!exists(path.join(dir, '.claude', 'hooks', 'hooks-cursor.json')), 'Claude 不应落 hooks-cursor.json');
    for (const f of GATE_SCRIPTS) {
      assert.ok(exists(path.join(dir, '.claude', 'scripts', f)), `缺少 scripts/${f}`);
    }

    // 默认配置生成
    const cfg = JSON.parse(readText(path.join(dir, '.jevzh.json')));
    assert.equal(cfg.backend, 'auto');
    assert.equal(cfg.strict, false);
  } finally {
    rmFixture(dir);
  }
});

test('Cursor 项目级安装：27 技能 + .cursor/hooks 落位', () => {
  const dir = mkFixture('jevzh-proj-cursor-');
  try {
    const r = run(['--tool', 'cursor'], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const skillsDir = path.join(dir, '.cursor', 'skills');
    assert.equal(fs.readdirSync(skillsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).length, 27);
    for (const f of CURSOR_HOOK_RUNTIME) {
      assert.ok(exists(path.join(dir, '.cursor', 'hooks', f)), `缺少 .cursor/hooks/${f}`);
    }
    // R-1：Cursor 宿主不得落 Claude schema 文件
    assert.ok(!exists(path.join(dir, '.cursor', 'hooks', 'hooks.json')), 'Cursor 不应落 hooks.json');
    for (const f of GATE_SCRIPTS) {
      assert.ok(exists(path.join(dir, '.cursor', 'scripts', f)), `缺少 .cursor/scripts/${f}`);
    }
    // R-3：项目根相对 + node 启动器（宿主在项目根直生；旧 ./hooks/run-hook.cmd 是死路径）
    const hookCfg = JSON.parse(readText(path.join(dir, '.cursor', 'hooks.json')));
    const flat = JSON.stringify(hookCfg);
    assert.match(flat, /node \.cursor\/hooks\/run-hook\.cjs session-start/);
    assert.match(flat, /node \.cursor\/hooks\/run-hook\.cjs pre-commit/);
    assert.match(flat, /node \.cursor\/hooks\/run-hook\.cjs stop/);
    assert.doesNotMatch(flat, /\.\/hooks\/run-hook\.cmd/, 'R-3：不应再生成项目根解析不到的旧形态');
  } finally {
    rmFixture(dir);
  }
});

test('Codex 项目级安装：27 技能落 .agents/skills，不安装 hooks', () => {
  const dir = mkFixture('jevzh-proj-codex-');
  try {
    const r = run(['--tool', 'codex'], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const skillsDir = path.join(dir, '.agents', 'skills');
    assert.equal(fs.readdirSync(skillsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).length, 27);
    assert.ok(!exists(path.join(dir, '.agents', 'hooks')));
    assert.ok(!exists(path.join(dir, '.agents', 'scripts')));
  } finally {
    rmFixture(dir);
  }
});

test('项目级安装幂等：连跑三次，第二/三次后文件集合与内容指纹完全一致', () => {
  const dir = mkFixture('jevzh-proj-idem-');
  try {
    const r1 = run(['--tool', 'claude'], { cwd: dir });
    assert.equal(r1.status, 0, r1.stdout + r1.stderr);
    const r2 = run(['--tool', 'claude'], { cwd: dir });
    assert.equal(r2.status, 0, r2.stdout + r2.stderr);
    const hash2 = hashTree(dir);
    const files2 = listFiles(dir);
    const r3 = run(['--tool', 'claude'], { cwd: dir });
    assert.equal(r3.status, 0, r3.stdout + r3.stderr);
    assert.deepEqual(listFiles(dir), files2);
    assert.equal(hashTree(dir), hash2);

    // 哨兵仍然恰好一对，bootstrap 不重复追加
    const claudeMd = readText(path.join(dir, 'CLAUDE.md'));
    assert.equal((claudeMd.match(/<!-- jev-superpowers-zh:begin/g) ?? []).length, 1);
    assert.equal((claudeMd.match(/<!-- jev-superpowers-zh:end/g) ?? []).length, 1);
  } finally {
    rmFixture(dir);
  }
});

test('无参数自动检测：预置 .claude 标记即装 Claude Code', () => {
  const dir = mkFixture('jevzh-proj-auto-');
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  try {
    const r = run([], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(
      fs
        .readdirSync(path.join(dir, '.claude', 'skills'), { withFileTypes: true })
        .filter((e) => e.isDirectory()).length,
      27,
    );
    assert.ok(exists(path.join(dir, 'CLAUDE.md')));
  } finally {
    rmFixture(dir);
  }
});
