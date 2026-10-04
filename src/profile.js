// Perfil do terreno entre dois pontos tocados no mapa: linha sobre o relevo + gráfico de altitude.
import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

const N = 320;

export class TerrainProfile {
  constructor({ terrain, scene, panel, nf }) {
    Object.assign(this, { terrain, panel, nf });
    this.group = new THREE.Group(); scene.add(this.group);
    this.mat = new LineMaterial({ color: 0xffffff, linewidth: 4, worldUnits: false, transparent: true, opacity: 0.95 });
    const pin = (c) => { const m = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), new THREE.MeshBasicMaterial({ color: c })); m.visible = false; this.group.add(m); return m; };
    this.pinA = pin(0x2fbf71); this.pinB = pin(0xe8453c); this.cursor = pin(0x1d2621);
    this.a = null; this.b = null; this.samples = null;
    panel.addEventListener('pointermove', (e) => this.#hover(e));
    panel.addEventListener('pointerleave', () => { this.cursor.visible = false; this.panel.querySelector('.pf-tip')?.setAttribute('hidden', ''); });
  }
  setResolution(w, h) { this.mat.resolution.set(w, h); }

  /** recebe um ponto (local x, z); devolve 'a' ou 'b' conforme o passo */
  add(x, z) {
    if (!this.a || this.b) { this.clear(true); this.a = { x, z }; this.#pins(); return 'a'; }
    this.b = { x, z }; this.#build(); return 'b';
  }
  clear(keepPanel = false) {
    this.a = this.b = this.samples = null;
    if (this.line) { this.line.removeFromParent(); this.line.geometry.dispose(); this.line = null; }
    this.pinA.visible = this.pinB.visible = this.cursor.visible = false;
    if (!keepPanel) this.panel.hidden = true;
  }
  #pins() {
    const t = this.terrain;
    for (const [p, m] of [[this.a, this.pinA], [this.b, this.pinB]]) {
      m.visible = !!p;
      if (p) m.position.set(p.x, t.groundY(p.x, p.z) + 6, p.z);
    }
  }
  // mantém o tamanho dos marcadores constante na tela
  update(camera) {
    for (const m of [this.pinA, this.pinB, this.cursor]) if (m.visible) m.scale.setScalar(Math.max(4, camera.position.distanceTo(m.position) * 0.007));
  }
  refresh() { if (this.b) this.#build(); else this.#pins(); }

  #build() {
    const t = this.terrain, { a, b } = this, nf = this.nf;
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    const S = [];
    for (let k = 0; k <= N; k++) {
      const x = a.x + ((b.x - a.x) * k) / N, z = a.z + ((b.z - a.z) * k) / N;
      const { lat, lon } = t.frame.toLatLon(x, z);
      S.push({ x, z, d: (L * k) / N, e: t.hf.elevation(lat, lon) });
    }
    this.samples = S;
    const arr = [];
    for (let k = 0; k < N; k++) {
      const p = S[k], q = S[k + 1];
      arr.push(p.x, t.groundY(p.x, p.z) + 5, p.z, q.x, t.groundY(q.x, q.z) + 5, q.z);
    }
    if (this.line) { this.line.removeFromParent(); this.line.geometry.dispose(); }
    this.line = new LineSegments2(new LineSegmentsGeometry().setPositions(arr), this.mat);
    this.line.renderOrder = 9;
    this.group.add(this.line);
    this.#pins();
    // números: subida/descida com o perfil suavizado (tira o ruído de 1–2 m do modelo)
    const sm = S.map((s, k) => { let v = 0, n = 0; for (let m = -2; m <= 2; m++) { const q = S[k + m]; if (q) { v += q.e; n++; } } return v / n; });
    let up = 0, down = 0, maxG = 0;
    for (let k = 1; k <= N; k++) { const de = sm[k] - sm[k - 1]; if (de > 0) up += de; else down -= de; }
    const win = Math.max(1, Math.round(30 / (L / N)));
    for (let k = win; k <= N; k += 1) maxG = Math.max(maxG, Math.abs(sm[k] - sm[k - win]) / ((L * win) / N));
    const es = S.map((s) => s.e), emin = Math.min(...es), emax = Math.max(...es);
    this.stats = { L, up, down, emin, emax, maxG };
    // gráfico
    this.panel.hidden = false;
    const W = Math.max(280, Math.round(this.panel.querySelector('.pf-chart').clientWidth) || 640), H = 150, pad = { l: 52, r: 10, t: 10, b: 22 };
    const lo = Math.floor((emin - 10) / 20) * 20, hi = Math.ceil((emax + 10) / 20) * 20;
    const X = (d) => pad.l + (d / L) * (W - pad.l - pad.r), Y = (e) => pad.t + (1 - (e - lo) / (hi - lo)) * (H - pad.t - pad.b);
    this.geom = { W, H, pad, X, Y };
    const line = S.map((s) => `${X(s.d).toFixed(1)},${Y(s.e).toFixed(1)}`).join(' ');
    const area = `${X(0)},${Y(lo)} ${line} ${X(L)},${Y(lo)}`;
    const gy = [lo, (lo + hi) / 2, hi].map((e) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${Y(e)}" y2="${Y(e)}" class="pf-grid"/><text x="${pad.l - 6}" y="${Y(e) + 4}" text-anchor="end">${nf(e)} m</text>`).join('');
    const kmStep = L > 8000 ? 2000 : L > 3000 ? 1000 : L > 1200 ? 500 : 200;
    let gx = '';
    for (let d = 0; d <= L + 1; d += kmStep) gx += `<text x="${X(d)}" y="${H - 6}" text-anchor="${d === 0 ? 'start' : 'middle'}">${d >= 1000 || kmStep >= 1000 ? `${nf(d / 1000, kmStep < 1000 ? 1 : 0)} km` : `${d} m`}</text>`;
    this.panel.querySelector('.pf-chart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Perfil do terreno">
      <polygon points="${area}" class="pf-area"/><polyline points="${line}" class="pf-line"/>${gy}${gx}
      <line class="pf-cur" x1="0" x2="0" y1="${pad.t}" y2="${H - pad.b}" visibility="hidden"/></svg>`;
    const st = this.stats;
    this.panel.querySelector('.pf-stats').innerHTML = `
      <span><b>${L >= 1000 ? `${nf(L / 1000, 2)} km` : `${nf(L)} m`}</b> distância</span>
      <span><b>↗ ${nf(st.up)} m</b> subida</span><span><b>↘ ${nf(st.down)} m</b> descida</span>
      <span><b>${nf(emin)}–${nf(emax)} m</b> altitude</span><span><b>${nf(st.maxG * 100)}%</b> rampa mais forte</span>`;
    this.panel.hidden = false;
  }

  #hover(e) {
    if (!this.samples) return;
    const svg = this.panel.querySelector('svg'); if (!svg) return;
    const r = svg.getBoundingClientRect(), { W, pad, X, Y } = this.geom;
    const vx = ((e.clientX - r.left) / r.width) * W;
    const u = Math.min(1, Math.max(0, (vx - pad.l) / (W - pad.l - pad.r)));
    const s = this.samples[Math.round(u * N)];
    const cur = svg.querySelector('.pf-cur');
    cur.setAttribute('x1', X(s.d)); cur.setAttribute('x2', X(s.d)); cur.setAttribute('visibility', 'visible');
    this.cursor.visible = true;
    this.cursor.position.set(s.x, this.terrain.groundY(s.x, s.z) + 6, s.z);
    const tip = this.panel.querySelector('.pf-tip');
    tip.hidden = false;
    tip.textContent = `${s.d >= 1000 ? `${this.nf(s.d / 1000, 2)} km` : `${this.nf(s.d)} m`} · ${this.nf(s.e)} m`;
    const pr = this.panel.getBoundingClientRect();
    tip.style.left = `${Math.min(pr.width - 110, Math.max(4, e.clientX - pr.left - 40))}px`;
    tip.style.top = `${r.top - pr.top + (Y(s.e) / this.geom.H) * r.height - 28}px`;
  }
}
