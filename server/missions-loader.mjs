// content/missions.ts は TypeScript なので、Node から読むために
// 型注釈を剥がして評価する最小ローダー（ビルド工程を増やさないための工夫）。
// Node 22.6+ の --experimental-strip-types でも読めるが、互換性のためここで処理する。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function loadMissions() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'content', 'missions.ts'), 'utf8');
  const js = src
    .replace(/^import type .*$/m, '')
    .replace(/export const MISSIONS: Mission\[\] =/, 'export const MISSIONS =')
    .replace(/export const HUBBLE_DATA: \{[^}]*\}\[\] =/, 'export const HUBBLE_DATA =')
    .replace(/export const getMission = \(id: string\) =>/, 'export const getMission = (id) =>');
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(js).toString('base64');
  const mod = await import(dataUrl);
  return mod.MISSIONS;
}
