// tests/coexistence/restore-hardening.test.mjs — 任务 7 复验残留 R-2a/b/c：
// R-2a：dir 类备份载荷必须与 manifest files 精确一致——多余文件、缺失文件、
//       载荷内符号链接/junction（copyDirSync 会解引用，可把备份目录外内容带入
//       恢复目标）一律预演 rc=1，删除任何活文件之前整体中止、中文报告首个违规；
// R-2b：载荷不可读（EPERM/独占占用）时按 restore 口径报错（含路径/原因/
//       「未删除/覆盖任何活文件」/检查备份权限建议），不再兜底成「安装失败」；
// R-2c：恢复写入阶段异常（如目标只读 EPERM）-> rc=1、报失败条目与 pre-restore
//       safetyTs 回退点、如实说明目录恢复非原子；按提示 restore <safetyTs> 可
//       端到端回到恢复前状态。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  run, mkFixture, rmFixture, readText,
  listBackups, readBackupManifest,
} from './helpers.mjs';
import { makeDirLinkOrSkip, unlinkQuiet, BIN } from '../installer/helpers.mjs';
import { pathToFileURL } from 'node:url';

const { verifyRestoredEntries } = await import(pathToFileURL(BIN).href);

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// --adopt-skills 接管同名技能目录：产生真实的 dir 类备份（dirs/000N 载荷）。
function adoptInstallWithDirBackup() {
  const dir = mkFixture('jevzh-r2h-dir-');
  const skillDir = path.join(dir, '.claude', 'skills', 'brainstorming');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    '---\nname: brainstorming\n---\nKEEP-R2H-SKILL 接管前的原始技能内容\n',
  );
  const inst = run(['--tool', 'claude', '--adopt-skills'], { cwd: dir });
  assert.equal(inst.status, 0, inst.stdout + inst.stderr);
  const ts = listBackups(dir).find((t) => readBackupManifest(dir, t).kind === 'install');
  assert.ok(ts);
  const entry = readBackupManifest(dir, ts).targets
    .flatMap((g) => g.entries)
    .find((e) => e.kind === 'dir');
  assert.ok(entry, 'adopt 安装应产生 dir 类备份条目');
  return {
    dir,
    ts,
    entry,
    payloadDir: path.join(dir, '.jevzh', 'backups', ts, entry.payload),
    liveSkill: path.join(skillDir, 'SKILL.md'),
  };
}

test('R-2a ①：dir 载荷多一个 manifest 未声明的文件 -> rc1 零触碰，报错带路径与类型', () => {
  const ctx = adoptInstallWithDirBackup();
  const { dir, ts, payloadDir, liveSkill } = ctx;
  try {
    const liveBefore = fs.readFileSync(liveSkill, 'utf8');
    const backupsBefore = listBackups(dir);
    fs.writeFileSync(path.join(payloadDir, 'evil-extra.txt'), 'TAMPERED EXTRA FILE');

    const r = run(['restore', ts], { cwd: dir });
    assert.equal(r.status, 1);
    const out = r.stdout + r.stderr;
    assert.match(out, /备份完整性校验失败/);
    assert.match(out, /目录载荷与 manifest 清单不精确一致/);
    assert.match(out, /evil-extra\.txt/); // 首个违规路径
    assert.match(out, /多余文件/); // 违规类型
    assert.match(out, /未删除\/覆盖任何活文件/);

    assert.equal(fs.readFileSync(liveSkill, 'utf8'), liveBefore, '活技能文件被触碰');
    assert.deepEqual(listBackups(dir), backupsBefore, '不得新建 pre-restore 备份');
  } finally {
    rmFixture(dir);
  }
});

