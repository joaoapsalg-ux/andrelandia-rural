"""Imagem de 2 m (CBERS-4A WPM, fusão PCA do INPE) para células escolhidas, no formato dos blocos da cidade.

Roda no GitHub Actions (.github/workflows/imagem-2m.yml), que tem GDAL e internet: lê só o recorte de cada célula
no COG do INPE (pedidos parciais, sem baixar a cena de 4 GB) e grava data/muni/img/town/c_{r}_{c}.jpg.

Cor: a do bloco de 4 m que o app já usa (CBERS 4 m + cor Sentinel-2). Dos 2 m vem só o detalhe fino:
    saída = suave(bloco 4 m) + ganho · (L_2m − suave(L_2m))
O ganho casa o contraste local dos 2 m com o do bloco atual (percentis, como em tools/fuse_imagery.py).

Uso: python tools/build_cbers2m.py --cells 6_11,6_12,7_11,7_12 [--out pasta] [--gain 1.0]
"""
import argparse
import os
import time

import numpy as np
import rasterio
from PIL import Image
from rasterio.warp import transform
from rasterio.windows import from_bounds
from scipy.ndimage import gaussian_filter, map_coordinates

COG = ('https://data.inpe.br/bdc/data/CB4A-WPM-PCA-FUSED/v001/200/140/2026/7/'
       'CBERS4A_WPM_PCA_RGB321_20260723_200_140.tif')   # 23/07/2026, órbita 200/140 (mesma data da imagem atual)
# bandas originais da mesma cena (CB4A-WPM-L4-DN-1): pancromática 2 m e azul/verde/vermelho 8 m, para fusão própria
L4 = ('https://data.inpe.br/bdc/data/CB4A-WPM-L4-DN/2026_07/CBERS_4A_WPM_RAW_2026_07_23.12_41_31_ETC2/200_140_0/'
      '4_BC_UTM_WGS84/CBERS_4A_WPM_20260723_200_140_L4_BAND{}.tif')
EXT = dict(w=-44.51, e=-44.06, n=-21.53, s=-21.94)
COLS, ROWS = 22, 20
CLON = (EXT['e'] - EXT['w']) / COLS
CLAT = (EXT['n'] - EXT['s']) / ROWS
TS = 1024


def lum(a):
    return a[..., 0] * 0.299 + a[..., 1] * 0.587 + a[..., 2] * 0.114


def cell_grid(r, c):
    n = EXT['n'] - r * CLAT; w = EXT['w'] + c * CLON
    lon = w + (np.arange(TS) + 0.5) * (CLON / TS)
    lat = n - (np.arange(TS) + 0.5) * (CLAT / TS)
    return np.meshgrid(lon, lat)


def base_tile(r, c):
    """quadrante do bloco de 4 m que cobre a célula, ampliado para 1024 (já no espaço de cor final do app)"""
    t4 = Image.open(f'data/muni/img/cbers/t_{r // 2}_{c // 2}.jpg').convert('RGB')
    oy, ox = (r % 2) * 512, (c % 2) * 512
    return np.asarray(t4.crop((ox, oy, ox + 512, oy + 512)).resize((TS, TS), Image.BICUBIC)).astype(np.float32)


def inspect_l4(cells):
    """lê só os cabeçalhos das bandas L4 e estima quantos bytes o recorte das células exigiria"""
    os.environ.setdefault('GDAL_DISABLE_READDIR_ON_OPEN', 'EMPTY_DIR')
    for b in (0, 1, 2, 3):
        with rasterio.open(L4.format(b)) as ds:
            bw, bh = ds.block_shapes[0]
            ovr = ds.overviews(1)
            tiled = ds.profile.get('tiled', False)
            tot = 0
            for cell in cells.split(','):
                r, c = map(int, cell.split('_'))
                n = EXT['n'] - r * CLAT; w = EXT['w'] + c * CLON
                X, Y = transform('EPSG:4326', ds.crs, [w, w + CLON], [n, n - CLAT])
                win = from_bounds(min(X) - 40, min(Y) - 40, max(X) + 40, max(Y) + 40, ds.transform)
                # blocos que a janela toca × tamanho do bloco (sem compressão: pior caso)
                bx = int(np.ceil(win.width / bw)) + 1 if tiled else 1
                rows = int(np.ceil(win.height / bh)) + 1
                blk = bw * bh if tiled else ds.width * bh
                tot += bx * rows * blk * ds.count
            print(f'BAND{b}: {ds.width}x{ds.height} {ds.crs} res {ds.res} tiled={tiled} bloco {bw}x{bh} '
                  f'compressão {ds.compression} overviews {ovr} · recorte de {len(cells.split(","))} células ≈ {tot / 1e6:.0f} MB (sem compressão)')


