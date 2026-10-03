import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const skillsRoot = new URL("skills/", root);

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

test("all zh skills have frontmatter and no jev calls", () => {
  for (const name of expected) {
    const file = new URL(`skills/${name}/SKILL.md`, root);
    assert.ok(fs.existsSync(file), `skills/${name}/SKILL.md`);
    const text = fs.readFileSync(file, "utf8");
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
  assert.equal(expected.length, 21);
});

test("skills/ contains exactly the 21 zh skill directories", () => {
  const dirs = fs
    .readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(dirs, [...expected].sort());
});

test("self-referential brand is replaced; upstream attribution kept", () => {
  const read = (path) => fs.readFileSync(new URL(path, root), "utf8");

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
        const text = fs.readFileSync(path, "utf8");
        assert.doesNotMatch(
          text,
          /jev-axi|jev-scout|jev-guard|git jev check|TYPESAFE|limpet|supercov/,
          `${path.pathname}: jev vocabulary forbidden in zh base`,
        );
      }
    }
  };
  walk(skillsRoot);
});
