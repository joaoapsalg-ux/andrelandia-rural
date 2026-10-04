"""Altura da vegetação (modelo de copas) = Copernicus GLO-30 (superfície) − ANADEM (terreno).

As duas grades são reamostradas na extensão exata do município (data/muni/grid.js),
o ruído do radar é atenuado (mediana 3×3) e valores < 2,5 m viram 0.
Saída: data/muni/layers/canopy.png — cinza 8 bits, altura (m) = valor / 6 (até 42,5 m).
Uso: python3 tools/build_canopy.py
"""
import numpy as np
from PIL import Image
from scipy.ndimage import map_coordinates, median_filter

EXT = dict(w=-44.51, e=-44.06, n=-21.53, s=-21.94)
W, H = 1670, 1521


def load(path, w, h):
    px = np.asarray(Image.open(path)).astype(np.float64)
    return (px[..., 0] * 256 + px[..., 1] + px[..., 2] / 256 - 32768).reshape(h, w)


def resample(z, lon0, lat0, dlon, dlat):
    """z em grade com canto (lon0, lat0) → centros da grade de saída"""
    lon = EXT['w'] + (np.arange(W) + 0.5) * (EXT['e'] - EXT['w']) / W
    lat = EXT['n'] - (np.arange(H) + 0.5) * (EXT['n'] - EXT['s']) / H
    LON, LAT = np.meshgrid(lon, lat)
    i = (LON - lon0) / dlon - 0.5
    j = (LAT - lat0) / dlat - 0.5
    return map_coordinates(z, [j, i], order=1, mode='nearest')


ana = resample(load('data/muni/dem/anadem.png', 1671, 1522), -44.510264686724526, -21.529922414492574, 0.00026949458523585647, -0.00026949458523585647)
cop = resample(load('data/muni/dem/copernicus.png', 1620, 1477), -44.51 - 1 / 7200, -21.53 + 1 / 7200, 1 / 3600, -1 / 3600)
chm = median_filter(np.clip(cop - ana, 0, 42.5), size=3)
chm[chm < 2.5] = 0
Image.fromarray(np.round(chm * 6).astype(np.uint8), 'L').save('data/muni/layers/canopy.png', optimize=True)
cov = (chm > 5).mean()
print('copas > 5 m: %.1f%% da extensão; p95 = %.1f m; máx = %.1f m' % (cov * 100, np.percentile(chm[chm > 0], 95), chm.max()))
