// Acesso pela estrada: o menor caminho nas vias do OpenStreetMap da propriedade até o asfalto e até o centro de
// Andrelândia (Igreja Matriz, origem do sistema local). "Asfalto" = via com pavimento marcado no OSM (asphalt, paved,
// concrete…) ou rodovia principal (trunk/primary) sem marcação. Saída: da porteira mais próxima (via que passa
// dentro ou a até 30 m da divisa). O traçado e o pavimento do OSM podem estar incompletos: distâncias aproximadas.
import * as THREE from 'three';

const PAVED = new Set(['asphalt', 'paved', 'concrete', 'concrete:plates', 'concrete:lanes', 'paving_stones', 'sett', 'chipseal']);
const MAIN = new Set(['trunk', 'trunk_link', 'primary', 'primary_link']);
const SKIP = new Set(['footway', 'path', 'steps', 'cycleway', 'pedestrian', 'bridleway']);
const URBAN = new Set(['residential', 'living_street', 'service']);   // pavimento aqui é rua calçada, não rodovia
const STEP = 25, CELL = 250, NEAR = 30;

function segDist(px, pz, a, b) {
  const vx = b.x - a.x, vz = b.z - a.z, L = vx * vx + vz * vz;
  const u = L ? Math.max(0, Math.min(1, ((px - a.x) * vx + (pz - a.z) * vz) / L)) : 0;
  return Math.hypot(a.x + u * vx - px, a.z + u * vz - pz);
}

export class RoadAccess {
  constructor({ osm, frame }) { this.osm = osm; this.frame = frame; this.g = null; this.cache = new Map(); }

