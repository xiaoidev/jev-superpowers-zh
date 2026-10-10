// tests/e2e/global-lifecycle.test.mjs — 全局宿主端到端生命周期（DoD §11-3 取证）：
//   claude（~/.claude，含全局 hooks 接线切除）
//   Reasonix（Windows %APPDATA%/Roaming，dirWin）
//   Crush（Windows %LOCALAPPDATA%，dirWin）
// 全部在伪造 HOME/APPDATA/LOCALAPPDATA 沙箱内进行，绝不触碰真实用户目录。
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  run, mkFixture, rmFixture, readText, exists, listFiles, hashTree, ALL_SKILLS,
} from '../installer/helpers.mjs';

function fakeHomeEnv(root) {
  const home = path.join(root, 'home');
  fs.mkdirSync(home, { recursive: true });
  return {
    home,
    env: {
      HOME: home,
      USERPROFILE: home,
      APPDATA: path.join(home, 'AppData', 'Roaming'),
      LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
      // 与 tests/installer/global.test.mjs 同口径：注入不存在的 npm root，
      // 杜绝真实 npm spawn 在夹具内写 debug log。
      JEVZH_TEST_NPM_ROOT_G: path.join(root, 'injected-empty-npm-root'),
    },
  };
}

function putUserSkill(skillsDir) {
  const d = path.join(skillsDir, 'user-global-keep');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(
    path.join(d, 'SKILL.md'),
    '---\nname: user-global-keep\n---\n用户全局技能 USER-GLOBAL-KEEP\n',
  );
}

function countSkillDirs(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
}

// claude：全局 hooks/settings 接线 + 卸载切除都覆盖
test('e2e 全局 claude：安装 → 幂等 → doctor --global → 卸载（hooks 接线随卸载切除，用户内容保留）', () => {
  const root = mkFixture('jevzh-e2e-g-claude-');
  const { home, env } = fakeHomeEnv(root);
  const skillsDir = path.join(home, '.claude', 'skills');
  putUserSkill(skillsDir);
  // 预置全局 settings 用户 hook + 未知键
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(
    path.join(home, '.claude', 'settings.json'),
    `${JSON.stringify({ userGlobalKey: 'GLOBAL-KEEP', hooks: { Other: [{ hooks: [{ type: 'command', command: 'echo GLOBAL-USER-HOOK' }] }] } }, null, 2)}\n`,
  );
  try {
    assert.equal(run(['--global', '--tool', 'claude'], { cwd: root, env }).status, 0);
    const dirs = countSkillDirs(skillsDir).map((e) => e.name).sort();
    assert.equal(dirs.filter((s) => ALL_SKILLS.includes(s)).length, 27);
    assert.ok(dirs.includes('user-global-keep'));
    assert.ok(exists(path.join(home, '.claude', 'hooks', 'run-hook.cjs')));
    assert.ok(exists(path.join(home, '.claude', 'hooks', 'hooks.json')));
    assert.ok(exists(path.join(home, '.claude', 'scripts', 'jev-gate')));
    const wired = JSON.parse(readText(path.join(home, '.claude', 'settings.json')));
    assert.equal(wired.userGlobalKey, 'GLOBAL-KEEP');
    assert.match(JSON.stringify(wired.hooks), /GLOBAL-USER-HOOK/);
    assert.match(JSON.stringify(wired.hooks), /run-hook\.cmd/);
    assert.ok(!exists(path.join(home, '.jevzh.json')), '全局安装不生成项目级配置');
    // 全局 bootstrap
    assert.match(readText(path.join(home, '.claude', 'CLAUDE.md')), /jev-superpowers-zh:begin/);

    // 幂等
    assert.equal(run(['--global', '--tool', 'claude'], { cwd: root, env }).status, 0);
    const h2 = hashTree(home);
    assert.equal(run(['--global', '--tool', 'claude'], { cwd: root, env }).status, 0);
    assert.equal(hashTree(home), h2, '全局第三次安装后指纹变化');

    // doctor --global
    const rd = run(['doctor', '--global', '--tool', 'claude'], { cwd: root, env: { ...env, JEVZH_BACKEND: 'off' } });
    assert.equal(rd.status, 0, rd.stdout + rd.stderr);
    assert.match(rd.stdout, /\[OK\]/);

    // 卸载
    assert.equal(run(['--global', '--uninstall', '--tool', 'claude'], { cwd: root, env }).status, 0);
    const left = countSkillDirs(skillsDir).map((e) => e.name);
    assert.deepEqual(left, ['user-global-keep']);
    assert.ok(!exists(path.join(home, '.claude', 'hooks')));
    assert.ok(!exists(path.join(home, '.claude', 'scripts')));
    assert.ok(!exists(path.join(home, '.claude', 'CLAUDE.md')), '纯本包全局 bootstrap 应删除');
    const after = JSON.parse(readText(path.join(home, '.claude', 'settings.json')));
    assert.equal(after.userGlobalKey, 'GLOBAL-KEEP');
    assert.match(JSON.stringify(after.hooks), /GLOBAL-USER-HOOK/);
    assert.doesNotMatch(JSON.stringify(after), /run-hook/);
  } finally {
    rmFixture(root);
  }
});

// Windows dirWin 全局宿主矩阵：Reasonix（Roaming）/ Crush（Local）
for (const [alias, skillsAbs] of [
  ['reasonix', (env) => path.join(env.APPDATA, 'reasonix', 'skills')],
  ['crush', (env) => path.join(env.LOCALAPPDATA, 'crush', 'skills')],
]) {
  test(`e2e 全局 ${alias}（dirWin）：安装 → 幂等 → doctor --global → 卸载护栏（用户技能保留）`, { skip: process.platform !== 'win32' && 'dirWin 仅 Windows 路径' }, () => {
    const root = mkFixture(`jevzh-e2e-g-${alias}-`);
    const { env } = fakeHomeEnv(root);
    const skillsDir = skillsAbs(env);
    putUserSkill(skillsDir);
    try {
      const r1 = run(['--global', '--tool', alias], { cwd: root, env });
      assert.equal(r1.status, 0, r1.stdout + r1.stderr);
      const dirs = countSkillDirs(skillsDir).map((e) => e.name).sort();
      assert.equal(dirs.filter((s) => ALL_SKILLS.includes(s)).length, 27);
      assert.deepEqual(dirs.filter((s) => !ALL_SKILLS.includes(s)), ['user-global-keep']);
      // 无 hooks 能力宿主不得落 hooks/scripts
      assert.ok(!exists(path.join(skillsDir, '..', 'hooks')));
      // 伪造 USERPROFILE 零污染
      assert.deepEqual(listFiles(path.join(root, 'home')).filter((f) => !f.startsWith('AppData/') && f !== 'AppData'), [],
        '全局 dirWin 安装不得在 ~/ 下落任何其他文件');

      const h2 = hashTree(path.join(root, 'home'));
      assert.equal(run(['--global', '--tool', alias], { cwd: root, env }).status, 0);
      assert.equal(hashTree(path.join(root, 'home')), h2, '幂等重装指纹变化');

      const rd = run(['doctor', '--global', '--tool', alias], { cwd: root, env: { ...env, JEVZH_BACKEND: 'off' } });
      assert.equal(rd.status, 0, rd.stdout + rd.stderr);
      assert.match(rd.stdout, /\[OK\]/);

      assert.equal(run(['--global', '--uninstall', '--tool', alias], { cwd: root, env }).status, 0);
      assert.deepEqual(countSkillDirs(skillsDir).map((e) => e.name), ['user-global-keep']);
    } finally {
      rmFixture(root);
    }
  });
}
