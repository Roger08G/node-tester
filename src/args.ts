import type { RunTestsOptions } from "./types.js";

export interface CliOptions extends RunTestsOptions {
  color: boolean;
  help: boolean;
  version: boolean;
  showOutput: boolean;
}

const DEFAULT_TEST_TIMEOUT_MS = 30_000;
const DEFAULT_RUN_TIMEOUT_MS = 15 * 60_000;
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;

export class UsageError extends Error {
  override readonly name = "UsageError";
}

function readValue(
  args: readonly string[],
  index: number,
  option: string,
  allowOption = false,
): string {
  const value = args[index + 1];
  if (value === undefined || (!allowOption && value.startsWith("--"))) {
    throw new UsageError(`${option} necesita un valor.`);
  }
  return value;
}

export function parseDuration(value: string, option: string): number {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m)?$/i.exec(value.trim());
  if (!match) {
    throw new UsageError(
      `${option} debe ser una duración como 500ms, 30s o 2m.`,
    );
  }

  const amount = Number(match[1]);
  const unit = match[2]?.toLowerCase() ?? "ms";
  const multiplier = unit === "m" ? 60_000 : unit === "s" ? 1_000 : 1;
  const milliseconds = Math.round(amount * multiplier);

  if (
    !Number.isSafeInteger(milliseconds) ||
    milliseconds < 1 ||
    milliseconds > 604_800_000
  ) {
    throw new UsageError(`${option} debe estar entre 1ms y 7 días.`);
  }

  return milliseconds;
}

function parsePositiveInteger(
  value: string,
  option: string,
  maximum: number,
): number {
  if (!/^\d+$/.test(value)) {
    throw new UsageError(`${option} debe ser un entero positivo.`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new UsageError(`${option} debe ser un entero entre 1 y ${maximum}.`);
  }
  return parsed;
}

export function parseArgs(args: readonly string[]): CliOptions {
  const files: string[] = [];
  const globPatterns: string[] = [];
  const testArgs: string[] = [];
  const nodeArgs: string[] = [];
  const options: CliOptions = {
    files,
    globPatterns,
    testArgs,
    nodeArgs,
    testTimeoutMs: DEFAULT_TEST_TIMEOUT_MS,
    runTimeoutMs: DEFAULT_RUN_TIMEOUT_MS,
    maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
    color: true,
    help: false,
    version: false,
    showOutput: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === undefined) continue;

    if (argument === "--") {
      testArgs.push(...args.slice(index + 1));
      break;
    }
    if (!argument.startsWith("-")) {
      files.push(argument);
      continue;
    }

    switch (argument) {
      case "-h":
      case "--help":
        options.help = true;
        break;
      case "-V":
      case "--version":
        options.version = true;
        break;
      case "--no-color":
        options.color = false;
        break;
      case "--show-output":
        options.showOutput = true;
        break;
      case "--only":
        options.only = true;
        break;
      case "--node":
        options.nodePath = readValue(args, index, argument);
        index += 1;
        break;
      case "--node-arg":
        nodeArgs.push(readValue(args, index, argument, true));
        index += 1;
        break;
      case "--glob":
        globPatterns.push(readValue(args, index, argument));
        index += 1;
        break;
      case "--name":
        options.namePattern = readValue(args, index, argument);
        index += 1;
        break;
      case "--skip":
        options.skipPattern = readValue(args, index, argument);
        index += 1;
        break;
      case "--concurrency":
        options.concurrency = parsePositiveInteger(
          readValue(args, index, argument),
          argument,
          1024,
        );
        index += 1;
        break;
      case "--test-timeout":
        options.testTimeoutMs = parseDuration(
          readValue(args, index, argument),
          argument,
        );
        index += 1;
        break;
      case "--run-timeout":
        options.runTimeoutMs = parseDuration(
          readValue(args, index, argument),
          argument,
        );
        index += 1;
        break;
      case "--max-output-kb":
        options.maxOutputBytes =
          parsePositiveInteger(
            readValue(args, index, argument),
            argument,
            65_536,
          ) * 1024;
        index += 1;
        break;
      default:
        throw new UsageError(`Opción desconocida: ${argument}`);
    }
  }

  if (files.length > 0 && globPatterns.length > 0) {
    throw new UsageError(
      "No se pueden combinar rutas posicionales con --glob.",
    );
  }

  return options;
}
