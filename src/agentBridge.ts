import type { IncomingMessage, Server, ServerResponse } from "node:http";

export type LocalAgentProvider = "auto" | "codex" | "claude";

export type AgentBridgeRuntimeSettings = {
  enabled: boolean;
  port: number;
  token: string;
  agentBrainEnabled: boolean;
  agentBrainProvider: LocalAgentProvider;
  agentBrainModel: string;
  agentBrainTimeoutSeconds: number;
};

export type AgentBridgeActionResponse = {
  sessionId: string;
  status: "executed" | "approval-required" | "blocked" | "failed";
  report: string;
  runs: Array<{
    id: string;
    status: string;
    summary: string;
    result?: string;
    error?: string;
  }>;
};

export type AgentBridgePromptResponse = {
  sessionId: string;
  status: string;
  answer: string;
};

export type AgentBridgeHandlers = {
  status(): Record<string, unknown>;
  capabilities(): Promise<Record<string, unknown>> | Record<string, unknown>;
  search(input: Record<string, unknown>): Promise<unknown>;
  read(input: Record<string, unknown>): Promise<unknown>;
  open(input: Record<string, unknown>): Promise<unknown>;
  prompt(input: Record<string, unknown>): Promise<unknown>;
  action(input: Record<string, unknown>): Promise<unknown>;
  agentRun(input: Record<string, unknown>): Promise<unknown>;
};

export type LocalAgentRunRequest = {
  provider: LocalAgentProvider;
  model?: string;
  system: string;
  prompt: string;
  cwd?: string;
  timeoutMs: number;
  onProgress?: (text: string) => void;
};

export type LocalAgentRunResult = {
  provider: Exclude<LocalAgentProvider, "auto">;
  model: string;
  text: string;
  durationMs: number;
};

export type LocalAgentDiagnostic = {
  provider: Exclude<LocalAgentProvider, "auto">;
  available: boolean;
  command: string;
  detail: string;
};

type RequireLike = (name: string) => unknown;

type NodeHttp = typeof import("node:http");
type NodeCrypto = typeof import("node:crypto");
type NodeChildProcess = typeof import("node:child_process");
type NodeFs = typeof import("node:fs");
type NodePath = typeof import("node:path");

type ResolvedAgentCommand = {
  provider: Exclude<LocalAgentProvider, "auto">;
  command: string;
  prefixArgs: string[];
  label: string;
};

const BRIDGE_HOST = "127.0.0.1";
const BRIDGE_PROTOCOL_VERSION = 1;
const MAX_REQUEST_BYTES = 1024 * 1024;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_AGENT_OUTPUT_BYTES = 8 * 1024 * 1024;
const PORT_FALLBACK_COUNT = 8;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 120;
const AGENT_DIAGNOSTIC_CACHE_MS = 10_000;
const CODEX_MCP_CACHE_MS = 60_000;
const CODEX_DISABLED_FEATURES = [
  "shell_tool",
  "apps",
  "browser_use",
  "computer_use",
  "plugins",
  "skill_search",
  "workspace_dependencies",
  "multi_agent"
] as const;

let agentDiagnosticCache: { expiresAt: number; value: LocalAgentDiagnostic[] } | null = null;
let codexMcpCache: { expiresAt: number; value: string[] } | null = null;

function nodeRequire<T>(name: string): T | null {
  try {
    const scope = globalThis as typeof globalThis & { require?: RequireLike };
    const requireLike = scope.require
      ?? (typeof window !== "undefined" ? (window as unknown as { require?: RequireLike }).require : undefined);
    if (typeof requireLike !== "function") return null;
    return requireLike(name) as T;
  } catch {
    return null;
  }
}

function safeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]")
    .replace(/[A-Za-z]:\\[^\r\n]+/g, "[local path]")
    .replace(/\/(?:Users|home)\/[^\r\n]+/g, "[local path]")
    .slice(0, 800);
}

