// Conferência do MapBiomas com o satélite: cada pixel de 30 m do uso do solo de 2025 é cruzado com o verde da
// Sentinel-2 (NDVI das águas e da seca de 2026, os mesmos mapas do vigor). Cada classe tem um verde típico — mata segura
// ~0,8 na seca, pasto cai para ~0,45, eucalipto colhido fica perto de 0,3 — e os limites abaixo saíram dessas
// distribuições no próprio município (percentis por classe, 04/10/2026). O que não bate pode ser mudança real entre 2025
// e 2026 (corte, colheita, fogo, mata crescendo) ou erro do mapa: a conferência aponta onde olhar, não diz quem errou.
import * as THREE from 'three';

export const CHECKS = [null,
  { k: 'Mata no mapa, mas pouco verde em 2026', d: 'corte recente, fogo ou erro do mapa', c: '#e5484d' },
  { k: 'Eucalipto no mapa, mas sem copa em 2026', d: 'colhido ou plantado há pouco', c: '#f59e0b' },
  { k: 'Pasto ou campo no mapa, mas verde de mata o ano todo', d: 'mata crescendo, capoeira ou erro do mapa', c: '#14b8a6' },
  { k: 'Água no mapa, mas com vegetação', d: 'assoreamento, plantas aquáticas ou represa seca', c: '#a855f7' },
];
const nd = (b) => (b ? (b - 1) / 254 - 0.1 : NaN);   // byte do vigor → NDVI
/** código da conferência (0 = combina) para uma classe do MapBiomas e o NDVI das águas (w) e da seca (d) */
export function check(code, w, d) {
  if (Number.isNaN(w) || Number.isNaN(d)) return 0;
  if (code === 3 && d < 0.55) return 1;
  if (code === 9 && d < 0.45) return 2;
  if ((code === 15 || code === 12) && d > 0.75 && w > 0.83) return 3;
  if (code === 33 && d > 0.6) return 4;
  return 0;
}

async function decode(blob) {
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
  const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, 0, 0);
  const d = g.getImageData(0, 0, bmp.width, bmp.height).data; bmp.close?.();
  return { d, w: cv.width, h: cv.height };
}

