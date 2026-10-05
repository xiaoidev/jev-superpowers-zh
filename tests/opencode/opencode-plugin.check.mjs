// OpenCode 插件离线套件：直接 import 仓内 .opencode/plugins/superpowers.js，
// 不依赖符号链接/真实 opencode（Git for Windows 无 symlink 权限，源仓
// test-plugin-loading.sh 在本机即红；源 bootstrap-caching 断言缓存实现，但
// 本 fork 插件刻意保持无缓存、每次 transform 现读盘，故改为 present/missing
// 两场景的注入正确性断言）。
//
// 由 run-tests.sh 显式驱动；文件名刻意不取 *.test.mjs，避免 `npm test` 重复发现。
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const pluginPath = path.join(repoRoot, '.opencode/plugins/superpowers.js');
const skillsDir = path.join(repoRoot, 'skills');
const bootstrapSkill = path.join(skillsDir, 'jev-using-superpowers', 'SKILL.md');

const JEV_SKILL_RE = /jev-using-superpowers[\\/]SKILL\.md/;

function makeOutput(text) {
  return {
    messages: [{
      info: { role: 'user' },
      parts: [{ type: 'text', text }],
    }],
  };
}

function bootstrapParts(output) {
  return output.messages[0].parts.filter(
    (part) => part.type === 'text' && part.text.includes('EXTREMELY_IMPORTANT'),
  );
}

async function loadPlugin() {
  const mod = await import(pathToFileURL(pluginPath).href + `?cachebust=${Date.now()}-${Math.random()}`);
  return mod.SuperpowersPlugin({ client: {}, directory: repoRoot });
}

test('plugin exposes config hook and messages.transform', async () => {
  const plugin = await loadPlugin();
  assert.equal(typeof plugin.config, 'function');
  assert.equal(typeof plugin['experimental.chat.messages.transform'], 'function');
});

test('config hook registers the bundled skills dir (idempotent)', async () => {
  const plugin = await loadPlugin();
  const cfg = { skills: { paths: [] } };
  await plugin.config(cfg);
  assert.deepEqual(cfg.skills.paths, [skillsDir]);
  await plugin.config(cfg);
  assert.deepEqual(cfg.skills.paths, [skillsDir], '重复注册不产生重复项');
});

test('present: transform injects exactly one jev router bootstrap into first user message', async () => {
  const plugin = await loadPlugin();
  const transform = plugin['experimental.chat.messages.transform'];

  const output = makeOutput('first step payload');
  await transform({}, output);

  const parts = bootstrapParts(output);
  assert.equal(parts.length, 1);
  const bootstrap = parts[0].text;
  assert.match(bootstrap, /<EXTREMELY_IMPORTANT>/);
  assert.match(bootstrap, /You have jev-superpowers-zh/);
  assert.match(bootstrap, /jev-using-superpowers/);
  assert.match(bootstrap, /<\/EXTREMELY_IMPORTANT>/);
  // 原始用户文本仍在（注入为前置新 part，不吞原文）
  assert.ok(output.messages[0].parts.some((p) => p.text === 'first step payload'));
});

test('present: transform never double-injects into an already-bootstrapped message', async () => {
  const plugin = await loadPlugin();
  const transform = plugin['experimental.chat.messages.transform'];

  const output = makeOutput('hello');
  await transform({}, output);
  const afterFirst = bootstrapParts(output).length;
  await transform({}, output);
  assert.equal(bootstrapParts(output).length, afterFirst, '同一消息数组二次 transform 不重复注入');
});

test('present: bootstrap is read from the jev-using-superpowers router skill path', async () => {
  // 不假设缓存语义（本 fork 无缓存，每次现读），只验证读取目标确为 jev 路由技能。
  let jevReads = 0;
  const originalRead = fs.readFileSync;
  fs.readFileSync = function (...args) {
    if (JEV_SKILL_RE.test(String(args[0]).replaceAll('\\', '/'))) jevReads += 1;
    return originalRead.apply(this, args);
  };
  try {
    const plugin = await loadPlugin();
    const output = makeOutput('route check');
    await plugin['experimental.chat.messages.transform']({}, output);
    assert.ok(jevReads >= 1, `expected read of jev-using-superpowers/SKILL.md, got ${jevReads}`);
  } finally {
    fs.readFileSync = originalRead;
  }
});

test('missing: absent router SKILL.md yields no injection and leaves payload intact', async () => {
  const originalExists = fs.existsSync;
  fs.existsSync = function (p) {
    if (JEV_SKILL_RE.test(String(p).replaceAll('\\', '/'))) return false;
    return originalExists.apply(this, arguments);
  };
  try {
    const plugin = await loadPlugin();
    const output = makeOutput('no skill on disk');
    await plugin['experimental.chat.messages.transform']({}, output);
    assert.equal(bootstrapParts(output).length, 0);
    assert.deepEqual(output.messages[0].parts, [{ type: 'text', text: 'no skill on disk' }]);
  } finally {
    fs.existsSync = originalExists;
  }
});

test('non-user-only messages are not injected', async () => {
  const plugin = await loadPlugin();
  const output = {
    messages: [{ info: { role: 'assistant' }, parts: [{ type: 'text', text: 'assistant says hi' }] }],
  };
  await plugin['experimental.chat.messages.transform']({}, output);
  assert.equal(bootstrapParts(output).length, 0);
});
