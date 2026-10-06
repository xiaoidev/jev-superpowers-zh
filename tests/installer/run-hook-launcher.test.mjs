// tests/installer/run-hook-launcher.test.mjs — hooks/run-hook.cjs bash 解析单测（R2）
//
// 旧缺陷：两个硬编码 Git for Windows 路径只做 existsSync。同名目录或坏 junction
// 也会让 existsSync 命中，但 spawn 一个目录必然 ENOENT，run-hook.cjs 随后静默
// rc0——钩子永远没跑却不留痕迹。修复口径：固定候选必须 statSync().isFile()，
// 不合法则落到 PATH 枚举分支。
//
// 可测性：run-hook.cjs 是 CommonJS，已把候选解析抽成可注入纯函数并 module.exports；
// require 它不触发任何 argv 解析/进程派生（require.main 门禁）。所有夹具只在
// os.tmpdir() 构造，绝不在 Program Files 下动东西。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const cjsPath = fileURLToPath(new URL('../../hooks/run-hook.cjs', import.meta.url));
const {
  resolveBash,
  pickFirstFile,
  FIXED_WIN_BASH_PATHS,
} = require(cjsPath);

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function realIsFile(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

test('R2 常量：两个固定候选仍是权威 Git for Windows 安装路径（与 run-hook.cmd 同序）', () => {
  assert.deepEqual(FIXED_WIN_BASH_PATHS, [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
  ]);
});

test('pickFirstFile：普通文件命中；同名目录跳过取后一个普通文件；皆非文件返回 null', () => {
  const dir = mkTmp('jevzh-r2-pick-');
  try {
    const asDir = path.join(dir, 'bash-dir.exe');
    fs.mkdirSync(asDir); // 同名目录（坏 junction 的可观察效果同为 stat 非普通文件）
    const asFile = path.join(dir, 'bash-file.exe');
    fs.writeFileSync(asFile, 'not-a-real-bash');
    assert.equal(pickFirstFile([asDir, asFile], realIsFile), asFile, '目录候选必须跳过');
    assert.equal(pickFirstFile([asDir], realIsFile), null, '只有目录候选时不得命中');
    assert.equal(pickFirstFile([path.join(dir, 'missing.exe')], realIsFile), null);
    assert.equal(pickFirstFile([], realIsFile), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('R2 win32：固定路径是同名目录时不采用，回退 PATH 枚举并甄别后采用 PATH 候选', () => {
  const dir = mkTmp('jevzh-r2-fixed-dir-');
  try {
    // 伪造「固定安装路径」：bash.exe 是目录而非文件
    const fixedDir = path.join(dir, 'Program Files', 'Git', 'bin');
    fs.mkdirSync(path.join(fixedDir, 'bash.exe'), { recursive: true });
    const fixedCandidate = path.join(fixedDir, 'bash.exe');
    assert.ok(fs.existsSync(fixedCandidate), '夹具前置：existsSync 对目录为真（复现缺陷前提）');
    assert.equal(realIsFile(fixedCandidate), false);

    // PATH 上的候选：普通文件
    const pathDir = path.join(dir, 'on-path');
    fs.mkdirSync(pathDir, { recursive: true });
    const pathBash = path.join(pathDir, 'bash.exe');
    fs.writeFileSync(pathBash, 'not-a-real-bash');

    const probeCalls = [];
    const got = resolveBash({
      platform: 'win32',
      pathEnv: pathDir,
      fixedWinPaths: [fixedCandidate],
      looksLikeGitBash: (exe) => { probeCalls.push(['gitbash', exe]); return true; },
      bashIsAlive: (exe) => { probeCalls.push(['alive', exe]); return true; },
    });
    assert.equal(got, pathBash, '固定路径是目录时必须回退到 PATH 分支');
    // 固定目录不触发探活；只有 PATH 候选经过双重甄别
    assert.deepEqual(probeCalls, [['gitbash', pathBash], ['alive', pathBash]]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('R2 win32：固定路径是普通文件时直接采用，不枚举 PATH、不做任何探活', () => {
  const dir = mkTmp('jevzh-r2-fixed-file-');
  try {
    const fixed = path.join(dir, 'bash.exe');
    fs.writeFileSync(fixed, 'not-a-real-bash');
    let probed = false;
    const got = resolveBash({
      platform: 'win32',
      pathEnv: '', // 即便 PATH 为空也无所谓
      fixedWinPaths: [fixed],
      looksLikeGitBash: () => { probed = true; return false; },
      bashIsAlive: () => { probed = true; return false; },
    });
    assert.equal(got, fixed);
    assert.equal(probed, false, '权威固定路径是普通文件时直接采用，不得探活');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('R2 win32：固定路径缺失/非文件且 PATH 无 Git Bash 时返回 null（上层静默放行）', () => {
  const dir = mkTmp('jevzh-r2-none-');
  try {
    const got = resolveBash({
      platform: 'win32',
      pathEnv: dir, // 空目录：无 bash.exe
      fixedWinPaths: [path.join(dir, 'no-such-bash.exe')],
      looksLikeGitBash: () => true,
      bashIsAlive: () => true,
    });
    assert.equal(got, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('R2 posix：注入候选与探活桩时行为与 win32 同构（文件才探活、命中即返回）', () => {
  const dir = mkTmp('jevzh-r2-posix-');
  try {
    const good = path.join(dir, 'bash');
    fs.writeFileSync(good, 'x');
    const calls = [];
    assert.equal(
      resolveBash({
        platform: 'linux',
        posixCandidates: [good],
        bashIsAlive: (exe) => { calls.push(exe); return true; },
      }),
      good,
    );
    assert.deepEqual(calls, [good]);
    assert.equal(
      resolveBash({
        platform: 'linux',
        posixCandidates: [path.join(dir, 'missing')],
        bashIsAlive: () => true,
      }),
      null,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
