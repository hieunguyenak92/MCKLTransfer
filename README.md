# MCKL Transfer

Chia sẻ file và chat qua máy chủ riêng trong LAN, hoặc giữa các thiết bị được cho phép trong mạng overlay. Chỉ máy chủ cần Node.js; các thiết bị còn lại mở trình duyệt. Không có tài khoản cloud của MCKL, analytics, database hay dependency npm runtime.

**0.2.0-alpha.1 · Apache-2.0 · thử nghiệm.** Xem [kết quả xác minh](docs/VALIDATION.md) và [mô hình bảo mật](SECURITY.md) trước khi triển khai. Chưa có cam kết hỗ trợ ổn định hoặc tốc độ LAN trên mọi thiết bị.

## Chạy nhanh trong mạng tin cậy

Cài Node.js **24 từ 24.22.2**, hoặc **26 từ 26.13.0**, đã cập nhật bản vá. Trong thư mục source:

```sh
npm start
```

Không cần `npm install`. Terminal hiển thị địa chỉ LAN, mã truy cập 6 số và **mã quản trị riêng**. Mở địa chỉ LAN trên thiết bị khác, đặt tên thiết bị và nhập mã truy cập. Chỉ cung cấp mã quản trị cho người quản lý máy chủ. Các mã không xuất hiện qua API, kể cả localhost.

Mặc định HTTP không mã hóa: chỉ dùng trên mạng bạn kiểm soát với những người tin cậy. Dùng HTTPS hoặc overlay được kiểm soát cho kết nối khác. Không chuyển tiếp cổng này từ router ra Internet.

### Cách sử dụng

- Chọn/kéo nhiều file; hàng đợi toàn ứng dụng truyền tối đa hai file cùng lúc, có tốc độ, ETA, tạm dừng, tiếp tục, thử lại và hủy.
- Sau mất mạng hoặc tải lại trang, chọn lại đúng file để tiếp tục. Cần giữ cookie của thiết bị và upload chưa hết hạn. Trình duyệt không tự giữ quyền đọc file sau khi đóng trang.
- Trước khi gửi, trình duyệt đọc nguồn để tính SHA-256; từng chunk và file hoàn tất được đối chiếu tại host. Bước hash là một lượt đọc bổ sung, có thể chậm trên thiết bị yếu. Không giữ cả file trong RAM.
- File hoàn tất xuất hiện trong danh sách chung; mọi thành viên đã đăng nhập có thể tải xuống. Thành viên chỉ xóa file do mình gửi; quản trị viên xóa được mọi file và thu hồi phiên thiết bị.
- Chat chung giữ tối đa 200 tin trong RAM; mất khi khởi động lại host. Giữ trang mở khi truyền, nhất là trên điện thoại. PWA không đảm bảo truyền nền hay tiếp tục khi iOS khóa màn hình.

Đây là mô hình **browser A → host lưu file → browser B tải về**. “Upload hoàn tất” nghĩa là host đã nhận và xác minh; không có nghĩa B đã tải/lưu file. Host đọc được cả file và chat; chưa có E2EE hoặc phòng riêng theo người nhận.

## Cấu hình

