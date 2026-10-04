// Posição do sol (aproximação NOAA, erro < 0,5°) e cores do céu/luz conforme a altura do sol.
import * as THREE from 'three';

const RAD = Math.PI / 180;

/** @returns {{ azimuth: number, elevation: number }} graus; azimute a partir do norte, sentido horário */
export function sunPosition(date, lat, lon) {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const n = jd - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * RAD;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const eps = (23.439 - 0.0000004 * n) * RAD;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const gmst = (18.697374558 + 24.06570982441908 * n) % 24;
  const ha = ((gmst * 15 + lon) * RAD - ra);
  const phi = lat * RAD;
  const el = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(ha));
  let az = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(ha));
  az = (az / RAD + 360) % 360;
  return { azimuth: az, elevation: el / RAD };
}

/** direção do sol no plano local (x leste, y cima, z sul) */
export function sunDirection({ azimuth, elevation }) {
  const a = azimuth * RAD, e = elevation * RAD;
  return new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)).normalize();
}

const mixc = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), Math.min(1, Math.max(0, t)));
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** cores do céu, da luz e intensidades para uma elevação solar (graus) */
export function skyState(el) {
  const day = smooth(-2, 12, el), gold = 1 - smooth(1, 20, el), night = 1 - smooth(-12, -2, el);
  // hora mágica: horizonte laranja, zênite puxando para o violeta, sol cor de brasa
  const zenithDay = mixc('#5b8fc9', '#5c62a6', gold * 0.75);
  const horizonDay = mixc('#d3e2ec', '#f2b07a', gold * 0.8);
  const zenith = mixc(zenithDay, '#0a1228', night);
  const horizon = mixc(horizonDay, '#1f2a44', night);
  const sunColor = mixc('#fff4e4', '#ff8a45', gold);
  return {
    zenith, horizon, sunColor,
    intensity: 0.85 * day * (1 + 0.2 * gold),
    ambient: 0.22 + 0.24 * smooth(-10, 15, el),
    elevation: el,
    gold: gold * smooth(-3, 3, el),   // 0 de dia alto e de noite, 1 com o sol rente ao horizonte
    night,
  };
}

/** textura de fundo em gradiente (horizonte → zênite) */
export function skyTexture(state, prev) {
  const cv = prev?.image ?? document.createElement('canvas');
  cv.width = 4; cv.height = 256;
  const ctx = cv.getContext('2d');
  const gr = ctx.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, `#${state.zenith.getHexString()}`);
  gr.addColorStop(0.62, `#${state.horizon.getHexString()}`);
  gr.addColorStop(1, `#${state.horizon.getHexString()}`);
  ctx.fillStyle = gr; ctx.fillRect(0, 0, 4, 256);
  const tex = prev ?? new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** cúpula do céu: degradê pela altura do olhar (não pela tela), brilho em volta do sol e névoa clara no horizonte */
