# Phản Ánh Xanh

**Phản Ánh Xanh** là nền tảng tiếp nhận và xử lý phản ánh môi trường đô thị tại TP. Hồ Chí Minh, hỗ trợ người dân gửi sự cố kèm ảnh hiện trường, tự động kiểm tra chất lượng ảnh và phân loại bằng AI cục bộ, theo dõi tiến độ theo vị trí bản đồ GIS (phường/xã), lộ trình tuần tra cho cán bộ và đối chiếu hình ảnh Trước/Sau xử lý.

---

## Yêu cầu hệ thống

- **Node.js** `>= 22.12` (kèm `npm`)
- **Python** `>= 3.12`
- **PostgreSQL** (có sẵn `initdb`, `pg_ctl`, `psql`, `createdb`; nếu chưa nằm trong `PATH`, thiết lập biến môi trường `PG_BIN`)

---

## Hướng dẫn cài đặt và chạy (Windows)

### Bước 1: Tải mã nguồn

```powershell
git clone https://github.com/vudinhkhang/PhanAnhXanh.git
cd PhanAnhXanh
```

### Bước 2: Khởi động tự động toàn bộ hệ thống

Mở PowerShell tại thư mục dự án và chạy:

```powershell
./scripts/start-local.ps1
```

Script sẽ tự động thực hiện các bước sau:
1. Tạo môi trường ảo `.venv` và cài đặt các thư viện Python trong `backend/requirements.txt`.
2. Khởi tạo và khởi động PostgreSQL cục bộ ở cổng `55432` (lưu trong `.runtime/postgres`), đồng thời sinh cấu hình mặc định tại `.runtime/local.json`.
3. Tải mô hình AI phân tích cục bộ (`python -m backend.prepare_models`) và khởi tạo tài khoản mặc định (`python -m backend.seed`).
4. Cài đặt gói Node.js (`npm ci`), build giao diện React (`npm run build`) và khởi chạy máy chủ FastAPI.

Sau khi hoàn tất, truy cập: **http://127.0.0.1:8010/**

*(Tùy chọn)* Nếu muốn nạp thêm bộ dữ liệu phản ánh ban đầu vào PostgreSQL cục bộ:

```powershell
.\.venv\Scripts\python.exe -m backend.seed --samples
```

---

## Chế độ phát triển giao diện (tùy chọn)

Cài đặt dependencies (nếu chưa cài qua script trên):

```powershell
npm install
```

- **Chạy frontend kết nối API thật** (khi máy chủ FastAPI đang chạy ở cổng `8010`):
  ```powershell
  npm run dev
  ```
- **Chạy riêng giao diện chế độ demo trên trình duyệt** (không cần backend/PostgreSQL):
  ```powershell
  npm run demo
  ```

---

## Tài khoản đăng nhập mặc định

Mật khẩu chung cho các tài khoản: **`Demo1234`**

| Vai trò | Bản chạy cục bộ (`PostgreSQL`) | Chế độ `npm run demo` | Quyền hạn chính |
| --- | --- | --- | --- |
| Quản trị viên | `quantri@phananh.local` | `quantri@demo.vn` | Duyệt hồ sơ hàng chờ, phân công cán bộ, quản lý tài khoản và bảng tin |
| Cán bộ môi trường | `canbo@phananh.local` | `canbo@demo.vn` | Tiếp nhận, cập nhật tiến độ, đính kèm ảnh minh chứng và tuần tra khu vực phụ trách |
| Người dân | `nguoidan@phananh.local` | `nguoidan@demo.vn` | Gửi phản ánh mới, theo dõi tiến độ và tự hủy hồ sơ của mình |
