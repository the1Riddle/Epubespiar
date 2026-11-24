import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

for (const target of ["chrome", "firefox"]) {
  const base = join("dist", target);
  const manifestPath = join(base, "manifest.json");
  assert(existsSync(manifestPath), `${target}: manifest missing`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.manifest_version, 3, `${target}: expected MV3`);
  const paths = [
    "reader.html",
    "side_panel.html",
    ...(manifest.content_scripts || []).flatMap((cs) => cs.js || []),
    ...Object.values(manifest.icons || {}),
    ...(target === "chrome"
      ? [manifest.background.service_worker]
      : manifest.background.scripts),
  ];
  for (const relative of paths) {
    const path = join(base, relative);
    assert(existsSync(path), `${target}: missing packaged file ${relative}`);
    assert(statSync(path).isFile(), `${target}: not a file: ${relative}`);
  }
  assert(manifest.permissions.includes("downloads"), "downloads permission required");
  if (target === "chrome") {
    assert.equal(manifest.background.type, "module");
  }
  console.log(`${target}: verified ${paths.length} manifest assets`);
}
