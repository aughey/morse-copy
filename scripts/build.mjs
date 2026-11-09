import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = resolve(root, "dist");
const output = resolve(root, "_site");
const run = (command, args) => execFileSync(command, args, { cwd: root, stdio: "inherit" });

for (const file of ["deepcw-core.js", "deepcw-worker.js", "mic-worklet.js", "vendor/vosk.js"]) {
  run(process.execPath, ["--check", resolve(source, file)]);
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
const keyerManifest = JSON.parse(await readFile(resolve(source, "models/deepcw-manifest.json"), "utf8"));
for (const file of keyerManifest.files) {
  const bytes = await readFile(resolve(source, file.file));
  if (bytes.length !== file.bytes || createHash("sha256").update(bytes).digest("hex") !== file.sha256)
    throw new Error(`DeepCW asset integrity check failed: ${file.file}`);
}
const metadata = JSON.parse(execFileSync(
  "cargo", ["metadata", "--locked", "--no-deps", "--format-version", "1"],
  { cwd: root, encoding: "utf8" },
));
const target = "wasm32-unknown-unknown";
run("cargo", ["build", "--locked", "--release", "--target", target]);

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(source, output, { recursive: true });
run("wasm-bindgen", [
  "--target", "web",
  "--out-dir", output,
  "--out-name", "morse_copy",
  "--no-typescript",
  resolve(metadata.target_directory, target, "release", "morse-copy.wasm"),
]);
await writeFile(resolve(output, ".nojekyll"), "");
console.log(`Built _site with Leptos CSR, ${total} verified speech model bytes, and verified DeepCW/runtime assets.`);
