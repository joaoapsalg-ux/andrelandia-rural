"""MapBiomas Coleção 11, 41 anos (1985–2025), para a máquina do tempo.

Entrada: municipio_mapbiomas30m_1985-2025.bin.gz — 41 recortes uint8 (1522 × 1671, grade do ANADEM) empilhados,
lidos dos COGs públicos gs://mapbiomas-public/initiatives/brasil/collection11/lulc/coverage/brazil_coverage/
brazil_coverage-col11_{ano}.tif (janela x0 = 109504, y0 = 100013).
Saídas:
  data/muni/landuse/lc30_{ano}.png   41 anos
  data/muni/landuse/hist.json        % de cada grupo de uso no município, ano a ano (mantém "sol")
  data/muni/layers/car_hist.json     por propriedade (índice do car.json): 41 × 6 valores 0–100 em base64
  data/muni/layers/car.json          tira o "hist" de 6 anos e grava hist_years
Uso: python3 tools/build_landuse41.py
"""
import base64, gzip, json
import numpy as np
from PIL import Image, ImageDraw
import os
RAW = os.environ.get('ANDRELANDIA_RAW', os.path.join(os.path.expanduser('~'), 'Downloads')) + os.sep   # arquivos brutos baixados

SRC = RAW + 'municipio_mapbiomas30m_1985-2025.bin.gz'
G = dict(w=1671, h=1522, lon0=-44.510264686724526, lat0=-21.529922414492574, d=0.00026949458523585647)
YEARS = list(range(1985, 2026))
GROUPS = [[3, 4], [11, 12], [15], [19, 41, 36, 46, 47, 48, 21], [9]]
NAMES = ['Mata', 'Campo nativo', 'Pastagem', 'Lavoura e mosaico', 'Eucalipto', 'Outros']

stack = np.frombuffer(gzip.decompress(open(SRC, 'rb').read()), np.uint8).reshape(len(YEARS), G['h'], G['w'])
for k, y in enumerate(YEARS):
    Image.fromarray(stack[k], 'L').save(f'data/muni/landuse/lc30_{y}.png', optimize=True)
print('PNGs', len(YEARS))

gid = np.full(256, 5, np.uint8)
for g, cl in enumerate(GROUPS): gid[cl] = g
grp = gid[stack]                                   # (41, h, w)
to_px = lambda la, lo: ((lo - G['lon0']) / G['d'], (G['lat0'] - la) / G['d'])


def shares(sel):   # sel: (41, n) grupos dos pixels → (41, 6) em %
    n = sel.shape[1]
    return np.stack([np.bincount(row, minlength=6)[:6] for row in sel]) * 100.0 / n


ring = json.load(open('data/muni/layers/boundary.json'))['ring']
bi = Image.new('1', (G['w'], G['h']), 0); ImageDraw.Draw(bi).polygon([to_px(la, lo) for la, lo in ring], fill=1)
muni = np.array(bi, bool)
hist = json.load(open('data/muni/landuse/hist.json'))
hist.update(years=YEARS, groups=NAMES, muni=np.round(shares(grp[:, muni]), 1).tolist())
json.dump(hist, open('data/muni/landuse/hist.json', 'w'), separators=(',', ':'))
print('município 1985', hist['muni'][0], '2025', hist['muni'][-1])

car = json.load(open('data/muni/layers/car.json'))
out = []
for f in car['features']:
    s = f.get('s')
    if s: s.pop('hist', None)
    if not s:
        out.append(None); continue
    xs = [lo for r in f['rings'] for la, lo in r]; ys = [la for r in f['rings'] for la, lo in r]
    x0 = max(int(to_px(0, min(xs))[0]) - 1, 0); x1 = min(int(to_px(0, max(xs))[0]) + 2, G['w'])
    y0 = max(int(to_px(max(ys), 0)[1]) - 1, 0); y1 = min(int(to_px(min(ys), 0)[1]) + 2, G['h'])
    if x1 <= x0 or y1 <= y0:
        out.append(None); continue
    im = Image.new('1', (x1 - x0, y1 - y0), 0); dr = ImageDraw.Draw(im)
    for r in f['rings']: dr.polygon([(a - x0, b - y0) for a, b in (to_px(la, lo) for la, lo in r)], fill=1)
    m = np.array(im, bool)
    if not m.any(): m[m.shape[0] // 2, m.shape[1] // 2] = True
    v = np.round(shares(grp[:, y0:y1, x0:x1][:, m])).astype(np.uint8)
    out.append(base64.b64encode(v.tobytes()).decode())
car['hist_years'] = YEARS; car['hist_groups'] = NAMES
json.dump(car, open('data/muni/layers/car.json', 'w'), separators=(',', ':'), ensure_ascii=False)
json.dump({'years': YEARS, 'groups': NAMES, 'h': out}, open('data/muni/layers/car_hist.json', 'w'), separators=(',', ':'))
print('car_hist', sum(x is not None for x in out), 'propriedades')