def cog_url(key):
    """'20260723_200_140' → endereço do COG fundido do INPE dessa data/órbita/ponto"""
    d, orb, pt = key.split('_')
    return (f'https://data.inpe.br/bdc/data/CB4A-WPM-PCA-FUSED/v001/{orb}/{pt}/{d[:4]}/{int(d[4:6])}/'
            f'CBERS4A_WPM_PCA_RGB321_{key}.tif')


def dehaze(img, strength):
    """tira o véu de névoa (canal escuro): onde o mínimo das 3 cores é alto em toda a vizinhança, há névoa"""
    from scipy.ndimage import minimum_filter
    dc = minimum_filter(img.min(-1), size=15)
    A = np.percentile(img.reshape(-1, 3)[dc.ravel() >= np.percentile(dc, 99.9)], 90, axis=0)   # luz da atmosfera
    t = 1 - strength * gaussian_filter(dc, 8) / max(A.max(), 1)
    t = np.clip(t, 0.45, 1)[..., None]
    return (img - A) / t + A


def read_rgb(ds, X, Y, order):
    win = from_bounds(X.min() - 40, Y.min() - 40, X.max() + 40, Y.max() + 40, ds.transform).round_offsets().round_lengths()
    src = ds.read([1, 2, 3], window=win, boundless=True, fill_value=0).astype(np.float32)
    wt = ds.window_transform(win)
    rows, cols = (Y - wt.f) / wt.e - 0.5, (X - wt.c) / wt.a - 0.5
    return np.stack([map_coordinates(src[k], [rows, cols], order=order, mode='nearest', prefilter=order > 1) for k in range(3)], -1)


def register(ref, img):
    """deslocamento (dy, dx) de img em relação a ref, com fração de pixel (correlação de fase no detalhe)"""
    hp = lambda a: a - gaussian_filter(a, 4)
    F = np.fft.fft2(hp(ref)) * np.conj(np.fft.fft2(hp(img)))
    cc = np.fft.ifft2(F / np.maximum(np.abs(F), 1e-6)).real
    py, px = np.unravel_index(np.argmax(cc), cc.shape)
    # refino parabólico nos dois eixos
    h, w = cc.shape
    y0, y1, y2 = cc[(py - 1) % h, px], cc[py, px], cc[(py + 1) % h, px]
    x0, x1, x2 = cc[py, (px - 1) % w], cc[py, px], cc[py, (px + 1) % w]
    dy = py + 0.5 * (y0 - y2) / (y0 - 2 * y1 + y2 + 1e-9)
    dx = px + 0.5 * (x0 - x2) / (x0 - 2 * x1 + x2 + 1e-9)
    if dy > h / 2: dy -= h
    if dx > w / 2: dx -= w
    return dy, dx


def denoise(img, strength):
    """tira o granulado do sensor preservando as bordas (non-local means no brilho) — antes de realçar"""
    from skimage.restoration import denoise_nl_means, estimate_sigma
    L = lum(img) / 255.0
    sig = float(estimate_sigma(L))
    D = denoise_nl_means(L, h=strength * sig, sigma=sig, patch_size=5, patch_distance=6, fast_mode=True)
    return img + ((D - L) * 255.0)[..., None], sig * 255


