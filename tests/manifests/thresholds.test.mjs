import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

// 文档阈值与门禁源码交叉锁定：数字只允许从脚本里"提取"，再到文档中验证，
// 避免文档与 scripts/jev-gate 各写一套后悄悄漂移。
const root = new URL("../../", import.meta.url);
const readText = (rel) =>
  fs.readFileSync(new URL(rel, root), "utf8").replace(/\r\n/g, "\n");

const gate = readText("scripts/jev-gate");
const gateDoc = readText("docs/jev-gate.md");
const confidenceDoc = readText("docs/CONFIDENCE.zh.md");

// scripts/jev-gate 实际硬编码的四个阈值
const GATE_CONSTANTS = [
  { token: "0.80", source: /c>=0\.80/ },
  { token: "0.50", source: /c>=0\.50/ },
  { token: "0.70", source: />0\.70/ },
  { token: "0.90", source: /q_float_gt "\$QNUM" 0\.90/ },
];

test("jev-gate 源码含四个权威阈值常量", () => {
  for (const { token, source } of GATE_CONSTANTS) {
    assert.match(gate, source, `源码缺少阈值 ${token}`);
  }
});

test("jev-gate 文档逐字收录源码全部阈值", () => {
  for (const { token } of GATE_CONSTANTS) {
    assert.ok(gateDoc.includes(token), `docs/jev-gate.md 缺少阈值 ${token}`);
  }
});

test("pick 三档与 exit 3 人工破平在源码和文档中一致", () => {
  assert.match(gate, /c>=0\.80\?"A":\(c>=0\.50\?"B":"C"\)/);
  assert.match(gate, /exit 3/);
  for (const token of ["0.80", "0.50", "exit 3", "人工破平"]) {
    assert.ok(gateDoc.includes(token), `jev-gate.md 缺少 ${token}`);
  }
});

test("check-hypothesis 严格大于 0.70 的边界语义有文档", () => {
  // 源码：Number(p)>0.70
  assert.match(gate, />0\.70\?0:1/);
  assert.ok(gateDoc.includes("p > 0.70"));
  assert.ok(gateDoc.includes("0.70 本身"));
});

test("deep_nesting 严格大于 0.90（0.90 通过）双侧一致", () => {
  assert.match(gate, /q_float_gt "\$QNUM" 0\.90/);
  assert.ok(gateDoc.includes("0.90 本身通过"));
});

test("commit 门的字面 [PASS] 要求双侧一致", () => {
  assert.match(gate, /grep -Fq '\[PASS\]'/);
  assert.ok(gateDoc.includes("`[PASS]`"));
  // CONFIDENCE 上游表：[PASS] 且 p < 0.10
  assert.ok(confidenceDoc.includes("[PASS]"));
  assert.ok(confidenceDoc.includes("p < 0.10"));
});

test("CONFIDENCE 中文表保留上游全部数字", () => {
  for (const token of ["0.80", "0.50", "0.70", "0.10", "0.56", "0.44"]) {
    assert.ok(confidenceDoc.includes(token), `CONFIDENCE.zh.md 缺少 ${token}`);
  }
  assert.ok(confidenceDoc.includes("verdict: block"));
  assert.ok(confidenceDoc.includes("STOP"));
});

test("guard 保守否决与 block 永否的规则双侧一致", () => {
  assert.match(gate, /verdict:\[\[:space:\]\]\*block/i);
  assert.ok(gateDoc.includes("verdict: block"));
  assert.ok(gateDoc.includes("保守否决"));
});

test("FOSS 文档的桥端点与源码一致", () => {
  const py = readText("scripts/serve-laya.py");
  const foss = readText("docs/FOSS_LAYA.zh.md");
  for (const token of ["/health", "/v1/models", "/v1/systemone", "127.0.0.1", "8000"]) {
    assert.ok(py.includes(token), `serve-laya.py 缺少 ${token}`);
    assert.ok(foss.includes(token), `FOSS_LAYA.zh.md 缺少 ${token}`);
  }
  for (const token of ["laya-421m", "convaiinnovations", "Apache-2.0", "laya-heuristic-fallback"]) {
    assert.ok(py.includes(token));
    assert.ok(foss.includes(token), `FOSS_LAYA.zh.md 缺少 ${token}`);
  }
});
