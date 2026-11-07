// ============================================================================
// 「御校の上空」計算：住所→緯度経度、ISS通過予報（SGP4）、今のISSまでの距離、日の出・日の入り
// 外部: 国土地理院ジオコーダ（鍵不要）/ Nominatim / Celestrak TLE。全部オフライン時も動く。
// ============================================================================
import * as satellite from 'satellite.js';

const ISS_CATNR = 25544;
const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------
// TLE（Celestrak、6時間キャッシュ。失敗時は内蔵TLE＝軌道形状は正しいが時刻は近似）
// ---------------------------------------------------------------------------
const FALLBACK_TLE = {
  line1: '1 25544U 98067A   24001.50000000  .00016717  00000+0  10270-3 0  9003',
  line2: '2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.49000000432006',
  source: 'builtin-fallback',
};
let tleCache = { at: 0, tle: null };

export async function getIssTle() {
  if (tleCache.tle && Date.now() - tleCache.at < 6 * 3600 * 1000) return tleCache.tle;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch(`https://celestrak.org/NORAD/elements/gp.php?CATNR=${ISS_CATNR}&FORMAT=TLE`, { signal: ctrl.signal });
    clearTimeout(t);
    const txt = await r.text();
    const lines = txt.trim().split(/\r?\n/).map((s) => s.trim());
    const l1 = lines.find((l) => l.startsWith('1 '));
    const l2 = lines.find((l) => l.startsWith('2 '));
    if (!l1 || !l2) throw new Error('bad TLE');
    tleCache = { at: Date.now(), tle: { line1: l1, line2: l2, source: 'celestrak' } };
    return tleCache.tle;
  } catch (err) {
    return FALLBACK_TLE;
  }
}

