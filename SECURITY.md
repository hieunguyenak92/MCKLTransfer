# Security policy

## Supported scope

`0.2.0-alpha.1` is experimental. There is no stable security release or guaranteed response time. Use patched Node.js 24 (at least 24.22.2) or 26 (at least 26.13.0). See [validation evidence](docs/VALIDATION.md) and the [historical audit](docs/research/security-audit.md).

## Trust boundary

- Use a network you control with mutually trusted participants. HTTP exposes traffic, codes and cookies to anyone able to observe the path. Configure trusted HTTPS or a restricted encrypted overlay; do not expose the application directly to the public Internet.
- The host can read every file and chat message. All authenticated members can list/download all files and read shared chat. There is no E2EE, recipient isolation or application encryption at rest.
- Peers may delete their own files. A separate administrator code grants deletion of all files and device-session management. Do not share it with ordinary members.
- Sessions use random HttpOnly cookies and persisted token hashes. Logout/revocation invalidates future requests and closes SSE; it cannot recall downloaded data. Previously authorized operations may already have completed. Changing a code or restarting the host does not revoke existing sessions. Revoke affected sessions after a code leak.
- Someone with the current member code can pair again after revocation. Change the code as well when excluding someone. This is not public-key device pairing or protection from a compromised host/browser.
- Use a dedicated local data directory with restrictive OS permissions and one server process. Do not allow untrusted local writers, network-share semantics or cloud sync to alter internal state. Quotas are application checks, not a replacement for OS storage limits.
- Keep data directories, backups, logs, environment files, keys and real screenshots out of source/release artifacts. The exporter does not inspect unrelated Git history or arbitrary third-party installers.
- Keep the browser open for transfers. Mobile/background behavior and real multi-device throughput need device-specific verification. No remote control, shell execution or preview of uploaded active content is provided.

## Reporting a vulnerability

Maintainer: **hieunguyenak92**. Repository security settings are still pending final publication verification. Until a private reporting channel is confirmed here, do not post credentials, personal files or sensitive exploit details in public issues.

After the maintainer enables GitHub Private vulnerability reporting, use the repository's **Security → Report a vulnerability** form. Use synthetic data; include affected version, OS/runtime/browser, reproduction steps and impact. Never attach someone else's files, access codes, raw session tokens or private keys.

This policy must be updated with the verified reporting URL before the release announcement.
