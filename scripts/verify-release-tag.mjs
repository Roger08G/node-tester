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
if (!/^v\d+\.\d+\.\d+$/u.test(tag)) {
  throw new Error("Production releases require a stable vX.Y.Z tag.");
}
const workspace = readFileSync(
  new URL("../Cargo.toml", import.meta.url),
  "utf8",
);
const rustVersion = /^version\s*=\s*"([^"]+)"/mu.exec(workspace)?.[1];
if (rustVersion !== manifest.version) {
  throw new Error("Rust workspace and npm package versions must match.");
}
process.stdout.write(`Release tag ${tag} matches package version.\n`);
