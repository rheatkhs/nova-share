import { loadSenderConfig, upsertBackupProfile } from "./config-store.ts";
import type { TransferManager } from "./transfer-manager.ts";

/**
 * Lightweight background scheduler that checks saved BackupProfiles with `autoSyncMode` enabled:
 * - `on_connect`: triggers backup when the target Receiver comes online (at most once per 30 mins per profile)
 * - `interval_60`: triggers backup every 60 minutes when Receiver is reachable
 * - `interval_240`: triggers backup every 240 minutes (4 hours) when Receiver is reachable
 */
export function startProfileScheduler(transferManager: TransferManager) {
  let checking = false;

  const timer = setInterval(async () => {
    if (checking) return;
    const progress = transferManager.getProgress();
    if (
      progress.state === "SCANNING" ||
      progress.state === "PLANNING" ||
      progress.state === "TRANSFERRING" ||
      progress.state === "PAUSED" ||
      progress.state === "WAITING_FOR_NETWORK"
    ) {
      return;
    }

    checking = true;
    try {
      const cfg = await loadSenderConfig();
      const now = Date.now();

      for (const profile of cfg.profiles) {
        const mode = profile.autoSyncMode || "off";
        if (mode === "off") continue;

        const lastRun = profile.lastRunAt || 0;
        let minIntervalMs = 60 * 60 * 1000;
        if (mode === "on_connect") {
          minIntervalMs = 30 * 60 * 1000;
        } else if (mode === "interval_60") {
          minIntervalMs = 60 * 60 * 1000;
        } else if (mode === "interval_240") {
          minIntervalMs = 240 * 60 * 1000;
        }

        if (now - lastRun < minIntervalMs) {
          continue;
        }

        // Check if profile's Receiver is reachable
        try {
          const infoUrl = `${profile.receiverUrl.replace(/\/+$/, "")}/api/system/info`;
          const res = await fetch(infoUrl, {
            headers: { "X-Nova-Token": profile.token },
          });
          if (!res.ok) continue;

          // Update lastRunAt and kick off job
          profile.lastRunAt = now;
          await upsertBackupProfile(profile);

          void transferManager.runBackupJob({
            sourceDir: profile.sourceDir,
            destinationDir: profile.destinationDir,
            receiverUrl: profile.receiverUrl,
            token: profile.token,
            useSmartIgnore: profile.useSmartIgnore,
            customIgnore: profile.customIgnore,
            bandwidthLimitMBps: profile.bandwidthLimitMBps,
            concurrency: profile.concurrency,
          });
          break;
        } catch {
          // Receiver offline, skip until next check
        }
      }
    } finally {
      checking = false;
    }
  }, 15000);

  // Unref timer so it doesn't block test runner exit
  if (typeof timer.unref === "function") {
    timer.unref();
  }

  return () => clearInterval(timer);
}
