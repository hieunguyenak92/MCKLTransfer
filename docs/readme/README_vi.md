<div align="center">

[English](../../README.md) · [简体中文](README_zh-CN.md) · [日本語](README_ja.md) · **Tiếng Việt** · [ไทย](README_th.md) · [Español](README_es.md) · [Português](README_pt.md)

# MCKL Transfer

### Thiết bị của bạn. Dữ liệu của bạn. Kết nối theo cách của bạn.

Chuyển thư mục từ laptop. Để lại file cho người nhận đang offline. Gửi thẳng tới trình duyệt bên cạnh. Bạn nắm quyền quản lý máy chủ và cách dữ liệu được chia sẻ.

**Tự host · Dùng bằng trình duyệt · Truyền có resume · Inbox riêng · WebRTC thử nghiệm**

[Tải source](https://github.com/hieunguyenak92/MCKLTransfer/releases/latest) · [Bắt đầu](#mở-lên-và-chia-sẻ) · [Cấu hình](../CONFIGURATION.md) · [Star trên GitHub](https://github.com/hieunguyenak92/MCKLTransfer)

</div>

MCKL Transfer biến một máy tính thành không gian chia sẻ cho các thiết bị của bạn và một nhóm nhỏ tin cậy. Chạy host, mở địa chỉ trên thiết bị khác và bắt đầu gửi. Các thiết bị dùng trình duyệt; chỉ host cần Node.js. Không cần tài khoản cloud của MCKL, analytics hay cài dependency npm runtime.

**Phiên bản 0.5.0 · Apache-2.0.** Chia sẻ qua hub dùng HTTP(S); truyền thẳng giữa trình duyệt là tính năng thử nghiệm, có yêu cầu trình duyệt cụ thể. Xem [bằng chứng kiểm thử](../VALIDATION.md) để biết phạm vi đã được xác minh.

## Giải quyết những việc nhỏ giữa nhiều thiết bị

| Bạn cần | MCKL mang lại |
|---|---|
| “Chuyển file này sang máy kia.” | Kéo thả, tiến độ, tốc độ, ETA, tạm dừng, thử lại và tiếp tục theo chunk. |
| “Họ sẽ lấy file sau.” | Hub giữ file; người nhận tải khi host còn hoạt động. |
| “Chỉ gửi cho người này.” | Inbox theo người nhận hoặc phòng có thành viên cụ thể; server kiểm tra quyền truy cập. |
| “Cho thiết bị này tham gia.” | QR/link tạo ngay tại host, dùng một lần và có hạn; có thể yêu cầu host duyệt. |
| “Chuyển cả thư mục dự án.” | Giữ đường dẫn tương đối khi chọn thư mục; tải nhiều file bằng archive `.tar` theo luồng. |
| “Gửi thẳng giữa hai trình duyệt.” | WebRTC tùy chọn, người nhận đồng ý, hai đầu so mã xác nhận và ghi dữ liệu xuống đĩa. |
| “Biết file đã tới đâu.” | Lịch sử theo quyền truy cập, biên nhận khi lưu có xác minh và thông tin đường direct/relay. |
| “Giữ host chạy gọn gàng.” | Quota byte/số file theo thiết bị, giới hạn download, hết hạn, thu hồi thiết bị và khóa một tiến trình ghi. |

Giới hạn mặc định là **20 GiB/file**, host có thể điều chỉnh. File lớn qua hub được truyền theo chunk có giới hạn bộ nhớ. SHA-256 của nguồn, từng chunk và file hoàn tất giúp phát hiện sai lệch dữ liệu. Thử lại bước hoàn tất không xuất bản file trùng; lease upload điều phối quyền thao tác giữa các tab.

## Mở lên và chia sẻ

Cài Node.js đã cập nhật bản vá: **24 từ 24.22.2** hoặc **26 từ 26.13.0** (`^24.22.2 || ^26.13.0`).

```sh
git clone https://github.com/hieunguyenak92/MCKLTransfer.git
cd MCKLTransfer
npm start
```

Không cần chạy `npm install`.

1. Đọc địa chỉ LAN và mã truy cập trong terminal.
2. Mở địa chỉ đó trên thiết bị khác, đặt tên thiết bị và nhập mã 6 số.
3. Chọn không gian chung, người nhận trong inbox hoặc phòng riêng. Thả file, chọn thư mục hoặc gửi chat.

Terminal còn hiển thị **mã quản trị riêng**. Dùng mã này để quản lý thiết bị, tạo phòng và lời mời; giữ bí mật. Bật duyệt thiết bị thành viên mới bằng:

```sh
REQUIRE_APPROVAL=1 npm start
```

Trong bảng quản trị, tạo **lời mời 10 phút** rồi quét QR trên thiết bị còn lại. Mỗi lời mời dùng một lần; nếu bật duyệt, thiết bị chờ quản trị viên chấp nhận. QR được tạo tại máy và lời mời mất hiệu lực khi host dừng.

**HTTP mặc định truyền mã truy cập và nội dung file không mã hóa.** Chỉ dùng trên mạng tin cậy. Cấu hình HTTPS được các thiết bị tin cậy cho dữ liệu nhạy cảm và truyền trực tiếp; dùng Tailscale/WireGuard có kiểm soát quyền khi kết nối khác mạng. [Ví dụ triển khai và toàn bộ cấu hình →](../CONFIGURATION.md)

## Hai cách chuyển file hữu ích

### Để file trên hub của bạn

Gửi một lần để người nhận lấy sau. Host cần hoạt động khi người nhận tải xuống. Tìm kiếm trong không gian hiện tại, chọn nhiều file để tải archive và đặt hạn tự xóa khi không cần giữ lâu.

Sau mất mạng hoặc tải lại trang, chọn lại **đúng file nguồn** để tiếp tục phần đã được xác nhận. Cần giữ cookie, bản ghi resume và upload chưa hết hạn. Tab đang giữ lease sẽ ngăn tab khác sửa cùng upload cho tới khi nhả lease hoặc đủ điều kiện chuyển quyền. Giữ trang mở khi truyền, đặc biệt trên điện thoại.

Không gian chung cho các thành viên đã được phép đọc. File inbox riêng chỉ hiển thị cho người gửi, người nhận và quản trị viên host; phòng tùy chọn giới hạn các thành viên khác theo danh sách phòng. **Host được tin cậy và đọc được file/chat lưu trên hub.** Phân quyền này không phải mã hóa đầu cuối chống lại host.

### Gửi trực tiếp khi hai thiết bị đều online

Chọn người nhận rồi bấm **Gửi trực tiếp WebRTC**. Người nhận đồng ý và chọn nơi lưu. So sánh mã xác nhận trên hai thiết bị qua kênh tin cậy, sau đó cả hai cùng xác nhận trước khi nội dung file được gửi.

Máy nhận ghi từng chunk xuống đĩa và đối chiếu checksum. Giao diện báo đường WebRTC quan sát được khi trình duyệt cung cấp thống kê; TURN do bạn cấu hình có thể chuyển tiếp lưu lượng mã hóa khi không nối trực tiếp được. Mặc định không dùng dịch vụ STUN/TURN bên ngoài.

**Điều kiện:** HTTPS hoặc localhost, WebRTC và trình duyệt nhận hỗ trợ `showSaveFilePicker`—thường là Chromium trên desktop. Địa chỉ IP LAN qua HTTP không phải secure context. Safari/điện thoại vẫn dùng luồng hub; chưa cam kết nhận trực tiếp trên các thiết bị đó. Nếu truyền trực tiếp lỗi, người gửi có thể chủ động chọn gửi qua hub, tức lưu thêm bản sao tại host. App không âm thầm đổi chính sách lưu trữ.

Mã so sánh xác minh kết nối của phiên này khi người dùng kiểm tra. Nó không bảo vệ client do host bị xâm nhập cung cấp và không tạo danh tính thiết bị vĩnh viễn.

## Những chi tiết giúp việc chia sẻ dễ chịu hơn

- **Thư mục và batch:** kiểm tra đường dẫn tương đối; payload lưu bằng ID nội bộ. Tải TAR theo luồng, tối đa 100 file được chọn mỗi request. Không lưu thư mục rỗng.
- **Hạn lưu:** giữ file hoặc chọn một giờ, một ngày, bảy ngày trong UI. File hết hạn không còn truy cập được và host dọn theo lịch; lịch sử có hạn riêng.
- **Trạng thái nhận rõ ràng:** upload xong nghĩa là host đã xác minh. Download thường không chứng minh OS đã lưu file; trình duyệt hỗ trợ có thao tác lưu và đối chiếu checksum kèm biên nhận.
- **Ngôn ngữ quen thuộc:** đổi **Tiếng Việt / English** không tải lại trang. README có bảy ngôn ngữ ở đầu trang.
- **Đường mạng của bạn:** phép đo trong app kiểm tra đúng đường browser–host hiện tại. Tốc độ phụ thuộc thiết bị, ổ đĩa, hash, Wi-Fi và tuyến truyền; không có một thiết lập “nhanh nhất” cho mọi nơi.

Chat giữ tối đa 200 tin trong RAM host và mất khi restart. PWA cache giao diện ứng dụng; không đảm bảo upload nền, tiếp tục khi iPhone khóa màn hình hay nhận file khi host tắt. MCKL Transfer không điều khiển desktop của thiết bị khác.

## Vận hành và nâng cấp

Dùng filesystem cục bộ đáng tin cậy, ưu tiên đặt dữ liệu ngoài thư mục source. **Dừng host sạch và sao lưu toàn bộ thư mục dữ liệu trước khi nâng cấp.** Không dự kiến hạ cấp metadata mới về phiên bản cũ. File chung hiện có vẫn là file chung; phòng riêng được tạo rõ ràng.

Restart sạch giữ phiên còn hạn và quyền sở hữu. Sau lần dừng bất thường, cơ chế khôi phục phiên từ chối trạng thái cũ để bảo vệ quyền truy cập; thiết bị phải ghép đôi lại và có owner ID mới. Inbox/upload cũ có thể cần quản trị viên khôi phục. Bảo vệ backup và mã quản trị tương ứng.

Khóa storage ngăn hai host ghi cùng thư mục. Có thể phục hồi owner local đã xác nhận process chết; lock mơ hồ hoặc hỏng sẽ bị từ chối. Không xóa lock khi host có thể vẫn chạy. Xem [cấu hình và phục hồi](../CONFIGURATION.md#data-upgrades-and-recovery).

Nếu sau nâng cấp thấy màn hình recovery hoặc giao diện cũ, kết nối lại host và reload; hard refresh nếu shell cũ còn được cache. Đừng tùy tiện xóa cookie khi cần resume upload.

## Cùng xây dựng MCKL Transfer

```sh
npm run check
npm test
npm run release:check
npm run release:source
```

Công cụ export tạo archive source theo allowlist và SHA-256 trong `release/`. Tránh nén toàn bộ thư mục làm việc cùng dữ liệu runtime hoặc thông tin truy cập.

[Đóng góp](../../CONTRIBUTING.md) · [Báo lỗi bảo mật](../../SECURITY.md) · [Giao thức](../PROTOCOL.md) · [Kiểm chứng](../VALIDATION.md) · [Nghiên cứu nâng cấp](../research/upgrade-audit-2026-11.md)

Nếu MCKL Transfer giúp bạn bớt một lần upload cloud hoặc tìm dây cáp, **[hãy tặng dự án một star](https://github.com/hieunguyenak92/MCKLTransfer)**. Một lỗi tái hiện được, kết quả thử trình duyệt hay đóng góp nhỏ đều giúp việc chuyển qua lại giữa các thiết bị nhẹ nhàng hơn.

## Giấy phép

[Apache License 2.0](../../LICENSE), bản quyền 2026 hieunguyenak92. Được sử dụng thương mại, sửa đổi và phân phối theo điều khoản; giữ các notice bắt buộc. Thư viện QR đi kèm có giấy phép MIT; xem [NOTICE](../../NOTICE). Không có bảo hành.
