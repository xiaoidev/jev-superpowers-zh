// tests/installer/helpers.mjs — 安装器测试共用夹具
//
// 所有测试都在 os.tmpdir() 的一次性夹具中离线运行：
//   - 子进程 cwd 永远是临时目录，绝不污染真实 HOME / 全局目录；
//   - 读文本统一 CRLF -> LF（Windows 夹具下行为可移植）；
//   - 仓库根用 import.meta.url 定位（不依赖运行测试时的 cwd）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const ROOT_URL = new URL('../../', import.meta.url);
export const ROOT = fileURLToPath(ROOT_URL);
export const BIN = fileURLToPath(new URL('bin/jevzh.js', ROOT_URL));
export const SKILLS_SRC = path.join(ROOT, 'skills');
export const HOOKS_SRC = path.join(ROOT, 'hooks');
export const SCRIPTS_SRC = path.join(ROOT, 'scripts');

// 6 个 jev-* 汉化门禁技能（任务 3 迁入）
export const JEV_SKILLS = [
  'jev-using-superpowers',
  'jev-brainstorming',
  'jev-writing-plans',
  'jev-executing-plans',
  'jev-systematic-debugging',
  'jev-verification',
];

// 21 个中文技能（15 翻译 + 4 中国原创 + 2 上游历史保留，任务 2 迁入）
export const ZH_SKILLS = [
  'brainstorming',
  'diagnosing-superpowers',
  'dispatching-parallel-agents',
  'executing-plans',
  'finishing-a-development-branch',
  'receiving-code-review',
  'requesting-code-review',
  'subagent-driven-development',
  'systematic-debugging',
  'test-driven-development',
  'using-git-worktrees',
  'using-superpowers',
  'verification-before-completion',
  'writing-plans',
  'writing-skills',
  'chinese-code-review',
  'chinese-commit-conventions',
  'chinese-documentation',
  'chinese-git-workflow',
  'mcp-builder',
  'workflow-runner',
];

export const ALL_SKILLS = [...ZH_SKILLS, ...JEV_SKILLS];

export function mkFixture(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function rmFixture(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows 下偶发 EBUSY/EPERM 不影响断言结果；夹具留在 tmpdir 由系统清理。
  }
}

// 统一子进程入口：默认清空 JEVZH_*/TYPESAFE_* 继承并把 HOME 指到夹具内，
// 保证测试不触碰真实环境；伪造 USERPROFILE/APPDATA 的全局测试通过 opts.env 注入。
export function run(args, opts = {}) {
  const env = { ...process.env, ...(opts.env || {}) };
  delete env.JEVZH_BACKEND;
  delete env.JEVZH_STRICT;
  delete env.TYPESAFE_API_KEY;
  delete env.TYPESAFE_BASE_URL;
  if (!opts.env || !Object.prototype.hasOwnProperty.call(opts.env, 'HOME')) {
    env.HOME = path.join(opts.cwd, 'home');
  }
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd: opts.cwd,
    encoding: 'utf8',
    env,
    timeout: 90_000,
  });
}

export function readText(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

export function exists(p) {
  return fs.existsSync(p);
}

// 递归列出目录内全部文件（相对路径、正斜杠、字典序）。
export function listFiles(dir) {
  const out = [];
  const walk = (d, rel) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const r = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(path.join(d, entry.name), r);
      } else if (entry.isFile()) {
        out.push(r.split(path.sep).join('/'));
      }
    }
  };
  walk(dir, '');
  return out.sort();
}

// 整树内容指纹（路径 + 字节内容），用于幂等重跑稳定性断言。
export function hashTree(dir) {
  const h = crypto.createHash('sha256');
  for (const f of listFiles(dir)) {
    h.update(f).update('\0').update(fs.readFileSync(path.join(dir, f)));
  }
  return h.digest('hex');
}

// 断言两个目录的文件集合与字节内容一致（忽略 extra 相对路径集合）。
export function assertTreesEqual(t, actualDir, expectedDir, opts = {}) {
  const ignore = new Set(opts.ignore ?? []);
  const actual = new Set(listFiles(actualDir).filter(f => !ignore.has(f)));
  const expected = new Set(listFiles(expectedDir).filter(f => !ignore.has(f)));
  assertSetEqual(t, actual, expected);
  for (const f of expected) {
    const a = fs.readFileSync(path.join(actualDir, f));
    const e = fs.readFileSync(path.join(expectedDir, f));
    t.assert.ok(a.equals(e), `文件内容不一致: ${f}`);
  }
}

export function assertSetEqual(t, actual, expected) {
  const missing = [...expected].filter(x => !actual.has(x));
  const extra = [...actual].filter(x => !expected.has(x));
  t.assert.equal(
    missing.length + extra.length,
    0,
    `集合不一致；缺少: ${missing.join(',') || '无'}；多出: ${extra.join(',') || '无'}`,
  );
}

// 读取一个已安装技能的 .jevzh-meta.json（本包管理标记）。
export function readMeta(skillsDir, skillName) {
  return JSON.parse(
    readText(path.join(skillsDir, skillName, '.jevzh-meta.json')),
  );
}
