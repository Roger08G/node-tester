import { once } from "node:events";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { run } from "node:test";
import { pathToFileURL } from "node:url";

const PROTOCOL_VERSION = 1;
const MAX_INPUT_BYTES = 1024 * 1024;
const MAX_NAME_BYTES = 4 * 1024;
const MAX_PATH_BYTES = 16 * 1024;
const MAX_ERROR_BYTES = 8 * 1024;
const MAX_OUTPUT_EVENT_BYTES = 32 * 1024;

function truncateUtf8(value, maximum) {
  const encoded = Buffer.from(String(value));
  if (encoded.byteLength <= maximum)
    return { value: String(value), truncated: false };
  return {
    value: encoded
      .subarray(0, maximum)
      .toString("utf8")
      .replace(/\uFFFD$/u, ""),
    truncated: true,
  };
}

function sanitize(value) {
  const project = resolve(process.cwd());
  const userHome = resolve(homedir());
  const projectUrl = pathToFileURL(project).href.replace(/\/$/u, "");
  const homeUrl = pathToFileURL(userHome).href.replace(/\/$/u, "");
  return String(value)
    .replaceAll(projectUrl, "file:///<project>")
    .replaceAll(homeUrl, "file:///<home>")
    .replaceAll(project, "<project>")
    .replaceAll(project.replaceAll("\\", "/"), "<project>")
    .replaceAll(userHome, "<home>")
    .replaceAll(userHome.replaceAll("\\", "/"), "<home>");
}

function errorText(error) {
  let selected = error;
  for (let depth = 0; depth < 8; depth += 1) {
    if (selected?.cause === null || typeof selected?.cause !== "object") break;
    selected = selected.cause;
  }
  const text =
    typeof selected?.stack === "string"
      ? selected.stack
      : typeof selected?.message === "string"
        ? `${selected.name ?? "Error"}: ${selected.message}`
        : String(selected);
  return truncateUtf8(sanitize(text), MAX_ERROR_BYTES).value;
}

async function emit(event) {
  const line = `${JSON.stringify(event)}\n`;
  if (!process.stdout.write(line)) await once(process.stdout, "drain");
}

async function readConfiguration() {
  process.stdin.setEncoding("utf8");
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
    if (Buffer.byteLength(input) > MAX_INPUT_BYTES) {
      throw new Error(`Bridge input exceeds ${MAX_INPUT_BYTES} bytes.`);
    }
  }
  if (!input.trim()) throw new Error("Bridge input is empty.");
  return JSON.parse(input);
}

function assertConfiguration(options) {
  if (options.protocol_version !== PROTOCOL_VERSION) {
    throw new Error(
      `Unsupported protocol version: ${options.protocol_version}.`,
    );
  }
  if (!Array.isArray(options.files) || !Array.isArray(options.glob_patterns)) {
    throw new Error("files and glob_patterns must be arrays.");
  }
  if (options.files.length > 0 && options.glob_patterns.length > 0) {
    throw new Error("files and glob_patterns are mutually exclusive.");
  }
}

function assertNodeVersion() {
  const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 13)) {
    throw new Error(
      `node-tester requires Node.js 22.13 or newer; found ${process.versions.node}.`,
    );
  }
}

function statusFor(type, data, error) {
  if (data.skip) return "skipped";
  if (data.todo) return "todo";
  if (type === "test:fail" && error?.name === "AbortError") return "cancelled";
  return type === "test:pass" ? "passed" : "failed";
}

async function main() {
  assertNodeVersion();
  const options = await readConfiguration();
  assertConfiguration(options);
  await emit({
    type: "ready",
    protocol_version: PROTOCOL_VERSION,
    node_version: process.versions.node,
  });

  const stream = run({
    ...(options.files.length > 0 ? { files: options.files } : {}),
    ...(options.glob_patterns.length > 0
      ? { globPatterns: options.glob_patterns }
      : {}),
    concurrency: options.concurrency ?? true,
    isolation: "process",
    timeout: options.test_timeout_ms,
    testNamePatterns: options.name_pattern ?? undefined,
    testSkipPatterns: options.skip_pattern ?? undefined,
    only: options.only === true,
    argv: Array.isArray(options.test_args) ? options.test_args : [],
    execArgv: Array.isArray(options.node_args) ? options.node_args : [],
  });

  for await (const event of stream) {
    if (event.type === "test:pass" || event.type === "test:fail") {
      const data = event.data;
      if (data.details.type === "suite") {
        await emit({ type: "suite" });
        continue;
      }
      const error = event.type === "test:fail" ? data.details.error : undefined;
      await emit({
        type: "test",
        name: truncateUtf8(data.name, MAX_NAME_BYTES).value,
        status: statusFor(event.type, data, error),
        duration_ms: data.details.duration_ms,
        nesting: data.nesting,
        file:
          data.file === undefined
            ? null
            : truncateUtf8(data.file, MAX_PATH_BYTES).value,
        line: data.line ?? null,
        column: data.column ?? null,
        error: error === undefined ? null : errorText(error),
      });
      continue;
    }

    if (event.type === "test:stdout" || event.type === "test:stderr") {
      const message = truncateUtf8(
        sanitize(event.data.message),
        MAX_OUTPUT_EVENT_BYTES,
      );
      await emit({
        type: "output",
        stream: event.type === "test:stdout" ? "stdout" : "stderr",
        message: message.value,
        truncated: message.truncated,
      });
      continue;
    }

    if (event.type === "test:summary") {
      await emit({
        type: "summary",
        success: event.data.success,
        counts: {
          tests: event.data.counts.tests ?? 0,
          passed: event.data.counts.passed ?? 0,
          failed: event.data.counts.failed ?? 0,
          skipped: event.data.counts.skipped ?? 0,
          todo: event.data.counts.todo ?? 0,
          cancelled: event.data.counts.cancelled ?? 0,
          suites: event.data.counts.suites ?? 0,
        },
        duration_ms: event.data.duration_ms,
        file: event.data.file ?? null,
      });
    }
  }
}

main().catch(async (error) => {
  try {
    await emit({ type: "fatal", message: errorText(error) });
  } finally {
    process.exitCode = 2;
  }
});
