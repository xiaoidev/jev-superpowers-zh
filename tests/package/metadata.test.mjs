import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const root = new URL("../../", import.meta.url);

const pkg = JSON.parse(fs.readFileSync(new URL("package.json", root), "utf8"));

test("package exposes jevzh", () => {
  assert.equal(pkg.name, "jev-superpowers-zh");
  assert.equal(pkg.bin.jevzh, "bin/jevzh.js");
  assert.equal(pkg.engines.node, ">=20.0.0");
});

test("config template uses local-first defaults", () => {
  const config = JSON.parse(
    fs.readFileSync(new URL(".jevzh.json.example", root), "utf8"),
  );
  assert.deepEqual(config, {
    backend: "auto",
    strict: false,
    baseUrl: "http://127.0.0.1:8000",
    tools: {},
  });
});
