import React, { useEffect, useState } from 'react';
import { api } from '../../services/api';
import type { ClassroomLocation, SkyReport } from '../../types';
import { Button, Card, Input, Pill, Spinner, Stat } from '../ui';

// ---------------------------------------------------------------------------
// 衛星画像タイル（鍵不要）
//  - NASA GIBS: VIIRS 真色（毎日更新・広域。雲が見える＝「今日の御校の上空」）
//  - EOX Sentinel-2 cloudless: 高解像度の雲なし合成（御校の建物が見える）
// ---------------------------------------------------------------------------
function tileXY(lat: number, lon: number, z: number) {
  const n = 2 ** z;
  const x = ((lon + 180) / 360) * n;
  const latR = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n;
  return { x, y };
}

const yesterdayIso = () => new Date(Date.now() - 36 * 3600 * 1000).toISOString().slice(0, 10);

const TileMosaic: React.FC<{ lat: number; lon: number; z: number; url: (z: number, x: number, y: number) => string; size?: number; label: string; credit: string }> = ({ lat, lon, z, url, size = 256, label, credit }) => {
  const { x, y } = tileXY(lat, lon, z);
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  const fx = x - cx;
  const fy = y - cy;
  // 3x3 タイルを、中心点がコンテナ中央に来るようにずらす
  const view = size * 1.5; // 表示サイズ
  const offsetX = view / 2 - (1 + fx) * size;
  const offsetY = view / 2 - (1 + fy) * size;
  const tiles: React.ReactNode[] = [];
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++)
      tiles.push(
        <img
          key={`${dx},${dy}`}
          src={url(z, cx + dx, cy + dy)}
          alt=""
          loading="lazy"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
          }}
          style={{ position: 'absolute', left: offsetX + (dx + 1) * size, top: offsetY + (dy + 1) * size, width: size, height: size }}
        />,
      );
  return (
    <div className="rounded-xl overflow-hidden border border-white/10 bg-space-950">
      <div className="relative mx-auto" style={{ width: view, height: view, maxWidth: '100%' }}>
        <div className="absolute inset-0 flex items-center justify-center text-[11px] text-slate-600 text-center px-6">衛星画像を読み込み中…（ネット接続が必要です）</div>
        {tiles}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <span className="block w-4 h-4 rounded-full bg-brand-orange border-2 border-white shadow-lg" />
        </div>
        <div className="absolute left-2 top-2 text-[11px] font-display text-white bg-black/50 rounded px-2 py-0.5">{label}</div>
      </div>
      <div className="text-[10px] text-slate-500 px-2 py-1">{credit}</div>
    </div>
  );
};

