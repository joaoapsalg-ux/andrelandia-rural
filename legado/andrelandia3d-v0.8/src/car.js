// Imóveis rurais do CAR: contornos e preenchimento coloridos por critério, sobreposições, APP estimada,
// destaque ao passar o mouse, rótulos de área de perto e a ficha de cada imóvel.
// Dados: data/muni/layers/car.json (ficha "s" calculada por tools/build_car_stats.py) e car_id.png
// (raster de identificação usado pelo shader do terreno).
import * as THREE from 'three';
import { CLASSES } from '../data/muni/landuse.js';

const GRAY = '#a8a49a';
const STATUS = (f) => {
  const c = f.cond || '';
  if (c.startsWith('Analisado, em conformidade') && c.includes('ativos')) return 4;
  if (c.startsWith('Analisado, em conformidade')) return 3;
  if (c.includes('regularização')) return 2;
  if (c.includes('notificação') && c.startsWith('Analisado')) return 1;
  return 0;
};
const step = (v, cuts) => { let i = 0; while (i < cuts.length && v >= cuts[i]) i++; return i; };

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
  situacao: {
    label: 'Situação do cadastro',
    buckets: [['Aguardando ou em análise', '#bdb6a8'], ['Analisado, com notificação', '#ef8a47'], ['Aguardando regularização', '#c2412d'], ['Em conformidade', '#5aa469'], ['Em conformidade, com excedente', '#1d6b3a']],
    of: STATUS,
  },
};

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
  constructor({ terrain, vectors, scene, labels, nf, fmtDate, getJSON, onFit, onRoute, routes, onFly }) {
    Object.assign(this, { terrain, vectors, nf, fmtDate, getJSON, onFit, onRoute, routes, onFly });
    this.labelsEl = labels;
    this.on = false; this.data = null; this.criterion = 'tamanho';
    this.fill = true; this.overlap = true; this.app = false;
    this.sel = null; this.hover = null;
    this.labelPool = []; this.labelItems = [];
    // marcador do ponto mais alto
    const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 1, 0)]);
    this.marker = new THREE.Group();
    this.marker.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffffff })));
    const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    ball.name = 'ball'; this.marker.add(ball);
    this.marker.visible = false; this.markerAt = null;
    scene.add(this.marker);
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
    for (let b = -1; b < 6; b++) this.vectors.removeLines(`car-${b}`);
    for (const k of ['mini', 'pequena', 'media', 'grande']) this.vectors.removeLines(`car-${k}`);
    if (!this.on || !this.data) return;
    const groups = new Map();
    const pal = new Uint8Array(64 * 64 * 4);
    this.feats.forEach((f, k) => {
      if (f.status === 'cancelado' || k >= 4096) return;
      const b = this.bucketOf(f);
      if (!groups.has(b)) groups.set(b, []);
      groups.get(b).push(...f.rings);
      const [r, g, bl] = hex2rgb(b < 0 ? GRAY : crit.buckets[b][1]);
      pal.set([r, g, bl, 255], k * 4);
    });
    for (const [b, rings] of groups) {
      const [, hex, w] = b < 0 ? [0, GRAY, 1] : crit.buckets[b];
      this.vectors.addLines(`car-${b}`, 'car', { color: parseInt(hex.slice(1), 16), width: w ?? 1.5, lift: 4, opacity: 0.9, order: 4 }, rings, 30);
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
    if (!x) { this.vectors.removeLines('car-sel'); this.marker.visible = false; return; }
    this.vectors.addLines('car-sel', 'highlight', { color: 0xffffff, width: 3.5, lift: 6, opacity: 1, order: 6, noClip: true }, x.f.rings, 20);
    this.marker.visible = false;
    if (fit) this.onFit(x.f.rings.flat());
  }

  showPeak() {
    const s = this.sel?.f.s; if (!s) return;
    this.markerAt = s.zp; this.marker.visible = true; this.#placeMarker();
    this.onFly(s.zp[0], s.zp[1]);
  }
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
      return { el, pos: new THREE.Vector3(p.x, t.groundY(p.x, p.z) + 8, p.z) };
    });
    for (let i = take.length; i < this.labelPool.length; i++) this.labelPool[i].hidden = true;
  }
  #clearLabels() { this.labelItems = []; for (const el of this.labelPool) el.hidden = true; }
  projectLabels(camera, w, h) {
    const v = new THREE.Vector3();
    for (const it of this.labelItems) {
      v.copy(it.pos).project(camera);
      if (v.z > 1 || v.z < -1) { it.el.style.visibility = 'hidden'; continue; }
      it.el.style.visibility = '';
      it.el.style.transform = `translate(${((v.x * 0.5 + 0.5) * w).toFixed(1)}px, ${((-v.y * 0.5 + 0.5) * h).toFixed(1)}px)`;
    }
  }

  // ---------- ficha ----------
  card(x) {
    const f = x.f, s = f.s, nf = this.nf, esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    const size = CRITERIA.tamanho.buckets[CRITERIA.tamanho.of(f)]?.[0].split(' (')[0] ?? '';
    const st = CRITERIA.situacao.buckets[STATUS(f)];
    let h = `<header class="cc-head">
      <span class="eyebrow">Imóvel rural · CAR</span>
      <h2 id="cc-title">${nf(f.ha, f.ha < 10 ? 2 : 1)} ha <small>${esc(size.toLowerCase())}</small></h2>
      <p class="cc-meta">${nf(f.mf, 2)} módulos fiscais · ${esc(f.mun)} · <span class="cc-chip" style="--c:${st[1]}">${esc(st[0])}</span></p>
    </header>`;
    if (!s) return h + `<p class="model-note">Imóvel fora da área com dados do mapa.</p>`;
    const partial = s.a / f.ha < 0.9 ? `<p class="cc-warn">O imóvel passa da borda do mapa: os números abaixo valem só para a parte dentro dele (${nf(s.a)} ha).</p>` : '';
    // uso do solo
    const lu = s.lu.map(([c, p]) => [CLASSES[c]?.[0] ?? `classe ${c}`, CLASSES[c]?.[1] ?? '#999', p]);
    const bar = lu.map(([n, c, p]) => `<span style="flex:${p} 1 0;background:${c}" title="${esc(n)}: ${nf(p, 1)}%"></span>`).join('');
    const list = lu.slice(0, 5).map(([n, c, p]) => `<li><span class="lc-sw" style="background:${c}"></span><span>${esc(n)}</span><b>${nf(p, p < 10 ? 1 : 0)}%</b></li>`).join('');
    const dv = s.n25 - s.n85, sign = dv > 0.5 ? 'up' : dv < -0.5 ? 'down' : '';
    h += partial + `<div class="cc-grid">
    <section><h3>Uso do solo · 2025</h3>
      <div class="cc-bar" role="img" aria-label="Composição do uso do solo">${bar}</div>
      <ul class="cc-list">${list}</ul>
      <p class="cc-kv">Vegetação nativa (matas e campos) <b>${nf(s.n85)}% → ${nf(s.n25)}%</b> <span class="cc-delta ${sign}">${dv > 0 ? '+' : dv < 0 ? '−' : '±'}${nf(Math.abs(dv))} pp desde 1985</span></p>
      <p class="cc-kv">Só matas <b>${nf(s.f85)}% → ${nf(s.f25)}%</b>${s.eu >= 0.5 ? ` · eucalipto <b>${nf(s.eu)}%</b>` : ''}</p>
    </section>`;
    // APP
    const [aha, anat, adef] = s.app, [mha, mdef, mw, capped] = s.appm;
    h += `<section><h3>APP estimada</h3>` + (aha < 0.1
      ? `<p class="model-note">Nenhuma APP estimada: não há córrego, nascente ou encosta acima de 45° calculados no imóvel.</p>`
      : `<p class="cc-kv">Faixa integral (art. 4º) <b>${nf(aha, 1)} ha</b></p>
      <div class="cc-bar cc-bar--app" role="img" aria-label="${nf(anat)}% com vegetação nativa"><span style="flex:${anat} 1 0;background:#2f8f5b"></span><span style="flex:${100 - anat} 1 0;background:#c2412d"></span></div>
      <p class="cc-kv"><span class="cc-dot" style="background:#2f8f5b"></span>${nf(anat)}% com vegetação nativa · <span class="cc-dot" style="background:#c2412d"></span><b>${nf(adef, 1)} ha</b> com uso agropecuário</p>
      <p class="cc-kv">Se o uso é anterior a 22/07/2008 (art. 61-A): faixa de ${mw} m nos córregos e 15 m nas nascentes, <b>${nf(mdef, 1)} ha</b> a recompor${capped ? ` (teto de ${f.mf <= 2 ? 10 : 20}% da área)` : ''}.</p>`)
      + `<p class="cc-note">Estimativa do app: córregos e nascentes calculados do relevo, uso do MapBiomas 10 m. Não inclui topos de morro nem a Reserva Legal. Não substitui a análise do órgão ambiental.</p></section>`;
    // relevo
    const pctSl = Math.tan((s.sl * Math.PI) / 180) * 100;
    const relevo = pctSl < 3 ? 'plano' : pctSl < 8 ? 'suave ondulado' : pctSl < 20 ? 'ondulado' : pctSl < 45 ? 'forte ondulado' : 'montanhoso';
    h += `<section><h3>Relevo</h3>
      <p class="cc-kv">Altitude <b>${nf(s.z[0])}–${nf(s.z[2])} m</b> · média ${nf(s.z[1])} m</p>
      <p class="cc-kv">Declividade média <b>${nf(s.sl)}°</b> (${nf(pctSl)}%, ${relevo})</p>
      <button type="button" class="btn btn--small" data-act="peak">Ver o ponto mais alto</button>
    </section>`;
    // água e acesso
    const acts = s.sv.map((id) => this.routes.find((a) => a.id === id)).filter(Boolean);
    const routes = acts.length
      ? `<p class="cc-kv">Suas rotas que passam aqui: <b>${acts.length}</b></p><ul class="cc-routes">${acts.slice(0, 4).map((a) => `<li><button type="button" data-route="${a.id}">${esc(a.name)} · ${this.fmtDate(a.date)}</button></li>`).join('')}${acts.length > 4 ? `<li class="model-note">e mais ${acts.length - 4}</li>` : ''}</ul>`
      : `<p class="cc-kv">Nenhuma rota sua passa por aqui.</p>`;
    h += `<section><h3>Água e acesso</h3>
      <p class="cc-kv">Córregos <b>${nf(s.dr, 1)} km</b> · nascentes estimadas <b>${s.nas ?? 0}</b></p>
      <p class="cc-kv">Estradas e caminhos (OSM) <b>${nf(s.rd, 1)} km</b></p>
      ${routes}
    </section></div>`;
    const ov = s.ov[0] >= 0.5 ? `<p class="cc-warn cc-warn--ov">${nf(s.ov[0], 1)} ha (${nf((100 * s.ov[0]) / s.a)}% do imóvel) se sobrepõem a ${Math.max(1, s.ov[1]) === 1 ? 'outro cadastro' : `${s.ov[1]} outros cadastros`}.</p>` : '';
    h += `<footer class="cc-foot">${ov}<p>${esc(f.cond)} · atualizado em ${f.atualizado ? this.fmtDate(f.atualizado) : '—'}</p><p class="cc-cod">${esc(f.cod)}</p></footer>`;
    return h;
  }

  routeById(id) { return this.routes.find((a) => a.id === id); }
}
