# Giấy phép, phát hành và lộ trình sản phẩm

> **Quyết định đã áp dụng — 03-11-2026:** chủ dự án chọn **Apache-2.0** cho `0.2.0-alpha.1`. Có [LICENSE](../../LICENSE) nguyên văn, [NOTICE](../../NOTICE), SPDX `Apache-2.0` trong `package.json`, README và CONTRIBUTING tương ứng. Bản so sánh/đề xuất ban đầu phía dưới được giữ như nghiên cứu lịch sử; các câu “chưa chọn/chưa có LICENSE” ở đó không còn mô tả source hiện tại.

## Trạng thái hiện tại và phần việc tiếp theo

Danh tính công khai trong notice/package là **hieunguyenak92**; đích dự kiến là `hieunguyenak92/MCKLTransfer`. `private: true` được giữ để tránh publish npm nhầm. Chưa suy ra quyền sở hữu repository, Git author, trạng thái CI hay việc phát hành từ các metadata này. Các cổng thực thi nằm trong [RELEASE_CHECKLIST](../RELEASE_CHECKLIST.md), bằng chứng ở [VALIDATION](../VALIDATION.md), phạm vi đã duyệt ở [IMPLEMENTATION_PLAN](../IMPLEMENTATION_PLAN.md) và hướng dẫn hiện tại ở [README](../../README.md).

| Hạng mục roadmap ban đầu | Hiện trạng alpha |
|---|---|
| Phiên thiết bị và quyền | Có ID/cookie bền qua restart, token hash, owner/admin và revoke; chưa có pairing bằng keypair/QR/fingerprint |
| Mã hóa đường truyền | Có HTTPS cấu hình được; người triển khai cấp trust đúng; HTTP mặc định chỉ dành cho LAN tin cậy; chưa có E2EE |
| Resume/cancel/integrity | Có API offset riêng, checksum chunk/toàn file, cancel/expiry/retry và chọn lại nguồn sau reload; host commit chưa xác nhận người nhận cuối đã lưu |
| Quota và queue | Có quota tổng/file, free-space, upload dở/concurrency; queue toàn ứng dụng và speed/ETA/pause/resume; file hoàn tất chưa có retention tự động |
| Overlay và phát hành | Có hướng dẫn triển khai nhóm riêng; exporter source allowlist/checksum và cấu hình CI; cần bằng chứng các cổng cuối |
| Khả năng sau alpha | Discovery/QR, clipboard theo thao tác, folder transfer, phòng theo người nhận/E2EE, WebRTC, screen sharing và remote native vẫn là roadmap |

Giữ phần phân tích license/remote phía dưới để tra cứu lý do lựa chọn. Những phụ thuộc/assets/runtime đưa thêm vào sau phải được kiểm tra nguồn gốc và notice theo đúng thành phần/version; source hiện không bundle Node runtime hay RustDesk. Việc có Apache-2.0 không xác nhận quyền cấp phép của mọi đoạn code/assets có nguồn gốc ngoài dự án. Browser, hai thiết bị LAN, overlay thực tế và publishing chỉ được coi là hoàn tất khi có bản ghi xác minh tương ứng.

---

## Hồ sơ nghiên cứu ban đầu — 03-11-2026, trước quyết định cấp phép và triển khai

Ngày kiểm tra nguồn: **03/11/2026**. Chủ tài khoản GitHub dự kiến: **hieunguyenak92**. Đây là đề xuất kỹ thuật và tóm tắt điều khoản; quyết định cấp quyền vẫn thuộc người nắm bản quyền.

## 1. Kết luận đề xuất

**Chọn Apache-2.0 nếu mục tiêu là nhiều người dùng, tự host và doanh nghiệp cũng có thể áp dụng.** Đây là lựa chọn đề xuất, chưa phải giấy phép đã áp dụng. MIT phù hợp khi ưu tiên văn bản thật ngắn. GPLv3/AGPLv3 phù hợp hơn khi chủ dự án chủ ý yêu cầu các bản phái sinh tuân thủ copyleft.

Public repository và open source là hai việc khác nhau: cần giấy phép cấp quyền sử dụng, sửa đổi và phân phối. GitHub cho phép xem/fork repository công khai theo điều khoản nền tảng, nhưng việc đó không thay thế giấy phép phần mềm. [GitHub: licensing a repository](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository).

