import React, { useState } from "react";
import { Mail, Phone, Clock, Siren, Shield, Flame, Ambulance } from "lucide-react";
import { Page } from "./ui";
import { SITE, FAQ, EMERGENCY } from "./site";
import { groups } from "./domain";

const groupList = new Intl.ListFormat("vi", { type: "disjunction" }).format(
  Object.values(groups).map((label) => label.toLocaleLowerCase("vi")),
);

export function FaqList({ items = FAQ }) {
  return (
    <div className="faq-list">
      {items.map(([q, a]) => (
        <details key={q}>
          <summary>{q}</summary>
          <p>{a}</p>
        </details>
      ))}
    </div>
  );
}
const emergencyIcons = { "113": Shield, "114": Flame, "115": Ambulance };

export function EmergencyNote() {
  return (
    <div className="emergency" role="note" aria-label="Số điện thoại khẩn cấp">
      <Siren size={20} aria-hidden="true" />
      <div className="emergency-body">
        <strong>Phản Ánh Xanh không phải kênh cấp cứu.</strong>
        <p>Khi có cháy nổ, rò rỉ hóa chất hoặc nguy hiểm đến tính mạng, hãy gọi ngay:</p>
        <ul className="emergency-links">
          {EMERGENCY.map(([number, label]) => {
            const Icon = emergencyIcons[number];
            return (
              <li key={number}>
                <a href={"tel:" + number}>
                  <Icon className="emergency-service-icon" size={17} aria-hidden="true" />
                  <span className="emergency-service-text"><b>{number}</b> <span>{label}</span></span>
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
export function About() {
  return (
    <Page title="Giới thiệu" back="/" backLabel="Trang chủ">
      <div className="panel prose">
        <h2>Một dự án của cộng đồng</h2>
        <p>
          {SITE.name} là dự án độc lập do cộng đồng tình nguyện vận hành tại
          TP. Hồ Chí Minh, không thuộc cơ quan nhà nước. Mục tiêu của chúng tôi
          là giúp người dân thành phố ghi nhận vấn đề môi trường quanh mình,
          theo dõi quá trình xử lý và nhìn thấy bức tranh chung của từng
          phường/xã.
        </p>
        <h2>Cách hệ thống hoạt động</h2>
        <ul>
          <li>
            Người dân gửi mô tả, địa điểm (ghim trong phạm vi TP. Hồ Chí Minh)
            và tối đa 3 ảnh hiện trường.
          </li>
          <li>
            AI gợi ý một nhóm phản ánh ({groupList}). Hệ thống luôn phân
            tích bằng mô hình cục bộ trước. Nếu cần kiểm tra thêm và bạn đồng
            ý, mô tả và ảnh đính kèm (nếu có) được gửi đến DeepSeek qua Deploy.
          </li>
          <li>
            Cán bộ xác nhận nhóm, mức ưu tiên, cập nhật trạng thái và phản hồi
            cho người gửi.
          </li>
          <li>
            Phản ánh được người gửi chọn chia sẻ sẽ hiện trên bảng tin và bản
            đồ cộng đồng.
          </li>
        </ul>
        <h2>Nguyên tắc của chúng tôi</h2>
        <ul>
          <li>
            <b>Riêng tư mặc định:</b> hồ sơ chỉ công khai khi bạn đồng ý.
          </li>
          <li>
            <b>Minh bạch:</b> hệ thống giữ cả gợi ý AI và kết quả do cán bộ xác
            nhận.
          </li>
          <li>
            <b>Dữ liệu mở có ghi công:</b> bản đồ nền từ OpenStreetMap, ranh giới
            hành chính từ Vietnamese Provinces Database.
          </li>
        </ul>
        <h2>Lưu ý</h2>
        <p>
          Vì là dự án cộng đồng, chúng tôi không thay thế cơ quan chức năng và
          không cam kết thời hạn xử lý. Với vụ việc nghiêm trọng, vui lòng liên
          hệ trực tiếp chính quyền địa phương.
        </p>
        <EmergencyNote />
      </div>
    </Page>
  );
}
export function Faq() {
  return (
    <Page title="Câu hỏi thường gặp">
      <FaqList />
      <EmergencyNote />
    </Page>
  );
}
export function Privacy() {
  return (
    <Page title="Chính sách quyền riêng tư">
      <div className="panel prose">
        <small>Cập nhật lần cuối: tháng 11/{SITE.year}</small>
        <h2>1. Dữ liệu chúng tôi thu thập</h2>
        <ul>
          <li>Họ tên và email khi đăng ký; mật khẩu được lưu dạng băm.</li>
          <li>Nội dung phản ánh, địa điểm, tọa độ ghim (nếu có) và ảnh đính kèm.</li>
          <li>Dữ liệu phiên đăng nhập cần thiết để duy trì tài khoản.</li>
        </ul>
        <h2>2. Mục đích sử dụng</h2>
        <p>
          Dữ liệu chỉ dùng để tiếp nhận, phân loại, xử lý và phản hồi phản ánh,
          cũng như thống kê tổng hợp theo khu vực. Chúng tôi không bán hoặc
          chia sẻ dữ liệu cá nhân cho bên thứ ba vì mục đích thương mại.
        </p>
        <h2>3. Ai được xem dữ liệu</h2>
        <ul>
          <li>Hồ sơ riêng tư: người gửi, cán bộ phụ trách và quản trị viên.</li>
          <li>
            Hồ sơ chia sẻ: công khai nội dung, ảnh, tên phường/xã và tọa độ làm
            tròn khoảng 1 km. Email và tọa độ gốc không công khai.
          </li>
        </ul>
        <h2>4. Phân tích bằng AI</h2>
        <p>
          Hệ thống luôn chạy mô hình cục bộ trên máy chủ dự án trước. Khi mô
          hình cục bộ đủ độ tin cậy hoặc bạn không tích chọn đồng ý, ảnh không
          rời khỏi máy chủ. Kết quả chỉ là gợi ý và cán bộ xác nhận cuối cùng.
        </p>
        <p>
          Nếu cần kiểm tra thêm và bạn đã đồng ý, hệ thống gửi mô tả và ảnh
          đính kèm (nếu có) tới dịch vụ AI của Deploy để DeepSeek phân tích.
          Ảnh được thu nhỏ, chuyển sang JPEG và bỏ thông tin EXIF gồm vị trí.
          Hệ thống không gửi các trường tên, email hay tọa độ ghim. Nếu dịch vụ không phản hồi, hệ
          thống giữ kết quả từ bộ phân tích cục bộ. Việc xử lý và lưu trữ phía
          Deploy theo chính sách của họ tại{" "}
          <a href="https://deploy.com/privacy" target="_blank" rel="noreferrer">
            deploy.com/privacy
          </a>
          . Bạn có thể bỏ chọn mà vẫn gửi phản ánh bình thường.
        </p>
        <h2>5. Dịch vụ bên thứ ba</h2>
        <p>
          Bản đồ nền được tải từ OpenStreetMap DE / FOSSGIS, nên trình duyệt của
          bạn có thể gửi địa chỉ IP tới dịch vụ này khi xem bản đồ. Dịch vụ AI
          Deploy chỉ nhận dữ liệu khi bạn đồng ý, như mô tả ở mục 4.
        </p>
        <h2>6. Thời gian lưu trữ và quyền của bạn</h2>
        <p>
          Dữ liệu được lưu trong thời gian tài khoản còn hoạt động hoặc cần thiết
          cho việc xử lý hồ sơ. Bạn có quyền yêu cầu xem, chỉnh sửa hoặc xóa dữ
          liệu cá nhân theo quy định của Nghị định 13/2023/NĐ-CP bằng cách gửi
          email tới <a href={"mailto:" + SITE.email}>{SITE.email}</a>.
        </p>
      </div>
    </Page>
  );
}
export function Terms() {
  return (
    <Page title="Điều khoản sử dụng">
      <div className="panel prose">
        <small>Cập nhật lần cuối: tháng 11/{SITE.year}</small>
        <h2>1. Chấp nhận điều khoản</h2>
        <p>
          Khi đăng ký hoặc gửi phản ánh trên {SITE.name}, bạn đồng ý với các điều
          khoản dưới đây.
        </p>
        <h2>2. Nội dung phản ánh</h2>
        <ul>
          <li>Cung cấp thông tin trung thực, đúng sự việc bạn trực tiếp ghi nhận.</li>
          <li>
            Không đăng nội dung sai sự thật, xúc phạm, quảng cáo, vi phạm pháp
            luật hoặc chứa thông tin cá nhân của người khác.
          </li>
          <li>Chỉ đính kèm ảnh do bạn chụp hoặc có quyền sử dụng.</li>
        </ul>
        <h2>3. Quyền của người vận hành</h2>
        <p>
          Chúng tôi có thể ẩn, chỉnh sửa hoặc xóa nội dung vi phạm, và khóa tài
          khoản vi phạm nhiều lần mà không cần báo trước.
        </p>
        <h2>4. Giới hạn trách nhiệm</h2>
        <p>
          {SITE.name} là dự án cộng đồng độc lập, không phải cơ quan nhà nước.
          Chúng tôi không cam kết thời hạn hay kết quả xử lý, và không chịu trách
          nhiệm với thiệt hại phát sinh từ việc sử dụng thông tin trên website.
          Gợi ý của AI có thể chưa chính xác.
        </p>
        <h2>5. Trường hợp khẩn cấp</h2>
        <p>Website không phải kênh cấp cứu. Hãy gọi 113, 114 hoặc 115.</p>
        <h2>6. Thay đổi điều khoản</h2>
        <p>
          Điều khoản có thể được cập nhật; việc tiếp tục sử dụng website nghĩa là
          bạn chấp nhận phiên bản mới.
        </p>
      </div>
    </Page>
  );
}
export function Contact() {
  const [sent, setSent] = useState(false);
  function submit(e) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const subject = encodeURIComponent("Góp ý: " + f.get("subject"));
    const body = encodeURIComponent(
      f.get("message") + "\n\n— " + f.get("name") + " (" + f.get("email") + ")",
    );
    window.location.href = `mailto:${SITE.email}?subject=${subject}&body=${body}`;
    setSent(true);
  }
  return (
    <Page title="Liên hệ và góp ý" wide>
      <div className="contact-grid">
        <div className="panel contact-info">
          <h2>Thông tin liên hệ</h2>
          <p>
            <Mail size={17} />
            <a href={"mailto:" + SITE.email}>{SITE.email}</a>
          </p>
          <p>
            <Phone size={17} />
            <a href={"tel:" + SITE.phone.replaceAll(" ", "")}>{SITE.phone}</a>
          </p>
          <p>
            <Clock size={17} />
            {SITE.hours}
          </p>
          <EmergencyNote />
        </div>
        <form className="panel form" onSubmit={submit}>
          <h2>Gửi góp ý</h2>
          <label>
            Họ và tên
            <input name="name" required maxLength={80} autoComplete="name" />
          </label>
          <label>
            Email
            <input
              type="email"
              name="email"
              required
              maxLength={180}
              autoComplete="email"
            />
          </label>
          <label>
            Chủ đề
            <input name="subject" required maxLength={120} />
          </label>
          <label>
            Nội dung
            <textarea name="message" rows={5} required maxLength={2000} />
          </label>
          <small>Nút gửi sẽ mở ứng dụng email của bạn với nội dung đã điền.</small>
          <button className="btn green">Gửi góp ý</button>
          {sent && <p aria-live="polite">Đã mở ứng dụng email của bạn.</p>}
        </form>
      </div>
    </Page>
  );
}
