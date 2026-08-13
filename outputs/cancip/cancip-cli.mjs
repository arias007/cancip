#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const CLI_VERSION = "3.3.69";
const BRIDGE_PORT = 43172;
const PORT_FALLBACK_COUNT = 8;
const REQUEST_TIMEOUT_MS = 10 * 60_000;
const PLUGIN_IDS = ["cancip"];
const MCP_PROTOCOL_VERSION = "2024-11-05";

function parseArgs(argv) {
  const options = {};
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const equal = arg.indexOf("=");
    if (equal > 2) {
      options[arg.slice(2, equal)] = arg.slice(equal + 1);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      options[key] = next;
      index += 1;
    } else {
      options[key] = true;
    }
  }
  return { options, positionals };
}

function asInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function obsidianConfigCandidates() {
  if (process.platform === "win32") {
    return [join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "obsidian", "obsidian.json")];
  }
  if (process.platform === "darwin") {
    return [join(homedir(), "Library", "Application Support", "obsidian", "obsidian.json")];
  }
  return [
    join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "obsidian", "obsidian.json"),
    join(homedir(), ".config", "obsidian", "obsidian.json")
  ];
}

function pluginDataForVault(vaultPath) {
  for (const pluginId of PLUGIN_IDS) {
    const pluginDir = join(vaultPath, ".obsidian", "plugins", pluginId);
    const dataPath = join(pluginDir, "data.json");
    const manifestPath = join(pluginDir, "manifest.json");
    if (!existsSync(dataPath) || !existsSync(manifestPath)) continue;
    try {
      const data = readJson(dataPath);
      const manifest = readJson(manifestPath);
      const token = typeof data.agentBridgeToken === "string" ? data.agentBridgeToken.trim() : "";
      const port = asInt(data.agentBridgePort, BRIDGE_PORT, 1024, 65535);
      return { vaultPath, pluginDir, dataPath, manifest, data, token, port };
    } catch {
      // Keep looking for another installed Cancip instance.
    }
  }
  return null;
}

function discoverVaults(explicitVault) {
  const candidates = [];
  const preferred = explicitVault || process.env.CANCIP_VAULT || "";
  if (preferred) candidates.push({ path: resolve(preferred), open: true, explicit: true });
  for (const configPath of obsidianConfigCandidates()) {
    if (!existsSync(configPath)) continue;
    try {
      const config = readJson(configPath);
      for (const entry of Object.values(config.vaults || {})) {
        if (!entry || typeof entry !== "object" || typeof entry.path !== "string") continue;
        candidates.push({ path: resolve(entry.path), open: entry.open === true, explicit: false });
      }
    } catch {
      // A malformed Obsidian registry must not block an explicit vault.
    }
  }
  const unique = new Map();
  for (const candidate of candidates) {
    const key = process.platform === "win32" ? candidate.path.toLowerCase() : candidate.path;
    const previous = unique.get(key);
    if (!previous || candidate.explicit || (candidate.open && !previous.open)) unique.set(key, candidate);
  }
  return [...unique.values()].sort((left, right) => Number(right.explicit) - Number(left.explicit) || Number(right.open) - Number(left.open));
}

function resolveCancip(options) {
  for (const candidate of discoverVaults(typeof options.vault === "string" ? options.vault : "")) {
    const found = pluginDataForVault(candidate.path);
    if (found) return found;
  }
  throw new Error("No Obsidian vault with an installed Cancip plugin was found. Open the vault or pass --vault <path>.");
}

async function probePort(context, port) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1200);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/status`, {
      signal: controller.signal,
      headers: { Accept: "application/json", Authorization: `Bearer ${context.token}` }
    });
    if (!response.ok) return null;
    const body = await response.json();
    return body?.name === "Cancip Agent Bridge" ? { port, status: body } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function resolveBridge(context) {
  if (!context.token) throw new Error("Cancip Agent Bridge token is not initialized. Reload Cancip in Obsidian once.");
  const explicitPort = process.env.CANCIP_PORT ? asInt(process.env.CANCIP_PORT, context.port, 1024, 65535) : 0;
  const candidates = explicitPort
    ? [explicitPort]
    : Array.from({ length: PORT_FALLBACK_COUNT + 1 }, (_, offset) => context.port + offset);
  for (const port of candidates) {
    const probe = await probePort(context, port);
    if (probe) return probe;
  }
  throw new Error("Cancip Agent Bridge is not reachable. Open Obsidian, enable Cancip Agent Bridge, then reload the plugin.");
}

async function bridgeRequest(context, method, path, body) {
  const bridge = await resolveBridge(context);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`http://127.0.0.1:${bridge.port}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${context.token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" })
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok !== true) {
      const message = payload?.error?.message || `Bridge request failed with HTTP ${response.status}.`;
      const error = new Error(message);
      error.code = payload?.error?.code || "bridge_request_failed";
      throw error;
    }
    return payload.result ?? payload;
  } finally {
    clearTimeout(timer);
  }
}

