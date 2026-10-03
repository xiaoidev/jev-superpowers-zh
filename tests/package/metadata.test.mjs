import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));

test("package exposes jevzh", () => {
  assert.equal(pkg.name, "jev-superpowers-zh");
  assert.equal(pkg.bin.jevzh, "bin/jevzh.js");
  assert.equal(pkg.engines.node, ">=20.0.0");
});

test("config template uses local-first defaults", () => {
  const config = JSON.parse(fs.readFileSync(".jevzh.json.example", "utf8"));
  assert.deepEqual(config, {
    backend: "auto",
    strict: false,
    baseUrl: "http://127.0.0.1:8000",
    tools: {},
  });
});