test('R-2a ②：dir 载荷内造符号链接/junction 指向备份外目录 -> rc1 零触碰', (t) => {
  const ctx = adoptInstallWithDirBackup();
  const { dir, ts, payloadDir, liveSkill } = ctx;
  const outside = mkFixture('jevzh-r2h-out-');
  const linkPath = path.join(payloadDir, 'evil-link');
  try {
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'OUT-OF-BACKUP-SECRET');
    // Windows junction / POSIX dir 型符号链接；当前环境造不出链接则 skip（不假过）。
    if (!makeDirLinkOrSkip(t, outside, linkPath)) return;

    const liveBefore = fs.readFileSync(liveSkill, 'utf8');
    const backupsBefore = listBackups(dir);

    const r = run(['restore', ts], { cwd: dir });
    assert.equal(r.status, 1);
    const out = r.stdout + r.stderr;
    assert.match(out, /备份完整性校验失败/);
    assert.match(out, /evil-link/);
    assert.match(out, /符号链接\/junction/);
    assert.match(out, /未删除\/覆盖任何活文件/);

    assert.equal(fs.readFileSync(liveSkill, 'utf8'), liveBefore, '活技能文件被触碰');
    assert.deepEqual(listBackups(dir), backupsBefore);
    // 载荷外内容绝不能被解引用带进恢复目标
    const liveWalk = [];
    const walk = (d) => {
      for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, ent.name);
        if (ent.isDirectory()) walk(p);
        else liveWalk.push(fs.readFileSync(p, 'utf8'));
      }
    };
    walk(path.join(dir, '.claude', 'skills'));
    assert.ok(!liveWalk.some((s) => s.includes('OUT-OF-BACKUP-SECRET')), '链接目标内容被带进恢复目标');
  } finally {
    unlinkQuiet(linkPath); // 只摘链接本身，绝不触及链接目标
    rmFixture(dir);
    rmFixture(outside);
  }
});

test('R-2a ③：正常 dir 备份恢复仍成功（精确比对不回归正常备份）', () => {
  const ctx = adoptInstallWithDirBackup();
  const { dir, ts, liveSkill } = ctx;
  try {
    assert.match(fs.readFileSync(liveSkill, 'utf8'), /jev-superpowers-zh|头脑/);
    const r = run(['restore', ts], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /写后完整性复核通过/);
    assert.match(readText(liveSkill), /KEEP-R2H-SKILL/);
    assert.ok(!fs.existsSync(path.join(path.dirname(liveSkill), '.jevzh-meta.json')), '恢复后本包 meta 应消失');
  } finally {
    rmFixture(dir);
  }
});

// 安装一个带 router + settings 接管备份的最小 claude 项目。
function installClaudeProject(prefix) {
  const dir = mkFixture(prefix);
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'CLAUDE.md'),
    '# p\n\n<!-- superpowers-zh:begin (do not edit between these markers) -->\n'
      + '原始路由内容 KEEP-R2H-ROUTER\n<!-- superpowers-zh:end -->\n',
  );
  fs.writeFileSync(
    path.join(dir, '.claude', 'settings.json'),
    JSON.stringify({ myKey: 'KEEP-R2H-SETTINGS' }, null, 2),
  );
  const inst = run(['--tool', 'claude'], { cwd: dir });
  assert.equal(inst.status, 0, inst.stdout + inst.stderr);
  const ts = listBackups(dir).find((t) => readBackupManifest(dir, t).kind === 'install');
  assert.ok(ts);
  const entry = readBackupManifest(dir, ts).targets
    .flatMap((g) => g.entries)
    .find((e) => e.relPath === 'CLAUDE.md');
  const payload = path.join(dir, '.jevzh', 'backups', ts, entry.payload);
  return { dir, ts, payload };
}

