import React, { lazy, Suspense, useEffect, useRef, useState } from "react";
import "@fontsource-variable/inter";
import { Send } from "lucide-react";
import { reportAreas, shortArea } from "./areas";
import { calendarDateText, communityPath } from "./domain";
import { ReportLookup } from "./forms";
import { NewsPreview } from "./news";
import { EmergencyNote } from "./pages";
import { useResource } from "./screens";
import { Stats, RecentReports } from "./ui";

const CommunityMap = lazy(() =>
  import("./maps").then((module) => ({ default: module.CommunityMap })),
);

class MapPreviewBoundary extends React.Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed
      ? <p className="home-map-placeholder">Chưa tải được bản đồ thu nhỏ.</p>
      : this.props.children;
  }
}

function ReportMapPreview({ reports, loading }) {
  const [ward, setWard] = useState("");
  const [near, setNear] = useState(false);
  const surface = useRef(null);
  const pinned = reports.filter((report) => report.pin?.approximate);
  const wards = reportAreas(pinned);
  const rows = ward ? pinned.filter((report) => report.ward === ward) : pinned;

  useEffect(() => {
    if (!("IntersectionObserver" in window)) {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setNear(true);
        observer.disconnect();
      }
    }, { rootMargin: "160px" });
    observer.observe(surface.current);
    return () => observer.disconnect();
  }, []);

  return (
    <section className="home-section home-map-section" aria-labelledby="home-map-title">
      <div className="home-insight-header home-map-header">
        <div>
          <h2 id="home-map-title">Bản đồ phản ánh</h2>
          <p>Ghim công khai thể hiện vị trí gần đúng.</p>
        </div>
        <label>
          Phường/xã
          <select value={ward} onChange={(event) => setWard(event.target.value)}>
            <option value="">Tất cả phường/xã</option>
            {ward && !wards.includes(ward) && <option value={ward}>{shortArea(ward)}</option>}
            {wards.map((area) => <option key={area} value={area}>{shortArea(area)}</option>)}
          </select>
        </label>
      </div>
      <div className="home-map-surface" ref={surface}>
        {loading ? (
          <p className="home-map-placeholder" role="status">Đang tải phản ánh công khai…</p>
        ) : !rows.length ? (
          <p className="home-map-placeholder">Chưa có phản ánh công khai có ghim trong khu vực này.</p>
        ) : near ? (
          <MapPreviewBoundary>
            <Suspense fallback={<p className="home-map-placeholder" role="status">Đang tải bản đồ…</p>}>
              <CommunityMap reports={rows} compact />
            </Suspense>
          </MapPreviewBoundary>
        ) : <p className="home-map-placeholder">Bản đồ sẽ tải khi bạn cuộn tới.</p>}
      </div>
      <a className="all-link home-map-link" href={"#" + communityPath({ mapView: true, ward })}>
        Mở bản đồ đầy đủ
      </a>
    </section>
  );
}

