import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const source = fs.readFileSync(path.join(root, "src", "main.ts"), "utf8");
const semver = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const checks = [
  ["manifest has a stable lowercase plugin id", typeof manifest.id === "string" && /^[a-z0-9][a-z0-9-]*$/.test(manifest.id)],
  ["manifest name is concise and does not impersonate Obsidian", typeof manifest.name === "string" && manifest.name.trim().length > 0 && !/obsidian/i.test(manifest.name)],
  ["manifest and package versions match semver", semver.test(manifest.version ?? "") && manifest.version === packageJson.version],
  ["manifest declares minimum app version and mobile compatibility", semver.test(manifest.minAppVersion ?? "") && manifest.isDesktopOnly === false],
  ["manifest contains description author and main entry", typeof manifest.description === "string" && manifest.description.trim().length >= 20 && typeof manifest.author === "string" && manifest.author.trim().length > 0 && packageJson.main === "main.js"],
  ["source avoids unsafe HTML assignment APIs", !/\.(?:innerHTML|outerHTML)\s*=/.test(source) && !/\binsertAdjacentHTML\s*\(/.test(source)],
  ["source avoids dynamic code execution primitives", !/\bnew\s+Function\s*\(/.test(source) && !/(?:^|[^\w.])eval\s*\(/m.test(source)],
  ["source avoids dynamic script element injection", !/createElement\s*\(\s*["']script["']\s*\)/.test(source)],
  ["runtime source does not import Node filesystem or process APIs", !/from\s+["'](?:node:)?(?:fs|path|child_process|process)["']/.test(source)],
  ["cross-document contextual editing guards iframe access", /try\s*\{\s*doc\s*=\s*frame\.contentDocument;/.test(source) && source.includes("frame.removeEventListener(\"load\", bind)")],
  ["contextual-edit listeners and temporary geometry nodes are cleaned", source.includes("doc?.removeEventListener(\"selectionchange\", selectionChange)") && source.includes("viewport.remove();")]
];

const failed = checks.filter(([, passed]) => !passed).map(([name]) => name);
for (const [name, passed] of checks) console.log(`${passed ? "PASS" : "FAIL"} ${name}`);
if (failed.length) {
  console.error(`Obsidian community standards gate failed: ${failed.join("; ")}`);
  process.exit(1);
}
