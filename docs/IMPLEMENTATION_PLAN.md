# Kế hoạch triển khai bản open source đầu tiên

Chủ dự án đã đồng ý lộ trình ngày 03-11-2026. Giấy phép được chọn theo đề xuất: **Apache-2.0**. Đích phát hành: `hieunguyenak92/MCKLTransfer`, bản `0.2.0-alpha.1`.

## Phạm vi

Hoàn thiện bản LAN có kiểm soát quyền, HTTPS cấu hình được và hỗ trợ nhóm riêng qua overlay; sửa toàn bộ lỗi đã xác minh; thêm truyền có resume/cancel/integrity và hàng đợi có giới hạn; tạo bản nguồn sạch, CI và quy trình phát hành. Giữ kiến trúc Node stdlib, tránh thêm dependency runtime.

WebRTC, discovery native, screen sharing và điều khiển hệ điều hành là các giai đoạn sau trong nghiên cứu đã thống nhất. Lần phát hành này cần tài liệu nêu rõ chúng chưa có; không quảng bá như tính năng đã triển khai.

## Thứ tự và phân công

1. Khóa các lỗi hiện có bằng regression test chạy đỏ trên source ban đầu.
2. Server: storage/manifest an toàn, stream error/abort, logout/SSE expiry, Host/Origin, quyền xóa, session thiết bị, quota và HTTPS.
3. Transfer: upload session theo offset, bounded chunks, checksum, phục hồi sau restart, cancel/expiry, commit nhất quán.
4. UI: hàng đợi toàn ứng dụng, pause/resume/cancel/retry, hash incremental, tiến độ/tốc độ/ETA, quyền và quản lý thiết bị.
5. Release: Apache-2.0, CI, syntax/security/source checks, archive allowlist/checksum và cập nhật tài liệu theo hành vi thật.
6. Kiểm thử tích hợp, review độc lập, kiểm tra browser và benchmark có điều kiện được ghi rõ; kiểm tra artifact cuối.
7. Xác minh tài khoản và remote; tạo repository, bật thiết lập phù hợp và phát hành alpha khi các cổng đã đạt. Không đưa dữ liệu runtime hoặc credential lên GitHub.

Các agent làm test, UI và release độc lập; server/storage do agent chính tích hợp. Không có hai agent sửa cùng file.

## Tiêu chí nghiệm thu

| Cổng | Bằng chứng cần có |
|---|---|
| Không lộ dữ liệu riêng trong source/artifact | Scan snapshot cuối; allowlist archive; đọc lại member list; checksum; không chứa shared/config riêng/symlink |
| Các lỗi đã biết được sửa | Regression đi đỏ trên bản cũ, xanh trên bản sửa; original lifecycle xanh |
| Phiên và quyền | Logout/revoke/expiry kết thúc API và SSE; peer không xóa file người khác; config công khai không có PIN/hostname/interface |
| File không bị ghi sai | Tên dài/trùng/Unicode/reserved; lỗi I/O/abort; digest mismatch bị từ chối; không có manifest bị ghi đè |
| Resume và giới hạn tài nguyên | Offset sau mất kết nối/restart đúng; sai owner/offset bị từ chối; quota/concurrency/expiry/cancel hoạt động; không giữ toàn file trong RAM |
| HTTPS và overlay | TLS test bằng CA fixture tin cậy; cookie Secure; tài liệu trust/reverse proxy/overlay chính xác; không tự bỏ qua cảnh báo TLS |
| UI | Thử browser: auth, upload, pause/resume/cancel, queue, chat, logout, quyền xóa; hash test vector và boundary |
| Hiệu năng | Benchmark có payload/time/hash/RSS; phân biệt localhost với LAN; chưa đo thiết bị nào phải ghi rõ |
| Pháp lý và phát hành | LICENSE nguyên văn, SPDX, policy cập nhật, CI và source artifact; xác minh đúng account/repo/visibility trước công bố |

Không thể cam kết đúng 100% bằng một lần kiểm thử. Chỉ đánh dấu hoàn thành từng cổng khi có bằng chứng phù hợp, giữ các giới hạn chưa kiểm chứng và phụ thuộc thiết bị/tài khoản thành việc còn lại.
