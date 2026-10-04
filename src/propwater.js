// "Água da propriedade": de onde vem a água que passa por ela (todas as células cujo escoamento D8 acaba entrando
// nela), os córregos calculados dentro dela e as nascentes estimadas (cabeceiras dos trechos de 1ª ordem, como em
// tools/build_car_stats.py). Tudo calculado pelo relevo: é ilustrativo.
import * as THREE from 'three';
import { G, N8 } from './water.js';

function inRings(rings, lat, lon) {
  return rings.some((ring) => {
    let c = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ai, oi] = ring[i], [aj, oj] = ring[j];
      if ((ai > lat) !== (aj > lat) && lon < ((oj - oi) * (lat - ai)) / (aj - ai) + oi) c = !c;
    }
    return c;
  });
}

export class PropertyWater {
  constructor({ terrain, vectors, scene, drop, drainage }) {
    Object.assign(this, { terrain, vectors, drop, drainage });
    this.group = new THREE.Group(); this.group.name = 'prop-water';
    scene.add(this.group);
    this.ballGeo = new THREE.SphereGeometry(1, 12, 8);
    this.ballMat = new THREE.MeshBasicMaterial({ color: 0x8fe6ff });
    this.stemMat = new THREE.LineBasicMaterial({ color: 0x8fe6ff });
    this.stemGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 1, 0)]);
    this.x = null; this.springs = [];
  }

  /** liga para a propriedade x; devolve { upHa, edge, springs, river } */
  async show(x) {
    this.hide();
    await this.drop.load();
    this.x = x;
    const fd = this.drop.fdir, W = G.w, H = G.h, rings = x.f.rings;
    // 1. a propriedade na grade de 30 m (um pixel de canvas por célula)
    let s = 90, n = -90, w = 180, e = -180;
    for (const r of rings) for (const [la, lo] of r) { s = Math.min(s, la); n = Math.max(n, la); w = Math.min(w, lo); e = Math.max(e, lo); }
    const i0 = Math.max(0, Math.floor((w - G.lon0) / G.d)), i1 = Math.min(W - 1, Math.floor((e - G.lon0) / G.d));
    const j0 = Math.max(0, Math.floor((G.lat0 - n) / G.d)), j1 = Math.min(H - 1, Math.floor((G.lat0 - s) / G.d));
    const mark = new Uint8Array(W * H), q = (this.queue ??= new Int32Array(W * H));
    let qt = 0;
    if (i1 >= i0 && j1 >= j0) {
      const cw = i1 - i0 + 1, ch = j1 - j0 + 1, cv = document.createElement('canvas');
      cv.width = cw; cv.height = ch;
      const g = cv.getContext('2d', { willReadFrequently: true });
      g.fillStyle = '#fff';
      for (const r of rings) {
        g.beginPath();
        r.forEach(([la, lo], k) => g[k ? 'lineTo' : 'moveTo']((lo - G.lon0) / G.d - i0, (G.lat0 - la) / G.d - j0));
        g.closePath(); g.fill();
      }
      const px = g.getImageData(0, 0, cw, ch).data;
      for (let jj = 0; jj < ch; jj++) for (let ii = 0; ii < cw; ii++) {
        if (px[(jj * cw + ii) * 4 + 3] < 128) continue;
        const k = (j0 + jj) * W + i0 + ii; mark[k] = 1; q[qt++] = k;
      }
      if (!qt) { const k = Math.round((j0 + j1) / 2) * W + Math.round((i0 + i1) / 2); mark[k] = 1; q[qt++] = k; }   // menor que uma célula
    }
    // 2. de onde vem a água: de trás para frente no D8 (vizinhas que escoam para uma célula já marcada)
    let up = 0, edge = false, bi0 = W, bi1 = -1, bj0 = H, bj1 = -1;
    for (let qh = 0; qh < qt; qh++) {
      const k = q[qh], j = (k / W) | 0, i = k - j * W;
      for (let c = 0; c < 8; c++) {
        const jj = j - N8[c][0], ii = i - N8[c][1];
        if (jj < 0 || ii < 0 || jj >= H || ii >= W) continue;
        const kk = jj * W + ii;
        if (mark[kk] || fd[kk] !== c + 1) continue;
        mark[kk] = 2; q[qt++] = kk; up++;
        if (ii <= 1 || jj <= 1 || ii >= W - 2 || jj >= H - 2) edge = true;
        if (ii < bi0) bi0 = ii; if (ii > bi1) bi1 = ii; if (jj < bj0) bj0 = jj; if (jj > bj1) bj1 = jj;
      }
    }
    if (up) {
      const mw = bi1 - bi0 + 1, mh = bj1 - bj0 + 1, data = new Uint8Array(mw * mh);
      for (let r = 0; r < mh; r++) {   // linha 0 da textura = a mais ao sul
        const row = (bj1 - r) * W + bi0;
        for (let ii = 0; ii < mw; ii++) if (mark[row + ii] === 2) data[r * mw + ii] = 255;
      }
      this.terrain.setUpstream({ data, w: mw, h: mh, i0: bi0, j0: bj0, gw: W, gh: H });
    }
    const lat = (n + s) / 2, cellHa = (G.d * 110574 * G.d * 111320 * Math.cos((lat * Math.PI) / 180)) / 1e4;

    // 3. córregos dentro dela (trechos cujo meio cai dentro), em três espessuras pela ordem
    const lines = [[], [], []];
    let river = 0;
    for (const f of this.drainage.features) {
      let run = null;
      for (let k = 0; k < f.geom.length - 1; k++) {
        const [la1, lo1] = f.geom[k], [la2, lo2] = f.geom[k + 1], ml = (la1 + la2) / 2, mo = (lo1 + lo2) / 2;
        const inside = ml >= s && ml <= n && mo >= w && mo <= e && inRings(rings, ml, mo);
        if (inside) { if (!run) { run = [f.geom[k]]; lines[f.order <= 2 ? 0 : f.order <= 4 ? 1 : 2].push(run); river = Math.max(river, f.order); } run.push(f.geom[k + 1]); }
        else run = null;
      }
    }
    [[1.8, 0], [2.6, 1], [3.4, 2]].forEach(([width, b]) => {
      if (lines[b].length) this.vectors.addLines(`car-water-${b}`, 'highlight', { color: 0x6fd6ff, width, lift: 3.5, opacity: 1, order: 6, noClip: true }, lines[b], 20);
    });

    // 4. nascentes estimadas: começo dos trechos de 1ª ordem (pela altitude, o lado mais alto)
    const hf = this.terrain.hf;
    for (const f of this.drainage.features) {
      if (f.order !== 1) continue;
      let a = f.geom[0];
      const b = f.geom.at(-1);
      if (hf.elevation(a[0], a[1]) < hf.elevation(b[0], b[1])) a = b;
      if (a[0] < s || a[0] > n || a[1] < w || a[1] > e || !inRings(rings, a[0], a[1])) continue;
      const m = new THREE.Group();
      m.add(new THREE.Line(this.stemGeo, this.stemMat), new THREE.Mesh(this.ballGeo, this.ballMat));
      this.group.add(m); this.springs.push({ m, at: a });
    }
    this.refresh();
    return { upHa: up * cellHa, edge, springs: this.springs.length, river };
  }

  hide() {
    if (!this.x) return;
    this.x = null;
    this.terrain.setUpstream(null);
    for (let b = 0; b < 3; b++) this.vectors.removeLines(`car-water-${b}`);
    this.group.clear(); this.springs = [];
  }

  /** alturas dos marcadores (ao ligar e ao mudar o exagero do relevo) */
  refresh() {
    const h = 25 * Math.max(1, this.terrain.exaggeration);
    for (const { m, at } of this.springs) {
      m.position.copy(this.terrain.worldPosition(at[0], at[1]));
      m.children[0].scale.set(1, h, 1);
      m.children[1].position.y = h; m.children[1].scale.setScalar(5);
    }
  }
}
