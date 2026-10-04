// Aptidão da terra: para que cada pedaço do município serve — calculado no navegador, na grade de 30 m do ANADEM, a
// partir do que o app já tem: relevo (declividade), solo (SoilGrids 250 m), sol do inverno e geada (solgeada.png),
// uso do solo 2025 (MapBiomas), APP estimada (car_id.png), córregos (drainage.json) e clima (clima.json, pela altitude).
//  - capacidade de uso (I–VIII): sistema de capacidade de uso simplificado (Lepsch), pela declividade, várzea, solo raso
//    ou arenoso e rocha;
//  - mecanização: faixas de declividade + o que o Código Florestal restringe (25–45°) ou protege (> 45°);
//  - culturas: nota 0–100 multiplicando fatores (temperatura pela altitude, declividade, geada, sol, solo, água);
//  - erosão: Equação Universal de Perda de Solo simplificada (RUSLE: LS de McCool), com o uso atual;
//  - conflitos: uso atual que briga com a aptidão ou com a lei (e mata em área boa, candidata à Reserva Legal).
// Tudo é estimativa de escritório: não substitui o laudo de um agrônomo nem a análise do órgão ambiental.
import * as THREE from 'three';

export const CAP = [null,
  { k: 'I', use: 'Lavouras anuais sem restrição', c: '#1a7f3c' },
  { k: 'II', use: 'Lavouras com conservação simples (plantio em nível)', c: '#7bb342' },
  { k: 'III', use: 'Lavouras com conservação intensiva (terraço, curva de nível)', c: '#e2cf3a' },
  { k: 'IV', use: 'Lavoura só de vez em quando; melhor café, fruta ou pasto', c: '#f09a36' },
  { k: 'V', use: 'Várzea encharcável: pasto, arroz, sem lavoura comum', c: '#3a8fd0' },
  { k: 'VI', use: 'Pasto e reflorestamento, com cuidado', c: '#c48a5a' },
  { k: 'VII', use: 'Reflorestamento e preservação', c: '#9c4a38' },
  { k: 'VIII', use: 'Preservação (rocha, encosta muito forte)', c: '#76598f' },
];
export const MECH = [null,
  { k: 'Trator em tudo', d: 'até 12%', c: '#2f8a3c' },
  { k: 'Trator com restrição', d: '12–20%', c: '#b8c24a' },
  { k: 'Só manual ou tração animal', d: '20% a 25°', c: '#e0882f' },
  { k: 'Uso restrito pela lei', d: '25° a 45° (art. 11)', c: '#c2412d' },
  { k: 'APP de encosta', d: 'acima de 45°', c: '#6b3d8f' },
  { k: 'Várzea encharcável', d: 'plano e úmido', c: '#3a8fd0' },
];
export const EROS = [
  { max: 2, k: 'Muito baixa', c: '#2f8a3c' }, { max: 5, k: 'Baixa (tolerável)', c: '#9cc05a' }, { max: 15, k: 'Moderada', c: '#e8c53a' },
  { max: 50, k: 'Alta', c: '#e0702f' }, { max: Infinity, k: 'Muito alta', c: '#b2182b' },
];
export const CROPS = [
  { id: 'cafe', name: 'Café arábica', zarc: 'Café Arábica Implantação' },
  { id: 'graos', name: 'Milho e feijão', zarc: 'Milho 1ª Safra' },
  { id: 'pasto', name: 'Pasto (braquiária)', zarc: 'Forrageira Pecuária' },
  { id: 'euca', name: 'Eucalipto', zarc: null },
  { id: 'horta', name: 'Horta', zarc: null },
];
export const CONF = [null,
  { k: 'APP com pasto ou lavoura', c: '#d7301f' },
  { k: 'Lavoura em encosta forte', c: '#f08c2e' },
  { k: 'Pasto onde deveria ser mata', c: '#f2c14e' },
  { k: 'Solo exposto', c: '#8a5a32' },
  { k: 'Mata em área boa (candidata à Reserva Legal)', c: '#2aa198' },
];
export const MODES = { cap: 'Capacidade de uso', crop: 'Cultura', mech: 'Mecanização', eros: 'Erosão', conf: 'Conflitos' };