def s2_offset(bbox, crs):
    """deslocamento (leste, norte) em metros que leva a CBERS para a posição da Sentinel-2 (boa precisão de posição).
    Busca a cena Sentinel-2 L2A de jun–ago/2026 com menos nuvem no catálogo aberto da AWS (Element84)."""
    import json, urllib.request
    w, s, e, n = bbox
    q = {'collections': ['sentinel-2-l2a'], 'bbox': [w, s, e, n], 'datetime': '2026-06-01T00:00:00Z/2026-08-31T23:59:59Z',
         'query': {'eo:cloud_cover': {'lt': 10}}, 'limit': 20}
    req = urllib.request.Request('https://earth-search.aws.element84.com/v1/search', data=json.dumps(q).encode(), headers={'Content-Type': 'application/json'})
    items = json.load(urllib.request.urlopen(req, timeout=60))['features']
    if not items: return 0.0, 0.0, 'sem cena Sentinel-2'
    it = min(items, key=lambda f: f['properties'].get('eo:cloud_cover', 100))
    href = it['assets']['red']['href']
    with rasterio.open(href) as s2:
        X, Y = transform('EPSG:4326', s2.crs, [w, e], [n, s])
        win = from_bounds(min(X), min(Y), max(X), max(Y), s2.transform).round_offsets().round_lengths()
        ref = s2.read(1, window=win).astype(np.float32)
        b = rasterio.windows.bounds(win, s2.transform)
    with rasterio.open(COG) as cb:   # a mesma área, na CBERS, reamostrada para a grade de 10 m da Sentinel-2
        cw = from_bounds(*b, cb.transform)
        img = cb.read(1, window=cw, out_shape=ref.shape, resampling=rasterio.enums.Resampling.average).astype(np.float32)
    dy, dx = register(ref, img)
    de, dn = -dx * 10.0, dy * 10.0
    info = f'Sentinel-2 {it["id"]} ({it["properties"].get("eo:cloud_cover", 0):.0f}% nuvem): CBERS deslocada {de:+.1f} m leste, {dn:+.1f} m norte'
    if abs(de) > 40 or abs(dn) > 40:   # grande demais para ser só erro de posição: não confia
        return 0.0, 0.0, info + ' (ignorado)'
    return de, dn, info


def deconvolve(img, sigma, k):
    """desfaz em parte o borrão do sensor (Wiener, borrão gaussiano de raio sigma px), só no brilho"""
    L = lum(img)
    Lp = np.pad(L, 32, mode='reflect')
    hp, wp = Lp.shape
    fy = np.fft.fftfreq(hp)[:, None]; fx = np.fft.fftfreq(wp)[None, :]
    H = np.exp(-2 * np.pi ** 2 * sigma ** 2 * (fx ** 2 + fy ** 2))
    R = np.fft.ifft2(np.fft.fft2(Lp) * H / (H ** 2 + k)).real[32:-32, 32:-32]
    return img + (R - L)[..., None]


# relevo do app (ANADEM 30 m, PNG Terrarium) e hora da passagem da cena (item L4 do INPE: 12:48:02 UTC)
DEM = dict(path='data/muni/dem/anadem.png', lon0=-44.510264686724526, lat0=-21.529922414492574, d=0.00026949458523585647)
SCENE_UTC = (2026, 7, 23, 12, 48)


def sun_position(lat, lon, y, mo, d, hh, mm):
    """azimute (graus a partir do norte, horário) e elevação do sol — aproximação NOAA, igual à do app (src/sun.js)"""
    import datetime
    t = datetime.datetime(y, mo, d, hh, mm, tzinfo=datetime.timezone.utc).timestamp()
    n = t / 86400 + 2440587.5 - 2451545.0
    L = (280.46 + 0.9856474 * n) % 360; g = np.radians((357.528 + 0.9856003 * n) % 360)
    lam = np.radians(L + 1.915 * np.sin(g) + 0.02 * np.sin(2 * g)); eps = np.radians(23.439 - 0.0000004 * n)
    ra = np.arctan2(np.cos(eps) * np.sin(lam), np.cos(lam)); dec = np.arcsin(np.sin(eps) * np.sin(lam))
    gmst = (18.697374558 + 24.06570982441908 * n) % 24
    ha = np.radians(gmst * 15 + lon) - ra; phi = np.radians(lat)
    el = np.arcsin(np.sin(phi) * np.sin(dec) + np.cos(phi) * np.cos(dec) * np.cos(ha))
    az = (np.degrees(np.arctan2(-np.sin(ha), np.tan(dec) * np.cos(phi) - np.sin(phi) * np.cos(ha))) + 360) % 360
    return az, np.degrees(el)


