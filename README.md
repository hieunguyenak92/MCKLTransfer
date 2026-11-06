<div align="center">

**English** · [简体中文](docs/readme/README_zh-CN.md) · [日本語](docs/readme/README_ja.md) · [Tiếng Việt](docs/readme/README_vi.md) · [ไทย](docs/readme/README_th.md) · [Español](docs/readme/README_es.md) · [Português](docs/readme/README_pt.md)

# MCKL Transfer

### Your devices. Your files. Your way across.

Move a folder from your laptop. Leave a file for someone offline. Send directly to a nearby browser. Keep the server—and the choices—in your hands.

**Self-hosted · Browser clients · Resumable transfers · Private inboxes · Experimental WebRTC**

[Get the source](https://github.com/hieunguyenak92/MCKLTransfer/releases/latest) · [Quick start](#up-and-sharing) · [Configuration](docs/CONFIGURATION.md) · [Star on GitHub](https://github.com/hieunguyenak92/MCKLTransfer)

</div>

MCKL Transfer turns one computer into a file-sharing space for your own devices and a small trusted group. Run the host, open its address on another device, and start sharing. Other devices need a browser; the host needs Node.js. No MCKL cloud account, analytics or npm runtime installation.

**Version 0.5.0 · Apache-2.0.** Hub sharing works through HTTP(S); direct browser transfer is an experimental capability with specific browser requirements. See [validation](docs/VALIDATION.md) for what has actually been tested.

## Built for the moments between devices

| What you need | What MCKL gives you |
|---|---|
| “Get this file onto my other device.” | Drag-and-drop uploads, progress, speed, ETA, pause, retry and resumable chunks. |
| “They can collect it later.” | The hub stores the file; the recipient can download while the host remains available. |
| “Only send this to Alex.” | A recipient inbox or a room with selected members; access is checked by the server. |
| “Let this device join.” | A locally generated QR/link, single-use and expiring, with optional host approval. |
| “Move a whole project folder.” | Folder selection preserves relative paths; download selected files as a streamed `.tar` archive. |
| “Send browser to browser.” | Optional WebRTC, explicit receive acceptance, a matching confirmation code and a disk-writing receiver. |
| “Know what happened.” | Scoped transfer history, optional verified-save receipts and direct/relay route information. |
| “Keep the host manageable.” | Per-device byte/count quotas, download limits, expiry, device revocation and a single-writer storage lock. |

The default file limit is **20 GiB**, configurable by the host. Large hub transfers use bounded chunks rather than keeping the complete file in server memory. Source, chunk and completed-upload SHA-256 checks help detect corruption. Completion can be retried without publishing a duplicate; upload leases coordinate ownership across tabs.

## Up and sharing

Use a patched **Node.js 24 ≥24.22.2** or **26 ≥26.13.0** (`^24.22.2 || ^26.13.0`).

```sh
git clone https://github.com/hieunguyenak92/MCKLTransfer.git
cd MCKLTransfer
npm start
```

No `npm install` step is needed.

1. Read the LAN address and access code printed in the terminal.
2. Open that address on another device, name the device and enter the six-digit code.
3. Choose the shared space, a private inbox recipient or a room. Drop files, choose a folder or send a chat message.

The terminal also prints a **separate administrator code**. Use it to manage devices, create rooms and generate invitations; keep it private. Enable approval for new member devices with:

```sh
REQUIRE_APPROVAL=1 npm start
```

In the admin panel, generate a **10-minute invitation** and scan its QR code on the other device. Each invitation is usable once; pending devices wait for the administrator when approval is enabled. Invites are generated locally and disappear when the host stops.

**Default HTTP sends credentials and file content without encryption.** Use it only on a trusted network. Configure trusted HTTPS for sensitive use and direct transfer; use a controlled Tailscale/WireGuard network for access across networks. [Deployment examples and all settings →](docs/CONFIGURATION.md)

## Two useful ways to move a file

### Leave it on your hub

Upload once and let the recipient collect it later. The host must stay available for downloads. Search the current space, select files for a batch archive, and choose automatic expiry when the file does not need to remain.

After a lost connection or a page reload, select the **same original file** to resume the confirmed portion. Keep the device cookie and resume record; the partial upload must still be valid. A tab currently holding an upload lease blocks another tab from editing it until it releases the lease or becomes eligible for takeover. Keep the page open during transfer, especially on phones.

Shared space is readable by approved members. Private inbox files are readable by the sender, recipient and host administrator; custom rooms restrict other members by room membership. **The host is trusted and can read hub files and chat.** These access controls do not provide end-to-end encryption against the host.

### Send directly when both devices are online

Select a recipient and choose **Send directly with WebRTC**. The receiver accepts and chooses a destination. Compare the confirmation code shown on both devices through a trusted channel, then both users confirm before file content is sent.

The receiver writes chunks to disk and verifies the digest. The UI reports the observed WebRTC route when browser statistics provide it; a configured TURN relay may carry encrypted traffic when a direct route is unavailable. No external STUN/TURN service is configured by default.

**Requirements:** HTTPS or localhost, WebRTC and a receiver supporting `showSaveFilePicker`—typically desktop Chromium browsers. Ordinary HTTP LAN addresses are not secure contexts. Safari/mobile devices can use hub sharing; direct receiving is not promised there. If a direct transfer fails, the sender can explicitly choose hub fallback, which stores a copy on the host. Fallback is never a silent change in storage policy.

The confirmation code verifies this session's peer connection when users compare it. It does not protect a client served by a compromised host or establish a permanent device identity.

## A few details that make sharing better

- **Folders and batches:** relative paths are validated; storage uses internal IDs. Batch downloads stream a TAR archive, up to 100 selected files per request. Empty directories are not represented.
- **Retention:** keep a file or select one hour, one day or seven days in the UI. Expired files become unavailable and cleanup runs on the host. History is bounded separately.
- **Honest delivery status:** upload completion means the host verified the file. A normal browser download does not prove the OS saved it; supported browsers offer a verified-save action with a receipt.
- **Your language:** switch between **Tiếng Việt** and **English** without reloading the page. The README is available in seven languages above.
- **Your network:** an in-app transfer check measures the current browser-to-host path. Reported speeds depend on the devices, disk, hashing, Wi-Fi and route; there is no universal “fastest” setting.

Chat retains up to 200 messages in host memory and is cleared on restart. The PWA caches the application shell; it does not guarantee background uploads, iPhone lock-screen transfers or offline delivery while the host is off. MCKL Transfer does not control another device's desktop.

## Operate it with confidence

Store data on a trusted local filesystem, preferably outside the checkout. **Stop the host cleanly and back up the entire data directory before upgrading.** New metadata is not intended for downgrade to old versions. Existing shared files remain shared; private rooms are created explicitly.

Clean restarts preserve valid sessions and ownership. After an unclean stop, session recovery fails closed and devices must pair again; re-pairing creates new owner identities. Old private inbox items and uploads may require administrator recovery. Protect the backup and administrator code accordingly.

The storage lock prevents two hosts from writing the same directory. Proven-dead local owners can be recovered; an ambiguous or damaged lock is refused. Never remove a lock while a host may still be running. See [configuration and recovery](docs/CONFIGURATION.md#data-upgrades-and-recovery).

If an upgrade shows a recovery screen or an older layout, reconnect to the host and reload; use a hard refresh if the old application shell persists. Do not clear cookies casually when you need to resume uploads.

## Build with us

```sh
npm run check
npm test
npm run release:check
npm run release:source
```

The exporter builds an allowlisted source archive and SHA-256 files in `release/`. Avoid zipping the working directory with runtime data or credentials.

[Contributing](CONTRIBUTING.md) · [Security reporting](SECURITY.md) · [Protocol](docs/PROTOCOL.md) · [Validation](docs/VALIDATION.md) · [Upgrade research](docs/research/upgrade-audit-2026-11.md)

If MCKL Transfer saves you a cloud upload or a hunt for a cable, **[give it a star](https://github.com/hieunguyenak92/MCKLTransfer)**. Share a reproducible issue, a browser result or an improvement—help make moving between devices feel effortless.

## License

[Apache License 2.0](LICENSE), copyright 2026 hieunguyenak92. Commercial use, modification and redistribution are permitted under its terms; retain required notices. The bundled QR generator is MIT-licensed; see [NOTICE](NOTICE). No warranty is provided.
