import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { RemoteInfo, Socket } from "node:dgram";

export type LanSyncRuntimeSettings = {
  enabled: boolean;
  autoDiscovery: boolean;
  port: number;
  maxFileBytes: number;
};

export type LanSyncFileStat = {
  path: string;
  size: number;
  mtime: number;
};

export type LanSyncStorage = {
  identityRoot: string;
  listFiles(): Promise<LanSyncFileStat[]>;
  statFile(path: string): Promise<LanSyncFileStat | null>;
  readBinary(path: string): Promise<ArrayBuffer>;
  writeBinary(path: string, data: ArrayBuffer): Promise<void>;
  exists(path: string): Promise<boolean>;
  readText(path: string): Promise<string>;
  writeText(path: string, content: string): Promise<void>;
  ensureFolder(path: string): Promise<void>;
  listDirectory(path: string): Promise<string[]>;
};

export type LanSyncHttpRequest = {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
};

export type LanSyncHttpResponse = {
  status: number;
  text: string;
};

export type LanSyncProgressPhase = "stopped" | "discovering" | "connected" | "scanning" | "syncing" | "complete" | "error";

export type LanSyncProgress = {
  phase: LanSyncProgressPhase;
  active: boolean;
  peerId: string;
  peerCount: number;
  completed: number;
  total: number;
  bytesTransferred: number;
  bytesTotal: number;
  changed: number;
  conflicts: number;
  error: string;
};

export type LanSyncServiceOptions = {
  desktop: boolean;
  getSettings(): LanSyncRuntimeSettings;
  storage: LanSyncStorage;
  httpRequest(request: LanSyncHttpRequest): Promise<LanSyncHttpResponse>;
  onProgress(progress: LanSyncProgress): void;
  localStore?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
  now?: () => number;
};

export type LanSyncManifestEntry = {
  path: string;
  size: number;
  mtime: number;
  hash: string;
};

export type LanSyncReconcileAction = {
  kind: "push" | "pull" | "conflict";
  path: string;
  local: LanSyncManifestEntry | null;
  remote: LanSyncManifestEntry | null;
  winner?: "local" | "remote";
};

type LanSyncIdentity = {
  schemaVersion: 1;
  vaultId: string;
  secret: string;
  createdAt: string;
};

type LanSyncPeerDescriptor = {
  schemaVersion: 1;
  protocolVersion: 1;
  vaultId: string;
  deviceId: string;
  port: number;
  addresses: string[];
  updatedAt: string;
};

type LanSyncPeer = {
  deviceId: string;
  port: number;
  addresses: Set<string>;
  canHost: boolean;
  lastSeenAt: number;
  verifiedAt: number;
  lastProbeAt: number;
  lastSyncAt: number;
  probing: boolean;
};

type LanSyncEnvelope = {
  version: 1;
  iv: string;
  ciphertext: string;
};

type LanSyncLedger = {
  schemaVersion: 1;
  entries: Record<string, string>;
};

type NodeHttp = typeof import("node:http");
type NodeDgram = typeof import("node:dgram");
type NodeOs = typeof import("node:os");
type RequireLike = (name: string) => unknown;

const PROTOCOL_VERSION = 1;
const PROTOCOL_NAME = "cancip-lan-sync";
const API_PREFIX = "/cancip-lan/v1";
const MULTICAST_ADDRESS = "239.255.67.19";
const DISCOVERY_PORT = 43189;
const ANNOUNCE_INTERVAL_MS = 3500;
const PEER_SWEEP_INTERVAL_MS = 2000;
const PEER_PROBE_INTERVAL_MS = 10_000;
const PEER_ACTIVE_MS = 22_000;
const REMEMBERED_PEER_MAX_AGE_MS = 30 * 24 * 60 * 60_000;
const SYNC_MIN_INTERVAL_MS = 2500;
const MAX_CLOCK_SKEW_MS = 120_000;
const REPLAY_TTL_MS = 180_000;
const MAX_MANIFEST_FILES = 25_000;
const MAX_LEDGER_ENTRIES = 12_000;
const HARD_MAX_REQUEST_BYTES = 192 * 1024 * 1024;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 1200;
const DEVICE_ID_STORAGE_KEY = "cancip.lan-sync.device-id.v1";

class LanSyncProtocolError extends Error {
  constructor(
    readonly code: string,
    readonly status = 400
  ) {
    super(code);
  }
}

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

function cryptoApi(): Crypto {
  if (!globalThis.crypto?.subtle) throw new Error("secure_crypto_unavailable");
  return globalThis.crypto;
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function bytesToBase64Url(value: ArrayBuffer | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64url");
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, Math.min(bytes.length, index + 0x8000)));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) throw new LanSyncProtocolError("invalid_base64");
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(value, "base64url"));
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function randomId(bytes: number): string {
  const value = new Uint8Array(bytes);
  cryptoApi().getRandomValues(value);
  return bytesToBase64Url(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isRecord(parsed)) throw new Error("not_object");
    return parsed;
  } catch {
    throw new LanSyncProtocolError("invalid_json");
  }
}

function safeErrorCode(error: unknown): string {
  if (error instanceof LanSyncProtocolError) return error.code;
  const value = error instanceof Error ? error.message : String(error);
  if (/timeout/i.test(value)) return "timeout";
  if (/precondition/i.test(value)) return "precondition_failed";
  if (/unreachable|fetch|connect|socket|network/i.test(value)) return "peer_unreachable";
  return "sync_failed";
}

function normalizedPort(value: unknown, fallback = 43190): number {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? Math.max(1024, Math.min(65527, parsed)) : fallback;
}

function normalizedMaxFileBytes(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(64 * 1024, Math.min(100 * 1024 * 1024, Math.floor(parsed))) : 50 * 1024 * 1024;
}

function headerValue(request: IncomingMessage, name: string): string {
  const value = request.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function normalizeRemoteAddress(value: string): string {
  const trimmed = value.trim().replace(/^::ffff:/i, "");
  return trimmed === "::1" ? "127.0.0.1" : trimmed;
}

export function isPrivateLanAddress(value: string): boolean {
  const host = normalizeRemoteAddress(value).replace(/^\[|\]$/g, "");
  if (host === "127.0.0.1" || host === "localhost") return true;
  const parts = host.split(".");
  if (parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)) {
    const [a, b] = parts.map(Number);
    return a === 10
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 169 && b === 254);
  }
  return /^f[cd][0-9a-f]{2}:/i.test(host) || /^fe8[0-9a-f]:/i.test(host);
}

export function normalizeLanSyncPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const path = value.trim();
  if (!path || path.length > 1024 || path.includes("\\") || path.includes("\0") || path.startsWith("/") || /^[A-Za-z]:/.test(path)) return null;
  const segments = path.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return null;
  const root = segments[0].toLocaleLowerCase();
  if (root.startsWith(".") || root === "node_modules") return null;
  return segments.join("/");
}

export function isLanSyncPathEligible(value: unknown): value is string {
  return normalizeLanSyncPath(value) !== null;
}

