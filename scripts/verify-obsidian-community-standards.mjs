import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const versions = JSON.parse(fs.readFileSync(path.join(root, "versions.json"), "utf8"));
const releaseWorkflow = fs.readFileSync(path.join(root, ".github", "workflows", "release.yml"), "utf8");
const source = fs.readFileSync(path.join(root, "src", "main.ts"), "utf8");
const semver = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const staticStyleAssignmentPattern = /\.style\.(?:cssText|position|touchAction|color|cursor|textDecoration|zoom|transform|transformOrigin)\s*=/;
const checks = [
  ["manifest has a stable lowercase plugin id", typeof manifest.id === "string" && /^[a-z0-9][a-z0-9-]*$/.test(manifest.id)],
  ["manifest name is concise and does not impersonate Obsidian", typeof manifest.name === "string" && manifest.name.trim().length > 0 && !/obsidian/i.test(manifest.name)],
  ["manifest and package versions match semver", semver.test(manifest.version ?? "") && manifest.version === packageJson.version],
  ["versions.json contains only SemVer compatibility entries", Object.entries(versions).every(([version, minAppVersion]) => semver.test(version) && typeof minAppVersion === "string" && semver.test(minAppVersion))],
  ["versions.json maps the current release to minAppVersion", versions[manifest.version] === manifest.minAppVersion],
  ["release workflow accepts current SemVer tags", /tags:\s*[\r\n]+\s*-\s*["']\*\.\*\.\*["']/.test(releaseWorkflow)],
  ["release workflow publishes only after draft assets are uploaded", releaseWorkflow.includes("--draft") && releaseWorkflow.includes("state=\"$(gh release view") && releaseWorkflow.indexOf("gh release edit \"$tag\" --draft=false --latest") > releaseWorkflow.indexOf("Attest release assets")],
  ["manifest declares minimum app version and mobile compatibility", semver.test(manifest.minAppVersion ?? "") && manifest.isDesktopOnly === false],
  ["manifest contains description author and main entry", typeof manifest.description === "string" && manifest.description.trim().length >= 20 && typeof manifest.author === "string" && manifest.author.trim().length > 0 && packageJson.main === "main.js"],
  ["source avoids unsafe HTML assignment APIs", !/\.(?:innerHTML|outerHTML)\s*=/.test(source) && !/\binsertAdjacentHTML\s*\(/.test(source)],
  ["source avoids dynamic code execution primitives", !/\bnew\s+Function\s*\(/.test(source) && !/(?:^|[^\w.])eval\s*\(/m.test(source)],
  ["source avoids dynamic script element injection", !/createElement\s*\(\s*["']script["']\s*\)/.test(source)],
  ["runtime source does not import Node filesystem or process APIs", !/from\s+["'](?:node:)?(?:fs|path|child_process|process)["']/.test(source)],
  ["payment QR images use bundled resources", source.includes('from "./support/code-1.png"') && source.includes('from "./support/code-2.png"') && source.includes('"builtin/alipay"') && source.includes('"builtin/binance"')],
  ["cross-document contextual editing guards iframe access", /try\s*\{\s*doc\s*=\s*frame\.contentDocument;/.test(source) && source.includes("frame.removeEventListener(\"load\", bind)")],
  ["contextual-edit listeners and temporary geometry nodes are cleaned", source.includes("doc?.removeEventListener(\"selectionchange\", selectionChange)") && source.includes("viewport.remove();")],
  ["contextual-edit Markdown previews use scoped components", !/MarkdownRenderer\.render\(\s*cancipContextEditPreviewPlugin\.app\s*,\s*this\.preview\.markdown\s*,\s*element\s*,\s*this\.preview\.path\s*,\s*cancipContextEditPreviewPlugin\s*\)/.test(source) && !/MarkdownRenderer\.render\(\s*this\.app\s*,\s*markdown\s*,\s*preview\s*,\s*anchor\.file\.path\s*,\s*this\s*\)/.test(source)],
  ["contextual-edit fixed mirror styles use CSS classes", !/(?:viewport|mirror)\.style\.(?:position|overflow|visibility|pointerEvents|zIndex|whiteSpace)\s*=/.test(source)],
  ["source avoids static style assignments flagged by Obsidian review", !staticStyleAssignmentPattern.test(source)]
];

const failed = checks.filter(([, passed]) => !passed).map(([name]) => name);
for (const [name, passed] of checks) console.log(`${passed ? "PASS" : "FAIL"} ${name}`);
if (failed.length) {
  console.error(`Obsidian community standards gate failed: ${failed.join("; ")}`);
  process.exit(1);
}
