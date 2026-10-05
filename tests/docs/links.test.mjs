import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

// cwd 无关：所有路径基于本测试文件位置解析。
const root = new URL("../../", import.meta.url);
const readText = (rel) =>
  fs.readFileSync(new URL(rel, root), "utf8").replace(/\r\n/g, "\n");

test("README 覆盖全部公开迁移控制开关", () => {
  const readme = readText("README.md");
  for (const token of [
    "jevzh",
    "27",
    "--no-jev",
    "--strict",
    "--adopt-skills",
    "--keep-router",
    "--detect-only",
    "doctor",
    "restore",
  ]) {
    assert.match(readme, new RegEscaped(token), `README 缺少 token: ${token}`);
  }
});

test("jev-gate 文档覆盖四态、两类失败与云端配置变量", () => {
  const gate = readText("docs/jev-gate.md");
  for (const token of [
    "FULL",
    "LOCAL",
    "PARTIAL",
    "DEGRADED",
    "判定型失败",
    "环境型失败",
    "TYPESAFE_API_KEY",
    "TYPESAFE_BASE_URL",
  ]) {
    assert.match(gate, new RegEscaped(token), `jev-gate.md 缺少 token: ${token}`);
  }
});

test("三篇核心中文文档存在且非空", () => {
  for (const rel of [
    "docs/jev-gate.md",
    "docs/CONFIDENCE.zh.md",
    "docs/FOSS_LAYA.zh.md",
  ]) {
    const text = readText(rel);
    assert.ok(text.length > 500, `${rel} 内容过短`);
  }
});

test("26 篇宿主文档全部存在", () => {
  const hosts = [
    "aider", "antigravity", "claw", "cline", "codearts", "codebuddy",
    "codex", "crush", "deepseek-harness", "deerflow", "gemini-cli",
    "hermes", "kilocode", "kimi", "kiro", "openclaw", "opencode", "pi",
    "qoder", "qwen", "reasonix", "trae", "trae-cn", "vscode", "windsurf",
    "zcode",
  ];
  for (const host of hosts) {
    assert.ok(
      fs.existsSync(new URL(`docs/README.${host}.md`, root)),
      `docs/README.${host}.md`,
    );
  }
});

function RegEscaped(value) {
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}
