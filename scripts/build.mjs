import { mkdir, rm, copyFile, readFile, writeFile } from "node:fs/promises";
const verifier = await readFile("python/verify.py", "utf8");
await writeFile(
  "src/verifier-source.mjs",
  "// Generated from python/verify.py. Do not edit directly.\nexport const VERIFIER_SOURCE=" +
    JSON.stringify(verifier) +
    ";\n",
);
await rm("dist", { recursive: true, force: true });
await mkdir("dist/src", { recursive: true });
for (const f of [
  "core.mjs",
  "example.mjs",
  "export.mjs",
  "verifier-source.mjs",
])
  await copyFile("src/" + f, "dist/src/" + f);
for (const f of ["index.html", "styles.css"])
  await copyFile("web/" + f, "dist/" + f);
await writeFile(
  "dist/app.mjs",
  (await readFile("web/app.mjs", "utf8")).replace(
    /(["'])\.\.\/src\//g,
    "$1./src/",
  ),
);
console.log("Built static dist; no external runtime dependencies or uploads.");
