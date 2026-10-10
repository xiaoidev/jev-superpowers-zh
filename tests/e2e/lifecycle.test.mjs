// tests/e2e/lifecycle.test.mjs — 跨宿主端到端生命周期矩阵（DoD §11-3 取证）
//
// claude / cursor / trae 三个项目级宿主，真实子进程跑安装器完整生命周期：
//   安装（27 技能 + 宿主能力产物 + 预置用户内容保留）
//   → 二次安装幂等（整树指纹稳定、备份不新增）
//   → doctor --tool（rc=0 健康）
//   → 卸载（本包 27 技能/hooks/scripts/接线/哨兵全清；.jevzh.json 保留；用户内容保留）
//   → restore <ts>（安装前备份可把接管文件还原到安装前字节）
//
// 与既有单测的分工：tests/installer/* 与 tests/coexistence/* 逐点断言每个机制；
// 本文件只做「跨阶段串点」，不重复机制内部用例。
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  run, mkFixture, rmFixture, readText, exists, listFiles, hashTree, ALL_SKILLS,
} from '../installer/helpers.mjs';
import { listBackups } from '../coexistence/helpers.mjs';

const GATE_SCRIPTS = ['jev-readiness', 'jev-gate', 'serve-laya.py'];
const HOOK_RUNTIME = ['hooks.json', 'hooks-cursor.json', 'session-start', 'pre-commit', 'stop', 'run-hook.cmd', 'run-hook.cjs'];

function skillDirs(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

function writeUserSkill(skillsDir) {
  const d = path.join(skillsDir, 'user-keep-skill');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'SKILL.md'), '---\nname: user-keep-skill\n---\n用户自有技能 USER-SKILL-KEEP\n');
}

