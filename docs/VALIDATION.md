# Release validation record

Candidate: **0.2.0-alpha.1**. Evidence recorded on **03-11-2026**. Automated/local checks are distinct from physical device and published CI results. This record will be finalized after integration; its existence does not imply publication.

## Local evidence

- Original security regressions: 10 of 10 failed on the original implementation, then passed after integration.
- Storage coverage: malformed names, ownership, quota/concurrency/expiry, checksums, interrupted-body rollback, durable offset restoration, journaled stream/deletion recovery, no-overwrite publication and filesystem fallback.
- TLS: temporary certificate, trusted CA/SAN verification, untrusted certificate rejection, Secure/HttpOnly cookie and payload integrity. No fixture private key is committed.
- Browser logic tests execute the shipped app/hash worker through adapters; these do not replace real browser/device checks.
- Official macOS ARM64 Node 24.22.2 and 26.13.0 distributions were checksum-verified for local testing. They are temporary tools, not bundled in source.

## Automated results

macOS ARM64, synthetic temporary data, loopback sockets:

| Runtime | Result | Duration | Skipped |
|---|---|---|---|
| Node 24.22.2 | 72/72 pass | 10.98 s | 0 |
| Node 26.13.0 | 72/72 pass | 11.66 s | 0 |

Suites cover API (8), client (5), hash/worker (4), source release (8), security regressions (10), original lifecycle (1), storage (34), TLS (2). Both final suites ran concurrently; durations are not performance comparisons. There is no configured standalone linter; `check` verifies source rules and JavaScript syntax.

## Reproducible performance sample

Node 26.13.0 on macOS ARM64. Random synthetic **64 MiB/file × 3 runs**, warm fixture/cache, HTTP loopback, separate server process, all upload/download SHA-256 checks matched and synthetic payloads were deleted. Default 4 MiB resumable chunks and fsync/metadata completion; timings include final server hash/commit.

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

## Privacy and packaging

Gitleaks **8.30.1**, official macOS ARM64 binary verified against its GitHub release SHA-256: workspace directory scan returned **0 findings / exit 0**, with full secret redaction. The allowlist/syntax check passed. Data in the original `shared/` and Finder metadata remain local and excluded; no original Git history existed in this workspace. History and final extracted-archive scans follow creation of the new snapshot. No finding result proves absence of all PII or secrets. Browser/CI/publication results remain pending.

## Remaining release gates

- Final artifact extraction/history scan and checks after any additional source changes. Independent API/session review found no remaining confirmed blocker; Node suites and syntax checks above passed.
- Desktop-browser test using synthetic data: upload/download/chat/logout and queue controls.
- Final Gitleaks snapshot/history scan, archive/checksum inspection and extraction smoke test.
- GitHub repository/author verification, CI and security-settings verification.
- Two physical devices in representative LAN, including Safari/iOS file selection, interruption/reselection and background limits. Localhost is not proof of these.
- LAN/overlay throughput and encrypted real-path measurements. No measured speed claim is made for untested hardware/networks.

Process-crash recovery is tested with explicit interrupted on-disk states; it is not power-loss certification. Same-size malicious local payload replacement is outside the protected trust boundary. Required implementation-plan gates are not silently counted as passed.
