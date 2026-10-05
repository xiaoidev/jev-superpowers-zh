// tests/e2e/hook-direct-dial.test.mjs — R-3 实测取证（Windows 宿主直调）
//
// 背景（cursor.com/docs/hooks）：Cursor 项目级钩子在【项目根】被宿主以 shell
// string 派生。2026-10 沙箱实测旧形态两类硬失败：
//   1) ./hooks/run-hook.cmd 在项目根解析（hooks 实际在 .cursor/hooks/）→ 死路径；
//   2) 直调无扩展名 bash 脚本（./hooks/pre-commit）→ cmd “is not recognized”。
// 修复后接线统一为 `node .cursor/hooks/run-hook.cjs <arg>`（.cjs 不受宿主项目
// package.json type 影响）。本套件用两种真实宿主派生方式实跑接线命令，并实跑
// 插件模板形态（cwd=插件根，./hooks/...）：
//   A. cmd：%ComSpec% /d /s /c "<command>"（Cursor Windows 默认）
//   B. node spawnSync(..., { shell: true })（另一类 IDE/插件宿主的派生口径）
//
// 能力探测 skip：无 Git for Windows 固定安装（或非 Windows）时跳过本套件——
// run-hook.cjs 在 POSIX 可另用 Git Bash PATH 回退，但 R-3 的失效面是 Windows
// cmd 直生，换平台跑不能证明同一问题，故只在能力齐备的 Windows 上执行。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  run, mkFixture, rmFixture, readText, ROOT,
} from '../installer/helpers.mjs';

const GIT_BASH_CANDIDATES = [
  'C:\\Program Files\\Git\\bin\\bash.exe',
  'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
];
const hasGitBash = GIT_BASH_CANDIDATES.some((p) => fs.existsSync(p));
const skip = process.platform !== 'win32'
  ? 'R-3 直调失效面为 Windows cmd 宿主派生，POSIX 不覆盖该路径'
  : (!hasGitBash ? '未发现 Git for Windows 固定安装（run-hook.cjs 无可复用 bash）' : false);

