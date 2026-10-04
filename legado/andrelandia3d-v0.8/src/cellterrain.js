// Terreno do município em células geográficas (~2 km), com:
//  - nível de detalhe (LOD) por distância: 72 → 36 → 18 → 9 segmentos por célula
//  - "saias" verticais nas bordas para esconder frestas entre níveis diferentes
//  - imagens carregadas sob demanda: visão geral sempre; blocos de 4 m perto; 2 m na cidade bem perto
// A malha é amostrada do HeightField ativo, então trocar de modelo só refaz as geometrias.
import * as THREE from 'three';
import { EXTENT, COLS, ROWS, OVERVIEW, TOWN_CELLS } from '../data/muni/grid.js';

const SEGS = [72, 36, 18, 9];
const LOD_DIST = [3500, 8000, 17000];          // m (distância 3D até a célula)
const TILE_DIST = 9000, TOWN_DIST = 3200, UNLOAD_DIST = 16000;
const SKIRT = 60;                                // m (antes do exagero)

const VERT = /* glsl */ `
  attribute vec2 uvc;
  varying vec2 vUvc;
  varying float vElev;
  varying vec3 vNormalV;
  varying vec3 vSunV;
  varying float vDepth;
  uniform vec3 uSun;
  void main() {
    vElev = position.y;
    vUvc = uvc;
    vNormalV = normalize(normalMatrix * normal);
    vSunV = normalize((viewMatrix * vec4(uSun, 0.0)).xyz);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  varying vec2 vUvc;
  varying float vElev;
  varying vec3 vNormalV;
  varying vec3 vSunV;
  varying float vDepth;
  uniform sampler2D uOverview, uTile, uMask, uLc, uPal, uChm, uHgt;
  uniform float uClip;
  uniform vec4 uOvRect, uTileRect;   // (u0, v0, escala u, escala v) da célula em cada textura
  uniform vec4 uLcX, uHgtX;          // extensão (u, v) → textura: (escala u, desloc. u, escala v, desloc. v)
  uniform float uTileMix;
  uniform float uMin, uMax, uHyps, uSat, uLand, uCanopy, uContours, uInterval, uDim;
  uniform vec3 uPaper, uInk, uFog;
  uniform float uFogNear, uFogFar;
  // sol
  uniform vec3 uSunL, uSunCol;       // direção do sol no plano local (x leste, y cima, z sul)
  uniform float uSunI, uAmb, uShadow, uExag, uBase;
  uniform vec2 uExtM;                // tamanho da extensão em metros (leste-oeste, norte-sul)
  // imóveis do CAR: textura de identificação (R·256+G = índice+1; B = nº de cadastros | APP | déficit)
  uniform sampler2D uCar, uCarPal;
  uniform float uCarOn, uCarFill, uCarOv, uCarApp, uCarSel, uCarHov;

  vec3 ramp(float t) {
    vec3 c0 = vec3(0.47, 0.60, 0.40), c1 = vec3(0.70, 0.73, 0.49), c2 = vec3(0.80, 0.68, 0.47);
    vec3 c3 = vec3(0.70, 0.52, 0.36), c4 = vec3(0.93, 0.89, 0.82);
    if (t < 0.25) return mix(c0, c1, t / 0.25);
    if (t < 0.55) return mix(c1, c2, (t - 0.25) / 0.30);
    if (t < 0.85) return mix(c2, c3, (t - 0.55) / 0.30);
    return mix(c3, c4, (t - 0.85) / 0.15);
  }
  float contour(float e, float interval, float width) {
    float v = e / interval;
    float d = abs(fract(v - 0.5) - 0.5) / max(fwidth(v), 1e-5);
    return 1.0 - clamp(d / width, 0.0, 1.0);
  }
  // sombra do relevo: marcha na direção do sol sobre a grade de altitudes (passos crescentes, ~12 km)
  float sunVisibility(vec2 uv0, float e0) {
    if (uSunL.y <= 0.0) return 0.0;
    if (uShadow < 0.5) return 1.0;
    vec2 h = vec2(uSunL.x, uSunL.z);
    float hl = length(h);
    if (hl < 1e-4) return 1.0;
    h /= hl;
    float tanEl = (uSunL.y / hl) / uExag;     // a cena tem o relevo exagerado: o raio sobe mais devagar
    float vis = 1.0;
    float d = 25.0;
    for (int i = 0; i < 52; i++) {
      vec2 uv = uv0 + vec2(h.x * d / uExtM.x, -h.y * d / uExtM.y);
      if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) break;
      float th = texture2D(uHgt, vec2(uv.x * uHgtX.x + uHgtX.y, uv.y * uHgtX.z + uHgtX.w)).r + uBase;
      float ray = e0 + 3.0 + d * tanEl;
      vis = min(vis, clamp(0.5 + (ray - th) / (d * 0.035), 0.0, 1.0));
      if (vis <= 0.0) break;
      d *= 1.115;
    }
    return vis;
  }
  void main() {
    vec2 uvc = clamp(vUvc, 0.0, 1.0);
    vec2 ovUv = uOvRect.xy + uvc * uOvRect.zw;
    // recorte no limite municipal: máscara rasterizada do polígono (branco = dentro)
    if (uClip > 0.5 && texture2D(uMask, ovUv).r < 0.5) discard;

    vec3 n = normalize(vNormalV);
    float lam = max(dot(n, vSunV), 0.0);
    float vis = sunVisibility(ovUv, vElev);
    vec3 light = vec3(uAmb) + uSunCol * (uSunI * lam * vis);   // luz total (relevo)
    float direct = uSunI * lam * vis;

    // superfícies
    float t = clamp((vElev - uMin) / (uMax - uMin), 0.0, 1.0);
    vec3 base = mix(uPaper, ramp(t), uHyps);
    if (uLand > 0.5) {
      float cls = texture2D(uLc, vec2(ovUv.x * uLcX.x + uLcX.y, ovUv.y * uLcX.z + uLcX.w)).r;
      base = texture2D(uPal, vec2((cls * 255.0 + 0.5) / 256.0, 0.5)).rgb;
    }
    if (uCanopy > 0.5) {
      float hc = texture2D(uChm, ovUv).r * 255.0 / 6.0;  // metros
      vec3 bare = vec3(0.86, 0.84, 0.78);
      vec3 low = vec3(0.62, 0.78, 0.45), high = vec3(0.07, 0.33, 0.16);
      base = hc < 2.5 ? bare : mix(low, high, clamp((hc - 2.5) / 20.0, 0.0, 1.0));
    }
    vec3 col = base * (light * 1.05);
    // imagem de satélite: já traz sombras do horário da foto; aplica a luz pela metade + sombra projetada
    vec3 ov = texture2D(uOverview, ovUv).rgb;
    vec3 ti = texture2D(uTile, uTileRect.xy + uvc * uTileRect.zw).rgb;
    vec3 img = mix(ov, ti, uTileMix);
    vec3 imgLit = img * mix(vec3(1.0), light * 1.12, 0.5) * mix(1.0, 0.55 + 0.45 * vis, step(0.0, uSunL.y) * uShadow);
    imgLit *= mix(0.25, 1.0, smoothstep(-0.12, 0.08, uSunL.y));   // noite escurece
    col = mix(col, imgLit, uSat);
    col *= uDim;

    if (uCarOn > 0.5) {
      vec3 cc = floor(texture2D(uCar, ovUv).rgb * 255.0 + 0.5);
      float id = cc.r * 256.0 + cc.g;
      float cnt = mod(cc.b, 16.0), app = mod(floor(cc.b / 16.0), 2.0), def = mod(floor(cc.b / 32.0), 2.0);
      vec2 mp = ovUv * uExtM;
      float far = smoothstep(9000.0, 16000.0, vDepth);
      if (id > 0.5) {
        float idx = id - 1.0;
        vec4 pc = texture2D(uCarPal, vec2((mod(idx, 64.0) + 0.5) / 64.0, (floor(idx / 64.0) + 0.5) / 64.0));
        float sel = 1.0 - step(0.5, abs(id - uCarSel)), hov = 1.0 - step(0.5, abs(id - uCarHov));
        col = mix(col, pc.rgb, pc.a * max(uCarFill, sel * 0.35));
        col = mix(col, vec3(1.0), 0.16 * hov + 0.10 * sel);
        if (uCarOv > 0.5 && cnt > 1.5) {          // hachura diagonal onde há mais de um cadastro
          float v = (mp.x - mp.y) / 22.0;
          float dl = 0.5 - abs(fract(v) - 0.5);
          float ln = 1.0 - smoothstep(0.09, 0.09 + 1.5 * fwidth(v), dl);
          col = mix(col, vec3(0.80, 0.12, 0.42), 0.6 * ln * (1.0 - far));
        }
      }
      if (uCarApp > 0.5 && app > 0.5) col = mix(col, def > 0.5 ? vec3(0.88, 0.22, 0.12) : vec3(0.08, 0.50, 0.78), 0.55);
    }

    float minor = contour(vElev, uInterval, 0.8);
    float major = contour(vElev, uInterval * 5.0, 1.25);
    float fade = 1.0 - smoothstep(4000.0, 9000.0, vDepth);
    col = mix(col, mix(uInk, vec3(1.0, 0.93, 0.8), uSat * 0.6), uContours * fade * max(minor * 0.32, major * 0.62) * (1.0 - 0.35 * uSat));
    float fog = clamp((vDepth - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
    gl_FragColor = vec4(mix(col, uFog, fog), 1.0);
  }
`;

