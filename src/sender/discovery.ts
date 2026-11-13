import * as os from "node:os";
import { DEFAULT_RECEIVER_PORT } from "../shared/constants.ts";
import type { DiscoveredPeer, RouteKind, RouteQualityInfo } from "../shared/types.ts";

function timeoutAfter<T>(ms: number, fallback: T): Promise<T> {
  const { promise, resolve } = Promise.withResolvers<T>();
  const timer = setTimeout(() => resolve(fallback), ms);
  if (typeof timer.unref === "function") timer.unref();
  return promise;
}

async function probeNovaShareReceiver(url: string, timeoutMs = 450): Promise<boolean> {
  const check = (async () => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      if (typeof timer.unref === "function") timer.unref();
      try {
        const res = await fetch(`${url}/api/health`, { signal: controller.signal });
        if (!res.ok) return false;
        const data = (await res.json()) as { service?: string };
        return data?.service === "novashare-receiver";
      } finally {
        clearTimeout(timer);
      }
    } catch {
      return false;
    }
  })();

  return Promise.race([check, timeoutAfter(timeoutMs + 50, false)]);
}

async function queryTailscalePeers(receiverPort: number): Promise<DiscoveredPeer[]> {
  const task = (async (): Promise<DiscoveredPeer[]> => {
    try {
      const proc = Bun.spawn(["tailscale", "status", "--json"], {
        stdout: "pipe",
        stderr: "ignore",
      });
      const text = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;
      if (exitCode !== 0 || !text.trim().startsWith("{")) return [];

      const parsed = JSON.parse(text) as {
        Peer?: Record<
          string,
          {
            HostName?: string;
            DNSName?: string;
            OS?: string;
            Online?: boolean;
            TailscaleIPs?: string[];
            CurAddr?: string;
          }
        >;
      };

      const list: DiscoveredPeer[] = [];
      for (const peer of Object.values(parsed.Peer || {})) {
        const ipv4 = (peer.TailscaleIPs || []).find((ip) => !ip.includes(":"));
        if (!ipv4) continue;
        const rawName = peer.HostName || peer.DNSName?.split(".")[0] || ipv4;

        // If Tailscale reports a Direct LAN address (e.g. 192.168.11.136:41641), surface Direct LAN too!
        if (peer.CurAddr) {
          const lanIp = peer.CurAddr.split(":")[0];
          if (
            lanIp &&
            (lanIp.startsWith("192.168.") ||
              lanIp.startsWith("10.") ||
              lanIp.startsWith("172."))
          ) {
            list.push({
              name: `${rawName} (Direct LAN)`,
              ip: lanIp,
              url: `http://${lanIp}:${receiverPort}`,
              os: peer.OS || "linux",
              source: "lan",
              online: Boolean(peer.Online),
              novaShareActive: false,
            });
          }
        }

        list.push({
          name: `${rawName} (Tailscale)`,
          ip: ipv4,
          url: `http://${ipv4}:${receiverPort}`,
          os: peer.OS || "linux",
          source: "tailscale",
          online: Boolean(peer.Online),
          novaShareActive: false,
        });
      }
      return list;
    } catch {
      return [];
    }
  })();

  return Promise.race([task, timeoutAfter(900, [])]);
}

/**
 * Discovers Tailscale peers (via `tailscale status --json`) and local network interfaces,
 * probing each candidate on the Receiver port (7654) to see if NovaShare Receiver is active.
 */
