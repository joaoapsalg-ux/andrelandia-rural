"""Vigor da vegetação (NDVI da Sentinel-2 L2A) para o app: mapas das águas e da seca de 2026 e números por propriedade.

Roda no GitHub Actions (robô "Vigor da pastagem"): lê do catálogo público Earth Search (Element 84, cenas na AWS)
só o recorte da extensão do mapa em cada cena, máscara de nuvem pela classificação da própria cena (SCL: fica só
vegetação e solo exposto) e junta as datas de cada estação num valor só por pixel:
  - águas (jan–abr): percentil 70 (o auge do verde; nuvem e sombra que escaparam da máscara puxam para baixo)
  - seca (jul–set): mediana
2026 é lido a 10 m e gravado na grade da extensão (~15 m, a mesma do car_id.png) para o mapa; 2019–2025 são lidos
na visão de 20 m e levados à grade de 30 m do MapBiomas, só para a tendência de cada propriedade.

Saídas (data/muni/layers/):
  vigor_aguas_2026.webp, vigor_seca_2026.webp  cinza 8 bits, 3072×2993: 0 = sem dado; NDVI = (v − 1) / 254 − 0,1
  vigor.json   anos, datas usadas, médias do pasto no município e, por propriedade (mesmo índice do car.json):
               [ha de pasto, % pasto fraco, % pasto forte, NDVI águas 2026, NDVI seca 2026, [águas ano a ano], [seca ano a ano]]
               (NDVI × 100; "fraco" e "forte" = abaixo do 1º quartil / acima do 3º quartil do pasto do município nas águas)
Pasto = classe 15 do MapBiomas 2025 (30 m).
Uso: python tools/build_vigor.py [--years 2019-2026] [--max-items 20]
"""
import argparse, json, math, os, re, time
from concurrent.futures import ThreadPoolExecutor
import numpy as np
import requests
import rasterio
from rasterio.vrt import WarpedVRT
from rasterio.enums import Resampling
from rasterio.transform import from_origin
from PIL import Image, ImageDraw

T0 = time.time()
L = 'data/muni/layers/'
EXT = dict(w=-44.51, e=-44.06, n=-21.53, s=-21.94)
G30 = dict(w=1671, h=1522, lon0=-44.51026468672453, lat0=-21.529922414492574, d=0.00026949458523585647)
LAT_C = -21.735
MX = 111320 * math.cos(math.radians(LAT_C))
MY = 110574
W15 = 3072
H15 = round(W15 * (EXT['n'] - EXT['s']) * MY / ((EXT['e'] - EXT['w']) * MX))
STAC = 'https://earth-search.aws.element84.com/v1/search'
SEASONS = {'aguas': ('01-01', '04-30', 70), 'seca': ('07-01', '09-30', 50)}
PASTO = 15

# sem GDAL_HTTP_MULTIRANGE: o S3 não aceita vários trechos num pedido e devolve o arquivo inteiro (~150 MB por banda)
os.environ.update(GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR', CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.tif', AWS_NO_SIGN_REQUEST='YES',
                  GDAL_HTTP_MERGE_CONSECUTIVE_RANGES='YES', VSI_CACHE='TRUE', GDAL_CACHEMAX='2048', GDAL_INGESTED_BYTES_AT_OPEN='65536')
STATS = {'off': 0, 'nooff': 0}
# cada banda é lida em centenas de pedidos pequenos, um depois do outro (a demora é a ida e volta, não o volume):
# muitas bandas ao mesmo tempo
BANDS = ThreadPoolExecutor(36)


def log(*a): print(f'[{time.time() - T0:6.1f}s]', *a, flush=True)


def search(year, season, max_items):
    a, b, _ = SEASONS[season]
    body = {'collections': ['sentinel-2-l2a'], 'bbox': [EXT['w'], EXT['s'], EXT['e'], EXT['n']],
            'datetime': f'{year}-{a}T00:00:00Z/{year}-{b}T23:59:59Z', 'query': {'eo:cloud_cover': {'lt': 60}}, 'limit': 200}
    items, url = [], STAC
    while url:
        r = requests.post(url, json=body, timeout=60); r.raise_for_status(); j = r.json()
        items += j['features']
        nxt = [l for l in j.get('links', []) if l.get('rel') == 'next']
        url, body = (nxt[0]['href'], nxt[0].get('body', body)) if nxt else (None, None)
    # o catálogo às vezes tem a mesma cena processada duas vezes (…_0_L2A, …_1_L2A): fica a mais nova
    best = {}
    for it in items:
        m = re.match(r'(.+)_(\d+)_L2A$', it['id'])
        key, seq = (m.group(1), int(m.group(2))) if m else (it['id'], 0)
        if key not in best or seq > best[key][0]: best[key] = (seq, it)
    out = sorted((it for _, it in best.values()), key=lambda it: it['properties'].get('eo:cloud_cover', 100))
    return out[:max_items]


