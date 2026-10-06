#!/usr/bin/env node
// hooks/run-hook.cjs — 跨平台钩子启动器（zero-dependency，Node >=20）
//
// 为什么需要它（R-3，2026-10 实测）：
//   Cursor 项目级钩子（<project>/.cursor/hooks.json）由宿主在「项目根」以
//   shell string 形式派生（见 https://cursor.com/docs/hooks：
//   「For project hooks ... scripts run from the project root」）。
//   在 Windows 上：
//     * 直接执行无扩展名的 bash 脚本（./hooks/pre-commit）→ cmd 报
//       “is not recognized as an internal or external command”；
//     * 即使指向 run-hook.cmd，CreateProcess 直生 .cmd 会 ENOENT，
//       正斜杠相对路径在 cmd 下也会被当成开关解析；
//     * PATH 上的 bash 可能是 WSL 存根（不认 Windows 路径、无 node）。
//   经 `node <本文件> <脚本名>` 启动可同时绕开三类坑：node 是本包硬性前置，
//   宿主无论用 cmd/PowerShell/Git Bash/直接 CreateProcess 都能拉起来；
//   Git Bash 的查找口径与 run-hook.cmd 完全一致（固定安装路径优先）。
//
// 扩展名用 .cjs 而非 .js：本仓 package.json 为 type:module，且被接线的宿主
// 项目自身可能有任意 type 的 package.json——.cjs 在两种项目里都被 Node 强制
// 按 CommonJS 解释，行为与最近的 package.json 无关。
//
// 用法：node run-hook.cjs <script-name> [args...]
//   例： node .cursor/hooks/run-hook.cjs session-start
//        node .cursor/hooks/run-hook.cjs pre-commit
//
// 行为与 hooks/run-hook.cmd 对齐：
// Windows 找 Git for Windows bash（两个固定路径 → PATH 上的 Git bash）；
// POSIX 找 PATH/bash 常见路径；找不到 bash 时静默 exit 0（仅缺上下文注入，
// 不阻断宿主），绝不伪造钩子成功/失败判定。
'use strict';