export async function discoverPeers(
  receiverPort = DEFAULT_RECEIVER_PORT
): Promise<DiscoveredPeer[]> {
  const candidates = new Map<string, DiscoveredPeer>();

  // 1. Always include Localhost
  const localHostName = os.hostname();
  const localUrl = `http://127.0.0.1:${receiverPort}`;
  candidates.set("127.0.0.1", {
    name: `${localHostName} (Localhost)`,
    ip: "127.0.0.1",
    url: localUrl,
    os: os.platform(),
    source: "local",
    online: true,
    novaShareActive: false,
  });

  // 2. Include local LAN / Tailscale interface IPs on this machine
  const nets = os.networkInterfaces();
  for (const [ifName, addrs] of Object.entries(nets)) {
    for (const addr of addrs || []) {
      if (addr.family === "IPv4" && !addr.internal) {
        const isTailscale =
          addr.address.startsWith("100.") || ifName.toLowerCase().includes("tailscale");
        candidates.set(addr.address, {
          name: `${localHostName} (${ifName})`,
          ip: addr.address,
          url: `http://${addr.address}:${receiverPort}`,
          os: os.platform(),
          source: isTailscale ? "tailscale" : "lan",
          online: true,
          novaShareActive: false,
        });
      }
    }
  }

  // 3. Query Tailscale peers with strict 900ms bound
  const tsPeers = await queryTailscalePeers(receiverPort);
  for (const p of tsPeers) {
    candidates.set(p.ip, p);
  }

  // 4. Probe online candidates in parallel with strict 500ms bound
  const peerList = Array.from(candidates.values());
  await Promise.all(
    peerList.map(async (peer) => {
      if (peer.online) {
        peer.novaShareActive = await probeNovaShareReceiver(peer.url);
      }
    })
  );

  peerList.sort((a, b) => {
    if (a.novaShareActive !== b.novaShareActive) return a.novaShareActive ? -1 : 1;
    if (a.source !== b.source) return a.source === "tailscale" ? -1 : 1;
    if (a.online !== b.online) return a.online ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return peerList;
}

/**
 * Measures route latency and inspects Tailscale vs Direct LAN routing for a given Receiver URL.
 * Also checks if a faster alternate route (e.g. Direct LAN 192.168.x.x instead of Tailscale 100.x.y.z,
 * or Tailscale fallback when Direct LAN is unreachable) is available.
 */
export async function inspectRouteQuality(receiverUrl: string): Promise<RouteQualityInfo> {
  const cleanUrl = receiverUrl.trim().replace(/\/+$/, "");
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(cleanUrl);
  } catch {
    return {
      currentUrl: cleanUrl,
      routeKind: "DIRECT_LAN",
      latencyMs: 0,
    };
  }

  const host = parsedUrl.hostname;
  const port = Number(parsedUrl.port || DEFAULT_RECEIVER_PORT);

  // Measure HTTP latency to currentUrl
  const t0 = performance.now();
  const currentReachable = await probeNovaShareReceiver(cleanUrl, 900);
  const latencyMs = currentReachable ? Math.max(1, Math.round(performance.now() - t0)) : 0;

  if (host === "127.0.0.1" || host === "localhost") {
    return {
      currentUrl: cleanUrl,
      routeKind: "LOCAL",
      latencyMs,
    };
  }

  // Query Tailscale JSON to see if host matches a Tailscale peer or its CurAddr LAN IP
  let routeKind: RouteKind = host.startsWith("100.") ? "TAILSCALE_DIRECT" : "DIRECT_LAN";
  let relayCode: string | undefined;
  let directLanUrl: string | undefined;
  let tailscaleUrl: string | undefined;

  try {
    const proc = Bun.spawn(["tailscale", "status", "--json"], {
      stdout: "pipe",
      stderr: "ignore",
    });
    const text = await Promise.race([
      new Response(proc.stdout).text(),
      timeoutAfter(800, ""),
    ]);
    if (text.trim().startsWith("{")) {
      const parsed = JSON.parse(text) as {
        Peer?: Record<
          string,
          {
            TailscaleIPs?: string[];
            CurAddr?: string;
            Relay?: string;
          }
        >;
      };
      for (const peer of Object.values(parsed.Peer || {})) {
        const tsIp = (peer.TailscaleIPs || []).find((ip) => !ip.includes(":"));
        const curLanIp = peer.CurAddr ? peer.CurAddr.split(":")[0] : "";
        if (tsIp === host || curLanIp === host) {
          if (tsIp) {
            tailscaleUrl = `http://${tsIp}:${port}`;
          }
          if (
            curLanIp &&
            (curLanIp.startsWith("192.168.") ||
              curLanIp.startsWith("10.") ||
              curLanIp.startsWith("172."))
          ) {
            directLanUrl = `http://${curLanIp}:${port}`;
          }
          if (host === tsIp) {
            if (!curLanIp && peer.Relay) {
              routeKind = "TAILSCALE_RELAY";
              relayCode = peer.Relay;
            } else {
              routeKind = "TAILSCALE_DIRECT";
            }
          }
          break;
        }
      }
    }
  } catch {
    // Ignore
  }

  let fasterUrlAvailable: string | undefined;

  // Case 1: User is on Tailscale IP, check if Direct LAN URL is reachable!
  if (routeKind !== "DIRECT_LAN" && directLanUrl && directLanUrl !== cleanUrl) {
    const lanOk = await probeNovaShareReceiver(directLanUrl, 450);
    if (lanOk) {
      fasterUrlAvailable = directLanUrl;
    }
  }

  // Case 2: User is on Direct LAN IP, but it's unreachable (e.g. away from office) -> check Tailscale fallback!
  if (!currentReachable && tailscaleUrl && tailscaleUrl !== cleanUrl) {
    const tsOk = await probeNovaShareReceiver(tailscaleUrl, 650);
    if (tsOk) {
      fasterUrlAvailable = tailscaleUrl;
    }
  }

  return {
    currentUrl: cleanUrl,
    routeKind,
    latencyMs,
    relayCode,
    directLanUrl,
    tailscaleUrl,
    fasterUrlAvailable,
  };
}