  // grafo das vias (densificado a cada ~25 m, para achar as que passam pela propriedade); feito no primeiro uso
  #build() {
    const fr = this.frame, xs = [], zs = [], la = [], lo = [], paved = [], label = [], adj = [], ids = new Map();
    const node = (lat, lon, x, z, key) => {
      if (key) { const id = ids.get(key); if (id !== undefined) return id; }
      const id = xs.length;
      xs.push(x); zs.push(z); la.push(lat); lo.push(lon); paved.push(0); label.push(null); adj.push([]);
      if (key) ids.set(key, id);
      return id;
    };
    const edge = (a, b, w, pv, lb) => {
      adj[a].push(b, w, pv); adj[b].push(a, w, pv);
      if (pv) { paved[a] = paved[b] = 1; label[a] ??= lb; label[b] ??= lb; }
    };
    for (const f of this.osm.features) {
      if (f.kind !== 'highway' || SKIP.has(f.sub)) continue;
      const pv = PAVED.has(f.surface) || (!f.surface && MAIN.has(f.sub)) ? 1 : 0;
      const lb = { name: f.ref?.split(';')[0] || f.name || null, urban: URBAN.has(f.sub) && !f.ref };
      for (const line of f.geom) {
        let prev = -1, pp = null;
        for (const [lat, lon] of line) {
          const p = fr.toLocal(lat, lon), id = node(lat, lon, p.x, p.z, `${lat},${lon}`);
          if (prev >= 0 && id !== prev) {
            const d = Math.hypot(p.x - pp.x, p.z - pp.z), n = Math.max(1, Math.ceil(d / STEP));
            let a = prev;
            for (let s = 1; s < n; s++) {
              const t = s / n, b = node(pp.lat + (lat - pp.lat) * t, pp.lon + (lon - pp.lon) * t, pp.x + (p.x - pp.x) * t, pp.z + (p.z - pp.z) * t, null);
              edge(a, b, d / n, pv, lb); a = b;
            }
            edge(a, id, d / n, pv, lb);
          }
          prev = id; pp = { x: p.x, z: p.z, lat, lon };
        }
      }
    }
    const grid = new Map(), key = (i, j) => i * 100003 + j;
    xs.forEach((x, i) => { const k = key(Math.floor(x / CELL), Math.floor(zs[i] / CELL)); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); });
    let city = 0, best = Infinity;
    xs.forEach((x, i) => { const d = x * x + zs[i] * zs[i]; if (d < best) { best = d; city = i; } });
    return { xs, zs, la, lo, paved, label, adj, grid, key, city, n: xs.length };
  }

  #near(x0, x1, z0, z1) {   // nós no retângulo (local)
    const g = this.g, out = [];
    for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++)
      for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL); j++) for (const id of g.grid.get(g.key(i, j)) ?? []) out.push(id);
    return out;
  }

  /**
   * { gap: m sem estrada até a divisa, asphalt: { m, name, urban, at, lines }, city: { m, dirt, lines } } ou null
   * lines = { dirt: [[lat, lon]…][], paved: [[lat, lon]…][] }
   */
  route(x) {
    if (this.cache.has(x.k)) return this.cache.get(x.k);
    this.g ??= this.#build();
    const g = this.g, fr = this.frame;
    const rings = x.f.rings.map((r) => r.map(([la, lo]) => fr.toLocal(la, lo)));
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const P of rings) for (const p of P) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
    // saídas: nós dentro da propriedade ou a até 30 m da divisa (máscara: preenchimento + traço largo)
    const res = Math.max(3, Math.max(x1 - x0, z1 - z0) / 1024), pad = NEAR + res;
    const cw = Math.ceil((x1 - x0 + 2 * pad) / res), ch = Math.ceil((z1 - z0 + 2 * pad) / res);
    const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
    const c2 = cv.getContext('2d', { willReadFrequently: true });
    c2.fillStyle = c2.strokeStyle = '#fff'; c2.lineWidth = (2 * NEAR) / res; c2.lineJoin = 'round';
    for (const P of rings) {
      c2.beginPath(); P.forEach((p, i) => c2[i ? 'lineTo' : 'moveTo']((p.x - x0 + pad) / res, (p.z - z0 + pad) / res));
      c2.closePath(); c2.fill(); c2.stroke();
    }
    const A = c2.getImageData(0, 0, cw, ch).data;
    const src = this.#near(x0 - pad, x1 + pad, z0 - pad, z1 + pad).filter((id) => {
      const i = Math.floor((g.xs[id] - x0 + pad) / res), j = Math.floor((g.zs[id] - z0 + pad) / res);
      return i >= 0 && j >= 0 && i < cw && j < ch && A[(j * cw + i) * 4 + 3] > 127;
    });
    let gap = 0;
    if (!src.length) {   // nenhuma via encosta: a mais próxima (até 5 km), em linha reta até a divisa
      for (let r = 250; r <= 5000 && !src.length; r += 250) {
        let best = -1, bd = Infinity;
        for (const id of this.#near(x0 - r, x1 + r, z0 - r, z1 + r)) {
          let d = Infinity;
          for (const P of rings) for (let i = 0; i < P.length - 1; i++) d = Math.min(d, segDist(g.xs[id], g.zs[id], P[i], P[i + 1]));
          if (d < bd) { bd = d; best = id; }
        }
        if (best >= 0 && bd <= r) { src.push(best); gap = bd; }
      }
    }
    if (!src.length) { this.cache.set(x.k, null); return null; }
    // Dijkstra com várias saídas; para quando achar o asfalto e o centro
    const N = g.n, dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), prevPv = new Uint8Array(N);
    const hk = [], hv = [];
    const push = (id, d) => {
      let i = hk.length; hk.push(d); hv.push(id);
      while (i > 0) { const p = (i - 1) >> 1; if (hk[p] <= d) break; hk[i] = hk[p]; hv[i] = hv[p]; i = p; }
      hk[i] = d; hv[i] = id;
    };
    const pop = () => {
      const id = hv[0], d = hk[0], lk = hk.pop(), lv = hv.pop();
      if (hk.length) {
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i, mk = lk;
          if (l < hk.length && hk[l] < mk) { m = l; mk = hk[l]; }
          if (r < hk.length && hk[r] < mk) { m = r; mk = hk[r]; }
          if (m === i) break;
          hk[i] = hk[m]; hv[i] = hv[m]; i = m;
        }
        hk[i] = lk; hv[i] = lv;
      }
      return [id, d];
    };
    for (const s of src) { dist[s] = 0; push(s, 0); }
    let asphalt = -1, city = -1;
    while (hk.length) {
      const [u, du] = pop();
      if (du > dist[u]) continue;
      if (asphalt < 0 && g.paved[u]) asphalt = u;
      if (u === g.city) city = u;
      if (asphalt >= 0 && city >= 0) break;
      const a = g.adj[u];
      for (let k = 0; k < a.length; k += 3) {
        const v = a[k], nd = du + a[k + 1];
        if (nd < dist[v]) { dist[v] = nd; prev[v] = u; prevPv[v] = a[k + 2]; push(v, nd); }
      }
    }
    // caminho da saída até o alvo, em trechos de terra e de asfalto
    const trace = (t) => {
      const ids = [];
      for (let u = t; u >= 0; u = prev[u]) ids.push(u);
      ids.reverse();
      const lines = { dirt: [], paved: [] };
      let dirt = 0, run = null, runPv = -1;
      for (let i = 1; i < ids.length; i++) {
        const a = ids[i - 1], b = ids[i], pv = prevPv[b];
        if (!pv) dirt += dist[b] - dist[a];
        if (pv !== runPv) { run = [[g.la[a], g.lo[a]]]; (pv ? lines.paved : lines.dirt).push(run); runPv = pv; }
        run.push([g.la[b], g.lo[b]]);
      }
      return { lines, dirt };
    };
    const out = { gap, asphalt: null, city: null };
    if (asphalt >= 0) out.asphalt = { m: dist[asphalt], name: g.label[asphalt]?.name ?? null, urban: !!g.label[asphalt]?.urban, at: [g.la[asphalt], g.lo[asphalt]], lines: trace(asphalt).lines };
    if (city >= 0) { const t = trace(city); out.city = { m: dist[city], dirt: t.dirt, lines: t.lines }; }
    this.cache.set(x.k, out);
    return out;
  }
}

