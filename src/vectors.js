// Camadas vetoriais assentadas sobre o relevo: vias, ferrovia, rios, drenagem e edificações.
// As linhas são densificadas (~12 m) e recebem a altura do modelo ativo; ao trocar de modelo
// ou de exagero, só as alturas são recalculadas.
import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

// estilos por classe (cores de carta: vias em amarelo/branco, ferrovia escura, hidrografia azul)
const STYLES = {
  trunk:       { color: 0xf3b23a, width: 3.0, lift: 4 },
  tertiary:    { color: 0xf7dc8a, width: 2.0, lift: 3.5 },
  unclassified:{ color: 0xf1e6c8, width: 1.4, lift: 3 },
  residential: { color: 0xffffff, width: 1.3, lift: 3 },
  service:     { color: 0xf4efe4, width: 1.0, lift: 3 },
  path:        { color: 0xe9d7b6, width: 1.0, lift: 3, dashed: true },
  railway:     { color: 0x5b2a1c, width: 2.0, lift: 4.5, dashed: true },
  river:       { color: 0x2f8fe0, width: 2.4, lift: 2.5 },
  stream:      { color: 0x55aef0, width: 1.4, lift: 2.5 },
  boundary:    { color: 0xd94f8a, width: 2.6, lift: 6, dashed: true, dashSize: 40, gapSize: 22 },
};
const HIGHWAY_CLASS = {
  trunk: 'trunk', trunk_link: 'trunk', primary: 'trunk', primary_link: 'trunk', secondary: 'tertiary', tertiary: 'tertiary',
  unclassified: 'unclassified', residential: 'residential', living_street: 'residential',
  service: 'service', track: 'path', path: 'path', footway: 'path',
};
const DRAIN_WIDTH = [0, 0.6, 0.8, 1.1, 1.5, 2.0, 2.4, 2.8];
// quanto cada camada some quando uma propriedade está escolhida (o contorno dela, "highlight", não muda)
const DIM_FADE = { car: 0.65, roads: 0.45, water: 0.35, drainage: 0.45, flow: 0.45, boundary: 0.3 };
// distância câmera→alvo (m) acima da qual a classe some
const MINOR_LIMIT = { 'flow-s': 9000, 'flow-m': 20000, drain1: 7000, drain2: 12000, drain3: 20000, residential: 14000, service: 9000, path: 9000, unclassified: 26000 };

function densify(latlons, frame, step = 12) {
  const out = [];
  for (let k = 0; k < latlons.length; k++) {
    const [lat, lon] = latlons[k];
    const p = frame.toLocal(lat, lon);
    if (k > 0) {
      const q = out[out.length - 1];
      const n = Math.floor(Math.hypot(p.x - q.x, p.z - q.z) / step);
      for (let s = 1; s <= n; s++) {
        const t = s / (n + 1);
        out.push({ x: q.x + (p.x - q.x) * t, z: q.z + (p.z - q.z) * t });
      }
    }
    out.push({ x: p.x, z: p.z });
  }
  return out;
}

