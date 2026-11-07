import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { api } from '../../services/api';
import type { ClassroomLocation, IssPosition } from '../../types';
import { Button, Card, Input, Pill, Spinner } from '../ui';

// ============================================================================
// School → Space メタバース
// 住所（緯度経度）から、衛星写真（Sentinel-2）＋標高（Terrarium）で教室の街を自動生成し、
// 打ち上げ → 地球（NASA Blue Marble）→ 本物の位置にいる ISS まで飛ぶ。単位は km。
// 外部タイルが取れない時は手続き的な地形・地球で動く（デモが止まらない）。
// ============================================================================

const R_EARTH = 6371;
const TERRAIN_Z = 13;
const TERRAIN_TILES = 3; // 3x3
const ISS_INC = 51.6;
const DEG = Math.PI / 180;

function tileXY(lat: number, lon: number, z: number) {
  const n = 2 ** z;
  const latR = lat * DEG;
  return { x: ((lon + 180) / 360) * n, y: ((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n, n };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`image failed: ${url}`));
    img.src = url;
  });
}

/** 3x3 タイルを 1 枚のキャンバスに。1枚でも失敗したら null（→フォールバック） */
async function stitchTiles(urlFor: (x: number, y: number) => string, cx: number, cy: number, size = 256): Promise<HTMLCanvasElement | null> {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size * TERRAIN_TILES;
  const ctx = canvas.getContext('2d')!;
  try {
    const jobs: Promise<void>[] = [];
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        jobs.push(loadImage(urlFor(cx + dx, cy + dy)).then((img) => ctx.drawImage(img, (dx + 1) * size, (dy + 1) * size, size, size)));
    await Promise.all(jobs);
    // CORS で汚染されていないか確認（toDataURL が投げる）
    ctx.getImageData(0, 0, 1, 1);
    return canvas;
  } catch {
    return null;
  }
}

/** 手続き的な地形テクスチャ（オフライン用） */
function proceduralGround(size: number, seed: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, '#2f4a2a');
  g.addColorStop(1, '#4a5a33');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  let s = seed;
  const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
  for (let i = 0; i < 1800; i++) {
    ctx.fillStyle = rnd() > 0.5 ? 'rgba(160,160,170,.55)' : 'rgba(70,90,60,.5)';
    ctx.fillRect(rnd() * size, rnd() * size, 2 + rnd() * 10, 2 + rnd() * 10);
  }
  ctx.strokeStyle = 'rgba(200,200,210,.5)';
  ctx.lineWidth = 3;
  for (let i = 0; i < 12; i++) {
    ctx.beginPath();
    ctx.moveTo(rnd() * size, 0);
    ctx.lineTo(rnd() * size, size);
    ctx.stroke();
  }
  return c;
}