const LC_C = { 3: 0.001, 4: 0.01, 5: 0.001, 11: 0.001, 12: 0.012, 15: 0.04, 9: 0.02, 19: 0.2, 20: 0.15, 39: 0.2, 40: 0.2, 41: 0.2, 62: 0.2,
  36: 0.1, 46: 0.1, 47: 0.1, 48: 0.1, 21: 0.1, 24: 0, 25: 0.8, 29: 0, 30: 0.5, 33: 0, 31: 0 };
const CROPLAND = new Set([19, 20, 39, 40, 41, 62, 36, 46, 47, 48]), NATIVE = new Set([3, 4, 5, 11, 12]);
const WRB_K = { 10: 0.013, 0: 0.032, 2: 0.032, 17: 0.032, 6: 0.04, 28: 0.035, 16: 0.045, 24: 0.04, 12: 0.02, 11: 0.03, 4: 0.03 };
const R_FACTOR = 6800;   // erosividade da chuva no sul de Minas (MJ·mm/ha·h·ano), ordem de grandeza dos mapas regionais
const tri = (v, a, b, c, d) => (v <= a || v >= d ? 0 : v < b ? (v - a) / (b - a) : v <= c ? 1 : (d - v) / (d - c));
const lin = (v, a, b, ya, yb) => (v <= a ? ya : v >= b ? yb : ya + ((v - a) / (b - a)) * (yb - ya));
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

async function decode(blob) {
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
  const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, 0, 0);
  const d = g.getImageData(0, 0, bmp.width, bmp.height).data;
  bmp.close?.();
  return { d, w: cv.width, h: cv.height };
}

