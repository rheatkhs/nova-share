import * as os from "node:os";
import { startReceiverServer } from "./receiver/server.ts";
import { startSenderServer } from "./sender/server.ts";
import {
  APP_VERSION,
  DEFAULT_RECEIVER_PORT,
  DEFAULT_SENDER_PORT,
  DEFAULT_TOKEN,
} from "./shared/constants.ts";

function parseArgValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx >= 0 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  return undefined;
}

function getLocalAddresses(): string[] {
  const interfaces = os.networkInterfaces();
  const ips: string[] = [];
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name] || []) {
      if (net.family === "IPv4" && !net.internal) {
        ips.push(`${net.address} (${name})`);
      }
    }
  }
  return ips;
}

function printHelp(): void {
  console.log(`
🚀 NovaShare v${APP_VERSION} — High-Throughput Cross-Platform Backup Engine
Usage:
  bun run src/index.ts [options]

Modes:
  --sender             Start Windows Sender Engine + Local Web UI Dashboard
  --receiver           Start Linux Omarchy Receiver Daemon
  --dual               Start both Sender and Receiver locally (default for dev)

Options:
  --ui-port <number>   Port for Sender Web UI (default: ${DEFAULT_SENDER_PORT})
  --port <number>      Port for Receiver Daemon (default: ${DEFAULT_RECEIVER_PORT})
  --token <secret>     Secret token for Receiver auth (or set NOVA_TOKEN env)
  --help, -h           Show this help message
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    process.exit(0);
  }

  const hasSender = args.includes("--sender");
  const hasReceiver = args.includes("--receiver");
  const hasDual = args.includes("--dual") || (!hasSender && !hasReceiver);

  const receiverPort = Number(
    parseArgValue(args, "--port") || process.env.NOVA_RECEIVER_PORT || DEFAULT_RECEIVER_PORT
  );
  const senderPort = Number(
    parseArgValue(args, "--ui-port") || process.env.NOVA_SENDER_PORT || DEFAULT_SENDER_PORT
  );
  const token = parseArgValue(args, "--token") || process.env.NOVA_TOKEN || DEFAULT_TOKEN;

  console.log(`================================================================`);
  console.log(`⚡ NovaShare v${APP_VERSION} — Cross-Platform Backup Engine`);
  console.log(`================================================================`);

  if (hasReceiver || hasDual) {
    const recServer = startReceiverServer({
      port: receiverPort,
      hostname: "0.0.0.0",
      token,
    });
    const ips = getLocalAddresses();
    console.log(`🐧 [Receiver Daemon] Listening on port ${recServer.port}`);
    if (ips.length > 0) {
      console.log(`   Available Network / Tailscale IPs:`);
      for (const ip of ips) {
        console.log(`   • http://${ip.split(" ")[0]}:${recServer.port}  [${ip}]`);
      }
    }
    console.log(`   Auth Token (X-Nova-Token): ${token}`);
    console.log(`----------------------------------------------------------------`);
  }

  if (hasSender || hasDual) {
    const { server: sndServer } = startSenderServer({
      port: senderPort,
      hostname: "127.0.0.1",
    });
    console.log(`💻 [Sender Dashboard UI] Ready at: http://localhost:${sndServer.port}`);
    console.log(`   Open this URL in your browser to select folders & start backup.`);
    console.log(`----------------------------------------------------------------`);
  }
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
