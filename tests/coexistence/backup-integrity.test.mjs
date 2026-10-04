// tests/coexistence/backup-integrity.test.mjs — I-2：备份载荷完整性（sha256/size/files）
// restore 必须先预演只读校验，失败即 rc=1 中止：活文件零触碰、不建 pre-restore 备份；
// 同尺寸篡改也要靠 sha256 拦住；载荷缺失拦住；旧版无哈希 manifest 走弱校验（明确 WARN），
// .json 目标坏内容仍拦得住；新备份 manifest 携带指纹。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  run, mkFixture, rmFixture, readText,
  listBackups, readBackupManifest,
} from './helpers.mjs';

const sha256 = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

const ROUTER_ORIGINAL = `# 我的项目

前文 KEEP-BI-PRE。

<!-- superpowers-zh:begin (do not edit between these markers) -->
# Superpowers-ZH 中文增强版

旧段 KEEP-BI-OLD。
<!-- superpowers-zh:end -->

后文 KEEP-BI-TAIL。
`;
const SETTINGS_ORIGINAL = JSON.stringify(
  { myKey: 'KEEP-BI-SETTINGS', hooks: { Other: [{ command: 'echo keep-bi' }] } },
  null,
  2,
);

function installClaudeWithBackup() {
  const dir = mkFixture('jevzh-bi-');
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), ROUTER_ORIGINAL);
  fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), SETTINGS_ORIGINAL);
  const inst = run(['--tool', 'claude'], { cwd: dir });
  assert.equal(inst.status, 0, inst.stdout + inst.stderr);
  const ts = listBackups(dir).find((t) => readBackupManifest(dir, t).kind === 'install');
  assert.ok(ts);
  return { dir, ts };
}

function allEntries(dir, ts) {
  return readBackupManifest(dir, ts).targets.flatMap((t) => t.entries);
}

function entryFor(dir, ts, rel) {
  const want = rel.replace(/\\/g, '/');
  const e = allEntries(dir, ts).find((x) => x.relPath.replace(/\\/g, '/') === want);
  assert.ok(e, `manifest 缺少条目 ${rel}`);
  return e;
}

function payloadPath(dir, ts, e) {
  return path.join(dir, '.jevzh', 'backups', ts, e.payload);
}

function liveHashes(dir) {
  return {
    claude: sha256(path.join(dir, 'CLAUDE.md')),
    settings: sha256(path.join(dir, '.claude', 'settings.json')),
  };
}

// 把 manifest 所有 file 条目的指纹字段按策略抹掉，模拟旧版备份。
function stripFingerprints(dir, ts, { size: stripSize }) {
  const mPath = path.join(dir, '.jevzh', 'backups', ts, 'manifest.json');
  const m = JSON.parse(readText(mPath));
  for (const t of m.targets) {
    for (const e of t.entries) {
      delete e.sha256;
      if (stripSize) delete e.size;
    }
  }
  fs.writeFileSync(mPath, JSON.stringify(m, null, 2));
}

test('I-2 结构：新备份 file 条目携带 size + sha256，与落盘载荷实际指纹一致', () => {
  const { dir, ts } = installClaudeWithBackup();
  try {
    for (const rel of ['CLAUDE.md', path.join('.claude', 'settings.json')]) {
      const e = entryFor(dir, ts, rel);
      assert.equal(e.kind, 'file');
      assert.equal(typeof e.size, 'number', `${rel} 缺 size`);
      assert.match(e.sha256 ?? '', /^[0-9a-f]{64}$/, `${rel} 缺 sha256`);
      const p = payloadPath(dir, ts, e);
      assert.equal(fs.statSync(p).size, e.size);
      assert.equal(sha256(p), e.sha256);
    }
  } finally {
    rmFixture(dir);
  }
});

test('I-2 a：载荷被截断（size 不符）-> rc1 中止，活文件 sha 不变、无 pre-restore 备份', () => {
  const { dir, ts } = installClaudeWithBackup();
  try {
    const e = entryFor(dir, ts, 'CLAUDE.md');
    const p = payloadPath(dir, ts, e);
    fs.writeFileSync(p, fs.readFileSync(p).subarray(0, 5));
    const before = liveHashes(dir);
    const backupsBefore = listBackups(dir);

    const r = run(['restore', ts], { cwd: dir });
    assert.equal(r.status, 1);
    const out = r.stdout + r.stderr;
    assert.match(out, /备份完整性校验失败/);
    assert.match(out, /CLAUDE\.md/); // 首个不符项必须带 relPath（不得打印 undefined）
    assert.match(out, /载荷大小不匹配|载荷 sha256 不匹配/);
    assert.match(out, /未删除\/覆盖任何活文件/);

    assert.deepEqual(liveHashes(dir), before);
    assert.deepEqual(listBackups(dir), backupsBefore, '校验失败不得新建 pre-restore 备份');
  } finally {
    rmFixture(dir);
  }
});