export class Aptitude {
  /** G: grade de 30 m (GRIDS.g30) · EXT: extensão do mapa · hf: relevo · agro: Agro · lcBlob(): Promise<Blob> do uso 2025 */
  constructor({ G, EXT, hf, agro, lcBlob, drainage, osm, boundary }) {
    Object.assign(this, { G, EXT, hf, agro, lcBlob, drainage, osm, boundary });
    this.p = null; this.tex = null;
  }
  load() { this.p ??= this.#build().catch((e) => { this.p = null; throw e; }); return this.p; }

  async #build() {
    const { G, EXT } = this, W = G.w, H = G.h, N = W * H;
    const [lc, sg, id] = await Promise.all([
      this.lcBlob().then(decode),
      fetch('data/muni/layers/solgeada.png').then((r) => r.blob()).then(decode),
      fetch('data/muni/layers/car_id.png').then((r) => r.blob()).then(decode),
      this.agro.load(),
    ]);
    const S = this.agro.solo, C = this.agro.clima;
    const [w0, s0, e0, n0] = S.bbox, scw = (e0 - w0) / S.w, sch = (n0 - s0) / S.h;
    // temperatura média do ano no nível de referência dos pontos do clima (corrigida pela altitude em cada pixel)
    const tmean = (p) => p.tmax.reduce((a, v, m) => a + (v + p.tmin[m]) / 2, 0) / 12;
    const T0 = C.points.reduce((a, p) => a + tmean(p), 0) / C.points.length, Z0 = C.points.reduce((a, p) => a + p.elev, 0) / C.points.length;
    // córregos e rios na grade de 30 m → distância (m) até a água, por chanfro 3-4
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H); g.strokeStyle = '#fff'; g.lineWidth = 1;
    const P = (la, lo) => [(lo - G.lon0) / G.d, (G.lat0 - la) / G.d];
    const stroke = (line) => { g.beginPath(); line.forEach(([la, lo], k) => g[k ? 'lineTo' : 'moveTo'](...P(la, lo))); g.stroke(); };
    for (const f of this.drainage.features) stroke(f.geom);
    for (const f of this.osm.features) if (f.kind === 'waterway') f.geom.forEach(stroke);
    const wm = g.getImageData(0, 0, W, H).data, dist = new Float32Array(N);
    for (let i = 0; i < N; i++) dist[i] = wm[i * 4] > 60 ? 0 : 1e9;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const k = j * W + i; let v = dist[k];
      if (i) v = Math.min(v, dist[k - 1] + 3); if (j) { v = Math.min(v, dist[k - W] + 3); if (i) v = Math.min(v, dist[k - W - 1] + 4); if (i < W - 1) v = Math.min(v, dist[k - W + 1] + 4); }
      dist[k] = v;
    }
    for (let j = H - 1; j >= 0; j--) for (let i = W - 1; i >= 0; i--) {
      const k = j * W + i; let v = dist[k];
      if (i < W - 1) v = Math.min(v, dist[k + 1] + 3); if (j < H - 1) { v = Math.min(v, dist[k + W] + 3); if (i < W - 1) v = Math.min(v, dist[k + W + 1] + 4); if (i) v = Math.min(v, dist[k + W - 1] + 4); }
      dist[k] = v;
    }
    // limite do município (para os totais da legenda)
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H); g.fillStyle = '#fff'; g.beginPath();
    this.boundary.ring.forEach(([la, lo], k) => g[k ? 'lineTo' : 'moveTo'](...P(la, lo))); g.closePath(); g.fill();
    const bm = g.getImageData(0, 0, W, H).data;

    const hf = this.hf, direct = hf.width === W && hf.height === H;
    const elev = new Float32Array(N);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      elev[j * W + i] = direct ? hf.data[j * W + i] : hf.elevation(G.lat0 - (j + 0.5) * G.d, G.lon0 + (i + 0.5) * G.d);
    }
    const L = {
      W, H, N, elev, slope: new Float32Array(N), cap: new Uint8Array(N), mech: new Uint8Array(N), eros: new Float32Array(N),
      conf: new Uint8Array(N), suit: CROPS.map(() => new Uint8Array(N)), frost: new Uint8Array(N), sun: new Uint8Array(N),
      app: new Uint8Array(N), lc: new Uint8Array(N), muni: new Uint8Array(N), wet: new Uint8Array(N),
    };
    const sgAt = (i, j) => ((Math.min(sg.h - 1, Math.floor(((j + 0.5) / H) * sg.h)) * sg.w) + Math.min(sg.w - 1, Math.floor(((i + 0.5) / W) * sg.w))) * 4;
    const lcAt = (i, j) => ((Math.min(lc.h - 1, Math.floor(((j + 0.5) / H) * lc.h)) * lc.w) + Math.min(lc.w - 1, Math.floor(((i + 0.5) / W) * lc.w))) * 4;
    for (let j = 0; j < H; j++) {
      const lat = G.lat0 - (j + 0.5) * G.d, dx = G.d * 111320 * Math.cos((lat * Math.PI) / 180), dy = G.d * 110574;
      const jn = Math.max(0, j - 1), js = Math.min(H - 1, j + 1);
      for (let i = 0; i < W; i++) {
        const k = j * W + i, lon = G.lon0 + (i + 0.5) * G.d;
        const iw = Math.max(0, i - 1), ie = Math.min(W - 1, i + 1);
        const gx = (elev[j * W + ie] - elev[j * W + iw]) / ((ie - iw) * dx), gy = (elev[jn * W + i] - elev[js * W + i]) / ((js - jn) * dy);
        const s = Math.hypot(gx, gy) * 100;   // declividade (%)
        L.slope[k] = s;
        const q = sgAt(i, j), frost = sg.d[q + 2] / 255, sun = sg.d[q] / 25;   // geada 0–1 · sol de 21/jun (kWh/m²/dia)
        L.frost[k] = sg.d[q + 2]; L.sun[k] = sg.d[q];
        const code = lc.d[lcAt(i, j)]; L.lc[k] = code;
        // APP pelo raster de identificação do CAR (bit 4 = APP, bit 5 = APP com uso antrópico)
        const ci = Math.floor(((lon - EXT.w) / (EXT.e - EXT.w)) * id.w), cj = Math.floor(((EXT.n - lat) / (EXT.n - EXT.s)) * id.h);
        const cb = ci >= 0 && cj >= 0 && ci < id.w && cj < id.h ? id.d[(cj * id.w + ci) * 4 + 2] : 0;
        const app = (cb >> 4) & 1, appUse = (cb >> 5) & 1;
        L.app[k] = app | (appUse << 1);
        L.muni[k] = bm[k * 4] > 127 ? 1 : 0;
        // solo (SoilGrids)
        const si = Math.floor((lon - w0) / scw), sj = Math.floor((n0 - lat) / sch), sk = si >= 0 && sj >= 0 && si < S.w && sj < S.h ? sj * S.w + si : -1;
        const clay = sk >= 0 && S.clay[sk] ? S.clay[sk] : 40, sand = sk >= 0 && S.sand[sk] ? S.sand[sk] : 35, ph = sk >= 0 && S.ph[sk] ? S.ph[sk] / 10 : 5.3, wrb = sk >= 0 ? S.wrb[sk] : 255;
        const dm = dist[k] / 3 * 30;   // metros até a água
        const wet = s < 3 && frost > 0.5 && dm < 250;   // várzea: plano, baixada fria (ar e água parados) e perto do córrego
        L.wet[k] = wet ? 1 : 0;
        const rock = code === 29, shallow = wrb === 16, sandy = sand > 70;
        // capacidade de uso
        let cap = rock || s > 100 ? 8 : s > 45 ? 7 : wet ? 5 : s > 20 ? 6 : s > 12 ? 4 : s > 6 ? 3 : s > 3 ? 2 : 1;
        if (shallow && cap < 6) cap = 6;
        if (sandy && cap < 3) cap = 3;
        L.cap[k] = cap;
        L.mech[k] = wet ? 6 : s <= 12 ? 1 : s <= 20 ? 2 : s <= 46.6 ? 3 : s <= 100 ? 4 : 5;
        // erosão (USLE): A = R · K · LS · C
        // LS da RUSLE (McCool): o fator de declividade cresce menos que o da USLE original nas encostas fortes
        const th = Math.atan(s / 100), sn = Math.sin(th), beta = sn / 0.0896 / (3 * Math.max(sn, 1e-4) ** 0.8 + 0.56), m = beta / (1 + beta);
        const LS = (50 / 22.13) ** m * (s < 9 ? 10.8 * sn + 0.03 : 16.8 * sn - 0.5);
        const K = WRB_K[wrb] ?? Math.min(0.05, Math.max(0.01, 0.055 - 0.0007 * clay));
        L.eros[k] = R_FACTOR * K * LS * (LC_C[code] ?? 0.05);
        // culturas (0–1, multiplicando fatores); APP e encosta acima de 45° ficam de fora
        const T = T0 + C.lapse * (elev[k] - Z0);
        const legal = app || s > 100 ? 0 : 1, wetF = (v) => (wet ? v : 1);
        const soilF = (a, b, c, d) => 0.55 + 0.45 * tri(clay, a, b, c, d);
        const frostF = (w) => 1 - w * ss(0.35, 0.62, frost);
        const sc = [
          // café arábica: 18–22 °C de média, geada é o maior risco, encosta voltada ao norte ajuda; até 20% mecaniza
          tri(T, 16.5, 18, 22, 23.5) * frostF(0.92) * lin(s, 20, 60, 1, 0.15) * (0.75 + 0.25 * Math.min(1, Math.max(0, (sun - 2.8) / 1.5))) * soilF(15, 30, 60, 75) * wetF(0) * (ph < 4.8 ? 0.85 : 1),
          // milho e feijão: mecanização manda; solo e acidez ajustam
          tri(T, 14, 17, 26, 30) * lin(s, 12, 30, 1, 0.1) * soilF(15, 25, 60, 75) * (ph < 5 ? 0.85 : 1) * wetF(0.3) * frostF(0.25),
          // pasto: quase tudo serve, menos encosta muito forte
          lin(s, 30, 75, 1, 0.15) * wetF(0.75) * frostF(0.25),
          // eucalipto: aguenta encosta e solo fraco; geada e várzea atrapalham
          tri(T, 13, 16, 25, 28) * lin(s, 30, 70, 1, 0.3) * frostF(0.5) * wetF(0.1),
          // horta: plano e perto da água
          lin(s, 6, 15, 1, 0) * lin(dm, 200, 900, 1, 0.3) * soilF(10, 20, 50, 65) * frostF(0.4) * wetF(0.5),
        ];
        sc.forEach((v, c) => { L.suit[c][k] = Math.round(100 * v * legal); });
        // conflitos (o primeiro que valer)
        L.conf[k] = appUse ? 1 : CROPLAND.has(code) && cap >= 6 ? 2 : code === 15 && cap >= 7 ? 3 : code === 25 ? 4 : NATIVE.has(code) && cap <= 3 && !app ? 5 : 0;
      }
    }
    this.L = L;
    this.pxHa = (G.d * 111320 * Math.cos((21.735 * Math.PI) / 180)) * (G.d * 110574) / 1e4;
    // totais no município, para a legenda
    this.muniTot = {};
    for (const mode of ['cap', 'mech', 'conf']) {
      const cnt = new Float64Array(16);
      for (let k = 0; k < N; k++) if (L.muni[k]) cnt[L[mode][k]]++;
      this.muniTot[mode] = Array.from(cnt, (v) => v * this.pxHa);
    }
    { const cnt = new Float64Array(EROS.length); for (let k = 0; k < N; k++) if (L.muni[k]) cnt[EROS.findIndex((e) => L.eros[k] < e.max)]++; this.muniTot.eros = Array.from(cnt, (v) => v * this.pxHa); }
    this.muniTot.crop = CROPS.map((_, c) => { let gd = 0, rg = 0; for (let k = 0; k < N; k++) if (L.muni[k]) { const v = L.suit[c][k]; if (v >= 70) gd++; else if (v >= 40) rg++; } return [gd * this.pxHa, rg * this.pxHa]; });
    return this;
  }

  /** textura de cor (RGBA, linhas de sul para norte como as do uso do solo) para um modo do mapa */
  texture(mode, crop = 0) {
    const L = this.L, { W, H, N } = L, out = new Uint8Array(N * 4);
    const pal = (list, key = 'c') => list.map((x) => (x ? hex(x[key]) : [0, 0, 0]));
    const capP = pal(CAP), mechP = pal(MECH), confP = pal(CONF), erosP = pal(EROS);
    const ramp = [[178, 24, 43], [224, 112, 47], [232, 197, 58], [156, 192, 90], [47, 138, 60], [20, 90, 42]];
    for (let j = 0; j < H; j++) {
      const row = (H - 1 - j) * W;
      for (let i = 0; i < W; i++) {
        const k = j * W + i, o = (row + i) * 4;
        let c, a = 215;
        if (mode === 'cap') c = capP[L.cap[k]];
        else if (mode === 'mech') c = mechP[L.mech[k]];
        else if (mode === 'eros') c = erosP[EROS.findIndex((e) => L.eros[k] < e.max)];
        else if (mode === 'conf') { const v = L.conf[k]; c = v ? confP[v] : [0, 0, 0]; a = v ? 235 : 0; }
        else {   // cultura: vermelho (inapto) → verde-escuro (ótimo); APP / encosta > 45° sem cor
          const v = L.suit[crop][k];
          if (!v) { c = [90, 90, 96]; a = 150; }
          else { const t = (v / 100) * (ramp.length - 1), q = Math.min(ramp.length - 2, Math.floor(t)), f = t - q; c = ramp[q].map((x, n) => x + (ramp[q + 1][n] - x) * f); }
        }
        out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = a;
      }
    }
    const tex = this.tex ?? new THREE.DataTexture(out, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
    if (this.tex) tex.image.data = out;
    const cat = mode !== 'crop' && mode !== 'eros';
    tex.magFilter = cat ? THREE.NearestFilter : THREE.LinearFilter; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
    tex.needsUpdate = true;
    this.tex = tex;
    return tex;
  }

  /** números de uma área (contorno da propriedade ou talhão desenhado): rings = [[[lat, lon]…]…] */
  statsFor(rings) {
    const { G } = this, L = this.L, { W, H } = L;
    let s = 90, n = -90, w = 180, e = -180;
    for (const r of rings) for (const [la, lo] of r) { s = Math.min(s, la); n = Math.max(n, la); w = Math.min(w, lo); e = Math.max(e, lo); }
    const i0 = Math.max(0, Math.floor((w - G.lon0) / G.d)), i1 = Math.min(W - 1, Math.ceil((e - G.lon0) / G.d));
    const j0 = Math.max(0, Math.floor((G.lat0 - n) / G.d)), j1 = Math.min(H - 1, Math.ceil((G.lat0 - s) / G.d));
    if (i1 < i0 || j1 < j0) return null;
    const cw = i1 - i0 + 1, ch = j1 - j0 + 1, cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
    const g = cv.getContext('2d', { willReadFrequently: true }); g.fillStyle = '#fff';
    for (const r of rings) { g.beginPath(); r.forEach(([la, lo], k) => g[k ? 'lineTo' : 'moveTo']((lo - G.lon0) / G.d - i0, (G.lat0 - la) / G.d - j0)); g.closePath(); g.fill(); }
    const m = g.getImageData(0, 0, cw, ch).data;
    const st = { px: 0, cap: new Float64Array(9), mech: new Float64Array(7), conf: new Float64Array(6), eros: new Float64Array(EROS.length),
      crop: CROPS.map(() => [0, 0]), slope: 0, frost: 0, sun: 0, zmin: Infinity, zmax: -Infinity, A: 0, Apot: 0, app: 0, wet: 0 };
    for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
      if (m[(j * cw + i) * 4 + 3] < 128) continue;
      const k = (j0 + j) * W + i0 + i;
      st.px++; st.cap[L.cap[k]]++; st.mech[L.mech[k]]++; st.conf[L.conf[k]]++;
      st.eros[EROS.findIndex((x) => L.eros[k] < x.max)]++; st.A += L.eros[k];
      st.Apot += L.eros[k] / (LC_C[L.lc[k]] || 0.05) * 0.2;   // se virasse lavoura anual (C = 0,2)
      CROPS.forEach((_, c) => { const v = L.suit[c][k]; if (v >= 70) st.crop[c][0]++; else if (v >= 40) st.crop[c][1]++; });
      st.slope += L.slope[k]; st.frost += L.frost[k] / 255; st.sun += L.sun[k] / 25;
      st.zmin = Math.min(st.zmin, L.elev[k]); st.zmax = Math.max(st.zmax, L.elev[k]);
      if (L.app[k] & 1) st.app++; if (L.wet[k]) st.wet++;
    }
    if (!st.px) return null;
    const ha = this.pxHa;
    return {
      ha: st.px * ha, n: st.px, cap: Array.from(st.cap, (v) => v * ha), mech: Array.from(st.mech, (v) => v * ha), conf: Array.from(st.conf, (v) => v * ha),
      eros: Array.from(st.eros, (v) => v * ha), crop: st.crop.map(([a, b]) => [a * ha, b * ha]), A: st.A / st.px, Apot: st.Apot / st.px,
      slope: st.slope / st.px, frost: st.frost / st.px, sun: st.sun / st.px, zmin: st.zmin, zmax: st.zmax, app: st.app * ha, wet: st.wet * ha,
    };
  }
}

