// tests/e2e/gate-failures.test.mjs
// 两类失败端到端矩阵（DoD §4.3：环境型失败 soft 放行/strict 阻断；判定型失败
// 任何模式都阻断）。与 tests/jev-gate/gate.test.sh 的区别：本套件不直调
// scripts/jev-gate，而是用【安装产物】的 Cursor 项目钩子，穿过完整宿主链路：
//
//   cmd /c → node .cursor/hooks/run-hook.cjs pre-commit
//          → Git Bash → hooks/pre-commit → .cursor/scripts/jev-gate commit
//          → git jev check（桩）
//
// stdin 喂 PreToolUse 载荷 {"tool_input":{"command":"git commit ..."}}。
// 若只在 gate 层测，钩子的载荷识别、git 存在性兜底、30s 超时包装、strict
// 缓存一致性任一处回归都测不到。
//
// 能力探测 skip：非 Windows 或两个固定 Git for Windows 路径都缺失则跳过——
// R-3 的直调链路是 Windows 失效面；POSIX 走 PATH bash 已由 9 套 bash 覆盖。
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { run, mkFixture, rmFixture, readText } from '../installer/helpers.mjs';

const GIT_BASH_CANDIDATES = [
  'C:\\Program Files\\Git\\bin\\bash.exe',
  'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
];
const BASH_EXE = GIT_BASH_CANDIDATES.find((p) => fs.existsSync(p));
const hasGitBash = Boolean(BASH_EXE);
const skip = process.platform !== 'win32'
  ? '两类失败全链路 e2e 以 Windows cmd 直调为失效面，POSIX 由 bash 套件覆盖'
  : (!hasGitBash ? '未发现 Git for Windows 固定安装，无法跑 Git Bash 钩子链' : false);

const COMMIT_INPUT = JSON.stringify({
  tool_name: 'Bash',
  tool_input: { command: 'git commit -m "test: gate failures e2e"' },
});

// status=null（spawn 超时/沙箱杀子进程）属「没跑成」而非断言失败，空结果重试
// 至多 2 次（见 hook-direct-dial.test.mjs 同款说明）。
function dialedOrRetry(spawnOnce) {
  let r;
  for (let attempt = 1; ; attempt += 1) {
    r = spawnOnce();
    if (r.status !== null || attempt === 3) return r;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
}

function dialViaCmd(command, opts) {
  const comspec = process.env.ComSpec || 'cmd.exe';
  return dialedOrRetry(() => spawnSync(comspec, ['/d', '/s', '/c', command], {
    cwd: opts.cwd,
    env: opts.env,
    encoding: 'utf8',
    input: opts.input,
    timeout: 180_000,
    windowsHide: true,
  }));
}

function cursorPreCommitCommand(hooksJsonPath) {
  const cfg = JSON.parse(readText(hooksJsonPath));
  const list = cfg.hooks.preToolUse;
  const cmd = list[0].command;
  const m = cmd.match(/run-hook\.cjs\s+pre-commit$/);
  if (!m) throw new Error(`pre-commit 命令形态不符: ${cmd}`);
  return cmd;
}

function toMsys(p) {
  return p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '/$1').toLowerCase();
}

