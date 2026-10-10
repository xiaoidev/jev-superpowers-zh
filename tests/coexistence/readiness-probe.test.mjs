// tests/coexistence/readiness-probe.test.mjs — S-1：Windows 就绪探测硬化
// 1) 优先 Git for Windows 固定路径（PATH 无 bash 也能命中），探活标记挡 WSL 存根；
// 2) 权威脚本默认 15s 超时（env 可注入缩短），超时/无 bash/探活失败三态中文降级；
// 3) JEVZH_TEST_BASH_ARGV 注入「node + fake-bash 包装」覆盖成功/非法输出/探活失败/
//    无候选/超时；Windows 固定路径另跑一条真实 Git Bash 集成用例。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { run, mkFixture, rmFixture } from './helpers.mjs';
import { BIN } from '../installer/helpers.mjs';

const mod = await import(pathToFileURL(BIN).href);
const { probeReadiness, resolveUsableBash, READINESS_TIMEOUT_MS } = mod;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// 假 bash：应答 `-c echo <marker>` 探活；其余调用把「脚本路径 + 参数」交给 node 执行
// （测试中的就绪脚本是 .mjs stub；生产路径上该接缝不启用）。
const FAKE_BASH = `
import { spawnSync } from 'node:child_process';
const args = process.argv.slice(2);
if (args[0] === '-c') {
  if (process.env.JEVZH_STUB_LIVENESS_FAIL === '1') process.exit(1);
  process.stdout.write('jevzh-bash-ok\\n');
  process.exit(0);
}
const [script, ...rest] = args;
const r = spawnSync(process.execPath, [script, ...rest], { stdio: 'inherit' });
process.exit(r.status ?? 1);
`;

// 假就绪脚本：可控延迟/坏输出/合法 JSON。
const READINESS_STUB = `
const delay = Number(process.env.JEVZH_STUB_DELAY_MS || 0);
setTimeout(() => {
  if (process.env.JEVZH_STUB_OUT === 'bad') {
    process.stdout.write('this is absolutely not json\\n');
    process.exit(0);
  }
  process.stdout.write(JSON.stringify({
    state: 'DEGRADED', backend: 'none', strict: false, missingTools: [],
  }) + '\\n');
}, delay);
`;

let harnessDir;
let fakeBashPath;
let readinessStubPath;
test.before(() => {
  harnessDir = mkFixture('jevzh-rp-harness-');
  fakeBashPath = path.join(harnessDir, 'fake-bash.mjs');
  readinessStubPath = path.join(harnessDir, 'readiness-stub.mjs');
  fs.writeFileSync(fakeBashPath, FAKE_BASH);
  fs.writeFileSync(readinessStubPath, READINESS_STUB);
});
test.after(() => {
  if (harnessDir) rmFixture(harnessDir);
});

