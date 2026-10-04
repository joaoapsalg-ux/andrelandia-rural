"""Rasters e números do app rural (tudo a partir do ANADEM 30 m e do MapBiomas 30 m já no projeto).

Saídas
  data/muni/layers/fdir.png     direção do escoamento D8 (0 = sem saída, 1–8 = vizinho em N8), para a "gota de chuva"
  data/muni/layers/solgeada.png R = sol direto no inverno (21/jun), G = no verão (21/dez), em kWh/m²/dia × 25
                                B = índice ilustrativo de geada (0–255)
  data/muni/layers/car.json     acrescenta em "s": sol [inv kWh, ver kWh, inv h, ver h], gea (% em baixada fria),
                                hist (6 anos × 6 grupos de uso, %); remove as rotas (dado pessoal)
  data/muni/landuse/hist.json   mesma história para o município inteiro
Sol: céu limpo (Meinel), feixe direto sobre a encosta, com sombra do horizonte (32 direções, até 12 km).
Geada: ar frio escorre e se acumula nas baixadas planas — posição relativa no relevo (500 m e 2 km),
declividade e altitude. É um mapa ilustrativo, não uma previsão.
Depois de rodar, rode tools/build_landuse41.py (histórico de 41 anos substitui o de 6 anos gravado aqui).
Uso: python3 tools/build_rural.py
"""
import heapq, json, math, time
import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import uniform_filter

T0 = time.time()
def log(*a): print(f'[{time.time() - T0:6.1f}s]', *a, flush=True)

L = 'data/muni/layers/'
G = dict(w=1671, h=1522, lon0=-44.510264686724526, lat0=-21.529922414492574, d=0.00026949458523585647)
LAT = -21.735
DX = G['d'] * 111320 * math.cos(math.radians(LAT)); DY = G['d'] * 110574
px = np.asarray(Image.open('data/muni/dem/anadem.png')).astype(np.float64)
z = px[..., 0] * 256 + px[..., 1] + px[..., 2] / 256 - 32768
H, W = z.shape
N8 = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]

# ---------------- direção do escoamento (igual a derive_drainage.py) ----------------
filled = z.copy(); closed = np.zeros_like(z, bool); pq = []
for j in range(H):
    for i in (0, W - 1):
        heapq.heappush(pq, (filled[j, i], j, i)); closed[j, i] = True
for i in range(1, W - 1):
    for j in (0, H - 1):
        heapq.heappush(pq, (filled[j, i], j, i)); closed[j, i] = True
while pq:
    e, j, i = heapq.heappop(pq)
    for dj, di in N8:
        jj, ii = j + dj, i + di
        if 0 <= jj < H and 0 <= ii < W and not closed[jj, ii]:
            closed[jj, ii] = True
            if filled[jj, ii] <= e: filled[jj, ii] = e + 1e-3
            heapq.heappush(pq, (filled[jj, ii], jj, ii))
pad = np.pad(filled, 1, mode='constant', constant_values=np.inf)
best = np.zeros((H, W)); code = np.zeros((H, W), np.uint8)
for n, (dj, di) in enumerate(N8):
    nb = pad[1 + dj:1 + dj + H, 1 + di:1 + di + W]
    s_ = (filled - nb) / math.hypot(di * DX, dj * DY)
    upd = s_ > best
    best[upd] = s_[upd]; code[upd] = n + 1
# bordas: deixa sair do mapa
Image.fromarray(code).save(L + 'fdir.png', optimize=True)
log('fdir.png', (code == 0).sum(), 'células sem saída')

