#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { parseArgs, UsageError } from "./args.js";
import { formatReport } from "./reporter.js";
import { runTests } from "./runner.js";
import { safeText } from "./safety.js";

const manifest = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };
const VERSION = manifest.version;

function safeInternalMessage(value: string): string {
  return Buffer.from(safeText(value))
    .subarray(0, 8 * 1024)
    .toString("utf8")
    .replace(/\uFFFD$/u, "");
}

const HELP = `node-tester ${VERSION}

Uso:
  node-tester [rutas...] [opciones] [-- argumentos-del-test]

Opciones:
  --glob <patrón>          Ejecuta archivos que coincidan con un glob (repetible)
  --name <regex>           Incluye tests cuyo nombre coincida
  --skip <regex>           Excluye tests cuyo nombre coincida
  --only                   Ejecuta tests marcados con only
  --concurrency <n>        Número máximo de archivos en paralelo
  --test-timeout <tiempo>  Timeout por test; admite ms, s y m (30s)
  --run-timeout <tiempo>   Timeout global de la ejecución (15m)
  --max-output-kb <n>      Límite conjunto de stdout/stderr (64 KiB)
  --node <ruta>            Ejecutable Node.js que usará el motor Rust
  --node-arg <argumento>   Argumento Node para los procesos de test (repetible)
  --show-output            Muestra la salida capturada
  --no-color               Desactiva colores ANSI
  -h, --help               Muestra esta ayuda
  -V, --version            Muestra la versión
`;

async function main(): Promise<number> {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(HELP);
      return 0;
    }
    if (options.version) {
      process.stdout.write(`${VERSION}\n`);
      return 0;
    }

    const controller = new AbortController();
    // Repeated signals must not bypass the engine's process-group cleanup.
    const interrupt = () => controller.abort();
    process.on("SIGINT", interrupt);
    process.on("SIGTERM", interrupt);
    const result = await runTests({
      ...options,
      signal: controller.signal,
    }).finally(() => {
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", interrupt);
    });
    const useColor =
      options.color &&
      process.stdout.isTTY === true &&
      process.env.NO_COLOR === undefined;
    process.stdout.write(formatReport(result, useColor, options.showOutput));
    return result.cancelled
      ? 130
      : result.timedOut
        ? 124
        : result.success
          ? 0
          : 1;
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(
        `node-tester: ${safeInternalMessage(error.message)}\nUsa --help para ver las opciones.\n`,
      );
      return 2;
    }
    const message = safeInternalMessage(
      error instanceof Error ? error.message : String(error),
    );
    process.stderr.write(`node-tester: error interno: ${message}\n`);
    return 2;
  }
}

process.exitCode = await main();
