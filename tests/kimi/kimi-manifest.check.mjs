// Kimi 插件清单离线套件（源仓为内嵌 python3 的 sh；按既定决策改写为 node，
// 零解释器依赖，由 run-tests.sh 显式驱动；文件名不取 *.test.mjs 以免
// `npm test` 重复发现）。
//
// 相对源仓的调整：
//   - name / sessionStart.skill 品牌化为 jev-superpowers-zh / jev-using-superpowers；
//   - 删除 .version-bump.json 断言（本 fork 无该文件，版本由
//     scripts/sync-plugin-version.js 统管，其 --check 另有测试覆盖）。
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');
const manifestPath = resolve(repoRoot, '.kimi-plugin/plugin.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

test('manifest identity points at the jev fork', () => {
  assert.equal(manifest.name, 'jev-superpowers-zh');
  assert.equal(manifest.skills, './skills/');
  assert.equal(manifest.sessionStart.skill, 'jev-using-superpowers');
});

test('skillInstructions is non-empty and documents all 12 mapped tools', () => {
  const instructions = manifest.skillInstructions;
  assert.equal(typeof instructions, 'string');
  assert.ok(instructions.trim().length > 0);

  for (const token of [
    'AskUserQuestion',
    'TodoList',
    'Agent',
    'Skill',
    'Read',
    'Write',
    'Edit',
    'Bash',
    'Grep',
    'Glob',
    'FetchURL',
    'WebSearch',
  ]) {
    assert.ok(instructions.includes(token), `skillInstructions missing ${token}`);
  }
});

test('manifest carries no fields unsupported by the Kimi runtime', () => {
  const unsupported = [
    'tools',
    'commands',
    'hooks',
    'apps',
    'inject',
    'configFile',
    'config_file',
    'bootstrap',
  ];
  const present = unsupported.filter((field) => field in manifest);
  assert.deepEqual(present, [], `unsupported fields present: ${present.join(', ')}`);
});
