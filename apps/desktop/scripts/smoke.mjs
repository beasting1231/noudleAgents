import { access } from "node:fs/promises";
import { resolve } from "node:path";

const expected = [
  "out/main/index.js",
  "out/preload/index.cjs",
  "out/renderer/index.html",
];

await Promise.all(expected.map((file) => access(resolve(import.meta.dirname, "..", file))));
console.log(`Electron smoke ready: ${expected.join(", ")}`);