function human(value) {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function output(value, options) {
  if (options.json === true || options.output === "json") {
    process.stdout.write(`${JSON.stringify(value)}\n`);
    return;
  }
  process.stdout.write(`${human(value)}\n`);
}

async function stdinText() {
  if (process.stdin.isTTY) return "";
  let text = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) text += chunk;
  return text.trim();
}

function commandCandidate(provider) {
  const locator = process.platform === "win32" ? "where.exe" : "which";
  if (process.platform === "win32") {
    const packageRoot = join(
      process.env.APPDATA || "",
      "npm",
      "node_modules",
      provider === "codex" ? "@openai" : "@anthropic-ai",
      provider === "codex" ? "codex" : "claude-code"
    );
    const nativeModule = provider === "claude" ? join(packageRoot, "bin", "claude.exe") : "";
    if (nativeModule && existsSync(nativeModule)) return { command: nativeModule, prefix: [] };
    const nodeModule = provider === "codex" ? join(packageRoot, "bin", "codex.js") : join(packageRoot, "cli.js");
    if (existsSync(nodeModule)) return { command: process.execPath, prefix: [nodeModule] };
  }
  const name = process.platform === "win32" ? `${provider}.exe` : provider;
  const located = spawnSync(locator, [name], { encoding: "utf8", windowsHide: true, shell: false });
  const executable = String(located.stdout || "").split(/\r?\n/).map((item) => item.trim()).find((item) => item && existsSync(item));
  return executable && !/\.(?:cmd|bat)$/i.test(executable) ? { command: executable, prefix: [] } : null;
}

function runAgentCli(provider, args) {
  const candidate = commandCandidate(provider);
  if (!candidate) throw new Error(`${provider} CLI was not found.`);
  return spawnSync(candidate.command, [...candidate.prefix, ...args], {
    encoding: "utf8",
    windowsHide: true,
    shell: false,
    timeout: 30_000
  });
}

function mcpConnectionState(provider) {
  if (!commandCandidate(provider)) {
    return { provider, available: false, linked: false, status: "unavailable", detail: `${provider} CLI was not found.` };
  }
  const current = runAgentCli(provider, ["mcp", "get", "cancip"]);
  return current.status === 0
    ? { provider, available: true, linked: true, status: "linked", detail: "Cancip MCP is configured." }
    : { provider, available: true, linked: false, status: "not-linked", detail: "Cancip MCP is not configured yet." };
}

function registerMcp(context, provider, force) {
  const state = mcpConnectionState(provider);
  if (!state.available) return state;
  const current = runAgentCli(provider, ["mcp", "get", "cancip"]);
  if (current.status === 0 && !force) {
    return { provider, available: true, linked: true, status: "already-configured", detail: "Cancip MCP is already available to this agent. Use --force only to replace it." };
  }
  if (current.status === 0 && force) runAgentCli(provider, ["mcp", "remove", ...(provider === "claude" ? ["-s", "user"] : []), "cancip"]);
  const cliPath = fileURLToPath(import.meta.url);
  const mcpCommand = [process.execPath, cliPath, "mcp", "--vault", context.vaultPath];
  const args = provider === "codex"
    ? ["mcp", "add", "cancip", "--", ...mcpCommand]
    : ["mcp", "add", "-s", "user", "cancip", "--", ...mcpCommand];
  const added = runAgentCli(provider, args);
  if (added.status !== 0) {
    const detail = added.error?.message || String(added.stderr || added.stdout || "unknown error").trim();
    throw new Error(`${provider} MCP registration failed: ${detail}`);
  }
  return { provider, available: true, linked: true, status: "linked", detail: "Cancip MCP tools are now available to this agent." };
}

function requestedLinkProviders(words) {
  const normalized = words.map((word) => String(word).trim().toLowerCase()).filter(Boolean);
  if (normalized.includes("codex")) return ["codex"];
  if (normalized.includes("claude") || normalized.includes("claudecode") || normalized.includes("claude-code")) return ["claude"];
  if (normalized.includes("all")) return ["codex", "claude"];
  if (normalized.includes("auto") || normalized.includes("obsidian") || normalized.includes("cancip")) {
    const available = ["codex", "claude"].filter((provider) => commandCandidate(provider));
    return available.length ? available : ["codex", "claude"];
  }
  return [];
}