Ứng dụng đọc biến môi trường của tiến trình; không tự nạp `.env`. Dung lượng tính bằng byte, thời gian bằng millisecond.

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `HOST`, `PORT` | `0.0.0.0`, `8787` | Interface và cổng lắng nghe; mặc định IPv4 |
| `SHARE_DIR` | `./shared` cạnh source | Thư mục dữ liệu riêng, nên đặt ngoài repository |
| `DEVICE_NAME` | hostname | Tên host, chỉ hiện sau đăng nhập và trong terminal |
| `SHARE_CODE` | 6 số ngẫu nhiên mỗi lần chạy | Mã thành viên; `LAN_SHARE_CODE` vẫn được nhận để tương thích |
| `ADMIN_CODE` | Ngẫu nhiên riêng mỗi lần chạy | Tối thiểu 24 ký tự; giữ bí mật |
| `MAX_FILE_SIZE` | `21474836480` (20 GiB) | Giới hạn mỗi file |
| `MAX_TOTAL_SIZE` | `107374182400` (100 GiB) | Tổng file hoàn tất và dung lượng upload đã đặt trước |
| `MIN_FREE_SPACE` | `134217728` (128 MiB) | Dung lượng ổ trống dự phòng; không phải disk quota của OS |
| `CHUNK_SIZE` | `4194304` (4 MiB) | Tối đa 16 MiB mỗi request upload chunk |
| `MAX_CONCURRENT_UPLOADS` | `4` | Số tác vụ ghi/hash upload đồng thời ở server |
| `MAX_PENDING_UPLOADS` | `128` | Số upload dở được giữ |
| `UPLOAD_TTL_MS` | `86400000` (24 giờ) | Hạn tuyệt đối từ lúc tạo upload dở |
| `SESSION_TTL_MS`, `MAX_DEVICES` | `43200000` (12 giờ), `128` | Phiên thường và tổng phiên thiết bị; ghi nhớ có hạn 30 ngày |
| `REQUEST_TIMEOUT_MS` | `1800000` (30 phút) | Thời gian nhận một request; socket không hoạt động 60 giây bị ngắt |
| `TLS_KEY_FILE`, `TLS_CERT_FILE` | Không đặt | Cặp private key/chứng chỉ PEM cho HTTPS trực tiếp |
| `PUBLIC_URL` | Không đặt | Origin ngoài của proxy, ví dụ `https://transfer.example.org`; không path/query |
| `ALLOWED_HOSTS` | Hostname/interface cục bộ | Thêm hostname/IP cụ thể, phân cách dấu phẩy; không wildcard hay port |

Ví dụ PowerShell, dùng thư mục dữ liệu riêng:

```powershell
$env:SHARE_DIR = "D:\MCKL-data"
$env:DEVICE_NAME = "Home transfer host"
npm start
```

Mã đổi sau restart không thu hồi phiên đã cấp. Dùng bảng quản lý thiết bị để revoke; nếu lộ PIN, đổi PIN **và** thu hồi những phiên không tin cậy. Cookie và quyền sở hữu file được giữ qua restart. Đăng xuất/xóa cookie rồi ghép đôi lại tạo danh tính mới; quản trị viên vẫn xóa được file cũ.

## HTTPS và kết nối khác mạng

### HTTPS trực tiếp

Cấp chứng chỉ có SAN khớp đúng hostname/IP đang dùng, từ CA mà mọi thiết bị tin cậy. Đặt key ngoài source, hạn chế quyền đọc, rồi cấu hình cả hai biến:

```sh
TLS_KEY_FILE=/secure/mckl/server.key TLS_CERT_FILE=/secure/mckl/server.pem npm start
```

Mở URL `https://...` tương ứng. Không bỏ qua lỗi xác minh chứng chỉ. Chứng chỉ tự ký cần quy trình cài trust CA/fingerprint qua kênh tin cậy; app chưa tự động pairing chứng chỉ. Cookie HTTPS có `Secure`, `HttpOnly`, `SameSite=Strict`.

### Nhóm riêng qua Tailscale hoặc WireGuard

Cài overlay trên các thiết bị, cấp quyền đúng thành viên và giới hạn cổng dịch vụ. Giữ xác thực của MCKL. Với WireGuard, bạn tự quản lý khóa, routing, firewall và DNS; với Tailscale, kiểm tra policy và đường direct/relay. Dải IP riêng không tự chứng minh thiết bị đáng tin cậy.

Một lựa chọn HTTPS cho tailnet là [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve). Sau khi có tên DNS của host và đã cấu hình HTTPS trong tailnet, chạy MCKL chỉ trên loopback với origin đó:

```sh
HOST=127.0.0.1 PUBLIC_URL=https://YOUR-HOST.YOUR-TAILNET.ts.net npm start
```

Trong terminal khác:

```sh
tailscale serve --bg http://127.0.0.1:8787
tailscale serve status
```

