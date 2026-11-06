# Security policy

## Supported scope

`0.5.0` is an experimental security release. There is no guaranteed response time. Use patched Node.js 24 (at least 24.22.2) or 26 (at least 26.13.0). See [validation evidence](docs/VALIDATION.md), [protocol](docs/PROTOCOL.md) and [configuration](docs/CONFIGURATION.md).

## Trust boundary

- Use a network you control. Plain HTTP exposes codes, cookies and file content to observers. Configure trusted HTTPS or a restricted encrypted overlay before using a network you do not control. Do not expose the service directly to the public Internet.
- The host can read every file and chat message stored through the hub. Rooms and inboxes restrict approved users at the application layer; they do not provide end-to-end encryption against the host.
- Direct WebRTC transfers keep file bytes off the hub when the connection is direct, but the browser application and signaling host remain part of the trust model. The confirmation code authenticates the session transcript after both users compare it; it is not permanent device identity or protection from a compromised host.
- The separate administrator code grants device, room, invitation and file-management access. Keep it private. Enable `REQUIRE_APPROVAL=1` when every new member needs host approval.
- Logout and revocation prevent subsequent requests and terminate active session work where the host can abort it. Bytes already delivered cannot be recalled.
- A single-use invitation is short-lived and high-entropy. Treat its URL as a credential until it is redeemed or expires. Do not paste it into public channels.
- Use a dedicated local data directory with restrictive OS permissions and one host process. The storage lock rejects concurrent writers. Quotas are application checks, not a replacement for OS storage limits.
- Keep data directories, backups, logs, environment files, keys and real screenshots out of source/release artifacts. The exporter does not inspect unrelated Git history or arbitrary third-party installers.
- Keep browser pages open for hub transfers. PWA caching does not guarantee background uploads, iPhone lock-screen transfers or delivery while the host is off. Direct receiving requires HTTPS/localhost and a browser with a streaming file sink; unsupported devices should use hub sharing.
- Uploaded content is stored as attachments and is not executed or previewed by the host UI. If you add previews, archive extraction or malware scanning, keep those paths isolated and bounded.

## Reporting a vulnerability

Maintainer: **hieunguyenak92**. GitHub Private vulnerability reporting is enabled. Report security issues through the [private vulnerability reporting form](https://github.com/hieunguyenak92/MCKLTransfer/security/advisories/new), which requires a GitHub account. Do not post credentials, personal files or sensitive exploit details in public issues.

Use synthetic data; include affected version, OS/runtime/browser, reproduction steps and impact. Never attach someone else's files, access codes, raw session tokens or private keys.