export class SkyDome {
  constructor() {
    this.uniforms = {
      uZenith: { value: new THREE.Color('#5b8fc9') }, uHorizon: { value: new THREE.Color('#d3e2ec') },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color('#fff4e4') }, uSunUp: { value: 1 },
      uCloudTex: { value: null }, uClouds: { value: 0 }, uTime: { value: 0 }, uNight: { value: 0 }, uGold: { value: 0 },
    };
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(140000, 32, 16), new THREE.ShaderMaterial({
      uniforms: this.uniforms, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: /* glsl */ `varying vec3 vDir;
        void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `uniform vec3 uZenith, uHorizon, uSunDir, uSunCol; uniform float uSunUp, uClouds, uTime, uNight, uGold; uniform sampler2D uCloudTex; varying vec3 vDir;
        float hash3(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
        // estrelas: uma por célula de uma grade em volta da cúpula, poucas acesas, cintilando
        float stars(vec3 d, float n, float keep, float r) {
          vec3 q = d * n, c = floor(q), f = fract(q) - 0.5;
          float h = hash3(c);
          if (h < keep) return 0.0;
          float tw = 0.75 + 0.25 * sin(uTime * (1.5 + 3.0 * hash3(c + 7.0)) + h * 40.0);
          return smoothstep(r, 0.0, length(f)) * (0.4 + 0.6 * hash3(c + 3.0)) * tw;
        }
        void main() {
          vec3 d = normalize(vDir);
          float h = clamp(d.y, 0.0, 1.0);
          vec3 col = mix(uHorizon, uZenith, pow(h, 0.55));
          col = mix(col, uHorizon * 1.04, (1.0 - smoothstep(0.0, 0.06, h)) * 0.6);   // faixa clara no horizonte
          // abaixo do horizonte (visto de cima, em volta da maquete): névoa um pouco mais escura, dá fundo ao mapa
          col = mix(col, uHorizon * vec3(0.74, 0.77, 0.80), smoothstep(0.0, -0.5, d.y) * 0.85);
          float s = max(dot(d, normalize(uSunDir)), 0.0);
          if (uNight > 0.0 && d.y > 0.0) {   // noite: estrelas e a Via Láctea (faixa de ruído ao longo de um grande círculo)
            float vis = uNight * smoothstep(0.0, 0.18, d.y);
            float st = stars(d, 260.0, 0.982, 0.32) + stars(d, 110.0, 0.993, 0.22) * 1.6;
            float band = exp(-pow(dot(d, normalize(vec3(0.45, 0.35, -0.82))), 2.0) * 26.0);
            float mw = band * (0.5 + texture2D(uCloudTex, d.xz * 1.7 + 0.2).r) * 0.07;
            col += (vec3(0.92, 0.95, 1.0) * st + vec3(0.62, 0.68, 0.85) * mw) * vis;
          }
          if (uClouds > 0.0 && d.y > 0.0) {   // nuvens: o mesmo ruído das sombras no chão, numa camada plana no alto
            vec2 p = d.xz / (d.y + 0.12) * 0.32 + vec2(uTime * 0.0035, uTime * 0.0012);
            float c = texture2D(uCloudTex, p).r * 0.65 + texture2D(uCloudTex, p * 2.6 + 0.31).r * 0.35;
            float a = smoothstep(0.5, 0.8, c) * smoothstep(0.0, 0.22, d.y) * uClouds;
            vec3 cc = mix(uHorizon, vec3(1.0), 0.6) * (0.35 + 0.65 * uSunUp) + uSunCol * pow(s, 6.0) * 0.35 * uSunUp;
            cc *= 0.88 + 0.12 * smoothstep(0.55, 0.8, c);   // miolo mais claro
            col = mix(col, cc, a * 0.8);
          }
          col += uSunCol * (pow(s, 900.0) * 1.2 + pow(s, 24.0) * (0.22 + 0.25 * uGold) + pow(s, 4.0) * (0.08 + 0.22 * uGold)) * uSunUp;
          // hora mágica: o horizonte do lado do sol pega fogo
          col += uSunCol * uGold * 0.22 * pow(max(dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(uSunDir.x, 0.0, uSunDir.z))), 0.0), 3.0) * (1.0 - smoothstep(0.0, 0.35, abs(d.y)));
          gl_FragColor = vec4(col, 1.0);
        }`,
    }));
    this.mesh.renderOrder = -10; this.mesh.frustumCulled = false;
  }
  set(state, dir) {
    const u = this.uniforms;
    u.uZenith.value.copy(state.zenith); u.uHorizon.value.copy(state.horizon);
    u.uSunDir.value.copy(dir); u.uSunCol.value.copy(state.sunColor); u.uSunUp.value = Math.min(1, Math.max(0, (state.elevation + 3) / 6));
    u.uNight.value = state.night ?? 0; u.uGold.value = state.gold ?? 0;
  }
  setClouds(tex, v) { this.uniforms.uCloudTex.value = tex; this.uniforms.uClouds.value = v; }
  follow(camera) { this.mesh.position.copy(camera.position); this.uniforms.uTime.value = (performance.now() / 1000) % 100000; }
}

const DIRS = ['norte', 'nordeste', 'leste', 'sudeste', 'sul', 'sudoeste', 'oeste', 'noroeste'];
export const compassName = (az) => DIRS[Math.round(az / 45) % 8];
