import { fileURLToPath } from "node:url";
import { createNativeExecution } from "./native.js";
import type { RunTestsOptions, TestRunResult } from "./types.js";

const DEFAULT_TEST_TIMEOUT_MS = 30_000;
const DEFAULT_RUN_TIMEOUT_MS = 15 * 60_000;
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;
const PROTOCOL_VERSION = 1;

function assertNodeRuntime(): void {
  if (process.release.name !== "node") {
    throw new Error(
      "node-tester debe ejecutarse con Node.js; Bun y otros runtimes no están soportados.",
    );
  }
}

function parseResult(json: string): TestRunResult {
  const result = JSON.parse(json) as Partial<TestRunResult>;
  if (result.engine !== "rust" || result.protocolVersion !== PROTOCOL_VERSION) {
    throw new Error(
      "El motor Rust devolvió una versión de protocolo incompatible.",
    );
  }
  if (!result.counts || !Array.isArray(result.tests) || !result.output) {
    throw new Error("El motor Rust devolvió un resultado incompleto.");
  }
  return result as TestRunResult;
}

export async function runTests(
  options: RunTestsOptions = {},
): Promise<TestRunResult> {
  assertNodeRuntime();
  for (const [name, maximum] of [
    ["concurrency", 1024],
    ["testTimeoutMs", 604_800_000],
    ["runTimeoutMs", 604_800_000],
    ["maxOutputBytes", 64 * 1024 * 1024],
  ] as const) {
    const value = options[name];
    if (
      value !== undefined &&
      (!Number.isSafeInteger(value) || value < 1 || value > maximum)
    ) {
      throw new Error(`${name} debe ser un entero entre 1 y ${maximum}.`);
    }
  }
  for (const name of [
    "files",
    "globPatterns",
    "testArgs",
    "nodeArgs",
  ] as const) {
    const value = options[name];
    if (
      value !== undefined &&
      (!Array.isArray(value) ||
        value.some((item) => typeof item !== "string" || item.includes("\0")))
    ) {
      throw new Error(`${name} debe ser un array de strings sin bytes nulos.`);
    }
  }
  if (options.files?.length && options.globPatterns?.length) {
    throw new Error("files y globPatterns son mutuamente excluyentes.");
  }

  const execution = createNativeExecution(
    JSON.stringify({
      nodePath: options.nodePath ?? process.execPath,
      bridgePath: fileURLToPath(
        new URL("../runtime/node-test-bridge.mjs", import.meta.url),
      ),
      cwd: options.cwd ?? process.cwd(),
      files: options.files ?? [],
      globPatterns: options.globPatterns ?? [],
      concurrency: options.concurrency,
      testTimeoutMs: options.testTimeoutMs ?? DEFAULT_TEST_TIMEOUT_MS,
      runTimeoutMs: options.runTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS,
      maxOutputBytes: options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
      namePattern: options.namePattern,
      skipPattern: options.skipPattern,
      only: options.only ?? false,
      testArgs: options.testArgs ?? [],
      nodeArgs: options.nodeArgs ?? [],
    }),
  );

  const cancel = () => execution.cancel();
  if (options.signal?.aborted) cancel();
  else options.signal?.addEventListener("abort", cancel, { once: true });

  try {
    return parseResult(await execution.execute());
  } finally {
    options.signal?.removeEventListener("abort", cancel);
  }
}
