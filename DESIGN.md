---
name: NovaShare
description: High-Throughput Cross-Platform Backup Operator Console (Windows Laptop to Linux Omarchy PC)
colors:
  primary: "#18181b"
  primary-hover: "#27272a"
  primary-fg: "#fafafa"
  bg-canvas: "#f4f4f5"
  bg-surface: "#ffffff"
  bg-subtle: "#fafafa"
  bg-muted: "#e4e4e7"
  bg-plate: "#09090b"
  fg-primary: "#09090b"
  fg-secondary: "#3f3f46"
  fg-muted: "#52525b"
  border-hairline: "#e4e4e7"
  border-strong: "#d4d4d8"
  signal-blue: "#1d4ed8"
  signal-blue-soft: "#dbeafe"
  verified-emerald: "#047857"
  verified-emerald-soft: "#d1fae5"
  in-flight-amber: "#b45309"
  in-flight-amber-soft: "#fef3c7"
  fault-crimson: "#b91c1c"
  fault-crimson-soft: "#fee2e2"
typography:
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Roboto, Oxygen, Ubuntu, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "-0.02em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Roboto, Oxygen, Ubuntu, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.015em"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Roboto, Oxygen, Ubuntu, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Roboto, Oxygen, Ubuntu, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.2
  mono:
    fontFamily: "'JetBrains Mono', 'Cascadia Code', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.45
rounded:
  sm: "6px"
  md: "8px"
  lg: "12px"
spacing:
  xs: "6px"
  sm: "8px"
  md: "14px"
  lg: "20px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-fg}"
    rounded: "{rounded.sm}"
    height: "36px"
    padding: "0 14px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-secondary:
    backgroundColor: "{colors.bg-subtle}"
    textColor: "{colors.fg-primary}"
    rounded: "{rounded.sm}"
    height: "36px"
    padding: "0 14px"
  button-outline:
    backgroundColor: "{colors.bg-surface}"
    textColor: "{colors.fg-primary}"
    rounded: "{rounded.sm}"
    height: "36px"
    padding: "0 14px"
  button-destructive:
    backgroundColor: "{colors.fault-crimson}"
    textColor: "#ffffff"
    rounded: "{rounded.sm}"
    height: "36px"
    padding: "0 14px"
  input-field:
    backgroundColor: "{colors.bg-surface}"
    textColor: "{colors.fg-primary}"
    rounded: "{rounded.sm}"
    height: "36px"
    padding: "0 11px"
---

# Design System: NovaShare

## Overview

**Creative North Star: "Dual-Bus Studio Patch Bay & Operator Deck"**

NovaShare approaches cross-platform backup not as a passive consumer cloud uploader, but as a precision benchtop routing deck connecting a Windows Laptop Source Bus, a central Dual-Lane Transfer Pipeline Bus, and a Linux Omarchy Destination Bus. Every pixel in the interface reports concrete filesystem paths, `statfs` partition capacity, or SHA-256 verification physics.

Built on `shadcn/ui` primitives and `lucide-react` 1.75px vector iconography, the visual world defaults to a high-craft daylight zinc scale suited to fluorescent and daylight office desks, paired with a dark workstation toggle (`html[data-theme="dark"]`). The interface explicitly rejects AI-slop tropes: zero blurry glassmorphism, zero neon gradient text, zero decorative sparklines, zero modal-first directory pickers, and zero emoji substitutes.

**Key Characteristics:**
- **Three-Bus Architectural Patch Bay:** A unified 1px hairline grid (`1fr 1.35fr 1fr`) where Source, Pipeline, and Destination sit side by side without nested card containers.
- **Single Reversed Status Plate:** One high-contrast reversed plate (`#09090b` in light mode) anchors the primary transfer percentage, byte counter, and real-time throughput (`MB/s` and `ETA`).
- **Whole-Cell Signal Matrix:** A 48-cell (`16x3` desktop, `8x6` mobile) verification grid displaying verified (`#047857`), delta-skipped (`#1d4ed8`), active (`#b45309`), and pending chunks.
- **Inline Modal-Free Directory Exploration:** Windows and remote Linux Omarchy directory trees live directly inside their respective bus columns alongside inline folder creation.

## Colors

