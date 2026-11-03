# Contributing

Contributions are provided under the project's [Apache-2.0 license](LICENSE). Submit only code and assets you have the right to license. Preserve applicable copyright and notices; disclose third-party provenance. No CLA is currently required.

## Development

Use patched Node.js 24 (at least 24.22.2) or 26 (at least 26.13.0). There are no external runtime dependencies and no install step.

```sh
npm run check
npm test
npm run release:check
npm run dev
```

Use a synthetic, separate `SHARE_DIR` and trusted network for manual work. Automated tests use temporary directories and loopback sockets. Some symlink/permission tests depend on OS privileges; the TLS test generates an ephemeral certificate with OpenSSL and reports a skip if OpenSSL is absent. Read test summaries rather than counting a skipped case as a pass.

## Changes

- Keep PRs focused and follow the standard-library architecture and existing style. Explain changed behavior, reason and verification.
- Add meaningful regressions for correctness/security fixes; document protocol, migration and permission changes.
- Do not claim LAN/mobile support or throughput from localhost/VM tests alone. Record payload, runtime, topology, checksum and measurement scope for performance work.
- Never submit real transfer data, internal manifests, cookies, access codes, private keys, logs with network identity or personal screenshots. Do not force-add ignored files.
- Review staged content and author metadata before pushing. The exporter and `.gitignore` do not erase secrets already in Git history.
- Report vulnerabilities using [SECURITY.md](SECURITY.md).

## Release verification

Follow [the release checklist](docs/RELEASE_CHECKLIST.md). `npm run release:source` creates a bounded source archive, per-file manifest and checksums in `release/`; it performs no publication. Scan both the final snapshot and Git history. Check every binary/container/installer separately if introduced later.
