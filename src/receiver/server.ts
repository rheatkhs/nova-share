import * as os from "node:os";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  APP_VERSION,
  DEFAULT_CHUNK_SIZE,
  DEFAULT_RECEIVER_PORT,
  DEFAULT_TOKEN,
} from "../shared/constants.ts";
import { safeCompareHex } from "../shared/hash.ts";
import type { ReceiverSystemInfo, SyncPlanRequest } from "../shared/types.ts";
import { receiveMicroBatch } from "./batch-receiver.ts";
import { completeChunkedFile, receiveFileChunk } from "./chunk-receiver.ts";
import {
  browseDirectory,
  createDirectory,
  deletePathOnDisk,
  renamePathOnDisk,
} from "./fs-browser.ts";
import { createSyncPlan } from "./sync-planner.ts";

export interface ReceiverServerOptions {
  port?: number;
  hostname?: string;
  token?: string;
}

export type ReceiverServerInstance = Bun.Server;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, X-Nova-Token, X-Nova-Dest, X-Nova-Path, X-Nova-Chunk-Index, X-Nova-Total-Chunks, X-Nova-Chunk-Size, X-Nova-Offset, X-Nova-Total-Size, X-Nova-Mtime, X-Nova-Hash",
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

export function startReceiverServer(options: ReceiverServerOptions = {}): ReceiverServerInstance {
  const port = options.port ?? Number(process.env.NOVA_RECEIVER_PORT || DEFAULT_RECEIVER_PORT);
  const hostname = options.hostname ?? "0.0.0.0";
  const secretToken = options.token ?? process.env.NOVA_TOKEN ?? DEFAULT_TOKEN;
  const startedAt = Date.now();

  const server = Bun.serve({
    port,
    hostname,
    maxRequestBodySize: 128 * 1024 * 1024, // Up to 128 MB per Turbo Chunk request
    async fetch(req: Request): Promise<Response> {
      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      }

      const url = new URL(req.url);

      // Health check without auth
      if (url.pathname === "/api/health" && req.method === "GET") {
        return jsonResponse({ ok: true, service: "novashare-receiver", version: APP_VERSION });
      }

      // Authenticate all `/api/*` endpoints via `X-Nova-Token`
      const clientToken = req.headers.get("x-nova-token") || "";
      if (!safeCompareHex(clientToken, secretToken)) {
        return jsonResponse(
          { error: "UNAUTHORIZED", message: "Invalid or missing X-Nova-Token" },
          401
        );
      }

      try {
        // 1. GET /api/system/info
        if (url.pathname === "/api/system/info" && req.method === "GET") {
          const info: ReceiverSystemInfo = {
            name: "NovaShare Receiver Daemon",
            version: APP_VERSION,
            hostname: os.hostname(),
            platform: `${os.platform()} (${os.release()})`,
            arch: os.arch(),
            uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
            defaultBackupDir: path.join(os.homedir(), "NovaShare-Backups"),
          };
          return jsonResponse(info);
        }

        // 2. GET /api/fs/browse?path=...
        if (url.pathname === "/api/fs/browse" && req.method === "GET") {
          const targetPath = url.searchParams.get("path") || undefined;
          const result = await browseDirectory(targetPath);
          return jsonResponse(result);
        }

        // 3. POST /api/fs/mkdir
        if (url.pathname === "/api/fs/mkdir" && req.method === "POST") {
          const body = (await req.json()) as { path: string };
          const result = await createDirectory(body.path);
          return jsonResponse(result);
        }


        // 3b. GET /api/fs/download?path=... (Download file from Receiver)
        if (url.pathname === "/api/fs/download" && req.method === "GET") {
          const rawPath = url.searchParams.get("path") || "";
          if (!rawPath.trim()) {
            return jsonResponse({ error: "BAD_REQUEST", message: "Missing path parameter" }, 400);
          }
          const resolved = path.resolve(rawPath.trim());
          const stat = await fs.stat(resolved);
          if (!stat.isFile()) {
            return jsonResponse({ error: "BAD_REQUEST", message: "Path is not a file" }, 400);
          }
          const fileName = path.basename(resolved);
          return new Response(Bun.file(resolved), {
            headers: {
              "Content-Type": "application/octet-stream",
              "Content-Length": String(stat.size),
              "Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"`,
              ...CORS_HEADERS,
            },
          });
        }

        // 3c. POST /api/fs/delete (Delete file or folder on Receiver)
        if (url.pathname === "/api/fs/delete" && req.method === "POST") {
          const body = (await req.json()) as { path: string };
          const result = await deletePathOnDisk(body.path);
          return jsonResponse(result);
        }

        // 3d. POST /api/fs/rename (Rename file or folder on Receiver)
        if (url.pathname === "/api/fs/rename" && req.method === "POST") {
          const body = (await req.json()) as { oldPath: string; newPath: string };
          const result = await renamePathOnDisk(body.oldPath, body.newPath);
          return jsonResponse(result);
        }
        // 4. POST /api/sync/plan
        if (url.pathname === "/api/sync/plan" && req.method === "POST") {
          const body = (await req.json()) as SyncPlanRequest;
          const plan = await createSyncPlan(body);
          return jsonResponse(plan);
        }

        // 5. POST /api/transfer/batch (Lane A: Micro-Batching)
        if (url.pathname === "/api/transfer/batch" && req.method === "POST") {
          const buffer = await req.arrayBuffer();
          const result = await receiveMicroBatch(buffer);
          return jsonResponse({ ok: true, ...result });
        }

        // 6. POST /api/transfer/chunk (Lane B: 8MB Chunk Streaming)
        if (url.pathname === "/api/transfer/chunk" && req.method === "POST") {
          const destinationDir = decodeURIComponent(req.headers.get("x-nova-dest") || "");
          const relativePath = decodeURIComponent(req.headers.get("x-nova-path") || "");
          const chunkIndex = Number(req.headers.get("x-nova-chunk-index") || "0");
          const totalChunks = Number(req.headers.get("x-nova-total-chunks") || "1");
          const chunkSize = Number(
            req.headers.get("x-nova-chunk-size") || String(DEFAULT_CHUNK_SIZE)
          );
          const offset = Number(req.headers.get("x-nova-offset") || "0");
          const totalSize = Number(req.headers.get("x-nova-total-size") || "0");
          const sourceMtime = Number(req.headers.get("x-nova-mtime") || String(Date.now()));
          const expectedHash = req.headers.get("x-nova-hash") || "";

          const buffer = new Uint8Array(await req.arrayBuffer());
          const result = await receiveFileChunk({
            destinationDir,
            relativePath,
            chunkIndex,
            totalChunks,
            chunkSize,
            offset,
            totalSize,
            sourceMtime,
            expectedHash,
            data: buffer,
          });
          return jsonResponse({ ok: true, ...result });
        }

        // 7. POST /api/transfer/complete (Finalize Chunked File)
        if (url.pathname === "/api/transfer/complete" && req.method === "POST") {
          const body = (await req.json()) as {
            destinationDir: string;
            relativePath: string;
            totalSize: number;
            sourceMtime: number;
          };
          const result = await completeChunkedFile(body);
          return jsonResponse({ ok: true, ...result });
        }

        return jsonResponse({ error: "NOT_FOUND", message: `Unknown route ${url.pathname}` }, 404);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const status = message.includes("HASH_MISMATCH") ? 422 : 400;
        return jsonResponse({ error: "RECEIVER_ERROR", message }, status);
      }
    },
  });

  return server;
}
