// Imóveis rurais do CAR: contornos e preenchimento coloridos por critério, sobreposições, APP estimada,
// destaque ao passar o mouse, rótulos de área de perto e a ficha de cada imóvel.
// Dados: data/muni/layers/car.json (ficha "s" calculada por tools/build_car_stats.py) e car_id.png
// (raster de identificação usado pelo shader do terreno).
import * as THREE from 'three';
import { CLASSES } from '../data/muni/landuse.js';

const GRAY = '#a8a49a';
export const GROUP_COLORS = ['#1f8d49', '#d6bc74', '#efe3a1', '#d68fe2', '#7a5900', '#b9b9b9'];

// gráfico de áreas empilhadas (% da área por grupo de uso, ano a ano)
export function histChart(hist, years, groups, { w = 300, h = 96 } = {}) {
  const x0 = years[0], x1 = years.at(-1), X = (y) => 2 + ((y - x0) / (x1 - x0)) * (w - 4), Y = (p) => 4 + (1 - p / 100) * (h - 18);
  const acc = years.map(() => 0);
  let paths = '';
  groups.forEach((g, i) => {
    const lo = acc.slice(), hi = acc.map((v, k) => v + hist[k][i]);
    hi.forEach((v, k) => { acc[k] = v; });
    const top = years.map((y, k) => `${X(y).toFixed(1)},${Y(hi[k]).toFixed(1)}`), bot = years.map((y, k) => `${X(y).toFixed(1)},${Y(lo[k]).toFixed(1)}`).reverse();
    paths += `<polygon points="${top.concat(bot).join(' ')}" fill="${GROUP_COLORS[i]}"><title>${g}</title></polygon>`;
  });
  const ticks = years.filter((y) => years.length <= 8 || (y - x0) % 10 === 0 || y === x1).map((y) => `<line x1="${X(y)}" x2="${X(y)}" y1="${h - 14}" y2="${h - 11}" stroke="currentColor" stroke-opacity=".5"/><text x="${X(y)}" y="${h - 2}" text-anchor="${y === x0 ? 'start' : y === x1 ? 'end' : 'middle'}">${y}</text>`).join('');
  return `<svg class="hist-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Uso do solo de ${x0} a ${x1}">${paths}${ticks}</svg>`;
}
const STATUS = (f) => {
  const c = f.cond || '';
  if (c.startsWith('Analisado, em conformidade') && c.includes('ativos')) return 4;
  if (c.startsWith('Analisado, em conformidade')) return 3;
  if (c.includes('regularização')) return 2;
  if (c.includes('notificação') && c.startsWith('Analisado')) return 1;
  return 0;
};
const step = (v, cuts) => { let i = 0; while (i < cuts.length && v >= cuts[i]) i++; return i; };
/** classe de relevo (Embrapa) pela declividade média em graus */
export function relevoOf(deg) {
  const p = Math.tan((deg * Math.PI) / 180) * 100;
  return p < 3 ? 'plano' : p < 8 ? 'suave ondulado' : p < 20 ? 'ondulado' : p < 45 ? 'forte ondulado' : 'montanhoso';
}

// critérios de cor: cada um devolve o índice da faixa (ou -1 = sem dado)
export const CRITERIA = {
  tamanho: {
    label: 'Tamanho (módulos fiscais)',
    buckets: [['Minifúndio (< 1 MF)', '#fde68a', 1.0], ['Pequena (1–4 MF)', '#fbbf24', 1.3], ['Média (4–15 MF)', '#f97316', 1.8], ['Grande (> 15 MF)', '#dc2626', 2.4]],
    of: (f) => ({ mini: 0, pequena: 1, media: 2, grande: 3 })[f.cls] ?? -1,
  },
  nativa: {
    label: 'Vegetação nativa em 2025',
    note: 'Mata, cerrado, campo nativo e área úmida (MapBiomas 30 m).',
    buckets: [['menos de 10%', '#f3ead0'], ['10–25%', '#d3e3a4'], ['25–50%', '#93c47d'], ['50–75%', '#4b9b58'], ['75% ou mais', '#1d6b3a']],
    of: (f) => f.s ? step(f.s.n25, [10, 25, 50, 75]) : -1,
  },
  mudanca: {
    label: 'Vegetação nativa: 1985 → 2025',
    note: 'Diferença em pontos percentuais da área do imóvel (MapBiomas 30 m).',
    buckets: [['perdeu 20 pp ou mais', '#a6611a'], ['perdeu 5–20 pp', '#dfc27d'], ['estável (±5 pp)', '#e9e5da'], ['ganhou 5–20 pp', '#80cdc1'], ['ganhou 20 pp ou mais', '#018571']],
    of: (f) => f.s ? step(f.s.n25 - f.s.n85, [-20, -5, 5, 20]) : -1,
  },
  app: {
    label: 'APP estimada com vegetação nativa',
    note: 'Faixa integral do Código Florestal estimada pelo app (margens, nascentes, encostas > 45°).',
    buckets: [['menos de 25%', '#c2412d'], ['25–50%', '#ef8a47'], ['50–75%', '#f2cf63'], ['75% ou mais', '#2f8f5b'], ['sem APP estimada', '#c9c4b8']],
    of: (f) => !f.s ? -1 : f.s.app[0] < 0.1 ? 4 : step(f.s.app[1], [25, 50, 75]),
  },
  declive: {
    label: 'Declividade média',
    buckets: [['menos de 5°', '#fbf3dc'], ['5–10°', '#f4d29c'], ['10–15°', '#e0a065'], ['15–20°', '#b86b3c'], ['20° ou mais', '#7a3d22']],
    of: (f) => f.s ? step(f.s.sl, [5, 10, 15, 20]) : -1,
  },
  sol: {
    label: 'Sol no inverno',
    note: 'Sol direto em 21 de junho, céu limpo, média do imóvel (kWh por m² por dia). Encostas viradas para o norte recebem mais.',
    buckets: [['menos de 3,0', '#3a1f55'], ['3,0–3,5', '#8a2c6a'], ['3,5–4,0', '#d9544a'], ['4,0–4,5', '#f59e3a'], ['4,5 ou mais', '#fbe7a0']],
    of: (f) => f.s?.sol ? step(f.s.sol[0], [3, 3.5, 4, 4.5]) : -1,
  },
  geada: {
    label: 'Baixadas frias (geada)',
    note: 'Parte do imóvel em baixada onde o ar frio se acumula. Mapa ilustrativo.',
    buckets: [['menos de 5%', '#e9e2cf'], ['5–15%', '#b9d4ea'], ['15–30%', '#7fb2dd'], ['30% ou mais', '#3b7fc0']],
    of: (f) => f.s?.gea != null ? step(f.s.gea, [5, 15, 30]) : -1,
  },
  vigor: {
    label: 'Vigor do pasto (águas 2026)',
    note: 'NDVI médio do pasto de cada propriedade nas águas de 2026 (Sentinel-2), comparado com as outras do município: cada faixa tem ¼ das propriedades com pasto.',
    buckets: [['fraco', '#b5651d'], ['abaixo da média', '#d9b45a'], ['acima da média', '#8cbf5a'], ['forte', '#2f8a3c'], ['pouco pasto (< 1 ha)', '#c9c4b8']],
    q: null,   // quartis das propriedades (CarLayer.loadVigor)
    of: (f) => {
      const v = f.vg, q = CRITERIA.vigor.q;
      if (v === undefined || !q) return -1;
      return !v || v[0] < 1 || v[3] == null ? 4 : step(v[3], q);
    },
  },
  situacao: {
    label: 'Situação do cadastro',
    buckets: [['Aguardando ou em análise', '#bdb6a8'], ['Analisado, com notificação', '#ef8a47'], ['Aguardando regularização', '#c2412d'], ['Em conformidade', '#5aa469'], ['Em conformidade, com excedente', '#1d6b3a']],
    of: STATUS,
  },
};

