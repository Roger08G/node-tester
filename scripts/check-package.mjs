import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const targets = {
  "win32-x64": "win32-x64-msvc",
  "win32-arm64": "win32-arm64-msvc",
  "linux-x64": "linux-x64-gnu",
  "linux-arm64": "linux-arm64-gnu",
  "darwin-x64": "darwin-x64",
  "darwin-arm64": "darwin-arm64",
};

const target = targets[`${process.platform}-${process.arch}`];
if (!target)
  throw new Error(
    `Unsupported package-check platform: ${process.platform}-${process.arch}`,
  );

const required = [
  new URL("../dist/cli.js", import.meta.url),
  new URL("../runtime/node-test-bridge.mjs", import.meta.url),
  new URL(`../native/node-tester-engine.${target}.node`, import.meta.url),
];

for (const url of required) {
  const path = fileURLToPath(url);
  if (!existsSync(path) || statSync(path).size === 0)
    throw new Error(`Missing package artifact: ${path}`);
}

process.stdout.write(`Package artifacts ready for ${target}.\n`);