// 受控 PATH：前置 BIN（桩目录）或不前置；保留 node/system32/Git 核心目录。
// 不继承宿主任意 PATH 目录，保证本机装没装 jev-* 工具结果都确定。
//
// Windows 坑（实测）：Git Bash 非登录启动时强制把 /mingw64/bin、/usr/bin
// 前置到继承来的 PATH 之前——桩目录即使在 Windows PATH 最前，桩 git 仍被
// /mingw64/bin/git（真 git，无 jev 子命令）遮蔽。bash 内部 export 可以改顺序
// （gate.test.sh 即如此），但本套件的 bash 由宿主链 cmd→node→run-hook.cjs
// 派生，无法在壳内 export。故用 bash 官方测试钩子 BASH_ENV：非交互 shell 启动
// 时先 source 它，里面用 cygpath 转译桩目录并前置，等价于「桩工具装在 PATH
// 最前」。产品代码零改动。
function gateEnv({ dir, binDir, extra = {} } = {}) {
  const bits = [
    ...(binDir ? [binDir] : []),
    path.dirname(process.execPath),
    process.env.SystemRoot ? path.join(process.env.SystemRoot, 'System32') : 'C:\\Windows\\System32',
    'C:\\Program Files\\Git\\usr\\bin',
    'C:\\Program Files\\Git\\bin',
    'C:\\Program Files (x86)\\Git\\usr\\bin',
    'C:\\Program Files (x86)\\Git\\bin',
  ].filter((p) => {
    try { return fs.existsSync(p); } catch { return false; }
  });
  const pathValue = bits.join(';');
  const env = {
    ...process.env,
    PATH: pathValue,
    Path: pathValue,
    TYPESAFE_API_KEY: '',
    // 本机沙箱进程派生秒级开销，套件并行时 readiness+gate 冷跑墙钟可能破 40s；
    // 用脚本自带测试开关放宽门超时，避免把「慢」误判成超时降级，退出码语义不变。
    JEVZH_HOOK_TIMEOUT: '120',
    ...extra,
  };
  if (binDir && dir) {
    // BASH_ENV 脚本：把桩目录（Windows 形态经 cygpath -u）前置到 MSYS PATH。
    const envSh = path.join(dir, 'bashenv.sh');
    fs.writeFileSync(envSh, 'export PATH="$(cygpath -u "$JEVZH_TEST_STUBBIN"):$PATH"\n', { mode: 0o644 });
    env.BASH_ENV = toMsys(envSh);
    env.JEVZH_TEST_STUBBIN = binDir;
  }
  return env;
}

// 六个 env 驱动的无扩展名 bash 桩（与 tests/jev-gate/gate.test.sh 同构）：
// readiness 探 git jev --version 得 exit0 → 认为 git-jev 在；
// commit 门的判定结果由 GIT_JEV_OUT / GIT_JEV_RC 逐用例注入。
function writeStubs(binDir) {
  fs.mkdirSync(binDir, { recursive: true });
  const stubs = {
    git: `#!/usr/bin/env bash
case "\${1:-}" in
  jev)
    case "\${2:-}" in
      --version) exit 0 ;;
      check)
        [ -n "\${GIT_JEV_OUT:-}" ] && printf '%s\\n' "\$GIT_JEV_OUT"
        exit "\${GIT_JEV_RC:-0}" ;;
    esac ;;
esac
exit 0
`,
    'jev-axi': `#!/usr/bin/env bash
case "\${1:-}" in
  pick)    printf '%s\\n' "\${AXI_OUT:-confidence: 0.9}"; exit "\${AXI_RC:-0}" ;;
  triage)  cat; [ -n "\${TRIAGE_OUT:-}" ] && printf '%s\\n' "\$TRIAGE_OUT"; exit "\${TRIAGE_RC:-0}" ;;
  check)   printf '%s\\n' "\${CHECK_OUT:-p: 0.9}"; exit "\${CHECK_RC:-0}" ;;
esac
exit 0
`,
    'jev-scout': `#!/usr/bin/env bash
printf '%s\\n' "\${SCOUT_OUT:-3 verified crates found}"
exit "\${SCOUT_RC:-0}"
`,
    'jev-guard': `#!/usr/bin/env bash
printf '%s\\n' "\${GUARD_OUT:-PASS (destructive: 0.01)}"
exit "\${GUARD_RC:-0}"
`,
    supercov: `#!/usr/bin/env bash
case "\${1:-}" in
  quality) printf '%s\\n' "\${SUPERCOV_OUT:-quality ok, 0 weak files}"; exit "\${SUPERCOV_RC:-0}" ;;
esac
exit 0
`,
    limpet: `#!/usr/bin/env bash
case "\${1:-}" in
  check) printf '%s\\n' "\${LIMPET_OUT:-all stop criteria satisfied}"; exit "\${LIMPET_RC:-0}" ;;
esac
exit 0
`,
  };
  for (const [name, body] of Object.entries(stubs)) {
    const p = path.join(binDir, name);
    fs.writeFileSync(p, body.replace(/\r\n/g, '\n'), { mode: 0o755 });
    fs.chmodSync(p, 0o755);
  }
}

