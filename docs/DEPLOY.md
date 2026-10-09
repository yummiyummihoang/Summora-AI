# Chạy local và chuẩn bị beta online

Ngày triển khai: 08/10/2026. Bản này phục vụ một host có ổ đĩa bền vững và một worker. Chưa xuất bản lên Internet.

## Chạy trên máy hiện tại

Mở `start_web.cmd`. Launcher dùng FastAPI/Uvicorn mới; lần đầu tự cài thư viện. API key/model lấy từ `.env`, biến môi trường được ưu tiên. API key không được trả cho trình duyệt. Mở `http://127.0.0.1:8765` hoặc chạy `python -m summora --port 52635` để dùng cổng riêng.

Bản nháp, prompt riêng, tài khoản và lịch sử lưu trong `studio_data/studio.sqlite3`; file kết quả trong cùng thư mục. Workspace local chỉ dành cho máy cá nhân, không có đăng nhập. Không bind chế độ local ra mạng. 

Mặc định giữ bản nháp không hoạt động và lượt chạy đã kết thúc 30 ngày; worker dọn mỗi giờ. Prompt riêng/tài khoản giữ đến khi người quản trị quản lý. Có thể đổi `STUDIO_RETENTION_DAYS` trước khi khởi động. Xóa lịch sử xóa nội dung trong database hiện hành và file JSON; bản nháp là bản lưu riêng. Dữ liệu trong backup chỉ mất khi backup hết thời hạn lưu.

## Beta trên một VPS/host có Docker

1. Chọn host, region và domain. DNS trỏ vào host, mở cổng 80/443. API và database không mở cổng public riêng.
2. Copy `.env.deploy.example` thành `.env.deploy`; điền domain, `STUDIO_ORIGIN=https://domain`, key và tên model thực sự được cấp quyền. Giới hạn quyền đọc file này; không đưa vào Git hay image.
3. Build và khởi động:

```sh
docker compose --env-file .env.deploy build
docker compose --env-file .env.deploy up -d
docker compose --env-file .env.deploy exec api python -m summora.cli.users create email@example.com
```

Nhập mật khẩu trong terminal, không ghi mật khẩu vào command/history. Người dùng đăng nhập bằng tài khoản được cấp. Reset/revoke bằng `python -m summora.cli.users reset email@example.com` hoặc `revoke`. Reset/revoke hủy toàn bộ phiên cũ của tài khoản. Chưa có email xác minh, đăng ký public hay khôi phục qua email.

Caddy nhận HTTPS và chuyển tiếp tới API. Cấu hình theo tài liệu [FastAPI lifespan](https://fastapi.tiangolo.com/advanced/events/), [upload](https://fastapi.tiangolo.com/tutorial/request-files/) và [Caddy reverse_proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy). Chỉ tin forwarded headers trong mạng Docker riêng của cấu hình này; khi dùng proxy/hạ tầng khác cần giới hạn địa chỉ proxy được tin cậy.

`studio-data` là named volume dùng chung API/worker. Không dùng filesystem tạm, NFS hay nhiều host cho database SQLite này. Chỉ chạy **một worker**, có khóa riêng chống chạy lặp. Nhiều tài khoản được xếp hàng độc lập; mỗi tài khoản có tối đa một lượt đang chờ/chạy. Worker xử lý tuần tự, concurrency toàn hệ thống/provider bằng 1. Khi cần nhiều worker/host, cần chuyển database và queue sang dịch vụ phù hợp, không tăng replica cấu hình này.

## Giới hạn và trạng thái tác vụ

- Mặc định 200 tác vụ/tài khoản/ngày, 1.000 tác vụ toàn hệ thống/ngày theo UTC. Thay qua `STUDIO_DAILY_TASKS`, `STUDIO_GLOBAL_TASKS`.
- Mỗi lượt tối đa 100 tài liệu/tác vụ, 1 triệu ký tự nguồn; mỗi tài liệu 1–10 prompt, 10.000 ký tự/prompt; upload 24 MB/file, request 25 MB.
- Hạn mức được giữ chỗ khi nhận lượt, trừ khi tác vụ bắt đầu và trả phần chưa xử lý khi cancel/lỗi hệ thống. Hạn mức tác vụ không phải số tiền nhà cung cấp tính. Không hiển thị giá ước tính. Đặt thêm ngân sách thật trong tài khoản provider khi chạy online.
- Request dùng Idempotency-Key; gửi lặp cùng mã/nội dung trả cùng lượt. Retry kết quả là thao tác mới, tiêu tốn hạn mức mới.
- SDK không tự retry request. Nếu worker bị tắt giữa request, giữ kết quả đã lưu và đánh dấu request chưa xác định; không tự gửi lại. Nút chạy lại do người dùng chọn có thể tốn thêm phí nếu provider đã xử lý request cũ.
- Cancel chờ request hiện tại (timeout 120s), giữ kết quả đã xong. Shutdown worker có 150s để đóng lượt; các lượt còn nằm trong queue tiếp tục khi worker khởi động.

## Backup, phục hồi và rollback

Backup chứa văn bản/tóm tắt riêng tư và password hash; lưu ngoài thư mục web, hạn chế quyền đọc và mã hóa ổ/backup theo môi trường. Không có session token trong backup.

```sh
docker compose --env-file .env.deploy stop worker
docker compose --env-file .env.deploy exec api python -m summora.cli.backup backup /data/backup.zip
# Sao chép backup ra kho riêng rồi xóa bản nằm trong volume theo lịch vận hành.
docker compose --env-file .env.deploy cp api:/data/backup.zip ./backup.zip
docker compose --env-file .env.deploy start worker
```

Phục hồi vào **thư mục/volume trống khác**: `python -m summora.cli.backup restore backup.zip --data path/to/restored`. Chạy kiểm tra nguồn/kết quả/tài khoản, sau đó mới đổi mount/cấu hình. Các lượt queue trong backup không tự chạy để tránh gửi lại request đã xử lý sau thời điểm backup. Backup không chứa `.env`; giữ cấu hình/secret riêng.

Trước mỗi release: dừng nhận thao tác ở proxy hoặc thông báo bảo trì, chờ/dừng worker, backup, build image với version mới, chạy test rồi cập nhật API/worker. Giữ image/version và backup trước release. Rollback bằng version image cũ; nếu schema thay đổi phải phục hồi backup vào volume riêng và kiểm tra tương thích. Schema hiện tại là bản đầu tiên; chưa có migration cho thay đổi schema tương lai. Không dùng `docker compose down -v` với volume cần giữ.

`/health` kiểm tra database và báo lần worker được thấy. Trong lúc request dài, heartbeat có thể cũ tới 120s. Người vận hành cần thêm giám sát lỗi, dung lượng, queue, ngân sách và backup theo dịch vụ hosting. CI đã có file workflow; chỉ chạy tự động sau khi đưa repository lên GitHub.

## Trước khi public

Cần chốt hosting/domain/region/ngân sách, kiểm thử staging bằng model thật và HTTPS, khảo sát 5–8 người dùng, vận hành beta, thử khôi phục tại host và có kênh hỗ trợ. Chưa đo usability hay chứng nhận WCAG; hiện có hỗ trợ bàn phím, focus/dialog, responsive và reduced motion. OCR, chia đoạn nguồn dài, thanh toán, chia sẻ nhóm và xuất DOCX/PDF chưa nằm trong bản này.
