import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import config from './config.js';
import { LocalFrame, toUTM } from './geo.js';
import { CellTerrain } from './cellterrain.js';
import { POILayer } from './pois.js';
import { VectorLayers } from './vectors.js';
import { loadPNG } from './sources/png.js';
import MODELS from '../data/muni/models.js';
import { IMAGERY_SETS } from '../data/muni/grid.js';
import MANUAL_POIS from '../data/pois.js';
import { LANDUSE_LAYERS, GRIDS, CLASSES, LANDUSE_SOURCE } from '../data/muni/landuse.js';
import { Trees } from './trees.js';
import { CarLayer, CRITERIA } from './car.js';
import { sunPosition, sunDirection, skyState, skyTexture, compassName } from './sun.js';

const $ = (s) => document.querySelector(s);
const stage = $('#stage');
const status = $('#status');
const nf = (v, d = 0) => v.toLocaleString('pt-BR', { maximumFractionDigits: d, minimumFractionDigits: d });
const store = {
  get(k) { try { return localStorage.getItem('andrelandia3d.' + k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem('andrelandia3d.' + k, v); } catch { /* sem armazenamento */ } },
};

// --- relevo (com cache: voltar a um modelo é instantâneo) ---------------------
const cache = new Map();
function loadModel(model) {
  if (!cache.has(model.id)) cache.set(model.id, loadPNG(model).catch((e) => { cache.delete(model.id); throw e; }));
  return cache.get(model.id);
}
const getJSON = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error(url); return r.json(); });

// ponto dentro do polígono (anel lat/lon)
function inside(ring, lat, lon) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ai, oi] = ring[i], [aj, oj] = ring[j];
    if ((ai > lat) !== (aj > lat) && lon < ((oj - oi) * (lat - ai)) / (aj - ai) + oi) c = !c;
  }
  return c;
}

function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

