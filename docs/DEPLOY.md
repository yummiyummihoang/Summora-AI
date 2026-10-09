# Triển khai Summora

## Dịch vụ

- `web`: Next.js phục vụ giao diện và làm mới Supabase Auth session.
- `api`: FastAPI xác thực access token, xử lý nhập tài liệu và quản lý job.
- `worker`: consumer Python duy nhất cho hàng đợi PostgreSQL.
- Supabase: PostgreSQL và Supabase Auth. Dùng Supabase backups/PITR để bảo vệ database.
- Caddy: TLS và reverse proxy tới Next.js. FastAPI chỉ mở trong mạng Docker.

## Cấu hình

Sao chép `.env.deploy.example` thành `.env.deploy`. Điền domain, Supabase URL/key, `DATABASE_URL`, `DIRECT_URL` và provider credentials. Mã hóa ký tự đặc biệt trong mật khẩu PostgreSQL theo URL encoding. Worker cần kết nối trực tiếp hoặc qua Supavisor session mode vì khóa worker là PostgreSQL session advisory lock; không dùng transaction pooler cho kết nối worker.

`NEXT_PUBLIC_SUPABASE_URL` và `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` được đưa vào bundle web khi build. Đây là thông tin public của Supabase, không dùng service role key. `SUPABASE_JWT_SECRET` chỉ điền nếu project vẫn ký JWT HS256; khóa bất đối xứng được kiểm tra qua JWKS.

## Build và khởi động

```sh
docker compose --env-file .env.deploy build
docker compose --env-file .env.deploy up -d
```

Chạy `pnpm db:migrate` từ môi trường quản trị đã có `DIRECT_URL` để áp dụng schema trước khi nhận người dùng đầu tiên. Có thể chạy thủ công bằng `pnpm db:generate` và `pnpm db:migrate`. Bật email confirmation trong Supabase Auth production và cấu hình SMTP cho project.

Chỉ chạy một worker cho database này. Advisory lock ngăn worker thứ hai chạy đồng thời. Mỗi người dùng có tối đa một job đang chờ/chạy; quota mặc định 200 tác vụ/user/ngày và 1.000 tác vụ toàn hệ thống/ngày theo UTC. Giữ `STUDIO_DATA_DIR` trên volume bền vững vì worker lưu JSON kết quả tại đó.

## Kiểm tra sức khỏe và backup

`GET /health` trên FastAPI kiểm tra kết nối PostgreSQL và trả thời điểm worker cuối cùng được nhìn thấy. Thêm giám sát cho queue, provider errors, dung lượng volume, quota và ngân sách provider. Dùng tính năng backup của Supabase; giữ riêng các API key và `.env.deploy` ngoài Git/image.

Trước khi nâng phiên bản: backup Supabase, build image mới, áp dụng migration tương thích, sau đó cập nhật web/API/worker. Không chạy nhiều phiên bản worker đồng thời nếu schema thay đổi. Rollback cần kiểm tra tương thích migration và phục hồi backup vào project/branch riêng trước khi trỏ traffic production.
