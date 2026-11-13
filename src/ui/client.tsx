import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bell,
  BellOff,
  Bookmark,
  CheckCircle2,
  CheckSquare,
  ChevronRight,
  CornerLeftUp,
  Download,
  FileSearch,
  FileText,
  FileUp,
  Folder,
  FolderOpen,
  FolderPlus,
  Gauge,
  HardDrive,
  Laptop,
  Layers,
  Lock,
  Moon,
  Pause,
  Play,
  Radar,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  ShieldCheck,
  Square,
  Sun,
  Terminal,
  Trash2,
  Wifi,
  WifiOff,
} from "lucide-react";
import {
  Badge,
  Button,
  Input,
  Progress,
  Select,
  Separator,
  Switch,
} from "./components/shadcn.tsx";
import type {
  BackupProfile,
  BrowseResponse,
  DirectoryEntry,
  DiscoveredPeer,
  DryRunPreviewResponse,
  ReceiverSystemInfo,
  TransferProgress,
} from "../shared/types.ts";

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(i >= 2 ? 2 : 0)} ${units[i]}`;
}

function formatEta(seconds: number | null): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "--:--";
  if (seconds <= 0) return "00:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${h}j ${String(m).padStart(2, "0")}m`;
  }
  return `${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}d`;
}

function formatOsName(rawPlatform?: string): string {
  if (!rawPlatform) return "OS";
  const lower = rawPlatform.toLowerCase();
  if (lower.startsWith("win32") || lower.includes("windows")) return "Windows";
  if (lower.startsWith("linux")) return "Linux";
  if (lower.startsWith("darwin") || lower.includes("mac")) return "macOS";
  return rawPlatform.split(" ")[0] || rawPlatform;
}

function playNotificationTone(kind: "success" | "warning"): void {
  try {
    if (typeof window.AudioContext !== "function") return;
    const ctx = new window.AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(kind === "success" ? 660 : 330, ctx.currentTime);
    if (kind === "success") {
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.12);
    }
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch {
    // Ignore audio context restriction
  }
}

type SortKey = "name" | "size" | "mtime";

function filterAndSortEntries(
  entries: DirectoryEntry[],
  query: string,
  sortBy: SortKey
): DirectoryEntry[] {
  const q = query.trim().toLowerCase();
  const filtered = q
    ? entries.filter((e) => e.name.toLowerCase().includes(q))
    : [...entries];

  filtered.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) {
      return a.isDirectory ? -1 : 1;
    }
    if (sortBy === "size") {
      return b.size - a.size || a.name.localeCompare(b.name);
    }
    if (sortBy === "mtime") {
      return b.mtime - a.mtime || a.name.localeCompare(b.name);
    }
    return a.name.localeCompare(b.name);
  });

  return filtered;
}

const INITIAL_PROGRESS: TransferProgress = {
  state: "IDLE",
  jobId: null,
  sourceDir: "",
  destinationDir: "",
  receiverUrl: "",
  startedAt: null,
  updatedAt: Date.now(),
  totalFiles: 0,
  filesCompleted: 0,
  filesSkipped: 0,
  filesRemaining: 0,
  totalBytes: 0,
  bytesTransferred: 0,
  bytesSkipped: 0,
  speedBytesPerSec: 0,
  etaSeconds: null,
  currentFile: null,
  currentLane: null,
  currentChunkInfo: null,
  errorMessage: null,
  recentLogs: ["[SIAP] Mesin Dual-Lane siap. Pilih pasangan folder SENDER & RECEIVER."],
};

