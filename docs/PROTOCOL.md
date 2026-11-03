# Alpha HTTP protocol

Version `0.2.0-alpha.1`. This is a project-specific protocol, **not a tus implementation**. Changes may occur before stable release. Requests must use an allowed Host and same Origin; API responses are not cached. JSON endpoints require `Content-Type: application/json` and object bodies.

## Identity and authorization

`POST /api/auth` accepts `{code,deviceName,rememberDevice}`. The six-digit code creates a peer; the separate administrator code creates an admin. The server sets an HttpOnly, SameSite=Strict session cookie (Secure for HTTPS). Default expiry is 12 hours; `rememberDevice: true` selects 30 days. Raw tokens are never written to the device journal. Protect the cookie like a credential. API tools may use the issued token as a Bearer credential; browsers use the cookie.

`POST /api/logout` revokes the current session and expires its cookie. `GET /api/devices` and `DELETE /api/devices/:id` require admin. Device IDs are 16 lowercase hex characters. A valid cookie preserves identity across host restarts; pairing after logout creates a new owner identity. Revocation closes that session's SSE and prevents subsequent authenticated requests.

`GET /api/config` is public but contains only version/limits/transport status. Authenticated requests also receive host addresses, identity/permissions and storage usage. Codes are terminal-only. `GET /api/health` returns `{ok:true}`.

## Resumable upload

1. Compute source SHA-256 incrementally. `POST /api/uploads` with `{name,size,mime,sha256}` reserves the full size and a display name. Response `201`: `{id,offset,size,chunkSize,expiresAt}`; `expiresAt` is epoch milliseconds. IDs are 24 lowercase hex characters.
2. `HEAD /api/uploads/:id` returns durable `Upload-Offset`, `Upload-Length` and `Upload-Expires` (HTTP date, second precision). Only the initiating identity may modify its pending upload. An expired/missing/foreign upload returns `404`.
3. `PATCH /api/uploads/:id` sends raw binary, at most `chunkSize` bytes, with integer `Upload-Offset` and `x-chunk-sha256` (64 hex characters). Server validates offset/checksum, flushes data and persists the offset before returning `204` with `Upload-Offset`. Failed/interrupted chunks roll back; re-HEAD before retry after an ambiguous network outcome. Do not pipeline chunks for one upload.
4. `POST /api/uploads/:id/complete` verifies size and full SHA-256 before publishing, then returns `201` file metadata. Until publication it is absent from `/api/files`. Completion is not idempotent after success: if its response is lost, inspect the file list and compare name/size/hash before creating another upload.
5. `DELETE /api/uploads/:id` cancels pending state. Pause/abort the active request first; a busy upload may return `409`. Completed files use the separate file-deletion endpoint.

Expiry is absolute from creation; default 24 hours. Resume after reload requires the same cookie and source file reselection. Restart restores the persisted offset and truncates an uncommitted tail. Hashes detect corruption; they do not authenticate the host without trusted transport.

Use one live upload tab per server/origin in this alpha. The UI excludes duplicate pending-ID ownership within one app and preserves distinct same-metadata/different-content records. Cookies/resume records are shared across tabs; cross-tab claims are not coordinated. Two tabs can therefore reference one pending upload, and cancelling it in either can discard the other's progress. Source/completed files are unaffected; a missing pending upload is retried from zero. Cross-tab claim coordination is future work, not a tested guarantee.

Legacy `POST /api/upload` accepts raw bytes with URL-encoded `x-file-name`, optional `x-file-size`, `x-file-type` and `x-file-sha256`. It streams one request without resume. Prefer resumable flow for large files. No multipart/base64 is used.

## Files, chat and events

- `GET /api/files` → `{files:[{id,name,size,mime,hash,uploadedAt,ownerId,canDelete}]}`. Filesystem paths are private.
- `GET|HEAD /api/files/:id/download` supports one byte range, ETag/If-Range and attachment disposition. A valid range returns `206`; invalid/unsatisfiable ranges return `416`. Download resume depends on browser/tool. The UI does not automatically hash the downloaded file after the OS saves it.
- `DELETE /api/files/:id` requires owner or admin. All authenticated members can list/download every completed file.
- `GET /api/messages` → `{messages,clientId}`; `POST /api/messages` with `{text}` → new message (`201`). Limits: 4,000 codepoints, 60 messages/minute/identity, 200 retained messages in RAM.
- `GET /api/events` is SSE: `ready`, `files` and `chat`. It closes on expiry/logout/revoke. Limits: four streams/session, 128 total; slow readers are disconnected.

Errors use `{error,message}` with meaningful HTTP status where possible. Body-stream failures may terminate the connection before JSON delivery; query the durable offset before retry. `409` denotes offset/busy conflict; `413` size limits; `429` resource/rate limits; `507` insufficient storage. Browser upload-progress is not confirmation of disk commit.