async function sha256Bytes(value: ArrayBuffer | Uint8Array | string): Promise<string> {
  const bytes = typeof value === "string" ? utf8(value) : value instanceof Uint8Array ? value : new Uint8Array(value);
  return bytesToBase64Url(await cryptoApi().subtle.digest("SHA-256", arrayBuffer(bytes)));
}

async function aesKey(secret: string): Promise<CryptoKey> {
  const keyMaterial = await cryptoApi().subtle.digest("SHA-256", arrayBuffer(utf8(`cancip-lan-sync:aes:${secret}`)));
  return await cryptoApi().subtle.importKey("raw", keyMaterial, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  const keyMaterial = await cryptoApi().subtle.digest("SHA-256", arrayBuffer(utf8(`cancip-lan-sync:hmac:${secret}`)));
  return await cryptoApi().subtle.importKey("raw", keyMaterial, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function encryptLanSyncPayload(secret: string, value: unknown): Promise<string> {
  const iv = new Uint8Array(12);
  cryptoApi().getRandomValues(iv);
  const ciphertext = await cryptoApi().subtle.encrypt(
    { name: "AES-GCM", iv: arrayBuffer(iv) },
    await aesKey(secret),
    arrayBuffer(utf8(JSON.stringify(value)))
  );
  const envelope: LanSyncEnvelope = {
    version: 1,
    iv: bytesToBase64Url(iv),
    ciphertext: bytesToBase64Url(ciphertext)
  };
  return JSON.stringify(envelope);
}

export async function decryptLanSyncPayload(secret: string, value: string): Promise<Record<string, unknown>> {
  const raw = safeJsonObject(value);
  if (raw.version !== 1 || typeof raw.iv !== "string" || typeof raw.ciphertext !== "string") {
    throw new LanSyncProtocolError("invalid_envelope");
  }
  const iv = base64UrlToBytes(raw.iv);
  if (iv.byteLength !== 12) throw new LanSyncProtocolError("invalid_envelope");
  try {
    const plaintext = await cryptoApi().subtle.decrypt(
      { name: "AES-GCM", iv: arrayBuffer(iv) },
      await aesKey(secret),
      arrayBuffer(base64UrlToBytes(raw.ciphertext))
    );
    return safeJsonObject(new TextDecoder().decode(plaintext));
  } catch (error) {
    if (error instanceof LanSyncProtocolError) throw error;
    throw new LanSyncProtocolError("decrypt_failed", 401);
  }
}

async function requestSignature(secret: string, canonical: string): Promise<string> {
  return bytesToBase64Url(await cryptoApi().subtle.sign("HMAC", await hmacKey(secret), arrayBuffer(utf8(canonical))));
}

async function verifyRequestSignature(secret: string, canonical: string, signature: string): Promise<boolean> {
  try {
    return await cryptoApi().subtle.verify(
      "HMAC",
      await hmacKey(secret),
      arrayBuffer(base64UrlToBytes(signature)),
      arrayBuffer(utf8(canonical))
    );
  } catch {
    return false;
  }
}

async function authHeaders(identity: LanSyncIdentity, deviceId: string, method: string, path: string, body: string, now: number): Promise<Record<string, string>> {
  const timestamp = String(Math.floor(now));
  const nonce = randomId(18);
  const bodyHash = await sha256Bytes(body);
  const canonical = `${method}\n${path}\n${timestamp}\n${nonce}\n${bodyHash}`;
  return {
    "Content-Type": "application/json; charset=utf-8",
    "X-Cancip-Lan-Version": String(PROTOCOL_VERSION),
    "X-Cancip-Vault": identity.vaultId,
    "X-Cancip-Device": deviceId,
    "X-Cancip-Timestamp": timestamp,
    "X-Cancip-Nonce": nonce,
    "X-Cancip-Signature": await requestSignature(identity.secret, canonical)
  };
}

export async function createLanSyncRequestHeaders(input: {
  secret: string;
  vaultId: string;
  deviceId: string;
  method: string;
  path: string;
  body: string;
  now: number;
}): Promise<Record<string, string>> {
  return await authHeaders(
    { schemaVersion: 1, vaultId: input.vaultId, secret: input.secret, createdAt: new Date(input.now).toISOString() },
    input.deviceId,
    input.method,
    input.path,
    input.body,
    input.now
  );
}

export async function verifyLanSyncRequest(input: {
  secret: string;
  vaultId: string;
  method: string;
  path: string;
  body: string;
  headers: Record<string, string>;
  replayCache: Map<string, number>;
  now: number;
}): Promise<string> {
  const version = input.headers["x-cancip-lan-version"] ?? "";
  const vaultId = input.headers["x-cancip-vault"] ?? "";
  const deviceId = input.headers["x-cancip-device"] ?? "";
  const timestampText = input.headers["x-cancip-timestamp"] ?? "";
  const nonce = input.headers["x-cancip-nonce"] ?? "";
  const signature = input.headers["x-cancip-signature"] ?? "";
  if (version !== String(PROTOCOL_VERSION) || vaultId !== input.vaultId) throw new LanSyncProtocolError("vault_mismatch", 401);
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(deviceId) || !/^[A-Za-z0-9_-]{16,64}$/.test(nonce)) throw new LanSyncProtocolError("invalid_auth", 401);
  const timestamp = Number(timestampText);
  if (!Number.isFinite(timestamp) || Math.abs(input.now - timestamp) > MAX_CLOCK_SKEW_MS) throw new LanSyncProtocolError("stale_request", 401);
  for (const [key, expiresAt] of input.replayCache) {
    if (expiresAt <= input.now) input.replayCache.delete(key);
  }
  const replayKey = `${deviceId}:${nonce}`;
  if (input.replayCache.has(replayKey)) throw new LanSyncProtocolError("replayed_request", 409);
  const bodyHash = await sha256Bytes(input.body);
  const canonical = `${input.method}\n${input.path}\n${timestampText}\n${nonce}\n${bodyHash}`;
  if (!await verifyRequestSignature(input.secret, canonical, signature)) throw new LanSyncProtocolError("invalid_auth", 401);
  input.replayCache.set(replayKey, input.now + REPLAY_TTL_MS);
  return deviceId;
}

function manifestWinner(local: LanSyncManifestEntry, remote: LanSyncManifestEntry): "local" | "remote" {
  if (local.mtime !== remote.mtime) return local.mtime > remote.mtime ? "local" : "remote";
  return local.hash.localeCompare(remote.hash) >= 0 ? "local" : "remote";
}

export function planLanSyncReconciliation(
  localEntries: LanSyncManifestEntry[],
  remoteEntries: LanSyncManifestEntry[],
  ledger: Record<string, string>
): LanSyncReconcileAction[] {
  const local = new Map(localEntries.map((entry) => [entry.path, entry]));
  const remote = new Map(remoteEntries.map((entry) => [entry.path, entry]));
  const paths = [...new Set([...local.keys(), ...remote.keys()])].sort((left, right) => left.localeCompare(right));
  const actions: LanSyncReconcileAction[] = [];
  for (const path of paths) {
    const localEntry = local.get(path) ?? null;
    const remoteEntry = remote.get(path) ?? null;
    const baseline = ledger[path] ?? "";
    if (localEntry && remoteEntry) {
      if (localEntry.hash === remoteEntry.hash) continue;
      if (baseline && localEntry.hash === baseline) {
        actions.push({ kind: "pull", path, local: localEntry, remote: remoteEntry });
      } else if (baseline && remoteEntry.hash === baseline) {
        actions.push({ kind: "push", path, local: localEntry, remote: remoteEntry });
      } else {
        actions.push({ kind: "conflict", path, local: localEntry, remote: remoteEntry, winner: manifestWinner(localEntry, remoteEntry) });
      }
      continue;
    }
    // A previously synchronized unilateral absence may be a deletion. Cancip
    // deliberately leaves it for Remotely Save instead of resurrecting or deleting.
    if (baseline) continue;
    if (localEntry) actions.push({ kind: "push", path, local: localEntry, remote: null });
    else if (remoteEntry) actions.push({ kind: "pull", path, local: null, remote: remoteEntry });
  }
  return actions;
}

export function buildLanConflictPath(path: string, losingDeviceId: string, losingHash: string): string {
  const normalized = normalizeLanSyncPath(path);
  if (!normalized) throw new LanSyncProtocolError("unsafe_path");
  const slash = normalized.lastIndexOf("/");
  const folder = slash >= 0 ? normalized.slice(0, slash + 1) : "";
  const name = slash >= 0 ? normalized.slice(slash + 1) : normalized;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";
  const device = losingDeviceId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 8) || "peer";
  const hash = losingHash.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 8) || "changed";
  return `${folder}${stem} (LAN conflict ${device} ${hash})${extension}`;
}

