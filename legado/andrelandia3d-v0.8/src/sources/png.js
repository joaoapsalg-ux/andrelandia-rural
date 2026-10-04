// Fonte PNG: grade de altitudes codificada como os tiles Terrarium
//   altitude (m) = R·256 + G + B/256 − 32768   (precisão de 1/256 m ≈ 4 mm)
// É o formato usado para qualquer MDE recortado fora do app (GeoTIFF → PNG + georef em data/muni/models.js).
// PNG é compacto, sem perdas e servido por qualquer hospedagem.
import { HeightField } from '../heightfield.js';

export async function loadPNG(model) {
  const res = await fetch(model.url);
  if (!res.ok) throw new Error(`Falha ao carregar ${model.url} (${res.status})`);
  const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const { width: w, height: h } = bmp;
  if (w !== model.width || h !== model.height) throw new Error(`Tamanho inesperado em ${model.url}`);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  const px = ctx.getImageData(0, 0, w, h).data;
  const data = new Float32Array(w * h);
  for (let k = 0; k < w * h; k++) data[k] = px[k * 4] * 256 + px[k * 4 + 1] + px[k * 4 + 2] / 256 - 32768;
  return new HeightField({ width: w, height: h, data, georef: model.georef, label: model.source });
}
