#!/usr/bin/env node
// scripts/run-bash.js — 跨平台 bash 脚本入口包装（零第三方依赖）
//
// 背景：package.json 里 audit / test:bash 若裸调 bash，Windows 上 PATH 首位
// 常常解析到 WSL 的 bash.exe（WindowsApps 存根或已装发行版）：WSL 内既无
// 本仓依赖的 node，worktree 的 gitdir 指针还会被拼成 /mnt/d/.../D:/... 导致
// 「fatal: not a git repository」。本包装让 npm 脚本在两平台行为一致：
//   - POSIX：直接 exec bash（PATH 解析，与手写 bash 等价）；
//   - Windows：bash 解析顺序对齐 bin/jevzh.js 的 resolveUsableBash —— 先
//     Git for Windows 两个固定安装路径，再退回 PATH 上的 bash；候选必须
//     通过 `echo jevzh-bash-ok` 探活（rc 0 且输出含标记，挡掉 WSL 存根/
//     退出非 0 的伪 bash）。
//
// 用法：node scripts/run-bash.js <脚本路径> [参数...]
//   例：node scripts/run-bash.js scripts/audit.sh --quick
//       npm run audit -- --quick          # npm 透传额外参数
//
// 退出码：子进程退出码原样透传；用法错误 64；找不到可用 bash 127。

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { constants as osConstants } from 'node:os';

const USAGE = '用法: node scripts/run-bash.js <脚本路径> [参数...]';

// 与 bin/jevzh.js 的 GIT_BASH_FIXED_PATHS / BASH_PROBE_* 保持同一口径。
const GIT_BASH_FIXED_PATHS = [
  'C:\\Program Files\\Git\\bin\\bash.exe',
  'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
];
const PROBE_MARKER = 'jevzh-bash-ok';
const PROBE_TIMEOUT_MS = 5000;
const PROBE_ATTEMPTS = 2;

// PATH 上是否存在某可执行文件（Windows 叠加 PATHEXT）。
function isOnPath(bin) {
  const pathSep = process.platform === 'win32' ? ';' : ':';
  const dirs = (process.env.PATH || '').split(pathSep).filter(Boolean);
  const exts = process.platform === 'win32'
    ? ['', ...(process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)]
    : [''];
  for (const d of dirs) {
    for (const ext of exts) {
      try { if (existsSync(join(d, bin + ext))) return true; } catch { /* 忽略不可读目录 */ }
    }
  }
  return false;
}

// 探活：bash -c 'echo jevzh-bash-ok' 必须 rc 0 且 stdout 含标记。
// PATH 上的 WSL 存根（无发行版 -> 127）、任何非 bash 可执行文件都过不了。
// 高负载下 spawn 可能偶发超时，失败重试 PROBE_ATTEMPTS 次（同 bin/jevzh.js）。
function probeBashLiveness(exe) {
  for (let attempt = 1; attempt <= PROBE_ATTEMPTS; attempt++) {
    let r;
    try {
      r = spawnSync(exe, ['-c', `echo ${PROBE_MARKER}`], {
        encoding: 'utf8',
        timeout: PROBE_TIMEOUT_MS,
        windowsHide: true,
      });
    } catch {
      continue;
    }
    if (r && !r.error && r.status === 0 && String(r.stdout || '').includes(PROBE_MARKER)) {
      return true;
    }
  }
  return false;
}

// Windows 专用：按「固定路径 -> PATH」顺序返回首个探活通过的 Git Bash。
// 找不到/全部探活失败 -> null（调用方输出安装指引并 exit 127）。
function resolveWindowsBash() {
  const candidates = [];
  for (const p of GIT_BASH_FIXED_PATHS) {
    try { if (existsSync(p)) candidates.push(p); } catch { /* 忽略 */ }
  }
  if (isOnPath('bash')) candidates.push('bash');
  for (const exe of candidates) {
    if (probeBashLiveness(exe)) return exe;
  }
  return null;
}

// --- 参数解析 -------------------------------------------------------------
const [scriptPath, ...scriptArgs] = process.argv.slice(2);
if (!scriptPath) {
  console.error(`run-bash: 缺少脚本路径参数。\n${USAGE}`);
  process.exit(64);
}

// --- 选择 bash ------------------------------------------------------------
let bashExe;
if (process.platform === 'win32') {
  bashExe = resolveWindowsBash();
  if (!bashExe) {
    console.error(
      'run-bash: 未找到可用的 Git Bash。\n'
      + '本仓的 bash 脚本在 Windows 上需要 Git for Windows 提供的 bash.exe'
      + '（PATH 首位若是 WSL 的 bash 存根会导致 node 找不到、gitdir 错乱）。\n'
      + '请安装 Git for Windows：https://git-scm.com/download/win\n'
      + '安装后重开终端再试；如装在非默认目录，可把 Git\\bin 加入 PATH。',
    );
    process.exit(127);
  }
} else {
  // POSIX：与裸调 bash 等价，直接交给 PATH 解析，不做探活。
  bashExe = 'bash';
}

// Windows 反斜杠路径转成 Git Bash 可直接识别的正斜杠盘符形态
// （D:\\dir\\script.sh -> D:/dir/script.sh）；相对路径/参数不受影响。
const bashScriptArg = process.platform === 'win32'
  ? scriptPath.replace(/\\/g, '/')
  : scriptPath;

// --- 执行并透传退出码 ------------------------------------------------------
const r = spawnSync(bashExe, [bashScriptArg, ...scriptArgs], {
  stdio: 'inherit',
  windowsHide: true,
});

if (r.error) {
  // POSIX 上 bash 不存在（ENOENT）等启动错误：给出明确指引而非静默 rc 1。
  console.error(`run-bash: 启动 bash 失败：${r.error.message}`);
  process.exit(127);
}
if (r.signal) {
  // 被信号终止：沿用 shell 惯例 128 + 信号编号。
  const signo = osConstants.signals?.[r.signal] || 1;
  process.exit(128 + signo);
}
process.exit(r.status ?? 1);