export class LanStatusBarTakeover {
  private snapshot: {
    element: HTMLElement;
    style: string | null;
    hidden: boolean;
    ariaHidden: string | null;
  } | null = null;

  activeElement(): HTMLElement | null {
    return this.snapshot?.element ?? null;
  }

  takeOver(element: HTMLElement): void {
    if (this.snapshot?.element === element) {
      element.hidden = true;
      element.style.display = "none";
      element.setAttribute("aria-hidden", "true");
      return;
    }
    this.restore();
    this.snapshot = {
      element,
      style: element.getAttribute("style"),
      hidden: element.hidden,
      ariaHidden: element.getAttribute("aria-hidden")
    };
    element.hidden = true;
    element.style.display = "none";
    element.setAttribute("aria-hidden", "true");
  }

  restore(): void {
    const snapshot = this.snapshot;
    this.snapshot = null;
    if (!snapshot) return;
    if (snapshot.style === null) snapshot.element.removeAttribute("style");
    else snapshot.element.setAttribute("style", snapshot.style);
    snapshot.element.hidden = snapshot.hidden;
    if (snapshot.ariaHidden === null) snapshot.element.removeAttribute("aria-hidden");
    else snapshot.element.setAttribute("aria-hidden", snapshot.ariaHidden);
  }
}

function defaultProgress(phase: LanSyncProgressPhase = "stopped"): LanSyncProgress {
  return {
    phase,
    active: false,
    peerId: "",
    peerCount: 0,
    completed: 0,
    total: 0,
    bytesTransferred: 0,
    bytesTotal: 0,
    changed: 0,
    conflicts: 0,
    error: ""
  };
}

function identityFromRaw(value: unknown): LanSyncIdentity | null {
  if (!isRecord(value) || value.schemaVersion !== 1) return null;
  if (typeof value.vaultId !== "string" || !/^[A-Za-z0-9_-]{16,64}$/.test(value.vaultId)) return null;
  if (typeof value.secret !== "string" || !/^[A-Za-z0-9_-]{32,128}$/.test(value.secret)) return null;
  return {
    schemaVersion: 1,
    vaultId: value.vaultId,
    secret: value.secret,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date(0).toISOString()
  };
}

function descriptorFromRaw(value: unknown): LanSyncPeerDescriptor | null {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.protocolVersion !== 1) return null;
  if (typeof value.vaultId !== "string" || !/^[A-Za-z0-9_-]{16,64}$/.test(value.vaultId)) return null;
  if (typeof value.deviceId !== "string" || !/^[A-Za-z0-9_-]{16,64}$/.test(value.deviceId)) return null;
  const port = normalizedPort(value.port, 0);
  if (!port) return null;
  const addresses = Array.isArray(value.addresses)
    ? [...new Set(value.addresses.filter((item): item is string => typeof item === "string" && isPrivateLanAddress(item)))]
    : [];
  if (!addresses.length) return null;
  return {
    schemaVersion: 1,
    protocolVersion: 1,
    vaultId: value.vaultId,
    deviceId: value.deviceId,
    port,
    addresses,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : ""
  };
}

function readBody(request: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer | string) => {
      const bytes = typeof chunk === "string" ? Buffer.from(chunk) : new Uint8Array(chunk);
      size += bytes.byteLength;
      if (size > maxBytes) {
        reject(new LanSyncProtocolError("request_too_large", 413));
        request.destroy();
        return;
      }
      chunks.push(bytes);
    });
    request.on("end", () => {
      const merged = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
      }
      resolve(new TextDecoder().decode(merged));
    });
    request.on("error", reject);
  });
}

