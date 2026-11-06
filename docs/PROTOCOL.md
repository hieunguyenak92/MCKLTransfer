# MCKL Transfer HTTP protocol

Protocol version `0.5.0`, project-specific. It is **not tus-compatible**. This document describes the current server routes and the browser-facing contract; error messages and optional fields can evolve before stable release.

Requests must use an allowed `Host` and same-origin `Origin`. API responses use `Cache-Control: no-store`. JSON endpoints require `Content-Type: application/json` and an object body. Binary upload bodies are streamed; no multipart or base64 is required.

## Trust and identity

The host is a trusted storage and policy authority. HTTPS or a private overlay protects transport; it does not prevent the host from reading hub files/chat or replacing the browser application. A six-digit member code is a bootstrap credential. The separate administrator code manages devices, rooms, invitations and all files. Do not forward the default HTTP port to the public Internet.

`POST /api/auth` accepts `{code,deviceName,rememberDevice}`. The server sets an `HttpOnly; SameSite=Strict` cookie and adds `Secure` for HTTPS. A normal session lasts 12 hours; `rememberDevice:true` lasts 30 days. Raw bearer tokens are stored only as hashes in the device journal. API clients may send the issued token as `Authorization: Bearer …`; browsers use the cookie.

With `REQUIRE_APPROVAL=1`, a member code or invitation creates a pending device. Its cookie can query limited config, but member API access waits for `POST /api/devices/:id` by an administrator. Administrators are approved immediately. `GET /api/devices` returns public device metadata only; `DELETE /api/devices/:id` revokes the device, closes SSE, aborts tracked requests and cancels its direct sessions. `POST /api/logout` revokes the current session.

A clean host shutdown removes the active-session marker and preserves valid identities. An unclean stop or failed session persistence fails closed and requires re-pairing; new owner IDs do not automatically inherit old room membership or private-inbox upload ownership. See [configuration and recovery](CONFIGURATION.md).

## Public and authenticated endpoints

- `GET /api/health` → `{ok:true}`. It does not authenticate.
- `GET /api/config` returns version, limits, secure-context status and protocol features. Authenticated approved sessions also receive the host origin/address, role, permissions, storage usage for administrators, and ICE server configuration. Pending devices do not receive the full host configuration.
- `GET /api/events` opens an SSE stream. Events are `ready`, `files`, `chat`, `scope` and `direct`; streams close on expiry, logout or revoke. Maximum four streams per session and 128 total; slow readers are disconnected. Reconnect must reload authoritative files/messages because events are notifications, not a replay log.
- `GET /api/peers` returns approved peer IDs/names for recipient selection.
- `GET /api/history?before=<epoch-ms>` returns up to 100 scoped metadata events. History is bounded and expires; it never contains payload bytes or tokens.

## Spaces, recipients and invitations

Every file/message has `roomId` (`shared`, `inbox` or a 24-hex custom room) and optional 16-hex `recipientId`.

- `shared`: approved members can read; the owner and administrator can manage according to the file route.
- `inbox`: a recipient is required; only sender, recipient and administrator can read.
- custom room: current approved members can read; administrators manage membership.

The owner can read their own resource. The host administrator can read all hub resources. The server applies these rules to list, download, batch archive, events, history and receipts; UI hiding is not the authorization boundary.

`POST /api/invites` (administrator) creates a locally generated high-entropy invitation. The UI uses a 10-minute QR/link; API lifetime is at most one hour. `GET /api/invites` lists status without returning tokens. Invitations are single-use, in-memory and invalidated on host restart. The invitation is supplied as `{invite,code?,deviceName,rememberDevice}` to `/api/auth`; it never contains the administrator code.

`GET /api/rooms` lists spaces visible to the session. `POST /api/rooms` and `PATCH /api/rooms/:id` are administrator-only and accept a name plus approved member IDs. Membership changes broadcast `scope` and abort affected active streams. `POST /api/messages` accepts `{text,roomId,recipientId}` with 4,000 codepoints and 60 messages/minute/identity; `GET /api/messages` returns only scoped messages. Up to 200 messages remain in RAM and are lost on restart.

