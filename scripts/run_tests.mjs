import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";

for (const name of ["test_people_editor.mjs", "test_session_cancellation.mjs", "test_regressions.mjs"]) {
  const result = spawnSync(process.execPath, [resolve("scripts", name)], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
for (const directory of ["pwa", "pwa/pages"]) {
  for (const name of readdirSync(directory).filter(name => name.endsWith(".js"))) {
    const result = spawnSync(process.execPath, ["--check", resolve(directory, name)], { stdio: "inherit" });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
console.log("PASS: JavaScript syntax");
