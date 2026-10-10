// tests/coexistence/settings-merge.test.mjs — hooks/settings JSON 读-改-写合并（用例 7 的 hooks 部分）：
// 未知键与用户既有 hook 条目保留；jev 上游 pre-commit/stop 引用改写而非重复追加；
// 幂等字节稳定；settings.local.json 优先；Cursor 小写 schema；
// 损坏 JSON -> 该目标 BLOCK exit 2 且零写盘，其他目标继续；R-1 运行时按宿主过滤。
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  run, mkFixture, rmFixture, readText, exists, listBackups,
} from './helpers.mjs';

test('Claude settings.json：未知键与用户既有 hook 保留，本包三类 hook 挂入；改前备份', () => {
  const dir = mkFixture('jevzh-settings-merge-');
  const pre = {
    unknownTopKey: 'KEEP-SETTINGS-1',
    permissions: { allow: ['KEEP-SETTINGS-2'] },
    hooks: {
      UserPromptSubmit: [
        { hooks: [{ type: 'command', command: 'echo KEEP-USER-HOOK' }] },
      ],
      SessionStart: [
        { matcher: 'startup', hooks: [{ type: 'command', command: 'echo KEEP-SESSION-START' }] },
      ],
    },
  };
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify(pre, null, 2));
  try {
    const r = run(['--tool', 'claude'], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const cfg = JSON.parse(readText(path.join(dir, '.claude', 'settings.json')));
    assert.equal(cfg.unknownTopKey, 'KEEP-SETTINGS-1', '未知顶层键丢失');
    assert.deepEqual(cfg.permissions, { allow: ['KEEP-SETTINGS-2'] });
    const commands = JSON.stringify(cfg.hooks);
    assert.match(commands, /KEEP-USER-HOOK/, '用户既有 hook 条目丢失');
    assert.match(commands, /KEEP-SESSION-START/, '用户既有 SessionStart 组丢失');
    assert.match(commands, /run-hook\.cmd[\\/"]+ session-start|run-hook\.cmd session-start/);
    assert.match(commands, /run-hook\.cmd[\\/"]+ pre-commit|run-hook\.cmd pre-commit/);
    assert.match(commands, /run-hook\.cmd[\\/"]+ stop|run-hook\.cmd stop/);
    assert.equal(cfg.hooks.SessionStart.length, 1 + 1, 'SessionStart 应保留用户组并追加本包组');

    // 改前整文件备份
    const ts = listBackups(dir)[0];
    assert.ok(ts, 'settings 合并属于接管，应有备份');
    const manifest = JSON.parse(
      readText(path.join(dir, '.jevzh', 'backups', ts, 'manifest.json')),
    );
    const rels = manifest.targets.flatMap((t) => t.entries.map((e) => e.relPath));
    assert.ok(rels.some((r) => r.replace(/\\/g, '/').endsWith('.claude/settings.json')));
  } finally {
    rmFixture(dir);
  }
});

test('jev 上游 pre-commit/stop 引用被改写指向 jevzh，不重复追加；幂等字节稳定', () => {
  const dir = mkFixture('jevzh-settings-rewrite-');
  const pre = {
    hooks: {
      PreToolUse: [
        {
          matcher: 'Bash',
          hooks: [
            { type: 'command', command: '~/.local/share/jev-superpowers/hooks/pre-commit' },
          ],
        },
      ],
      Stop: [
        { hooks: [{ type: 'command', '/path/to/jev-superpowers/hooks/stop': '' }] },
      ],
    },
  };
  // Stop 用真实命令字段构造
  pre.hooks.Stop = [{ hooks: [{ type: 'command', command: '/opt/jev-superpowers/hooks/stop' }] }];
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify(pre, null, 2));
  try {
    const r1 = run(['--tool', 'claude'], { cwd: dir });
    assert.equal(r1.status, 0, r1.stdout + r1.stderr);
    const s1 = readText(path.join(dir, '.claude', 'settings.json'));
    const cfg1 = JSON.parse(s1);
    const flat = JSON.stringify(cfg1.hooks);
    assert.doesNotMatch(flat, /jev-superpowers\/hooks/, 'jev 上游路径残留');
    assert.match(flat, /run-hook\.cmd/);
    // pre-commit 只有一条（改写而非追加）
    const preToolUses = JSON.stringify(cfg1.hooks.PreToolUse);
    assert.equal((preToolUses.match(/pre-commit/g) ?? []).length, 1);

    // 幂等：第二次安装不再改写
    const statBefore = fs.statSync(path.join(dir, '.claude', 'settings.json'));
    const r2 = run(['--tool', 'claude'], { cwd: dir });
    assert.equal(r2.status, 0, r2.stdout + r2.stderr);
    assert.equal(
      fs.statSync(path.join(dir, '.claude', 'settings.json')).size,
      statBefore.size,
      '幂等重跑不应改写 settings.json',
    );
    assert.equal(readText(path.join(dir, '.claude', 'settings.json')), s1);
  } finally {
    rmFixture(dir);
  }
});

test('hooks 已在 settings.local.json 时合并进该文件；settings.json 不被创建', () => {
  const dir = mkFixture('jevzh-settings-local-');
  const local = {
    hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo local-only-KEEP' }] }] },
  };
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'settings.local.json'), JSON.stringify(local, null, 2));
  try {
    const r = run(['--tool', 'claude'], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(!exists(path.join(dir, '.claude', 'settings.json')), '不应新建 settings.json');
    const cfg = JSON.parse(readText(path.join(dir, '.claude', 'settings.local.json')));
    assert.match(JSON.stringify(cfg.hooks), /local-only-KEEP/);
    // Windows 绝对路径命令带闭合引号，JSON 再序列化形如 ...run-hook.cmd\" session-start
    assert.match(JSON.stringify(cfg.hooks), /run-hook\.cmd[\\/"]+ session-start/);
  } finally {
    rmFixture(dir);
  }
});

test('Cursor：.cursor/hooks.json 小写 schema 合并，用户 command 保留', () => {
  const dir = mkFixture('jevzh-settings-cursor-');
  fs.mkdirSync(path.join(dir, '.cursor'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.cursor', 'hooks.json'),
    JSON.stringify({ version: 1, hooks: { sessionStart: [{ command: 'echo KEEP-CURSOR-HOOK' }] } }, null, 2),
  );
  try {
    const r = run(['--tool', 'cursor'], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const cfg = JSON.parse(readText(path.join(dir, '.cursor', 'hooks.json')));
    const all = JSON.stringify(cfg.hooks);
    assert.match(all, /KEEP-CURSOR-HOOK/);
    // R-3：cursor 项目根相对 + node 启动器
    assert.match(all, /node \.cursor\/hooks\/run-hook\.cjs session-start/);
    assert.match(all, /node \.cursor\/hooks\/run-hook\.cjs pre-commit/);
    assert.match(all, /node \.cursor\/hooks\/run-hook\.cjs stop/);
    assert.ok(Array.isArray(cfg.hooks.sessionStart));
  } finally {
    rmFixture(dir);
  }
});

test('R-3：Cursor 旧形态 ./hooks/run-hook.cmd 被就地归一为 node 启动器，不重复追加', () => {
  const dir = mkFixture('jevzh-cursor-r3-normalize-');
  const old = {
    version: 1,
    hooks: {
      sessionStart: [{ command: './hooks/run-hook.cmd session-start' }],
      preToolUse: [{ matcher: 'Bash', command: './hooks/run-hook.cmd pre-commit' }],
      stop: [{ command: './hooks/run-hook.cmd stop' }],
    },
  };
  fs.mkdirSync(path.join(dir, '.cursor'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.cursor', 'hooks.json'), JSON.stringify(old, null, 2));
  try {
    const r1 = run(['--tool', 'cursor'], { cwd: dir });
    assert.equal(r1.status, 0, r1.stdout + r1.stderr);
    const s1 = readText(path.join(dir, '.cursor', 'hooks.json'));
    const cfg1 = JSON.parse(s1);
    const flat = JSON.stringify(cfg1.hooks);
    assert.match(flat, /node \.cursor\/hooks\/run-hook\.cjs session-start/);
    assert.match(flat, /node \.cursor\/hooks\/run-hook\.cjs pre-commit/);
    assert.match(flat, /node \.cursor\/hooks\/run-hook\.cjs stop/);
    assert.doesNotMatch(flat, /run-hook\.cmd/, '旧 run-hook.cmd 形态应全部消失');
    // 每事件恰好一条（归一而非追加）
    assert.equal(cfg1.hooks.sessionStart.length, 1);
    assert.equal(cfg1.hooks.preToolUse.length, 1);
    assert.equal(cfg1.hooks.stop.length, 1);

    // 幂等：第二次安装字节稳定
    const r2 = run(['--tool', 'cursor'], { cwd: dir });
    assert.equal(r2.status, 0, r2.stdout + r2.stderr);
    assert.equal(readText(path.join(dir, '.cursor', 'hooks.json')), s1);
  } finally {
    rmFixture(dir);
  }
});

test('R-1：Claude 不落 hooks-cursor.json，Cursor 不落 hooks.json', () => {
  const dir = mkFixture('jevzh-settings-r1-');
  try {
    const r = run(['--tool', 'claude'], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(exists(path.join(dir, '.claude', 'hooks', 'hooks.json')));
    assert.ok(!exists(path.join(dir, '.claude', 'hooks', 'hooks-cursor.json')),
      'Claude 目标不应落 hooks-cursor.json');

    const r2 = run(['--tool', 'cursor'], { cwd: dir });
    assert.equal(r2.status, 0, r2.stdout + r2.stderr);
    assert.ok(exists(path.join(dir, '.cursor', 'hooks', 'hooks-cursor.json')));
    assert.ok(!exists(path.join(dir, '.cursor', 'hooks', 'hooks.json')),
      'Cursor 目标不应落 hooks.json');
  } finally {
    rmFixture(dir);
  }
});

test('损坏 settings.json：Claude 目标 BLOCK exit 2 且零写盘；同范围 Cursor 目标不受影响', () => {
  const dir = mkFixture('jevzh-settings-corrupt-');
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.cursor'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), '{ broken json ,,, }');
  try {
    const r = run([], { cwd: dir });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    const out = r.stdout + r.stderr;
    assert.match(out, /BLOCK/);
    assert.match(out, /settings\.json/);
    // 被阻断目标零写盘
    assert.ok(!exists(path.join(dir, '.claude', 'skills')));
    assert.ok(!exists(path.join(dir, 'CLAUDE.md')));
    // 坏文件字节不动
    assert.equal(readText(path.join(dir, '.claude', 'settings.json')), '{ broken json ,,, }');
    // 其他目标正常完成
    assert.ok(exists(path.join(dir, '.cursor', 'skills', 'jev-verification', 'SKILL.md')));
  } finally {
    rmFixture(dir);
  }
});

test('--keep-router：settings.json 存在也不合并，原文件字节不动', () => {
  const dir = mkFixture('jevzh-settings-keep-');
  const pre = { hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo x' }] }] } };
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify(pre));
  try {
    const r = run(['--tool', 'claude', '--keep-router'], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(
      readText(path.join(dir, '.claude', 'settings.json')),
      JSON.stringify(pre),
    );
  } finally {
    rmFixture(dir);
  }
});

// ── I-1：Claude settings 同组混条目时卸载剪枝必须回写 ──────────────────────
// 旧缺陷：claude 分支写回条件只比组数（keptGroups.length < list.length），
// 同组内「本包条目 + 用户条目」时组不消失，摘掉本包条目后不回写，死命令
// run-hook.cmd 留在 JSON 里每次工具调用都 127，日志却谎报切除成功。
function writeClaudeSettings(dir, cfg) {
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), `${JSON.stringify(cfg, null, 2)}\n`);
}

function cutCountLines(out) {
  return [...out.matchAll(/精确切除 (\d+) 条/g)].map((m) => Number(m[1]));
}

test('I-1a：PreToolUse 同组混装（竞品改写条目 + 用户 echo），卸载回写切除死命令、计数如实', () => {
  const dir = mkFixture('jevzh-i1-mixed-group-');
  const settingsPath = path.join(dir, '.claude', 'settings.json');
  const pre = {
    hooks: {
      PreToolUse: [{
        matcher: 'Bash',
        hooks: [
          { type: 'command', command: '~/.local/share/jev-superpowers/hooks/pre-commit' },
          { type: 'command', command: 'echo USER-SIBLING-KEEP' },
        ],
      }],
    },
  };
  writeClaudeSettings(dir, pre);
  try {
    const ri = run(['--tool', 'claude'], { cwd: dir });
    assert.equal(ri.status, 0, ri.stdout + ri.stderr);
    // 安装后同组两条：竞品条目就地改写为本包接线，用户 echo 同组保留
    const installed = JSON.parse(readText(settingsPath));
    assert.equal(installed.hooks.PreToolUse.length, 1);
    assert.equal(installed.hooks.PreToolUse[0].hooks.length, 2);
    assert.match(installed.hooks.PreToolUse[0].hooks[0].command, /run-hook\.cmd[\\/"]+ pre-commit/);
    assert.equal(installed.hooks.PreToolUse[0].hooks[1].command, 'echo USER-SIBLING-KEEP');

    const ru = run(['--uninstall', '--tool', 'claude'], { cwd: dir });
    assert.equal(ru.status, 0, ru.stdout + ru.stderr);
    const text = readText(settingsPath);
    JSON.parse(text); // 落盘必须仍是合法 JSON
    assert.doesNotMatch(text, /run-hook/, '死命令 run-hook 必须从整个 JSON 消失');
    assert.match(text, /USER-SIBLING-KEEP/, '同组用户条目必须保留');
    const cfg = JSON.parse(text);
    assert.deepEqual(
      cfg.hooks.PreToolUse,
      [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo USER-SIBLING-KEEP' }] }],
    );
    assert.ok(!cfg.hooks.SessionStart && !cfg.hooks.Stop, '另两事件纯本包组应整组消失');
    // 切除计数与实际一致：混合组 1 + SessionStart/Stop 纯本包各 1 = 3
    assert.deepEqual(cutCountLines(ru.stdout + ru.stderr), [3]);
  } finally {
    rmFixture(dir);
  }
});

test('I-1b：PreToolUse 多组（纯竞品→纯本包 / 用户+竞品混合 / 纯用户），卸载分别正确处置', () => {
  const dir = mkFixture('jevzh-i1-multi-group-');
  const settingsPath = path.join(dir, '.claude', 'settings.json');
  const pre = {
    hooks: {
      PreToolUse: [
        { matcher: 'Bash', hooks: [{ type: 'command', command: '/opt/jev-superpowers/hooks/pre-commit' }] },
        {
          matcher: 'Bash',
          hooks: [
            { type: 'command', command: '~/.local/share/jev-superpowers/hooks/pre-commit' },
            { type: 'command', command: 'echo MIXED-USER-KEEP' },
          ],
        },
        { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo PURE-USER-KEEP' }] },
      ],
    },
  };
  writeClaudeSettings(dir, pre);
  try {
    const ri = run(['--tool', 'claude'], { cwd: dir });
    assert.equal(ri.status, 0, ri.stdout + ri.stderr);
    assert.equal(JSON.parse(readText(settingsPath)).hooks.PreToolUse.length, 3, '安装不应改组数');

    const ru = run(['--uninstall', '--tool', 'claude'], { cwd: dir });
    assert.equal(ru.status, 0, ru.stdout + ru.stderr);
    const text = readText(settingsPath);
    JSON.parse(text);
    assert.doesNotMatch(text, /run-hook/, '纯本包组与混合组内本包条目都必须消失');
    const cfg = JSON.parse(text);
    assert.equal(cfg.hooks.PreToolUse.length, 2, '纯本包组消失后应剩混合组+纯用户组');
    assert.deepEqual(
      cfg.hooks.PreToolUse[0],
      { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo MIXED-USER-KEEP' }] },
    );
    assert.deepEqual(
      cfg.hooks.PreToolUse[1],
      { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo PURE-USER-KEEP' }] },
      '纯用户组必须原样不动',
    );
    // 纯竞品组 1 + 混合组 1 + SessionStart/Stop 各 1 = 4
    assert.deepEqual(cutCountLines(ru.stdout + ru.stderr), [4]);
  } finally {
    rmFixture(dir);
  }
});

// 三事件走同一个剪枝函数：参数化覆盖 SessionStart / PreToolUse / Stop 同组混装。
for (const [event, arg] of [['SessionStart', 'session-start'], ['PreToolUse', 'pre-commit'], ['Stop', 'stop']]) {
  test(`I-1c：${event} 同组混装（竞品 ${arg} 改写条目 + 用户 echo），卸载只留用户条目`, () => {
    const dir = mkFixture(`jevzh-i1-${arg}-`);
    const settingsPath = path.join(dir, '.claude', 'settings.json');
    const pre = {
      hooks: {
        [event]: [{
          hooks: [
            { type: 'command', command: `/opt/jev-superpowers/hooks/${arg}` },
            { type: 'command', command: `echo USER-${arg}-KEEP` },
          ],
        }],
      },
    };
    writeClaudeSettings(dir, pre);
    try {
      const ri = run(['--tool', 'claude'], { cwd: dir });
      assert.equal(ri.status, 0, ri.stdout + ri.stderr);
      const group = JSON.parse(readText(settingsPath)).hooks[event][0];
      assert.equal(group.hooks.length, 2);
      assert.match(group.hooks[0].command, new RegExp('run-hook\\.cmd[\\\\/"]+ ' + arg));
      assert.equal(group.hooks[1].command, `echo USER-${arg}-KEEP`);

      const ru = run(['--uninstall', '--tool', 'claude'], { cwd: dir });
      assert.equal(ru.status, 0, ru.stdout + ru.stderr);
      const text = readText(settingsPath);
      assert.doesNotMatch(text, /run-hook/);
      assert.match(text, new RegExp(`echo USER-${arg}-KEEP`));
      const cfg = JSON.parse(text);
      assert.deepEqual(
        cfg.hooks[event],
        [{ hooks: [{ type: 'command', command: `echo USER-${arg}-KEEP` }] }],
      );
      for (const other of ['SessionStart', 'PreToolUse', 'Stop']) {
        if (other !== event) assert.ok(!cfg.hooks[other], `${other} 纯本包组应消失`);
      }
      // 混合组 1 + 另两事件追加的纯本包组 2
      assert.deepEqual(cutCountLines(ru.stdout + ru.stderr), [3]);
    } finally {
      rmFixture(dir);
    }
  });
}

test('I-1d：卸载后 restore 安装前备份 -> settings.json 回到安装前原样（备份确为安装前那份）', () => {
  const dir = mkFixture('jevzh-i1-restore-');
  const settingsPath = path.join(dir, '.claude', 'settings.json');
  const pre = {
    hooks: {
      PreToolUse: [{
        hooks: [
          { type: 'command', command: '/srv/jev-superpowers/hooks/pre-commit' },
          { type: 'command', command: 'echo USER-RESTORE-KEEP' },
        ],
      }],
    },
  };
  const originalText = `${JSON.stringify(pre, null, 2)}\n`;
  writeClaudeSettings(dir, pre);
  try {
    const ri = run(['--tool', 'claude'], { cwd: dir });
    assert.equal(ri.status, 0, ri.stdout + ri.stderr);
    const ts = listBackups(dir)[0];
    assert.ok(ts, '接管安装应产生安装前备份');
    // 安装后备份内容不再等于原文（竞品条目被改写）
    assert.match(readText(settingsPath), /run-hook/);

    const ru = run(['--uninstall', '--tool', 'claude'], { cwd: dir });
    assert.equal(ru.status, 0, ru.stdout + ru.stderr);
    assert.doesNotMatch(readText(settingsPath), /run-hook/);

    const rr = run(['restore', ts], { cwd: dir });
    assert.equal(rr.status, 0, rr.stdout + rr.stderr);
    const restored = readText(settingsPath);
    assert.equal(restored, originalText, 'restore 后必须与安装前字节一致');
    assert.match(restored, /jev-superpowers\/hooks\/pre-commit/, '安装前的竞品条目应随备份回来');
    assert.match(restored, /USER-RESTORE-KEEP/);
    assert.doesNotMatch(restored, /run-hook/);
  } finally {
    rmFixture(dir);
  }
});

test('I-1e：已卸载状态再次卸载幂等：文件字节不变、removed=0、不打印切除成功行', () => {
  const dir = mkFixture('jevzh-i1-idempotent-');
  const settingsPath = path.join(dir, '.claude', 'settings.json');
  const pre = {
    hooks: {
      PreToolUse: [{
        matcher: 'Bash',
        hooks: [
          { type: 'command', command: '/opt/jev-superpowers/hooks/pre-commit' },
          { type: 'command', command: 'echo USER-IDEMPOTENT-KEEP' },
        ],
      }],
    },
  };
  writeClaudeSettings(dir, pre);
  try {
    assert.equal(run(['--tool', 'claude'], { cwd: dir }).status, 0);
    const r1 = run(['--uninstall', '--tool', 'claude'], { cwd: dir });
    assert.equal(r1.status, 0, r1.stdout + r1.stderr);
    assert.deepEqual(cutCountLines(r1.stdout + r1.stderr), [3], '首次卸载应如实报告切除');
    const bytesAfterFirst = readText(settingsPath);
    assert.doesNotMatch(bytesAfterFirst, /run-hook/);

    const r2 = run(['--uninstall', '--tool', 'claude'], { cwd: dir });
    assert.equal(r2.status, 0, r2.stdout + r2.stderr);
    assert.equal(readText(settingsPath), bytesAfterFirst, '二次卸载必须字节不动');
    const out2 = r2.stdout + r2.stderr;
    assert.doesNotMatch(out2, /精确切除 \d+ 条/, '无本包条目时不得打印切除成功行');
    assert.doesNotMatch(out2, /含 \d+ 条本包接线/);
    assert.match(readText(settingsPath), /USER-IDEMPOTENT-KEEP/);
  } finally {
    rmFixture(dir);
  }
});

// ── R3：竞品条目事件归属以所在事件键为准（畸形配置不漏切） ──────────────────
test('R3：竞品 stop 脚本条目错挂 PreToolUse 键（畸形配置）：安装按所在键改写、卸载整文件清空', () => {
  const dir = mkFixture('jevzh-r3-wrong-key-');
  const settingsPath = path.join(dir, '.claude', 'settings.json');
  const pre = {
    hooks: {
      PreToolUse: [{
        matcher: 'Bash',
        hooks: [{ type: 'command', command: '/opt/jev-superpowers/hooks/stop' }],
      }],
    },
  };
  writeClaudeSettings(dir, pre);
  try {
    const ri = run(['--tool', 'claude'], { cwd: dir });
    assert.equal(ri.status, 0, ri.stdout + ri.stderr);
    const installed = JSON.parse(readText(settingsPath));
    const flat = JSON.stringify(installed.hooks.PreToolUse);
    // 处置口径：以条目所在事件键为权威改写成 pre-commit（不跨键迁移、不按脚本名猜成 stop）
    assert.match(flat, /run-hook\.cmd[\\/"]+ pre-commit/);
    assert.doesNotMatch(flat, /run-hook\.cmd[\\/"]+ stop/, '不得按内嵌脚本名反推成 stop 接线');
    assert.equal(installed.hooks.PreToolUse.length, 1);
    assert.equal(installed.hooks.PreToolUse[0].hooks.length, 1, '已接线不得重复追加第二组');

    const ru = run(['--uninstall', '--tool', 'claude'], { cwd: dir });
    assert.equal(ru.status, 0, ru.stdout + ru.stderr);
    assert.ok(!exists(settingsPath), '畸形键条目漏切：三键清空后纯本包 settings 文件应删除');
    assert.match(
      ru.stdout + ru.stderr,
      /删除已清空的 \.claude\/settings\.json（含 3 条本包接线）/,
    );
  } finally {
    rmFixture(dir);
  }
});

test('R3 兼容：旧安装器按字符串反推留下的畸形已装形态（PreToolUse 键内嵌 stop 启动器）卸载同样切净', () => {
  const dir = mkFixture('jevzh-r3-legacy-form-');
  const settingsPath = path.join(dir, '.claude', 'settings.json');
  const pre = {
    hooks: {
      PreToolUse: [{
        matcher: 'Bash',
        hooks: [
          { type: 'command', shell: 'bash', command: '"D:/legacy-home/.claude/hooks/run-hook.cmd" stop' },
          { type: 'command', command: 'echo LEGACY-MIXED-KEEP' },
        ],
      }],
    },
  };
  writeClaudeSettings(dir, pre);
  try {
    // 不重装，直接卸载：模拟用户磁盘上的旧安装产物
    const ru = run(['--uninstall', '--tool', 'claude'], { cwd: dir });
    assert.equal(ru.status, 0, ru.stdout + ru.stderr);
    const text = readText(settingsPath);
    JSON.parse(text);
    assert.doesNotMatch(text, /run-hook/, '内嵌脚本名与所在键不一致的旧条目也必须切除');
    assert.match(text, /LEGACY-MIXED-KEEP/);
    assert.deepEqual(
      JSON.parse(text).hooks.PreToolUse,
      [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo LEGACY-MIXED-KEEP' }] }],
    );
    assert.deepEqual(cutCountLines(ru.stdout + ru.stderr), [1]);
  } finally {
    rmFixture(dir);
  }
});

// ── R1：detect-only 文案按宿主实际启动器 ───────────────────────────────────
test('R1：--detect-only 按宿主实际接线报告启动器（claude=run-hook.cmd，cursor=run-hook.cjs），零写盘', () => {
  const dc = mkFixture('jevzh-r1-detect-claude-');
  try {
    writeClaudeSettings(dc, {
      hooks: {
        PreToolUse: [{ hooks: [{ type: 'command', command: '/opt/jev-superpowers/hooks/pre-commit' }] }],
      },
    });
    const r = run(['--tool', 'claude', '--detect-only'], { cwd: dc });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const out = r.stdout + r.stderr;
    assert.match(out, /检测到 jev-superpowers 旧 hooks 引用[^\n]*run-hook\.cmd/);
    assert.doesNotMatch(out, /改写为本包 run-hook\.cjs/);
    // detect-only 零写盘：竞品原条目原样保留
    assert.match(readText(path.join(dc, '.claude', 'settings.json')), /jev-superpowers\/hooks\/pre-commit/);
  } finally {
    rmFixture(dc);
  }

  const du = mkFixture('jevzh-r1-detect-cursor-');
  try {
    fs.mkdirSync(path.join(du, '.cursor'), { recursive: true });
    fs.writeFileSync(path.join(du, '.cursor', 'hooks.json'), `${JSON.stringify({
      version: 1,
      hooks: { preToolUse: [{ matcher: 'Bash', command: '/opt/jev-superpowers/hooks/pre-commit' }] },
    }, null, 2)}\n`);
    const r = run(['--tool', 'cursor', '--detect-only'], { cwd: du });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const out = r.stdout + r.stderr;
    assert.match(out, /检测到 jev-superpowers 旧 hooks 引用[^\n]*run-hook\.cjs/);
    assert.doesNotMatch(out, /改写为本包 run-hook\.cmd/);
    assert.match(readText(path.join(du, '.cursor', 'hooks.json')), /jev-superpowers\/hooks\/pre-commit/);
  } finally {
    rmFixture(du);
  }
});
