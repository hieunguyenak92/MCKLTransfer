# Approved implementation plan: 0.3 → 0.5

Approved by the maintainer on 2026-11-06. Target final release: `0.5.0` (experimental browser direct transport is labelled separately). Preserve Apache-2.0, Vietnamese/English UI and seven README languages.

1. **Storage and identity foundation (0.3):** single-writer lock; idempotent completion/status; server upload leases; count/owner quotas; durable revoke and active request interruption; reconnect snapshots; bounded prefetch, retry and phase measurements. Add regression tests before integration.
2. **Private sharing (0.4):** expiring single-use invites/QR; optional host device approval; room and recipient authorization applied to every read/event; bounded search/pagination/history; folder paths and streamed batch download; retention. Preserve legacy shared files and document migration/backup.
3. **Direct transfer (0.5):** authenticated signaling, explicit accept, compare-and-confirm DTLS transcript code at both ends before payload, bounded transfer with disk sink, integrity and receipt; actual route diagnostics; explicit hub fallback. No hidden remote relay or full-file memory buffering.
4. **Verification:** full test suite and new fault/security tests, real browser direct/host flow, source/export/privacy checks, before/after synthetic benchmark. A physical LAN benchmark requires a second physical device; record actual coverage without substituting loopback.
5. **Publication:** rewrite all README versions around verified capabilities, update protocol/config/security/changelog, commit and push reviewed changes, check GitHub CI, publish latest version/source artifact as appropriate. Do not bypass branch protection to force merge.

## Ownership

- Storage agent: `lib/file-store.mjs`, `lib/storage-lock.mjs`, storage upgrade tests.
- Identity agent: `lib/sessions.mjs`, `lib/sharing.mjs`, identity/sharing tests.
- Direct agent: `lib/direct.mjs`, `public/direct.js`, direct tests.
- Parent: HTTP integration, frontend/VI-EN, folder archive/QR, validation, documentation and publication.

## Constraints and risks

The host remains trusted and can read hub files. Browser code served by a compromised host is not protected by a displayed pairing code. Direct receiving requires a supported disk-streaming API and secure context; unsupported devices get an explicit hub path. Revocation cannot retract delivered bytes. Client lifecycle/mobile background, TURN availability, filesystem power-loss durability and physical LAN performance must be stated according to evidence. README copy may be persuasive, but must not invent speed/security/platform guarantees.