function stringValue(value: unknown, max = 200_000): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function positiveInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function jsonResponse(response: ServerResponse, status: number, body: unknown): void {
  let text = JSON.stringify(body);
  if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
    text = JSON.stringify({ ok: false, error: { code: "response_too_large", message: "Bridge response exceeded the safe size limit." } });
    status = 413;
  }
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Content-Length", Buffer.byteLength(text, "utf8"));
  response.end(text);
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer | string) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > MAX_REQUEST_BYTES) {
        reject(new Error("request_too_large"));
        request.destroy();
        return;
      }
      chunks.push(bytes);
    });
    request.on("end", () => {
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          reject(new Error("invalid_json_object"));
          return;
        }
        resolve(parsed as Record<string, unknown>);
      } catch {
        reject(new Error("invalid_json"));
      }
    });
    request.on("error", reject);
  });
}

function tokenMatches(expected: string, authorization: string | undefined): boolean {
  const supplied = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
  if (!expected || !supplied) return false;
  const crypto = nodeRequire<NodeCrypto>("node:crypto") ?? nodeRequire<NodeCrypto>("crypto");
  if (!crypto) return false;
  const expectedBytes = Buffer.from(expected, "utf8");
  const suppliedBytes = Buffer.from(supplied, "utf8");
  return expectedBytes.length === suppliedBytes.length && crypto.timingSafeEqual(expectedBytes, suppliedBytes);
}

export function createAgentBridgeToken(): string {
  const crypto = nodeRequire<NodeCrypto>("node:crypto") ?? nodeRequire<NodeCrypto>("crypto");
  if (!crypto) throw new Error("Secure random generator is unavailable on this device.");
  return crypto.randomBytes(32).toString("base64url");
}

export class CancipAgentBridge {
  private server: Server | null = null;
  private boundPort = 0;
  private readonly rateByClient = new Map<string, { startedAt: number; count: number }>();

  constructor(
    private readonly getSettings: () => AgentBridgeRuntimeSettings,
    private readonly handlers: AgentBridgeHandlers,
    private readonly onBound?: (port: number) => void
  ) {}

  port(): number {
    return this.boundPort;
  }

  running(): boolean {
    return this.server?.listening === true;
  }

  async start(): Promise<number> {
    if (this.running()) return this.boundPort;
    const settings = this.getSettings();
    if (!settings.enabled) return 0;
    const http = nodeRequire<NodeHttp>("node:http") ?? nodeRequire<NodeHttp>("http");
    if (!http) throw new Error("Node HTTP runtime is unavailable on this device.");
    let latestError: unknown = null;
    for (let offset = 0; offset <= PORT_FALLBACK_COUNT; offset += 1) {
      const port = settings.port + offset;
      try {
        const server = http.createServer((request, response) => {
          void this.handleRequest(request, response);
        });
        server.requestTimeout = 10 * 60_000;
        server.headersTimeout = 15_000;
        server.keepAliveTimeout = 5_000;
        await new Promise<void>((resolve, reject) => {
          const onError = (error: Error): void => reject(error);
          server.once("error", onError);
          server.listen(port, BRIDGE_HOST, () => {
            server.off("error", onError);
            resolve();
          });
        });
        this.server = server;
        this.boundPort = port;
        this.onBound?.(port);
        return port;
      } catch (error) {
        latestError = error;
      }
    }
    throw new Error(`Cancip Agent Bridge could not bind its local port: ${safeErrorMessage(latestError)}`);
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.boundPort = 0;
    this.rateByClient.clear();
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private allowedByRateLimit(request: IncomingMessage): boolean {
    const key = request.socket.remoteAddress ?? "local";
    const now = Date.now();
    const current = this.rateByClient.get(key);
    if (!current || now - current.startedAt >= RATE_WINDOW_MS) {
      this.rateByClient.set(key, { startedAt: now, count: 1 });
      return true;
    }
    current.count += 1;
    return current.count <= RATE_LIMIT;
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const remote = request.socket.remoteAddress ?? "";
      if (remote && remote !== BRIDGE_HOST && remote !== "::1" && remote !== "::ffff:127.0.0.1") {
        jsonResponse(response, 403, { ok: false, error: { code: "loopback_only", message: "Cancip Agent Bridge accepts only local connections." } });
        return;
      }
      if (!this.allowedByRateLimit(request)) {
        jsonResponse(response, 429, { ok: false, error: { code: "rate_limited", message: "Too many local bridge requests." } });
        return;
      }
      const url = new URL(request.url ?? "/", `http://${BRIDGE_HOST}`);
      const path = url.pathname.replace(/\/+$/, "") || "/";
      if (!tokenMatches(this.getSettings().token, request.headers.authorization)) {
        jsonResponse(response, 401, { ok: false, error: { code: "unauthorized", message: "Valid local bridge authentication is required." } });
        return;
      }
      if (path === "/v1/status" && request.method === "GET") {
        jsonResponse(response, 200, {
          ok: true,
          protocolVersion: BRIDGE_PROTOCOL_VERSION,
          authRequired: true,
          ...this.handlers.status()
        });
        return;
      }
      if (path === "/v1/capabilities" && request.method === "GET") {
        jsonResponse(response, 200, { ok: true, result: await this.handlers.capabilities() });
        return;
      }
      const routes: Record<string, (body: Record<string, unknown>) => Promise<unknown>> = {
        "/v1/search": this.handlers.search,
        "/v1/read": this.handlers.read,
        "/v1/open": this.handlers.open,
        "/v1/prompt": this.handlers.prompt,
        "/v1/action": this.handlers.action,
        "/v1/agent/run": this.handlers.agentRun
      };
      const handler = routes[path];
      if (!handler || request.method !== "POST") {
        jsonResponse(response, 404, { ok: false, error: { code: "not_found", message: "Unknown Cancip Agent Bridge route." } });
        return;
      }
      const body = await readJsonBody(request);
      jsonResponse(response, 200, { ok: true, result: await handler(body) });
    } catch (error) {
      const message = safeErrorMessage(error);
      const status = message.includes("request_too_large") ? 413 : message.includes("invalid_json") ? 400 : 500;
      jsonResponse(response, status, { ok: false, error: { code: status === 500 ? "bridge_error" : "bad_request", message } });
    }
  }
}