// ícones dos cartões do resumo (traço, 24 × 24)
const RS_ICON = {
  'Uso hoje': 'M5 19c0-8 6-14 14-14 0 8-6 14-14 14Z M5 19l7-7',
  'Vigor do pasto': 'M12 20v-8 M12 12c0-4-3-6-7-6 0 4 3 6 7 6Z M12 10c0-3 2-5 6-5 0 3-2 5-6 5Z',
  'Água': 'M12 3c3.5 4.6 6 8 6 11a6 6 0 0 1-12 0c0-3 2.5-6.4 6-11Z',
  'Relevo': 'M3 19 9 9l4 6 2-3 6 7Z',
  'Sol e geada': 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z M12 2v2 M12 20v2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M2 12h2 M20 12h2 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4',
  'Clima': 'M7 15a4 4 0 1 1 .8-7.9A5 5 0 0 1 17.5 9 3.5 3.5 0 0 1 17 15Z M9 18l-1 2 M13 18l-1 2 M17 18l-1 2',
  'Solo provável': 'M3 7h18 M3 12h18 M3 17h18 M7 7v5 M15 12v5 M10 17v4',
  'Acesso': 'M8 3 5 21 M16 3l3 18 M12 5v3 M12 11v3 M12 17v3',
  'Vizinhos': 'M4 21V8l2-3 2 3v13 M16 21V8l2-3 2 3v13 M4 11h16 M4 17h16',
  'Desde 1985': 'M3 12a9 9 0 1 0 3-6.7 M3 4v5h5 M12 7v5l3 2',
  'Quando plantar com menos risco (ZARC)': 'M4 6h16v14H4Z M4 10h16 M8 3v4 M16 3v4 M8 14h3 M13 14h3',
};
const VIG_LV = [['fraco', '#b5651d'], ['abaixo da média', '#c9a03a'], ['acima da média', '#6fa84a'], ['forte', '#2f8a3c']];
const ndvi = (v, nf) => nf(v / 100, 2);

// vigor do pasto ano a ano: linhas cheias = propriedade, tracejadas = pasto do município (NDVI × 100)
function vigChart(V, M, years, nf, { w = 340, h = 128 } = {}) {
  const S = [[V.ws, '#2f8a3c', ''], [M.wet, '#2f8a3c', '4 3'], [V.ds, '#c08a3e', ''], [M.dry, '#c08a3e', '4 3']];
  const all = S.flatMap(([a]) => a).filter((v) => v != null);
  if (all.length < 3) return '';
  const lo = Math.floor(Math.min(...all) / 5) * 5 - 5, hi = Math.ceil(Math.max(...all) / 5) * 5 + 5;
  const pl = 32, pr = 8, pt = 8, pb = 18;
  const X = (i) => pl + (i / (years.length - 1)) * (w - pl - pr), Y = (v) => pt + (1 - (v - lo) / (hi - lo)) * (h - pt - pb);
  let g = '';
  for (const v of [lo, (lo + hi) / 2, hi]) g += `<line x1="${pl}" x2="${w - pr}" y1="${Y(v)}" y2="${Y(v)}" stroke="currentColor" stroke-opacity=".18"/><text x="${pl - 5}" y="${Y(v) + 3}" text-anchor="end">${ndvi(v, nf)}</text>`;
  years.forEach((y, i) => { g += `<text x="${X(i)}" y="${h - 4}" text-anchor="middle">${String(y).slice(2)}</text>`; });
  for (const [arr, col, dash] of S) {
    let run = [];
    const flush = () => { if (run.length > 1) g += `<polyline points="${run.join(' ')}" fill="none" stroke="${col}" stroke-width="${dash ? 1.4 : 2.2}" stroke-dasharray="${dash}" stroke-linejoin="round"/>`; run = []; };
    arr.forEach((v, i) => { if (v == null) flush(); else run.push(`${X(i).toFixed(1)},${Y(v).toFixed(1)}`); });
    flush();
    if (!dash) arr.forEach((v, i) => { if (v != null) g += `<circle cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="2.6" fill="${col}"/>`; });
  }
  return `<svg class="vig-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Vigor do pasto de ${years[0]} a ${years.at(-1)}">${g}</svg>`;
}
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
/** comparação da tendência com a do município: diferença das últimas 3 safras menos a das 3 primeiras (NDVI × 100) */
function vigTrend(ws, mw) {
  const d = ws.map((v, i) => (v != null && mw[i] != null ? v - mw[i] : null)).filter((v) => v != null);
  if (d.length < 4) return null;
  return mean(d.slice(-3)) - mean(d.slice(0, 3));
}

const hex2rgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
function inRing(ring, lat, lon) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ai, oi] = ring[i], [aj, oj] = ring[j];
    if ((ai > lat) !== (aj > lat) && lon < ((oj - oi) * (lat - ai)) / (aj - ai) + oi) c = !c;
  }
  return c;
}

