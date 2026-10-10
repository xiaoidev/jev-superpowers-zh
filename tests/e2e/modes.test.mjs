// tests/e2e/modes.test.mjs — 跨宿主模式矩阵（DoD §11-3 取证）：
//   --no-jev：claude/cursor/trae 严格只落 21 个中文技能，无 jev-*、无 hooks/scripts/配置；
//   --strict：新建配置写 strict:true；既有 strict:false 不被覆盖。
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  run, mkFixture, rmFixture, readText, exists,
} from '../installer/helpers.mjs';

const HOST_LAYOUT = {
  claude: { skillsRel: '.claude/skills', hooksRel: '.claude/hooks', scriptsRel: '.claude/scripts', wiredFile: '.claude/settings.json', routerRel: 'CLAUDE.md' },
  cursor: { skillsRel: '.cursor/skills', hooksRel: '.cursor/hooks', scriptsRel: '.cursor/scripts', wiredFile: '.cursor/hooks.json', routerRel: null },
  trae: { skillsRel: '.trae/skills', hooksRel: null, scriptsRel: null, wiredFile: null, routerRel: '.trae/rules/jevzh.md' },
};

for (const [alias, layout] of Object.entries(HOST_LAYOUT)) {
  test(`e2e --no-jev（${alias}）：仅 21 中文技能，无 hooks/scripts/.jevzh.json，router 仍在`, () => {
    const dir = mkFixture(`jevzh-e2e-nojev-${alias}-`);
    try {
      const r = run(['--tool', alias, '--no-jev'], { cwd: dir });
      assert.equal(r.status, 0, r.stdout + r.stderr);

      const skills = fs
        .readdirSync(path.join(dir, layout.skillsRel), { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort();
      assert.equal(skills.length, 21, `--no-jev 应只落 21 技能，实际 ${skills.length}`);
      assert.ok(skills.includes('brainstorming'));
      assert.ok(skills.includes('chinese-code-review'));
      assert.ok(!skills.includes('jev-using-superpowers'), 'jev 门禁技能不得安装');
      assert.ok(!skills.includes('jev-verification'));

      if (layout.hooksRel) {
        assert.ok(!exists(path.join(dir, layout.hooksRel)), `${alias} 不应落 hooks 运行时`);
        assert.ok(!exists(path.join(dir, layout.scriptsRel)), `${alias} 不应落门禁脚本`);
        assert.ok(!exists(path.join(dir, layout.wiredFile)), `${alias} 不应生成 hooks 接线文件`);
      }
      assert.ok(!exists(path.join(dir, '.jevzh.json')), '--no-jev 不生成配置');
      if (layout.routerRel) {
        assert.ok(exists(path.join(dir, layout.routerRel)), '技能引导 router 仍应安装');
        assert.match(readText(path.join(dir, layout.routerRel)), /21 个 skills|21 个技能/);
      }
    } finally {
      rmFixture(dir);
    }
  });
}

test('e2e --strict（cursor）：新建 .jevzh.json 写 strict:true', () => {
  const dir = mkFixture('jevzh-e2e-strict-new-');
  try {
    const r = run(['--tool', 'cursor', '--strict'], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const cfg = JSON.parse(readText(path.join(dir, '.jevzh.json')));
    assert.equal(cfg.strict, true);
  } finally {
    rmFixture(dir);
  }
});

test('e2e --strict（claude）：既有 strict:false 配置不被覆盖（只对新建生效）', () => {
  const dir = mkFixture('jevzh-e2e-strict-keep-');
  const cfgPath = path.join(dir, '.jevzh.json');
  fs.writeFileSync(cfgPath, JSON.stringify({ backend: 'off', strict: false }));
  try {
    const r = run(['--tool', 'claude', '--strict'], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const cfg = JSON.parse(readText(cfgPath));
    assert.equal(cfg.strict, false, '既有配置不得被 --strict 改写');
    assert.equal(cfg.backend, 'off');
  } finally {
    rmFixture(dir);
  }
});
