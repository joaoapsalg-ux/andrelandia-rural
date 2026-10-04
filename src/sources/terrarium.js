// Fonte de tiles Terrarium (PNG RGB → altitude = R·256 + G + B/256 − 32768).
// Use quando o app rodar fora do claude.ai (servidor próprio ou localhost), onde é possível
// buscar tiles externos. Zooms 14–15 dão ~9 m/px de grade (o dado de origem é ~30 m;
// para ganho real de detalhe, troque `urlTemplate` por um MDE melhor, p.ex. o do IBGE/IDE-Sisema).
import { HeightField } from '../heightfield.js';
import { lonToTileX, latToTileY } from '../geo.js';

export const AWS_TERRARIUM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

export async function loadTerrarium({ bounds, zoom = 14, step = 1, urlTemplate = AWS_TERRARIUM }) {
  const x0 = Math.floor(lonToTileX(bounds.west, zoom)), x1 = Math.floor(lonToTileX(bounds.east, zoom));
  const y0 = Math.floor(latToTileY(bounds.north, zoom)), y1 = Math.floor(latToTileY(bounds.south, zoom));
  const nx = x1 - x0 + 1, ny = y1 - y0 + 1;
  const canvas = new OffscreenCanvas(nx * 256, ny * 256);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  await Promise.all(
    Array.from({ length: nx * ny }, async (_, k) => {
      const x = x0 + (k % nx), y = y0 + Math.floor(k / nx);
      const url = urlTemplate.replace('{z}', zoom).replace('{x}', x).replace('{y}', y);
      const blob = await (await fetch(url)).blob();
      const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
      ctx.drawImage(bmp, (x - x0) * 256, (y - y0) * 256);
    })
  );
  const px = ctx.getImageData(0, 0, nx * 256, ny * 256).data;
  const W = Math.floor((nx * 256) / step), H = Math.floor((ny * 256) / step);
  const data = new Float32Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const o = ((j * step) * nx * 256 + i * step) * 4;
    data[j * W + i] = px[o] * 256 + px[o + 1] + px[o + 2] / 256 - 32768;
  }
  return new HeightField({
    width: W, height: H, data,
    georef: { type: 'mercator', zoom, px0: x0 * 256, py0: y0 * 256, pxStep: step },
    label: `Terrarium z${zoom} · passo ${step} px`,
  });
}
