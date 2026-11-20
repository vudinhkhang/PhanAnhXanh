# Phản Ánh Xanh

Cổng phản ánh môi trường bằng tiếng Việt, gồm giao diện React, API FastAPI, PostgreSQL và bộ phân loại ảnh chạy cục bộ. Bản khởi tạo có sáu hồ sơ minh họa. Dữ liệu mới được lưu riêng tư, trừ khi người gửi chọn chia sẻ lên bảng tin.

## Chạy trên Windows

Cần Node.js 22.12 trở lên, Python 3.12 trở lên và PostgreSQL với các công cụ `initdb`, `pg_ctl`, `psql`, `createdb`. Nếu PostgreSQL ở ngoài đường dẫn mặc định, đặt biến `PG_BIN` trỏ tới thư mục `bin` của PostgreSQL.

Từ thư mục dự án, chạy trong PowerShell:

```powershell
./scripts/start-local.ps1
```

Mở [Phản Ánh Xanh](http://127.0.0.1:8010/). Lệnh trên chuẩn bị môi trường Python, tải mô hình lần đầu, build React và chạy FastAPI. Cơ sở dữ liệu dự án dùng cổng 55432 trên loopback và lưu trong `.runtime/postgres`. Những lần chạy tiếp theo giữ lại dữ liệu.

Mục **Thông tin địa phương** đọc tiêu đề, ngày đăng và liên kết từ hai kênh RSS [Thời sự](https://dantri.com.vn/rss/thoi-su.rss) và [Khoa học](https://dantri.com.vn/rss/khoa-hoc.rss) của Dân trí dành cho bản cộng đồng phi lợi nhuận. Máy chủ cập nhật mỗi 30 phút và có các bài chọn lọc dẫn nguồn để đọc trong chế độ demo hoặc lúc nguồn ngoài thiếu tin. Đặt `NEWS_FEEDS_ENABLED=0` để tắt đồng bộ RSS.

Trang chi tiết dùng `react-markdown` để hiển thị các bản tóm tắt trong `src/articles`. Tin RSS có thể hiện trích đoạn ngắn và liên kết tới bài gốc. Mỗi bài chọn lọc dùng một đường dẫn nội bộ ổn định, kể cả khi đã rời khỏi bản tin RSS.

Đăng ký trên giao diện để dùng vai trò người dân. Email và mật khẩu khởi tạo cho cán bộ và quản trị viên được sinh trong `.runtime/local.json`, với các trường `staff_email`, `staff_password`, `admin_email` và `admin_password`. Thư mục này đã được loại khỏi Git.

Dừng FastAPI bằng Ctrl+C. Để dừng riêng PostgreSQL của dự án, dùng công cụ `pg_ctl` từ thư mục cài PostgreSQL:

```powershell
pg_ctl -D .runtime/postgres -m fast stop
```

## Phát triển giao diện

```powershell
npm ci
npm run demo
```

Chế độ demo dùng 11 hồ sơ minh họa và lưu thay đổi trong trình duyệt. Mật khẩu demo là `Demo1234`.

| Vai trò | Chế độ mô phỏng | Bản chạy cục bộ đã nạp demo |
| --- | --- | --- |
| Quản trị viên, xem toàn bộ hồ sơ, phân công và quản lý tài khoản | `quantri@demo.vn` | `quantri@phananh.local` |
| Cán bộ, xử lý hồ sơ được giao hoặc thuộc khu vực phụ trách | `canbo@demo.vn` | `canbo@phananh.local` |
| Người dân, gửi phản ánh và theo dõi hồ sơ của mình | `nguoidan@demo.vn` | `nguoidan@phananh.local` |

Các hồ sơ dùng ảnh được cung cấp và vị trí mô phỏng. Ngày gửi được rải từ đầu tháng đến ngày nạp dữ liệu. Lệnh khởi động chỉ cấp tài khoản theo cấu hình cục bộ. Có thể nạp riêng bộ hồ sơ mẫu bằng `python -m backend.seed --samples`.

Khi FastAPI đang chạy ở cổng 8010, dùng `npm run dev` để chỉnh sửa React với dữ liệu thật. Vite chuyển tiếp các yêu cầu `/api` đến FastAPI. Bản build thông thường dùng API.

## Tiếp nhận và xử lý

1. Người dân có thể gửi phản ánh với tư cách khách hoặc bằng tài khoản. Nhập mô tả, địa điểm và chọn tối đa ba ảnh JPG, PNG hoặc WebP. Có thể xem trước và xóa từng ảnh trước khi gửi.
2. FastAPI lưu hồ sơ và ảnh rồi trả mã ngay. Mục **Theo dõi phản ánh** hiển thị trạng thái **Đang kiểm tra**, **Chờ duyệt**, **Đã từ chối** hoặc trạng thái xử lý sau khi hồ sơ được tiếp nhận.
3. Tiến trình nền kiểm tra mô tả, phân tích từng ảnh và đối chiếu chúng với nhau. Hệ thống từ chối lỗi rõ ràng và chuyển hồ sơ còn nghi vấn vào hàng **Chờ duyệt**. Khi người gửi đồng ý và có cấu hình Deploy, mô tả và ảnh có thể được gửi tới DeepSeek để kiểm tra thêm.
4. Cụm từ chỉ nguy cơ trong mô tả hoặc mức ưu tiên cao do cán bộ chọn sẽ tạo thông báo nội bộ. Chuông thông báo tự cập nhật khi cán bộ hoặc quản trị viên sử dụng ứng dụng.
5. Khi tiếp nhận, hệ thống kiểm tra hồ sơ đang mở cùng nhóm tại cùng vị trí. Vị trí trùng được xác định bằng ghim trong 30 m hoặc địa chỉ đầy đủ đã chuẩn hóa. Nếu bằng chứng vị trí chưa rõ, cán bộ kiểm tra trong hàng chờ. Chỉ hồ sơ đã qua kiểm tra mới có thể phân công và xuất hiện công khai khi người gửi chọn chia sẻ.
6. Cán bộ có thể tiếp nhận hoặc từ chối hồ sơ trong hàng chờ, với lý do được lưu trong lịch sử. Người dân tra cứu bằng mã hoặc vào **Hồ sơ của tôi**. Quản trị viên có thể mở lại hồ sơ bị từ chối để duyệt lại.

Khách dùng mã hồ sơ và trình duyệt đã gửi để xem phản ánh riêng tư. Quyền xem lưu trong cookie riêng cho từng hồ sơ, tối đa 180 ngày. Trong 15 phút, mỗi địa chỉ IP gửi tối đa 8 lượt với tư cách khách và mỗi tài khoản gửi tối đa 15 lượt.

Mô hình được tải và kiểm tra SHA-256 bằng `python -m backend.prepare_models`. PostgreSQL giữ hàng đợi qua các lần khởi động lại. Khi bộ phân tích cục bộ gặp lỗi, hồ sơ mới chuyển sang **Chờ duyệt**.

Bộ phân loại mô tả tiếng Việt sử dụng đặc trưng từ và cụm ký tự để hỗ trợ tám nhóm, kể cả văn bản không dấu. Chạy `python -m backend.train_text` để thử lại các cấu hình, in kết quả trước và sau trên bộ kiểm thử riêng và tạo `backend/data/text_model.npz`. Các chỉ số này được đo trên câu mẫu tự soạn. CLIP tiếp tục xử lý ảnh, độc lập với trọng số mô tả.

Ảnh hồi quy `tests/data/house-smoke.jpg` được lưu nguyên bản từ Wikimedia Commons và dùng để kiểm tra luồng duyệt khi nguồn khói chưa rõ. [Smoke stream raising from a house fire, Public Domain Images](https://commons.wikimedia.org/wiki/File:Smoke_stream_raising_from_a_house_fire.jpg)

## AI xử lý ảnh (DeepSeek qua Deploy)

Tài liệu: [docs.deploy.com/deepseek-v4-1-flash-1017](https://docs.deploy.com/deepseek-v4-1-flash-1017). API tương thích OpenAI tại `https://api-cdn.deploy.com/api/v1`, model `deepseek-ai/deepseek-v4.1-flash-1017`.

- Đặt khóa vào biến môi trường `DEPLOY_API_KEY`, hoặc trường `deploy_api_key` trong `.runtime/local.json` (script khởi động sẽ nạp). Không ghi khóa vào mã nguồn.
- Biến tùy chọn: `DEPLOY_BASE_URL`, `DEPLOY_MODEL`, `DEPLOY_TIMEOUT` (giây, mặc định 40).
- Chỉ gọi dịch vụ ngoài để kiểm tra thêm khi người gửi tích chọn đồng ý. Hệ thống gửi mô tả và ảnh nếu có. Ảnh được thu nhỏ tối đa 1024 px, chuyển JPEG và bỏ EXIF. Không gửi các trường tên, email hay tọa độ.
- Mô tả ảnh (`ai_summary`) và nguồn phân tích (`ai_source`) chỉ hiện cho người gửi, cán bộ và quản trị viên.
- Kiểm thử đơn vị: `.venv/Scripts/python -m unittest tests.test_vision`.

## Kiểm thử

Cài Chromium cho Playwright một lần:

```powershell
npx playwright install chromium
```

Có thể đặt `CHROME_PATH` trỏ tới Chromium có sẵn. Để kiểm tra chế độ mẫu, mở hai cửa sổ PowerShell:

```powershell
# Cửa sổ thứ nhất
npm run demo -- --port 5174
# Cửa sổ thứ hai
npm test
```

Để kiểm tra toàn bộ hệ thống sau khi đã chạy script khởi tạo:

```powershell
npm run build
.venv/Scripts/python scripts/test-integration.py
```

Bộ kiểm thử tạo một cơ sở dữ liệu PostgreSQL tạm, chạy API trên một cổng riêng và dọn cơ sở dữ liệu sau khi hoàn tất. Playwright thao tác trên giao diện ở 390 × 844 và 1440 × 960. Kiểm tra API bao gồm kiểm tra hồ sơ, duyệt thủ công, chống trùng, quyền xem ảnh, giới hạn đính kèm, thông báo và phân quyền. Ảnh chụp giao diện nằm ở `.runtime/qa`.

## Bản đồ GIS

Ở **Gửi phản ánh**, chọn **Chọn trên bản đồ**, tìm tên phường/xã hoặc sử dụng vị trí thiết bị. Chạm bản đồ, kéo ghim hoặc dùng **Ghim tại tâm bản đồ** để chọn điểm. Định vị là tùy chọn. Tọa độ WGS84 và tên phường/xã được lưu cùng hồ sơ trong PostgreSQL.

[Bản đồ cộng đồng](http://127.0.0.1:8010/#/community?view=map) dùng chung bộ lọc với danh sách. API công cộng làm tròn tọa độ tới 0,01 độ và thay địa chỉ chi tiết của hồ sơ có ghim bằng tên khu vực. Người gửi, cán bộ và quản trị viên mở được tọa độ gốc trong hồ sơ. Nội dung và ảnh người dân chọn chia sẻ vẫn xuất hiện trên bảng tin.

Trong **Quản lý hồ sơ → Thống kê → Thống kê theo phường/xã**, lọc theo nhóm, trạng thái hoặc từ khóa. Máy chủ xác định phường/xã bằng phép đối chiếu điểm với đa giác ranh giới cục bộ. Hồ sơ thiếu ghim hoặc nằm ngoài lớp ranh giới được tính vào “Chưa xác định phường/xã”. Ghim của sáu hồ sơ minh họa là vị trí mẫu.

Nền đường phố dùng Leaflet và dịch vụ raster của [OpenStreetMap DE / FOSSGIS](https://tile.openstreetmap.de/). Khi mất kết nối dịch vụ nền, lớp ranh giới tỉnh và các ghim vẫn dùng được. Danh mục tìm kiếm và ranh giới được trích từ [Vietnamese Provinces Database v5.2.0](https://github.com/thanglequoc/vietnamese-provinces-database/releases/tag/v5.2.0), với [giấy phép đi kèm](backend/data/LICENSE.txt). Đường biên đã được giản lược phục vụ thống kê. Có thể tái tạo các tệp bằng `python scripts/prepare-gis.py <đường-dẫn-vn_provinces_wards_geojson.zip>`.

## Tệp chính

- `src/` chứa giao diện React, các biểu mẫu, màn hình quản lý và dữ liệu mẫu.
- `backend/` chứa API, cấu trúc PostgreSQL, phân loại AI và hàng đợi xử lý.
- `public/images/` chứa banner, logo trong suốt và ba ảnh hiện trường minh họa do ImageGen tạo.
- `assets/prompts/` lưu prompt riêng của từng ảnh.
- `tests/` chứa kiểm thử trình duyệt và API.

