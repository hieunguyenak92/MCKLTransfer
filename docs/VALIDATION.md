# Release validation record

## 0.5.0 — current workspace verification, 2026-11-06

- Full Node 26.13.0 macOS ARM64 suite: **140/140 passed**, 0 skipped, including direct broker/client, storage locks and quotas, session revocation/approval/invitations, room/inbox ACL, retention, pagination/search, TAR batches, idempotent completion, upload leases and active-request aborts.
- Source allowlist and JavaScript syntax check: **68 files / 33 JavaScript files passed**; `git diff --check` passed. The check is an explicit snapshot/pattern review, not proof that every historical commit is free of secrets.
- Real Chromium 151 loopback scenario with synthetic 12 MiB data: hub upload digest, private inbox isolation (sender/recipient/outsider `1/1/0`), verified disk save and SHA-256 receipt, local QR invitation rendering, direct WebRTC transfer with matching confirmation code, direct digest verification and 375px layout width all passed. No page errors were observed. This is a desktop loopback scenario, not physical LAN or mobile evidence.
- Browser direct transfer uses two browser contexts and the host signaling broker. It verifies explicit receive acceptance, both-side confirmation and bounded sink writes. TURN, Safari/iOS and real cross-network relay were not tested.
- Loopback benchmark runs from the earlier audit remain diagnostic only. No universal LAN speed claim is made; run the benchmark/iperf matrix in [the upgrade audit](research/upgrade-audit-2026-11.md) on the actual devices and network before publishing throughput numbers.


## 0.2.0-alpha.2 — 2026-11-04

This update adds complete English, Japanese, Spanish, Portuguese, Thai and Simplified Chinese READMEs alongside Vietnamese. All seven keep the commands, configuration defaults, security model and alpha limitations. The app supports **Vietnamese and English only**, with an accessible selector, browser-language detection, English fallback and a local saved choice. File names, device names and chat content remain user data and are not translated.

### Local checks

- Full suites on checksum-verified macOS ARM64 **Node 24.22.2: 92/92 passed** (4.96 s) and **Node 26.13.0: 92/92 passed** (4.79 s), zero failures or skips. Tests requiring listeners ran with loopback permission after the sandbox denied the initial runs with `EPERM`.
- The source allowlist covers **54 files**; all **22 JavaScript syntax checks** and `git diff --check` passed. No runtime dependency was added.
- Actual catalog tests cover key/placeholder parity, server error codes, safe text interpolation, locale/region negotiation, malformed or denied storage and metadata updates.
- Actual client-handler tests switch the selector during a live synthetic upload and verify the same upload ID, resume record, source/final digest, session, SSE connection, input values and focus. Authentication and XHR checksum errors re-render in the selected language; retries preserve the upload.
- Bootstrap tests reproduce a legacy/mismatched cached shell and verify safe bilingual recovery, no client initialization or automatic reload, manual-click reload, same-origin dependency ordering and dependency/client load errors. HTTP/CSP and service-worker installation tests fetch and cache both locale manifests and all app scripts; both manifests share one installed-app identity.
- Independent implementation and translation reviews found no remaining confirmed issue within this update's scope. Secret scans and final archive/CI evidence are recorded on the [alpha.2 release page](https://github.com/hieunguyenak92/MCKLTransfer/releases/tag/v0.2.0-alpha.2).

### Browser checks and limits

Real Chromium-based in-app browser, isolated loopback server and synthetic data: Vietnamese/English switching, translated labels/placeholders/security notice/authentication errors, preserved input and chat draft, peer/admin UI, unchanged Unicode file/chat data, English preference after reload, document language and locale manifest. After the bootstrap split, a fresh reload loaded the current shell and client successfully. The **375 px** viewport had a matching **375 px** document scroll width; the language selector remained usable. This is a responsive desktop-browser check, not a physical-phone test.

Active-transfer preservation is verified by the actual-handler VM tests above. This update does not add physical-device, Safari/iOS, overlay, background-transfer, graphical active-Cancel or throughput evidence. Historical alpha.1 results below retain their original scope. Final exact-commit CI results, platform skips and artifact checksums belong to the alpha.2 release notes.

## Historical record: 0.2.0-alpha.1

