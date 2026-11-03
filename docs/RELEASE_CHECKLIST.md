# Checklist phát hành `0.2.0-alpha.1`

Đích dự kiến: **`hieunguyenak92/MCKLTransfer`**. Giấy phép đã chọn và thêm vào source: **Apache-2.0**. Checklist này là quy trình hiện hành sau triển khai ngày **03-11-2026**; hồ sơ nghiên cứu ban đầu được giữ ở [OPEN_SOURCE_REVIEW](OPEN_SOURCE_REVIEW.md) và [security-audit](research/security-audit.md).

**Chỉ đánh dấu từng cổng khi có bằng chứng trên đúng snapshot/artifact sẽ phát hành.** Ghi lệnh, runtime/OS, kết quả và giới hạn ở [VALIDATION](VALIDATION.md). Source đã có công cụ/CI không đồng nghĩa scanner, browser, LAN hoặc GitHub đã được xác minh. Phạm vi được duyệt ở [IMPLEMENTATION_PLAN](IMPLEMENTATION_PLAN.md); hướng dẫn hành vi hiện tại ở [README](../README.md).

## 1. Khóa phạm vi và nguồn gốc

- [ ] Xác nhận version, README, CHANGELOG, SECURITY và [PROTOCOL](PROTOCOL.md) cùng mô tả một bản alpha: hub tin cậy, không gian chung; HTTP chỉ cho LAN tin cậy; HTTPS/overlay cấu hình rõ; chưa E2EE, remote control, discovery hoặc cam kết background trên iOS.
- [ ] Kiểm tra `LICENSE` nguyên văn, `NOTICE`, SPDX và danh tính công khai; xác nhận quyền cấp phép code/assets thực tế. Nếu thêm dependency/runtime/binary, rà lại license và notice của đúng thành phần.
- [ ] Giữ dữ liệu thật, môi trường riêng, key/cert, log, backup và screenshot nhạy cảm bên ngoài source. Không xóa dữ liệu sử dụng để tạo bản phân phối.
- [ ] Xác định có dùng lịch sử Git gốc hay snapshot mới. Workspace được audit ban đầu không có `.git`; không được coi lịch sử chưa thấy là sạch.

