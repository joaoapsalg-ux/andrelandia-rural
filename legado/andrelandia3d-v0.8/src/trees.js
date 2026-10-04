// Árvores 3D nas matas e eucaliptais perto da câmera.
// Onde: classes de árvores do MapBiomas (30 m) e/ou copas > 8 m; altura: modelo de copas (Copernicus − ANADEM).
// Construídas por célula do terreno, só nas células próximas, e descartadas ao se afastar.
import * as THREE from 'three';
import { EXTENT } from '../data/muni/grid.js';
import { GRIDS, TREE_CLASSES } from '../data/muni/landuse.js';

const NEAR = 2600, FAR = 3600, SPACING = 13, MAX_PER_CELL = 9000;

async function imagePixels(url) {
  const bmp = await createImageBitmap(await (await fetch(url)).blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const cv = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
  const out = new Uint8Array(bmp.width * bmp.height);
  for (let k = 0; k < out.length; k++) out[k] = d[k * 4];
  return { w: bmp.width, h: bmp.height, px: out };
}

// gerador pseudoaleatório determinístico por posição
function hash(i, j) {
  let h = (i * 374761393 + j * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

export class Trees {
  constructor(terrain, scene) {
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.group.name = 'trees';
    scene.add(this.group);
    this.enabled = true;
    this.ready = false;
    this.byCell = new Map();
    // copas redondas (mata) e cônicas (eucalipto) + troncos
    this.geoNative = new THREE.IcosahedronGeometry(1, 1);
    this.geoEuc = new THREE.ConeGeometry(1, 1, 7); this.geoEuc.translate(0, 0.5, 0);
    this.geoTrunk = new THREE.CylinderGeometry(0.18, 0.28, 1, 5); this.geoTrunk.translate(0, 0.5, 0);
    this.matCrown = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    this.matTrunk = new THREE.MeshLambertMaterial({ color: 0x5a4632 });
  }

  async load(canopyUrl, landuseUrl) {
    const [chm, lc] = await Promise.all([imagePixels(canopyUrl), imagePixels(landuseUrl)]);
    this.chm = chm; this.lc = lc; this.ready = true;
  }

  #sample(lat, lon) {
    const c = this.chm, g = GRIDS.g30, l = this.lc;
    const ci = Math.floor(((lon - EXTENT.w) / (EXTENT.e - EXTENT.w)) * c.w), cj = Math.floor(((EXTENT.n - lat) / (EXTENT.n - EXTENT.s)) * c.h);
    const li = Math.floor((lon - g.lon0) / g.d), lj = Math.floor((g.lat0 - lat) / g.d);
    if (ci < 0 || cj < 0 || ci >= c.w || cj >= c.h || li < 0 || lj < 0 || li >= l.w || lj >= l.h) return null;
    return { h: c.px[cj * c.w + ci] / 6, cls: l.px[lj * l.w + li] };
  }

  #build(cell) {
    const t = this.terrain, f = t.frame, hf = t.hf;
    const items = [];
    const nx = Math.floor((cell.maxX - cell.minX) / SPACING), nz = Math.floor((cell.maxZ - cell.minZ) / SPACING);
    for (let j = 0; j < nz && items.length < MAX_PER_CELL; j++) {
      for (let i = 0; i < nx && items.length < MAX_PER_CELL; i++) {
        const gi = Math.round(cell.minX / SPACING) + i, gj = Math.round(cell.minZ / SPACING) + j;
        const r1 = hash(gi, gj), r2 = hash(gj + 7, gi + 3), r3 = hash(gi + 11, gj - 5);
        const x = cell.minX + (i + r1) * SPACING, z = cell.minZ + (j + r2) * SPACING;
        const { lat, lon } = f.toLatLon(x, z);
        if (t.clipped && !t.insideLocal(x, z)) continue;
        const s = this.#sample(lat, lon);
        if (!s) continue;
        const isTreeClass = TREE_CLASSES.has(s.cls);
        if (!isTreeClass && s.h < 8) continue;           // fora das matas, só copas altas de verdade
        if (r3 > (isTreeClass ? 0.95 : 0.6)) continue;     // falhas naturais no dossel
        // altura: modelo de copas; onde ele não "vê" a mata (copas baixas/ruído), usa um valor típico
        const h0 = s.h >= 3 ? s.h : (s.cls === 9 ? 14 : 8);
        const h = Math.min(32, Math.max(4.5, h0)) * (0.82 + 0.3 * r3);
        items.push({ x, z, h, euc: s.cls === 9, ground: hf.elevation(lat, lon), r: r1 });
      }
    }
    const nNat = items.filter((it) => !it.euc).length, nEuc = items.length - nNat;
    const crownsN = new THREE.InstancedMesh(this.geoNative, this.matCrown, Math.max(1, nNat));
    const crownsE = new THREE.InstancedMesh(this.geoEuc, this.matCrown, Math.max(1, nEuc));
    const trunks = new THREE.InstancedMesh(this.geoTrunk, this.matTrunk, Math.max(1, items.length));
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(), col = new THREE.Color();
    let a = 0, b = 0;
    items.forEach((it, k) => {
      const y0 = t.sceneY(it.ground);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.r * 6.28);
      if (it.euc) {
        const crownH = it.h * 0.72, rad = 1.8 + it.h * 0.07;
        p.set(it.x, y0 + it.h - crownH, it.z); sc.set(rad, crownH, rad);
        m.compose(p, q, sc); crownsE.setMatrixAt(b, m);
        crownsE.setColorAt(b, col.setHSL(0.28 + it.r * 0.04, 0.25, 0.12 + it.r * 0.05)); b++;
        p.set(it.x, y0, it.z); sc.set(1, it.h - crownH + 0.5, 1);
      } else {
        const crownH = it.h * 0.6, rad = 3.6 + it.h * 0.2;
        p.set(it.x, y0 + it.h - crownH / 2, it.z); sc.set(rad, crownH / 2, rad * (0.85 + it.r * 0.3));
        m.compose(p, q, sc); crownsN.setMatrixAt(a, m);
        crownsN.setColorAt(a, col.setHSL(0.25 + it.r * 0.06, 0.45 + it.r * 0.15, 0.09 + it.r * 0.06)); a++;
        p.set(it.x, y0, it.z); sc.set(1, it.h - crownH + 0.3, 1);
      }
      m.compose(p, q, sc); trunks.setMatrixAt(k, m);
    });
    crownsN.count = a; crownsE.count = b; trunks.count = items.length;
    for (const im of [crownsN, crownsE, trunks]) { im.frustumCulled = false; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
    const g = new THREE.Group();
    g.add(crownsN, crownsE, trunks);
    return { group: g, count: items.length };
  }

  update() {
    if (!this.ready) return;
    const show = this.enabled && this.terrain.hf.label?.includes?.('ANADEM');
    this.group.visible = show;
    if (!show) return;
    let builds = 0;
    const cells = [...this.terrain.cells].sort((a, b) => a.dist - b.dist);
    for (const cell of cells) {
      const key = `${cell.r}_${cell.c}`;
      const have = this.byCell.get(key);
      if (cell.dist < NEAR && !have && builds < 1) {
        const built = this.#build(cell);
        this.group.add(built.group);
        this.byCell.set(key, built);
        builds++;
      } else if (have && cell.dist > FAR) {
        this.#drop(key, have);
      }
    }
  }

  #drop(key, have) {
    this.group.remove(have.group);
    have.group.children.forEach((im) => im.dispose());
    this.byCell.delete(key);
  }

  // exagero, modelo ou recorte mudaram: refaz tudo aos poucos
  reset() { for (const [k, v] of this.byCell) this.#drop(k, v); }

  setEnabled(v) { this.enabled = v; if (!v) this.reset(); }

  count() { let n = 0; for (const v of this.byCell.values()) n += v.count; return n; }
}
