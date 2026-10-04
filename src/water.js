// "Gota de chuva": a partir de um ponto tocado, segue a direção do escoamento (D8, calculada do ANADEM)
// até sair do mapa, e anima uma gota descendo pelo caminho — córrego, ribeirão, rio.
import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

export const G = { w: 1671, h: 1522, lon0: -44.510264686724526, lat0: -21.529922414492574, d: 0.00026949458523585647 };
export const N8 = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

async function imagePixels(url) {
  const bmp = await createImageBitmap(await (await fetch(url)).blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const cv = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
  const out = new Uint8Array(bmp.width * bmp.height);
  for (let k = 0; k < out.length; k++) out[k] = d[k * 4];
  return out;
}

export class RainDrop {
  constructor({ terrain, scene, drainage, osm, inMunicipio }) {
    this.terrain = terrain; this.inMunicipio = inMunicipio;
    this.group = new THREE.Group(); scene.add(this.group);
    // células de canal (vértices da drenagem calculada são centros de pixel da mesma grade)
    this.channel = new Set();
    for (const f of drainage.features) for (const [la, lo] of f.geom) this.channel.add(this.#key(la, lo));
    // rios com nome (OSM) numa grade de 150 m
    this.rivers = new Map();
    const fr = terrain.frame;
    for (const f of osm.features) {
      if (f.kind !== 'waterway' || !f.name) continue;
      for (const g of f.geom) for (let k = 0; k < g.length - 1; k++) {
        const a = fr.toLocal(g[k][0], g[k][1]), b = fr.toLocal(g[k + 1][0], g[k + 1][1]);
        const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 30));
        for (let s = 0; s <= n; s++) {
          const x = a.x + ((b.x - a.x) * s) / n, z = a.z + ((b.z - a.z) * s) / n;
          const key = `${Math.floor(x / 150)}_${Math.floor(z / 150)}`;
          if (!this.rivers.has(key)) this.rivers.set(key, []);
          this.rivers.get(key).push([x, z, f.name]);
        }
      }
    }
    this.mat = new LineMaterial({ color: 0x19b2ff, linewidth: 5, dashed: true, dashSize: 0, gapSize: 1e9, transparent: true, opacity: 0.95, worldUnits: false });
    this.glow = new LineMaterial({ color: 0xffffff, linewidth: 8, dashed: true, dashSize: 0, gapSize: 1e9, transparent: true, opacity: 0.35, worldUnits: false });
    this.drop = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: 0x8fe3ff }));
    this.drop.visible = false; this.group.add(this.drop);
    this.anim = null;
  }

  async load() { this.fdir ??= imagePixels('data/muni/layers/fdir.png'); this.fdir = await this.fdir; }
  setResolution(w, h) { this.mat.resolution.set(w, h); this.glow.resolution.set(w, h); }

  #key(la, lo) { return Math.round((G.lat0 - la) / G.d - 0.5) * G.w + Math.round((lo - G.lon0) / G.d - 0.5); }
  #edge(k) { const j = Math.floor(k / G.w), i = k % G.w; return i <= 1 || j <= 1 || i >= G.w - 2 || j >= G.h - 2; }
  #river(x, z) {
    const cx = Math.floor(x / 150), cz = Math.floor(z / 150);
    let best = null, bd = 90;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      for (const [px, pz, name] of this.rivers.get(`${cx + dx}_${cz + dz}`) ?? []) {
        const d = Math.hypot(px - x, pz - z);
        if (d < bd) { bd = d; best = name; }
      }
    }
    return best;
  }

  /** traça o caminho da água a partir de (lat, lon) */
  trace(lat, lon) {
    const fd = this.fdir, fr = this.terrain.frame;
    let i = Math.floor((lon - G.lon0) / G.d), j = Math.floor((G.lat0 - lat) / G.d);
    const raw = [], seen = new Set();
    while (i >= 0 && j >= 0 && i < G.w && j < G.h && raw.length < 60000) {
      const k = j * G.w + i;
      if (seen.has(k)) break;
      seen.add(k);
      raw.push([G.lat0 - (j + 0.5) * G.d, G.lon0 + (i + 0.5) * G.d, k]);
      const c = fd[k];
      if (!c) break;
      j += N8[c - 1][0]; i += N8[c - 1][1];
    }
    if (raw.length) raw[0] = [lat, lon, raw[0][2]];
    // suaviza o zigue-zague das 8 direções (média móvel), em coordenadas locais
    const loc = raw.map(([la, lo]) => fr.toLocal(la, lo));
    const pts = loc.map((p, n) => {
      if (n < 2 || n > loc.length - 3) return { x: p.x, z: p.z };
      let x = 0, z = 0;
      for (let m = -2; m <= 2; m++) { x += loc[n + m].x; z += loc[n + m].z; }
      return { x: x / 5, z: z / 5 };
    });
    const info = { dist: [0], channelAt: null, river: [], exitAt: null };
    let wasIn = this.inMunicipio(lat, lon), run = { name: null, from: 0 };
    for (let n = 0; n < pts.length; n++) {
      if (n) info.dist.push(info.dist[n - 1] + Math.hypot(pts[n].x - pts[n - 1].x, pts[n].z - pts[n - 1].z));
      if (info.channelAt == null && this.channel.has(raw[n][2])) info.channelAt = n;
      if (n % 2 === 0) {   // só conta um rio depois de seguir junto dele por ~400 m (evita confluências)
        const r = this.#river(pts[n].x, pts[n].z);
        if (r !== run.name) run = { name: r, from: n };
        else if (r && info.dist[n] - info.dist[run.from] >= 400 && !info.river.some((x) => x.name === r)) info.river.push({ name: r, at: info.dist[run.from] });
      }
      if (n % 5 === 0 && wasIn && info.exitAt == null && !this.inMunicipio(raw[n][0], raw[n][1])) info.exitAt = info.dist[n];
    }
    const z0 = this.terrain.hf.elevation(lat, lon), zEnd = this.terrain.hf.elevation(raw.at(-1)[0], raw.at(-1)[1]);
    return {
      pts, raw, ...info, length: info.dist.at(-1) ?? 0, z0, zEnd,
      channelDist: info.channelAt == null ? null : info.dist[info.channelAt],
      startedInside: wasIn, leftMap: this.#edge(raw.at(-1)[2]) || fd[raw.at(-1)[2]] !== 0,
    };
  }

  /** desenha o caminho e começa a animação (dur em segundos; padrão: cresce com o comprimento) */
  start(path, { dur } = {}) {
    this.stop();
    const t = this.terrain, ex = Math.max(1, t.exaggeration);
    const arr = [];
    const P = path.pts.map((p) => new THREE.Vector3(p.x, t.groundY(p.x, p.z) + 4 * ex, p.z));
    for (let n = 0; n < P.length - 1; n++) arr.push(P[n].x, P[n].y, P[n].z, P[n + 1].x, P[n + 1].y, P[n + 1].z);
    const geo = new LineSegmentsGeometry().setPositions(arr);
    this.line = new LineSegments2(geo, this.mat); this.line.computeLineDistances(); this.line.renderOrder = 8;
    this.halo = new LineSegments2(geo, this.glow); this.halo.computeLineDistances(); this.halo.renderOrder = 7;
    this.group.add(this.halo, this.line);
    // distâncias 3D acumuladas (as mesmas usadas pelo tracejado)
    const d3 = [0];
    for (let n = 1; n < P.length; n++) d3.push(d3[n - 1] + P[n].distanceTo(P[n - 1]));
    const L = d3.at(-1) || 1;
    this.anim = { P, d3, L, dur: dur ?? 4 + 7 * Math.log10(1 + L / 800), t: 0 };
    this.drop.visible = true;
  }

  stop() {
    this.anim = null; this.drop.visible = false;
    for (const m of [this.line, this.halo]) if (m) { m.removeFromParent(); }
    this.line?.geometry.dispose(); this.line = this.halo = null;
  }

  /** avança a animação; devolve a posição da gota (para a câmera acompanhar) ou null */
  update(dt, camera) {
    const a = this.anim;
    if (!a) return null;
    a.t = Math.min(a.dur, a.t + dt);
    const u = a.t / a.dur, s = a.L * Math.pow(u, 1.5);
    this.mat.dashSize = this.glow.dashSize = Math.max(0.01, s);
    let lo = 0, hi = a.d3.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (a.d3[m] < s) lo = m; else hi = m; }
    const f = (s - a.d3[lo]) / Math.max(1e-6, a.d3[hi] - a.d3[lo]);
    this.drop.position.lerpVectors(a.P[lo], a.P[hi], Math.min(1, f));
    this.drop.scale.setScalar(Math.max(5, camera.position.distanceTo(this.drop.position) * 0.008));
    if (u >= 1) { this.drop.visible = a.t < a.dur + 0.01; return null; }
    return this.drop.position;
  }
}
