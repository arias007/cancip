import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const temp = await mkdtemp(join(tmpdir(), "cancip-lan-sync-"));

function memoryLocalStore(deviceId) {
  const values = new Map([["cancip.lan-sync.device-id.v1", deviceId]]);
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key)
  };
}

function bytes(value) {
  return new TextEncoder().encode(value);
}

function arrayBuffer(value) {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
}

class MemoryStorage {
  constructor(identity, files = {}) {
    this.identityRoot = ".obsidian/plugins/cancip/data/lan-sync";
    this.files = new Map();
    this.folders = new Set([
      ".obsidian",
      ".obsidian/plugins",
      ".obsidian/plugins/cancip",
      ".obsidian/plugins/cancip/data",
      this.identityRoot,
      `${this.identityRoot}/peers`
    ]);
    this.clock = 1000;
    this.putText(`${this.identityRoot}/identity.json`, `${JSON.stringify(identity)}\n`, 1);
    for (const [path, value] of Object.entries(files)) this.putText(path, value.content, value.mtime);
  }

  putText(path, content, mtime = ++this.clock) {
    const value = bytes(content);
    this.files.set(path, { data: value, mtime });
    const segments = path.split("/");
    for (let index = 1; index < segments.length; index += 1) this.folders.add(segments.slice(0, index).join("/"));
  }

  text(path) {
    const entry = this.files.get(path);
    return entry ? new TextDecoder().decode(entry.data) : null;
  }

  async listFiles(includeConfigFolder = false) {
    return [...this.files.entries()]
      .filter(([path]) => includeConfigFolder || !path.startsWith(".obsidian/"))
      .map(([path, entry]) => ({ path, size: entry.data.byteLength, mtime: entry.mtime }));
  }

  async statFile(path) {
    const entry = this.files.get(path);
    return entry ? { path, size: entry.data.byteLength, mtime: entry.mtime } : null;
  }

  async readBinary(path) {
    const entry = this.files.get(path);
    if (!entry) throw new Error("missing_file");
    return arrayBuffer(entry.data);
  }

  async writeBinary(path, data) {
    this.files.set(path, { data: new Uint8Array(data), mtime: ++this.clock });
  }

  async deleteFile(path) {
    if (!this.files.delete(path)) throw new Error("missing_file");
  }

  async exists(path) {
    return this.files.has(path) || this.folders.has(path);
  }

  async readText(path) {
    const value = this.text(path);
    if (value === null) throw new Error("missing_file");
    return value;
  }

  async writeText(path, content) {
    this.putText(path, content);
  }

  async ensureFolder(path) {
    const segments = path.split("/");
    for (let index = 1; index <= segments.length; index += 1) this.folders.add(segments.slice(0, index).join("/"));
  }

  async listDirectory(path) {
    const prefix = `${path.replace(/\/+$/, "")}/`;
    return [...this.files.keys()].filter((file) => file.startsWith(prefix) && !file.slice(prefix.length).includes("/"));
  }
}

async function freePort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolvePromise) => server.close(resolvePromise));
  return port;
}

async function waitFor(predicate, label, timeoutMs = 12_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 80));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

