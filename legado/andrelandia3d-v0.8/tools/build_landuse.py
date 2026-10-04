"""Uso e cobertura do solo — MapBiomas Coleção 11 (30 m, 1985–2025) e Coleção 4 10 m (2025).

Entradas: recortes .bin.gz (uint8, códigos de classe) baixados do bucket público do MapBiomas.
Saídas (data/muni/landuse/):
  lc30_{ano}.png, lc10_2025.png   códigos de classe em cinza 8 bits (sem perdas)
  stats.json                      área (km²) por classe dentro do município, por ano
Uso: python3 tools/build_landuse.py
"""
import gzip, json, math
import numpy as np
from PIL import Image, ImageDraw
import os
RAW = os.environ.get('ANDRELANDIA_RAW', os.path.join(os.path.expanduser('~'), 'Downloads')) + os.sep   # arquivos brutos baixados

UP = RAW
G30 = dict(w=1671, h=1522, lon0=-44.51026468672453, lat0=-21.529922414492574, d=0.00026949458523585647)
G10 = dict(w=5011, h=4565, lon0=-44.51008502366769, lat0=-21.52992241449257, d=0.00008983152841195215)
YEARS = [1985, 1995, 2005, 2015, 2020, 2025]
ring = json.load(open('data/muni/layers/boundary.json'))['ring']


def mask(g):
    im = Image.new('L', (g['w'], g['h']), 0)
    pts = [((lon - g['lon0']) / g['d'], (g['lat0'] - lat) / g['d']) for lat, lon in ring]
    ImageDraw.Draw(im).polygon(pts, fill=1)
    return np.asarray(im).astype(bool)


def pixel_km2(g):
    lat = g['lat0'] - (np.arange(g['h']) + 0.5) * g['d']
    return (g['d'] * 111.320 * np.cos(np.radians(lat)) * g['d'] * 110.574)[:, None]  # km² por linha


stats = {}
for res, g, files in [('30m', G30, [(y, f'municipio_mapbiomas30m_{y}.bin.gz') for y in YEARS]),
                      ('10m', G10, [(2025, 'municipio_mapbiomas10m_2025.bin.gz')])]:
    m = mask(g); pa = np.broadcast_to(pixel_km2(g), (g['h'], g['w']))
    for y, fn in files:
        a = np.frombuffer(gzip.decompress(open(UP + fn, 'rb').read()), np.uint8).reshape(g['h'], g['w'])
        Image.fromarray(a, 'L').save(f'data/muni/landuse/lc{res[:2]}_{y}.png', optimize=True)
        s = {}
        for c in np.unique(a[m]):
            s[int(c)] = round(float(pa[m & (a == c)].sum()), 2)
        stats[f'{res}_{y}'] = s
        print(res, y, 'total %.1f km²' % sum(s.values()), sorted(s.items(), key=lambda kv: -kv[1])[:5])
json.dump(stats, open('data/muni/landuse/stats.json', 'w'), indent=1)
