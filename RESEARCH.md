# Nghiên cứu thị trường và kỹ thuật (31-10-2026)

> **Hồ sơ nghiên cứu lịch sử.** Nội dung từ “Ghi chú ban đầu” trở xuống mô tả MVP ngày **31-10-2026**. Deep research và audit ngày 03-11-2026 ở [OPEN_SOURCE_REVIEW](docs/OPEN_SOURCE_REVIEW.md) được giữ cùng bằng chứng ban đầu; trạng thái hiện tại nằm ở [README](README.md), [IMPLEMENTATION_PLAN](docs/IMPLEMENTATION_PLAN.md) và [VALIDATION](docs/VALIDATION.md).

## Cập nhật sau nghiên cứu — 03-11-2026

Hướng đã chọn cho `0.2.0-alpha.1`: hub Node.js stdlib với streaming HTTP(S), source Apache-2.0, nhóm tin cậy dùng LAN hoặc overlay tự quản lý quyền. Các lỗi tên/manifest/stream/logout/SSE được sửa; có quyền owner/admin, phiên thiết bị qua restart, upload offset với checksum/cancel/expiry và hàng đợi toàn ứng dụng. Đường resume là API riêng; chưa tuyên bố tương thích tus hoặc LocalSend.

Nghiên cứu kiến trúc hiện đại vẫn được giữ ở [architecture](docs/research/architecture.md), phương pháp đo ở [performance](docs/research/performance.md), lịch sử phát hiện/sửa lỗi ở [security-audit](docs/research/security-audit.md), quyết định license/roadmap ở [license-and-roadmap](docs/research/license-and-roadmap.md). WebRTC/QUIC/iroh, discovery/QR, screen share và full remote control là các hướng về sau; chưa có số đo để thay transport hiện tại hoặc tuyên bố tốc độ cao nhất.

Snapshot/artifact cuối, scanner/history, browser, CI, LAN/overlay và publishing phải được xác minh theo [RELEASE_CHECKLIST](docs/RELEASE_CHECKLIST.md). Các khẳng định “đã xử lý” trong ghi chú MVP phía dưới chỉ là lịch sử thiết kế; không thay bằng chứng regression và giới hạn được ghi ở VALIDATION.

---

## Ghi chú ban đầu — 31-10-2026

> Ghi chú thiết kế ban đầu. Báo cáo kiểm chứng ngày 03-11-2026 nằm ở [docs/OPEN_SOURCE_REVIEW.md](docs/OPEN_SOURCE_REVIEW.md). Các đoạn “đã xử lý” bên dưới không phải chứng nhận bảo mật; audit mới nêu các giới hạn còn tồn tại.

## Những sản phẩm nên benchmark

| Sản phẩm | Cách truyền | Điểm mạnh | Giới hạn đối với MVP |
|---|---|---|---|
| [LocalSend](https://github.com/localsend/localsend) | HTTP(S) LAN + discovery multicast/fallback | Native đa nền tảng, nhanh, không cloud, protocol mở | Cần cài app; discovery và trust model phức tạp hơn web-only |
| [PairDrop](https://github.com/schlagmichdoch/PairDrop) | WebRTC P2P, signaling, TURN tùy topology | Không cài đặt, PWA, pairing/QR, UX tốt | HTTPS cần cho PWA self-host; TURN làm chậm/đưa dữ liệu qua relay khi NAT |
| [Syncthing](https://github.com/syncthing/syncthing) | Đồng bộ thư mục liên tục | Tin cậy, resume/versioning | Nặng và nhiều khái niệm hơn một phiên gửi file |
| [croc](https://github.com/schollz/croc) | CLI relay/E2E | Mã ghép đôi, đi qua mạng khó | Không phù hợp UX iPhone/desktop phổ thông |

## Kỹ thuật quan trọng

### HTTP stream làm đường truyền chính

LocalSend protocol v2.2 mô tả server nhận upload binary qua HTTP và cho phép các file song song; receiver có thể xác nhận SHA-256, trả lỗi checksum và có API reverse-download cho browser. Đây là nền tảng phù hợp cho LAN vì TCP/HTTP dễ debug, tận dụng buffering của kernel và không cần server cloud.

MVP dùng cùng ý tưởng nhưng đơn giản hơn: mỗi file là một HTTP request, server pipe trực tiếp vào file tạm, hash streaming rồi rename nguyên tử. Download dùng Range/ETag để trình duyệt có thể tiếp tục hoặc cache an toàn.

### Discovery

Multicast UDP/Bonjour cho UX “mở app là thấy nhau”, nhưng nhiều Wi-Fi bật client isolation hoặc chặn multicast. Vì vậy bản đầu luôn hiển thị URL IPv4 LAN và có thể thêm mDNS ở milestone sau. Apple khuyến nghị Bonjour/Network framework cho service discovery và cảnh báo về local-network permission trên iOS.

### P2P browser

PairDrop chứng minh WebRTC phù hợp cho browser-to-browser và DTLS mã hóa dữ liệu. Tuy nhiên cần signaling, ICE/STUN, TURN fallback, HTTPS và xử lý lifecycle của Safari. Với mục tiêu “nhẹ, chuẩn xác, nhanh” và có desktop làm host, HTTP LAN dễ đưa vào production hơn; WebRTC sẽ là transport tùy chọn sau khi discovery/trust hoàn thiện.

### Browser upload

Fetch/Streams API xử lý response theo stream, nhưng upload progress chưa đồng nhất giữa các browser. MVP dùng XMLHttpRequest với `xhr.upload.onprogress` và gửi body là `File` trực tiếp để vừa có tiến độ vừa không phải tạo multipart buffer.

## Kiến trúc đề xuất

```text
Browser (Windows/macOS/iPhone)
        │ HTTP LAN + cookie session
        ▼
Node.js stdlib server
  ├─ PIN auth + rate limit
  ├─ streaming upload → .part → SHA-256 → atomic rename
  ├─ range download + ETag
  ├─ SSE file events
  └─ shared/ + JSON index
```

## Rủi ro đã xử lý

- **Path traversal / overwrite:** canonicalize basename, UUID metadata, file tạm và tên trùng tự tăng hậu tố.
- **RAM tăng theo file:** không dùng `readFile` cho payload; Node stream có backpressure.
- **File hỏng khi mất mạng:** `.part` không xuất hiện trong API; cleanup khi abort/size mismatch.
- **Người lạ trong LAN:** PIN phiên, rate-limit, logout; roadmap HTTPS fingerprint để chống MITM.
- **iPhone hạn chế nền:** MVP chạy trong Safari foreground; native URLSession/Bonjour là milestone nếu cần background transfer.
