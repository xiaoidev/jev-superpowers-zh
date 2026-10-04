// tests/installer/config.test.mjs — .jevzh.json 生成、保留与 --strict 语义。
// 字段契约与 .jevzh.json.example / scripts/jev-readiness 解析口径一致：
// backend(auto|cloud|local|off) / strict(boolean) / baseUrl / tools(object)。
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { run, mkFixture, rmFixture, readText, exists } from './helpers.mjs';

const DEFAULT_CONFIG = {
  backend: 'auto',
  strict: false,
  baseUrl: 'http://127.0.0.1:8000',
  tools: {},
};

test('首次项目安装生成默认 .jevzh.json，可 JSON.parse 且契约字段齐全', () => {
  const dir = mkFixture('jevzh-cfg-default-');
  try {
    const r = run(['--tool', 'claude'], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const cfgPath = path.join(dir, '.jevzh.json');
    assert.ok(exists(cfgPath));
    const cfg = JSON.parse(readText(cfgPath));
    assert.deepEqual(cfg, DEFAULT_CONFIG);
    assert.ok(['auto', 'cloud', 'local', 'off'].includes(cfg.backend));
    assert.equal(typeof cfg.strict, 'boolean');
  } finally {
    rmFixture(dir);
  }
});

test('预置自定义 .jevzh.json 后重跑不被覆盖（含未知字段原样保留）', () => {
  const dir = mkFixture('jevzh-cfg-keep-');
  const custom = {
    backend: 'off',
    strict: true,
    baseUrl: 'http://127.0.0.1:9999',
    tools: { 'jev-axi': { channel: 'manual' } },
    note: '用户自定义字段必须保留',
  };
  try {
    const cfgPath = path.join(dir, '.jevzh.json');
    fs.writeFileSync(cfgPath, JSON.stringify(custom, null, 2));
    const before = readText(cfgPath);
    const r = run(['--tool', 'claude'], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(readText(cfgPath), before, '配置文件被改写');
    assert.deepEqual(JSON.parse(readText(cfgPath)), custom);
    assert.match(r.stdout + r.stderr, /保留|不覆盖|既有/);
  } finally {
    rmFixture(dir);
  }
});

test('--strict 仅在首次生成时写入 strict:true', () => {
  const dir = mkFixture('jevzh-cfg-strict-new-');
  try {
    const r = run(['--tool', 'claude', '--strict'], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const cfg = JSON.parse(readText(path.join(dir, '.jevzh.json')));
    assert.equal(cfg.strict, true);
    assert.equal(cfg.backend, 'auto');
    assert.equal(cfg.baseUrl, DEFAULT_CONFIG.baseUrl);
    assert.deepEqual(cfg.tools, {});
  } finally {
    rmFixture(dir);
  }
});

test('既有 strict:false 不被 --strict 改写，且输出明确提示取自既有文件', () => {
  const dir = mkFixture('jevzh-cfg-strict-keep-');
  try {
    const cfgPath = path.join(dir, '.jevzh.json');
    fs.writeFileSync(cfgPath, JSON.stringify({ ...DEFAULT_CONFIG, strict: false }, null, 2));
    const before = readText(cfgPath);
    const r = run(['--tool', 'claude', '--strict'], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(readText(cfgPath), before);
    assert.equal(JSON.parse(readText(cfgPath)).strict, false);
    const out = r.stdout + r.stderr;
    assert.match(out, /strict/);
    assert.match(out, /既有|保留|不覆盖/);
  } finally {
    rmFixture(dir);
  }
});

test('幂等重跑不重写 .jevzh.json（mtime/content 稳定）', () => {
  const dir = mkFixture('jevzh-cfg-idem-');
  try {
    assert.equal(run(['--tool', 'claude'], { cwd: dir }).status, 0);
    const cfgPath = path.join(dir, '.jevzh.json');
    const before = readText(cfgPath);
    const statBefore = fs.statSync(cfgPath);
    assert.equal(run(['--tool', 'claude'], { cwd: dir }).status, 0);
    assert.equal(readText(cfgPath), before);
    assert.equal(fs.statSync(cfgPath).size, statBefore.size);
  } finally {
    rmFixture(dir);
  }
});
