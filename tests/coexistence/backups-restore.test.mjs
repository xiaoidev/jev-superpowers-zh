// tests/coexistence/backups-restore.test.mjs — 用例 9 之备份/轮转/restore：
// 备份树结构与恢复元数据；5 次接管只留最新 3 份且内容完整；
// restore <ts> 字节还原关键文件（router/settings/adopt 技能）；
// restore --list / 无参数列清单；恢复前自动再备一份当前状态；离线、无网络依赖。
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  run, mkFixture, rmFixture, readText, exists, listFiles,
  listBackups, readBackupManifest,
} from './helpers.mjs';

test('备份结构：.jevzh/backups/<ts>/manifest.json 含恢复元数据，载荷含原始文件相对路径', () => {
  const dir = mkFixture('jevzh-bk-struct-');
  const original = `# p

<!-- superpowers-zh:begin (do not edit between these markers) -->
zh KEEP-BK-STRUCT
<!-- superpowers-zh:end -->
`;
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), original);
  fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify({ x: 1 }));
  try {
    const r = run(['--tool', 'claude'], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const ts = listBackups(dir)[0];
    assert.match(ts, /^\d{8}T\d{9}-[0-9a-f]+$/, `时间戳目录名形状不符: ${ts}`);
    const bkRoot = path.join(dir, '.jevzh', 'backups', ts);
    const files = listFiles(bkRoot);
    assert.ok(files.includes('manifest.json'));
    assert.ok(files.some((f) => f.startsWith('files/')), '应含文件载荷目录');

    const m = readBackupManifest(dir, ts);
    assert.equal(m.schema, 1);
    assert.equal(m.kind, 'install');
    assert.equal(m.pkg, 'jev-superpowers-zh');
    assert.equal(m.scope, 'project');
    assert.ok(m.targets.some((t) => t.target === 'Claude Code'));
    const entry = m.targets
      .flatMap((t) => t.entries)
      .find((e) => e.relPath.replace(/\\/g, '/') === 'CLAUDE.md');
    assert.ok(entry, 'manifest 缺少 CLAUDE.md 条目');
    assert.equal(entry.kind, 'file');
    assert.equal(entry.existed, true);
    assert.ok(typeof entry.payload === 'string' && entry.payload.length > 0);
  } finally {
    rmFixture(dir);
  }
});

test('轮转：连续 5 次接管只保留最新 3 份，被保留备份内容完整可恢复', () => {
  const dir = mkFixture('jevzh-bk-rotate-');
  try {
    for (let i = 1; i <= 5; i++) {
      fs.writeFileSync(
        path.join(dir, 'CLAUDE.md'),
        `# p\n\n<!-- superpowers-zh:begin (do not edit between these markers) -->\n版本 V${i} 内容 MARKER-V${i}\n<!-- superpowers-zh:end -->\n`,
      );
      const r = run(['--tool', 'claude'], { cwd: dir });
      assert.equal(r.status, 0, `第 ${i} 次安装失败: ${r.stdout}${r.stderr}`);
      // 等待时间戳递增（毫秒精度 + 随机后缀；同毫秒时再给一点时间）
      const bks = listBackups(dir);
      if (i <= 3) assert.equal(bks.length, i);
    }
    const backups = listBackups(dir);
    assert.deepEqual(backups.length, 3, `应只剩 3 份，实际 ${backups.length}`);
    // 最新三次对应 V5/V4/V3（旧 V1/V2 被清）
    const allFiles = listFiles(path.join(dir, '.jevzh', 'backups'));
    const joined = allFiles.map((f) => {
      try {
        return fs.readFileSync(path.join(dir, '.jevzh', 'backups', f), 'utf8');
      } catch { return ''; }
    }).join('\n');
    assert.match(joined, /MARKER-V5/);
    assert.match(joined, /MARKER-V4/);
    assert.match(joined, /MARKER-V3/);
    assert.doesNotMatch(joined, /MARKER-V1(?!\d)/);
    assert.doesNotMatch(joined, /MARKER-V2(?!\d)/);
    // 每份保留备份的 manifest 均可解析
    for (const ts of backups) {
      const m = readBackupManifest(dir, ts);
      assert.equal(m.pkg, 'jev-superpowers-zh');
      assert.ok(Array.isArray(m.targets));
    }
  } finally {
    rmFixture(dir);
  }
});

