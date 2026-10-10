// tests/coexistence/helpers.mjs — 共存测试共用夹具
// 复用 tests/installer/helpers.mjs 的子进程/临时目录约定（os.tmpdir、import.meta.url
// 定位仓库根、CRLF -> LF），另加四套静态前置夹具的复制工具。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  run as installerRun, mkFixture, rmFixture as rmFixtureBase, readText, exists,
  listFiles, hashTree,
} from '../installer/helpers.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const FIXTURES = path.join(ROOT, 'tests', 'coexistence', 'fixtures');

export { mkFixture, readText, exists, listFiles, hashTree };

export function rmFixture(dir) {
  rmFixtureBase(dir);
}

// 与安装器测试同一入口；JEVZH_FAULT 仅用于事务失败注入（生产代码在该 env 缺省时零行为）。
export function run(args, opts = {}) {
  return installerRun(args, opts);
}

// 复制 tests/coexistence/fixtures/<name>/ 下整棵树到目标目录。
export function copyFixture(name, destDir) {
  fs.cpSync(path.join(FIXTURES, name), destDir, { recursive: true });
}

// 在项目夹具中放入某来源的同名技能（.claude/skills/brainstorming）。
export function putCompetitorSkill(projectDir, source, tool = 'claude') {
  const skillsRel = tool === 'cursor' ? '.cursor/skills' : '.claude/skills';
  const dest = path.join(projectDir, skillsRel, 'brainstorming');
  fs.mkdirSync(dest, { recursive: true });
  copyFixture(path.join(source, 'brainstorming'), dest);
  return dest;
}

export function skillText(source) {
  return readText(path.join(FIXTURES, source, 'brainstorming', 'SKILL.md'));
}

// 列出 .jevzh/backups 下时间戳目录（字典序=时间序）。
export function listBackups(projectOrHome) {
  const root = path.join(projectOrHome, '.jevzh', 'backups');
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

export function readBackupManifest(projectOrHome, ts) {
  return JSON.parse(
    readText(path.join(projectOrHome, '.jevzh', 'backups', ts, 'manifest.json')),
  );
}

// 在备份树中递归找包含指定文本的文件（验证备份内容完整性）。
export function backupHasContent(projectOrHome, ts, needle) {
  const root = path.join(projectOrHome, '.jevzh', 'backups', ts);
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (walk(p)) return true;
      } else {
        try {
          if (fs.readFileSync(p, 'utf8').includes(needle)) return true;
        } catch {
          // 二进制/编码问题不影响其他文件扫描。
        }
      }
    }
    return false;
  };
  return walk(root);
}
