import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

// cwd 无关：所有路径基于本测试文件位置解析。
const rootUrl = new URL("../../", import.meta.url);
const root = fs.realpathSync(rootUrl);
const readText = (rel) =>
  fs.readFileSync(new URL(rel, rootUrl), "utf8").replace(/\r\n/g, "\n");
const exists = (rel) => fs.existsSync(path.join(root, rel));

const pkg = JSON.parse(readText("package.json"));

// 六个带版本字段的 JSON 清单：<路径, 取版本字段的函数>
const VERSIONED_MANIFESTS = [
  [".claude-plugin/plugin.json", (j) => j.version],
  [".claude-plugin/marketplace.json", (j) => j.plugins[0].version],
  [".cursor-plugin/plugin.json", (j) => j.version],
  [".codex-plugin/plugin.json", (j) => j.version],
  [".kimi-plugin/plugin.json", (j) => j.version],
  ["gemini-extension.json", (j) => j.version],
];

test("六个清单均可解析、品牌名与版本一致", () => {
  for (const [rel, getVersion] of VERSIONED_MANIFESTS) {
    const json = JSON.parse(readText(rel));
    const name = json.name ?? json.plugins?.[0]?.name;
    assert.equal(name, "jev-superpowers-zh", `${rel}: name`);
    assert.equal(
      getVersion(json),
      pkg.version,
      `${rel}: version 与 package.json 不一致`,
    );
    const text = readText(rel);
    assert.ok(!text.includes("jnMetaCode"), `${rel}: 残留旧 author jnMetaCode`);
    assert.ok(!text.includes("1.7.1"), `${rel}: 残留旧版本号`);
    assert.match(text, /27/, `${rel}: 描述应说明 27 个技能`);
  }
});

test("清单自指 URL 全部指向 xiaoidev/jev-superpowers-zh", () => {
  // marketplace 结构只有 owner（无 homepage/repository 字段），单独要求 owner 归属
  const mp = readText(".claude-plugin/marketplace.json");
  assert.ok(mp.includes("https://github.com/xiaoidev"));
  assert.ok(!mp.includes("jnMetaCode"));

  const withUrls = [
    ".claude-plugin/plugin.json",
    ".cursor-plugin/plugin.json",
    ".codex-plugin/plugin.json",
    ".kimi-plugin/plugin.json",
  ];
  for (const rel of withUrls) {
    const text = readText(rel);
    assert.ok(
      text.includes("xiaoidev/jev-superpowers-zh"),
      `${rel}: 缺少 xiaoidev 仓库 URL`,
    );
    assert.ok(!text.includes("jnMetaCode/superpowers-zh"), `${rel}: 残留旧 URL`);
  }
});

test("codex 清单不引用缺失资产，composerIcon 实物存在", () => {
  const codex = JSON.parse(readText(".codex-plugin/plugin.json"));
  assert.ok(!("logo" in codex.interface), "app-icon.png 资产不存在，不得声明 logo");
  assert.equal(codex.interface.composerIcon, "./assets/superpowers-small.svg");
  assert.ok(exists("assets/superpowers-small.svg"), "composerIcon 资产缺失");
  assert.deepEqual(codex.hooks, {}, "codex 不接线 Claude 式 hooks");
});

test("cursor/kimi 清单的技术字段与实物对齐", () => {
  const cursor = JSON.parse(readText(".cursor-plugin/plugin.json"));
  assert.equal(cursor.skills, "./skills/");
  assert.equal(cursor.hooks, "./hooks/hooks-cursor.json");
  assert.ok(exists("hooks/hooks-cursor.json"));
  assert.ok(exists("skills"));

  const kimi = JSON.parse(readText(".kimi-plugin/plugin.json"));
  assert.equal(kimi.sessionStart.skill, "jev-using-superpowers");
  assert.ok(exists("skills/jev-using-superpowers/SKILL.md"));
  assert.ok(kimi.skillInstructions.includes("AskUserQuestion"));
});

test("marketplace 插件项 source 指向仓根", () => {
  const mp = JSON.parse(readText(".claude-plugin/marketplace.json"));
  assert.equal(mp.plugins[0].source, "./");
  assert.equal(mp.plugins[0].name, "jev-superpowers-zh");
});

