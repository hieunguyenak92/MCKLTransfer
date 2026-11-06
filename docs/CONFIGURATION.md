# Configuration and operations

[English README](../README.md) · [Tiếng Việt](readme/README_vi.md) · [Protocol](PROTOCOL.md) · [Security](../SECURITY.md)

The application reads the **process environment**. It does not load `.env` files automatically. Sizes below are bytes; durations are milliseconds. Keep keys, credentials and transfer data outside the source checkout.

The supported Node.js range is `^24.22.2 || ^26.13.0`: use an updated patch release in the Node 24 or 26 branch. Node 25/27 are not included by that range. There are no npm runtime dependencies to install.

## Complete environment reference

| Variable | Default | Meaning |
|---|---|---|
| `HOST` | `0.0.0.0` | Listen on all IPv4 interfaces. Use `127.0.0.1` behind a local proxy; set `::` explicitly if needed for IPv6. |
| `PORT` | `8787` | Listening port. |
| `SHARE_DIR` | `shared/` beside `server.mjs` | Private data directory; relative values resolve from the working directory. Prefer a dedicated directory outside the checkout. |
| `DEVICE_NAME` | OS hostname | Display label for the host after approval/sign-in and in the terminal. |
| `SHARE_CODE` | Six random digits each start | Member pairing code. Exactly six digits. `LAN_SHARE_CODE` remains a compatibility alias; `SHARE_CODE` takes precedence. |
| `ADMIN_CODE` | Separate random value each start | Administrator pairing credential; at least 24 characters. Never distribute it as a member invitation. |
| `REQUIRE_APPROVAL` | Unset/off | Set exactly `1` to require host approval for newly paired member devices, including invite redemption. Administrators are approved directly. |
| `MAX_FILE_SIZE` | `21474836480` (20 GiB) | Maximum size of an uploaded file. |
| `MAX_TOTAL_SIZE` | `107374182400` (100 GiB) | Completed-file bytes plus full reserved capacity of incomplete uploads. |
| `MAX_FILES` | `10000` | Completed files plus incomplete reservations, including zero-byte files. |
| `MAX_OWNER_BYTES` | `21474836480` (20 GiB) | Completed and reserved bytes per device owner identity. |
| `MAX_OWNER_FILES` | `1000` | Completed files plus incomplete reservations per owner, including zero-byte files. |
| `MAX_OWNER_PENDING_UPLOADS` | `16` | Incomplete uploads reserved by one owner. |
| `MAX_PENDING_UPLOADS` | `128` | Incomplete uploads reserved across the host. |
| `MAX_CONCURRENT_UPLOADS` | `4` | Concurrent server write/hash operations; the browser queue independently limits active files. |
| `MAX_DOWNLOADS` | `16` | Active download streams across the host. Batch archive requests count as downloads. |
| `MAX_OWNER_DOWNLOADS` | `4` | Active download streams per device. |
| `MIN_FREE_SPACE` | `134217728` (128 MiB) | Additional free-space reserve after outstanding reservations; not a filesystem quota. |
| `CHUNK_SIZE` | `4194304` (4 MiB) | Maximum resumable request chunk. Server accepts up to 16 MiB; the shipped browser caps chunks at 8 MiB. |
| `UPLOAD_TTL_MS` | `86400000` (24 hours) | Absolute partial-upload lifetime from creation. Pausing does not restart this clock. |
| `SESSION_TTL_MS` | `43200000` (12 hours) | Normal device session lifetime. “Remember this device” selects a 30-day lifetime. |
| `MAX_DEVICES` | `128` | Maximum retained active device sessions, including pending devices. |
| `REQUEST_TIMEOUT_MS` | `1800000` (30 minutes) | Time allowed to receive one request. Header timeout is at most 30 seconds; idle sockets are closed after 60 seconds. |
| `TLS_KEY_FILE` | Unset | PEM private key for direct HTTPS; configure together with `TLS_CERT_FILE`. |
| `TLS_CERT_FILE` | Unset | PEM certificate/chain for direct HTTPS; hostname/IP SAN must match the address clients use. |
| `PUBLIC_URL` | Unset | Canonical HTTP(S) origin behind a proxy, for example `https://transfer.example.org`; no path, query, fragment or embedded credentials. |
| `ALLOWED_HOSTS` | Local hostname and current local interfaces | Comma-separated additional explicit hostnames/IPs. No wildcards, URL scheme or port. |
| `ICE_SERVERS` | `[]` | JSON array of optional WebRTC ICE server settings. No external STUN/TURN service is used by default. See below. |
| `MAX_DIRECT_TRANSFERS` | Not currently configurable | Direct broker bounds 128 active sessions and 8 active sessions per owner/recipient. |