// 全量套件并行时沙箱偶发杀死子进程（status=null + signal/error，实测触发点
// 含沙箱对 Windows CustomDestinations 的写拦截），以及高负载下 spawn 超时。
// 这类「根本没跑成」与断言失败无关：空结果最多重试 2 次，真判定码/输出不改判。
function dialedOrRetry(spawnOnce) {
  let r;
  for (let attempt = 1; ; attempt += 1) {
    r = spawnOnce();
    if (r.status !== null || attempt === 3) return r;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
}

// 宿主直调：cmd 形态。命令文本由测试在运行时从安装产物 JSON 中提取，
// 不经任何包装脚本，等价于 Cursor 把 hooks.json 的 command 交给 cmd /c。
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

// 宿主直调：node shell:true 形态（CreateProcess 经 cmd 解释整条 string）。
function dialViaNodeShell(command, opts) {
  return dialedOrRetry(() => spawnSync(command, {
    shell: true,
    cwd: opts.cwd,
    env: opts.env,
    encoding: 'utf8',
    input: opts.input,
    timeout: 180_000,
    windowsHide: true,
  }));
}

function cursorCommands(hooksJsonPath) {
  const cfg = JSON.parse(readText(hooksJsonPath));
  const out = {};
  for (const [key, list] of Object.entries(cfg.hooks)) {
    const cmd = list[0].command;
    const m = cmd.match(/run-hook\.cjs\s+([a-z-]+)$/);
    assert.ok(m, `${key} 命令不是 node run-hook.cjs 形态: ${cmd}`);
    out[m[1]] = cmd;
  }
  return out; // { 'session-start': cmd, 'pre-commit': cmd, 'stop': cmd }
}

const NON_COMMIT_INPUT = JSON.stringify({
  tool_name: 'Bash',
  tool_input: { command: 'ls -la' },
});

// session-start 的 JSON 形状随宿主环境分三派（见 hooks/session-start 输出分支）：
// CURSOR_PLUGIN_ROOT -> additional_context（snake）；CLAUDE_PLUGIN_ROOT ->
// hookSpecificOutput.additionalContext；无宿主 env -> SDK 标准 additionalContext。
// 直调模拟不带宿主 env，落在 SDK 标准形态；另设一次 CURSOR_PLUGIN_ROOT 验 Cursor 形态。
function sessionContext(payload) {
  return payload.additional_context
    ?? payload.additionalContext
    ?? payload.hookSpecificOutput?.additionalContext;
}
function assertSessionJson(stdout, label) {
  const payload = JSON.parse(stdout);
  const ctx = sessionContext(payload);
  assert.equal(typeof ctx, 'string', `${label}: 缺会话注入文本字段，stdout=${stdout.slice(0, 200)}`);
  assert.ok(ctx.includes('jev-superpowers-zh'), `${label}: 注入文本不含本包标识`);
  return payload;
}

test('R-3：安装产物 .cursor/hooks.json 三事件命令可被 cmd /c 与 node shell 在项目根直跑', { skip }, () => {
  const dir = mkFixture('jevzh-e2e-dial-');
  try {
    const r = run(['--tool', 'cursor'], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    // 后端关掉，避免就绪探测走网络；输出确定性不受影响。
    fs.writeFileSync(path.join(dir, '.jevzh.json'), JSON.stringify({ backend: 'off', strict: false }));
    const cmds = cursorCommands(path.join(dir, '.cursor', 'hooks.json'));

    // 1) session-start：rc=0，stdout 必须是宿主可读的钩子 JSON
    for (const [label, dial] of [['cmd /c', dialViaCmd], ['node shell:true', dialViaNodeShell]]) {
      const ss = dial(cmds['session-start'], { cwd: dir });
      assert.equal(ss.status, 0, `${label} session-start rc=${ss.status}\n${ss.stdout}${ss.stderr}`);
      const payload = assertSessionJson(ss.stdout, `${label} session-start`);
      // 无宿主 env：SDK 标准形态（顶层 additionalContext）
      assert.equal(typeof payload.additionalContext, 'string', `${label} 未带宿主 env 应走 SDK 标准形态`);
    }
    // 1b) Cursor 插件实跑会带 CURSOR_PLUGIN_ROOT：输出切到 additional_context（snake）
    const ssCur = dialViaCmd(cmds['session-start'], {
      cwd: dir,
      env: { ...process.env, CURSOR_PLUGIN_ROOT: path.join(dir, '.cursor') },
    });
    assert.equal(ssCur.status, 0, `cursor env session-start rc=${ssCur.status}\n${ssCur.stdout}${ssCur.stderr}`);
    const curPayload = assertSessionJson(ssCur.stdout, 'CURSOR_PLUGIN_ROOT session-start');
    assert.equal(typeof curPayload.additional_context, 'string', 'CURSOR_PLUGIN_ROOT 下应为 additional_context');
    assert.equal(curPayload.additionalContext, undefined, 'cursor 形态不得同时发 SDK 字段');

    // 2) pre-commit：非提交命令走快路径 exit 0（两种派生各一次）
    for (const [label, dial] of [['cmd /c', dialViaCmd], ['node shell:true', dialViaNodeShell]]) {
      const pc = dial(cmds['pre-commit'], { cwd: dir, input: NON_COMMIT_INPUT });
      assert.equal(pc.status, 0, `${label} pre-commit 非提交快路径应 rc=0\n${pc.stdout}${pc.stderr}`);
    }

    // 3) stop：非 git 仓库 + 门禁软降级，exit 0（受控 PATH 保证确定性）
    const controlledEnv = controlledHookEnv();
    for (const [label, dial] of [['cmd /c', dialViaCmd], ['node shell:true', dialViaNodeShell]]) {
      const st = dial(cmds.stop, { cwd: dir, env: controlledEnv });
      assert.equal(st.status, 0, `${label} stop 在非 git 仓库应软降级 rc=0\n${st.stdout}${st.stderr}`);
    }
  } finally {
    rmFixture(dir);
  }
});

test('R-3：插件模板 hooks/hooks-cursor.json 形态（cwd=插件根，node ./hooks/...）可直跑', { skip }, () => {
  // 插件被 Cursor 解包后，命令相对【插件根】执行（ babysitter 官方示例同构：
  // bash "./hooks/session-start.sh"）。这里以仓根模拟插件根，实跑模板三命令。
  const cfg = JSON.parse(readText(path.join(ROOT, 'hooks', 'hooks-cursor.json')));
  const commands = {};
  for (const [key, list] of Object.entries(cfg.hooks)) {
    const cmd = list[0].command;
    const m = cmd.match(/^node\s+\.\/hooks\/run-hook\.cjs\s+([a-z-]+)$/);
    assert.ok(m, `${key} 模板命令形态不符: ${cmd}`);
    commands[m[1]] = cmd;
  }

  // session-start：钩子只读 cwd 上下文并输出 JSON（仓根不是 git 项目也成立）
  const ss = dialViaCmd(commands['session-start'], { cwd: ROOT });
  assert.equal(ss.status, 0, `模板 session-start rc=${ss.status}\n${ss.stdout}${ss.stderr}`);
  assertSessionJson(ss.stdout, '模板 session-start');

  // pre-commit 非提交快路径
  const pc = dialViaCmd(commands['pre-commit'], { cwd: ROOT, input: NON_COMMIT_INPUT });
  assert.equal(pc.status, 0, `模板 pre-commit rc=${pc.status}\n${pc.stdout}${pc.stderr}`);
});

// 受控 PATH：node 目录 + system32 + Git for Windows（usr/bin 提供 timeout/coreutils）。
// 不含任何 jev 门禁工具，保证 stop 的 limpet 门走环境缺失软降级而非真实判定。
function controlledHookEnv() {
  const bits = [
    path.dirname(process.execPath),
    process.env.SystemRoot ? path.join(process.env.SystemRoot, 'System32') : 'C:\\Windows\\System32',
    'C:\\Program Files\\Git\\usr\\bin',
    'C:\\Program Files\\Git\\bin',
    'C:\\Program Files (x86)\\Git\\usr\\bin',
    'C:\\Program Files (x86)\\Git\\bin',
  ].filter((p) => {
    try { return fs.existsSync(p); } catch { return false; }
  });
  return {
    ...process.env,
    PATH: bits.join(';'),
    Path: bits.join(';'), // Windows 环境变量大小写不敏感，但两写保险
    JEVZH_BACKEND: 'off',
    TYPESAFE_API_KEY: '',
  };
}

// 反向证明（防回归锚点）：旧死形态在项目根必须仍然失败——避免有人把接线改回
// ./hooks/run-hook.cmd 后本套件因新形态通过而漏掉回归。
test('R-3 防回归锚点：旧形态 ./hooks/run-hook.cmd 在项目根直调确实失败', { skip }, () => {
  const dir = mkFixture('jevzh-e2e-oldform-');
  try {
    const r = run(['--tool', 'cursor'], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const dead = '.\\hooks\\run-hook.cmd session-start';
    const res = dialViaCmd(dead, { cwd: dir });
    assert.notEqual(res.status, 0, '旧死路径形态竟成功，R-3 修复前提已不成立（请复查本断言）');
  } finally {
    rmFixture(dir);
  }
});
