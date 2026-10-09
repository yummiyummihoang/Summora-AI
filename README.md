# Summora

Web tóm tắt văn bản bằng AI: nhập hoặc kéo thả nhiều tài liệu, chọn model/prompt,
đặt độ dài theo phần trăm hoặc số từ, xem kết quả cạnh nguồn và lưu lịch sử.

## Khởi động

Yêu cầu Python 3.10 trở lên. Trên Windows, mở `start_web.cmd`.
Launcher tạo `.venv`, cài đúng phiên bản trong `requirements.lock.txt` và mở
<http://127.0.0.1:8765>. Giữ cửa sổ terminal mở khi sử dụng.

Chạy tại thư mục dự án với cổng riêng:

```powershell
.\.venv\Scripts\python.exe -m summora --port 52635
```

Nếu cài thủ công: tạo môi trường Python, chạy `pip install -r requirements.lock.txt`,
copy `.env.example` thành `.env`, rồi chạy `python -m summora`.
Điền API key và model vào `.env`; không đưa file này vào Git.

## Cấu trúc

```text
summora/             Backend Python
  api.py             FastAPI, phiên làm việc và các route
  config.py          Cấu hình nhà cung cấp
  paths.py           Đường dẫn dữ liệu và tài nguyên
  providers.py       Kết nối API mô hình
  formats.py         Đọc CSV/JSON, kiểm tra prompt, ghi JSON
  documents.py       Nhập TXT, DOCX, PDF, JSON, CSV
  tasks.py           Chuẩn hóa tác vụ và xử lý tóm tắt
  storage.py         SQLite, tài khoản, hạn mức và hàng đợi
  worker.py          Worker xử lý hàng đợi
  cli/               Quản lý tài khoản, backup và đóng gói
web/                 HTML, CSS, JavaScript và logo
resources/           Thư viện prompt mặc định
tests/               Kiểm thử và server preview với model giả
deploy/              Cấu hình reverse proxy Caddy
docs/                Hướng dẫn triển khai và vận hành
studio_data/         Database và kết quả riêng tư, không đưa vào Git
```

`Dockerfile` và `compose.yaml` nằm ở gốc để build/deploy trực tiếp.
Backend dùng FastAPI/Uvicorn và SQLite; frontend dùng JavaScript modules.

## Kiểm tra

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
node --check web/app.js
node --test tests/test_state.mjs
```

Các test dùng client giả, không gọi API trả phí. Preview riêng:
`python -m tests.serve_studio --port 52636`.
Định dạng và kiểm tra mã Python: `ruff format .` và `ruff check .`
(cài công cụ phát triển bằng `pip install -r requirements-dev.txt`).
Định dạng giao diện bằng `npx prettier@3.6.2 --write "web/*.js" "web/*.css" "web/*.html"`.

## Dữ liệu và triển khai

Bản nháp/lịch sử nằm trong `studio_data/studio.sqlite3`; kết quả xuất JSON cùng thư mục.
Dữ liệu và `.env` được giữ nguyên sau lần dọn cấu trúc. Các backup trước đó nằm tại
`../summora_backups/`, ngoài mã ứng dụng.

```powershell
python -m summora.cli.backup backup ../summora_backups/manual.zip
python -m summora.cli.share
```

ZIP chia sẻ chỉ chứa mã, tài nguyên, test và cấu hình mẫu; không chứa key hoặc dữ liệu riêng.
Để chạy online, xem [hướng dẫn triển khai](docs/DEPLOY.md): HTTPS, tài khoản riêng,
một worker và ổ đĩa bền vững.
