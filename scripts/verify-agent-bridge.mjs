import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const source = await readFile(join(root, "src", "main.ts"), "utf8");
const bridgeSource = await readFile(join(root, "src", "agentBridge.ts"), "utf8");
const cliPath = join(root, "cli", "cancip-cli.mjs");
const cliSource = await readFile(cliPath, "utf8");
const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));

assert.match(bridgeSource, /const BRIDGE_HOST = "127\.0\.0\.1"/);
assert.ok(bridgeSource.indexOf("tokenMatches(this.getSettings().token") < bridgeSource.indexOf('path === "/v1/status"'));
assert.doesNotMatch(bridgeSource, /shell:\s*true/);
assert.match(bridgeSource, /"--sandbox",\s*\n\s*"read-only"/);
assert.match(bridgeSource, /"mcp_servers=\{\}"/);
assert.match(bridgeSource, /"mcp", "list", "--json"/);
assert.match(bridgeSource, /\^\[A-Za-z0-9_-\]\+\$/);
assert.match(bridgeSource, /mcp_servers\.\$\{name\}=\$\{config\}/);
assert.match(bridgeSource, /type === "stdio" && command/);
assert.match(bridgeSource, /type === "streamable_http" \|\| type === "sse"/);
assert.doesNotMatch(bridgeSource.slice(bridgeSource.indexOf("function codexMcpDisableArgs"), bridgeSource.indexOf("function extractCodexText")), /http_headers|env_http_headers|bearer_token_env_var/);
for (const feature of ["shell_tool", "apps", "browser_use", "computer_use", "plugins", "skill_search", "workspace_dependencies", "multi_agent"]) {
  assert.match(bridgeSource, new RegExp(`"${feature}"`));
}
assert.match(bridgeSource, /CODEX_DISABLED_FEATURES\.flatMap\(\(feature\) => \["--disable", feature\]\)/);
assert.match(bridgeSource, /"--ignore-rules"/);
assert.match(bridgeSource, /"--tools",\s*\n\s*""/);
assert.match(bridgeSource, /never copy path into query/);
assert.match(source, /const markdownTitle = field === "title"/);
assert.match(source, /if \(!Platform\.isMobileApp\)[\s\S]*?this\.startAgentBridge/);
const configWriter = source.slice(source.indexOf("function settingsToCancipConfig"), source.indexOf("function parseCancipConfig"));
assert.doesNotMatch(configWriter, /agentBridgeToken/);
assert.match(source, /nextSettings = normalizeSettings\(\{[\s\S]*?agentBridgeToken: this\.plugin\.settings\.agentBridgeToken[\s\S]*?\}\);/);
const configSchema = source.slice(source.indexOf("const CANCIP_CONFIG_STRING_KEYS"), source.indexOf("function isFiniteConfigNumber"));
const exportedConfigKeys = [...configWriter.matchAll(/^\s{4}([A-Za-z][A-Za-z0-9]*):\s*settings\./gm)].map((match) => match[1]);
const acceptedConfigKeys = new Set([...configSchema.matchAll(/"([A-Za-z][A-Za-z0-9]*)"/g)].map((match) => match[1]));
for (const key of exportedConfigKeys) {
  assert.ok(acceptedConfigKeys.has(key), `Exported Cancip config key is rejected by its own schema: ${key}`);
}
assert.doesNotMatch(cliSource, /output\s*\(\s*(?:context\.)?token/);
assert.match(cliSource, /Authorization: `Bearer \$\{context\.token\}`/);
assert.match(cliSource, /command === "link" \|\| command === "connect"/);
assert.match(cliSource, /normalized\.includes\("obsidian"\) \|\| normalized\.includes\("cancip"\)/);
assert.match(cliSource, /mcpConnectionState/);
assert.match(source, /Ollama Local/);
assert.match(source, /LM Studio Local/);
assert.match(source, /vLLM Local/);
assert.match(source, /compatibleResponse\.json\.data/);
assert.match(source, /agentConnectGuidePath/);
assert.match(source, /\.\.\.this\.plugin\.agentModelOptions\(\)\.map\(\(item\) => item\.model\)[\s\S]*?automationUseCurrentModel/);

const cliVersion = spawnSync(process.execPath, [cliPath, "version"], { encoding: "utf8", shell: false });
assert.equal(cliVersion.status, 0, cliVersion.stderr);
assert.equal(cliVersion.stdout.trim(), manifest.version);

const temp = await mkdtemp(join(tmpdir(), "cancip-agent-bridge-"));
try {
  const pluginDir = join(temp, "vault", ".obsidian", "plugins", "cancip");
  await mkdir(pluginDir, { recursive: true });
  await writeFile(join(pluginDir, "manifest.json"), JSON.stringify({ id: "cancip", version: manifest.version }));
  await writeFile(join(pluginDir, "data.json"), JSON.stringify({ agentBridgeToken: "a".repeat(43), agentBridgePort: 43172 }));
  const mcpInput = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1" } } },
    { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }
  ].map((value) => JSON.stringify(value)).join("\n") + "\n";
  const mcp = spawnSync(process.execPath, [cliPath, "mcp", "--vault", join(temp, "vault")], {
    encoding: "utf8",
    input: mcpInput,
    shell: false
  });
  assert.equal(mcp.status, 0, mcp.stderr);
  const responses = mcp.stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line));
  assert.equal(responses.length, 2);
  assert.equal(responses[0].result.serverInfo.name, "cancip");
  const toolNames = responses[1].result.tools.map((tool) => tool.name);
  for (const name of ["cancip_status", "cancip_search", "cancip_read", "cancip_open", "cancip_send", "cancip_action"]) {
    assert.ok(toolNames.includes(name), `MCP tool missing: ${name}`);
  }

  const bridgeBundle = join(temp, "agentBridge.cjs");
  await esbuild.build({
    entryPoints: [join(root, "src", "agentBridge.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    outfile: bridgeBundle,
    logLevel: "silent"
  });
  const require = createRequire(import.meta.url);
  globalThis.require = require;
  const { CancipAgentBridge } = require(bridgeBundle);
  const token = "b".repeat(43);
  const bridge = new CancipAgentBridge(
    () => ({
      enabled: true,
      port: 47320 + (process.pid % 1000),
      token,
      agentBrainEnabled: false,
      agentBrainProvider: "auto",
      agentBrainModel: "",
      agentBrainTimeoutSeconds: 30
    }),
    {
      status: () => ({ name: "Cancip Agent Bridge", pluginVersion: manifest.version }),
      capabilities: () => ({ protocolVersion: 1 }),
      search: async (input) => input,
      read: async (input) => input,
      open: async (input) => input,
      prompt: async (input) => input,
      action: async (input) => input,
      agentRun: async (input) => input
    }
  );
  const port = await bridge.start();
  try {
    const unauthenticated = await fetch(`http://127.0.0.1:${port}/v1/status`);
    assert.equal(unauthenticated.status, 401);
    const authenticated = await fetch(`http://127.0.0.1:${port}/v1/status`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(authenticated.status, 200);
    const status = await authenticated.json();
    assert.equal(status.name, "Cancip Agent Bridge");
    const capabilities = await fetch(`http://127.0.0.1:${port}/v1/capabilities`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(capabilities.status, 200);
    assert.equal((await capabilities.json()).result.protocolVersion, 1);
  } finally {
    await bridge.stop();
  }
} finally {
  await rm(temp, { recursive: true, force: true });
}

console.log("PASS Cancip Agent Bridge security, CLI, and MCP regression checks");
