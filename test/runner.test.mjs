import assert from "node:assert/strict";
import { test } from "node:test";
import { engineVersion, runTests } from "../dist/index.js";

test("loads the Rust Node-API engine", () => {
  assert.equal(engineVersion(), "1.0.0");
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