async function start() {
  const frame = new LocalFrame(config.region.origin.lat, config.region.origin.lon);
  let model = MODELS.find((m) => m.id === store.get('model')) || MODELS[0];
  status.textContent = 'Carregando relevo do município…';
  const [firstHf, osm, drainage, boundary, places] = await Promise.all([
    loadModel(model),
    getJSON('data/muni/layers/osm.json'),
    getJSON('data/muni/layers/drainage.json'),
    getJSON('data/muni/layers/boundary.json'),
    getJSON('data/muni/layers/places.json'),
  ]);
  let hf = firstHf;

  // --- renderização -------------------------------------------------------
  const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  stage.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 20, 160000);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a63, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(-0.55, 0.75, -0.35);
  scene.add(sun);

  let imgSet = IMAGERY_SETS.find((s) => s.id === store.get('imagery')) || IMAGERY_SETS[0];
  const style = { surface: 'satellite', contours: false, interval: config.terrain.contourInterval };
  const terrain = new CellTerrain(hf, frame, {
    baseElev: config.terrain.baseElevation, colorRange: config.terrain.colorRange, imagerySet: imgSet, renderer,
  });
  terrain.setExaggeration(parseFloat($('#exag').value));
  terrain.setClipPolygon(boundary.ring);
  terrain.setClip(store.get('clip') === '1');
  scene.add(terrain.group);

  // o tema claro/escuro vale para os painéis; o céu e a névoa seguem o sol (applySun)
  function applyTheme() {
    terrain.setStyle({ paper: cssVar('--relief-paper'), ink: cssVar('--contour'), wall: cssVar('--skirt') });
  }
  scene.fog = new THREE.Fog(0xd6ddd9, terrain.shared.uFogNear.value, terrain.shared.uFogFar.value);
  applyTheme();
  terrain.setStyle(style);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

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
    // visão geral do município, de sul-sudeste
    municipio: { pos: [12000, 20000, 30000], target: [2500, 0, 2500] },
    // a cidade e a serra das torres
    cidade: { pos: config.camera.position, target: config.camera.target },
  };
  const vpos = (v) => new THREE.Vector3(v.pos.x ?? v.pos[0], (v.pos.y ?? v.pos[1]) * terrain.exaggeration, v.pos.z ?? v.pos[2]);
  const vtgt = (v) => new THREE.Vector3(v.target.x ?? v.target[0], (v.target.y ?? v.target[1]) * terrain.exaggeration, v.target.z ?? v.target[2]);
  camera.position.copy(vpos(VIEWS.municipio));
  controls.target.copy(vtgt(VIEWS.municipio));
  controls.update();
  if (matchMedia('(max-width: 700px)').matches) $('#layers').open = false;

  // --- lugares --------------------------------------------------------------
  const manualNames = new Set(MANUAL_POIS.map((p) => p.name));
  const pois = [
    ...MANUAL_POIS.map((p) => ({ ...p, inside: true })),
    ...places.filter((p) => !manualNames.has(p.name) && !(p.kind === 'pico' && p.name === 'Turvo')),
  ];
  const poiLayer = new POILayer(terrain, $('#labels'), pois, { onSelect: (p) => flyTo(p) });
  scene.add(poiLayer.group);

  // --- vetores ------------------------------------------------------------
  const vectors = new VectorLayers(terrain, { osm, drainage, boundary });
  scene.add(vectors.group);

  // --- sol, céu e sombras ---------------------------------------------------
  const hemi = scene.children.find((o) => o.isHemisphereLight);
  const lightUI = { time: $('#time'), out: $('#time-out'), sun: $('#sun-out') };
  const lowPower = matchMedia('(pointer: coarse)').matches || Math.min(screen.width, screen.height) < 700;
  let skyTex = null;
  const today = new Date();
  const savedMin = parseInt(store.get('timeMin') ?? '', 10);
  lightUI.time.value = Number.isFinite(savedMin) ? savedMin : 15 * 60 + 30;
  function applySun() {
    const min = parseInt(lightUI.time.value, 10);
    // horário de Brasília (UTC−3, sem horário de verão)
    const date = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0) + (min + 180) * 60000);
    const pos = sunPosition(date, config.region.origin.lat, config.region.origin.lon);
    const dir = sunDirection(pos);
    const st = skyState(pos.elevation);
    terrain.setSun({ dir, color: st.sunColor, intensity: st.intensity, ambient: st.ambient });
    sun.position.copy(dir); sun.color.copy(st.sunColor); sun.intensity = 0.25 + 1.3 * st.intensity;
    hemi.intensity = 0.25 + 1.4 * st.ambient;
    skyTex = skyTexture(st, skyTex);
    scene.background = skyTex;
    scene.fog.color.copy(st.horizon);
    terrain.setStyle({ fog: st.horizon });
    const hh = String(Math.floor(min / 60)).padStart(2, '0'), mm = String(min % 60).padStart(2, '0');
    lightUI.out.textContent = `${hh}:${mm}`;
    lightUI.sun.textContent = pos.elevation > 0
      ? `Sol a ${nf(pos.elevation)}° de altura, a ${compassName(pos.azimuth)}`
      : pos.elevation > -6 ? 'Crepúsculo' : 'Noite';
    store.set('timeMin', String(min));
  }
  lightUI.time.addEventListener('input', applySun);
  $('#time-now').addEventListener('click', () => {
    const now = new Date(Date.now() - 3 * 3600000);
    lightUI.time.value = now.getUTCHours() * 60 + now.getUTCMinutes();
    applySun();
  });
  const shadowBox = $('#t-shadows');
  shadowBox.checked = (store.get('shadows') ?? (lowPower ? '0' : '1')) === '1';
  terrain.setShadows(shadowBox.checked);
  shadowBox.addEventListener('change', () => { terrain.setShadows(shadowBox.checked); store.set('shadows', shadowBox.checked ? '1' : '0'); });
  applySun();

  // --- uso do solo (MapBiomas) e copas -----------------------------------------
  const palData = new Uint8Array(256 * 4);
  for (const [code, [, hex]] of Object.entries(CLASSES)) {
    const c = parseInt(hex.slice(1), 16);
    palData.set([(c >> 16) & 255, (c >> 8) & 255, c & 255, 255], Number(code) * 4);
  }
  const palette = new THREE.DataTexture(palData, 256, 1);
  palette.magFilter = palette.minFilter = THREE.NearestFilter; palette.needsUpdate = true;
  const lcStats = await getJSON('data/muni/landuse/stats.json');
  const maxTex = renderer.capabilities.maxTextureSize;
  const lcLayers = LANDUSE_LAYERS.filter((l) => !l.maxTex || l.maxTex <= maxTex);
  let lcLayer = lcLayers.find((l) => l.id === store.get('landuse')) || lcLayers.at(-1);
  const lcCache = new Map();
  async function showLanduse(layer) {
    if (!lcCache.has(layer.id)) lcCache.set(layer.id, new THREE.TextureLoader().loadAsync(layer.url));
    $('#lc-state').textContent = `Carregando ${layer.year}…`;
    const tex = await lcCache.get(layer.id);
    lcLayer = layer;
    terrain.setLanduseTexture(tex, GRIDS[layer.grid], palette);
    $('#lc-state').textContent = '';
    store.set('landuse', layer.id);
    renderLanduseStats();
  }
  const lcYears = $('#lc-years');
  for (const l of lcLayers) {
    lcYears.insertAdjacentHTML('beforeend', `<input type="radio" name="lcyear" id="lc-${l.id}" value="${l.id}"><label for="lc-${l.id}">${l.year}${l.res === '10 m' ? '<small>10 m</small>' : ''}</label>`);
  }
  lcYears.addEventListener('change', (e) => showLanduse(lcLayers.find((l) => l.id === e.target.value)));
  function renderLanduseStats() {
    $(`#lc-${lcLayer.id}`).checked = true;
    const st = lcStats[lcLayer.stats], base = lcStats['30m_1985'];
    const total = Object.values(st).reduce((a, b) => a + b, 0);
    const rows = Object.entries(st).filter(([c]) => CLASSES[c]).sort((a, b) => b[1] - a[1]);
    const cmp = lcLayer.res === '30 m' && lcLayer.year !== 1985;
    $('#lc-table').innerHTML = rows.map(([c, km2]) => {
      const pct = (100 * km2) / total;
      const d = cmp ? km2 - (base[c] || 0) : null;
      const dTxt = d === null ? '' : `<span class="lc-d ${d > 0.5 ? 'up' : d < -0.5 ? 'down' : ''}">${d > 0 ? '+' : ''}${nf(d)}</span>`;
      return `<tr><td title="${CLASSES[c][0]}"><span class="lc-sw" style="background:${CLASSES[c][1]}"></span><span>${CLASSES[c][0]}</span></td><td>${nf(km2, km2 < 10 ? 1 : 0)}</td><td>${nf(pct, 1)}%</td><td>${dTxt}</td></tr>`;
    }).join('');
    $('#lc-head-d').textContent = cmp ? 'desde 1985' : '';
    $('#lc-note').textContent = lcLayer.res === '10 m'
      ? 'Mapa de 10 m (Coleção 4): mais detalhado, mas com legenda e método próprios; compare anos só no 30 m.'
      : `Áreas dentro do município, em km² (total ${nf(total)} km²). Diferença em relação a 1985.`;
  }
  $('#src-lc').textContent = LANDUSE_SOURCE;
  new THREE.TextureLoader().loadAsync('data/muni/layers/canopy.png').then((t) => terrain.setCanopyTexture(t));

  const trees = new Trees(terrain, scene);
  trees.load('data/muni/layers/canopy.png', 'data/muni/landuse/lc30_2025.png').catch((e) => console.warn('árvores', e));
  const treeBox = $('#t-trees');
  treeBox.checked = (store.get('trees') ?? (lowPower ? '0' : '1')) === '1';
  trees.setEnabled(treeBox.checked);
  treeBox.addEventListener('change', () => { trees.setEnabled(treeBox.checked); store.set('trees', treeBox.checked ? '1' : '0'); });

  // --- rotas do Strava ----------------------------------------------------------
  const SPORT = { Ride: ['Pedalada', 0xfc4c02, '#fc4c02'], Run: ['Corrida', 0xa855f7, '#a855f7'], Walk: ['Caminhada', 0x16a34a, '#16a34a'] };
  const strava = await getJSON('data/muni/layers/strava.json').catch(() => ({ activities: [] }));
  function drawStrava(on) {
    for (const sp of Object.keys(SPORT)) {
      const acts = strava.activities.filter((a) => a.sport === sp);
      if (!on || !acts.length) { vectors.removeLines(`strava-${sp}`); continue; }
      vectors.addLines(`strava-${sp}`, 'strava', { color: SPORT[sp][1], width: 2.3, lift: 6, opacity: 0.8, noClip: true, order: 5 }, acts.map((a) => a.pts), 20);
    }
  }
  const fmtDate = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
  const fmtDur = (s) => `${Math.floor(s / 3600)}h${String(Math.round((s % 3600) / 60)).padStart(2, '0')}`;
  {
    const acts = strava.activities;
    const km = acts.reduce((a, b) => a + b.km, 0), gain = acts.reduce((a, b) => a + b.gain_m, 0);
    $('#strava-sum').textContent = acts.length
      ? `${acts.length} atividades · ${nf(km)} km · ${nf(gain)} m de subida · ${acts[0].date.slice(0, 4)}–${acts.at(-1).date.slice(0, 4)}`
      : 'Nenhuma atividade sua na área do município.';
    $('#strava-list').innerHTML = [...acts].reverse().map((a) => `<li><button type="button" data-id="${a.id}">
      <span class="sv-dot" style="background:${SPORT[a.sport]?.[2] ?? '#888'}"></span>
      <span class="sv-main"><b>${a.name}</b><small>${fmtDate(a.date)} · ${nf(a.km, 1)} km · ${nf(a.gain_m)} m+</small></span></button></li>`).join('');
  }
  $('#strava-list').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-id]'); if (!b) return;
    const a = strava.activities.find((x) => x.id === b.dataset.id);
    selectRoute(a);
  });
  function fitLatLon(pts, pad = 1.35) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [la, lo] of pts) { const p = frame.toLocal(la, lo); minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2, size = Math.max(maxX - minX, maxZ - minZ, 600);
    const { lat, lon } = frame.toLatLon(cx, cz);
    const tgt = terrain.worldPosition(lat, lon);
    const dir = camera.position.clone().sub(controls.target); dir.y = 0; dir.normalize();
    const dist = size * pad;
    const to = tgt.clone().add(dir.multiplyScalar(dist * 0.75)); to.y = tgt.y + dist * 0.75;
    flight = { t: 0, from: camera.position.clone(), to, tFrom: controls.target.clone(), tTo: tgt, dur: 2 };
  }
  function selectRoute(a, { quiet = false } = {}) {
    vectors.addLines('sel', 'highlight', { color: 0xffffff, width: 4.5, lift: 7, opacity: 0.95, noClip: true, order: 6 }, [a.pts], 20);
    fitLatLon(a.pts);
    if (quiet) return;
    carCard.hidden = true;
    infoPOI = null;
    $('#info-name').textContent = a.name;
    $('#info-meta').textContent = `${SPORT[a.sport]?.[0] ?? a.sport} · ${fmtDate(a.date)} · ${nf(a.km, 1)} km · ${nf(a.gain_m)} m de subida · ${fmtDur(a.moving_s)} em movimento`;
    $('#info-src').textContent = 'Strava (trajeto simplificado, ~1 ponto a cada 80 m)';
    $('#info').hidden = false;
  }
  const stravaBox = $('#t-strava');
  stravaBox.checked = (store.get('strava') ?? '1') === '1';
  drawStrava(stravaBox.checked);
  stravaBox.addEventListener('change', () => { drawStrava(stravaBox.checked); $('#strava-panel').hidden = !stravaBox.checked; store.set('strava', stravaBox.checked ? '1' : '0'); });
  $('#strava-panel').hidden = !stravaBox.checked;

  // --- imóveis rurais (CAR) ------------------------------------------------------
  const carLayer = new CarLayer({
    terrain, vectors, scene, labels: $('#labels'), nf, fmtDate, getJSON, routes: strava.activities,
    onFit: (pts) => fitLatLon(pts, 1.6),
    onFly: (lat, lon) => flyToPoint(lat, lon, 1400),
  });
  const carBox = $('#t-car'), carCard = $('#car-card'), carTip = $('#car-tip');
  const carSel = $('#car-crit');
  carSel.innerHTML = Object.entries(CRITERIA).map(([k, c]) => `<option value="${k}">${c.label}</option>`).join('');
  carSel.value = CRITERIA[store.get('carCrit')] ? store.get('carCrit') : 'tamanho';
  carLayer.criterion = carSel.value;
  for (const [id, key, def, fn] of [['#car-fill', 'carFill', '1', 'setFill'], ['#car-ov', 'carOv', '1', 'setOverlap'], ['#car-app', 'carApp', '0', 'setApp']]) {
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
    if (on && !carLayer.data) $('#car-state').textContent = 'Carregando 3.726 imóveis…';
    $('#car-panel').hidden = !on;
    await carLayer.setOn(on);
    if (!on) { closeCarCard(); return; }
    $('#car-state').textContent = '';
    const st = carLayer.data.stats_andrelandia, r = carLayer.data.resumo;
    const tot = Object.values(st).reduce((x, y) => x + y.n, 0);
    $('#car-sum').innerHTML = `Em Andrelândia: <b>${nf(tot)}</b> imóveis declarados, cobrindo ${nf(r.cobertos_car_pct)}% do município; ${nf(r.sobreposto_ha / 100, 1)} km² têm mais de um cadastro.`;
    $('#car-app-sum').innerHTML = `APP estimada no município: <b>${nf(r.app_ha / 100, 1)} km²</b>, ${nf(r.app_nat_pct)}% com vegetação nativa e ${nf(r.app_def_ha / 100, 1)} km² com uso agropecuário · ${nf(r.nascentes)} nascentes estimadas.`;
    renderCarLegend();
  }
  carBox.checked = store.get('car') === '1';
  if (carBox.checked) drawCar(true);
  carBox.addEventListener('change', () => { drawCar(carBox.checked); store.set('car', carBox.checked ? '1' : '0'); });
  carSel.addEventListener('change', () => { carLayer.setCriterion(carSel.value); store.set('carCrit', carSel.value); renderCarLegend(); });

  function openCarCard(x) {
    carLayer.select(x);
    $('#info').hidden = true; infoPOI = null;
    $('#car-card-body').innerHTML = carLayer.card(x);
    carCard.hidden = false;
    carCard.scrollTop = 0;
  }
  function closeCarCard() { carCard.hidden = true; carLayer.select(null); }
  $('#car-card-close').addEventListener('click', closeCarCard);
  carCard.addEventListener('click', (e) => {
    const r = e.target.closest('[data-route]');
    if (r) { const a = carLayer.routeById(r.dataset.route); if (a) selectRoute(a, { quiet: true }); return; }
    if (e.target.closest('[data-act="peak"]')) carLayer.showPeak();
  });
  function pickCar(lat, lon) { return carLayer.pick(lat, lon)?.f ?? null; }
  // passar o mouse destaca o imóvel e mostra um resumo junto ao cursor
  function carHover(lat, lon, ev) {
    if (!carBox.checked || !carLayer.data || lat == null || ev.pointerType !== 'mouse' || ev.buttons) { carLayer.setHover(null); carTip.hidden = true; return; }
    const x = carLayer.pick(lat, lon);
    carLayer.setHover(x);
    if (!x) { carTip.hidden = true; return; }
    const f = x.f, b = carLayer.bucketOf(f), crit = CRITERIA[carLayer.criterion];
    carTip.innerHTML = `<b>${nf(f.ha, f.ha < 10 ? 1 : 0)} ha</b> · ${CRITERIA.tamanho.buckets[CRITERIA.tamanho.of(f)]?.[0].split(' (')[0].toLowerCase() ?? ''}${carLayer.criterion !== 'tamanho' && b >= 0 ? `<br><span class="lc-sw" style="background:${crit.buckets[b][1]}"></span> ${crit.buckets[b][0]}` : ''}`;
    const r = renderer.domElement.getBoundingClientRect();
    carTip.style.transform = `translate(${ev.clientX - r.left + 14}px, ${ev.clientY - r.top + 14}px)`;
    carTip.hidden = false;
  }
  // clique (sem arrastar) no terreno escolhe um imóvel
  let downAt = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerleave', () => { carLayer.setHover(null); carTip.hidden = true; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5 || !carBox.checked || !carLayer.data) return;
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(terrain.chunks, false).find((h) => !terrain.clipped || terrain.insideLocal(h.point.x, h.point.z));
    if (!hit) return;
    const { lat, lon } = frame.toLatLon(hit.point.x, hit.point.z);
    const x = carLayer.pick(lat, lon);
    if (x) openCarCard(x);
    else {
      closeCarCard();
      $('#info-name').textContent = 'Sem imóvel no CAR neste ponto';
      $('#info-meta').textContent = 'Área urbana, estrada, rio ou terra sem cadastro.';
      $('#info-src').textContent = 'SICAR — consulta pública';
      $('#info').hidden = false;
    }
  });

  function resize() {
    const r = stage.getBoundingClientRect();
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / r.height;
    camera.updateProjectionMatrix();
    vectors.setResolution(r.width, r.height);
  }
  new ResizeObserver(resize).observe(stage);
  resize();

  // --- seletor de modelo --------------------------------------------------
  const modelList = $('#models');
  for (const [k, m] of MODELS.entries()) {
    const row = document.createElement('label');
    row.className = 'model';
    row.htmlFor = `m-${m.id}`;
    row.innerHTML = `
      <input type="radio" name="model" id="m-${m.id}" value="${m.id}">
      <span class="model__name">${m.name}</span>
      <span class="model__meta"><abbr class="badge badge--${m.kind.toLowerCase()}" title="${m.kind === 'MDT' ? 'Modelo Digital de Terreno' : 'Modelo Digital de Superfície'}">${m.kind}</abbr> ${m.res}</span>
      <kbd class="model__key" aria-hidden="true">${k + 1}</kbd>`;
    modelList.appendChild(row);
  }
  function syncModelUI() {
    $(`#m-${model.id}`).checked = true;
    $('#model-note').textContent = `${model.kindLabel[0].toUpperCase()}${model.kindLabel.slice(1)}. ${model.note}`;
    $('#src-dem').textContent = `${model.source} · grade ${nf(hf.width)}×${nf(hf.height)} (${nf(hf.spacingMeters())} m) · ${nf(hf.min)}–${nf(hf.max)} m`;
    $('#legend-alt').textContent = `Altitude ${nf(hf.min)} → ${nf(hf.max)} m`;
    $('#model-chip').textContent = `${model.name} · ${imgSet.name}`;
  }
  syncModelUI();
  $('#src-area').textContent = `Município (IBGE ${boundary.ibge}): ${nf(boundary.area_km2)} km², limite do OpenStreetMap. Grade de 22 × 20 células de ~2 km.`;

  let switching = 0;
  async function switchModel(id) {
    const next = MODELS.find((m) => m.id === id);
    if (!next || next.id === model.id) return;
    const ticket = ++switching;
    $('#model-state').textContent = `Carregando ${next.name}…`;
    try {
      const nextHf = await loadModel(next);
      if (ticket !== switching) return;
      model = next; hf = nextHf;
      terrain.setHeightField(hf);
      poiLayer.update();
      vectors.update();
      trees.reset();
      if (infoPOI) showInfo(infoPOI);
      store.set('model', model.id);
      syncModelUI();
      $('#model-state').textContent = '';
      pointerDirty = true;
    } catch (e) {
      console.error(e);
      $('#model-state').textContent = `Não foi possível carregar ${next.name}. Tente de novo.`;
      $(`#m-${model.id}`).checked = true;
    }
  }
  modelList.addEventListener('change', (e) => { if (e.target.name === 'model') switchModel(e.target.value); });
  window.addEventListener('keydown', (e) => {
    if (e.target.closest?.('input[type=text], textarea, select')) return;
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= MODELS.length) switchModel(MODELS[n - 1].id);
  });

  // --- seletor de imagem --------------------------------------------------
  const imgList = $('#imagery');
  for (const set of IMAGERY_SETS) {
    imgList.insertAdjacentHTML('beforeend', `<label class="row img-opt" for="i-${set.id}"><span><input type="radio" name="imagery" id="i-${set.id}" value="${set.id}"> ${set.name} <small>${set.res}</small></span></label>`);
  }
  function syncImageryUI() {
    $(`#i-${imgSet.id}`).checked = true;
    $('#src-img').textContent = imgSet.source;
    $('#model-chip').textContent = `${model.name} · ${imgSet.name}`;
  }
  syncImageryUI();
  imgList.addEventListener('change', (e) => {
    imgSet = IMAGERY_SETS.find((s) => s.id === e.target.value);
    terrain.setImagerySet(imgSet);
    if (style.surface !== 'satellite') { style.surface = 'satellite'; $('#s-sat').checked = true; terrain.setStyle(style); }
    store.set('imagery', imgSet.id);
    syncImageryUI();
  });

  // --- leitura do cursor --------------------------------------------------
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const readout = { lat: $('#r-lat'), lon: $('#r-lon'), utm: $('#r-utm'), alt: $('#r-alt'), mun: $('#r-mun') };
  let pointerDirty = false, pointerEvt = null;
  renderer.domElement.addEventListener('pointermove', (e) => { pointerEvt = e; pointerDirty = true; });
  renderer.domElement.addEventListener('pointerleave', () => { $('#readout').dataset.empty = 'true'; });
  function updateReadout() {
    if (!pointerDirty || !pointerEvt) return;
    pointerDirty = false;
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((pointerEvt.clientX - r.left) / r.width) * 2 - 1, -((pointerEvt.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(terrain.chunks, false).find((h) => !terrain.clipped || terrain.insideLocal(h.point.x, h.point.z));
    const box = $('#readout');
    if (!hit) { box.dataset.empty = 'true'; carHover(null, null, pointerEvt); return; }
    box.dataset.empty = 'false';
    const { lat, lon } = frame.toLatLon(hit.point.x, hit.point.z);
    carHover(lat, lon, pointerEvt);
    const u = toUTM(lat, lon);
    readout.lat.textContent = fmtDMS(lat, 'S', 'N');
    readout.lon.textContent = fmtDMS(lon, 'W', 'E');
    readout.utm.textContent = `${u.zone}${u.hemi} ${nf(Math.round(u.E))} E · ${nf(Math.round(u.N))} N`;
    readout.alt.textContent = `${nf(hf.elevation(lat, lon))} m`;
    readout.mun.textContent = inside(boundary.ring, lat, lon) ? 'Andrelândia' : 'fora do município';
  }

  // --- voo ----------------------------------------------------------------
  let flight = null;
  function flyToView(v) {
    flight = { t: 0, from: camera.position.clone(), to: vpos(v), tFrom: controls.target.clone(), tTo: vtgt(v), dur: 2.2 };
  }
  function flyTo(p) {
    const target = terrain.worldPosition(p.lat, p.lon);
    const dir = camera.position.clone().sub(controls.target).normalize();
    const camEnd = target.clone().add(dir.multiplyScalar(p.kind === 'cidade' ? 3500 : 1800));
    camEnd.y = Math.max(camEnd.y, target.y + 500);
    const far = camera.position.distanceTo(camEnd) > 15000;
    flight = { t: 0, from: camera.position.clone(), to: camEnd, tFrom: controls.target.clone(), tTo: target, dur: far ? 2.6 : 1.6 };
    showInfo(p);
  }
  function flyToPoint(lat, lon, dist = 1500) {
    const target = terrain.worldPosition(lat, lon);
    const dir = camera.position.clone().sub(controls.target).normalize();
    const camEnd = target.clone().add(dir.multiplyScalar(dist));
    camEnd.y = Math.max(camEnd.y, target.y + 400);
    flight = { t: 0, from: camera.position.clone(), to: camEnd, tFrom: controls.target.clone(), tTo: target, dur: 1.6 };
  }
  function stepFlight(dt) {
    if (!flight) return;
    flight.t = Math.min(1, flight.t + dt / flight.dur);
    const k = flight.t < 0.5 ? 4 * flight.t ** 3 : 1 - (-2 * flight.t + 2) ** 3 / 2;
    camera.position.lerpVectors(flight.from, flight.to, k);
    controls.target.lerpVectors(flight.tFrom, flight.tTo, k);
    if (flight.t >= 1) flight = null;
  }
  controls.addEventListener('start', () => { flight = null; });

  let infoPOI = null;
  function showInfo(p) {
    infoPOI = p;
    if (!carCard.hidden) closeCarCard();
    const e = hf.elevation(p.lat, p.lon);
    const u = toUTM(p.lat, p.lon);
    $('#info-name').textContent = p.name;
    $('#info-meta').textContent = `${nf(e)} m (${model.name}) · UTM ${u.zone}${u.hemi} ${Math.round(u.E)} E ${Math.round(u.N)} N`;
    const ref = p.ele ? ` · cota registrada: ${nf(p.ele)} m` : '';
    const where = p.inside === false ? ' · fora do município' : '';
    $('#info-src').textContent = (p.src === 'aprox' ? 'Posição aproximada (estimada do mapa) — a refinar' : 'Coordenada: OpenStreetMap') + ref + where;
    $('#info').hidden = false;
  }
  $('#info-close').addEventListener('click', () => { $('#info').hidden = true; infoPOI = null; });

  // lista: lugares principais + picos mais altos do município
  const topPeaks = places.filter((p) => p.kind === 'pico' && p.inside && p.ele && p.name !== 'Turvo' && !manualNames.has(p.name)).sort((a, b) => b.ele - a.ele).slice(0, 3);
  const listed = [...MANUAL_POIS, ...topPeaks];
  for (const p of listed) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = p.kind === 'pico' && p.ele ? `${p.name} · ${nf(p.ele)} m` : p.name;
    b.addEventListener('click', () => flyTo(p));
    li.appendChild(b);
    $('#places').appendChild(li);
  }

  // --- controles ----------------------------------------------------------
  const exag = $('#exag');
  exag.addEventListener('input', () => {
    const v = parseFloat(exag.value), before = terrain.exaggeration;
    terrain.setExaggeration(v);
    $('#exag-out').textContent = `${nf(v, 1)}×`;
    controls.target.y *= v / before;
    camera.position.y *= v / before;
    poiLayer.update();
    vectors.update();
    trees.reset();
  });
  $('#t-contours').checked = style.contours;
  queueMicrotask(() => {
    const sv = store.get('surface');
    if (sv && $(`#surface input[value="${sv}"]`)) { const el = $(`#surface input[value="${sv}"]`); el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  $('#t-contours').addEventListener('change', (e) => { style.contours = e.target.checked; terrain.setStyle(style); });
  $('#surface').addEventListener('change', (e) => {
    if (e.target.name !== 'surface') return;
    style.surface = e.target.value; terrain.setStyle(style);
    $('#legend-hyps').hidden = style.surface !== 'altitude';
    $('#lc-panel').hidden = style.surface !== 'landuse';
    $('#chm-panel').hidden = style.surface !== 'canopy';
    $('#imagery').hidden = style.surface !== 'satellite';
    if (style.surface === 'landuse' && !lcCache.has(lcLayer.id)) showLanduse(lcLayer);
    store.set('surface', style.surface);
  });
  for (const [id, layer] of [['t-roads', 'roads'], ['t-water', 'water'], ['t-drainage', 'drainage'], ['t-buildings', 'buildings'], ['t-boundary', 'boundary']]) {
    $('#' + id).addEventListener('change', (e) => vectors.setVisible(layer, e.target.checked));
  }
  $('#t-labels').addEventListener('change', (e) => poiLayer.setVisible(e.target.checked));
  const clipBox = $('#t-clip');
  clipBox.checked = terrain.clipped;
  clipBox.addEventListener('change', () => {
    terrain.setClip(clipBox.checked);
    vectors.update();
    trees.reset();
    store.set('clip', clipBox.checked ? '1' : '0');
  });
  $('#src-vec').textContent = 'OpenStreetMap (ODbL), extraído em 03/10/2026. Córregos calculados do ANADEM (D8, área mínima 0,15 km²).';
  $('#v-muni').addEventListener('click', () => flyToView(VIEWS.municipio));
  $('#v-reset').addEventListener('click', () => flyToView(VIEWS.cidade));
  $('#v-top').addEventListener('click', () => {
    const t = controls.target.clone();
    const h = Math.max(4000, camera.position.distanceTo(t));
    flight = { t: 0, from: camera.position.clone(), to: new THREE.Vector3(t.x, t.y + h, t.z + 10), tFrom: t, tTo: t, dur: 1.6 };
  });

  // --- ocultar painéis (botão ou tecla H) e legenda recolhível ---------------
  const uiBtn = $('#ui-toggle');
  function setUIHidden(h) {
    document.body.classList.toggle('ui-hidden', h);
    uiBtn.setAttribute('aria-pressed', String(h));
    $('#ui-toggle-label').textContent = h ? 'Mostrar painéis' : 'Ocultar painéis';
    uiBtn.title = `${h ? 'Mostrar' : 'Ocultar'} painéis (tecla H)`;
    store.set('uiHidden', h ? '1' : '0');
  }
  uiBtn.addEventListener('click', () => setUIHidden(!document.body.classList.contains('ui-hidden')));
  window.addEventListener('keydown', (e) => {
    if (e.target.closest?.('input[type=text], textarea, select') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'h' || e.key === 'H') setUIHidden(!document.body.classList.contains('ui-hidden'));
  });
  setUIHidden(store.get('uiHidden') === '1');
  const legendBox = $('#legend-box');
  if (store.get('legendOpen') === '0') legendBox.open = false;
  legendBox.addEventListener('toggle', () => store.set('legendOpen', legendBox.open ? '1' : '0'));

  // --- bússola e escala ---------------------------------------------------
  const needle = $('#compass-rose');
  const scaleBar = $('#scale-bar'), scaleLabel = $('#scale-label');
  function updateHUD() {
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    needle.style.transform = `rotate(${-Math.atan2(dir.x, -dir.z)}rad)`;
    const d = camera.position.distanceTo(controls.target);
    const mPerPx = (2 * d * Math.tan((camera.fov * Math.PI) / 360)) / (renderer.domElement.clientHeight || 1);
    const nice = [50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000];
    const m = nice.find((n) => n / mPerPx >= 60) ?? 20000;
    scaleBar.style.width = `${(m / mPerPx).toFixed(0)}px`;
    scaleLabel.textContent = m >= 1000 ? `${m / 1000} km` : `${m} m`;
  }
  $('#compass').addEventListener('click', () => {
    const t = controls.target, d = camera.position.clone().sub(t);
    flight = { t: 0, from: camera.position.clone(), to: new THREE.Vector3(t.x, camera.position.y, t.z + Math.hypot(d.x, d.z)), tFrom: t.clone(), tTo: t.clone(), dur: 1.2 };
  });

  // --- laço principal -----------------------------------------------------
  const clock = new THREE.Clock();
  let lastStream = 0;
  function tick() {
    const dt = Math.min(clock.getDelta(), 0.05);
    stepFlight(dt);
    controls.update();
    const gy = terrain.groundY(camera.position.x, camera.position.z) + 40;
    if (camera.position.y < gy) camera.position.y = gy;
    const now = performance.now();
    if (now - lastStream > 200) {
      lastStream = now;
      terrain.update(camera);
      trees.update();
      vectors.setViewDistance(camera.position.distanceTo(controls.target));
      carLayer.refreshLabels(camera, controls.target);
      const s = terrain.stats();
      $('#stream').textContent = s.near ? `Imagem detalhada: ${s.tiles}/${s.near} células próximas${s.loading ? ' · carregando…' : ''}` : 'Aproxime para carregar a imagem detalhada';
    }
    terrain.animate();
    // névoa acompanha a distância: de perto dá profundidade, de longe não apaga o município
    const dist = camera.position.distanceTo(controls.target);
    const fn = Math.max(9000, dist * 1.1), ff = Math.max(38000, dist * 2.6);
    terrain.shared.uFogNear.value = fn; terrain.shared.uFogFar.value = ff;
    if (scene.fog) { scene.fog.near = fn; scene.fog.far = ff; }
    updateReadout();
    updateHUD();
    renderer.render(scene, camera);
    poiLayer.project(camera, renderer.domElement.clientWidth, renderer.domElement.clientHeight);
    carLayer.projectLabels(camera, renderer.domElement.clientWidth, renderer.domElement.clientHeight);
    requestAnimationFrame(tick);
  }
  status.hidden = true;
  tick();
  setTimeout(() => MODELS.forEach((m) => loadModel(m).catch(() => {})), 4000);

  window.app = { THREE, trees, carLayer, openCarCard, applySun, pickCar: (la, lo) => pickCar(la, lo), scene, camera, controls, terrain, get hf() { return hf; }, frame, poiLayer, vectors, switchModel, flyToView, VIEWS };
}

function fmtDMS(v, neg, pos) {
  const h = v < 0 ? neg : pos;
  const a = Math.abs(v), d = Math.floor(a), mf = (a - d) * 60, m = Math.floor(mf), s = (mf - m) * 60;
  return `${d}°${String(m).padStart(2, '0')}′${s.toFixed(1).padStart(4, '0')}″${h}`;
}

start().catch((err) => {
  console.error(err);
  status.textContent = 'Não foi possível carregar o relevo. Recarregue a página; se persistir, o navegador pode não suportar WebGL.';
  status.dataset.error = 'true';
});