_dem = None
def terrain_cos(LON, LAT):
    """cosseno do ângulo entre o sol da hora da foto e a encosta, em cada pixel (relevo de 30 m suavizado)"""
    global _dem
    if _dem is None:
        rgb = np.asarray(Image.open(DEM['path']).convert('RGB')).astype(np.float64)
        z = rgb[..., 0] * 256 + rgb[..., 1] + rgb[..., 2] / 256 - 32768
        z = gaussian_filter(z, 1.0)
        latc = DEM['lat0'] - z.shape[0] / 2 * DEM['d']
        dx = DEM['d'] * 111320 * np.cos(np.radians(latc)); dy = DEM['d'] * 110574
        gy, gx = np.gradient(z, dy, dx)          # gy: para o sul (linhas descem), gx: para o leste
        _dem = (gx, -gy)                         # dz/dleste, dz/dnorte
    gx, gn = _dem
    ii = (LON - DEM['lon0']) / DEM['d'] - 0.5; jj = (DEM['lat0'] - LAT) / DEM['d'] - 0.5
    zx = map_coordinates(gx, [jj, ii], order=1, mode='nearest'); zn = map_coordinates(gn, [jj, ii], order=1, mode='nearest')
    az, el = sun_position(LAT.mean(), LON.mean(), *SCENE_UTC)
    s = np.array([np.sin(np.radians(az)) * np.cos(np.radians(el)), np.cos(np.radians(az)) * np.cos(np.radians(el)), np.sin(np.radians(el))])
    nrm = np.sqrt(zx ** 2 + zn ** 2 + 1)
    cos_i = (-zx * s[0] - zn * s[1] + s[2]) / nrm
    return cos_i, np.sin(np.radians(el)), az, el


def deshadow(img, LON, LAT, strength, c=0.6):
    """C-correction: clareia as encostas que estavam de costas para o sol na hora da foto (e escurece as de frente).
    c fixo para todas as células (ajustado por célula, variava de 0,3 a 3 e criaria degraus nas bordas)"""
    cos_i, cos_z, az, el = terrain_cos(LON, LAT)
    f = np.clip((cos_z + c) / (cos_i + c), 0.65, 1.7)
    f = 1 + strength * (gaussian_filter(f, 3) - 1)
    return img * f[..., None], f'sol {az:.0f}° / {el:.0f}°, c={c:.2f}, fator {f.min():.2f}–{f.max():.2f}'