// ---------------------------------------------------------------------------
// 太陽の位置（低精度・Meeus）。ECI 単位ベクトル。
// ---------------------------------------------------------------------------
function sunEci(date) {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const n = jd - 2451545.0;
  const L = ((280.46 + 0.9856474 * n) % 360) * DEG;
  const g = ((357.528 + 0.9856003 * n) % 360) * DEG;
  const lambda = L + (1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG;
  const eps = (23.439 - 0.0000004 * n) * DEG;
  return { x: Math.cos(lambda), y: Math.sin(lambda) * Math.cos(eps), z: Math.sin(lambda) * Math.sin(eps) };
}

function sunElevation(observerGd, date) {
  const s = sunEci(date);
  const AU = 149597870.7;
  const gmst = satellite.gstime(date);
  const ecf = satellite.eciToEcf({ x: s.x * AU, y: s.y * AU, z: s.z * AU }, gmst);
  return satellite.ecfToLookAngles(observerGd, ecf).elevation / DEG;
}

/** 衛星が太陽に照らされているか（円筒影の近似） */
function satSunlit(posEci, date) {
  const s = sunEci(date);
  const dot = posEci.x * s.x + posEci.y * s.y + posEci.z * s.z; // 太陽方向成分
  if (dot > 0) return true; // 太陽側
  const r2 = posEci.x ** 2 + posEci.y ** 2 + posEci.z ** 2;
  const perp = Math.sqrt(r2 - dot * dot);
  return perp > 6371;
}

// ---------------------------------------------------------------------------
// ISS 通過予報
// ---------------------------------------------------------------------------
function dir8(az) {
  const names = ['N 北', 'NE 北東', 'E 東', 'SE 南東', 'S 南', 'SW 南西', 'W 西', 'NW 北西'];
  return names[Math.round(((az % 360) + 360) % 360 / 45) % 8];
}

export async function issPasses({ lat, lon, days = 7, minElevation = 10, limit = 6, from = new Date() }) {
  const tle = await getIssTle();
  const satrec = satellite.twoline2satrec(tle.line1, tle.line2);
  const observerGd = { longitude: lon * DEG, latitude: lat * DEG, height: 0.03 };
  const stepMs = 20 * 1000;
  const endMs = from.getTime() + days * 86400000;
  const passes = [];
  let cur = null;
  for (let t = from.getTime(); t < endMs && passes.length < limit; t += stepMs) {
    const date = new Date(t);
    const pv = satellite.propagate(satrec, date);
    if (!pv.position || typeof pv.position === 'boolean') break;
    const gmst = satellite.gstime(date);
    const ecf = satellite.eciToEcf(pv.position, gmst);
    const look = satellite.ecfToLookAngles(observerGd, ecf);
    const el = look.elevation / DEG;
    if (el > 0) {
      const az = look.azimuth / DEG;
      const sunEl = sunElevation(observerGd, date);
      const lit = satSunlit(pv.position, date);
      const visibleNow = lit && sunEl < -6 && el >= minElevation;
      if (!cur) cur = { start: date, startAz: az, maxEl: el, maxAt: date, maxAz: az, end: date, endAz: az, visibleStart: null, visibleEnd: null, rangeAtMax: look.rangeSat };
      cur.end = date;
      cur.endAz = az;
      if (el > cur.maxEl) {
        cur.maxEl = el;
        cur.maxAt = date;
        cur.maxAz = az;
        cur.rangeAtMax = look.rangeSat;
      }
      if (visibleNow) {
        if (!cur.visibleStart) cur.visibleStart = date;
        cur.visibleEnd = date;
      }
    } else if (cur) {
      if (cur.maxEl >= minElevation) {
        passes.push({
          start: cur.start.toISOString(),
          end: cur.end.toISOString(),
          durationMin: Math.round((cur.end - cur.start) / 60000),
          maxElevation: Math.round(cur.maxEl),
          maxAt: cur.maxAt.toISOString(),
          fromDir: dir8(cur.startAz),
          maxDir: dir8(cur.maxAz),
          toDir: dir8(cur.endAz),
          rangeKmAtMax: Math.round(cur.rangeAtMax),
          visibleToEye: Boolean(cur.visibleStart),
          visibleFrom: cur.visibleStart ? cur.visibleStart.toISOString() : null,
          visibleTo: cur.visibleEnd ? cur.visibleEnd.toISOString() : null,
        });
      }
      cur = null;
    }
  }
  return { passes, tle: { source: tle.source, epochLine: tle.line1.slice(18, 32).trim(), approximate: tle.source !== 'celestrak' } };
}

/** 今この瞬間の ISS と観測地点の関係 */
export async function issNow({ lat, lon, date = new Date() }) {
  const tle = await getIssTle();
  const satrec = satellite.twoline2satrec(tle.line1, tle.line2);
  const observerGd = { longitude: lon * DEG, latitude: lat * DEG, height: 0.03 };
  const pv = satellite.propagate(satrec, date);
  if (!pv.position || typeof pv.position === 'boolean') return null;
  const gmst = satellite.gstime(date);
  const ecf = satellite.eciToEcf(pv.position, gmst);
  const look = satellite.ecfToLookAngles(observerGd, ecf);
  const geo = satellite.eciToGeodetic(pv.position, gmst);
  return {
    rangeKm: Math.round(look.rangeSat),
    azimuth: Math.round(look.azimuth / DEG),
    elevation: Math.round(look.elevation / DEG),
    direction: dir8(look.azimuth / DEG),
    aboveHorizon: look.elevation > 0,
    subLat: geo.latitude / DEG,
    subLon: geo.longitude / DEG,
    altitudeKm: Math.round(geo.height),
    lightSeconds: +(look.rangeSat / 299792.458).toFixed(4),
    approximate: tle.source !== 'celestrak',
  };
}

// ---------------------------------------------------------------------------
// 日の出・日の入り・南中（太陽高度のスキャン）。date はその地点の「今日」。
// ---------------------------------------------------------------------------
export function sunTimes({ lat, lon, date = new Date(), tzOffsetMin = 540 }) {
  const observerGd = { longitude: lon * DEG, latitude: lat * DEG, height: 0.03 };
  // 現地の 0:00 を UTC に
  const local = new Date(date.getTime() + tzOffsetMin * 60000);
  const dayStartUtc = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - tzOffsetMin * 60000;
  let prev = null;
  let sunrise = null;
  let sunset = null;
  let noonAt = null;
  let noonEl = -90;
  for (let m = 0; m <= 1440; m++) {
    const d = new Date(dayStartUtc + m * 60000);
    const el = sunElevation(observerGd, d);
    if (prev !== null) {
      if (prev < -0.833 && el >= -0.833 && !sunrise) sunrise = d;
      if (prev >= -0.833 && el < -0.833) sunset = d;
    }
    if (el > noonEl) {
      noonEl = el;
      noonAt = d;
    }
    prev = el;
  }
  return {
    sunrise: sunrise?.toISOString() || null,
    sunset: sunset?.toISOString() || null,
    solarNoon: noonAt?.toISOString() || null,
    noonElevation: Math.round(noonEl * 10) / 10,
    dayLengthMin: sunrise && sunset ? Math.round((sunset - sunrise) / 60000) : null,
  };
}

// ---------------------------------------------------------------------------
// ジオコーディング
// ---------------------------------------------------------------------------
const OFFLINE_PLACES = [
  ['渋谷', 35.6619, 139.7041, '東京都渋谷区'],
  ['新宿', 35.6938, 139.7034, '東京都新宿区'],
  ['神楽坂', 35.7021, 139.7367, '東京都新宿区神楽坂'],
  ['港区', 35.6581, 139.7514, '東京都港区'],
  ['世田谷', 35.6464, 139.6532, '東京都世田谷区'],
  ['横浜', 35.4437, 139.638, '神奈川県横浜市'],
  ['川崎', 35.5308, 139.7029, '神奈川県川崎市'],
  ['千葉', 35.6074, 140.1065, '千葉県千葉市'],
  ['さいたま', 35.8617, 139.6455, '埼玉県さいたま市'],
  ['札幌', 43.0618, 141.3545, '北海道札幌市'],
  ['仙台', 38.2682, 140.8694, '宮城県仙台市'],
  ['名古屋', 35.1815, 136.9066, '愛知県名古屋市'],
  ['京都', 35.0116, 135.7681, '京都府京都市'],
  ['大阪', 34.6937, 135.5023, '大阪府大阪市'],
  ['神戸', 34.6901, 135.1955, '兵庫県神戸市'],
  ['広島', 34.3853, 132.4553, '広島県広島市'],
  ['福岡', 33.5904, 130.4017, '福岡県福岡市'],
  ['那覇', 26.2124, 127.6809, '沖縄県那覇市'],
  ['東京', 35.6762, 139.6503, '東京都'],
];

export async function geocode(q) {
  const query = String(q || '').trim();
  if (!query) throw new Error('住所を入力してください');
  // 1) 国土地理院
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch(`https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(query)}`, { signal: ctrl.signal });
    clearTimeout(t);
    const j = await r.json();
    if (Array.isArray(j) && j.length) {
      const [lon, lat] = j[0].geometry.coordinates;
      return { lat, lon, label: j[0].properties?.title || query, source: 'gsi' };
    }
  } catch {
    /* fallthrough */
  }
  // 2) Nominatim
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'U-Space/0.1 (education; contact via website)' },
    });
    clearTimeout(t);
    const j = await r.json();
    if (Array.isArray(j) && j.length) return { lat: +j[0].lat, lon: +j[0].lon, label: j[0].display_name, source: 'nominatim' };
  } catch {
    /* fallthrough */
  }
  // 3) オフライン表
  const hit = OFFLINE_PLACES.find(([k]) => query.includes(k));
  if (hit) return { lat: hit[1], lon: hit[2], label: `${hit[3]}（概略位置・オフライン）`, source: 'offline' };
  throw new Error('住所を特定できませんでした。市区町村名まで入れてお試しください。');
}
