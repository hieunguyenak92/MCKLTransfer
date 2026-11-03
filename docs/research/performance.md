# Hiệu năng truyền file: phân tích và kế hoạch đo

> **Cập nhật `0.2.0-alpha.1` — 03-11-2026:** phân tích source ban đầu được giữ bên dưới như hồ sơ lịch sử. Bản alpha đã sửa stream, queue và timeout, thêm resume/checksum/quota. Các số đo cuối, điều kiện chạy và phần chưa thử được ghi ở [VALIDATION](../VALIDATION.md); xem [README](../../README.md) và [IMPLEMENTATION_PLAN](../IMPLEMENTATION_PLAN.md) để biết phạm vi hiện tại.

## Đường truyền và công cụ đo hiện tại

- Giữ HTTP(S) streaming qua hub. Browser đọc nguồn theo phần trong hash worker, rồi gửi chunk mặc định 4 MiB; server xác minh chunk và đọc lại phần hoàn tất để đối chiếu SHA-256 toàn file trước commit. Các lượt đọc/hash này có chi phí cần đưa vào thời gian người dùng chờ.
- Hàng đợi UI giới hạn hai file trên toàn ứng dụng. Server mặc định bốn tác vụ ghi/hash upload đồng thời và có giới hạn chunk, dung lượng/file/tổng, upload dở, free-space và expiry. Concurrency của UI không thay giới hạn ở server.
- Có pause/resume/retry/cancel, offset lưu qua restart và rollback chunk lỗi. Mục tiêu là hạn chế truyền lại khi mất kết nối; chưa có phép đo LAN chứng minh mức tăng tốc cụ thể.
- Request timeout mặc định 30 phút, socket không hoạt động 60 giây bị ngắt; cấu hình thực tế ở README. Chunk là đơn vị giao thức riêng với ngưỡng buffer stream 1 MiB.
- `package.json` yêu cầu Node `^24.22.2 || ^26.13.0`; cấu hình CI có Ubuntu/Windows/macOS × Node 24/26. Đọc kết quả thực thi trong VALIDATION, không suy ra CI đã xanh từ file YAML.

Chạy benchmark tổng hợp từ source bằng runtime được hỗ trợ:

```sh
npm run benchmark -- --mib=64 --runs=3 --concurrency=1
```

Đọc phần điều kiện và phạm vi trong output của harness. Mặc định tạo host loopback và fixture tổng hợp trong thư mục tạm, xác minh digest; kết quả local chỉ mô tả máy đang chạy. Lệnh trên là cách thực thi, không phải bằng chứng rằng snapshot cuối đã benchmark. Tùy chọn và kết quả được chốt tại [VALIDATION](../VALIDATION.md).

Harness không thay ma trận đo giữa hai thiết bị: cần cả đường upload/download, hash nguồn/đích, thời gian toàn phiên, CPU/RSS, TLS thật và overlay direct/relay nếu sử dụng. Warm-cache, legacy streaming API và đường chunk của browser phải ghi rõ khi so sánh. Đường A → hub → B vẫn có hai chặng, và host commit chưa phải B đã nhận/lưu. Không có tuyên bố “nhanh nhất”, đạt trần LAN, dùng RAM cố định tuyệt đối hoặc chịu mất điện.

---

## Hồ sơ phân tích ban đầu — 03-11-2026, trước triển khai

Ngày đối chiếu nguồn: **03-11-2026**. Đây là phân tích mã nguồn và thiết kế thí nghiệm; chưa có benchmark giữa các thiết bị thật. Những con số mục tiêu dưới đây là tiêu chí đề xuất, không phải kết quả của MCKL Transfer.

## 1. Quyết định chính

Giữ HTTP streaming làm đường truyền nền. Ưu tiên đường đi trực tiếp, độ tin cậy và giới hạn tài nguyên; đo trước khi thay Node.js, tăng số luồng hoặc thêm QUIC. Nếu A gửi B và B chính là máy host, kiến trúc hiện tại đã truyền trực tiếp tới đích. Nếu A và B đều là client của host H, ứng dụng hiện tại cần A → H lưu file, rồi H → B tải xuống. Nó chưa phải browser A → browser B.