const { statSync } = require('node:fs');
const { join, delimiter, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');

// 只允许调用同目录下已知的无扩展名钩子，杜绝相对路径穿越参数。
const ALLOWED_SCRIPTS = new Set(['session-start', 'pre-commit', 'stop']);

function isFile(p) {
  try { return statSync(p).isFile(); } catch { return false; }
}

// Git for Windows 固定安装路径（与 hooks/run-hook.cmd、scripts/run-bash.js 同序）。
// 抽成常量 + 注入式解析，便于单测在 os.tmpdir 构造畸形候选而不必碰 Program Files。
const FIXED_WIN_BASH_PATHS = [
  'C:\\Program Files\\Git\\bin\\bash.exe',
  'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
];
const POSIX_BASH_CANDIDATES = ['bash', '/bin/bash', '/usr/bin/bash', '/usr/local/bin/bash', '/opt/homebrew/bin/bash'];

// 纯判定：候选列表里第一个【普通文件】。existsSync 对同名目录/坏 junction 也
// 返回真，但 spawn 一个目录会 ENOENT，调用方随后静默 rc0——等于钩子永远没跑。
function pickFirstFile(candidates, isFileFn) {
  for (const p of candidates) {
    if (isFileFn(p)) return p;
  }
  return null;
}

// 探活：必须是真能跑的 bash。WSL 存根（无发行版时 rc 127）/非 bash 可执行文件
// 都过不了这一关。超时放宽到 10s：CI/高负载 Windows 上单次 bash 冷启动本身
// 就可能数秒，探活超时会让钩子被误判为「无 bash」而静默放行。
function bashIsAlive(exe) {
  try {
    const r = spawnSync(exe, ['-c', 'echo jevzh-bash-ok'], {
      encoding: 'utf8',
      timeout: 10_000,
      windowsHide: true,
    });
    return !r.error && r.status === 0 && String(r.stdout || '').includes('jevzh-bash-ok');
  } catch {
    return false;
  }
}

// 额外验证：PATH 上名为 bash 的程序必须真的是 Git Bash（能执行 Windows 路径下
// 的脚本且同环境能调 node）。WSL bash 即便已装发行版也不满足——它看到的
// /c/... 挂载与 Git Bash 不同，且常无 node，钩子链路会断在半道。
function looksLikeGitBash(exe) {
  try {
    const r = spawnSync(exe, ['-c', 'echo "$MSYSTEM"'], {
      encoding: 'utf8',
      timeout: 10_000,
      windowsHide: true,
    });
    return !r.error && r.status === 0 ? /MINGW|MSYS|CYGWIN/.test(String(r.stdout || '').trim()) : false;
  } catch {
    return false;
  }
}

// 解析可用 bash。依赖（候选列表、PATH、探活谓词）均可注入，供单测在临时目录
// 构造「固定路径是目录 / PATH 有候选」等场景；生产直跑时全部取真实实现。
function resolveBash(opts = {}) {
  const platform = opts.platform ?? process.platform;
  const pathEnv = opts.pathEnv ?? process.env.PATH;
  const fileCheck = opts.isFileFn ?? isFile;
  const alive = opts.bashIsAlive ?? bashIsAlive;
  const looksGitBash = opts.looksLikeGitBash ?? looksLikeGitBash;
  if (platform === 'win32') {
    // 1) Git for Windows 固定安装路径（与 hooks/run-hook.cmd、scripts/run-bash.js
    //    同序）。这是安装器写入的权威路径，确认是普通文件即直接采用：不再做探活
    //    ——高负载机器上探活进程可能排队超过其 timeout，反而把可用 Git Bash 误判
    //    成「无 bash」静默放行。注意必须 isFile：同名目录/坏 junction 即便存在也
    //    不能采用（spawn 目录必 ENOENT），此时落到 PATH 枚举分支。
    const fixedHit = pickFirstFile(opts.fixedWinPaths ?? FIXED_WIN_BASH_PATHS, fileCheck);
    if (fixedHit) return fixedHit;
    // 2) PATH 上枚举 bash.exe：优先 Git Bash，拒绝 WSL 存根。
    const names = ['bash.exe', 'bash'];
    const seen = new Set();
    for (const dir of String(pathEnv || '').split(delimiter).filter(Boolean)) {
      for (const name of names) {
        const exe = join(dir, name);
        if (seen.has(exe) || !fileCheck(exe)) continue;
        seen.add(exe);
        if (looksGitBash(exe) && alive(exe)) return exe;
      }
    }
    return null;
  }
  // POSIX：PATH 优先，再退常见安装位置。
  for (const exe of (opts.posixCandidates ?? POSIX_BASH_CANDIDATES)) {
    if (exe === 'bash' || fileCheck(exe)) {
      if (alive(exe)) return exe;
    }
  }
  return null;
}

// 直跑入口：被 require（单测）时不执行任何 argv 解析/进程派生。
function main() {
  const scriptName = process.argv[2];
  if (!scriptName) {
    console.error('run-hook.cjs: missing script name');
    process.exit(1);
  }
  if (!ALLOWED_SCRIPTS.has(scriptName)) {
    console.error(`run-hook.cjs: unknown hook script "${scriptName}"`);
    process.exit(1);
  }
  const hookArgs = process.argv.slice(3);

  const bash = resolveBash();
  if (!bash) {
    // 与 run-hook.cmd 的无 bash 分支一致：静默放行（钩子只是没跑，不代表门失败）。
    process.exit(0);
  }

  // Git Bash 接受盘符正斜杠形态（C:/dir/script）；传反斜杠会被当转义符。
  let scriptPath = join(__dirname, scriptName);
  if (process.platform === 'win32') {
    scriptPath = resolve(scriptPath).split('\\').join('/');
  }

  const r = spawnSync(bash, [scriptPath, ...hookArgs], {
    stdio: 'inherit',
    windowsHide: true,
  });

  if (r.error) {
    // 钩子启动失败属环境问题：与 run-hook.cmd 的兜底一致，不把它伪装成判定否决。
    console.error(`run-hook.cjs: failed to launch hook: ${r.error.message}`);
    process.exit(0);
  }
  if (r.signal) {
    process.exit(1);
  }
  process.exit(r.status ?? 0);
}

if (require.main === module) {
  main();
}

module.exports = {
  resolveBash,
  pickFirstFile,
  isFile,
  FIXED_WIN_BASH_PATHS,
  POSIX_BASH_CANDIDATES,
};
