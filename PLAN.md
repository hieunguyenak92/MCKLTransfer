# LAN Share — kế hoạch và quyết định kỹ thuật

> **Bản kế hoạch MVP được lưu làm lịch sử.** Kế hoạch thực thi đã được chủ dự án duyệt ngày **03-11-2026** nằm ở [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md). Source hiện là **`0.2.0-alpha.1`, Apache-2.0**. Xem [README](README.md) để sử dụng và [VALIDATION](docs/VALIDATION.md) để biết chính xác phần đã/chưa được xác minh.

## Trạng thái sau triển khai — 03-11-2026

Giữ Node stdlib + UI browser + hub lưu file. Đã tách storage/session thành module, sửa các lỗi security/correctness được tái hiện, thêm peer/admin và revoke, HTTPS cấu hình được, quota/concurrency, upload offset/checksum/recovery, queue pause/resume/retry/cancel và công cụ source release. `LICENSE`, `NOTICE`, policy và cấu hình CI đã có trong source.

Phần triển khai không tự hoàn tất các cổng phát hành. Bước tiếp theo theo [checklist](docs/RELEASE_CHECKLIST.md): khóa snapshot, chạy suite trên runtime được hỗ trợ, scanner và artifact cuối, thử browser/hai thiết bị/đường LAN hoặc overlay đại diện, xác minh tài khoản/CI/security settings rồi mới công bố. Kết quả cụ thể được tập trung ở VALIDATION; không đánh dấu các bước này đã đạt chỉ vì có code hoặc tài liệu.

Mô hình vẫn là không gian chung của nhóm tin cậy: host đọc được dữ liệu, peer đọc mọi file/chat và chỉ xóa file của mình. Keypair pairing, E2EE, discovery/QR, WebRTC, native background và remote control chưa được triển khai. Test clean restart/recovery không phải kiểm chứng mất điện hay Safari/iOS thật.

---

## Kế hoạch MVP ban đầu — trước triển khai bản alpha ngày 03-11-2026

> Kế hoạch ban đầu. Xem [báo cáo kiểm chứng trước open source](docs/OPEN_SOURCE_REVIEW.md) để biết trạng thái và rủi ro thực tế ngày 03-11-2026.

## 1. Mục tiêu

Tạo một ứng dụng chia sẻ file hai chiều trong cùng mạng LAN, dùng được giữa Windows, macOS, iPhone/iPad và mọi trình duyệt hiện đại. Bản đầu tiên phải nhẹ, không cần cloud hay dependency runtime, giao diện dễ dùng và truyền theo dạng stream để không giữ cả file trong RAM.

## 2. Nghiên cứu và lựa chọn