function ReportTrend({ days, error, retry, isDemo }) {
  const total = days?.reduce((sum, row) => sum + row.count, 0);
  const max = days && Math.max(1, ...days.map((row) => row.count));
  return (
    <section className="home-section home-trend-section" aria-labelledby="home-trend-title">
      <div className="home-insight-header">
        <h2 id="home-trend-title">Tình hình trong 30 ngày</h2>
        <p>Phản ánh công khai theo ngày gửi{isDemo && " · Dữ liệu mẫu"}.</p>
      </div>
      {error ? (
        <div className="home-data-state">
          <p>Chưa tải được số liệu.</p>
          <button type="button" className="btn outline small" onClick={retry}>Thử lại</button>
        </div>
      ) : !days ? (
        <p className="home-data-state" role="status">Đang tải số liệu…</p>
      ) : (
        <>
          <div className="home-trend">
            <p className="home-trend-total"><strong>{total.toLocaleString("vi-VN")}</strong> phản ánh</p>
            <div className="home-chart" aria-hidden="true">
              <div className="home-chart-scale"><span>{max}</span><span>0</span></div>
              <div className="home-chart-bars">
                {days.map(({ day, count }) => (
                  <div key={day} title={calendarDateText(day) + " · " + count + " phản ánh"}>
                    <span style={{ height: (count / max * 100) + "%" }} />
                  </div>
                ))}
              </div>
              <div className="home-chart-dates">
                {days.filter((_, index) => [0, 7, 14, 21, days.length - 1].includes(index))
                  .map(({ day }) => <span key={day}>{calendarDateText(day).slice(0, 5)}</span>)}
              </div>
            </div>
          </div>
          <details className="home-trend-details">
            <summary>Xem số liệu từng ngày</summary>
            <table aria-label="Số phản ánh theo ngày">
              <thead><tr><th scope="col">Ngày gửi</th><th scope="col">Số phản ánh</th></tr></thead>
              <tbody>
                {days.map(({ day, count }) => (
                  <tr key={day}><th scope="row"><time dateTime={day}>{calendarDateText(day)}</time></th><td>{count}</td></tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
    </section>
  );
}

export function Home({ community, feedLoading, send, me }) {
  const [lookupOpen, setLookupOpen] = useState(false);
  const [overview, overviewError, retryOverview] = useResource("/community/home");
  const isDemo = import.meta.env.MODE === "demo";
  return (
    <main className="landing" id="main-content" tabIndex={-1}>
      <div className="wrap landing-wrap">
        <section className="landing-hero" aria-labelledby="landing-title">
          <div className="landing-cover">
            <div className="landing-copy">
              <p className="landing-locality">TP. Hồ Chí Minh</p>
              <h1 id="landing-title">Phản ánh <span>môi trường</span></h1>
              <p className="landing-intro">
                Gửi mô tả, vị trí và ảnh hiện trường nếu có. Dùng mã hồ sơ để theo dõi tiến độ và xem phản hồi.
              </p>
              <div className="landing-actions">
                <button type="button" className="btn green" onClick={send}>
                  <Send size={16} aria-hidden="true" /> Gửi phản ánh
                </button>
                <button
                  type="button"
                  className="landing-lookup-toggle"
                  aria-expanded={lookupOpen}
                  aria-controls="banner-report-lookup"
                  onClick={() => setLookupOpen((open) => !open)}
                >
                  Tra cứu hồ sơ
                </button>
              </div>
            </div>
            <figure className="landing-photo">
              <img
                src="/images/canal-print-1200.webp"
                srcSet="/images/canal-print-820.webp 820w, /images/canal-print-1200.webp 1200w, /images/canal-print-2000.webp 2000w"
                sizes="(max-width: 520px) max(486px, 146vw), (max-width: 720px) 720px, (max-width: 960px) 1080px, (max-width: 1304px) calc(100vw - 64px), 1240px"
                alt="Minh họa người dân dùng điện thoại ghi lại rác nổi trên kênh trong khu dân cư"
                width="2000"
                height="740"
                fetchPriority="high"
              />
            </figure>
          </div>
          <div className="landing-lookup-panel" id="banner-report-lookup" hidden={!lookupOpen}>
            {lookupOpen && <ReportLookup me={me} compact />}
          </div>
        </section>
        <Stats counts={community.counts} />
        <RecentReports reports={community.reports} loading={feedLoading} />
        <div className="home-insights">
          <ReportMapPreview reports={community.reports} loading={feedLoading} />
          <ReportTrend days={overview?.daily_counts} error={overviewError} retry={retryOverview} isDemo={isDemo} />
        </div>
        <section className="home-section home-news" aria-labelledby="home-news-title">
          <div className="home-news-header">
            <h2 id="home-news-title">Tin môi trường</h2>
            <a className="all-link" href="#/news">Xem tất cả tin <span aria-hidden="true">›</span></a>
          </div>
          <NewsPreview />
        </section>
        <EmergencyNote />
      </div>
    </main>
  );
}