def run_sheet(a):
    """folha de prova: o recorte da propriedade (--bbox w,s,e,n) em cada data, lado a lado, com a data escrita"""
    from PIL import ImageDraw
    w, s, e, n = map(float, a.bbox.split(','))
    keys = a.dates.split(',')
    tw = 360; th = int(tw * (n - s) / ((e - w) * np.cos(np.radians((n + s) / 2))))
    cols = 4; sheet = Image.new('RGB', (cols * tw, ((len(keys) + cols - 1) // cols) * (th + 22)), (17, 17, 17))
    dr = ImageDraw.Draw(sheet)
    for i, key in enumerate(keys):
        t0 = time.time()
        with rasterio.open(cog_url(key)) as ds:
            lon = w + (np.arange(tw * 2) + 0.5) * (e - w) / (tw * 2); lat = n - (np.arange(th * 2) + 0.5) * (n - s) / (th * 2)
            LON, LAT = np.meshgrid(lon, lat)
            X, Y = transform('EPSG:4326', ds.crs, LON.ravel().tolist(), LAT.ravel().tolist())
            img = read_rgb(ds, np.array(X).reshape(LON.shape), np.array(Y).reshape(LON.shape), 1)
        lo, hi = np.percentile(img[img.sum(-1) > 0], [1, 99]) if (img.sum(-1) > 0).any() else (0, 255)
        img = np.clip((img - lo) / max(hi - lo, 1) * 255, 0, 255).astype(np.uint8)
        x, y = (i % cols) * tw, (i // cols) * (th + 22)
        sheet.paste(Image.fromarray(img).resize((tw, th), Image.LANCZOS), (x, y + 22))
        dr.text((x + 6, y + 5), f'{key[6:8]}/{key[4:6]}/{key[:4]}  órbita {key[9:]}', fill=(255, 255, 255))
        print(f'{key}: {time.time() - t0:.1f} s')
    os.makedirs(a.out, exist_ok=True)
    sheet.save(os.path.join(a.out, 'folha_de_prova.jpg'), quality=90)


def run_stack(a, sk):
    """várias datas empilhadas: alinha cada uma à primeira, iguala as cores e tira a mediana pixel a pixel"""
    keys = a.dates.split(',')
    dss = [rasterio.open(cog_url(k)) for k in keys]
    de = dn = 0.0
    if a.offset:   # deslocamento já medido (leste, norte em metros), igual para a cena toda
        de, dn = map(float, a.offset.split(','))
        print(f'encaixe fixo: {de:+.1f} m leste, {dn:+.1f} m norte')
    elif a.align:   # um deslocamento só para todas as células pedidas (erro de posição da cena, quase uma translação)
        rc = [tuple(map(int, x.split('_'))) for x in a.cells.split(',')]
        bbox = (EXT['w'] + min(c for _, c in rc) * CLON, EXT['n'] - (max(r for r, _ in rc) + 1) * CLAT,
                EXT['w'] + (max(c for _, c in rc) + 1) * CLON, EXT['n'] - min(r for r, _ in rc) * CLAT)
        de, dn, info = s2_offset(bbox, dss[0].crs)
        print(info)
    for cell in a.cells.split(','):
        r, c = map(int, cell.split('_'))
        t0 = time.time()
        LON, LAT = cell_grid(r, c)
        X, Y = transform('EPSG:4326', dss[0].crs, LON.ravel().tolist(), LAT.ravel().tolist())
        X = np.array(X).reshape(TS, TS) + de; Y = np.array(Y).reshape(TS, TS) + dn
        imgs = [read_rgb(ds, X, Y, a.order) for ds in dss]
        ref = imgs[0]; refL = lum(ref); valid = ref.sum(-1) > 0
        stack, shifts = [], []
        for img in imgs:
            v = img.sum(-1) > 0
            if v.mean() < 0.5: continue
            if img is not ref:
                dy, dx = register(refL, lum(img))
                shifts.append(f'{dy:+.2f},{dx:+.2f}')
                yy, xx = np.mgrid[0:TS, 0:TS].astype(np.float32)
                img = np.stack([map_coordinates(img[..., k], [yy - dy, xx - dx], order=3, mode='nearest') for k in range(3)], -1)
            m = valid & (img.sum(-1) > 0)
            for k in range(3):   # cores de cada data iguais às da primeira
                img[..., k] = (img[..., k] - img[..., k][m].mean()) / max(img[..., k][m].std(), 1e-3) * ref[..., k][m].std() + ref[..., k][m].mean()
            stack.append(img)
        med = np.median(np.stack(stack), 0)
        if len(stack) > 1:
            # a primeira data (a mais recente) manda: as outras só entram onde mostram o mesmo (tiram ruído e névoa);
            # onde a terra mudou (colheita, desmate) ou há nuvem numa delas, a diferença é grande e fica a primeira
            dL = np.abs(lum(med) - lum(ref))
            wgt = np.exp(-(gaussian_filter(dL, 1.5) / 14.0) ** 2)[..., None]
            med = ref + wgt * (med - ref)
        if a.dehaze: med = dehaze(med, a.dehaze)
        if a.denoise: med, _ = denoise(med, a.denoise)
        if a.deconv: med = deconvolve(med, a.deconv * sk, a.deconv_k)
        out = match_to_base(med, base_tile(r, c), valid, sk)
        info = ''
        if a.deshadow:   # depois do casamento de cor: o bloco de 4 m também tem as sombras da hora da foto
            out, info = deshadow(out, LON, LAT, a.deshadow)
        if a.clarity: out = out + a.clarity * (out - np.stack([gaussian_filter(out[..., j], 6 * sk) for j in range(3)], -1))
        if a.unsharp: out = out + a.unsharp * (out - np.stack([gaussian_filter(out[..., j], 0.9 * sk) for j in range(3)], -1))
        im8 = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))
        name = f'c_{r}_{c}{a.tag}.jpg'
        if a.format in ('jpg', 'both'):
            im8.save(os.path.join(a.out, name), quality=a.quality, optimize=True, progressive=True)
        if a.format in ('webp', 'both'):
            im8.save(os.path.join(a.out, name[:-4] + '.webp'), quality=a.webp_quality, method=6)
        print(f'{name}: {len(stack)} datas, deslocamentos (px) {" ".join(shifts)} {info}, {time.time() - t0:.1f} s')
    for ds in dss: ds.close()


def sample_window(ds, band, X, Y, order):
    """lê de ds a janela que cobre as coordenadas (X, Y) e amostra a banda nelas"""
    win = from_bounds(X.min() - 40, Y.min() - 40, X.max() + 40, Y.max() + 40, ds.transform).round_offsets().round_lengths()
    src = ds.read(band, window=win, boundless=True, fill_value=0).astype(np.float32)
    wt = ds.window_transform(win)
    return map_coordinates(src, [(Y - wt.f) / wt.e - 0.5, (X - wt.c) / wt.a - 0.5], order=order, mode='nearest', prefilter=order > 1)


def match_to_base(img, base, valid, sk):
    """contraste de cada cor casado com o bloco atual e cor em escala > ~50 m trocada pela dele (sem emenda)"""
    out = img.copy()
    for k in range(3):
        s, b = img[..., k][valid], base[..., k][valid]
        out[..., k] = (img[..., k] - s.mean()) / max(s.std(), 1e-3) * b.std() + b.mean()
        out[..., k] += gaussian_filter(base[..., k], 25 * sk) - gaussian_filter(out[..., k], 25 * sk)
    fv = np.clip((gaussian_filter(valid.astype(np.float32), 15 * sk) - 0.5) * 2 + 0.5, 0, 1) * valid
    return out * fv[..., None] + base * (1 - fv[..., None])


def run_l4(a, sk):
    """fusão própria a partir das bandas originais: pancromática 2 m (BAND0) + vermelho/verde/azul 8 m (BAND3/2/1)"""
    os.environ.setdefault('GDAL_CACHEMAX', '1500')   # as linhas lidas para uma célula servem à vizinha da mesma fileira
    with rasterio.open(L4.format(0)) as pan, rasterio.open(L4.format(3)) as rr, rasterio.open(L4.format(2)) as gg, rasterio.open(L4.format(1)) as bb:
        for cell in a.cells.split(','):
            r, c = map(int, cell.split('_'))
            t0 = time.time()
            LON, LAT = cell_grid(r, c)
            X, Y = transform('EPSG:4326', pan.crs, LON.ravel().tolist(), LAT.ravel().tolist())
            X = np.array(X).reshape(TS, TS); Y = np.array(Y).reshape(TS, TS)
            P = sample_window(pan, 1, X, Y, a.order)
            ms = np.stack([sample_window(d, 1, X, Y, 3) for d in (rr, gg, bb)], -1)
            valid = (P > 0) & (ms.sum(-1) > 0)
            base = base_tile(r, c)
            Plow = gaussian_filter(P, 1.6 * sk)   # a pancromática vista como se fosse de 8 m
            outs = {
                '': ms * (P / np.maximum(Plow, 1.0))[..., None],                              # razão
                '_hpf': ms + (P - Plow)[..., None] * (ms.mean() / max(P.mean(), 1.0)),         # passa-alta
            }
            for suf, img in outs.items():
                out = match_to_base(img, base, valid, sk)
                if a.unsharp:
                    out = out + a.unsharp * (out - np.stack([gaussian_filter(out[..., j], 0.9 * sk) for j in range(3)], -1))
                name = f'c_{r}_{c}{a.tag}{suf}.jpg'
                Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).save(os.path.join(a.out, name), quality=a.quality, optimize=True, progressive=True)
            print(f'c_{r}_{c}{a.tag}: válido {valid.mean() * 100:.0f}%, {time.time() - t0:.1f} s')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cells', required=True)
    ap.add_argument('--out', default='data/muni/img/town')
    ap.add_argument('--gain', type=float, default=1.0, help='multiplica o ganho automático')
    ap.add_argument('--tag', default='')
    ap.add_argument('--mode', default='puro', choices=['detalhe', 'puro', 'l4', 'sheet', 'stack'],
                    help='detalhe · puro (2 m inteira, cor casada) · l4 (fusão própria) · sheet (folha de prova das datas) · stack (datas empilhadas; com 1 data = só a correção)')
    ap.add_argument('--dates', default='20260723_200_140', help='datas "AAAAMMDD_órbita_ponto" separadas por vírgula (sheet/stack)')
    ap.add_argument('--bbox', default='-44.2700,-21.6870,-44.2495,-21.6635', help='w,s,e,n da folha de prova')
    ap.add_argument('--dehaze', type=float, default=0.0, help='correção de névoa (0 = nenhuma, ~0,6 típico)')
    ap.add_argument('--clarity', type=float, default=0.0, help='contraste local (raio ~12 m)')
    ap.add_argument('--deconv', type=float, default=0.0, help='deconvolução: raio do borrão do sensor em px (0 = nenhuma, ~0,8)')
    ap.add_argument('--deconv-k', dest='deconv_k', type=float, default=0.02, help='regularização da deconvolução (maior = menos ruído)')
    ap.add_argument('--deshadow', type=float, default=0.0, help='correção das sombras da hora da foto, 0–1')
    ap.add_argument('--denoise', type=float, default=0.0, help='tira o granulado antes de realçar (h do non-local means em múltiplos do ruído, ~0,8)')
    ap.add_argument('--align', action='store_true', help='encaixa a CBERS na posição da Sentinel-2 antes de ler')
    ap.add_argument('--offset', default='', help='encaixe fixo "leste,norte" em metros (já medido; dispensa a Sentinel-2)')
    ap.add_argument('--checkalign', action='store_true', help='só mede o encaixe em cada célula de --cells (separadamente)')
    ap.add_argument('--format', default='jpg', choices=['jpg', 'webp', 'both'])
    ap.add_argument('--webp-quality', dest='webp_quality', type=int, default=82)
    ap.add_argument('--size', type=int, default=1024, help='lado do bloco em px (1024 ≈ 2 m, 2048 ≈ 1 m)')
    ap.add_argument('--order', type=int, default=1, help='interpolação ao reprojetar: 1 linear, 3 bicúbica')
    ap.add_argument('--unsharp', type=float, default=0.0, help='nitidez aplicada no arquivo (0 = nenhuma)')
    ap.add_argument('--quality', type=int, default=85)
    ap.add_argument('--inspect', action='store_true', help='só mostra a organização dos arquivos L4 e estima a leitura')
    a = ap.parse_args()
    if a.inspect:
        return inspect_l4(a.cells)
    if a.checkalign:   # o deslocamento é o mesmo na cena toda? mede célula por célula
        with rasterio.open(COG) as ds:
            for cell in a.cells.split(','):
                r, c = map(int, cell.split('_'))
                bbox = (EXT['w'] + c * CLON, EXT['n'] - (r + 1) * CLAT, EXT['w'] + (c + 1) * CLON, EXT['n'] - r * CLAT)
                print(cell, s2_offset(bbox, ds.crs)[2])
        return
    global TS
    TS = a.size
    sk = TS / 1024   # os raios dos filtros acompanham o tamanho do bloco
    os.makedirs(a.out, exist_ok=True)
    if a.mode == 'l4':
        return run_l4(a, sk)
    if a.mode == 'sheet':
        return run_sheet(a)
    if a.mode == 'stack':
        return run_stack(a, sk)
    os.environ.setdefault('GDAL_DISABLE_READDIR_ON_OPEN', 'EMPTY_DIR')
    os.environ.setdefault('GDAL_HTTP_MULTIRANGE', 'YES')
    with rasterio.Env(), rasterio.open(COG) as ds:
        print('COG', ds.width, 'x', ds.height, ds.crs, 'res', ds.res, 'bandas', ds.count, ds.dtypes[0], 'compressão', ds.compression)
        for cell in a.cells.split(','):
            r, c = map(int, cell.split('_'))
            t0 = time.time()
            LON, LAT = cell_grid(r, c)
            X, Y = transform('EPSG:4326', ds.crs, LON.ravel().tolist(), LAT.ravel().tolist())
            X = np.array(X).reshape(TS, TS); Y = np.array(Y).reshape(TS, TS)
            m = 40.0
            win = from_bounds(X.min() - m, Y.min() - m, X.max() + m, Y.max() + m, ds.transform).round_offsets().round_lengths()
            src = ds.read([1, 2, 3], window=win, boundless=True, fill_value=0).astype(np.float32)   # (3, h, w)
            wt = ds.window_transform(win)
            cols = (X - wt.c) / wt.a - 0.5
            rows = (Y - wt.f) / wt.e - 0.5
            hi = np.stack([map_coordinates(src[k], [rows, cols], order=a.order, mode='nearest', prefilter=a.order > 1) for k in range(3)], -1)
            valid = hi.sum(-1) > 0
            base = base_tile(r, c)
            L2, LB = lum(hi), lum(base)
            detail = (L2 - gaussian_filter(L2, 1.5)) * valid
            ref = np.percentile(np.abs(LB - gaussian_filter(LB, 3)), 90)
            cur = np.percentile(np.abs(L2[valid] - gaussian_filter(L2, 3)[valid]), 90) if valid.any() else 1
            gain = a.gain * ref / max(cur, 1e-3)
            if a.mode == 'puro':
                # a imagem de 2 m inteira: contraste de cada cor casado com o bloco atual, e a cor em escala maior
                # que ~50 m (sigma de 25 px) trocada pela do bloco — assim a borda da célula tem a mesma cor dos
                # vizinhos de 4 m (sem degrau) e da imagem de 2 m fica a textura e o detalhe
                out = hi.copy()
                for k in range(3):
                    s, b = hi[..., k][valid], base[..., k][valid]
                    out[..., k] = (hi[..., k] - s.mean()) / max(s.std(), 1e-3) * b.std() + b.mean()
                for k in range(3):
                    out[..., k] += gaussian_filter(base[..., k], 25 * sk) - gaussian_filter(out[..., k], 25 * sk)
                # onde a cena não cobre, o bloco de 4 m, com transição suave de ~60 m
                fv = np.clip((gaussian_filter(valid.astype(np.float32), 15 * sk) - 0.5) * 2 + 0.5, 0, 1) * valid
                out = out * fv[..., None] + base * (1 - fv[..., None])
                if a.unsharp:   # nitidez no próprio arquivo (máscara de desfoque, raio ~1 px de 2 m)
                    out = out + a.unsharp * (out - np.stack([gaussian_filter(out[..., j], 0.9 * sk) for j in range(3)], -1))
                out = np.clip(out, 0, 255).astype(np.uint8)
            else:
                low = np.stack([gaussian_filter(base[..., k], 0.8) for k in range(3)], -1)
                out = np.clip(low + gain * detail[..., None], 0, 255).astype(np.uint8)
            name = f'c_{r}_{c}{a.tag}.jpg'
            Image.fromarray(out).save(os.path.join(a.out, name), quality=a.quality, optimize=True, progressive=True)
            print(f'{name}: janela {int(win.width)}x{int(win.height)} px, válido {valid.mean() * 100:.0f}%, ganho {gain:.2f}, {time.time() - t0:.1f} s')


if __name__ == '__main__':
    main()
