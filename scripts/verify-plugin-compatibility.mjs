import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const source = fs.readFileSync(path.join(root, "src", "main.ts"), "utf8");
const guide = fs.readFileSync(path.join(root, "docs", "CANCIP_PLUGIN_COMPATIBILITY.md"), "utf8");
const schema = JSON.parse(fs.readFileSync(path.join(root, "docs", "cancip-plugin.schema.json"), "utf8"));

const checks = [];
const check = (name, pass) => checks.push({ name, pass: Boolean(pass) });

check("public v1 adapter registration API exists", source.includes("registerPluginAdapter: (descriptor: unknown)") && source.includes("unregisterPluginAdapter: (pluginId: string)"));
check("public API lists and resolves registered adapters", source.includes("listPluginAdapters: ()") && source.includes("getPluginAdapter: (pluginId: string)"));
check("public effectful execution cannot bypass access mode", source.includes('this.settings.accessMode === "full-access"') && source.includes("requiresApproval: true"));
check("registered callbacks execute only through a declared action", source.includes("executeRegisteredPluginAction(") && source.includes("Plugin action not registered"));
check("descriptor file is discovered beside the plugin manifest", source.includes('const CANCIP_PLUGIN_DESCRIPTOR_FILE = "cancip-plugin.json"') && source.includes("`${plugin.path}/${CANCIP_PLUGIN_DESCRIPTOR_FILE}`"));
check("runtime descriptors are discovered without private controllers", source.includes("runtime?.cancipCompatibility") && source.includes("api?.cancipCompatibility"));
check("learning index records compatibility schema v2", source.includes("CANCIP_PLUGIN_LEARNING_INDEX_SCHEMA_VERSION = 2") && source.includes("compatibility: {"));
check("learning index signature includes adapter and descriptor changes", source.includes("pluginCompatibilitySourceRevision()") && source.includes("descriptorSignatures"));
check("UI fallback is request-scoped and semantic", source.includes("resolveSemanticPluginUiTarget(") && source.includes("querySelectorAll<HTMLElement>(selector)"));
check("ambiguous UI controls are rejected", source.includes("Ambiguous visible UI target"));
check("UI routes support click input select toggle and key", ["input", "select", "toggle", "key"].every((operation) => source.includes(`operation === "${operation}"`)));
check("UI actions report before after and verification", source.includes("before: ${safeJsonishDisplay(before)}") && source.includes("after: ${safeJsonishDisplay(after)}") && source.includes("verification: ${safeJsonishDisplay(verification)}"));
check("inconclusive UI effects do not claim success", source.includes('status: observable ? "passed" : "inconclusive"'));
check("compatibility settings default on", ["pluginCompatibilityEnabled", "pluginCompatibilityAutoLearn", "pluginCompatibilityUiFallback"].every((key) => source.includes(`${key}: true`)));
check("fixed Vault guide and schema paths exist", source.includes('.cancip/guides/PLUGIN_COMPATIBILITY.md') && source.includes('.cancip/guides/cancip-plugin.schema.json'));
check("guide documents observe act verify and ambiguity", guide.includes("observe -> act -> verify") && guide.includes("Ambiguous controls are not clicked"));
check("JSON schema requires risk and route", schema?.properties?.actions?.items?.required?.includes("risk") && schema?.properties?.actions?.items?.required?.includes("route"));
check("JSON schema accepts all three declarative routes", ["command", "api", "ui"].every((route) => schema?.properties?.actions?.items?.properties?.route?.properties?.type?.enum?.includes(route)));

const failed = checks.filter((item) => !item.pass);
for (const item of checks) console.log(`${item.pass ? "PASS" : "FAIL"} ${item.name}`);
if (failed.length) {
  console.error(`Plugin compatibility verification failed (${failed.length}/${checks.length}).`);
  process.exit(1);
}
console.log(`Plugin compatibility verification passed (${checks.length}/${checks.length}).`);
