import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

interface NativeExecution {
  execute(): Promise<string>;
  cancel(): void;
}

interface NativeBinding {
  NativeExecution: new (optionsJson: string) => NativeExecution;
  engineVersion(): string;
}

const TARGETS: Readonly<Record<string, string>> = {
  "win32-x64": "win32-x64-msvc",
  "win32-arm64": "win32-arm64-msvc",
  "linux-x64": "linux-x64-gnu",
  "linux-arm64": "linux-arm64-gnu",
  "darwin-x64": "darwin-x64",
  "darwin-arm64": "darwin-arm64",
};

let loaded: NativeBinding | undefined;

function binding(): NativeBinding {
  if (loaded) return loaded;
  const target = TARGETS[`${process.platform}-${process.arch}`];
  if (!target) {
    throw new Error(
      `Plataforma no soportada por node-tester: ${process.platform}-${process.arch}.`,
    );
  }

  const binary = fileURLToPath(
    new URL(`../native/node-tester-engine.${target}.node`, import.meta.url),
  );
  if (!existsSync(binary)) {
    throw new Error(
      `No se encontró el motor Rust para ${target}. Reinstala el paquete o ejecuta "bun run build:native".`,
    );
  }

  const require = createRequire(import.meta.url);
  loaded = require(binary) as NativeBinding;
  return loaded;
}

export function createNativeExecution(optionsJson: string): NativeExecution {
  return new (binding().NativeExecution)(optionsJson);
}

export function engineVersion(): string {
  return binding().engineVersion();
}
