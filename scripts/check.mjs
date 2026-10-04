import { readdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
for (const dir of ["src", "web", "scripts", "tests", "tests/browser"])
  for (const file of await readdir(dir)) {
    if (file.endsWith(".mjs")) {
      let r = spawnSync(process.execPath, ["--check", dir + "/" + file], {
        encoding: "utf8",
      });
      if (r.status !== 0) throw Error(r.stderr);
    }
  }
let html = await readFile("web/index.html", "utf8");
if (/https?:\/\/[^" ]+\.(?:js|css)/.test(html))
  throw Error("External runtime asset");
console.log("Syntax and static runtime checks passed.");
