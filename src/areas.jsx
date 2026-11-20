import React, { useEffect, useMemo, useState } from "react";
import { MapPin, Plus, X } from "lucide-react";

let wardList;
export function loadHcmAreas() {
  wardList ??= fetch("/maps/places.json")
    .then((r) => {
      if (!r.ok) throw Error();
      return r.json();
    })
    .then((rows) =>
      rows
        .filter((row) => row[0].includes("Hồ Chí Minh") && row[0].includes(","))
        .map((row) => ({ name: row[0], lat: row[1], lng: row[2] })),
    )
    .catch((error) => {
      wardList = null;
      throw error;
    });
  return wardList;
}

export const shortArea = (name) =>
  String(name || "").replace(/,\s*Thành phố Hồ Chí Minh$/i, "");

export function reportAreas(reports) {
  return [...new Set(reports.map((report) => report.ward).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b, "vi"),
  );
}

const fold = (text) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .trim();

export function AreaChips({ areas, empty = "Chưa phân khu vực" }) {
  if (!areas?.length) return <span className="area-empty">{empty}</span>;
  return (
    <span className="area-chips">
      {areas.map((area) => (
        <span className="area-chip" key={area}>
          <MapPin size={12} aria-hidden="true" />
          {shortArea(area)}
        </span>
      ))}
    </span>
  );
}

export function AreaPicker({ value, onChange, disabled = false }) {
  const [places, setPlaces] = useState([]);
  const [term, setTerm] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    loadHcmAreas()
      .then((rows) => live && setPlaces(rows))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);
  const matches = useMemo(() => {
    const query = fold(term);
    if (query.length < 2) return [];
    return places
      .filter(
        (place) =>
          !value.includes(place.name) && fold(shortArea(place.name)).includes(query),
      )
      .slice(0, 8);
  }, [places, term, value]);
  function add(name) {
    onChange([...value, name]);
    setTerm("");
  }
  return (
    <div className="area-picker">
      {value.length > 0 && (
        <ul className="area-chips" aria-label="Khu vực đã chọn">
          {value.map((area) => (
            <li className="area-chip" key={area}>
              {shortArea(area)}
              <button
                type="button"
                aria-label={"Bỏ khu vực " + shortArea(area)}
                disabled={disabled}
                onClick={() => onChange(value.filter((item) => item !== area))}
              >
                <X size={13} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        type="search"
        aria-label="Tìm phường/xã để thêm khu vực"
        placeholder="Gõ tên phường/xã tại TP.HCM để thêm…"
        value={term}
        disabled={disabled}
        onChange={(event) => setTerm(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (matches[0]) add(matches[0].name);
          }
        }}
      />
      {failed && (
        <small className="area-empty">Chưa tải được danh mục phường/xã.</small>
      )}
      {matches.length > 0 && (
        <ul className="area-options" role="listbox" aria-label="Gợi ý phường/xã">
          {matches.map((place) => (
            <li key={place.name} role="option" aria-selected="false">
              <button type="button" onClick={() => add(place.name)}>
                <Plus size={14} aria-hidden="true" />
                {place.name.replace(/,\s*Thành phố Hồ Chí Minh$/i, "")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
