import assert from "node:assert/strict";
import { test } from "node:test";
import { formatReport } from "../dist/index.js";

function resultWith(testResult) {
  return {
    engine: "rust",
    protocolVersion: 1,
    nodeVersion: "24.18.1",
    success: false,
    timedOut: false,
    cancelled: false,
    durationMs: 1,
    counts: {
      tests: 1,
      passed: 0,
      failed: 1,
      skipped: 0,
      todo: 0,
      cancelled: 0,
      suites: 0,
    },
    tests: [
      {
        name: "safe",
        status: "failed",
        durationMs: 1,
        nesting: 0,
        location: {},
        ...testResult,
      },
    ],
    output: { stdout: "", stderr: "", truncated: false },
  };
}

test("bounds indentation supplied by library callers", () => {
  const text = formatReport(resultWith({ nesting: 4_294_967_295 }), false);
  assert.ok(text.length < 1000);
});

test("sanitizes untrusted caller-provided terminal text", () => {
  const text = formatReport(
    resultWith({ name: "safe\u001b]52;c;ignored\u0007\nforged" }),
    false,
  );
  assert.match(text, /safe forged/u);
  assert.doesNotMatch(text, /[\u001b\u0007]/u);
});

test(
  "hides absolute paths on a different Windows volume",
  { skip: process.platform !== "win32" },
  () => {
    const drive = process.cwd().startsWith("Z:") ? "Y:" : "Z:";
    const text = formatReport(
      resultWith({ location: { file: `${drive}\\private\\outside.test.mjs` } }),
      false,
    );
    assert.match(text, /<external>/u);
    assert.doesNotMatch(text, /private|outside\.test|[YZ]:/u);
  },
);
