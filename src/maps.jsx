import React, { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster";
import * as maplibregl from "maplibre-gl";
import maplibreglWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  AlertTriangle,
  Compass,
  Crosshair,
  ExternalLink,
  LocateFixed,
  MapPin,
  Navigation,
  Route,
  Search,
  Scan,
  Trash2,
  UserCheck,
  X,
} from "lucide-react";
import { api, awaitingIntake, groups, statuses } from "./domain";
import { loadHcmAreas, shortArea } from "./areas";
import { Status } from "./ui";

maplibregl.setWorkerUrl(maplibreglWorkerUrl);

const hcmCenter = [10.7769, 106.7009];
const DEFAULT_GOONG_MAP_KEY = "8K7ueiGj67N8nImjImdepvpxcImsPUqfsmhE1fNk";
const credit =
  '&copy; <a href="https://goong.io/" target="_blank" rel="noreferrer">Goong Maps</a> · &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>';
let directory;
function localData(url) {
  return fetch(url).then((r) => {
    if (!r.ok) throw Error();
    return r.json();
  });
}
function loadDirectory() {
  directory ??= localData("/maps/places.json")
    .then((rows) => rows.filter((row) => row[0].includes("Hồ Chí Minh")))
    .catch((e) => {
      directory = null;
      throw e;
    });
  return directory;
}
function normalize(text) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .trim();
}

const goongStyleCache = new Map();
function fetchGoongStyle(mapKey, signal) {
  if (goongStyleCache.has(mapKey)) {
    return Promise.resolve(structuredClone(goongStyleCache.get(mapKey)));
  }
  const url =
    "https://tiles.goong.io/assets/goong_map_web.json?api_key=" +
    encodeURIComponent(mapKey);
  return fetch(url, { signal, headers: { Accept: "application/json" } })
    .then((r) => {
      if (!r.ok) throw Error("HTTP " + r.status);
      return r.json();
    })
    .then((style) => {
      if (style && typeof style === "object") {
        delete style.center;
        delete style.zoom;
        delete style.bearing;
        delete style.pitch;
      }
      if (Array.isArray(style?.layers)) {
        for (const l of style.layers) {
          if (l?.type === "background" && "filter" in l) {
            delete l.filter;
          }
        }
      }
      goongStyleCache.set(mapKey, style);
      return structuredClone(style);
    });
}
function mountGoongVectorLayer(leafletMap, mapKey, { onLoad, onError } = {}) {
  let disposed = false;
  let glMap = null;
  let container = null;
  const ctrl = new AbortController();

  const sync = (withResize = false) => {
    if (!glMap || !container || disposed) return;
    const size = leafletMap.getSize();
    if (size.x <= 0 || size.y <= 0) return;
    container.style.width = size.x + "px";
    container.style.height = size.y + "px";
    L.DomUtil.setPosition(
      container,
      leafletMap.containerPointToLayerPoint([0, 0]),
    );
    if (withResize) glMap.resize();
    const c = leafletMap.getCenter();
    glMap.jumpTo({
      center: [c.lng, c.lat],
      zoom: leafletMap.getZoom() - 1,
      bearing: 0,
      pitch: 0,
    });
  };

  const onMove = () => sync(false);
  const onResize = () => sync(true);

  fetchGoongStyle(mapKey, ctrl.signal)
    .then((style) => {
      if (disposed) return;
      const tilePane = leafletMap.getPanes()?.tilePane;
      if (!tilePane) return;
      container = document.createElement("div");
      container.className = "goong-gl-layer";
      const size = leafletMap.getSize();
      container.style.width = Math.max(1, size.x) + "px";
      container.style.height = Math.max(1, size.y) + "px";
      L.DomUtil.setPosition(
        container,
        leafletMap.containerPointToLayerPoint([0, 0]),
      );
      tilePane.appendChild(container);

      const c = leafletMap.getCenter();
      try {
        glMap = new maplibregl.Map({
          container,
          style,
          interactive: false,
          attributionControl: false,
          trackResize: false,
          center: [c.lng, c.lat],
          zoom: leafletMap.getZoom() - 1,
        });
      } catch (err) {
        container.remove();
        container = null;
        throw err;
      }
      glMap.on("load", () => {
        if (disposed) return;
        sync(true);
        onLoad?.();
      });
      glMap.on("error", (e) => {
        if (disposed) return;
        if (!glMap?.loaded()) onError?.(e?.error || e);
      });

      leafletMap.on("move moveend zoom zoomend viewreset", onMove);
      leafletMap.on("resize", onResize);
    })
    .catch((err) => {
      if (!disposed && err?.name !== "AbortError") {
        onError?.(err);
      }
    });

  return () => {
    disposed = true;
    ctrl.abort();
    leafletMap.off("move moveend zoom zoomend viewreset", onMove);
    leafletMap.off("resize", onResize);
    if (glMap) {
      try {
        glMap.remove();
      } catch {
        // Ignore cleanup errors if WebGL context already lost
      }
      glMap = null;
    }
    if (container) {
      container.remove();
      container = null;
    }
  };
}

