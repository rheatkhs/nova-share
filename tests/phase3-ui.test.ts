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

  test("supports Dry-Run preview, Receiver file download, and Peer Auto-Discovery", async () => {
    const sampleFile = path.join(tempDir, "omarchy-shared", "readme.txt");
    await fs.writeFile(sampleFile, "Downloaded from Receiver!");

    // 1. Test Receiver file download via Sender proxy
    const dlUrl = `${senderUrl}/api/remote/download?receiverUrl=${encodeURIComponent(
      receiverUrl
    )}&token=${encodeURIComponent(token)}&path=${encodeURIComponent(sampleFile)}`;
    const dlRes = await fetch(dlUrl);
    expect(dlRes.status).toBe(200);
    const dlText = await dlRes.text();
    expect(dlText).toBe("Downloaded from Receiver!");

    // 2. Test Pre-Flight Dry-Run Preview
    const destPreview = path.join(tempDir, "preview-dest");
    const prevRes = await fetch(`${senderUrl}/api/job/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceDir: path.join(tempDir, "omarchy-shared"),
        destinationDir: destPreview,
        receiverUrl,
        token,
      }),
    });
    expect(prevRes.status).toBe(200);
    const prevData = await prevRes.json();
    expect(prevData.summary.totalFiles).toBe(1);
    expect(prevData.summary.newCount).toBe(1);
    expect(prevData.enoughSpace).toBe(true);

    // 3. Test Peer Auto-Discovery
    const discRes = await fetch(`${senderUrl}/api/discovery/peers?port=${receiver.port}`);
    expect(discRes.status).toBe(200);
    const discData = await discRes.json();
    expect(Array.isArray(discData.peers)).toBe(true);
    expect(discData.peers.some((p: { ip: string; novaShareActive: boolean }) => p.ip === "127.0.0.1" && p.novaShareActive)).toBe(true);
  });

  test("supports Route Quality diagnostics, Receiver file rename & delete, and Transfer History", async () => {
    // 1. Route quality
    const rqRes = await fetch(`${senderUrl}/api/discovery/route-quality`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ receiverUrl }),
    });
    expect(rqRes.status).toBe(200);
    const rqData = await rqRes.json();
    expect(rqData.routeKind).toBe("LOCAL");
    expect(rqData.latencyMs).toBeGreaterThanOrEqual(1);

    // 2. Remote rename & delete
    const oldFile = path.join(tempDir, "omarchy-shared", "readme.txt");
    const renRes = await fetch(`${senderUrl}/api/remote/rename`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        receiverUrl,
        token,
        oldPath: oldFile,
        newPath: "renamed-readme.txt",
      }),
    });
    expect(renRes.status).toBe(200);

    const renamedPath = path.join(tempDir, "omarchy-shared", "renamed-readme.txt");
    const delRes = await fetch(`${senderUrl}/api/remote/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        receiverUrl,
        token,
        path: renamedPath,
      }),
    });
    expect(delRes.status).toBe(200);

    // 3. History endpoint
    const histRes = await fetch(`${senderUrl}/api/history`);
    expect(histRes.status).toBe(200);
    const histData = await histRes.json();
    expect(Array.isArray(histData.history)).toBe(true);
  });
});