test('R-2b：载荷不可读（Windows 独占占用 / POSIX chmod 000）-> restore 口径报错 rc1 零触碰', async (t) => {
  const { dir, ts, payload } = installClaudeProject('jevzh-r2h-b-');
  const liveClaude = path.join(dir, 'CLAUDE.md');
  let locker = null;
  let posixDenied = false;
  try {
    if (process.platform === 'win32') {
      // 不用 icacls 拒读（管理员身份可能绕过）：用 PowerShell 以 FileShare.None
      // 独占打开载荷文件，其他进程 open 必共享冲突（EBUSY/EPERM），手法稳定且
      // 与具体用户权限无关。
      locker = spawn(
        'powershell.exe',
        ['-NoProfile', '-Command',
          `$ErrorActionPreference='Stop'; $fs=[System.IO.File]::Open('${payload.replace(/'/g, "''")}', 'Open', 'Read', 'None'); Start-Sleep -Seconds 60`],
        { stdio: 'ignore' },
      );
      // 等独占锁真正生效（本进程自己读失败才算数）。
      const deadline = Date.now() + 8000;
      let locked = false;
      while (Date.now() < deadline) {
        try { fs.readFileSync(payload); sleep(120); } catch { locked = true; break; }
      }
      if (!locked) {
        locker.kill();
        locker = null;
        t.skip('PowerShell 独占占用未生效（可能无 powershell 或被策略限制），跳过');
        return;
      }
    } else {
      fs.chmodSync(payload, 0o000);
      try {
        fs.readFileSync(payload);
        t.skip('当前身份（root？）可绕过 chmod 000 拒读，跳过');
        return;
      } catch {
        posixDenied = true;
      }
    }

    const liveBefore = fs.readFileSync(liveClaude, 'utf8');
    const backupsBefore = listBackups(dir);
    const r = run(['restore', ts], { cwd: dir });
    assert.equal(r.status, 1);
    const out = r.stdout + r.stderr;
    assert.match(out, /恢复预演失败/);
    assert.match(out, new RegExp(ts.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))); // 含备份路径/时间戳
    assert.match(out, /原因：/); // 含原因（EBUSY/EPERM/EACCES…）
    assert.match(out, /未删除\/覆盖任何活文件/);
    assert.match(out, /读取权限|独占占用/); // 建议方向
    assert.doesNotMatch(out, /安装失败/); // 不得再走 main 兜底口径

    assert.equal(fs.readFileSync(liveClaude, 'utf8'), liveBefore, '活文件被触碰');
    assert.deepEqual(listBackups(dir), backupsBefore, '不得新建 pre-restore 备份');
  } finally {
    if (locker) {
      try { locker.kill(); } catch { /* 进程可能已退出 */ }
    }
    if (posixDenied) {
      try { fs.chmodSync(payload, 0o644); } catch { /* 忽略 */ }
    }
    rmFixture(dir);
  }
});

test('R-2c：目标只读致恢复写入 EPERM -> rc1 报 safetyTs/部分恢复，按提示 restore <safetyTs> 端到端回退', (t) => {
  const { dir, ts } = installClaudeProject('jevzh-r2h-c-');
  const liveClaude = path.join(dir, 'CLAUDE.md');
  const liveSettings = path.join(dir, '.claude', 'settings.json');
  try {
    // 恢复前（=安装后）状态：回退成功后必须精确回到这里。
    const installedClaude = fs.readFileSync(liveClaude, 'utf8');
    const installedSettings = fs.readFileSync(liveSettings, 'utf8');
    assert.match(installedClaude, /jev-superpowers-zh:begin/);

    // Windows：只读属性让 rename 覆盖目标文件抛 EPERM；
    // POSIX：rename 只看目录写权限、文件只读位拦不住——触发不了就 skip（注释说明）。
    fs.chmodSync(liveClaude, 0o444);
    const r = run(['restore', ts], { cwd: dir });
    if (r.status === 0 && process.platform !== 'win32') {
      fs.chmodSync(liveClaude, 0o644);
      t.skip('POSIX 下目录可写即可 rename 覆盖只读文件，只读位无法触发写入失败，跳过');
      return;
    }
    assert.equal(r.status, 1, r.stdout + r.stderr);
    const out = r.stdout + r.stderr;
    assert.match(out, /恢复写入失败/);
    assert.match(out, /CLAUDE\.md/); // 失败条目
    assert.match(out, /部分恢复/);
    assert.match(out, /非原子/); // 如实说明 dir 恢复 rm+copy 非原子

    // 报错必须给出可直接复制的回退命令，指向 pre-restore safetyTs。
    const safetyTs = listBackups(dir)
      .find((x) => readBackupManifest(dir, x).kind === 'pre-restore');
    assert.ok(safetyTs, '失败前应已完成 pre-restore 安全网备份');
    assert.ok(out.includes(`npx jevzh restore ${safetyTs}`), `输出缺少回退命令:\n${out}`);

    // 原子写失败不留 *.tmp 半成品
    assert.ok(
      fs.readdirSync(dir).every((n) => !/\.tmp$/.test(n)),
      '目标目录残留 *.tmp',
    );

    // 用户修好权限问题后，严格按报错提示回退：端到端回到恢复前（安装后）状态。
    fs.chmodSync(liveClaude, 0o644);
    const rb = run(['restore', safetyTs], { cwd: dir });
    assert.equal(rb.status, 0, rb.stdout + rb.stderr);
    assert.match(rb.stdout + rb.stderr, /写后完整性复核通过/);
    assert.equal(fs.readFileSync(liveClaude, 'utf8'), installedClaude);
    assert.equal(fs.readFileSync(liveSettings, 'utf8'), installedSettings);
    assert.match(fs.readFileSync(liveClaude, 'utf8'), /jev-superpowers-zh:begin/);
  } finally {
    try { fs.chmodSync(liveClaude, 0o644); } catch { /* 夹具清理前尽量复位 */ }
    rmFixture(dir);
  }
});

