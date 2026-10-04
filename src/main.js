// Andrelândia Rural — o município em 3D para quem vive da terra.
// Relevo ANADEM + imagem CBERS-4A, propriedades do CAR com ficha, máquina do tempo do uso do solo,
// caminho da água (correnteza e gota de chuva), sol e geada, sobrevoo e perfil do terreno.
import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import config from './config.js';
import { LocalFrame } from './geo.js';
import { CellTerrain } from './cellterrain.js';
import { POILayer } from './pois.js';
import { VectorLayers } from './vectors.js';
import { loadPNG } from './sources/png.js';
import MODELS from '../data/muni/models.js';
import { IMAGERY_SETS, EXTENT } from '../data/muni/grid.js';
import MANUAL_POIS from '../data/pois.js';
import { LANDUSE_LAYERS, GRIDS, CLASSES } from '../data/muni/landuse.js';
import { CarLayer, CRITERIA, histChart, GROUP_COLORS } from './car.js';
import { RainDrop } from './water.js';
import { TerrainProfile } from './profile.js';
import { PropertyDemo } from './demo.js';
import { PropertyWater } from './propwater.js';
import { buildSheet } from './sheet.js';
import { RoadAccess, AccessLayer, accessText } from './access.js';
import { Agro, FEATURED, agroText, bestWindow, zarcStrip, climateChart, phName } from './agro.js';
import { sunPosition, sunDirection, skyState, SkyDome, compassName } from './sun.js';

const $ = (s) => document.querySelector(s);
const stage = $('#stage');
const status = $('#status');
const nf = (v, d = 0) => v.toLocaleString('pt-BR', { maximumFractionDigits: d, minimumFractionDigits: d });
const store = {
  get(k) { try { return localStorage.getItem('andrelandia-rural.' + k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem('andrelandia-rural.' + k, v); } catch { /* sem armazenamento */ } },
};
const getJSON = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error(url); return r.json(); });
const fmtDate = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const fmtLen = (m) => (m >= 1000 ? `${nf(m / 1000, m < 10000 ? 1 : 0)} km` : `${nf(Math.round(m / 10) * 10)} m`);

function inside(ring, lat, lon) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ai, oi] = ring[i], [aj, oj] = ring[j];
    if ((ai > lat) !== (aj > lat) && lon < ((oj - oi) * (lat - ai)) / (aj - ai) + oi) c = !c;
  }
  return c;
}
function splash(frac, msg) {
  const bar = document.getElementById('splash-prog'), m = document.getElementById('splash-msg');
  if (bar) bar.style.width = `${Math.round(frac * 100)}%`;
  if (m && msg) m.textContent = msg;
}
function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

