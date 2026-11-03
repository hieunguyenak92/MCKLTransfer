# Kiểm toán riêng tư và bảo mật trước open source

> **Cập nhật sau sửa lỗi — 03-11-2026, `0.2.0-alpha.1`:** giữ nguyên hồ sơ kiểm toán ban đầu phía dưới để lưu điều kiện và bằng chứng tái hiện. Những vị trí dòng, số test và câu “chưa sửa” trong hồ sơ đó áp dụng cho source cũ. Xem [README](../../README.md), [SECURITY](../../SECURITY.md), [kế hoạch đã duyệt](../IMPLEMENTATION_PLAN.md), [VALIDATION](../VALIDATION.md) và [checklist hiện hành](../RELEASE_CHECKLIST.md) cho bản alpha.

## Trạng thái xử lý trong source hiện tại

| Phát hiện ban đầu | Thay đổi đã triển khai | Bằng chứng regression trong repository |
|---|---|---|
| A — tên dài trùng làm treo | Reservation dành chỗ cho suffix theo giới hạn UTF-8 và có giới hạn thử | `test/security.test.mjs`, `test/storage.test.mjs` |
| B — ghi đè manifest | Payload mới lưu theo ID trong object storage, tên nội bộ bị từ chối | `test/security.test.mjs`, `test/storage.test.mjs` |
| C — lỗi stream làm thoát tiến trình | Vòng đời pipeline/error/abort, cleanup/rollback và commit được quản lý | `test/security.test.mjs`, `test/storage.test.mjs` |
| D/E — logout và SSE tồn tại quá phiên | Logout thu hồi server token và cookie; SSE liên kết với session, đóng khi expiry/logout/revoke | `test/security.test.mjs`, `test/api.test.mjs` |
| PIN/metadata trước auth và Host/Origin | Không trả PIN qua HTTP; ẩn identity/network trước auth; kiểm tra Host/Origin | `test/security.test.mjs`, `test/api.test.mjs` |
| Symlink/namespace filesystem | Mở và kiểm tra regular file, dùng bảo vệ no-follow khi nền tảng hỗ trợ, không dùng tên upload làm storage key | `test/security.test.mjs`, `test/storage.test.mjs` |
| Quyền xóa, identity, giới hạn | Peer/admin riêng; owner bền qua restart; revoke thiết bị; quota/concurrency/expiry/SSE buffer có giới hạn | `test/api.test.mjs`, `test/storage.test.mjs` |
| HTTP và integrity | HTTPS cấu hình được, cookie Secure; digest nguồn/chunk/toàn file và offset được đối chiếu | `test/tls.test.mjs`, `test/hash.test.mjs`, `test/api.test.mjs` |

Suite API đã được chạy riêng với dữ liệu tổng hợp: **8/8 pass** sau sửa header `Upload-Expires`. Tổng suite, runtime/OS cụ thể và các kiểm tra cuối phải lấy từ [VALIDATION](../VALIDATION.md). Bằng chứng TLS dùng chứng chỉ tạm và CA fixture; chưa suy ra thiết bị người dùng đã có trust đúng. Test client dùng adapter chưa thay phiên browser thật.

**Ranh giới còn tồn tại:** host đọc được dữ liệu; mọi thành viên đọc không gian chung; chưa có E2EE, phòng theo người nhận hoặc keypair thiết bị được pin. Chỉ dùng filesystem riêng có ACL chặt, không cho nhiều tiến trình dùng chung thư mục dữ liệu. Không bảo vệ trước người có quyền sửa payload regular file tại máy host cùng kích thước. Test recovery/restart không chứng nhận chịu mất điện; file phiên dùng ghi tạm/rename và không có cam kết fsync/power-loss.

Không xóa dữ liệu riêng đã tìm thấy trong `shared/`; dữ liệu đó phải tiếp tục nằm ngoài source và artifact. Đã có source allowlist/scanner mẫu và exporter kiểm tra member/hash, nhưng scanner snapshot/history đầy đủ, artifact cuối, browser, CI và LAN vẫn là các cổng riêng trong checklist. Không coi phần cập nhật này là chứng nhận hết secret/PII hoặc pentest đầy đủ. Apache-2.0 đã được chọn và thêm vào source; giấy phép không làm dữ liệu người dùng thành nội dung được phép phát hành.

