import * as os from "node:os";
import { DEFAULT_RECEIVER_PORT } from "../shared/constants.ts";
import type { DiscoveredPeer, RouteKind, RouteQualityInfo } from "../shared/types.ts";

function timeoutAfter<T>(ms: number, fallback: T): Promise<T> {
  const { promise, resolve } = Promise.withResolvers<T>();
  const timer = setTimeout(() => resolve(fallback), ms);
  if (typeof timer.unref === "function") timer.unref();
  return promise;
}

/**
 * Collects all IPv4 addresses belonging to THIS machine so we never mistake
 * our own local interface for a remote peer's Direct LAN address.
 */
function getSelfIpSet(): Set<string> {
  const ips = new Set<string>(["127.0.0.1", "localhost", "0.0.0.0"]);
  const nets = os.networkInterfaces();
  for (const addrs of Object.values(nets)) {
    for (const addr of addrs || []) {
      if (addr.family === "IPv4") {
        ips.add(addr.address);
      }
    }
  }
  return ips;
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

async function queryTailscalePeers(
  receiverPort: number,
  selfIps: Set<string>
): Promise<DiscoveredPeer[]> {
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
        Self?: { TailscaleIPs?: string[] };
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

      for (const selfTsIp of parsed.Self?.TailscaleIPs || []) {
        selfIps.add(selfTsIp);
      }

      const list: DiscoveredPeer[] = [];
      for (const peer of Object.values(parsed.Peer || {})) {
        const ipv4 = (peer.TailscaleIPs || []).find((ip) => !ip.includes(":"));
        if (!ipv4 || selfIps.has(ipv4)) continue;
        const rawName = peer.HostName || peer.DNSName?.split(".")[0] || ipv4;

        // Only surface CurAddr as Direct LAN if it is a private IP AND NOT one of our own local IPs!
        if (peer.CurAddr) {
          const lanIp = peer.CurAddr.split(":")[0];
          if (
            lanIp &&
            !selfIps.has(lanIp) &&
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
 * Discovers remote Tailscale peers and local Receiver endpoints.
 */
export async function discoverPeers(
  receiverPort = DEFAULT_RECEIVER_PORT
): Promise<DiscoveredPeer[]> {
  const selfIps = getSelfIpSet();
  const candidates = new Map<string, DiscoveredPeer>();

  // 1. Query remote Tailscale peers first
  const tsPeers = await queryTailscalePeers(receiverPort, selfIps);
  for (const p of tsPeers) {
    candidates.set(`${p.source}:${p.ip}`, p);
  }

  // 2. Include 127.0.0.1 only as an explicit local test loopback
  const localHostName = os.hostname();
  const localUrl = `http://127.0.0.1:${receiverPort}`;
  candidates.set("local:127.0.0.1", {
    name: `${localHostName} (Tes Lokal 127.0.0.1)`,
    ip: "127.0.0.1",
    url: localUrl,
    os: os.platform(),
    source: "local",
    online: true,
    novaShareActive: false,
  });

  // 3. Probe online candidates in parallel
  const peerList = Array.from(candidates.values());
  await Promise.all(
    peerList.map(async (peer) => {
      if (peer.online) {
        peer.novaShareActive = await probeNovaShareReceiver(peer.url);
      }
    })
  );

  // Sort remote active peers first, local loopback last
  peerList.sort((a, b) => {
    if (a.source === "local" && b.source !== "local") return 1;
    if (a.source !== "local" && b.source === "local") return -1;
    if (a.novaShareActive !== b.novaShareActive) return a.novaShareActive ? -1 : 1;
    if (a.online !== b.online) return a.online ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return peerList;
}

/**
 * Measures route latency and inspects Tailscale vs Direct LAN routing for a given Receiver URL.
 * Guarantees that `directLanUrl` and `fasterUrlAvailable` never point to the Sender's own IPs.
 */
export async function inspectRouteQuality(receiverUrl: string): Promise<RouteQualityInfo> {
  const selfIps = getSelfIpSet();
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

  const t0 = performance.now();
  const currentReachable = await probeNovaShareReceiver(cleanUrl, 900);
  const latencyMs = currentReachable ? Math.max(1, Math.round(performance.now() - t0)) : 0;

  if (selfIps.has(host)) {
    return {
      currentUrl: cleanUrl,
      routeKind: "LOCAL",
      latencyMs,
    };
  }

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
        Self?: { TailscaleIPs?: string[] };
        Peer?: Record<
          string,
          {
            TailscaleIPs?: string[];
            CurAddr?: string;
            Relay?: string;
          }
        >;
      };
      for (const selfTsIp of parsed.Self?.TailscaleIPs || []) {
        selfIps.add(selfTsIp);
      }

      for (const peer of Object.values(parsed.Peer || {})) {
        const tsIp = (peer.TailscaleIPs || []).find((ip) => !ip.includes(":"));
        const rawCurIp = peer.CurAddr ? peer.CurAddr.split(":")[0] : "";
        // Ignore CurAddr if it points to our own machine (hairpin reflection)
        const curLanIp = rawCurIp && !selfIps.has(rawCurIp) ? rawCurIp : "";

        if (tsIp === host || (curLanIp && curLanIp === host)) {
          if (tsIp && !selfIps.has(tsIp)) {
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

  if (routeKind !== "DIRECT_LAN" && directLanUrl && directLanUrl !== cleanUrl) {
    const lanOk = await probeNovaShareReceiver(directLanUrl, 450);
    if (lanOk) {
      fasterUrlAvailable = directLanUrl;
    }
  }

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
