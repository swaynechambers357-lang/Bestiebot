import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const port = 18000 + Math.floor(Math.random() * 20000);
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ["server.js"], {
  env: { ...process.env, PORT: String(port), REAL_TRADING_ENABLED: "true" },
  stdio: "ignore"
});

async function request(path, options) {
  return fetch(base + path, { signal: AbortSignal.timeout(2000), ...options });
}

async function ready() {
  for (let i = 0; i < 50; i++) {
    if (child.exitCode !== null) throw Error("Server exited early");
    try { return await request("/api/health"); } catch { await new Promise(r => setTimeout(r, 100)); }
  }
  throw Error("Server did not start");
}

test("security and public endpoints", async () => {
  try {
    const health = await ready();
    assert.equal(health.status, 200);
    assert.equal((await health.json()).ok, true);
    const config = await request("/api/config");
    assert.equal((await config.json()).realExecutionEnabled, false,
      "REAL_TRADING_ENABLED=true must never unlock unfinished execution");
    const session = await request("/api/session");
    assert.equal((await session.json()).authenticated, false);
    const accounts = await request("/api/accounts");
    assert.equal(accounts.status, 401);
    const gate = await request("/api/real-execution/check", { method: "POST" });
    assert.equal(gate.status, 401);
    const page = await request("/");
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-security-policy") || "", /default-src/);
    const css = await request("/style.css");
    assert.equal(css.status, 200);
    const missing = await request("/server.js");
    assert.equal(missing.status, 404);
  } finally {
    child.kill();
  }
});