function NovaShareOperatorDeck() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const prevStateRef = useRef<string>("IDLE");

  // Connection & Folder Config
  const [receiverUrl, setReceiverUrl] = useState("http://127.0.0.1:7654");
  const [token, setToken] = useState("novashare-secret-2026");
  const [sourceDir, setSourceDir] = useState("");
  const [destinationDir, setDestinationDir] = useState("");
  const [useSmartIgnore, setUseSmartIgnore] = useState(true);
  const [bandwidthLimitMBps, setBandwidthLimitMBps] = useState(0);
  const [concurrency, setConcurrency] = useState(4);
  const [profiles, setProfiles] = useState<BackupProfile[]>([]);
  const [newProfileName, setNewProfileName] = useState("");
  const [newProfileAutoSync, setNewProfileAutoSync] =
    useState<BackupProfile["autoSyncMode"]>("off");

  // Auto-Discovery Peers (Tailscale & LAN)
  const [peers, setPeers] = useState<DiscoveredPeer[]>([]);
  const [scanningPeers, setScanningPeers] = useState(false);
  const [showDiscoveryBar, setShowDiscoveryBar] = useState(false);

  // Remote Connection Status
  const [connStatus, setConnStatus] = useState<"idle" | "checking" | "online" | "offline">("idle");
  const [remoteInfo, setRemoteInfo] = useState<ReceiverSystemInfo | null>(null);
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [connError, setConnError] = useState<string | null>(null);

  // Inline Directory Explorers + Search & Sort
  const [localBrowse, setLocalBrowse] = useState<BrowseResponse | null>(null);
  const [localNewFolder, setLocalNewFolder] = useState("");
  const [localLoading, setLocalLoading] = useState(false);
  const [localSearch, setLocalSearch] = useState("");
  const [localSort, setLocalSort] = useState<SortKey>("name");

  const [remoteBrowse, setRemoteBrowse] = useState<BrowseResponse | null>(null);
  const [remoteNewFolder, setRemoteNewFolder] = useState("");
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteSearch, setRemoteSearch] = useState("");
  const [remoteSort, setRemoteSort] = useState<SortKey>("name");

  // Dry-Run Preview & Live Telemetry
  const [dryRunResult, setDryRunResult] = useState<DryRunPreviewResponse | null>(null);
  const [dryRunLoading, setDryRunLoading] = useState(false);
  const [progress, setProgress] = useState<TransferProgress>(INITIAL_PROGRESS);
  const [bottomTab, setBottomTab] = useState<"logs" | "profiles">("logs");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // Desktop Notification & Audio cue on job completion or network drop
  useEffect(() => {
    const prev = prevStateRef.current;
    const curr = progress.state;
    prevStateRef.current = curr;

    if (!notificationsEnabled || prev === curr) return;

    if (curr === "COMPLETED" && prev === "TRANSFERRING") {
      playNotificationTone("success");
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification("NovaShare — Backup 100% Selesai", {
          body: `${progress.filesCompleted} file terkirim & terverifikasi SHA-256 (${progress.filesSkipped} di-skip).`,
        });
      }
    } else if (curr === "WAITING_FOR_NETWORK" || (curr === "ERROR" && prev !== "IDLE")) {
      playNotificationTone("warning");
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification("NovaShare — Peringatan Koneksi", {
          body:
            curr === "WAITING_FOR_NETWORK"
              ? "Koneksi Wi-Fi/Tailscale terputus. Menunggu jaringan pulih untuk Auto-Resume..."
              : `Terjadi error: ${progress.errorMessage || "Periksa log"}`,
        });
      }
    }
  }, [progress.state, notificationsEnabled, progress.filesCompleted, progress.filesSkipped, progress.errorMessage]);

  // Initial config load + SSE stream
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/config");
        const cfg = await res.json();
        const rUrl = cfg.receiverUrl || "http://127.0.0.1:7654";
        const rTok = cfg.token || "novashare-secret-2026";
        const sDir = cfg.defaultSourceDir || "";
        const dDir = cfg.defaultDestinationDir || "";

        setReceiverUrl(rUrl);
        setToken(rTok);
        setSourceDir(sDir);
        setDestinationDir(dDir);
        setUseSmartIgnore(cfg.useSmartIgnore !== false);
        setBandwidthLimitMBps(cfg.bandwidthLimitMBps || 0);
        setConcurrency(cfg.concurrency || 2);
        setProfiles(Array.isArray(cfg.profiles) ? cfg.profiles : []);

        await browseLocalPath(sDir || undefined);
        await verifyLinuxConnection(rUrl, rTok, dDir || undefined);
      } catch {
        // Ignore initial error
      }
    })();

    if (window.location.search.includes("oneshot=1")) {
      fetch("/api/job/status")
        .then((r) => r.json())
        .then((data: TransferProgress) => setProgress(data))
        .catch(() => {});
      return;
    }

    const es = new EventSource("/api/job/events");
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data) as TransferProgress;
        setProgress(data);
      } catch {
        // Ignore malformed frame
      }
    };
    return () => es.close();
  }, []);

  async function handleScanPeers() {
    setScanningPeers(true);
    setShowDiscoveryBar(true);
    try {
      const res = await fetch("/api/discovery/peers");
      const data = await res.json();
      if (res.ok && Array.isArray(data.peers)) {
        setPeers(data.peers);
      }
    } finally {
      setScanningPeers(false);
    }
  }

  async function handleToggleNotifications() {
    const next = !notificationsEnabled;
    setNotificationsEnabled(next);
    if (next && "Notification" in window && Notification.permission === "default") {
      await Notification.requestPermission().catch(() => {});
    }
  }

  async function browseLocalPath(targetPath?: string, keepSelection = false) {
    setLocalLoading(true);
    try {
      const q = targetPath ? `?path=${encodeURIComponent(targetPath)}` : "";
      const res = await fetch(`/api/local/browse${q}`);
      const data = await res.json();
      if (res.ok) {
        setLocalBrowse(data);
        setSourceDir(data.currentPath);
        setLocalSearch("");
        if (!keepSelection) {
          setSelectedItems([]);
        }
      }
    } finally {
      setLocalLoading(false);
    }
  }

  async function handlePickNativeWindowsFolder() {
    setLocalLoading(true);
    try {
      const res = await fetch("/api/local/pick-folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initialPath: sourceDir }),
      });
      const data = await res.json();
      if (res.ok && !data.cancelled && data.path) {
        setSourceDir(data.path);
        setSelectedItems([]);
        if (data.browse) {
          setLocalBrowse(data.browse);
        } else {
          await browseLocalPath(data.path);
        }
      } else if (data.unsupported) {
        await browseLocalPath(sourceDir);
      }
    } finally {
      setLocalLoading(false);
    }
  }

  async function handlePickNativeWindowsFile() {
    setLocalLoading(true);
    try {
      const res = await fetch("/api/local/pick-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initialPath: sourceDir }),
      });
      const data = await res.json();
      if (res.ok && !data.cancelled && data.parentDir && Array.isArray(data.files)) {
        setSourceDir(data.parentDir);
        setSelectedItems(data.files);
        if (data.browse) {
          setLocalBrowse(data.browse);
        } else {
          await browseLocalPath(data.parentDir, true);
        }
      }
    } finally {
      setLocalLoading(false);
    }
  }

  function toggleSelectItem(name: string) {
    setSelectedItems((prev) =>
      prev.includes(name) ? prev.filter((item) => item !== name) : [...prev, name]
    );
  }

  async function browseRemotePath(
    targetPath?: string,
    overrideUrl?: string,
    overrideToken?: string
  ) {
    setRemoteLoading(true);
    try {
      const res = await fetch("/api/remote/browse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          receiverUrl: (overrideUrl ?? receiverUrl).trim(),
          token: (overrideToken ?? token).trim(),
          path: targetPath,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setRemoteBrowse(data);
        setDestinationDir(data.currentPath);
        setRemoteSearch("");
      }
    } finally {
      setRemoteLoading(false);
    }
  }

  async function verifyLinuxConnection(
    overrideUrl?: string,
    overrideToken?: string,
    initialDest?: string
  ) {
    const rUrl = (overrideUrl ?? receiverUrl).trim();
    const rTok = (overrideToken ?? token).trim();
    if (!rUrl) return;

    setConnStatus("checking");
    setConnError(null);
    try {
      const res = await fetch("/api/remote/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receiverUrl: rUrl, token: rTok }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || `HTTP ${res.status}`);
      }
      setRemoteInfo(data);
      setConnStatus("online");
      const targetDest = initialDest || destinationDir || data.defaultBackupDir;
      await browseRemotePath(targetDest, rUrl, rTok);
    } catch (err) {
      setConnStatus("offline");
      setConnError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleCreateFolder(mode: "local" | "remote") {
    if (mode === "local") {
      const name = localNewFolder.trim();
      if (!name || !localBrowse) return;
      const sep = localBrowse.currentPath.includes("\\") ? "\\" : "/";
      const fullPath = localBrowse.currentPath.endsWith(sep)
        ? `${localBrowse.currentPath}${name}`
        : `${localBrowse.currentPath}${sep}${name}`;
      await fetch("/api/local/mkdir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: fullPath }),
      });
      setLocalNewFolder("");
      await browseLocalPath(fullPath);
    } else {
      const name = remoteNewFolder.trim();
      if (!name || !remoteBrowse) return;
      const sep = remoteBrowse.currentPath.includes("\\") ? "\\" : "/";
      const fullPath = remoteBrowse.currentPath.endsWith(sep)
        ? `${remoteBrowse.currentPath}${name}`
        : `${remoteBrowse.currentPath}${sep}${name}`;
      await fetch("/api/remote/mkdir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          receiverUrl: receiverUrl.trim(),
          token: token.trim(),
          path: fullPath,
        }),
      });
      setRemoteNewFolder("");
      await browseRemotePath(fullPath);
    }
  }

  async function handleDryRunPreview() {
    setDryRunLoading(true);
    try {
      const res = await fetch("/api/job/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceDir: sourceDir.trim(),
          selectedItems: selectedItems.length > 0 ? selectedItems : undefined,
          destinationDir: destinationDir.trim(),
          receiverUrl: receiverUrl.trim(),
          token: token.trim(),
          useSmartIgnore,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setDryRunResult(data);
      }
    } finally {
      setDryRunLoading(false);
    }
  }

  async function handleStartBackup() {
    setDryRunResult(null);
    await fetch("/api/job/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceDir: sourceDir.trim(),
        selectedItems: selectedItems.length > 0 ? selectedItems : undefined,
        destinationDir: destinationDir.trim(),
        receiverUrl: receiverUrl.trim(),
        token: token.trim(),
        useSmartIgnore,
        bandwidthLimitMBps,
        concurrency,
      }),
    });
  }

  async function handleBandwidthChange(nextMbps: number) {
    setBandwidthLimitMBps(nextMbps);
    await fetch("/api/job/bandwidth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bandwidthLimitMBps: nextMbps }),
    });
  }

  async function handleSaveProfile() {
    if (!sourceDir.trim() || !destinationDir.trim()) return;
    const defaultLabel =
      newProfileName.trim() ||
      `${sourceDir.split(/[\\/]/).filter(Boolean).pop() || "Backup"} ➔ ${receiverHost}`;
    const res = await fetch("/api/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: `prof-${Date.now()}`,
        name: defaultLabel,
        sourceDir: sourceDir.trim(),
        destinationDir: destinationDir.trim(),
        receiverUrl: receiverUrl.trim(),
        token: token.trim(),
        useSmartIgnore,
        customIgnore: [],
        bandwidthLimitMBps,
        concurrency,
        autoSyncMode: newProfileAutoSync || "off",
      }),
    });
    const cfg = await res.json();
    setProfiles(cfg.profiles || []);
    setNewProfileName("");
    setBottomTab("profiles");
  }

  async function handleUpdateProfileAutoSync(
    prof: BackupProfile,
    autoSyncMode: BackupProfile["autoSyncMode"]
  ) {
    const res = await fetch("/api/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...prof,
        autoSyncMode,
      }),
    });
    const cfg = await res.json();
    setProfiles(cfg.profiles || []);
  }

  async function handleDeleteProfile(id: string) {
    const res = await fetch(`/api/profiles/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    const cfg = await res.json();
    setProfiles(cfg.profiles || []);
  }

  function applyProfile(p: BackupProfile) {
    setSourceDir(p.sourceDir);
    setDestinationDir(p.destinationDir);
    setReceiverUrl(p.receiverUrl);
    setToken(p.token);
    setUseSmartIgnore(p.useSmartIgnore);
    setBandwidthLimitMBps(p.bandwidthLimitMBps || 0);
    setConcurrency(p.concurrency || 2);
    void browseLocalPath(p.sourceDir);
    void verifyLinuxConnection(p.receiverUrl, p.token, p.destinationDir);
  }

  function buildReceiverDownloadUrl(remoteFilePath: string): string {
    const q = new URLSearchParams({
      receiverUrl: receiverUrl.trim(),
      token: token.trim(),
      path: remoteFilePath,
    });
    return `/api/remote/download?${q.toString()}`;
  }

  // Computed telemetry
  const processedBytes = (progress.bytesTransferred || 0) + (progress.bytesSkipped || 0);
  const progressPercent =
    progress.totalBytes > 0
      ? Math.min(100, Math.round((processedBytes / progress.totalBytes) * 100))
      : progress.state === "COMPLETED"
      ? 100
      : 0;

  const speedMBps = ((progress.speedBytesPerSec || 0) / (1024 * 1024)).toFixed(1);
  const isJobRunning =
    progress.state === "SCANNING" ||
    progress.state === "PLANNING" ||
    progress.state === "TRANSFERRING" ||
    progress.state === "WAITING_FOR_NETWORK";

  const matrixCells = useMemo(() => {
    const totalCells = 48;
    const verifiedRatio =
      progress.totalBytes > 0 ? (progress.bytesTransferred || 0) / progress.totalBytes : 0;
    const skippedRatio =
      progress.totalBytes > 0 ? (progress.bytesSkipped || 0) / progress.totalBytes : 0;

    const skippedCells = Math.round(skippedRatio * totalCells);
    const verifiedCells = Math.round(verifiedRatio * totalCells);

    return Array.from({ length: totalCells }, (_, idx) => {
      if (progress.state === "COMPLETED") return "verified";
      if (idx < skippedCells) return "skipped";
      if (idx < skippedCells + verifiedCells) return "verified";
      if (idx === skippedCells + verifiedCells && isJobRunning) return "active";
      return "pending";
    });
  }, [
    progress.totalBytes,
    progress.bytesTransferred,
    progress.bytesSkipped,
    progress.state,
    isJobRunning,
  ]);

  const rawLocalEntries = localBrowse?.entries || [];
  const localEntries = useMemo(
    () => filterAndSortEntries(rawLocalEntries, localSearch, localSort),
    [rawLocalEntries, localSearch, localSort]
  );
  const localDirsCount = rawLocalEntries.filter((e: DirectoryEntry) => e.isDirectory).length;
  const localFilesCount = rawLocalEntries.length - localDirsCount;

  const rawRemoteEntries = remoteBrowse?.entries || [];
  const remoteEntries = useMemo(
    () => filterAndSortEntries(rawRemoteEntries, remoteSearch, remoteSort),
    [rawRemoteEntries, remoteSearch, remoteSort]
  );
  const remoteDirsCount = rawRemoteEntries.filter((e: DirectoryEntry) => e.isDirectory).length;
  const remoteFilesCount = rawRemoteEntries.length - remoteDirsCount;

  const remoteUsedRatio =
    remoteBrowse && remoteBrowse.totalBytes > 0
      ? Math.round(
          ((remoteBrowse.totalBytes - remoteBrowse.freeBytes) / remoteBrowse.totalBytes) * 100
        )
      : 0;
  const senderHost = localBrowse?.hostname || "Localhost";
  const senderOs = formatOsName(localBrowse?.platform);
  const receiverHost = remoteInfo?.hostname || remoteBrowse?.hostname || "Remote";
  const receiverOs = formatOsName(remoteInfo?.platform || remoteBrowse?.platform);

  const allFilteredSelected =
    localEntries.length > 0 && localEntries.every((e) => selectedItems.includes(e.name));

  function handleToggleSelectAll() {
    if (allFilteredSelected) {
      setSelectedItems([]);
    } else {
      setSelectedItems(localEntries.map((e) => e.name));
    }
  }

  return (
    <div className="ns-shell">
      {/* Top Operator Command Bar */}
      <header className="ns-topbar">
        <div className="ns-brand">
          <div className="ns-brand__mark" aria-hidden="true">
            <Layers className="ns-icon" />
          </div>
          <div className="ns-brand__titles">
            <h1>NovaShare Operator Console</h1>
            <p className="ns-brand__sub">
              SENDER ({senderHost} • {senderOs}) <ArrowRight className="ns-icon-inline" /> RECEIVER (
              {connStatus === "online" ? `${receiverHost} • ${receiverOs}` : "Offline"})
            </p>
          </div>
        </div>

        <div className="ns-topbar__right">
          <div className="ns-connection-inline">
            <div className="ns-input-group">
              <Server className="ns-input-group__icon" />
              <Input
                value={receiverUrl}
                onChange={(e) => setReceiverUrl(e.target.value)}
                placeholder="http://100.x.y.z:7654"
                aria-label="Receiver URL"
                className="ns-input--url"
              />
            </div>
            <div className="ns-input-group">
              <Lock className="ns-input-group__icon" />
              <Input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="X-Nova-Token"
                aria-label="Secret Token"
                className="ns-input--token"
              />
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => verifyLinuxConnection()}
              disabled={connStatus === "checking"}
            >
              <RefreshCw
                className={`ns-icon-sm ${connStatus === "checking" ? "ns-spin" : ""}`}
              />
              <span>Verifikasi Link</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleScanPeers}
              disabled={scanningPeers}
              title="Deteksi otomatis perangkat Tailscale & LAN"
            >
              <Radar className={`ns-icon-sm ${scanningPeers ? "ns-spin" : ""}`} />
              <span>Scan Perangkat</span>
            </Button>
          </div>

          <Separator orientation="vertical" className="ns-topbar__sep" />

          <div className="ns-status-chip">
            {connStatus === "online" ? (
              <Badge variant="success" className="ns-conn-badge">
                <Wifi className="ns-icon-xs" />
                <span>RECEIVER: {receiverHost}</span>
              </Badge>
            ) : connStatus === "offline" ? (
              <Badge variant="destructive" className="ns-conn-badge">
                <WifiOff className="ns-icon-xs" />
                <span>Link Terputus</span>
              </Badge>
            ) : (
              <Badge variant="secondary" className="ns-conn-badge">
                <Activity className="ns-icon-xs" />
                <span>Siaga</span>
              </Badge>
            )}

            <Button
              variant="outline"
              size="icon"
              onClick={handleToggleNotifications}
              aria-label={
                notificationsEnabled ? "Matikan Notifikasi" : "Aktifkan Notifikasi"
              }
              title={
                notificationsEnabled
                  ? "Notifikasi Selesai & Suara: Aktif"
                  : "Notifikasi Selesai & Suara: Nonaktif"
              }
            >
              {notificationsEnabled ? (
                <Bell className="ns-icon-sm ns-text-accent" />
              ) : (
                <BellOff className="ns-icon-sm ns-text-muted" />
              )}
            </Button>

            <Button
              variant="outline"
              size="icon"
              onClick={() => setTheme(theme === "light" ? "dark" : "light")}
              aria-label={theme === "light" ? "Aktifkan Dark Mode" : "Aktifkan Light Mode"}
              title={theme === "light" ? "Switch to Dark Mode" : "Switch to Light Mode"}
            >
              {theme === "light" ? <Moon className="ns-icon-sm" /> : <Sun className="ns-icon-sm" />}
            </Button>
          </div>
        </div>
      </header>

      {/* Auto-Discovered Tailscale & LAN Peers Strip */}
      {showDiscoveryBar && (
        <div className="ns-discovery-bar" role="region" aria-label="Perangkat Tailscale dan LAN">
          <span className="ns-discovery-bar__title">
            <Radar className="ns-icon-xs ns-text-accent" />
            <span>Perangkat Terdeteksi:</span>
          </span>
          {scanningPeers ? (
            <span className="ns-text-muted">Memindai jaringan Tailscale &amp; LAN...</span>
          ) : peers.length === 0 ? (
            <span className="ns-text-muted">Tidak ada perangkat ditemukan.</span>
          ) : (
            peers.map((peer) => (
              <button
                key={peer.ip}
                type="button"
                className={`ns-peer-pill ${
                  peer.novaShareActive ? "ns-peer-pill--active" : ""
                }`}
                onClick={() => {
                  setReceiverUrl(peer.url);
                  void verifyLinuxConnection(peer.url, token);
                }}
                title={`${peer.url} (${peer.source.toUpperCase()} • ${peer.os})`}
              >
                <Server className="ns-icon-xs" />
                <span>{peer.name}</span>
                <span className="ns-mono">({peer.ip})</span>
                {peer.novaShareActive && <span>• Aktif</span>}
              </button>
            ))
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowDiscoveryBar(false)}
          >
            Tutup
          </Button>
        </div>
      )}

      {connError && (
        <div className="ns-alert-banner" role="alert">
          <AlertTriangle className="ns-icon-sm" />
          <span>
            Koneksi ke RECEIVER gagal (<code>{connError}</code>). Pastikan daemon berjalan di mesin RECEIVER atau gunakan tombol <b>Scan Perangkat</b>.
          </span>
        </div>
      )}

      {/* Three-Column Architectural Patch Bay */}
      <main className="ns-patchbay">
        {/* BUS A: SENDER Inspector */}
        <section className="ns-bus" aria-labelledby="bus-source-heading">
          <div className="ns-bus__header">
            <div className="ns-bus__title-row">
              <Laptop className="ns-icon-sm ns-text-accent" />
              <h2 id="bus-source-heading">
                SENDER ({senderHost} • {senderOs})
              </h2>
            </div>
            <Badge variant="outline">SENDER</Badge>
          </div>

          <div className="ns-bus__body">
            <label className="ns-field-label" htmlFor="source-dir-input">
              Path Direktori SENDER
            </label>
            <div className="ns-path-row">
              <Input
                id="source-dir-input"
                value={sourceDir}
                onChange={(e) => setSourceDir(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    void browseLocalPath(sourceDir);
                  }
                }}
                placeholder="C:\Users\...\Project"
                className="ns-mono"
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={handlePickNativeWindowsFolder}
                disabled={localLoading}
                title="Pilih folder dari Windows Explorer"
              >
                <FolderOpen className="ns-icon-sm" />
                <span>Pilih Folder</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handlePickNativeWindowsFile}
                disabled={localLoading}
                title="Pilih 1 atau beberapa file spesifik dari Windows Explorer"
              >
                <FileUp className="ns-icon-sm" />
                <span>Pilih File</span>
              </Button>
            </div>

            {/* Inline SENDER Directory & File Explorer */}
            <div className="ns-explorer">
              <div className="ns-explorer__toolbar">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    localBrowse?.parentPath && browseLocalPath(localBrowse.parentPath)
                  }
                  disabled={!localBrowse?.parentPath || localLoading}
                >
                  <CornerLeftUp className="ns-icon-xs" />
                  <span>Induk</span>
                </Button>
                <div className="ns-mkdir-inline">
                  <Input
                    value={localNewFolder}
                    onChange={(e) => setLocalNewFolder(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        void handleCreateFolder("local");
                      }
                    }}
                    placeholder="Folder baru..."
                    aria-label="Buat folder baru di SENDER"
                    className="ns-input--compact"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleCreateFolder("local")}
                    disabled={!localNewFolder.trim()}
                    title="Buat folder baru di lokasi ini"
                  >
                    <FolderPlus className="ns-icon-xs" />
                  </Button>
                </div>
              </div>

              {/* Search, Sort & Select-All Bar */}
              <div className="ns-explorer__filter">
                <div className="ns-search-wrap">
                  <Search className="ns-search-wrap__icon" />
                  <Input
                    value={localSearch}
                    onChange={(e) => setLocalSearch(e.target.value)}
                    placeholder="Cari file/folder..."
                    aria-label="Cari file atau folder di SENDER"
                    className="ns-input--search"
                  />
                </div>
                <Select
                  value={localSort}
                  onChange={(e) => setLocalSort(e.target.value as SortKey)}
                  aria-label="Urutkan daftar SENDER"
                  className="ns-select--compact"
                >
                  <option value="name">Nama A–Z</option>
                  <option value="size">Ukuran Terbesar</option>
                  <option value="mtime">Terbaru Diubah</option>
                </Select>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleToggleSelectAll}
                  disabled={localEntries.length === 0}
                  title="Pilih atau batalkan semua item di daftar ini"
                >
                  <CheckSquare className="ns-icon-xs" />
                  <span>{allFilteredSelected ? "Reset" : "Pilih Semua"}</span>
                </Button>
              </div>

              {localBrowse?.roots && localBrowse.roots.length > 0 && (
                <div className="ns-explorer__roots" aria-label="Pintasan drive dan folder SENDER">
                  {localBrowse.roots.map((r) => (
                    <button
                      key={r.path}
                      type="button"
                      className={`ns-root-pill ${
                        localBrowse.currentPath === r.path ? "ns-root-pill--active" : ""
                      }`}
                      onClick={() => browseLocalPath(r.path)}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              )}

              <div className="ns-explorer__list" role="region" aria-label="Daftar folder dan file SENDER">
                {localEntries.length === 0 ? (
                  <div className="ns-explorer__empty">
                    {localSearch
                      ? `Tidak ada item yang cocok dengan pencarian "${localSearch}".`
                      : "Direktori ini kosong (0 folder, 0 file)."}
                  </div>
                ) : (
                  localEntries.map((entry: DirectoryEntry) => {
                    const isSelected = selectedItems.includes(entry.name);
                    return (
                      <div
                        key={entry.path}
                        className={`ns-explorer__item ${
                          isSelected ? "ns-explorer__item--selected" : ""
                        }`}
                      >
                        <button
                          type="button"
                          className={`ns-explorer__check ${
                            isSelected ? "ns-explorer__check--active" : ""
                          }`}
                          onClick={() => toggleSelectItem(entry.name)}
                          aria-label={`Pilih ${entry.name}`}
                          title={
                            isSelected
                              ? "Batalkan pilihan item ini"
                              : "Pilih item ini untuk dikirim"
                          }
                        >
                          {isSelected ? (
                            <CheckSquare className="ns-icon-xs" />
                          ) : (
                            <Square className="ns-icon-xs" />
                          )}
                        </button>

                        <button
                          type="button"
                          className="ns-explorer__main-btn"
                          onClick={() =>
                            entry.isDirectory
                              ? browseLocalPath(entry.path)
                              : toggleSelectItem(entry.name)
                          }
                        >
                          <span className="ns-explorer__item-name">
                            {entry.isDirectory ? (
                              <Folder className="ns-icon-xs ns-text-accent" />
                            ) : (
                              <FileText className="ns-icon-xs ns-text-muted" />
                            )}
                            <span>{entry.name}</span>
                          </span>
                          <span className="ns-explorer__item-action ns-tabular">
                            {entry.isDirectory ? (
                              <>
                                <span>Buka</span>
                                <ChevronRight className="ns-icon-xs" />
                              </>
                            ) : (
                              <span>{formatBytes(entry.size)}</span>
                            )}
                          </span>
                        </button>
                      </div>
                    );
                  })
                )}
              </div>

              {selectedItems.length > 0 && (
                <div className="ns-selection-bar">
                  <span>
                    Mode Seleksi: {selectedItems.length} item dipilih untuk dikirim
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedItems([])}
                  >
                    Reset (Kirim Semua)
                  </Button>
                </div>
              )}

              <div className="ns-explorer__footer">
                <span className="ns-explorer__footer-path ns-mono" title={sourceDir}>
                  Aktif: {localBrowse?.currentPath || sourceDir}
                </span>
                <span className="ns-tabular">
                  {localDirsCount} folder • {localFilesCount} file
                </span>
              </div>
            </div>

            <div className="ns-filter-bar">
              <div className="ns-filter-bar__info">
                <span className="ns-filter-bar__title">Smart Ignore Filter</span>
                <span className="ns-filter-bar__desc">
                  Lewati otomatis <code>node_modules</code>, <code>.git</code>, <code>vendor</code>, <code>.cache</code>
                </span>
              </div>
              <Switch
                id="smart-ignore-switch"
                checked={useSmartIgnore}
                onCheckedChange={setUseSmartIgnore}
                label="Aktifkan Smart Ignore Filter"
              />
            </div>
          </div>
        </section>

        {/* BUS B: Center Dual-Lane Pipeline & Telemetry Console */}
        <section className="ns-bus ns-bus--center" aria-labelledby="bus-pipeline-heading">
          <div className="ns-bus__header">
            <div className="ns-bus__title-row">
              <Gauge className="ns-icon-sm ns-text-accent" />
              <h2 id="bus-pipeline-heading">Dual-Lane Pipeline &amp; Telemetry</h2>
            </div>
            <Badge
              variant={
                progress.state === "COMPLETED"
                  ? "success"
                  : progress.state === "WAITING_FOR_NETWORK" || progress.state === "PAUSED"
                  ? "warning"
                  : progress.state === "ERROR"
                  ? "destructive"
                  : "default"
              }
            >
              {progress.state}
            </Badge>
          </div>

          <div className="ns-bus__body">
            {/* Reversed High-Contrast Status Plate */}
            <div className="ns-telemetry-plate">
              <div className="ns-telemetry-plate__primary">
                <div className="ns-telemetry-plate__pct ns-tabular">{progressPercent}%</div>
                <div className="ns-telemetry-plate__meta">
                  <span className="ns-telemetry-plate__bytes ns-tabular">
                    {formatBytes(processedBytes)} / {formatBytes(progress.totalBytes)}
                  </span>
                  <span className="ns-telemetry-plate__sub ns-tabular">
                    Delta Sync Skip: {formatBytes(progress.bytesSkipped)}
                  </span>
                </div>
              </div>

              <div className="ns-telemetry-plate__right ns-tabular">
                <div className="ns-telemetry-plate__speed">{speedMBps} MB/s</div>
                <div className="ns-telemetry-plate__eta">ETA {formatEta(progress.etaSeconds)}</div>
              </div>
            </div>

            <Progress value={progressPercent} ariaLabel="Progres total backup" />

            {/* Dual-Lane Signal Matrix (48 Whole Cells) */}
            <div className="ns-matrix-block">
              <div className="ns-matrix-block__header">
                <span className="ns-matrix-block__title">
                  <ShieldCheck className="ns-icon-xs ns-text-success" />
                  <span>SHA-256 Chunk &amp; Micro-Batch Signal Matrix</span>
                </span>
                <span className="ns-matrix-block__legend ns-tabular">
                  {progress.currentLane === "BATCH"
                    ? `Jalur A: Micro-Batch (<8MB)`
                    : progress.currentLane === "CHUNK"
                    ? `Jalur B: 8MB Stream • ${progress.currentChunkInfo || ""}`
                    : "Menunggu Instruksi"}
                </span>
              </div>

              <div className="ns-signal-grid" aria-hidden="true">
                {matrixCells.map((status, i) => (
                  <div
                    key={i}
                    className={`ns-signal-cell ns-signal-cell--${status}`}
                  />
                ))}
              </div>

              <div className="ns-active-stream ns-mono">
                <span className="ns-active-stream__path">
                  {progress.currentFile ||
                    (progress.state === "COMPLETED"
                      ? "Seluruh paket & chunk 8MB selesai diverifikasi tanpa korup."
                      : "Pilih folder/file lalu tekan Mulai Backup atau Cek Perubahan.")}
                </span>
              </div>
            </div>

            {/* Pre-Flight Dry-Run Summary Card (when triggered) */}
            {dryRunResult && (
              <div className="ns-dryrun-box" role="status">
                <div className="ns-dryrun-box__top">
                  <span>
                    Hasil Cek Perubahan (Dry-Run):{" "}
                    {formatBytes(dryRunResult.summary.bytesToTransfer)} akan dikirim
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDryRunResult(null)}
                  >
                    ✕
                  </Button>
                </div>
                <div className="ns-tabular">
                  • <b>{dryRunResult.summary.newCount}</b> file baru/berubah •{" "}
                  <b>{dryRunResult.summary.resumeCount}</b> file lanjut resume (<code>.novapart</code>) •{" "}
                  <b>{dryRunResult.summary.skipCount}</b> file di-skip ({formatBytes(dryRunResult.summary.bytesSkipped)} sudah identik)
                </div>
                <div className="ns-tabular">
                  • Status Disk RECEIVER:{" "}
                  {dryRunResult.enoughSpace
                    ? `✔ Cukup (${formatBytes(dryRunResult.freeBytes)} tersedia)`
                    : `⚠️ Ruang disk kurang! (Butuh ${formatBytes(dryRunResult.summary.bytesToTransfer)}, sisa ${formatBytes(dryRunResult.freeBytes)})`}
                </div>
              </div>
            )}

            {/* Tabular Flush-Right Ledger Rows */}
            <div className="ns-ledger-grid">
              <div className="ns-ledger-row">
                <span className="ns-ledger-row__label">Total File Terindeks</span>
                <span className="ns-ledger-row__val ns-tabular">{progress.totalFiles}</span>
              </div>
              <div className="ns-ledger-row">
                <span className="ns-ledger-row__label">Terkirim &amp; Terverifikasi</span>
                <span className="ns-ledger-row__val ns-tabular ns-text-success">
                  {progress.filesCompleted}
                </span>
              </div>
              <div className="ns-ledger-row">
                <span className="ns-ledger-row__label">Dilewati (Delta Sync Identik)</span>
                <span className="ns-ledger-row__val ns-tabular ns-text-accent">
                  {progress.filesSkipped}
                </span>
              </div>
              <div className="ns-ledger-row">
                <span className="ns-ledger-row__label">Antrean Tersisa</span>
                <span className="ns-ledger-row__val ns-tabular">{progress.filesRemaining}</span>
              </div>
            </div>

            {/* Engine Controls: Bandwidth & Concurrency */}
            <div className="ns-engine-controls">
              <div className="ns-control-col">
                <label className="ns-field-label" htmlFor="bandwidth-select">
                  Batas Kecepatan Wi-Fi
                </label>
                <Select
                  id="bandwidth-select"
                  value={String(bandwidthLimitMBps)}
                  onChange={(e) => handleBandwidthChange(Number(e.target.value))}
                >
                  <option value="0">Tanpa Batas (Full Line Rate)</option>
                  <option value="10">10 MB/s (Mode Rapat / Hemat Wi-Fi)</option>
                  <option value="25">25 MB/s (Seimbang)</option>
                  <option value="50">50 MB/s (High Throughput)</option>
                </Select>
              </div>

              <div className="ns-control-col">
                <label className="ns-field-label" htmlFor="concurrency-select">
                  Worker Stream Paralel
                </label>
                <Select
                  id="concurrency-select"
                  value={String(concurrency)}
                  onChange={(e) => setConcurrency(Number(e.target.value))}
                >
                  <option value="1">1 Stream Sekuensial</option>
                  <option value="2">2 Streams Paralel</option>
                  <option value="4">4 Streams Paralel (Rekomendasi)</option>
                  <option value="8">8 Streams Paralel (Turbo Wi-Fi / LAN)</option>
                  <option value="12">12 Streams Paralel (Max Throughput)</option>
                </Select>
              </div>
            </div>

            {/* Primary Execution Bar */}
            <div className="ns-Execution-bar">
              <Button
                variant="default"
                size="lg"
                className="ns-btn-start"
                onClick={handleStartBackup}
                disabled={isJobRunning || progress.state === "PAUSED"}
              >
                <Play className="ns-icon-sm" />
                <span>
                  {selectedItems.length > 0
                    ? `Kirim ${selectedItems.length} Item ke ${
                        connStatus === "online" ? receiverHost : "RECEIVER"
                      }`
                    : `Mulai Backup ke ${
                        connStatus === "online" ? receiverHost : "RECEIVER"
                      }`}
                </span>
              </Button>

              <Button
                variant="secondary"
                onClick={handleDryRunPreview}
                disabled={isJobRunning || dryRunLoading}
                title="Cek berapa GB dan file yang berubah sebelum mengirim data"
              >
                <FileSearch className="ns-icon-sm" />
                <span>{dryRunLoading ? "Mengecek..." : "Dry-Run"}</span>
              </Button>

              <Button
                variant="outline"
                onClick={() => fetch("/api/job/pause", { method: "POST" })}
                disabled={
                  !(
                    progress.state === "TRANSFERRING" ||
                    progress.state === "WAITING_FOR_NETWORK"
                  )
                }
                title="Jeda sementara"
              >
                <Pause className="ns-icon-sm" />
              </Button>

              <Button
                variant="outline"
                onClick={() => fetch("/api/job/resume", { method: "POST" })}
                disabled={progress.state !== "PAUSED"}
                title="Lanjutkan dari chunk terakhir"
              >
                <RotateCcw className="ns-icon-sm" />
              </Button>

              <Button
                variant="destructive"
                onClick={() => fetch("/api/job/cancel", { method: "POST" })}
                disabled={!(isJobRunning || progress.state === "PAUSED")}
                title="Batalkan proses"
              >
                <Square className="ns-icon-sm" />
              </Button>
            </div>

            {/* Bottom Console Drawer: Verification Audit Log & Saved Profiles */}
            <div className="ns-drawer">
              <div className="ns-drawer__tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={bottomTab === "logs"}
                  className={`ns-tab-btn ${bottomTab === "logs" ? "ns-tab-btn--active" : ""}`}
                  onClick={() => setBottomTab("logs")}
                >
                  <Terminal className="ns-icon-xs" />
                  <span>Log Verifikasi SHA-256</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={bottomTab === "profiles"}
                  className={`ns-tab-btn ${
                    bottomTab === "profiles" ? "ns-tab-btn--active" : ""
                  }`}
                  onClick={() => setBottomTab("profiles")}
                >
                  <Bookmark className="ns-icon-xs" />
                  <span>Profil &amp; Auto-Sync ({profiles.length})</span>
                </button>
              </div>

              {bottomTab === "logs" ? (
                <pre className="ns-log-terminal ns-mono" aria-live="polite">
                  {(progress.recentLogs || []).join("\n")}
                </pre>
              ) : (
                <div className="ns-profiles-pane">
                  <div className="ns-profiles-pane__add">
                    <Input
                      value={newProfileName}
                      onChange={(e) => setNewProfileName(e.target.value)}
                      placeholder="Nama profil..."
                      aria-label="Nama profil baru"
                    />
                    <Select
                      value={newProfileAutoSync || "off"}
                      onChange={(e) =>
                        setNewProfileAutoSync(
                          e.target.value as BackupProfile["autoSyncMode"]
                        )
                      }
                      aria-label="Jadwal Auto-Sync"
                      className="ns-select--compact"
                    >
                      <option value="off">Manual</option>
                      <option value="on_connect">Auto saat Online</option>
                      <option value="interval_60">Auto Tiap 1 Jam</option>
                      <option value="interval_240">Auto Tiap 4 Jam</option>
                    </Select>
                    <Button variant="secondary" size="sm" onClick={handleSaveProfile}>
                      <Bookmark className="ns-icon-xs" />
                      <span>Simpan</span>
                    </Button>
                  </div>

                  <div className="ns-profiles-list">
                    {profiles.length === 0 ? (
                      <div className="ns-explorer__empty">
                        Belum ada profil tersimpan. Pilih folder SENDER &amp; RECEIVER lalu simpan (bisa dijadwalkan Auto-Sync).
                      </div>
                    ) : (
                      profiles.map((prof) => (
                        <div key={prof.id} className="ns-profile-row">
                          <div className="ns-profile-row__info">
                            <span className="ns-profile-row__name">{prof.name}</span>
                            <span className="ns-profile-row__paths ns-mono">
                              {prof.sourceDir} ➔ {prof.destinationDir}
                            </span>
                          </div>
                          <div className="ns-profile-row__actions">
                            <Select
                              value={prof.autoSyncMode || "off"}
                              onChange={(e) =>
                                handleUpdateProfileAutoSync(
                                  prof,
                                  e.target.value as BackupProfile["autoSyncMode"]
                                )
                              }
                              aria-label={`Auto-sync mode untuk ${prof.name}`}
                              className="ns-autosync-select"
                            >
                              <option value="off">Manual</option>
                              <option value="on_connect">Saat Online</option>
                              <option value="interval_60">Tiap 1 Jam</option>
                              <option value="interval_240">Tiap 4 Jam</option>
                            </Select>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => applyProfile(prof)}
                            >
                              Muat
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDeleteProfile(prof.id)}
                              aria-label={`Hapus profil ${prof.name}`}
                            >
                              <Trash2 className="ns-icon-xs" />
                            </Button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* BUS C: RECEIVER Inspector & Partition Gauge */}
        <section className="ns-bus" aria-labelledby="bus-dest-heading">
          <div className="ns-bus__header">
            <div className="ns-bus__title-row">
              <HardDrive className="ns-icon-sm ns-text-success" />
              <h2 id="bus-dest-heading">
                {connStatus === "online"
                  ? `RECEIVER (${receiverHost} • ${receiverOs})`
                  : "RECEIVER (Belum Terhubung)"}
              </h2>
            </div>
            <Badge variant="outline">RECEIVER</Badge>
          </div>

          <div className="ns-bus__body">
            {/* Real-time RECEIVER Partition Capacity Gauge */}
            <div className="ns-disk-gauge">
              <div className="ns-disk-gauge__row">
                <span className="ns-disk-gauge__label">Kapasitas Partisi Tujuan</span>
                <span className="ns-disk-gauge__val ns-tabular">
                  {remoteBrowse && remoteBrowse.freeBytes > 0
                    ? `${formatBytes(remoteBrowse.freeBytes)} Kosong`
                    : "Menunggu info disk..."}
                </span>
              </div>
              <Progress
                value={remoteUsedRatio}
                ariaLabel="Pemakaian ruang disk RECEIVER"
              />
              <div className="ns-disk-gauge__sub ns-tabular">
                <span>
                  Total: {remoteBrowse ? formatBytes(remoteBrowse.totalBytes) : "--"}
                </span>
                <span>Terpakai: {remoteUsedRatio}%</span>
              </div>
            </div>

            <label className="ns-field-label" htmlFor="dest-dir-input">
              Path Direktori RECEIVER
            </label>
            <div className="ns-path-row">
              <Input
                id="dest-dir-input"
                value={destinationDir}
                onChange={(e) => setDestinationDir(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    void browseRemotePath(destinationDir);
                  }
                }}
                placeholder="/home/user/NovaShare-Backups"
                className="ns-mono"
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={async () => {
                  if (destinationDir.trim()) {
                    await fetch("/api/remote/mkdir", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        receiverUrl: receiverUrl.trim(),
                        token: token.trim(),
                        path: destinationDir.trim(),
                      }),
                    }).catch(() => {});
                  }
                  await browseRemotePath(destinationDir);
                }}
                disabled={remoteLoading}
                title="Buka atau buat path tujuan di RECEIVER"
              >
                <FolderOpen className="ns-icon-sm" />
                <span>Pilih / Buka</span>
              </Button>
            </div>

            {/* Inline RECEIVER Directory & File Explorer */}
            <div className="ns-explorer">
              <div className="ns-explorer__toolbar">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    remoteBrowse?.parentPath && browseRemotePath(remoteBrowse.parentPath)
                  }
                  disabled={!remoteBrowse?.parentPath || remoteLoading}
                >
                  <CornerLeftUp className="ns-icon-xs" />
                  <span>Induk</span>
                </Button>
                <div className="ns-mkdir-inline">
                  <Input
                    value={remoteNewFolder}
                    onChange={(e) => setRemoteNewFolder(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        void handleCreateFolder("remote");
                      }
                    }}
                    placeholder="Folder baru di RECEIVER..."
                    aria-label="Buat folder baru di RECEIVER"
                    className="ns-input--compact"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleCreateFolder("remote")}
                    disabled={!remoteNewFolder.trim()}
                    title="Buat folder baru di RECEIVER"
                  >
                    <FolderPlus className="ns-icon-xs" />
                  </Button>
                </div>
              </div>

              {/* RECEIVER Search & Sort Bar */}
              <div className="ns-explorer__filter">
                <div className="ns-search-wrap">
                  <Search className="ns-search-wrap__icon" />
                  <Input
                    value={remoteSearch}
                    onChange={(e) => setRemoteSearch(e.target.value)}
                    placeholder="Cari di RECEIVER..."
                    aria-label="Cari file atau folder di RECEIVER"
                    className="ns-input--search"
                  />
                </div>
                <Select
                  value={remoteSort}
                  onChange={(e) => setRemoteSort(e.target.value as SortKey)}
                  aria-label="Urutkan daftar RECEIVER"
                  className="ns-select--compact"
                >
                  <option value="name">Nama A–Z</option>
                  <option value="size">Ukuran Terbesar</option>
                  <option value="mtime">Terbaru Diubah</option>
                </Select>
              </div>

              {remoteBrowse?.roots && remoteBrowse.roots.length > 0 && (
                <div className="ns-explorer__roots" aria-label="Pintasan direktori RECEIVER">
                  {remoteBrowse.roots.map((r) => (
                    <button
                      key={r.path}
                      type="button"
                      className={`ns-root-pill ${
                        remoteBrowse.currentPath === r.path ? "ns-root-pill--active" : ""
                      }`}
                      onClick={() => browseRemotePath(r.path)}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              )}

              <div
                className="ns-explorer__list"
                role="region"
                aria-label="Daftar folder dan file RECEIVER"
              >
                {remoteEntries.length === 0 ? (
                  <div className="ns-explorer__empty">
                    {remoteSearch
                      ? `Tidak ada item yang cocok dengan "${remoteSearch}".`
                      : connStatus === "online"
                      ? "Folder tujuan masih kosong dan siap menerima struktur 1:1."
                      : "Hubungkan ke RECEIVER untuk menelusuri direktori jarak jauh."}
                  </div>
                ) : (
                  remoteEntries.map((entry: DirectoryEntry) => (
                    <div key={entry.path} className="ns-explorer__item">
                      <button
                        type="button"
                        className="ns-explorer__main-btn"
                        onClick={() => {
                          if (entry.isDirectory) {
                            void browseRemotePath(entry.path);
                          }
                        }}
                      >
                        <span className="ns-explorer__item-name">
                          {entry.isDirectory ? (
                            <Folder className="ns-icon-xs ns-text-success" />
                          ) : (
                            <FileText className="ns-icon-xs ns-text-muted" />
                          )}
                          <span>{entry.name}</span>
                        </span>
                        <span className="ns-explorer__item-action ns-tabular">
                          {entry.isDirectory ? (
                            <>
                              <span>Buka</span>
                              <ChevronRight className="ns-icon-xs" />
                            </>
                          ) : (
                            <span>{formatBytes(entry.size)}</span>
                          )}
                        </span>
                      </button>

                      {!entry.isDirectory && (
                        <a
                          href={buildReceiverDownloadUrl(entry.path)}
                          className="ns-download-link"
                          title={`Unduh ${entry.name} dari RECEIVER ke komputer ini`}
                          download={entry.name}
                        >
                          <Download className="ns-icon-xs" />
                          <span>Unduh</span>
                        </a>
                      )}
                    </div>
                  ))
                )}
              </div>

              <div className="ns-explorer__footer">
                <span className="ns-explorer__footer-path ns-mono" title={destinationDir}>
                  Aktif: {remoteBrowse?.currentPath || destinationDir}
                </span>
                <span className="ns-tabular">
                  {remoteDirsCount} folder • {remoteFilesCount} file
                </span>
              </div>
            </div>

            <div className="ns-integrity-note">
              <CheckCircle2 className="ns-icon-sm ns-text-success" />
              <div>
                <strong>1:1 Native Filesystem &amp; Atomic Resume</strong>
                <p>
                  File ditulis sebagai <code>.novapart</code> per 8MB dan otomatis berganti nama ke file asli setelah hash SHA-256 cocok.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(<NovaShareOperatorDeck />);
}
