// Utilidades geográficas: Web Mercator (tiles), plano local em metros e UTM (SIRGAS 2000 ≈ WGS84).
const R_EQ = 6378137;

export function tileXToLon(x, z) { return (x / 2 ** z) * 360 - 180; }
export function tileYToLat(y, z) {
  const n = Math.PI * (1 - (2 * y) / 2 ** z);
  return (Math.atan(Math.sinh(n)) * 180) / Math.PI;
}
export function lonToTileX(lon, z) { return ((lon + 180) / 360) * 2 ** z; }
export function latToTileY(lat, z) {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * 2 ** z;
}

// Plano tangente local (x = leste, z = sul, em metros) centrado em `origin`.
// Erro < 0,1 % na área de ~15 km — suficiente aqui; trocar por ENU completo se a área crescer.
export class LocalFrame {
  constructor(lat0, lon0) {
    this.lat0 = lat0; this.lon0 = lon0;
    const φ = (lat0 * Math.PI) / 180;
    this.mPerDegLat = 111132.92 - 559.82 * Math.cos(2 * φ) + 1.175 * Math.cos(4 * φ);
    this.mPerDegLon = 111412.84 * Math.cos(φ) - 93.5 * Math.cos(3 * φ);
  }
  toLocal(lat, lon) {
    return { x: (lon - this.lon0) * this.mPerDegLon, z: -(lat - this.lat0) * this.mPerDegLat };
  }
  toLatLon(x, z) {
    return { lat: this.lat0 - z / this.mPerDegLat, lon: this.lon0 + x / this.mPerDegLon };
  }
}

// Conversão para UTM (fuso calculado), elipsoide GRS80 — mesma grade das cartas IBGE (SIRGAS 2000).
export function toUTM(lat, lon) {
  const a = R_EQ, f = 1 / 298.257222101, k0 = 0.9996;
  const zone = Math.floor((lon + 180) / 6) + 1;
  const λ0 = ((zone - 1) * 6 - 180 + 3) * Math.PI / 180;
  const φ = lat * Math.PI / 180, λ = lon * Math.PI / 180;
  const e2 = f * (2 - f), ep2 = e2 / (1 - e2);
  const N = a / Math.sqrt(1 - e2 * Math.sin(φ) ** 2);
  const T = Math.tan(φ) ** 2, C = ep2 * Math.cos(φ) ** 2, A = Math.cos(φ) * (λ - λ0);
  const M = a * ((1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * φ
    - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * φ)
    + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * φ)
    - (35 * e2 ** 3 / 3072) * Math.sin(6 * φ));
  const E = k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T ** 2 + 72 * C - 58 * ep2) * A ** 5 / 120) + 500000;
  let Nn = k0 * (M + N * Math.tan(φ) * (A ** 2 / 2 + (5 - T + 9 * C + 4 * C ** 2) * A ** 4 / 24
    + (61 - 58 * T + T ** 2 + 600 * C - 330 * ep2) * A ** 6 / 720));
  if (lat < 0) Nn += 10000000;
  return { zone, hemi: lat < 0 ? 'S' : 'N', E, N: Nn };
}
