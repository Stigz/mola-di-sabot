import { build } from "esbuild";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const frontend = resolve(root, "frontend");
const dist = resolve(frontend, "dist");
const basePath = normalizeBasePath(process.env.VITE_BASE_PATH ?? "/");
const apiBaseUrl = process.env.VITE_API_BASE_URL;

await rm(dist, { recursive: true, force: true });
await mkdir(resolve(dist, "assets"), { recursive: true });

await build({
  entryPoints: [resolve(frontend, "src/main.tsx")],
  bundle: true,
  minify: true,
  format: "esm",
  target: ["es2020"],
  outfile: resolve(dist, "assets/index.js"),
  define: {
    "import.meta.env.BASE_URL": JSON.stringify(basePath),
    "import.meta.env.VITE_API_BASE_URL": apiBaseUrl ? JSON.stringify(apiBaseUrl) : "undefined",
  },
  loader: {
    ".svg": "dataurl",
  },
});

await writeFile(
  resolve(dist, "index.html"),
  `<!doctype html>
<html lang="de">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#f8fafc" />
    <title>Mola di Sabot</title>
    <link rel="stylesheet" href="${basePath}assets/index.css" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="${basePath}assets/index.js"></script>
  </body>
</html>
`,
);

function normalizeBasePath(value) {
  if (!value || value === "/") return "/";
  return `/${value.replace(/^\/+|\/+$/g, "")}/`;
}