test('restore 往返：MIGRATE 后 restore <ts> 还原 CLAUDE.md 与 settings.json 字节', () => {
  const dir = mkFixture('jevzh-restore-roundtrip-');
  const routerOriginal = `# 我的项目

前文 KEEP-RT-1。

<!-- superpowers-zh:begin (do not edit between these markers) -->
# Superpowers-ZH 中文增强版

旧段 KEEP-RT-2。
<!-- superpowers-zh:end -->

后文 KEEP-RT-3。
`;
  const settingsOriginal = JSON.stringify(
    { myKey: 'KEEP-RT-SETTINGS', hooks: { Other: [{ command: 'echo keep' }] } },
    null,
    2,
  );
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), routerOriginal);
  fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), settingsOriginal);
  try {
    const r1 = run(['--tool', 'claude'], { cwd: dir });
    assert.equal(r1.status, 0, r1.stdout + r1.stderr);
    // 安装确实接管了
    assert.match(readText(path.join(dir, 'CLAUDE.md')), /jev-superpowers-zh:begin/);
    const settingsAfter = JSON.parse(readText(path.join(dir, '.claude', 'settings.json')));
    assert.match(JSON.stringify(settingsAfter.hooks), /run-hook/);
    const ts = listBackups(dir).find((t) => readBackupManifest(dir, t).kind === 'install');
    assert.ok(ts);

    // 清单
    const ls = run(['restore', '--list'], { cwd: dir });
    assert.equal(ls.status, 0, ls.stderr);
    assert.ok(ls.stdout.includes(ts));
    const ls2 = run(['restore'], { cwd: dir });
    assert.equal(ls2.status, 0);
    assert.ok(ls2.stdout.includes(ts));

    // 恢复
    const r2 = run(['restore', ts], { cwd: dir });
    assert.equal(r2.status, 0, r2.stdout + r2.stderr);
    assert.equal(readText(path.join(dir, 'CLAUDE.md')), routerOriginal.replace(/\r?\n/g, '\n'));
    assert.equal(readText(path.join(dir, '.claude', 'settings.json')), settingsOriginal);
    assert.ok(!readText(path.join(dir, 'CLAUDE.md')).includes('jev-superpowers-zh'));

    // 恢复前自动再备了一份当前状态
    const latest = listBackups(dir).at(-1);
    assert.equal(readBackupManifest(dir, latest).kind, 'pre-restore');

    // 未知时间戳 exit 1（不恢复、不报错退出 0）
    const r3 = run(['restore', '19990101T000000000-deadbeef'], { cwd: dir });
    assert.equal(r3.status, 1);
  } finally {
    rmFixture(dir);
  }
});

test('restore：--adopt-skills 被替代的技能目录随恢复回到原始内容', () => {
  const dir = mkFixture('jevzh-restore-adopt-');
  const zhSkill = path.join(dir, '.claude', 'skills', 'brainstorming');
  fs.mkdirSync(zhSkill, { recursive: true });
  fs.writeFileSync(
    path.join(zhSkill, 'SKILL.md'),
    '---\nname: brainstorming\n---\n本节是 superpowers-zh 的增量内容 KEEP-ADOPT-RESTORE\n',
  );
  try {
    const r1 = run(['--tool', 'claude', '--adopt-skills'], { cwd: dir });
    assert.equal(r1.status, 0, r1.stdout + r1.stderr);
    assert.match(readText(path.join(zhSkill, 'SKILL.md')), /jev-superpowers-zh|头脑/);
    assert.ok(exists(path.join(zhSkill, '.jevzh-meta.json')));

    const ts = listBackups(dir).find((t) => readBackupManifest(dir, t).kind === 'install');
    const r2 = run(['restore', ts], { cwd: dir });
    assert.equal(r2.status, 0, r2.stdout + r2.stderr);
    assert.match(readText(path.join(zhSkill, 'SKILL.md')), /KEEP-ADOPT-RESTORE/);
    assert.ok(!exists(path.join(zhSkill, '.jevzh-meta.json')), '恢复后本包 meta 应消失');
  } finally {
    rmFixture(dir);
  }
});

test('restore 离线：不触发就绪探测/网络（输出不含就绪报告）', () => {
  const dir = mkFixture('jevzh-restore-offline-');
  fs.writeFileSync(
    path.join(dir, 'CLAUDE.md'),
    '<!-- superpowers-zh:begin (do not edit between these markers) -->\nx\n<!-- superpowers-zh:end -->\n',
  );
  try {
    run(['--tool', 'claude'], { cwd: dir });
    const ts = listBackups(dir)[0];
    const r = run(['restore', ts], { cwd: dir });
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stdout, /门禁就绪检测/);
  } finally {
    rmFixture(dir);
  }
});