Với file kích thước S, trường hợp thứ hai truyền khoảng 2S payload ở tầng ứng dụng và cần H ghi S rồi đọc S. Thiết bị dùng cùng sóng Wi-Fi có thể tranh chấp airtime thêm; không suy ra tốc độ chỉ từ tốc độ danh nghĩa của router. Loại bỏ host trung gian khi không cần lưu trữ có thể đáng giá hơn đổi giao thức.

## 2. Trần vật lý và ý nghĩa của “nhanh nhất”

```text
goodput ≤ min(băng thông khả dụng trên đường đi,
              tốc độ đọc nguồn, tốc độ ghi đích,
              năng lực CPU mã hóa/hash, khả năng xử lý của client)
```

Phép đổi đơn vị lý thuyết, chưa trừ bất kỳ overhead nào:

| Link danh nghĩa | Trần MB/s thập phân | Trần MiB/s |
|---|---:|---:|
| 1 Gbit/s | 125 | 119,2 |
| 2,5 Gbit/s | 312,5 | 298,0 |
| 10 Gbit/s | 1.250 | 1.192,1 |

Đây không phải tốc độ app sẽ đạt. WAN còn bị giới hạn bởi upload của bên gửi, download bên nhận, RTT, mất gói và relay. Không dùng speed test internet để đánh giá đường LAN.

## 3. Những điểm đã có và khoảng trống thực tế trong code

| Vị trí | Quan sát | Hành động đề xuất |
|---|---|---|
| `server.mjs:237–245` | Stream ghi file và chờ drain; SHA-256 cập nhật trên từng chunk | Giữ bounded buffering, xử lý lỗi stream đầy đủ; đo CPU/hash trước khi chuyển worker |
| `server.mjs:243` | Mỗi lần drain gắn thêm listener `error` nhưng không gỡ khi drain thành công | Dùng một vòng đời stream có cleanup; cân nhắc `pipeline` cùng transform hash, xác minh abort/error semantics |
| `server.mjs:237`, `:368` | `highWaterMark` 1 MiB | Đây là ngưỡng buffer, không phải chunk giao thức cố định hay cam kết RAM tối đa |
| `public/app.js:87` | Hai upload song song trong mỗi lần gọi `uploadFiles` | Hàng đợi toàn ứng dụng; chọn file nhiều lần có thể tạo thêm worker vượt 2 |
| `public/app.js:84–86` | Mỗi sự kiện progress dựng lại toàn bộ danh sách truyền | Nếu profile thấy nghẽn UI, cập nhật riêng hàng thay đổi và giới hạn tần suất hiển thị |
| `public/app.js:86` | Callback `onload` chờ `loadFiles` trước `resolve` | Lỗi refresh sau khi upload thành công có thể để Promise không resolve, dừng worker; phải finalize trong `finally` |
| `server.mjs:151–161` | Mỗi mutation serialize toàn bộ manifest; các lượt ghi xếp hàng | Đo với nhiều file nhỏ; chỉ đổi sang index/database khi quy mô và profile yêu cầu |
| `server.mjs:186–191`, `:340–345` | SSE chưa xử lý client đọc chậm và chưa kết thúc theo TTL của session | Có giới hạn queue, heartbeat, re-auth và disconnect; file transfer không được kéo chat nghẽn theo |
| `server.mjs:402–403` | Không đặt `requestTimeout` riêng | Thiết kế timeout phù hợp tốc độ tối thiểu, idle timeout và quota; không đơn giản vô hiệu mọi timeout |
| Upload API | Không có session upload/offset; client chưa so sánh digest với nguồn | Resume và xác nhận integrity trước khi đánh dấu thành công ở đích |

