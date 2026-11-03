<div align="center">

**English** · [简体中文](docs/readme/README_zh-CN.md) · [日本語](docs/readme/README_ja.md) · [Tiếng Việt](docs/readme/README_vi.md) · [ไทย](docs/readme/README_th.md) · [Español](docs/readme/README_es.md) · [Português](docs/readme/README_pt.md)

# MCKL Transfer

</div>

Share files and chat through your own server on a LAN, or between authorized devices on an overlay network. Only the server needs Node.js; other devices use a browser. There are no MCKL cloud accounts, analytics, database or npm runtime dependencies.

**0.2.0-alpha.2 · Apache-2.0 · experimental.** Read the [validation results](docs/VALIDATION.md) and [security model](SECURITY.md) before deployment. Stable support and LAN speeds across all devices are not guaranteed.

## Quick start on a trusted network

Install a patched Node.js **24, starting at 24.22.2**, or **26, starting at 26.13.0**. From the source directory:

```sh
npm start
```

No `npm install` is needed. The terminal displays LAN addresses, a six-digit access code and a **separate administrator code**. Open the LAN address on another device, enter a device name and the access code. Give the administrator code only to the person managing the server. Codes are never exposed through the API, including on localhost.

The default HTTP connection is unencrypted: use it only on a network you control with trusted participants. Use HTTPS or a controlled overlay for other connections. Do not forward this port from your router to the Internet.

### Using the app

- Select or drag multiple files. The application-wide queue transfers up to two files at once, with speed, ETA, pause, resume, retry and cancel controls.
- After losing connectivity or reloading the page, select the same file again to resume. The device cookie must remain available and the upload must not have expired. The browser does not retain permission to read a file automatically after the page closes.
- Use **one upload tab per server**. Tabs on the same origin share cookies and resume records. If two tabs resume the same upload, cancelling in one can delete the other tab's partial progress. The source file remains safe; the other tab must restart when it receives `404`. This alpha does not coordinate upload ownership between tabs.
- Before sending, the browser reads the source to calculate SHA-256; each chunk and the completed file are checked on the host. Hashing requires an additional read and may be slow on less powerful devices. The entire file is not held in RAM.
- Completed files appear in the shared list; all signed-in members can download them. Members can delete only files they uploaded. Administrators can delete any file and revoke device sessions.
- Shared chat keeps up to 200 messages in RAM; they are lost when the host restarts. Keep the page open during transfers, especially on phones. The PWA does not guarantee background transfers or continued transfers while iOS locks the screen.

The model is **browser A → host stores the file → browser B downloads it**. “Upload complete” means the host has received and verified the file; it does not mean B has downloaded or saved it. The host can read both files and chat; there is no E2EE or recipient-specific private room.

## Language

The app interface is available in **Tiếng Việt** and **English**. Use the language selector in the top bar; your choice is saved in this browser. On first use, the app follows the browser language and falls back to English when it is unsupported. Switching languages does not reload the page or stop transfers; file contents, chat messages and device names are not translated. The README is available in seven languages through the links at the top of the page.

## Configuration

The app reads the process environment; it does not load `.env` files automatically. Sizes are in bytes and durations in milliseconds.

| Variable | Default | Meaning |
|---|---|---|
| `HOST`, `PORT` | `0.0.0.0`, `8787` | Listening interface and port; IPv4 by default |
| `SHARE_DIR` | `./shared` beside the source | Private data directory; preferably outside the repository |
| `DEVICE_NAME` | hostname | Host name, displayed only after sign-in and in the terminal |
| `SHARE_CODE` | Six random digits on each start | Member code; `LAN_SHARE_CODE` is still accepted for compatibility |
| `ADMIN_CODE` | Separate random value on each start | At least 24 characters; keep it secret |
| `MAX_FILE_SIZE` | `21474836480` (20 GiB) | Per-file limit |
| `MAX_TOTAL_SIZE` | `107374182400` (100 GiB) | Completed files plus reserved upload capacity |
| `MIN_FREE_SPACE` | `134217728` (128 MiB) | Reserved free disk space; not an OS disk quota |
| `CHUNK_SIZE` | `4194304` (4 MiB) | Maximum 16 MiB per upload-chunk request |
| `MAX_CONCURRENT_UPLOADS` | `4` | Concurrent server-side upload write/hash operations |
| `MAX_PENDING_UPLOADS` | `128` | Number of retained incomplete uploads |
| `UPLOAD_TTL_MS` | `86400000` (24 hours) | Absolute lifetime from the creation of an incomplete upload |
| `SESSION_TTL_MS`, `MAX_DEVICES` | `43200000` (12 hours), `128` | Normal session lifetime and total device sessions; remembered sessions last up to 30 days |
| `REQUEST_TIMEOUT_MS` | `1800000` (30 minutes) | Time allowed to receive one request; sockets idle for 60 seconds are disconnected |
| `TLS_KEY_FILE`, `TLS_CERT_FILE` | Unset | PEM private-key/certificate pair for direct HTTPS |
| `PUBLIC_URL` | Unset | External proxy origin, such as `https://transfer.example.org`; no path or query |
| `ALLOWED_HOSTS` | Local hostname/interfaces | Additional specific hostnames/IPs, comma-separated; no wildcards or ports |

