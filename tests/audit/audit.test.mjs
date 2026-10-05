// 双上游审计的不变量测试（node:test，离线可跑）。
//
// 与 tests/skills/* 的分工：
//   - zh-skills/jev-contract 已覆盖 27 目录、禁词、23 token、8 脚本可执行位等；
//   - 本文件只守护 audit 机制自身依赖的事实：audit-divergences.json 合法性、
//     AGENTS 符号链接、模式位、安装目标/文档计数、共存开关、版本同步等。
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));
const git = (args) => execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' });

const dirs = fs.readdirSync(path.join(ROOT, 'skills'), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();
const zhDirs = dirs.filter((d) => !d.startsWith('jev-'));
const jevDirs = dirs.filter((d) => d.startsWith('jev-'));

describe('审计自身：27 技能 frontmatter', () => {
  test('恰好 21 zh + 6 jev = 27 个技能目录', () => {
    assert.equal(zhDirs.length, 21);
    assert.deepEqual(jevDirs, [
      'jev-brainstorming',
      'jev-executing-plans',
      'jev-systematic-debugging',
      'jev-using-superpowers',
      'jev-verification',
      'jev-writing-plans',
    ]);
  });

  for (const name of dirs) {
    test(`${name}/SKILL.md frontmatter 合法且 name 与目录同名`, () => {
      const file = path.join(ROOT, 'skills', name, 'SKILL.md');
      const src = fs.readFileSync(file, 'utf8');
      const m = src.match(/^---\n([\s\S]*?)\n---/);
      assert.ok(m, `${name}: 缺少 frontmatter`);
      const fm = m[1];
      const nm = fm.match(/^name:\s*(.+?)\s*$/m);
      assert.ok(nm, `${name}: 缺 name`);
      assert.equal(nm[1].replace(/["']/g, ''), name);
      assert.match(fm, /^description:\s*\S+/m, `${name}: 缺 description`);
    });
  }

  for (const name of zhDirs) {
    test(`${name}（zh 技能）frontmatter 带 license`, () => {
      const fm = read(`skills/${name}/SKILL.md`).match(/^---\n([\s\S]*?)\n---/)[1];
      assert.match(fm, /^license:\s*\S+/m, `${name}: zh 技能必须声明 license`);
    });
  }
});

describe('audit-divergences.json 与 .upstream-sync.json', () => {
  const div = JSON.parse(read('scripts/audit-divergences.json'));
  const sync = JSON.parse(read('.upstream-sync.json'));
  const allTracked = git(['ls-files']).trim().split('\n').filter(Boolean);

  test('恰好 4 项 declaredDivergences，字段齐全', () => {
    assert.ok(Array.isArray(div.divergences));
    assert.equal(div.divergences.length, 4);
    for (const d of div.divergences) {
      assert.equal(typeof d.id, 'string');
      assert.ok(d.id.length > 0);
      assert.ok(Array.isArray(d.scope) && d.scope.length > 0);
      assert.equal(typeof d.reason, 'string');
      assert.ok(d.reason.trim().length > 0);
      assert.equal(typeof d.sourceText, 'string');
    }
  });

  test('divergences + whitelist 的 id 全局唯一', () => {
    const ids = [...div.divergences, ...(div.whitelist ?? [])].map((r) => r.id);
    assert.equal(new Set(ids).size, ids.length, `id 重复: ${ids}`);
  });

  test('每条 scope 都能解析（字面路径存在或 glob 至少命中一个跟踪文件）', () => {
    for (const rule of [...div.divergences, ...(div.whitelist ?? [])]) {
      for (const sc of rule.scope) {
        if (/[*?]/.test(sc)) {
          const re = new RegExp(
            '^' +
              sc
                .replace(/[.+^${}()|[\]\\]/g, '\\$&')
                .replace(/\*\*/g, '\u0000')
                .replace(/\*/g, '[^/]*')
                .replace(/\?/g, '[^/]')
                .replace(/\u0000/g, '.*') +
              '$',
          );
          assert.ok(
            allTracked.some((p) => re.test(p)),
            `${rule.id}: glob ${sc} 命中不了任何 git 跟踪文件`,
          );
        } else {
          assert.ok(exists(sc), `${rule.id}: 路径 ${sc} 不存在`);
        }
      }
    }
  });

  test('4 项 sourceText 与 .upstream-sync.json 原文一一对应', () => {
    const texts = new Set(sync.declaredDivergences);
    assert.equal(texts.size, 4);
    for (const d of div.divergences) {
      assert.ok(texts.has(d.sourceText), `${d.id}: sourceText 在 .upstream-sync.json 中缺失`);
    }
  });

  test('4 项 scope 覆盖规格声明的全部衍件路径', () => {
    const covered = new Set(div.divergences.flatMap((d) => d.scope));
    for (const p of [
      'hooks/hooks.json',
      'hooks/hooks-cursor.json',
      'hooks/session-start',
      'hooks/pre-commit',
      'hooks/stop',
      'bin/jevzh.js',
    ]) {
      assert.ok(covered.has(p), `declaredDivergences 未覆盖 ${p}`);
    }
  });
});

describe('git 模式位与仓库卫生', () => {
  const modeOf = (p) => {
    const line = git(['ls-files', '-s', '--', p]).trim();
    return line ? line.split(/\s+/)[0] : null;
  };

  test('AGENTS.md 是指向 CLAUDE.md 的 120000 符号链接', () => {
    assert.equal(modeOf('AGENTS.md'), '120000');
    assert.equal(read('AGENTS.md').trim(), 'CLAUDE.md');
    assert.ok(exists('CLAUDE.md'));
  });

  const execFiles = [
    'hooks/pre-commit',
    'hooks/session-start',
    'hooks/stop',
    'scripts/jev-gate',
    'scripts/jev-readiness',
    'scripts/sync-plugin-version.js',
    'scripts/audit.sh',
    'scripts/run-bash-tests.sh',
    'skills/brainstorming/scripts/start-server.sh',
    'skills/brainstorming/scripts/stop-server.sh',
    'skills/executing-plans/scripts/task-start',
    'skills/executing-plans/scripts/task-done',
    'skills/subagent-driven-development/scripts/task-brief',
    'skills/subagent-driven-development/scripts/sdd-workspace',
    'skills/subagent-driven-development/scripts/review-package',
    'skills/systematic-debugging/find-polluter.sh',
  ];
  for (const f of execFiles) {
    test(`${f} git 模式位 100755`, () => {
      assert.equal(modeOf(f), '100755', `${f} 必须可执行`);
    });
  }

  test('hooks/run-hook.cmd 保持 100644（polyglot 普通文件）', () => {
    assert.equal(modeOf('hooks/run-hook.cmd'), '100644');
  });

  test('skills/ 下没有任何 .jevzh-meta.json（安装期生成物不得入仓）', () => {
    const hit = git(['ls-files', 'skills']).split('\n').filter((p) => p.endsWith('.jevzh-meta.json'));
    assert.deepEqual(hit, []);
    const walk = (dir) => {
      const out = [];
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) out.push(...walk(p));
        else out.push(p);
      }
      return out;
    };
    const untracked = walk(path.join(ROOT, 'skills')).filter((p) => p.endsWith('.jevzh-meta.json'));
    assert.deepEqual(untracked, []);
  });

  test('.gitignore 必须忽略 .jevzh/ 与 upstream/ 上游检出目录', () => {
    const gi = read('.gitignore');
    assert.match(gi, /^\.jevzh\/?$/m);
    assert.match(gi, /^upstream\/?$/m);
  });
});

describe('计数 / 共存开关 / 版本同步', () => {
  const installer = read('bin/jevzh.js');

  test('installer TARGETS 恰好 26 条（含 1 条 editionOf 发行版变体）', () => {
    const block = installer.slice(installer.indexOf('const TARGETS = ['));
    const body = block.slice(0, block.indexOf('\n];'));
    const entries = body.match(/^  \{ name: '/gm) ?? [];
    assert.equal(entries.length, 26);
    assert.match(body, /editionOf:/);
  });

  test('docs/README.*.md 恰好 26 篇宿主文档', () => {
    const docs = fs
      .readdirSync(path.join(ROOT, 'docs'))
      .filter((f) => /^README\..*\.md$/.test(f));
    assert.equal(docs.length, 26);
  });

  const markers = ['preflight', 'doctor', 'restore', '--adopt-skills', '--keep-router', '--detect-only', '--no-jev', '--strict'];
  for (const marker of markers) {
    test(`installer 含共存标识 ${marker}`, () => {
      assert.ok(installer.includes(marker), `bin/jevzh.js 缺少 ${marker}`);
    });
  }

  const subs = ['pick', 'scout', 'guard', 'commit', 'triage', 'check-hypothesis', 'quality', 'limpet'];
  const gate = read('scripts/jev-gate');
  for (const sub of subs) {
    test(`scripts/jev-gate 分发 ${sub} 子命令`, () => {
      assert.match(gate, new RegExp(`^\\s*${sub}\\)`, 'm'));
    });
  }

  test('package.json name = jev-superpowers-zh', () => {
    assert.equal(JSON.parse(read('package.json')).name, 'jev-superpowers-zh');
  });

  test('sync-plugin-version --check 通过（清单版本无漂移）', () => {
    execFileSync('node', ['scripts/sync-plugin-version.js', '--check'], { cwd: ROOT, stdio: 'pipe' });
  });
});
