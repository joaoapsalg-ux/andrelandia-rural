// HeightField: grade regular de altitudes georreferenciada.
// É o contrato comum entre as fontes de dados (sources/*) e a malha 3D (cellterrain.js).
// Dois tipos de georreferência:
//   { type: 'mercator',   zoom, px0, py0, pxStep }          → pixels Web Mercator (tiles)
//   { type: 'geographic', lon0, lat0, dLon, dLat }          → grade lat/lon (GeoTIFF EPSG:4326)
// Em ambos, (lon0, lat0) / (px0, py0) é o CANTO superior esquerdo do pixel [0,0].
import { tileXToLon, tileYToLat, lonToTileX, latToTileY } from './geo.js';

export class HeightField {
  /**
   * @param {object} o
   * @param {number} o.width, o.height
   * @param {Float32Array} o.data   altitudes (m), linha 0 = norte
   * @param {object} o.georef
   * @param {string} o.label
   */
  constructor(o) {
    Object.assign(this, o);
    let mn = Infinity, mx = -Infinity;
    for (const v of this.data) { if (v < mn) mn = v; if (v > mx) mx = v; }
    this.min = mn; this.max = mx;
  }
  // lat/lon do centro da amostra (i, j)
  latLonAt(i, j) {
    const g = this.georef;
    if (g.type === 'geographic') return { lat: g.lat0 + (j + 0.5) * g.dLat, lon: g.lon0 + (i + 0.5) * g.dLon };
    const z = g.zoom + 8;
    return { lat: tileYToLat(g.py0 + (j + 0.5) * g.pxStep, z), lon: tileXToLon(g.px0 + (i + 0.5) * g.pxStep, z) };
  }
  // índice fracionário da grade (centros) para lat/lon
  gridAt(lat, lon) {
    const g = this.georef;
    if (g.type === 'geographic') return { i: (lon - g.lon0) / g.dLon - 0.5, j: (lat - g.lat0) / g.dLat - 0.5 };
    const z = g.zoom + 8;
    return { i: (lonToTileX(lon, z) - g.px0) / g.pxStep - 0.5, j: (latToTileY(lat, z) - g.py0) / g.pxStep - 0.5 };
  }
  contains(lat, lon) {
    const { i, j } = this.gridAt(lat, lon);
    return i >= 0 && j >= 0 && i <= this.width - 1 && j <= this.height - 1;
  }
  get(i, j) {
    i = Math.max(0, Math.min(this.width - 1, i));
    j = Math.max(0, Math.min(this.height - 1, j));
    return this.data[j * this.width + i];
  }
  // altitude interpolada (bilinear)
  elevation(lat, lon) {
    const { i, j } = this.gridAt(lat, lon);
    const i0 = Math.floor(i), j0 = Math.floor(j), fi = i - i0, fj = j - j0;
    const a = this.get(i0, j0), b = this.get(i0 + 1, j0), c = this.get(i0, j0 + 1), d = this.get(i0 + 1, j0 + 1);
    return (a * (1 - fi) + b * fi) * (1 - fj) + (c * (1 - fi) + d * fi) * fj;
  }
  bounds() {
    const nw = this.latLonAt(-0.5, -0.5), se = this.latLonAt(this.width - 0.5, this.height - 0.5);
    return { north: nw.lat, west: nw.lon, south: se.lat, east: se.lon };
  }
  // espaçamento médio da grade em metros (para exibir)
  spacingMeters() {
    const a = this.latLonAt(0, 0), b = this.latLonAt(1, 1);
    const dy = (a.lat - b.lat) * 110574, dx = (b.lon - a.lon) * 111320 * Math.cos((a.lat * Math.PI) / 180);
    return (Math.abs(dx) + Math.abs(dy)) / 2;
  }
}
