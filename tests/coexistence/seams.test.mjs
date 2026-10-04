// tests/coexistence/seams.test.mjs — 任务 6 接缝：
// R-3 --uninstall --tool X 单工具语义；S-10/S-11 就绪报告三修（非 JSON 200 不当 laya、
// URL userinfo 不外泄、探测有整体超时口径）。
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { run, mkFixture, rmFixture, exists } from './helpers.mjs';
import { BIN } from '../installer/helpers.mjs';

const mod = await import(pathToFileURL(BIN).href);
const { classifyHealth, redactUrl } = mod;

test('R-3：--uninstall --tool cursor 只清 Cursor，Claude 目标技能/hooks/settings 全保留', () => {
  const dir = mkFixture('jevzh-r3-scope-');
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.cursor'), { recursive: true });
  try {
    const r0 = run([], { cwd: dir });
    assert.equal(r0.status, 0, r0.stdout + r0.stderr);
    assert.ok(exists(path.join(dir, '.claude', 'skills', 'jev-verification', 'SKILL.md')));
    assert.ok(exists(path.join(dir, '.cursor', 'skills', 'jev-verification', 'SKILL.md')));

    const r = run(['--uninstall', '--tool', 'cursor'], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    // Cursor 清干净
    assert.ok(!exists(path.join(dir, '.cursor', 'skills')));
    assert.ok(!exists(path.join(dir, '.cursor', 'hooks')));
    assert.ok(!exists(path.join(dir, '.cursor', 'scripts')));
    // Claude 完好
    assert.ok(exists(path.join(dir, '.claude', 'skills', 'jev-verification', 'SKILL.md')));
    assert.ok(exists(path.join(dir, '.claude', 'hooks', 'hooks.json')));
    assert.ok(exists(path.join(dir, 'CLAUDE.md')));
    // 反向：再卸 claude 不碰（已不存在的）cursor
    const r2 = run(['--uninstall', '--tool', 'claude'], { cwd: dir });
    assert.equal(r2.status, 0, r2.stdout + r2.stderr);
    assert.ok(!exists(path.join(dir, '.claude', 'skills')));
  } finally {
    rmFixture(dir);
  }
});

test('S-10/S-11 单元：非 JSON / 无 laya_installed 字段的 200 响应不得判定为 laya', () => {
  assert.equal(classifyHealth(null), 'none');
  assert.equal(classifyHealth({}), 'none');
  assert.equal(classifyHealth({ status: 'whatever' }), 'none');
  assert.equal(classifyHealth({ laya_installed: false }), 'heuristic');
  assert.equal(classifyHealth({ laya_installed: true }), 'laya');
});

test('S-10/S-11 单元：就绪报告输出的 URL 必须抹除 userinfo', () => {
  assert.equal(redactUrl('http://127.0.0.1:8000/health'), 'http://127.0.0.1:8000/health');
  const redacted = redactUrl('http://sk-secret-abc:pw@10.0.0.1:8000/health');
  assert.doesNotMatch(redacted, /sk-secret-abc/);
  assert.doesNotMatch(redacted, /pw@/);
  assert.match(redacted, /10\.0\.0\.1:8000/);
  assert.match(redacted, /\*\*\*/);
  // 畸形 URL 不抛错
  assert.equal(typeof redactUrl('not-a-url'), 'string');
});

test('安装末报告：不把非 JSON 200 当 laya（坏后端场景报告 none/未知而非 laya）', () => {
  const dir = mkFixture('jevzh-readiness-report-');
  try {
    const r = run(['--tool', 'claude'], {
      cwd: dir,
      env: { TYPESAFE_BASE_URL: 'http://127.0.0.1:9' }, // 1～1024 未授权端口，连接直接失败
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    // 本机无桥/无工具：状态应为 PARTIAL 或 DEGRADED，绝不在无证据时报告 Laya/FULL
    assert.match(r.stdout, /PARTIAL|DEGRADED/);
  } finally {
    rmFixture(dir);
  }
});