Invalid configuration fails startup. Raising only `MAX_FILE_SIZE` may still leave an upload blocked by owner, total-size, count or physical free-space limits. Increasing `CHUNK_SIZE` can increase memory, retransmission cost and pause latency; measure the actual client/host path first.

### Limits controlled by protocol or UI

These are current product defaults, rather than environment variables:

- The upload tab lease lasts **30 seconds** and is renewed by active operations. A different tab must claim the upload; it cannot steal a lease while an operation is busy.
- The UI has up to **two active hub file workers**, with a bounded queue. Selecting a folder does not bypass file-count or queue limits.
- The UI file list requests pages of up to **100 files**. Batch TAR downloads accept up to **100 distinct file IDs**.
- Completed files are kept by default. UI retention choices are one hour, one day and seven days; the API accepts up to 30 days. Retention starts on completion. Cleanup is periodic, so expiry is not a secure-erasure guarantee.
- Transfer history retains up to **1000 metadata events** for **seven days**; visibility follows the file/room scope. Chat keeps up to **200 messages** of at most **4000 codepoints**, in RAM only.
- Invitations default to **10 minutes** in the UI, are single-use and are held only in memory. The API allows a lifetime from one second to one hour. A restart invalidates outstanding invites.
- Custom rooms are bounded to **100**, with up to **128 member IDs** each. Administrators manage membership.
- Direct sessions have a **30-minute** broker lifetime. WebRTC is optional and experimental; see the protocol for signaling/resource bounds.

## Start with a separate data directory

macOS/Linux:

```sh
SHARE_DIR=/path/to/mckl-data DEVICE_NAME="Home transfer host" REQUIRE_APPROVAL=1 npm start
```

PowerShell:

```powershell
$env:SHARE_DIR = "D:\MCKL-data"
$env:DEVICE_NAME = "Home transfer host"
$env:REQUIRE_APPROVAL = "1"
npm start
```

The console displays member and administrator codes. Protect terminal scrollback and service logs. Changing the codes does **not** revoke existing sessions; revoke unwanted devices in the admin panel as well. Logging out or deleting the cookie ends that owner's continuity; signing in again may create a new owner identity.

The default shared space allows approved group members to read shared files/chat. Private inbox access is limited to sender, recipient and host administrator. Rooms restrict other readers by current room membership, while the sender retains access to their own files. These are server-side access rules, not E2EE against the host.

## HTTPS

HTTP LAN is an unencrypted option for trusted networks. For trusted HTTPS, obtain a certificate whose SAN matches the exact hostname/IP and whose CA every client trusts. Store the key outside the checkout with restricted permissions:

```sh
TLS_KEY_FILE=/secure/mckl/server.key TLS_CERT_FILE=/secure/mckl/server.pem npm start
```

Open the corresponding `https://` address. Do not bypass certificate errors. A QR invitation does not install CA trust or allow JavaScript to pin an arbitrary TLS certificate. HTTPS sessions use `Secure`, `HttpOnly` and `SameSite=Strict` cookies.

### A controlled network across locations

Tailscale/WireGuard can make the host reachable by your authorized devices across networks. Configure the overlay, access policy, routing and firewall separately; MCKL does not install them. Keep MCKL authentication enabled and restrict access to the intended service port. Do not expose the default HTTP port through router port forwarding.

For example, after enabling the required DNS/HTTPS features in your tailnet, [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve) can proxy a loopback-only host:

```sh
HOST=127.0.0.1 PUBLIC_URL=https://YOUR-HOST.YOUR-TAILNET.ts.net npm start
```

In another terminal:

```sh
tailscale serve --bg http://127.0.0.1:8787
tailscale serve status
```