// 伪本地桥（laya 健康体，对任何路径回 200）。由每次判定型拨号的 bash 根进程
// 以后台方式拉起（见 dialViaBridgeBash）。
//
// 为什么必须与钩子链共享同一个 Git Bash 根（实测坑）：本机沙箱下，跨进程回环
// TCP 仅在【同一个 bash.exe 根进程的子树】内连通（对照 tests/jev-gate/gate.test.sh
// 的单脚本拓扑）；agent node 不同子树（含同进程 server + node 子进程 client）
// 的回环 SYN 会被黑洞。故判定型用例不能用测试进程内置 http server，也不能
// 先起桥再 cmd 拨号，必须：bash -c '起桥 & 跑钩子'，桥与钩子互为同根兄弟。
// 环境型用例不涉及回环，仍走 cmd /c 宿主派生根。
// 哨兵文件关停，避免遗留游离 node。
const BRIDGE_SERVER_SRC = `
const http = require('http');
const fs = require('fs');
const portFile = process.argv[2];
const sentinel = process.argv[3];
const srv = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok', engine: 'laya-421m', laya_installed: true }));
});
srv.listen(0, '127.0.0.1', () => fs.writeFileSync(portFile, String(srv.address().port)));
function shutdown() {
  try { fs.rmSync(portFile, { force: true }); } catch (e) {}
  srv.close(() => process.exit(0));
}
const iv = setInterval(() => { try { if (fs.existsSync(sentinel)) { clearInterval(iv); shutdown(); } } catch (e) {} }, 150);
setTimeout(() => { clearInterval(iv); shutdown(); }, 180000);
`;

// 在单个 Git Bash 根进程内：夹具目录起后台桥 → 导出 local 后端 env → 跑安装态
// 钩子命令（stdin 原样喂 PreToolUse 载荷）→ 收尾停桥，退出码透传钩子 rc。
function dialViaBridgeBash({ dir, hookCommand, env, input, tag }) {
  fs.writeFileSync(path.join(dir, 'bridge-server.cjs'), BRIDGE_SERVER_SRC.replace(/^\n/, ''));
  // tag 隔离三次拨号的端口/哨兵文件；桥后台继承的 fd 重定向到日志，不抢 stdin。
  const shell = [
    'set -u',
    'cd "$1" || exit 70',
    `PF="bridge.${tag}.port"; SF="bridge.${tag}.stop"; rm -f "$PF" "$SF"`,
    'node bridge-server.cjs "$PF" "$SF" >bridge.log 2>&1 &',
    'for _ in 1 2 3 4 5 6 7 8 9 10 20 30 40 50; do [ -s "$PF" ] && break; sleep 0.1; done',
    '[ -s "$PF" ] || { echo "bridge port missing"; cat bridge.log; exit 71; }',
    'export TYPESAFE_BASE_URL="http://127.0.0.1:$(cat "$PF")"',
    'export TYPESAFE_API_KEY="local"',
    'eval "$2"', // 钩子命令，形如 node .cursor/hooks/run-hook.cjs pre-commit（测试自控，无注入面）
    'rc=$?',
    'touch "$SF"',
    'exit "$rc"',
  ].join('\n');
  return dialedOrRetry(() => spawnSync(BASH_EXE, ['-c', shell, '_', toMsys(dir), hookCommand], {
    cwd: dir,
    env,
    encoding: 'utf8',
    input,
    timeout: 240_000,
    windowsHide: true,
  }));
}