export class VectorLayers {
  constructor(terrain, { osm, drainage, boundary }) {
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.group.name = 'vectors';
    this.batches = [];       // { key, lines: [[{x,z}]], mesh, lift, layer }
    this.materials = [];
    this.buildings = [];     // { mesh, ring, levels }
    this.sublayers = { roads: new THREE.Group(), water: new THREE.Group(), drainage: new THREE.Group(), buildings: new THREE.Group(), boundary: new THREE.Group() };
    Object.values(this.sublayers).forEach((g) => this.group.add(g));

    const buckets = new Map();
    const push = (key, layer, style, line) => {
      if (!buckets.has(key)) buckets.set(key, { key, layer, style, lines: [] });
      buckets.get(key).lines.push(line);
    };
    const frame = terrain.frame;
    for (const f of osm.features) {
      if (f.kind === 'highway' && HIGHWAY_CLASS[f.sub]) {
        const cls = HIGHWAY_CLASS[f.sub];
        for (const g of f.geom) push(cls, 'roads', STYLES[cls], densify(g, frame, 30));
      } else if (f.kind === 'railway') {
        for (const g of f.geom) push('railway', 'roads', STYLES.railway, densify(g, frame, 30));
      } else if (f.kind === 'waterway') {
        const cls = f.sub === 'river' ? 'river' : 'stream';
        for (const g of f.geom) push(cls, 'water', STYLES[cls], densify(g, frame, 30));
      } else if (f.kind === 'building') {
        for (const g of f.geom) this.#addBuilding(g, f.levels);
      }
    }
    for (const f of drainage.features) {
      const o = Math.min(f.order, 7);
      push(`drain${o}`, 'drainage', { color: 0x6cc4ff, width: DRAIN_WIDTH[o], lift: 2, opacity: 0.55 + 0.06 * o }, densify(f.geom, frame, 40));
    }
    if (boundary) push('boundary', 'boundary', STYLES.boundary, densify(boundary.ring, frame, 50));

    for (const b of buckets.values()) this.#makeBatch(b);
    this.update();
  }

