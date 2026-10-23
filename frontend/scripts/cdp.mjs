/**
 * Minimal Chrome DevTools Protocol client.
 *
 * The browser checks drive a real Chrome over the DevTools Protocol so the
 * application is verified in an actual browser engine instead of a DOM
 * emulation. This module owns the connection handling, the command queue and
 * the browser start-up so the individual check scripts stay readable.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const CDP_PORT = Number(process.env.CDP_PORT ?? 9222);
export const CDP = `http://127.0.0.1:${CDP_PORT}`;

const CHROME_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Make sure a debuggable browser is listening on the CDP port. */
export async function ensureBrowser() {
  try {
    await fetch(`${CDP}/json/version`, { signal: AbortSignal.timeout(3000) });
    return;
  } catch {
    /* not running */
  }
  const binary = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!binary) throw new Error("No Chrome/Edge binary found");
  const profile = mkdtempSync(join(tmpdir(), "voicesurg-chrome-"));
  const child = spawn(
    binary,
    [
      "--headless=new",
      "--disable-gpu",
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--window-size=1600,1200",
      "about:blank",
    ],
    { detached: true, stdio: "ignore" },
  );
  child.unref();
  const started = Date.now();
  while (Date.now() - started < 30000) {
    await sleep(500);
    try {
      await fetch(`${CDP}/json/version`, { signal: AbortSignal.timeout(3000) });
      return;
    } catch {
      /* keep waiting */
    }
  }
  throw new Error("The browser did not start in time");
}

/**
 * A CDP session for one page.
 *
 * Collects console errors/warnings and uncaught exceptions so a check can
 * assert that the application ran cleanly.
 */
export class CdpSession {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.consoleErrors = [];
    this.consoleWarnings = [];
    this.pageErrors = [];
    this.timeoutMs = 300000;
    // The methods are frequently destructured, so bind them once.
    this.send = this.send.bind(this);
    this.evaluate = this.evaluate.bind(this);
    this.navigate = this.navigate.bind(this);
    this.waitFor = this.waitFor.bind(this);
    this.close = this.close.bind(this);
  }

  static async open(url = "about:blank") {
    await ensureBrowser();
    const created = await fetch(`${CDP}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
    const target = await created.json();
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = () => reject(new Error("WebSocket error"));
    });
    const session = new CdpSession(ws);
    ws.onmessage = (event) => session._onMessage(event);
    await session.send("Runtime.enable");
    await session.send("Page.enable");
    await session.send("DOM.enable");
    await session.send("Log.enable");
    return session;
  }

  _onMessage(event) {
    const message = JSON.parse(event.data);
    if (message.id && this.pending.has(message.id)) {
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
      return;
    }
    if (message.method === "Runtime.consoleAPICalled") {
      const text = (message.params.args ?? [])
        .map((a) => a.value ?? a.description ?? a.type)
        .join(" ");
      if (message.params.type === "error") this.consoleErrors.push(`[error] ${text}`);
      if (message.params.type === "warning") this.consoleWarnings.push(`[warning] ${text}`);
    }
    if (message.method === "Runtime.exceptionThrown") {
      this.pageErrors.push(
        message.params.exceptionDetails?.exception?.description ??
          message.params.exceptionDetails?.text ??
          "unknown exception",
      );
    }
    if (message.method === "Log.entryAdded") {
      const entry = message.params.entry;
      if (entry.level === "error") this.consoleErrors.push(`[log] ${entry.text}`);
    }
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, this.timeoutMs);
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(
        `Evaluation failed: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`,
      );
    }
    return result.result.value;
  }

  async navigate(url) {
    await this.send("Page.navigate", { url });
  }

  async waitFor(expression, timeoutMs = 30000, label = expression) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      let value = false;
      try {
        value = await this.evaluate(expression);
      } catch {
        value = false;
      }
      if (value) return value;
      await sleep(250);
    }
    throw new Error(`Timed out waiting for: ${label}`);
  }

  async close() {
    await this.send("Page.close").catch(() => {});
  }
}
