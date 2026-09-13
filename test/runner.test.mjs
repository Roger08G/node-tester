import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { engineVersion, runTests } from "../dist/index.js";

test("loads the Rust Node-API engine", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(engineVersion(), manifest.version);
});

test("cancels an active Rust execution", { timeout: 5_000 }, async () => {
  const controller = new AbortController();
  const pending = runTests({
    files: ["test/fixtures/hanging.test.mjs"],
    testTimeoutMs: 5_000,
    runTimeoutMs: 4_000,
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 100).unref();
  const result = await pending;
  assert.equal(result.engine, "rust");
  assert.equal(result.cancelled, true);
  assert.equal(result.success, false);
});

test("rejects invalid numeric library options instead of JSON-coercing them", async () => {
  for (const concurrency of [NaN, Infinity, -1, 0, 1025, 1.5, null]) {
    await assert.rejects(runTests({ concurrency }), /concurrency/u);
  }
});

test("executes duplicate explicit files once", async () => {
  const result = await runTests({
    files: [
      "test/fixtures/passing.test.mjs",
      "./test/fixtures/passing.test.mjs",
    ],
  });
  assert.equal(result.success, true);
  assert.equal(result.counts.tests, 1);
});

test("keeps failed suites visible without counting them as extra tests", async () => {
  const result = await runTests({
    files: ["test/fixtures/suite-hook.test.mjs"],
  });
  assert.equal(result.success, false);
  assert.equal(result.counts.tests, 1);
  assert.ok(
    result.tests.some(
      (item) => item.isSuite && item.error.includes("suite cleanup failed"),
    ),
  );
});

test("an already-aborted request does not start the configured executable", async () => {
  const result = await runTests({
    files: ["test/fixtures/passing.test.mjs"],
    nodePath: "this-executable-does-not-exist-node-tester",
    signal: AbortSignal.abort(),
  });
  assert.equal(result.cancelled, true);
  assert.equal(result.success, false);
});

test("name and skip patterns preserve native skipped test semantics", async () => {
  const result = await runTests({
    files: ["test/fixtures/mixed.test.mjs"],
    namePattern: "passes|fails",
    skipPattern: "fails",
  });
  assert.equal(result.success, true);
  assert.equal(result.counts.passed, 1);
  assert.equal(result.counts.failed, 0);
});
