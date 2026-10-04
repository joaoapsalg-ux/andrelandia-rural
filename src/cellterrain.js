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
  uniform sampler2D uOverview, uTile, uMask, uLc, uLc2, uLcA, uPal, uSolG, uHgt;
  uniform float uLcT, uSol, uFrost, uSplit;   // uSol: 1 inverno, 2 verão · uSplit: x em pixels da divisória (antes/depois), < 0 = desligada
  uniform vec2 uSolR;                        // faixa de kWh/m²/dia da rampa do sol
  uniform float uClip;
  uniform vec4 uOvRect, uTileRect;   // (u0, v0, escala u, escala v) da célula em cada textura
  uniform vec4 uLcX, uHgtX;          // extensão (u, v) → textura: (escala u, desloc. u, escala v, desloc. v)
  uniform float uTileMix;
  uniform float uMin, uMax, uHyps, uSat, uLand, uContours, uInterval, uDim;
  uniform vec3 uPaper, uInk, uFog;
  uniform float uFogNear, uFogFar;
  // sol
  uniform vec3 uSunL, uSunCol;       // direção do sol no plano local (x leste, y cima, z sul)
  uniform float uSunI, uAmb, uShadow, uExag, uBase;
  uniform vec2 uExtM;                // tamanho da extensão em metros (leste-oeste, norte-sul)
  // imóveis do CAR: textura de identificação (R·256+G = índice+1; B = nº de cadastros | APP | déficit)
  uniform sampler2D uCar, uCarPal;
  uniform float uCarOn, uCarFill, uCarOv, uCarApp, uCarSel, uCarHov;
  // propriedade escolhida: máscara do contorno (R = dentro, G = borda suave) num retângulo da extensão
  uniform sampler2D uSelMask;
  uniform vec4 uSelRect;             // (u0, v0, largura, altura) na extensão
  uniform float uSelDim;             // 0 = nada apagado, 1 = resto do mapa apagado
  // área morro acima que drena para a propriedade (máscara na grade de 30 m, recortada no retângulo da bacia)
  uniform sampler2D uUpMask;
  uniform vec4 uUpRect;              // (u0, v0, largura, altura) na grade de 30 m
  uniform float uUpOn;
  // relevo local (vale escuro, crista clara), 128 = neutro
  uniform sampler2D uRel;
  uniform vec4 uRelX;
  uniform float uRelief;
  uniform float uFilm;               // acabamento de cinema (0–1)
  uniform float uSharp, uClarity, uTexel;   // nitidez e clareza da imagem de perto; texel = 1 / lado do bloco
  uniform float uTileSharp;                 // por célula: 1 nos blocos de 4 m, menos nos de 2 m (já realçados)
  // vigor (NDVI da Sentinel-2, grade da extensão ~15 m): 0 = sem dado; NDVI = (v − 1) / 254 − 0,1
  uniform sampler2D uNdvi;
  uniform float uVig;
  uniform vec2 uVigR;                // faixa de NDVI da rampa (muda com a estação)

  // rampa do vigor: marrom (pouco verde) → amarelo → verde → verde-escuro
  vec3 vigRamp(float t) {
    vec3 c0 = vec3(0.55, 0.35, 0.18), c1 = vec3(0.79, 0.64, 0.35), c2 = vec3(0.84, 0.83, 0.42), c3 = vec3(0.50, 0.71, 0.31), c4 = vec3(0.18, 0.54, 0.24), c5 = vec3(0.08, 0.35, 0.16);
    if (t < 0.2) return mix(c0, c1, t / 0.2);
    if (t < 0.4) return mix(c1, c2, (t - 0.2) / 0.2);
    if (t < 0.6) return mix(c2, c3, (t - 0.4) / 0.2);
    if (t < 0.8) return mix(c3, c4, (t - 0.6) / 0.2);
    return mix(c4, c5, (t - 0.8) / 0.2);
  }

  vec3 ramp(float t) {
    vec3 c0 = vec3(0.47, 0.60, 0.40), c1 = vec3(0.70, 0.73, 0.49), c2 = vec3(0.80, 0.68, 0.47);
    vec3 c3 = vec3(0.70, 0.52, 0.36), c4 = vec3(0.93, 0.89, 0.82);
    if (t < 0.25) return mix(c0, c1, t / 0.25);
    if (t < 0.55) return mix(c1, c2, (t - 0.25) / 0.30);
    if (t < 0.85) return mix(c2, c3, (t - 0.55) / 0.30);
    return mix(c3, c4, (t - 0.85) / 0.15);
  }
  // rampa do sol: pouco (violeta escuro) → muito (amarelo claro)
  vec3 solRamp(float t) {
    vec3 c0 = vec3(0.17, 0.11, 0.33), c1 = vec3(0.50, 0.17, 0.42), c2 = vec3(0.85, 0.33, 0.29), c3 = vec3(0.97, 0.62, 0.23), c4 = vec3(0.99, 0.93, 0.62);
    if (t < 0.25) return mix(c0, c1, t / 0.25);
    if (t < 0.5) return mix(c1, c2, (t - 0.25) / 0.25);
    if (t < 0.75) return mix(c2, c3, (t - 0.5) / 0.25);
    return mix(c3, c4, (t - 0.75) / 0.25);
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

    // superfícies (à esquerda da divisória "antes e depois": uso do solo do ano de comparação)
    bool before = uSplit >= 0.0 && gl_FragCoord.x < uSplit;
    float land = before ? 1.0 : uLand, sat = before ? 0.0 : uSat, sol = before ? 0.0 : uSol, frost = before ? 0.0 : uFrost, vig = before ? 0.0 : uVig;
    float t = clamp((vElev - uMin) / (uMax - uMin), 0.0, 1.0);
    vec3 base = mix(uPaper, ramp(t), uHyps);
    vec2 lcUv = vec2(ovUv.x * uLcX.x + uLcX.y, ovUv.y * uLcX.z + uLcX.w);
    if (land > 0.5) {
      if (before) {
        base = texture2D(uPal, vec2((texture2D(uLcA, lcUv).r * 255.0 + 0.5) / 256.0, 0.5)).rgb;
      } else {
        vec3 c1 = texture2D(uPal, vec2((texture2D(uLc, lcUv).r * 255.0 + 0.5) / 256.0, 0.5)).rgb;
        vec3 c2 = texture2D(uPal, vec2((texture2D(uLc2, lcUv).r * 255.0 + 0.5) / 256.0, 0.5)).rgb;
        base = mix(c1, c2, uLcT);
      }
    }
    vec3 sg = texture2D(uSolG, lcUv).rgb;
    if (sol > 0.5) {
      float kwh = (sol < 1.5 ? sg.r : sg.g) * 255.0 / 25.0;
      base = solRamp(clamp((kwh - uSolR.x) / (uSolR.y - uSolR.x), 0.0, 1.0));
    }
    if (vig > 0.5) {   // sem dado = cinza
      float nb = texture2D(uNdvi, ovUv).r * 255.0;
      base = nb < 0.5 ? vec3(0.55) : vigRamp(clamp(((nb - 1.0) / 254.0 - 0.1 - uVigR.x) / (uVigR.y - uVigR.x), 0.0, 1.0));
    }
    vec3 col = base * mix(vec3(1.0), light * 1.05, sol > 0.5 ? 0.35 : 1.0);
    // imagem de satélite: já traz sombras do horário da foto; aplica a luz pela metade + sombra projetada
    vec3 ov = texture2D(uOverview, ovUv).rgb;
    vec2 tuv = uTileRect.xy + uvc * uTileRect.zw;
    vec3 ti = texture2D(uTile, tuv).rgb;
    if (uTileMix > 0.0 && (uSharp > 0.0 || uClarity > 0.0)) {
      // nitidez (vizinhos a 1 texel) e clareza (contraste local a ~4 texels) só na imagem de perto.
      // Testados também bicúbica (Catmull-Rom) e nitidez adaptativa: sem ganho visível com a imagem de 4 m.
      vec2 o = vec2(uTexel, 0.0), p = vec2(0.0, uTexel);
      vec3 b1 = (texture2D(uTile, tuv + o).rgb + texture2D(uTile, tuv - o).rgb + texture2D(uTile, tuv + p).rgb + texture2D(uTile, tuv - p).rgb) * 0.25;
      vec3 b4 = (texture2D(uTile, tuv + 4.0 * o).rgb + texture2D(uTile, tuv - 4.0 * o).rgb + texture2D(uTile, tuv + 4.0 * p).rgb + texture2D(uTile, tuv - 4.0 * p).rgb) * 0.25;
      ti = clamp(ti + uTileSharp * (uSharp * (ti - b1) + uClarity * (ti - b4)), 0.0, 1.0);
    }
    vec3 img = mix(ov, ti, uTileMix);
    // correção de cor da imagem (vinha escura e lavada): meios-tons mais claros, mais saturação e um pouco de contraste
    img = pow(max(img, 0.0), vec3(0.88));
    img = mix(vec3(dot(img, vec3(0.299, 0.587, 0.114))), img, 1.15);
    img = clamp((img - 0.5) * 1.1 + 0.52, 0.0, 1.0);
    vec3 imgLit = img * mix(vec3(1.0), light * 1.12, 0.5) * mix(1.0, 0.55 + 0.45 * vis, step(0.0, uSunL.y) * uShadow);
    imgLit *= mix(0.25, 1.0, smoothstep(-0.12, 0.08, uSunL.y));   // noite escurece
    col = mix(col, imgLit, sat);
    if (vig > 0.5) col *= 0.72 + 0.56 * dot(img, vec3(0.299, 0.587, 0.114));   // a textura da imagem (árvores, estradas) por baixo da cor
    if (frost > 0.5) {   // geada: imagem acinzentada e baixadas frias em branco-azulado
      float g = dot(imgLit, vec3(0.3, 0.59, 0.11));
      col = mix(vec3(g * 0.82), imgLit * 0.6, 0.25);
      float fr = sg.b;
      col = mix(col, vec3(0.62, 0.80, 0.96), smoothstep(0.30, 0.48, fr) * 0.55);
      col = mix(col, vec3(0.95, 0.98, 1.0), smoothstep(0.48, 0.68, fr) * 0.9);
    }
    if (uRelief > 0.0) {
      float rl = texture2D(uRel, vec2(ovUv.x * uRelX.x + uRelX.y, ovUv.y * uRelX.z + uRelX.w)).r * 2.0 - 1.0;
      col *= 1.0 + uRelief * 0.3 * rl * (1.0 - smoothstep(20000.0, 45000.0, vDepth) * 0.5);
    }
    if (uSplit >= 0.0 && abs(gl_FragCoord.x - uSplit) < 1.5) col = vec3(1.0);
    col *= uDim;
    // propriedade escolhida (R = dentro, G = borda suave)
    vec2 selM = vec2(0.0);
    if (uSelDim > 0.0) {
      vec2 sm = (ovUv - uSelRect.xy) / uSelRect.zw;
      selM = (sm.x >= 0.0 && sm.y >= 0.0 && sm.x <= 1.0 && sm.y <= 1.0) ? texture2D(uSelMask, sm).rg : vec2(0.0);
    }

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
        // a escolhida fica com a cor bem leve: o destaque vem do resto apagado e a imagem aparece
        col = mix(col, pc.rgb, pc.a * (sel > 0.5 ? 0.15 : uCarFill));
        col = mix(col, vec3(1.0), 0.16 * hov + 0.04 * sel);
        if (uCarOv > 0.5 && cnt > 1.5) {          // hachura diagonal onde há mais de um cadastro
          float v = (mp.x - mp.y) / 22.0;
          float dl = 0.5 - abs(fract(v) - 0.5);
          float ln = 1.0 - smoothstep(0.09, 0.09 + 1.5 * fwidth(v), dl);
          col = mix(col, vec3(0.80, 0.12, 0.42), 0.6 * ln * (1.0 - far));
        }
      }
      // APP: com uma propriedade escolhida, só a dela
      if (uCarApp > 0.5 && app > 0.5) col = mix(col, def > 0.5 ? vec3(0.88, 0.22, 0.12) : vec3(0.08, 0.50, 0.78), 0.55 * (uSelDim > 0.0 ? selM.r : 1.0));
    }

    float minor = contour(vElev, uInterval, 0.8);
    float major = contour(vElev, uInterval * 5.0, 1.25);
    float fade = 1.0 - smoothstep(4000.0, 9000.0, vDepth);
    col = mix(col, mix(uInk, vec3(1.0, 0.93, 0.8), sat * 0.6), uContours * fade * max(minor * 0.32, major * 0.62) * (1.0 - 0.35 * sat));
    float up = 0.0;
    if (uUpOn > 0.0) {     // de onde vem a água: véu azul, e o escurecido fica mais fraco ali
      vec2 gu = (lcUv - uUpRect.xy) / uUpRect.zw;
      up = (gu.x >= 0.0 && gu.y >= 0.0 && gu.x <= 1.0 && gu.y <= 1.0) ? texture2D(uUpMask, gu).r * uUpOn : 0.0;
      col = mix(col, vec3(0.22, 0.60, 0.95), 0.38 * up);
    }
    if (uSelDim > 0.0) {   // fora da propriedade escolhida: mais escuro e quase sem cor; perto da borda, menos
      vec3 dimmed = mix(vec3(dot(col, vec3(0.3, 0.59, 0.11))), col, 0.35) * 0.55;
      col = mix(col, dimmed, uSelDim * (1.0 - max(max(selM.r, selM.g * 0.5), up * 0.6)));
    }
    // perspectiva aérea: o ar entre a câmera e o chão clareia e azula o que está longe (sensação de distância)
    col = mix(col, uFog, 0.38 * (1.0 - exp(-vDepth / 26000.0)));
    float fog = clamp((vDepth - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
    col = mix(col, uFog, fog);
    if (uFilm > 0.0) {   // acabamento de cinema: curva em S suave, sombras um pouco mais frias e realces mais quentes
      vec3 s = col * col * (3.0 - 2.0 * col);
      vec3 graded = mix(col, s, 0.45);
      float l = dot(graded, vec3(0.299, 0.587, 0.114));
      graded += vec3(0.025, 0.01, -0.02) * smoothstep(0.45, 0.9, l) + vec3(-0.012, 0.0, 0.018) * (1.0 - smoothstep(0.1, 0.4, l));
      col = mix(col, clamp(graded, 0.0, 1.0), uFilm);
    }
    gl_FragColor = vec4(col, 1.0);
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
      uLand: { value: 0 }, uSol: { value: 0 }, uFrost: { value: 0 }, uSplit: { value: -1 }, uLcT: { value: 0 },
      uSolR: { value: new THREE.Vector2(1.6, 5.0) },
      uLc: { value: blank }, uLc2: { value: blank }, uLcA: { value: blank }, uPal: { value: blank }, uSolG: { value: blank }, uHgt: { value: blank },
      uLcX: { value: new THREE.Vector4(1, 0, 1, 0) }, uHgtX: { value: new THREE.Vector4(1, 0, 1, 0) },
      uSunL: { value: new THREE.Vector3(-0.55, 0.75, -0.35).normalize() },
      uSunCol: { value: new THREE.Color(1, 0.97, 0.92) },
      uSunI: { value: 0.78 }, uAmb: { value: 0.42 }, uShadow: { value: 0 }, uExag: { value: 1 }, uBase: { value: baseElev },
      uExtM: { value: new THREE.Vector2(1, 1) },
      uCar: { value: blank }, uCarPal: { value: blank },
      uCarOn: { value: 0 }, uCarFill: { value: 0.3 }, uCarOv: { value: 1 }, uCarApp: { value: 0 }, uCarSel: { value: -1 }, uCarHov: { value: -1 },
      uSelMask: { value: blank }, uSelRect: { value: new THREE.Vector4(0, 0, 1, 1) }, uSelDim: { value: 0 },
      uUpMask: { value: blank }, uUpRect: { value: new THREE.Vector4(0, 0, 1, 1) }, uUpOn: { value: 0 },
      uRel: { value: blank }, uRelX: { value: new THREE.Vector4(1, 0, 1, 0) }, uRelief: { value: 0 }, uFilm: { value: 0 },
      uSharp: { value: 0 }, uClarity: { value: 0 }, uTexel: { value: 1 / 1024 },
      uNdvi: { value: blank }, uVig: { value: 0 }, uVigR: { value: new THREE.Vector2(0.45, 0.9) },
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
      uTile: { value: this.blank }, uTileMix: { value: 0 }, uTileSharp: { value: 1 },
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
      u.uTileSharp.value = url.includes('/town/') ? 0.35 : 1;   // os blocos de 2 m já vêm realçados do processamento
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
  setLcGrid(grid, palette) { this.shared.uLcX.value = this.#xform(grid, true); if (palette) this.shared.uPal.value = palette; }
  setLanduseTexture(tex, grid, palette) {
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false;
    this.shared.uLc.value = tex;
    this.shared.uLcX.value = this.#xform(grid, true);
    if (palette) this.shared.uPal.value = palette;
  }
  // máquina do tempo: dois anos misturados por t (0 = a, 1 = b); "antes" = ano à esquerda da divisória
  // só reenvia a textura à GPU na primeira vez (a máquina do tempo chama isto a cada quadro enquanto toca)
  #nearest(tex) {
    if (tex.magFilter === THREE.NearestFilter && tex.minFilter === THREE.NearestFilter && !tex.generateMipmaps) return tex;
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.needsUpdate = true;
    return tex;
  }
  setLanduseBlend(a, b, t) { this.shared.uLc.value = this.#nearest(a); this.shared.uLc2.value = this.#nearest(b); this.shared.uLcT.value = t; }
  setBeforeTexture(tex) { this.shared.uLcA.value = this.#nearest(tex); }
  setSplit(px) { this.shared.uSplit.value = px; }
  setSolTexture(tex) { this.shared.uSolG.value = tex; }
  setVigorTexture(tex, range) { this.shared.uNdvi.value = tex ?? this.blank; if (range) this.shared.uVigR.value.set(range[0], range[1]); }
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
  setCarState({ on, fill, overlap, app, sel, hover, dim } = {}) {
    const u = this.shared;
    if (on !== undefined) u.uCarOn.value = on ? 1 : 0;
    if (fill !== undefined) u.uCarFill.value = fill;
    if (overlap !== undefined) u.uCarOv.value = overlap ? 1 : 0;
    if (app !== undefined) u.uCarApp.value = app ? 1 : 0;
    if (sel !== undefined) u.uCarSel.value = sel;
    if (hover !== undefined) u.uCarHov.value = hover;
    if (dim !== undefined) u.uSelDim.value = dim;
  }
  // área que drena para a propriedade: data = bytes (0/255) de w×h células, linha 0 = a mais ao SUL do retângulo;
  // (i0, j0) = canto noroeste na grade de 30 m (gw×gh). null desliga.
  setUpstream(m) {
    const u = this.shared;
    if (u.uUpMask.value !== this.blank) u.uUpMask.value.dispose();
    u.uUpMask.value = this.blank; u.uUpOn.value = 0;
    if (!m) return;
    const tex = new THREE.DataTexture(m.data, m.w, m.h, THREE.RedFormat, THREE.UnsignedByteType);
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter; tex.unpackAlignment = 1; tex.needsUpdate = true;
    u.uUpMask.value = tex;
    u.uUpRect.value.set(m.i0 / m.gw, 1 - (m.j0 + m.h) / m.gh, m.w / m.gw, m.h / m.gh);
    u.uUpOn.value = 1;
  }
  // propriedade escolhida: contorno rasterizado à parte (o car_id.png põe as menores por cima e furaria as grandes).
  // R = dentro; G = dentro + uma borda que esmaece para fora (até 600 m), para o escurecido não começar seco.
  setCarSelection(rings) {
    const u = this.shared;
    if (u.uSelMask.value !== this.blank) u.uSelMask.value.dispose();
    u.uSelMask.value = this.blank;
    if (!rings) return;
    let s = 90, n = -90, w = 180, e = -180;
    for (const r of rings) for (const [la, lo] of r) { s = Math.min(s, la); n = Math.max(n, la); w = Math.min(w, lo); e = Math.max(e, lo); }
    const kx = 111320 * Math.cos((((n + s) / 2) * Math.PI) / 180), ky = 110574;   // m por grau
    const halo = Math.min(600, Math.max(60, 0.25 * Math.max((e - w) * kx, (n - s) * ky)));
    w -= halo / kx; e += halo / kx; s -= halo / ky; n += halo / ky;
    const mpp = Math.max((e - w) * kx, (n - s) * ky) / 1024;
    const cw = Math.max(8, Math.round(((e - w) * kx) / mpp)), ch = Math.max(8, Math.round(((n - s) * ky) / mpp));
    const cv = document.createElement('canvas');
    cv.width = cw; cv.height = ch;
    const g = cv.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, cw, ch);
    const paths = rings.map((r) => {
      const p = new Path2D();
      r.forEach(([la, lo], i) => p[i ? 'lineTo' : 'moveTo'](((lo - w) / (e - w)) * cw, ((n - la) / (n - s)) * ch));
      p.closePath();
      return p;
    });
    g.globalCompositeOperation = 'lighter';   // os traços somam no verde: 1 na borda → 0 a "halo" metros
    g.lineJoin = 'round';
    const N = 12;
    for (let i = 1; i <= N; i++) {
      g.strokeStyle = `rgba(0,255,0,${1 / N})`; g.lineWidth = (2 * halo * i) / N / mpp;
      for (const p of paths) g.stroke(p);
    }
    g.fillStyle = '#0f0'; for (const p of paths) g.fill(p);
    g.fillStyle = '#f00'; for (const p of paths) g.fill(p);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.NoColorSpace; tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
    u.uSelMask.value = tex;
    const ew = EXTENT.e - EXTENT.w, ns = EXTENT.n - EXTENT.s;
    u.uSelRect.value.set((w - EXTENT.w) / ew, (s - EXTENT.s) / ns, (e - w) / ew, (n - s) / ns);
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
  // relevo com volume sem custo por quadro: "relevo local" = altitude − média dos arredores, em duas escalas
  // (~120 m e ~600 m), calculado uma vez em ~0,1 s. Vales e grotas escurecem, cristas e topos clareiam.
  buildRelief() {
    const hf = this.hf, W = hf.width, H = hf.height, z = hf.data, S = new Float64Array((W + 1) * (H + 1));
    for (let j = 0; j < H; j++) {
      let row = 0;
      for (let i = 0; i < W; i++) { row += z[j * W + i]; S[(j + 1) * (W + 1) + i + 1] = S[j * (W + 1) + i + 1] + row; }
    }
    const mean = (i, j, r) => {
      const i0 = Math.max(0, i - r), i1 = Math.min(W, i + r + 1), j0 = Math.max(0, j - r), j1 = Math.min(H, j + r + 1);
      return (S[j1 * (W + 1) + i1] - S[j0 * (W + 1) + i1] - S[j1 * (W + 1) + i0] + S[j0 * (W + 1) + i0]) / ((i1 - i0) * (j1 - j0));
    };
    const out = new Uint8Array(W * H);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const h = z[j * W + i], s = (h - mean(i, j, 4)) / 22 + (h - mean(i, j, 20)) / 90;
      out[j * W + i] = Math.max(0, Math.min(255, Math.round(128 + 127 * Math.tanh(s))));
    }
    const tex = new THREE.DataTexture(out, W, H, THREE.RedFormat, THREE.UnsignedByteType);
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter; tex.unpackAlignment = 1; tex.needsUpdate = true;
    this.shared.uRel.value?.dispose?.();
    this.shared.uRel.value = tex;
    const g = hf.georef;
    this.shared.uRelX.value = this.#xform({ w: W, h: H, lon0: g.lon0, lat0: g.lat0, d: g.dLon }, false);
  }
  setRelief(k) { this.shared.uRelief.value = k; }
  setFilm(k) { this.shared.uFilm.value = k; }
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
      u.uSol.value = surface === 'sol-inverno' ? 1 : surface === 'sol-verao' ? 2 : 0;
      u.uFrost.value = surface === 'geada' ? 1 : 0;
      u.uVig.value = surface === 'vigor' ? 1 : 0;
      if (surface === 'geada') u.uSat.value = 1;   // a geada é desenhada sobre a imagem
      if (surface === 'sol-inverno') u.uSolR.value.set(1.6, 5.0);
      if (surface === 'sol-verao') u.uSolR.value.set(6.1, 7.4);
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
