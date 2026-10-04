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
  const day = smooth(-2, 12, el), gold = 1 - smooth(2, 22, el), night = 1 - smooth(-12, -2, el);
  const zenithDay = mixc('#5b8fc9', '#4a6fa5', gold * 0.6);
  const horizonDay = mixc('#d3e2ec', '#f3c89a', gold);
  const zenith = mixc(zenithDay, '#0d1730', night);
  const horizon = mixc(horizonDay, '#26324d', night);
  const sunColor = mixc('#fff4e4', '#ffae66', gold);
  return {
    zenith, horizon, sunColor,
    intensity: 0.85 * day,
    ambient: 0.22 + 0.24 * smooth(-10, 15, el),
    elevation: el,
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
    };
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(140000, 32, 16), new THREE.ShaderMaterial({
      uniforms: this.uniforms, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: /* glsl */ `varying vec3 vDir;
        void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `uniform vec3 uZenith, uHorizon, uSunDir, uSunCol; uniform float uSunUp; varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float h = clamp(d.y, 0.0, 1.0);
          vec3 col = mix(uHorizon, uZenith, pow(h, 0.55));
          col = mix(col, uHorizon * 1.04, (1.0 - smoothstep(0.0, 0.06, h)) * 0.6);   // faixa clara no horizonte
          float s = max(dot(d, normalize(uSunDir)), 0.0);
          col += uSunCol * (pow(s, 900.0) * 1.2 + pow(s, 24.0) * 0.22 + pow(s, 4.0) * 0.08) * uSunUp;
          gl_FragColor = vec4(col, 1.0);
        }`,
    }));
    this.mesh.renderOrder = -10; this.mesh.frustumCulled = false;
  }
  set(state, dir) {
    const u = this.uniforms;
    u.uZenith.value.copy(state.zenith); u.uHorizon.value.copy(state.horizon);
    u.uSunDir.value.copy(dir); u.uSunCol.value.copy(state.sunColor); u.uSunUp.value = Math.min(1, Math.max(0, (state.elevation + 3) / 6));
  }
  follow(camera) { this.mesh.position.copy(camera.position); }
}

const DIRS = ['norte', 'nordeste', 'leste', 'sudeste', 'sul', 'sudoeste', 'oeste', 'noroeste'];
export const compassName = (az) => DIRS[Math.round(az / 45) % 8];