def read_grid(href, transform, w, h, resampling, overview=None):
    kw = {'overview_level': overview} if overview is not None else {}
    with rasterio.open(href, **kw) as src, WarpedVRT(src, crs='EPSG:4326', transform=transform, width=w, height=h,
                                                     resampling=resampling, src_nodata=0, nodata=0) as vrt:
        return vrt.read(1)


def ndvi_of(it, transform, w, h, coarse):
    """NDVI de uma cena na grade pedida (NaN onde há nuvem, sombra, água ou falta de dado)"""
    A = it['assets']
    ov = 0 if coarse else None   # 2019–2025: visão de 20 m das bandas de 10 m (a SCL já é de 20 m)
    rs = Resampling.average
    fr = BANDS.submit(read_grid, A['red']['href'], transform, w, h, rs, ov)
    fn = BANDS.submit(read_grid, A['nir']['href'], transform, w, h, rs, ov)
    fs = BANDS.submit(read_grid, A['scl']['href'], transform, w, h, Resampling.nearest)
    red, nir, scl = fr.result().astype(np.float32), fn.result().astype(np.float32), fs.result()
    ok = (red > 0) & (nir > 0) & np.isin(scl, [4, 5])
    # deslocamento de +1000 nos números (cenas processadas a partir de 2022): decidido pelos dados, não pelo catálogo
    # (que marca "boa_offset_applied" e offset −0,1 ao mesmo tempo). Mata fechada reflete 2–4% no vermelho:
    # número ~200–400 sem o deslocamento, ~1200–1400 com ele
    veg = (scl == 4) & (red > 0)
    off = 1000.0 if veg.sum() > 2000 and np.percentile(red[veg], 1) > 800 else 0.0
    STATS['off' if off else 'nooff'] += 1
    R, N = np.maximum((red - off) * 1e-4, 0), np.maximum((nir - off) * 1e-4, 0)
    with np.errstate(invalid='ignore', divide='ignore'):
        v = (N - R) / (N + R)
    v[~ok | (N + R < 0.02)] = np.nan
    return v.astype(np.float16)


def composite(year, season, transform, w, h, coarse, max_items):
    items = search(year, season, max_items)
    pct = SEASONS[season][2]
    if not items: log(year, season, 'nenhuma cena'); return None, []
    with ThreadPoolExecutor(12) as ex:
        stack = list(ex.map(lambda it: ndvi_of(it, transform, w, h, coarse), items))
    stack = np.stack(stack)
    out = np.full((h, w), np.nan, np.float32)
    for y0 in range(0, h, 128):   # por faixas de linhas: o percentil de tudo de uma vez não cabe na memória
        blk = stack[:, y0:y0 + 128].astype(np.float32)
        with np.errstate(all='ignore'):
            out[y0:y0 + 128] = np.nanpercentile(blk, pct, axis=0)
    cnt = np.isfinite(stack).sum(0)
    dates = sorted({it['properties']['datetime'][:10] for it in items})
    log(f'{year} {season}: {len(items)} cenas, {len(dates)} datas, {np.isfinite(out).mean() * 100:.1f}% com dado, '
        f'mediana de {np.median(cnt):.0f} observações por pixel, NDVI mediano {np.nanmedian(out):.2f} '
        f'(cenas com/sem deslocamento até agora: {STATS["off"]}/{STATS["nooff"]})')
    return out, dates


