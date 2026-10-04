// tests/coexistence/transactions.test.mjs — 用例 8：按目标事务失败回滚。
//
// JEVZH_FAULT 是安装器内置的失败注入开关（env 缺省时零行为，仅供测试）：
//   JEVZH_FAULT=post-settings:claude  在 claude 目标 settings 合并后、校验前抛错
// 断言：仅当前目标回滚到事务前状态（含预置文件字节还原），其他目标保持已完成，
// 无 *.tmp 残留、无半写哨兵、无损坏 JSON。
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  run, mkFixture, rmFixture, readText, exists, listFiles,
} from './helpers.mjs';
import { BIN } from '../installer/helpers.mjs';

const mod = await import(pathToFileURL(BIN).href);
const { classifySkillSource } = mod;

function writeSkill(dir, text) {
  const skill = path.join(dir, 'brainstorming');
  fs.mkdirSync(skill, { recursive: true });
  fs.writeFileSync(path.join(skill, 'SKILL.md'), text);
}

test('来源识别单元：ours/jev-en/zh/obra/未知 五类边界与误判防护', () => {
  const tmp = mkFixture('jevzh-src-unit-');
  try {
    // jev-en：英文 + TypeSafe Jev + Failure Modes + docs/CONFIDENCE.md
    writeSkill(tmp, '---\nname: brainstorming\n---\nTypeSafe Jev Failure Modes see docs/CONFIDENCE.md');
    assert.equal(classifySkillSource(path.join(tmp, 'brainstorming')).source, 'jev');

    // 本包 jev 技能虽含 TypeSafe Jev，但中文 + jev-superpowers-zh 品牌 -> ours
    writeSkill(tmp, '---\nname: jev-brainstorming\n---\nTypeSafe Jev 门禁，本节是 jev-superpowers-zh 的增量内容，阈值见 docs/CONFIDENCE.zh.md');
    assert.equal(classifySkillSource(path.join(tmp, 'brainstorming')).source, 'ours');

    writeSkill(tmp, '---\nname: x\n---\n本节是 superpowers-zh 的增量内容');
    assert.equal(classifySkillSource(path.join(tmp, 'brainstorming')).source, 'zh');

    writeSkill(tmp, '---\nname: x\n---\nuse superpowers:using-superpowers first');
    assert.equal(classifySkillSource(path.join(tmp, 'brainstorming')).source, 'obra');

    writeSkill(tmp, '---\nname: x\n---\n# 我们团队自己的流程');
    assert.equal(classifySkillSource(path.join(tmp, 'brainstorming')).source, 'unknown');
  } finally {
    rmFixture(tmp);
  }
});

test('本包 meta 识别优先于正文特征（meta pkg 不匹配不得漂白）', () => {
  const tmp = mkFixture('jevzh-src-meta-');
  const skill = path.join(tmp, 'brainstorming');
  fs.mkdirSync(skill, { recursive: true });
  fs.writeFileSync(path.join(skill, 'SKILL.md'), '---\nname: brainstorming\n---\n正文无任何品牌串\n');
  fs.writeFileSync(
    path.join(skill, '.jevzh-meta.json'),
    JSON.stringify({ pkg: 'someone-else', version: '9.9.9' }),
  );
  try {
    assert.equal(classifySkillSource(skill).source, 'unknown');
    fs.writeFileSync(
      path.join(skill, '.jevzh-meta.json'),
      JSON.stringify({ pkg: 'jev-superpowers-zh', version: '0.0.1' }),
    );
    assert.equal(classifySkillSource(skill).source, 'ours');
  } finally {
    rmFixture(tmp);
  }
});

test('故障注入：claude 目标失败仅回滚自身，cursor 目标保持完成；无 .tmp/半哨兵', () => {
  const dir = mkFixture('jevzh-tx-fault-');
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.cursor'), { recursive: true });
  try {
    const r = run([], { cwd: dir, env: { JEVZH_FAULT: 'post-settings:claude' } });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    const out = r.stdout + r.stderr;
    assert.match(out, /回滚|恢复/);
    assert.match(out, /Cursor/);

    // claude 目标完全回滚（所有产物均为本事务新建）
    assert.ok(!exists(path.join(dir, '.claude', 'skills')), 'skills 应回滚');
    assert.ok(!exists(path.join(dir, '.claude', 'hooks')));
    assert.ok(!exists(path.join(dir, '.claude', 'scripts')));
    assert.ok(!exists(path.join(dir, '.claude', 'settings.json')));
    assert.ok(!exists(path.join(dir, 'CLAUDE.md')));
    // cursor 目标已完成且完好
    assert.ok(exists(path.join(dir, '.cursor', 'skills', 'jev-verification', 'SKILL.md')));
    assert.ok(exists(path.join(dir, '.cursor', 'hooks', 'hooks-cursor.json')));
    assert.equal(
      fs.readdirSync(path.join(dir, '.cursor', 'skills'), { withFileTypes: true })
        .filter((e) => e.isDirectory()).length,
      27,
    );

    // 无 *.tmp 残留
    const tmps = listFiles(dir).filter((f) => f.endsWith('.tmp') || /\.[^/]+\.[0-9a-f]{16}\.tmp$/.test(f));
    assert.deepEqual(tmps, []);

    // 任何现存文件中不得有不成对的本包哨兵
    for (const f of listFiles(dir).filter((x) => x.endsWith('.md'))) {
      const text = readText(path.join(dir, f));
      const begins = (text.match(/jev-superpowers-zh:begin/g) ?? []).length;
      const ends = (text.match(/jev-superpowers-zh:end/g) ?? []).length;
      assert.equal(begins, ends, `${f} 哨兵不成对`);
    }

    // 回滚后重跑（无故障）成功，系统自愈
    const r2 = run([], { cwd: dir });
    assert.equal(r2.status, 0, r2.stdout + r2.stderr);
    assert.ok(exists(path.join(dir, '.claude', 'skills', 'jev-verification', 'SKILL.md')));
  } finally {
    rmFixture(dir);
  }
});

test('故障注入：预置 CLAUDE.md/settings.json 时回滚还原字节，备份暂存被清理', () => {
  const dir = mkFixture('jevzh-tx-restore-');
  const routerOriginal = `# 我的项目

<!-- superpowers-zh:begin (do not edit between these markers) -->
旧 zh 段 KEEP-TX-ORIG。
<!-- superpowers-zh:end -->
`;
  const settingsOriginal = JSON.stringify({ keepMe: 'KEEP-TX-SETTINGS' });
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), routerOriginal);
  fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), settingsOriginal);
  try {
    const r = run(['--tool', 'claude'], { cwd: dir, env: { JEVZH_FAULT: 'post-router:claude' } });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    // 预置文件字节还原（CRLF 归一化后）
    assert.equal(readText(path.join(dir, 'CLAUDE.md')), routerOriginal.replace(/\r?\n/g, '\n'));
    assert.equal(readText(path.join(dir, '.claude', 'settings.json')), settingsOriginal);
    // 技能/钩子新建物全部撤回
    assert.ok(!exists(path.join(dir, '.claude', 'skills')));
    assert.ok(!exists(path.join(dir, '.claude', 'hooks')));
    // 回滚成功的事务不留下备份暂存
    assert.ok(!exists(path.join(dir, '.jevzh', 'backups')) || listFiles(path.join(dir, '.jevzh', 'backups')).length === 0);
  } finally {
    rmFixture(dir);
  }
});