function MapCanvas({ label, children, className = "" }) {
  const surface = useRef(null),
    layer = useRef(null);
  const [map, setMap] = useState(null),
    [tileError, setTileError] = useState(false);
  useEffect(() => {
    const instance = L.map(surface.current, {
      zoomControl: false,
      minZoom: 9,
      maxZoom: 19,
      scrollWheelZoom: false,
      worldCopyJump: true,
      zoomSnap: 0.25,
    }).setView(hcmCenter, 12);
    instance.attributionControl.setPrefix(false);
    L.control
      .zoom({
        position: "topright",
        zoomInTitle: "Phóng to",
        zoomOutTitle: "Thu nhỏ",
      })
      .addTo(instance);
    L.control
      .scale({ imperial: false, position: "bottomleft" })
      .addTo(instance);
    let live = true;
    const tiles = L.tileLayer("https://tile.openstreetmap.de/{z}/{x}/{y}.png", {
      maxZoom: 19,
      maxNativeZoom: 18,
      attribution: credit,
    });
    let errors = 0;
    let goongReady = false;
    tiles.on("loading", () => {
      errors = 0;
    });
    tiles.on("tileerror", () => {
      errors++;
      if (live && !goongReady) setTileError(true);
    });
    tiles.on("load", () => {
      if (live && !goongReady) setTileError(errors > 0);
    });
    tiles.addTo(instance);
    layer.current = tiles;

    let unmountGoong = null;
    loadGoongMapKey().then((mapKey) => {
      if (!live || !mapKey) return;
      unmountGoong = mountGoongVectorLayer(instance, mapKey, {
        onLoad() {
          if (!live) return;
          goongReady = true;
          tiles.setOpacity(0);
          setTileError(false);
        },
        onError() {
          if (!live) return;
          goongReady = false;
          tiles.setOpacity(1);
        },
      });
    });

    const observer = new ResizeObserver(() =>
      instance.invalidateSize({ pan: false }),
    );
    observer.observe(surface.current);
    setMap(instance);
    return () => {
      live = false;
      unmountGoong?.();
      observer.disconnect();
      instance.remove();
      layer.current = null;
    };
  }, []);
  return (
    <div className={"map-shell " + className}>
      <div
        className="map-canvas"
        ref={surface}
        role="region"
        aria-label={label}
      />
      {map && children(map)}
      {tileError && (
        <div className="tile-warning" aria-live="polite">
          Chưa tải đủ bản đồ nền.{" "}
          <button type="button" onClick={() => layer.current?.redraw()}>
            Tải lại
          </button>
        </div>
      )}
    </div>
  );
}
function icon(status, count = 1) {
  const kind = statuses[status] ? status : "point";
  return L.divIcon({
    className: "geo-marker " + kind,
    html:
      '<span class="geo-pin">' +
      (count > 1 ? "<b>" + count + "</b>" : "<i></i>") +
      "</span>",
    iconSize: [28, 34],
    iconAnchor: [14, 34],
    popupAnchor: [0, -32],
  });
}
function fixPoint(lat, lng) {
  return {
    lat: Number(lat.toFixed(6)),
    lng: Number(L.Util.wrapNum(lng, [-180, 180], true).toFixed(6)),
  };
}
function PickerLayer({ map, pin, setPin, view, onReady }) {
  useEffect(() => {
    onReady?.(map);
    return () => onReady?.(null);
  }, [map, onReady]);
  useEffect(() => {
    map.setView(view.center, view.zoom, { animate: false });
  }, [map, view]);
  useEffect(() => {
    const select = (e) => setPin(fixPoint(e.latlng.lat, e.latlng.lng));
    map.on("click", select);
    return () => map.off("click", select);
  }, [map, setPin]);
  useEffect(() => {
    if (!pin) return;
    const marker = L.marker([pin.lat, pin.lng], {
      icon: icon(),
      draggable: true,
      title: "Ghim hiện trường",
    }).addTo(map);
    marker.on("dragend", () => {
      const p = marker.getLatLng();
      setPin(fixPoint(p.lat, p.lng));
    });
    return () => marker.remove();
  }, [map, pin, setPin]);
  return (
    <button
      type="button"
      className="map-center-action"
      onClick={() => {
        const p = map.getCenter();
        setPin(fixPoint(p.lat, p.lng));
      }}
    >
      <MapPin size={15} />
      Ghim tại tâm bản đồ
    </button>
  );
}
function composeLocation(street, ...restParts) {
  const seen = new Set();
  const out = [];
  for (const raw of [street, ...restParts]) {
    if (!raw) continue;
    for (const seg of String(raw).split(",")) {
      const clean = seg.trim();
      if (!clean) continue;
      let norm = normalize(clean);
      if (
        /^(tp\.?|thanh pho)?\s*ho chi minh/.test(norm) ||
        norm === "ho chi minh city"
      ) {
        norm = "tphcm";
      }
      if (seen.has(norm)) continue;
      seen.add(norm);
      out.push(clean);
    }
  }
  return out.join(", ");
}
function cleanAreaHint(parts) {
  const out = [];
  const seen = new Set();
  for (const raw of parts) {
    const clean = (raw || "").trim();
    if (!clean) continue;
    const norm = normalize(clean);
    if (
      /^(tp\.?|thanh pho)?\s*ho chi minh/.test(norm) ||
      norm === "ho chi minh city" ||
      norm === "viet nam" ||
      norm === "vietnam"
    ) {
      continue;
    }
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(clean);
  }
  return out.join(", ");
}
function inHcmBounds(lat, lng) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= 10.33 &&
    lat <= 11.18 &&
    lng >= 106.33 &&
    lng <= 107.05
  );
}
function extractHousePrefix(query) {
  const m = query
    .trim()
    .match(/^(\d+[a-zA-Z]?(?:\/\d+[a-zA-Z]?)*)(?:\s+|,\s*)(.+)$/);
  return m ? { house: m[1], rest: m[2] } : { house: "", rest: query.trim() };
}
function streetTokens(text) {
  const stop = new Set(["duong", "pho", "hem", "ngo", "so", "tp", "tphcm", "hcm"]);
  return normalize(text)
    .split(/[\s,./-]+/)
    .filter((t) => t && !stop.has(t));
}
function candidateMatchesStreet(candidateText, rest) {
  const tokens = streetTokens(rest);
  if (!tokens.length) return true;
  const hay = normalize(candidateText).replace(/[^\w\s]/g, " ");
  return tokens.every((t) => hay.includes(t));
}
function nominatimStreet(addr) {
  if (!addr) return "";
  const road =
    addr.road || addr.pedestrian || addr.residential || addr.footway || "";
  const num = addr.house_number || "";
  return [num, road].filter(Boolean).join(" ").trim();
}
function nearestWard(places, p) {
  if (!places.length) return "";
  let best = places[0],
    bestDist = Infinity;
  for (const item of places) {
    const d = (item[1] - p.lat) ** 2 + (item[2] - p.lng) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = item;
    }
  }
  return best[0] || "";
}
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function stripHousePrefix(text, house) {
  if (!text || !house) return (text || "").trim();
  return text
    .replace(new RegExp("^" + escapeRegExp(house) + "(?:[\\s,/-]+|$)", "i"), "")
    .trim();
}
function extractAlleyInfo(roadName, targetHouseNum) {
  if (!Number.isFinite(targetHouseNum)) return { isAlley: false, alleyDist: Infinity, baseStreet: roadName };
  const m = normalize(roadName).match(/^(?:hem|kiet|ngo|duong\s+hem)\s*(\d+)/i);
  if (!m) return { isAlley: false, alleyDist: Infinity, baseStreet: roadName };
  const alleyNum = parseInt(m[1], 10);
  const restRoad = roadName
    .replace(/^(?:Hẻm|Kiết|Ngõ|Đường\s+hẻm)\s*\d+[a-zA-Z]*(?:\/\d+[a-zA-Z]*)*\s*/i, "")
    .trim();
  return {
    isAlley: Number.isFinite(alleyNum),
    alleyDist: Number.isFinite(alleyNum) ? Math.abs(alleyNum - targetHouseNum) : Infinity,
    baseStreet: restRoad || roadName,
  };
}
async function searchArcGIS(query, house, rest, signal) {
  const url =
    "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?f=json&SingleLine=" +
    encodeURIComponent(query.trim() + ", Thành phố Hồ Chí Minh") +
    "&countryCode=VNM&searchExtent=106.33,10.33,107.05,11.18&location=106.7009,10.7769&outFields=Match_addr,StAddr,AddNum,StName,PlaceName,Nbrhd,District,City,Addr_type&maxLocations=6&langCode=vi";
  const res = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!res.ok) return [];
  const data = await res.json();
  const out = [];
  for (const c of data.candidates || []) {
    const score = typeof c.score === "number" ? c.score : 0;
    if (typeof c.score === "number" && c.score < 55) continue;
    const lat = Number(c.location?.y),
      lng = Number(c.location?.x);
    if (!inHcmBounds(lat, lng)) continue;
    const a = c.attributes || {};
    const checkText = [a.StName, a.StAddr, a.PlaceName, c.address].filter(Boolean).join(" ");
    if (house && rest && !candidateMatchesStreet(checkText, rest)) continue;
    const addNum = String(a.AddNum || "").trim();
    const isPointType = a.Addr_type === "PointAddress" || a.Addr_type === "Subaddress";
    const exactHouse = Boolean(
      house &&
        isPointType &&
        ((addNum && normalize(addNum) === normalize(house)) ||
          new RegExp("(^|\\s)" + escapeRegExp(normalize(house)) + "(\\s|$)").test(
            normalize(a.StAddr || c.address || ""),
          )),
    );
    const interpolated = Boolean(house && !exactHouse && a.Addr_type === "StreetAddress");
    const roadBase = (
      a.StName ||
      a.PlaceName ||
      stripHousePrefix(a.StAddr || c.address || "", house)
    ).trim();
    const areaHint = cleanAreaHint([a.Nbrhd, a.District]);
    const subParts = [a.Nbrhd, a.District, a.City || "TP. Hồ Chí Minh"].filter(Boolean);
    const sub = areaHint
      ? `${areaHint}, TP. Hồ Chí Minh`
      : cleanAreaHint(subParts) || "TP. Hồ Chí Minh";
    if (!roadBase) continue;
    const exactLabel = (a.StAddr || [addNum || house, roadBase].filter(Boolean).join(" ")).trim();
    const street = exactHouse
      ? exactLabel
      : house && !normalize(roadBase).startsWith(normalize(house))
        ? `${house} ${roadBase}`
        : roadBase;
    out.push({
      key: "",
      kind: exactHouse ? "exact" : interpolated ? "interpolated" : "segment",
      score,
      alleyDist: Infinity,
      roadBase,
      label: exactHouse
        ? exactLabel
        : interpolated
          ? `${house} ${roadBase} (vị trí ước lượng trên đường — chạm bản đồ để chỉnh chính xác)`
          : house
            ? `${roadBase} — Khu vực ${areaHint || "TP. Hồ Chí Minh"}`
            : roadBase,
      sub,
      areaHint,
      lat,
      lng,
      street,
      exactHouse,
    });
  }
  return out;
}
async function searchPhoton(query, house, rest, signal, opts = {}) {
  const targetHouseNum = parseInt(house, 10);
  const url =
    "https://photon.komoot.io/api/?q=" +
    encodeURIComponent(query.trim() + " Hồ Chí Minh") +
    "&lat=10.7769&lon=106.7009&bbox=106.33,10.33,107.05,11.18&limit=6";
  const res = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!res.ok) return [];
  const data = await res.json();
  const out = [];
  for (const f of data.features || []) {
    const [lng, lat] = (f.geometry?.coordinates || []).map(Number);
    if (!inHcmBounds(lat, lng)) continue;
    const p = f.properties || {};
    const checkText = [p.housenumber, p.street, p.name, p.suburb, p.district]
      .filter(Boolean)
      .join(" ");
    if (house && rest && !candidateMatchesStreet(checkText, rest)) continue;
    const num = String(p.housenumber || "").trim();
    const base = stripHousePrefix(p.street || p.name || "", opts.alleyMode ? "" : house);
    if (!base) continue;
    const exactHouse = Boolean(house && num && normalize(num) === normalize(house));
    const alley = opts.alleyMode ? extractAlleyInfo(base, targetHouseNum) : { isAlley: false, alleyDist: Infinity, baseStreet: base };
    if (opts.alleyMode && !alley.isAlley) continue;
    const areaHint = cleanAreaHint([p.suburb || p.locality, p.district]);
    const sub = areaHint ? `${areaHint}, TP. Hồ Chí Minh` : "TP. Hồ Chí Minh";
    const exactLabel = [num, base].filter(Boolean).join(" ").trim();
    const street = exactHouse
      ? exactLabel
      : house && !normalize(alley.baseStreet).startsWith(normalize(house))
        ? `${house} ${alley.baseStreet}`
        : alley.baseStreet;
    out.push({
      key: "",
      kind: exactHouse ? "exact" : alley.isAlley ? "alley" : "segment",
      score: 0,
      alleyDist: alley.alleyDist,
      roadBase: base,
      label: exactHouse
        ? exactLabel
        : alley.isAlley
          ? `${base} (gần số ${house})`
          : house
            ? `${base} — Khu vực ${areaHint || "TP. Hồ Chí Minh"}`
            : base,
      sub,
      areaHint,
      lat,
      lng,
      street,
      exactHouse,
    });
  }
  return out;
}
async function searchNominatim(query, house, rest, signal) {
  const targetHouseNum = parseInt(house, 10);
  const searchText = house && rest.length >= 2 ? rest : query.trim();
  const url =
    "https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&countrycodes=vn&viewbox=106.33,11.18,107.05,10.33&bounded=1&accept-language=vi&q=" +
    encodeURIComponent(searchText);
  const res = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!res.ok) return [];
  const rows = await res.json();
  const out = [];
  for (const item of rows || []) {
    const lat = Number(item.lat),
      lng = Number(item.lon);
    if (!inHcmBounds(lat, lng)) continue;
    const rawRoad = (
      item.address?.road ||
      item.address?.pedestrian ||
      item.address?.residential ||
      item.address?.footway ||
      item.address?.path ||
      item.name ||
      item.display_name.split(",")[0]
    ).trim();
    const checkText = [item.name, item.display_name].filter(Boolean).join(" ");
    if (house && rest && !candidateMatchesStreet(checkText, rest)) continue;
    const num = String(item.address?.house_number || "").trim();
    const exactHouse = Boolean(house && num && normalize(num) === normalize(house));
    const alley = house ? extractAlleyInfo(rawRoad, targetHouseNum) : { isAlley: false, alleyDist: Infinity, baseStreet: rawRoad };
    const roadBase = exactHouse ? rawRoad : stripHousePrefix(rawRoad, house);
    if (!roadBase) continue;
    const areaHint = cleanAreaHint([
      item.address?.quarter || item.address?.suburb || item.address?.village,
      item.address?.city_district,
    ]);
    const sub = areaHint ? `${areaHint}, TP. Hồ Chí Minh` : "TP. Hồ Chí Minh";
    const exactLabel = [num, rawRoad].filter(Boolean).join(" ").trim();
    const street = exactHouse
      ? exactLabel
      : house && !normalize(alley.baseStreet).startsWith(normalize(house))
        ? `${house} ${alley.baseStreet}`
        : alley.baseStreet;
    out.push({
      key: "",
      kind: exactHouse ? "exact" : alley.isAlley ? "alley" : "segment",
      score: 0,
      alleyDist: alley.alleyDist,
      roadBase,
      label: exactHouse
        ? exactLabel
        : alley.isAlley
          ? `${roadBase} (gần số ${house})`
          : house
            ? `${roadBase} — Khu vực ${areaHint || "TP. Hồ Chí Minh"}`
            : roadBase,
      sub,
      areaHint,
      lat,
      lng,
      street,
      exactHouse,
    });
  }
  return out;
}
let cachedGeoConfig = null;
let geoConfigPromise = null;
function fetchGeoConfig() {
  if (cachedGeoConfig) return Promise.resolve(cachedGeoConfig);
  if (!geoConfigPromise) {
    geoConfigPromise = api("/geocode/config")
      .then((r) => {
        const cfg = {
          goong_api_key: String(r?.goong_api_key || "").trim(),
          goong_map_key:
            String(r?.goong_map_key || "").trim() || DEFAULT_GOONG_MAP_KEY,
        };
        cachedGeoConfig = cfg;
        return cfg;
      })
      .catch(() => ({
        goong_api_key: "",
        goong_map_key: DEFAULT_GOONG_MAP_KEY,
      }))
      .finally(() => {
        geoConfigPromise = null;
      });
  }
  return geoConfigPromise;
}
function loadGeoConfig() {
  return fetchGeoConfig().then((cfg) => cfg.goong_api_key);
}
function loadGoongMapKey() {
  return fetchGeoConfig().then((cfg) => cfg.goong_map_key);
}
async function searchGoong(query, apiKey, signal) {
  const url =
    "https://rsapi.goong.io/Place/AutoComplete?api_key=" +
    encodeURIComponent(apiKey) +
    "&input=" +
    encodeURIComponent(query.trim()) +
    "&location=10.7769,106.7009&radius=65000&limit=6&more_compound=true";
  const res = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!res.ok) return [];
  const data = await res.json();
  const out = [];
  for (const p of data?.predictions || []) {
    const prov = p.compound?.province || "";
    if (
      prov &&
      !normalize(prov).includes("ho chi minh") &&
      !normalize(p.description || "").includes("ho chi minh")
    ) {
      continue;
    }
    const main =
      p.structured_formatting?.main_text ||
      (p.description || "").split(",")[0].trim();
    if (!main) continue;
    const areaHint = cleanAreaHint([p.compound?.commune, p.compound?.district]);
    const sub =
      p.structured_formatting?.secondary_text ||
      [p.compound?.commune, p.compound?.district, p.compound?.province]
        .filter(Boolean)
        .join(", ");
    out.push({
      key: p.place_id || normalize(main + "|" + areaHint) + "|" + out.length,
      placeId: p.place_id,
      label: main,
      sub,
      areaHint,
      street: main,
      exactHouse: true,
    });
  }
  return out;
}
async function fetchGoongPlaceDetail(placeId, apiKey) {
  const url =
    "https://rsapi.goong.io/Place/Detail?api_key=" +
    encodeURIComponent(apiKey) +
    "&place_id=" +
    encodeURIComponent(placeId);
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  const data = await res.json();
  const result = data?.result || {};
  const loc = result.geometry?.location || {};
  const lat = Number(loc.lat),
    lng = Number(loc.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const street = (
    result.name ||
    (result.formatted_address || "").split(",")[0] ||
    ""
  ).trim();
  const areaHint = cleanAreaHint([
    result.compound?.commune,
    result.compound?.district,
  ]);
  return { lat, lng, street, areaHint };
}
async function reverseGoong(p, apiKey, signal) {
  const url =
    "https://rsapi.goong.io/Geocode?api_key=" +
    encodeURIComponent(apiKey) +
    "&latlng=" +
    p.lat +
    "," +
    p.lng;
  const res = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  const data = await res.json();
  const first = (data?.results || [])[0];
  if (!first) return null;
  const street = (
    first.name ||
    (first.formatted_address || "").split(",")[0] ||
    ""
  ).trim();
  if (!street) return null;
  const areaHint = cleanAreaHint([
    first.compound?.commune,
    first.compound?.district,
  ]);
  return { street, areaHint, hasHouse: true };
}
async function searchRealAddresses(query, signal) {
  const goongKey = await loadGeoConfig();
  if (goongKey) {
    const goongHits = await searchGoong(query, goongKey, signal).catch(() => []);
    if (goongHits.length > 0) return goongHits;
  }
  const { house, rest } = extractHousePrefix(query);
  const requests = [
    searchArcGIS(query, house, rest, signal),
    searchPhoton(query, house, rest, signal),
    searchNominatim(query, house, rest, signal),
  ];
  if (house && rest.length >= 2) {
    requests.push(
      searchPhoton("Hẻm " + rest, house, rest, signal, { alleyMode: true }),
    );
  }
  const batches = await Promise.allSettled(requests);
  const merged = [];
  for (const batch of batches) {
    if (batch.status === "fulfilled") merged.push(...batch.value);
  }
  const exactOnly = merged.filter((m) => m.exactHouse);
  let ranked;
  if (exactOnly.length > 0) {
    ranked = exactOnly;
  } else {
    const interpolated = merged
      .filter((m) => m.kind === "interpolated")
      .sort((a, b) => b.score - a.score);
    const alleys = merged
      .filter((m) => m.kind === "alley")
      .sort((a, b) => a.alleyDist - b.alleyDist);
    const segments = merged.filter((m) => m.kind === "segment");
    // Strip echoed house numbers on any other StreetAddress hits and allow at most 1 interpolated estimate.
    const extraSegments = interpolated.slice(1).map((item) => ({
      ...item,
      kind: "segment",
      label: `${item.roadBase} — Khu vực ${item.areaHint || "TP. Hồ Chí Minh"}`,
    }));
    ranked = [
      ...(interpolated[0] ? [interpolated[0]] : []),
      ...alleys,
      ...segments,
      ...extraSegments,
    ];
  }
  const seen = new Set();
  const out = [];
  for (const item of ranked) {
    const dedupeKey = normalize(
      (item.exactHouse ? item.label : item.kind + "|" + item.roadBase) +
        "|" +
        item.sub,
    );
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push({ ...item, key: dedupeKey + "|" + out.length });
    if (out.length >= 6) break;
  }
  return out;
}
async function reverseArcGIS(p, signal) {
  const url =
    "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/reverseGeocode?f=json&location=" +
    p.lng +
    "," +
    p.lat +
    "&langCode=vi";
  const res = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  const data = await res.json();
  const a = data?.address || {};
  const street = (a.Address || a.ShortLabel || "").trim();
  if (!street) return null;
  const areaHint = cleanAreaHint([a.Nbrhd, a.District]);
  return {
    street,
    areaHint,
    hasHouse: Boolean(a.AddNum && String(a.AddNum).trim()),
  };
}
async function reverseNominatim(p, signal) {
  const url =
    "https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=" +
    p.lat +
    "&lon=" +
    p.lng +
    "&zoom=18&addressdetails=1&accept-language=vi";
  const res = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  const data = await res.json();
  const addr = data?.address || {};
  const street = nominatimStreet(addr);
  if (!street) return null;
  const areaHint = cleanAreaHint([
    addr.quarter || addr.suburb || addr.village,
    addr.city_district,
  ]);
  return { street, areaHint, hasHouse: Boolean(addr.house_number) };
}
async function reverseRealAddress(p, signal) {
  const goongKey = await loadGeoConfig();
  if (goongKey) {
    const goongHit = await reverseGoong(p, goongKey, signal).catch(() => null);
    if (goongHit?.street) return goongHit;
  }
  const settled = await Promise.allSettled([
    reverseArcGIS(p, signal),
    reverseNominatim(p, signal),
  ]);
  const hits = settled
    .filter((r) => r.status === "fulfilled" && r.value?.street)
    .map((r) => r.value);
  return hits.find((h) => h.hasHouse) || hits[0] || { street: "", areaHint: "" };
}

export function LocationPicker({ pin, setPin, location = "", setLocation }) {
  const [view, setView] = useState(() => ({
    center: pin ? [pin.lat, pin.lng] : hcmCenter,
    zoom: pin ? 16 : 11,
  }));
  const [places, setPlaces] = useState([]),
    [q, setQ] = useState(""),
    [geoMatches, setGeoMatches] = useState([]),
    [geoLoading, setGeoLoading] = useState(false),
    [street, setStreet] = useState(""),
    [areaHint, setAreaHint] = useState(""),
    [ward, setWard] = useState(""),
    [geoBusy, setGeoBusy] = useState(false),
    [notice, setNotice] = useState("");
  const request = useRef(0),
    pinLookup = useRef(0),
    reverseAbort = useRef(null),
    mapRef = useRef(null),
    streetRef = useRef(""),
    areaHintRef = useRef(""),
    lastAppliedPin = useRef("");
  streetRef.current = street;
  areaHintRef.current = areaHint;
  useEffect(() => {
    const key = pin ? `${pin.lat},${pin.lng}` : "";
    if (!pin || key === lastAppliedPin.current) {
      if (!pin) lastAppliedPin.current = "";
      return;
    }
    lastAppliedPin.current = key;
    setView({ center: [pin.lat, pin.lng], zoom: 17 });
    applyPin(pin, { skipStreetLookup: Boolean(location) });
  }, [pin?.lat, pin?.lng]);
  useEffect(
    () => () => {
      request.current++;
      pinLookup.current++;
      reverseAbort.current?.abort();
    },
    [],
  );
  useEffect(() => {
    let live = true;
    loadDirectory()
      .then((p) => {
        if (live) setPlaces(p);
      })
      .catch(() => {
        if (live)
          setNotice(
            "Chưa tải được danh mục khu vực. Bạn vẫn có thể chọn điểm trên bản đồ.",
          );
      });
    return () => {
      live = false;
    };
  }, []);
  const term = normalize(q),
    parsedQuery = useMemo(() => extractHousePrefix(q), [q]),
    restTerm = normalize(parsedQuery.rest),
    matches = useMemo(() => {
      if (term.length < 2) return [];
      return places
        .filter((p) => {
          const full = normalize(p[0]);
          if (full.includes(term)) return true;
          if (parsedQuery.house && restTerm.length >= 2 && full.includes(restTerm))
            return true;
          const shortName = full
            .replace(/,\s*thanh pho ho chi minh$/, "")
            .replace(/^(phuong|xa|thi tran|dac khu)\s+/, "");
          if (shortName.length >= 3) {
            const rx = new RegExp(
              "(^|\\s|,)" +
                shortName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
                "(\\s|,|$)",
            );
            if (rx.test(term)) return true;
          }
          return false;
        })
        .slice(0, 7);
    }, [places, term, parsedQuery.house, restTerm]);
  useEffect(() => {
    if (term.length < 3) {
      setGeoMatches([]);
      setGeoLoading(false);
      return;
    }
    setGeoLoading(true);
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => {
      const timeoutId = window.setTimeout(() => ctrl.abort(), 6000);
      searchRealAddresses(q, ctrl.signal)
        .then((list) => {
          if (!ctrl.signal.aborted) setGeoMatches(list);
        })
        .catch(() => {
          if (!ctrl.signal.aborted) setGeoMatches([]);
        })
        .finally(() => {
          window.clearTimeout(timeoutId);
          if (!ctrl.signal.aborted) setGeoLoading(false);
        });
    }, 320);
    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [q, term.length]);
  async function applyPin(p, options = {}) {
    request.current++;
    setGeoBusy(false);
    setNotice("");
    if (!p) {
      pinLookup.current++;
      reverseAbort.current?.abort();
      setPin(null);
      setAreaHint("");
      areaHintRef.current = "";
      setWard("");
      return;
    }
    const seq = ++pinLookup.current;
    reverseAbort.current?.abort();
    const ctrl = new AbortController();
    reverseAbort.current = ctrl;
    const timeoutId = window.setTimeout(() => ctrl.abort(), 6000);
    setPin(p);
    lastAppliedPin.current = `${p.lat},${p.lng}`;
    let currentStreet =
      options.presetStreet !== undefined
        ? options.presetStreet
        : streetRef.current;
    if (options.presetStreet !== undefined) {
      setStreet(options.presetStreet);
      streetRef.current = options.presetStreet;
    }
    let currentArea = options.areaHint || "";
    setAreaHint(currentArea);
    areaHintRef.current = currentArea;
    let resolvedWard = options.knownWard || "";
    if (resolvedWard) {
      setWard(resolvedWard);
      setLocation?.(composeLocation(currentStreet, currentArea, resolvedWard));
    } else {
      try {
        const rev = await api(
          `/geocode/reverse?lat=${p.lat}&lng=${p.lng}`,
        );
        if (seq !== pinLookup.current) {
          window.clearTimeout(timeoutId);
          return;
        }
        if (rev?.in_hcm && rev.ward) {
          resolvedWard = rev.ward;
          setWard(resolvedWard);
          setLocation?.(
            composeLocation(currentStreet, currentArea, resolvedWard),
          );
        } else {
          setWard("");
          setNotice(
            "Vị trí ghim nằm ngoài phạm vi TP. Hồ Chí Minh. Vui lòng chọn điểm trong TP.HCM.",
          );
          window.clearTimeout(timeoutId);
          return;
        }
      } catch {
        if (seq !== pinLookup.current) {
          window.clearTimeout(timeoutId);
          return;
        }
        resolvedWard = nearestWard(places, p);
        if (resolvedWard) {
          setWard(resolvedWard);
          setLocation?.(
            composeLocation(currentStreet, currentArea, resolvedWard),
          );
        }
      }
    }
    if (options.presetStreet === undefined && !options.skipStreetLookup) {
      reverseRealAddress(p, ctrl.signal)
        .then((hit) => {
          if (seq !== pinLookup.current || (!hit?.street && !hit?.areaHint)) {
            return;
          }
          const nextStreet = hit.street || streetRef.current;
          const nextArea = hit.areaHint || areaHintRef.current;
          if (hit.street) {
            setStreet(nextStreet);
            streetRef.current = nextStreet;
          }
          if (hit.areaHint) {
            setAreaHint(nextArea);
            areaHintRef.current = nextArea;
          }
          setLocation?.(composeLocation(nextStreet, nextArea, resolvedWard));
        })
        .catch(() => {})
        .finally(() => window.clearTimeout(timeoutId));
    } else {
      window.clearTimeout(timeoutId);
    }
  }
  function fromDevice() {
    if (!navigator.geolocation) {
      setNotice("Thiết bị chưa hỗ trợ định vị. Bạn có thể chạm lên bản đồ.");
      return;
    }
    const seq = ++request.current;
    setGeoBusy(true);
    setNotice("");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (seq !== request.current) return;
        const p = fixPoint(coords.latitude, coords.longitude);
        setView({ center: [p.lat, p.lng], zoom: 17 });
        applyPin(p);
      },
      (err) => {
        if (seq !== request.current) return;
        setGeoBusy(false);
        setNotice(
          err.code === 1
            ? "Bạn chưa cấp quyền vị trí. Chạm lên bản đồ để chọn điểm hoặc nhập địa chỉ trực tiếp."
            : "Chưa xác định được vị trí thiết bị. Bạn có thể chạm lên bản đồ để chọn điểm.",
        );
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );
  }
  function selectWard(p) {
    const pt = fixPoint(p[1], p[2]);
    setView({ center: [pt.lat, pt.lng], zoom: 14 });
    let presetStreet;
    if (parsedQuery.house) {
      const rawWard = p[0].replace(/,\s*Thành phố Hồ Chí Minh$/i, "").trim();
      const shortWard = rawWard
        .replace(/^(Phường|Xã|Thị trấn|Đặc khu)\s+/i, "")
        .trim();
      const stripped = q
        .trim()
        .replace(new RegExp(rawWard.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "")
        .replace(new RegExp(shortWard.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "")
        .replace(/^[,\s-]+|[,\s-]+$/g, "")
        .trim();
      if (stripped) presetStreet = stripped;
    }
    setQ("");
    setGeoMatches([]);
    setGeoLoading(false);
    applyPin(pt, {
      knownWard: p[0],
      areaHint: "",
      skipStreetLookup: true,
      ...(presetStreet !== undefined ? { presetStreet } : {}),
    });
  }
  async function selectGeo(item) {
    setQ("");
    setGeoMatches([]);
    setGeoLoading(false);
    let lat = item.lat,
      lng = item.lng,
      streetText = item.street || item.label,
      areaText = item.areaHint || "";
    if (item.placeId && (!lat || !lng)) {
      const key = await loadGeoConfig();
      const detail = key
        ? await fetchGoongPlaceDetail(item.placeId, key).catch(() => null)
        : null;
      if (!detail || !inHcmBounds(detail.lat, detail.lng)) {
        setNotice(
          "Không lấy được tọa độ trong phạm vi TP. Hồ Chí Minh cho địa chỉ này.",
        );
        return;
      }
      lat = detail.lat;
      lng = detail.lng;
      streetText = detail.street || streetText;
      areaText = detail.areaHint || areaText;
    }
    const pt = fixPoint(lat, lng);
    setView({ center: [pt.lat, pt.lng], zoom: item.exactHouse ? 18 : 16 });
    applyPin(pt, {
      presetStreet: streetText,
      areaHint: areaText,
    });
  }
  function applyCustomQuery() {
    const mapCenter = mapRef.current
      ? fixPoint(mapRef.current.getCenter().lat, mapRef.current.getCenter().lng)
      : fixPoint(view.center[0], view.center[1]);
    const text = q.trim();
    setView({
      center: [mapCenter.lat, mapCenter.lng],
      zoom: Math.max(view.zoom, 15),
    });
    setQ("");
    setGeoMatches([]);
    setGeoLoading(false);
    applyPin(mapCenter, { presetStreet: text, areaHint: "", skipStreetLookup: true });
  }
  function handleStreetChange(value) {
    pinLookup.current++;
    reverseAbort.current?.abort();
    setStreet(value);
    streetRef.current = value;
    if (ward || value.trim()) {
      setLocation?.(composeLocation(value, areaHintRef.current, ward));
    }
  }
  const hasAnyResults = matches.length > 0 || geoMatches.length > 0;
  return (
    <div className="picker">
      <div className="picker-tools">
        <div className="place-search">
          <Search size={16} />
          <input
            aria-label="Tìm phường, xã hoặc tỉnh thành"
            placeholder="Tìm số nhà, tên đường hoặc phường/xã tại TP.HCM…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (matches[0]) selectWard(matches[0]);
                else if (geoMatches[0]) selectGeo(geoMatches[0]);
                else if (!geoLoading && term.length >= 3) applyCustomQuery();
              }
              if (e.key === "Escape") {
                setQ("");
                setGeoMatches([]);
                setGeoLoading(false);
              }
            }}
          />
          {term.length >= 2 && (
            <div className="place-results">
              {matches.map((p) => (
                <button type="button" key={p[0]} onClick={() => selectWard(p)}>
                  {p[0]}
                </button>
              ))}
              {geoMatches.map((g) => (
                <button
                  type="button"
                  key={g.key}
                  onClick={() => selectGeo(g)}
                >
                  <span>{g.label}</span>
                  {g.sub && <small className="place-sub">{g.sub}</small>}
                </button>
              ))}
              {geoLoading && <span>Đang tìm địa chỉ tại TP.HCM…</span>}
              {!geoLoading && term.length < 3 && !hasAnyResults && (
                <span>Chưa tìm thấy khu vực.</span>
              )}
              {!geoLoading && !hasAnyResults && term.length >= 3 && (
                <button
                  type="button"
                  className="place-fallback"
                  onClick={applyCustomQuery}
                >
                  Dùng địa chỉ &ldquo;{q.trim()}&rdquo; tại tâm bản đồ
                </button>
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          className="btn outline small"
          onClick={fromDevice}
          disabled={geoBusy}
        >
          <LocateFixed size={16} />
          {geoBusy ? "Đang định vị…" : "Dùng vị trí hiện tại"}
        </button>
      </div>
      <MapCanvas label="Chọn vị trí hiện trường">
        {(map) => (
          <PickerLayer
            map={map}
            pin={pin}
            setPin={applyPin}
            view={view}
            onReady={(m) => {
              mapRef.current = m;
            }}
          />
        )}
      </MapCanvas>
      <div className="pin-foot">
        <small>
          {pin
            ? `Ghim đã chọn · ${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}${ward ? " · " + ward : ""} (Có thể kéo ghim để chỉnh chính xác vị trí)`
            : "Chạm lên bản đồ để đặt ghim tại nơi xảy ra sự việc."}
        </small>
        {pin && (
          <button
            type="button"
            className="text-action"
            onClick={() => applyPin(null)}
          >
            <Trash2 size={14} />
            Bỏ ghim
          </button>
        )}
      </div>
      {notice && (
        <p className="geo-notice" role="status">
          {notice}
        </p>
      )}
      <div className="picker-address">
        <label>
          Số nhà, tên đường / hẻm
          <input
            type="text"
            placeholder="VD: Số 123 Nguyễn Trãi, Hẻm 45/2…"
            value={street}
            onChange={(e) => handleStreetChange(e.target.value)}
            maxLength={140}
          />
        </label>
        <label>
          Địa điểm
          <input
            aria-label="Địa điểm"
            name="location"
            placeholder="Tự động điền từ ghim bản đồ hoặc nhập địa chỉ tại TP.HCM"
            value={location}
            onChange={(e) => setLocation?.(e.target.value)}
            minLength={3}
            maxLength={240}
            required
          />
        </label>
      </div>
    </div>
  );
}

function FieldPoint({ map, pin }) {
  useEffect(() => {
    const xy = [pin.lat, pin.lng];
    map.setView(xy, pin.approximate ? 14 : 17);
    const marker = pin.approximate
      ? L.circle(xy, {
          radius: 800,
          weight: 2,
          color: "#34865f",
          fillOpacity: 0.16,
        })
      : L.marker(xy, { icon: icon(), title: "Vị trí hiện trường" });
    marker.addTo(map);
    return () => marker.remove();
  }, [map, pin.lat, pin.lng, pin.approximate]);
  return null;
}
export function FieldMap({ report }) {
  const { pin } = report;
  if (!pin)
    return (
      <p className="gis-empty-pin">
        <MapPin size={15} />
        Hồ sơ chưa có ghim vị trí.
      </p>
    );
  return (
    <section className="field-map">
      <div className="gis-heading">
        <h3>
          <MapPin size={18} />
          {pin.approximate ? "Khu vực phản ánh" : "Vị trí hiện trường"}
        </h3>
        {!pin.approximate && (
          <a
            className="text-action"
            target="_blank"
            rel="noopener noreferrer"
            href={
              "https://www.google.com/maps/dir/?api=1&destination=" +
              pin.lat +
              "," +
              pin.lng
            }
          >
            <Navigation size={15} />
            Mở chỉ đường
          </a>
        )}
      </div>
      <MapCanvas
        label={pin.approximate ? "Vị trí gần đúng" : "Bản đồ hiện trường"}
      >
        {(map) => <FieldPoint map={map} pin={pin} />}
      </MapCanvas>
      <small>
        {pin.approximate
          ? "Vị trí gần đúng trên bản đồ công cộng."
          : report.ward || "Tọa độ hiện trường do người gửi cung cấp."}
      </small>
    </section>
  );
}

function popup(rows) {
  const box = document.createElement("div");
  box.className = "geo-popup";
  for (const r of rows) {
    const link = document.createElement("a");
    link.href = "#/report/" + encodeURIComponent(r.id);
    if (r.photos?.[0]) {
      const image = document.createElement("img");
      image.src = r.photos[0];
      image.alt = "";
      link.append(image);
    }
    const copy = document.createElement("span"),
      title = document.createElement("strong"),
      status = document.createElement("small");
    title.textContent = r.title;
    status.textContent = statuses[r.status] + " · Xem hồ sơ";
    copy.append(title, status);
    link.append(copy);
    box.append(link);
  }
  return box;
}
function CommunityLayer({ map, rows, selected }) {
  const pins = useRef(new Map());
  function fit() {
    const hcmPins = rows
      .filter((r) => inHcmBounds(Number(r.pin.lat), Number(r.pin.lng)))
      .map((r) => [r.pin.lat, r.pin.lng]);
    const bounds = L.latLngBounds(hcmPins);
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [42, 42], maxZoom: 14, animate: false });
    } else {
      map.setView(hcmCenter, 12, { animate: false });
    }
  }
  useEffect(() => {
    const layer = L.markerClusterGroup({
        animate: false,
        maxClusterRadius: 42,
        disableClusteringAtZoom: 15,
        showCoverageOnHover: false,
        iconCreateFunction(cluster) {
          const count = cluster
            .getAllChildMarkers()
            .reduce((sum, m) => sum + m.options.reportCount, 0);
          return L.divIcon({
            className: "geo-cluster",
            iconSize: [36, 36],
            html:
              '<span aria-label="' + count + ' phản ánh">' + count + "</span>",
          });
        },
      }).addTo(map),
      buckets = new Map();
    pins.current.clear();
    for (const r of rows) {
      const key = r.pin.lat + "," + r.pin.lng;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(r);
    }
    for (const list of buckets.values()) {
      const r = list[0];
      const marker = L.marker([r.pin.lat, r.pin.lng], {
        icon: icon(list.length === 1 ? r.status : "point", list.length),
        reportCount: list.length,
        title:
          list.length === 1 ? r.title : list.length + " phản ánh tại khu vực",
        alt: r.title,
      })
        .addTo(layer)
        .bindPopup(() => popup(list), {
          minWidth: 200,
          maxWidth: 285,
          maxHeight: 185,
        });
      for (const item of list) pins.current.set(item.id, marker);
    }
    fit();
    return () => {
      map.closePopup();
      layer.remove();
    };
  }, [map, rows]);
  useEffect(() => {
    const marker = pins.current.get(selected?.id);
    if (marker) {
      map.setView(marker.getLatLng(), 15, { animate: false });
      marker.openPopup();
    }
  }, [map, selected, rows]);
  return (
    <button
      type="button"
      className="map-fit"
      aria-label="Xem toàn bộ ghim"
      title="Xem toàn bộ ghim"
      onClick={() => {
        map.closePopup();
        fit();
      }}
    >
      <Scan size={18} />
    </button>
  );
}
export function CommunityMap({ reports, compact = false }) {
  const rows = useMemo(
      () =>
        reports.filter(
          (r) => r.pin && inHcmBounds(Number(r.pin.lat), Number(r.pin.lng)),
        ),
      [reports],
    ),
    [selected, setSelected] = useState(null);
  if (!rows.length)
    return (
      <p className="empty">
        Các hồ sơ phù hợp chưa có ghim. Bạn có thể xem trong danh sách.
      </p>
    );
  return (
    <section className={"community-map" + (compact ? " community-map-compact" : "")}>
      {!compact && <aside className="gis-sidebar">
        <div className="map-summary">
          <h2>Phản ánh trên bản đồ</h2>
          <small>
            {rows.length} hồ sơ có ghim
            {reports.length > rows.length
              ? " · " + (reports.length - rows.length) + " hồ sơ chưa có ghim"
              : ""}
          </small>
        </div>
        <div className="map-report-list">
          {rows.map((r) => (
            <button
              key={r.id}
              type="button"
              aria-pressed={selected?.id === r.id}
              onClick={() => setSelected({ id: r.id })}
            >
              {r.photos[0] && <img src={r.photos[0]} alt="" />}
              <span>
                <Status value={r.status} />
                <b>{r.title}</b>
                <small>{r.location}</small>
              </span>
            </button>
          ))}
        </div>
      </aside>}
      <div className="community-surface">
        <MapCanvas label="Bản đồ phản ánh cộng đồng">
          {(map) => (
            <CommunityLayer map={map} rows={rows} selected={selected} />
          )}
        </MapCanvas>
        <small>
          <MapPin size={14} />
          Ghim công cộng thể hiện vị trí gần đúng.
        </small>
      </div>
    </section>
  );
}