export class Conference {
  /** G: grade de 30 m · EXT: extensão · lcBlob(): Blob do uso 2025 · year: ano dos mapas de vigor · boundary */
  constructor({ G, EXT, lcBlob, year, boundary }) { Object.assign(this, { G, EXT, lcBlob, year, boundary }); this.p = null; this.tex = null; }
  load() { this.p ??= this.#build().catch((e) => { this.p = null; throw e; }); return this.p; }

  async #build() {
    const { G, EXT } = this, W = G.w, H = G.h, N = W * H;
    const [lc, wet, dry] = await Promise.all([this.lcBlob().then(decode),
      fetch(`data/muni/layers/vigor_aguas_${this.year}.webp`).then((r) => r.blob()).then(decode),
      fetch(`data/muni/layers/vigor_seca_${this.year}.webp`).then((r) => r.blob()).then(decode)]);
    this.vig = { wet, dry };
    const flag = new Uint8Array(N), muni = new Uint8Array(N), code = new Uint8Array(N);
    // limite do município (totais)
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#fff'; g.beginPath();
    this.boundary.ring.forEach(([la, lo], k) => g[k ? 'lineTo' : 'moveTo']((lo - G.lon0) / G.d, (G.lat0 - la) / G.d)); g.closePath(); g.fill();
    const bm = g.getImageData(0, 0, W, H).data;
    for (let j = 0; j < H; j++) {
      const lat = G.lat0 - (j + 0.5) * G.d;
      for (let i = 0; i < W; i++) {
        const k = j * W + i, lon = G.lon0 + (i + 0.5) * G.d;
        const c = lc.d[((Math.min(lc.h - 1, Math.floor(((j + 0.5) / H) * lc.h)) * lc.w) + Math.min(lc.w - 1, Math.floor(((i + 0.5) / W) * lc.w))) * 4];
        code[k] = c; muni[k] = bm[k * 4 + 3] > 127 ? 1 : 0;
        flag[k] = check(c, ...this.#ndvi(lat, lon, G.d));
      }
    }
    Object.assign(this, { W, H, N, flag, muni, code });
    this.pxHa = (G.d * 111320 * Math.cos((21.735 * Math.PI) / 180)) * (G.d * 110574) / 1e4;
    // totais no município: área de cada conferência e quanto de cada classe foi conferido
    const tot = new Float64Array(CHECKS.length), base = { 3: 0, 9: 0, 15: 0, 12: 0, 33: 0 };
    for (let k = 0; k < N; k++) if (muni[k]) { tot[flag[k]]++; if (code[k] in base) base[code[k]]++; }
    this.muniTot = Array.from(tot, (v) => v * this.pxHa);
    this.muniHa = tot.reduce((a, b) => a + b, 0) * this.pxHa;
    this.muniBase = Object.fromEntries(Object.entries(base).map(([c, v]) => [c, v * this.pxHa]));
    return this;
  }

  // NDVI médio (águas, seca) no quadrado de lado "size" graus em volta do ponto (os mapas do vigor têm ~15 m)
  #ndvi(lat, lon, size) {
    const { EXT } = this, { wet, dry } = this.vig;
    const x0 = ((lon - size / 2 - EXT.w) / (EXT.e - EXT.w)) * wet.w, x1 = ((lon + size / 2 - EXT.w) / (EXT.e - EXT.w)) * wet.w;
    const y0 = ((EXT.n - lat - size / 2) / (EXT.n - EXT.s)) * wet.h, y1 = ((EXT.n - lat + size / 2) / (EXT.n - EXT.s)) * wet.h;
    let sw = 0, sd = 0, n = 0;
    for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(wet.h - 1, Math.floor(y1 - 1e-6)); y++) {
      for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(wet.w - 1, Math.floor(x1 - 1e-6)); x++) {
        const k = (y * wet.w + x) * 4, a = nd(wet.d[k]), b = nd(dry.d[k]);
        if (!Number.isNaN(a) && !Number.isNaN(b)) { sw += a; sd += b; n++; }
      }
    }
    return n ? [sw / n, sd / n] : [NaN, NaN];
  }

  /** o mesmo teste no mapa de 10 m (data: um byte por pixel, grade G10), só os totais no município */
  totals10(data, G10, W10, H10) {
    const { G } = this, tot = new Float64Array(CHECKS.length);
    for (let j = 0; j < H10; j += 2) {
      const lat = G10.lat0 - (j + 0.5) * G10.d, gj = Math.floor((G.lat0 - lat) / G.d);
      if (gj < 0 || gj >= this.H) continue;
      for (let i = 0; i < W10; i += 2) {
        const lon = G10.lon0 + (i + 0.5) * G10.d, gi = Math.floor((lon - G.lon0) / G.d);
        if (gi < 0 || gi >= this.W || !this.muni[gj * this.W + gi]) continue;
        const c = data[j * W10 + i];
        if (c === 3 || c === 9 || c === 15 || c === 12 || c === 33) tot[check(c, ...this.#ndvi(lat, lon, G10.d * 2))]++;
      }
    }
    const px = (G10.d * 2 * 111320 * Math.cos((21.735 * Math.PI) / 180)) * (G10.d * 2 * 110574) / 1e4;
    return Array.from(tot, (v) => v * px);
  }

  /** textura de cor (linhas de sul para norte, como as do uso do solo): só os pixels que não batem */
  texture() {
    if (this.tex) return this.tex;
    const { W, H, flag } = this, out = new Uint8Array(W * H * 4);
    const pal = CHECKS.map((x) => (x ? [parseInt(x.c.slice(1, 3), 16), parseInt(x.c.slice(3, 5), 16), parseInt(x.c.slice(5, 7), 16)] : [0, 0, 0]));
    for (let j = 0; j < H; j++) {
      const row = (H - 1 - j) * W;
      for (let i = 0; i < W; i++) {
        const v = flag[j * W + i], o = (row + i) * 4;
        if (!v) continue;
        out[o] = pal[v][0]; out[o + 1] = pal[v][1]; out[o + 2] = pal[v][2]; out[o + 3] = 235;
      }
    }
    const tex = new THREE.DataTexture(out, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false; tex.needsUpdate = true;
    return (this.tex = tex);
  }

  /** conferência dentro de uma propriedade: { ha, flags: [ha por código], base: {classe: ha} } */
  statsFor(rings) {
    const { G, W, H } = this;
    let s = 90, n = -90, w = 180, e = -180;
    for (const r of rings) for (const [la, lo] of r) { s = Math.min(s, la); n = Math.max(n, la); w = Math.min(w, lo); e = Math.max(e, lo); }
    const i0 = Math.max(0, Math.floor((w - G.lon0) / G.d)), i1 = Math.min(W - 1, Math.ceil((e - G.lon0) / G.d));
    const j0 = Math.max(0, Math.floor((G.lat0 - n) / G.d)), j1 = Math.min(H - 1, Math.ceil((G.lat0 - s) / G.d));
    if (i1 < i0 || j1 < j0) return null;
    const cw = i1 - i0 + 1, ch = j1 - j0 + 1, cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
    const g = cv.getContext('2d', { willReadFrequently: true }); g.fillStyle = '#fff';
    for (const r of rings) { g.beginPath(); r.forEach(([la, lo], k) => g[k ? 'lineTo' : 'moveTo']((lo - G.lon0) / G.d - i0, (G.lat0 - la) / G.d - j0)); g.closePath(); g.fill(); }
    const m = g.getImageData(0, 0, cw, ch).data, flags = new Float64Array(CHECKS.length);
    let px = 0;
    for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
      if (m[(j * cw + i) * 4 + 3] < 128) continue;
      px++; flags[this.flag[(j0 + j) * W + i0 + i]]++;
    }
    return px ? { ha: px * this.pxHa, flags: Array.from(flags, (v) => v * this.pxHa) } : null;
  }
}
