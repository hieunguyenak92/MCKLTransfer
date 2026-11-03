# MCKLTransfer — đánh giá trước open source

> **Trạng thái mới — 03-11-2026, sau triển khai `0.2.0-alpha.1`:** chủ dự án đã chọn **Apache-2.0**. Runtime, UI và quy trình đóng gói đã được sửa. Phần nghiên cứu ban đầu bên dưới được giữ nguyên để lưu bằng chứng; các câu “chưa sửa/chưa có LICENSE/1 test” trong phần đó mô tả snapshot trước triển khai. Trạng thái sử dụng nằm ở [README](../README.md), kế hoạch được duyệt ở [IMPLEMENTATION_PLAN](IMPLEMENTATION_PLAN.md), kết quả và các cổng còn lại ở [VALIDATION](VALIDATION.md).

## Cập nhật sau triển khai

| Hạng mục | Hiện trạng trong source alpha |
|---|---|
| Giấy phép | Có `LICENSE` Apache-2.0 nguyên văn, `NOTICE`, SPDX trong package và hướng dẫn đóng góp; dùng danh tính công khai `hieunguyenak92` |
| Correctness/storage | Tách payload theo ID khỏi tên hiển thị; chặn namespace nội bộ; reservation tên có giới hạn; quản lý stream/error/abort; journal phục hồi và commit không ghi đè |
| Phiên và quyền | Đăng xuất/revoke/expiry đóng API/SSE; cookie thiết bị và owner giữ qua restart; peer chỉ xóa file của mình, admin có mã riêng và quản lý thiết bị |
| Biên HTTP và HTTPS | Không trả PIN/hostname/interface trước auth; kiểm tra Host/Origin; HTTPS cấu hình được; cookie Secure trên HTTPS; tài liệu trust và reverse proxy |
| Truyền đáng tin cậy | Upload theo offset, checksum chunk/toàn file, resume sau restart khi giữ cookie/file nguồn, cancel/expiry, quota và giới hạn tác vụ |
| UI | Hàng đợi toàn ứng dụng, pause/resume/retry/cancel, hash nguồn incremental, tốc độ/ETA và quyền quản trị |
| Chuẩn bị release | Source exporter có allowlist, manifest/checksum và kiểm tra archive; CI được cấu hình cho ba OS và hai nhánh Node; có benchmark tổng hợp |

Các regression bảo mật, storage, TLS, API, client/hash và release đã có trong `test/`. Kết quả cuối trên đúng snapshot sẽ được ghi ở [VALIDATION](VALIDATION.md); có cấu hình CI không đồng nghĩa workflow đã chạy trên GitHub. Checklist thực thi hiện tại nằm ở [RELEASE_CHECKLIST](RELEASE_CHECKLIST.md).

**Phạm vi alpha:** hub tin cậy vẫn đọc được file/chat; mọi thành viên đăng nhập đọc không gian chung. Có identity phiên bền vững, chưa có pairing bằng khóa công khai, E2EE hay phòng riêng từng người nhận. HTTP chỉ dành cho mạng tin cậy; trust chứng chỉ và policy overlay do người triển khai cấu hình. Giao thức resume là API riêng được ghi ở [PROTOCOL](PROTOCOL.md), chưa tuyên bố tương thích tus.

Scanner snapshot/artifact cuối, browser, CI, LAN/overlay thực tế và phát hành phải có bằng chứng riêng. Không coi localhost, test qua adapter hay clean restart là xác minh Safari/iOS, tốc độ LAN hoặc khả năng chịu mất điện. Quyền cấp phép code/assets có nguồn bên ngoài vẫn cần xác nhận theo nguồn gốc thực tế.

---

## Hồ sơ nghiên cứu ban đầu — 03-11-2026, trước triển khai

Ngày hoàn tất nghiên cứu: **03-11-2026**. Tài khoản phát hành dự kiến: **`hieunguyenak92`**. Mục tiêu: chia sẻ file/chat riêng tư trong LAN và giữa các mạng cho một người hoặc nhóm nhỏ.

## 1. Kết luận

