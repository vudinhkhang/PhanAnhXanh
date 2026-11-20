import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/be-vietnam-pro/400.css";
import "@fontsource/be-vietnam-pro/500.css";
import "@fontsource/be-vietnam-pro/600.css";
import "@fontsource/be-vietnam-pro/700.css";
import { api, navigate } from "./domain";
import { Guide, ErrorMsg, Page } from "./ui";
import { Header, Footer } from "./chrome";
import { AdminShell } from "./admin";
import { Home } from "./home";
import { NewsArticle, NewsPage } from "./news";
import { About, Faq, Privacy, Terms, Contact } from "./pages";
import { Auth, NewReport, Profile, Sent, Track } from "./forms";
import { AdminDesk, Community, Desk, Detail, useResource } from "./screens";
import "./style.css";
import "./maps.css";
import "./extra.css";
import "./redesign.css";
function App() {
  const [hash, setHash] = useState(location.hash.slice(1) || "/"),
    [me, setMe] = useState(null),
    [ready, setReady] = useState(false),
    [authError, setAuthError] = useState("");
  const [community, communityError, refresh] = useResource("/community");
  useEffect(() => {
    function changed() {
      setHash(location.hash.slice(1) || "/");
      window.scrollTo(0, 0);
      document.title = "Phản Ánh Xanh · Cổng phản ánh môi trường";
      refresh();
    }
    window.addEventListener("hashchange", changed);
    api("/session")
      .then(setMe)
      .catch((e) => setAuthError(e.message))
      .finally(() => setReady(true));
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  const [noticeFeed, setNoticeFeed] = useState({ urgent_count: 0, items: [] });
  useEffect(() => {
    if (!me) {
      setNoticeFeed({ urgent_count: 0, items: [] });
      return;
    }
    let live = true;
    const poll = () => {
      if (document.visibilityState === "hidden") return;
      api("/user-notifications")
        .then((res) => {
          if (live && res) {
            setNoticeFeed({
              urgent_count: res.urgent_count ?? 0,
              items: Array.isArray(res.items) ? res.items : [],
            });
          }
        })
        .catch(() => {});
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") poll();
    };
    poll();
    const timer = setInterval(poll, 10000);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      live = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [me, hash]);
  const [path, query] = hash.split("?");
  const next = new URLSearchParams(query).get("next");
  const goSend = () => navigate("/new");
  async function logout() {
    try {
      await api("/logout", "POST");
      setMe(null);
      navigate("/");
    } catch (e) {
      setAuthError(e.message);
    }
  }
  const feed = community || { reports: [], counts: null };
  let screen;
  if (path === "/")
    screen = <Home community={feed} feedLoading={!community && !communityError} send={goSend} me={me} />;
  else if (path === "/guide") screen = <Guide send={goSend} />;
  else if (path === "/news") screen = <NewsPage />;
  else if (path.startsWith("/news/")) screen = <NewsArticle key={path} slug={path.slice(6)} />;
  else if (path === "/about") screen = <About />;
  else if (path === "/faq") screen = <Faq />;
  else if (path === "/privacy") screen = <Privacy />;
  else if (path === "/terms") screen = <Terms />;
  else if (path === "/contact") screen = <Contact />;
  else if (path === "/community")
    screen = (
      <Community
        group={new URLSearchParams(query).get("group") || ""}
        ward={new URLSearchParams(query).get("ward") || ""}
        reports={feed.reports}
        mapView={new URLSearchParams(query).get("view") === "map"}
      />
    );
  else if (path === "/login" || path === "/register")
    screen = (
      <Auth
        key={path}
        register={path === "/register"}
        onAuth={setMe}
        next={next?.startsWith("/") ? next : null}
      />
    );
  else if (path === "/track") screen = <Track me={me} />;
  else if (path.startsWith("/report/"))
    screen = (
      <Detail
        key={path}
        id={path.slice(8)}
        me={me}
        from={new URLSearchParams(query).get("from")}
      />
    );
  else if (path.startsWith("/sent/")) screen = <Sent id={path.slice(6)} me={me} />;
  else if (path === "/new")
    screen = ready ? <NewReport refresh={refresh} me={me} /> : <div className="wrap page">Đang tải…</div>;
  else if (
    path === "/desk" ||
    path === "/admin" ||
    path === "/profile"
  )
    screen = !ready ? (
      <div className="wrap page">Đang tải…</div>
    ) : !me ? (
      <Auth next={path} onAuth={setMe} />
    ) : path === "/profile" ? (
      <Profile me={me} onAuth={setMe} logout={logout} />
    ) : me.role === "admin" ? (
      <AdminDesk key={hash} me={me} hash={hash} />
    ) : me.role === "citizen" ? (
      <Track me={me} />
    ) : (
      <Desk key={hash} me={me} hash={hash} />
    );
  else
    screen = (
      <Page title="Không tìm thấy trang">
        <a href="#/">Về trang chủ</a>
      </Page>
    );
  const isWorkspace = Boolean(
    me &&
    (me.role === "admin" || me.role === "staff") &&
    (path === "/desk" ||
      path === "/admin" ||
      path === "/profile" ||
      path.startsWith("/report/")),
  );
  if (isWorkspace) {
    return (
      <AdminShell me={me} logout={logout} noticeFeed={noticeFeed} hash={hash}>
        <ErrorMsg msg={authError} />
        {screen}
      </AdminShell>
    );
  }
  return (
    <>
      <Header me={me} logout={logout} noticeFeed={noticeFeed} hash={hash} />
      <ErrorMsg msg={authError || communityError} />
      <div id="content" tabIndex={-1}>
        {screen}
      </div>
      <Footer />
    </>
  );
}
createRoot(document.getElementById("root")).render(<App />);
