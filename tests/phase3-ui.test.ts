import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { startReceiverServer, type ReceiverServerInstance } from "../src/receiver/server.ts";
import { startSenderServer, type SenderServerInstance } from "../src/sender/server.ts";
import { loadUiAssets } from "../src/ui/assets.ts";

describe("Phase 3: Local Web UI Dashboard & Remote Linux Explorer Proxy", () => {
  const token = "test-token-phase3";
  let receiver: ReceiverServerInstance;
  let sender: SenderServerInstance;
  let receiverUrl = "";
  let senderUrl = "";
  let tempDir = "";

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "novashare-p3-"));
    receiver = startReceiverServer({ port: 0, hostname: "127.0.0.1", token });
    receiverUrl = `http://127.0.0.1:${receiver.port}`;

    const started = startSenderServer({
      port: 0,
      hostname: "127.0.0.1",
      uiHtmlProvider: loadUiAssets,
    });
    sender = started.server;
    senderUrl = `http://127.0.0.1:${sender.port}`;
  });

  afterAll(async () => {
    sender.stop(true);
    receiver.stop(true);
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test("serves embedded HTML, CSS, and JS dashboard assets", async () => {
    const htmlRes = await fetch(`${senderUrl}/`);
    expect(htmlRes.status).toBe(200);
    const html = await htmlRes.text();
    expect(html).toContain("NovaShare");
    expect(html).toContain("Linux Omarchy");

    const cssRes = await fetch(`${senderUrl}/styles.css`);
    expect(cssRes.status).toBe(200);
    const jsRes = await fetch(`${senderUrl}/app.js`);
    expect(jsRes.status).toBe(200);
  });

  test("proxies Remote Linux Explorer info, mkdir, and directory browse with disk space", async () => {
    const infoRes = await fetch(`${senderUrl}/api/remote/info`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ receiverUrl, token }),
    });
    expect(infoRes.status).toBe(200);
    const info = await infoRes.json();
    expect(info.name).toContain("NovaShare");

    const newRemoteFolder = path.join(tempDir, "omarchy-shared");
    const mkdirRes = await fetch(`${senderUrl}/api/remote/mkdir`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ receiverUrl, token, path: newRemoteFolder }),
    });
    expect(mkdirRes.status).toBe(200);

    const browseRes = await fetch(`${senderUrl}/api/remote/browse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ receiverUrl, token, path: tempDir }),
    });
    expect(browseRes.status).toBe(200);
    const browse = await browseRes.json();
    expect(browse.entries.some((e: { name: string }) => e.name === "omarchy-shared")).toBe(true);
  });
});