try {
  const bundle = join(temp, "lanSync.cjs");
  await esbuild.build({
    entryPoints: [join(root, "src", "lanSync.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    outfile: bundle,
    logLevel: "silent"
  });
  const require = createRequire(import.meta.url);
  globalThis.require = require;
  const {
    CancipLanSync,
    LanStatusBarTakeover,
    buildLanConflictPath,
    createLanSyncRequestHeaders,
    decryptLanSyncPayload,
    encryptLanSyncPayload,
    isPrivateLanAddress,
    normalizeLanSyncPath,
    planLanSyncReconciliation,
    verifyLanSyncRequest
  } = require(bundle);

  assert.equal(normalizeLanSyncPath("Notes/Safe.md"), "Notes/Safe.md");
  for (const unsafe of ["../secret", "/absolute", "C:/drive", ".obsidian/plugins/x", ".trash/a", "folder\\file", "a//b", "a/./b", "a/../b"]) {
    assert.equal(normalizeLanSyncPath(unsafe), null, `Unsafe path accepted: ${unsafe}`);
  }
  const configPathOptions = {
    syncConfigFolder: true,
    configDir: ".obsidian",
    identityRoot: ".obsidian/plugins/cancip/data/lan-sync"
  };
  assert.equal(normalizeLanSyncPath(".obsidian/hotkeys.json", configPathOptions), ".obsidian/hotkeys.json");
  for (const protectedPath of [
    ".obsidian/workspace.json",
    ".obsidian/workspace-mobile.json",
    ".obsidian/plugins/remotely-save/data.json",
    ".obsidian/plugins/cancip/data/lan-sync/identity.json",
    ".obsidian/plugins/example/node_modules/cache.bin"
  ]) {
    assert.equal(normalizeLanSyncPath(protectedPath, configPathOptions), null, `Protected config path accepted: ${protectedPath}`);
  }
  assert.equal(normalizeLanSyncPath(".obsidian/hotkeys.json"), null, "Config path was enabled without the setting");
  for (const address of ["127.0.0.1", "10.0.0.2", "172.20.1.2", "192.168.1.8", "169.254.2.3"]) assert.equal(isPrivateLanAddress(address), true);
  for (const address of ["8.8.8.8", "1.1.1.1", "example.com"]) assert.equal(isPrivateLanAddress(address), false);

  const secret = "s".repeat(43);
  const encrypted = await encryptLanSyncPayload(secret, { text: "private note", count: 2 });
  assert.deepEqual(await decryptLanSyncPayload(secret, encrypted), { text: "private note", count: 2 });
  const tampered = JSON.parse(encrypted);
  tampered.ciphertext = `${tampered.ciphertext.startsWith("A") ? "B" : "A"}${tampered.ciphertext.slice(1)}`;
  await assert.rejects(() => decryptLanSyncPayload(secret, JSON.stringify(tampered)), /decrypt_failed/);

  const now = Date.now();
  const requestInput = {
    secret,
    vaultId: "v".repeat(24),
    deviceId: "d".repeat(24),
    method: "POST",
    path: "/cancip-lan/v1/ping",
    body: encrypted,
    now
  };
  const requestHeaders = await createLanSyncRequestHeaders(requestInput);
  const lowerHeaders = Object.fromEntries(Object.entries(requestHeaders).map(([key, value]) => [key.toLowerCase(), value]));
  const replayCache = new Map();
  assert.equal(await verifyLanSyncRequest({ ...requestInput, headers: lowerHeaders, replayCache }), requestInput.deviceId);
  await assert.rejects(() => verifyLanSyncRequest({ ...requestInput, headers: lowerHeaders, replayCache }), /replayed_request/);
  await assert.rejects(() => verifyLanSyncRequest({ ...requestInput, vaultId: "x".repeat(24), headers: lowerHeaders, replayCache: new Map() }), /vault_mismatch/);

  const local = { path: "Note.md", size: 5, mtime: 100, hash: "a".repeat(43) };
  const remote = { path: "Note.md", size: 6, mtime: 200, hash: "b".repeat(43) };
  assert.equal(planLanSyncReconciliation([local], [remote], { "Note.md": local.hash })[0].kind, "pull");
  assert.equal(planLanSyncReconciliation([local], [remote], { "Note.md": remote.hash })[0].kind, "push");
  assert.deepEqual(planLanSyncReconciliation([local], [], { "Note.md": local.hash }), [], "Deletion was resurrected");
  const conflict = planLanSyncReconciliation([local], [remote], {});
  assert.equal(conflict[0].kind, "conflict");
  assert.equal(conflict[0].winner, "remote");
  assert.equal(buildLanConflictPath("Folder/Note.md", "device-123456", local.hash), "Folder/Note (LAN conflict device-1 aaaaaaaa).md");

  const passivePolicy = {
    incrementalPush: false,
    incrementalPull: false,
    deletePush: false,
    deletePull: false,
    syncConfigFolder: false,
    deleteProtocol: true
  };
  const incrementalPushPolicy = { ...passivePolicy, incrementalPush: true };
  const incrementalPullPolicy = { ...passivePolicy, incrementalPull: true };
  const deletePushPolicy = { ...incrementalPushPolicy, deletePush: true };
  const deletePullPolicy = { ...incrementalPullPolicy, deletePull: true };
  assert.equal(planLanSyncReconciliation([local], [remote], { "Note.md": remote.hash }, incrementalPushPolicy, passivePolicy)[0].kind, "push");
  assert.equal(planLanSyncReconciliation([local], [remote], { "Note.md": local.hash }, incrementalPullPolicy, passivePolicy)[0].kind, "pull");
  assert.deepEqual(planLanSyncReconciliation([local], [remote], { "Note.md": local.hash }, incrementalPushPolicy, passivePolicy), []);
  assert.equal(planLanSyncReconciliation([], [remote], { "Note.md": remote.hash }, deletePushPolicy, passivePolicy)[0].kind, "delete-remote");
  assert.equal(planLanSyncReconciliation([local], [], { "Note.md": local.hash }, deletePullPolicy, passivePolicy)[0].kind, "delete-local");
  const locallyChanged = { ...local, hash: "c".repeat(43), mtime: 300 };
  assert.deepEqual(planLanSyncReconciliation([locallyChanged], [], { "Note.md": local.hash }, deletePullPolicy, passivePolicy), [], "A remote deletion removed a locally changed file");

  class FakeElement {
    constructor() {
      this.hidden = false;
      this.style = { display: "inline-flex" };
      this.attributes = new Map([["style", "display: inline-flex; color: red"], ["aria-hidden", "false"]]);
    }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    removeAttribute(name) { this.attributes.delete(name); }
  }
  const remotelySave = {
    isSyncing: true,
    currSyncMsg: "cloud sync",
    settings: { serviceType: "onedrive", syncDirection: "bidirectional" },
    statusBarElement: new FakeElement()
  };
  const remotelySaveState = JSON.stringify({ isSyncing: remotelySave.isSyncing, currSyncMsg: remotelySave.currSyncMsg, settings: remotelySave.settings });
  const takeover = new LanStatusBarTakeover();
  takeover.takeOver(remotelySave.statusBarElement);
  assert.equal(remotelySave.statusBarElement.hidden, true);
  assert.equal(remotelySave.statusBarElement.getAttribute("aria-hidden"), "true");
  takeover.restore();
  assert.equal(remotelySave.statusBarElement.hidden, false);
  assert.equal(remotelySave.statusBarElement.getAttribute("style"), "display: inline-flex; color: red");
  assert.equal(remotelySave.statusBarElement.getAttribute("aria-hidden"), "false");
  assert.equal(JSON.stringify({ isSyncing: remotelySave.isSyncing, currSyncMsg: remotelySave.currSyncMsg, settings: remotelySave.settings }), remotelySaveState);

  const identity = {
    schemaVersion: 1,
    vaultId: "vault_identity_1234567890",
    secret: "shared_secret_12345678901234567890123456789012",
    createdAt: new Date().toISOString()
  };
  const deviceA = "AAAAAAAAAAAAAAAAAAAAAAAA";
  const deviceB = "BBBBBBBBBBBBBBBBBBBBBBBB";
  const [portA, portB] = await Promise.all([freePort(), freePort()]);
  assert.notEqual(portA, portB);
  const storageA = new MemoryStorage(identity, {
    "Notes/from-a.md": { content: "from A", mtime: 100 },
    "Notes/shared.md": { content: "older A", mtime: 200 },
    ".obsidian/hotkeys.json": { content: "hotkeys from A", mtime: 500 },
    ".obsidian/plugins/remotely-save/data.json": { content: "protected fixture", mtime: 600 }
  });
  const storageB = new MemoryStorage(identity, {
    "Notes/from-b.md": { content: "from B", mtime: 300 },
    "Notes/shared.md": { content: "newer B", mtime: 400 }
  });
  const descriptor = (deviceId, port) => JSON.stringify({
    schemaVersion: 1,
    protocolVersion: 1,
    vaultId: identity.vaultId,
    deviceId,
    port,
    addresses: ["127.0.0.1"],
    updatedAt: new Date().toISOString()
  });
  storageA.putText(`${storageA.identityRoot}/peers/${deviceB}.json`, descriptor(deviceB, portB));
  storageB.putText(`${storageB.identityRoot}/peers/${deviceA}.json`, descriptor(deviceA, portA));

  const httpRequest = async (request) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);
    try {
      const response = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        signal: controller.signal
      });
      return { status: response.status, text: await response.text() };
    } finally {
      clearTimeout(timer);
    }
  };
  const progressA = [];
  const progressB = [];
  const commonOptions = (storage, port, deviceId, progress, overrides = {}) => {
    const runtimeSettings = {
      enabled: true,
      autoDiscovery: true,
      checkIntervalSeconds: 1,
      mode: "bidirectional",
      syncConfigFolder: false,
      configDir: ".obsidian",
      port,
      maxFileBytes: 1024 * 1024,
      ...overrides
    };
    return {
      desktop: true,
      getSettings: () => runtimeSettings,
      storage,
      httpRequest,
      onProgress: (value) => progress.push(value),
      localStore: memoryLocalStore(deviceId),
      runtimeSettings
    };
  };
  const optionsB = commonOptions(storageB, portB, deviceB, progressB);
  const optionsA = commonOptions(storageA, portA, deviceA, progressA);
  const serviceB = new CancipLanSync(optionsB);
  const serviceA = new CancipLanSync(optionsA);
  try {
    await serviceB.start();
    await serviceA.start();
    await waitFor(() => serviceA.status().peerCount === 1, "authenticated same-Vault peer");
    await waitFor(() => storageA.text("Notes/from-b.md") === "from B" && storageB.text("Notes/from-a.md") === "from A", "automatic bidirectional LAN transfer");
    await waitFor(() => storageA.text("Notes/shared.md") === "newer B" && storageB.text("Notes/shared.md") === "newer B", "conflict convergence");
    const conflictPath = [...storageA.files.keys()].find((path) => path.includes("LAN conflict"));
    assert.ok(conflictPath, "Conflict copy was not created");
    assert.equal(storageA.text(conflictPath), "older A");
    assert.equal(storageB.text(conflictPath), "older A");
    assert.ok(progressA.some((value) => value.phase === "syncing" && value.active));
    assert.ok(progressA.some((value) => value.phase === "complete" && value.conflicts === 1));
    assert.ok(progressB.some((value) => value.active), "Receiving peer did not expose LAN status");
    const firstProgress = progressA.find((value) => value.phase === "syncing" && value.total > 0 && value.completed === 0);
    assert.ok(firstProgress, "LAN progress did not start at 0/N");
    for (let completed = 0; completed <= firstProgress.total; completed += 1) {
      assert.ok(progressA.some((value) => value.total === firstProgress.total && value.completed === completed), `LAN progress skipped ${completed}/${firstProgress.total}`);
    }
    assert.equal(storageB.text(".obsidian/hotkeys.json"), null, "Config folder synced while disabled");

    optionsA.runtimeSettings.syncConfigFolder = true;
    serviceA.requestSync();
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
    assert.equal(storageB.text(".obsidian/hotkeys.json"), null, "Config folder synced before both peers enabled it");
    optionsB.runtimeSettings.syncConfigFolder = true;
    serviceA.requestSync();
    await waitFor(() => storageB.text(".obsidian/hotkeys.json") === "hotkeys from A", "two-sided config-folder synchronization");
    assert.equal(storageB.text(".obsidian/plugins/remotely-save/data.json"), null, "Protected Remotely Save data was transferred");

    optionsA.runtimeSettings.mode = "delete-push";
    optionsB.runtimeSettings.mode = "bidirectional";
    storageA.files.delete("Notes/from-a.md");
    serviceA.notifyVaultChange("Notes/from-a.md");
    serviceA.requestSync();
    await waitFor(() => storageB.text("Notes/from-a.md") === null, "deletion push");
    storageA.putText("Notes/from-a.md", "recreated A", 900);
    serviceA.notifyVaultChange("Notes/from-a.md");
    await waitFor(() => storageB.text("Notes/from-a.md") === "recreated A", "recreated path after cloud deletion");

    optionsA.runtimeSettings.mode = "delete-pull";
    storageB.files.delete("Notes/from-b.md");
    serviceA.requestSync();
    await waitFor(() => storageA.text("Notes/from-b.md") === null, "deletion pull");
  } finally {
    await Promise.all([serviceA.stop(), serviceB.stop()]);
  }

  const [desktopPort] = await Promise.all([freePort()]);
  const desktopDevice = "CCCCCCCCCCCCCCCCCCCCCCCC";
  const mobileDevice = "ZZZZZZZZZZZZZZZZZZZZZZZZ";
  const desktopStorage = new MemoryStorage(identity, {});
  const mobileStorage = new MemoryStorage(identity, {
    "Mobile/client-created.md": { content: "from mobile client", mtime: 1200 }
  });
  mobileStorage.putText(`${mobileStorage.identityRoot}/peers/${desktopDevice}.json`, descriptor(desktopDevice, desktopPort));
  const desktopProgress = [];
  const mobileProgress = [];
  const desktopService = new CancipLanSync(commonOptions(desktopStorage, desktopPort, desktopDevice, desktopProgress));
  const mobileService = new CancipLanSync({
    ...commonOptions(mobileStorage, 43190, mobileDevice, mobileProgress),
    desktop: false
  });
  try {
    await desktopService.start();
    await mobileService.start();
    await waitFor(() => mobileService.status().peerCount === 1, "mobile authenticated desktop endpoint");
    await waitFor(() => desktopStorage.text("Mobile/client-created.md") === "from mobile client", "automatic mobile-initiated LAN synchronization");
    assert.ok(mobileProgress.some((value) => value.phase === "complete"), "Mobile client waited for the lower desktop device ID");
  } finally {
    await Promise.all([mobileService.stop(), desktopService.stop()]);
  }

  const source = await readFile(join(root, "src", "main.ts"), "utf8");
  const takeoverSource = source.slice(source.indexOf("private remotelySaveStatusBarElement"), source.indexOf("async restartAgentBridge"));
  const statusTextSource = source.slice(source.indexOf("private lanSyncStatusText"), source.indexOf("private renderLanSyncStatusBar"));
  assert.match(statusTextSource, /return `\$\{progress\.completed\}\/\$\{progress\.total\}`;/, "LAN progress should stay compact beside the Wi-Fi icon");
  assert.doesNotMatch(statusTextSource, /progress\.completed.*percent|·.*%/, "LAN progress should not append a percentage or LAN label");
  assert.doesNotMatch(statusTextSource, /LAN (?:connected|scanning|syncing|synced|unavailable)|局域网|已连接|扫描中|同步中|已同步|暂不可用/, "LAN status text should not show visible words");
  assert.match(statusTextSource, /return "";/, "Non-transfer LAN status should leave the visible text empty");
  assert.match(source, /setIcon\(icon, "wifi"\)/, "Connected LAN status should keep the Wi-Fi icon");
  for (const mode of ["bidirectional", "incremental-push", "incremental-pull", "delete-push", "delete-pull"]) {
    assert.match(source, new RegExp(`(?:\\"|^)${mode.replace("-", "\\-")}(?:\\"|$)`), `LAN settings are missing mode ${mode}`);
  }
  assert.match(source, /lanSyncMaxFileMb[^\n]*512/, "LAN settings should allow selecting files larger than 100 MB");
  assert.match(takeoverSource, /plugins\?\.\["remotely-save"\]\?\.statusBarElement/);
  assert.doesNotMatch(takeoverSource, /isSyncing|currSyncMsg|syncEvent|remotelySave\.settings|candidate\.settings|start-sync/);
  assert.doesNotMatch(source, /plugins\/remotely-save|plugins\\remotely-save/);

  console.log("PASS Cancip encrypted LAN sync, conflict safety, replay defense, and Remotely Save status isolation checks");
} finally {
  await rm(temp, { recursive: true, force: true });
}