function sendText(response: ServerResponse, status: number, text: string, contentType = "application/json; charset=utf-8"): void {
  const body = utf8(text);
  response.statusCode = status;
  response.setHeader("Content-Type", contentType);
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Content-Length", String(body.byteLength));
  response.end(Buffer.from(body));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), Math.max(100, timeoutMs));
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class CancipLanSync {
  private identity: LanSyncIdentity | null = null;
  private deviceId = "";
  private server: Server | null = null;
  private socket: Socket | null = null;
  private boundPort = 0;
  private runningValue = false;
  private peers = new Map<string, LanSyncPeer>();
  private replayCache = new Map<string, number>();
  private rateByClient = new Map<string, { startedAt: number; count: number }>();
  private hashCache = new Map<string, { signature: string; hash: string }>();
  private intervals: Array<ReturnType<typeof setInterval>> = [];
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private syncRunning = false;
  private syncQueued = false;
  private lastTransferAt = 0;
  private progressValue = defaultProgress();
  private lastErrorValue = "";

  constructor(private readonly options: LanSyncServiceOptions) {}

  running(): boolean {
    return this.runningValue;
  }

  port(): number {
    return this.boundPort;
  }

  progress(): LanSyncProgress {
    return { ...this.progressValue };
  }

  status(): { running: boolean; port: number; peerCount: number; error: string; desktop: boolean } {
    return {
      running: this.runningValue,
      port: this.boundPort,
      peerCount: this.activePeers().length,
      error: this.lastErrorValue,
      desktop: this.options.desktop
    };
  }

  async start(): Promise<void> {
    if (this.runningValue) return;
    const settings = this.settings();
    if (!settings.enabled) {
      this.emit(defaultProgress("stopped"));
      return;
    }
    this.identity = await this.loadOrCreateIdentity();
    this.deviceId = this.loadOrCreateDeviceId();
    this.runningValue = true;
    this.lastErrorValue = "";
    try {
      if (this.options.desktop) {
        await this.startServer();
        await this.publishPeerDescriptor();
        if (settings.autoDiscovery) {
          try {
            await this.startDiscoverySocket();
          } catch {
            this.socket = null;
          }
        }
      }
      await this.loadRememberedPeers();
      this.intervals.push(setInterval(() => this.announce(), ANNOUNCE_INTERVAL_MS));
      this.intervals.push(setInterval(() => void this.probePeers(), PEER_PROBE_INTERVAL_MS));
      this.intervals.push(setInterval(() => this.sweepPeers(), PEER_SWEEP_INTERVAL_MS));
      this.announce();
      this.emit({ ...defaultProgress("discovering"), active: false });
      void this.probePeers();
    } catch (error) {
      this.lastErrorValue = safeErrorCode(error);
      await this.stop();
      this.emit({ ...defaultProgress("error"), error: this.lastErrorValue });
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.runningValue = false;
    this.syncQueued = false;
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }
    for (const interval of this.intervals) clearInterval(interval);
    this.intervals = [];
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      try {
        socket.close();
      } catch {
        // Already closed.
      }
    }
    const server = this.server;
    this.server = null;
    this.boundPort = 0;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    this.peers.clear();
    this.replayCache.clear();
    this.rateByClient.clear();
    this.emit(defaultProgress("stopped"));
  }

  notifyVaultChange(path: string): void {
    const normalized = normalizeLanSyncPath(path);
    if (!normalized) return;
    this.hashCache.delete(normalized);
    this.scheduleSync(700);
  }

  requestSync(): void {
    this.scheduleSync(0);
  }

  private settings(): LanSyncRuntimeSettings {
    const raw = this.options.getSettings();
    return {
      enabled: raw.enabled === true,
      autoDiscovery: raw.autoDiscovery === true,
      port: normalizedPort(raw.port),
      maxFileBytes: normalizedMaxFileBytes(raw.maxFileBytes)
    };
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private localStore(): Pick<Storage, "getItem" | "setItem" | "removeItem"> | null {
    if (this.options.localStore !== undefined) return this.options.localStore;
    try {
      return globalThis.localStorage;
    } catch {
      return null;
    }
  }

  private emit(progress: LanSyncProgress): void {
    this.progressValue = { ...progress, peerCount: this.activePeers().length };
    try {
      this.options.onProgress({ ...this.progressValue });
    } catch {
      // UI reporting must never interrupt synchronization.
    }
  }

  private async loadOrCreateIdentity(): Promise<LanSyncIdentity> {
    const root = this.options.storage.identityRoot.replace(/\/+$/, "");
    const path = `${root}/identity.json`;
    await this.options.storage.ensureFolder(root);
    if (await this.options.storage.exists(path)) {
      const identity = identityFromRaw(safeJsonObject(await this.options.storage.readText(path)));
      if (!identity) throw new Error("invalid_lan_identity");
      return identity;
    }
    const identity: LanSyncIdentity = {
      schemaVersion: 1,
      vaultId: randomId(18),
      secret: randomId(32),
      createdAt: new Date(this.now()).toISOString()
    };
    await this.options.storage.writeText(path, `${JSON.stringify(identity, null, 2)}\n`);
    const verified = identityFromRaw(safeJsonObject(await this.options.storage.readText(path)));
    if (!verified) throw new Error("lan_identity_write_failed");
    return verified;
  }

  private async refreshIdentityIfChanged(): Promise<void> {
    if (!this.identity) return;
    const path = `${this.options.storage.identityRoot.replace(/\/+$/, "")}/identity.json`;
    try {
      const next = identityFromRaw(safeJsonObject(await this.options.storage.readText(path)));
      if (!next || (next.vaultId === this.identity.vaultId && next.secret === this.identity.secret)) return;
      this.identity = next;
      this.peers.clear();
      this.replayCache.clear();
      this.rateByClient.clear();
      if (this.options.desktop) await this.publishPeerDescriptor();
      await this.loadRememberedPeers();
      this.announce();
      this.emit({ ...defaultProgress("discovering"), active: false });
    } catch {
      // Keep the last valid identity until the synchronized file is complete.
    }
  }

  private loadOrCreateDeviceId(): string {
    const store = this.localStore();
    const current = store?.getItem(DEVICE_ID_STORAGE_KEY) ?? "";
    if (/^[A-Za-z0-9_-]{16,64}$/.test(current)) return current;
    const next = randomId(18);
    try {
      store?.setItem(DEVICE_ID_STORAGE_KEY, next);
    } catch {
      // The current process still keeps a stable ID until reload.
    }
    return next;
  }

  private localAddresses(): string[] {
    const os = nodeRequire<NodeOs>("node:os") ?? nodeRequire<NodeOs>("os");
    if (!os) return [];
    const addresses: string[] = [];
    for (const rows of Object.values(os.networkInterfaces())) {
      for (const row of rows ?? []) {
        if (row.family !== "IPv4" || row.internal || !isPrivateLanAddress(row.address) || row.address === "127.0.0.1") continue;
        addresses.push(row.address);
      }
    }
    return [...new Set(addresses)].sort();
  }

  private async publishPeerDescriptor(): Promise<void> {
    if (!this.identity || !this.boundPort) return;
    const addresses = this.localAddresses();
    if (!addresses.length) return;
    const folder = `${this.options.storage.identityRoot.replace(/\/+$/, "")}/peers`;
    const path = `${folder}/${this.deviceId}.json`;
    await this.options.storage.ensureFolder(folder);
    let previous: LanSyncPeerDescriptor | null = null;
    if (await this.options.storage.exists(path)) {
      try {
        previous = descriptorFromRaw(safeJsonObject(await this.options.storage.readText(path)));
      } catch {
        previous = null;
      }
    }
    const previousAge = previous?.updatedAt ? this.now() - Date.parse(previous.updatedAt) : Number.POSITIVE_INFINITY;
    if (previous
      && previous.vaultId === this.identity.vaultId
      && previous.port === this.boundPort
      && JSON.stringify(previous.addresses) === JSON.stringify(addresses)
      && previousAge >= 0
      && previousAge < 24 * 60 * 60_000) return;
    const descriptor: LanSyncPeerDescriptor = {
      schemaVersion: 1,
      protocolVersion: 1,
      vaultId: this.identity.vaultId,
      deviceId: this.deviceId,
      port: this.boundPort,
      addresses,
      updatedAt: new Date(this.now()).toISOString()
    };
    await this.options.storage.writeText(path, `${JSON.stringify(descriptor, null, 2)}\n`);
  }

  private async loadRememberedPeers(): Promise<void> {
    if (!this.identity) return;
    const folder = `${this.options.storage.identityRoot.replace(/\/+$/, "")}/peers`;
    if (!await this.options.storage.exists(folder)) return;
    let files: string[] = [];
    try {
      files = await this.options.storage.listDirectory(folder);
    } catch {
      return;
    }
    for (const path of files.slice(0, 100)) {
      if (!path.toLowerCase().endsWith(".json")) continue;
      try {
        const descriptor = descriptorFromRaw(safeJsonObject(await this.options.storage.readText(path)));
        if (!descriptor || descriptor.vaultId !== this.identity.vaultId || descriptor.deviceId === this.deviceId) continue;
        const updatedAt = Date.parse(descriptor.updatedAt);
        if (!Number.isFinite(updatedAt) || this.now() - updatedAt > REMEMBERED_PEER_MAX_AGE_MS) continue;
        this.upsertPeer(descriptor.deviceId, descriptor.port, descriptor.addresses, 0, true);
      } catch {
        // Ignore malformed/stale descriptors without changing them.
      }
    }
  }

  private async startServer(): Promise<void> {
    const http = nodeRequire<NodeHttp>("node:http") ?? nodeRequire<NodeHttp>("http");
    if (!http) throw new Error("node_http_unavailable");
    let latestError: unknown = null;
    for (let offset = 0; offset <= 8; offset += 1) {
      const port = this.settings().port + offset;
      try {
        const server = http.createServer((request, response) => void this.handleServerRequest(request, response));
        server.requestTimeout = 45_000;
        server.headersTimeout = 10_000;
        server.keepAliveTimeout = 5000;
        await new Promise<void>((resolve, reject) => {
          const onError = (error: Error): void => reject(error);
          server.once("error", onError);
          server.listen(port, "0.0.0.0", () => {
            server.off("error", onError);
            resolve();
          });
        });
        this.server = server;
        this.boundPort = port;
        return;
      } catch (error) {
        latestError = error;
      }
    }
    throw new Error(`lan_server_bind_failed:${safeErrorCode(latestError)}`);
  }

  private async startDiscoverySocket(): Promise<void> {
    const dgram = nodeRequire<NodeDgram>("node:dgram") ?? nodeRequire<NodeDgram>("dgram");
    if (!dgram) return;
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    socket.on("message", (message, remote) => this.handleAnnouncement(message, remote));
    socket.on("error", () => {
      if (this.socket === socket) {
        try {
          socket.close();
        } catch {
          // Already closed.
        }
        this.socket = null;
      }
    });
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => reject(error);
      socket.once("error", onError);
      socket.bind(DISCOVERY_PORT, "0.0.0.0", () => {
        socket.off("error", onError);
        try {
          socket.addMembership(MULTICAST_ADDRESS);
          socket.setMulticastTTL(1);
          socket.setBroadcast(true);
        } catch {
          // Limited networks can still use remembered peer descriptors.
        }
        resolve();
      });
    });
    this.socket = socket;
  }

  private announce(): void {
    if (!this.runningValue || !this.socket || !this.identity || !this.boundPort) return;
    const packet = Buffer.from(JSON.stringify({
      protocol: PROTOCOL_NAME,
      version: PROTOCOL_VERSION,
      vaultId: this.identity.vaultId,
      deviceId: this.deviceId,
      port: this.boundPort,
      timestamp: this.now()
    }), "utf8");
    if (packet.byteLength > 1024) return;
    this.socket.send(packet, DISCOVERY_PORT, MULTICAST_ADDRESS, () => undefined);
    this.socket.send(packet, DISCOVERY_PORT, "255.255.255.255", () => undefined);
  }

  private handleAnnouncement(message: Buffer, remote: RemoteInfo): void {
    if (!this.identity || message.byteLength > 1024) return;
    try {
      const raw = safeJsonObject(message.toString("utf8"));
      if (raw.protocol !== PROTOCOL_NAME || raw.version !== PROTOCOL_VERSION || raw.vaultId !== this.identity.vaultId) return;
      if (typeof raw.deviceId !== "string" || !/^[A-Za-z0-9_-]{16,64}$/.test(raw.deviceId) || raw.deviceId === this.deviceId) return;
      const port = normalizedPort(raw.port, 0);
      const address = normalizeRemoteAddress(remote.address);
      if (!port || !isPrivateLanAddress(address)) return;
      const peer = this.upsertPeer(raw.deviceId, port, [address], this.now(), true);
      void this.verifyPeer(peer);
    } catch {
      // Discovery packets are untrusted and intentionally ignored on failure.
    }
  }

  private upsertPeer(deviceId: string, port: number, addresses: string[], seenAt: number, canHost: boolean): LanSyncPeer {
    let peer = this.peers.get(deviceId);
    if (!peer) {
      peer = {
        deviceId,
        port,
        addresses: new Set(),
        canHost,
        lastSeenAt: seenAt,
        verifiedAt: 0,
        lastProbeAt: 0,
        lastSyncAt: 0,
        probing: false
      };
      this.peers.set(deviceId, peer);
    }
    peer.port = normalizedPort(port);
    peer.canHost = peer.canHost || canHost;
    peer.lastSeenAt = Math.max(peer.lastSeenAt, seenAt);
    for (const address of addresses.map(normalizeRemoteAddress)) {
      if (isPrivateLanAddress(address)) peer.addresses.add(address);
    }
    return peer;
  }

  private markInboundPeer(deviceId: string, address: string, route: string): void {
    if (deviceId === this.deviceId) return;
    const peer = this.upsertPeer(
      deviceId,
      this.peers.get(deviceId)?.port ?? this.settings().port,
      isPrivateLanAddress(address) ? [address] : [],
      this.now(),
      this.peers.get(deviceId)?.canHost === true
    );
    peer.verifiedAt = this.now();
    this.lastTransferAt = this.now();
    const transfer = route.includes("/file/");
    this.emit({
      ...defaultProgress(transfer ? "syncing" : "connected"),
      active: true,
      peerId: deviceId
    });
  }

  private async verifyPeer(peer: LanSyncPeer): Promise<void> {
    const now = this.now();
    if (!this.runningValue || !peer.canHost || peer.probing || now - peer.lastProbeAt < 2500 || !peer.addresses.size) return;
    peer.probing = true;
    peer.lastProbeAt = now;
    try {
      const response = await this.callPeer(peer, "/ping", {});
      if (response.protocolVersion !== PROTOCOL_VERSION || response.deviceId !== peer.deviceId) throw new Error("peer_identity_mismatch");
      peer.verifiedAt = this.now();
      peer.lastSeenAt = Math.max(peer.lastSeenAt, peer.verifiedAt);
      this.lastErrorValue = "";
      this.emit({ ...defaultProgress("connected"), active: true, peerId: peer.deviceId });
      this.scheduleSync(200);
    } catch {
      // A remembered endpoint can be offline or reassigned. It is not active
      // until the authenticated ping succeeds.
    } finally {
      peer.probing = false;
    }
  }

  private async probePeers(): Promise<void> {
    if (!this.runningValue) return;
    await this.refreshIdentityIfChanged();
    await Promise.all([...this.peers.values()].slice(0, 16).map(async (peer) => await this.verifyPeer(peer)));
  }

  private activePeers(): LanSyncPeer[] {
    const now = this.now();
    return [...this.peers.values()]
      .filter((peer) => peer.verifiedAt > 0 && now - peer.verifiedAt <= PEER_ACTIVE_MS)
      .sort((left, right) => left.deviceId.localeCompare(right.deviceId));
  }

  private sweepPeers(): void {
    const active = this.activePeers();
    if (!active.length) {
      if (this.progressValue.active) this.emit({ ...defaultProgress("discovering"), active: false });
      return;
    }
    if (this.progressValue.phase === "syncing" && !this.syncRunning && this.now() - this.lastTransferAt > 1600) {
      this.emit({ ...defaultProgress("connected"), active: true, peerId: active[0].deviceId });
    }
  }

  private scheduleSync(delay: number): void {
    if (!this.runningValue || !this.syncTargets().length) return;
    if (this.syncRunning) {
      this.syncQueued = true;
      return;
    }
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      void this.syncActivePeers();
    }, Math.max(0, delay));
  }

  private isCoordinator(): boolean {
    if (!this.options.desktop) return true;
    return this.syncTargets().every((peer) => this.deviceId.localeCompare(peer.deviceId) < 0);
  }

  private syncTargets(): LanSyncPeer[] {
    return this.activePeers().filter((peer) => peer.canHost);
  }

  private async syncActivePeers(): Promise<void> {
    if (!this.runningValue || this.syncRunning || !this.isCoordinator()) return;
    const peers = this.syncTargets();
    if (!peers.length) return;
    this.syncRunning = true;
    try {
      for (const peer of peers) {
        if (!this.runningValue) break;
        if (this.now() - peer.lastSyncAt < SYNC_MIN_INTERVAL_MS && !this.syncQueued) continue;
        await this.syncPeer(peer);
        peer.lastSyncAt = this.now();
      }
    } catch (error) {
      this.lastErrorValue = safeErrorCode(error);
      const peer = peers[0];
      this.emit({ ...defaultProgress("error"), active: Boolean(peer), peerId: peer?.deviceId ?? "", error: this.lastErrorValue });
    } finally {
      this.syncRunning = false;
      if (this.syncQueued) {
        this.syncQueued = false;
        this.scheduleSync(900);
      }
    }
  }

  private async syncPeer(peer: LanSyncPeer): Promise<void> {
    this.emit({ ...defaultProgress("scanning"), active: true, peerId: peer.deviceId });
    const [localEntries, remoteResponse, ledger] = await Promise.all([
      this.buildManifest(),
      this.callPeer(peer, "/manifest", {}),
      Promise.resolve(this.loadLedger(peer.deviceId))
    ]);
    const remoteEntries = this.parseManifest(remoteResponse.files);
    const localMap = new Map(localEntries.map((entry) => [entry.path, entry]));
    const remoteMap = new Map(remoteEntries.map((entry) => [entry.path, entry]));
    for (const path of Object.keys(ledger.entries)) {
      if (!localMap.has(path) && !remoteMap.has(path)) delete ledger.entries[path];
    }
    for (const path of [...new Set([...localMap.keys(), ...remoteMap.keys()])]) {
      const local = localMap.get(path);
      const remote = remoteMap.get(path);
      if (local && remote && local.hash === remote.hash) ledger.entries[path] = local.hash;
    }
    const actions = planLanSyncReconciliation(localEntries, remoteEntries, ledger.entries);
    const bytesTotal = actions.reduce((sum, action) => sum + Math.max(action.local?.size ?? 0, action.remote?.size ?? 0), 0);
    let completed = 0;
    let bytesTransferred = 0;
    let changed = 0;
    let conflicts = 0;
    this.emit({
      ...defaultProgress(actions.length ? "syncing" : "complete"),
      active: true,
      peerId: peer.deviceId,
      total: actions.length,
      bytesTotal
    });
    for (const action of actions) {
      if (!this.runningValue) break;
      const result = await this.executeAction(peer, action, ledger);
      completed += 1;
      bytesTransferred += result.bytes;
      changed += result.changed ? 1 : 0;
      conflicts += result.conflict ? 1 : 0;
      this.lastTransferAt = this.now();
      this.emit({
        ...defaultProgress("syncing"),
        active: true,
        peerId: peer.deviceId,
        completed,
        total: actions.length,
        bytesTransferred,
        bytesTotal,
        changed,
        conflicts
      });
    }
    this.saveLedger(peer.deviceId, ledger);
    peer.verifiedAt = this.now();
    this.lastErrorValue = "";
    this.emit({
      ...defaultProgress("complete"),
      active: true,
      peerId: peer.deviceId,
      completed,
      total: actions.length,
      bytesTransferred,
      bytesTotal,
      changed,
      conflicts
    });
  }

  private async executeAction(peer: LanSyncPeer, action: LanSyncReconcileAction, ledger: LanSyncLedger): Promise<{ bytes: number; changed: boolean; conflict: boolean }> {
    if (action.kind === "push" && action.local) {
      const bytes = await this.readLocalVerified(action.local.path, action.local.hash);
      await this.writeRemote(peer, action.path, bytes, action.remote?.hash ?? null, action.local.hash);
      ledger.entries[action.path] = action.local.hash;
      return { bytes: bytes.byteLength, changed: true, conflict: false };
    }
    if (action.kind === "pull" && action.remote) {
      const bytes = await this.readRemote(peer, action.remote);
      await this.writeLocal(action.path, bytes, action.local?.hash ?? null, action.remote.hash);
      ledger.entries[action.path] = action.remote.hash;
      return { bytes: bytes.byteLength, changed: true, conflict: false };
    }
    if (action.kind === "conflict" && action.local && action.remote && action.winner) {
      if (action.winner === "local") {
        const [localBytes, remoteBytes] = await Promise.all([
          this.readLocalVerified(action.path, action.local.hash),
          this.readRemote(peer, action.remote)
        ]);
        const conflictPath = buildLanConflictPath(action.path, peer.deviceId, action.remote.hash);
        await this.writeLocalIfMissingOrSame(conflictPath, remoteBytes, action.remote.hash);
        await this.writeRemoteIfMissingOrSame(peer, conflictPath, remoteBytes, action.remote.hash);
        await this.writeRemote(peer, action.path, localBytes, action.remote.hash, action.local.hash);
        ledger.entries[action.path] = action.local.hash;
        ledger.entries[conflictPath] = action.remote.hash;
        return { bytes: localBytes.byteLength + remoteBytes.byteLength * 2, changed: true, conflict: true };
      }
      const localBytes = await this.readLocalVerified(action.path, action.local.hash);
      const remoteBytes = await this.readRemote(peer, action.remote);
      const conflictPath = buildLanConflictPath(action.path, this.deviceId, action.local.hash);
      await this.writeRemoteIfMissingOrSame(peer, conflictPath, localBytes, action.local.hash);
      await this.writeLocalIfMissingOrSame(conflictPath, localBytes, action.local.hash);
      await this.writeLocal(action.path, remoteBytes, action.local.hash, action.remote.hash);
      ledger.entries[action.path] = action.remote.hash;
      ledger.entries[conflictPath] = action.local.hash;
      return { bytes: localBytes.byteLength * 2 + remoteBytes.byteLength, changed: true, conflict: true };
    }
    return { bytes: 0, changed: false, conflict: false };
  }

  private async buildManifest(): Promise<LanSyncManifestEntry[]> {
    const maxFileBytes = this.settings().maxFileBytes;
    const files = (await this.options.storage.listFiles())
      .map((file) => ({ ...file, path: normalizeLanSyncPath(file.path) }))
      .filter((file): file is Omit<LanSyncFileStat, "path"> & { path: string } => Boolean(file.path) && file.size >= 0 && file.size <= maxFileBytes)
      .sort((left, right) => left.path.localeCompare(right.path))
      .slice(0, MAX_MANIFEST_FILES);
    const entries: LanSyncManifestEntry[] = [];
    for (const file of files) {
      const signature = `${file.mtime}:${file.size}`;
      let hash = this.hashCache.get(file.path)?.signature === signature ? this.hashCache.get(file.path)?.hash ?? "" : "";
      if (!hash) {
        hash = await sha256Bytes(await this.options.storage.readBinary(file.path));
        this.hashCache.set(file.path, { signature, hash });
      }
      entries.push({ path: file.path, size: file.size, mtime: file.mtime, hash });
    }
    return entries;
  }

  private parseManifest(value: unknown): LanSyncManifestEntry[] {
    if (!Array.isArray(value) || value.length > MAX_MANIFEST_FILES) throw new LanSyncProtocolError("invalid_manifest");
    const entries: LanSyncManifestEntry[] = [];
    for (const item of value) {
      if (!isRecord(item)) throw new LanSyncProtocolError("invalid_manifest");
      const path = normalizeLanSyncPath(item.path);
      const size = Number(item.size);
      const mtime = Number(item.mtime);
      const hash = typeof item.hash === "string" ? item.hash : "";
      if (!path || !Number.isFinite(size) || size < 0 || size > this.settings().maxFileBytes || !Number.isFinite(mtime) || !/^[A-Za-z0-9_-]{32,64}$/.test(hash)) {
        throw new LanSyncProtocolError("invalid_manifest");
      }
      entries.push({ path, size, mtime, hash });
    }
    return entries;
  }

  private ledgerKey(peerId: string): string {
    return `cancip.lan-sync.ledger.v1.${this.identity?.vaultId ?? "unknown"}.${peerId}`;
  }

  private loadLedger(peerId: string): LanSyncLedger {
    try {
      const raw = this.localStore()?.getItem(this.ledgerKey(peerId));
      if (!raw) return { schemaVersion: 1, entries: {} };
      const parsed = safeJsonObject(raw);
      if (parsed.schemaVersion !== 1 || !isRecord(parsed.entries)) return { schemaVersion: 1, entries: {} };
      const entries: Record<string, string> = {};
      for (const [path, hash] of Object.entries(parsed.entries).slice(-MAX_LEDGER_ENTRIES)) {
        const normalized = normalizeLanSyncPath(path);
        if (normalized && typeof hash === "string" && /^[A-Za-z0-9_-]{32,64}$/.test(hash)) entries[normalized] = hash;
      }
      return { schemaVersion: 1, entries };
    } catch {
      return { schemaVersion: 1, entries: {} };
    }
  }

  private saveLedger(peerId: string, ledger: LanSyncLedger): void {
    const keys = Object.keys(ledger.entries);
    const trimmed = keys.length <= MAX_LEDGER_ENTRIES
      ? ledger.entries
      : Object.fromEntries(keys.slice(-MAX_LEDGER_ENTRIES).map((key) => [key, ledger.entries[key]]));
    try {
      this.localStore()?.setItem(this.ledgerKey(peerId), JSON.stringify({ schemaVersion: 1, entries: trimmed }));
    } catch {
      try {
        const smaller = Object.fromEntries(Object.entries(trimmed).slice(-3000));
        this.localStore()?.setItem(this.ledgerKey(peerId), JSON.stringify({ schemaVersion: 1, entries: smaller }));
      } catch {
        // Synchronization remains safe; the next run may be more conservative.
      }
    }
  }

  private async readLocalVerified(path: string, expectedHash: string): Promise<Uint8Array> {
    const normalized = normalizeLanSyncPath(path);
    if (!normalized) throw new LanSyncProtocolError("unsafe_path");
    const bytes = new Uint8Array(await this.options.storage.readBinary(normalized));
    if (bytes.byteLength > this.settings().maxFileBytes || await sha256Bytes(bytes) !== expectedHash) throw new LanSyncProtocolError("precondition_failed", 409);
    return bytes;
  }

  private async writeLocal(path: string, bytes: Uint8Array, expectedHash: string | null, suppliedHash: string): Promise<void> {
    const normalized = normalizeLanSyncPath(path);
    if (!normalized || bytes.byteLength > this.settings().maxFileBytes || await sha256Bytes(bytes) !== suppliedHash) throw new LanSyncProtocolError("unsafe_write", 400);
    const current = await this.options.storage.statFile(normalized);
    if (expectedHash === null) {
      if (current) throw new LanSyncProtocolError("precondition_failed", 409);
    } else {
      if (!current || await sha256Bytes(await this.options.storage.readBinary(normalized)) !== expectedHash) throw new LanSyncProtocolError("precondition_failed", 409);
    }
    await this.options.storage.writeBinary(normalized, arrayBuffer(bytes));
    this.hashCache.delete(normalized);
    const written = await this.options.storage.statFile(normalized);
    if (!written || await sha256Bytes(await this.options.storage.readBinary(normalized)) !== suppliedHash) throw new Error("write_verification_failed");
  }

  private async writeLocalIfMissingOrSame(path: string, bytes: Uint8Array, hash: string): Promise<void> {
    const stat = await this.options.storage.statFile(path);
    if (stat) {
      if (await sha256Bytes(await this.options.storage.readBinary(path)) === hash) return;
      throw new LanSyncProtocolError("conflict_copy_collision", 409);
    }
    await this.writeLocal(path, bytes, null, hash);
  }

  private async readRemote(peer: LanSyncPeer, entry: LanSyncManifestEntry): Promise<Uint8Array> {
    const response = await this.callPeer(peer, "/file/read", { path: entry.path, expectedHash: entry.hash }, 45_000);
    if (response.path !== entry.path || response.hash !== entry.hash || typeof response.data !== "string") throw new LanSyncProtocolError("invalid_file_response");
    const bytes = base64UrlToBytes(response.data);
    if (bytes.byteLength !== entry.size || bytes.byteLength > this.settings().maxFileBytes || await sha256Bytes(bytes) !== entry.hash) throw new LanSyncProtocolError("invalid_file_response");
    return bytes;
  }

  private async writeRemote(peer: LanSyncPeer, path: string, bytes: Uint8Array, expectedHash: string | null, hash: string): Promise<void> {
    const response = await this.callPeer(peer, "/file/write", {
      path,
      expectedHash,
      hash,
      data: bytesToBase64Url(bytes)
    }, 45_000);
    if (response.hash !== hash) throw new Error("remote_write_verification_failed");
  }

  private async writeRemoteIfMissingOrSame(peer: LanSyncPeer, path: string, bytes: Uint8Array, hash: string): Promise<void> {
    try {
      await this.writeRemote(peer, path, bytes, null, hash);
    } catch (error) {
      if (safeErrorCode(error) !== "precondition_failed") throw error;
      const response = await this.callPeer(peer, "/file/read", { path, expectedHash: hash }, 45_000);
      if (response.hash !== hash) throw error;
    }
  }

  private async callPeer(peer: LanSyncPeer, route: string, payload: Record<string, unknown>, timeoutMs = 8000): Promise<Record<string, unknown>> {
    if (!this.identity) throw new Error("identity_unavailable");
    const path = `${API_PREFIX}${route}`;
    const body = await encryptLanSyncPayload(this.identity.secret, payload);
    const headers = await authHeaders(this.identity, this.deviceId, "POST", path, body, this.now());
    let lastError: unknown = null;
    for (const address of peer.addresses) {
      if (!isPrivateLanAddress(address)) continue;
      const host = address.includes(":") ? `[${address}]` : address;
      try {
        const response = await withTimeout(this.options.httpRequest({
          url: `http://${host}:${peer.port}${path}`,
          method: "POST",
          headers,
          body,
          timeoutMs
        }), timeoutMs);
        if (response.status < 200 || response.status >= 300) {
          let code = "peer_rejected";
          try {
            const errorBody = safeJsonObject(response.text);
            if (typeof errorBody.error === "string") code = errorBody.error;
          } catch {
            // Keep the generic error code.
          }
          throw new LanSyncProtocolError(code, response.status);
        }
        const decrypted = await decryptLanSyncPayload(this.identity.secret, response.text);
        peer.verifiedAt = this.now();
        return decrypted;
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError instanceof LanSyncProtocolError) throw lastError;
    throw new Error(`peer_unreachable:${safeErrorCode(lastError)}`);
  }

  private allowedByRateLimit(key: string): boolean {
    const now = this.now();
    const current = this.rateByClient.get(key);
    if (!current || now - current.startedAt >= RATE_WINDOW_MS) {
      this.rateByClient.set(key, { startedAt: now, count: 1 });
      return true;
    }
    current.count += 1;
    return current.count <= RATE_LIMIT;
  }

  private async handleServerRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    let authenticated = false;
    try {
      if (!this.identity || request.method !== "POST") throw new LanSyncProtocolError("not_found", 404);
      const url = new URL(request.url ?? "/", "http://cancip-lan.local");
      const path = url.pathname;
      if (!path.startsWith(`${API_PREFIX}/`)) throw new LanSyncProtocolError("not_found", 404);
      const maxBody = Math.min(HARD_MAX_REQUEST_BYTES, this.settings().maxFileBytes * 2 + 2 * 1024 * 1024);
      const body = await readBody(request, maxBody);
      const headers: Record<string, string> = {
        "x-cancip-lan-version": headerValue(request, "x-cancip-lan-version"),
        "x-cancip-vault": headerValue(request, "x-cancip-vault"),
        "x-cancip-device": headerValue(request, "x-cancip-device"),
        "x-cancip-timestamp": headerValue(request, "x-cancip-timestamp"),
        "x-cancip-nonce": headerValue(request, "x-cancip-nonce"),
        "x-cancip-signature": headerValue(request, "x-cancip-signature")
      };
      const deviceId = await verifyLanSyncRequest({
        secret: this.identity.secret,
        vaultId: this.identity.vaultId,
        method: request.method,
        path,
        body,
        headers,
        replayCache: this.replayCache,
        now: this.now()
      });
      authenticated = true;
      const remoteAddress = normalizeRemoteAddress(request.socket.remoteAddress ?? "");
      if (!this.allowedByRateLimit(`${remoteAddress}:${deviceId}`)) throw new LanSyncProtocolError("rate_limited", 429);
      const payload = await decryptLanSyncPayload(this.identity.secret, body);
      this.markInboundPeer(deviceId, remoteAddress, path);
      let result: Record<string, unknown>;
      if (path === `${API_PREFIX}/ping`) {
        result = { ok: true, protocolVersion: PROTOCOL_VERSION, deviceId: this.deviceId };
      } else if (path === `${API_PREFIX}/manifest`) {
        result = { files: await this.buildManifest() };
      } else if (path === `${API_PREFIX}/file/read`) {
        result = await this.handleReadFile(payload);
      } else if (path === `${API_PREFIX}/file/write`) {
        result = await this.handleWriteFile(payload);
      } else {
        throw new LanSyncProtocolError("not_found", 404);
      }
      sendText(response, 200, await encryptLanSyncPayload(this.identity.secret, result));
    } catch (error) {
      const protocol = error instanceof LanSyncProtocolError ? error : new LanSyncProtocolError(safeErrorCode(error), 500);
      sendText(response, protocol.status, JSON.stringify({ ok: false, error: authenticated ? protocol.code : "request_rejected" }));
    }
  }

  private async handleReadFile(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const path = normalizeLanSyncPath(payload.path);
    const expectedHash = typeof payload.expectedHash === "string" ? payload.expectedHash : "";
    if (!path || !/^[A-Za-z0-9_-]{32,64}$/.test(expectedHash)) throw new LanSyncProtocolError("unsafe_path");
    const stat = await this.options.storage.statFile(path);
    if (!stat || stat.size > this.settings().maxFileBytes) throw new LanSyncProtocolError("file_unavailable", 404);
    const bytes = new Uint8Array(await this.options.storage.readBinary(path));
    const hash = await sha256Bytes(bytes);
    if (hash !== expectedHash) throw new LanSyncProtocolError("precondition_failed", 409);
    return { path, hash, mtime: stat.mtime, size: bytes.byteLength, data: bytesToBase64Url(bytes) };
  }

  private async handleWriteFile(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const path = normalizeLanSyncPath(payload.path);
    const expectedHash = payload.expectedHash === null ? null : typeof payload.expectedHash === "string" ? payload.expectedHash : undefined;
    const hash = typeof payload.hash === "string" ? payload.hash : "";
    const encoded = typeof payload.data === "string" ? payload.data : "";
    if (!path || expectedHash === undefined || (expectedHash !== null && !/^[A-Za-z0-9_-]{32,64}$/.test(expectedHash)) || !/^[A-Za-z0-9_-]{32,64}$/.test(hash)) {
      throw new LanSyncProtocolError("unsafe_write");
    }
    const bytes = base64UrlToBytes(encoded);
    if (bytes.byteLength > this.settings().maxFileBytes || await sha256Bytes(bytes) !== hash) throw new LanSyncProtocolError("invalid_file_content");
    await this.writeLocal(path, bytes, expectedHash, hash);
    return { ok: true, path, hash, size: bytes.byteLength };
  }
}