function proceduralEarth(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 512;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#1b4f8a';
  ctx.fillRect(0, 0, 1024, 512);
  let s = 7;
  const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
  ctx.fillStyle = '#3f6b3a';
  for (let i = 0; i < 40; i++) {
    ctx.beginPath();
    ctx.ellipse(rnd() * 1024, 80 + rnd() * 350, 40 + rnd() * 120, 30 + rnd() * 80, rnd() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#e8eef5';
  ctx.fillRect(0, 0, 1024, 28);
  ctx.fillRect(0, 484, 1024, 28);
  return c;
}

/** 緯度経度 → 地球表面の3D点（three.js SphereGeometry の UV と整合） */
function latLonToVec(lat: number, lon: number, r = R_EARTH) {
  const φ = lat * DEG;
  const λ = lon * DEG;
  return new THREE.Vector3(r * Math.cos(φ) * Math.cos(λ), r * Math.sin(φ), -r * Math.cos(φ) * Math.sin(λ));
}

type Phase = 'ground' | 'ascend' | 'orbit' | 'transfer' | 'arrived';

export const SchoolToSpace: React.FC<{ location?: ClassroomLocation | null; allowInput?: boolean; onResult?: (text: string) => void }> = ({ location, allowInput = false, onResult }) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const [loc, setLoc] = useState<ClassroomLocation | null>(location || null);
  const [addr, setAddr] = useState('');
  const [geoBusy, setGeoBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('loading');
  const [altitude, setAltitude] = useState(0);
  const [distToIss, setDistToIss] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>('ground');
  const [callout, setCallout] = useState('Welcome to your town. Drag to look around. Press LAUNCH.');
  const [sources, setSources] = useState<{ ground: string; earth: string }>({ ground: '…', earth: '…' });
  const phaseRef = useRef<Phase>('ground');
  const exportRef = useRef<{ height: HTMLCanvasElement | null; color: HTMLCanvasElement | null }>({ height: null, color: null });
  const launchRef = useRef<() => void>(() => {});
  const resetRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (location) setLoc(location);
  }, [location?.lat, location?.lon]);

  const locate = async (e: React.FormEvent) => {
    e.preventDefault();
    setGeoBusy(true);
    setErr(null);
    try {
      const g = await api.geo(addr.trim());
      setLoc({ lat: g.lat, lon: g.lon, label: g.label, address: addr.trim(), source: g.source });
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setGeoBusy(false);
    }
  };

  // ------------------------------------------------------------------ scene
  useEffect(() => {
    if (!loc || !mountRef.current) return;
    const mount = mountRef.current;
    let disposed = false;
    const W = mount.clientWidth;
    const H = Math.max(360, Math.min(560, Math.round(W * 0.56)));

    const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.setSize(W, H);
    renderer.setClearColor(0x070a1a);
    mount.innerHTML = '';
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(55, W / H, 0.02, 400000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;

    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(1, 0.6, 0.4).multiplyScalar(100000);
    scene.add(sun);

    // stars
    {
      const n = 2500;
      const pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const v = new THREE.Vector3().randomDirection().multiplyScalar(150000);
        pos.set([v.x, v.y, v.z], i * 3);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 260, sizeAttenuation: true })));
    }

    // ---------------------------------------------------------------- local
    const local = new THREE.Group();
    scene.add(local);
    const tileKm = (40075 * Math.cos(loc.lat * DEG)) / 2 ** TERRAIN_Z;
    const sizeKm = tileKm * TERRAIN_TILES;
    const { x: tx, y: ty } = tileXY(loc.lat, loc.lon, TERRAIN_Z);
    const cx = Math.floor(tx);
    const cy = Math.floor(ty);
    // 教室はタイル中心からずれている → 地形をずらして教室を原点に
    const offX = (tx - cx - 0.5) * tileKm;
    const offZ = (ty - cy - 0.5) * tileKm;

    const seg = 96;
    const terrainGeo = new THREE.PlaneGeometry(sizeKm, sizeKm, seg, seg);
    terrainGeo.rotateX(-Math.PI / 2);
    const terrainMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
    const terrain = new THREE.Mesh(terrainGeo, terrainMat);
    terrain.position.set(-offX, 0, -offZ);
    local.add(terrain);

    // 広域プレーン（z=8、約450km四方）：詳細パッチの外側に地域の衛星写真を敷き、上昇中に「自分の地方」が見える
    const REGION_Z = 8;
    const regionTileKm = (40075 * Math.cos(loc.lat * DEG)) / 2 ** REGION_Z;
    const regionSizeKm = regionTileKm * TERRAIN_TILES;
    const rt = tileXY(loc.lat, loc.lon, REGION_Z);
    const rcx = Math.floor(rt.x);
    const rcy = Math.floor(rt.y);
    const regionMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
    const region = new THREE.Mesh(new THREE.PlaneGeometry(regionSizeKm, regionSizeKm, 1, 1), regionMat);
    region.rotateX(-Math.PI / 2);
    region.position.set(-(rt.x - rcx - 0.5) * regionTileKm, -0.02, -(rt.y - rcy - 0.5) * regionTileKm);
    local.add(region);

    // school marker（原点）
    const marker = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.3, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    pole.position.y = 0.15;
    const flag = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 16), new THREE.MeshBasicMaterial({ color: 0xe27a2d }));
    flag.position.y = 0.32;
    marker.add(pole, flag);
    local.add(marker);

    // ---------------------------------------------------------------- globe
    const globe = new THREE.Group();
    globe.visible = false;
    scene.add(globe);
    const earthMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
    const earth = new THREE.Mesh(new THREE.SphereGeometry(R_EARTH, 96, 64), earthMat);
    globe.add(earth);
    const atmo = new THREE.Mesh(new THREE.SphereGeometry(R_EARTH + 60, 64, 48), new THREE.MeshBasicMaterial({ color: 0x5aa0ff, transparent: true, opacity: 0.12, side: THREE.BackSide }));
    globe.add(atmo);
    const schoolVec = latLonToVec(loc.lat, loc.lon);
    const schoolNormal = schoolVec.clone().normalize();
    const schoolDot = new THREE.Mesh(new THREE.SphereGeometry(25, 12, 12), new THREE.MeshBasicMaterial({ color: 0xe27a2d }));
    schoolDot.position.copy(schoolVec);
    globe.add(schoolDot);

    // ISS
    const iss = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(14, 10, 40), new THREE.MeshStandardMaterial({ color: 0xdddddd }));
    const panelMat = new THREE.MeshStandardMaterial({ color: 0x2244aa, emissive: 0x112266 });
    const p1 = new THREE.Mesh(new THREE.BoxGeometry(70, 1, 14), panelMat);
    const p2 = p1.clone();
    p1.position.x = 42;
    p2.position.x = -42;
    iss.add(body, p1, p2);
    iss.visible = false;
    globe.add(iss);
    const orbitLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xe27a2d, transparent: true, opacity: 0.7 }));
    globe.add(orbitLine);

    let issPos: THREE.Vector3 | null = null;
    let issNormal: THREE.Vector3 | null = null;
    let prevSub: THREE.Vector3 | null = null;
    const applyIss = (p: IssPosition) => {
      const alt = p.altitude || 417;
      const sub = latLonToVec(p.latitude, p.longitude, 1);
      issNormal = sub.clone();
      issPos = sub.clone().multiplyScalar(R_EARTH + alt);
      iss.position.copy(issPos);
      iss.lookAt(0, 0, 0);
      iss.visible = true;
      // 軌道リング：傾斜角 51.6° で sub を通る大円
      const y = new THREE.Vector3(0, 1, 0);
      const u1 = y.clone().sub(sub.clone().multiplyScalar(y.dot(sub))).normalize();
      const u2 = new THREE.Vector3().crossVectors(sub, y).normalize();
      const cosLat = Math.cos(p.latitude * DEG);
      const cosTheta = Math.min(1, Math.cos(ISS_INC * DEG) / Math.max(cosLat, 1e-6));
      const theta = Math.acos(cosTheta);
      const cands = [theta, -theta].map((t) => u1.clone().multiplyScalar(Math.cos(t)).add(u2.clone().multiplyScalar(Math.sin(t))).normalize());
      let n = cands[0];
      if (prevSub) {
        const v = sub.clone().sub(prevSub);
        n = cands.find((c) => new THREE.Vector3().crossVectors(c, sub).dot(v) > 0) || cands[0];
      }
      prevSub = sub.clone();
      const pts: THREE.Vector3[] = [];
      const t2 = new THREE.Vector3().crossVectors(n, sub).normalize();
      for (let i = 0; i <= 180; i++) {
        const a = (i / 180) * Math.PI * 2;
        pts.push(sub.clone().multiplyScalar(Math.cos(a)).add(t2.clone().multiplyScalar(Math.sin(a))).multiplyScalar(R_EARTH + alt));
      }
      orbitLine.geometry.dispose();
      orbitLine.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    };
    const pollIss = () => api.iss().then((p) => !disposed && applyIss(p)).catch(() => {});
    pollIss();
    const issTimer = setInterval(pollIss, 5000);

    // ---------------------------------------------------------------- textures (async)
    (async () => {
      const [ground, height, regionTex] = await Promise.all([
        stitchTiles((x, y) => `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2023_3857/default/g/${TERRAIN_Z}/${y}/${x}.jpg`, cx, cy),
        stitchTiles((x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${TERRAIN_Z}/${x}/${y}.png`, cx, cy),
        stitchTiles((x, y) => `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2023_3857/default/g/${REGION_Z}/${y}/${x}.jpg`, rcx, rcy),
      ]);
      if (disposed) return;
      const gCanvas = ground || proceduralGround(768, Math.round(loc.lat * 1000));
      terrainMat.map = new THREE.CanvasTexture(gCanvas);
      terrainMat.map.colorSpace = THREE.SRGBColorSpace;
      terrainMat.needsUpdate = true;
      exportRef.current.color = gCanvas;
      const rCanvas = regionTex || proceduralGround(768, Math.round(loc.lon * 1000));
      regionMat.map = new THREE.CanvasTexture(rCanvas);
      regionMat.map.colorSpace = THREE.SRGBColorSpace;
      regionMat.needsUpdate = true;
      // 標高で頂点を押し上げる
      const pos = terrainGeo.attributes.position as THREE.BufferAttribute;
      const hCanvas = height;
      let hCtx: CanvasRenderingContext2D | null = null;
      let hData: ImageData | null = null;
      if (hCanvas) {
        hCtx = hCanvas.getContext('2d');
        hData = hCtx!.getImageData(0, 0, hCanvas.width, hCanvas.height);
      }
      const exaggeration = 1.6;
      let seed = 3;
      const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        const u = (x + sizeKm / 2) / sizeKm;
        const v = (z + sizeKm / 2) / sizeKm;
        let hKm = 0;
        if (hData) {
          const px = Math.min(hData.width - 1, Math.max(0, Math.floor(u * hData.width)));
          const py = Math.min(hData.height - 1, Math.max(0, Math.floor(v * hData.height)));
          const k = (py * hData.width + px) * 4;
          const m = hData.data[k] * 256 + hData.data[k + 1] + hData.data[k + 2] / 256 - 32768;
          hKm = Math.max(0, m) / 1000;
        } else {
          hKm = (Math.sin(u * 9 + 1) * Math.cos(v * 7) * 0.08 + rnd() * 0.01 + 0.08) * 0.6;
        }
        pos.setY(i, hKm * exaggeration);
      }
      pos.needsUpdate = true;
      terrainGeo.computeVertexNormals();
      exportRef.current.height = hCanvas;
      setSources({ ground: ground ? 'Sentinel-2 (EOX)' : '手続き生成（オフライン）', earth: '…' });

      // 地球：NASA Blue Marble（GIBS EPSG:4326）。レベル2（8×4タイル＝4096×2048）→失敗ならレベル0→手続き生成
      const ec = document.createElement('canvas');
      const ectx = ec.getContext('2d')!;
      let earthOk = false;
      const gibs = (lvl: number, row: number, col: number) => `https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/BlueMarble_ShadedRelief_Bathymetry/default/2004-08/250m/${lvl}/${row}/${col}.jpg`;
      for (const [lvl, cols, rows] of [
        [2, 8, 4],
        [0, 2, 1],
      ] as const) {
        try {
          ec.width = cols * 512;
          ec.height = rows * 512;
          const jobs: Promise<void>[] = [];
          for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) jobs.push(loadImage(gibs(lvl, r, c)).then((img) => ectx.drawImage(img, c * 512, r * 512, 512, 512)));
          await Promise.all(jobs);
          ectx.getImageData(0, 0, 1, 1);
          earthOk = true;
          break;
        } catch {
          /* 次の候補へ */
        }
      }
      if (disposed) return;
      earthMat.map = new THREE.CanvasTexture(earthOk ? ec : proceduralEarth());
      earthMat.map.colorSpace = THREE.SRGBColorSpace;
      earthMat.needsUpdate = true;
      setSources((s) => ({ ...s, earth: earthOk ? 'NASA Blue Marble (GIBS)' : '手続き生成（オフライン）' }));
      setStatus('ready');
    })();

    // ---------------------------------------------------------------- flight
    let alt = 0.0015; // km（地上 1.5 m）
    let phaseL: Phase = 'ground';
    let transferT = 0;
    let lastCallout = -1;
    const setPhaseBoth = (p: Phase) => {
      phaseL = p;
      phaseRef.current = p;
      setPhase(p);
    };
    const placeGround = () => {
      camera.position.set(1.1, 0.7, 1.6);
      controls.target.set(0, 0.08, 0);
      controls.minDistance = 0.1;
      controls.maxDistance = 60;
      controls.maxPolarAngle = Math.PI * 0.48;
      controls.update();
    };
    // 東方向（地平線を見るための視線の傾きに使う）
    const eastDir = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), schoolNormal).normalize();
    const SWITCH_ALT = 150; // km：ここで平面の街 → 球体の地球に切り替え
    placeGround();

    launchRef.current = () => {
      if (phaseL !== 'ground') return;
      setPhaseBoth('ascend');
      controls.enabled = false;
      setCallout('3… 2… 1… LIFTOFF! 🚀');
    };
    resetRef.current = () => {
      alt = 0.0015;
      transferT = 0;
      lastCallout = -1;
      globe.visible = false;
      local.visible = true;
      setPhaseBoth('ground');
      setDistToIss(null);
      controls.enabled = true;
      camera.up.set(0, 1, 0);
      placeGround();
      setCallout('Back at school. Drag to look around. Press LAUNCH.');
    };

    const CALLOUTS: [number, string][] = [
      [0.4, 'Above the rooftops. Can you find your school?'],
      [10, '10 km — airplanes fly here. The air is thin and very cold.'],
      [50, '50 km — the sky turns black. The sunset is below you.'],
      [100, '100 km — the Kármán line. You are in SPACE!'],
      [400, '400 km — ISS altitude. Now fly to the station!'],
    ];

    const tmp = new THREE.Vector3();
    let last = performance.now();
    const loop = (now: number) => {
      if (disposed) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      if (phaseL === 'ascend') {
        // 指数的に加速（地上付近はゆっくり、宇宙では速く）
        alt += Math.max(0.002, alt * 0.9) * dt * 2.2;
        if (alt < SWITCH_ALT) {
          // 斜め後方から見下ろし、上がるほど前方（北）に視線を傾けて地平線を出す
          camera.position.set(0.9 + alt * 0.05, alt, 1.4 + alt * 0.45);
          camera.lookAt(0, 0, -alt * 0.9);
        } else {
          if (!globe.visible) {
            globe.visible = true;
            local.visible = false;
          }
          tmp.copy(schoolNormal).multiplyScalar(R_EARTH + alt);
          camera.position.copy(tmp);
          camera.up.copy(schoolNormal);
          // 真下でなく、前方の地平線方向を見る
          const look = schoolVec.clone().add(eastDir.clone().multiplyScalar(alt * 3));
          camera.lookAt(look);
          if (alt >= 400) {
            alt = 400;
            setPhaseBoth(issPos ? 'transfer' : 'orbit');
            if (!issPos) {
              controls.enabled = true;
              controls.target.set(0, 0, 0);
              controls.minDistance = R_EARTH + 300;
              controls.maxDistance = R_EARTH * 6;
              setCallout('400 km up. The ISS position is not available right now — drag to look at the Earth.');
            }
          }
        }
        for (const [h, text] of CALLOUTS) {
          if (alt >= h && lastCallout < h) {
            lastCallout = h;
            setCallout(text);
          }
        }
        setAltitude(alt);
      } else if (phaseL === 'transfer' && issPos && issNormal) {
        transferT = Math.min(1, transferT + dt * 0.12);
        const ease = transferT < 0.5 ? 2 * transferT * transferT : 1 - Math.pow(-2 * transferT + 2, 2) / 2;
        // 球面補間で学校上空 → ISS へ
        const q = new THREE.Quaternion().setFromUnitVectors(schoolNormal, issNormal);
        const qs = new THREE.Quaternion().slerp(q, ease);
        const n = schoolNormal.clone().applyQuaternion(qs);
        const camAlt = 400 + 60 * Math.sin(ease * Math.PI);
        camera.position.copy(n).multiplyScalar(R_EARTH + camAlt);
        camera.up.copy(n);
        // 序盤は進行方向の地平線、終盤は ISS を見る
        const ahead = n.clone().multiplyScalar(R_EARTH).add(new THREE.Vector3().crossVectors(n, new THREE.Vector3().crossVectors(issNormal, n)).normalize().multiplyScalar(-2000));
        const look = new THREE.Vector3().lerpVectors(ahead, issPos, Math.pow(ease, 2));
        camera.lookAt(look);
        setDistToIss(Math.round(camera.position.distanceTo(issPos)));
        setAltitude(camAlt);
        if (transferT >= 1) {
          setPhaseBoth('arrived');
          controls.enabled = true;
          controls.target.copy(issPos);
          controls.minDistance = 60;
          controls.maxDistance = 4000;
          controls.maxPolarAngle = Math.PI;
          camera.up.copy(issNormal);
          // ISS の少し外側・上から、地球を背景に見る
          camera.position.copy(issPos).add(issNormal.clone().multiplyScalar(90)).add(new THREE.Vector3().crossVectors(issNormal, new THREE.Vector3(0, 1, 0)).normalize().multiplyScalar(160));
          controls.update();
          const km = Math.round(schoolVec.distanceTo(issPos));
          setCallout(`You reached the ISS! It moves at 7.66 km every second. Look back — your school is ${km.toLocaleString()} km away.`);
          onResult?.(`Flew from ${loc.label} to the ISS: ${km.toLocaleString()} km (straight-line)`);
        }
      }

      if (controls.enabled) controls.update();
      if (phaseL === 'arrived' && issPos) {
        // ISS を自転方向にゆっくり回して「生きている」感
        iss.rotation.z += dt * 0.05;
      }
      renderer.render(scene, camera);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);

    const onResize = () => {
      const w = mount.clientWidth;
      const h = Math.max(360, Math.min(560, Math.round(w * 0.56)));
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);

    return () => {
      disposed = true;
      clearInterval(issTimer);
      window.removeEventListener('resize', onResize);
      controls.dispose();
      renderer.dispose();
      terrainGeo.dispose();
      mount.innerHTML = '';
    };
  }, [loc?.lat, loc?.lon]);

  const exportRoblox = () => {
    const { height, color } = exportRef.current;
    const dl = (name: string, url: string) => {
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
    };
    try {
      if (color) dl(`uspace_colormap_${loc?.lat.toFixed(3)}_${loc?.lon.toFixed(3)}.png`, color.toDataURL('image/png'));
      if (height) {
        // Terrarium (RGB 16bit) → 8bit グレースケール高さ図（Roblox Terrain Import 用）
        const c = document.createElement('canvas');
        c.width = height.width;
        c.height = height.height;
        const ctx = c.getContext('2d')!;
        const src = height.getContext('2d')!.getImageData(0, 0, height.width, height.height);
        const out = ctx.createImageData(src.width, src.height);
        let min = Infinity;
        let max = -Infinity;
        const hs = new Float32Array(src.width * src.height);
        for (let i = 0; i < hs.length; i++) {
          const k = i * 4;
          hs[i] = src.data[k] * 256 + src.data[k + 1] + src.data[k + 2] / 256 - 32768;
          if (hs[i] < min) min = hs[i];
          if (hs[i] > max) max = hs[i];
        }
        for (let i = 0; i < hs.length; i++) {
          const g = Math.round(((hs[i] - min) / Math.max(1, max - min)) * 255);
          out.data.set([g, g, g, 255], i * 4);
        }
        ctx.putImageData(out, 0, 0);
        dl(`uspace_heightmap_${loc?.lat.toFixed(3)}_${loc?.lon.toFixed(3)}_${Math.round(min)}m-${Math.round(max)}m.png`, c.toDataURL('image/png'));
      }
      const meta = { lat: loc?.lat, lon: loc?.lon, label: loc?.label, zoom: TERRAIN_Z, tiles: TERRAIN_TILES, note: 'Roblox Studio → Terrain Editor → Import: heightmap + colormap. 1 tile ≈ 4 km at this zoom.' };
      dl('uspace_terrain_meta.json', 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(meta, null, 2)));
    } catch (e) {
      setErr('書き出しに失敗しました（衛星タイルが読み込めていない可能性）');
    }
  };

  return (
    <Card title="🌍 School → Space — 御校から宇宙へ（メタバース）" subtitle={loc ? `${loc.label} の街を衛星写真＋標高から自動生成。ドラッグで見回し、LAUNCH で打ち上げ、本物の位置にいる ISS まで飛びます。` : '住所を入れると、その街がメタバースの出発点になります'}>
      {allowInput && (
        <form onSubmit={locate} className="flex gap-2 mb-4">
          <Input value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="例：東京都渋谷区神南1-11-4" />
          <Button type="submit" disabled={geoBusy || !addr.trim()}>
            {geoBusy ? <Spinner /> : 'この街を生成'}
          </Button>
        </form>
      )}
      {err && <p className="text-rose-300 text-sm mb-2">{err}</p>}
      {loc && (
        <div className="relative rounded-xl overflow-hidden border border-white/10 bg-space-950">
          <div ref={mountRef} className="w-full" style={{ minHeight: 360 }} />
          {/* HUD */}
          <div className="absolute left-3 top-3 flex flex-col gap-1 pointer-events-none">
            <div className="rounded-lg bg-black/55 px-3 py-1.5 text-xs font-display text-white">
              ALT <span className="text-orange-300 text-base">{altitude < 1 ? `${Math.round(altitude * 1000)} m` : `${Math.round(altitude).toLocaleString()} km`}</span>
              {distToIss !== null && (
                <span className="ml-3">
                  → ISS <span className="text-emerald-300 text-base">{distToIss.toLocaleString()} km</span>
                </span>
              )}
            </div>
            <div className="rounded-lg bg-black/55 px-3 py-1.5 text-xs text-slate-200 max-w-md">{callout}</div>
          </div>
          <div className="absolute right-3 top-3 flex gap-2">
            {phase === 'ground' && (
              <Button onClick={() => launchRef.current()} disabled={status !== 'ready'}>
                {status === 'ready' ? '🚀 LAUNCH' : <Spinner />}
              </Button>
            )}
            {phase !== 'ground' && (
              <Button variant="ghost" onClick={() => resetRef.current()}>
                🏫 Back to school
              </Button>
            )}
          </div>
          <div className="absolute left-3 bottom-3 flex flex-wrap gap-1">
            <Pill tone="slate">地面: {sources.ground}</Pill>
            <Pill tone="slate">地球: {sources.earth}</Pill>
            <Pill tone="slate">標高 ×1.6 強調</Pill>
          </div>
        </div>
      )}
      {loc && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="ghost" onClick={exportRoblox} disabled={status !== 'ready'}>
            ⬇︎ Roblox 用に書き出し（高さ図＋カラーマップ）
          </Button>
          <span className="text-xs text-slate-500">U-Speak Roblox の「教室専用ワールド」に、この街の地形をそのまま取り込めます（Roblox Studio → Terrain → Import）。</span>
        </div>
      )}
      <p className="text-[10px] text-slate-500 mt-2">Sentinel-2 cloudless by EOX (CC BY 4.0) · Terrain tiles: Mapzen/AWS Terrarium · Earth: NASA Blue Marble via GIBS · ISS position: wheretheiss.at（ISS と目印は見やすいよう実寸より大きく表示）</p>
    </Card>
  );
};