## Resumable hub uploads

The resumable API is a project-specific offset protocol with server leases, integrity checks and idempotent completion.

### Create and inspect

`POST /api/uploads` with:

```json
{
  "name": "report.pdf",
  "size": 1048576,
  "mime": "application/pdf",
  "sha256": "64 lowercase hex characters",
  "roomId": "shared",
  "recipientId": null,
  "relativePath": "optional/folder/report.pdf",
  "retentionMs": 0,
  "clientId": "32 lowercase hex characters"
}
```

`roomId`/`recipientId` are checked against the current session. `relativePath` is display/archive metadata, not a filesystem path; traversal, control characters, reserved names and excessive depth are rejected. `retentionMs` is zero or at most 30 days. `clientId` identifies a browser tab lease and is not an authentication credential.

Response `201` returns `{id,state:"pending",offset,size,chunkSize,expiresAt,leaseExpiresAt,roomId,recipientId,relativePath}`. IDs are 24 lowercase hex. The server reserves full size and applies total, count, owner, pending and free-space limits. Incomplete uploads expire absolutely after 24 hours by default.

`HEAD /api/uploads/:id` returns durable headers `Upload-Offset`, `Upload-Length`, `Upload-State` and `Upload-Expires`. `GET /api/uploads/:id` returns the same status as JSON. After a successful commit, status is `{state:"complete",offset:size,size,file}` for the owner; it remains idempotent until the file is deleted or expires. A foreign or missing ID returns `404`.

### Claim, append, complete and cancel

- `POST /api/uploads/:id/claim` with `{clientId}` obtains/renews the 30-second tab lease. A live lease held by another tab returns `409 UPLOAD_CLAIMED`; a busy operation cannot be stolen. `POST /api/uploads/:id/release` releases the caller's lease.
- `PATCH /api/uploads/:id` sends up to `chunkSize` raw bytes with `Upload-Offset`, `X-Chunk-SHA256` and optional `Upload-Client`. The server checks ownership, lease, persisted room/recipient policy, offset, chunk digest, request signal and disk durability before returning `204 Upload-Offset`. Failed or interrupted chunks roll back to the durable offset.
- `POST /api/uploads/:id/complete` verifies the full file SHA-256 and size, checks the persisted scope again immediately before manifest publication and returns `201` file metadata. Repeating after a lost response returns the same committed file metadata rather than publishing a duplicate.
- `DELETE /api/uploads/:id` cancels a pending upload owned by the session. Owner cleanup remains available even if a room membership changed. A busy stream can return `409`; abort the active request first.

The browser hashes the source and each chunk; the host hashes each received chunk and verifies the completed object. These checks detect corruption, not a malicious host. The shipped browser keeps one bounded prefetch and up to two active file workers. Keep one logical upload tab per server when possible; the server lease prevents concurrent mutation, but browser resume records are still local-storage based.

Legacy `POST /api/upload` accepts raw bytes with URL-encoded `X-File-Name`, optional `X-File-Size`, `X-File-Type` and `X-File-SHA256`. It streams without resume and is useful for the in-app path check. Prefer resumable uploads for large files.

## Files, download and batch

`GET /api/files?q=<text>&room=<id>&after=<file-id>&limit=<1..100>` returns scoped metadata and `{files,total,nextCursor}`. Each file includes `{id,name,size,mime,hash,uploadedAt,ownerId,roomId,recipientId,relativePath,expiresAt,canDelete}`. Expired files are omitted.

`GET|HEAD /api/files/:id/download` supports one byte range, ETag/If-Range and attachment disposition. `206` includes `Content-Range`; invalid ranges return `416`. The server limits active downloads globally (16 by default) and per device (4 by default). A normal browser download does not prove that the OS saved the file.