export class CellTerrain {
  constructor(hf, frame, { baseElev, colorRange, imagerySet, renderer }) {
    this.hf = hf; this.frame = frame; this.baseElev = baseElev;
    this.exaggeration = 1;
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    this.chunks = [];               // malhas ativas (para o raycast)
    this.cells = [];
    this.imagerySet = imagerySet;
    this.renderer = renderer;
    this.clon = (EXTENT.e - EXTENT.w) / COLS;
    this.clat = (EXTENT.n - EXTENT.s) / ROWS;
    this.texCache = new Map();      // url → { tex, promise, users:Set }
    this.loading = 0;

    const blank = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
    blank.needsUpdate = true;
    this.blank = blank;
    this.shared = {
      uMin: { value: colorRange[0] }, uMax: { value: colorRange[1] },
      uHyps: { value: 0 }, uSat: { value: 1 }, uContours: { value: 0 }, uInterval: { value: 20 },
      uSun: { value: new THREE.Vector3(-0.55, 0.75, -0.35).normalize() },
      uPaper: { value: new THREE.Color(0.91, 0.89, 0.83) },
      uInk: { value: new THREE.Color(0.49, 0.30, 0.16) },
      uFog: { value: new THREE.Color(0.85, 0.87, 0.86) },
      uFogNear: { value: 14000 }, uFogFar: { value: 52000 }, uDim: { value: 1 },
      uOverview: { value: blank },
      uMask: { value: blank }, uClip: { value: 0 },
      uLand: { value: 0 }, uCanopy: { value: 0 },
      uLc: { value: blank }, uPal: { value: blank }, uChm: { value: blank }, uHgt: { value: blank },
      uLcX: { value: new THREE.Vector4(1, 0, 1, 0) }, uHgtX: { value: new THREE.Vector4(1, 0, 1, 0) },
      uSunL: { value: new THREE.Vector3(-0.55, 0.75, -0.35).normalize() },
      uSunCol: { value: new THREE.Color(1, 0.97, 0.92) },
      uSunI: { value: 0.78 }, uAmb: { value: 0.42 }, uShadow: { value: 0 }, uExag: { value: 1 }, uBase: { value: baseElev },
      uExtM: { value: new THREE.Vector2(1, 1) },
      uCar: { value: blank }, uCarPal: { value: blank },
      uCarOn: { value: 0 }, uCarFill: { value: 0.3 }, uCarOv: { value: 1 }, uCarApp: { value: 0 }, uCarSel: { value: -1 }, uCarHov: { value: -1 },
    };
    {
      const nw = frame.toLocal(EXTENT.n, EXTENT.w), se = frame.toLocal(EXTENT.s, EXTENT.e);
      this.shared.uExtM.value.set(se.x - nw.x, se.z - nw.z);
    }
    this.uniforms = this.shared; // compatibilidade com o resto do app
    new THREE.TextureLoader().loadAsync(OVERVIEW).then((t) => {
      t.anisotropy = renderer.capabilities.getMaxAnisotropy();
      this.shared.uOverview.value = t;
    });

    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) this.#makeCell(r, c);
    this.chunks = this.cells.map((c) => c.mesh);
    this.skirtMaterial = null;
    this.setExaggeration(1);
  }

  #makeCell(r, c) {
    const n = EXTENT.n - r * this.clat, s = n - this.clat, w = EXTENT.w + c * this.clon, e = w + this.clon;
    const center = this.frame.toLocal((n + s) / 2, (w + e) / 2);
    const nw = this.frame.toLocal(n, w), se = this.frame.toLocal(s, e);
    const uniforms = {
      ...this.shared,
      uTile: { value: this.blank }, uTileMix: { value: 0 },
      uTileRect: { value: new THREE.Vector4(0, 0, 1, 1) },
      uOvRect: { value: new THREE.Vector4(c / COLS, 1 - (r + 1) / ROWS, 1 / COLS, 1 / ROWS) },
    };
    const material = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms });
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    mesh.frustumCulled = true;
    const cell = { r, c, n, s, w, e, center, minX: nw.x, maxX: se.x, minZ: nw.z, maxZ: se.z,
      mesh, uniforms, lod: -1, geoms: [], tileUrl: null, wantUrl: null };
    mesh.userData.cell = cell;
    this.cells.push(cell);
    this.group.add(mesh);
    this.#setLOD(cell, SEGS.length - 1);
  }

  #buildGeometry(cell, lod) {
    const N = SEGS[lod], V = N + 1, hf = this.hf, f = this.frame;
    const total = V * V + 4 * V;      // grade + anel da saia
    const pos = new Float32Array(total * 3), nrm = new Float32Array(total * 3), uv = new Float32Array(total * 2);
    const dLat = 12 / f.mPerDegLat, dLon = 12 / f.mPerDegLon; // passo de 12 m para a normal
    let k = 0;
    const put = (lat, lon, y, nx, ny, nz, u, v) => {
      const p = f.toLocal(lat, lon);
      pos[k * 3] = p.x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = p.z;
      nrm[k * 3] = nx; nrm[k * 3 + 1] = ny; nrm[k * 3 + 2] = nz;
      uv[k * 2] = u; uv[k * 2 + 1] = v; k++;
    };
    const normalAt = (lat, lon) => {
      const sx = (hf.elevation(lat, lon + dLon) - hf.elevation(lat, lon - dLon)) / 24;
      const sz = (hf.elevation(lat - dLat, lon) - hf.elevation(lat + dLat, lon)) / 24; // z = sul
      const l = Math.hypot(sx, 1, sz);
      return [-sx / l, 1 / l, -sz / l];
    };
    const ring = [];
    for (let j = 0; j < V; j++) {
      const lat = cell.n - (j / N) * (cell.n - cell.s);
      for (let i = 0; i < V; i++) {
        const lon = cell.w + (i / N) * (cell.e - cell.w);
        const y = hf.elevation(lat, lon);
        const [nx, ny, nz] = normalAt(lat, lon);
        put(lat, lon, y, nx, ny, nz, i / N, 1 - j / N);
      }
    }
    // saia: repete a borda (sentido horário) baixando SKIRT metros
    const edge = [];
    for (let i = 0; i < N; i++) edge.push([0, i]);
    for (let j = 0; j < N; j++) edge.push([j, N]);
    for (let i = N; i > 0; i--) edge.push([N, i]);
    for (let j = N; j > 0; j--) edge.push([j, 0]);
    const skirt0 = k;
    for (const [j, i] of edge) {
      const src = j * V + i;
      pos[k * 3] = pos[src * 3]; pos[k * 3 + 1] = pos[src * 3 + 1] - SKIRT; pos[k * 3 + 2] = pos[src * 3 + 2];
      nrm[k * 3] = nrm[src * 3]; nrm[k * 3 + 1] = nrm[src * 3 + 1]; nrm[k * 3 + 2] = nrm[src * 3 + 2];
      uv[k * 2] = uv[src * 2]; uv[k * 2 + 1] = uv[src * 2 + 1];
      ring.push(src); k++;
    }
    const idx = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const a = j * V + i, b = a + 1, c = a + V, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const L = ring.length;
    for (let q = 0; q < L; q++) {
      const a = ring[q], b = ring[(q + 1) % L], a2 = skirt0 + q, b2 = skirt0 + ((q + 1) % L);
      idx.push(a, a2, b, b, a2, b2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, k * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm.subarray(0, k * 3), 3));
    g.setAttribute('uvc', new THREE.BufferAttribute(uv.subarray(0, k * 2), 2));
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
  }

  #setLOD(cell, lod) {
    if (cell.lod === lod) return;
    if (!cell.geoms[lod]) cell.geoms[lod] = this.#buildGeometry(cell, lod);
    cell.mesh.geometry = cell.geoms[lod];
    cell.mesh.material.side = THREE.DoubleSide; // saias visíveis dos dois lados
    cell.lod = lod;
  }

  // distância 3D aproximada da câmera até a célula (em metros reais)
  #distance(cell, cam) {
    const dx = Math.max(cell.minX - cam.x, 0, cam.x - cell.maxX);
    const dz = Math.max(cell.minZ - cam.z, 0, cam.z - cell.maxZ);
    const camElev = this.elevFromSceneY(cam.y);
    const groundElev = this.hf.elevation((cell.n + cell.s) / 2, (cell.w + cell.e) / 2);
    return Math.hypot(dx, dz, Math.max(0, camElev - groundElev));
  }

  // chamado periodicamente pelo laço principal
  update(camera) {
    const cam = camera.position;
    let builds = 0;
    const wants = [];
    for (const cell of this.cells) cell.dist = this.#distance(cell, cam);
    // mais perto primeiro: o orçamento de construção por quadro vai para o que está à frente da câmera
    const order = [...this.cells].sort((a, b) => a.dist - b.dist);
    for (const cell of order) {
      const d = cell.dist;
      const lod = d < LOD_DIST[0] ? 0 : d < LOD_DIST[1] ? 1 : d < LOD_DIST[2] ? 2 : 3;
      if (lod !== cell.lod && (cell.geoms[lod] || builds < 6)) {
        if (!cell.geoms[lod]) builds++;
        this.#setLOD(cell, lod);
      }
      // imagem desejada
      const set = this.imagerySet;
      let want = null, rect = null;
      if (set.town && TOWN_CELLS.has(`${cell.r}_${cell.c}`) && d < TOWN_DIST) {
        want = set.town(cell.r, cell.c); rect = [0, 0, 1, 1];
      } else if (d < TILE_DIST) {
        want = set.tile(cell.r >> 1, cell.c >> 1);
        rect = [(cell.c & 1) * 0.5, (cell.r & 1) ? 0 : 0.5, 0.5, 0.5];
      } else if (d > UNLOAD_DIST) {
        want = null;
      } else {
        want = cell.tileUrl; rect = cell.rect; // faixa intermediária: mantém o que já tem
      }
      cell.wantUrl = want; cell.wantRect = rect;
      if (want && want !== cell.tileUrl) wants.push(cell);
      if (!want && cell.tileUrl) this.#assign(cell, null, null);
    }
    wants.sort((a, b) => a.dist - b.dist);
    for (const cell of wants) {
      const entry = this.texCache.get(cell.wantUrl);
      if (entry?.tex) { this.#assign(cell, cell.wantUrl, cell.wantRect); continue; }
      if (!entry && this.loading < 6) this.#load(cell.wantUrl);
    }
    this.#gc();
  }

  #load(url) {
    this.loading++;
    const entry = { tex: null, users: new Set() };
    this.texCache.set(url, entry);
    new THREE.TextureLoader().loadAsync(url).then((t) => {
      t.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      entry.tex = t;
    }).catch(() => { this.texCache.delete(url); }).finally(() => { this.loading--; });
  }

  #assign(cell, url, rect) {
    if (cell.tileUrl) this.texCache.get(cell.tileUrl)?.users.delete(cell);
    cell.tileUrl = url; cell.rect = rect;
    const u = cell.uniforms;
    if (url) {
      const entry = this.texCache.get(url);
      entry.users.add(cell);
      u.uTile.value = entry.tex;
      u.uTileRect.value.set(...rect);
      cell.fadeStart = performance.now();
      u.uTileMix.value = 0;
    } else {
      u.uTile.value = this.blank; u.uTileMix.value = 0;
    }
  }

  // transição suave quando a imagem chega; libera texturas sem uso
  animate() {
    const now = performance.now();
    for (const cell of this.cells) {
      if (cell.tileUrl && cell.uniforms.uTileMix.value < 1) {
        cell.uniforms.uTileMix.value = Math.min(1, (now - cell.fadeStart) / 400);
      }
    }
  }

  #gc() {
    for (const [url, entry] of this.texCache) {
      if (entry.tex && entry.users.size === 0) {
        entry.idle = (entry.idle || 0) + 1;
        if (entry.idle > 20) { entry.tex.dispose(); this.texCache.delete(url); }
      } else entry.idle = 0;
    }
  }

  // --- recorte no limite municipal ----------------------------------------
  // máscara: polígono rasterizado na grade da visão geral (~15 m/px); parede: "maquete" ao longo do limite
  setClipPolygon(ring) {
    const W = 3072, H = Math.round(3072 * (EXTENT.n - EXTENT.s) / (EXTENT.e - EXTENT.w));
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff'; ctx.beginPath();
    ring.forEach(([lat, lon], k) => {
      const x = ((lon - EXTENT.w) / (EXTENT.e - EXTENT.w)) * W, y = ((EXTENT.n - lat) / (EXTENT.n - EXTENT.s)) * H;
      k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.closePath(); ctx.fill();
    this.maskData = { W, H, px: ctx.getImageData(0, 0, W, H).data };
    const tex = new THREE.CanvasTexture(cv);
    tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
    this.shared.uMask.value = tex;
    this.clipRing = ring;
    this.#buildWall();
  }

  // true se o ponto local (x, z) está dentro do município (pela máscara)
  insideLocal(x, z) {
    if (!this.maskData) return true;
    const { lat, lon } = this.frame.toLatLon(x, z);
    const { W, H, px } = this.maskData;
    const i = Math.floor(((lon - EXTENT.w) / (EXTENT.e - EXTENT.w)) * W), j = Math.floor(((EXTENT.n - lat) / (EXTENT.n - EXTENT.s)) * H);
    if (i < 0 || j < 0 || i >= W || j >= H) return false;
    return px[(j * W + i) * 4] > 127;
  }

  #buildWall() {
    if (!this.clipRing) return;
    if (this.wall) { this.wall.geometry.dispose(); this.group.remove(this.wall); }
    const f = this.frame, hf = this.hf, bottom = this.baseElev - 120;
    const pts = [];
    const ring = this.clipRing;
    for (let k = 0; k < ring.length - 1; k++) {
      const [la, oa] = ring[k], [lb, ob] = ring[k + 1];
      const a = f.toLocal(la, oa), b = f.toLocal(lb, ob);
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 25));
      for (let s = 0; s < n; s++) { const t = s / n; pts.push([la + (lb - la) * t, oa + (ob - oa) * t]); }
    }
    pts.push(ring[ring.length - 1]);
    const pos = new Float32Array(pts.length * 2 * 3);
    pts.forEach(([lat, lon], k) => {
      const p = f.toLocal(lat, lon), y = hf.elevation(lat, lon);
      pos.set([p.x, y, p.z, p.x, bottom, p.z], k * 6);
    });
    const idx = [];
    for (let k = 0; k < pts.length - 1; k++) { const a = k * 2, b = a + 2; idx.push(a, a + 1, b, b, a + 1, b + 1); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    this.wallMaterial ??= new THREE.MeshLambertMaterial({ color: 0x8b7b64, side: THREE.DoubleSide });
    this.wall = new THREE.Mesh(g, this.wallMaterial);
    this.wall.visible = this.shared.uClip.value > 0.5;
    this.group.add(this.wall);
  }

  setClip(on) {
    this.shared.uClip.value = on && this.maskData ? 1 : 0;
    if (this.wall) this.wall.visible = !!on;
  }
  get clipped() { return this.shared.uClip.value > 0.5; }

  // --- texturas temáticas e luz ------------------------------------------------
  // transformação (u, v) da extensão → (u, v) de uma grade geográfica; flipY: textura carregada de imagem
  #xform(g, flipY) {
    const W = g.w * g.d, H = g.h * g.d, ew = EXTENT.e - EXTENT.w, ns = EXTENT.n - EXTENT.s;
    const su = ew / W, ou = (EXTENT.w - g.lon0) / W;
    if (flipY) return new THREE.Vector4(su, ou, ns / H, 1 - (g.lat0 - EXTENT.s) / H);
    return new THREE.Vector4(su, ou, -ns / H, (g.lat0 - EXTENT.s) / H);
  }
  setLanduseTexture(tex, grid, palette) {
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false;
    this.shared.uLc.value = tex;
    this.shared.uLcX.value = this.#xform(grid, true);
    if (palette) this.shared.uPal.value = palette;
  }
  setCanopyTexture(tex) { this.shared.uChm.value = tex; }
  // imóveis do CAR: textura de identificação (cobre a extensão), paleta 64×64 por índice e estado
  setCarTexture(tex) {
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false;
    tex.colorSpace = THREE.NoColorSpace; tex.needsUpdate = true;
    this.shared.uCar.value = tex;
  }
  setCarPalette(rgba) {
    let t = this.shared.uCarPal.value;
    if (!t || t === this.blank) {
      t = new THREE.DataTexture(rgba, 64, 64, THREE.RGBAFormat);
      t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
      this.shared.uCarPal.value = t;
    } else t.image.data.set(rgba);
    t.needsUpdate = true;
  }
  setCarState({ on, fill, overlap, app, sel, hover } = {}) {
    const u = this.shared;
    if (on !== undefined) u.uCarOn.value = on ? 1 : 0;
    if (fill !== undefined) u.uCarFill.value = fill;
    if (overlap !== undefined) u.uCarOv.value = overlap ? 1 : 0;
    if (app !== undefined) u.uCarApp.value = app ? 1 : 0;
    if (sel !== undefined) u.uCarSel.value = sel;
    if (hover !== undefined) u.uCarHov.value = hover;
  }
  // grade de altitudes do modelo ativo como textura (meia precisão) para as sombras
  #buildHeightTexture() {
    const hf = this.hf, n = hf.width * hf.height, half = new Uint16Array(n);
    for (let k = 0; k < n; k++) half[k] = THREE.DataUtils.toHalfFloat(hf.data[k] - this.baseElev);
    const tex = new THREE.DataTexture(half, hf.width, hf.height, THREE.RedFormat, THREE.HalfFloatType);
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true;
    this.shared.uHgt.value?.dispose?.();
    this.shared.uHgt.value = tex;
    const g = hf.georef;
    this.shared.uHgtX.value = this.#xform({ w: hf.width, h: hf.height, lon0: g.lon0, lat0: g.lat0, d: g.dLon }, false);
  }
  setShadows(on) {
    if (on && !this.hgtReady) { this.#buildHeightTexture(); this.hgtReady = true; }
    this.shared.uShadow.value = on ? 1 : 0;
  }
  setSun({ dir, color, intensity, ambient }) {
    const u = this.shared;
    u.uSunL.value.copy(dir); u.uSun.value.copy(dir);
    u.uSunCol.value.copy(color).convertLinearToSRGB(); u.uSunI.value = intensity; u.uAmb.value = ambient;
  }

  setImagerySet(set) {
    this.imagerySet = set;
    for (const cell of this.cells) this.#assign(cell, null, null);
  }

  // troca o modelo de relevo: refaz geometrias (as imagens continuam)
  setHeightField(hf) {
    this.hf = hf;
    this.#buildWall();
    if (this.hgtReady) this.#buildHeightTexture();
    for (const cell of this.cells) {
      cell.geoms.forEach((g) => g?.dispose());
      cell.geoms = []; const lod = cell.lod; cell.lod = -1;
      this.#setLOD(cell, Math.max(lod, 2)); // começa leve; o update refina
    }
  }

  setExaggeration(v) {
    this.exaggeration = v;
    this.shared.uExag.value = v;
    this.group.scale.y = v;
    this.group.position.y = -this.baseElev * v;
  }
  sceneY(elev) { return (elev - this.baseElev) * this.exaggeration; }
  elevFromSceneY(y) { return y / this.exaggeration + this.baseElev; }
  worldPosition(lat, lon, elev) {
    const p = this.frame.toLocal(lat, lon);
    return new THREE.Vector3(p.x, this.sceneY(elev ?? this.hf.elevation(lat, lon)), p.z);
  }
  groundY(x, z) {
    const { lat, lon } = this.frame.toLatLon(x, z);
    return this.sceneY(this.hf.elevation(lat, lon));
  }
  bounds() { return { ...EXTENT }; }

  setStyle({ surface, contours, interval, paper, ink, fog, dim, wall }) {
    const u = this.shared;
    if (surface !== undefined) {
      u.uSat.value = surface === 'satellite' ? 1 : 0;
      u.uHyps.value = surface === 'altitude' ? 1 : 0;
      u.uLand.value = surface === 'landuse' ? 1 : 0;
      u.uCanopy.value = surface === 'canopy' ? 1 : 0;
    }
    if (contours !== undefined) u.uContours.value = contours ? 1 : 0;
    if (interval !== undefined) u.uInterval.value = interval;
    if (paper) u.uPaper.value.set(paper);
    if (ink) u.uInk.value.set(ink);
    if (fog) u.uFog.value.set(fog).convertLinearToSRGB();   // o shader escreve sem conversão de cor
    if (dim !== undefined) u.uDim.value = dim;
    if (wall && this.wallMaterial) this.wallMaterial.color.set(wall);
  }

  // textura carregada / total, para a barra de status
  stats() {
    let tiles = 0, near = 0;
    for (const c of this.cells) { if (c.dist < TILE_DIST) { near++; if (c.tileUrl && c.uniforms.uTileMix.value > 0) tiles++; } }
    return { tiles, near, loading: this.loading };
  }
}
