import { browseDirectory, createDirectory } from "../receiver/fs-browser.ts";
import { APP_VERSION, DEFAULT_SENDER_PORT } from "../shared/constants.ts";
import type { BackupProfile } from "../shared/types.ts";
import {
  deleteBackupProfile,
  loadSenderConfig,
  saveSenderConfig,
  upsertBackupProfile,
} from "./config-store.ts";
import {
  TransferManager,
  type StartTransferJobParams,
} from "./transfer-manager.ts";
import { loadUiAssets } from "../ui/assets.ts";

export interface SenderServerOptions {
  port?: number;
  hostname?: string;
  uiHtmlProvider?: () => Promise<{ html: string; css: string; js: string }>;
}

export type SenderServerInstance = Bun.Server;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...CORS_HEADERS,
    },
  });
}

export function startSenderServer(options: SenderServerOptions = {}): {
  server: SenderServerInstance;
  transferManager: TransferManager;
} {
  const port = options.port ?? Number(process.env.NOVA_SENDER_PORT || DEFAULT_SENDER_PORT);
  const hostname = options.hostname ?? "127.0.0.1";
  const transferManager = new TransferManager();

  const server = Bun.serve({
    port,
    hostname,
    idleTimeout: 255,
    async fetch(req: Request): Promise<Response> {
      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      }

      const url = new URL(req.url);

      try {
        // Health check
        if (url.pathname === "/api/health" && req.method === "GET") {
          return jsonResponse({ ok: true, service: "novashare-sender", version: APP_VERSION });
        }

        // Config endpoints
        if (url.pathname === "/api/config" && req.method === "GET") {
          const cfg = await loadSenderConfig();
          return jsonResponse(cfg);
        }

        if (url.pathname === "/api/config" && req.method === "POST") {
          const body = await req.json();
          const updated = await saveSenderConfig(body);
          if (typeof body.bandwidthLimitMBps === "number") {
            transferManager.setBandwidthLimit(body.bandwidthLimitMBps);
          }
          return jsonResponse(updated);
        }

        // Profiles endpoints
        if (url.pathname === "/api/profiles" && req.method === "POST") {
          const profile = (await req.json()) as BackupProfile;
          if (!profile.id) {
            profile.id = `prof-${Date.now()}`;
          }
          const updated = await upsertBackupProfile(profile);
          return jsonResponse(updated);
        }

        if (url.pathname.startsWith("/api/profiles/") && req.method === "DELETE") {
          const id = decodeURIComponent(url.pathname.slice("/api/profiles/".length));
          const updated = await deleteBackupProfile(id);
          return jsonResponse(updated);
        }

        // Browse local Windows folders
        if (url.pathname === "/api/local/browse" && req.method === "GET") {
          const targetPath = url.searchParams.get("path") || undefined;
          const res = await browseDirectory(targetPath);
          return jsonResponse(res);
        }

        if (url.pathname === "/api/local/mkdir" && req.method === "POST") {
          const body = (await req.json()) as { path: string };
          const res = await createDirectory(body.path);
          return jsonResponse(res);
        }

        if (url.pathname === "/api/local/pick-folder" && req.method === "POST") {
          const body = (await req.json().catch(() => ({}))) as { initialPath?: string };
          if (process.platform === "win32") {
            const initDir = (body.initialPath || "").replace(/'/g, "''");
            const psScript = `
              Add-Type -AssemblyName System.Windows.Forms
              $owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false; WindowState = 'Minimized' }
              $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
              $dlg.Description = 'Pilih Folder untuk NovaShare Backup'
              $dlg.ShowNewFolderButton = $true
              if ('${initDir}' -ne '' -and (Test-Path -LiteralPath '${initDir}')) {
                $dlg.SelectedPath = '${initDir}'
              }
              $res = $dlg.ShowDialog($owner)
              $owner.Dispose()
              if ($res -eq [System.Windows.Forms.DialogResult]::OK) {
                [Console]::Out.Write($dlg.SelectedPath)
              }
            `;
            const proc = Bun.spawn(
              ["powershell", "-NoProfile", "-STA", "-Command", psScript],
              { stdout: "pipe", stderr: "ignore" }
            );
            const selected = (await new Response(proc.stdout).text()).trim();
            await proc.exited;
            if (selected) {
              const browsed = await browseDirectory(selected);
              return jsonResponse({ cancelled: false, path: browsed.currentPath, browse: browsed });
            }
            return jsonResponse({ cancelled: true });
          }
          return jsonResponse({ cancelled: true, unsupported: true });
        }

        // Proxy to Remote Linux Omarchy Receiver (System Info, Browse, Mkdir)
        if (url.pathname === "/api/remote/info" && req.method === "POST") {
          const { receiverUrl, token } = (await req.json()) as {
            receiverUrl: string;
            token: string;
          };
          const target = `${receiverUrl.replace(/\/+$/, "")}/api/system/info`;
          const r = await fetch(target, { headers: { "X-Nova-Token": token } });
          const data = await r.json();
          return jsonResponse(data, r.status);
        }

        if (url.pathname === "/api/remote/browse" && req.method === "POST") {
          const { receiverUrl, token, path: remotePath } = (await req.json()) as {
            receiverUrl: string;
            token: string;
            path?: string;
          };
          const q = remotePath ? `?path=${encodeURIComponent(remotePath)}` : "";
          const target = `${receiverUrl.replace(/\/+$/, "")}/api/fs/browse${q}`;
          const r = await fetch(target, { headers: { "X-Nova-Token": token } });
          const data = await r.json();
          return jsonResponse(data, r.status);
        }

        if (url.pathname === "/api/remote/mkdir" && req.method === "POST") {
          const { receiverUrl, token, path: remotePath } = (await req.json()) as {
            receiverUrl: string;
            token: string;
            path: string;
          };
          const target = `${receiverUrl.replace(/\/+$/, "")}/api/fs/mkdir`;
          const r = await fetch(target, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Nova-Token": token },
            body: JSON.stringify({ path: remotePath }),
          });
          const data = await r.json();
          return jsonResponse(data, r.status);
        }

        // Transfer Job Controls
        if (url.pathname === "/api/job/status" && req.method === "GET") {
          return jsonResponse(transferManager.getProgress());
        }

        if (url.pathname === "/api/job/start" && req.method === "POST") {
          const params = (await req.json()) as StartTransferJobParams;
          // Save last used settings
          await saveSenderConfig({
            receiverUrl: params.receiverUrl,
            token: params.token,
            defaultSourceDir: params.sourceDir,
            defaultDestinationDir: params.destinationDir,
            useSmartIgnore: params.useSmartIgnore ?? true,
            bandwidthLimitMBps: params.bandwidthLimitMBps ?? 0,
            concurrency: params.concurrency ?? 2,
          });
          // Kick off job in background
          void transferManager.runBackupJob(params);
          return jsonResponse({ ok: true, status: transferManager.getProgress() });
        }

        if (url.pathname === "/api/job/pause" && req.method === "POST") {
          transferManager.pause();
          return jsonResponse(transferManager.getProgress());
        }

        if (url.pathname === "/api/job/resume" && req.method === "POST") {
          transferManager.resume();
          return jsonResponse(transferManager.getProgress());
        }

        if (url.pathname === "/api/job/cancel" && req.method === "POST") {
          transferManager.cancel();
          return jsonResponse(transferManager.getProgress());
        }

        if (url.pathname === "/api/job/bandwidth" && req.method === "POST") {
          const { bandwidthLimitMBps } = (await req.json()) as { bandwidthLimitMBps: number };
          transferManager.setBandwidthLimit(bandwidthLimitMBps);
          return jsonResponse(transferManager.getProgress());
        }

        // SSE Real-time Progress Stream
        if (url.pathname === "/api/job/events" && req.method === "GET") {
          let unsubscribe: (() => void) | null = null;
          const stream = new ReadableStream({
            start(controller) {
              const encoder = new TextEncoder();
              unsubscribe = transferManager.subscribe((progress) => {
                try {
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify(progress)}\n\n`)
                  );
                } catch {
                  // Client closed stream
                }
              });
            },
            cancel() {
              unsubscribe?.();
            },
          });

          return new Response(stream, {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
              ...CORS_HEADERS,
            },
          });
        }

        // Serve Web UI static assets if provided
        const uiProvider = options.uiHtmlProvider ?? loadUiAssets;
        if (uiProvider) {
          const assets = await uiProvider();
          if (url.pathname === "/" || url.pathname === "/index.html") {
            return new Response(assets.html, {
              headers: { "Content-Type": "text/html; charset=utf-8" },
            });
          }
          if (url.pathname === "/styles.css") {
            return new Response(assets.css, {
              headers: { "Content-Type": "text/css; charset=utf-8" },
            });
          }
          if (url.pathname === "/app.js") {
            return new Response(assets.js, {
              headers: { "Content-Type": "application/javascript; charset=utf-8" },
            });
          }
        }

        return jsonResponse({ error: "NOT_FOUND", message: `Route ${url.pathname} not found` }, 404);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResponse({ error: "SENDER_ERROR", message }, 400);
      }
    },
  });

  return { server, transferManager };
}