test('I-2 b：同尺寸篡改（size 不变）-> sha256 拦住，rc1 且活文件零触碰', () => {
  const { dir, ts } = installClaudeWithBackup();
  try {
    const e = entryFor(dir, ts, path.join('.claude', 'settings.json'));
    const p = payloadPath(dir, ts, e);
    const orig = fs.readFileSync(p, 'utf8');
    // 等长替换：myKey -> myKxy，字节数不变，纯 size 校验无法发现，只有哈希能拦
    assert.match(orig, /myKey/);
    fs.writeFileSync(p, orig.replace('myKey', 'myKxy'));
    assert.equal(fs.statSync(p).size, e.size);
    const before = liveHashes(dir);
    const backupsBefore = listBackups(dir);

    const r = run(['restore', ts], { cwd: dir });
    assert.equal(r.status, 1);
    assert.match(r.stdout + r.stderr, /settings\.json/);
    assert.match(r.stdout + r.stderr, /载荷 sha256 不匹配/);
    assert.deepEqual(liveHashes(dir), before);
    assert.deepEqual(listBackups(dir), backupsBefore);
  } finally {
    rmFixture(dir);
  }
});

test('I-2 c：载荷文件缺失 -> rc1，活文件零触碰、无 pre-restore 备份', () => {
  const { dir, ts } = installClaudeWithBackup();
  try {
    const e = entryFor(dir, ts, 'CLAUDE.md');
    fs.rmSync(payloadPath(dir, ts, e), { force: true });
    const before = liveHashes(dir);
    const backupsBefore = listBackups(dir);

    const r = run(['restore', ts], { cwd: dir });
    assert.equal(r.status, 1);
    assert.match(r.stdout + r.stderr, /备份完整性校验失败/);
    assert.match(r.stdout + r.stderr, /CLAUDE\.md/);
    assert.match(r.stdout + r.stderr, /载荷不存在/);
    assert.deepEqual(liveHashes(dir), before);
    assert.deepEqual(listBackups(dir), backupsBefore);
  } finally {
    rmFixture(dir);
  }
});

test('I-2 d1：legacy 备份（无 sha256/size）且 .json 载荷损坏 -> 弱校验 WARN + rc1，活文件不动', () => {
  const { dir, ts } = installClaudeWithBackup();
  try {
    stripFingerprints(dir, ts, { size: true });
    const e = entryFor(dir, ts, path.join('.claude', 'settings.json'));
    fs.writeFileSync(payloadPath(dir, ts, e), '{bad');
    const before = liveHashes(dir);
    const backupsBefore = listBackups(dir);

    const r = run(['restore', ts], { cwd: dir });
    assert.equal(r.status, 1);
    const out = r.stdout + r.stderr;
    assert.match(out, /旧备份无完整性哈希/);
    assert.match(out, /弱校验/);
    assert.match(out, /备份完整性校验失败/);
    assert.match(out, /settings\.json/);
    assert.match(out, /JSON 目标无法解析/);
    assert.deepEqual(liveHashes(dir), before);
    assert.deepEqual(listBackups(dir), backupsBefore);
  } finally {
    rmFixture(dir);
  }
});

test('I-2 d2：完好 legacy 备份（仅缺 sha256）-> 弱校验 WARN + rc0，字节还原成功并复核', () => {
  const { dir, ts } = installClaudeWithBackup();
  try {
    stripFingerprints(dir, ts, { size: false });

    const r = run(['restore', ts], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const out = r.stdout + r.stderr;
    assert.match(out, /旧备份无完整性哈希/);
    assert.match(out, /写后完整性复核通过/);
    assert.equal(readText(path.join(dir, 'CLAUDE.md')), ROUTER_ORIGINAL.replace(/\r?\n/g, '\n'));
    assert.equal(readText(path.join(dir, '.claude', 'settings.json')), SETTINGS_ORIGINAL);
    // 成功路径才创建 pre-restore 安全网
    const latest = listBackups(dir).at(-1);
    assert.equal(readBackupManifest(dir, latest).kind, 'pre-restore');
  } finally {
    rmFixture(dir);
  }
});
