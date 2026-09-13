import { homedir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { stripVTControlCharacters } from "node:util";

export function safeText(value: string, singleLine = false): string {
  let text = stripVTControlCharacters(value);
  for (const [directory, label] of [
    [resolve(process.cwd()), "<project>"],
    [resolve(homedir()), "<home>"],
  ] as const) {
    text = text
      .replaceAll(
        pathToFileURL(directory).href.replace(/\/$/u, ""),
        `file:///${label}`,
      )
      .replaceAll(directory, label)
      .replaceAll(directory.replaceAll("\\", "/"), label);
  }
  text = text.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/gu, "");
  return singleLine ? text.replace(/[\n\t\u2028\u2029]/gu, " ") : text;
}