async function start() {
  const frame = new LocalFrame(config.region.origin.lat, config.region.origin.lon);
  const model = MODELS[0];
  // tela de abertura: cada arquivo que chega avança a barra
  let got = 0;
  const step = (p) => p.then((v) => { got++; splash(0.1 + 0.7 * (got / 6), got < 6 ? `Carregando o relevo, as estradas e os rios (${got} de 6)…` : 'Montando o relevo em 3D…'); return v; });
  splash(0.06, 'Carregando o relevo, as estradas e os rios…');
  const [hf, osm, drainage, boundary, places, hist] = await Promise.all([
    step(loadPNG(model)),
    step(getJSON('data/muni/layers/osm.json')),
    step(getJSON('data/muni/layers/drainage.json')),
    step(getJSON('data/muni/layers/boundary.json')),
    step(getJSON('data/muni/layers/places.json')),
    step(getJSON('data/muni/landuse/hist.json')),
  ]);
  const inMuni = (lat, lon) => inside(boundary.ring, lat, lon);

  // --- renderização -------------------------------------------------------
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  stage.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 20, 160000);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x8a7a63, 1.6);
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  scene.add(hemi, sun);

  const style = { surface: 'satellite', contours: false, interval: config.terrain.contourInterval };
  const terrain = new CellTerrain(hf, frame, {
    baseElev: config.terrain.baseElevation, colorRange: config.terrain.colorRange, imagerySet: IMAGERY_SETS[0], renderer,
  });
  terrain.setExaggeration(parseFloat($('#exag').value));
  terrain.setClipPolygon(boundary.ring);
  terrain.setClip(store.get('clip') === '1');
  scene.add(terrain.group);
  function applyTheme() { terrain.setStyle({ paper: cssVar('--relief-paper'), ink: cssVar('--contour'), wall: cssVar('--skirt') }); }
  scene.fog = new THREE.Fog(0xd6ddd9, terrain.shared.uFogNear.value, terrain.shared.uFogFar.value);
  applyTheme();
  terrain.setStyle(style);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

  // --- câmera -------------------------------------------------------------
  const controls = new MapControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.47;
  controls.minDistance = 120;
  controls.maxDistance = 90000;
  controls.zoomToCursor = true;
  controls.keyPanSpeed = 30;
  controls.listenToKeyEvents(window);
  const VIEWS = {
    municipio: { pos: [12000, 20000, 30000], target: [2500, 0, 2500] },
    cidade: { pos: config.camera.position, target: config.camera.target },
  };
  const vpos = (v) => new THREE.Vector3(v.pos.x ?? v.pos[0], (v.pos.y ?? v.pos[1]) * terrain.exaggeration, v.pos.z ?? v.pos[2]);
  const vtgt = (v) => new THREE.Vector3(v.target.x ?? v.target[0], (v.target.y ?? v.target[1]) * terrain.exaggeration, v.target.z ?? v.target[2]);
  camera.position.copy(vpos(VIEWS.municipio));
  controls.target.copy(vtgt(VIEWS.municipio));
  controls.update();

  // --- lugares e vetores -----------------------------------------------------
  const manualNames = new Set(MANUAL_POIS.map((p) => p.name));
  const pois = [
    ...MANUAL_POIS.map((p) => ({ ...p, inside: true })),
    ...places.filter((p) => !manualNames.has(p.name) && !(p.kind === 'pico' && p.name === 'Turvo')),
  ];
  const poiLayer = new POILayer(terrain, $('#labels'), pois, { onSelect: (p) => flyTo(p) });
  scene.add(poiLayer.group);
  const vectors = new VectorLayers(terrain, { osm, drainage, boundary });
  scene.add(vectors.group);

  // --- voo e sobrevoo ----------------------------------------------------------
  let flight = null, orbit = null, follow = false;
  function flyToView(v) { orbit = null; flight = { t: 0, from: camera.position.clone(), to: vpos(v), tFrom: controls.target.clone(), tTo: vtgt(v), dur: 2.2 }; }
  function flyToTarget(target, dist, dur = 1.8) {
    const dir = camera.position.clone().sub(controls.target).normalize();
    const camEnd = target.clone().add(dir.multiplyScalar(dist));
    camEnd.y = Math.max(camEnd.y, target.y + dist * 0.35);
    flight = { t: 0, from: camera.position.clone(), to: camEnd, tFrom: controls.target.clone(), tTo: target, dur: camera.position.distanceTo(camEnd) > 15000 ? 2.6 : dur };
  }
  function flyTo(p) { orbit = null; flyToTarget(terrain.worldPosition(p.lat, p.lon), p.kind === 'cidade' ? 3500 : 1800); showInfo(p); }
  function flyToPoint(lat, lon, dist = 1500) { orbit = null; flyToTarget(terrain.worldPosition(lat, lon), dist, 1.6); }
  function fitLatLon(pts, pad = 1.35) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [la, lo] of pts) { const p = frame.toLocal(la, lo); minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2, size = Math.max(maxX - minX, maxZ - minZ, 600);
    const { lat, lon } = frame.toLatLon(cx, cz);
    const tgt = terrain.worldPosition(lat, lon);
    const dir = camera.position.clone().sub(controls.target); dir.y = 0; dir.normalize();
    // mapa à mostra mais alto que largo (celular em pé, gaveta aberta): afasta mais para caber na largura
    const cw = renderer.domElement.clientWidth || 1, chv = (renderer.domElement.clientHeight || 1) * (mqPhone.matches ? 0.5 : 1);
    const dist = size * pad * Math.max(1, 1.15 / (cw / chv));
    const to = tgt.clone().add(dir.multiplyScalar(dist * 0.75)); to.y = tgt.y + dist * 0.75;
    orbit = null;
    flight = { t: 0, from: camera.position.clone(), to, tFrom: controls.target.clone(), tTo: tgt, dur: 2 };
  }
  function stepFlight(dt) {
    if (!flight) return;
    flight.t = Math.min(1, flight.t + dt / flight.dur);
    const k = flight.t < 0.5 ? 4 * flight.t ** 3 : 1 - (-2 * flight.t + 2) ** 3 / 2;
    camera.position.lerpVectors(flight.from, flight.to, k);
    controls.target.lerpVectors(flight.tFrom, flight.tTo, k);
    if (flight.t >= 1) flight = null;
  }
  // sobrevoo: a câmera dá a volta em torno de um centro, como um drone
  // hRatio: altura da câmera em relação ao raio (0,2 rasante … 1,6 quase de cima) · speed: multiplica a volta
  function startOrbit(center, r, label = 'Sobrevoando', { hRatio = 0.55, speed = 1, dur = 2 } = {}) {
    const h = r * hRatio;
    const ang = Math.atan2(camera.position.x - center.x, camera.position.z - center.z);
    const to = new THREE.Vector3(center.x + r * Math.sin(ang), center.y + h, center.z + r * Math.cos(ang));
    flight = { t: 0, from: camera.position.clone(), to, tFrom: controls.target.clone(), tTo: center.clone(), dur };
    orbit = { c: center.clone(), r, h, ang, speed: (speed * 2 * Math.PI) / Math.max(28, Math.min(60, r / 25)) };
    $('#tool-orbit').setAttribute('aria-pressed', 'true');
    if (!tool) { $('#tool-hint').hidden = false; $('#tool-hint-text').textContent = `${label} · toque no mapa para parar`; }
  }
  function stopOrbit() {
    orbit = null; $('#tool-orbit').setAttribute('aria-pressed', 'false');
    if (!tool) $('#tool-hint').hidden = true;
  }
  function stepOrbit(dt) {
    if (!orbit || flight) return;
    orbit.ang += dt * orbit.speed;
    camera.position.set(orbit.c.x + orbit.r * Math.sin(orbit.ang), orbit.c.y + orbit.h, orbit.c.z + orbit.r * Math.cos(orbit.ang));
    controls.target.copy(orbit.c);
  }
  controls.addEventListener('start', () => { flight = null; follow = false; if (orbit) stopOrbit(); });

  // --- menu: barra de ícones + painel (largura ajustável no computador; gaveta no celular) ------------
  const side = $('#side'), pane = $('#pane'), paneBody = $('#pane-body'), root = document.documentElement;
  const mqPhone = matchMedia('(max-width: 700px)'), mqWide = matchMedia('(min-width: 1000px)');
  const RAIL_W = 68, PANE_MIN = 320, PANE_DEF = 400;
  let paneWant = Math.max(PANE_MIN, parseInt(store.get('paneW') ?? '', 10) || PANE_DEF), paneW = paneWant;   // largura escolhida · largura que cabe
  let curPane = 'prop';
  let collapsed = mqPhone.matches || store.get('paneOpen') === '0';
  let menuReady = false;   // a bolinha da barra depende das propriedades (ainda não carregadas no começo)
  function layout() {
    paneW = Math.min(paneWant, Math.max(PANE_MIN, Math.min(760, innerWidth * 0.6)));
    root.style.setProperty('--pane-w', `${paneW}px`);
    side.classList.toggle('is-collapsed', collapsed);
    side.classList.toggle('is-narrow', paneW < 440);
    // computador largo: o mapa começa depois do painel; tablet: o painel passa por cima; celular: gaveta por cima
    const off = document.body.classList.contains('ui-hidden') || document.body.classList.contains('demo');
    const w = off || mqPhone.matches ? 0 : mqWide.matches && !collapsed ? RAIL_W + paneW : RAIL_W;
    root.style.setProperty('--side-w', `${w}px`);
    document.querySelectorAll('.rail-btn[data-pane]').forEach((b) => b.setAttribute('aria-current', String(!collapsed && b.dataset.pane === curPane)));
    if (menuReady) $('#rail-dot').hidden = !carLayer.sel || (!collapsed && curPane === 'prop');
  }
  function setSheet(s) { pane.classList.toggle('is-full', s === 'full'); pane.classList.toggle('is-peek', s === 'peek'); }
  function setCollapsed(c) {
    collapsed = c;
    if (!mqPhone.matches) store.set('paneOpen', c ? '0' : '1');
    layout();
  }
  /** mostra uma parte do painel (abre o painel se estava recolhido); sheet: altura da gaveta no celular */
  function showPane(name, { sheet = 'half' } = {}) {
    const changed = name !== curPane;
    curPane = name;
    document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('is-on', p.dataset.pane === name));
    if (mqPhone.matches && (collapsed || changed)) setSheet(sheet);
    if (changed) paneBody.scrollTop = 0;
    setCollapsed(false);
  }
  document.querySelectorAll('.rail-btn[data-pane]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.pane === curPane && !collapsed) setCollapsed(true); else showPane(b.dataset.pane);
  }));
  $('#pane-x').addEventListener('click', () => setCollapsed(true));
  // largura: arrastar a borda do painel (duplo clique volta ao padrão)
  {
    const grip = $('#pane-resize');
    grip.addEventListener('pointerdown', (e) => {
      grip.setPointerCapture(e.pointerId); grip.classList.add('is-drag'); document.body.classList.add('is-resizing');
      const move = (ev) => { paneWant = Math.max(PANE_MIN, Math.min(760, ev.clientX - RAIL_W)); layout(); };
      const up = () => {
        grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up);
        grip.classList.remove('is-drag'); document.body.classList.remove('is-resizing');
        store.set('paneW', String(Math.round(paneWant)));
        if (carLayer.sel && !carCard.hidden) renderCard(carLayer.sel);   // gráficos na largura nova
      };
      grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up);
    });
    grip.addEventListener('dblclick', () => { paneWant = PANE_DEF; store.set('paneW', String(PANE_DEF)); layout(); if (carLayer.sel && !carCard.hidden) renderCard(carLayer.sel); });
  }
  // celular: alça da gaveta — tocar alterna meia/alta; arrastar para cima abre, para baixo baixa e depois recolhe
  {
    const grip = $('#pane-grip');
    let y0 = null;
    grip.addEventListener('pointerdown', (e) => { y0 = e.clientY; grip.setPointerCapture(e.pointerId); });
    grip.addEventListener('pointerup', (e) => {
      if (y0 == null) return;
      const dy = e.clientY - y0; y0 = null;
      const full = pane.classList.contains('is-full'), peek = pane.classList.contains('is-peek');
      if (Math.abs(dy) < 8) setSheet(full ? 'half' : 'full');
      else if (dy < 0) setSheet(peek ? 'half' : 'full');
      else if (full) setSheet('half');
      else if (!peek) setSheet('peek');
      else setCollapsed(true);
    });
  }
  addEventListener('resize', layout);
  mqPhone.addEventListener('change', () => { collapsed = mqPhone.matches || store.get('paneOpen') === '0'; layout(); });
  mqWide.addEventListener('change', layout);
  layout();

  // --- resultados no painel: ficha (Propriedade), gota e perfil (Ferramentas), lugar (Lugares) -------------
  const PANELS = { info: $('#info'), car: $('#car-card'), drop: $('#drop-card'), profile: $('#profile') };
  const PANE_OF = { info: 'lugares', car: 'prop', drop: 'ferr', profile: 'ferr' };
  function openPanel(name) {
    if (name === 'drop') PANELS.profile.hidden = true;
    if (name === 'profile') PANELS.drop.hidden = true;
    if (name === 'car') showCard(true); else PANELS[name].hidden = false;
    // no celular a gota e o perfil abrem a gaveta baixa: o mapa (onde a gota desce) continua à vista
    showPane(PANE_OF[name], { sheet: name === 'drop' || name === 'profile' ? 'peek' : 'half' });
    if (name !== 'car') requestAnimationFrame(() => PANELS[name].scrollIntoView({ block: 'nearest', behavior: reduceMotion.matches ? 'auto' : 'smooth' }));
  }
  function showCard(on) { PANELS.car.hidden = !on; $('#prop-empty').hidden = on; layout(); }
  let infoPOI = null;
  function showInfo(p) {
    infoPOI = p;
    carLayer.select(null);
    $('#info-name').textContent = p.name;
    $('#info-meta').textContent = `${nf(hf.elevation(p.lat, p.lon))} m de altitude${p.inside === false ? ' · fora do município' : ''}`;
    $('#info-src').textContent = p.src === 'aprox' ? 'Posição aproximada' : 'OpenStreetMap';
    openPanel('info');
  }
  $('#info-close').addEventListener('click', () => { PANELS.info.hidden = true; infoPOI = null; });
  $('#rail-logo').addEventListener('click', () => flyToView(VIEWS.municipio));
  document.addEventListener('click', (e) => {
    const c = e.target.closest('[data-close]'); if (!c) return;
    PANELS[c.dataset.close].hidden = true;
    if (c.dataset.close === 'drop') drop.stop();
    if (c.dataset.close === 'profile') { profile.clear(); setTool(null); }
  });

  // --- sol e céu ------------------------------------------------------------------
  const lightUI = { time: $('#time'), out: $('#time-out'), sun: $('#sun-out') };
  const sky = new SkyDome();
  scene.add(sky.mesh);
  const today = new Date();
  const savedMin = parseInt(store.get('timeMin') ?? '', 10);
  lightUI.time.value = Number.isFinite(savedMin) ? savedMin : 16 * 60 + 20;   // fim da tarde: o relevo fica mais bonito
  function applySun() {
    const min = parseInt(lightUI.time.value, 10);
    const date = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0) + (min + 180) * 60000);
    const pos = sunPosition(date, config.region.origin.lat, config.region.origin.lon);
    const dir = sunDirection(pos), st = skyState(pos.elevation);
    terrain.setSun({ dir, color: st.sunColor, intensity: st.intensity, ambient: st.ambient });
    sun.position.copy(dir); sun.color.copy(st.sunColor); sun.intensity = 0.25 + 1.3 * st.intensity;
    hemi.intensity = 0.25 + 1.4 * st.ambient;
    sky.set(st, dir);
    scene.fog.color.copy(st.horizon);
    terrain.setStyle({ fog: st.horizon });
    // hora mágica, neblina da manhã nas baixadas e noite
    const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    const el = pos.elevation, morning = min >= 240 && min < 720;
    const mist = $('#t-mist').checked && morning ? (1 - sm(4, 19, el)) * sm(-8, -2, el) : 0;
    terrain.setAtmosphere({ gold: st.gold, mist, night: st.night });
    vectors.setNight(st.night);
    vectors.setWaterLight(new THREE.Color('#9fd0f5').lerp(st.horizon, 0.55), (0.35 + 0.75 * st.gold) * (1 - 0.8 * st.night));
    if (st.night > 0) setTimeout(() => ensureLights().catch((e) => { lightsP = null; console.warn('luzes', e); }), 0);
    lightUI.out.textContent = `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
    lightUI.sun.textContent = pos.elevation > 0 ? `Sol a ${nf(pos.elevation)}° de altura, a ${compassName(pos.azimuth)}` : pos.elevation > -6 ? 'Crepúsculo' : 'Noite';
    store.set('timeMin', String(min));
  }
  lightUI.time.addEventListener('input', applySun);
  // atalhos de hora: a régua anda suave até a hora pedida (o céu e a luz acompanham)
  let timeAnim = null;
  function goToMinute(target) {
    const from = parseInt(lightUI.time.value, 10), t0 = performance.now();
    cancelAnimationFrame(timeAnim);
    const step = (now) => {
      const k = Math.min(1, (now - t0) / 1400), e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      lightUI.time.value = String(Math.round((from + (target - from) * e) / 5) * 5);
      applySun();
      if (k < 1) timeAnim = requestAnimationFrame(step);
    };
    timeAnim = requestAnimationFrame(step);
  }
  // primeiro minuto do dia (a partir de "from") em que o sol cumpre a condição
  function sunMinute(from, to, test) {
    for (let m = from; m <= to; m += 2) {
      const d = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0) + (m + 180) * 60000);
      if (test(sunPosition(d, config.region.origin.lat, config.region.origin.lon).elevation)) return m;
    }
    return from;
  }
  $('#time-now').addEventListener('click', () => {
    const now = new Date(Date.now() - 3 * 3600000);
    goToMinute(now.getUTCHours() * 60 + now.getUTCMinutes());
  });
  $('#time-dawn').addEventListener('click', () => goToMinute(sunMinute(240, 600, (e) => e > 3)));    // sol nascendo: neblina nas baixadas
  $('#time-gold').addEventListener('click', () => goToMinute(sunMinute(720, 1200, (e) => e < 6)));   // sol a ~6° da tarde
  $('#time-night').addEventListener('click', () => goToMinute(21 * 60 + 30));
  {
    const mistBox = $('#t-mist');
    mistBox.checked = (store.get('mist') ?? '1') === '1';
    mistBox.addEventListener('change', () => { store.set('mist', mistBox.checked ? '1' : '0'); applySun(); });
  }

  // luzes da noite (feitas na primeira vez que escurece): a mancha urbana do MapBiomas 2025 (classe 24) salpicada de
  // casas, os postes ao longo das ruas que passam por ela e grupinhos de luz nos povoados. R = pontos, G = halo.
  let lightsP = null;
  function ensureLights() {
    lightsP ??= (async () => {
      const E = EXTENT, { W, H } = terrain.lightsSize;   // mesma grade da máscara do limite (as luzes vão no R/G dela)
      const px = (lat, lon) => [((lon - E.w) / (E.e - E.w)) * W, ((E.n - lat) / (E.n - E.s)) * H];
      const bmp = await createImageBitmap(await blobOf(YEARS.length - 1), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
      const c0 = document.createElement('canvas'); c0.width = bmp.width; c0.height = bmp.height;
      const g0 = c0.getContext('2d', { willReadFrequently: true }); g0.drawImage(bmp, 0, 0);
      const lc = g0.getImageData(0, 0, bmp.width, bmp.height).data, G = GRIDS.g30;
      const urban = (lat, lon) => {
        const i = Math.floor((lon - G.lon0) / G.d), j = Math.floor((G.lat0 - lat) / G.d);
        return i >= 0 && j >= 0 && i < G.w && j < G.h && lc[(j * G.w + i) * 4] === 24;
      };
      let seed = 7;
      const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const g = cv.getContext('2d', { willReadFrequently: true });
      g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
      g.globalCompositeOperation = 'lighter';
      const dot = (x, y, a, s = 1) => { g.fillStyle = `rgba(255,255,255,${a})`; g.fillRect(x - s / 2, y - s / 2, s, s); };
      // casas na mancha urbana
      for (let j = 0; j < G.h; j++) for (let i = 0; i < G.w; i++) {
        if (lc[(j * G.w + i) * 4] !== 24) continue;
        const [x, y] = px(G.lat0 - (j + 0.5) * G.d, G.lon0 + (i + 0.5) * G.d);
        for (let k = 0; k < 2; k++) if (rnd() < 0.4) dot(x + (rnd() - 0.5) * 2.2, y + (rnd() - 0.5) * 2.2, 0.2 + 0.4 * rnd());
      }
      // postes nas ruas dentro da mancha urbana (a cada ~25 m)
      for (const f of osm.features) {
        if (f.kind !== 'highway') continue;
        for (const line of f.geom) for (let k = 0; k < line.length - 1; k++) {
          const [la0, lo0] = line[k], [la1, lo1] = line[k + 1];
          const len = Math.hypot((la1 - la0) * 110574, (lo1 - lo0) * 103400), n = Math.max(1, Math.round(len / 25));
          for (let s = 0; s < n; s++) {
            const la = la0 + ((la1 - la0) * s) / n, lo = lo0 + ((lo1 - lo0) * s) / n;
            if (!urban(la, lo)) continue;
            const [x, y] = px(la, lo); dot(x, y, 0.7, 1.4);
          }
        }
      }
      // povoados, vilas e localidades: grupinho de luzes
      for (const p of places) {
        if (!['povoado', 'vila', 'localidade'].includes(p.kind)) continue;
        const [x, y] = px(p.lat, p.lon), nLights = p.kind === 'vila' ? 26 : p.kind === 'povoado' ? 14 : 6, r = p.kind === 'vila' ? 14 : 8;
        for (let k = 0; k < nLights; k++) { const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * r; dot(x + Math.cos(a) * d, y + Math.sin(a) * d, 0.4 + 0.5 * rnd(), 1.3); }
      }
      // halo: a mesma imagem reduzida e ampliada (desfoca sem filtro de canvas, que o Safari não tem)
      const sw = Math.round(W / 8), sh = Math.round(H / 8);
      const cs = document.createElement('canvas'); cs.width = sw; cs.height = sh;
      const gs = cs.getContext('2d'); gs.imageSmoothingQuality = 'high'; gs.drawImage(cv, 0, 0, sw, sh);
      const cg = document.createElement('canvas'); cg.width = W; cg.height = H;
      const gg = cg.getContext('2d', { willReadFrequently: true }); gg.imageSmoothingEnabled = true; gg.drawImage(cs, 0, 0, W, H);
      const A = g.getImageData(0, 0, W, H).data, B = gg.getImageData(0, 0, W, H).data, rg = new Uint8Array(W * H * 2);
      for (let i = 0, n = W * H; i < n; i++) { rg[i * 2] = A[i * 4]; rg[i * 2 + 1] = Math.min(255, B[i * 4] * 2.5); }
      terrain.setLights(rg);
      return true;
    })();
    return lightsP;
  }
  const shadowBox = $('#t-shadows');
  shadowBox.checked = store.get('shadows') === '1';
  terrain.setShadows(shadowBox.checked);
  shadowBox.addEventListener('change', () => { terrain.setShadows(shadowBox.checked); store.set('shadows', shadowBox.checked ? '1' : '0'); });
  // imagem na "opção F" (escolhida nos testes da propriedade de 144 ha): nitidez + clareza da imagem de perto
  // e acabamento de cinema ligado por padrão em todos os aparelhos (a pessoa pode desligar em "Luz do dia")
  terrain.shared.uSharp.value = 0.5; terrain.shared.uClarity.value = 0.5;
  const filmBox = $('#t-film');
  const applyFilm = () => { terrain.setFilm(filmBox.checked ? 1 : 0); document.body.classList.toggle('film', filmBox.checked); };
  filmBox.checked = (store.get('film') ?? '1') === '1';
  applyFilm();
  filmBox.addEventListener('change', () => { applyFilm(); store.set('film', filmBox.checked ? '1' : '0'); });
  // nuvens: no céu e a sombra delas passando no chão (ligadas por padrão; custo pequeno, duas leituras de textura)
  const cloudBox = $('#t-clouds');
  const applyClouds = () => { const v = cloudBox.checked ? 1 : 0; terrain.setClouds(v); sky.setClouds(terrain.cloudTex, v); };
  cloudBox.checked = (store.get('clouds') ?? '1') === '1';
  applyClouds();
  cloudBox.addEventListener('change', () => { applyClouds(); store.set('clouds', cloudBox.checked ? '1' : '0'); });
  // tema: automático (do aparelho), claro ou escuro
  function setTheme(t) {
    if (t === 'auto') delete root.dataset.theme; else root.dataset.theme = t;
    store.set('theme', t);
    applyTheme();
  }
  {
    const t = ['light', 'dark'].includes(store.get('theme')) ? store.get('theme') : 'auto';
    $(`#th-${t}`).checked = true;
    if (t !== 'auto') setTheme(t);
    document.querySelectorAll('input[name="theme"]').forEach((r) => r.addEventListener('change', () => { if (r.checked) setTheme(r.value); }));
  }
  applySun();

  // --- uso do solo: máquina do tempo -------------------------------------------------
  const palData = new Uint8Array(256 * 4);
  for (const [code, [, hex]] of Object.entries(CLASSES)) {
    const c = parseInt(hex.slice(1), 16);
    palData.set([(c >> 16) & 255, (c >> 8) & 255, c & 255, 255], Number(code) * 4);
  }
  const palette = new THREE.DataTexture(palData, 256, 1);
  palette.magFilter = palette.minFilter = THREE.NearestFilter; palette.needsUpdate = true;
  terrain.setLcGrid(GRIDS.g30, palette);
  const YEARS = LANDUSE_LAYERS.map((l) => l.year);
  // 41 anos: os PNGs ficam guardados compactados (≈ 14 MB) e só uns poucos viram textura por vez
  const lcBlob = new Map(), lcTex = new Map();
  const blobOf = (i) => { if (!lcBlob.has(i)) lcBlob.set(i, fetch(LANDUSE_LAYERS[i].url).then((r) => r.blob())); return lcBlob.get(i); };
  let pinned = new Set();
  function loadYear(i) {
    let p = lcTex.get(i);
    if (!p) {
      p = blobOf(i)
        .then((b) => createImageBitmap(b, { imageOrientation: 'flipY', colorSpaceConversion: 'none', premultiplyAlpha: 'none' }))
        .then((bmp) => { const t = new THREE.Texture(bmp); t.flipY = false; t.needsUpdate = true; return t; });
    }
    lcTex.delete(i); lcTex.set(i, p);       // mais recente no fim (LRU)
    for (const [k, old] of lcTex) {
      if (lcTex.size <= 6) break;
      if (pinned.has(k)) continue;
      lcTex.delete(k);
      old.then((t) => { t.dispose(); t.image?.close?.(); });
    }
    return p;
  }
  let tmPos = YEARS.length - 1, playing = null, tmTicket = 0;
  const tmRange = $('#tm-year');
  tmRange.max = String(YEARS.length - 1);
  $('#tm-chart').innerHTML = histChart(hist.muni, YEARS, hist.groups) + '<span class="hist-mark" id="tm-mark"></span>';
  async function setYearPos(v) {
    tmPos = Math.max(0, Math.min(YEARS.length - 1, v));
    let i = Math.floor(tmPos), f = tmPos - i;
    if (i >= YEARS.length - 1) { i = YEARS.length - 2; f = 1; }
    const near = Math.round(tmPos), yr = YEARS[i] + (YEARS[i + 1] - YEARS[i]) * f;
    tmRange.value = String(tmPos);
    $('#year-badge').textContent = YEARS[near];
    $('#tm-mark').style.left = `${(2 + ((yr - YEARS[0]) / (YEARS.at(-1) - YEARS[0])) * 296) / 3}%`;
    $('#tm-legend').innerHTML = hist.groups.map((g, k) => `<span><span class="lc-sw" style="background:${GROUP_COLORS[k]}"></span>${g}<b>${nf(hist.muni[near][k])}%</b></span>`).join('');
    if (splitOn) updateSplitLabels();
    const ticket = ++tmTicket;
    pinned = new Set([i, i + 1, beforeIdx]);
    const [a, b] = await Promise.all([loadYear(i), loadYear(i + 1)]);
    if (ticket !== tmTicket) return;          // já pediram outro ano
    terrain.setLanduseBlend(a, b, f);
    if (i + 2 < YEARS.length) loadYear(i + 2);  // adianta o próximo
  }
  tmRange.addEventListener('input', () => { stopPlay(); setYearPos(parseFloat(tmRange.value)); });
  tmRange.addEventListener('change', () => setYearPos(Math.round(parseFloat(tmRange.value))));
  function stopPlay() { playing = null; $('#tm-icon').setAttribute('d', 'M2 1l7 4-7 4z'); $('#tm-state').textContent = ''; }
  $('#tm-play').addEventListener('click', async () => {
    if (playing) { stopPlay(); return; }
    // baixa os 41 anos antes de tocar, mostrando o progresso
    let n = 0;
    $('#tm-state').textContent = 'Carregando os anos…';
    await Promise.all(YEARS.map((_, i) => blobOf(i).then(() => { $('#tm-state').textContent = `Carregando os anos: ${++n} de ${YEARS.length}`; })));
    $('#tm-state').textContent = '';
    if (tmPos >= YEARS.length - 1.001) await setYearPos(0);
    playing = { hold: 0.6 };
    $('#tm-icon').setAttribute('d', 'M2 1h2.2v8H2zM5.8 1H8v8H5.8z');
  });
  function stepPlay(dt) {
    if (!playing) return;
    if (playing.hold > 0) { playing.hold -= dt; return; }
    const next = Math.floor(tmPos + 1e-6) + 1;
    let v = tmPos + dt * 2.2;                  // ~2 anos por segundo, com transição
    if (v >= next) { v = next; playing.hold = next >= YEARS.length - 1 ? 0 : 0.12; }
    setYearPos(v);
    if (v >= YEARS.length - 1) stopPlay();
  }

  // --- sol e geada (mapas calculados) ------------------------------------------------
  new THREE.TextureLoader().loadAsync('data/muni/layers/solgeada.png').then((t) => terrain.setSolTexture(t));
  const SOL = {
    'sol-inverno': { range: [1.6, 5.0], note: `21 de junho, céu limpo, com a sombra dos morros. No inverno o sol fica baixo ao norte: encostas viradas para o norte (soalheiras) recebem até 3 vezes mais que as viradas para o sul (noruegas). Média do município: ${nf(hist.sol[0], 1)}.` },
    'sol-verao': { range: [6.1, 7.4], note: `21 de dezembro, céu limpo. No verão o sol passa quase a pino e o terreno todo recebe parecido. Média do município: ${nf(hist.sol[1], 1)}.` },
  };
  $('#alt-min').textContent = `${nf(hf.min)} m`; $('#alt-max').textContent = `${nf(hf.max)} m`;

  // --- transição suave: foto da tela por cima, troca por baixo, a foto esmaece ----------
  const fadeCv = document.createElement('canvas');
  fadeCv.id = 'fade-shot'; fadeCv.setAttribute('aria-hidden', 'true');
  stage.after(fadeCv);
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  function crossfade() {
    if (reduceMotion.matches) return;
    renderer.render(scene, camera);   // o buffer só vale logo depois de desenhar
    fadeCv.width = renderer.domElement.width; fadeCv.height = renderer.domElement.height;
    fadeCv.getContext('2d').drawImage(renderer.domElement, 0, 0);
    fadeCv.classList.remove('is-fading'); fadeCv.style.opacity = '1';
    void fadeCv.offsetWidth;
    fadeCv.classList.add('is-fading'); fadeCv.style.opacity = '0';
  }

  // --- superfície --------------------------------------------------------------------
  function setSurface(v, { fade = false } = {}) {
    if (fade && v !== style.surface) crossfade();
    style.surface = v; terrain.setStyle(style);
    $('#lc-panel').hidden = v !== 'landuse';
    $('#sol-panel').hidden = !SOL[v];
    $('#geada-panel').hidden = v !== 'geada';
    $('#alt-panel').hidden = v !== 'altitude';
    $('#vig-panel').hidden = v !== 'vigor';
    if (v === 'vigor') loadVigor(VIG.season);
    $('#year-badge').hidden = v !== 'landuse';
    if (SOL[v]) { $('#sol-min').textContent = nf(SOL[v].range[0], 1); $('#sol-max').textContent = nf(SOL[v].range[1], 1); $('#sol-note').textContent = SOL[v].note; }
    if (v === 'landuse') setYearPos(tmPos); else stopPlay();
    if (splitOn) updateSplitLabels();
    store.set('surface', v);
  }
  $('#surface').addEventListener('change', (e) => { if (e.target.name === 'surface') setSurface(e.target.value, { fade: true }); });

  // --- vigor da vegetação (NDVI da Sentinel-2): um mapa por estação de 2026, só o da estação escolhida vira textura ---
  const VIG = { season: store.get('vigSeason') === 'seca' ? 'seca' : 'aguas', tex: null, key: null, p: null };
  const VIG_NOTE = {
    aguas: 'O quanto a vegetação estava verde nas águas de 2026 (jan–abr), pela Sentinel-2 (10 m). Pasto bem formado fica verde; o que segue marrom nas águas pode ser pasto fraco, solo exposto ou roçado. Mata fica sempre verde-escura.',
    seca: 'O verde que sobrou na seca de 2026 (jul–set). Pasto seca e fica marrom — é normal; o que segura o verde costuma ser baixada úmida, capineira, irrigação, eucalipto ou mata.',
  };
  // faixa da rampa por estação: nas águas quase tudo fica entre 0,65 e 0,85 — a rampa abre ali para separar pasto fraco e forte
  const VIG_RANGE = { aguas: [0.45, 0.9], seca: [0.2, 0.8] };
  function loadVigor(season) {
    $('#vig-note').textContent = VIG_NOTE[season];
    $('#vig-min').textContent = nf(VIG_RANGE[season][0], 2); $('#vig-max').textContent = nf(VIG_RANGE[season][1], 2);
    if (VIG.key === season) return VIG.p;
    VIG.key = season;
    $('#vig-state').textContent = 'Carregando o mapa de vigor…';
    VIG.p = carLayer.loadVigor().then((d) => {
      if (!d) throw new Error('sem vigor.json');
      return new THREE.TextureLoader().loadAsync(`data/muni/layers/vigor_${season}_${d.years.at(-1)}.webp`);
    }).then((t) => {
      if (VIG.key !== season) { t.dispose(); return VIG.p; }   // trocaram de estação enquanto carregava
      VIG.tex?.dispose(); VIG.tex = t;
      terrain.setVigorTexture(t, VIG_RANGE[season]);
      $('#vig-state').textContent = '';
      return t;
    }).catch(() => { VIG.key = null; $('#vig-state').textContent = 'O mapa de vigor ainda não está disponível.'; return null; });
    return VIG.p;
  }
  $(`#vs-${VIG.season}`).checked = true;
  document.querySelectorAll('input[name="vig-season"]').forEach((r) => r.addEventListener('change', () => {
    if (!r.checked) return;
    VIG.season = r.value; store.set('vigSeason', r.value);
    if (style.surface === 'vigor') { crossfade(); loadVigor(r.value); }
  }));

  // --- antes e depois ------------------------------------------------------------------
  let splitOn = false, splitX = 0.5, beforeIdx = 0;
  const splitEl = $('#split');
  const SURF_NAME = { satellite: 'Satélite hoje', altitude: 'Altitude', vigor: 'Vigor 2026', 'sol-inverno': 'Sol no inverno', 'sol-verao': 'Sol no verão', geada: 'Geada' };
  const splitSel = $('#split-year');
  splitSel.innerHTML = YEARS.slice(0, -1).map((y, k) => `<option value="${k}">${y}</option>`).join('');
  function updateSplitLabels() {
    splitSel.value = String(beforeIdx);
    $('#split-r').textContent = style.surface === 'landuse' ? `${YEARS[Math.round(tmPos)]} ▸` : `${SURF_NAME[style.surface]} ▸`;
  }
  function placeSplit() {
    const r = renderer.domElement.getBoundingClientRect(), w = r.width;
    splitEl.style.left = `${r.left + splitX * w}px`;
    terrain.setSplit(splitOn ? splitX * w * renderer.getPixelRatio() : -1);
  }
  async function setSplit(on) {
    splitOn = on;
    $('#tool-split').setAttribute('aria-pressed', String(on));
    splitEl.hidden = !on;
    if (on) { terrain.setBeforeTexture(await loadYear(beforeIdx)); updateSplitLabels(); }
    placeSplit();
  }
  splitEl.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.tag')) return;
    splitEl.setPointerCapture(e.pointerId);
    const move = (ev) => { const r = renderer.domElement.getBoundingClientRect(); splitX = Math.min(0.97, Math.max(0.03, (ev.clientX - r.left) / r.width)); placeSplit(); };
    const up = () => { splitEl.removeEventListener('pointermove', move); splitEl.removeEventListener('pointerup', up); };
    splitEl.addEventListener('pointermove', move); splitEl.addEventListener('pointerup', up);
  });
  // o ano da esquerda é escolhido na lista
  splitSel.addEventListener('change', async () => {
    beforeIdx = +splitSel.value;
    pinned.add(beforeIdx);
    terrain.setBeforeTexture(await loadYear(beforeIdx));
  });
  splitSel.addEventListener('pointerdown', (e) => e.stopPropagation());

  // --- água: correnteza e gota de chuva --------------------------------------------------
  let flowBuilt = false;
  function setFlow(on) {
    if (on && !flowBuilt) {
      flowBuilt = true;
      const groups = [['flow-s', (o) => o <= 2, 1.6, 16, 40, 22], ['flow-m', (o) => o >= 3 && o <= 4, 2.2, 24, 60, 34], ['flow-l', (o) => o >= 5, 3, 36, 90, 50]];
      for (const [key, test, width, dash, gap, speed] of groups) {
        vectors.addLines(key, 'flow', { color: 0xeefaff, width, lift: 3.2, opacity: 0.9, dashed: true, dashSize: dash, gapSize: gap, flow: speed, order: 3 },
          drainage.features.filter((f) => test(f.order)).map((f) => f.geom), 40);
      }
    }
    vectors.setVisible('flow', on);
    store.set('flow', on ? '1' : '0');
  }
  const flowBox = $('#t-flow');
  flowBox.checked = (store.get('flow') ?? '1') === '1';
  setFlow(flowBox.checked);
  flowBox.addEventListener('change', () => setFlow(flowBox.checked));
  $('#t-water').addEventListener('change', (e) => { vectors.setVisible('water', e.target.checked); vectors.setVisible('drainage', e.target.checked); });

  const drop = new RainDrop({ terrain, scene, drainage, osm, inMunicipio: inMuni });
  async function rain(lat, lon) {
    await drop.load();
    const p = drop.trace(lat, lon);
    if (p.pts.length < 2) return;
    drop.start(p);
    stopOrbit();
    flyToTarget(terrain.worldPosition(lat, lon), 2600, 1.4);
    follow = true;
    const steps = [[0, `a chuva cai a ${nf(p.z0)} m de altitude`]];
    if (p.channelDist != null && p.channelDist > 0) steps.push([p.channelDist, 'chega a um córrego']);
    for (const r of p.river) steps.push([r.at, `entra no ${r.name}`]);
    if (p.exitAt != null) steps.push([p.exitAt, 'sai do município de Andrelândia']);
    steps.push([p.length + 0.1, p.leftMap ? `sai do mapa a ${nf(p.zEnd)} m de altitude` : 'para numa baixada sem saída no mapa']);
    steps.sort((x, y) => x[0] - y[0]);
    $('#drop-title').textContent = `A gota desce ${nf(Math.max(0, p.z0 - p.zEnd))} m em ${fmtLen(p.length)}`;
    $('#drop-steps').innerHTML = steps.map(([d, t]) => `<li><b>${fmtLen(d)}</b><span>${t}</span></li>`).join('');
    const viaGrande = p.river.some((r) => r.name === 'Rio Grande');
    $('#drop-note').textContent = viaGrande
      ? 'Daqui o Rio Grande leva a água até o Rio Paraná, que deságua no oceano Atlântico pelo Rio da Prata, entre a Argentina e o Uruguai.'
      : 'Como em toda esta região, a água segue depois para o Rio Grande e o Rio Paraná, e chega ao oceano Atlântico pelo Rio da Prata, entre a Argentina e o Uruguai.';
    openPanel('drop');
  }

  // --- perfil do terreno -------------------------------------------------------------------
  const profile = new TerrainProfile({ terrain, scene, panel: $('#profile'), nf });

  // --- propriedades rurais (CAR) ------------------------------------------------------------
  let waterInfo = null;   // água da propriedade ligada: { x, st }
  let routeX = null;      // propriedade com o caminho pela estrada no mapa
  const carLayer = new CarLayer({
    terrain, vectors, scene, labels: $('#labels'), nf, fmtDate, getJSON,
    onFit: (pts) => fitLatLon(pts, 1.6),
    onFly: (lat, lon) => flyToPoint(lat, lon, 1400),
    onSelect: (x) => onCarSelect(x),
  });
  carLayer.muni = hist;
  menuReady = true;
  const carBox = $('#t-car'), carCard = $('#car-card'), carTip = $('#car-tip'), carSel = $('#car-crit');
  carSel.innerHTML = Object.entries(CRITERIA).map(([k, c]) => `<option value="${k}">${c.label}</option>`).join('');
  carSel.value = CRITERIA[store.get('carCrit')] ? store.get('carCrit') : 'tamanho';
  carLayer.criterion = carSel.value;
  for (const [id, key, def, fn] of [['#car-fill', 'carFill', '0', 'setFill'], ['#car-ov', 'carOv', '0', 'setOverlap'], ['#car-app', 'carApp', '0', 'setApp']]) {
    const el = $(id);
    el.checked = (store.get(key) ?? def) === '1';
    carLayer[fn](el.checked);
    el.addEventListener('change', () => { carLayer[fn](el.checked); store.set(key, el.checked ? '1' : '0'); $('#car-app-key').hidden = !$('#car-app').checked; });
  }
  $('#car-app-key').hidden = !$('#car-app').checked;
  function renderCarLegend() {
    const { rows, note } = carLayer.legend();
    $('#car-legend').innerHTML = rows.map(([l, c, n, ha]) => `<div class="row car-row"><span><span class="lc-sw" style="background:${c}"></span> ${l}</span><span>${nf(n)}${ha ? ` · ${nf(ha / 100, 1)} km²` : ''}</span></div>`).join('')
      + (note ? `<p class="model-note">${note}</p>` : '');
  }
  async function drawCar(on) {
    if (on && !carLayer.data) $('#car-state').textContent = 'Carregando as propriedades…';
    $('#car-panel').hidden = !on;
    await carLayer.setOn(on);
    if (!on) { closeCarCard(); return; }
    $('#car-state').textContent = '';
    const st = carLayer.data.stats_andrelandia, r = carLayer.data.resumo;
    const tot = Object.values(st).reduce((x, y) => x + y.n, 0);
    $('#car-sum').innerHTML = `<b>${nf(tot)}</b> propriedades declaradas em Andrelândia, cobrindo ${nf(r.cobertos_car_pct)}% do município.`;
    const ms = $('#muni-stats');
    ms.innerHTML = `<div><b>${nf(tot)}</b><span>propriedades no CAR</span></div><div><b>${nf(r.cobertos_car_pct)}%</b><span>do município cadastrado</span></div><div><b>${nf(r.nascentes)}</b><span>nascentes estimadas</span></div>`;
    ms.hidden = false;
    renderCarLegend();
    carLayer.loadVigor().then(() => { if (carLayer.criterion === 'vigor') { carLayer.redraw(); renderCarLegend(); } });
  }
  carBox.checked = (store.get('car') ?? '1') === '1';
  if (carBox.checked) drawCar(true);
  carBox.addEventListener('change', () => { drawCar(carBox.checked); store.set('car', carBox.checked ? '1' : '0'); });
  carSel.addEventListener('change', () => { carLayer.setCriterion(carSel.value); store.set('carCrit', carSel.value); renderCarLegend(); });
  async function ensureCar() { if (!carBox.checked) { carBox.checked = true; store.set('car', '1'); } if (!carLayer.on) await drawCar(true); }

  let mine = store.get('mine');
  const mineBtn = $('#mine-btn');
  mineBtn.hidden = !mine;
  // abas da ficha (a última escolhida fica guardada; a primeira vez abre no resumo)
  function setCardTab(k) {
    const body = $('#car-card-body');
    if (!body.querySelector(`[data-tab-btn="${k}"]`)) k = 'resumo';
    body.dataset.tab = k;
    body.querySelectorAll('[data-tab-btn]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tabBtn === k)));
    store.set('cardTab2', k);
  }
  const renderCard = (x) => {
    const w = mqPhone.matches ? innerWidth - 32 : paneW - 40;
    $('#car-card-body').innerHTML = carLayer.card(x, { mine: x.f.cod === mine, chartW: Math.round(Math.max(260, w)) });
    setCardTab(store.get('cardTab2') || 'resumo');
    syncWaterUI();
    setTimeout(() => fillAccess(x), 30);   // a primeira vez monta o grafo das estradas (~0,2 s): a ficha aparece antes
    fillAgro(x);
  };
  async function openCarCard(x, { fit = false } = {}) {
    carLayer.select(x, { fit });
    await Promise.all([carLayer.loadHist(), carLayer.loadVigor()]);
    if (carLayer.sel !== x) return;   // escolheram outra enquanto os arquivos chegavam
    infoPOI = null;
    renderCard(x);
    openPanel('car');
    paneBody.scrollTop = 0;
    countUp($('#car-card-body'));
  }
  // os números grandes da ficha contam de zero até o valor ao abrir (formato brasileiro: 1.315 · 3,8)
  function countUp(box) {
    if (reduceMotion.matches) return;
    for (const el of box.querySelectorAll('.cc-head h2, .rs .v, .big')) {
      const tn = [...el.childNodes].find((n) => n.nodeType === 3 && /\d/.test(n.textContent));
      const m = tn?.textContent.match(/\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?/);
      if (!m) continue;
      const s = m[0], dec = (s.split(',')[1] ?? '').length, val = parseFloat(s.replace(/\./g, '').replace(',', '.'));
      if (!(val > 0)) continue;
      const pre = tn.textContent.slice(0, m.index), post = tn.textContent.slice(m.index + s.length), t0 = performance.now();
      const step = (now) => {
        const k = Math.min(1, (now - t0) / 700), e = 1 - (1 - k) ** 3;
        tn.textContent = pre + nf(val * e, dec) + post;
        if (k < 1 && tn.isConnected) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
  }
  function closeCarCard() { showCard(false); carLayer.select(null); layout(); }
  $('#car-card-close').addEventListener('click', closeCarCard);

  // --- link direto (#car=código) ---------------------------------------------------------------------
  function onCarSelect(x) {
    if (waterInfo && waterInfo.x !== x) setWater(null);
    if (routeX && routeX !== x) setRoute(null);
    if (demo.running && demo.run.x !== x) demo.stop();   // trocou de propriedade (ex.: link aberto) no meio da demonstração
    layout();   // bolinha na barra: há uma propriedade escolhida
    try { history.replaceState(null, '', x ? `#car=${encodeURIComponent(x.f.cod)}` : location.pathname + location.search); } catch { /* moldura sem histórico */ }
  }
  async function openFromHash() {
    const m = location.hash.match(/car=([^&]+)/);
    if (!m) return;
    await ensureCar(); await carLayer.load();   // na abertura as propriedades ainda podem estar chegando
    const x = carLayer.byCod(decodeURIComponent(m[1]));
    if (x && x !== carLayer.sel) openCarCard(x, { fit: true });
  }
  window.addEventListener('hashchange', openFromHash);
  // link da propriedade: o próprio endereço (site no GitHub Pages ou localhost); dentro da moldura do claude.ai,
  // o do Artifact publicado (o código do CAR vai junto no texto, caso o # se perca)
  const inArtifact = window.parent !== window && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const carLink = (cod) => `${inArtifact ? config.share.url : location.origin + location.pathname}#car=${encodeURIComponent(cod)}`;
  async function shareCar(x) {
    const msg = $('#cc-share'), url = carLink(x.f.cod);
    const text = `Propriedade de ${nf(x.f.ha, x.f.ha < 10 ? 1 : 0)} ha em ${x.f.mun} no Andrelândia Rural (CAR ${x.f.cod})`;
    if (matchMedia('(pointer: coarse)').matches && navigator.share) {   // celular: a folha de compartilhar do sistema
      try { await navigator.share({ title: 'Andrelândia Rural', text, url }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      msg.textContent = 'Link copiado. Cole no WhatsApp, no e-mail…';
    } catch {   // sem acesso à área de transferência (ex.: dentro de moldura): mostra o link para copiar
      msg.innerHTML = `Copie o link: <input class="cc-link" readonly value="${url.replace(/"/g, '&quot;')}">`;
      const inp = msg.querySelector('input'); inp.addEventListener('focus', () => inp.select());
    }
    msg.hidden = false;
  }

  // --- água da propriedade ---------------------------------------------------------------------------
  const propWater = new PropertyWater({ terrain, vectors, scene, drop, drainage });
  async function setWater(x) {
    if (!x) {
      if (waterInfo) { waterInfo = null; propWater.hide(); terrain.setCarState({ app: carLayer.app }); }
      syncWaterUI();
      return;
    }
    const btn = carCard.querySelector('[data-act="water"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Calculando…'; }
    const st = await propWater.show(x);
    if (carLayer.sel !== x) { propWater.hide(); return; }   // trocou de propriedade no meio
    waterInfo = { x, st };
    terrain.setCarState({ app: true });
    syncWaterUI();
  }
  function syncWaterUI() {
    const btn = carCard.querySelector('[data-act="water"]'), box = $('#cc-water');
    if (!btn || !box) return;
    const on = !!waterInfo && waterInfo.x === carLayer.sel;
    btn.disabled = false; btn.setAttribute('aria-pressed', String(on));
    btn.textContent = on ? '💧 Esconder a água' : '💧 Ver a água da propriedade';
    box.hidden = !on;
    if (!on) return;
    const { x, st } = waterInfo, area = (ha) => (ha >= 100 ? `${nf(ha / 100, ha >= 1000 ? 0 : 1)} km²` : `${nf(ha, ha < 10 ? 1 : 0)} ha`);
    let t = st.upHa < 1 ? 'Quase nenhuma água vem de fora: a propriedade fica no alto, perto do divisor de águas.'
      : `Morro acima, a chuva que cai em <b>${area(st.upHa)}</b> escorre para dentro da propriedade${st.upHa > 2 * x.f.ha ? ` (${nf(st.upHa / x.f.ha)} vezes a área dela)` : ''}${st.edge ? ', e essa área continua além da borda do mapa' : ''}.`;
    if (st.river >= 5) t += ' A maior parte chega pelo rio que passa por ela.';
    box.innerHTML = `<p class="cc-kv">${t}</p>
      <p class="cc-water-key"><span><i class="k-up"></i>área que drena para ela</span><span><i class="k-st"></i>córregos dela</span><span><i class="k-sp"></i>${st.springs} ${st.springs === 1 ? 'nascente estimada' : 'nascentes estimadas'}</span><span><i class="k-app"></i>APP: azul com mata, vermelho com pasto ou lavoura</span></p>
      <p class="cc-note">Calculado pelo relevo (ANADEM 30 m) e pela direção da água em cada ponto; ilustrativo.</p>`;
  }

  // --- acesso pela estrada: até o asfalto e até o centro ------------------------------------------------
  const roads = new RoadAccess({ osm, frame }), accessLayer = new AccessLayer({ vectors, scene, terrain });
  function fillAccess(x) {
    const box = $('#cc-access');
    if (!box || carLayer.sel !== x) return;
    const r = roads.route(x), t = accessText(r, nf);
    const rs = $('#rs-acesso');
    rs?.removeAttribute('aria-busy');
    if (rs) rs.innerHTML = !r?.city ? '<span class="d">Sem caminho pelas estradas do mapa.</span>'
      : `<span class="v">${t.km(r.city.m)} <small>até o centro</small></span><span class="d">${!r.asphalt ? '' : r.asphalt.m < 100 ? 'Asfalto passa na propriedade' : `Asfalto a ${t.km(r.asphalt.m)}`}${r.city.dirt >= 50 ? ` · ${t.km(r.city.dirt)} de terra até o centro` : ''}</span>`;
    box.innerHTML = !r ? `<p class="cc-kv">${t.city}.</p>`
      : `<p class="cc-kv">Centro de Andrelândia <b>${r.city ? t.km(r.city.m) : '—'}</b>${r.city ? (r.city.dirt >= 50 ? ` · ${t.km(r.city.dirt)} de terra` : ' · todo no asfalto') : ''}</p>
        <p class="cc-kv">Asfalto <b>${!r.asphalt ? '—' : r.asphalt.m < 100 ? 'passa na propriedade' : t.km(r.asphalt.m)}</b>${t.where && r.asphalt.m >= 100 ? (r.asphalt.urban ? ' · chega numa rua calçada' : ` · chega na ${t.where}`) : ''}</p>
        ${t.gap ? `<p class="cc-warn">${t.gap}</p>` : ''}
        <p class="cc-note">Menor caminho pelas estradas do OpenStreetMap, saindo da divisa. Pode faltar estrada no mapa ou o pavimento estar desatualizado.</p>`;
    syncRouteUI();
  }
  function setRoute(x, { fit = true } = {}) {
    routeX = x;
    if (!x) { accessLayer.hide(); syncRouteUI(); return; }
    const r = roads.route(x);
    accessLayer.show(r);
    syncRouteUI();
    if (fit && r) fitLatLon([...x.f.rings.flat(), ...routePoints(r)], 1.2);
  }
  const routePoints = (r) => [r.city, r.asphalt].filter(Boolean).flatMap((p) => [...p.lines.dirt, ...p.lines.paved].flat());
  function syncRouteUI() {
    const btn = carCard.querySelector('[data-act="route"]');
    if (!btn) return;
    const on = routeX === carLayer.sel;
    btn.setAttribute('aria-pressed', String(on));
    btn.textContent = on ? '🛣 Esconder o caminho' : '🛣 Ver o caminho';
    btn.hidden = !roads.cache.get(carLayer.sel?.k);
  }

  // --- clima, solo e quando plantar (ZARC) ------------------------------------------------------------
  const agro = new Agro({ getJSON });
  const escH = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
  const zarcRow = (z) => `<div class="zarc-row"><span class="zarc-name" title="${escH(`${z.ciclo} · solo ${z.solo} · ${z.manejo}`)}">${escH(z.crop)}</span>${zarcStrip(z.risk, { w: 360, h: 11 })}<span class="zarc-best">${bestWindow(z.risk) ?? 'não indicado'}</span></div>`;
  async function fillAgro(x) {
    const boxes = ['#cc-clima', '#cc-solo', '#cc-zarc', '#rs-clima', '#rs-solo', '#rs-zarc'];
    try { await agro.load(); } catch { boxes.forEach((b) => { const el = $(b); if (el) el.innerHTML = '<p class="cc-note">Não foi possível carregar.</p>'; }); return; }
    if (carLayer.sel !== x || !$('#cc-clima')) return;
    const { climate: c, soil: s } = agro.of(x), t = agroText(c, s, nf);
    // cartões do resumo
    const rsC = $('#rs-clima'), rsS = $('#rs-solo'), rsZ = $('#rs-zarc');
    [rsC, rsS, rsZ].forEach((e) => e?.removeAttribute('aria-busy'));
    if (rsC) rsC.innerHTML = `<span class="v">${nf(c.year)} <small>mm de chuva/ano</small></span><span class="d">${t.dry[0].toUpperCase() + t.dry.slice(1)}</span>`;
    if (rsS) rsS.innerHTML = !s ? '<span class="d">Sem dado de solo aqui.</span>'
      : `<span class="v">${s.tipoName[0].toUpperCase() + s.tipoName.slice(1)}</span><span class="d">${s.cls ? `${s.cls} · ` : ''}argila ${nf(s.clay)}% · pH ${nf(s.ph, 1)}</span>`;
    if (rsZ) {
      const zs = FEATURED.map((n) => agro.zarcFor(n, s)).filter(Boolean).map((z) => [z.crop, bestWindow(z.risk)]).filter((z) => z[1]).slice(0, 4);
      rsZ.innerHTML = zs.length ? `<ul class="cc-list">${zs.map(([n, w]) => `<li><span class="lc-sw" style="background:#3f9d5a"></span><span>${escH(n)}</span><b>${w}</b></li>`).join('')}</ul>` : '<span class="d">Nenhuma cultura indicada aqui.</span>';
    }
    $('#cc-clima').innerHTML = `${climateChart(c, { w: 320, h: 104 })}
      <p class="cc-kv"><b>${nf(c.year)} mm</b> de chuva por ano · ${t.dry}</p>
      <p class="cc-kv">${t.temp[0].toUpperCase() + t.temp.slice(1)}</p>
      <p class="cc-note">Médias de 1991 a 2020 (Open-Meteo, reanálise ERA5), temperatura ajustada à altitude média dela (${nf(c.elev)} m). A reanálise suaviza as baixadas: nelas o frio e a geada podem ser mais fortes.</p>`;
    $('#cc-solo').innerHTML = !s ? '<p class="cc-note">Sem dado de solo aqui.</p>'
      : `${s.cls ? `<p class="cc-kv"><b>${s.cls}</b> é a classe mais provável${s.clsShare < 0.8 ? ` (em ${nf(100 * s.clsShare)}% da área)` : ''}</p>` : ''}
        <p class="cc-kv">Argila <b>${nf(s.clay)}%</b> · areia <b>${nf(s.sand)}%</b> → ${s.tipoName}</p>
        <p class="cc-kv">pH <b>${nf(s.ph, 1)}</b> (${phName(s.ph)}) · carbono <b>${nf(s.soc)} g/kg</b></p>
        <p class="cc-note">SoilGrids 250 m, de 0 a 30 cm: estimativa global, não substitui análise de solo.</p>`;
    const others = agro.zarc.crops.map((cr) => cr.n).filter((n) => !FEATURED.includes(n));
    $('#cc-zarc').innerHTML = `<div class="zarc-list"><div class="zarc-row zarc-head"><span></span>${zarcStrip('0'.repeat(36), { w: 360, h: 0, labels: true })}<span class="zarc-best">melhor época</span></div>
        ${FEATURED.map((n) => agro.zarcFor(n, s)).filter(Boolean).map(zarcRow).join('')}</div>
      <label class="zarc-pick">Ver outra cultura <select id="zarc-sel"><option value="">escolha…</option>${others.map((n) => `<option>${escH(n)}</option>`).join('')}</select></label>
      <p class="zarc-legend"><span><i style="background:#3f9d5a"></i>risco 20%</span><span><i style="background:#e0b13a"></i>30%</span><span><i style="background:#e0702f"></i>40%</span><span>em branco: não indicado</span></p>
      <p class="cc-note">Zoneamento Agrícola de Risco Climático do MAPA (safra 2026/2027 e perenes), sem irrigação, para solo ${s?.tipoName ?? 'argiloso'} — tipo estimado pela argila; o ZARC vale para o solo da sua análise. É a referência do crédito rural e do seguro.</p>`;
    $('#zarc-sel').addEventListener('change', (e) => {
      const z = e.target.value && agro.zarcFor(e.target.value, s);
      if (z) $('#cc-zarc .zarc-list').insertAdjacentHTML('beforeend', zarcRow(z));
      e.target.value = '';
    });
  }

  // --- folha da propriedade ---------------------------------------------------------------------------
  const until = (cond, ms) => new Promise((res) => { const t0 = performance.now(); const loop = () => (cond() || performance.now() - t0 > ms ? res() : setTimeout(loop, 100)); loop(); });
  // fotografa a cena num tamanho fixo (mesmo quadro: nada pisca na tela)
  function captureView(w, h) {
    const pr = renderer.getPixelRatio();
    camera.clearViewOffset();   // o laço principal repõe o deslocamento da gaveta no quadro seguinte
    renderer.setPixelRatio(1); renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    vectors.setResolution(w, h); drop.setResolution(w, h); terrain.setSplit(-1);
    renderer.render(scene, camera);
    const out = document.createElement('canvas'); out.width = w; out.height = h;
    out.getContext('2d').drawImage(renderer.domElement, 0, 0);
    renderer.setPixelRatio(pr); resize();
    return out;
  }
  async function makeSheet(x) {
    // enquadra de cima, em diagonal desde o sudeste, e espera as imagens de perto chegarem
    const ex = carLayer.extent(x), { lat, lon } = frame.toLatLon(ex.x, ex.z), c = terrain.worldPosition(lat, lon), d = Math.max(650, ex.size * 1.1);
    stopOrbit(); follow = false;
    flight = { t: 0, from: camera.position.clone(), to: new THREE.Vector3(c.x + d * 0.35, c.y + d * 0.95, c.z + d * 0.62), tFrom: controls.target.clone(), tTo: c, dur: 1.4 };
    await until(() => !flight, 3000);
    await until(() => { const s = terrain.stats(); return s.loading === 0 && s.tiles >= s.near; }, 7000);
    await new Promise((r) => setTimeout(r, 700));   // transição das imagens
    const view = captureView(1600, 1000);
    let agroInfo = null;
    try {
      await agro.load();
      const { climate, soil } = agro.of(x);
      agroInfo = { climate, soil, text: agroText(climate, soil, nf), zarc: FEATURED.map((n) => agro.zarcFor(n, soil)).filter(Boolean).map((z) => ({ ...z, best: bestWindow(z.risk) })) };
    } catch { /* sem os arquivos: a folha sai sem essa parte */ }
    await carLayer.loadVigor();
    return buildSheet({ x, car: carLayer, view, water: waterInfo?.x === x ? waterInfo.st : null, access: roads.route(x), agro: agroInfo, vigor: carLayer.vigorOf(x), nf, fmtDate, exag: terrain.exaggeration });
  }
  // no Artifact o arquivo sai pela capacidade "downloads" (o visitante confirma); fora dele, download comum
  async function saveFile(blob, filename) {
    const dl = window.claude?.use ? await window.claude.use('downloads').catch(() => null) : null;
    if (dl) return dl.save({ filename, data: blob }).then(() => 'saved', (e) => (e?.code === 'declined' ? 'declined' : Promise.reject(e)));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    return 'saved';
  }
  async function saveSheet(x) {
    const btn = carCard.querySelector('[data-act="sheet"]'), msg = $('#cc-share');
    btn.disabled = true; btn.textContent = 'Preparando a folha…';
    try {
      const r = await saveFile(await makeSheet(x), `andrelandia-rural_${x.f.cod}.png`);
      msg.textContent = r === 'saved' ? 'Folha salva: imagem PNG no tamanho A4, pronta para imprimir ou mandar.' : 'A folha não foi salva.';
    } catch (e) {
      console.error(e);
      msg.textContent = 'Não foi possível salvar a folha neste navegador.';
    }
    msg.hidden = false;
    if (btn.isConnected) { btn.disabled = false; btn.textContent = 'Salvar folha'; }
  }

  // demonstração da propriedade (~30 s): os painéis saem, a câmera gira em volta e as legendas contam os dados
  let demoSplit = false;
  const demo = new PropertyDemo({
    terrain, carLayer, drop, nf, fmtLen, years: YEARS, loadYear, blobOf, muni: hist,
    access: { route: (x) => roads.route(x), layer: accessLayer }, agro, fade: crossfade,
    // vigor: a cena do pasto usa o mapa das águas (a estação escolhida volta no fim, em setSurface)
    vigor: { ensure: () => loadVigor('aguas'), of: (x) => carLayer.vigorOf(x) },
    onFrame: (pts) => { stopOrbit(); fitLatLon(pts, 1.15); },
    // tomadas da câmera por cena, em volta da propriedade: aberta, de cima, rasante, perto, longe
    onShot: (x, kind) => {
      const ex = carLayer.extent(x), { lat, lon } = frame.toLatLon(ex.x, ex.z), c = terrain.worldPosition(lat, lon);
      const r = Math.max(550, ex.size * 1.15 * Math.max(1, 1.1 / camera.aspect));
      const S = { open: [1.15, 0.55, 1], top: [0.55, 1.6, 0.5], low: [0.85, 0.2, 0.8], close: [0.8, 0.4, 0.7], wide: [1.7, 0.75, 0.6] }[kind] ?? [1, 0.55, 1];
      startOrbit(c, r * S[0], 'Demonstração', { hRatio: S[1], speed: S[2], dur: 2.2 });
    },
    el: { box: $('#demo'), cap: $('#demo-cap'), step: $('#demo-step'), title: $('#demo-title'), text: $('#demo-text'), extra: $('#demo-extra'), note: $('#demo-note'), prog: $('#demo-prog'), badge: $('#year-badge') },
    onStart: (x) => {
      setTool(null); stopPlay(); tmTicket++; drop.stop(); follow = false; setWater(null); setRoute(null);
      demoSplit = splitOn; if (splitOn) setSplit(false);
      carTip.hidden = true; carLayer.setHover(null);
      document.body.classList.add('demo');
      layout();   // o menu sai e o mapa ocupa a tela toda
      // primeira tomada: alta e longe; cada cena depois escolhe a sua (onShot). Tela em pé: a câmera fica mais longe
      const ex = carLayer.extent(x), { lat, lon } = frame.toLatLon(ex.x, ex.z);
      startOrbit(terrain.worldPosition(lat, lon), Math.max(800, ex.size * 2.2 * Math.max(1, 1.1 / camera.aspect)), 'Demonstração', { hRatio: 0.9, speed: 0.5 });
    },
    onStop: (x, ended) => {
      stopOrbit();
      document.body.classList.remove('demo');
      layout();
      terrain.setStyle({ contours: style.contours, interval: style.interval });
      setSurface(style.surface);
      if (demoSplit) setSplit(true);
      if (carLayer.sel === x) openCarCard(x, { fit: ended });   // no fim natural a câmera volta para a propriedade
    },
  });
  $('#demo-stop').addEventListener('click', () => demo.stop());
  controls.addEventListener('start', () => demo.stop());   // mexer no mapa (arrastar, girar, zoom) para a demonstração

  carCard.addEventListener('click', (e) => {
    // aba (ou cartão do resumo que leva a uma aba): a ficha volta para o alto das abas, se tinha descido além delas
    const tb = e.target.closest('[data-tab-btn], [data-goto]');
    if (tb) {
      setCardTab(tb.dataset.tabBtn ?? tb.dataset.goto);
      if (mqPhone.matches) setSheet('full');
      const tabs = carCard.querySelector('.cc-tabs');
      if (tabs) { const top = paneBody.scrollTop + tabs.getBoundingClientRect().top - paneBody.getBoundingClientRect().top; if (paneBody.scrollTop > top) paneBody.scrollTop = top; }
      return;
    }
    const nb = e.target.closest('[data-nb]');
    if (nb) { carLayer.setHover(null); openCarCard(carLayer.index[+nb.dataset.nb], { fit: true }); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    const x = carLayer.sel; if (!act || !x) return;
    if (act === 'demo') demo.start(x);
    if (act === 'share') shareCar(x);
    if (act === 'sheet') saveSheet(x);
    if (act === 'water') setWater(waterInfo?.x === x ? null : x);
    if (act === 'route') setRoute(routeX === x ? null : x);
    if (act === 'peak') { carLayer.showPeak(); if (mqPhone.matches) setSheet('peek'); }
    if (act === 'vigmap') {   // mostra o mapa de vigor e enquadra a propriedade
      const el = $('#s-vig'); el.checked = true; setSurface('vigor', { fade: true }); carLayer.select(x, { fit: true });
      if (mqPhone.matches) setSheet('peek');
    }
    if (act === 'orbit') {
      const ex = carLayer.extent(x); const { lat, lon } = frame.toLatLon(ex.x, ex.z);
      if (mqPhone.matches) setCollapsed(true);   // celular: a gaveta sai da frente; o contorno continua destacado
      startOrbit(terrain.worldPosition(lat, lon), Math.max(500, ex.size * 1.05), `Sobrevoando a propriedade de ${nf(x.f.ha, x.f.ha < 10 ? 1 : 0)} ha`);
    }
    if (act === 'mine') {
      mine = mine === x.f.cod ? null : x.f.cod;
      store.set('mine', mine ?? '');
      mineBtn.hidden = !mine;
      renderCard(x);
    }
  });
  // passar o mouse num vizinho da lista acende ele no mapa
  carCard.addEventListener('pointerover', (e) => { const b = e.target.closest('[data-nb]'); if (b) carLayer.setHover(carLayer.index[+b.dataset.nb]); });
  carCard.addEventListener('pointerout', (e) => { if (e.target.closest('[data-nb]')) carLayer.setHover(null); });
  mineBtn.addEventListener('click', async () => {
    await ensureCar();
    const x = carLayer.byCod(mine);
    if (x) openCarCard(x, { fit: true });
  });
  // busca pelo código do CAR
  const q = $('#car-q'), results = $('#car-results');
  q.addEventListener('input', async () => {
    const v = q.value;
    if (v.replace(/[^A-Za-z0-9]/g, '').length < 4) { results.innerHTML = ''; return; }
    await carLayer.load();
    const found = carLayer.search(v);
    results.innerHTML = found.length
      ? found.map((x) => `<li><button type="button" data-k="${x.k}">${nf(x.f.ha, 1)} ha · ${x.f.mun}<small>${x.f.cod}</small></button></li>`).join('')
      : '<li class="hint">Nenhuma propriedade com esse código.</li>';
  });
  results.addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-k]'); if (!b) return;
    await ensureCar();
    openCarCard(carLayer.index[+b.dataset.k], { fit: true });
    results.innerHTML = ''; q.value = '';
  });
  // passar o mouse destaca a propriedade
  function carHover(lat, lon, ev) {
    if (tool || !carBox.checked || !carLayer.data || lat == null || ev.pointerType !== 'mouse' || ev.buttons) { carLayer.setHover(null); carTip.hidden = true; return; }
    const x = carLayer.pick(lat, lon);
    carLayer.setHover(x);
    if (!x) { carTip.hidden = true; return; }
    const f = x.f, b = carLayer.bucketOf(f), crit = CRITERIA[carLayer.criterion];
    carTip.innerHTML = `<b>${nf(f.ha, f.ha < 10 ? 1 : 0)} ha</b> · ${CRITERIA.tamanho.buckets[CRITERIA.tamanho.of(f)]?.[0].split(' (')[0].toLowerCase() ?? ''}${carLayer.criterion !== 'tamanho' && b >= 0 ? `<br><span class="lc-sw" style="background:${crit.buckets[b][1]}"></span> ${crit.buckets[b][0]}` : ''}`;
    carTip.style.transform = `translate(${ev.clientX + 14}px, ${ev.clientY + 14}px)`;
    carTip.hidden = false;
  }

  // --- ferramentas ----------------------------------------------------------------------------
  let tool = null;
  const HINT = { drop: 'Toque no mapa onde a chuva cai', profile: 'Toque no ponto de partida do perfil' };
  function setTool(t) {
    tool = t;
    $('#tool-drop').setAttribute('aria-pressed', String(t === 'drop'));
    $('#tool-profile').setAttribute('aria-pressed', String(t === 'profile'));
    $('#tool-hint').hidden = !t;
    if (t) $('#tool-hint-text').textContent = HINT[t];
    renderer.domElement.style.cursor = t ? 'crosshair' : '';
    carLayer.setHover(null); carTip.hidden = true;
    if (t && mqPhone.matches) setCollapsed(true);   // celular: a gaveta sai para tocar no mapa
  }
  $('#tool-drop').addEventListener('click', () => setTool(tool === 'drop' ? null : 'drop'));
  $('#tool-profile').addEventListener('click', () => { if (tool === 'profile') { setTool(null); } else { profile.clear(); setTool('profile'); } });
  $('#tool-split').addEventListener('click', () => setSplit(!splitOn));
  $('#tool-orbit').addEventListener('click', () => {
    if (orbit) { stopOrbit(); return; }
    if (carLayer.sel && !carCard.hidden) { carCard.querySelector('[data-act="orbit"]').click(); return; }
    if (mqPhone.matches) setCollapsed(true);
    startOrbit(controls.target.clone(), Math.max(800, Math.min(25000, camera.position.distanceTo(controls.target) * 0.8)), 'Sobrevoo');
  });
  $('#tool-hint-x').addEventListener('click', () => { setTool(null); stopOrbit(); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') { demo.stop(); setTool(null); stopOrbit(); } });

  // --- toque no terreno ------------------------------------------------------------------------
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function groundAt(ev) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return ray.intersectObjects(terrain.chunks, false).find((h) => !terrain.clipped || terrain.insideLocal(h.point.x, h.point.z)) ?? null;
  }
  let downAt = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerleave', () => { carLayer.setHover(null); carTip.hidden = true; $('#readout').dataset.empty = 'true'; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return;
    const hit = groundAt(e);
    if (!hit) return;
    const { lat, lon } = frame.toLatLon(hit.point.x, hit.point.z);
    if (tool === 'drop') { rain(lat, lon); $('#tool-hint-text').textContent = 'Toque em outro ponto para outra gota'; return; }
    if (tool === 'profile') {
      const step = profile.add(hit.point.x, hit.point.z);
      if (step === 'a') { $('#tool-hint-text').textContent = 'Agora toque no ponto de chegada'; PANELS.profile.hidden = true; }
      else { openPanel('profile'); $('#tool-hint-text').textContent = 'Toque de novo para começar outro perfil'; }
      return;
    }
    if (!carBox.checked || !carLayer.data) return;
    const x = carLayer.pick(lat, lon);
    if (x) openCarCard(x);
    else if (!PANELS.car.hidden || carLayer.sel) closeCarCard();   // também depois do sobrevoo, com a ficha fechada
  });

  // --- leitura do cursor ---------------------------------------------------------------------------
  let pointerDirty = false, pointerEvt = null;
  renderer.domElement.addEventListener('pointermove', (e) => { pointerEvt = e; pointerDirty = true; });
  function updateReadout() {
    if (!pointerDirty || !pointerEvt) return;
    pointerDirty = false;
    const hit = groundAt(pointerEvt);
    const box = $('#readout');
    if (!hit) { box.dataset.empty = 'true'; carHover(null, null, pointerEvt); return; }
    box.dataset.empty = 'false';
    const { lat, lon } = frame.toLatLon(hit.point.x, hit.point.z);
    carHover(lat, lon, pointerEvt);
    $('#r-alt').textContent = `${nf(hf.elevation(lat, lon))} m`;
    $('#r-pt').textContent = `${nf(lat, 5)}, ${nf(lon, 5)}${inMuni(lat, lon) ? '' : ' · fora do município'}`;
  }

  // --- lugares ---------------------------------------------------------------------------------------
  const topPeaks = places.filter((p) => p.kind === 'pico' && p.inside && p.ele && p.name !== 'Turvo' && !manualNames.has(p.name)).sort((a, b) => b.ele - a.ele).slice(0, 3);
  for (const p of [...MANUAL_POIS, ...topPeaks]) {
    const li = document.createElement('li'), b = document.createElement('button');
    b.type = 'button';
    b.textContent = p.kind === 'pico' && p.ele ? `${p.name} · ${nf(p.ele)} m` : p.name;
    b.addEventListener('click', () => flyTo(p));
    li.appendChild(b); $('#places').appendChild(li);
  }

  // --- controles gerais -------------------------------------------------------------------------------
  const exag = $('#exag');
  exag.addEventListener('input', () => {
    const v = parseFloat(exag.value), before = terrain.exaggeration;
    terrain.setExaggeration(v);
    $('#exag-out').textContent = `${nf(v, 1)}×`;
    controls.target.y *= v / before; camera.position.y *= v / before;
    if (orbit) { orbit.c.y *= v / before; }
    poiLayer.update(); vectors.update(); profile.refresh(); drop.stop(); carLayer.updateFence(); propWater.refresh(); accessLayer.refresh();
  });
  $('#t-contours').addEventListener('change', (e) => { style.contours = e.target.checked; terrain.setStyle(style); });
  for (const [id, layer] of [['t-roads', 'roads'], ['t-boundary', 'boundary']]) $('#' + id).addEventListener('change', (e) => vectors.setVisible(layer, e.target.checked));
  $('#t-labels').addEventListener('change', (e) => poiLayer.setVisible(e.target.checked));
  const clipBox = $('#t-clip');
  clipBox.checked = terrain.clipped;
  clipBox.addEventListener('change', () => { terrain.setClip(clipBox.checked); vectors.update(); store.set('clip', clipBox.checked ? '1' : '0'); });
  $('#v-muni').addEventListener('click', () => flyToView(VIEWS.municipio));
  $('#v-reset').addEventListener('click', () => flyToView(VIEWS.cidade));
  $('#v-top').addEventListener('click', () => {
    const t = controls.target.clone(), h = Math.max(4000, camera.position.distanceTo(t));
    orbit = null;
    flight = { t: 0, from: camera.position.clone(), to: new THREE.Vector3(t.x, t.y + h, t.z + 10), tFrom: t, tTo: t, dur: 1.6 };
  });

  // só o mapa: esconde o menu e a bússola (botão na barra ou tecla H); um botão no canto traz de volta
  const uiBtn = $('#ui-toggle');
  function setUIHidden(h) {
    document.body.classList.toggle('ui-hidden', h);
    uiBtn.setAttribute('aria-pressed', String(h));
    store.set('uiHidden', h ? '1' : '0');
    layout();
  }
  uiBtn.addEventListener('click', () => setUIHidden(true));
  $('#ui-restore').addEventListener('click', () => setUIHidden(false));
  window.addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, textarea, select') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'h' || e.key === 'H') setUIHidden(!document.body.classList.contains('ui-hidden'));
  });
  setUIHidden(store.get('uiHidden') === '1');

  function resize() {
    const r = stage.getBoundingClientRect();
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / r.height;
    camera.updateProjectionMatrix();
    vectors.setResolution(r.width, r.height);
    drop.setResolution(r.width, r.height);
    profile.setResolution(r.width, r.height);
    placeSplit();
  }
  new ResizeObserver(resize).observe(stage);
  resize();

  // bússola e escala
  const needle = $('#compass-rose'), scaleBar = $('#scale-bar'), scaleLabel = $('#scale-label');
  function updateHUD() {
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    needle.style.transform = `rotate(${-Math.atan2(dir.x, -dir.z)}rad)`;
    const d = camera.position.distanceTo(controls.target);
    const mPerPx = (2 * d * Math.tan((camera.fov * Math.PI) / 360)) / (renderer.domElement.clientHeight || 1);
    const m = [50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000].find((n) => n / mPerPx >= 60) ?? 20000;
    scaleBar.style.width = `${(m / mPerPx).toFixed(0)}px`;
    scaleLabel.textContent = m >= 1000 ? `${m / 1000} km` : `${m} m`;
  }
  $('#compass').addEventListener('click', () => {
    const t = controls.target, d = camera.position.clone().sub(t);
    orbit = null;
    flight = { t: 0, from: camera.position.clone(), to: new THREE.Vector3(t.x, camera.position.y, t.z + Math.hypot(d.x, d.z)), tFrom: t.clone(), tTo: t.clone(), dur: 1.2 };
  });

  // --- laço principal ------------------------------------------------------------------------------------
  const clock = new THREE.Clock();
  let lastSlow = 0, viewOff = 0;
  function tick() {
    const dt = Math.min(clock.getDelta(), 0.05);
    stepFlight(dt);
    stepOrbit(dt);
    stepPlay(dt);
    demo.update(dt);
    const dp = drop.update(dt, camera);
    if (dp && follow && !flight) {   // a câmera acompanha a gota
      const delta = dp.clone().sub(controls.target).multiplyScalar(Math.min(1, dt * 2.5));
      controls.target.add(delta); camera.position.add(delta);
    }
    controls.update();
    // celular: a gaveta cobre a parte de baixo do mapa — o centro da vista sobe para o meio da parte que fica à mostra
    {
      const h = renderer.domElement.clientHeight, w = renderer.domElement.clientWidth;
      const want = mqPhone.matches && !document.body.classList.contains('demo') && !document.body.classList.contains('ui-hidden')
        ? Math.max(0, Math.min(h * 0.6, innerHeight - side.getBoundingClientRect().top)) : 0;
      viewOff += (want - viewOff) * Math.min(1, dt * 6);
      if (want === 0 && viewOff < 0.5) { viewOff = 0; if (camera.view?.enabled) camera.clearViewOffset(); }
      else camera.setViewOffset(w, h + viewOff, 0, viewOff, w, h);
    }
    const gy = terrain.groundY(camera.position.x, camera.position.z) + 40;
    if (camera.position.y < gy) camera.position.y = gy;
    const now = performance.now();
    if (now - lastSlow > 200) {
      lastSlow = now;
      terrain.update(camera);
      vectors.setViewDistance(camera.position.distanceTo(controls.target));
      carLayer.refreshLabels(camera, controls.target);
    }
    vectors.animate(dt);
    carLayer.animate(dt);
    profile.update(camera);
    terrain.animate();
    const dist = camera.position.distanceTo(controls.target);
    const fn = Math.max(9000, dist * 1.1), ff = Math.max(38000, dist * 2.6);
    terrain.shared.uFogNear.value = fn; terrain.shared.uFogFar.value = ff;
    scene.fog.near = fn; scene.fog.far = ff;
    updateReadout();
    updateHUD();
    sky.follow(camera);
    renderer.render(scene, camera);
    const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
    poiLayer.project(camera, w, h);
    carLayer.projectLabels(camera, w, h);
    requestAnimationFrame(tick);
  }
  {   // última superfície escolhida
    const sv = store.get('surface');
    const el = sv && $(`#surface input[value="${sv}"]`);
    if (el) { el.checked = true; setSurface(sv); }
  }
  // abertura: a câmera começa bem alta e longe e chega voando ao município enquanto a tela de abertura some
  splash(1, 'Pronto');
  if (!location.hash.includes('car=')) {
    camera.position.copy(vpos(VIEWS.municipio)).multiplyScalar(1.9);
    controls.update();
    setTimeout(() => flyToView(VIEWS.municipio), 250);
  }
  status.classList.add('is-out');
  setTimeout(() => { status.hidden = true; }, 900);
  tick();
  openFromHash();   // link direto: #car=código
  setTimeout(() => { terrain.buildRelief(); terrain.setRelief(1); }, 400);   // volume do relevo (~0,1 s, depois do 1º quadro)

  window.app = { THREE, renderer, scene, camera, controls, terrain, hf, frame, vectors, carLayer, openCarCard, demo, setWater, makeSheet, drop, rain, profile, setSurface, setYearPos, setSplit, startOrbit, flyToView, VIEWS, setTool, showPane, setCollapsed, loadVigor };
}

start().catch((err) => {
  console.error(err);
  status.textContent = 'Não foi possível carregar o mapa. Recarregue a página; se persistir, o navegador pode não suportar WebGL.';
  status.dataset.error = 'true';
});
