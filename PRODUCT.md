# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Bun + TypeScript backend (Dual-Role Sender & Receiver HTTP binary stream engine) with a React + Tailwind CSS + shadcn/ui + `lucide-react` single-page operator console bundled directly into the local Sender server (`localhost:7650`) and standalone executables.

## Users

Software engineers and technical office workers carrying a Windows work laptop who back up large working datasets (hundreds of gigabytes of VM images, raw video, database dumps) alongside hundreds of thousands of small project files to a dedicated Linux Omarchy workstation on the office network.

## Product Purpose

NovaShare provides unattended, corruption-proof, resumable one-way backup from a Windows laptop to a Linux Omarchy office PC over unstable office Wi-Fi or Tailscale P2P mesh, preserving a 1:1 native folder structure on the Linux filesystem so files are immediately usable without archive extraction.

## Positioning

A Dual-Lane transfer pipeline that simultaneously packs thousands of small files (`< 8 MB`) into in-memory micro-batches to eliminate Wi-Fi round-trip overhead while streaming multi-hundred-gigabyte files in SHA-256 verified `8 MB` byte-offset chunks with instant `.novapart` resume and remote Linux directory exploration.

## Operating Context

Used at an office desk under daylight/fluorescent office lighting (with dark workstation toggle) over shared office Wi-Fi or remotely over Tailscale VPN. Sessions span minutes to hours, during which Wi-Fi drops, laptop lid closures, or bandwidth contention during work calls are normal events that must auto-recover without manual intervention.

## Capabilities and Constraints

- Token-authenticated (`X-Nova-Token`) unattended connection to the Linux Omarchy Receiver daemon.
- Remote Linux directory browser with folder creation (`mkdir`) and real-time partition free-space inspection (`statfs`).
- Pre-flight Delta Sync (`size` + `mtime` comparison) to skip unchanged files in milliseconds and Smart Ignore filters (`node_modules`, `.git`, `vendor`).
- Lane A (Micro-Batching `< 8 MB`) and Lane B (`8 MB` Chunk Streaming with `.novapart` + `.novapart.meta.json` state).
- Live Server-Sent Events (SSE) telemetry: throughput (`MB/s`), ETA, active lane, chunk index, file counters, and verification log.
- Saved Backup Profiles (`Source Windows Path -> Destination Linux Path`) and on-the-fly bandwidth throttling (`MB/s` cap) + worker concurrency.
- Low memory footprint (`< 150 MB` RAM even on 500 GB files).

## Brand Commitments

- **Component & Icon System:** Built with `shadcn/ui` primitives and `lucide-react` icons.
- **Anti-Slop Commitment:** Strict rejection of generic AI-generated dark neon/purple glassmorphism clichés; high-craft light-default utility interface with a crisp dark mode toggle, tabular numerals, 1px structural hairlines, and unambiguous operational state indicators.

## Evidence on Hand

- Working Receiver Daemon (`src/receiver/`), Sender Engine (`src/sender/`), Shared Binary Codec & SHA-256 Verifier (`src/shared/`), and automated test suite (`tests/`).
- Product Requirements Document (`prd.md`) and documentation (`README.md`).
- No commercial pricing, external customer testimonials, or cloud hosting claims exist and none may be fabricated.

## Product Principles

1. **Zero Silent Corruption:** Every byte written to the Linux disk is cryptographically verified per chunk or micro-batch before atomic rename.
2. **Interruptions Are Routine:** Wi-Fi drops and laptop sleep pause the pipeline cleanly and resume from the exact `8 MB` chunk index when connectivity returns.
3. **Native Filesystem Honesty:** Backed-up folders remain ordinary, directly inspectable directories on Linux Omarchy, never opaque proprietary archives.
4. **Operational Clarity Over Decoration:** Every pixel in the operator console reports real filesystem paths, disk capacity, lane activity, or transfer physics.
