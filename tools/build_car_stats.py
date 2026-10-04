"""Ficha de cada imóvel do CAR + APP estimada + raster de identificação para o app.

Lê data/muni/layers/car.json (gerado por build_car.py) e os dados já no projeto:
  - MapBiomas 30 m (1985, 2025) e 10 m (2025)      → composição do uso do solo, vegetação nativa
  - ANADEM 30 m                                     → altitude, declividade
  - drainage.json (córregos calculados) e osm.json  → córregos, nascentes, rios, estradas
  - strava.json                                     → rotas que passam pelo imóvel

APP estimada (Código Florestal, Lei 12.651/2012), numa grade de 10 m:
  - integral (art. 4º): 30 m de cada lado dos córregos, 50 m dos rios do OSM, 50 m de raio nas nascentes,
    encostas > 45°. Topos de morro, veredas e entorno de reservatórios NÃO entram.
  - mínima em área rural consolidada (art. 61-A): faixa por tamanho do imóvel (5 m até 1 MF, 8 m de 1 a 2,
    15 m de 2 a 4, 20 m acima de 4) e 15 m de raio nas nascentes; teto de 10% da área (até 2 MF) e 20% (2 a 4 MF).
  Nascentes = cabeceiras dos córregos calculados (bacia de 0,15 km²): ficam abaixo da nascente real.
  Déficit = área da faixa com uso antrópico (pasto, lavoura, eucalipto, mosaico, urbano…) no MapBiomas 10 m.

Saídas:
  data/muni/layers/car.json   (acrescenta o campo "s" em cada imóvel e "resumo" no topo)
  data/muni/layers/car_id.png (RGB, extensão do mapa: R·256+G = índice do imóvel + 1, B = nº de cadastros sobrepostos)
Uso: python3 tools/build_car_stats.py
"""
import json, math, time
import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import distance_transform_edt
from shapely.geometry import Polygon, LineString, MultiPolygon
from shapely.strtree import STRtree
from shapely.ops import unary_union, polylabel

T0 = time.time()
L = 'data/muni/layers/'
EXT = dict(w=-44.51, e=-44.06, n=-21.53, s=-21.94)
G30 = dict(w=1671, h=1522, lon0=-44.51026468672453, lat0=-21.529922414492574, d=0.00026949458523585647)
G10 = dict(w=5011, h=4565, lon0=-44.51008502366769, lat0=-21.52992241449257, d=0.00008983152841195215)
LAT_C = -21.735
MX = 111320 * math.cos(math.radians(LAT_C))   # m por grau de longitude
MY = 110574                                    # m por grau de latitude
DX10, DY10 = G10['d'] * MX, G10['d'] * MY
PX_HA = DX10 * DY10 / 1e4
NATIVE = [3, 4, 11, 12]
NEUTRAL = [29, 33, 0]            # rocha, água, sem dado: não entram na conta da APP
CLS_ALL = [3, 4, 11, 12, 29, 15, 19, 41, 36, 46, 47, 48, 9, 21, 24, 30, 25, 33, 31]


def log(*a): print(f'[{time.time() - T0:6.1f}s]', *a, flush=True)


car = json.load(open(L + 'car.json'))
feats = car['features']
log(len(feats), 'imóveis')

# ---------- rasters base em 10 m ----------
lc10 = np.array(Image.open('data/muni/landuse/lc10_2025.png'))
lc30_25 = np.array(Image.open('data/muni/landuse/lc30_2025.png'))
lc30_85 = np.array(Image.open('data/muni/landuse/lc30_1985.png'))
dem = np.array(Image.open('data/muni/dem/anadem.png')).astype(np.float64)
elev30 = (dem[..., 0] * 256 + dem[..., 1] + dem[..., 2] / 256 - 32768).astype(np.float32)
gy, gx = np.gradient(elev30, G30['d'] * MY, G30['d'] * MX)
slope30 = np.degrees(np.arctan(np.hypot(gx, gy))).astype(np.float32)

# índice g30 de cada coluna/linha g10 (centros)
lon10 = G10['lon0'] + (np.arange(G10['w']) + 0.5) * G10['d']
lat10 = G10['lat0'] - (np.arange(G10['h']) + 0.5) * G10['d']
ix30 = np.clip(np.floor((lon10 - G30['lon0']) / G30['d']).astype(int), 0, G30['w'] - 1)
iy30 = np.clip(np.floor((G30['lat0'] - lat10) / G30['d']).astype(int), 0, G30['h'] - 1)
up = lambda a: a[np.ix_(iy30, ix30)]
lc25u, lc85u, elevu, slopeu = up(lc30_25), up(lc30_85), up(elev30), up(slope30)
log('rasters 10 m prontos')


