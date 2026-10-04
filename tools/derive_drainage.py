"""Deriva a rede de drenagem a partir do ANADEM (MDT 30 m).

Passos: preenchimento de depressões (priority-flood com epsilon) → direção de fluxo D8 →
área de contribuição → canais onde a área ≥ LIMIAR → ordem de Strahler → polilinhas lat/lon.

Uso: python3 tools/derive_drainage.py [local|municipio]
"""
import heapq, json, math
import numpy as np
from PIL import Image

PRESETS = {
    'local': dict(png='data/dem/anadem.png', out='data/layers/drainage.json',
                  lon0=-44.38494970458985, lat0=-21.698087035679748,
                  dlon=0.00026949458523585647, dlat=-0.00026949458523585647, area=0.12),
    'municipio': dict(png='data/muni/dem/anadem.png', out='data/muni/layers/drainage.json',
                      lon0=-44.510264686724526, lat0=-21.529922414492574,
                      dlon=0.00026949458523585647, dlat=-0.00026949458523585647, area=0.15),
}
import sys
MODEL = PRESETS[sys.argv[1] if len(sys.argv) > 1 else 'local']
AREA_MIN_KM2 = MODEL['area']  # área de contribuição mínima para virar canal (~1ª ordem)

px = np.asarray(Image.open(MODEL['png'])).astype(np.float64)
z = px[..., 0] * 256 + px[..., 1] + px[..., 2] / 256 - 32768
h, w = z.shape
lat_c = MODEL['lat0'] + (np.arange(h) + 0.5) * MODEL['dlat']
cell_km2 = (abs(MODEL['dlat']) * 110.574) * (MODEL['dlon'] * 111.320 * math.cos(math.radians(lat_c.mean())))

# --- priority-flood (Barnes et al. 2014) com epsilon para garantir escoamento ---
filled = z.copy()
closed = np.zeros_like(z, bool)
pq = []
for j in range(h):
    for i in range(w):
        if i in (0, w - 1) or j in (0, h - 1):
            heapq.heappush(pq, (filled[j, i], j, i)); closed[j, i] = True
N8 = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
while pq:
    e, j, i = heapq.heappop(pq)
    for dj, di in N8:
        jj, ii = j + dj, i + di
        if 0 <= jj < h and 0 <= ii < w and not closed[jj, ii]:
            closed[jj, ii] = True
            if filled[jj, ii] <= e:
                filled[jj, ii] = e + 1e-3
            heapq.heappush(pq, (filled[jj, ii], jj, ii))

# --- D8 ---
dx = MODEL['dlon'] * 111320 * math.cos(math.radians(lat_c.mean())); dy = abs(MODEL['dlat']) * 110574
pad = np.pad(filled, 1, mode='constant', constant_values=np.inf)
best = np.zeros((h, w)); down = -np.ones((h, w), np.int64)
J, I = np.mgrid[0:h, 0:w]
for dj, di in N8:
    nb = pad[1 + dj:1 + dj + h, 1 + di:1 + di + w]
    s_ = (filled - nb) / math.hypot(di * dx, dj * dy)
    upd = s_ > best
    best[upd] = s_[upd]
    down[upd] = ((J + dj) * w + (I + di))[upd]

# --- acumulação (ordem decrescente de altitude) ---
order = np.argsort(-filled, axis=None)
acc = np.ones(h * w)
dflat = down.ravel()
for k in order:
    d = dflat[k]
    if d >= 0: acc[d] += acc[k]
area = acc * cell_km2
is_ch = area >= AREA_MIN_KM2

# --- Strahler ---
strahler = np.zeros(h * w, np.int32)
up_max = np.zeros(h * w, np.int32); up_cnt = np.zeros(h * w, np.int32)
for k in order:
    if not is_ch.ravel()[k]: continue
    s = 1 if up_max[k] == 0 else (up_max[k] + 1 if up_cnt[k] >= 2 else up_max[k])
    strahler[k] = s
    d = dflat[k]
    if d >= 0 and is_ch.ravel()[d]:
        if s > up_max[d]: up_max[d], up_cnt[d] = s, 1
        elif s == up_max[d]: up_cnt[d] += 1

# --- polilinhas: um trecho por sequência de mesma ordem ---
def ll(k):
    j, i = divmod(int(k), w)
    return [round(MODEL['lat0'] + (j + 0.5) * MODEL['dlat'], 6), round(MODEL['lon0'] + (i + 0.5) * MODEL['dlon'], 6)]

n_up = np.zeros(h * w, np.int32)
for k in np.flatnonzero(is_ch.ravel()):
    d = dflat[k]
    if d >= 0 and is_ch.ravel()[d]: n_up[d] += 1
# trechos começam em nascentes (0 afluentes) e confluências (≥2); seguem até a próxima confluência
features = []
heads = [int(k) for k in np.flatnonzero(is_ch.ravel()) if n_up[k] != 1]
for k0 in heads:
    k = k0; s = strahler[k]; pts = [ll(k)]; amax = area.ravel()[k]
    while True:
        d = dflat[k]
        if d < 0 or not is_ch.ravel()[d]:
            break
        pts.append(ll(d)); amax = area.ravel()[d]
        if n_up[d] != 1 or strahler[d] != s:
            break
        k = d
    if len(pts) >= 2:
        features.append({'order': int(s), 'area_km2': round(float(amax), 3), 'geom': pts})

out = {
    'source': 'Derivado do ANADEM v1.0 (UFRGS/ANA): priority-flood + D8',
    'area_min_km2': AREA_MIN_KM2,
    'features': features,
}
json.dump(out, open(MODEL['out'], 'w'), separators=(',', ':'))
print(len(features), 'trechos; ordens:', {o: sum(f['order'] == o for f in features) for o in range(1, 8)})
