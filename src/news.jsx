import React, { lazy, Suspense, useEffect, useState } from "react";
import { ArrowUpRight, ChevronRight } from "lucide-react";
import { calendarDateText, hcmDay } from "./domain";
import { useResource } from "./screens";
import { Page } from "./ui";
import { selectedArticles, topics } from "./news-data";

const Markdown = lazy(() => import("react-markdown"));
const QuillArticle = lazy(() => import("./quill-article"));

const selectedBySource = new Map(selectedArticles.map((article) => [article.source_url, article]));

function articleSlug(article) {
  if (article.slug) return article.slug;
  return new URL(article.source_url).pathname.split("/").filter(Boolean).join("--").replace(/\.htm$/i, "");
}

function articleLink(article) {
  return "#/news/" + encodeURIComponent(articleSlug(article));
}

function articleDay(article) {
  return article.date || hcmDay(article.published_at);
}

function restoreCover(event, fallback) {
  if (event.currentTarget.getAttribute("src") !== fallback) event.currentTarget.src = fallback;
}

function useNewsArticles() {
  const demo = import.meta.env.MODE === "demo";
  const [feed, error, refresh] = useResource("/community/news");
  useEffect(() => {
    if (demo) return;
    const timer = window.setInterval(refresh, 60_000);
    return () => window.clearInterval(timer);
  }, [demo]);
  const managed = (feed?.editorial || []).map((article) => ({ ...article, managed: true }));
  const replaced = new Set([...managed.map((article) => article.slug), ...(feed?.retired || [])]);
  const hiddenSources = new Set([
    ...selectedArticles.filter((article) => replaced.has(article.slug)).map((article) => article.source_url),
    ...managed.map((article) => article.source_url).filter(Boolean),
  ]);
  const live = (feed?.articles || []).filter((article) => !hiddenSources.has(article.source_url));
  return {
    loading: !feed && !error,
    error,
    refresh,
    articles: [
      ...managed,
      ...live.map((article) => selectedBySource.get(article.source_url) || article),
      ...selectedArticles.filter((item) => !replaced.has(item.slug) && !hiddenSources.has(item.source_url) && !live.some((article) => article.source_url === item.source_url)),
    ],
  };
}

function Story({ article, Heading = "h3", layout = "text" }) {
  const [topic, topicImage] = topics[article.category] || topics.green;
  const day = articleDay(article);
  return (
    <article className={"news-story news-story-" + layout}>
      {layout !== "text" && (
        <img className="news-cover" src={article.image || topicImage} width="720" height="405" alt="" loading="lazy" referrerPolicy="no-referrer" onError={(event) => restoreCover(event, topicImage)} />
      )}
      <div className="news-story-body">
        {layout !== "compact" && <p className="news-story-topic">{topic}{article.area && " · " + article.area}</p>}
        <Heading>
          <a href={articleLink(article)}>
            {article.title}
          </a>
        </Heading>
        {layout !== "compact" && article.summary && <p className="news-story-summary">{article.summary}</p>}
        <p className="news-story-source">
          {article.source_name} <span aria-hidden="true">·</span>{" "}
          <time dateTime={day}>{calendarDateText(day)}</time>
        </p>
      </div>
    </article>
  );
}

export function NewsPreview() {
  const { articles } = useNewsArticles();
  const [lead, ...rest] = articles.filter((article) => article.area).slice(0, 4);
  if (!lead) return <p className="empty">Chưa có tin môi trường.</p>;
  return (
    <>
      <div className="news-preview">
        <Story article={lead} layout="featured" />
        <div className="news-preview-list">
          {rest.map((article) => <Story key={articleSlug(article)} article={article} layout="compact" />)}
        </div>
      </div>
      {[lead, ...rest].every((article) => !article.managed || !article.image) && <p className="news-preview-caption">Ảnh minh họa</p>}
    </>
  );
}