def to10(lat, lon):
    return (lon - G10['lon0']) / G10['d'], (G10['lat0'] - lat) / G10['d']


# ---------- hidrografia e APP ----------
drain = json.load(open(L + 'drainage.json'))['features']
osm = json.load(open(L + 'osm.json'))['features']
img_stream = Image.new('1', (G10['w'], G10['h']), 0); ds = ImageDraw.Draw(img_stream)
img_river = Image.new('1', (G10['w'], G10['h']), 0); dr = ImageDraw.Draw(img_river)
for f in drain:
    ds.line([to10(la, lo) for la, lo in f['geom']], fill=1, width=1)
for f in osm:
    if f['kind'] != 'waterway': continue
    for g in f['geom']:
        pts = [to10(la, lo) for la, lo in g]
        if len(pts) < 2: continue
        ds.line(pts, fill=1, width=1)
        if f['sub'] == 'river': dr.line(pts, fill=1, width=1)
stream = np.array(img_stream, dtype=bool); river = np.array(img_river, dtype=bool)


# nascentes: início dos trechos de 1ª ordem (confere o sentido pela altitude)
def elev_at(lat, lon):
    i = int((lon - G30['lon0']) / G30['d']); j = int((G30['lat0'] - lat) / G30['d'])
    return elev30[min(max(j, 0), G30['h'] - 1), min(max(i, 0), G30['w'] - 1)]


springs, flips = [], 0
for f in drain:
    if f['order'] != 1: continue
    a, b = f['geom'][0], f['geom'][-1]
    if elev_at(*a) < elev_at(*b): a = b; flips += 1
    springs.append(a)
log(len(springs), 'nascentes estimadas;', flips, 'trechos com sentido invertido')
spring_mask = np.zeros_like(stream)
sp_xy = []
for la, lo in springs:
    x, y = to10(la, lo); xi, yi = int(x), int(y)
    if 0 <= xi < G10['w'] and 0 <= yi < G10['h']:
        spring_mask[yi, xi] = True; sp_xy.append((xi, yi))
sp_xy = np.array(sp_xy)

edt = lambda m: distance_transform_edt(~m, sampling=(DY10, DX10)).astype(np.float32)
d_stream, d_river, d_spring = edt(stream), edt(river), edt(spring_mask)
log('distâncias prontas')
steep = slopeu > 45
app_full = (d_stream <= 30) | (d_river <= 50) | (d_spring <= 50) | steep
is_nat = np.isin(lc10, NATIVE)
is_neu = np.isin(lc10, NEUTRAL)
is_ant = ~is_nat & ~is_neu
log('APP integral na extensão: %.0f ha' % (app_full.sum() * PX_HA))

# ---------- geometrias ----------
polys = []
for f in feats:
    ps = [Polygon([(lo, la) for la, lo in r]) for r in f['rings'] if len(r) >= 4]
    ps = [p if p.is_valid else p.buffer(0) for p in ps]
    g = unary_union(ps) if ps else Polygon()
    polys.append(g)
active = [k for k, f in enumerate(feats) if f['status'] != 'cancelado']
tree = STRtree([polys[k] for k in active])


def deg_area_ha(g): return g.area * MX * MY / 1e4


def proj(g):  # graus → metros locais (para comprimentos)
    from shapely import transform
    return transform(g, lambda c: np.c_[c[:, 0] * MX, c[:, 1] * MY])


def lines_tree(lines):
    geoms = [proj(LineString([(lo, la) for la, lo in l])) for l in lines if len(l) >= 2]
    return geoms, STRtree(geoms)


drain_geoms, drain_tree = lines_tree([f['geom'] for f in drain])
road_geoms, road_tree = lines_tree([g for f in osm if f['kind'] == 'highway' for g in f['geom']])
strava = json.load(open(L + 'strava.json'))['activities']
sv_geoms = [proj(LineString([(lo, la) for la, lo in a['pts']])) for a in strava]
sv_tree = STRtree(sv_geoms)


def length_km(geoms, tr, gm):
    idx = tr.query(gm)
    return sum(geoms[i].intersection(gm).length for i in idx) / 1000


# ---------- contagem de sobreposição (10 m) ----------
count10 = np.zeros((G10['h'], G10['w']), np.uint8)