/** HTML das partes da aptidão para a ficha e para o talhão (st = statsFor) · opts: { nf, usable, zarc(cropName) → texto } */
export function aptHTML(st, { nf, usable = null, zarc = null, mapButtons = true } = {}) {
  const fha = (v) => `${nf(v, v < 10 ? 1 : 0)} ha`, pct = (v) => (100 * v) / st.ha;
  const bar = (vals, list) => `<div class="cc-bar">${vals.map((v, i) => (v > 0 && list[i] ? `<span style="flex:${v} 1 0;background:${list[i].c}" title="${list[i].k}: ${fha(v)}"></span>` : '')).join('')}</div>`;
  const rows = (vals, list, desc) => `<ul class="cc-list">${vals.map((v, i) => (list[i] && v >= Math.max(0.05, st.ha * 0.005) ? `<li><span class="lc-sw" style="background:${list[i].c}"></span><span>${desc(list[i], i)}</span><b>${fha(v)}</b></li>` : '')).join('')}</ul>`;
  const btn = (mode, crop) => (mapButtons ? `<button type="button" class="btn btn--small" data-apt-map="${mode}"${crop != null ? ` data-apt-crop="${crop}"` : ''}>Ver no mapa</button>` : '');
  let h = '';
  // capacidade de uso
  h += `<section data-tab="apt"><h3>Capacidade de uso da terra</h3>${bar(st.cap, CAP)}
    ${rows(st.cap, CAP, (c) => `<b class="apt-k">${c.k}</b> ${c.use}`)}
    <p class="cc-note">Classes I a VIII (sistema de capacidade de uso, simplificado): declividade do ANADEM, várzeas, solo raso ou arenoso (SoilGrids) e rocha.</p>${btn('cap')}</section>`;
  // culturas
  h += `<section data-tab="apt"><h3>Onde cada cultura se dá melhor</h3>
    <table class="lu-cmp apt-crops"><thead><tr><th></th><th>boa</th><th>regular</th><th></th></tr></thead><tbody>${CROPS.map((c, i) => {
      const [gd, rg] = st.crop[i];
      return `<tr><td>${c.name}${zarc && c.zarc ? `<small class="apt-z">${zarc(c.zarc) ?? ''}</small>` : ''}</td><td>${gd >= 0.05 ? fha(gd) : '—'}</td><td>${rg >= 0.05 ? fha(rg) : '—'}</td><td>${mapButtons ? `<button type="button" class="apt-eye" data-apt-map="crop" data-apt-crop="${i}" title="Ver no mapa" aria-label="Ver ${c.name} no mapa">◉</button>` : ''}</td></tr>`;
    }).join('')}</tbody></table>
    <p class="cc-note">Nota de 0 a 100 por pedaço de 30 m: temperatura pela altitude, declividade, geada, sol do inverno, solo e distância da água. "Boa" = 70 ou mais; APP e encosta acima de 45° ficam de fora. Época de plantio: ZARC.</p></section>`;
  // mecanização
  h += `<section data-tab="apt"><h3>Mecanização e o que a lei restringe</h3>${bar(st.mech, MECH)}
    ${rows(st.mech, MECH, (c) => `${c.k} <small class="dim">${c.d}</small>`)}${btn('mech')}</section>`;
  // quanto pode usar
  if (usable) {
    const { a, app, rl, natOut, mf } = usable, rlNeed = 0.2 * a, livre = Math.max(0, a - app - Math.max(rlNeed, natOut));
    const falta = Math.max(0, rlNeed - natOut);
    h += `<section data-tab="apt"><h3>Quanto da área dá para produzir</h3>
      <div class="cc-bar apt-use"><span style="flex:${app} 1 0;background:#1c80c4" title="APP"></span><span style="flex:${Math.max(rlNeed, natOut)} 1 0;background:#2f8a3c" title="Reserva Legal"></span><span style="flex:${livre} 1 0;background:#e3c46b" title="Livre"></span></div>
      <ul class="cc-list">
        <li><span class="lc-sw" style="background:#1c80c4"></span><span>APP estimada</span><b>${fha(app)}</b></li>
        <li><span class="lc-sw" style="background:#2f8a3c"></span><span>Reserva Legal (20%)${natOut > rlNeed ? ' — já tem mata de sobra' : ''}</span><b>${fha(rlNeed)}</b></li>
        <li><span class="lc-sw" style="background:#e3c46b"></span><span>Livre para produzir</span><b>${fha(livre)}</b></li>
      </ul>
      <p class="cc-kv">${falta >= 0.1 ? `Mata nativa fora da APP: <b>${fha(natOut)}</b> — faltariam <b>${fha(falta)}</b> para os 20% da Reserva Legal.` : `Mata nativa fora da APP: <b>${fha(natOut)}</b> — cobre a Reserva Legal${natOut - rlNeed >= 0.5 ? ` e sobram <b>${fha(natOut - rlNeed)}</b>` : ''}.`}</p>
      <p class="cc-note">${mf <= 4 ? 'Até 4 módulos fiscais, a Reserva Legal pode ficar com a vegetação que existia em 22/07/2008 (art. 67). ' : ''}A APP pode entrar no cálculo da Reserva Legal em alguns casos (art. 15). Estimativa pelo MapBiomas e pela APP do app: quem define é o órgão ambiental.</p></section>`;
  }
  // erosão
  const ei = EROS.findIndex((e) => st.A < e.max), ep = EROS.findIndex((e) => st.Apot < e.max);
  h += `<section data-tab="apt"><h3>Risco de erosão</h3>${bar(st.eros, EROS)}
    <p class="cc-kv">Perda de solo estimada com o uso de hoje: <b>${nf(st.A, st.A < 10 ? 1 : 0)} t/ha por ano</b> (${EROS[ei].k.toLowerCase()})</p>
    <p class="cc-kv">Se a área toda virasse lavoura anual: <b>${nf(st.Apot, st.Apot < 10 ? 1 : 0)} t/ha por ano</b> (${EROS[ep].k.toLowerCase()})</p>
    ${rows(st.eros, EROS, (c) => c.k)}
    <p class="cc-note">Equação Universal de Perda de Solo (RUSLE) simplificada: chuva da região, solo (SoilGrids), declividade e cobertura do MapBiomas 2025. O solo aguenta perder uns 5 a 12 t/ha por ano sem empobrecer.</p>${btn('eros')}</section>`;
  // conflitos
  const anyConf = st.conf.slice(1).some((v) => v >= 0.05);
  h += `<section data-tab="apt"><h3>Uso de hoje × aptidão</h3>${anyConf ? rows(st.conf, CONF, (c) => c.k) : '<p class="cc-kv">Nada que chame atenção: o uso de hoje combina com a aptidão.</p>'}
    <p class="cc-note">Cruza o MapBiomas 2025 com a capacidade de uso e a APP estimada.</p>${btn('conf')}</section>`;
  return h;
}
