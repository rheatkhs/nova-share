(() => {
  const el = (id) => document.getElementById(id);

  const receiverUrlInput = el("receiverUrl");
  const tokenInput = el("tokenInput");
  const sourceDirInput = el("sourceDir");
  const destinationDirInput = el("destinationDir");
  const bandwidthSelect = el("bandwidthSelect");
  const concurrencySelect = el("concurrencySelect");
  const useSmartIgnoreCheck = el("useSmartIgnore");

  const connDot = el("connDot");
  const connText = el("connText");
  const remoteSysInfo = el("remoteSysInfo");
  const linuxDiskBadge = el("linuxDiskBadge");

  const statePill = el("statePill");
  const progressPercent = el("progressPercent");
  const speedValue = el("speedValue");
  const etaValue = el("etaValue");
  const progressFill = el("progressFill");
  const byteCounter = el("byteCounter");
  const laneTag = el("laneTag");
  const currentFileText = el("currentFileText");

  const statTotalFiles = el("statTotalFiles");
  const statCompleted = el("statCompleted");
  const statSkipped = el("statSkipped");
  const statRemaining = el("statRemaining");
  const logBox = el("logBox");
  const profileList = el("profileList");

  const btnTestConn = el("btnTestConn");
  const btnBrowseLocal = el("btnBrowseLocal");
  const btnBrowseRemote = el("btnBrowseRemote");
  const btnStartBackup = el("btnStartBackup");
  const btnPause = el("btnPause");
  const btnResume = el("btnResume");
  const btnCancel = el("btnCancel");
  const btnSaveProfile = el("btnSaveProfile");

  // Modal elements
  const browserModal = el("browserModal");
  const modalTitle = el("modalTitle");
  const modalCurrentPath = el("modalCurrentPath");
  const modalDiskInfo = el("modalDiskInfo");
  const modalDirList = el("modalDirList");
  const newFolderName = el("newFolderName");
  const btnParentDir = el("btnParentDir");
  const btnCreateFolder = el("btnCreateFolder");
  const btnCloseModal = el("btnCloseModal");
  const btnCancelModal = el("btnCancelModal");
  const btnSelectFolder = el("btnSelectFolder");

  let browseMode = "local"; // "local" | "remote"
  let currentModalParent = null;
  let profiles = [];

  function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    return `${(bytes / Math.pow(1024, i)).toFixed(i >= 2 ? 2 : 0)} ${units[i]}`;
  }

  function formatEta(seconds) {
    if (seconds === null || seconds === undefined || !isFinite(seconds)) return "ETA: --";
    if (seconds <= 0) return "ETA: 0s";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `ETA: ${h}j ${m}m`;
    if (m > 0) return `ETA: ${m}m ${s}d`;
    return `ETA: ${s}d`;
  }

  async function loadConfig() {
    try {
      const res = await fetch("/api/config");
      const cfg = await res.json();
      receiverUrlInput.value = cfg.receiverUrl || "http://127.0.0.1:7654";
      tokenInput.value = cfg.token || "";
      sourceDirInput.value = cfg.defaultSourceDir || "";
      destinationDirInput.value = cfg.defaultDestinationDir || "";
      useSmartIgnoreCheck.checked = cfg.useSmartIgnore !== false;
      bandwidthSelect.value = String(cfg.bandwidthLimitMBps || 0);
      concurrencySelect.value = String(cfg.concurrency || 2);
      profiles = cfg.profiles || [];
      renderProfiles();
      await checkRemoteConnection(false);
    } catch (e) {
      console.error("Failed loading config:", e);
    }
  }

  function renderProfiles() {
    if (!profiles || profiles.length === 0) {
      profileList.innerHTML = `<div class="empty-hint">Belum ada profil tersimpan.</div>`;
      return;
    }
    profileList.innerHTML = "";
    for (const p of profiles) {
      const row = document.createElement("div");
      row.className = "profile-item";
      row.innerHTML = `
        <div>
          <strong>${p.name}</strong>
          <div class="profile-paths">💻 ${p.sourceDir} ➔ 🐧 ${p.destinationDir}</div>
        </div>
        <div style="display:flex;gap:6px;">
          <button class="btn btn-secondary btn-sm" data-load="${p.id}">Pakai</button>
          <button class="btn btn-danger btn-sm" data-del="${p.id}">✕</button>
        </div>
      `;
      profileList.appendChild(row);
    }

    profileList.querySelectorAll("[data-load]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const prof = profiles.find((x) => x.id === btn.getAttribute("data-load"));
        if (!prof) return;
        sourceDirInput.value = prof.sourceDir;
        destinationDirInput.value = prof.destinationDir;
        receiverUrlInput.value = prof.receiverUrl;
        tokenInput.value = prof.token;
        useSmartIgnoreCheck.checked = prof.useSmartIgnore;
        bandwidthSelect.value = String(prof.bandwidthLimitMBps || 0);
        concurrencySelect.value = String(prof.concurrency || 2);
        checkRemoteConnection(false);
      });
    });

    profileList.querySelectorAll("[data-del]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-del");
        const res = await fetch(`/api/profiles/${encodeURIComponent(id)}`, { method: "DELETE" });
        const cfg = await res.json();
        profiles = cfg.profiles || [];
        renderProfiles();
      });
    });
  }

  async function checkRemoteConnection(useDefaultDestIfEmpty = true) {
    const receiverUrl = receiverUrlInput.value.trim();
    const token = tokenInput.value.trim();
    if (!receiverUrl) return;

    try {
      const res = await fetch("/api/remote/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receiverUrl, token }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || `HTTP ${res.status}`);
      }
      connDot.className = "dot online";
      connText.textContent = `Terhubung: ${data.hostname}`;
      remoteSysInfo.innerHTML = `✅ Terhubung ke <b>${data.hostname}</b> — OS: <code>${data.platform}</code> (${data.arch})`;

      if (useDefaultDestIfEmpty && !destinationDirInput.value.trim() && data.defaultBackupDir) {
        destinationDirInput.value = data.defaultBackupDir;
      }
      await refreshRemoteDiskSpace();
    } catch (err) {
      connDot.className = "dot offline";
      connText.textContent = "Tidak Terhubung";
      remoteSysInfo.innerHTML = `❌ Gagal terhubung ke Receiver Linux: <code>${err.message}</code>`;
    }
  }

  async function refreshRemoteDiskSpace() {
    try {
      const res = await fetch("/api/remote/browse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          receiverUrl: receiverUrlInput.value.trim(),
          token: tokenInput.value.trim(),
          path: destinationDirInput.value.trim() || undefined,
        }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.freeBytes > 0) {
        linuxDiskBadge.textContent = `Sisa Disk Linux: ${formatBytes(data.freeBytes)} tersedia`;
      }
    } catch {
      // Ignore
    }
  }

  async function openBrowserModal(mode) {
    browseMode = mode;
    newFolderName.value = "";
    browserModal.classList.remove("hidden");

    if (mode === "local") {
      modalTitle.textContent = "💻 Pilih Folder Sumber di Laptop (Windows)";
      await loadModalDirectory(sourceDirInput.value.trim() || undefined);
    } else {
      modalTitle.textContent = "🐧 Pilih Folder Tujuan di PC Kantor (Linux Omarchy)";
      await loadModalDirectory(destinationDirInput.value.trim() || undefined);
    }
  }

  async function loadModalDirectory(targetPath) {
    modalDirList.innerHTML = `<div style="padding:12px;color:var(--muted);">Memuat isi direktori...</div>`;
    try {
      let res;
      if (browseMode === "local") {
        const q = targetPath ? `?path=${encodeURIComponent(targetPath)}` : "";
        res = await fetch(`/api/local/browse${q}`);
      } else {
        res = await fetch("/api/remote/browse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            receiverUrl: receiverUrlInput.value.trim(),
            token: tokenInput.value.trim(),
            path: targetPath,
          }),
        });
      }
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Gagal membuka direktori");
      }

      modalCurrentPath.value = data.currentPath;
      currentModalParent = data.parentPath;
      btnParentDir.disabled = !currentModalParent;

      if (data.freeBytes > 0) {
        modalDiskInfo.textContent = `Host: ${data.hostname} (${data.platform}) • Sisa Ruang Kosong: ${formatBytes(data.freeBytes)} dari ${formatBytes(data.totalBytes)}`;
      } else {
        modalDiskInfo.textContent = `Host: ${data.hostname} (${data.platform})`;
      }

      const dirs = (data.entries || []).filter((e) => e.isDirectory);
      const filesCount = (data.entries || []).length - dirs.length;

      modalDirList.innerHTML = "";
      if (dirs.length === 0) {
        modalDirList.innerHTML = `<div class="empty-hint" style="padding:12px;">Tidak ada sub-folder di dalam direktori ini (${filesCount} file).</div>`;
        return;
      }

      for (const d of dirs) {
        const row = document.createElement("div");
        row.className = "dir-row";
        row.innerHTML = `<span>📁 ${d.name}</span><span style="color:var(--muted);font-size:12px;">Buka ➔</span>`;
        row.addEventListener("click", () => loadModalDirectory(d.path));
        modalDirList.appendChild(row);
      }
    } catch (err) {
      modalDirList.innerHTML = `<div style="padding:12px;color:var(--danger);">Error: ${err.message}</div>`;
    }
  }

  function updateProgressUI(p) {
    statePill.textContent = p.state;
    const processedBytes = (p.bytesTransferred || 0) + (p.bytesSkipped || 0);
    const pct = p.totalBytes > 0 ? Math.min(100, Math.round((processedBytes / p.totalBytes) * 100)) : 0;

    progressPercent.textContent = `${pct}%`;
    progressFill.style.width = `${pct}%`;
    speedValue.textContent = `${((p.speedBytesPerSec || 0) / (1024 * 1024)).toFixed(1)} MB/s`;
    etaValue.textContent = formatEta(p.etaSeconds);

    byteCounter.textContent = `${formatBytes(processedBytes)} / ${formatBytes(p.totalBytes)} (${formatBytes(p.bytesSkipped)} di-skip Delta Sync)`;

    if (p.currentLane === "BATCH") {
      laneTag.textContent = `⚡ JALUR A: MICRO-BATCHING (< 8 MB) • ${p.currentChunkInfo || ""}`;
    } else if (p.currentLane === "CHUNK") {
      laneTag.textContent = `🧱 JALUR B: 8MB CHUNK STREAM • ${p.currentChunkInfo || ""}`;
    } else {
      laneTag.textContent = `STATUS: ${p.state}`;
    }

    currentFileText.textContent = p.currentFile || (p.state === "COMPLETED" ? "Semua file selesai & terverifikasi SHA-256!" : "-");

    statTotalFiles.textContent = String(p.totalFiles || 0);
    statCompleted.textContent = String(p.filesCompleted || 0);
    statSkipped.textContent = String(p.filesSkipped || 0);
    statRemaining.textContent = String(p.filesRemaining || 0);

    if (Array.isArray(p.recentLogs) && p.recentLogs.length > 0) {
      logBox.textContent = p.recentLogs.join("\n");
      logBox.scrollTop = logBox.scrollHeight;
    }

    const active = p.state === "SCANNING" || p.state === "PLANNING" || p.state === "TRANSFERRING" || p.state === "WAITING_FOR_NETWORK";
    btnStartBackup.disabled = active || p.state === "PAUSED";
    btnPause.disabled = !(p.state === "TRANSFERRING" || p.state === "WAITING_FOR_NETWORK");
    btnResume.disabled = p.state !== "PAUSED";
    btnCancel.disabled = !(active || p.state === "PAUSED");
  }

  function connectSSE() {
    const es = new EventSource("/api/job/events");
    es.onmessage = (ev) => {
      try {
        const progress = JSON.parse(ev.data);
        updateProgressUI(progress);
      } catch {
        // Ignore malformed frame
      }
    };
  }

  // Event Listeners
  btnTestConn.addEventListener("click", () => checkRemoteConnection(true));
  btnBrowseLocal.addEventListener("click", () => openBrowserModal("local"));
  btnBrowseRemote.addEventListener("click", () => openBrowserModal("remote"));

  btnCloseModal.addEventListener("click", () => browserModal.classList.add("hidden"));
  btnCancelModal.addEventListener("click", () => browserModal.classList.add("hidden"));

  btnParentDir.addEventListener("click", () => {
    if (currentModalParent) {
      loadModalDirectory(currentModalParent);
    }
  });

  btnCreateFolder.addEventListener("click", async () => {
    const name = newFolderName.value.trim();
    const base = modalCurrentPath.value.trim();
    if (!name || !base) return;
    const sep = base.includes("\\") ? "\\" : "/";
    const fullNewPath = base.endsWith(sep) ? `${base}${name}` : `${base}${sep}${name}`;

    if (browseMode === "local") {
      await fetch("/api/local/mkdir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: fullNewPath }),
      });
    } else {
      await fetch("/api/remote/mkdir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          receiverUrl: receiverUrlInput.value.trim(),
          token: tokenInput.value.trim(),
          path: fullNewPath,
        }),
      });
    }
    newFolderName.value = "";
    await loadModalDirectory(fullNewPath);
  });

  btnSelectFolder.addEventListener("click", () => {
    const chosen = modalCurrentPath.value.trim();
    if (chosen) {
      if (browseMode === "local") {
        sourceDirInput.value = chosen;
      } else {
        destinationDirInput.value = chosen;
        refreshRemoteDiskSpace();
      }
    }
    browserModal.classList.add("hidden");
  });

  bandwidthSelect.addEventListener("change", async () => {
    await fetch("/api/job/bandwidth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bandwidthLimitMBps: Number(bandwidthSelect.value) }),
    });
  });

  btnSaveProfile.addEventListener("click", async () => {
    const src = sourceDirInput.value.trim();
    const dst = destinationDirInput.value.trim();
    if (!src || !dst) return;
    const name = prompt("Nama Profil Backup:", `${src.split(/[\\/]/).pop()} ➔ Omarchy`);
    if (!name) return;

    const res = await fetch("/api/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: `prof-${Date.now()}`,
        name,
        sourceDir: src,
        destinationDir: dst,
        receiverUrl: receiverUrlInput.value.trim(),
        token: tokenInput.value.trim(),
        useSmartIgnore: useSmartIgnoreCheck.checked,
        customIgnore: [],
        bandwidthLimitMBps: Number(bandwidthSelect.value),
        concurrency: Number(concurrencySelect.value),
      }),
    });
    const cfg = await res.json();
    profiles = cfg.profiles || [];
    renderProfiles();
  });

  btnStartBackup.addEventListener("click", async () => {
    const payload = {
      sourceDir: sourceDirInput.value.trim(),
      destinationDir: destinationDirInput.value.trim(),
      receiverUrl: receiverUrlInput.value.trim(),
      token: tokenInput.value.trim(),
      useSmartIgnore: useSmartIgnoreCheck.checked,
      bandwidthLimitMBps: Number(bandwidthSelect.value),
      concurrency: Number(concurrencySelect.value),
    };
    await fetch("/api/job/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  });

  btnPause.addEventListener("click", () => fetch("/api/job/pause", { method: "POST" }));
  btnResume.addEventListener("click", () => fetch("/api/job/resume", { method: "POST" }));
  btnCancel.addEventListener("click", () => fetch("/api/job/cancel", { method: "POST" }));

  loadConfig();
  connectSSE();
})();