function existingFile(path: string): boolean {
  const fs = nodeRequire<NodeFs>("node:fs") ?? nodeRequire<NodeFs>("fs");
  try {
    return fs?.statSync(path).isFile() === true;
  } catch {
    return false;
  }
}

function nodeExecutable(): string | null {
  const processLike = globalThis.process as NodeJS.Process | undefined;
  const path = nodeRequire<NodePath>("node:path") ?? nodeRequire<NodePath>("path");
  const current = processLike?.execPath ?? "";
  if (current && path && /^node(?:\.exe)?$/i.test(path.basename(current))) return current;
  const located = locateExecutable(processLike?.platform === "win32" ? "node.exe" : "node").find(existingFile);
  return located ?? null;
}

function locateExecutable(name: string): string[] {
  const childProcess = nodeRequire<NodeChildProcess>("node:child_process") ?? nodeRequire<NodeChildProcess>("child_process");
  if (!childProcess) return [];
  try {
    const processLike = globalThis.process as NodeJS.Process | undefined;
    const locator = processLike?.platform === "win32" ? "where.exe" : "which";
    const result = childProcess.spawnSync(locator, [name], { encoding: "utf8", windowsHide: true, shell: false });
    return String(result.stdout ?? "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function resolveAgentCommand(provider: Exclude<LocalAgentProvider, "auto">): ResolvedAgentCommand | null {
  const processLike = globalThis.process as NodeJS.Process | undefined;
  const path = nodeRequire<NodePath>("node:path") ?? nodeRequire<NodePath>("path");
  if (!processLike || !path) return null;
  if (processLike.platform !== "win32") {
    const executable = locateExecutable(provider).find(existingFile);
    return executable ? { provider, command: executable, prefixArgs: [], label: executable } : null;
  }
  const appData = processLike.env.APPDATA ?? "";
  const packageRoot = path.join(appData, "npm", "node_modules", provider === "codex" ? "@openai" : "@anthropic-ai", provider === "codex" ? "codex" : "claude-code");
  const nativeModule = provider === "claude" ? path.join(packageRoot, "bin", "claude.exe") : "";
  if (nativeModule && existingFile(nativeModule)) {
    return { provider, command: nativeModule, prefixArgs: [], label: "claude.exe" };
  }
  const nodeModule = provider === "codex"
    ? path.join(packageRoot, "bin", "codex.js")
    : path.join(packageRoot, "cli.js");
  const node = nodeExecutable();
  if (node && existingFile(nodeModule)) {
    return { provider, command: node, prefixArgs: [nodeModule], label: `${provider} Node CLI` };
  }
  const executable = locateExecutable(`${provider}.exe`).find(existingFile);
  if (executable) return { provider, command: executable, prefixArgs: [], label: `${provider}.exe` };
  return null;
}

export function localAgentDiagnostics(force = false): LocalAgentDiagnostic[] {
  if (!force && agentDiagnosticCache && agentDiagnosticCache.expiresAt > Date.now()) {
    return agentDiagnosticCache.value.map((item) => ({ ...item }));
  }
  const value = (["codex", "claude"] as const).map((provider) => {
    const resolved = resolveAgentCommand(provider);
    return {
      provider,
      available: Boolean(resolved),
      command: resolved?.label ?? "",
      detail: resolved ? "ready" : "CLI not found"
    };
  });
  agentDiagnosticCache = { expiresAt: Date.now() + AGENT_DIAGNOSTIC_CACHE_MS, value };
  return value.map((item) => ({ ...item }));
}

function providerForRequest(requested: LocalAgentProvider): Exclude<LocalAgentProvider, "auto"> {
  if (requested !== "auto") return requested;
  if (resolveAgentCommand("codex")) return "codex";
  if (resolveAgentCommand("claude")) return "claude";
  throw new Error("Neither Codex CLI nor Claude Code was found on this computer.");
}

function agentPrompt(system: string, prompt: string): string {
  return [
    "You are the reasoning engine behind Cancip. Cancip owns all UI, Vault mutations, approvals, and tool execution.",
    "Use only the supplied context. Do not inspect or modify local files yourself. Return a concise answer or the existing cancip-action protocol requested by the system instructions.",
    "For read actions, set path to the Vault-relative file path and omit query unless the user explicitly asks to find text inside that file; never copy path into query.",
    "",
    "<cancip-system>",
    system,
    "</cancip-system>",
    "",
    "<cancip-input>",
    prompt,
    "</cancip-input>"
  ].join("\n");
}

function codexMcpDisableArgs(childProcess: NodeChildProcess, resolved: ResolvedAgentCommand): string[] {
  let overrides = codexMcpCache?.expiresAt && codexMcpCache.expiresAt > Date.now()
    ? codexMcpCache.value
    : null;
  if (!overrides) {
    overrides = [];
    try {
      const listed = childProcess.spawnSync(resolved.command, [...resolved.prefixArgs, "mcp", "list", "--json"], {
        encoding: "utf8",
        windowsHide: true,
        shell: false,
        timeout: 15_000,
        maxBuffer: 2 * 1024 * 1024
      });
      const parsed = JSON.parse(String(listed.stdout ?? "")) as Array<Record<string, unknown>>;
      overrides = parsed.flatMap((item) => {
        const name = stringValue(item.name, 200);
        const transport = item.transport && typeof item.transport === "object"
          ? item.transport as Record<string, unknown>
          : null;
        if (!/^[A-Za-z0-9_-]+$/.test(name) || !transport) return [];
        const type = stringValue(transport.type, 40);
        const command = stringValue(transport.command, 20_000);
        const url = stringValue(transport.url, 20_000);
        const args = Array.isArray(transport.args)
          ? transport.args.map((value) => stringValue(value, 20_000)).filter(Boolean)
          : [];
        // Keep only public transport metadata. Headers, environment and authentication values
        // are deliberately not copied into a child-process command line.
        const config = type === "stdio" && command
          ? `{command=${JSON.stringify(command)},args=[${args.map((value) => JSON.stringify(value)).join(",")}],enabled=false}`
          : ((type === "streamable_http" || type === "sse") && url
            ? `{url=${JSON.stringify(url)},enabled=false}`
            : "");
        return config ? [`mcp_servers.${name}=${config}`] : [];
      });
    } catch {
      // The static empty-map override and disabled Codex features remain active if discovery fails.
    }
    codexMcpCache = { expiresAt: Date.now() + CODEX_MCP_CACHE_MS, value: overrides };
  }
  return overrides.flatMap((override) => ["-c", override]);
}

function extractCodexText(stdout: string): string {
  let answer = "";
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const event = JSON.parse(trimmed) as Record<string, unknown>;
      const item = event.item && typeof event.item === "object" ? event.item as Record<string, unknown> : null;
      if (item?.type === "agent_message" && typeof item.text === "string") answer = item.text;
      if ((event.type === "agent_message" || event.type === "message") && typeof event.text === "string") answer = event.text;
      if (event.type === "turn.completed" && typeof event.output_text === "string") answer = event.output_text;
    } catch {
      // JSONL may include non-result diagnostic events; ignore malformed lines.
    }
  }
  return answer.trim();
}