`SHARE_DIR` có thể trỏ sang đường dẫn tùy chỉnh. `.gitignore` không tự nhận mọi thư mục dữ liệu đó, không gỡ file đã tracked và không lọc ZIP của Finder/Explorer. Dùng exporter nguồn có allowlist; không zip toàn bộ thư mục đang chạy ứng dụng. [GitHub: ignoring files](https://docs.github.com/en/get-started/git-basics/ignoring-files)

## 2. Kiểm thử source cuối

Dùng Node **24 từ 24.22.2** hoặc **26 từ 26.13.0**, trong các nhánh được hỗ trợ; không cần `npm install` cho source hiện tại. Chạy các lệnh sau trên cả hai nhánh Node, ghi từng kết quả:

```sh
node --version
npm run check
npm test
npm run release:check
```

- [ ] Các suite security/storage/API/TLS/client/hash/release đều pass; không có lỗi chưa phân loại hoặc test bị skip mà không nêu lý do.
- [ ] Kiểm tra ownership/revoke/logout/expiry, offset/checksum, lỗi I/O/abort, quota, cancel/expiry, restart và download ranges trong kết quả regression.
- [ ] Ghi rõ test client qua adapter, TLS fixture và recovery không thay browser thật, trust CA của người dùng hoặc kiểm chứng mất điện.
- [ ] Nếu thêm linter/build/dependency, chạy gate tương ứng và cập nhật checklist. Hiện `npm run check` kiểm tra source/syntax, không phải kết quả một linter riêng.

Không lấy số test của báo cáo MVP làm trạng thái cuối. Ghi kết quả thực tế mới vào VALIDATION; chạy lại sau mọi thay đổi có ảnh hưởng.

## 3. Browser và thiết bị thật

- [ ] Browser desktop dùng dữ liệu tổng hợp: auth, queue nhiều lần chọn file, upload/download/hash, pause/resume/retry/cancel, reload/chọn lại nguồn, chat, logout, quyền peer/admin và revoke.
- [ ] Hai thiết bị vật lý trong LAN: xác nhận URL/interface/firewall đúng, gửi/nhận file lớn, Unicode/trùng tên, gián đoạn đường truyền rồi tiếp tục với digest đúng.
- [ ] Safari/iOS thật: chọn file, tải xuống, mất mạng, chọn lại nguồn và lock/background; ghi đúng giới hạn khi browser dừng tác vụ.
- [ ] HTTPS với CA/SAN mà thiết bị thật tin cậy; không bỏ qua cảnh báo chứng chỉ. Nếu hỗ trợ proxy/overlay trong bản công bố, kiểm tra policy, streaming/SSE và đường direct/relay thực tế.
- [ ] Đo hiệu năng với fixture không riêng tư; ghi payload, runtime/OS, topology, TLS, cache, hash, thời gian, CPU/RSS và điều kiện chưa đo.

Harness local hỗ trợ kiểm tra có thể lặp lại:

```sh
npm run benchmark -- --mib=64 --runs=3 --concurrency=1
```

Loopback không chứng minh throughput LAN/overlay hoặc tốc độ browser. Xem [phương pháp benchmark](research/performance.md); chỉ công bố số đo có điều kiện đi kèm.

## 4. Quét secret và quyền riêng tư

- [ ] Chạy scanner đầy đủ trên snapshot cuối, xem từng finding; mẫu fixture phải được phân loại cụ thể, không allowlist hàng loạt.
- [ ] Nếu có lịch sử Git gốc, quét toàn bộ refs/branches/tags định phát hành và kiểm tra author/committer email; snapshot sạch không chứng minh history sạch.
- [ ] Rà thủ công tên file, IP/hostname, home path, tài liệu, ảnh chụp, notice, báo cáo và archive; secret scanner không chứng nhận hết PII.
- [ ] Nếu tìm credential thật, revoke/rotate trước khi công bố rồi xử lý các bản sao/history liên quan. Chỉ xóa file không thu hồi credential.

Sau khi cài bản Gitleaks đã xác minh từ nguồn chính thức, kiểm tra cú pháp theo phiên bản rồi chạy, ví dụ:

```sh
gitleaks dir . --redact
# Chạy riêng trong repository có lịch sử định phát hành:
gitleaks git . --redact
```

Ghi version, phạm vi, finding đã xử lý và exit status ở VALIDATION. Giữ raw report riêng vì vẫn có thể chứa metadata nhạy cảm. Scanner mẫu trong `release:check` là một lớp bổ sung, chưa thay Gitleaks/history review. [Gitleaks CLI](https://github.com/gitleaks/gitleaks), [GitHub: removing sensitive data](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository)

## 5. Tạo và kiểm tra artifact cuối

Sau khi tích hợp mọi chỉnh sửa, chạy lại:

```sh
npm run release:check
npm run release:source
npm pack --dry-run --json --ignore-scripts
```

Exporter ghi trong `release/`:

- `mckl-transfer-0.2.0-alpha.1-source.tar.gz`
- `mckl-transfer-0.2.0-alpha.1-source.manifest.json`
- `mckl-transfer-0.2.0-alpha.1-source.sha256`

Nó giới hạn source theo allowlist, kiểm tra file không hợp lệ/symlink, đối chiếu member và digest rồi đọc lại archive đã lưu. Sau đó vẫn cần:

- [ ] Đọc manifest và member list của **archive cuối**, xác nhận không có dữ liệu runtime/config riêng/key/log/backup, không có artifact tạm hoặc symlink.
- [ ] Kiểm tra checksum độc lập của đúng archive, ghi digest vào VALIDATION hoặc release notes.
- [ ] Giải nén vào thư mục tạm mới, chạy `npm run check` và `npm test` từ bản giải nén; smoke test khởi động bằng dữ liệu tổng hợp rồi dừng/xóa fixture.
- [ ] Đọc danh sách `npm pack --dry-run`; `files` hiện cho phép `server.mjs`, `public/`, `lib/`, `NOTICE` cùng các file npm tự kèm. Giữ `private: true` để ngăn publish npm nhầm.
- [ ] Nếu sửa source/tài liệu sau khi đóng gói, tạo lại archive/checksum và kiểm tra lại. Artifact cũ không đại diện snapshot mới.

Ví dụ kiểm tra bằng công cụ hệ điều hành (macOS/Linux):

```sh
tar -tzf release/mckl-transfer-0.2.0-alpha.1-source.tar.gz
shasum -a 256 release/mckl-transfer-0.2.0-alpha.1-source.tar.gz
mckl_review_dir=$(mktemp -d)
tar -xzf release/mckl-transfer-0.2.0-alpha.1-source.tar.gz -C "$mckl_review_dir"
```

Lệnh cuối chỉ giải nén; vào đúng thư mục source trong thư mục tạm để kiểm thử. Trên PowerShell có thể kiểm checksum bằng `Get-FileHash -Algorithm SHA256`. Binary/installer/container tương lai cần audit artifact và notice riêng; source archive sạch không xác minh chúng.

## 6. Git, tài khoản và metadata

- [ ] Xác minh tài khoản thực sự đang dùng là **hieunguyenak92**, quyền tạo repo và tên đích còn dùng được; chưa suy ra từ author/repository trong package.
- [ ] Trước commit, đặt Git name công khai và email noreply **chính xác** từ GitHub Settings → Emails; không đoán ID hoặc công bố email cá nhân chưa được chọn.
- [ ] Nếu dùng history gốc, hoàn tất kiểm tra history ở mục 4. Nếu tạo snapshot mới, chỉ `git init` trong bản source sạch đã review.
- [ ] Stage tường minh và đọc toàn bộ diff/index, không dùng force-add để vượt rule riêng tư.

Ví dụ cho **snapshot mới** đã review:

```sh
git init -b main
git config --local user.name "hieunguyenak92"
# Đặt user.email local bằng noreply chính xác trong Settings → Emails.
git add .gitignore .gitattributes .github package.json server.mjs public lib scripts test docs README.md PLAN.md RESEARCH.md SECURITY.md CONTRIBUTING.md CHANGELOG.md LICENSE NOTICE
git status --short
git diff --cached --stat
git diff --cached --check
git diff --cached
git ls-files
git ls-files -ci --exclude-standard
```

Lệnh cuối phải không có output. Kiểm tra riêng mọi tên/path mới; không coi `.gitattributes export-ignore` là bộ lọc commit/push. Sau commit, đối chiếu nội dung GitHub archive với bản nguồn đã review.

## 7. GitHub, CI và công bố

- [ ] Tạo đúng repository dưới `hieunguyenak92`; có thể dùng private trước để kiểm tra. Không tạo README/LICENSE tự động đè lên bản local.
- [ ] Xác minh remote và author trước push. Sau push, rà Files, mọi nhánh/tag, metadata commit và archive GitHub tải về.
- [ ] Chạy CI trên đúng commit: Ubuntu/Windows/macOS × Node 24/26. File workflow hiện có chưa chứng minh sáu job đã pass. Xử lý mọi khác biệt nền tảng/skip trước khi ghi trạng thái tương thích.
- [ ] Bật/kiểm tra các security settings khả dụng theo visibility/gói: secret scanning, push protection, Dependabot alerts, branch protection/rules. Ghi setting chưa khả dụng và thời điểm kiểm tra lại.
- [ ] Chỉ public khi các gate bắt buộc đã đạt hoặc có quyết định phạm vi alpha được ghi rõ. Khi public, bật/kiểm tra private vulnerability reporting nếu khả dụng, cập nhật SECURITY với kênh báo lỗi đã xác minh, rồi mới thông báo release.
- [ ] Tạo tag/release alpha từ đúng commit đã kiểm tra; đính kèm đúng archive/checksum cuối và release notes nêu giới hạn/chưa thử. Xác minh URL, visibility và artifact tải về sau phát hành.

Private vulnerability reporting chỉ khả dụng cho public repository; khả năng bảo vệ repo private phụ thuộc gói tài khoản. [GitHub: private reporting](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository), [protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)

Đây là mẫu quy trình dùng lại; các ô chưa đánh dấu không phải bảng trạng thái của bản alpha hiện tại. Trạng thái và giới hạn thực tế được ghi trong [VALIDATION](VALIDATION.md), còn tag/artifact cuối được xác định tại [trang phát hành](https://github.com/hieunguyenak92/MCKLTransfer/releases/tag/v0.2.0-alpha.1). Không đánh dấu các trường hợp thiết bị chi tiết chỉ dựa trên một báo cáo smoke test tổng quát.