NovaShare uses a Restrained zinc neutral scale where saturated hues are reserved strictly for pipeline state, cryptographic verification, and partition capacity thresholds.

### Primary
- **Carbon Zinc** (`#18181b`): Primary execution actions (`Mulai Backup`), active switches, and brand identity badge.
- **Signal Blue** (`#1d4ed8` light / `#60a5fa` dark): Active progress fill, delta-skipped file counts, and keyboard focus rings (`:focus-visible`).

### Secondary
- **Verified Emerald** (`#047857` light / `#34d399` dark): SHA-256 verified chunk cells, completed file counters, free Linux partition readouts, and online link badges.
- **In-Flight Amber** (`#b45309` light / `#fbbf24` dark): Active chunk cell in transit, paused state, and network-recovery waiting indicators.
- **Fault Crimson** (`#b91c1c` light / `#f87171` dark): Hash mismatch alerts, offline link badges, and cancellation controls.

### Neutral
- **Workstation Canvas** (`#f4f4f5` light / `#09090b` dark): Outer viewport ground.
- **Primary Patch Plane** (`#ffffff` light / `#121215` dark): Bus A (Windows) and Bus C (Linux) primary surface.
- **Pipeline Recess** (`#fafafa` light / `#18181b` dark): Bus B (Center Pipeline) recessed background and directory tree interiors.
- **Structural Hairline** (`#e4e4e7` light / `#27272a` dark): 1px structural borders separating buses, rows, and toolbars.
- **Control Stroke** (`#d4d4d8` light / `#3f3f46` dark): Form control borders (`Input`, `Select`, `Button` outline).

### Named Rules
**The Single Reversed Plate Rule.** Exactly one element per screen—the primary telemetry readout plate (`.ns-telemetry-plate`)—may invert the ground to solid Carbon Black (`#09090b`) with alabaster type (`#fafafa`). No secondary panel or badge may compete with it.

**The State-Only Hue Rule.** Saturated colors (Signal Blue, Verified Emerald, In-Flight Amber, Fault Crimson) never appear as decorative backgrounds or borders; they encode live transfer or connection state only.

## Typography

**Body & UI Font:** System UI / Inter geometric sans stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif`)
**Mono & Machine Voice:** JetBrains Mono / Cascadia Code (`"JetBrains Mono", "Cascadia Code", ui-monospace, monospace`)

**Character:** Compact, fixed-rem operational typography with tight negative tracking on headings and strict tabular alignment on every numeric readout.

### Hierarchy
- **Telemetry Readout** (`800`, `2rem`, `line-height: 1`, `letter-spacing: -0.03em`): Completion percentage inside the reversed status plate.
- **Headline** (`700`, `1.0625rem`, `line-height: 1.3`, `letter-spacing: -0.02em`): Top command bar product title.
- **Title** (`600`, `0.9375rem`, `line-height: 1.4`, `letter-spacing: -0.015em`): Bus column headers (`Sumber Laptop`, `Dual-Lane Pipeline`, `Tujuan PC Kantor`).
- **Body** (`400`–`600`, `0.8125rem`, `line-height: 1.5`, `max-width: 65ch`): Directory entries, ledger rows, and status descriptions.
- **Label & Mono** (`600` label / `400` mono, `0.75rem`, `line-height: 1.2`–`1.45`): Form labels, filesystem paths, network URLs, and SHA-256 verification logs.

### Named Rules
**The Tabular Numerals Rule.** Every element displaying bytes, percentages, file counts, throughput (`MB/s`), or `ETA` must enforce `font-variant-numeric: tabular-nums` so digits never jitter during high-frequency SSE updates.

**The Machine Voice Rule.** Monospace is reserved exclusively for filesystem paths, URLs, secret tokens, and terminal logs—never as a decorative label style.

## Layout

The interface is structured inside a `1440px` maximum-width shell (`.ns-shell`) with `16px 20px 28px` padding (`10px 12px 20px` below `640px`).
1. **Top Operator Command Bar (`.ns-topbar`):** Houses brand identity on the left and inline Linux Omarchy connection controls (`URL`, `X-Nova-Token`, `Verifikasi Link`, status badge, and theme toggle) on the right.
2. **Three-Column Patch Bay (`.ns-patchbay`):** A unified `1fr 1.35fr 1fr` CSS grid divided by 1px solid hairlines (`var(--border-hairline)`), collapsing cleanly to a single column below `1180px`.
3. **Flush-Right Ledger Rows (`.ns-ledger-grid`):** File counters sit in full-width horizontal rows with labels flush-left and tabular counts locked flush-right.

## Elevation & Depth

NovaShare uses **flat tonal layering and 1px structural hairlines** with zero drop shadows (`box-shadow: none` across all panels and controls). Depth is communicated by alternating surface luminance (`--bg-canvas` `#f4f4f5` $\rightarrow$ `--bg-surface` `#ffffff` $\rightarrow$ `--bg-subtle` `#fafafa`) and crisp 1px borders.

