import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const outputDirectory = fileURLToPath(new URL("../dist/", import.meta.url));
rmSync(outputDirectory, { force: true, recursive: true });