test('环境型失败：工具缺失 + backend=off，commit 载荷 soft rc0 含[门禁降级]；strict rc2', { skip }, () => {
  const dir = mkFixture('jevzh-e2e-envfail-');
  try {
    const r = run(['--tool', 'cursor'], { cwd: dir });
    if (r.status !== 0) throw new Error(r.stdout + r.stderr);
    fs.writeFileSync(path.join(dir, '.jevzh.json'), JSON.stringify({ backend: 'off', strict: false }));
    const cmd = cursorPreCommitCommand(path.join(dir, '.cursor', 'hooks.json'));
    // 注意：不放 BIN 桩；受控 PATH 里 Git 自带 /usr/bin/git 不支持 jev 子命令
    // → git-jev 缺失；backend=off → commit 门环境型失败。
    const env = gateEnv();

    const soft = dialViaCmd(cmd, { cwd: dir, env, input: COMMIT_INPUT });
    if (soft.status !== 0) throw new Error(`soft rc=${soft.status}\n${soft.stdout}${soft.stderr}`);
    if (!soft.stdout.includes('[门禁降级]')) {
      throw new Error(`soft 输出缺[门禁降级]\n${soft.stdout}${soft.stderr}`);
    }
    if (!soft.stdout.includes('git-jev')) {
      throw new Error(`soft 输出未点缺失项 git-jev\n${soft.stdout}${soft.stderr}`);
    }

    const strictEnv = gateEnv({ extra: { JEVZH_STRICT: '1' } });
    const strict = dialViaCmd(cmd, { cwd: dir, env: strictEnv, input: COMMIT_INPUT });
    if (strict.status !== 2) {
      throw new Error(`strict 环境型失败应 rc2，实际 rc=${strict.status}\n${strict.stdout}${strict.stderr}`);
    }
  } finally {
    rmFixture(dir);
  }
});

test('判定型失败：工具在+本地桥可达，git jev check 无[PASS] 则任何模式 rc2；有[PASS] rc0', { skip }, () => {
  const dir = mkFixture('jevzh-e2e-verdict-');
  try {
    const r = run(['--tool', 'cursor'], { cwd: dir });
    if (r.status !== 0) throw new Error(r.stdout + r.stderr);
    // 桥 URL 由拨号 shell 在同根 bash 内导出（env 优先），json 只声明 backend=local。
    fs.writeFileSync(path.join(dir, '.jevzh.json'),
      JSON.stringify({ backend: 'local', strict: false }));
    writeStubs(path.join(dir, 'fake-bin'));
    const cmd = cursorPreCommitCommand(path.join(dir, '.cursor', 'hooks.json'));
    const baseEnv = gateEnv({ dir, binDir: path.join(dir, 'fake-bin') });

    const dial = (tag, extra) => dialViaBridgeBash({
      dir, hookCommand: cmd, env: { ...baseEnv, ...extra }, input: COMMIT_INPUT, tag,
    });

    // 1) 软降级模式 + 判定否决：必须仍 rc2（软降级绝不放行判定型失败）
    const fail = dial('fail', { GIT_JEV_OUT: '[FAIL] secrets p=0.80 payload p=0.71', GIT_JEV_RC: '0' });
    if (fail.status !== 2) {
      throw new Error(`判定否决 soft 也应 rc2，实际 rc=${fail.status}\n${fail.stdout}${fail.stderr}`);
    }
    if (!fail.stdout.includes('判定否决')) {
      throw new Error(`判定否决输出缺「判定否决」文案\n${fail.stdout}${fail.stderr}`);
    }
    if (fail.stdout.includes('[门禁降级]')) {
      throw new Error(`判定型失败不得出现环境降级文案（两类失败不可混）\n${fail.stdout}${fail.stderr}`);
    }

    // 2) 严格模式同样 rc2（一致性，不是 strict 专属）
    const failStrict = dial('strict', { JEVZH_STRICT: '1', GIT_JEV_OUT: 'no pass marker at all', GIT_JEV_RC: '0' });
    if (failStrict.status !== 2) {
      throw new Error(`判定否决 strict 应 rc2，实际 rc=${failStrict.status}\n${failStrict.stdout}${failStrict.stderr}`);
    }

    // 3) PASS 控制组：证明链路真的在跑门并透传判定，而非一律 rc2
    const pass = dial('pass', { GIT_JEV_OUT: '[PASS] secrets p=0.02 payload p=0.01', GIT_JEV_RC: '0' });
    if (pass.status !== 0) {
      throw new Error(`[PASS] 应 rc0，实际 rc=${pass.status}\n${pass.stdout}${pass.stderr}`);
    }
    if (!pass.stdout.includes('[PASS]')) {
      throw new Error(`PASS 用例应透传原生输出\n${pass.stdout}${pass.stderr}`);
    }
  } finally {
    rmFixture(dir);
  }
});