# ---------------- sol ----------------
gy, gx = np.gradient(z, DY, DX)          # gy: derivada para o sul (linhas crescem para o sul)
# normal (leste, norte, cima) = (-dz/dx, +dz/dy_sul... ) → dz/dnorte = -gy
nE, nN, nU = -gx, gy, np.ones_like(z)
nl = np.sqrt(nE ** 2 + nN ** 2 + 1); nE /= nl; nN /= nl; nU /= nl
NAZ = 32
dists = [30.0]
while dists[-1] < 12000: dists.append(dists[-1] * 1.12)
hor = np.full((NAZ, H, W), -1.0, np.float32)   # tangente do ângulo do horizonte
for a in range(NAZ):
    az = 2 * math.pi * a / NAZ                   # 0 = norte, horário
    for d in dists:
        oi = int(round(d * math.sin(az) / DX)); oj = int(round(-d * math.cos(az) / DY))
        if abs(oi) >= W or abs(oj) >= H: continue
        src = z[max(oj, 0):H + min(oj, 0), max(oi, 0):W + min(oi, 0)]
        dst = (slice(max(-oj, 0), H + min(-oj, 0)), slice(max(-oi, 0), W + min(-oi, 0)))
        t = ((src - z[dst]) / d).astype(np.float32)
        np.maximum(hor[a][dst], t, out=hor[a][dst])
log('horizonte em', NAZ, 'direções')


def sun_day(decl_deg):
    """energia direta (kWh/m²) e horas de sol direto no dia, céu limpo"""
    phi, dec = math.radians(LAT), math.radians(decl_deg)
    E = np.zeros((H, W), np.float32); hrs = np.zeros((H, W), np.float32)
    step_h = 5 / 60
    for k in range(int(24 / step_h)):
        hra = math.radians(15 * (k * step_h + step_h / 2 - 12))
        sin_el = math.sin(phi) * math.sin(dec) + math.cos(phi) * math.cos(dec) * math.cos(hra)
        if sin_el <= 0.01: continue
        el = math.asin(sin_el)
        cos_az = (math.sin(dec) - sin_el * math.sin(phi)) / (math.cos(el) * math.cos(phi))
        az = math.acos(max(-1, min(1, cos_az)))
        if hra > 0: az = 2 * math.pi - az       # tarde: oeste
        am = 1 / (sin_el + 0.50572 * (math.degrees(el) + 6.07995) ** -1.6364)
        I0 = 1361 * 0.7 ** (am ** 0.678)
        sE, sN, sU = math.cos(el) * math.sin(az), math.cos(el) * math.cos(az), sin_el
        f = az / (2 * math.pi) * NAZ
        a0 = int(f) % NAZ; a1 = (a0 + 1) % NAZ; w1 = f - int(f)
        hz = hor[a0] * (1 - w1) + hor[a1] * w1
        lit = (math.tan(el) > hz)
        inc = np.clip(nE * sE + nN * sN + nU * sU, 0, None) * lit
        E += (I0 * inc * step_h / 1000).astype(np.float32)
        hrs += (lit & (inc > 0)) * step_h
    return E, hrs


Ew, Hw = sun_day(23.44)     # 21 de junho
Es, Hs = sun_day(-23.44)    # 21 de dezembro
log('sol: inverno %.2f–%.2f kWh, verão %.2f–%.2f kWh' % (np.percentile(Ew, 1), np.percentile(Ew, 99), np.percentile(Es, 1), np.percentile(Es, 99)))
del hor

# ---------------- geada (ilustrativo) ----------------
cell = (DX + DY) / 2
tpi_s = z - uniform_filter(z, size=int(500 * 2 / cell) | 1)
tpi_l = z - uniform_filter(z, size=int(2000 * 2 / cell) | 1)
slope = np.degrees(np.arctan(np.hypot(gx, gy)))
low = 1 / (1 + np.exp((0.55 * tpi_s + 0.45 * tpi_l + 12) / 9))      # baixadas → 1
flat = 1 - np.clip((slope - 4) / 14, 0, 1)
alt = np.clip((z - 950) / 500, 0, 1)
frost = np.clip(0.75 * low * (0.45 + 0.55 * flat) + 0.25 * alt, 0, 1)
log('geada: p50 %.2f p90 %.2f p99 %.2f' % tuple(np.percentile(frost, [50, 90, 99])))

