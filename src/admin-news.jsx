import React, { useEffect, useRef, useState } from "react";
import { api } from "./domain";
import { selectedArticles, topics } from "./news-data";
import QuillArticle, { articleContent } from "./quill-article";
import { ErrorMsg } from "./ui";

const endpoint = "/admin/news";

export default function AdminNews() {
  const [items, setItems] = useState(null);
  const [editor, setEditor] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const quill = useRef(null);

  useEffect(() => {
    let live = true;
    setError("");
    api(endpoint).then((rows) => { if (live) setItems(rows); })
      .catch((exception) => { if (live) setError(exception.message); });
    return () => { live = false; };
  }, [revision]);

  function edit(item) {
    setError("");
    setNotice("");
    setEditor(item);
  }

  async function mutate(path, method, data, message) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const item = await api(endpoint + path, method, data);
      setItems((current) => [item, ...current.filter((entry) => entry.slug !== item.slug)]);
      setEditor(null);
      setNotice(message);
    } catch (exception) {
      setError(exception.message);
    } finally {
      setBusy(false);
    }
  }

  function save(event) {
    event.preventDefault();
    if (!quill.current || busy) return;
    if (!quill.current.getText().trim()) {
      setError("Nhập nội dung bài viết.");
      quill.current.focus();
      return;
    }
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const published = editor.published || event.nativeEvent.submitter?.value === "publish";
    const data = {
      ...values,
      source_url: values.source_url.trim() || null,
      image: values.image.trim() || null,
      content: articleContent(quill.current),
      published: Boolean(published),
      replaces: editor.body ? editor.slug : null,
    };
    const existing = editor.content;
    mutate(existing ? "/" + editor.slug : "", existing ? "PUT" : "POST", data,
      editor.published ? "Đã cập nhật bài viết." : published ? "Đã đăng bài viết." : "Đã lưu bản nháp.");
  }

  const managed = new Set(items?.map((item) => item.slug));
  const rows = items && [...items, ...selectedArticles.filter((item) => !managed.has(item.slug))];
  return (
    <div className="local-admin news-admin">
      <div className="panel local-admin-toolbar">
        <p>Dán nội dung vào trình soạn thảo để giữ tiêu đề mục, danh sách và liên kết.</p>
        <button type="button" className="btn green" disabled={!items || Boolean(editor)} onClick={() => edit({})}>Viết bài mới</button>
      </div>
      {notice && <p role="status">{notice}</p>}
      {editor && (
        <form className="panel form news-admin-form" key={editor.slug || "new"} onSubmit={save}>
          <h2>{editor.slug ? "Sửa bài viết" : "Bài viết mới"}</h2>
          <label>Tiêu đề<input name="title" required maxLength={160} defaultValue={editor.title} autoFocus /></label>
          <label>Tóm tắt<textarea name="summary" rows={2} maxLength={500} defaultValue={editor.summary} /></label>
          <div className="news-admin-fields">
            <label>Chủ đề<select name="category" defaultValue={editor.category || "green"}>
              {Object.entries(topics).map(([key, [title]]) => <option key={key} value={key}>{title}</option>)}
            </select></label>
            <label>Khu vực<input name="area" required maxLength={120} defaultValue={editor.area || "TP. Hồ Chí Minh"} /></label>
            <label>Nguồn tin<input name="source_name" required maxLength={120} defaultValue={editor.source_name || "Phản Ánh Xanh"} /></label>
            <label>Liên kết nguồn (HTTPS)<input name="source_url" type="url" maxLength={2048} defaultValue={editor.source_url} /></label>
          </div>
          <label>Đường dẫn ảnh bìa (HTTPS)<input name="image" maxLength={2048} defaultValue={editor.image} /></label>
          <QuillArticle editorRef={quill} content={editor.content} markdown={editor.body} />
          <ErrorMsg msg={error} />
          <div className="local-admin-actions">
            {!editor.published && <button className="btn outline" value="draft" disabled={busy}>Lưu bản nháp</button>}
            <button className="btn green" value="publish" disabled={busy}>{editor.published ? "Lưu thay đổi" : "Đăng bài"}</button>
            <button type="button" className="btn outline" disabled={busy} onClick={() => edit(null)}>Hủy</button>
          </div>
        </form>
      )}
      {!editor && <ErrorMsg msg={error} />}
      {rows ? (
        <ul className="local-admin-list">
          {rows.map((item) => (
            <li className="panel" key={item.slug}>
              <div>
                <h2>{item.title}</h2>
                <p>{item.body ? "Bài có sẵn" : item.published ? "Đã xuất bản" : "Bản nháp"} · {item.source_name}</p>
              </div>
              <div className="local-admin-actions">
                <button type="button" className="btn outline small" disabled={busy || Boolean(editor)} onClick={() => edit(item)}>Sửa bằng Quill</button>
                {(item.body || item.published) && <a className="btn outline small" href={"#/news/" + item.slug}>Xem bài</a>}
                {item.published && <button type="button" className="btn outline small" disabled={busy || Boolean(editor)} onClick={() => mutate("/" + item.slug + "/publication", "PATCH", { published: false }, "Đã gỡ bài viết.")}>Gỡ bài</button>}
              </div>
            </li>
          ))}
        </ul>
      ) : error ? (
        <button type="button" className="btn outline" onClick={() => setRevision((value) => value + 1)}>Thử lại</button>
      ) : <p role="status">Đang tải bài viết…</p>}
    </div>
  );
}
