import React, { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ClipboardList,
  Map as MapIcon,
  Menu,
  Newspaper,
  Search,
  Send,
  X,
} from "lucide-react";
import { Brand, NotificationMenu, UserMenu } from "./ui";
import { SITE } from "./site";

export function Header({ me, logout, noticeFeed, hash }) {
  const [open, setOpen] = useState(false);
  const toggle = useRef(null);
  const nav = useRef(null);
  const [path, query] = hash.split("?");
  const active =
    path === "/community" && new URLSearchParams(query).get("view") === "map"
      ? "/community?view=map"
      : path.startsWith("/news/") ? "/news" : path;
  useEffect(() => {
    setOpen(false);
  }, [hash]);
  useEffect(() => {
    if (open && nav.current) {
      [...nav.current.querySelectorAll("a")].find((link) => link.getClientRects().length)?.focus();
    }
  }, [open]);
  const links = [
    ["/track", "Tra cứu hồ sơ", Search],
    ["/community", "Bảng tin", ClipboardList],
    ["/community?view=map", "Bản đồ", MapIcon],
    ["/news", "Tin môi trường", Newspaper],
  ];
  return (
    <header
      className="site-header editorial-header"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          setOpen(false);
          toggle.current?.focus();
        }
      }}
    >
      <a
        className="skip-link"
        href="#content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("content")?.focus();
        }}
      >
        Chuyển đến nội dung
      </a>
      <div className="wrap nav">
        <Brand />
        <nav
          ref={nav}
          id="public-navigation"
          aria-label="Điều hướng chính"
          className={open ? "expanded" : ""}
        >
          {[
            ...links.slice(0, 2),
            ["/new", "Gửi phản ánh", Send, true],
            ...links.slice(2),
          ].map(([href, label, Icon, isSend]) => (
            <a
              key={href}
              className={isSend ? "header-menu-send" : undefined}
              href={"#" + href}
              title={isSend ? label : undefined}
              aria-current={active === href ? "page" : undefined}
              onClick={() => setOpen(false)}
            >
              <Icon size={19} aria-hidden="true" />
              <span>{label}</span>
            </a>
          ))}
        </nav>
        <div className="account">
          <a className="btn green public-send" href="#/new"><Send size={16} aria-hidden="true" /> Gửi phản ánh</a>
          {me ? (
            <>
              <NotificationMenu me={me} feed={noticeFeed} />
              <UserMenu me={me} logout={logout} />
            </>
          ) : (
            <a className="login" href="#/login">
              Đăng nhập
            </a>
          )}
          <button
            ref={toggle}
            type="button"
            className="icon-btn hamburger"
            aria-label={open ? "Đóng menu" : "Mở menu"}
            aria-controls="public-navigation"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open ? <X size={21} /> : <Menu size={21} />}
          </button>
        </div>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="site-footer editorial-footer">
      <div className="wrap footer-grid">
        <div className="footer-identity">
          <Brand />
          <p>
            Cổng cộng đồng để ghi nhận và theo dõi phản ánh môi trường tại TP. Hồ Chí Minh.
          </p>
          <a className="footer-feedback" href="#/contact">Góp ý về website <ArrowRight size={15} aria-hidden="true" /></a>
        </div>
        <nav className="footer-links" aria-label="Liên kết cuối trang">
          <div>
            <h2>Hỗ trợ người dân</h2>
            <ul>
              <li>
                <a href="#/guide">Hướng dẫn gửi phản ánh</a>
              </li>
              <li>
                <a href="#/faq">Câu hỏi thường gặp</a>
              </li>
            </ul>
          </div>
          <div>
            <h2>Thông tin dự án</h2>
            <ul>
              <li>
                <a href="#/about">Giới thiệu dự án</a>
              </li>
            </ul>
          </div>
        </nav>
      </div>
      <div className="footer-bottom">
        <div className="wrap footer-meta">
          <small>© {SITE.year} {SITE.name}</small>
          <nav className="footer-legal" aria-label="Điều khoản và quyền riêng tư">
            <a href="#/privacy">Quyền riêng tư</a>
            <a href="#/terms">Điều khoản sử dụng</a>
          </nav>
        </div>
      </div>
    </footer>
  );
}