img = np.dstack([np.clip(Ew * 25, 0, 255), np.clip(Es * 25, 0, 255), frost * 255]).round().astype(np.uint8)
Image.fromarray(img).save(L + 'solgeada.png', optimize=True)
log('solgeada.png')

# ---------------- histórico do uso do solo ----------------
YEARS = [1985, 1995, 2005, 2015, 2020, 2025]
GROUPS = [[3, 4], [11, 12], [15], [19, 41, 36, 46, 47, 48, 21], [9]]   # o resto = outros
lc = {y: np.array(Image.open(f'data/muni/landuse/lc30_{y}.png')) for y in YEARS}
gid = np.full(256, 5, np.uint8)
for g, cl in enumerate(GROUPS): gid[cl] = g
lg = {y: gid[lc[y]] for y in YEARS}


def hist_of(mask):
    n = mask.sum()
    if not n: return None
    return [[round(100 * float(c) / n, 1) for c in np.bincount(lg[y][mask], minlength=6)[:6]] for y in YEARS]


ring = json.load(open(L + 'boundary.json'))['ring']
to_px = lambda la, lo: ((lo - G['lon0']) / G['d'], (G['lat0'] - la) / G['d'])
bi = Image.new('1', (W, H), 0); ImageDraw.Draw(bi).polygon([to_px(la, lo) for la, lo in ring], fill=1)
muni = np.array(bi, bool)
json.dump({'years': YEARS, 'groups': ['Mata', 'Campo nativo', 'Pastagem', 'Lavoura e mosaico', 'Eucalipto', 'Outros'],
           'muni': hist_of(muni),
           'sol': [round(float(Ew[muni].mean()), 2), round(float(Es[muni].mean()), 2)]},
          open('data/muni/landuse/hist.json', 'w'), separators=(',', ':'))
log('hist município', hist_of(muni)[0], '→', hist_of(muni)[-1])

# ---------------- por imóvel ----------------
car = json.load(open(L + 'car.json'))
for f in car['features']:
    s = f.get('s')
    if not s: continue
    s.pop('sv', None)
    im = Image.new('1', (W, H), 0); dr = ImageDraw.Draw(im)
    xs = [lo for r in f['rings'] for la, lo in r]; ys = [la for r in f['rings'] for la, lo in r]
    x0 = max(int(to_px(0, min(xs))[0]) - 1, 0); x1 = min(int(to_px(0, max(xs))[0]) + 2, W)
    y0 = max(int(to_px(max(ys), 0)[1]) - 1, 0); y1 = min(int(to_px(min(ys), 0)[1]) + 2, H)
    if x1 <= x0 or y1 <= y0: continue
    im = Image.new('1', (x1 - x0, y1 - y0), 0); dr = ImageDraw.Draw(im)
    for r in f['rings']: dr.polygon([(a - x0, b - y0) for a, b in (to_px(la, lo) for la, lo in r)], fill=1)
    m = np.array(im, bool)
    if m.sum() == 0:    # imóvel menor que um pixel: usa o pixel do centro
        cy, cx = (y1 - y0) // 2, (x1 - x0) // 2; m[min(cy, m.shape[0] - 1), min(cx, m.shape[1] - 1)] = True
    sl = (slice(y0, y1), slice(x0, x1))
    s['sol'] = [round(float(Ew[sl][m].mean()), 2), round(float(Es[sl][m].mean()), 2), round(float(Hw[sl][m].mean()), 1), round(float(Hs[sl][m].mean()), 1)]
    s['gea'] = round(100 * float((frost[sl][m] > 0.55).mean()), 1)
    n = m.sum()
    s['hist'] = [[round(100 * float(c) / n, 1) for c in np.bincount(lg[y][sl][m], minlength=6)[:6]] for y in YEARS]
car['hist_groups'] = ['Mata', 'Campo nativo', 'Pastagem', 'Lavoura e mosaico', 'Eucalipto', 'Outros']
car['hist_years'] = YEARS
json.dump(car, open(L + 'car.json', 'w'), separators=(',', ':'), ensure_ascii=False)
log('car.json atualizado')