`GET /api/batch?ids=id1,id2,…` streams a TAR archive for up to 100 distinct, authorized files. Paths are emitted as validated relative metadata through POSIX pax records; payload objects are opened by internal ID. Authorization is rechecked while streaming. It does not include empty directories and does not promise archive extraction safety for an arbitrary third-party extractor.

`POST /api/files/:id/receipt` accepts `received`, `verified` or `saved` from an authorized recipient. A supported verified-save UI writes through a disk sink, checks SHA-256 and sends `saved`. It cannot observe an arbitrary browser's download manager after the response leaves the page.

`DELETE /api/files/:id` requires the owner or administrator. Retention expiry removes the indexed object through the same safe deletion path. Deletion cannot erase prior downloads, backups or every storage-device remnant.

## Experimental direct WebRTC

Direct routes carry signaling metadata only; file bytes travel over a reliable ordered WebRTC DataChannel after both users accept and confirm.

- `POST /api/direct` with `{recipientId,name,size,mime,sha256}` creates a 30-minute transfer. The recipient must be approved and visible to the sender through the inbox target. Broker limits are 128 live transfers and eight per owner/recipient.
- `GET /api/direct` lists transfers for the current participant.
- `GET /api/direct/:id?after=<sequence>` returns `{transfer,signals,next,reset}`. Signaling queues are bounded; a `reset` requires a fresh direct attempt.
- `POST /api/direct/:id/signals` carries bounded `accept`, `description`, `candidate`, `confirm`, `restart` or `error` messages. SDP fingerprints are validated server-side; candidate count and signal sizes are bounded.
- `POST /api/direct/:id/complete` is a recipient receipt with `{sha256,size}`. The broker accepts it only after both confirmations and matching digest/size.
- `DELETE /api/direct/:id` cancels/rejects a transfer for either participant.

The sender and receiver compare a short SAS derived from the transfer metadata and both DTLS fingerprints. Both call `confirm` before the data channel starts. The receiver uses a bounded writable sink and incremental SHA-256; it does not assemble the complete file in a Blob. A reliable ACK is required per chunk and `bufferedAmount` is bounded. The current browser implementation can keep a live sender file/receiver sink for an in-page restart attempt, but direct resume is separate from hub offset resume.

Direct receiving requires a secure context and a disk-writing picker such as `showSaveFilePicker`, usually desktop Chromium. Ordinary HTTP LAN pages, unsupported mobile browsers and browsers without a suitable sink use hub sharing. `ICE_SERVERS=[]` by default; if configured, STUN/TURN credentials and relay cost belong to the operator. Browser stats label a selected relay candidate as `relay` and a suitable host/server-reflexive pair as `direct`; unknown stats stay `unknown`.

A failed direct attempt does **not** silently store the file on the hub. The user explicitly chooses hub fallback, which changes retention and host visibility. WebRTC encryption and SAS do not protect a malicious host that replaces the served application.

## Errors and durability

Typical errors are `{error,message}`: `401` authentication/session, `403` policy, `404` missing/foreign resource, `409` offset/busy/lease conflict, `410` terminal direct transfer, `413` size or signal limit, `416` range, `429` rate/quota/concurrency, `507` storage. A body-stream failure can close the connection before JSON; query status/offset before retry.

Atomic metadata replacement, object links/copies and filesystem sync are used where supported. A directory-sync failure after a manifest rename leaves the committed manifest authoritative and stops the store until recovery. The single-writer lock prevents two processes from mutating one `SHARE_DIR`; malformed or ambiguous locks fail closed.

## Compatibility and scope

This protocol does not claim LocalSend, PairDrop, tus, WebTransport or HTTP/3 compatibility. The hub path works with modern browsers that can make the required same-origin HTTP requests; background transfer, iOS lock-screen operation, power-loss certification, arbitrary network shares and Internet exposure are outside the tested contract. Use [validation evidence](VALIDATION.md) and [configuration](CONFIGURATION.md) for deployment limits.
