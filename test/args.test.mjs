import assert from "node:assert/strict";
import { test } from "node:test";
import { parseArgs, parseDuration, UsageError } from "../dist/index.js";

test("parseDuration accepts milliseconds, seconds and minutes", () => {
  assert.equal(parseDuration("250ms", "--timeout"), 250);
  assert.equal(parseDuration("1.5s", "--timeout"), 1_500);
  assert.equal(parseDuration("2m", "--timeout"), 120_000);
});

test("parseArgs keeps runner arguments after the separator", () => {
  const options = parseArgs([
    "sample.test.mjs",
    "--concurrency",
    "2",
    "--",
    "--fixture",
    "one",
  ]);
  assert.deepEqual(options.files, ["sample.test.mjs"]);
  assert.equal(options.concurrency, 2);
  assert.deepEqual(options.testArgs, ["--fixture", "one"]);
});

test("parseArgs accepts Node flags as explicit node arguments", () => {
  const options = parseArgs(["--node-arg", "--import", "--node-arg", "tsx"]);
  assert.deepEqual(options.nodeArgs, ["--import", "tsx"]);
});

test("parseArgs rejects files combined with globs", () => {
  assert.throws(
    () => parseArgs(["sample.test.mjs", "--glob", "test/**/*.test.mjs"]),
    UsageError,
  );
});

test("parseArgs rejects unknown options", () => {
  assert.throws(() => parseArgs(["--reporter", "tap"]), /Opción desconocida/u);
});

test("rejects values above engine limits before conversion", () => {
  for (const args of [
    ["--concurrency", "1025"],
    ["--max-output-kb", "65537"],
    ["--max-output-kb", "9007199254740991"],
    ["--run-timeout", "604800001ms"],
  ])
    assert.throws(() => parseArgs(args), UsageError);
});