**Dự án có nền tảng MVP gọn và hợp lý, nhưng chưa nên phát hành như một công cụ chia sẻ riêng tư an toàn trên Internet hoặc một bản stable.** Cần làm sạch bản phân phối, chọn giấy phép, sửa các lỗi correctness/security đã tái hiện, rồi kiểm thử hai thiết bị thật.

Khuyến nghị kiến trúc:

1. **LAN:** giữ Node.js + HTTP streaming, hoàn thiện TLS/trust, session, quyền và resume. Không viết lại transport khi chưa có số đo.
2. **Khác mạng, một/vài người tin cậy:** dùng overlay WireGuard/Tailscale với policy giới hạn peer/cổng; giữ xác thực ứng dụng. Đây là lộ trình ngắn nhất theo nhu cầu hiện tại.
3. **Không muốn cài VPN, hai browser cùng online:** thêm WebRTC tùy chọn, signaling + STUN/TURN + pairing; duy trì fallback hub.
4. **Remote:** truy cập file từ xa trước; screen share sau; full remote control là module native riêng khi đã có identity, consent và revoke.
5. **Giấy phép:** đề xuất Apache-2.0 cho mục tiêu phổ biến rộng và cho phép sử dụng thương mại, có patent grant trong phạm vi điều khoản; MIT nếu ưu tiên tối giản. Đây chưa phải quyết định cấp phép đã áp dụng. [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0), [MIT](https://opensource.org/license/mit)

## 2. Những gì kiểm toán thực sự xác nhận

### 2.1 Phạm vi

- Đã đọc code server, UI, service worker, test, cấu hình package, ignore rules và tài liệu hiện có; kiểm tra cả tệp ẩn và symlink trong cây dự án.
- Thư mục **không có `.git`**: không thể kết luận lịch sử gốc, author email, nhánh/tag cũ hoặc các remote trước đây đã sạch.
- Không phát hiện credential thật được hardcode trong code/tài liệu đã đọc. Kiểm tra bổ sung một số mẫu khóa/token phổ biến không có hit. Điều này không phải chứng nhận “không còn mọi secret/PII”.
- Không có Gitleaks/TruffleHog trong môi trường; chưa chạy bộ scanner đầy đủ. Cần quét snapshot cuối và lịch sử nếu lấy lại repository gốc.
- Không thực hiện đăng nhập GitHub, tạo repo, commit, push, publish npm hay đổi quyền công khai. Tên repo dự kiến `hieunguyenak92/MCKLTransfer` chưa được xác minh tồn tại/quyền sở hữu.

### 2.2 Dữ liệu riêng tìm thấy

| Hạng mục | Kết quả | Xử lý trong lần này |
|---|---|---|
| README | Có địa chỉ LAN/overlay cụ thể trong ví dụ từ log | Thay bằng địa chỉ minh họa và ghi rõ phải dùng IP thật của từng máy |
| `shared/.mckl-manifest.json` | Có metadata một file cũ: tên, size, MIME, digest, timestamp; không còn payload file tương ứng trong thư mục hiện tại | Giữ dữ liệu tại máy, loại cả thư mục khỏi Git/npm/archive theo chính sách; không chép giá trị riêng vào báo cáo |
| `.DS_Store` ở root và `shared/` | Metadata Finder có thể lưu thông tin tên file/view | Bổ sung ignore/export rules; không đưa vào package |
| PIN `123456` trong test | Fixture kiểm thử; không có bằng chứng là credential dùng thật | Giữ fixture; bỏ hướng dẫn đặt PIN cố định trong README chạy nhanh |
| Source | Session/token sinh bằng crypto lúc chạy, không hardcode secret cloud; không thấy dependency runtime ngoài | Vẫn cần quản lý runtime, khóa/cert và dữ liệu phát sinh về sau |

**Không zip trực tiếp thư mục làm việc để đưa lên GitHub.** `.gitignore` không bảo vệ thao tác nén thủ công, file đã tracked hoặc lịch sử cũ. Dùng snapshot nguồn được stage tường minh và kiểm tra artifact cuối. [GitHub về ignore rules](https://docs.github.com/en/get-started/git-basics/ignoring-files)

## 3. Các lỗi cần sửa trước bản phát hành cho người dùng

Chi tiết điều kiện, chứng cứ, mức ưu tiên và giới hạn có trong [security audit](research/security-audit.md). Những lỗi nổi bật đã được tái hiện bằng dữ liệu tổng hợp:

| Vấn đề | Ảnh hưởng | Hướng sửa gốc |
|---|---|---|
| Hai upload trùng tên đủ dài 180 ký tự | Vòng lặp reservation có thể khóa event loop toàn server | Dành sẵn độ dài cho suffix, bảo đảm tên thay đổi và có điểm dừng |
| Upload dùng tên trùng manifest nội bộ | Nội dung upload bị ghi đè bằng metadata; digest trả về không còn đúng nội dung lưu | Tách namespace/storage key nội bộ khỏi tên hiển thị; cấm tên nội bộ |
| Stream lỗi mở/ghi file trước khi gắn handler | Tiến trình có thể thoát khi storage không ghi được | Quản lý trọn vòng đời stream, lỗi/abort/cleanup, commit/rollback nhất quán |
| Đăng xuất chỉ cố xóa cookie HttpOnly bằng JavaScript | Session server vẫn có quyền tới TTL; refresh có thể vào lại | Endpoint logout thu hồi token, server xóa cookie và ngắt session liên quan |
| SSE chỉ kiểm tra session lúc mở | Phiên hết hạn vẫn có thể tiếp tục nhận chat qua kết nối cũ | Ràng buộc connection với session, đóng khi expiry/logout/revoke |

Những ranh giới cần quyết định thêm: HTTP hiện không mã hóa; mọi client đã vào cùng host có quyền đọc/xóa chung; `/api/config` chưa auth lộ thông tin máy/mạng; quota tổng, số session, số upload và backpressure cho SSE chưa đầy đủ. Symlink trong thư mục dữ liệu và Host/Origin phải xét theo threat model; báo cáo không coi mọi rủi ro có điều kiện là khai thác từ Internet đã được chứng minh.

Một test lifecycle pass không bao phủ các trường hợp trên. Đề xuất regression tests cho từng root cause trước khi thông báo đã sửa.

## 4. Kiến trúc hiện đại nào phù hợp?

| Hướng | Phù hợp | Điểm phải hiểu đúng |
|---|---|---|
| LocalSend style HTTP(S) + native discovery | Truyền LAN không cloud, app native | Multicast không vượt mọi VLAN; thêm discovery không tự tạo tương thích protocol |
| Syncthing style device identity + block sync | Đồng bộ thư mục liên tục | Conflict/xóa/versioning khác với thao tác gửi file một lần |
| Hub hiện tại + overlay mã hóa | Nhóm nhỏ quen nhau, khác mạng | Hub vẫn đọc dữ liệu; overlay không tạo quyền theo người nhận hoặc E2EE khỏi hub |
| WebRTC | Browser P2P có NAT traversal | Signaling và TURN vẫn cần khi topology yêu cầu; DTLS cần được ràng buộc đúng peer qua pairing |
| WebTransport/QUIC | Browser ↔ server hoặc native transport đáng benchmark | Không tự là browser P2P, discovery hay NAT traversal |

Nguồn chính: [LocalSend protocol](https://github.com/localsend/protocol), [Syncthing security](https://docs.syncthing.net/users/security.html), [Tailscale connection types](https://tailscale.com/docs/reference/connection-types), [WebRTC peer connections](https://webrtc.org/getting-started/peer-connections), [WebTransport](https://developer.mozilla.org/en-US/docs/Web/API/WebTransport).

Cập nhật đáng chú ý khi nghiên cứu: WebTransport đã được MDN ghi Baseline 2026; Tailscale có cả Peer Relay bên cạnh DERP; Chrome đang dùng Local Network Access permission. Không dựa vào kết luận hỗ trợ browser đã cũ. Cần feature detection và kiểm thử đúng phiên bản thiết bị. [MDN WebTransport](https://developer.mozilla.org/en-US/docs/Web/API/WebTransport), [Tailscale Peer Relay](https://tailscale.com/docs/features/peer-relay), [Chrome LNA](https://developer.chrome.com/docs/modern-web-guidance/guides/security/local-network-access)

Xem [báo cáo kiến trúc](research/architecture.md) để có sơ đồ ba giai đoạn, so sánh trust boundaries, iroh/QUIC, discovery, Apple background transfer và các giới hạn browser.

## 5. Làm sao đạt tốc độ cao nhất có thể kiểm chứng?

Mục tiêu đúng là **goodput đã xác nhận ở đích trong điều kiện đại diện**, kèm integrity, RAM ổn định và phục hồi mất mạng. Chưa có benchmark LAN trong lần này nên không có cơ sở tuyên bố “nhanh nhất”.

Ưu tiên theo thứ tự:

1. Sửa lỗi treo/crash, timeout và giới hạn tài nguyên.
2. Đo trần mạng bằng iperf3, đo disk/hash/CPU, rồi đo end-to-end có mã hóa trên hai thiết bị thật.
3. Giảm chặng trung gian: nếu A và B đều là client của H, hiện cần A → H rồi H → B. P2P có thể bỏ bước lưu/đọc tại H khi hai đầu online; nếu B chính là host thì đã trực tiếp.
4. Thêm resume để lỗi mạng không buộc truyền lại toàn bộ. Thử chuẩn tus trước khi tự định nghĩa giao thức mới.
5. Thử concurrency 1/2/4, buffer và khả năng lưu ở receiver; chọn theo số đo, không tăng vô hạn.
6. Chỉ đổi transport/language khi profile chứng minh lợi ích. Không tắt TLS/checksum để làm benchmark đẹp.

Hiện code dùng buffer threshold 1 MiB, không phải packet/chunk mạng cố định. Node mặc định có request timeout; file lớn trên Wi-Fi chậm cần thiết kế resume/timeout rõ ràng. [Node streams](https://nodejs.org/api/stream.html), [Node HTTP](https://nodejs.org/api/http.html#serverrequesttimeout)

[Báo cáo hiệu năng](research/performance.md) có công thức giới hạn, các điểm nghẽn cụ thể trong code, lệnh iperf3, ma trận thiết bị/payload/failure và tiêu chí nghiệm thu.

## 6. Nên thêm gì ngoài file và chat?

| Thứ tự | Nhóm tính năng | Giá trị |
|---|---|---|
| 1 | Pairing thiết bị, identity bền vững, thu hồi session, TLS, quyền gửi/nhận/xóa | Nền tảng riêng tư cho nhiều người |
| 2 | Resume/cancel/retry, checksum phía nhận, quota/TTL/free-space check | Chuyển file lớn đáng tin cậy |
| 3 | Queue toàn ứng dụng, ETA/tốc độ, trạng thái received/saved, QR/URL, discovery có fallback | Dễ dùng và chẩn đoán lỗi |
| 4 | Gửi clipboard/link/note có thao tác đồng ý; folder transfer, preview an toàn | Mở rộng công việc hằng ngày |
| 5 | Screen share view-only | Hỗ trợ người thân với quyền từng phiên |
| 6 | Full remote control qua native agent/module riêng | Chỉ làm khi chấp nhận duy trì bảo mật và quyền OS lâu dài |

Không ưu tiên đồng bộ hai chiều tự động hoặc remote shell trong bản đầu. Browser screen capture không tự cấp quyền điều khiển bàn phím/chuột OS; remote full control cần agent và permission tương ứng. Nếu tích hợp mã dự án khác như RustDesk, phải rà giấy phép của chính thành phần đó. [getDisplayMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia), [RustDesk license](https://github.com/rustdesk/rustdesk/blob/master/LICENCE)

## 7. Giấy phép và quy trình public

**Đề xuất Apache-2.0.** Người khác được dùng, sửa, phân phối và thương mại hóa theo điều khoản; không bắt họ công khai mọi bản sửa. MIT ngắn gọn hơn. GPLv3 phù hợp mục tiêu copyleft khi phân phối; AGPLv3 thêm nghĩa vụ cung cấp source cho người tương tác mạng với bản sửa thuộc điều khoản, kể cả LAN. Không có giấy phép nào thay cơ chế bảo vệ dữ liệu người dùng. [Apache](https://www.apache.org/licenses/LICENSE-2.0), [GPLv3](https://opensource.org/license/gpl-3.0), [AGPLv3](https://opensource.org/license/agpl-3.0)

Chưa thêm `LICENSE` để tránh tự cấp quyền khi chủ sở hữu chưa chọn. Khi chốt, dùng nguyên văn license chuẩn, tên chủ bản quyền có quyền cấp phép, SPDX tương ứng và điều khoản contribution thống nhất. Xác minh quyền trên code/assets và notice của runtime nếu đóng gói binary. Public repo khi chưa có license chưa đồng nghĩa mọi người đã được quyền tái sử dụng như một dự án open source. [GitHub licensing](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository)

Trình tự đề xuất: **snapshot sạch → sửa lỗi và test → chọn license → review artifact → repo private dưới đúng owner → public → hoàn tất security settings → thông báo alpha**. Thiết lập nào dùng được ở private thì bật sớm; private vulnerability reporting chỉ bật khi repo đã public. Chi tiết lệnh và các cổng phát hành trong [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md); phân tích license và remote trong [license-and-roadmap.md](research/license-and-roadmap.md).

## 8. Thay đổi đã thực hiện trong workspace

- `.gitignore`: loại runtime data/manifest, file môi trường, khóa/cert, cấu hình cá nhân, log, archive và metadata OS thông dụng.
- `.gitattributes`: thêm `export-ignore` cho các nhóm nhạy cảm khi tạo Git archive; không thay kiểm tra Git index.
- `package.json`: thêm allowlist `files` cho package npm, vẫn giữ `private: true`. Đây không phải GitHub visibility setting.
- README: thay địa chỉ cụ thể bằng ví dụ, bỏ hướng dẫn PIN cố định, thu hẹp ví dụ firewall về Private profile, sửa mô tả buffer và ghi đúng trạng thái MVP.
- PLAN/RESEARCH: đánh dấu tài liệu ban đầu và sửa các khẳng định chưa có cancel/logout/integrity đầu cuối.
- Thêm báo cáo nghiên cứu, checklist, SECURITY và CONTRIBUTING. Hai policy này ghi rõ trạng thái chuẩn bị, không giả định license/kênh báo lỗi đã được bật.

Không sửa logic server/UI, không xóa dữ liệu chia sẻ tại máy và không công bố lên dịch vụ nào. Các lỗi runtime được ghi thành backlog đã xác minh; nghiên cứu này không tuyên bố chúng đã được sửa.

## 9. Xác minh và giới hạn

- `npm test`: **1 test lifecycle pass**, gồm auth, chat/SSE, upload, list/download/range/HEAD, file rỗng, upload tên trùng ngắn và delete. Sandbox chặn bind socket ban đầu; chạy lại với quyền cho phép test cục bộ thành công.
- `node --check` cho server, app và service worker: pass. Dự án chưa có lệnh lint/cấu hình linter riêng.
- Git index mô phỏng đặt trong thư mục tạm: ignore rules khớp 15 đường dẫn fixture, snapshot cuối có 21 file nguồn/tài liệu và không stage `shared/` hoặc `.DS_Store`. Không tạo `.git` trong dự án.
- Git archive từ snapshot mô phỏng không chứa runtime data. Thử riêng các fixture nhạy cảm đã bị force-track cũng xác nhận `export-ignore` loại chúng khỏi archive, đồng thời vẫn giữ `.env.example`. Kiểm tra 12 liên kết Markdown nội bộ: hợp lệ.
- `npm pack --dry-run --json --ignore-scripts`: chỉ có **8 file** gồm README, package metadata, server và 5 file giao diện; không có metadata/file chia sẻ hoặc cấu hình cá nhân.
- Các reproducer bảo mật dùng thư mục và payload tổng hợp; không dùng dữ liệu thật của người dùng.
- Chưa kiểm thử hiệu năng LAN, mobile background, TLS/trust, overlay, WebRTC/TURN, WebTransport hoặc remote; chưa có CI đa nền tảng và chưa quét Git history gốc.

Đề xuất này đủ để quyết định hướng phát triển và chuẩn bị bản nguồn sạch. Việc xác nhận một bản phát hành ổn định cần hoàn tất các cổng còn trống trong checklist, trên chính commit/artifact sẽ public.
