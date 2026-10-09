# Summora AI

Summora là không gian tóm tắt tài liệu bằng AI. Ứng dụng gồm giao diện Next.js, Supabase Auth/PostgreSQL và API/worker Python FastAPI. Các luồng chính gồm nhập TXT/DOCX/PDF/JSON/CSV, cấu hình model và prompt, xử lý job có hàng đợi, xem lịch sử, lưu bản nháp và tải kết quả JSON.

## Công nghệ

- `apps/web`: Next.js App Router, pnpm, Tailwind CSS và các component theo shadcn/ui.
- Supabase: đăng ký/đăng nhập email và PostgreSQL.
- Prisma: schema/migration và các thao tác hồ sơ, bản nháp, thư viện prompt trong Next.js.
- `services/api/summora/`: FastAPI xác minh Supabase JWT, nhập tài liệu và quản lý API job.
- `services/api/summora.worker`: worker Python gọi provider; SQLAlchemy kết nối cùng Supabase PostgreSQL.

## Cấu hình local

1. Tạo Supabase project và bật email/password trong Authentication. Dùng URL project, publishable/anon key và connection string PostgreSQL từ Project Settings.
2. Sao chép `.env.example` thành `.env` ở repo root cho FastAPI/worker và Prisma CLI. Sao chép `apps/web/.env.local.example` thành `apps/web/.env.local` cho Next.js; điền Supabase URL/key cùng database URLs ở cả hai file. Dùng PostgreSQL connection trực tiếp hoặc session pooler; worker cần giữ một PostgreSQL session để khóa advisory hoạt động.
3. Cài Python 3.10+, Node.js 20.9+ và pnpm 10+.

```powershell
pnpm install
pnpm db:generate
pnpm db:migrate
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.lock.txt
```

Mở ba terminal tại thư mục repo:

```powershell
pnpm dev
```

```powershell
$env:PYTHONPATH = "services/api"; .\.venv\Scripts\python.exe -m uvicorn summora.api:create_app --factory --app-dir services/api --host 127.0.0.1 --port 8000
```

```powershell
$env:PYTHONPATH = "services/api"; .\.venv\Scripts\python.exe -m summora.worker
```

Truy cập <http://localhost:3000>. Khi bật email confirmation, người đăng ký cần xác nhận email trước khi đăng nhập. Trong local, có thể tắt confirmation trong Supabase Auth để thử nhanh.

## Biến môi trường

`DATABASE_URL` dùng bởi FastAPI/SQLAlchemy và Prisma runtime. `DIRECT_URL` dùng bởi Prisma migration. Cả hai cần trỏ tới cùng Supabase database. `FASTAPI_INTERNAL_URL` mặc định là `http://localhost:8000` trong Next.js dev. `WEB_ORIGIN` phải khớp origin của trình duyệt. Provider keys và model names chỉ được đọc phía Python, không trả key cho trình duyệt.

Các bảng mới được khai báo trong `prisma/schema.prisma` và migration `prisma/migrations`. Migration tạo profile khi người dùng đăng ký và bật RLS; web/API xác thực quyền sở hữu theo `user_id`. Không đặt Supabase service role key trong biến `NEXT_PUBLIC_*`.

## Docker triển khai

Sao chép `.env.deploy.example` thành `.env.deploy`, cấu hình domain, Supabase connection và provider. Sau đó chạy:

```sh
docker compose --env-file .env.deploy build
docker compose --env-file .env.deploy up -d
```

Caddy nhận HTTPS và gửi tới Next.js. Next.js proxy `/api/*` nội bộ tới FastAPI; worker xử lý job tuần tự. PostgreSQL/Auth được cung cấp bởi Supabase. Chỉ chạy một worker cho cùng database; PostgreSQL advisory lock ngăn một worker thứ hai khởi động.

## Bảo mật và dữ liệu

- Supabase Auth quản lý mật khẩu, phiên và xác minh email.
- FastAPI xác minh access token bằng Supabase JWKS (JWT HS256 cần `SUPABASE_JWT_SECRET`).
- File kết quả tạm nằm trong `studio_data/`; xóa job hoặc hết thời hạn lưu sẽ xóa nội dung liên quan.
- Không có dữ liệu SQLite lịch sử trong repository để nhập. Bản triển khai bắt đầu với Supabase database mới.
- Bật backup/point-in-time recovery trong Supabase theo gói hosting và lưu API keys ngoài Git.

## Kiểm tra

```powershell
pnpm --filter @summora/web build
python -m compileall services/api/summora
$env:PYTHONPATH = "services/api"; python -m unittest tests.test_tasks tests.test_auth -v
```

Luồng tích hợp cần Supabase project và provider key: đăng ký/xác nhận email, job mẫu, quota, hủy job, worker restart, ownership giữa hai tài khoản và tải JSON. Không cần provider thật để chạy unit tests hiện có.
