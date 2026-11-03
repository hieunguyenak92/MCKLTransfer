# Changelog

## Unreleased

### Changed

- Place the English README at the repository root and translations in `docs/readme/`, with centered language links above each title and the current language highlighted.

## 0.2.0-alpha.2 — 2026-11-04

### Added

- Complete English, Japanese, Spanish, Portuguese, Thai and Simplified Chinese README translations, with a shared language navigation.
- Vietnamese/English app selector, browser-language detection and a local saved preference. Switching updates UI, errors, accessible labels, dates and installation metadata without reloading or interrupting transfers.
- Local translation catalogs and offline caching; no external translation service or new runtime dependency.

### Fixed

- Cached shells from an earlier version show a bilingual recovery message and manual reload control when they cannot safely load the current client.

## 0.2.0-alpha.1 — 2026-11-04

### Added

- Resumable bounded-chunk uploads with source, chunk and final SHA-256 checks; durable offsets, ownership, expiry, cancellation and quota reservations.
- Application-wide two-worker browser queue, pause/resume/retry/cancel, speed/ETA and incremental hash worker.
- Separate peer/admin roles, persisted device sessions, logout and device revocation; SSE session expiry and resource bounds.
- Optional trusted HTTPS and explicit reverse-proxy origin/host configuration.
- Total-storage, free-space, concurrency, pending-session and request limits.
- Apache-2.0 license, public NOTICE, clean source exporter, manifests/checksums and CI for Windows/macOS/Linux on Node.js 24/26.

### Fixed

- Infinite filename-collision loop, metadata namespace overwrite and unhandled upload stream failures.
- Loopback PIN disclosure, unvalidated Host/Origin and symlink payload downloads.
- Logout unable to remove an HttpOnly cookie and SSE continuing past session expiry.
- Concurrent metadata updates, interrupted-upload recovery and visibility before durable commit.
- Browser worker stalls on file-list refresh failure and unbounded queue/chat growth.
- Duplicate pending-upload ownership within a tab and repeated Cancel requests racing their final state. Distinct files with the same name/size/timestamp keep separate resume records.

### Scope

Host-mediated shared file/chat alpha. No E2EE, per-recipient rooms, native discovery, guaranteed mobile background transfer or remote desktop. Tests, benchmarks and verification limits: [docs/VALIDATION.md](docs/VALIDATION.md).

## 0.1.0

- Initial HTTP streaming LAN transfer and in-memory text chat MVP.