export function NewsPage() {
  const { articles } = useNewsArticles();
  const [topic, setTopic] = useState("");
  const filtered = topic ? articles.filter((article) => article.category === topic) : articles;
  const present = new Set(articles.map((article) => article.category));
  if (topic) present.add(topic);
  return (
    <Page title="Tin môi trường" wide>
      <div className="news-page">
        <label className="news-topic-filter">
          Chủ đề
          <select value={topic} onChange={(event) => setTopic(event.target.value)}>
            <option value="">Tất cả chủ đề</option>
            {Object.entries(topics).filter(([key]) => present.has(key))
              .map(([key, [label]]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <div className="news-page-list">
          {filtered.map((article) => <Story key={articleSlug(article)} article={article} Heading="h2" />)}
          {!filtered.length && <p className="empty">Chưa có bài thuộc chủ đề này.</p>}
        </div>
      </div>
    </Page>
  );
}

export function NewsArticle({ slug }) {
  const { articles, loading, error, refresh } = useNewsArticles();
  const article = articles.find((item) => encodeURIComponent(articleSlug(item)) === slug);
  const [editorial, editorialError, refreshEditorial] = useResource(article?.managed ? "/community/news/" + slug : null);
  useEffect(() => {
    if (article) document.title = article.title + " · Phản Ánh Xanh";
  }, [article?.title]);

  if (!article) {
    return (
      <Page title="Tin môi trường">
        {loading ? <p role="status">Đang tải bài viết…</p> : error ? (
          <div className="panel">
            <p>Chưa tải được bài viết.</p>
            <button className="btn outline small" type="button" onClick={refresh}>Thử lại</button>
          </div>
        ) : <p>Bài viết hiện không có trong bản tin.</p>}
        <a className="all-link" href="#/news">Về danh sách tin</a>
      </Page>
    );
  }

  const [topic, topicImage] = topics[article.category] || topics.green;
  const day = articleDay(article);
  const related = articles
    .filter((item) => item.category === article.category && item !== article)
    .slice(0, 3);

  return (
    <main className="wrap page news-reading">
      <nav aria-label="Đường dẫn bài viết" className="crumb">
        <a href="#/">Trang chủ</a>
        <ChevronRight size={14} aria-hidden="true" />
        <a href="#/news">Tin môi trường</a>
      </nav>
      <article aria-labelledby="news-article-title">
        <p className="news-story-topic">{topic}{article.area && " · " + article.area}</p>
        <h1 id="news-article-title">{article.title}</h1>
        <p className="news-story-source">
          {article.body ? "Tóm tắt từ " : "Nguồn "}
          {article.source_name} · <time dateTime={day}>{calendarDateText(day)}</time>
        </p>
        {article.summary && <p className="news-article-lead">{article.summary}</p>}
        <figure className="news-article-photo">
          <img src={article.image || topicImage} width="720" height="405" alt="" referrerPolicy="no-referrer" onError={(event) => restoreCover(event, topicImage)} />
          {(!article.managed || !article.image) && <figcaption>Ảnh minh họa</figcaption>}
        </figure>
        {article.body ? (
          <div className="prose news-article-body">
            <Suspense fallback={<p role="status">Đang mở nội dung…</p>}>
              <Markdown skipHtml disallowedElements={["img", "h1"]}>{article.body}</Markdown>
            </Suspense>
          </div>
        ) : article.managed ? (
          editorialError ? <div className="panel"><p>{editorialError}</p><button type="button" className="btn outline small" onClick={refreshEditorial}>Thử lại</button></div>
            : <Suspense fallback={<p role="status">Đang mở nội dung…</p>}>
              {editorial ? <QuillArticle readOnly content={editorial.content} /> : <p role="status">Đang mở nội dung…</p>}
            </Suspense>
        ) : article.excerpt ? (
          <blockquote className="news-article-excerpt">{article.excerpt}</blockquote>
        ) : null}
        {article.source_url && <p className="news-source-link">
          <a className="btn outline" href={article.source_url} target="_blank" rel="noreferrer">
            Đọc bài gốc <ArrowUpRight size={16} aria-hidden="true" />
          </a>
        </p>}
      </article>
      {related.length > 0 && (
        <section className="news-related" aria-labelledby="news-related-title">
          <h2 id="news-related-title">Tin cùng chủ đề</h2>
          <ul>
            {related.map((item) => <li key={articleSlug(item)}><a href={articleLink(item)}>{item.title}</a></li>)}
          </ul>
        </section>
      )}
    </main>
  );
}
