# Triển khai Summora

## Dịch vụ

- `web`: Next.js phục vụ giao diện và làm mới Supabase Auth session.
- `api`: FastAPI xác thực access token, xử lý nhập tài liệu và quản lý job.
- `worker`: consumer Python duy nhất cho hàng đợi PostgreSQL.
- Supabase: PostgreSQL, Auth và private Storage bucket `summora-results` cho file kết quả. Dùng Supabase backups/PITR để bảo vệ database và backup riêng bucket Storage.
- Caddy: TLS và reverse proxy tới Next.js. FastAPI chỉ mở trong mạng Docker.

## Cấu hình

Sao chép `.env.deploy.example` thành `.env.deploy`. Điền domain, Supabase URL/key, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `DIRECT_URL` và provider credentials. Service role key chỉ dùng ở API/worker phía máy chủ; không đặt vào biến `NEXT_PUBLIC_*`. Mã hóa ký tự đặc biệt trong mật khẩu PostgreSQL theo URL encoding. Worker cần kết nối trực tiếp hoặc qua Supavisor session mode vì khóa worker là PostgreSQL session advisory lock; không dùng transaction pooler cho kết nối worker.

`NEXT_PUBLIC_SUPABASE_URL` và `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` được đưa vào bundle web khi build. Đây là thông tin public của Supabase, không dùng service role key. `SUPABASE_JWT_SECRET` chỉ điền nếu project vẫn ký JWT HS256; khóa bất đối xứng được kiểm tra qua JWKS.

## Build và khởi động

```sh
docker compose --env-file .env.deploy build
docker compose --env-file .env.deploy up -d
```

Chạy `pnpm db:migrate` từ môi trường quản trị đã có `DIRECT_URL` để áp dụng schema và tạo private bucket trước khi nhận người dùng đầu tiên. Có thể chạy thủ công bằng `pnpm db:generate` và `pnpm db:migrate`. Bật email confirmation trong Supabase Auth production và cấu hình SMTP cho project.

Chỉ chạy một worker cho database này. Advisory lock ngăn worker thứ hai chạy đồng thời. Mỗi người dùng có tối đa một job đang chờ/chạy; quota mặc định 200 tác vụ/user/ngày và 1.000 tác vụ toàn hệ thống/ngày theo UTC. Worker ghi JSON tạm trên đĩa rồi đồng bộ file hoàn tất sang private Supabase Storage; Compose ghi đè `STUDIO_DATA_DIR=/data` trên volume bền vững, còn Vercel dùng `/tmp/summora` vì filesystem của service không bền vững. Tệp nhập được giới hạn 3 MB để nằm dưới giới hạn request của Vercel.

## Vercel

Kết nối repository ở thư mục gốc, chọn framework **Services** trong Build and Deployment settings. `vercel.json` cấu hình Next.js frontend, FastAPI container, API rewrites và một Vercel Daemon chạy worker. Daemons hiện chỉ chạy ở production; preview có frontend/API nhưng không xử lý job nền. Tạo Supabase project và thiết lập các biến trong `.env.deploy.example` ở Vercel cho cả API và worker; web cần `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `DATABASE_URL` và `DIRECT_URL`. Thêm domain Vercel vào Supabase Auth redirect URLs. Sau đó chạy migration bằng `pnpm db:migrate` từ máy có quyền truy cập database rồi deploy production.

## Kiểm tra sức khỏe và backup

`GET /health` trên FastAPI kiểm tra kết nối PostgreSQL và trả thời điểm worker cuối cùng được nhìn thấy. Thêm giám sát cho queue, provider errors, dung lượng volume, quota và ngân sách provider. Dùng tính năng backup của Supabase; giữ riêng các API key và `.env.deploy` ngoài Git/image.

Trước khi nâng phiên bản: backup Supabase, build image mới, áp dụng migration tương thích, sau đó cập nhật web/API/worker. Không chạy nhiều phiên bản worker đồng thời nếu schema thay đổi. Rollback cần kiểm tra tương thích migration và phục hồi backup vào project/branch riêng trước khi trỏ traffic production.