def crop_mask(g):
    """máscara do polígono num recorte da grade de 10 m → (máscara, y0, x0)"""
    w_, s_, e_, n_ = g.bounds
    x0 = max(int((w_ - G10['lon0']) / G10['d']) - 1, 0); x1 = min(int((e_ - G10['lon0']) / G10['d']) + 2, G10['w'])
    y0 = max(int((G10['lat0'] - n_) / G10['d']) - 1, 0); y1 = min(int((G10['lat0'] - s_) / G10['d']) + 2, G10['h'])
    if x1 <= x0 or y1 <= y0: return None, 0, 0
    im = Image.new('1', (x1 - x0, y1 - y0), 0); d = ImageDraw.Draw(im)
    for p in (g.geoms if isinstance(g, MultiPolygon) else [g]):
        if p.is_empty: continue
        d.polygon([((lo - G10['lon0']) / G10['d'] - x0, (G10['lat0'] - la) / G10['d'] - y0) for lo, la in p.exterior.coords], fill=1)
        for hole in p.interiors:
            d.polygon([((lo - G10['lon0']) / G10['d'] - x0, (G10['lat0'] - la) / G10['d'] - y0) for lo, la in hole.coords], fill=0)
    return np.array(im, dtype=bool), y0, x0


masks = {}
for k in active:
    m, y0, x0 = crop_mask(polys[k])
    if m is None: continue
    masks[k] = (m, y0, x0)
    count10[y0:y0 + m.shape[0], x0:x0 + m.shape[1]] += m
log('máscaras prontas')


def width_min(mf):
    return 5 if mf <= 1 else 8 if mf <= 2 else 15 if mf <= 4 else 20


def pct(n, tot): return round(100 * n / tot, 1) if tot else 0


for k, f in enumerate(feats):
    f.pop('s', None)
    if k not in masks: continue
    m, y0, x0 = masks[k]
    sl = (slice(y0, y0 + m.shape[0]), slice(x0, x0 + m.shape[1]))
    npx = int(m.sum())
    if npx == 0: continue
    s = {'a': round(npx * PX_HA, 1)}
    # uso do solo (30 m) 2025 e 1985
    c25 = np.bincount(lc25u[sl][m], minlength=256); c85 = np.bincount(lc85u[sl][m], minlength=256)
    s['lu'] = sorted([[c, pct(c25[c], npx)] for c in CLS_ALL if pct(c25[c], npx) >= 0.5], key=lambda x: -x[1])
    s['n25'] = pct(c25[NATIVE].sum(), npx); s['n85'] = pct(c85[NATIVE].sum(), npx)
    s['eu'] = pct(c25[9], npx)
    s['f25'] = pct(c25[[3, 4]].sum(), npx); s['f85'] = pct(c85[[3, 4]].sum(), npx)   # só matas
    # relevo
    ev = elevu[sl][m]
    jm = np.argmax(np.where(m, elevu[sl], -1e9))
    yy, xx = np.unravel_index(jm, m.shape)
    s['z'] = [round(float(ev.min())), round(float(ev.mean())), round(float(ev.max()))]
    s['zp'] = [round(G10['lat0'] - (y0 + yy + 0.5) * G10['d'], 5), round(G10['lon0'] + (x0 + xx + 0.5) * G10['d'], 5)]
    s['sl'] = round(float(slopeu[sl][m].mean()), 1)
    # linhas
    gm = proj(polys[k])
    s['dr'] = round(length_km(drain_geoms, drain_tree, gm), 2)
    s['rd'] = round(length_km(road_geoms, road_tree, gm), 2)
    s['sv'] = [strava[i]['id'] for i in sv_tree.query(gm) if sv_geoms[i].intersects(gm)]
    if len(sp_xy):
        inb = (sp_xy[:, 0] >= x0) & (sp_xy[:, 0] < x0 + m.shape[1]) & (sp_xy[:, 1] >= y0) & (sp_xy[:, 1] < y0 + m.shape[0])
        s['nas'] = int(sum(m[yy_ - y0, xx_ - x0] for xx_, yy_ in sp_xy[inb]))
    # APP integral
    nat, ant, neu = is_nat[sl] & m, is_ant[sl] & m, is_neu[sl] & m
    af = app_full[sl] & m & ~neu
    a_ha = af.sum() * PX_HA
    s['app'] = [round(a_ha, 2), pct((af & nat).sum(), af.sum()), round((af & ant).sum() * PX_HA, 2)]
    # APP mínima (área consolidada, art. 61-A)
    w = width_min(f['mf'])
    am = ((d_stream[sl] <= w) | (d_river[sl] <= w) | (d_spring[sl] <= 15)) & m & ~neu
    dm = (am & ant).sum() * PX_HA
    cap = 0.10 if f['mf'] <= 2 else 0.20 if f['mf'] <= 4 else None
    capped = cap is not None and dm > cap * f['ha']
    if capped: dm = cap * f['ha']
    s['appm'] = [round(am.sum() * PX_HA, 2), round(dm, 2), w, 1 if capped else 0]
    # sobreposição com outros cadastros
    ovh = ((count10[sl] >= 2) & m).sum() * PX_HA
    partners = 0
    for j in tree.query(polys[k]):
        kk = active[j]
        if kk == k: continue
        try:
            if deg_area_ha(polys[k].intersection(polys[kk])) >= 0.2: partners += 1
        except Exception:
            pass
    s['ov'] = [round(ovh, 1), partners]
    # ponto para o rótulo (dentro do maior pedaço)
    big = max(polys[k].geoms, key=lambda p: p.area) if isinstance(polys[k], MultiPolygon) else polys[k]
    try: lp = polylabel(big, 0.00003)
    except Exception: lp = big.representative_point()
    s['lp'] = [round(lp.y, 5), round(lp.x, 5)]
    f['s'] = s
    if k % 500 == 0: log(k, f['cod'][-6:], s)