function decodePolyline(encoded) {
  if (!encoded) return [];
  const pts = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    pts.push([lat / 1e5, lng / 1e5]);
  }
  return pts;
}
function distanceMeters(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);
  const h =
    s1 * s1 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * s2 * s2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
function formatDistance(meters) {
  if (!Number.isFinite(meters)) return "";
  if (meters < 1000) return Math.round(meters) + " m";
  return (meters / 1000).toFixed(1) + " km";
}
function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return "";
  const mins = Math.max(1, Math.round(seconds / 60));
  if (mins < 60) return mins + " phút";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} giờ ${m} phút` : `${h} giờ`;
}
function stripHtml(html) {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(String(html), "text/html");
  return (doc.body.textContent || "").replace(/\s+/g, " ").trim();
}
function googleMapsDirUrl(origin, stops, vehicle = "bike") {
  if (!stops?.length) return "#";
  const last = stops[stops.length - 1];
  const dest = `${last.pin.lat},${last.pin.lng}`;
  const mode = vehicle === "car" ? "driving" : "two-wheeler";
  const params = new URLSearchParams({
    api: "1",
    destination: dest,
    travelmode: mode,
  });
  if (origin) params.set("origin", `${origin.lat},${origin.lng}`);
  if (stops.length > 1) {
    params.set(
      "waypoints",
      stops
        .slice(0, -1)
        .map((s) => `${s.pin.lat},${s.pin.lng}`)
        .join("|"),
    );
  }
  return "https://www.google.com/maps/dir/?" + params.toString();
}
function fallbackRoute(origin, targets) {
  const points = [
    [origin.lat, origin.lng],
    ...targets.map((t) => [t.pin.lat, t.pin.lng]),
  ];
  let total = 0;
  let prev = origin;
  for (const t of targets) {
    total += distanceMeters(prev, t.pin);
    prev = t.pin;
  }
  const durationValue = Math.max(60, Math.round(total / 7));
  return {
    points,
    distanceValue: total,
    durationValue,
    distanceText: formatDistance(total),
    durationText: formatDuration(durationValue),
    steps: [],
    source: "fallback",
  };
}
async function fetchGoongDirection(origin, targets, vehicle = "bike", signal) {
  if (!origin || !targets?.length) return null;
  const goongKey = await loadGeoConfig();
  if (!goongKey) return fallbackRoute(origin, targets);
  const destStr = targets.map((t) => `${t.pin.lat},${t.pin.lng}`).join(";");
  const url =
    "https://rsapi.goong.io/Direction?origin=" +
    `${origin.lat},${origin.lng}` +
    "&destination=" +
    encodeURIComponent(destStr) +
    "&vehicle=" +
    encodeURIComponent(vehicle) +
    "&api_key=" +
    encodeURIComponent(goongKey);
  try {
    const res = await fetch(url, { signal, headers: { Accept: "application/json" } });
    if (!res.ok) return fallbackRoute(origin, targets);
    const data = await res.json();
    const route = data?.routes?.[0];
    const points = decodePolyline(route?.overview_polyline?.points);
    if (!route || points.length < 2) return fallbackRoute(origin, targets);
    const legs = route.legs || [];
    const distanceValue = legs.reduce(
      (sum, leg) => sum + (Number(leg.distance?.value) || 0),
      0,
    );
    const durationValue = legs.reduce(
      (sum, leg) => sum + (Number(leg.duration?.value) || 0),
      0,
    );
    const steps = legs.flatMap((leg, legIndex) =>
      (leg.steps || [])
        .map((st) => ({
          text: stripHtml(st.html_instructions),
          distance: st.distance?.text || "",
          duration: st.duration?.text || "",
          legIndex,
        }))
        .filter((st) => st.text),
    );
    return {
      points,
      distanceValue,
      durationValue,
      distanceText: formatDistance(distanceValue),
      durationText: formatDuration(durationValue),
      steps,
      source: "goong",
    };
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    return fallbackRoute(origin, targets);
  }
}
async function fetchGoongDistances(origin, targets, vehicle = "bike", signal) {
  const map = {};
  for (const t of targets) {
    const meters = distanceMeters(origin, t.pin);
    map[t.id] = {
      distanceValue: meters,
      durationValue: Math.max(60, Math.round(meters / 7)),
      distanceText: formatDistance(meters),
      durationText: formatDuration(Math.round(meters / 7)),
      source: "haversine",
    };
  }
  const goongKey = await loadGeoConfig();
  if (!goongKey || !targets.length) return map;
  const slice = targets.slice(0, 20);
  const url =
    "https://rsapi.goong.io/DistanceMatrix?origins=" +
    `${origin.lat},${origin.lng}` +
    "&destinations=" +
    encodeURIComponent(slice.map((t) => `${t.pin.lat},${t.pin.lng}`).join("|")) +
    "&vehicle=" +
    encodeURIComponent(vehicle) +
    "&api_key=" +
    encodeURIComponent(goongKey);
  try {
    const res = await fetch(url, { signal, headers: { Accept: "application/json" } });
    if (!res.ok) return map;
    const data = await res.json();
    const elements = data?.rows?.[0]?.elements || [];
    slice.forEach((t, idx) => {
      const el = elements[idx];
      if (el?.status === "OK" && el.distance && el.duration) {
        map[t.id] = {
          distanceValue: Number(el.distance.value),
          durationValue: Number(el.duration.value),
          distanceText: el.distance.text || formatDistance(el.distance.value),
          durationText: el.duration.text || formatDuration(el.duration.value),
          source: "goong",
        };
      }
    });
  } catch (err) {
    if (err?.name === "AbortError") throw err;
  }
  return map;
}
function reportWaitHours(report) {
  const ts = Date.parse(report?.created_at || "");
  if (!Number.isFinite(ts)) return 0;
  return Math.max(0, (Date.now() - ts) / 3600000);
}
function formatWaitAge(hours) {
  if (!Number.isFinite(hours) || hours < 1) return "Mới gửi";
  if (hours < 24) return `Tồn ${Math.round(hours)} giờ`;
  return `Tồn ${Math.round(hours / 24)} ngày`;
}
function patrolPriorityBreakdown(report, wardCounts) {
  const group = report?.confirmed_group || report?.ai_group || "other";
  const groupWeight = { hazard: 15, flood: 10, water: 10, tree: 8 };
  const urgencyPts =
    (report?.urgent ? 32 : 0) +
    (report?.priority === "high" ? 18 : 0) +
    (groupWeight[group] ?? 4) +
    Math.min(10, Math.max(0, ((wardCounts?.get?.(report?.ward) || 1) - 1) * 3));
  const waitHours = reportWaitHours(report);
  const waitPts = Math.min(35, Math.round(waitHours * 0.6));
  const priorityScore = Math.min(100, urgencyPts + waitPts);
  return {
    urgencyPts,
    waitPts,
    priorityScore,
    waitHours,
    waitText: formatWaitAge(waitHours),
  };
}
function buildPatrolOrder(
  origin,
  targets,
  maxStops = 8,
  { distances = {}, wardCounts } = {},
) {
  const pool = [...targets];
  const ordered = [];
  let cursor = origin;
  while (pool.length && ordered.length < maxStops) {
    let bestIdx = 0;
    let bestCost = Infinity;
    let bestMeta = null;
    for (let i = 0; i < pool.length; i++) {
      const item = pool[i];
      const rawDist =
        ordered.length === 0 && Number.isFinite(distances[item.id]?.distanceValue)
          ? distances[item.id].distanceValue
          : distanceMeters(cursor, item.pin);
      const meta = patrolPriorityBreakdown(item, wardCounts);
      // Reduce effective travel distance proportionally for urgent and long-waiting stops.
      const weight = 1 + meta.urgencyPts * 0.028 + meta.waitPts * 0.022;
      const cost = Math.max(20, rawDist) / weight;
      if (cost < bestCost) {
        bestCost = cost;
        bestIdx = i;
        bestMeta = meta;
      }
    }
    const [picked] = pool.splice(bestIdx, 1);
    ordered.push({
      ...picked,
      patrolMeta: bestMeta || patrolPriorityBreakdown(picked, wardCounts),
    });
    cursor = picked.pin;
  }
  return ordered;
}
function staffOriginIcon() {
  return L.divIcon({
    className: "staff-origin-marker",
    html: '<span class="staff-origin-dot"><i></i></span>',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -14],
  });
}
function staffStopIcon(status, stopNum, selected) {
  const kind = statuses[status] ? status : "point";
  return L.divIcon({
    className:
      "geo-marker " + kind + (selected ? " is-selected" : ""),
    html:
      '<span class="geo-pin">' +
      (stopNum ? "<b>" + stopNum + "</b>" : "<i></i>") +
      "</span>",
    iconSize: [28, 34],
    iconAnchor: [14, 34],
    popupAnchor: [0, -32],
  });
}
function staffPopupNode(r, metric, onRouteTo) {
  const box = document.createElement("div");
  box.className = "geo-popup staff-map-popup";
  const title = document.createElement("strong");
  title.textContent = r.title;
  const meta = document.createElement("small");
  meta.textContent =
    (statuses[r.status] || r.status) +
    " · " +
    (r.ward ? shortArea(r.ward) : r.location) +
    (metric?.distanceText ? ` · Cách ${metric.distanceText}` : "");
  const actions = document.createElement("div");
  actions.className = "staff-popup-actions";
  const routeBtn = document.createElement("button");
  routeBtn.type = "button";
  routeBtn.className = "btn green small";
  routeBtn.textContent = "Chỉ đường tới đây";
  routeBtn.onclick = () => onRouteTo(r);
  const openLink = document.createElement("a");
  openLink.href =
    "#/report/" +
    encodeURIComponent(r.id) +
    "?from=" +
    encodeURIComponent("/desk?tab=map");
  openLink.textContent = "Mở hồ sơ";
  actions.append(routeBtn, openLink);
  box.append(title, meta, actions);
  return box;
}
function StaffMapLayer({
  map,
  rows,
  origin,
  onOriginChange,
  pickingOrigin,
  onPickDone,
  selectedId,
  route,
  distances,
  onRouteTo,
}) {
  const markersRef = useRef(new Map());
  const onOriginChangeRef = useRef(onOriginChange);
  const onPickDoneRef = useRef(onPickDone);
  const onRouteToRef = useRef(onRouteTo);
  const distancesRef = useRef(distances);
  const didFitOrigin = useRef(false);
  onOriginChangeRef.current = onOriginChange;
  onPickDoneRef.current = onPickDone;
  onRouteToRef.current = onRouteTo;
  distancesRef.current = distances;

  const routeStops = useMemo(() => {
    const mapStops = new Map();
    (route?.stops || []).forEach((s, i) => mapStops.set(s.id, i + 1));
    return mapStops;
  }, [route]);

  function fitAll() {
    const pts = rows.map((r) => [r.pin.lat, r.pin.lng]);
    if (origin) pts.push([origin.lat, origin.lng]);
    const bounds = L.latLngBounds(pts);
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [46, 46], maxZoom: 15, animate: false });
    } else {
      map.setView(hcmCenter, 12, { animate: false });
    }
  }

  useEffect(() => {
    if (!pickingOrigin) return;
    const el = map.getContainer();
    el.classList.add("is-picking-origin");
    const onClick = (e) => {
      onOriginChangeRef.current?.(fixPoint(e.latlng.lat, e.latlng.lng));
      onPickDoneRef.current?.();
    };
    map.on("click", onClick);
    return () => {
      el.classList.remove("is-picking-origin");
      map.off("click", onClick);
    };
  }, [map, pickingOrigin]);

  useEffect(() => {
    if (!origin) return;
    const marker = L.marker([origin.lat, origin.lng], {
      icon: staffOriginIcon(),
      draggable: true,
      title: "Vị trí cán bộ (kéo để chỉnh)",
      zIndexOffset: 900,
    })
      .addTo(map)
      .bindTooltip("Vị trí xuất phát", { direction: "top", offset: [0, -10] });
    marker.on("dragend", () => {
      const pt = marker.getLatLng();
      onOriginChangeRef.current?.(fixPoint(pt.lat, pt.lng));
    });
    if (!didFitOrigin.current && !route?.points?.length) {
      didFitOrigin.current = true;
      fitAll();
    }
    return () => marker.remove();
  }, [map, origin?.lat, origin?.lng]);

  useEffect(() => {
    const layer = L.layerGroup().addTo(map);
    markersRef.current.clear();
    for (const r of rows) {
      const stopNum = routeStops.get(r.id);
      const marker = L.marker([r.pin.lat, r.pin.lng], {
        icon: staffStopIcon(r.status, stopNum, false),
        title: r.title,
      })
        .addTo(layer)
        .bindPopup(
          () =>
            staffPopupNode(r, distancesRef.current[r.id], (target) =>
              onRouteToRef.current?.(target),
            ),
          {
            minWidth: 220,
            maxWidth: 300,
          },
        );
      markersRef.current.set(r.id, { marker, report: r });
    }
    return () => {
      map.closePopup();
      layer.remove();
    };
  }, [map, rows, routeStops]);

  useEffect(() => {
    for (const [id, entry] of markersRef.current.entries()) {
      entry.marker.setIcon(
        staffStopIcon(entry.report.status, routeStops.get(id), selectedId === id),
      );
    }
  }, [selectedId, routeStops]);

  useEffect(() => {
    if (route?.points?.length >= 2) return;
    fitAll();
  }, [map, rows.length]);

  useEffect(() => {
    if (!selectedId) return;
    const entry = markersRef.current.get(selectedId);
    if (entry?.marker) {
      if (!route?.points?.length) {
        map.setView(entry.marker.getLatLng(), Math.max(map.getZoom(), 15), {
          animate: false,
        });
      }
      entry.marker.openPopup();
    }
  }, [map, selectedId, rows, route]);

  useEffect(() => {
    if (!route?.points?.length || route.points.length < 2) return;
    const outline = L.polyline(route.points, {
      color: "#ffffff",
      weight: 8,
      opacity: 0.9,
      lineCap: "round",
      lineJoin: "round",
    }).addTo(map);
    const line = L.polyline(route.points, {
      color: "#176641",
      weight: 5,
      opacity: 0.95,
      lineCap: "round",
      lineJoin: "round",
      dashArray: route.source === "fallback" ? "8 6" : undefined,
    }).addTo(map);
    const bounds = line.getBounds();
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [52, 52], maxZoom: 16, animate: false });
    }
    return () => {
      outline.remove();
      line.remove();
    };
  }, [map, route]);

  return (
    <button
      type="button"
      className="map-fit"
      aria-label="Xem toàn bộ ghim"
      title="Xem toàn bộ ghim"
      onClick={() => {
        map.closePopup();
        fitAll();
      }}
    >
      <Scan size={18} />
    </button>
  );
}

export function StaffFieldMap({
  me,
  reports,
  initialWard = "",
  onClaim,
}) {
  const myAreas = me?.areas || [];
  const [statusFilter, setStatusFilter] = useState("received");
  const [wardFilter, setWardFilter] = useState(() =>
    initialWard && myAreas.includes(initialWard) ? initialWard : "",
  );
  const [vehicle, setVehicle] = useState("bike");
  const [origin, setOrigin] = useState(null);
  const [originLabel, setOriginLabel] = useState("Tâm khu vực phụ trách");
  const [pickingOrigin, setPickingOrigin] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [distances, setDistances] = useState({});
  const [route, setRoute] = useState(null);
  const [routeBusy, setRouteBusy] = useState(false);
  const [claimBusy, setClaimBusy] = useState("");
  const [notice, setNotice] = useState("");
  const routeAbort = useRef(null);

  useEffect(() => {
    if (initialWard && myAreas.includes(initialWard)) {
      setWardFilter(initialWard);
    }
  }, [initialWard]);

  const scopedReports = useMemo(
    () =>
      (reports || []).filter(
        (r) =>
          r.pin &&
          inHcmBounds(Number(r.pin.lat), Number(r.pin.lng)) &&
          !awaitingIntake(r) &&
          !["resolved", "rejected", "cancelled"].includes(r.status),
      ),
    [reports],
  );

  const areaOptions = useMemo(() => {
    const set = new Set(myAreas);
    for (const r of scopedReports) if (r.ward) set.add(r.ward);
    return [...set].sort((a, b) => a.localeCompare(b, "vi"));
  }, [myAreas, scopedReports]);

  const filtered = useMemo(() => {
    return scopedReports.filter((r) => {
      if (statusFilter === "received" && r.status !== "received") return false;
      if (statusFilter === "processing" && r.status !== "processing")
        return false;
      if (wardFilter && r.ward !== wardFilter) return false;
      return true;
    });
  }, [scopedReports, statusFilter, wardFilter]);

  useEffect(() => {
    let live = true;
    if (origin) return;
    loadHcmAreas()
      .then((places) => {
        if (!live) return;
        const firstArea = myAreas[0];
        const hit = firstArea
          ? places.find((p) => p.name === firstArea)
          : null;
        if (hit) {
          setOrigin(fixPoint(hit.lat, hit.lng));
          setOriginLabel(shortArea(hit.name));
        } else if (scopedReports[0]?.pin) {
          setOrigin(
            fixPoint(scopedReports[0].pin.lat, scopedReports[0].pin.lng),
          );
          setOriginLabel("Điểm phản ánh đầu tiên");
        } else {
          setOrigin({ lat: hcmCenter[0], lng: hcmCenter[1] });
          setOriginLabel("Trung tâm TP.HCM");
        }
      })
      .catch(() => {
        if (live) {
          setOrigin({ lat: hcmCenter[0], lng: hcmCenter[1] });
          setOriginLabel("Trung tâm TP.HCM");
        }
      });
    return () => {
      live = false;
    };
  }, [myAreas.join("|"), scopedReports.length]);

  useEffect(() => {
    if (!origin || !filtered.length) {
      setDistances({});
      return;
    }
    const ctrl = new AbortController();
    fetchGoongDistances(origin, filtered, vehicle, ctrl.signal)
      .then((map) => {
        if (!ctrl.signal.aborted) setDistances(map);
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [origin?.lat, origin?.lng, filtered, vehicle]);

  useEffect(() => () => routeAbort.current?.abort(), []);

  const wardCounts = useMemo(() => {
    const counts = new Map();
    for (const r of scopedReports) {
      if (r.ward) counts.set(r.ward, (counts.get(r.ward) || 0) + 1);
    }
    return counts;
  }, [scopedReports]);

  const rows = useMemo(() => {
    const stopOrder = new Map(
      (route?.stops || []).map((stop, index) => [stop.id, index]),
    );
    return [...filtered].sort((a, b) => {
      if (stopOrder.size > 1) {
        const ia = stopOrder.has(a.id) ? stopOrder.get(a.id) : Infinity;
        const ib = stopOrder.has(b.id) ? stopOrder.get(b.id) : Infinity;
        if (ia !== ib) return ia - ib;
      }
      const pa = patrolPriorityBreakdown(a, wardCounts).priorityScore;
      const pb = patrolPriorityBreakdown(b, wardCounts).priorityScore;
      const da = distances[a.id]?.distanceValue ?? Infinity;
      const db = distances[b.id]?.distanceValue ?? Infinity;
      const effA = da / (1 + pa * 0.02);
      const effB = db / (1 + pb * 0.02);
      if (Number.isFinite(effA) && Number.isFinite(effB) && effA !== effB)
        return effA - effB;
      return pb - pa || Date.parse(a.created_at) - Date.parse(b.created_at);
    });
  }, [filtered, distances, wardCounts, route]);

  async function startRoute(stops, modeLabel) {
    if (!origin || !stops.length) return;
    routeAbort.current?.abort();
    const ctrl = new AbortController();
    routeAbort.current = ctrl;
    setRouteBusy(true);
    setNotice("");
    try {
      const res = await fetchGoongDirection(origin, stops, vehicle, ctrl.signal);
      if (ctrl.signal.aborted || !res) return;
      setRoute({ ...res, stops, modeLabel });
      if (stops.length === 1) setSelectedId(stops[0].id);
    } catch (err) {
      if (err?.name !== "AbortError") {
        setNotice("Chưa tải được tuyến đường. Đã giữ đường dẫn ước tính.");
      }
    } finally {
      if (!ctrl.signal.aborted) setRouteBusy(false);
    }
  }

  function locateMe() {
    if (!navigator.geolocation) {
      setNotice("Thiết bị chưa hỗ trợ định vị. Hãy bấm “Chấm vị trí xuất phát” rồi chạm lên bản đồ.");
      return;
    }
    setNotice("");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const pt = fixPoint(coords.latitude, coords.longitude);
        setOrigin(pt);
        setOriginLabel("Vị trí GPS hiện tại");
        setRoute(null);
      },
      () => {
        setNotice(
          "Không lấy được vị trí GPS. Bạn có thể bấm “Chấm vị trí xuất phát” rồi chạm trực tiếp lên bản đồ.",
        );
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );
  }

  function findNearest(urgentOnly = false) {
    const pool = urgentOnly
      ? rows.filter((r) => r.urgent || r.priority === "high")
      : rows;
    if (!pool.length) {
      setNotice(
        urgentOnly
          ? "Không có điểm khẩn cấp nào trong bộ lọc hiện tại."
          : "Không có điểm phản ánh phù hợp để dẫn đường.",
      );
      return;
    }
    let best = pool[0];
    let bestDist = Infinity;
    for (const r of pool) {
      const d =
        distances[r.id]?.distanceValue ??
        (origin ? distanceMeters(origin, r.pin) : Infinity);
      if (d < bestDist) {
        bestDist = d;
        best = r;
      }
    }
    startRoute(
      [best],
      urgentOnly ? "Điểm khẩn cấp gần nhất" : "Điểm gần nhất",
    );
  }

  function startPatrol() {
    if (!origin || !rows.length) {
      setNotice("Chưa có điểm phản ánh để lập lộ trình tuần tra.");
      return;
    }
    const ordered = buildPatrolOrder(origin, rows, 8, {
      distances,
      wardCounts,
    });
    startRoute(
      ordered,
      `Lộ trình tuần tra (${ordered.length} điểm) · Tối ưu khẩn cấp & tồn đọng`,
    );
  }

  async function claimReport(id) {
    if (!onClaim) return;
    setClaimBusy(id);
    try {
      await onClaim(id);
    } finally {
      setClaimBusy("");
    }
  }

  if (!myAreas.length && !scopedReports.length) {
    return (
      <section className="work-panel staff-map-empty">
        <h2>Chưa được phân khu vực phụ trách</h2>
        <p className="empty">
          Quản trị viên chưa gán phường/xã phụ trách cho tài khoản của bạn. Sau
          khi được phân khu vực, các điểm <strong>Đã tiếp nhận</strong> tại
          khu vực đó sẽ hiển thị trên bản đồ này để bạn điều hướng và xử lý.
        </p>
      </section>
    );
  }

  return (
    <div className="staff-map-wrap">
      <div className="work-panel staff-map-toolbar">
        <div className="staff-map-filters">
          <label>
            Trạng thái hiển thị
            <select
              aria-label="Lọc trạng thái bản đồ"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setRoute(null);
              }}
            >
              <option value="received">Đã tiếp nhận</option>
              <option value="processing">Đang xử lý</option>
              <option value="open">Tất cả đang mở</option>
            </select>
          </label>
          <label>
            Khu vực quản lý
            <select
              aria-label="Lọc khu vực trên bản đồ"
              value={wardFilter}
              onChange={(e) => {
                setWardFilter(e.target.value);
                setRoute(null);
              }}
            >
              <option value="">Tất cả khu vực ({areaOptions.length})</option>
              {areaOptions.map((w) => (
                <option key={w} value={w}>
                  {shortArea(w)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Phương tiện
            <select
              aria-label="Phương tiện di chuyển"
              value={vehicle}
              onChange={(e) => {
                setVehicle(e.target.value);
                setRoute(null);
              }}
            >
              <option value="bike">Xe máy</option>
              <option value="car">Ô tô</option>
            </select>
          </label>
        </div>

        <div className="staff-map-actions">
          <button
            type="button"
            className="btn green small"
            disabled={routeBusy || !rows.length}
            onClick={() => findNearest(false)}
          >
            <Compass size={15} aria-hidden="true" />
            Tới điểm gần nhất
          </button>
          <button
            type="button"
            className="btn outline small"
            disabled={routeBusy || !rows.length}
            onClick={() => findNearest(true)}
          >
            <AlertTriangle size={15} aria-hidden="true" />
            Khẩn cấp gần nhất
          </button>
          <button
            type="button"
            className="btn outline small"
            disabled={routeBusy || rows.length < 2}
            onClick={startPatrol}
          >
            <Route size={15} aria-hidden="true" />
            Lộ trình tuần tra
          </button>
          <button
            type="button"
            className="btn outline small"
            onClick={locateMe}
          >
            <LocateFixed size={15} aria-hidden="true" />
            Vị trí GPS
          </button>
          <button
            type="button"
            className={"btn outline small" + (pickingOrigin ? " is-active" : "")}
            aria-pressed={pickingOrigin}
            onClick={() => setPickingOrigin((v) => !v)}
          >
            <Crosshair size={15} aria-hidden="true" />
            {pickingOrigin ? "Chạm bản đồ…" : "Chấm xuất phát"}
          </button>
          {route && (
            <button
              type="button"
              className="btn outline small"
              onClick={() => setRoute(null)}
            >
              <X size={15} aria-hidden="true" />
              Xóa tuyến
            </button>
          )}
        </div>
        <div className="staff-origin-bar">
          <span>
            <MapPin size={14} aria-hidden="true" />
            Xuất phát: <strong>{originLabel}</strong>
            {origin &&
              (originLabel === "Vị trí GPS hiện tại" ||
                originLabel === "Điểm xuất phát đã chọn") &&
              ` (${origin.lat.toFixed(4)}, ${origin.lng.toFixed(4)})`}
          </span>
          {pickingOrigin && (
            <small className="geo-notice">
              Chạm vào bất kỳ điểm nào trên bản đồ để đặt vị trí xuất phát.
            </small>
          )}
          {notice && (
            <small className="geo-notice" role="status">
              {notice}
            </small>
          )}
        </div>
      </div>

      <section className="community-map staff-map">
        <aside className="gis-sidebar">
          <div className="map-summary">
            <h2>Điểm phản ánh ({rows.length})</h2>
            <small>
              {statusFilter === "received"
                ? "Các điểm Đã tiếp nhận trong khu vực quản lý"
                : statusFilter === "processing"
                  ? "Các điểm Đang xử lý"
                  : "Tất cả điểm đang mở"}
            </small>
          </div>
          {!rows.length ? (
            <p className="empty">
              Không có điểm phản ánh nào khớp bộ lọc hiện tại.
            </p>
          ) : (
            <div className="map-report-list">
              {rows.map((r) => {
                const metric = distances[r.id];
                const meta = patrolPriorityBreakdown(r, wardCounts);
                const stopIndex = route?.stops?.findIndex((s) => s.id === r.id);
                const canClaim = r.assignee == null;
                return (
                  <div
                    key={r.id}
                    className={
                      "staff-map-item" +
                      (selectedId === r.id ? " is-selected" : "")
                    }
                  >
                    <button
                      type="button"
                      className="staff-map-select"
                      aria-pressed={selectedId === r.id}
                      onClick={() => setSelectedId(r.id)}
                    >
                      <span className="staff-map-item-top">
                        {stopIndex >= 0 && (
                          <span className="staff-stop-badge">
                            Điểm {stopIndex + 1}
                          </span>
                        )}
                        <Status value={r.status} />
                        {(r.urgent || r.priority === "high") && (
                          <span className="badge urgent">Cần xem sớm</span>
                        )}
                      </span>
                      <b>{r.title}</b>
                      <small>
                        {r.ward ? shortArea(r.ward) : r.location} ·{" "}
                        {groups[r.confirmed_group || r.ai_group] ||
                          "Chờ phân loại"}
                      </small>
                      <small className="staff-priority-tag">
                        Ưu tiên tuần tra {meta.priorityScore}đ · {meta.waitText}
                      </small>
                      {metric && (
                        <small className="staff-distance-tag">
                          Cách {metric.distanceText} · ~{metric.durationText}
                        </small>
                      )}
                    </button>
                    <div className="staff-map-item-actions">
                      <button
                        type="button"
                        className="text-action"
                        disabled={routeBusy}
                        onClick={() => startRoute([r], r.title)}
                      >
                        <Navigation size={13} aria-hidden="true" />
                        Chỉ đường
                      </button>
                      {canClaim && onClaim && (
                        <button
                          type="button"
                          className="text-action"
                          disabled={claimBusy === r.id}
                          onClick={() => claimReport(r.id)}
                        >
                          <UserCheck size={13} aria-hidden="true" />
                          {claimBusy === r.id ? "Đang nhận…" : "Nhận xử lý"}
                        </button>
                      )}
                      <a
                        className="text-action"
                        href={
                          "#/report/" +
                          encodeURIComponent(r.id) +
                          "?from=" +
                          encodeURIComponent("/desk?tab=map")
                        }
                      >
                        Mở hồ sơ
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </aside>

        <div className="community-surface">
          <MapCanvas label="Bản đồ khu vực cán bộ">
            {(map) => (
              <StaffMapLayer
                map={map}
                rows={rows}
                origin={origin}
                onOriginChange={(pt) => {
                  setOrigin(pt);
                  setOriginLabel("Điểm xuất phát đã chọn");
                  setRoute(null);
                }}
                pickingOrigin={pickingOrigin}
                onPickDone={() => setPickingOrigin(false)}
                selectedId={selectedId}
                route={route}
                distances={distances}
                onRouteTo={(r) => startRoute([r], r.title)}
              />
            )}
          </MapCanvas>
          {route && (
            <div className="staff-route-panel" role="region" aria-label="Chỉ dẫn đường đi">
              <div className="staff-route-head">
                <div>
                  <strong>{route.modeLabel}</strong>
                  <small>
                    {route.distanceText} · Dự kiến {route.durationText} ·{" "}
                    {route.source === "goong"
                      ? "Tuyến đường thực tế (Goong Direction)"
                      : "Đường nối thẳng ước tính"}
                  </small>
                </div>
                <div className="staff-route-links">
                  <a
                    className="btn green small"
                    target="_blank"
                    rel="noopener noreferrer"
                    href={googleMapsDirUrl(origin, route.stops, vehicle)}
                  >
                    <ExternalLink size={14} aria-hidden="true" />
                    Mở Google Maps
                  </a>
                  <button
                    type="button"
                    className="btn outline small"
                    onClick={() => setRoute(null)}
                  >
                    Đóng
                  </button>
                </div>
              </div>
              {route.stops.length > 1 && (
                <ol className="staff-route-stops">
                  {route.stops.map((stop, idx) => {
                    const meta =
                      stop.patrolMeta || patrolPriorityBreakdown(stop, wardCounts);
                    return (
                      <li key={stop.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedId(stop.id)}
                        >
                          <span className="staff-route-stop-num">
                            Điểm {idx + 1}
                          </span>
                          <strong>{stop.title}</strong>
                          <small>
                            {meta.priorityScore}đ · {meta.waitText}
                          </small>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              )}
              {route.steps.length > 0 && (
                <ol className="staff-route-steps">
                  {route.steps.map((st, idx) => (
                    <li key={idx}>
                      <span>{st.text}</span>
                      {(st.distance || st.duration) && (
                        <small>
                          {[st.distance, st.duration].filter(Boolean).join(" · ")}
                        </small>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