function extractClaudeText(stdout: string): string {
  try {
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    if (typeof parsed.result === "string") return parsed.result.trim();
    if (typeof parsed.text === "string") return parsed.text.trim();
  } catch {
    // Fall through to plain output for older Claude Code versions.
  }
  return stdout.trim();
}

export async function runLocalAgent(request: LocalAgentRunRequest): Promise<LocalAgentRunResult> {
  const childProcess = nodeRequire<NodeChildProcess>("node:child_process") ?? nodeRequire<NodeChildProcess>("child_process");
  if (!childProcess) throw new Error("Node child-process runtime is unavailable on this device.");
  const provider = providerForRequest(request.provider);
  const resolved = resolveAgentCommand(provider);
  if (!resolved) throw new Error(`${provider} CLI was not found on this computer.`);
  const model = stringValue(request.model, 200);
  const args = provider === "codex"
    ? [
        ...resolved.prefixArgs,
        "exec",
        "--json",
        "--ephemeral",
        "-c",
        "mcp_servers={}",
        ...codexMcpDisableArgs(childProcess, resolved),
        ...CODEX_DISABLED_FEATURES.flatMap((feature) => ["--disable", feature]),
        "--ignore-rules",
        "--sandbox",
        "read-only",
        "--skip-git-repo-check",
        "--color",
        "never",
        ...(model ? ["--model", model] : []),
        "-"
      ]
    : [
        ...resolved.prefixArgs,
        "-p",
        "--output-format",
        "json",
        "--permission-mode",
        "dontAsk",
        "--tools",
        "",
        "--no-session-persistence",
        ...(model ? ["--model", model] : [])
      ];
  const startedAt = Date.now();
  const input = agentPrompt(request.system, request.prompt);
  const timeoutMs = positiveInt(request.timeoutMs, 300_000, 10_000, 1_800_000);
  return await new Promise((resolve, reject) => {
    const child = childProcess.spawn(resolved.command, args, {
      cwd: request.cwd || undefined,
      windowsHide: true,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        reject(error);
        return;
      }
      const text = provider === "codex" ? extractCodexText(stdout) : extractClaudeText(stdout);
      if (!text) {
        reject(new Error(`${provider} returned no assistant text${stderr.trim() ? `: ${safeErrorMessage(stderr)}` : "."}`));
        return;
      }
      request.onProgress?.(text);
      resolve({ provider, model, text, durationMs: Date.now() - startedAt });
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error(`${provider} request timed out after ${Math.round(timeoutMs / 1000)} seconds.`));
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString();
      outputBytes += Buffer.byteLength(text, "utf8");
      if (outputBytes > MAX_AGENT_OUTPUT_BYTES) {
        child.kill();
        finish(new Error(`${provider} output exceeded the safe size limit.`));
        return;
      }
      stdout += text;
      const partial = provider === "codex" ? extractCodexText(stdout) : "";
      if (partial) request.onProgress?.(partial);
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-16_000);
    });
    child.on("error", (error) => finish(new Error(`${provider} could not start: ${safeErrorMessage(error)}`)));
    child.on("close", (code) => {
      if (code !== 0) {
        finish(new Error(`${provider} exited with code ${code}: ${safeErrorMessage(stderr || stdout)}`));
        return;
      }
      finish();
    });
    child.stdin.end(input, "utf8");
  });
}