/** desenho do caminho: terra em âmbar, asfalto em cinza-claro, marcador onde chega no asfalto */
export class AccessLayer {
  constructor({ vectors, scene, terrain }) {
    Object.assign(this, { vectors, terrain });
    this.marker = new THREE.Group();
    this.marker.add(
      new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 1, 0)]), new THREE.LineBasicMaterial({ color: 0xe6edf0 })),
      new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ color: 0xe6edf0 })),
    );
    this.marker.visible = false;
    scene.add(this.marker);
    this.r = null; this.batches = [];
  }

  show(r) {
    this.hide();
    if (!r) return;
    this.r = r;
    const dirt = [...(r.city?.lines.dirt ?? []), ...(r.asphalt?.lines.dirt ?? [])];
    const paved = [...(r.city?.lines.paved ?? []), ...(r.asphalt?.lines.paved ?? [])];
    if (dirt.length) this.batches.push(this.vectors.addLines('car-road-dirt', 'highlight', { color: 0xf2a84b, width: 4, lift: 7, opacity: 1, order: 7, noClip: true }, dirt, 20));
    if (paved.length) this.batches.push(this.vectors.addLines('car-road-paved', 'highlight', { color: 0xe6edf0, width: 4, lift: 7, opacity: 1, order: 7, noClip: true }, paved, 20));
    this.marker.visible = !!r.asphalt && r.asphalt.m >= 100;
    this.refresh();
  }

  hide() {
    this.r = null; this.batches = []; this.marker.visible = false;
    this.vectors.removeLines('car-road-dirt'); this.vectors.removeLines('car-road-paved');
  }

  setOpacity(k) { for (const b of this.batches) b.mat.opacity = k; }

  refresh() {
    if (!this.r?.asphalt) return;
    const h = 45 * Math.max(1, this.terrain.exaggeration);
    this.marker.position.copy(this.terrain.worldPosition(this.r.asphalt.at[0], this.r.asphalt.at[1]));
    this.marker.children[0].scale.set(1, h, 1);
    this.marker.children[1].position.y = h; this.marker.children[1].scale.setScalar(7);
  }
}

/** onde chega no asfalto: a rodovia (BR-494…) ou "rua calçada" quando o primeiro pavimento é rua de cidade/povoado */
const where = (a) => (!a ? '' : a.urban ? 'rua calçada' : a.name ?? '');

/** textos curtos para a ficha, a demonstração e a folha */
export function accessText(r, nf) {
  const km = (m) => (m >= 1000 ? `${nf(m / 1000, m < 10000 ? 1 : 0)} km` : `${nf(Math.round(m / 10) * 10)} m`);
  if (!r) return { city: 'Sem estrada no mapa por perto', asphalt: '', dirt: '', gap: '', km };
  return {
    km,
    city: r.city ? `${km(r.city.m)} até o centro de Andrelândia` : 'Sem ligação com a cidade pelas estradas do mapa',
    asphalt: !r.asphalt ? 'Sem asfalto alcançável pelas estradas do mapa' : r.asphalt.m < 100 ? 'O asfalto passa na propriedade' : `${km(r.asphalt.m)} até o asfalto${where(r.asphalt) ? ` (${where(r.asphalt)})` : ''}`,
    where: where(r.asphalt),
    dirt: r.city && r.city.dirt >= 50 ? `${km(r.city.dirt)} de terra no caminho até a cidade` : r.city ? 'Asfalto em todo o caminho até a cidade' : '',
    gap: r.gap ? `A estrada mais próxima fica a ${km(r.gap)} da divisa, sem caminho no mapa até lá.` : '',
  };
}
