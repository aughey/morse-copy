import { cp, mkdir, readFile, rm, writeFile, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = resolve(root, "dist");
const output = resolve(root, "_site");

// Keep the original static source intact, including its patched speech worker.
for (const file of [
  "app.js",
  "welcome.js",
  "speech.js",
  "whisper.js",
  "whisper-worker.js",
  "wake-lock.js",
  "radio.js",
  "mic-worklet.js",
  "vendor/vosk.js",
]) {
  execFileSync(process.execPath, ["--check", resolve(source, file)]);
}
const html = await readFile(resolve(source, "index.html"), "utf8");
for (const [, url] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  if (/^(?:https?:|#)/.test(url)) continue;
  if (url.startsWith("/"))
    throw new Error(`Asset must support project Pages paths: ${url}`);
  await access(resolve(source, url));
}
const manifest = JSON.parse(
  await readFile(resolve(source, "models/manifest.json"), "utf8"),
);
let total = 0;
for (const part of manifest.parts) {
  const bytes = await readFile(resolve(source, "models", part.file));
  if (
    bytes.length !== part.bytes ||
    createHash("sha256").update(bytes).digest("hex") !== part.sha256
  ) {
    throw new Error(`Speech model integrity check failed: ${part.file}`);
  }
  total += bytes.length;
}
if (total !== manifest.bytes)
  throw new Error("Speech model total size does not match manifest");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(source, output, { recursive: true });
await writeFile(resolve(output, ".nojekyll"), "");
console.log(
  `Built _site with original app assets and ${total} verified speech model bytes.`,
);
