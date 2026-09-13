import { homedir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { TestResult, TestRunResult, TestStatus } from "./types.js";
import { safeText } from "./safety.js";

interface Palette {
  bold: (value: string) => string;
  dim: (value: string) => string;
  green: (value: string) => string;
  red: (value: string) => string;
  yellow: (value: string) => string;
  cyan: (value: string) => string;
}

function wrap(
  open: number,
  close: number,
  enabled: boolean,
): (value: string) => string {
  return enabled
    ? (value) => `\u001B[${open}m${value}\u001B[${close}m`
    : (value) => value;
}

function palette(enabled: boolean): Palette {
  return {
    bold: wrap(1, 22, enabled),
    dim: wrap(2, 22, enabled),
    green: wrap(32, 39, enabled),
    red: wrap(31, 39, enabled),
    yellow: wrap(33, 39, enabled),
    cyan: wrap(36, 39, enabled),
  };
}

function label(status: TestStatus, colors: Palette): string {
  switch (status) {
    case "passed":
      return colors.green("PASS".padEnd(8));
    case "failed":
      return colors.red("FAIL".padEnd(8));
    case "skipped":
      return colors.yellow("SKIP".padEnd(8));
    case "todo":
      return colors.cyan("TODO".padEnd(8));
    case "cancelled":
      return colors.red("CANCEL".padEnd(8));
  }
}

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1) return `${milliseconds.toFixed(2)}ms`;
  if (milliseconds < 1_000) return `${milliseconds.toFixed(0)}ms`;
  return `${(milliseconds / 1_000).toFixed(2)}s`;
}

function displayPath(file: string): string {
  const absolute = resolve(file);
  const project = resolve(process.cwd());
  const withinProject = relative(project, absolute);
  if (
    withinProject &&
    withinProject !== ".." &&
    !withinProject.startsWith(`..${sep}`) &&
    !isAbsolute(withinProject)
  ) {
    return withinProject.replaceAll("\\", "/");
  }
  const homeRelative = relative(resolve(homedir()), absolute);
  return homeRelative === ".." ||
    homeRelative.startsWith(`..${sep}`) ||
    isAbsolute(homeRelative)
    ? "<external>"
    : `<home>/${homeRelative.replaceAll("\\", "/")}`;
}

function displayName(test: TestResult): string {
  if (
    test.location.file &&
    resolve(test.name) === resolve(test.location.file)
  ) {
    return displayPath(test.location.file);
  }
  return test.name;
}

function location(test: TestResult): string | undefined {
  if (!test.location.file) return undefined;
  const suffix =
    test.location.line === undefined
      ? ""
      : `:${test.location.line}${test.location.column === undefined ? "" : `:${test.location.column}`}`;
  return `${displayPath(test.location.file)}${suffix}`;
}

export function formatReport(
  result: TestRunResult,
  color = true,
  showOutput = false,
): string {
  const colors = palette(color);
  const lines = [
    colors.bold("node-tester"),
    colors.dim(`motor Rust | Node.js ${safeText(result.nodeVersion, true)}`),
    "",
  ];

  for (const test of result.tests) {
    const indent = "  ".repeat(Math.min(32, Math.max(0, test.nesting)));
    lines.push(
      `${indent}${label(test.status, colors)} ${safeText(displayName(test), true)} ${colors.dim(formatDuration(test.durationMs))}`,
    );
    const source = location(test);
    if (source)
      lines.push(`${indent}         ${colors.dim(safeText(source, true))}`);
    if (test.error) {
      for (const errorLine of safeText(test.error).split(/\r?\n/u))
        lines.push(`${indent}         ${colors.red(errorLine)}`);
    }
  }

  const counts = result.counts;
  lines.push("");
  lines.push(
    `${result.success ? colors.green("PASS") : colors.red("FAIL")}  ` +
      `${counts.tests} tests | ${colors.green(`${counts.passed} passed`)} | ` +
      `${colors.red(`${counts.failed} failed`)} | ${colors.yellow(`${counts.skipped} skipped`)} | ` +
      `${colors.cyan(`${counts.todo} todo`)} | ${formatDuration(result.durationMs)}`,
  );

  if (result.timedOut)
    lines.push(
      colors.red("La ejecución superó el timeout global y fue cancelada."),
    );
  if (result.cancelled)
    lines.push(
      colors.yellow("La ejecución fue cancelada por una señal externa."),
    );
  if (result.output.truncated)
    lines.push(colors.yellow("La salida fue truncada al límite configurado."));

  if (showOutput && (result.output.stdout || result.output.stderr)) {
    lines.push("", colors.bold("Salida capturada"));
    if (result.output.stdout)
      lines.push(
        colors.dim("stdout:"),
        safeText(result.output.stdout).trimEnd(),
      );
    if (result.output.stderr)
      lines.push(
        colors.dim("stderr:"),
        safeText(result.output.stderr).trimEnd(),
      );
  }

  return `${lines.join("\n")}\n`;
}
