#!/usr/bin/env node
// 把 package.json 的 version 同步到所有 plugin manifest（含嵌套字段）。
// 由 npm version 钩子触发，跑在 version commit 创建之前。
//
// 用法：
//   node scripts/sync-plugin-version.js          写入模式：把差异刷进各清单
//   node scripts/sync-plugin-version.js --check  校验模式：只报告差异，不写盘；
//                                                全部一致 exit 0，有差异 exit 1
//   node scripts/sync-plugin-version.js --root <dir>
//                                                指定清单根目录（默认仓根）；
//                                                供测试在临时副本上跑漂移检查
//
// 设计：用 regex 替换而不是 JSON.parse + stringify，目的是保留原文件格式
// （缩进、行内/多行数组、空白等不被破坏）。每种 field 路径对应一个专用 regex。
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const USAGE = '用法: node scripts/sync-plugin-version.js [--check] [--root <dir>]';

const args = process.argv.slice(2);
let checkOnly = false;
let rootArg = null;
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--check') {
    checkOnly = true;
  } else if (arg === '--root') {
    if (i + 1 >= args.length) {
      console.error('错误: --root 需要一个目录参数');
      console.error(USAGE);
      process.exit(64);
    }
    rootArg = args[++i];
  } else {
    console.error(`未知参数: ${arg}`);
    console.error(USAGE);
    process.exit(64);
  }
}

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = rootArg ? resolve(rootArg) : defaultRoot;
const pkgPath = resolve(root, 'package.json');
if (!existsSync(pkgPath)) {
  console.error(`错误: ${pkgPath} 不存在（--root 必须指向含 package.json 与各清单的目录）`);
  process.exit(64);
}
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

// targets 字段对齐 .version-bump 约定（path + field 路径）。
// 顶层用 "version"，嵌套用 dot-path（如 "plugins.0.version"）。
const TARGETS = [
  { path: '.claude-plugin/plugin.json',      field: 'version' },
  { path: '.cursor-plugin/plugin.json',      field: 'version' },
  { path: '.codex-plugin/plugin.json',       field: 'version' },
  { path: '.kimi-plugin/plugin.json',        field: 'version' },
  { path: '.claude-plugin/marketplace.json', field: 'plugins.0.version' },
  { path: 'gemini-extension.json',           field: 'version' },
];

function buildPattern(field) {
  if (field === 'version') {
    return /("version"\s*:\s*")[^"]+(")/;
  }
  if (field === 'plugins.0.version') {
    // 锚定到 "plugins": [ { ... 第一个对象内的 version 字段
    return /("plugins"\s*:\s*\[\s*\{[\s\S]*?"version"\s*:\s*")[^"]+(")/;
  }
  throw new Error(`Unsupported field path: ${field}`);
}

function readField(json, field) {
  if (field === 'version') return json.version;
  if (field === 'plugins.0.version') return json.plugins?.[0]?.version;
  throw new Error(`Unsupported field path: ${field}`);
}

const drift = [];
let touched = 0;
for (const { path: rel, field } of TARGETS) {
  const fullPath = resolve(root, rel);
  const text = readFileSync(fullPath, 'utf8');
  const json = JSON.parse(text);
  const current = readField(json, field);
  if (current === pkg.version) continue;

  drift.push(`  ${rel} (${field}): ${current} != ${pkg.version}`);
  if (checkOnly) continue;

  const pattern = buildPattern(field);
  const updated = text.replace(pattern, `$1${pkg.version}$2`);
  if (updated === text) {
    throw new Error(`未能在 ${rel} 中定位字段 ${field}`);
  }
  writeFileSync(fullPath, updated, 'utf8');
  console.log(`  ${rel} (${field}): ${current} -> ${pkg.version}`);
  touched++;
}

if (checkOnly) {
  if (drift.length > 0) {
    console.error(`plugin manifest 版本与 package.json ${pkg.version} 不一致：`);
    console.error(drift.join('\n'));
    console.error('运行 `node scripts/sync-plugin-version.js` 修复。');
    process.exit(1);
  }
  console.log(`plugin manifests already at ${pkg.version}`);
} else if (touched === 0) {
  console.log(`  plugin manifests already at ${pkg.version}`);
}