const fmtJst = (iso: string | null, opts: Intl.DateTimeFormatOptions = { month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' }) =>
  iso ? new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', ...opts }) : '—';

// ---------------------------------------------------------------------------
// 本体：location が与えられればそれを使い、無ければ住所入力を出す
// ---------------------------------------------------------------------------
export const SkyAboveSchool: React.FC<{
  location?: ClassroomLocation | null;
  allowInput?: boolean;
  compact?: boolean;
  onLocated?: (loc: ClassroomLocation) => void;
  onResult?: (text: string) => void;
}> = ({ location, allowInput = true, compact = false, onLocated, onResult }) => {
  const [addr, setAddr] = useState('');
  const [loc, setLoc] = useState<ClassroomLocation | null>(location || null);
  const [sky, setSky] = useState<SkyReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (location) setLoc(location);
  }, [location?.lat, location?.lon]);

  useEffect(() => {
    if (!loc) return;
    let alive = true;
    setBusy(true);
    api
      .sky(loc.lat, loc.lon)
      .then((s) => alive && setSky(s))
      .catch((e) => alive && setErr((e as Error).message))
      .finally(() => alive && setBusy(false));
    return () => {
      alive = false;
    };
  }, [loc?.lat, loc?.lon]);

  const locate = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!addr.trim()) return;
    setErr(null);
    setBusy(true);
    try {
      const g = await api.geo(addr.trim());
      const l = { lat: g.lat, lon: g.lon, label: g.label, address: addr.trim(), source: g.source };
      setLoc(l);
      onLocated?.(l);
    } catch (e2) {
      setErr((e2 as Error).message);
      setBusy(false);
    }
  };

  const nextVisible = sky?.passes.find((p) => p.visibleToEye);
  const next = sky?.passes[0];

  useEffect(() => {
    if (sky && next && onResult) onResult(`Next ISS pass over our school: ${fmtJst(next.maxAt)} JST, max ${next.maxElevation}° (${next.maxDir})`);
  }, [sky?.computedAt]);

  return (
    <Card title="🛰️ Sky above your school — 御校の上空" subtitle={loc ? `${loc.label}（${loc.lat.toFixed(4)}, ${loc.lon.toFixed(4)}）` : '住所を入れるだけで、ISSの通過予報・今の距離・日の出入り・衛星写真が御校基準になります'}>
      {allowInput && (
        <form onSubmit={locate} className="flex gap-2 mb-4">
          <Input value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="例：東京都渋谷区神南1-11-4（市区町村まででもOK）" />
          <Button type="submit" disabled={busy || !addr.trim()}>
            {busy ? <Spinner /> : '上空を調べる'}
          </Button>
        </form>
      )}
      {err && <p className="text-rose-300 text-sm mb-3">{err}</p>}
      {!loc && !busy && <p className="text-slate-400 text-sm">例として「渋谷」「横浜市」「札幌」などでも試せます。</p>}
      {loc && !sky && busy && (
        <div className="flex items-center gap-2 text-slate-300 text-sm">
          <Spinner /> 軌道を計算しています（SGP4・7日分）…
        </div>
      )}

      {loc && sky && (
        <div className="space-y-5">
          {/* 今この瞬間 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="ISS is now 御校から" value={sky.now ? `${sky.now.rangeKm.toLocaleString()} km` : '—'} hint={sky.now ? `光で ${sky.now.lightSeconds} 秒` : undefined} />
            <Stat label="Direction 方角" value={sky.now ? sky.now.direction : '—'} hint={sky.now ? (sky.now.aboveHorizon ? `地平線の上 ${sky.now.elevation}°` : '今は地平線の下') : undefined} />
            <Stat label="Sunrise / Sunset" value={`${fmtJst(sky.sun.sunrise, { hour: '2-digit', minute: '2-digit' })} / ${fmtJst(sky.sun.sunset, { hour: '2-digit', minute: '2-digit' })}`} hint={sky.sun.dayLengthMin ? `昼の長さ ${Math.floor(sky.sun.dayLengthMin / 60)}h${sky.sun.dayLengthMin % 60}m` : undefined} />
            <Stat label="Solar noon 南中" value={fmtJst(sky.sun.solarNoon, { hour: '2-digit', minute: '2-digit' })} hint={`太陽の高さ ${sky.sun.noonElevation}°`} />
          </div>

          {/* 次の通過 */}
          <div className="rounded-2xl border border-brand-orange/40 bg-orange-500/10 p-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="font-display text-white font-bold">
                {nextVisible ? '👀 Next VISIBLE pass — 次に肉眼で見える通過' : '📡 Next pass — 次の通過（昼間 or 影の中）'}
              </div>
              {sky.tle.approximate ? <Pill tone="slate">軌道データ近似（オフライン）</Pill> : <Pill tone="green">TLE: Celestrak</Pill>}
            </div>
            {(nextVisible || next) && (
              <div className="mt-2 text-slate-100">
                {(() => {
                  const p = nextVisible || next!;
                  return (
                    <>
                      <div className="font-display text-2xl md:text-3xl font-bold text-white">{fmtJst(p.maxAt)} <span className="text-base text-slate-300">JST</span></div>
                      <div className="text-sm mt-1">
                        {p.fromDir} から現れ、<b className="text-orange-200">{p.maxDir} の空・高さ {p.maxElevation}°</b> を通って {p.toDir} へ。約 {p.durationMin} 分間。
                        {p.visibleToEye && p.visibleFrom && (
                          <>
                            {' '}
                            肉眼で見えるのは <b className="text-emerald-200">{fmtJst(p.visibleFrom, { hour: '2-digit', minute: '2-digit' })}〜{fmtJst(p.visibleTo, { hour: '2-digit', minute: '2-digit' })}</b>。
                          </>
                        )}
                      </div>
                      <div className="text-xs text-slate-400 mt-1">最接近時の距離 {p.rangeKmAtMax.toLocaleString()} km。手をいっぱいに伸ばした握りこぶしが約10°。</div>
                    </>
                  );
                })()}
              </div>
            )}
          </div>

          {!compact && (
            <>
              <details open className="text-sm">
                <summary className="cursor-pointer text-slate-300">7日間の通過予報（{sky.passes.length}回）</summary>
                <table className="w-full mt-2 text-xs">
                  <thead className="text-slate-500 text-left">
                    <tr>
                      <th className="py-1">Max at (JST)</th>
                      <th>Path</th>
                      <th>Max el.</th>
                      <th>Visible</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sky.passes.map((p) => (
                      <tr key={p.start} className="border-t border-white/5 text-slate-200">
                        <td className="py-1">{fmtJst(p.maxAt)}</td>
                        <td>
                          {p.fromDir.split(' ')[0]} → {p.maxDir.split(' ')[0]} → {p.toDir.split(' ')[0]}
                        </td>
                        <td>{p.maxElevation}°</td>
                        <td>{p.visibleToEye ? <span className="text-emerald-300">👀 yes</span> : <span className="text-slate-500">no</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>

              <div className="grid md:grid-cols-2 gap-4">
                <TileMosaic lat={loc.lat} lon={loc.lon} z={15} label="Sentinel-2 · 御校の上空（雲なし合成）" credit="Sentinel-2 cloudless by EOX IT Services GmbH (CC BY 4.0), contains modified Copernicus Sentinel data" url={(z, x, y) => `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2023_3857/default/g/${z}/${y}/${x}.jpg`} />
                <TileMosaic lat={loc.lat} lon={loc.lon} z={8} label={`VIIRS · ${yesterdayIso()} の雲（NASA）`} credit="NASA Worldview / GIBS, VIIRS SNPP Corrected Reflectance (True Color)" url={(z, x, y) => `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/${yesterdayIso()}/GoogleMapsCompatible_Level9/${z}/${y}/${x}.jpg`} />
              </div>
              <p className="text-xs text-slate-500">衛星写真は NASA / ESA Copernicus の公開タイルを直接表示しています（ネット接続が必要）。</p>
            </>
          )}
        </div>
      )}
    </Card>
  );
};