---

## Hồ sơ kiểm toán ban đầu — 03-11-2026, trước triển khai

Ngày kiểm tra: **03-11-2026**. Phạm vi: snapshot cục bộ của MCKLTransfer trước khi chỉnh tài liệu/đóng gói. Các tham chiếu dòng runtime dưới đây khớp `server.mjs` và `public/app.js` tại thời điểm kiểm tra. Không xuất bản GitHub, không gửi tệp ra dịch vụ bên ngoài.

## 1. Kết luận

**Không tìm thấy khóa riêng, API token, mật khẩu tài khoản hoặc email cá nhân được hardcode trong các tệp văn bản đã kiểm tra. Có metadata sử dụng thực tế cần loại khỏi bản phát hành. Có lỗi runtime đã tái hiện, nên sửa trước khi giới thiệu ứng dụng như một công cụ chia sẻ riêng tư ổn định.**

Đây là kiểm toán có giới hạn, không phải chứng nhận “không có bí mật” hoặc pentest đầy đủ. Chưa có `.git`, vì vậy không thể kết luận về commit cũ, branch, tag, reflog hoặc repository gốc ở nơi khác. Toàn bộ nội dung hiện có đã được kiểm kê, gồm tệp ẩn; không có symlink trong snapshot. Kiểm tra không đọc nội dung file cá nhân ra báo cáo.

### Dữ liệu cần giữ ngoài GitHub/bản đóng gói

| Hạng mục trong snapshot | Đã xác minh | Xử lý |
|---|---|---|
| `shared/.mckl-manifest.json` | Có một bản ghi với tên tệp, kích thước, MIME, SHA-256, ID và thời gian upload. Không còn payload tương ứng trên đĩa | Loại toàn bộ `shared/` khỏi Git và mọi gói phát hành. Metadata cũ cũng là dữ liệu riêng tư dù payload đã xóa |
| `.DS_Store`, `shared/.DS_Store` | Có hai tệp metadata Finder; không phân tích đầy đủ định dạng bên trong | Không phát hành. Không khẳng định các tệp này chứa secret; tránh công bố metadata thư mục không cần thiết |
| `README.md` bản đầu | Ví dụ chứa địa chỉ LAN/overlay cụ thể, được viết dưới dạng log sử dụng | Thay bằng ví dụ chung, không đưa địa chỉ gốc vào báo cáo mới |
| `.gitignore` bản đầu | Đã bỏ qua `shared/`, manifest, `.part`, `node_modules/` và npm debug log | Bổ sung metadata hệ điều hành, môi trường cấu hình, private key và sản phẩm build; kiểm tra riêng từng kênh đóng gói |
| Tệp nguồn và tài liệu còn lại | Kiểm tra thủ công, quét các mẫu private key/token phổ biến, email, đường dẫn home và IP | Chưa thấy credential thật. PIN dùng trong test/ví dụ là dữ liệu fixture, không phải credential của tài khoản người dùng |