- **LocalSend** là chuẩn tham chiếu tốt cho LAN: giao thức v2.2 dùng REST/HTTP, discovery multicast và fallback HTTP, gửi binary trực tiếp, truyền nhiều file song song và kiểm tra SHA-256. Xem [protocol v2.2](https://github.com/localsend/protocol) và [ứng dụng](https://github.com/localsend/localsend/releases).
- **PairDrop** là tham chiếu tốt cho UX web/PWA: WebRTC truyền P2P, pairing bằng mã/QR, không cần cài app. Tuy nhiên WebRTC cần signaling/TURN trong một số topology và self-host PWA cần HTTPS; vì vậy phù hợp làm hướng nâng cấp, không phải nền tảng MVP tối giản. Xem [PairDrop](https://github.com/schlagmichdoch/PairDrop) và [FAQ](https://github.com/schlagmichdoch/PairDrop/blob/master/docs/faq.md).
- Trên Apple, **Bonjour** là lựa chọn discovery chuẩn, còn URLSession/Network framework là API được khuyến nghị; iOS cũng có giới hạn khi app chạy nền. Xem [TN3151](https://developer.apple.com/documentation/technotes/tn3151-choosing-the-right-networking-api).
- Browser Streams/Fetch hỗ trợ stream dữ liệu lớn; MVP dùng XMLHttpRequest upload để có tiến độ chính xác và Node HTTP stream để giảm bộ nhớ. Xem [MDN Streams API](https://developer.mozilla.org/en-US/docs/Web/API/Streams_API).

### Quyết định cho MVP

1. **Một Node.js server thuần stdlib**, chạy trên Windows/macOS/Linux; không npm dependency, dễ đóng gói sau này bằng Node SEA/Tauri.
2. **Web UI responsive/PWA** phục vụ ngay từ server: máy tính mở trình duyệt, iPhone mở Safari bằng URL LAN. Đây là con đường ít ma sát nhất để hỗ trợ hai chiều.
3. **HTTP streaming trực tiếp**: upload `POST` với body binary, download streaming có Range, hash SHA-256 trong lúc ghi. Không multipart để tránh buffering.
4. **Pairing code 6 chữ số + cookie phiên**, rate-limit đăng nhập, tên file được canonicalize và lưu ngoài thư mục static. LAN không được xem là biên bảo mật.
5. **SSE** thông báo file mới/xóa cho các trình duyệt khác; không cần WebSocket dependency.
6. Discovery tự động qua mDNS/Bonjour và giao thức LocalSend sẽ là milestone sau; MVP hiển thị tất cả địa chỉ IPv4 LAN để vẫn hoạt động trên mạng chặn multicast.

## 3. Phạm vi đã triển khai

- Khởi động bằng `npm start`, cổng mặc định `8787`.
- Tự tạo thư mục `shared/`, mã PIN in rõ trong console; có thể đặt `LAN_SHARE_CODE`, `PORT`, `SHARE_DIR`, `DEVICE_NAME`.
- Đăng nhập PIN, cookie phiên; nút ngắt kết nối hiện chưa thu hồi session ở server.
- Kéo/thả, chọn nhiều file, upload song song có progress; chưa có cancel trong giao diện.
- Danh sách file cập nhật theo SSE, download, xóa, hiển thị kích thước/thời gian/hash ngắn.
- Chat text hai chiều trong LAN qua `POST /api/messages` + SSE, giữ tối đa 200 tin nhắn gần nhất trong bộ nhớ server.
- Giới hạn file, kiểm tra Content-Length, file tạm + rename nguyên tử, tránh path traversal/đụng tên.
- Download hỗ trợ `Range`, `ETag`, `Last-Modified`, `Content-Disposition`.
- PWA manifest/service worker, giao diện dùng được trên màn hình nhỏ.
- Test tích hợp bằng `node --test` cho auth, upload, download range, hash và path safety.

## 4. Luồng sử dụng

1. Máy chủ chạy `npm start`; console hiển thị PIN và URL LAN.
2. Thiết bị cùng Wi-Fi mở một URL LAN, nhập PIN một lần.
3. Chọn/kéo file vào vùng upload. Dữ liệu đi thẳng tới máy chủ LAN và hiển thị tiến độ.
4. Các thiết bị đã mở trang nhận sự kiện file mới; nhấn Download để lấy file về máy.

## 5. Bảo mật và độ tin cậy

- PIN chỉ là lớp pairing thuận tiện, không thay thế TLS trên mạng không tin cậy; hướng production là HTTPS với chứng chỉ/self-signed fingerprint hoặc LocalSend protocol.
- Không tin tên file từ client; chỉ lưu basename đã lọc, giới hạn độ dài/ký tự và không cho ghi ra ngoài `SHARE_DIR`.
- Server tính SHA-256 sau upload; chưa có đối chiếu digest nguồn ở client. Luồng upload lỗi có cleanup `.part`, cần kiểm thử thêm lỗi I/O và crash.
- Session token ngẫu nhiên, HttpOnly/SameSite, không log token; rate-limit PIN thất bại.
- File chưa hoàn tất không xuất hiện trong danh sách; restart vẫn đọc lại metadata từ disk.

## 6. Roadmap sau MVP

1. mDNS/Bonjour (và UDP discovery tương thích LocalSend) để hiện thiết bị tự động.
2. HTTPS tự ký + fingerprint/QR để chống MITM khi dùng ngoài mạng gia đình.
3. Resume upload theo chunk/session, checksum từng chunk, pause/resume.
4. Native shell Tauri 2 cho Windows/macOS/Linux; iOS wrapper dùng URLSession/Bonjour nếu cần app native.
5. Tùy chọn WebRTC P2P cho hai browser và TURN chỉ khi không thể kết nối trực tiếp.
6. Benchmark LAN 1/2.5/10Gbps, test iOS background, firewall, IPv6-only và mạng bật client isolation.

## 7. Tiêu chí nghiệm thu

- Hai browser trên cùng LAN có thể upload/download hai chiều với file lớn hơn RAM máy.
- File tải xuống có SHA-256 giống file nguồn; file trùng tên không ghi đè.
- Thiết bị di động không cần cài app; layout và thao tác chọn file hoạt động trên Safari.
- Máy chủ vẫn phản hồi tốt khi nhiều upload đồng thời; lỗi/mất kết nối không để lại file hỏng trong danh sách.
- `npm test` và smoke test HTTP chạy thành công.