const MCP_TOOLS = [
  {
    name: "cancip_status",
    description: "Check the local Cancip/Obsidian bridge and its permission mode.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "cancip_search",
    description: "Search the active Obsidian Vault through Cancip's indexed content and attachment search.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 50 },
        scope: { type: "string", enum: ["filename", "content", "both"] },
        includeConfigs: { type: "boolean" },
        includeArchived: { type: "boolean" }
      },
      required: ["query"],
      additionalProperties: false
    }
  },
  {
    name: "cancip_read",
    description: "Read a Vault-relative file, folder, PDF, Office document, archive, or other Cancip-supported attachment.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        query: { type: "string" },
        startLine: { type: "integer", minimum: 1 },
        endLine: { type: "integer", minimum: 1 },
        maxChars: { type: "integer", minimum: 500, maximum: 30000 }
      },
      required: ["path"],
      additionalProperties: false
    }
  },
  {
    name: "cancip_open",
    description: "Open a Vault file or folder in Obsidian using Cancip's verified target route.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" }, query: { type: "string" }, targetKind: { type: "string" } },
      additionalProperties: false
    }
  },
  {
    name: "cancip_send",
    description: "Send a task into Cancip's normal side-panel agent loop. Cancip retains its UI, context, steps, approvals, review, and final answer.",
    inputSchema: {
      type: "object",
      properties: { prompt: { type: "string" } },
      required: ["prompt"],
      additionalProperties: false
    }
  },
  {
    name: "cancip_action",
    description: "Run one or more existing cancip-action objects. Read-only actions run immediately; writes queue for approval unless Cancip is in Full access.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "object" },
        actions: { type: "array", items: { type: "object" }, minItems: 1, maxItems: 20 }
      },
      additionalProperties: false
    }
  }
];

async function mcpToolCall(context, name, args) {
  if (name === "cancip_status") {
    const bridge = await resolveBridge(context);
    return bridge.status;
  }
  if (name === "cancip_search") return await bridgeRequest(context, "POST", "/v1/search", args);
  if (name === "cancip_read") return await bridgeRequest(context, "POST", "/v1/read", args);
  if (name === "cancip_open") return await bridgeRequest(context, "POST", "/v1/open", args);
  if (name === "cancip_send") return await bridgeRequest(context, "POST", "/v1/prompt", args);
  if (name === "cancip_action") return await bridgeRequest(context, "POST", "/v1/action", args);
  throw new Error(`Unknown Cancip MCP tool: ${name}`);
}

async function runMcp(context) {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let request;
    try {
      request = JSON.parse(line);
    } catch {
      process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })}\n`);
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(request, "id")) continue;
    try {
      let result;
      if (request.method === "initialize") {
        result = {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "cancip", version: CLI_VERSION },
          instructions: "Use Cancip for Obsidian Vault search, reads, UI opens, and permission-aware actions."
        };
      } else if (request.method === "ping") {
        result = {};
      } else if (request.method === "tools/list") {
        result = { tools: MCP_TOOLS };
      } else if (request.method === "tools/call") {
        const name = request.params?.name;
        const args = request.params?.arguments && typeof request.params.arguments === "object" ? request.params.arguments : {};
        try {
          const value = await mcpToolCall(context, name, args);
          result = { content: [{ type: "text", text: human(value) }], structuredContent: value };
        } catch (error) {
          result = { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true };
        }
      } else {
        throw Object.assign(new Error("Method not found"), { rpcCode: -32601 });
      }
      process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result })}\n`);
    } catch (error) {
      process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: error.rpcCode || -32603, message: error instanceof Error ? error.message : String(error) } })}\n`);
    }
  }
}

function usage() {
  return `Cancip CLI ${CLI_VERSION}

Usage:
  cancip status [--vault <path>] [--json]
  cancip capabilities
  cancip search <query> [--limit 12] [--scope both]
  cancip read <vault-path> [--query <text>] [--max-chars 12000]
  cancip open <vault-path>
  cancip send <prompt>
  cancip action '<cancip-action JSON>'
  cancip agent run <prompt> [--agent auto|codex|claude] [--model <model>]
  cancip connect [codex|claude|all] [--force]
  cancip link [obsidian cancip|codex|claude|all] [--force]
  cancip doctor
  cancip mcp

