import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { promisify } from "node:util";

const run = promisify(execFile);
const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

async function invoke(args) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => key !== "NODE_TEST_CONTEXT" && key !== "NODE_TEST_WORKER_ID",
    ),
  );
  try {
    const result = await run(process.execPath, [cli, ...args], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 5_000,
      windowsHide: true,
      env,
    });
    return { ...result, code: 0 };
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error) {
      return {
        stdout: String(error.stdout ?? ""),
        stderr: String(error.stderr ?? ""),
        code: Number(error.code),
      };
    }
    throw error;
  }
}

test("returns zero and renders a passing native test", async () => {
  const result = await invoke(["test/fixtures/passing.test.mjs", "--no-color"]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /motor Rust/u);
  assert.match(result.stdout, /PASS\s+adds numbers/u);
  assert.match(result.stdout, /1 tests \| 1 passed/u);
});

test("supports ESM, CommonJS and multiple files", async () => {
  const result = await invoke([
    "test/fixtures/passing.test.mjs",
    "test/fixtures/commonjs.test.cjs",
    "--no-color",
  ]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /adds numbers/u);
  assert.match(result.stdout, /runs CommonJS/u);
});

test("forwards arguments after the separator", async () => {
  const result = await invoke([
    "test/fixtures/arguments.test.mjs",
    "--no-color",
    "--",
    "--fixture-value",
  ]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /receives forwarded arguments/u);
});

test("reports compilation errors without exposing the user path", async () => {
  const result = await invoke([
    "test/fixtures/syntax-error.test.mjs",
    "--no-color",
    "--show-output",
  ]);
  assert.equal(result.code, 1);
  assert.match(result.stdout, /FAIL/u);
  assert.match(result.stdout, /SyntaxError/u);
  assert.doesNotMatch(result.stdout, /Roger Gómez/u);
});

test("accepts native glob selection", async () => {
  const result = await invoke([
    "--glob",
    "test/fixtures/passing.test.mjs",
    "--no-color",
  ]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /PASS\s+adds numbers/u);
});

test("returns one and preserves pass, fail, skip and todo states", async () => {
  const result = await invoke(["test/fixtures/mixed.test.mjs", "--no-color"]);
  assert.equal(result.code, 1);
  assert.match(result.stdout, /PASS\s+passes/u);
  assert.match(result.stdout, /FAIL\s+fails/u);
  assert.match(result.stdout, /SKIP\s+is skipped/u);
  assert.match(result.stdout, /TODO\s+is planned/u);
  assert.doesNotMatch(result.stdout, /Roger Gómez/u);
});

test("bounds captured output", async () => {
  const result = await invoke([
    "test/fixtures/output.test.mjs",
    "--no-color",
    "--show-output",
    "--max-output-kb",
    "1",
  ]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /salida fue truncada/iu);
  assert.ok(
    result.stdout.length < 3_000,
    `unexpected output length: ${result.stdout.length}`,
  );
});

test("times out a test that never settles", async () => {
  const result = await invoke([
    "test/fixtures/hanging.test.mjs",
    "--no-color",
    "--test-timeout",
    "100ms",
    "--run-timeout",
    "2s",
  ]);
  assert.equal(result.code, 1);
  assert.match(result.stdout, /FAIL/u);
  assert.match(result.stdout, /test timed out after 100ms/u);
});

test("cancels the complete run at the global timeout", async () => {
  const result = await invoke([
    "test/fixtures/hanging.test.mjs",
    "--no-color",
    "--test-timeout",
    "5s",
    "--run-timeout",
    "100ms",
  ]);
  assert.equal(result.code, 124);
  assert.match(result.stdout, /timeout global/u);
  assert.doesNotMatch(result.stdout, /Roger Gómez/u);
});

test("reports invalid CLI options as usage errors", async () => {
  const result = await invoke(["--unknown"]);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /Opción desconocida/u);
});

test("reports a missing explicit file without requiring captured output", async () => {
  const result = await invoke([
    "test/this-file-does-not-exist.test.mjs",
    "--no-color",
  ]);
  assert.equal(result.code, 2);
  assert.match(
    result.stderr,
    /test file .*this-file-does-not-exist.*not accessible/u,
  );
  assert.doesNotMatch(result.stderr, /Roger Gómez/u);
});

test("shows suite cleanup failures", async () => {
  const result = await invoke([
    "test/fixtures/suite-hook.test.mjs",
    "--no-color",
  ]);
  assert.equal(result.code, 1);
  assert.match(result.stdout, /suite cleanup failed/u);
});

test("neutralizes terminal controls in names, errors and captured output", async () => {
  const result = await invoke([
    "test/fixtures/terminal-output.test.mjs",
    "--no-color",
    "--show-output",
  ]);
  assert.equal(result.code, 1);
  assert.doesNotMatch(result.stdout, /[\u001b\u0007\r]/u);
  assert.match(result.stdout, /safe name forged line/u);
  assert.match(result.stdout, /stdoutcontent/u);
});

test("neutralizes terminal controls in usage errors", async () => {
  const result = await invoke(["--unknown\u001b]52;c;ignored\u0007"]);
  assert.equal(result.code, 2);
  assert.doesNotMatch(result.stderr, /[\u001b\u0007\r]/u);
});
