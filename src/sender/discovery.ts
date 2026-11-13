import * as os from "node:os";
import { DEFAULT_RECEIVER_PORT } from "../shared/constants.ts";
import type { DiscoveredPeer } from "../shared/types.ts";

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