Use the exact HTTPS origin returned by Serve and apply a restrictive tailnet policy. See the [Serve CLI reference](https://tailscale.com/docs/reference/tailscale-cli/serve) for setup and shutdown. An overlay can use direct or relay paths; inspect the actual route before interpreting a speed result.

Other reverse proxies must pass streaming uploads/downloads and SSE without response buffering, preserve the expected Host or use `PUBLIC_URL`, set suitable body/time limits, and restrict upstream access to the trusted proxy. The application does not trust `X-Forwarded-*` for security decisions. `PUBLIC_URL` describes your deployment; it does not create TLS itself.

## Experimental direct transfer and ICE

Both browsers must have WebRTC and a secure context—HTTPS or localhost. The receiver also needs a disk-writing file picker such as `showSaveFilePicker`, typically supported by desktop Chromium. Ordinary `http://192.168...` LAN pages are not secure contexts. Hub downloads remain the compatibility path for unsupported receivers.

The users explicitly accept the transfer, compare the matching session code through a trusted channel and confirm on both ends. This checks the session transcript; the host still serves the JavaScript and must be trusted. The host carries signaling; WebRTC carries the file bytes. Network changes or browser closure can interrupt the direct session; do not assume hub resume semantics apply to direct transfers.

`ICE_SERVERS=[]` avoids external rendezvous services by default. For connections requiring NAT traversal, you can configure your own STUN/TURN service:

```sh
ICE_SERVERS='[{"urls":"stun:stun.example.net:3478"},{"urls":"turn:turn.example.net:3478","username":"TEMP-USER","credential":"TEMP-CREDENTIAL"}]' npm start
```

These are placeholders. Use a service you operate or trust, limit its credentials and bandwidth, and account for TURN traffic costs. Approved browser clients receive the configured ICE settings, including any credentials they need; do not reuse unrelated long-lived credentials. A relay is still an extra network hop. Candidate statistics determine the displayed route when available; connection success alone is not proof of a direct path.

Direct failure does not automatically upload the file to the hub. The sender may explicitly choose the hub fallback, which changes where the file is stored. Keep both pages open and keep enough disk space for the receive target.

## Data, upgrades and recovery

The data directory contains payload objects, file/upload manifests, session and revocation state, room/history metadata and the single-writer lock. Protect the **whole directory**, not just visible filenames. The current internal names include:

```text
.mckl-objects/
.mckl-manifest.json
.mckl-uploads.json
.mckl-devices.json
.mckl-revocations.json
.mckl-sessions-active.json
.mckl-sharing.json
.mckl-lock/
```

1. Stop the host cleanly with Ctrl+C or the service manager's graceful stop.
2. Back up the entire data directory while the host is stopped. Backups contain files and access state; protect them like the host.
3. Update the source and restart with the same `SHARE_DIR`. Do not run old and new versions against the directory simultaneously. Downgrades after new metadata is written are unsupported.
4. Reload connected browsers. If an old cached shell persists, hard-refresh after reconnecting; preserve cookies if you need existing upload ownership.

Legacy valid shared files can be read without automatically converting their payload layout. Existing shared files are not silently made recipient-private. Completed-file retention only applies when a retention policy was selected.

### Clean restart versus an unclean stop

A clean shutdown removes the active-session marker and preserves valid device identities. After a crash, forced termination or failed session persistence, recovery fails closed: old sessions are invalidated and devices pair again. Newly paired devices have new owner IDs, so old room membership, inbox access and pending upload ownership do not automatically move to them.

Sign in as administrator to retrieve/re-share old completed files and update room membership. Pending uploads owned by the old identity may need to expire and be uploaded again; there is no general identity-reassignment command. Do not edit session journals to bypass this protection.

### Storage locks

Only one host may write a data directory. A lock with an owner on this machine whose process is demonstrably dead can be reclaimed. A lock with a live/reused PID, another hostname or malformed/ambiguous metadata is refused with `STORAGE_LOCKED`.

If automatic recovery is refused, stop every possible host instance, confirm no process is using the directory, and take a backup before inspecting the lock. Never remove `.mckl-lock/` merely because a second host cannot start. Use trusted local storage; network shares and cloud-sync folders do not provide the same tested assumptions.

Metadata uses atomic operations and sync where supported. This does not certify storage hardware or every filesystem against power loss. Expiry and deletion cannot erase copies already downloaded, backups or every SSD remnant.

## Connection checks

Use the LAN address printed by the host, the same intended network and an appropriate firewall rule. Guest Wi-Fi/AP isolation or VLANs may block client-to-client access. From another device, replace this example address:

```sh
curl --connect-timeout 5 http://192.168.1.10:8787/api/health
```

Expected: `{"ok":true}`. A timeout points toward routing/firewall/listening-interface problems. A `403` requires checking Host/Origin and your explicit `ALLOWED_HOSTS`/`PUBLIC_URL`; do not replace them with a wildcard. Browsers may request local-network permission.

The in-app network check creates a temporary synthetic transfer, verifies returned bytes and attempts to remove it. It measures that browser-to-host route, not total Wi-Fi capacity or a browser-to-browser direct transfer. Use the [validation record](VALIDATION.md) and benchmark commands to distinguish local loopback, real LAN, TLS and relay results.