  #makeBatch(b) {
    {
      const mat = new LineMaterial({
        color: b.style.color, linewidth: b.style.width, transparent: true, opacity: b.style.opacity ?? 0.95,
        dashed: !!b.style.dashed, dashSize: b.style.dashSize ?? 14, gapSize: b.style.gapSize ?? 10, worldUnits: false, fog: true,
      });
      this.materials.push(mat);
      const geo = new LineSegmentsGeometry();
      const mesh = new LineSegments2(geo, mat);
      mesh.renderOrder = b.layer === 'drainage' ? 1 : b.layer === 'water' ? 2 : b.layer === 'boundary' ? 4 : b.style.order ?? 3;
      if (!this.sublayers[b.layer]) { this.sublayers[b.layer] = new THREE.Group(); this.group.add(this.sublayers[b.layer]); }
      this.sublayers[b.layer].add(mesh);
      const batch = { ...b, mesh, mat };
      this.batches.push(batch);
      if (this.resolution) mat.resolution.copy(this.resolution);
      this.#applyDim(batch);
      return batch;
    }
  }

  /** acrescenta linhas (lat/lon) numa camada; substitui o lote se a chave já existir */
  addLines(key, layer, style, latlonLines, step = 30) {
    this.removeLines(key);
    const lines = latlonLines.map((l) => densify(l, this.terrain.frame, step));
    const b = this.#makeBatch({ key, layer, style, lines });
    this.#updateBatch(b);
    return b;
  }
  removeLines(key) {
    const i = this.batches.findIndex((b) => b.key === key);
    if (i < 0) return;
    const b = this.batches[i];
    b.mesh.removeFromParent(); b.mesh.geometry.dispose(); b.mat.dispose();
    this.materials = this.materials.filter((m) => m !== b.mat);
    this.batches.splice(i, 1);
  }

  #addBuilding(ring, levels) {
    const frame = this.terrain.frame;
    const pts = ring.map(([lat, lon]) => frame.toLocal(lat, lon));
    const shape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p.x, -p.z)));
    const h = (parseFloat(levels) || 2) * 3.2;
    const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2); // extrusão para cima (+y); shape em (x, -z)
    const mesh = new THREE.Mesh(geo, this.buildingMaterial ??= new THREE.MeshLambertMaterial({ color: 0xf1ece2 }));
    this.sublayers.buildings.add(mesh);
    this.buildings.push({ mesh, pts, h });
  }

  // recalcula alturas (troca de modelo, exagero)
  update() {
    const t = this.terrain;
    const y = (p, lift) => t.groundY(p.x, p.z) + lift * Math.max(1, t.exaggeration);
    // recorta no retângulo do terreno (no plano local a extensão lat/lon é um retângulo)
    const ext = t.bounds ? t.bounds() : null;
    const nw = ext ? t.frame.toLocal(ext.n, ext.w) : null, se = ext ? t.frame.toLocal(ext.s, ext.e) : null;
    const clip = !!t.clipped;
    const inExt = (p) => !ext || (p.x >= nw.x && p.x <= se.x && p.z >= nw.z && p.z <= se.z);
    this.#ctx = { y, inExt, clip, t };
    for (const b of this.batches) this.#updateBatch(b);
    this.#updateBuildings();
  }

  #ctx = null;
  #updateBatch(b) {
    if (!this.#ctx) {
      const t = this.terrain;
      const ext = t.bounds(), nw = t.frame.toLocal(ext.n, ext.w), se = t.frame.toLocal(ext.s, ext.e);
      this.#ctx = { t, clip: !!t.clipped, y: (p, lift) => t.groundY(p.x, p.z) + lift * Math.max(1, t.exaggeration),
        inExt: (p) => p.x >= nw.x && p.x <= se.x && p.z >= nw.z && p.z <= se.z };
    }
    const { y, inExt, clip, t } = this.#ctx;
    {
      const arr = [];
      for (const line of b.lines) {
        for (let k = 0; k < line.length - 1; k++) {
          const a = line[k], c = line[k + 1];
          if (!inExt(a) || !inExt(c)) continue;
          if (clip && b.layer !== 'boundary' && !b.style.noClip && (!t.insideLocal(a.x, a.z) || !t.insideLocal(c.x, c.z))) continue;
          arr.push(a.x, y(a, b.style.lift), a.z, c.x, y(c, b.style.lift), c.z);
        }
      }
      b.mesh.geometry.dispose();
      b.mesh.geometry = new LineSegmentsGeometry().setPositions(arr);
      if (b.style.dashed) b.mesh.computeLineDistances();
    }
  }

  #updateBuildings() {
    const t = this.terrain;
    for (const bl of this.buildings) {
      // base no ponto mais baixo do contorno, para não flutuar na encosta
      const base = Math.min(...bl.pts.map((p) => t.groundY(p.x, p.z)));
      bl.mesh.position.y = base;
      bl.mesh.scale.y = Math.max(1, t.exaggeration * 0.75);
    }
  }

  setTerrain(terrain) { this.terrain = terrain; this.update(); }

  setResolution(w, h) {
    this.resolution = new THREE.Vector2(w, h);
    for (const m of this.materials) m.resolution.set(w, h);
  }

  // correnteza: os traços andam rio abaixo (as linhas da drenagem vão da nascente para a foz)
  animate(dt) {
    for (const b of this.batches) if (b.style.flow && b.mesh.visible) b.mat.dashOffset = (b.mat.dashOffset - dt * b.style.flow) % (b.mat.dashSize + b.mat.gapSize);
  }

  setVisible(layer, v) { if (this.sublayers[layer]) this.sublayers[layer].visible = v; }

  // linhas mais apagadas enquanto uma propriedade está escolhida (k: 0–1)
  dim = 0; far = 0;
  setDim(k) { this.dim = k; for (const b of this.batches) this.#applyDim(b); }
  #applyDim(b) { b.mat.opacity = (b.style.opacity ?? 0.95) * (1 - this.dim * (DIM_FADE[b.layer] ?? 0)) * (b.layer === 'car' ? 1 - 0.6 * this.far : 1); }

  // detalhe por distância: vias locais e córregos pequenos só aparecem de perto
  setViewDistance(d) {
    // contornos do CAR mais transparentes de longe (vista do município inteiro)
    const far = Math.round(Math.min(1, Math.max(0, (d - 10000) / 25000)) * 20) / 20;
    if (far !== this.far) { this.far = far; for (const b of this.batches) if (b.layer === 'car') this.#applyDim(b); }
    for (const b of this.batches) {
      const lim = MINOR_LIMIT[b.key] ?? b.style.maxDist;
      if (lim && lim !== Infinity) b.mesh.visible = d < lim;
    }
  }
}
