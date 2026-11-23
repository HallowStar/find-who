import { cp, mkdir, readFile, rename, writeFile } from "node:fs/promises";

const game = "https://find-someone-who-simbb.endearingrabbit2.chatgpt.site";
const output = "dist/pages";
await mkdir(output + "/owner", { recursive: true });
await cp("public", output, { recursive: true });
const home = await readFile(output + "/index.html", "utf8");
await writeFile(output + "/index.html", home
  .replace("</head>", `  <meta name="game-api-origin" content="${game}">\n</head>`)
  .replace('src="./app.mjs"', 'src="./app.js"'));
const app = await readFile(output + "/app.mjs", "utf8");
await writeFile(output + "/app.mjs", app.replace('"./game-data.mjs"', '"./game-data.js"'));
await rename(output + "/app.mjs", output + "/app.js");
await rename(output + "/game-data.mjs", output + "/game-data.js");
await writeFile(output + "/.nojekyll", "");
await writeFile(output + "/owner/index.html", `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <meta http-equiv="refresh" content="0; url=${game}/owner">
  <title>Find Who Owner Dashboard</title>
</head>
<body><a href="${game}/owner">Open the owner dashboard</a></body>
</html>
`);
