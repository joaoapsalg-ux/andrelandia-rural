// Marcadores de pontos de interesse: haste 3D + rótulo HTML projetado.
import * as THREE from 'three';

const KIND_GLYPH = { cidade: '◉', vila: '◎', povoado: '•', localidade: '·', mirante: '△', atrativo: '✦', igreja: '✝', pico: '▲' };
// distância máxima (m) em que cada tipo de rótulo aparece — evita poluição na visão geral
const MAX_DIST = { cidade: 90000, vila: 32000, povoado: 13000, localidade: 8000, pico: 16000, mirante: 10000, atrativo: 7000, igreja: 6000 };

export class POILayer {
  constructor(terrain, container, pois, { onSelect } = {}) {
    this.terrain = terrain;
    this.container = container;
    this.items = [];
    this.group = new THREE.Group();
    this.group.name = 'pois';
    this.visible = true;
    const mat = new THREE.LineBasicMaterial({ color: 0x2b2118, transparent: true, opacity: 0.8 });
    for (const p of pois) {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 1, 0)]);
      const line = new THREE.Line(geo, mat);
      this.group.add(line);
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'poi' + (p.src === 'aprox' ? ' poi--aprox' : '') + (p.inside === false ? ' poi--out' : '');
      el.dataset.kind = p.kind;
      const ele = p.kind === 'pico' && p.ele ? ` <small>${Math.round(p.ele)} m</small>` : '';
      el.innerHTML = `<span class="poi__glyph" aria-hidden="true">${KIND_GLYPH[p.kind] || '•'}</span><span class="poi__name">${p.name}${ele}</span>`;
      el.title = `${p.name}${p.src === 'aprox' ? ' (posição aproximada)' : ''}`;
      el.addEventListener('click', () => onSelect?.(p));
      container.appendChild(el);
      this.items.push({ p, line, el, anchor: new THREE.Vector3(), maxDist: MAX_DIST[p.kind] ?? 8000 });
    }
    this.update();
  }

  // recalcula alturas (ex.: após mudar o exagero vertical)
  update() {
    const t = this.terrain;
    for (const it of this.items) {
      const ground = t.worldPosition(it.p.lat, it.p.lon);
      const stem = 70 * Math.max(1, t.exaggeration * 0.8);
      it.line.position.copy(ground);
      it.line.scale.set(1, stem, 1);
      it.anchor.copy(ground).add(new THREE.Vector3(0, stem, 0));
      it.ground = ground;
    }
  }

  setVisible(v) {
    this.visible = v;
    this.group.visible = v;
    for (const it of this.items) it.el.hidden = !v;
  }

  // posiciona os rótulos a cada quadro
  project(camera, w, h) {
    if (!this.visible) return;
    const v = new THREE.Vector3();
    for (const it of this.items) {
      v.copy(it.anchor).project(camera);
      const dist = camera.position.distanceTo(it.anchor);
      const behind = v.z > 1 || v.z < -1 || dist > it.maxDist || (this.terrain.clipped && it.p.inside === false);
      it.el.hidden = behind;
      it.line.visible = !behind;
      if (behind) continue;
      const x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
      it.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      it.el.style.opacity = String(Math.max(0.35, Math.min(1, 1.5 - dist / it.maxDist)));
      it.el.style.zIndex = String(100000 - Math.round(dist));
    }
  }

  find(id) { return this.items.find((it) => it.p.id === id); }
}