Không thêm điều khoản “cấm thương mại” nếu muốn gọi dự án là open source theo OSI; định nghĩa yêu cầu quyền phân phối và không phân biệt lĩnh vực sử dụng. [OSI: Open Source Definition, mục 1 và 6](https://opensource.org/osd).

## 2. So sánh giấy phép

| Giấy phép | Người dùng có thể làm gì? | Nghĩa vụ đáng chú ý | Patent | Khi phù hợp |
|---|---|---|---|---|
| MIT | Dùng, sửa, phân phối, thương mại, kết hợp sản phẩm đóng | Giữ thông báo bản quyền và giấy phép trong bản sao/phần đáng kể | Không có điều khoản cấp patent riêng, rõ ràng như Apache | Dự án nhỏ, ưu tiên dễ tiếp nhận |
| Apache-2.0 | Tương tự giấy phép permissive, không buộc công khai bản sửa | Kèm giấy phép; ghi nhận file đã sửa; giữ thông báo liên quan; bảo toàn NOTICE khi có | Có grant từ contributor trong phạm vi quy định; có điều khoản chấm dứt khi kiện patent | Đề xuất mặc định cho MCKLTransfer |
| GPL-3.0 | Cho phép cả thương mại; copyleft khi phân phối tác phẩm thuộc phạm vi giấy phép | Khi phát hành binary phải đáp ứng cách cung cấp Corresponding Source; bản sửa thuộc phạm vi phải theo GPL | Có quy định patent tại mục 11 | Muốn bản phái sinh được phân phối tiếp tục mở |
| AGPL-3.0 | Tương tự copyleft mạnh, bổ sung tình huống tương tác qua mạng | Bản đã sửa có tương tác mạng phải mời người dùng mạng nhận Corresponding Source, mục 13 | Có quy định patent tại mục 11 | Muốn cả bản sửa chạy như dịch vụ phải chia sẻ source với người dùng dịch vụ |

Nguồn điều khoản: [MIT từ OSI](https://opensource.org/license/mit), [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0), [GPLv3 từ OSI, mục 0, 5, 6, 11](https://opensource.org/license/gpl-3.0), [AGPLv3 từ OSI, mục 11 và 13](https://opensource.org/license/agpl-3.0).

### Các điểm dễ hiểu nhầm

- Apache-2.0 không cấp mọi patent trên thế giới; grant giới hạn ở các claim mà contributor có quyền cấp và phạm vi giấy phép mô tả. Mục 6 cũng không tự cấp quyền dùng thương hiệu. [Apache License 2.0, mục 3 và 6](https://www.apache.org/licenses/LICENSE-2.0).
- GPLv3 phân biệt việc phân phối bản sao với tương tác mạng không chuyển bản sao; chỉ vận hành server không tự động đồng nghĩa phải công khai mọi server code. Với web app, phần JavaScript gửi đến browser là một bản sao phần mềm và cần xem nghĩa vụ phân phối tương ứng. [GPLv3, mục 0 và 6](https://opensource.org/license/gpl-3.0).
- AGPL mục 13 nói đến **bản đã sửa** và người dùng tương tác qua mạng. Điều khoản không chỉ giới hạn ở cloud công khai: LAN cũng là mạng. Không có nghĩa mọi file cá nhân đi qua ứng dụng phải được cấp AGPL. [AGPLv3, mục 13 và định nghĩa Program](https://opensource.org/license/agpl-3.0).
- Chọn `GPL-3.0-only` hay `GPL-3.0-or-later`, hoặc tương tự cho AGPL, phải có chủ ý; SPDX phân biệt chúng. [SPDX GPL-3.0-only](https://spdx.org/licenses/GPL-3.0-only.html), [SPDX AGPL-3.0-only](https://spdx.org/licenses/AGPL-3.0-only.html).

### Áp dụng vào dự án

Sau khi chủ sở hữu chốt lựa chọn:

1. Đặt nguyên văn giấy phép chuẩn vào `LICENSE` ở root; không tự sửa điều khoản chuẩn.
2. Ghi tên người/tổ chức thực sự nắm bản quyền. Có thể dùng danh tính công khai phù hợp, nhưng tài khoản GitHub không tự chứng minh quyền sở hữu mọi đoạn code.
3. Thêm mã SPDX tương ứng vào `package.json`, ví dụ `"license": "Apache-2.0"`, và ghi trong README. Trường `private: true` hiện tại có tác dụng ngăn publish npm; vẫn có thể giữ khi công khai mã trên GitHub. [npm package.json: license và private](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/).
4. Kiểm tra nguồn gốc code, icon, font, ảnh và phần sao chép. `package.json` hiện không khai báo dependency ngoài; điều đó không xác minh quyền tác giả của toàn bộ tài sản.
5. Nếu sau này đóng gói kèm Node runtime/Tauri/RustDesk hay thư viện, rà giấy phép đúng phiên bản và giữ các notice cần thiết. Node có nhiều thông báo cho thành phần đi kèm trong [LICENSE của Node.js](https://github.com/nodejs/node/blob/main/LICENSE).
6. `CONTRIBUTING.md` cần nói rõ giấy phép áp dụng cho đóng góp. Chưa cần CLA phức tạp nếu dự án cá nhân không có yêu cầu chuyển nhượng/dual licensing đã xác định.

Không có cơ sở trong thư mục hiện tại để khẳng định quyền sở hữu của bên thứ ba đã được xử lý. Đây là phần chủ dự án phải xác nhận từ nguồn gốc thực tế của mã/tài sản.

## 3. Cách phát hành dưới tài khoản hieunguyenak92

Đích đề xuất là `hieunguyenak92/MCKLTransfer`; chưa xác minh tên repository còn trống hay quyền đăng nhập. Không có repository nào được tạo bởi nghiên cứu này.

### Trước khi public

- Tạo snapshot nguồn sạch đã kiểm tra. Loại thư mục chứa file người dùng, manifest runtime, `.env`, khóa/cert riêng, log, backup, cấu hình IDE cá nhân. `.gitignore` không làm biến mất dữ liệu đã commit trước đó.
- Kiểm tra cả archive/release artifact, ảnh chụp và log trong tài liệu; bản release có thể rò file dù Git sạch.
- Tránh dùng `git add .` cho lần đầu. Stage danh sách nguồn cần phát hành, kiểm tra lại `git diff --cached` và danh sách tên file. Quét secret trước commit và trước push.
- Dùng địa chỉ `noreply` chính xác do GitHub cung cấp trong Settings → Emails cho cấu hình Git **của repository**. Không đoán ID/email. Bật tùy chọn chặn push làm lộ email cá nhân; thay email mới không sửa metadata của commit cũ. [GitHub: email addresses](https://docs.github.com/en/account-and-profile/concepts/email-addresses), [noreply formats](https://docs.github.com/en/account-and-profile/reference/email-addresses-reference).
- Kiểm tra tài khoản GitHub đang xác thực trước thao tác remote; ghi rõ `OWNER/REPO` để tránh mặc định nhầm owner. Có thể tạo repo private trước để kiểm tra, rồi mới public khi các cổng phát hành đạt yêu cầu. GitHub CLI hỗ trợ `--source`, `--private`/`--public` và chỉ push khi yêu cầu `--push`. [GitHub CLI: gh repo create](https://cli.github.com/manual/gh_repo_create).

### Các file cần có

| File | Nội dung tối thiểu |
|---|---|
| README | Cài đặt, thiết bị hỗ trợ, sơ đồ dữ liệu, cách dùng LAN/overlay, giới hạn bảo mật đúng với bản phát hành |
| LICENSE | Lựa chọn được chủ bản quyền duyệt |
| SECURITY.md | Phiên bản được hỗ trợ, phạm vi tin cậy, cách báo lỗi riêng, giới hạn HTTP/LAN |
| CONTRIBUTING.md | Chạy test, quy ước PR, giấy phép đóng góp |
| CHANGELOG.md | Thay đổi người dùng cần biết, migration và lỗi đã sửa |
| CI | Test trên Windows/macOS/Linux và các Node LTS còn hỗ trợ; lint/syntax theo công cụ thực tế của dự án |
| Release notes | Trạng thái alpha/beta, checklist tương thích, checksum và nguồn build nếu có binary |

### Cấu hình GitHub

Bật/kiểm tra secret scanning, push protection, Dependabot alerts, kiểm tra code phù hợp và rules bảo vệ nhánh chính. Tài liệu hiện hành cho biết nhiều tính năng security miễn phí cho public repo; push protection có giới hạn mẫu/khối lượng nên không thay kiểm toán local. [GitHub security features](https://docs.github.com/en/code-security/getting-started/github-security-features), [secret scanning detection scope](https://docs.github.com/en/code-security/reference/secret-security/secret-scanning-scope).

Bật Private vulnerability reporting khi repository đã public và dùng SECURITY.md hướng dẫn gửi báo cáo kín trước khi thông báo release. Tính năng này chỉ khả dụng cho public repo; các thiết lập bảo vệ nhánh/secret scanning trên private repo phụ thuộc gói tài khoản. Không tự tạo địa chỉ email cá nhân chưa được chủ dự án đồng ý công bố. [GitHub: configuring private vulnerability reporting](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository), [protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches).

Vì app chưa có dependency npm ngoài, lợi ích Dependabot npm ban đầu hạn chế. Nếu dùng GitHub Actions thì cấu hình cập nhật Actions; khi thêm dependency mới mới mở rộng npm. [GitHub: Dependabot options](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference).

## 4. Nên thêm tính năng gì?

Đánh giá hiện trạng từ `README.md`, `public/index.html` và `public/app.js`: đã có chọn nhiều file, hai worker upload, progress, danh sách/download/delete, chat, copy từng tin nhắn và chia sẻ URL. Vì vậy “multi file” và “copy chat” không nên được trình bày như tính năng chưa tồn tại.

Thứ tự dưới đây là đề xuất cho sản phẩm, chưa triển khai:

| Ưu tiên | Tính năng | Lý do và điều kiện nghiệm thu |
|---|---|---|
| P0 | Pair thiết bị + định danh bền vững + thu hồi quyền | Xác nhận lần đầu bằng QR/fingerprint qua kênh tin cậy; key thiết bị lưu an toàn; xóa thiết bị phải chấm dứt session/quyền tương lai |
| P0 | Transport mã hóa, scope quyền rõ ràng | Người dùng hiểu ai đọc/xóa được file; TLS được kiểm chứng danh tính; phân biệt mã hóa đường truyền với E2EE |
| P0 | Resume, cancel, retry, integrity phía nhận | Đứt mạng không gửi lại toàn bộ; không đánh dấu hoàn thành trước khi receiver xác nhận; cleanup phần dở và thử lại không tạo trùng |
| P0 | Quota, retention, quyền xóa | Không làm đầy ổ; tự xóa theo chính sách opt-in; thiếu disk phải báo sớm; host có thể ngắt thiết bị |
| P1 | Hàng đợi và trạng thái xác nhận | Pause/reorder, speed/ETA có smoothing, received vs downloaded vs saved; xử lý app background/mobile lock đúng thực tế |
| P1 | Discovery + QR + người nhận cụ thể | LAN tìm peer khi có native helper; browser giữ URL/QR fallback; không auto-accept thiết bị lạ |
| P1 | Gửi link/note/clipboard bằng thao tác rõ ràng | “Gửi clipboard”/“Copy” theo yêu cầu; không âm thầm đọc clipboard, không đồng bộ mật khẩu/OTP mặc định |
| P2 | Folder transfer + tùy chọn archive + preview an toàn | Giữ đường dẫn tương đối đã chuẩn hóa; giới hạn số file/kích thước; preview không thực thi HTML/SVG hoặc file được upload |
| P2 | Folder sync một chiều có versioning/thùng rác | Là sản phẩm khác đáng kể so với gửi file; phải có policy conflict/delete, exclusions và bảo vệ xóa lan |
| P3 | Screen sharing rồi mới remote control | Chỉ sau khi identity, encrypted sessions, revocation và consent đã vững |

Clipboard trong browser cần secure context và có khác biệt về quyền/user activation giữa browser. Không hứa “clipboard nền tự động trên mọi thiết bị” với ứng dụng web HTTP hiện tại. [MDN: Clipboard API](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard_API).

### Vì sao chưa ưu tiên sync hai chiều và remote desktop?

Đây là đánh giá thiết kế: file transfer có hành động gửi/nhận hữu hạn; sync hai chiều phải xử lý xung đột và xóa lan; remote control cho phép tác động liên tục lên máy khác. Cả hai mở rộng phạm vi tin cậy và gánh nặng hỗ trợ vượt xa thêm một nút giao diện.

## 5. Remote: nên hiểu thành ba mức

### Mức A — Truy cập/chuyển file từ xa

Nên làm trước. Kết nối thiết bị tin cậy qua overlay VPN hoặc P2P đã xác thực; vẫn giữ quyền app. Điều này giải quyết “không cùng LAN” mà chưa cần điều khiển màn hình/OS. Chi tiết transport trong báo cáo kiến trúc.

### Mức B — Xem màn hình có người đồng ý

Browser có thể xin `getDisplayMedia()` rồi truyền video qua WebRTC. API cần secure context, user activation và người dùng chọn nguồn chia sẻ; quyền capture không được lưu để bỏ prompt cho những lần sau. Khả năng browser/mobile phải kiểm tra trên ma trận thiết bị thật. [MDN: getDisplayMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia).

Đề xuất: phiên view-only mặc định, chia sẻ cửa sổ/tab có chủ ý, banner hiển thị người xem, nút stop tại máy gửi, timeout, giới hạn người xem. Pause file transfer hoặc giảm băng thông tùy chọn khi video cạnh tranh đường truyền.

### Mức C — Điều khiển bàn phím/chuột và hệ điều hành

`getDisplayMedia()` không tự cấp quyền nhập liệu hệ điều hành. Chrome có Captured Surface Control cho scroll/zoom tab, tài liệu nêu desktop từ Chrome 136; đây không phải remote desktop chung cho Windows/macOS/iPhone. [Chrome: captured surface control](https://developer.chrome.com/docs/web-platform/captured-surface-control).

Muốn full control cần native agent, quyền hệ điều hành và cập nhật bảo mật đáng tin cậy. Đề xuất tách thành module hoặc tích hợp với công cụ remote đã trưởng thành. RustDesk là ví dụ kiến trúc có ID/rendezvous (`hbbs`) và relay (`hbbr`), thử direct trước rồi relay khi cần. [RustDesk: self-host](https://rustdesk.com/docs/en/self-host/). Nếu sao chép/nhúng mã RustDesk, phải rà tương thích giấy phép: repository client hiện có [AGPLv3 trong LICENCE](https://github.com/rustdesk/rustdesk/blob/master/LICENCE); không coi đó là mã Apache/MIT có thể chép tùy ý.

Điều kiện thiết kế bắt buộc cho module control: xin phép từng phiên và từng capability; view-only mặc định; không có unattended access mặc định; hiển thị danh tính peer; nút ngắt tại host; revoke key có hiệu lực; audit log chỉ metadata cần thiết; tắt clipboard/file transfer trong phiên nếu chưa được cấp; không auto-open file hay nhận lệnh shell từ peer.

## 6. Quyết định cần chốt trước release đầu tiên

1. **Giấy phép:** Apache-2.0 theo đề xuất, hay MIT/GPL/AGPL theo mục tiêu quyền sử dụng?
2. **Phạm vi:** alpha cho LAN tin cậy trước, hay yêu cầu Internet ngay? Đề xuất LAN + overlay cho nhóm nhỏ trước.
3. **Mô hình người dùng:** một chủ host tin cậy toàn quyền, hay từng peer chỉ thấy file được gửi cho mình? Mô hình sau cần authorization và E2EE thiết kế riêng.
4. **Remote:** ưu tiên chuyển file khác mạng; screen share là tính năng sau; full control chỉ khi chủ dự án muốn duy trì native agent lâu dài.

Các giấy phép không phải cơ chế giữ dữ liệu cá nhân bí mật. Quyền riêng tư đến từ loại dữ liệu khỏi bản phát hành, mô hình tin cậy, kiểm soát truy cập và cách ứng dụng vận hành.