// 每宿主的安装布局与预置用户内容
const HOSTS = {
  claude: {
    alias: 'claude',
    skillsRel: '.claude/skills',
    hooksRel: '.claude/hooks',
    scriptsRel: '.claude/scripts',
    wiredSettings: ['.claude/settings.json'],
    prepare(dir) {
      fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# 我的项目\n\nUSER-CLAUDE-KEEP\n');
      fs.writeFileSync(
        path.join(dir, '.claude', 'settings.json'),
        `${JSON.stringify({
          permissions: { allow: ['USER-PERMISSION-KEEP'] },
          hooks: {
            UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'echo USER-HOOK-KEEP' }] }],
          },
        }, null, 2)}\n`,
      );
      writeUserSkill(path.join(dir, '.claude', 'skills'));
    },
    verifyUserStateAfterInstall(dir) {
      const md = readText(path.join(dir, 'CLAUDE.md'));
      assert.match(md, /USER-CLAUDE-KEEP/, '用户 CLAUDE.md 内容被吞');
      assert.match(md, /<!-- jev-superpowers-zh:begin/, '本包哨兵缺失');
      const cfg = JSON.parse(readText(path.join(dir, '.claude', 'settings.json')));
      assert.equal(cfg.permissions.allow[0], 'USER-PERMISSION-KEEP');
      assert.match(JSON.stringify(cfg.hooks), /USER-HOOK-KEEP/);
      assert.match(JSON.stringify(cfg.hooks), /run-hook\.cmd["\\/]+ session-start/);
      assert.match(JSON.stringify(cfg.hooks), /run-hook\.cmd["\\/]+ pre-commit/);
      assert.match(JSON.stringify(cfg.hooks), /run-hook\.cmd["\\/]+ stop/);
    },
    verifyUserStateAfterUninstall(dir) {
      const md = readText(path.join(dir, 'CLAUDE.md'));
      assert.match(md, /USER-CLAUDE-KEEP/);
      assert.doesNotMatch(md, /jev-superpowers-zh:begin/);
      // 卸载精确切除本包接线：用户条目保留、未知键保留、run-hook 全清
      const cfg = JSON.parse(readText(path.join(dir, '.claude', 'settings.json')));
      assert.equal(cfg.permissions.allow[0], 'USER-PERMISSION-KEEP');
      assert.match(JSON.stringify(cfg.hooks), /USER-HOOK-KEEP/);
      assert.doesNotMatch(JSON.stringify(cfg), /run-hook/);
      assert.ok(!cfg.hooks.SessionStart && !cfg.hooks.PreToolUse && !cfg.hooks.Stop,
        '本包三个事件组应被整组切除');
    },
    restoreRels: ['CLAUDE.md', '.claude/settings.json'],
  },

  cursor: {
    alias: 'cursor',
    skillsRel: '.cursor/skills',
    hooksRel: '.cursor/hooks',
    scriptsRel: '.cursor/scripts',
    wiredSettings: ['.cursor/hooks.json'],
    prepare(dir) {
      fs.mkdirSync(path.join(dir, '.cursor'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, '.cursor', 'hooks.json'),
        `${JSON.stringify({
          version: 1,
          hooks: { sessionStart: [{ command: 'echo USER-CURSOR-HOOK-KEEP' }] },
        }, null, 2)}\n`,
      );
      writeUserSkill(path.join(dir, '.cursor', 'skills'));
    },
    verifyUserStateAfterInstall(dir) {
      const cfg = JSON.parse(readText(path.join(dir, '.cursor', 'hooks.json')));
      const flat = JSON.stringify(cfg.hooks);
      assert.match(flat, /USER-CURSOR-HOOK-KEEP/);
      // R-3：项目根相对 + node 启动器（宿主在项目根直生）
      assert.match(flat, /node \.cursor\/hooks\/run-hook\.cjs session-start/);
      assert.match(flat, /node \.cursor\/hooks\/run-hook\.cjs pre-commit/);
      assert.match(flat, /node \.cursor\/hooks\/run-hook\.cjs stop/);
      assert.doesNotMatch(flat, /\.\/hooks\/run-hook\.cmd/);
    },
    verifyUserStateAfterUninstall(dir) {
      const cfg = JSON.parse(readText(path.join(dir, '.cursor', 'hooks.json')));
      assert.equal(cfg.version, 1);
      assert.deepEqual(cfg.hooks.sessionStart, [{ command: 'echo USER-CURSOR-HOOK-KEEP' }]);
      assert.doesNotMatch(JSON.stringify(cfg), /run-hook/);
      assert.ok(!cfg.hooks.preToolUse && !cfg.hooks.stop, '本包事件应被切除');
    },
    restoreRels: ['.cursor/hooks.json'],
  },

  trae: {
    alias: 'trae',
    skillsRel: '.trae/skills',
    ruleRel: '.trae/rules/jevzh.md',
    prepare(dir) {
      fs.mkdirSync(path.join(dir, '.trae', 'rules'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.trae', 'rules', 'user-rule.md'), '# 用户规则 USER-TRAE-RULE-KEEP\n');
      writeUserSkill(path.join(dir, '.trae', 'skills'));
    },
    verifyUserStateAfterInstall(dir) {
      assert.ok(exists(path.join(dir, '.trae', 'rules', 'jevzh.md')), 'Trae 独立引导规则缺失');
      assert.equal(readText(path.join(dir, '.trae', 'rules', 'user-rule.md')), '# 用户规则 USER-TRAE-RULE-KEEP\n');
      assert.ok(!exists(path.join(dir, '.trae', 'hooks')), 'Trae 无 hooks 能力，不应落 hooks');
    },
    verifyUserStateAfterUninstall(dir) {
      assert.ok(!exists(path.join(dir, '.trae', 'rules', 'jevzh.md')), '本包规则应删除');
      assert.equal(readText(path.join(dir, '.trae', 'rules', 'user-rule.md')), '# 用户规则 USER-TRAE-RULE-KEEP\n');
    },
    restoreRels: [],
  },
};

for (const host of Object.values(HOSTS)) {
  test(`e2e ${host.alias}：安装 → 幂等重装 → doctor → 卸载 → restore（项目级全生命周期）`, () => {
    const dir = mkFixture(`jevzh-e2e-${host.alias}-`);
    try {
      host.prepare(dir);
      // 安装前字节快照（restore 最终要还原到这个状态）
      const originalBytes = new Map(
        (host.restoreRels || []).map((rel) => [rel, readText(path.join(dir, rel))]),
      );

      // ---- 安装 ----
      const r1 = run(['--tool', host.alias], { cwd: dir });
      assert.equal(r1.status, 0, r1.stdout + r1.stderr);

      const skills = skillDirs(path.join(dir, host.skillsRel));
      const packageSkills = skills.filter((s) => ALL_SKILLS.includes(s));
      const userSkills = skills.filter((s) => !ALL_SKILLS.includes(s));
      assert.equal(packageSkills.length, 27, `本包应装 27 个技能，实际 ${packageSkills.length}`);
      assert.deepEqual(userSkills, ['user-keep-skill'], '用户技能不得被覆盖/删除，且不得有多余目录');
      assert.ok(skills.includes('jev-using-superpowers'));
      assert.ok(skills.includes('brainstorming'));
      assert.ok(skills.includes('mcp-builder'));

      // 宿主能力产物
      if (host.hooksRel) {
        const runtime = listFiles(path.join(dir, host.hooksRel));
        for (const f of HOOK_RUNTIME) {
          const expected = host.alias === 'cursor'
            ? f !== 'hooks.json'
            : f !== 'hooks-cursor.json';
          if (expected) assert.ok(runtime.includes(f), `${host.alias} hooks 运行时缺 ${f}`);
        }
        for (const f of GATE_SCRIPTS) {
          assert.ok(exists(path.join(dir, host.scriptsRel, f)), `${host.alias} scripts 缺 ${f}`);
        }
        for (const rel of host.wiredSettings) {
          assert.ok(exists(path.join(dir, rel)), `接线文件 ${rel} 缺失`);
        }
      }
      assert.ok(exists(path.join(dir, '.jevzh.json')), '.jevzh.json 缺失');
      JSON.parse(readText(path.join(dir, '.jevzh.json')));
      host.verifyUserStateAfterInstall(dir);

      const backupsAfterInstall = listBackups(dir);

      // ---- 二次安装：幂等 ----
      const r2 = run(['--tool', host.alias], { cwd: dir });
      assert.equal(r2.status, 0, r2.stdout + r2.stderr);
      const hashAfterSecond = hashTree(dir);
      const r3 = run(['--tool', host.alias], { cwd: dir });
      assert.equal(r3.status, 0, r3.stdout + r3.stderr);
      assert.equal(hashTree(dir), hashAfterSecond, '第三次安装后整树指纹变化，幂等被破坏');
      assert.deepEqual(listBackups(dir), backupsAfterInstall, '幂等重装不应新增备份');

      // ---- doctor 健康（--tool 强制单宿主；offline 后端避免真实云探测）----
      const rd = run(['doctor', '--tool', host.alias], { cwd: dir, env: { JEVZH_BACKEND: 'off' } });
      assert.equal(rd.status, 0, rd.stdout + rd.stderr);
      assert.match(rd.stdout, /\[OK\]/);

      // ---- 卸载 ----
      const ru = run(['--uninstall', '--tool', host.alias], { cwd: dir });
      assert.equal(ru.status, 0, ru.stdout + ru.stderr);
      assert.ok(!exists(path.join(dir, host.skillsRel, 'jev-using-superpowers')));
      assert.ok(!exists(path.join(dir, host.skillsRel, 'brainstorming')));
      assert.ok(!exists(path.join(dir, host.skillsRel, 'mcp-builder')));
      assert.ok(exists(path.join(dir, host.skillsRel, 'user-keep-skill', 'SKILL.md')), '用户技能必须保留');
      if (host.hooksRel) {
        assert.ok(!exists(path.join(dir, host.hooksRel)), 'hooks 运行时目录应清空移除');
        assert.ok(!exists(path.join(dir, host.scriptsRel)), 'scripts 运行时目录应清空移除');
      }
      if (host.ruleRel) assert.ok(!exists(path.join(dir, host.ruleRel)));
      assert.ok(exists(path.join(dir, '.jevzh.json')), '卸载默认保留 .jevzh.json');
      host.verifyUserStateAfterUninstall(dir);

      // ---- restore：安装前备份可用，接管文件字节还原 ----
      const ts = backupsAfterInstall[0];
      if (originalBytes.size > 0) {
        assert.ok(ts, '安装期应产生接管备份');
        const rr = run(['restore', ts], { cwd: dir });
        assert.equal(rr.status, 0, rr.stdout + rr.stderr);
        for (const [rel, expected] of originalBytes) {
          assert.equal(readText(path.join(dir, rel)), expected.replace(/\r\n/g, '\n'),
            `restore 后 ${rel} 与安装前不一致`);
        }
      }
    } finally {
      rmFixture(dir);
    }
  });
}

test('e2e cursor：全新安装（无预置 hooks.json）卸载后接线文件零残留（不遗留空壳配置）', () => {
  const dir = mkFixture('jevzh-e2e-cursor-fresh-');
  try {
    assert.equal(run(['--tool', 'cursor'], { cwd: dir }).status, 0);
    assert.ok(exists(path.join(dir, '.cursor', 'hooks.json')));
    assert.equal(run(['--uninstall', '--tool', 'cursor'], { cwd: dir }).status, 0);
    assert.ok(!exists(path.join(dir, '.cursor', 'hooks.json')), '纯本包创建的接线文件应随卸载删除');
    assert.ok(exists(path.join(dir, '.jevzh.json')));
  } finally {
    rmFixture(dir);
  }
});
