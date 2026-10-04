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
    assert.match(all, /run-hook\.cmd session-start/);
    assert.match(all, /run-hook\.cmd pre-commit/);
    assert.match(all, /run-hook\.cmd stop/);
    assert.ok(Array.isArray(cfg.hooks.sessionStart));
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
