import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

// cwd 无关：所有路径基于本测试文件位置解析。
const root = new URL("../../", import.meta.url);

// 读文本前归一化 CRLF，避免 Windows 检出（core.autocrlf=true）干扰正则。
const readText = (url) =>
  fs.readFileSync(url, "utf8").replace(/\r\n/g, "\n");

const escapeRegExp = (value) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const jevSkills = [
  "jev-using-superpowers",
  "jev-brainstorming",
  "jev-writing-plans",
  "jev-executing-plans",
  "jev-systematic-debugging",
  "jev-verification",
];

// 上游调用契约：命令、参数、阈值、环境变量与端点，跨 6 个文件合并后必须全部出现。
const requiredTokens = [
  "jev-axi pick",
  "jev-axi triage",
  "jev-axi check",
  "jev-scout",
  "jev-guard",
  "git jev check",
  "supercov quality",
  "limpet",
  "--options",
  "--text",
  "--state",
  "--ecosystem",
  "--json",
  "0.80",
  "0.50",
  "0.70",
  "2.0",
  "0.10",
  "0.90",
  "TYPESAFE_API_KEY",
  "TYPESAFE_BASE_URL",
  "/v1/systemone",
  "/health",
];

// 21 个中文底座技能，jev-using-superpowers 的路由表必须全部点名。
const zhSkills = [
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

// 每个 jev 技能必须回链其继承的标准裸 slug。
const bareSlugBySkill = {
  "jev-using-superpowers": "using-superpowers",
  "jev-brainstorming": "brainstorming",
  "jev-writing-plans": "writing-plans",
  "jev-executing-plans": "executing-plans",
  "jev-systematic-debugging": "systematic-debugging",
  "jev-verification": "verification-before-completion",
};

// 裸 slug 边界：不得只以 jev- 前缀形态出现。
const bareSlugPattern = (slug) =>
  new RegExp(`(?<![A-Za-z0-9-])${escapeRegExp(slug)}(?![A-Za-z0-9-])`);

const readSkill = (name) =>
  readText(new URL(`skills/${name}/SKILL.md`, root));

test("每个 jev 技能保留英文 slug frontmatter 且 description 为中文", () => {
  for (const name of jevSkills) {
    const file = new URL(`skills/${name}/SKILL.md`, root);
    assert.ok(fs.existsSync(file), `skills/${name}/SKILL.md`);
    const text = readSkill(name);
    assert.match(text, /^---\nname:/, `${name}: frontmatter 起始`);
    const nameField = text.match(/^name: (.+)$/m)[1].trim();
    assert.equal(nameField, name, `${name}: name 必须等于英文 slug`);
    const description = text.match(/^description: (.+)$/m)[1];
    assert.match(
      description,
      /[一-鿿]/,
      `${name}: description 必须含中文字符`,
    );
  }
});

test("每个 jev 技能含派生声明、软降级、就绪检查与增量标记", () => {
  for (const name of jevSkills) {
    const text = readSkill(name);
    assert.match(text, /派生自 jev-superpowers/, `${name}: 派生声明`);
    assert.match(text, /软降级|降级/, `${name}: 软降级表述`);
    assert.match(text, /就绪检查/, `${name}: 就绪检查分支`);
    assert.match(
      text,
      /本节是 jev-superpowers-zh 的增量内容/,
      `${name}: 增量章节标记`,
    );
    assert.doesNotMatch(
      text,
      /superpowers:/,
      `${name}: 不得保留 superpowers: 前缀引用`,
    );
  }
});

test("每个 jev 技能以两类失败改写失效模式并引用 CONFIDENCE.zh.md", () => {
  for (const name of jevSkills) {
    const text = readSkill(name);
    assert.match(text, /环境型失败/, `${name}: 环境型失败`);
    assert.match(text, /判定型失败/, `${name}: 判定型失败`);
    assert.match(
      text,
      /docs\/CONFIDENCE\.zh\.md/,
      `${name}: 引用 docs/CONFIDENCE.zh.md`,
    );
    assert.match(
      text,
      /每会话.*(提示|告知|警告)一次/,
      `${name}: 每会话醒目提示一次`,
    );
    assert.match(text, /绝不(能)?静默|不得静默/, `${name}: 禁止静默降级`);
  }
});

test("6 个 jev 技能合并文本保留全部上游契约 token", () => {
  const combined = jevSkills.map((name) => readSkill(name)).join("\n");
  for (const token of requiredTokens) {
    assert.match(
      combined,
      new RegExp(escapeRegExp(token)),
      `契约 token 缺失: ${token}`,
    );
  }
});

test("每个 jev 技能回链对应的标准裸 slug", () => {
  for (const [name, slug] of Object.entries(bareSlugBySkill)) {
    const text = readSkill(name);
    assert.match(
      text,
      bareSlugPattern(slug),
      `${name}: 必须以裸 slug 引用 ${slug}`,
    );
  }
});

test("jev-using-superpowers 路由表覆盖全部 27 个技能", () => {
  const text = readSkill("jev-using-superpowers");
  for (const slug of [...zhSkills, ...jevSkills]) {
    assert.match(
      text,
      bareSlugPattern(slug),
      `路由表缺少技能: ${slug}`,
    );
  }
  assert.match(text, /27/, "必须说明技能总数为 27");
  assert.match(text, /路由/);
});

test("jev-using-superpowers 说明四态、后端协议与 jev-gate 统一入口", () => {
  const text = readSkill("jev-using-superpowers");
  for (const state of ["FULL", "LOCAL", "PARTIAL", "DEGRADED"]) {
    assert.match(text, new RegExp(state), `缺少就绪态: ${state}`);
  }
  assert.match(text, /strict/);
  assert.match(text, /bash scripts\/jev-gate/);
  for (const sub of [
    "pick",
    "scout",
    "guard",
    "commit",
    "triage",
    "check-hypothesis",
    "quality",
    "limpet",
  ]) {
    assert.match(text, new RegExp(sub), `jev-gate 子命令缺失: ${sub}`);
  }
  assert.match(text, /127\.0\.0\.1:8000/);
});

test("6 个 SKILL.md 均为 LF 行尾", () => {
  for (const name of jevSkills) {
    const buffer = fs.readFileSync(
      new URL(`skills/${name}/SKILL.md`, root),
    );
    assert.ok(
      !buffer.includes(0x0d),
      `${name}: 不得包含 CR（必须 LF）`,
    );
  }
});