Các kết luận trên đến từ source tại thời điểm kiểm tra. Node định nghĩa `highWaterMark` là ngưỡng backpressure, không phải giới hạn bộ nhớ cứng. `pipeline` hỗ trợ truyền lỗi và dọn stream, nhưng không tự đảm bảo tính đúng của transaction metadata. [Node streams](https://nodejs.org/api/stream.html)

Node mặc định `server.requestTimeout` là 300.000 ms để nhận toàn bộ request. Một file 20 GiB ở 20 MB/s cần khoảng 1.074 giây; đây là ví dụ tính toán cho thấy cần thiết kế timeout và resume. Chưa chạy thí nghiệm upload trên 5 phút để xác minh hành vi timeout của bản app này. [Node HTTP](https://nodejs.org/api/http.html#serverrequesttimeout)

SHA-256 hiện chỉ là digest do host tính; nếu client không tính/đối chiếu, không thể gọi đó là kiểm chứng đầu cuối. ETag và HTTP Range phục vụ download cũng không tự triển khai resume upload.

## 4. Thứ tự tối ưu

1. **Ổn định đường hiện tại:** sửa lỗi reservation tên dài, xử lý lỗi stream, logout/revocation, callback upload, timeout và giới hạn tài nguyên. Đường truyền nhanh nhưng có thể treo hoặc làm đầy ổ đĩa chưa đạt yêu cầu.
2. **Đo bốn trần riêng:** mạng, đọc/ghi ổ đĩa, hash/CPU, rồi end-to-end của app với TLS bật. Không dùng localhost làm đại diện Wi-Fi.
3. **Đường trực tiếp:** chọn đúng interface LAN; hiển thị direct/overlay/relay để người dùng biết đường dữ liệu. Nếu hai browser cần trao đổi tức thời, thêm transport WebRTC có fallback host.
4. **Resume:** dùng chuẩn tus hoặc thiết kế upload session tương đương có offset được server xác nhận, danh tính chủ sở hữu, hạn dùng và quota. Tách block dùng resume khỏi message/frame của transport.
5. **Thử concurrency có kiểm soát:** 1, 2, 4 file đồng thời; đo cả độ trễ chat, RAM và tốc độ từng thiết bị. Không mặc định nhiều luồng sẽ nhanh hơn; không chia một file thành nhiều stream khi chưa chứng minh cần.
6. **Chỉ tối ưu CPU khi profile xác nhận:** hash incremental, bounded worker pool nếu cần, giảm render/serialize. Đổi Node sang Rust/Go có chi phí phát hành đa nền tảng; không có số đo hiện tại để biện minh.
7. **QUIC/WebTransport là thử nghiệm sau:** QUIC giảm blocking giữa các stream khi mất gói, không loại bỏ mọi giới hạn của đường mạng hoặc tăng tốc file đơn một cách chắc chắn. [RFC 9000](https://www.rfc-editor.org/rfc/rfc9000.html#section-13)

tus có cơ chế offset và các extension checksum, expiration, termination, concatenation; authentication và authorization vẫn là trách nhiệm ứng dụng. Chọn implementation được bảo trì thay vì chỉ bắt chước vài header rồi tuyên bố tương thích chuẩn. [Đặc tả tus 1.0](https://tus.io/protocols/resumable-upload)

Với WebRTC, dùng reliable delivery cho file, giới hạn hàng đợi theo `bufferedAmount`/`bufferedamountlow`, và tôn trọng message size đã thương lượng. Khởi đầu thử 16–64 KiB/message là tham số thí nghiệm; block resume có thể lớn hơn, không được gửi nguyên block lớn thành một message tùy ý. Không gom toàn bộ file lớn thành mảng Blob trong RAM rồi mới lưu. [MDN data channels](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Using_data_channels), [RTCDataChannel](https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel)

Không bật compression cho mọi payload: ảnh/video/ZIP thường đã nén; thử trên corpus đại diện và chỉ bật nếu end-to-end tốt hơn. Tránh base64 cho file binary vì làm tăng lượng dữ liệu và công việc chuyển đổi.

## 5. Bộ benchmark có thể lặp lại

### 5.1 Mạng thuần

Chỉ chạy giữa hai máy do bạn quản lý, trên interface/mạng định đo. Thay `HOST_IP` bằng IP máy nhận, không phải URL chứa port:

```bash
# Máy nhận
iperf3 -s

# Máy gửi: chạy từng lệnh, lưu JSON ở nơi riêng nếu chứa IP/tên máy
iperf3 -c HOST_IP -t 30 -O 3 -P 1 -J
iperf3 -c HOST_IP -t 30 -O 3 -P 1 -R -J
iperf3 -c HOST_IP -t 30 -O 3 -P 4 -J
```

`-R` đảo chiều, `-P` thay số stream; iperf đo network throughput, không tính đọc/ghi payload và luồng ứng dụng. Không dùng kết quả `--zerocopy` làm cam kết app. [Tài liệu iperf3 của ESnet](https://software.es.net/iperf/invoking.html)

### 5.2 End-to-end

| Trục kiểm tra | Bộ ca đề xuất |
|---|---|
| Thiết bị | Windows ↔ macOS; iPhone Safari ↔ host; Android Chrome ↔ host |
| Mạng | Ethernet 1/2,5/10 Gbit/s nếu có; Wi-Fi; AP isolation; overlay direct và relay |
| Payload tổng hợp | 1 file 1 GiB; 1 file lớn hơn RAM nếu dung lượng cho phép; 1.000 file nhỏ; file 0 byte |
| Đồng thời | 1/2/4 file; thêm client đang chat; client nhận chậm |
| Hỏng đường truyền | Ngắt ở 10%/90%; restart host; sleep/lock điện thoại; hết ổ đĩa; hủy upload |
| Thống kê | goodput tính theo byte đã xác nhận tại đích, thời gian p50/p95, CPU, peak RSS, disk I/O, p95 chat latency, số byte phải gửi lại |

Mỗi ca chạy ít nhất 5 lần theo cùng điều kiện, ghi phiên bản OS/browser/runtime và direct/relay; phân biệt cache nóng/lạnh. Dùng file sinh mới không riêng tư. Xác nhận hash nguồn = đích. Không dùng file zero/sparse để kết luận ổ đĩa hoặc compression nhanh.

Thời gian end-to-end phải gồm handshake, truyền, hash/commit ở đích; tách riêng cold start. Trong kiến trúc A → H → B cần đo cả hai bước tới B; không lấy lúc H nhận xong làm “B đã nhận”. Với mức đảm bảo chịu mất điện, phải định nghĩa và đo flush/fsync riêng; rename nguyên tử không tự có nghĩa dữ liệu đã bền trên đĩa.

**Tiêu chí đề xuất:** với một file lớn trên LAN ổn định, đặt mục tiêu goodput đạt ≥80% của trần đo được phù hợp đường đó, có tính giới hạn disk/hash. Đây là mục tiêu nội bộ cần điều chỉnh theo thiết bị, không phải benchmark đã đạt. RAM không tăng tuyến tính theo kích thước file; phục hồi không gửi lại toàn bộ; không đánh đổi xác thực/TLS/checksum để đạt mục tiêu.

Node có `monitorEventLoopDelay` và `eventLoopUtilization` để quan sát ứng dụng khi tải tăng. [Node perf_hooks](https://nodejs.org/api/perf_hooks.html)

## 6. Runtime và kết quả xác minh hiện tại

- Môi trường kiểm thử hiện tại: Node **26.5.0**, npm **11.17.0**. `npm test` hiện có **1 test lifecycle**, bao nhiều API nhưng chưa đại diện load, security hoặc mạng thật.
- `package.json` vẫn khai báo `node >=20`; Node 20 đã EOL. Ngày kiểm tra, Node 24 và 26 có bản LTS; khuyến nghị CI và tài liệu dùng bản vá mới nhất của các nhánh còn hỗ trợ. Không chỉ nâng major rồi bỏ qua patch. [Node releases](https://nodejs.org/en/about/previous-releases)
- Bản Node tại máy kiểm thử thấp hơn các bản vá bảo mật tháng 10-2026; nên cập nhật runtime trước khi triển khai. Không từ đó suy ra mọi CVE đều khai thác được trong ứng dụng này. [Thông báo bảo mật Node](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)
- Chưa cài iperf3, chưa có hai thiết bị/mạng đại diện để đo. Chưa sửa runtime/transport; các tối ưu trên là backlog có căn cứ và phương pháp nghiệm thu.