**Đừng zip toàn bộ thư mục làm release.** `.gitignore` điều khiển tệp chưa được Git theo dõi, không phải bộ lọc cho trình tạo ZIP tùy ý và cũng không xóa tệp từng commit. Tệp đã được theo dõi cần xử lý riêng. [Git: gitignore](https://git-scm.com/docs/gitignore)

Không có dependency runtime bên thứ ba trong `package.json` hiện tại. Điều này giảm phạm vi rà soát dependency, nhưng không thay việc dùng Node còn được hỗ trợ và cập nhật bản vá.

## 2. Phương pháp và bằng chứng

- Kiểm kê đệ quy tệp thường/tệp ẩn, mode, symlink; đọc mã nguồn server, UI, service worker, manifest ứng dụng, test và tài liệu.
- Quét mẫu private key PEM/OpenSSH, token GitHub, AWS access key, email, đường dẫn home và IPv4. Quét mẫu chỉ phát hiện những định dạng đã biết; không phải một bộ secret scanner bao phủ mọi nhà cung cấp.
- Chỉ đọc cấu trúc và đếm bản ghi manifest riêng tư; không đưa tên/hash/thời gian thật vào báo cáo.
- Tái hiện bằng app khởi tạo với `shareDir` tạm, tên máy giả và PIN fixture. Chỉ bind loopback, không dùng `shared/` thật; tệp thử được xóa sau khi chạy.
- `npm test` ban đầu bị sandbox chặn `listen` (`EPERM`); sau khi chạy với quyền bind loopback, bộ test hiện có **pass 1/1**. Node dùng cho lần kiểm tra là v26.5.0. Suite chỉ có một lifecycle test; pass không bao phủ những lỗi bên dưới.
- Các script kiểm toán tạm không sửa runtime và không được thêm vào sản phẩm. Kết quả tái hiện được ghi rõ bên dưới; các mục chỉ phân tích tĩnh được đánh dấu riêng.

## 3. Lỗi cần ưu tiên

Mức độ đánh giá theo ứng dụng dùng trong LAN tin cậy: **cao** = có thể treo/crash tiến trình hoặc làm sai dữ liệu; **trung bình** = phiên/quyền riêng tư không đúng mong đợi; **có điều kiện** = cần thêm khả năng truy cập hoặc cấu hình đặc biệt. Không gán CVSS khi chưa có mô hình triển khai đầy đủ.

### A. Tên dài trùng nhau làm treo toàn bộ event loop — cao, đã tái hiện

**Vị trí:** `server.mjs:42–45`, `server.mjs:273–285`.

`sanitizeFileName` cho phép tên dài 180 ký tự. Khi tên đã tồn tại, `reserveName` thêm ` (2)` rồi cắt chuỗi về 180 ký tự. Với tên 180 ký tự không có phần mở rộng, suffix bị cắt mất hoàn toàn, tên vẫn giữ nguyên. `filesHasName(name)` luôn đúng nên nhánh `await lstat(...)` bị short-circuit; vòng `while` tiếp tục đồng bộ vô hạn.

**Bằng chứng:** upload đầu tiên một tên ASCII dài 180 ký tự trả `201`; upload thứ hai cùng tên khiến tiến trình con không xử lý được callback timeout nữa. Tiến trình kiểm toán bên ngoài phải kết thúc nó sau giới hạn 8 giây. Một client đã đăng nhập có thể làm treo cả server, ảnh hưởng mọi thiết bị.

**Sửa gốc:** dành trước số ký tự/byte cho suffix và extension rồi cắt stem; bảo đảm mỗi vòng tạo một ứng viên khác nhau, có giới hạn thử. Kiểm thử tên dài, Unicode và tên trùng nhiều lần; giới hạn tên theo khả năng filesystem thực tế, không chỉ số UTF-16 code unit.

### B. Tên file đụng manifest làm nội dung upload bị ghi đè — cao, đã tái hiện

**Vị trí:** `server.mjs:151–156`, `server.mjs:221–254`, `server.mjs:273–280`.

Khi thư mục chia sẻ mới chưa có manifest, người dùng có thể upload tệp tên `.mckl-manifest.json`. Sau khi rename payload vào tên đó, `persistManifest()` ghi đè nó bằng JSON metadata. API vẫn báo upload thành công và giữ SHA-256/kích thước của payload ban đầu.

**Bằng chứng:** upload fixture tên reserved trả `201`; nội dung lưu sau đó là mảng metadata; SHA-256 thực tế không khớp SHA-256 được trả về.

**Sửa gốc:** tách vùng metadata ra khỏi namespace file người dùng; lưu payload theo ID, giữ tên hiển thị trong metadata. Nếu vẫn giữ bố cục hiện tại, từ chối mọi tên nội bộ và tên tạm liên quan trước khi reserve, đồng thời kiểm tra xuyên nền tảng. Không chỉ cấm riêng một tên rồi bỏ sót biến thể file tạm.

### C. Lỗi mở/ghi output stream có thể crash tiến trình — cao, đã tái hiện

**Vị trí:** `server.mjs:237–248`.

`createWriteStream` chưa có listener `error` ngay sau khi tạo. Listener chỉ được gắn khi chờ `drain` hoặc khi gọi `end`. Nếu lỗi mở tệp xảy ra trước hai điểm đó, một sự kiện `error` không được xử lý có thể kết thúc tiến trình. Với EventEmitter, lỗi không có listener là lỗi kết thúc process theo cơ chế Node. [Node.js: Error events](https://nodejs.org/api/events.html#error-events)

**Bằng chứng:** tạo shareDir fixture, khởi động server, chuyển thư mục đó thành không ghi được rồi gửi upload chậm 2 byte. Tiến trình con thoát mã `1`, stderr xác nhận `EACCES` và unhandled `error` event. Không thay quyền thư mục thật.

**Sửa gốc:** quản lý error/abort/finish ngay từ lúc stream được tạo; cleanup listener và tệp tạm trong mọi nhánh. `pipeline`/`finished` là công cụ stdlib hữu ích, nhưng phải thiết kế response lỗi cẩn thận vì pipeline có thể destroy socket trước khi gửi JSON. Listener error được thêm mỗi lần chờ drain hiện tại cũng cần gỡ đúng lúc để tránh tích lũy. [Node.js: Streams](https://nodejs.org/api/stream.html)

### D. Nút Đăng xuất không hủy phiên — trung bình, đã xác minh luồng và đặc tính cookie

**Vị trí:** `public/app.js:97`; `server.mjs:195–202`, `server.mjs:307–310`.

UI dùng `document.cookie` để xóa `mckl_session`, nhưng cookie do server đặt có `HttpOnly`. JavaScript không được ghi đè/xóa cookie HttpOnly qua API không phải HTTP. Không có route logout hoặc API revoke; map phiên chỉ xóa token hết hạn khi token đó được kiểm tra. [RFC 6265, storage model](https://httpwg.org/specs/rfc6265.html#storage-model), [MDN: Set-Cookie/HttpOnly](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie#httponly)

**Bằng chứng:** `Set-Cookie` có `HttpOnly`; `POST /api/logout` trả `404`; token đang có vẫn gọi `/api/files` thành công. Kết luận về nút UI dựa trên code và quy tắc cookie, chưa chạy một phiên browser automation riêng.

**Sửa gốc:** endpoint logout cùng origin hủy token server, trả `Set-Cookie` hết hạn với cùng Path/Domain, đóng SSE của phiên rồi UI chuyển màn hình. Khi thêm TLS, đặt `Secure` tương ứng với cách triển khai. Giữ `HttpOnly`.

### E. SSE tiếp tục nhận chat sau khi phiên hết hạn — trung bình, đã tái hiện

**Vị trí:** `server.mjs:188–192`, `server.mjs:314–315`, `server.mjs:336–341`.

Auth chỉ diễn ra khi mở `/api/events`. `sseClients` chỉ giữ response, không liên kết phiên và hạn dùng. Broadcast sau đó không kiểm tra phiên còn hiệu lực.

**Bằng chứng:** mở SSE với phiên fixture, dịch `Date.now` trong tiến trình test thêm 13 giờ. Request API thường của token cũ trả `401`, nhưng SSE đã mở vẫn nhận chat fixture do phiên mới gửi. Đồng hồ hệ điều hành không bị thay đổi.

**Sửa gốc:** liên kết từng kết nối SSE với session; đóng khi hết hạn/logout/revoke, giới hạn số kết nối và cleanup timer/listener.

## 4. Rủi ro có điều kiện và thiết kế cần công khai

### Mã truy cập loopback + Host không kiểm tra — có điều kiện, một phần đã xác minh

**Vị trí:** `server.mjs:37–39`, `server.mjs:293–299`.

`GET /api/config` công khai tên máy và các địa chỉ/interface, đồng thời trả PIN nếu địa chỉ socket là loopback. Không kiểm tra Host hoặc Origin. Request loopback với Host không thuộc ứng dụng vẫn nhận PIN trong test.

Điều này **không tự chứng minh** mọi website Internet đọc được PIN: còn phụ thuộc DNS, browser, chính sách truy cập mạng cục bộ và triển khai. Tuy nhiên, DNS rebinding là bề mặt cần đánh giá; reverse proxy trên cùng máy có thể khiến request từ xa trông giống loopback nếu giữ thiết kế này. Chưa thực hiện exploit browser/DNS hoặc reverse proxy thực tế.

**Khuyến nghị:** PIN chỉ xuất hiện ở terminal hoặc kênh host có quyền rõ ràng; kiểm tra allowed Host/Origin, tránh dùng địa chỉ peer proxy làm bằng chứng người dùng đang ngồi máy chủ. Giảm metadata trước auth. Khi thêm HTTPS/reverse proxy, đánh giá lại mô hình này trước khi mở truy cập từ xa.

### Symlink có thể làm download ra ngoài shareDir — có điều kiện, đã tái hiện

**Vị trí:** `server.mjs:163–176`, `server.mjs:344–368`.

`stat` và `createReadStream` theo symlink. Một người/process đã có quyền ghi filesystem trong shareDir có thể thay payload đã được index bằng symlink tới tệp khác mà user chạy app đọc được. Restart với manifest trỏ tới symlink cũng đáng quan tâm vì load dùng `stat`.

**Bằng chứng:** sau khi upload fixture bình thường, thay nó bằng symlink tới fixture nằm ngoài shareDir. Download trả `200` và đúng nội dung fixture bên ngoài.

Không chứng minh client HTTP thuần túy tạo được symlink; upload hiện chỉ tạo regular file. Mức độ phụ thuộc ai được ghi vào shareDir và quyền process. Dùng thư mục riêng có ACL chặt, chạy ít quyền, kiểm tra `lstat`/đường dẫn thực và mở tệp với bảo vệ chống symlink phù hợp OS. Cần thiết kế tránh race kiểm-tra-rồi-mở, không chỉ thêm `realpath` một lần.

### Mỗi người có PIN đều dùng chung mọi quyền — hành vi hiện tại

**Vị trí:** `server.mjs:314–380`.

Mọi phiên đã auth đều list/download/delete toàn bộ tệp và đọc chat chung. Không có owner, recipient, room hay phê duyệt nhận. Đây có thể đúng với “bảng chia sẻ gia đình”, nhưng không phải chia sẻ riêng giữa hai thành viên trong nhóm. Muốn dùng cho một vài cá nhân private cần định nghĩa rõ nhóm tin cậy và quyền xóa, thay vì gọi mô hình hiện tại là phân quyền nhiều người.

### Quota, concurrency và client chậm — phân tích tĩnh, chưa load-test

- Giới hạn 20 GiB là **mỗi file**, không phải tổng disk quota. Chưa có giới hạn upload đồng thời phía server, tổng dung lượng/người, dung lượng trống tối thiểu hoặc TTL tệp. Hai worker trong UI không ràng buộc client API tự viết.
- SSE bỏ qua kết quả `write() === false`; client đọc chậm có thể làm buffer tăng khi broadcast. Chưa đo mức tăng RAM hoặc chứng minh OOM. Cần giới hạn queue, đóng client quá chậm và giới hạn SSE/phiên.
- Map phiên và map thử auth chưa có cơ chế quét định kỳ; chưa thử nghiệm lưu lượng lớn/IPv6 nhiều địa chỉ.
- Session/identity của thiết bị chưa được quản lý dài hạn; PIN là quyền truy cập chung, không phải danh tính được pin khóa công khai.
- Payload được lưu trên host, không có mã hóa đầu cuối giữa hai browser và không mã hóa at rest trong app. HTTP thuần có thể lộ payload/PIN/cookie cho người quan sát được đường truyền; cookie HttpOnly không khắc phục điều này. Phạm vi hiện tại phải ghi rõ LAN tin cậy, không mở port Internet.
- Tệp có thể tồn tại vô hạn; chat giới hạn 200 tin trong RAM server nhưng UI giữ Map tin nhắn nhận trong suốt phiên browser, chưa có giới hạn tương đương. Không có tính năng xóa chat, revoke thiết bị hoặc chính sách xóa payload tự động.

## 5. Những bảo vệ đang có và giới hạn của chúng

- API file/chat yêu cầu phiên ngẫu nhiên; so sánh PIN dùng timing-safe; rate limit PIN 12 request/phút/IP. PIN chỉ 6 số và không tự xoay theo thời gian ngoài restart/cấu hình nên không dùng làm nền tảng public Internet.
- Tên file được chuẩn hóa, loại slash/backslash/control character, tránh một số tên thiết bị Windows. Static file có kiểm tra phạm vi `public/`. Chưa phát hiện path traversal thuần HTTP trong phạm vi kiểm tra; không tuyên bố đã chứng minh an toàn trước mọi filesystem edge case.
- File trả `Content-Disposition: attachment`, `nosniff`; UI dùng `textContent` cho tên file và nội dung chat. Chưa tìm thấy đường stored XSS trực tiếp từ hai trường này. CSP có thiết lập; không dùng các HTML preview tùy ý.
- Upload streaming, có kiểm tra kích thước thực, ghi `.part` trước khi rename và SHA-256 streaming. Hash server tính không phải bằng chứng phía người nhận đã đối chiếu file nguồn. Các lỗi B/C cho thấy “ghi atomically” không đủ để kết luận không mất dữ liệu.
- Cookie có `HttpOnly`, `SameSite=Strict`; không có CORS cho API. Đây là bảo vệ có ích; vẫn cần xem Origin/Host và auth theo triển khai thực, không kết luận “CSRF đã được giải quyết hoàn toàn”.
- Không thấy analytics, upload cloud, tải script/font từ bên thứ ba hoặc gọi API bên ngoài trong mã đã rà soát. Điều này mô tả snapshot, không cam kết cho dependency/tính năng thêm sau.

## 6. Cổng kiểm tra trước public

1. Giữ dữ liệu thật nguyên trạng ở máy; tạo bản phát hành từ danh sách tệp được phép. Không copy `shared/`, `.DS_Store`, `.env`, khóa/chứng chỉ riêng, log, bản backup hoặc dữ liệu test thật.
2. Kiểm tra **nội dung archive cuối cùng**, không chỉ `.gitignore`; kiểm tra `npm pack --dry-run` nếu định đóng gói npm. `private: true` là chặn publish npm ngoài ý muốn, không làm GitHub repository thành private.
3. Với repository mới chưa có lịch sử, tạo commit đầu chỉ từ các tệp đã rà soát. Nếu tìm lại repository gốc có `.git`, quét toàn bộ lịch sử trước push. Bí mật đã từng public cần revoke/rotate; chỉ xóa ở commit mới không đủ. GitHub secret scanning kiểm tra lịch sử nhưng không thay cho kiểm tra trước khi công bố. [GitHub: Secret scanning](https://docs.github.com/en/code-security/concepts/secret-security/secret-scanning)
4. Dùng Git author email công khai theo lựa chọn người dùng, có thể dùng email noreply do GitHub cấp; không suy đoán địa chỉ từ username. Kiểm tra screenshot, log, issue template, release binary và chứng chỉ cũng không lộ tên máy/đường dẫn riêng.
5. Sửa các lỗi A–E và thêm regression test; chạy suite trên Node được hỗ trợ và các OS mục tiêu. Kiểm tra lỗi disk đầy/không ghi được, request abort, tên dài/Unicode, tên nội bộ và TTL/logout/SSE.
6. Nếu công bố mã khi chưa sửa runtime, ghi rõ **experimental / trusted LAN only**, liệt kê giới hạn thực tế; không giới thiệu như sản phẩm bảo mật hoàn chỉnh hoặc remote access đã sẵn sàng. Không gắn claim throughput chưa đo.

Các thay đổi ignore/đóng gói/tài liệu thực hiện trong đợt chuẩn bị chỉ giảm nguy cơ công bố dữ liệu cục bộ; **không tự sửa các lỗi runtime được liệt kê ở đây**. Kiểm tra lại artifact cuối sau mọi chỉnh sửa.

## 7. Giới hạn còn lại

Chưa kiểm tra lịch sử Git gốc, dependency/build pipeline tương lai, native app, trình duyệt Safari/iOS trên thiết bị thật, Wi-Fi công cộng, DNS rebinding xuyên trình duyệt, reverse proxy/TLS, filesystem/network share và race đồng thời có chủ ý. Chưa dùng bộ secret scanner toàn lịch sử hoặc kiểm thử fuzz/load dài hạn. Mọi kết luận “chưa thấy” áp dụng cho snapshot và phương pháp nêu ở mục 2.