Version: **0.2.0-alpha.1**. Evidence recorded on **03–04-11-2026**. Automated/local checks are distinct from maintainer-reported physical-device results. The [release page](https://github.com/hieunguyenak92/MCKLTransfer/releases/tag/v0.2.0-alpha.1) identifies the published tag, final CI run and source-archive checksum; its attached manifest records every source-file digest.

### Local evidence

- Original security regressions: 10 of 10 failed on the original implementation, then passed after integration.
- Storage coverage: malformed names, ownership, quota/concurrency/expiry, checksums, interrupted-body rollback, durable offset restoration, journaled stream/deletion recovery, no-overwrite publication and filesystem fallback.
- TLS: temporary certificate, trusted CA/SAN verification, untrusted certificate rejection, Secure/HttpOnly cookie and payload integrity. No fixture private key is committed.
- Browser logic tests execute the shipped app/hash worker through adapters; these do not replace real browser/device checks.
- Official macOS ARM64 Node 24.22.2 and 26.13.0 distributions were checksum-verified for local testing. They are temporary tools, not bundled in source.

### Automated results

macOS ARM64, synthetic temporary data, loopback sockets:

| Runtime | Result | Duration | Skipped |
|---|---|---|---|
| Node 24.22.2 | 75/75 pass | 14.11 s | 0 |
| Node 26.13.0 | 75/75 pass | 13.94 s | 0 |

Suites cover API (8), client (8), hash/worker (4), source release (8), security regressions (10), original lifecycle (1), storage (34), TLS (2). Both final suites ran concurrently; durations are not performance comparisons. There is no configured standalone linter; `check` verifies source rules and JavaScript syntax.

### Reproducible performance sample

Node 26.13.0 on macOS 26.1 ARM64, Apple M1, 8 GiB RAM (both client and host on this machine). Random synthetic **64 MiB/file × 3 runs**, warm fixture/cache, HTTP loopback, separate server process, all upload/download SHA-256 checks matched and synthetic payloads were deleted. Default 4 MiB resumable chunks and fsync/metadata completion; timings include final server hash/commit.

| Files at once | Transfer median, aggregate MiB/s | Including source prehash, MiB/s | Prehash median | Download median MiB/s | Server peak RSS MiB |
|---|---:|---:|---:|---:|---:|
| 1 | 145.77 | 130.98 | 49.59 ms | 688.17 | 155.61 |
| 2 | 221.96 | 183.78 | 102.16 ms | 607.17 | 176.36 |

Server RSS is sampled every 25 ms; client peaks were 252.16/282.81 MiB respectively. These are small warm-cache samples, not statistical throughput bounds. Node crypto does not represent browser/mobile worker cost; prehash adds a source-read pass. This measures A → host and download separately, not browser A → browser B delivery, LAN/Wi-Fi/TLS, overlay, full-device RSS or fastest-transport claims.

```sh
npm run benchmark -- --mode=resumable --mib=64 --runs=3 --concurrency=1
npm run benchmark -- --mode=resumable --mib=64 --runs=3 --concurrency=2
# Legacy single-request comparison, explicitly separate:
npm run benchmark -- --mode=stream --mib=64 --runs=3 --concurrency=1
```

The harness defaults to resumable; `--url=http(s)://HOST:PORT` targets a server you control and requires `BENCH_SHARE_CODE` in the environment. TLS verification stays enabled. External-server runs cannot observe server RSS. Source generation is excluded, source prehash is explicitly timed, and transport phase includes chunk hashes and final verification. No physical LAN throughput has been measured.

### Privacy and packaging

Gitleaks **8.30.1**, official binary verified against its GitHub release SHA-256: directory, new Git history and extracted source-archive scans returned **0 findings / exit 0**, with full secret redaction. The allowlist and all 17 JavaScript syntax checks passed. Original `shared/` and Finder metadata are excluded. No original Git history existed in this workspace; this does not audit a repository elsewhere. No scanner result proves absence of every secret or PII.

The 42-file candidate archive was read independently, checked for regular members/normalized metadata, and compared by per-file SHA-256. Its extracted copy passed syntax checks and all then-current 72 tests. After the queue fixes, a rebuilt/extracted candidate passed all 75 tests (9.11 s, zero skips) and another Gitleaks scan returned zero findings. Final checksums are recorded in the generated manifest/checksum files; later evidence-only documentation edits are re-exported and scanned before publication. The npm dry-run package contains only 13 runtime/license/README files (no transfer data). GitHub archives of the initial snapshot and later commits were compared with the reviewed manifests; the archive of `d5c33f0d5a603409faeef262d6a195276796d02d` matched all 42 file paths, sizes and SHA-256 digests before the final publication-documentation update.

### Browser evidence

Real Google Chrome on the same Mac, synthetic loopback data: peer/admin login, real Worker-backed upload, file list, download with byte/hash equality, chat between normal/incognito sessions via SSE, device panel, logout followed by unauthenticated reload, and revocation returning the peer to pairing. A 12 MiB random source also completed through the incremental Worker path with the correct server object SHA-256. The delayed-proxy test is correctness fault injection, not a browser speed benchmark. The 12 MiB delayed-proxy run used 1 MiB protocol chunks solely to observe controls. It paused at 2 MiB committed, reloaded/reselected the same source and resumed the same upload ID, then paused at 8 MiB. Further picks produced distinct upload IDs; two active workers plus another queued transfer were observed. Queued Cancel succeeded before server state existed. All three browser uploads completed, each 12 MiB with the source SHA-256; no partials remained. The graphical active-upload Cancel/delete path was not clicked because Computer Use requires action-time human confirmation for deletion; shipped-handler VM regressions and real storage/API tests verify active abort/deletion separately. This is an explicit verification limit, not a passed graphical test.

Three new actual-handler regressions cover same-tab duplicate pending-ID ownership, separate resume records for different content with identical metadata, and repeated Cancel clicks. All pass; an independent per-app review found no remaining actionable queue/cancellation race.

**Known alpha limitation:** one upload tab per server/origin. Cross-tab resume records/cookies are shared; cancelling the same pending ID in another live tab can discard progress. The original source and completed files are safe; the other tab falls back to a new upload on `404`. Cross-tab claim coordination is not implemented or marked passed. This restriction is visible in the UI/README/protocol.

### Maintainer-reported physical-device acceptance

On **2026-11-04**, the maintainer reported successful **Cốc Cốc** testing in response to the second-device LAN smoke-test request covering upload, download, chat and pause/resume. Device OS/hardware, browser version, payload size, independent digest and per-step results were not supplied. This closes the maintainer acceptance gate for this experimental alpha; it is not an instrumented throughput measurement, a large-file/network-loss test or Safari/iOS verification. No temporary LAN address, pairing code or user payload is included in source artifacts.

### GitHub evidence

The authenticated API and browser account were verified as `hieunguyenak92`. The exact noreply address was read from GitHub Settings → Emails and used only as repository-local Git author configuration. Repository [hieunguyenak92/MCKLTransfer](https://github.com/hieunguyenak92/MCKLTransfer) was created private; initial source commit `b96116d287c48c62ca2f9c02109958c4febe7ea4` was pushed after history scanning. On **2026-11-04**, after maintainer-reported LAN acceptance, visibility was changed to **public** and read back through the authenticated API. Dependabot vulnerability alerts remained enabled (verified HTTP204).

[Initial CI run](https://github.com/hieunguyenak92/MCKLTransfer/actions/runs/41679263593): Gitleaks and Ubuntu 24/26 passed (72/72, no skips). Windows 24/26 passed (68 pass, four explicit skips: one filesystem permission case and three symlink cases). Both macOS jobs were cancelled before startup after about 16 minutes, with no runner assigned. GitHub annotations state that the hosted runner could not be acquired and report macOS ARM64 capacity constraints; no application test failed in those jobs. Local macOS suites are separate evidence. The next workflow uses the documented standard `macos-26-intel` pool to cover Intel in CI alongside local Apple Silicon checks ([GitHub runner labels](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job)). This is still a three-OS/six-runtime-job matrix, not removal of the macOS gate. The queue fixes were then verified on [final code CI run41682905540](https://github.com/hieunguyenak92/MCKLTransfer/actions/runs/41682905540), exact commit `8f5dda7d1e314c7b9a8fd859571f2ae94716c095`: **all seven jobs succeeded**. Ubuntu and macOS Intel on Node24/26 each passed **75/75** without skips; Windows on each branch passed **71 tests with four documented platform skips**, no failures. Source/syntax/export gates passed on all six runtime jobs. Gitleaks reported three scanned commits and no leaks. Later evidence-only documentation commits do not change that tested runtime; their own checks remain visible in Actions. Automatic Dependabot PR #1 is unmerged and has not changed main.

The documentation commit `d5c33f0d5a603409faeef262d6a195276796d02d` also completed [all seven CI jobs successfully](https://github.com/hieunguyenak92/MCKLTransfer/actions/runs/41683630748). Final publication-documentation changes do not alter runtime code; the release notes link the CI run for the exact tagged commit.

While private, branch protection returned HTTP403 and secret scanning/push protection returned HTTP422 because those settings were unavailable for this account/repository combination. No plan upgrade or billing change was made. After public visibility, the API confirmed **secret scanning enabled**, **push protection enabled** and **private vulnerability reporting enabled**. Main-branch protection requires the exact seven CI contexts, strict up-to-date checks and resolved conversations; force pushes and deletion are disabled. Administrator bypass remains enabled for the owner. Local and CI Gitleaks remain enabled. The verified private reporting form is linked in [SECURITY](../SECURITY.md).

### Verification limits and follow-up work

- Independent API/session and per-app queue reviews found no remaining confirmed code blocker within the documented alpha scope. Every later release still needs its own source/artifact scan and exact-commit CI.
- Active graphical Cancel/delete happy path remains untested; its real handlers/backend are covered separately as described above.
- Broader physical-device testing: large files, Unicode/duplicate names, network loss/reselection, independent downloaded-file digests and Safari/iOS background limits. The maintainer smoke result does not verify each of these cases.
- Trusted HTTPS with device-installed CA/SAN and a real overlay/proxy path. Automated TLS fixtures do not replace this deployment-specific verification.
- LAN/overlay throughput and encrypted real-path measurements. No measured speed claim is made for untested hardware/networks.

Process-crash recovery is tested with explicit interrupted on-disk states; it is not power-loss certification. Same-size malicious local payload replacement is outside the protected trust boundary. Required implementation-plan gates are not silently counted as passed. Cross-tab claim coordination remains explicit future work before removing the single-upload-tab restriction.