def save_webp(v, path):
    b = np.where(np.isfinite(v), np.clip(np.round((v + 0.1) * 254) + 1, 1, 255), 0).astype(np.uint8)
    Image.fromarray(b).convert('RGB').save(path, quality=90, method=6)
    log(path, f'{os.path.getsize(path) / 1e6:.1f} MB')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--years', default='2019-2026')
    ap.add_argument('--max-items', type=int, default=20)
    ap.add_argument('--max-items-old', type=int, default=12)
    a = ap.parse_args()
    y0, y1 = map(int, a.years.split('-'))
    years = list(range(y0, y1 + 1))
    t15 = from_origin(EXT['w'], EXT['n'], (EXT['e'] - EXT['w']) / W15, (EXT['n'] - EXT['s']) / H15)
    t30 = from_origin(G30['lon0'], G30['lat0'], G30['d'], G30['d'])
    # grade de 30 m: centro de cada pixel → pixel da grade de 15 m (para levar 2026 à grade do MapBiomas)
    lon30 = G30['lon0'] + (np.arange(G30['w']) + 0.5) * G30['d']
    lat30 = G30['lat0'] - (np.arange(G30['h']) + 0.5) * G30['d']
    jx = np.clip(((lon30 - EXT['w']) / (EXT['e'] - EXT['w']) * W15).astype(int), 0, W15 - 1)
    jy = np.clip(((EXT['n'] - lat30) / (EXT['n'] - EXT['s']) * H15).astype(int), 0, H15 - 1)

    g30, dates = {}, {}
    for season in SEASONS:
        for y in years:
            if y == years[-1]:   # ano atual: 10 m para o mapa
                v15, d = composite(y, season, t15, W15, H15, False, a.max_items)
                if v15 is None: continue
                save_webp(v15, L + f'vigor_{season}_{y}.webp')
                g30[(season, y)] = v15[np.ix_(jy, jx)]
            else:
                v, d = composite(y, season, t30, G30['w'], G30['h'], True, a.max_items_old)
                if v is None: continue
                g30[(season, y)] = v
            dates[f'{season}_{y}'] = d

    # ---------- por propriedade ----------
    lc = np.array(Image.open('data/muni/landuse/lc30_2025.png'))
    pasto = lc == PASTO
    ring = json.load(open(L + 'boundary.json'))['ring']
    bi = Image.new('1', (G30['w'], G30['h']), 0)
    to30 = lambda la, lo: ((lo - G30['lon0']) / G30['d'], (G30['lat0'] - la) / G30['d'])
    ImageDraw.Draw(bi).polygon([to30(la, lo) for la, lo in ring], fill=1)
    muni = np.array(bi, dtype=bool)
    px_ha = (G30['d'] * MX) * (G30['d'] * MY) / 1e4
    cur = years[-1]
    wet, dry = g30.get(('aguas', cur)), g30.get(('seca', cur))
    mp = pasto & muni & np.isfinite(wet)
    q_wet = [round(float(np.percentile(wet[mp], q)), 3) for q in (25, 50, 75)]
    mpd = pasto & muni & np.isfinite(dry)
    q_dry = [round(float(np.percentile(dry[mpd], q)), 3) for q in (25, 50, 75)]
    mean_of = lambda arr, m: (lambda vv: None if vv.size < 0.5 * max(m.sum(), 1) or vv.size == 0 else round(float(vv.mean()) * 100))(arr[m][np.isfinite(arr[m])])
    series = lambda season, m: [mean_of(g30[(season, y)], m) if (season, y) in g30 else None for y in years]
    out = {
        'years': years, 'dates': dates, 'pasto': PASTO,
        'muni': {'pasto_ha': round(float((pasto & muni).sum() * px_ha)), 'q_wet': q_wet, 'q_dry': q_dry,
                 'wet': series('aguas', pasto & muni), 'dry': series('seca', pasto & muni)},
        'p': [],
    }
    log('pasto do município:', out['muni'])
    feats = json.load(open(L + 'car.json'))['features']
    for k, f in enumerate(feats):
        if not f.get('s') or f.get('status') == 'cancelado': out['p'].append(None); continue
        xs = [to30(la, lo) for r in f['rings'] for la, lo in r]
        x0 = max(int(min(p[0] for p in xs)) - 1, 0); x1 = min(int(max(p[0] for p in xs)) + 2, G30['w'])
        y0_ = max(int(min(p[1] for p in xs)) - 1, 0); y1_ = min(int(max(p[1] for p in xs)) + 2, G30['h'])
        if x1 <= x0 or y1_ <= y0_: out['p'].append(None); continue
        im = Image.new('1', (x1 - x0, y1_ - y0_), 0); dr = ImageDraw.Draw(im)
        for r in f['rings']:
            if len(r) >= 3: dr.polygon([((lo - G30['lon0']) / G30['d'] - x0, (G30['lat0'] - la) / G30['d'] - y0_) for la, lo in r], fill=1)
        m = np.zeros_like(pasto); m[y0_:y1_, x0:x1] = np.array(im, dtype=bool)
        mpk = m & pasto
        n = int(mpk.sum())
        if n < 3: out['p'].append([round(n * px_ha, 1)]); continue
        w_ = wet[mpk]; w_ = w_[np.isfinite(w_)]
        weak = round(100 * float((w_ < q_wet[0]).mean())) if w_.size else None
        strong = round(100 * float((w_ > q_wet[2]).mean())) if w_.size else None
        out['p'].append([round(n * px_ha, 1), weak, strong, mean_of(wet, mpk), mean_of(dry, mpk), series('aguas', mpk), series('seca', mpk)])
        if k % 500 == 0: log(k, out['p'][-1])
    json.dump(out, open(L + 'vigor.json', 'w'), separators=(',', ':'))
    log('vigor.json', f'{os.path.getsize(L + "vigor.json") / 1e3:.0f} kB')


if __name__ == '__main__':
    main()
