import { readFileSync } from "node:fs";

const manifest = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const tag = process.env.GITHUB_REF_NAME ?? process.argv[2];
if (!tag) throw new Error("Release tag is required.");
if (tag !== `v${manifest.version}`) {
  throw new Error(
    `Tag ${tag} does not match package version ${manifest.version}.`,
  );
}
process.stdout.write(`Release tag ${tag} matches package version.\n`);