export class CarLayer {
  constructor({ terrain, vectors, scene, labels, nf, fmtDate, getJSON, onFit, onFly, onSelect }) {
    Object.assign(this, { terrain, vectors, nf, fmtDate, getJSON, onFit, onFly, onSelect });
    this.muni = null;   // médias do município (hist.json)
    this.labelsEl = labels;
    this.on = false; this.data = null; this.criterion = 'tamanho';
    this.fill = true; this.overlap = true; this.app = false;
    this.sel = null; this.hover = null;
    this.dim = 0; this.dimTo = 0;   // resto do mapa apagado quando há uma propriedade escolhida (0–1, com transição)
    this.labelPool = []; this.labelItems = [];
    // marcador do ponto mais alto
    const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 1, 0)]);
    this.marker = new THREE.Group();
    this.marker.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffffff })));
    const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    ball.name = 'ball'; this.marker.add(ball);
    this.marker.visible = false; this.markerAt = null;
    scene.add(this.marker);
    // cerca da propriedade escolhida: mourões de madeira (3D, instanciados) e quatro fios de arame farpado com barriga
    // entre eles, desenhados num pano vertical; uma faixa de luz suave na base marca a divisa de longe. A altura acompanha
    // a distância da câmera (de perto parece cerca, de longe vira traço de luz) — ver fenceFor().
    this.fenceMat = new THREE.ShaderMaterial({
      uniforms: { uWire: { value: new THREE.Color(0xd9d6cc) }, uGlow: { value: new THREE.Color(0xfff1d6) }, uOpacity: { value: 0 },
        uPost: { value: 10 }, uTime: { value: 0 }, uLen: { value: 1000 }, uHeight: { value: 4 }, uNear: { value: 1 } },
      vertexShader: /* glsl */ `attribute float h, d; uniform float uHeight; varying float vH, vD;
        void main() { vH = h; vD = d; vec3 p = position; p.y += h * uHeight; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }`,
      fragmentShader: /* glsl */ `uniform vec3 uWire, uGlow; uniform float uOpacity, uPost, uTime, uLen, uNear; varying float vH, vD;
        void main() {
          float u = fract(vD / uPost);                        // posição entre dois mourões
          float sag = 0.07 * 4.0 * u * (1.0 - u);             // barriga do arame no meio do vão
          float px = fwidth(vH), barb = step(0.85, fract(vD / uPost * 7.0));   // farpas a cada ~1/7 do vão
          float wire = 0.0;
          for (int i = 0; i < 4; i++) {
            float dist = abs(vH - (0.30 + 0.19 * float(i) - sag));
            wire = max(wire, 1.0 - smoothstep(px * (0.55 + barb * 0.9), px * (1.5 + barb * 1.2), dist));
          }
          wire *= uNear;                                       // de longe os fios de baixo somem
          float glow = (0.16 + 0.26 * (1.0 - uNear)) * pow(1.0 - vH, 1.8);   // faixa de luz na base: marca a divisa de longe
          // fio de cima mais forte (≥ 1,5 px em qualquer distância) e uma luz correndo por ele (uma volta a cada ~12 s)
          float r = fract(vD / uLen - uTime / 12.0), run = pow(max(0.0, 1.0 - min(r, 1.0 - r) * 18.0), 3.0);
          float top = 1.0 - smoothstep(px * 0.9, px * 2.2, abs(vH - (0.87 - sag * uNear)));
          vec3 c = mix(uGlow, uWire * (0.85 + 0.25 * vH), wire);
          c = mix(c, vec3(1.0, 0.97, 0.9), top * (1.0 - uNear) * 0.6) + vec3(1.0, 0.78, 0.4) * run * top * 0.9;
          float a = max(max(wire * 0.95, glow), top * (0.55 + 0.4 * (1.0 - uNear) + 0.4 * run));
          if (a < 0.01) discard;
          gl_FragColor = vec4(c, uOpacity * a);
        }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    this.fence = new THREE.Mesh(new THREE.BufferGeometry(), this.fenceMat);
    this.fence.renderOrder = 5; this.fence.visible = false; this.fence.frustumCulled = false;
    scene.add(this.fence);
    // mourões: cilindro de 6 lados, madeira; posição e escala refeitas quando a altura da cerca muda
    const postGeo = new THREE.CylinderGeometry(1, 1.15, 1, 6, 1); postGeo.translate(0, 0.5, 0);
    this.postMat = new THREE.MeshLambertMaterial({ color: 0x7a5636, transparent: true, opacity: 0 });
    this.posts = new THREE.InstancedMesh(postGeo, this.postMat, 4096);
    this.posts.count = 0; this.posts.visible = false; this.posts.frustumCulled = false;
    scene.add(this.posts);
    this.fenceLines = []; this.fenceH = 0;
    this.nb = [];   // vizinhos da escolhida
  }

  async load() {
    if (this.data) return this.data;
    this.loading ??= Promise.all([
      this.getJSON('data/muni/layers/car.json'),
      new THREE.TextureLoader().loadAsync('data/muni/layers/car_id.png'),
    ]).then(([data, tex]) => {
      this.data = data;
      this.feats = data.features;
      this.index = this.feats.map((f, k) => {
        let s = 90, n = -90, w = 180, e = -180;
        for (const r of f.rings) for (const [la, lo] of r) { s = Math.min(s, la); n = Math.max(n, la); w = Math.min(w, lo); e = Math.max(e, lo); }
        return { f, k, s, n, w, e };
      });
      this.terrain.setCarTexture(tex);
      return data;
    });
    return this.loading;
  }

  async setOn(on) {
    this.on = on;
    if (on) await this.load();
    this.terrain.setCarState({ on, fill: this.fill ? 0.3 : 0, overlap: this.overlap, app: this.app });
    this.redraw();
    if (!on) { this.select(null); this.setHover(null); this.#clearLabels(); }
  }

  setCriterion(c) { this.criterion = c; if (this.on) this.redraw(); }
  setFill(v) { this.fill = v; this.terrain.setCarState({ fill: v ? 0.3 : 0 }); }
  setOverlap(v) { this.overlap = v; this.terrain.setCarState({ overlap: v }); }
  setApp(v) { this.app = v; this.terrain.setCarState({ app: v }); }

  bucketOf(f) { return CRITERIA[this.criterion].of(f); }
  colorOf(f) { const b = this.bucketOf(f); return b < 0 ? GRAY : CRITERIA[this.criterion].buckets[b][1]; }

  // contornos (um lote por faixa) e paleta do preenchimento
  redraw() {
    const crit = CRITERIA[this.criterion];
    for (const key of this.lineKeys ?? []) this.vectors.removeLines(key);
    this.lineKeys = [];
    if (!this.on || !this.data) return;
    // contornos por faixa de cor e por tamanho: de longe só as grandes, as pequenas aparecem ao aproximar
    const TIERS = [[100, Infinity], [20, 14000], [0, 6000]];   // [ha mínimo, distância máxima da câmera em m]
    const groups = new Map();
    const pal = new Uint8Array(64 * 64 * 4);
    this.feats.forEach((f, k) => {
      if (f.status === 'cancelado' || k >= 4096) return;
      const b = this.bucketOf(f), t = TIERS.findIndex(([ha]) => f.ha >= ha), key = `${b}|${t}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(...f.rings);
      const [r, g, bl] = hex2rgb(b < 0 ? GRAY : crit.buckets[b][1]);
      pal.set([r, g, bl, 255], k * 4);
    });
    for (const [key, rings] of groups) {
      const [b, t] = key.split('|').map(Number);
      const [, hex, w] = b < 0 ? [0, GRAY, 1] : crit.buckets[b];
      const name = `car-${b}-${t}`;
      this.vectors.addLines(name, 'car', { color: parseInt(hex.slice(1), 16), width: (w ?? 1.5) * (t === 2 ? 0.8 : 1), lift: 4, opacity: 0.9, order: 4, maxDist: TIERS[t][1] }, rings, 30);
      this.lineKeys.push(name);
    }
    this.terrain.setCarPalette(pal);
  }

  /** linhas da legenda: [rótulo, cor, nº, ha] para os imóveis declarados em Andrelândia */
  legend() {
    const crit = CRITERIA[this.criterion];
    const rows = crit.buckets.map(([l, c]) => [l, c, 0, 0]);
    let none = 0;
    for (const f of this.feats) {
      if (f.mun !== 'Andrelândia' || f.status === 'cancelado') continue;
      const b = this.bucketOf(f);
      if (b < 0) { none++; continue; }
      rows[b][2]++; rows[b][3] += f.ha;
    }
    if (none) rows.push(['sem dado', GRAY, none, 0]);
    return { rows, note: crit.note };
  }

  pick(lat, lon) {
    if (!this.index) return null;
    let best = null;
    for (const x of this.index) {
      if (lat < x.s || lat > x.n || lon < x.w || lon > x.e || x.f.status === 'cancelado') continue;
      if (best && x.f.ha >= best.f.ha) continue;   // o menor (mais específico) primeiro
      if (x.f.rings.some((r) => inRing(r, lat, lon))) best = x;
    }
    return best;
  }

  setHover(x) {
    if ((x?.k ?? -1) === (this.hover?.k ?? -1)) return;
    this.hover = x;
    this.terrain.setCarState({ hover: x ? x.k + 1 : -1 });
  }

  select(x, { fit = false } = {}) {
    this.sel = x;
    this.terrain.setCarState({ sel: x ? x.k + 1 : -1 });
    this.dimTo = x ? 1 : 0;
    this.onSelect?.(x);
    if (!x) { this.vectors.removeLines('car-sel'); this.vectors.removeLines('car-nb'); this.nb = []; this.marker.visible = false; return; }
    this.terrain.setCarSelection(x.f.rings);
    this.terrain.flashSelection?.();
    this.vectors.addLines('car-sel', 'highlight', { color: 0xffffff, width: 3.5, lift: 6, opacity: 1, order: 6, noClip: true }, x.f.rings, 20);
    this.nb = this.neighbors(x);
    // vizinhos: tracejado claro (as cores do critério são linhas cheias)
    if (this.nb.length) this.vectors.addLines('car-nb', 'highlight', { color: 0xffe9a8, width: 2, lift: 5, opacity: 0.95, order: 5, noClip: true, dashed: true, dashSize: 16, gapSize: 10 }, this.nb.flatMap((n) => n.x.f.rings), 25);
    else this.vectors.removeLines('car-nb');
    this.marker.visible = false;
    this.updateFence();
    if (fit) this.onFit(x.f.rings.flat());
  }

  // transição do apagado (~¼ s); a máscara e a cerca só saem depois que o mapa voltou ao normal
  animate(dt) {
    this.fenceMat.uniforms.uTime.value = (performance.now() / 1000) % 100000;
    if (this.dim === this.dimTo) return;
    this.dim = this.dimTo > this.dim ? Math.min(this.dimTo, this.dim + dt * 4) : Math.max(this.dimTo, this.dim - dt * 4);
    this.terrain.setCarState({ dim: this.dim });
    this.vectors.setDim(this.dim);
    this.fenceMat.uniforms.uOpacity.value = this.dim;
    this.postMat.opacity = this.dim * this.fenceMat.uniforms.uNear.value;
    if (this.dim === 0) { this.terrain.setCarSelection(null); this.fence.visible = false; this.posts.visible = false; }
  }

  /** refaz a cerca da escolhida (ao escolher e ao mudar o exagero do relevo): o pano fica no chão e sobe no shader */
  updateFence() {
    const x = this.sel;
    if (!x) return;
    const t = this.terrain;
    const pos = [], hh = [], dd = [], idx = [];
    this.fenceLines = [];
    let dist = 0;
    for (const r of x.f.rings) {
      const P = r.map(([la, lo]) => t.frame.toLocal(la, lo));
      if (P[0].x !== P.at(-1).x || P[0].z !== P.at(-1).z) P.push(P[0]);
      const line = [];   // a cada ~8 m, para a base acompanhar o relevo
      for (let k = 0; k < P.length - 1; k++) {
        const a = P[k], b = P[k + 1], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 8));
        for (let s = 0; s < n; s++) line.push([a.x + ((b.x - a.x) * s) / n, a.z + ((b.z - a.z) * s) / n]);
      }
      line.push([P.at(-1).x, P.at(-1).z]);
      const pts = [];
      line.forEach(([px, pz], i) => {
        if (i) dist += Math.hypot(px - line[i - 1][0], pz - line[i - 1][1]);
        const y = t.groundY(px, pz) - 0.3 * t.exaggeration, v = pos.length / 3;
        pos.push(px, y, pz, px, y, pz); hh.push(0, 1); dd.push(dist, dist);
        if (i) idx.push(v - 2, v - 1, v, v - 1, v + 1, v);
        pts.push({ x: px, z: pz, y, d: dist });
      });
      this.fenceLines.push(pts);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('h', new THREE.Float32BufferAttribute(hh, 1));
    g.setAttribute('d', new THREE.Float32BufferAttribute(dd, 1));
    g.setIndex(idx);
    this.fence.geometry.dispose();
    this.fence.geometry = g;
    this.fenceMat.uniforms.uLen.value = Math.max(200, dist);
    this.fenceH = 0;   // mourões refeitos no próximo fenceFor()
    this.fence.visible = true;
  }

  /**
   * altura da cerca pela distância da câmera (chamado a cada ~200 ms): de perto ~2,5 m (cerca de verdade, um pouco
   * exagerada), de longe até 45 m com os fios sumindo e a faixa de luz marcando a divisa. Mourões a ~2,4 alturas.
   */
  fenceFor(camera) {
    if (!this.sel || !this.fenceLines.length) return;
    const ex = this.extent(this.sel), cy = this.terrain.groundY(ex.x, ex.z);
    const dist = Math.hypot(camera.position.x - ex.x, camera.position.y - cy, camera.position.z - ex.z);
    const H = Math.min(45, Math.max(2.5, dist * 0.011)), near = 1 - Math.min(1, Math.max(0, (H - 16) / 22));
    const u = this.fenceMat.uniforms;
    u.uNear.value = near;
    this.postMat.opacity = this.dim * near;
    this.posts.visible = near > 0.03;
    // bem de perto (< ~500 m) a própria cerca marca a divisa: o contorno branco (que flutua alguns metros acima) quase some
    const sel = this.vectors.batches.find((b) => b.key === 'car-sel');
    if (sel) sel.mat.opacity = 1 - 0.85 * Math.min(1, Math.max(0, (9 - H) / 4));
    // mourão com pelo menos ~2 px de largura na tela (de média distância o tamanho "real" ficava menor que um pixel)
    const mPerPx = (2 * dist * Math.tan((camera.fov * Math.PI) / 360)) / (this.screenH || 800);
    const rad = Math.min(3, Math.max(0.12, H * 0.035, mPerPx * 1.0));
    if (this.fenceH && Math.abs(H - this.fenceH) / this.fenceH < 0.08 && Math.abs(rad - this.postRad) / this.postRad < 0.15) return;
    this.fenceH = H; this.postRad = rad;
    let S = Math.min(140, Math.max(6, H * 2.4));
    const total = u.uLen.value;
    if (total / S > this.posts.instanceMatrix.count - 8) S = total / (this.posts.instanceMatrix.count - 8);
    u.uHeight.value = H; u.uPost.value = S;
    // mourões a cada S metros ao longo de cada anel (a distância segue a mesma conta do pano, então caem nos "vãos" certos)
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    let n = 0;
    for (const pts of this.fenceLines) {
      let k = 0;
      for (let d = Math.ceil(pts[0].d / S) * S; d <= pts.at(-1).d && n < this.posts.instanceMatrix.count; d += S) {
        while (k < pts.length - 2 && pts[k + 1].d < d) k++;
        const a = pts[k], b = pts[k + 1] ?? a, f = b.d > a.d ? (d - a.d) / (b.d - a.d) : 0;
        p.set(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, a.z + (b.z - a.z) * f);
        sc.set(rad, H * 1.06, rad);
        this.posts.setMatrixAt(n++, m.compose(p, q, sc));
      }
    }
    this.posts.count = n;
    this.posts.instanceMatrix.needsUpdate = true;
  }

  /**
   * vizinhos: propriedades com pelo menos 30 m de divisa (contornos a menos de 25 m) ou sobrepostas à escolhida.
   * [{ x, m: metros de divisa, ov: sobreposta }], as de divisa mais longa primeiro
   */
  neighbors(x) {
    if (x.nbCache) return x.nbCache;
    const fr = this.terrain.frame, TOL = 25, STEP = 15;
    const loc = (r) => r.map(([la, lo]) => fr.toLocal(la, lo));
    const inside = (P, px, pz) => {
      let c = false;
      for (let i = 0, j = P.length - 1; i < P.length; j = i++) if ((P[i].z > pz) !== (P[j].z > pz) && px < ((P[j].x - P[i].x) * (pz - P[i].z)) / (P[j].z - P[i].z) + P[i].x) c = !c;
      return c;
    };
    const segDist = (px, pz, a, b) => {
      const vx = b.x - a.x, vz = b.z - a.z, L = vx * vx + vz * vz;
      const u = L ? Math.max(0, Math.min(1, ((px - a.x) * vx + (pz - a.z) * vz) / L)) : 0;
      return Math.hypot(a.x + u * vx - px, a.z + u * vz - pz);
    };
    const mine = x.f.rings.map(loc);
    // "dentro da escolhida" por uma máscara (≤ 1024 px) e "perto do contorno dela" por um índice de trechos em células
    // de 64 m: o contorno de uma propriedade grande tem milhares de vértices
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const P of mine) for (const p of P) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
    const res = Math.max(4, Math.max(x1 - x0, z1 - z0) / 1024), cw = Math.ceil((x1 - x0) / res) + 1, ch = Math.ceil((z1 - z0) / res) + 1;
    const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
    const g2 = cv.getContext('2d', { willReadFrequently: true });
    g2.fillStyle = '#fff';
    for (const P of mine) { g2.beginPath(); P.forEach((p, i) => g2[i ? 'lineTo' : 'moveTo']((p.x - x0) / res, (p.z - z0) / res)); g2.closePath(); g2.fill(); }
    const A = g2.getImageData(0, 0, cw, ch).data;
    const inMine = (px, pz) => { const i = Math.floor((px - x0) / res), j = Math.floor((pz - z0) / res); return i >= 0 && j >= 0 && i < cw && j < ch && A[(j * cw + i) * 4 + 3] > 127; };
    const CELL = 64, grid = new Map(), key = (i, j) => i * 100003 + j;
    for (const P of mine) for (let i = 0; i < P.length - 1; i++) {
      const a = P[i], b = P[i + 1];
      for (let ci = Math.floor((Math.min(a.x, b.x) - TOL) / CELL); ci <= Math.floor((Math.max(a.x, b.x) + TOL) / CELL); ci++)
        for (let cj = Math.floor((Math.min(a.z, b.z) - TOL) / CELL); cj <= Math.floor((Math.max(a.z, b.z) + TOL) / CELL); cj++) {
          const k = key(ci, cj); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(a, b);
        }
    }
    const nearMine = (px, pz) => {
      const l = grid.get(key(Math.floor(px / CELL), Math.floor(pz / CELL)));
      if (l) for (let i = 0; i < l.length; i += 2) if (segDist(px, pz, l[i], l[i + 1]) < TOL) return true;
      return false;
    };
    const samples = [];   // pontos a cada 15 m no contorno da escolhida
    for (const P of mine) for (let i = 0; i < P.length - 1; i++) {
      const a = P[i], b = P[i + 1], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / STEP));
      for (let s = 0; s < n; s++) samples.push([a.x + ((b.x - a.x) * s) / n, a.z + ((b.z - a.z) * s) / n]);
    }
    const dLat = TOL / 110574, dLon = TOL / 103000, out = [];
    for (const y of this.index) {
      if (y.k === x.k || y.f.status === 'cancelado') continue;
      if (y.s > x.n + dLat || y.n < x.s - dLat || y.w > x.e + dLon || y.e < x.w - dLon) continue;
      const rings = y.f.rings.map(loc);
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const P of rings) for (const p of P) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
      let near = 0, within = 0;
      for (const [px, pz] of samples) {
        if (px < minX - TOL || px > maxX + TOL || pz < minZ - TOL || pz > maxZ + TOL) continue;
        let d = Infinity;
        for (const P of rings) for (let i = 0; i < P.length - 1 && d >= TOL; i++) d = Math.min(d, segDist(px, pz, P[i], P[i + 1]));
        if (d < TOL) near++;
        else if (rings.some((P) => inside(P, px, pz))) within++;
      }
      // sobreposta: boa parte do contorno de uma passa por dentro da outra (longe da divisa, que não conta)
      let vin = 0, vtot = 0;
      for (const P of rings) for (const p of P) { vtot++; if (inMine(p.x, p.z) && !nearMine(p.x, p.z)) vin++; }
      const ov = within > 0.3 * samples.length || vin > 0.3 * vtot;
      const m = near * STEP;
      if (m >= 30 || ov) out.push({ x: y, m, ov });
    }
    out.sort((a, b) => (a.ov - b.ov) || b.m - a.m);
    return (x.nbCache = out);
  }

  showPeak({ fly = true } = {}) {
    const s = this.sel?.f.s; if (!s) return;
    this.markerAt = s.zp; this.marker.visible = true; this.#placeMarker();
    if (fly) this.onFly(s.zp[0], s.zp[1]);
  }
  hidePeak() { this.marker.visible = false; }
  #placeMarker() {
    if (!this.marker.visible || !this.markerAt) return;
    const p = this.terrain.worldPosition(this.markerAt[0], this.markerAt[1]);
    const h = 60 * Math.max(1, this.terrain.exaggeration);
    this.marker.position.copy(p);
    this.marker.children[0].scale.set(1, h, 1);
    const ball = this.marker.getObjectByName('ball'); ball.position.y = h; ball.scale.setScalar(6);
  }

  // rótulos de área (ha) dos imóveis perto do centro da vista; chamado a cada ~250 ms
  refreshLabels(camera, target) {
    this.#placeMarker();
    this.fenceFor(camera);
    const t = this.terrain;
    const d = camera.position.distanceTo(target);
    if (!this.on || !this.feats || d > 5500) { this.#clearLabels(); return; }
    const R = Math.max(1600, d * 1.1);
    const cand = [];
    for (const f of this.feats) {
      const s = f.s; if (!s || !s.lp || f.status === 'cancelado') continue;
      const p = t.frame.toLocal(s.lp[0], s.lp[1]);
      const dd = Math.hypot(p.x - target.x, p.z - target.z);
      if (dd > R) continue;
      if (t.clipped && !t.insideLocal(p.x, p.z)) continue;
      if (s.a < Math.max(1, d / 700)) continue;   // de longe, só os maiores
      cand.push([dd, f, p]);
    }
    cand.sort((a, b) => a[0] - b[0]);
    const take = cand.slice(0, 36);
    while (this.labelPool.length < take.length) {
      const el = document.createElement('span'); el.className = 'car-lbl'; this.labelsEl.appendChild(el); this.labelPool.push(el);
    }
    this.labelItems = take.map(([, f, p], i) => {
      const el = this.labelPool[i];
      el.textContent = `${this.nf(f.ha, f.ha < 10 ? 1 : 0)} ha`;
      el.hidden = false;
      el.classList.toggle('is-dim', !!this.sel && this.sel.f !== f && !this.nb.some((n) => n.x.f === f));
      el.classList.toggle('is-sel', !!this.sel && this.sel.f === f);
      return { el, f, pos: new THREE.Vector3(p.x, t.groundY(p.x, p.z) + 8, p.z) };
    });
    for (let i = take.length; i < this.labelPool.length; i++) this.labelPool[i].hidden = true;
    this.labelItems.sort((a, b) => (b.f === this.sel?.f) - (a.f === this.sel?.f));   // a escolhida é posta primeiro
  }
  #clearLabels() { this.labelItems = []; for (const el of this.labelPool) el.hidden = true; }
  projectLabels(camera, w, h) {
    this.screenH = h;   // altura da tela (largura mínima dos mourões)
    // os itens vêm do mais perto do centro para o mais longe: um rótulo que encostaria num já posto fica escondido
    const v = new THREE.Vector3(), placed = [];
    for (const it of this.labelItems) {
      v.copy(it.pos).project(camera);
      const x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
      const sel = this.sel && it.f === this.sel.f;
      if (v.z > 1 || v.z < -1 || (!sel && placed.some(([px, py]) => Math.abs(px - x) < 56 && Math.abs(py - y) < 20))) { it.el.style.visibility = 'hidden'; continue; }
      placed.push([x, y]);
      it.el.style.visibility = '';
      it.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    }
  }

  // ---------- ficha ----------
  card(x, { mine = false, chartW = 600 } = {}) {
    const f = x.f, s = f.s, nf = this.nf, esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    const size = CRITERIA.tamanho.buckets[CRITERIA.tamanho.of(f)]?.[0].split(' (')[0] ?? '';
    const st = CRITERIA.situacao.buckets[STATUS(f)];
    let h = `<header class="cc-head">
      <span class="eyebrow">Propriedade rural · CAR</span>
      <h2 id="cc-title">${nf(f.ha, f.ha < 10 ? 2 : 1)} ha <small>${esc(size.toLowerCase())}</small></h2>
      <p class="cc-meta">${nf(f.mf, 2)} módulos fiscais · ${esc(f.mun)} · <span class="cc-chip" style="--c:${st[1]}">${esc(st[0])}</span></p>
      <div class="cc-acts">
        ${s ? '<button type="button" class="btn btn--small btn--demo" data-act="demo">▶ Demonstração</button>' : ''}
        <button type="button" class="btn btn--small" data-act="orbit">Sobrevoar</button>
        <button type="button" class="btn btn--small" data-act="peak">Ponto mais alto</button>
        <button type="button" class="btn btn--small${mine ? ' is-on' : ''}" data-act="mine" aria-pressed="${mine}">${mine ? '★ Minha propriedade' : '☆ É a minha'}</button>
        <button type="button" class="btn btn--small" data-act="share">Compartilhar</button>
        ${s ? '<button type="button" class="btn btn--small" data-act="sheet">Salvar folha</button>' : ''}
      </div>
      <p class="cc-share" id="cc-share" role="status" hidden></p>
    </header>`;
    if (!s) return h + `<p class="model-note">Propriedade fora da área com dados do mapa.</p>`;
    const partial = s.a / f.ha < 0.9 ? `<p class="cc-warn">A propriedade passa da borda do mapa: os números abaixo valem só para a parte dentro dele (${nf(s.a)} ha).</p>` : '';
    // abas: o cabeçalho fica sempre; o resumo junta o principal de cada parte em cartões que levam à aba dela
    const tabs = [['resumo', 'Resumo'], ['apt', 'Aptidão'], ['terra', 'Terra'], ['pasto', 'Pasto'], ['agua', 'Água'], ['clima', 'Clima'], ['viz', 'Entorno']];
    h += `<nav class="cc-tabs" role="tablist" aria-label="Partes da ficha">${tabs.map(([k, l]) => `<button type="button" role="tab" data-tab-btn="${k}">${l}</button>`).join('')}</nav>`;
    h += partial + '<div class="cc-grid">';
    h += this.#summary(x);
    h += `<section data-tab="apt" id="cc-apt-wait"><h3>Aptidão da terra</h3><span class="skel skel--v"></span><span class="skel"></span><p class="cc-note">Calculando para que serve cada pedaço da propriedade…</p></section>`;
    h += this.#pasture(x, chartW);
    // a terra ao longo do tempo
    const hist = this.histOf(x.k);
    if (hist) {
      const g = this.data.hist_groups, yrs = this.data.hist_years, a = hist[0], z = hist.at(-1);
      const rows = g.map((name, i) => [name, GROUP_COLORS[i], a[i], z[i]]).filter((r) => r[2] >= 1 || r[3] >= 1);
      h += `<section class="cc-wide" data-tab="terra"><h3>A terra de 1985 a 2025</h3>
        ${histChart(hist, yrs, g, { w: chartW, h: 110 })}
        <ul class="cc-list cc-list--hist">${rows.map(([n, c, p0, p1]) => `<li><span class="lc-sw" style="background:${c}"></span><span>${n}</span><b>${nf(p0)}% → ${nf(p1)}%</b></li>`).join('')}</ul>
      </section>`;
    }
    // sol e geada
    if (s.sol) {
      const m = this.muni?.sol;
      const cmp = (v, ref) => !ref ? '' : v > ref * 1.03 ? ' · mais que a média do município' : v < ref * 0.97 ? ' · menos que a média do município' : ' · na média do município';
      const gea = s.gea >= 30 ? 'muita área em baixada fria' : s.gea >= 15 ? 'parte em baixada fria' : s.gea >= 5 ? 'pouca baixada fria' : 'quase nada em baixada fria';
      h += `<section data-tab="clima"><h3>Sol e geada</h3>
        <p class="cc-kv">☀ Inverno <b>${nf(s.sol[0], 1)} kWh/m²</b> por dia, ${nf(s.sol[2], 1)} h de sol${cmp(s.sol[0], m?.[0])}</p>
        <p class="cc-kv">☀ Verão <b>${nf(s.sol[1], 1)} kWh/m²</b> por dia, ${nf(s.sol[3], 1)} h de sol</p>
        <p class="cc-kv">❄ ${gea}: <b>${nf(s.gea)}%</b> da área</p>
        <p class="cc-note">Sol direto num dia de céu limpo (21/jun e 21/dez), com a sombra dos morros. Geada: onde o ar frio escorre e se acumula — mapa ilustrativo.</p>
      </section>`;
    }
    // uso do solo hoje
    const lu = s.lu.map(([c, p]) => [CLASSES[c]?.[0] ?? `classe ${c}`, CLASSES[c]?.[1] ?? '#999', p]);
    const bar = lu.map(([n, c, p]) => `<span style="flex:${p} 1 0;background:${c}" title="${esc(n)}: ${nf(p, 1)}%"></span>`).join('');
    const list = lu.slice(0, 4).map(([n, c, p]) => `<li><span class="lc-sw" style="background:${c}"></span><span>${esc(n)}</span><b>${nf(p, p < 10 ? 1 : 0)}%</b></li>`).join('');
    h += `<section data-tab="terra"><h3>Uso do solo hoje</h3>
      <div class="cc-bar" role="img" aria-label="Composição do uso do solo">${bar}</div>
      <ul class="cc-list">${list}</ul>
      <div id="cc-lu10"></div>
      <button type="button" class="btn btn--small" data-act="lu10">Comparar com o mapa de 10 m</button>
    </section>
    <section data-tab="terra"><h3>O mapa confere com o satélite?</h3>
      <div id="cc-conf"><p class="cc-note">Cruza o MapBiomas 2025 com o verde medido pela Sentinel-2 em 2026 (águas e seca) e aponta o que não bate.</p></div>
      <button type="button" class="btn btn--small" data-act="conf">Conferir com o satélite</button>
    </section>`;
    // relevo
    const pctSl = Math.tan((s.sl * Math.PI) / 180) * 100;
    h += `<section data-tab="terra"><h3>Relevo</h3>
      <p class="cc-kv">Altitude <b>${nf(s.z[0])}–${nf(s.z[2])} m</b> · média ${nf(s.z[1])} m</p>
      <p class="cc-kv">Declividade média <b>${nf(s.sl)}°</b> (${nf(pctSl)}%, ${relevoOf(s.sl)})</p>
      <p class="cc-kv">Estradas e caminhos (OSM) <b>${nf(s.rd, 1)} km</b></p>
    </section>`;
    // clima, solo e época de plantio (agro.js; preenchidos em main.js quando os arquivos chegam)
    h += `<section data-tab="clima"><h3>Clima</h3><div id="cc-clima"><p class="cc-note">Carregando…</p></div></section>
      <section data-tab="clima"><h3>Solo provável</h3><div id="cc-solo"><p class="cc-note">Carregando…</p></div></section>
      <section class="cc-wide" data-tab="clima"><h3>Quando plantar com menos risco (ZARC)</h3><div id="cc-zarc"><p class="cc-note">Carregando…</p></div></section>`;
    // acesso pela estrada (calculado em main.js logo depois de a ficha abrir)
    h += `<section data-tab="viz"><h3>Acesso pela estrada</h3>
      <div id="cc-access" class="cc-access"><p class="cc-note">Calculando o caminho pelas estradas…</p></div>
      <button type="button" class="btn btn--small" data-act="route" aria-pressed="false">🛣 Ver o caminho</button>
    </section>`;
    // água e APP
    const [aha, anat, adef] = s.app, [, mdef, mw, capped] = s.appm;
    h += `<section data-tab="agua"><h3>Água</h3>
      <button type="button" class="btn btn--small" data-act="water" aria-pressed="false">💧 Ver a água da propriedade</button>
      <div class="cc-water" id="cc-water" hidden></div>
      <p class="cc-kv">Córregos <b>${nf(s.dr, 1)} km</b> · nascentes estimadas <b>${s.nas ?? 0}</b></p>` + (aha < 0.1
      ? `<p class="model-note">Sem APP estimada (nenhum córrego, nascente ou encosta acima de 45° calculados aqui).</p>`
      : `<p class="cc-kv">APP estimada <b>${nf(aha, 1)} ha</b></p>
      <div class="cc-bar cc-bar--app" role="img" aria-label="${nf(anat)}% com vegetação nativa"><span style="flex:${anat} 1 0;background:#2f8f5b"></span><span style="flex:${100 - anat} 1 0;background:#c2412d"></span></div>
      <p class="cc-kv"><span class="cc-dot" style="background:#2f8f5b"></span>${nf(anat)}% com mata ou campo · <span class="cc-dot" style="background:#c2412d"></span>${nf(adef, 1)} ha com pasto ou lavoura</p>
      <p class="cc-note">Faixa mínima para uso anterior a 2008 (art. 61-A): ${mw} m nos córregos, ${nf(mdef, 1)} ha a recompor${capped ? ` (teto de ${f.mf <= 2 ? 10 : 20}% da área)` : ''}. Estimativa do app; não substitui a análise do órgão ambiental.</p>`)
      + `</section>`;
    // vizinhos (contornos do CAR que encostam nesta)
    const nb = this.sel === x ? this.nb : this.neighbors(x);
    if (nb.length) {
      const sizeOf = (g) => CRITERIA.tamanho.buckets[CRITERIA.tamanho.of(g)]?.[0].split(' (')[0].toLowerCase() ?? '';
      const fmtM = (m) => (m >= 1000 ? `${nf(m / 1000, 1)} km` : `${nf(Math.round(m / 10) * 10)} m`);
      const MAX = 8, side = nb.filter((n) => !n.ov), over = nb.filter((n) => n.ov);
      const li = (n) => `<li><button type="button" data-nb="${n.x.k}"><span class="lc-sw" style="background:${this.colorOf(n.x.f)}"></span><span>${nf(n.x.f.ha, n.x.f.ha < 10 ? 1 : 0)} ha · ${esc(sizeOf(n.x.f))}</span><b>${n.ov ? 'sobreposta' : `${fmtM(n.m)} de divisa`}</b></button></li>`;
      h += `<section data-tab="viz"><h3>Vizinhos</h3>
        <p class="cc-kv"><b>${side.length}</b> ${side.length === 1 ? 'propriedade faz' : 'propriedades fazem'} divisa${over.length ? ` · <b>${over.length}</b> ${over.length === 1 ? 'sobreposta' : 'sobrepostas'}` : ''}</p>
        <ul class="cc-list cc-nb">${[...side.slice(0, MAX), ...over.slice(0, 3)].map(li).join('')}</ul>
        ${side.length > MAX ? `<p class="cc-note">E mais ${side.length - MAX} com divisa curta.</p>` : ''}
        <p class="cc-note">Contornos tracejados no mapa. São autodeclarados no CAR: a divisa pode não bater com a cerca de verdade.</p>
      </section>`;
    }
    h += `</div>`;
    const ov = s.ov[0] >= 0.5 ? `<p class="cc-warn cc-warn--ov">${nf(s.ov[0], 1)} ha (${nf((100 * s.ov[0]) / s.a)}% da área) também aparecem em ${Math.max(1, s.ov[1]) === 1 ? 'outro cadastro' : `${s.ov[1]} outros cadastros`}.</p>` : '';
    h += `<footer class="cc-foot">${ov}<p>${esc(f.cond)} · atualizado em ${f.atualizado ? this.fmtDate(f.atualizado) : '—'}</p><p class="cc-cod">${esc(f.cod)}</p></footer>`;
    return h;
  }

  // resumo: um cartão por parte da ficha (os de clima, solo, acesso e plantio são preenchidos em main.js)
  #summary(x) {
    const f = x.f, s = f.s, nf = this.nf, esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    const tile = (goto, c, k, body, cls = '') => `<button type="button" class="rs${cls}" data-goto="${goto}"><span class="k"><i class="ic" style="--c:${c}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${RS_ICON[k] ?? RS_ICON.Clima}"/></svg></i>${k}</span>${body}</button>`;
    const wait = (id) => `<div class="rs-b" id="${id}" aria-busy="true"><span class="skel skel--v"></span><span class="skel"></span></div>`;
    const lu = s.lu.map(([c, p]) => [CLASSES[c]?.[0] ?? `classe ${c}`, CLASSES[c]?.[1] ?? '#999', p]);
    const bar = `<div class="cc-bar">${lu.map(([n, c, p]) => `<span style="flex:${p} 1 0;background:${c}" title="${esc(n)}: ${nf(p, 1)}%"></span>`).join('')}</div>`;
    let t = '';
    t += tile('terra', '#d6bc74', 'Uso hoje', `<span class="v">${nf(lu[0][2])}% <small>${esc(lu[0][0].toLowerCase())}</small></span>${bar}${lu[1] ? `<span class="d">${nf(lu[1][2])}% ${esc(lu[1][0].toLowerCase())}${lu[2] ? ` · ${nf(lu[2][2])}% ${esc(lu[2][0].toLowerCase())}` : ''}</span>` : ''}`);
    const V = this.vigorOf(x);
    t += tile('pasto', '#2f8a3c', 'Vigor do pasto', !this.vigor ? '<span class="d">Ainda não disponível.</span>'
      : !V || V.ha < 1 ? `<span class="v">— <small>pouco pasto</small></span><span class="d">Menos de 1 ha de pasto no MapBiomas 2025.</span>`
        : `<span class="v">${V.lv != null ? VIG_LV[V.lv][0][0].toUpperCase() + VIG_LV[V.lv][0].slice(1) : ndvi(V.wet, nf)}</span>${V.lv != null ? `<span class="lvl" style="--c:${VIG_LV[V.lv][1]}">NDVI ${ndvi(V.wet, nf)} nas águas</span>` : ''}<span class="d">${nf(V.ha, V.ha < 10 ? 1 : 0)} ha de pasto · ${V.weak ?? 0}% dele fraco</span>`);
    const [aha, anat] = s.app;
    t += tile('agua', '#2f8fe0', 'Água', `<span class="v">${nf(s.dr, 1)} km <small>de córregos</small></span><span class="d">${s.nas ?? 0} ${s.nas === 1 ? 'nascente estimada' : 'nascentes estimadas'}${aha >= 0.1 ? ` · APP ${nf(anat)}% com mata ou campo` : ' · sem APP estimada'}</span>`);
    t += tile('terra', '#b3845c', 'Relevo', `<span class="v">${nf(s.z[0])}–${nf(s.z[2])} <small>m de altitude</small></span><span class="d">${relevoOf(s.sl)[0].toUpperCase() + relevoOf(s.sl).slice(1)}, ${nf(s.sl)}° de declividade média</span>`);
    if (s.sol) {
      const ref = this.muni?.sol?.[0], v = s.sol[0];
      const cmp = !ref ? '' : v > ref * 1.03 ? 'mais sol que a média' : v < ref * 0.97 ? 'menos sol que a média' : 'sol na média';
      t += tile('clima', '#f79e3b', 'Sol e geada', `<span class="v">${nf(v, 1)} <small>kWh/m² no inverno</small></span><span class="d">${cmp ? `${cmp} · ` : ''}${nf(s.gea)}% em baixada fria</span>`);
    }
    t += tile('clima', '#6db3df', 'Clima', wait('rs-clima'));
    t += tile('clima', '#a0522d', 'Solo provável', wait('rs-solo'));
    t += tile('viz', '#9aa69e', 'Acesso', wait('rs-acesso'));
    const nb = this.sel === x ? this.nb : this.neighbors(x), side = nb.filter((n) => !n.ov).length, over = nb.length - side;
    t += tile('viz', '#e3a008', 'Vizinhos', `<span class="v">${side} <small>${side === 1 ? 'faz divisa' : 'fazem divisa'}</small></span><span class="d">${over ? `${over} ${over === 1 ? 'cadastro sobreposto' : 'cadastros sobrepostos'}` : 'nenhum cadastro sobreposto'}</span>`);
    t += tile('terra', '#1f8d49', 'Desde 1985', `<span class="v">${nf(s.n85)}% → ${nf(s.n25)}%</span><span class="d">de vegetação nativa (mata, campo, área úmida)</span>`);
    t += tile('clima', '#3f9d5a', 'Quando plantar com menos risco (ZARC)', wait('rs-zarc'), ' rs--wide');
    return `<section data-tab="resumo"><div class="rs-grid">${t}</div><p class="rs-note">Toque num cartão para ver os detalhes. Tudo é estimativa feita com dados públicos.</p></section>`;
  }

  // vigor do pasto: nas águas, na seca e ano a ano, comparado com o pasto do município
  #pasture(x, chartW) {
    const nf = this.nf, V = this.vigorOf(x), d = this.vigor;
    if (!d) return `<section data-tab="pasto"><h3>Vigor do pasto</h3><p class="cc-note">O mapa de vigor ainda não está disponível.</p></section>`;
    if (!V || V.ha < 1) return `<section data-tab="pasto"><h3>Vigor do pasto</h3><p class="cc-kv">Quase sem pasto nesta propriedade: ${V ? `${nf(V.ha, 1)} ha` : 'nada'} de pastagem no MapBiomas 2025.</p>
      <button type="button" class="btn btn--small" data-act="vigmap">Ver o vigor no mapa</button></section>`;
    const M = d.muni, mWet = M.wet.at(-1), mDry = M.dry.at(-1), yrs = d.years;
    const lv = V.lv != null ? VIG_LV[V.lv] : null;
    const weak = V.weak ?? 0, strong = V.strong ?? 0, mid = Math.max(0, 100 - weak - strong);
    let h = `<section data-tab="pasto"><h3>Vigor do pasto nas águas · ${yrs.at(-1)}</h3>
      <div class="big">${lv ? lv[0][0].toUpperCase() + lv[0].slice(1) : '—'} <small>NDVI ${ndvi(V.wet, nf)}</small></div>
      <p class="cc-kv">${nf(V.ha, V.ha < 10 ? 1 : 0)} ha de pasto (${nf(V.pct)}% da área) · pasto do município: NDVI <b>${mWet != null ? ndvi(mWet, nf) : '—'}</b></p>
      <div class="cc-bar vig-bar" role="img" aria-label="${weak}% fraco, ${mid}% médio, ${strong}% forte"><span style="flex:${weak} 1 0"></span><span style="flex:${mid} 1 0"></span><span style="flex:${strong} 1 0"></span></div>
      <p class="cc-kv"><span class="cc-dot" style="background:#b5651d"></span>${weak}% fraco · <span class="cc-dot" style="background:#c9c06a"></span>${mid}% médio · <span class="cc-dot" style="background:#2f8a3c"></span>${strong}% forte</p>
      <p class="cc-note">Fraco e forte: entre os 25% de pasto menos e mais verde do município nas águas. ${lv ? `"${lv[0][0].toUpperCase() + lv[0].slice(1)}" compara a média do pasto dela com a das outras propriedades.` : ''}</p>
      <button type="button" class="btn btn--small" data-act="vigmap">Ver o vigor no mapa</button>
    </section>`;
    if (V.dry != null && V.wet > 0) {
      const r = Math.round((100 * V.dry) / V.wet), rm = mWet && mDry ? Math.round((100 * mDry) / mWet) : null;
      const cmp = rm == null ? '' : r >= rm + 5 ? 'Segura mais verde na seca que a média do município — pode ter baixada úmida, capineira ou pasto mais fechado.' : r <= rm - 5 ? 'Seca mais que a média do município: vale olhar lotação, solo exposto e encostas viradas para o norte.' : 'Seca parecido com a média do município.';
      h += `<section data-tab="pasto"><h3>Na seca · jul–set ${yrs.at(-1)}</h3>
        <p class="cc-kv">NDVI <b>${ndvi(V.dry, nf)}</b>: o pasto guardou <b>${r}%</b> do verde das águas${rm != null ? ` (município: ${rm}%)` : ''}.</p>
        ${cmp ? `<p class="cc-kv">${cmp}</p>` : ''}
      </section>`;
    }
    const tr = vigTrend(V.ws, M.wet);
    h += `<section data-tab="pasto"><h3>Ano a ano · ${yrs[0]}–${yrs.at(-1)}</h3>
      ${vigChart(V, M, yrs, nf, { w: Math.max(280, Math.min(560, chartW)) })}
      <p class="vig-legend"><span><i style="border-color:#2f8a3c"></i>águas</span><span><i style="border-color:#c08a3e"></i>seca</span><span><i style="border-color:currentColor;border-top-style:dashed"></i>pasto do município</span></p>
      ${tr == null ? '' : `<p class="cc-kv">${tr >= 3 ? '↗ O pasto dela <b>melhorou</b> em relação ao do município nos últimos anos.' : tr <= -3 ? '↘ O pasto dela <b>piorou</b> em relação ao do município nos últimos anos.' : '→ O pasto dela acompanhou o do município ao longo dos anos.'}</p>`}
      <p class="cc-note">NDVI da Sentinel-2 (10 m): mede o verde da folhagem, não a quantidade nem a qualidade do capim. A chuva de cada ano, queimada, roçada e lotação mudam o valor — compare com o município (tracejado), não com um número fixo. Pasto = MapBiomas 2025.</p>
    </section>`;
    return h;
  }

  /** histórico de 41 anos por propriedade (arquivo à parte, carregado na primeira ficha) */
  loadHist() {
    this.histP ??= this.getJSON('data/muni/layers/car_hist.json').then((d) => { this.hist = d; }).catch(() => { this.histP = null; });
    return this.histP;
  }
  /** vigor do pasto (vigor.json, robô "Vigor da pastagem"): números por propriedade e quartis entre as propriedades */
  loadVigor() {
    this.vigP ??= Promise.all([this.getJSON('data/muni/layers/vigor.json'), this.load()]).then(([d]) => {
      this.vigor = d;
      this.feats.forEach((f, k) => { f.vg = d.p[k] ?? null; });
      const wets = this.feats.filter((f) => f.mun === 'Andrelândia' && f.vg && f.vg[0] >= 1 && f.vg[3] != null).map((f) => f.vg[3]).sort((a, b) => a - b);
      const qq = (p) => wets[Math.min(wets.length - 1, Math.floor(p * wets.length))];
      CRITERIA.vigor.q = wets.length ? [qq(0.25), qq(0.5), qq(0.75)] : null;
      return d;
    }).catch(() => { this.vigP = null; return null; });
    return this.vigP;
  }
  /** { ha, pct, weak, strong, wet, dry, ws, ds, lv } (NDVI × 100) ou null */
  vigorOf(x) {
    const v = x?.f.vg, q = CRITERIA.vigor.q;
    if (!v || v.length < 7 || v[3] == null) return v ? { ha: v[0], pct: x.f.s ? (100 * v[0]) / x.f.s.a : 0 } : null;
    return { ha: v[0], pct: x.f.s ? (100 * v[0]) / x.f.s.a : 0, weak: v[1], strong: v[2], wet: v[3], dry: v[4], ws: v[5], ds: v[6], lv: q ? step(v[3], q) : null };
  }
  histOf(k) {
    const b64 = this.hist?.h[k];
    if (!b64) return null;
    const raw = atob(b64), n = this.hist.years.length, out = [];
    for (let y = 0; y < n; y++) { const row = []; for (let g = 0; g < 6; g++) row.push(raw.charCodeAt(y * 6 + g)); out.push(row); }
    return out;
  }

  /** busca pelo código do CAR (inteiro ou um trecho de pelo menos 4 caracteres) */
  search(q) {
    const t = q.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (t.length < 4 || !this.index) return [];
    return this.index.filter((x) => x.f.status !== 'cancelado' && x.f.cod.replace(/[^A-Z0-9]/g, '').includes(t)).slice(0, 8);
  }
  byCod(cod) { return this.index?.find((x) => x.f.cod === cod) ?? null; }

  /** centro e tamanho (m) da propriedade, para o sobrevoo */
  extent(x) {
    const t = this.terrain;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const r of x.f.rings) for (const [la, lo] of r) { const p = t.frame.toLocal(la, lo); minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
    const lp = x.f.s?.lp;
    const c = lp ? t.frame.toLocal(lp[0], lp[1]) : { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 };
    return { x: c.x, z: c.z, size: Math.max(maxX - minX, maxZ - minZ, 300) };
  }
}