# ---------- resumo do município (dentro do limite) ----------
ring = json.load(open(L + 'boundary.json'))['ring']
bi = Image.new('1', (G10['w'], G10['h']), 0)
ImageDraw.Draw(bi).polygon([to10(la, lo) for la, lo in ring], fill=1)
muni = np.array(bi, dtype=bool)
af = app_full & muni & ~is_neu
resumo = {
    'app_ha': round(af.sum() * PX_HA), 'app_nat_pct': pct((af & is_nat).sum(), af.sum()),
    'app_def_ha': round((af & is_ant).sum() * PX_HA), 'nascentes': int(spring_mask[muni].sum()),
    'cobertos_car_pct': pct(((count10 > 0) & muni).sum(), muni.sum()),
    'sobreposto_ha': round(((count10 >= 2) & muni).sum() * PX_HA),
}
car['resumo'] = resumo
log('resumo', resumo)
json.dump(car, open(L + 'car.json', 'w'), separators=(',', ':'), ensure_ascii=False)

# ---------- raster de identificação (extensão do mapa, ~15 m) ----------
W = 3072
H = round(W * (EXT['n'] - EXT['s']) * MY / ((EXT['e'] - EXT['w']) * MX))
idimg = Image.new('RGB', (W, H), (0, 0, 0)); di = ImageDraw.Draw(idimg)
cnt = np.zeros((H, W), np.uint8)
px = lambda lo, la: ((lo - EXT['w']) / (EXT['e'] - EXT['w']) * W, (EXT['n'] - la) / (EXT['n'] - EXT['s']) * H)
for k in sorted(active, key=lambda k: -feats[k]['ha']):   # menores por cima (como o clique)
    v = k + 1
    for p in (polys[k].geoms if isinstance(polys[k], MultiPolygon) else [polys[k]]):
        if p.is_empty: continue
        pts = [px(lo, la) for lo, la in p.exterior.coords]
        di.polygon(pts, fill=(v >> 8, v & 255, 0))
for k in active:   # contagem de cadastros por pixel, só no recorte de cada polígono
    g = polys[k]
    w_, s_, e_, n_ = g.bounds
    x0, y1 = px(w_, s_); x1, y0 = px(e_, n_)
    x0, y0 = max(int(x0) - 1, 0), max(int(y0) - 1, 0); x1, y1 = min(int(x1) + 2, W), min(int(y1) + 2, H)
    if x1 <= x0 or y1 <= y0: continue
    one = Image.new('1', (x1 - x0, y1 - y0), 0); d1 = ImageDraw.Draw(one)
    for p in (g.geoms if isinstance(g, MultiPolygon) else [g]):
        if not p.is_empty: d1.polygon([(a - x0, b - y0) for a, b in (px(lo, la) for lo, la in p.exterior.coords)], fill=1)
    cnt[y0:y1, x0:x1] += np.array(one, dtype=np.uint8)
arr = np.array(idimg)
# canal B: bits 0–3 = nº de cadastros (até 15), bit 4 = APP integral estimada, bit 5 = APP com uso antrópico
lonc = EXT['w'] + (np.arange(W) + 0.5) / W * (EXT['e'] - EXT['w'])
latc = EXT['n'] - (np.arange(H) + 0.5) / H * (EXT['n'] - EXT['s'])
jx = np.clip(np.floor((lonc - G10['lon0']) / G10['d']).astype(int), 0, G10['w'] - 1)
jy = np.clip(np.floor((G10['lat0'] - latc) / G10['d']).astype(int), 0, G10['h'] - 1)
appx = (app_full & ~is_neu)[np.ix_(jy, jx)]
defx = (app_full & is_ant)[np.ix_(jy, jx)]
arr[..., 2] = np.minimum(cnt, 15) | (appx.astype(np.uint8) << 4) | (defx.astype(np.uint8) << 5)
Image.fromarray(arr).save(L + 'car_id.png', optimize=True)
log('car_id.png', W, H)