PowerShell example using a separate data directory:

```powershell
$env:SHARE_DIR = "D:\MCKL-data"
$env:DEVICE_NAME = "Home transfer host"
npm start
```

Changing codes after a restart does not revoke existing sessions. Use the device-management panel to revoke them. If a PIN leaks, change the PIN **and** revoke untrusted sessions. Cookies and file ownership survive restarts. Signing out or deleting cookies and pairing again creates a new identity; administrators can still delete the old files.

## HTTPS and connections across networks

### Direct HTTPS

Obtain a certificate whose SAN matches the hostname/IP in use, from a CA trusted by every device. Keep the key outside the source, restrict read permissions, then configure both variables:

```sh
TLS_KEY_FILE=/secure/mckl/server.key TLS_CERT_FILE=/secure/mckl/server.pem npm start
```

Open the corresponding `https://...` URL. Do not bypass certificate-verification errors. Self-signed certificates require a trusted-channel process for installing CA trust or verifying fingerprints; the app does not automate certificate pairing. HTTPS cookies use `Secure`, `HttpOnly` and `SameSite=Strict`.

### Private groups through Tailscale or WireGuard

Install the overlay on the devices, authorize the intended members and restrict the service port. Keep MCKL authentication enabled. With WireGuard, you manage keys, routing, firewall and DNS yourself; with Tailscale, check policies and direct/relay paths. A private IP range alone does not establish that a device is trustworthy.

One HTTPS option for a tailnet is [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve). Once the host has a DNS name and HTTPS is configured in the tailnet, run MCKL on loopback only with that origin:

```sh
HOST=127.0.0.1 PUBLIC_URL=https://YOUR-HOST.YOUR-TAILNET.ts.net npm start
```

In another terminal:

```sh
tailscale serve --bg http://127.0.0.1:8787
tailscale serve status
```

Open the exact HTTPS URL supplied by Serve. This service is for the tailnet; restrict your access policy. See the [Serve CLI](https://tailscale.com/docs/reference/tailscale-cli/serve) for requirements and shutdown instructions. MCKL does not install or configure Tailscale automatically, and this release has not been tested on a real tailnet.

Other reverse proxies must forward streaming/SSE without buffering, preserve Host or set `PUBLIC_URL` correctly, configure suitable timeouts/body limits, and restrict upstream access to the trusted proxy. The app does not trust `X-Forwarded-*` to determine whether a connection is secure.

## Data, upgrades and backups

The host keeps `.mckl-manifest.json`, `.mckl-devices.json` (session-token hashes), `.mckl-uploads.json` and `.mckl-objects/` in `SHARE_DIR`. New payloads are stored by ID; display names are in the manifest. Do not edit or delete internal files while the server is running. Do not run two processes against the same `SHARE_DIR`.

Stop the host before backing up the **entire** data directory. Backups contain group files and access state and must be protected. This alpha reads legacy MVP manifests containing valid regular files; it does not automatically migrate old payloads to object storage. Only administrators can delete legacy files without an owner. Back up before upgrading; downgrades are unsupported once the new manifest format has been written.

Use only a trusted local filesystem with strict ACLs. Expired incomplete uploads are cleaned up; completed files are not deleted automatically. Network drives, cloud synchronization of the data directory, actual power loss and storage hardware have not been verified. Atomic rename/fsync does not guarantee protection against every failure.

## If another device cannot connect

Choose the LAN IPv4 URL printed in the terminal, use the same Wi-Fi and avoid guest/AP isolation. Check that the firewall opens the port only for the intended networks/devices. Check health from another machine, replacing the example address:

```sh
curl --connect-timeout 5 http://192.168.1.10:8787/api/health
```

The expected response is `{"ok":true}`. A timeout usually requires checking routing/firewall; `403` requires checking hostname/Origin and `ALLOWED_HOSTS`/`PUBLIC_URL`. Do not add a wildcard to work around the error. The browser may request permission to access the local network.

## Development, testing and releases

```sh
npm run check
npm test
npm run release:check
npm run release:source
```

The source exporter uses an explicit allowlist, checks the archive again and writes SHA-256 to `release/`. Do not zip the entire working directory. `.gitignore` does not exclude files from Finder ZIPs or remove committed data. Keep `private: true` to prevent accidental npm publication; the source remains licensed under Apache-2.0.

- [Contributing](CONTRIBUTING.md), [security](SECURITY.md), [release checklist](docs/RELEASE_CHECKLIST.md).
- [Alpha protocol](docs/PROTOCOL.md), [validation evidence and limits](docs/VALIDATION.md).
- [Architecture](docs/research/architecture.md), [performance](docs/research/performance.md), [license and roadmap](docs/research/license-and-roadmap.md).

Discovery/QR, WebRTC, user-initiated clipboard sharing, folder transfer and screen sharing are on the roadmap. Full remote desktop requires a native agent and a separate consent model; this version has no remote control.

## License

[Apache License 2.0](LICENSE). Copyright 2026 hieunguyenak92; see [NOTICE](NOTICE). Use, modification and distribution, including commercial use, are permitted under the license terms. Retain LICENSE/NOTICE and document changes as required by the applicable terms. No warranty is provided.
