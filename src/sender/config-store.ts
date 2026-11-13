import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { DEFAULT_RECEIVER_PORT, DEFAULT_TOKEN } from "../shared/constants.ts";
import type { BackupProfile } from "../shared/types.ts";

export interface SenderConfigData {
  receiverUrl: string;
  token: string;
  defaultSourceDir: string;
  defaultDestinationDir: string;
  useSmartIgnore: boolean;
  customIgnore: string[];
  bandwidthLimitMBps: number;
  concurrency: number;
  profiles: BackupProfile[];
}

const CONFIG_FILE_PATH = path.resolve(process.cwd(), ".novashare-config.json");

function createDefaultConfig(): SenderConfigData {
  return {
    receiverUrl: `http://127.0.0.1:${DEFAULT_RECEIVER_PORT}`,
    token: process.env.NOVA_TOKEN || DEFAULT_TOKEN,
    defaultSourceDir: process.cwd(),
    defaultDestinationDir: path.join(os.homedir(), "NovaShare-Backups"),
    useSmartIgnore: true,
    customIgnore: [],
    bandwidthLimitMBps: 0,
    concurrency: 2,
    profiles: [],
  };
}

export async function loadSenderConfig(): Promise<SenderConfigData> {
  try {
    const raw = await fs.readFile(CONFIG_FILE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<SenderConfigData>;
    return {
      ...createDefaultConfig(),
      ...parsed,
      profiles: Array.isArray(parsed.profiles) ? parsed.profiles : [],
    };
  } catch {
    return createDefaultConfig();
  }
}

export async function saveSenderConfig(
  update: Partial<SenderConfigData>
): Promise<SenderConfigData> {
  const current = await loadSenderConfig();
  const merged: SenderConfigData = {
    ...current,
    ...update,
    profiles: update.profiles ?? current.profiles,
  };
  await fs.writeFile(CONFIG_FILE_PATH, JSON.stringify(merged, null, 2), "utf8");
  return merged;
}

export async function upsertBackupProfile(profile: BackupProfile): Promise<SenderConfigData> {
  const current = await loadSenderConfig();
  const idx = current.profiles.findIndex((p) => p.id === profile.id);
  if (idx >= 0) {
    current.profiles[idx] = profile;
  } else {
    current.profiles.push(profile);
  }
  return saveSenderConfig({ profiles: current.profiles });
}

export async function deleteBackupProfile(profileId: string): Promise<SenderConfigData> {
  const current = await loadSenderConfig();
  const filtered = current.profiles.filter((p) => p.id !== profileId);
  return saveSenderConfig({ profiles: filtered });
}