Mở đúng HTTPS URL Serve cấp. Dịch vụ này dành cho tailnet; giới hạn access policy của bạn. Xem [CLI Serve](https://tailscale.com/docs/reference/tailscale-cli/serve) cho điều kiện và cách tắt. MCKL không tự cài hoặc cấu hình Tailscale, và chưa được kiểm thử trên tailnet thật trong đợt phát hành này.

Reverse proxy khác cần chuyển tiếp stream/SSE không buffer, giữ Host hoặc đặt `PUBLIC_URL` đúng, cấu hình timeout/body size phù hợp, giới hạn upstream vào proxy tin cậy. App không tin `X-Forwarded-*` để xác định an toàn kết nối.

## Dữ liệu, nâng cấp và sao lưu

Host giữ `.mckl-manifest.json`, `.mckl-devices.json` (hash token phiên), `.mckl-uploads.json` và `.mckl-objects/` trong `SHARE_DIR`. Payload mới lưu theo ID; tên hiển thị nằm trong manifest. Không chỉnh sửa/xóa file nội bộ khi server chạy. Không chạy hai tiến trình trên cùng `SHARE_DIR`.

Dừng host trước khi sao lưu **toàn bộ** thư mục dữ liệu. Backup chứa file và quyền truy cập của nhóm, cần được bảo vệ. Bản alpha đọc manifest MVP cũ với regular file hợp lệ; không tự chuyển payload cũ sang object storage. File cũ không có owner chỉ quản trị viên xóa được. Sao lưu trước nâng cấp; downgrade không được hỗ trợ sau khi định dạng manifest mới được ghi.

Chỉ dùng filesystem cục bộ đáng tin cậy với ACL chặt. Upload dở hết hạn được dọn; file hoàn tất không tự xóa. Chưa kiểm chứng network drive, đồng bộ cloud thư mục dữ liệu, mất điện thực hoặc storage phần cứng. Atomic rename/fsync không phải cam kết chống mọi hỏng hóc.

## Nếu thiết bị khác không kết nối được

Chọn URL IPv4 LAN in trong terminal; cùng Wi-Fi và tránh guest/AP isolation. Kiểm tra firewall chỉ mở cổng cho mạng/thiết bị cần dùng. Kiểm tra health trên máy khác, thay địa chỉ mẫu:

```sh
curl --connect-timeout 5 http://192.168.1.10:8787/api/health
```

Đúng là `{"ok":true}`. Timeout thường cần kiểm tra routing/firewall; `403` cần kiểm tra hostname/Origin và `ALLOWED_HOSTS`/`PUBLIC_URL`. Không thêm wildcard để sửa lỗi. Trình duyệt có thể hỏi quyền truy cập mạng cục bộ.

## Phát triển, kiểm thử và phát hành

```sh
npm run check
npm test
npm run release:check
npm run release:source
```

Source exporter chỉ lấy danh sách cho phép, kiểm tra lại archive và ghi SHA-256 vào `release/`. Không zip toàn bộ thư mục đang dùng. `.gitignore` không loại file khỏi ZIP của Finder và không gỡ dữ liệu đã commit. Giữ `private: true` để tránh publish npm nhầm; source vẫn được cấp phép Apache-2.0.

- [Đóng góp](CONTRIBUTING.md), [bảo mật](SECURITY.md), [checklist phát hành](docs/RELEASE_CHECKLIST.md).
- [Giao thức alpha](docs/PROTOCOL.md), [bằng chứng và giới hạn xác minh](docs/VALIDATION.md).
- [Kiến trúc](docs/research/architecture.md), [hiệu năng](docs/research/performance.md), [giấy phép và roadmap](docs/research/license-and-roadmap.md).

Discovery/QR, WebRTC, clipboard theo thao tác, folder transfer và screen sharing là roadmap. Full remote desktop cần native agent và mô hình consent riêng; bản này chưa có remote control.

## Giấy phép

[Apache License 2.0](LICENSE). Copyright 2026 hieunguyenak92; xem [NOTICE](NOTICE). Cho phép sử dụng, sửa đổi và phân phối theo điều khoản giấy phép, gồm sử dụng thương mại. Giữ LICENSE/NOTICE và ghi nhận thay đổi theo điều khoản áp dụng. Không có bảo hành.