// R-2d：写后复核（verifyRestoredEntries）真正跑起来且失败时，报告必须带具体
// relPath 与中文原因，绝不能是 `…复核失败：undefined undefined`。触发方式：
// 恢复目标（dir 条目）在恢复时是符号链接/junction——写入阶段防穿越【主动跳过】
// 该条目（写入循环整体成功结束），写后复核 lstat 发现它仍不是正常目录
//（Windows junction 计入目录但内部文件全缺；POSIX dir 链接 lstat 不是目录），
// 于是失败。这是「写入成功但复核不符」路径，现有 R-2a/b/c 只覆盖预演中止与
// 写入异常。Windows 用 junction（无需特权），POSIX 用 dir 型符号链接。
test('R-2d：恢复目标为 junction/链接被防穿越跳过后写后复核失败 -> rc1 报具体路径而非 undefined，给回退点', (t) => {
  const ctx = adoptInstallWithDirBackup();
  const { dir, ts, entry } = ctx;
  // 注意：ctx.liveSkill 是目录内 SKILL.md 的路径；junction 必须建在【技能目录本
  // 身】（manifest dir 条目的 abs），写循环的防穿越判定才会命中。
  const liveSkillDir = path.dirname(ctx.liveSkill);
  const outside = mkFixture('jevzh-r2h-d-out-');
  try {
    // 用空目录做链接目标：junction 存活时复核必然发现 manifest files 全缺。
    fs.rmSync(liveSkillDir, { recursive: true, force: true }); // Node 只摘 junction 不删目标内容
    if (!makeDirLinkOrSkip(t, outside, liveSkillDir)) return;

    const r = run(['restore', ts], { cwd: dir });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    const out = r.stdout + r.stderr;
    assert.match(out, /恢复后完整性复核失败/);
    assert.ok(out.includes(entry.relPath), `输出缺少条目路径 ${entry.relPath}:\n${out}`);
    assert.match(out, /恢复后目录不完整|恢复后目标不是目录/); // 具体中文原因
    assert.doesNotMatch(out, /undefined/); // R-2 回归红线：键名必须统一 relPath

    // 给出 pre-restore 回退点（该备份确实已建）。
    const safetyTs = listBackups(dir)
      .find((x) => readBackupManifest(dir, x).kind === 'pre-restore');
    assert.ok(safetyTs, '失败前应已完成 pre-restore 安全网备份');
    assert.ok(out.includes(`npx jevzh restore ${safetyTs}`), `输出缺少回退命令:\n${out}`);

    // 防穿越：链接本身保留、链接目标未被解引用写入。
    assert.ok(fs.lstatSync(liveSkillDir).isSymbolicLink(), 'junction/链接应原样保留');
    assert.deepEqual(fs.readdirSync(outside), [], '链接目标被解引用写入');
  } finally {
    unlinkQuiet(liveSkillDir);
    rmFixture(dir);
    rmFixture(outside);
  }
});

test('R-2d 单元：verifyRestoredEntries 失败对象键名统一为 relPath（不存在的恢复目标）', () => {
  const failures = verifyRestoredEntries(
    () => path.join(os.tmpdir(), `jevzh-r2h-unit-nonexistent-${process.pid}-R2D-MISSING-MARKER.txt`),
    [{
      existed: true,
      kind: 'file',
      relPath: 'R2D-MISSING-MARKER.txt',
      payload: 'files/0001',
      sha256: 'a'.repeat(64),
      size: 1,
    }],
  );
  assert.equal(failures.length, 1);
  assert.equal(failures[0].relPath, 'R2D-MISSING-MARKER.txt');
  assert.ok(!Object.prototype.hasOwnProperty.call(failures[0], 'rel'), '残留旧键名 rel');
  assert.match(failures[0].reason, /恢复后目标不存在/);
});
