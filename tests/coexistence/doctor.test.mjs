// tests/coexistence/doctor.test.mjs — doctor 只读诊断（用例 9 之 doctor）：
// 健康夹具 exit 0（router 归属/hooks 接线/就绪四态齐备）；竞品来源、损坏 JSON、
// 悬空哨兵、技能完整性缺失分别给出问题分级与建议修复命令；插件形态 exit 2。
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  run, mkFixture, rmFixture, readText, exists, putCompetitorSkill,
} from './helpers.mjs';
import { hashTree } from '../installer/helpers.mjs';

test('健康安装：doctor exit 0，报告 router 归属、hooks 接线、就绪四态、备份/restore 用法', () => {
  const dir = mkFixture('jevzh-doctor-ok-');
  try {
    const r0 = run(['--tool', 'claude'], { cwd: dir });
    assert.equal(r0.status, 0, r0.stdout + r0.stderr);

    const r = run(['doctor', '--tool', 'claude'], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const out = r.stdout;
    assert.match(out, /router|路由/);
    assert.match(out, /jevzh|jev-superpowers-zh/);
    assert.match(out, /FULL|LOCAL|PARTIAL|DEGRADED/);
    assert.match(out, /hooks|钩子/);
    assert.match(out, /备份|restore/);
  } finally {
    rmFixture(dir);
  }
});

test('损坏夹具：zh 同名技能 + 插件启用 -> doctor 报告来源与 BLOCK，exit 2 并给卸载建议', () => {
  const dir = mkFixture('jevzh-doctor-bad-');
  putCompetitorSkill(dir, 'zh');
  fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude-plugin', 'enabled.json'), '{"superpowers-zh":true}');
  try {
    const r = run(['doctor', '--tool', 'claude'], { cwd: dir });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    const out = r.stdout + r.stderr;
    assert.match(out, /BLOCK/);
    assert.match(out, /superpowers-zh/);
    assert.match(out, /plugin uninstall|插件.*卸载|卸载.*插件/);
    assert.match(out, /brainstorming/);
    // doctor 只读：不写盘
    assert.ok(!exists(path.join(dir, '.claude', 'skills', 'jev-verification')));
  } finally {
    rmFixture(dir);
  }
});

test('损坏 settings.json：doctor exit 1 并建议修复/重装命令', () => {
  const dir = mkFixture('jevzh-doctor-cfg-');
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), '{ not json');
  try {
    const r = run(['doctor', '--tool', 'claude'], { cwd: dir });
    assert.notEqual(r.status, 0);
    assert.notEqual(r.status, 2, '非插件问题不应 exit 2');
    const out = r.stdout + r.stderr;
    assert.match(out, /settings\.json/);
    assert.match(out, /JSON/);
    assert.match(out, /jevzh/);
  } finally {
    rmFixture(dir);
  }
});

test('悬空 begin 哨兵 + 本包技能缺 SKILL.md：doctor 报 WARN/完整性问题并给修复建议', () => {
  const dir = mkFixture('jevzh-doctor-dangling-');
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'CLAUDE.md'),
    '# p\n\n<!-- jev-superpowers-zh:begin (do not edit between these markers) -->\n区块没有 end\n',
  );
  // 安装一份健康副本后破坏其中一个技能
  const r0 = run(['--tool', 'claude'], { cwd: dir });
  // 预置的悬空段会让 router 被 WARN 跳过；安装仍成功
  assert.equal(r0.status, 0, r0.stdout + r0.stderr);
  fs.rmSync(path.join(dir, '.claude', 'skills', 'brainstorming', 'SKILL.md'));
  try {
    const r = run(['doctor', '--tool', 'claude'], { cwd: dir });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    const out = r.stdout + r.stderr;
    assert.match(out, /悬空|配对|哨兵/);
    assert.match(out, /brainstorming/);
    assert.match(out, /完整性|SKILL\.md|修复|重装|adopt/);
  } finally {
    rmFixture(dir);
  }
});

test('doctor 只读：运行前后项目树 sha 不变', () => {
  const dir = mkFixture('jevzh-doctor-readonly-');
  run(['--tool', 'claude'], { cwd: dir });
  const before = hashTree(dir);
  try {
    const r = run(['doctor', '--tool', 'claude'], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(hashTree(dir), before, 'doctor 发生了写盘');
  } finally {
    rmFixture(dir);
  }
});
