import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bookmark,
  CheckCircle2,
  ChevronRight,
  CornerLeftUp,
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
  RefreshCw,
  RotateCcw,
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
  recentLogs: ["[SIAP] Mesin Dual-Lane siap. Pilih pasangan folder Windows & Linux Omarchy."],
};

function NovaShareOperatorDeck() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  // Connection & Folder Config
  const [receiverUrl, setReceiverUrl] = useState("http://127.0.0.1:7654");
  const [token, setToken] = useState("novashare-secret-2026");
  const [sourceDir, setSourceDir] = useState("");
  const [destinationDir, setDestinationDir] = useState("");
  const [useSmartIgnore, setUseSmartIgnore] = useState(true);
  const [bandwidthLimitMBps, setBandwidthLimitMBps] = useState(0);
  const [concurrency, setConcurrency] = useState(2);
  const [profiles, setProfiles] = useState<BackupProfile[]>([]);
  const [newProfileName, setNewProfileName] = useState("");

  // Remote Linux Connection Status
  const [connStatus, setConnStatus] = useState<"idle" | "checking" | "online" | "offline">("idle");
  const [remoteInfo, setRemoteInfo] = useState<ReceiverSystemInfo | null>(null);
  const [connError, setConnError] = useState<string | null>(null);

  // Inline Directory Explorers (No Modals!)
  const [localBrowse, setLocalBrowse] = useState<BrowseResponse | null>(null);
  const [localNewFolder, setLocalNewFolder] = useState("");
  const [localLoading, setLocalLoading] = useState(false);

  const [remoteBrowse, setRemoteBrowse] = useState<BrowseResponse | null>(null);
  const [remoteNewFolder, setRemoteNewFolder] = useState("");
  const [remoteLoading, setRemoteLoading] = useState(false);

  // Live Telemetry & Tabs
  const [progress, setProgress] = useState<TransferProgress>(INITIAL_PROGRESS);
  const [bottomTab, setBottomTab] = useState<"logs" | "profiles">("logs");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

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

  async function browseLocalPath(targetPath?: string) {
    setLocalLoading(true);
    try {
      const q = targetPath ? `?path=${encodeURIComponent(targetPath)}` : "";
      const res = await fetch(`/api/local/browse${q}`);
      const data = await res.json();
      if (res.ok) {
        setLocalBrowse(data);
        setSourceDir(data.currentPath);
      }
    } finally {
      setLocalLoading(false);
    }
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

  async function handleStartBackup() {
    await fetch("/api/job/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceDir: sourceDir.trim(),
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
      `${sourceDir.split(/[\\/]/).filter(Boolean).pop() || "Backup"} ➔ Omarchy`;
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
      }),
    });
    const cfg = await res.json();
    setProfiles(cfg.profiles || []);
    setNewProfileName("");
    setBottomTab("profiles");
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

  // 48-cell visual Signal Matrix representing chunk/batch verification across the job
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

  const localDirs = (localBrowse?.entries || []).filter((e: DirectoryEntry) => e.isDirectory);
  const remoteDirs = (remoteBrowse?.entries || []).filter((e: DirectoryEntry) => e.isDirectory);

  const remoteUsedRatio =
    remoteBrowse && remoteBrowse.totalBytes > 0
      ? Math.round(
          ((remoteBrowse.totalBytes - remoteBrowse.freeBytes) / remoteBrowse.totalBytes) * 100
        )
      : 0;

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
              Windows Workstation <ArrowRight className="ns-icon-inline" /> Linux Omarchy Dual-Lane Backup Bridge
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
                aria-label="Linux Receiver URL"
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
          </div>

          <Separator orientation="vertical" className="ns-topbar__sep" />

          <div className="ns-status-chip">
            {connStatus === "online" ? (
              <Badge variant="success" className="ns-conn-badge">
                <Wifi className="ns-icon-xs" />
                <span>{remoteInfo?.hostname || "Omarchy Online"}</span>
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
              onClick={() => setTheme(theme === "light" ? "dark" : "light")}
              aria-label={theme === "light" ? "Aktifkan Dark Mode" : "Aktifkan Light Mode"}
              title={theme === "light" ? "Switch to Dark Mode" : "Switch to Light Mode"}
            >
              {theme === "light" ? <Moon className="ns-icon-sm" /> : <Sun className="ns-icon-sm" />}
            </Button>
          </div>
        </div>
      </header>

      {connError && (
        <div className="ns-alert-banner" role="alert">
          <AlertTriangle className="ns-icon-sm" />
          <span>
            Koneksi ke Receiver Linux gagal (<code>{connError}</code>). Pastikan daemon berjalan di PC Omarchy atau cek IP Tailscale/Wi-Fi.
          </span>
        </div>
      )}

      {/* Three-Column Architectural Patch Bay */}
      <main className="ns-patchbay">
        {/* BUS A: Windows Source Inspector */}
        <section className="ns-bus" aria-labelledby="bus-source-heading">
          <div className="ns-bus__header">
            <div className="ns-bus__title-row">
              <Laptop className="ns-icon-sm ns-text-accent" />
              <h2 id="bus-source-heading">Sumber Laptop (Windows)</h2>
            </div>
            <Badge variant="outline">
              {localBrowse?.hostname || "Localhost"}
            </Badge>
          </div>

          <div className="ns-bus__body">
            <label className="ns-field-label" htmlFor="source-dir-input">
              Path Direktori Sumber
            </label>
            <div className="ns-path-row">
              <Input
                id="source-dir-input"
                value={sourceDir}
                onChange={(e) => setSourceDir(e.target.value)}
                placeholder="C:\Users\...\Project"
                className="ns-mono"
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={() => browseLocalPath(sourceDir)}
                disabled={localLoading}
              >
                <FolderOpen className="ns-icon-sm" />
                <span>Buka</span>
              </Button>
            </div>

            {/* Inline Windows Directory Tree */}
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
                    placeholder="Folder baru..."
                    aria-label="Buat folder baru di Windows"
                    className="ns-input--compact"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleCreateFolder("local")}
                    disabled={!localNewFolder.trim()}
                  >
                    <FolderPlus className="ns-icon-xs" />
                  </Button>
                </div>
              </div>

              <div className="ns-explorer__list" role="region" aria-label="Daftar folder Windows">
                {localDirs.length === 0 ? (
                  <div className="ns-explorer__empty">
                    Tidak ada sub-folder di dalam direktori ini (
                    {localBrowse?.entries?.length || 0} file siap dibackup).
                  </div>
                ) : (
                  localDirs.map((dir: DirectoryEntry) => (
                    <button
                      key={dir.path}
                      type="button"
                      className="ns-explorer__item"
                      onClick={() => browseLocalPath(dir.path)}
                    >
                      <span className="ns-explorer__item-name">
                        <Folder className="ns-icon-xs ns-text-muted" />
                        <span>{dir.name}</span>
                      </span>
                      <ChevronRight className="ns-icon-xs ns-text-muted" />
                    </button>
                  ))
                )}
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
            {/* Reversed High-Contrast Status Plate (Raised from Timetable Discipline) */}
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
                      : "Pilih folder lalu tekan Mulai Backup.")}
                </span>
              </div>
            </div>

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
                  <option value="2">2 Streams Paralel (Ideal Wi-Fi)</option>
                  <option value="4">4 Streams Paralel (Tailscale LAN)</option>
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
                <span>Mulai Backup ke Linux Omarchy</span>
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
                <span>Pause</span>
              </Button>

              <Button
                variant="secondary"
                onClick={() => fetch("/api/job/resume", { method: "POST" })}
                disabled={progress.state !== "PAUSED"}
                title="Lanjutkan dari chunk terakhir"
              >
                <RotateCcw className="ns-icon-sm" />
                <span>Resume</span>
              </Button>

              <Button
                variant="destructive"
                onClick={() => fetch("/api/job/cancel", { method: "POST" })}
                disabled={!(isJobRunning || progress.state === "PAUSED")}
                title="Batalkan proses"
              >
                <Square className="ns-icon-sm" />
                <span>Batal</span>
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
                  <span>Profil Pasangan Folder ({profiles.length})</span>
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
                      placeholder="Nama preset (mis. Kerjaan Harian ➔ Omarchy)..."
                      aria-label="Nama profil baru"
                    />
                    <Button variant="secondary" size="sm" onClick={handleSaveProfile}>
                      <Bookmark className="ns-icon-xs" />
                      <span>Simpan Pasangan Saat Ini</span>
                    </Button>
                  </div>

                  <div className="ns-profiles-list">
                    {profiles.length === 0 ? (
                      <div className="ns-explorer__empty">
                        Belum ada profil tersimpan. Pilih folder Windows &amp; Linux lalu simpan agar besok cukup 1 klik.
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

        {/* BUS C: Linux Omarchy Destination Inspector & Partition Gauge */}
        <section className="ns-bus" aria-labelledby="bus-dest-heading">
          <div className="ns-bus__header">
            <div className="ns-bus__title-row">
              <HardDrive className="ns-icon-sm ns-text-success" />
              <h2 id="bus-dest-heading">Tujuan PC Kantor (Linux Omarchy)</h2>
            </div>
            <Badge variant="outline">
              {remoteInfo?.platform ? remoteInfo.platform.split(" ")[0] : "Linux"}
            </Badge>
          </div>

          <div className="ns-bus__body">
            {/* Real-time Linux Partition Capacity Gauge */}
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
                ariaLabel="Pemakaian ruang disk Linux"
              />
              <div className="ns-disk-gauge__sub ns-tabular">
                <span>
                  Total: {remoteBrowse ? formatBytes(remoteBrowse.totalBytes) : "--"}
                </span>
                <span>Terpakai: {remoteUsedRatio}%</span>
              </div>
            </div>

            <label className="ns-field-label" htmlFor="dest-dir-input">
              Path Direktori Tujuan di Linux
            </label>
            <div className="ns-path-row">
              <Input
                id="dest-dir-input"
                value={destinationDir}
                onChange={(e) => setDestinationDir(e.target.value)}
                placeholder="/home/user/NovaShare-Backups"
                className="ns-mono"
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={() => browseRemotePath(destinationDir)}
                disabled={remoteLoading}
              >
                <FolderOpen className="ns-icon-sm" />
                <span>Buka</span>
              </Button>
            </div>

            {/* Inline Linux Omarchy Directory Explorer */}
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
                    placeholder="Folder baru di Linux..."
                    aria-label="Buat folder baru di Linux Omarchy"
                    className="ns-input--compact"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleCreateFolder("remote")}
                    disabled={!remoteNewFolder.trim()}
                  >
                    <FolderPlus className="ns-icon-xs" />
                  </Button>
                </div>
              </div>

              <div
                className="ns-explorer__list"
                role="region"
                aria-label="Daftar folder Linux Omarchy"
              >
                {remoteDirs.length === 0 ? (
                  <div className="ns-explorer__empty">
                    {connStatus === "online"
                      ? `Folder tujuan siap menerima struktur 1:1 (${
                          remoteBrowse?.entries?.length || 0
                        } item di dalam folder ini).`
                      : "Hubungkan ke Receiver Linux untuk menelusuri direktori jarak jauh."}
                  </div>
                ) : (
                  remoteDirs.map((dir: DirectoryEntry) => (
                    <button
                      key={dir.path}
                      type="button"
                      className="ns-explorer__item"
                      onClick={() => browseRemotePath(dir.path)}
                    >
                      <span className="ns-explorer__item-name">
                        <Folder className="ns-icon-xs ns-text-muted" />
                        <span>{dir.name}</span>
                      </span>
                      <ChevronRight className="ns-icon-xs ns-text-muted" />
                    </button>
                  ))
                )}
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
