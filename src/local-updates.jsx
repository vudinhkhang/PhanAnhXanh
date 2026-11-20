import React, { useEffect, useState } from "react";
import { loadHcmAreas, shortArea } from "./areas";
import { api, calendarDateText, hcmDay } from "./domain";
import { ErrorMsg } from "./ui";

const endpoint = "/admin/local-updates";

function publicationStatus(item, today) {
  if (!item.published) return "Bản nháp";
  if (item.ends_on < today) return "Đã hết hạn";
  if (item.starts_on > today) return "Đã lên lịch";
  return "Đang hiển thị";
}

export function AdminLocalUpdates() {
  const [items, setItems] = useState(null);
  const [areas, setAreas] = useState([]);
  const [areasFailed, setAreasFailed] = useState(false);
  const [editor, setEditor] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const today = hcmDay();

  useEffect(() => {
    let live = true;
    setError("");
    api(endpoint)
      .then((rows) => { if (live) setItems(rows); })
      .catch((err) => { if (live) setError(err.message); });
    return () => { live = false; };
  }, [revision]);

  useEffect(() => {
    let live = true;
    loadHcmAreas()
      .then((rows) => { if (live) setAreas(rows.map((area) => area.name).sort((a, b) => a.localeCompare(b, "vi"))); })
      .catch(() => { if (live) setAreasFailed(true); });
    return () => { live = false; };
  }, []);

  function edit(item) {
    setError("");
    setNotice("");
    setEditor(item);
  }

  async function mutate(path, method, data, message, closeEditor = false) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const item = await api(endpoint + path, method, data);
      setItems((current) => [...current.filter((entry) => entry.id !== item.id), item]);
      if (closeEditor) setEditor(null);
      setNotice(message);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function save(event) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const data = { ...values, ward: values.ward || null };
    if (editor.id) return mutate("/" + editor.id, "PUT", data, "Đã lưu thay đổi.", true);
    return mutate("", "POST", data, "Đã lưu bản nháp.", true);
  }

  return (
    <div className="local-admin">
      <div className="panel local-admin-toolbar">
        <p>Thông báo hiển thị trên trang chủ trong thời gian áp dụng.</p>
        <button
          type="button"
          className="btn green"
          disabled={busy || !items || Boolean(editor)}
          onClick={() => edit({ starts_on: today, ends_on: today })}
        >
          Tạo thông báo
        </button>
      </div>
      <ErrorMsg msg={error} />
      {notice && <p role="status">{notice}</p>}
      {editor && (
        <form className="panel form local-editor" key={editor.id || "new"} onSubmit={save}>
          <h2>{editor.id ? "Sửa thông báo" : "Thông báo mới"}</h2>
          <label>Tiêu đề<input name="title" required maxLength={120} defaultValue={editor.title} autoFocus /></label>
          <label>Nội dung ngắn<textarea name="summary" required maxLength={400} rows={3} defaultValue={editor.summary} /></label>
          <label>
            Phạm vi
            <select
              name="ward"
              value={editor.ward || ""}
              onChange={(event) => setEditor({ ...editor, ward: event.target.value })}
            >
              <option value="">Toàn thành phố</option>
              {editor.ward && !areas.includes(editor.ward) && <option value={editor.ward}>{shortArea(editor.ward)}</option>}
              {areas.map((area) => <option value={area} key={area}>{shortArea(area)}</option>)}
            </select>
          </label>
          {areasFailed && <small>Chưa tải được danh sách phường/xã. Mở lại mục này để thử lại.</small>}
          <label>Liên kết nguồn (HTTPS)<input name="source_url" type="url" required defaultValue={editor.source_url} /></label>
          <div className="local-editor-dates">
            <label>Ngày bắt đầu<input name="starts_on" type="date" required defaultValue={editor.starts_on} /></label>
            <label>Ngày kết thúc<input name="ends_on" type="date" required defaultValue={editor.ends_on} /></label>
          </div>
          <div className="local-admin-actions">
            <button className="btn green" disabled={busy}>{editor.id ? "Lưu thay đổi" : "Lưu bản nháp"}</button>
            <button type="button" className="btn outline" disabled={busy} onClick={() => edit(null)}>Hủy</button>
          </div>
        </form>
      )}
      {!items ? (
        error ? (
          <button type="button" className="btn outline" onClick={() => setRevision((value) => value + 1)}>Thử lại</button>
        ) : <p role="status">Đang tải thông báo…</p>
      ) : !items.length ? (
        <p className="panel">Chưa có thông báo địa phương.</p>
      ) : (
        <ul className="local-admin-list">
          {[...items].sort((a, b) => b.starts_on.localeCompare(a.starts_on) || b.id - a.id).map((item) => (
            <li key={item.id} className="panel">
              <div>
                <h2>{item.title}</h2>
                <p>{publicationStatus(item, today)} · {item.ward ? shortArea(item.ward) : "Toàn thành phố"}</p>
                <small>{calendarDateText(item.starts_on)} – {calendarDateText(item.ends_on)}</small>
              </div>
              <div className="local-admin-actions">
                <button type="button" className="btn outline small" disabled={busy || Boolean(editor)} onClick={() => edit(item)}>Sửa</button>
                <button
                  type="button"
                  className="btn outline small"
                  disabled={busy || Boolean(editor)}
                  onClick={() => mutate(
                    "/" + item.id + "/publication",
                    "PATCH",
                    { published: !item.published },
                    item.published ? "Đã gỡ thông báo khỏi trang chủ." : "Đã đăng thông báo.",
                  )}
                >
                  {item.published ? "Gỡ thông báo" : "Đăng thông báo"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
