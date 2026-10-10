import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = new URL("../../", import.meta.url);
const repoRoot = fileURLToPath(root);
const skillsRoot = new URL("skills/", root);

// Normalize CRLF so a fresh Windows checkout (core.autocrlf=true) does not
// break regexes that rely on LF semantics.
const readText = (path) =>
  fs.readFileSync(path, "utf8").replace(/\r\n/g, "\n");

const expected = [
  "brainstorming",
  "diagnosing-superpowers",
  "dispatching-parallel-agents",
  "executing-plans",
  "finishing-a-development-branch",
  "receiving-code-review",
  "requesting-code-review",
  "subagent-driven-development",
  "systematic-debugging",
  "test-driven-development",
  "using-git-worktrees",
  "using-superpowers",
  "verification-before-completion",
  "writing-plans",
  "writing-skills",
  "chinese-code-review",
  "chinese-commit-conventions",
  "chinese-documentation",
  "chinese-git-workflow",
  "mcp-builder",
  "workflow-runner",
];

// Upstream ships these scripts with mode 100755. The git index bit is the
// source of truth because Windows checkouts have no filesystem exec bit.
const executableScripts = [
  "skills/brainstorming/scripts/start-server.sh",
  "skills/brainstorming/scripts/stop-server.sh",
  "skills/executing-plans/scripts/task-start",
  "skills/executing-plans/scripts/task-done",
  "skills/subagent-driven-development/scripts/task-brief",
  "skills/subagent-driven-development/scripts/sdd-workspace",
  "skills/subagent-driven-development/scripts/review-package",
  "skills/systematic-debugging/find-polluter.sh",
];

test("all zh skills have frontmatter and no jev calls", () => {
  for (const name of expected) {
    const file = new URL(`skills/${name}/SKILL.md`, root);
    assert.ok(fs.existsSync(file), `skills/${name}/SKILL.md`);
    const text = readText(file);
    assert.match(text, /^---\nname:/, `${name}: frontmatter start`);
    assert.match(text, /^name: /m, `${name}: name field`);
    assert.match(text, /^description:/m, `${name}: description field`);
    const nameField = text.match(/^name: (.+)$/m)[1].trim();
    assert.equal(nameField, name, `${name}: slug must not change`);
    assert.doesNotMatch(
      text,
      /jev-axi|jev-scout|jev-guard|git jev check|TYPESAFE|limpet|supercov/,
      `${name}: no jev tooling in the zh skill base`,
    );
  }
  assert.equal(
    new Set(expected).size,
    expected.length,
    "expected skill list must not contain duplicates",
  );
});

const jevSkills = [
  "jev-using-superpowers",
  "jev-brainstorming",
  "jev-writing-plans",
  "jev-executing-plans",
  "jev-systematic-debugging",
  "jev-verification",
];

test(`skills/ contains exactly the ${expected.length} zh skill directories`, () => {
  const dirs = fs
    .readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  // 21 个 zh 底座集合仍精确存在：除 jev-* 外不得有任何多余目录。
  const zhDirs = dirs.filter((name) => !name.startsWith("jev-")).sort();
  assert.deepEqual(zhDirs, [...expected].sort());
});

test("skills/ contains 27 directories in total (21 zh + 6 jev)", () => {
  const dirs = fs
    .readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(dirs, [...expected, ...jevSkills].sort());
  assert.equal(dirs.length, 27);
});

test("self-referential brand is replaced; upstream attribution kept", () => {
  const read = (path) => readText(new URL(path, root));

  // FORK_MARK spots that actually exist upstream (3 files carry the mark).
  for (const path of [
    "skills/using-superpowers/SKILL.md",
    "skills/using-superpowers/references/hermes-tools.md",
    "skills/using-superpowers/references/codex-tools.md",
  ]) {
    const text = read(path);
    assert.match(
      text,
      /jev-superpowers-zh 的增量内容/,
      `${path}: new FORK_MARK brand text`,
    );
    assert.doesNotMatch(
      text,
      /本节[^，\n]*是 superpowers-zh 的增量内容/,
      `${path}: old FORK_MARK brand text must not remain`,
    );
  }

  // Installer CLI command shown to users is rebranded to jevzh.
  assert.match(
    read("skills/using-superpowers/references/hermes-tools.md"),
    /npx jevzh --tool hermes/,
  );
  assert.doesNotMatch(
    read("skills/using-superpowers/references/hermes-tools.md"),
    /npx superpowers-zh/,
  );

  // jnMetaCode zh-upstream repo URLs are attribution and stay untouched.
  const githubIssues = read(
    "skills/diagnosing-superpowers/references/github-issues.md",
  );
  assert.match(githubIssues, /jnMetaCode\/superpowers-zh/);
  const qoderTools = read("skills/using-superpowers/references/qoder-tools.md");
  assert.match(
    qoderTools,
    /https:\/\/github\.com\/jnMetaCode\/superpowers-zh\/issues\/119/,
  );
});

test("no forbidden jev vocabulary anywhere in the zh skill tree", () => {
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const path = new URL(`${entry.name}/`, dir);
      if (entry.isDirectory()) {
        walk(path);
      } else {
        const text = readText(path);
        assert.doesNotMatch(
          text,
          /jev-axi|jev-scout|jev-guard|git jev check|TYPESAFE|limpet|supercov/,
          `${fileURLToPath(path)}: jev vocabulary forbidden in zh base`,
        );
      }
    }
  };
  // jev 词汇检查只针对 21 个 zh 底座技能；6 个 jev-* 技能由
  // jev-contract.test.mjs 另行约束。
  for (const name of expected) {
    walk(new URL(`skills/${name}/`, root));
  }
});

test("shell and entry scripts keep the git executable bit", () => {
  for (const path of executableScripts) {
    const line = execSync(`git ls-files -s -- ${path}`, {
      encoding: "utf8",
      cwd: repoRoot,
    }).trim();
    assert.ok(
      line.startsWith("100755"),
      `${path}: git index mode must be 100755, got "${line || "(untracked)"}"`,
    );
  }
});
