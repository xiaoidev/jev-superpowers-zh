import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
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

test("sync --check 真实漂移：exit 1 不写盘，写入模式同步全部 6 个清单", () => {
  // 通过 --root 在临时副本里跑：脚本支持 --root <dir> 后，清单根可指向任意目录。
  // node --test 会并发跑多个测试文件，篡改仓内清单会与其他文件竞争且污染工作树；
  // 每个用例独占一个 mkdtemp 目录，天然并发安全，finally 清理后不留痕迹。
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jevzh-sync-"));
  const script = path.join(root, "scripts", "sync-plugin-version.js");
  const run = (extraArgs) =>
    spawnSync(
      process.execPath,
      [script, ...extraArgs, "--root", tmp],
      { cwd: root, encoding: "utf8" },
    );
  try {
    // package.json 升到 9.9.9，6 个清单全部停留在 0.0.1（构造真实漂移）
    fs.writeFileSync(
      path.join(tmp, "package.json"),
      `${JSON.stringify({ version: "9.9.9" }, null, 2)}\n`,
    );
    const seed = {
      ".claude-plugin/plugin.json": { version: "0.0.1" },
      ".cursor-plugin/plugin.json": { version: "0.0.1" },
      ".codex-plugin/plugin.json": { version: "0.0.1" },
      ".kimi-plugin/plugin.json": { version: "0.0.1" },
      "gemini-extension.json": { version: "0.0.1" },
      ".claude-plugin/marketplace.json": {
        plugins: [{ name: "jev-superpowers-zh", version: "0.0.1" }],
      },
    };
    for (const [rel, json] of Object.entries(seed)) {
      fs.mkdirSync(path.join(tmp, path.dirname(rel)), { recursive: true });
      fs.writeFileSync(path.join(tmp, rel), `${JSON.stringify(json, null, 2)}\n`);
    }

    // 1) --check：有漂移 exit 1，且清单保持篡改后的 0.0.1（校验模式绝不写盘）
    const check = run(["--check"]);
    assert.equal(
      check.status,
      1,
      `漂移时应 exit 1\nstdout:${check.stdout}\nstderr:${check.stderr}`,
    );
    for (const [rel] of VERSIONED_MANIFESTS) {
      const text = fs.readFileSync(path.join(tmp, rel), "utf8");
      assert.ok(text.includes("0.0.1"), `${rel}: --check 不得改写文件`);
      assert.ok(!text.includes("9.9.9"), `${rel}: --check 不得改写文件`);
    }

    // 2) 写入模式：exit 0，6 个清单全部同步到 package.json 的 9.9.9
    const write = run([]);
    assert.equal(
      write.status,
      0,
      `写入模式应 exit 0\nstdout:${write.stdout}\nstderr:${write.stderr}`,
    );
    for (const [rel, getVersion] of VERSIONED_MANIFESTS) {
      const json = JSON.parse(fs.readFileSync(path.join(tmp, rel), "utf8"));
      assert.equal(getVersion(json), "9.9.9", `${rel}: 写入模式应同步版本`);
    }

    // 3) 同步后再 --check：exit 0
    const recheck = run(["--check"]);
    assert.equal(recheck.status, 0, `同步后应一致 exit 0\nstderr:${recheck.stderr}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("sync 脚本拒绝未知参数、缺值 --root 与无 package.json 的根（exit 64）", () => {
  const spawn = (args) =>
    spawnSync(process.execPath, ["scripts/sync-plugin-version.js", ...args], {
      cwd: root,
      encoding: "utf8",
    });

  // 未知参数 exit 64，保证 CI 拼错参数不会静默通过
  assert.equal(spawn(["--write"]).status, 64);
  // --root 必须带目录值
  assert.equal(spawn(["--root"]).status, 64);
  // --root 指向不存在 package.json 的目录也是用法错误（64），而非未捕获异常（1）
  const missing = path.join(
    os.tmpdir(),
    `jevzh-sync-missing-${process.pid}-${Date.now()}`,
  );
  assert.equal(spawn(["--check", "--root", missing]).status, 64);
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

// 反向断言：关键分发根缺一个都不行（files 只能收窄，不能漏掉运行时必需品）。
test("files 必须包含关键分发根，pkg.bin 目标与各 glob 实物齐备", () => {
  const requiredEntries = [
    "bin/",
    "scripts/",
    "hooks/",
    "skills/",
    ".opencode/",
    ".pi/extensions/",
    ".claude-plugin/",
    ".cursor-plugin/",
    ".codex-plugin/",
    ".kimi-plugin/",
    ".codex/INSTALL.md",
    "gemini-extension.json",
    ".jevzh.json.example",
    "docs/*.md",
  ];
  for (const entry of requiredEntries) {
    assert.ok(pkg.files.includes(entry), `files 缺少关键分发条目: ${entry}`);
  }

  // pkg.bin 的 jevzh 命令必须指向仓内真实文件
  assert.equal(pkg.bin?.jevzh, "bin/jevzh.js");
  assert.ok(exists(pkg.bin.jevzh), `bin 目标悬空: ${pkg.bin.jevzh}`);

  // 六个版本化插件清单实物都在（由上面的目录/文件条目覆盖进发布包）
  for (const [rel] of VERSIONED_MANIFESTS) {
    assert.ok(exists(rel), `版本化清单实物缺失: ${rel}`);
  }

  // 每个 glob 条目至少命中一个实文件（files 写了 glob 但零命中等于漏发）
  for (const entry of pkg.files.filter((f) => f.includes("*"))) {
    const m = /^(.+)\/\*(\.[^/]+)$/.exec(entry);
    assert.ok(m, `不支持的 glob 形式: ${entry}`);
    const [, dir, ext] = m;
    const hits = fs
      .readdirSync(path.join(root, dir), { withFileTypes: true })
      .filter((d) => d.isFile() && d.name.endsWith(ext));
    assert.ok(hits.length > 0, `${entry}: glob 未命中任何实文件`);
  }

  // skills/ 整目录发布：必须恰好 27 个技能（21 中文 + 6 jev-*），每个带 SKILL.md
  const skillDirs = fs
    .readdirSync(path.join(root, "skills"), { withFileTypes: true })
    .filter((d) => d.isDirectory());
  assert.equal(skillDirs.length, 27, "skills 应分发 27 个技能目录");
  for (const d of skillDirs) {
    assert.ok(
      exists(path.join("skills", d.name, "SKILL.md")),
      `skills/${d.name} 缺 SKILL.md`,
    );
  }
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
