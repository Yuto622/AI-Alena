// ============================================================================
// ブラウザ側の天文計算（外部API不要）
// ============================================================================
import { HUBBLE_DATA, HUBBLE_TIME_GYR_CONST } from '../content/missions';

/** 月齢（日）と照らされている割合（0-1）。基準新月 2000-01-06 18:14 UTC、朔望月 29.530588853 日。 */
export function moonPhase(date = new Date()) {
  const synodic = 29.530588853;
  const ref = Date.UTC(2000, 0, 6, 18, 14, 0);
  const days = (date.getTime() - ref) / 86400000;
  const age = ((days % synodic) + synodic) % synodic;
  const illumination = (1 - Math.cos((2 * Math.PI * age) / synodic)) / 2;
  const waxing = age < synodic / 2;
  let nameEn = 'New Moon';
  let nameJa = '新月';
  const f = age / synodic;
  if (f < 0.03 || f > 0.97) [nameEn, nameJa] = ['New Moon', '新月'];
  else if (f < 0.22) [nameEn, nameJa] = ['Waxing Crescent', '三日月（満ちていく）'];
  else if (f < 0.28) [nameEn, nameJa] = ['First Quarter', '上弦の月'];
  else if (f < 0.47) [nameEn, nameJa] = ['Waxing Gibbous', '十三夜（満ちていく）'];
  else if (f < 0.53) [nameEn, nameJa] = ['Full Moon', '満月'];
  else if (f < 0.72) [nameEn, nameJa] = ['Waning Gibbous', '寝待月（欠けていく）'];
  else if (f < 0.78) [nameEn, nameJa] = ['Last Quarter', '下弦の月'];
  else [nameEn, nameJa] = ['Waning Crescent', '二十六夜（欠けていく）'];
  return { age, illumination, waxing, nameEn, nameJa, synodic };
}

/** 最小二乗（原点通過）で H₀ を求める：v = H₀ d */
export function fitHubble(data = HUBBLE_DATA) {
  const num = data.reduce((a, g) => a + g.distanceMpc * g.velocityKms, 0);
  const den = data.reduce((a, g) => a + g.distanceMpc * g.distanceMpc, 0);
  return num / den;
}

/** H₀ [km/s/Mpc] → ハッブル時間 [Gyr]（単純膨張モデル） */
export function hubbleAgeGyr(h0: number) {
  return HUBBLE_TIME_GYR_CONST / h0;
}

/** トランジットの減光率 = (Rp/R*)² */
export function transitDepth(planetRadiusEarth: number, starRadiusSun = 1) {
  const RSUN_IN_REARTH = 109.1;
  const ratio = planetRadiusEarth / (starRadiusSun * RSUN_IN_REARTH);
  return ratio * ratio;
}

export function fmt(n: number, digits = 1) {
  return n.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}
