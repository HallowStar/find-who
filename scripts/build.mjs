import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { extname } from "node:path";

const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};
const files = (await readdir("public", { recursive: true, withFileTypes: true }))
  .filter((entry) => entry.isFile())
  .map((entry) => entry.parentPath + "/" + entry.name)
  .sort();
const assets = {};
for (const file of files) {
  const type = types[extname(file)];
  if (type) assets[file.slice("public".length)] = [type, (await readFile(file)).toString("base64")];
}

await mkdir("dist/server", { recursive: true });
await mkdir("dist/.openai", { recursive: true });
await copyFile(".openai/hosting.json", "dist/.openai/hosting.json");
const gameData = (await readFile("public/game-data.mjs", "utf8")).replace(/^export /gm, "");
const worker = (await readFile("src/worker.mjs", "utf8"))
  .replace('import { ASSETS } from "./assets.mjs";', () => "const ASSETS = " + JSON.stringify(assets) + ";")
  .replace('import { PROMPTS, TEAMS } from "./game-data.mjs";', () => gameData);
await writeFile("dist/server/index.js", worker);