### Named Rules
**The Zero Ghost-Card Rule.** Elevation is declared once via a 1px structural hairline (`#e4e4e7` light / `#27272a` dark). Pairing a 1px border with a soft drop shadow is prohibited.

## Shapes

- **Outer Structural Containers** (`12px` / `--radius-lg`): Top command bar and the outer three-column Patch Bay frame.
- **Interior Modules** (`8px` / `--radius-md`): Inline directory explorers, the reversed telemetry plate, the Signal Matrix frame, and the bottom log/profile drawer.
- **Interactive Controls** (`6px` / `--radius-sm`): All `shadcn/ui` buttons, inputs, selects, and directory tree row hover targets.
- **Signal Matrix Cells** (`2px`): Sharp micro-cells inside the 48-cell verification grid.
- **Status Pills & Switches** (`999px`): Connection badges and toggle switches only.

## Components

### Buttons (`.ui-btn`)
- **Shape:** Gently rounded technical corners (`6px` radius), `36px` default height (`32px` small, `40px` large, `34px` square icon button).
- **Primary (`.ui-btn--default`):** Carbon Zinc (`#18181b`) background with `#fafafa` text; hovers to `#27272a`.
- **Secondary & Outline:** `#fafafa` or `#ffffff` background with `1px solid #d4d4d8` stroke; hovers to `#e4e4e7` / `#fafafa`.
- **Transitions:** `160ms cubic-bezier(0.22, 1, 0.36, 1)` on background, border, and color.

### Inputs & Selects (`.ui-input`, `.ui-select`)
- **Style:** `36px` height, `6px` radius, `1px solid #d4d4d8` border over `#ffffff` surface (`#121215` in dark mode).
- **Focus:** `2px solid var(--ring)` (`#1d4ed8`) with `2px` outline offset.

### Inline Directory Explorer (`.ns-explorer`)
- **Structure:** Replaces popup file-picker modals with an always-visible `270px` minimum-height tree container featuring an `Induk` (parent directory) button, inline `Folder baru...` creation input, and scrollable directory rows.

### Dual-Lane Signal Matrix (`.ns-signal-grid`)
- **Structure:** A 48-cell (`16x3` desktop, `8x6` mobile) grid where each cell transitions (`180ms cubic-bezier(0.22, 1, 0.36, 1)`) between pending (`#e4e4e7`), delta-skipped (`#1d4ed8`), active in-flight (`#b45309` with `scaleY(1.2)`), and SHA-256 verified (`#047857`).

## Do's and Don'ts

### Do:
- **Do** use `lucide-react` icons at `1.75px` stroke width (`14px`–`20px`) for all actions and status indicators.
- **Do** keep Windows and Linux folder selection inline inside their respective Patch Bay columns.
- **Do** apply `.ns-tabular` (`font-variant-numeric: tabular-nums`) to every byte count, speed, percentage, and file counter.
- **Do** maintain a single outer border around the three-column Patch Bay with 1px internal dividers rather than wrapping each section in nested cards.

### Don't:
- **Don't** place kickers or uppercase eyebrow labels above headings; let headings carry their own hierarchy.
- **Don't** use emoji or Unicode symbols (`⚡`, `📁`, `🐧`) in place of Lucide vector icons.
- **Don't** introduce modal dialogs for directory browsing or routine job configuration.
- **Don't** combine 1px borders with drop shadows or glassmorphic `backdrop-filter` blurs.