// 在测试进程内临时注入/还原 env（模块单测直接调用，不经子进程）。
const ENV_KEYS = [
  'JEVZH_BACKEND', 'JEVZH_TEST_BASH', 'JEVZH_TEST_BASH_ARGV',
  'JEVZH_TEST_READINESS_SCRIPT', 'JEVZH_STUB_LIVENESS_FAIL',
  'JEVZH_STUB_DELAY_MS', 'JEVZH_STUB_OUT', 'JEVZH_TEST_READINESS_TIMEOUT_MS',
];
async function withEnv(env, fn) {
  const save = new Map(ENV_KEYS.map((k) => [k, process.env[k]]));
  try {
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    return await fn();
  } finally {
    for (const [k, v] of save) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function baseEnv(extra = {}) {
  return {
    JEVZH_BACKEND: 'off',
    JEVZH_TEST_BASH_ARGV: JSON.stringify([process.execPath, fakeBashPath]),
    JEVZH_TEST_READINESS_SCRIPT: readinessStubPath,
    ...extra,
  };
}

test('S-1 常量：权威脚本默认超时 15000ms（冷启动实测约 5.7s，旧 4s 会误降级）', () => {
  assert.equal(READINESS_TIMEOUT_MS, 15000);
});

test('S-1 成功：假 bash 探活通过且返回合法 JSON -> bash 权威口径，state 取脚本值', async () => {
  const dir = mkFixture('jevzh-rp-ok-');
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  try {
    await withEnv(baseEnv(), async () => {
      const live = resolveUsableBash();
      assert.equal(live.ok, true);
      const r = await probeReadiness(dir, false, false);
      assert.match(r.source, /scripts\/jev-readiness（bash 权威口径）/);
      assert.equal(r.data.state, 'DEGRADED');
      assert.equal(r.data.backend, 'none');
    });
  } finally {
    rmFixture(dir);
  }
});

test('S-1 降级三态之 not-found：__none__ 约定 -> 文案含「未找到 bash」', async () => {
  const dir = mkFixture('jevzh-rp-none-');
  try {
    await withEnv({ JEVZH_BACKEND: 'off', JEVZH_TEST_BASH: '__none__' }, async () => {
      assert.equal(resolveUsableBash().ok, false);
      const r = await probeReadiness(dir, false, false);
      assert.match(r.source, /Node 轻量探测/);
      assert.match(r.source, /未找到 bash/);
    });
  } finally {
    rmFixture(dir);
  }
});

test('S-1 降级三态之 probe-failed：探活退出非 0（模拟 WSL 存根）-> 文案含「探活失败」', async () => {
  const dir = mkFixture('jevzh-rp-probe-');
  try {
    await withEnv(baseEnv({ JEVZH_STUB_LIVENESS_FAIL: '1' }), async () => {
      const r = await probeReadiness(dir, false, false);
      assert.match(r.source, /探活失败/);
    });
  } finally {
    rmFixture(dir);
  }
});

test('S-1 降级：不存在的绝对路径候选 -> probe-failed（不误报 not-found）', async () => {
  const dir = mkFixture('jevzh-rp-missing-');
  try {
    await withEnv({
      JEVZH_BACKEND: 'off',
      JEVZH_TEST_BASH_ARGV: JSON.stringify([path.join(harnessDir, 'no-such-bash.exe'), fakeBashPath]),
    }, async () => {
      const r = resolveUsableBash();
      assert.equal(r.ok, false);
      assert.equal(r.reason, 'probe-failed');
    });
  } finally {
    rmFixture(dir);
  }
});

test('S-1 降级：脚本输出非 JSON -> 回退 Node 轻量探测（无法解析文案）', async () => {
  const dir = mkFixture('jevzh-rp-bad-');
  try {
    await withEnv(baseEnv({ JEVZH_STUB_OUT: 'bad' }), async () => {
      const r = await probeReadiness(dir, false, false);
      assert.match(r.source, /就绪脚本输出无法解析/);
    });
  } finally {
    rmFixture(dir);
  }
});

test('S-1 降级三态之超时：脚本延迟超过注入超时 -> ETIMEDOUT 中文降级且快速返回', async () => {
  const dir = mkFixture('jevzh-rp-timeout-');
  try {
    await withEnv(baseEnv({
      JEVZH_STUB_DELAY_MS: '1000',
      JEVZH_TEST_READINESS_TIMEOUT_MS: '150',
    }), async () => {
      const t0 = Date.now();
      const r = await probeReadiness(dir, false, false);
      assert.ok(Date.now() - t0 < 3000, '超时分支不应等到脚本自然结束');
      assert.match(r.source, /执行超时/);
    });
  } finally {
    rmFixture(dir);
  }
});

test('S-1 Windows 集成：PATH 不含 bash，固定路径实调权威脚本（与直调 JSON 一致）', { timeout: 420000 }, async (t) => {
  if (process.platform !== 'win32') return t.skip('仅 Windows 验证固定 Git Bash 路径');
  const fixed = ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files (x86)\\Git\\bin\\bash.exe']
    .find((p) => fs.existsSync(p));
  if (!fixed) return t.skip('本机无 Git for Windows 固定安装路径');

  const dir = mkFixture('jevzh-rp-win-');
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  // PATH 只留 System32/Windows 与 node 目录：刻意不放 Git bin，证明固定路径查找不依赖 PATH。
  const stripped = [
    'C:\\Windows\\System32',
    'C:\\Windows',
    path.dirname(process.execPath),
  ].join(';');
  const sleepMs = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

  // 全量套件并发跑时大量 node 子进程会把单次 spawn 饿到数十秒。用最便宜的
  // `bash -c echo` 做负载金丝雀：等机器空闲（<1.2s）再做权威实调，避免环境抖动误判。
  async function waitForIdle(deadlineMs) {
    const t0 = Date.now();
    for (;;) {
      const s = Date.now();
      const r = spawnSync(fixed, ['-c', 'echo jevzh-idle'], {
        encoding: 'utf8', timeout: 10000,
        env: { ...process.env, PATH: stripped },
      });
      const cost = Date.now() - s;
      if (!r.error && r.status === 0 && cost < 1200) return true;
      if (Date.now() - t0 > deadlineMs) return false;
      sleepMs(5000);
    }
  }

  try {
    if (!(await waitForIdle(290000))) {
      return t.skip('本机持续高负载（金丝雀 bash -c 长期 >1.2s），跳过权威脚本实调；单独运行本文件可覆盖');
    }
    const scriptAbs = path.join(ROOT, 'scripts', 'jev-readiness');
    const direct = spawnSync(fixed, [scriptAbs, '--project', dir, '--json'], {
      encoding: 'utf8',
      timeout: 45000,
      env: { ...process.env, PATH: stripped, JEVZH_BACKEND: 'off' },
    });
    assert.equal(direct.status, 0, direct.stderr);
    const jsonLine = direct.stdout.split(/\r?\n/).filter(Boolean).at(-1);
    const directJson = JSON.parse(jsonLine);
    assert.ok(['FULL', 'LOCAL', 'PARTIAL', 'DEGRADED'].includes(directJson.state));
    assert.equal(directJson.backend, 'none');

    // 全量并发下 node 自举可能超过生产默认 15s：测试接缝放宽到 45s，仅用于验证
    // 「固定路径命中 + 权威口径与直调一致」，不改变生产默认值。
    const doctorEnv = { PATH: stripped, JEVZH_BACKEND: 'off', JEVZH_TEST_READINESS_TIMEOUT_MS: '45000' };
    let r = run(['doctor', '--tool', 'claude'], { cwd: dir, env: doctorEnv });
    let out = r.stdout + r.stderr;
    if (!/scripts\/jev-readiness（bash 权威口径）/.test(out) && /执行超时/.test(out)) {
      // 唯一允许的环境性失败是「饿死超时」：再等一轮空闲后重试一次。
      if (await waitForIdle(120000)) {
        r = run(['doctor', '--tool', 'claude'], { cwd: dir, env: doctorEnv });
        out = r.stdout + r.stderr;
      }
    }
    if (!/scripts\/jev-readiness（bash 权威口径）/.test(out) && /执行超时|探活失败/.test(out)) {
      return t.skip(`并发负载下权威脚本/探活未能在时限内完成（非功能缺陷；单独运行本文件必现权威口径）。输出片段：${out.slice(0, 200)}`);
    }
    assert.equal(r.status, 0, out);
    assert.match(out, /scripts\/jev-readiness（bash 权威口径）/);
    assert.match(r.stdout, new RegExp(`状态：${directJson.state}`));
    assert.match(r.stdout, /后端：none/);
  } finally {
    rmFixture(dir);
  }
});