The CLI discovers the open Obsidian Vault and authenticates locally without printing the bridge token.`;
}

async function main() {
  const { options, positionals } = parseArgs(process.argv.slice(2));
  const command = positionals.shift() || "help";
  if (command === "help" || command === "--help" || options.help === true) {
    output(usage(), options);
    return;
  }
  if (command === "version" || command === "--version") {
    output(CLI_VERSION, options);
    return;
  }
  const context = resolveCancip(options);
  if (command === "mcp") {
    await runMcp(context);
    return;
  }
  if (command === "status") {
    const bridge = await resolveBridge(context);
    output({ connected: true, vault: basename(context.vaultPath), pluginVersion: context.manifest.version, port: bridge.port, ...bridge.status }, options);
    return;
  }
  if (command === "capabilities") {
    output(await bridgeRequest(context, "GET", "/v1/capabilities"), options);
    return;
  }
  if (command === "search") {
    const query = positionals.join(" ").trim() || String(options.query || "").trim();
    if (!query) throw new Error("search requires a query.");
    output(await bridgeRequest(context, "POST", "/v1/search", {
      query,
      limit: asInt(options.limit, 12, 1, 50),
      scope: options.scope || "both",
      includeConfigs: options["include-configs"] === true,
      includeArchived: options["include-archived"] === true
    }), options);
    return;
  }
  if (command === "read") {
    const path = positionals.join(" ").trim() || String(options.path || "").trim();
    if (!path) throw new Error("read requires a Vault-relative path.");
    output(await bridgeRequest(context, "POST", "/v1/read", {
      path,
      query: options.query || "",
      startLine: options["start-line"],
      endLine: options["end-line"],
      maxChars: asInt(options["max-chars"], 12000, 500, 30000)
    }), options);
    return;
  }
  if (command === "open") {
    const path = positionals.join(" ").trim() || String(options.path || "").trim();
    if (!path) throw new Error("open requires a Vault-relative path.");
    output(await bridgeRequest(context, "POST", "/v1/open", { path }), options);
    return;
  }
  if (command === "send") {
    const prompt = positionals.join(" ").trim() || await stdinText();
    if (!prompt) throw new Error("send requires a prompt.");
    output(await bridgeRequest(context, "POST", "/v1/prompt", { prompt }), options);
    return;
  }
  if (command === "action") {
    const raw = positionals.join(" ").trim() || await stdinText();
    if (!raw) throw new Error("action requires a JSON action object or actions array.");
    const parsed = JSON.parse(raw);
    const body = Array.isArray(parsed) ? { actions: parsed } : parsed?.actions ? parsed : { action: parsed };
    output(await bridgeRequest(context, "POST", "/v1/action", body), options);
    return;
  }
  if (command === "agent" && positionals.shift() === "run") {
    const prompt = positionals.join(" ").trim() || await stdinText();
    if (!prompt) throw new Error("agent run requires a prompt.");
    output(await bridgeRequest(context, "POST", "/v1/agent/run", {
      prompt,
      provider: options.agent || "auto",
      model: options.model || "",
      system: options.system || ""
    }), options);
    return;
  }
  if (command === "link" || command === "connect") {
    await resolveBridge(context);
    const providers = requestedLinkProviders(positionals);
    if (!providers.length) {
      output({
        connected: true,
        vault: basename(context.vaultPath),
        agents: ["codex", "claude"].map((provider) => mcpConnectionState(provider)),
        next: ["cancip connect codex", "cancip connect claude", "cancip link obsidian cancip"]
      }, options);
      return;
    }
    output(providers.map((item) => registerMcp(context, item, options.force === true)), options);
    return;
  }
  if (command === "doctor") {
    let bridge;
    try {
      bridge = await resolveBridge(context);
    } catch (error) {
      bridge = { error: error instanceof Error ? error.message : String(error) };
    }
    output({
      cliVersion: CLI_VERSION,
      node: process.version,
      platform: process.platform,
      vault: basename(context.vaultPath),
      pluginVersion: context.manifest.version,
      tokenInitialized: Boolean(context.token),
      bridge,
      agents: ["codex", "claude"].map((provider) => mcpConnectionState(provider)),
      connect: {
        automatic: "cancip link obsidian cancip",
        codex: "cancip connect codex",
        claude: "cancip connect claude",
        genericMcp: `${process.execPath} ${fileURLToPath(import.meta.url)} mcp --vault ${context.vaultPath}`
      }
    }, options);
    return;
  }
  throw new Error(`Unknown command: ${command}\n\n${usage()}`);
}

main().catch((error) => {
  const payload = { ok: false, error: { code: error?.code || "cli_error", message: error instanceof Error ? error.message : String(error) } };
  const jsonOutput = process.argv.includes("--json") || process.argv.includes("--output=json");
  process.stderr.write(`${jsonOutput ? JSON.stringify(payload) : payload.error.message}\n`);
  process.exitCode = 1;
});
