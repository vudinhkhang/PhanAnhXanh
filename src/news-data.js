import cameraArticle from "./articles/camera-chong-do-trom-rac-tphcm.md?raw";
import waterArticle from "./articles/lo-trinh-xu-ly-nuoc-thai-tphcm.md?raw";
import wasteArticle from "./articles/thu-gom-chat-thai-tang-nhon-phu.md?raw";
import communityArticle from "./articles/khu-dan-cu-bao-ve-moi-truong.md?raw";

export const topics = {
  waste: ["Rác thải và tái chế", "/images/waste.webp"],
  water: ["Nước và ngập", "/images/water.webp"],
  air: ["Chất lượng không khí", "/images/dust.webp"],
  green: ["Môi trường đô thị", "/images/news-neighborhood-garden.webp"],
};

export const selectedArticles = [
  {
    slug: "camera-chong-do-trom-rac-tphcm",
    title: "Camera giúp phát hiện đổ trộm rác ở TP.HCM",
    summary: "Tại Tân Mỹ và Tân Hưng, hình ảnh từ camera giúp công an xác minh các vụ vứt rác sai nơi quy định.",
    source_name: "Dân trí",
    source_url: "https://dantri.com.vn/thoi-su/mat-than-xu-ly-nan-do-trom-rac-o-tphcm-20261004213214743.htm",
    date: "2026-11-20",
    category: "waste",
    area: "TP. Hồ Chí Minh",
    body: cameraArticle,
  },
  {
    slug: "lo-trinh-xu-ly-nuoc-thai-tphcm",
    title: "TP.HCM công bố lộ trình đầu tư hệ thống nước thải đô thị",
    summary: "Công báo đăng văn bản về việc dành đất và đầu tư hệ thống thu gom, xử lý nước thải ở những khu dân cư chưa có hạ tầng này.",
    source_name: "Công báo TP.HCM",
    source_url: "https://congbao.hochiminhcity.gov.vn/cong-bao/van-ban/quyet-dinh/so/79-2026-qd-ubnd/ngay/14-10-2026/50232?cbid=50261",
    date: "2026-11-01",
    category: "water",
    area: "TP. Hồ Chí Minh",
    body: waterArticle,
  },
  {
    slug: "thu-gom-chat-thai-tang-nhon-phu",
    title: "Ngày hội ở Tăng Nhơn Phú thu gom gần 300 kg chất thải nguy hại",
    summary: "Người dân mang pin cũ, bóng đèn và đồ thải cần xử lý riêng tới ngày hội. Ban tổ chức phân loại và bàn giao cho đơn vị xử lý.",
    source_name: "Khu Công nghệ cao TP.HCM",
    source_url: "https://shtp.hochiminhcity.gov.vn/khu-cong-nghe-cao-thanh-pho-ho-chi-minh-va-phuong-tang-nhon-phu-chung-tay-lan-toa-hanh-dong-vi-moi-truong-xanh-sach-dep-895.htm",
    date: "2026-06-08",
    category: "waste",
    area: "Phường Tăng Nhơn Phú",
    image: "/images/news-battery-recycling.webp",
    body: wasteArticle,
  },
  {
    slug: "khu-dan-cu-bao-ve-moi-truong",
    title: "TP.HCM ra mắt 20 khu dân cư cùng tham gia bảo vệ môi trường",
    summary: "Hoạt động diễn ra trong lễ phát động Tháng hành động vì môi trường tại phường Bình Dương, cùng với trồng cây và hỗ trợ thùng rác cho khu dân cư.",
    source_name: "Sở Nông nghiệp và Môi trường TP.HCM",
    source_url: "https://sonnmt.hochiminhcity.gov.vn/article?item=0337f7de48637c10f48d08a146360fef",
    date: "2026-06-05",
    category: "green",
    area: "Phường Bình Dương",
    body: communityArticle,
  },
];
