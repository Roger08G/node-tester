import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const targets = [
  "win32-x64-msvc",
  "win32-arm64-msvc",
  "linux-x64-gnu",
  "linux-arm64-gnu",
  "darwin-x64",
  "darwin-arm64",
];

for (const target of targets) {
  const path = fileURLToPath(
    new URL(`../native/node-tester-engine.${target}.node`, import.meta.url),
  );
  if (!existsSync(path) || statSync(path).size < 100_000) {
    throw new Error(`Missing or invalid native release artifact: ${target}`);
  }
}

process.stdout.write(`Verified ${targets.length} native release artifacts.\n`);