test("opencode 插件与 pi 扩展已品牌化且实物存在", async () => {
  assert.ok(exists(".opencode/plugins/superpowers.js"));
  assert.ok(exists(".pi/extensions/superpowers.ts"));
  assert.ok(exists(".codex/INSTALL.md"));

  const pi = readText(".pi/extensions/superpowers.ts");
  assert.match(pi, /jev-superpowers-zh:jev-using-superpowers bootstrap for pi/);
  assert.match(pi, /jev-using-superpowers["']?,?\s*["']?SKILL\.md/);
  assert.ok(!pi.includes("superpowers:using-superpowers"), "pi 扩展残留旧哨兵");

  const install = readText(".codex/INSTALL.md");
  assert.ok(install.includes("xiaoidev/jev-superpowers-zh"));
  // 迁移说明可以提及上游 jnMetaCode 归属，但克隆 URL 必须指向本仓
  assert.ok(!install.includes("jnMetaCode/superpowers-zh.git"), "INSTALL 克隆地址仍指旧仓");

  // 插件为 ESM，default 必须是函数（index.js 以 default 形式再导出）
  const mod = await import(new URL("../../.opencode/plugins/superpowers.js", import.meta.url));
  assert.equal(typeof mod.default, "function");
  const pluginText = readText(".opencode/plugins/superpowers.js");
  assert.ok(pluginText.includes("jev-using-superpowers"));
});

test("sync 脚本 --check 与 package.json 一致时 exit 0", () => {
  const r = spawnSync(
    process.execPath,
    ["scripts/sync-plugin-version.js", "--check"],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(r.status, 0, `--check stderr:\n${r.stderr}\n${r.stdout}`);
});

test("sync 脚本 --check 发现漂移时 exit 1 且不写盘", () => {
  // 用临时副本仓库无法做到（TARGETS 按脚本自身位置解析），改为直接校验
  // 未知参数 exit 64，保证 CI 拼错参数不会静默通过。
  const r = spawnSync(
    process.execPath,
    ["scripts/sync-plugin-version.js", "--write"],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(r.status, 64);
});

// ---------------------------------------------------------------------------
// package.json files 收口：每个分发根实物存在；禁止发布 tests/、.jevzh/、
// docs/superpowers/（整合工程自己的计划/规格）。
// ---------------------------------------------------------------------------
test("files 数组每个条目在仓内都有实物", () => {
  for (const entry of pkg.files) {
    if (entry.endsWith("/")) {
      const stat = fs.statSync(path.join(root, entry), { throwIfNoEntry: false });
      assert.ok(stat && stat.isDirectory(), `${entry} 应为目录`);
    } else if (entry.includes("*")) {
      // 仅支持本仓 files 里用到的简单 glob：dir/*.ext（非递归）
      const m = /^(.+)\/\*(\.[^/]+)$/.exec(entry);
      assert.ok(m, `不支持的 glob 形式: ${entry}`);
      const [, dir, ext] = m;
      const absDir = path.join(root, dir);
      const files = fs
        .readdirSync(absDir, { withFileTypes: true })
        .filter((d) => d.isFile() && d.name.endsWith(ext))
        .map((d) => d.name);
      assert.ok(files.length > 0, `${entry}: 无匹配文件`);
      for (const f of files) {
        assert.ok(!f.includes("/"), `${entry}: glob 不得递归`);
      }
    } else {
      assert.ok(exists(entry), `files 条目悬空: ${entry}`);
    }
  }
});

test("main 与 index.js 指向的 opencode 插件实物存在", () => {
  assert.ok(exists(pkg.main), `main 悬空: ${pkg.main}`);
  assert.ok(exists("index.js"));
});

test("files 不收 tests/、.jevzh/、docs/superpowers/", () => {
  const forbidden = ["tests/", "tests", ".jevzh/", ".jevzh", "docs/", "docs"];
  for (const bad of forbidden) {
    assert.ok(
      !pkg.files.includes(bad),
      `files 不得包含 ${bad}（docs 用 docs/*.md 收窄到顶层）`,
    );
  }
  const docsEntry = pkg.files.find((f) => f.startsWith("docs"));
  assert.equal(docsEntry, "docs/*.md");
  // docs/*.md 实际匹配结果不得混入 superpowers 子目录内容
  const topDocs = fs
    .readdirSync(path.join(root, "docs"), { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith(".md"))
    .map((d) => d.name);
  for (const required of [
    "jev-gate.md",
    "CONFIDENCE.zh.md",
    "FOSS_LAYA.zh.md",
    "README.codex.md",
  ]) {
    assert.ok(topDocs.includes(required), `docs/*.md 应发布 ${required}`);
  }
});

test("version 钩子的 git add 清单覆盖全部六个版本化清单", () => {
  const hook = pkg.scripts.version;
  for (const rel of VERSIONED_MANIFESTS.map(([r]) => r)) {
    assert.ok(hook.includes(rel), `version 钩子漏加: ${rel}`);
  }
  assert.ok(pkg.scripts["check:version"].includes("--check"));
});
