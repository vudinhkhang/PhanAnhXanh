import React, { useEffect, useRef, useState } from "react";
import Quill from "quill";
import { marked } from "marked";
import "quill/dist/quill.snow.css";

const formats = ["header", "bold", "italic", "underline", "strike", "blockquote", "list", "link", "image"];
const Delta = Quill.import("delta");

function allowedUrl(value, image = false) {
  if (typeof value !== "string" || value.length > 2048 || /[\s\\]/.test(value)) return false;
  if (image && /^\/images\/[\w-]+\.(webp|png|jpe?g)$/.test(value)) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function articleContent(quill) {
  return {
    ops: quill.getContents().ops.flatMap(({ insert, attributes }) => {
      if (typeof insert !== "string" && !allowedUrl(insert.image, true)) return [];
      const attrs = { ...attributes };
      if (attrs.header) attrs.header = attrs.header <= 2 ? 2 : 3;
      if (attrs.link && !allowedUrl(attrs.link)) delete attrs.link;
      if (attrs.list === "checked" || attrs.list === "unchecked") attrs.list = "bullet";
      return [Object.keys(attrs).length ? { insert, attributes: attrs } : { insert }];
    }),
  };
}

export default function QuillArticle({ content, markdown, editorRef, readOnly = false }) {
  const frame = useRef(null);
  const holder = useRef(null);
  const toolbar = useRef(null);
  const quillRef = useRef(null);
  const [showImage, setShowImage] = useState(false);
  const [imageUrl, setImageUrl] = useState("");
  const [imageError, setImageError] = useState("");
  const imageInput = useRef(null);
  const imageIndex = useRef(null);

  useEffect(() => {
    const host = holder.current;
    const container = host.appendChild(document.createElement("div"));
    const quill = new Quill(container, {
      theme: "snow",
      bounds: frame.current,
      readOnly,
      formats,
      placeholder: readOnly ? "" : "Dán hoặc viết nội dung bài tại đây…",
      modules: {
        toolbar: readOnly ? false : toolbar.current,
        uploader: { mimetypes: [] },
      },
    });
    quillRef.current = quill;
    quill.clipboard.addMatcher("IMG", (node, delta) => allowedUrl(node.getAttribute("src"), true) ? delta : new Delta());
    if (content) quill.setContents(content);
    else if (markdown) quill.setContents(quill.clipboard.convert({ html: marked.parse(markdown), text: "" }));
    if (readOnly) {
      quill.root.querySelectorAll("img").forEach((image) => {
        image.loading = "lazy";
        image.referrerPolicy = "no-referrer";
      });
    } else {
      quill.root.setAttribute("role", "textbox");
      quill.root.setAttribute("aria-label", "Nội dung bài viết");
      quill.root.setAttribute("aria-multiline", "true");
    }
    if (editorRef) editorRef.current = quill;
    return () => {
      if (editorRef) editorRef.current = null;
      quillRef.current = null;
      host.replaceChildren();
    };
  }, [content, markdown, editorRef, readOnly]);

  useEffect(() => {
    if (showImage) imageInput.current?.focus();
  }, [showImage]);

  function addImage() {
    const url = imageUrl.trim();
    if (!allowedUrl(url, true)) {
      setImageError("Dùng đường dẫn HTTPS tới ảnh.");
      return;
    }
    const quill = quillRef.current;
    const index = imageIndex.current ?? Math.max(0, quill.getLength() - 1);
    quill.insertEmbed(index, "image", url, "user");
    quill.setSelection(index + 1, 0);
    setShowImage(false);
    setImageUrl("");
    setImageError("");
  }

  return (
    <div ref={frame} className={readOnly ? "news-quill-reader" : "news-quill-editor"}>
      {!readOnly && (
        <div ref={toolbar} aria-label="Định dạng nội dung">
          <span className="ql-formats">
            <button type="button" className="ql-header" value="2" aria-label="Tiêu đề mục" />
            <button type="button" className="ql-header" value="3" aria-label="Tiêu đề phụ" />
          </span>
          <span className="ql-formats">
            <button type="button" className="ql-bold" aria-label="In đậm" />
            <button type="button" className="ql-italic" aria-label="In nghiêng" />
            <button type="button" className="ql-underline" aria-label="Gạch chân" />
          </span>
          <span className="ql-formats">
            <button type="button" className="ql-list" value="ordered" aria-label="Danh sách đánh số" />
            <button type="button" className="ql-list" value="bullet" aria-label="Danh sách gạch đầu dòng" />
            <button type="button" className="ql-blockquote" aria-label="Trích dẫn" />
          </span>
          <span className="ql-formats">
            <button type="button" className="ql-link" aria-label="Chèn liên kết HTTPS" />
            <button type="button" className="ql-clean" aria-label="Xóa định dạng" />
          </span>
          <button type="button" className="news-add-image" aria-expanded={showImage} onClick={() => {
            imageIndex.current = quillRef.current?.getSelection()?.index;
            setShowImage((visible) => !visible);
          }}>Chèn ảnh</button>
        </div>
      )}
      {showImage && (
        <div className="news-image-insert">
          <label>Đường dẫn ảnh (HTTPS)<input ref={imageInput} value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} /></label>
          <button type="button" className="btn outline small" onClick={addImage}>Thêm ảnh</button>
          {imageError && <p role="alert">{imageError}</p>}
        </div>
      )}
      <div ref={holder} />
    </div>
  );
}
