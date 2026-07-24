import fs from "node:fs";

const input = process.argv[2];
if (!input) {
  throw new Error("Usage: node scripts/run-obsidian-cdp-eval.mjs <script-file-or-expression>");
}

const expression = fs.existsSync(input) ? fs.readFileSync(input, "utf8") : input;
const endpoint = process.env.CANCIP_CDP_ENDPOINT || "http://127.0.0.1:9222/json";
const timeoutMs = Number(process.env.CANCIP_CDP_TIMEOUT_MS || 300_000);
const pages = await fetch(endpoint).then((response) => {
  if (!response.ok) throw new Error(`CDP endpoint returned HTTP ${response.status}`);
  return response.json();
});
const page = pages.find((item) => item.type === "page" && item.url === "app://obsidian.md/index.html");
if (!page?.webSocketDebuggerUrl) throw new Error("Obsidian CDP page was not found");

const result = await new Promise((resolve, reject) => {
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  const timer = setTimeout(() => {
    socket.close();
    reject(new Error(`CDP evaluation timed out after ${timeoutMs}ms`));
  }, timeoutMs);
  const finish = (callback) => {
    clearTimeout(timer);
    socket.close();
    callback();
  };
  socket.addEventListener("open", () => {
    socket.send(JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: { expression, awaitPromise: true, returnByValue: true }
    }));
  });
  socket.addEventListener("error", () => finish(() => reject(new Error("CDP WebSocket connection failed"))));
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id !== 1) return;
    if (message.error) {
      finish(() => reject(new Error(message.error.message || "CDP evaluation failed")));
      return;
    }
    if (message.result?.exceptionDetails) {
      const detail = message.result.exceptionDetails.exception?.description
        || message.result.exceptionDetails.text
        || "Obsidian evaluation threw an exception";
      finish(() => reject(new Error(detail)));
      return;
    }
    finish(() => resolve(message.result?.result?.value));
  });
});

console.log(JSON.stringify(result, null, 2));
