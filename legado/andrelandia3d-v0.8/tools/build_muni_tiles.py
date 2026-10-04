"""Gera as imagens em blocos do município (grade geográfica compartilhada com o app).

Grade: extensão W -44.51 / E -44.06 / N -21.53 / S -21.94, 22 × 20 células, blocos de 2 × 2 células.
Saídas (data/muni/img/):
  cbers/t_{ty}_{tx}.jpg   1024² · ~4 m  · fusão CBERS-4A (detalhe) + Sentinel-2 (cor)
  s2/t_{ty}_{tx}.jpg      512²  · ~8 m  · Sentinel-2
  town/c_{r}_{c}.jpg      1024² · ~2 m  · células da cidade (CBERS 2 m já fundida + 4 m ao redor)
  overview.jpg            2048 × 2000   · município inteiro (vista distante)
Uso: python3 tools/build_muni_tiles.py
"""
import glob, json, math, os
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, map_coordinates
import os
RAW = os.environ.get('ANDRELANDIA_RAW', os.path.join(os.path.expanduser('~'), 'Downloads')) + os.sep   # arquivos brutos baixados

Image.MAX_IMAGE_PIXELS = None
UP = RAW
OUT = 'data/muni/img'
EXT = dict(w=-44.51, e=-44.06, n=-21.53, s=-21.94)
COLS, ROWS = 22, 20
CLON = (EXT['e'] - EXT['w']) / COLS
CLAT = (EXT['n'] - EXT['s']) / ROWS
TX, TY = COLS // 2, ROWS // 2

S2 = dict(E0=550390, N1=7619320, res=10)
CB4 = dict(E0=550390, N1=7619320, res=4)
CB2 = dict(E0=568500, N1=7597500, res=2, path='data/layers/cbers_2m.jpg')  # já fundida (v0.4)
LO, HI, GAMMA, SAT = 11.0, 201.0, 0.8, 1.1
GAIN4 = 2.0


def utm(lat, lon, zone=23):
    a = 6378137.0; f = 1 / 298.257222101; k0 = 0.9996
    l0 = math.radians((zone - 1) * 6 - 180 + 3)
    p = np.radians(lat); l = np.radians(lon)
    e2 = f * (2 - f); ep2 = e2 / (1 - e2)
    N = a / np.sqrt(1 - e2 * np.sin(p) ** 2); T = np.tan(p) ** 2; C = ep2 * np.cos(p) ** 2; A = np.cos(p) * (l - l0)
    M = a * ((1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * p - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * np.sin(2 * p)
             + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * np.sin(4 * p) - (35 * e2 ** 3 / 3072) * np.sin(6 * p))
    E = k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T ** 2 + 72 * C - 58 * ep2) * A ** 5 / 120) + 500000
    Nn = k0 * (M + N * np.tan(p) * (A ** 2 / 2 + (5 - T + 9 * C + 4 * C ** 2) * A ** 4 / 24
                                    + (61 - 58 * T + T ** 2 + 600 * C - 330 * ep2) * A ** 6 / 720)) + 1e7
    return E, Nn


def sample(img, geo, E, N):
    """amostra bilinear (H,W,3) em coordenadas UTM; devolve float32 e máscara de dado válido"""
    si = (E - geo['E0']) / geo['res'] - 0.5
    sj = (geo['N1'] - N) / geo['res'] - 0.5
    out = np.stack([map_coordinates(img[..., c], [sj, si], order=1, mode='nearest') for c in range(3)], -1).astype(np.float32)
    valid = (si >= 0) & (sj >= 0) & (si <= img.shape[1] - 1) & (sj <= img.shape[0] - 1) & (out.sum(-1) > 0)
    return out, valid


def lum(a):
    return a[..., 0] * 0.299 + a[..., 1] * 0.587 + a[..., 2] * 0.114


def finish(a):
    o = np.clip((a - LO) / (HI - LO), 0, 1) ** GAMMA
    g = o.mean(-1, keepdims=True)
    return (np.clip(g + (o - g) * SAT, 0, 1) * 255).astype(np.uint8)


def grid(lat_n, lat_s, lon_w, lon_e, w, h, margin=0):
    dlon = (lon_e - lon_w) / w; dlat = (lat_n - lat_s) / h
    ii = np.arange(-margin, w + margin) + 0.5; jj = np.arange(-margin, h + margin) + 0.5
    lon = lon_w + ii * dlon; lat = lat_n - jj * dlat
    LON, LAT = np.meshgrid(lon, lat)
    return utm(LAT, LON)


def fuse(cb, s2, E, N, res, gain, margin):
    c, cv = sample(cb, CB4 if res >= 4 else CB2, E, N)
    s, _ = sample(s2, S2, E, N)
    sigma = 10.0 / res
    low = np.stack([gaussian_filter(s[..., k], sigma * 0.6) for k in range(3)], -1)
    L = lum(c)
    det = (L - gaussian_filter(L, sigma)) * cv
    f = low + gain * det[..., None]
    if margin:
        f = f[margin:-margin, margin:-margin]
    return f


def main():
    os.makedirs(f'{OUT}/cbers', exist_ok=True); os.makedirs(f'{OUT}/s2', exist_ok=True); os.makedirs(f'{OUT}/town', exist_ok=True)
    print('lendo Sentinel-2…')
    s2 = np.asarray(Image.open(UP + 'municipio_sentinel2.jpg')).astype(np.float32)
    print('lendo faixas CBERS 4 m…')
    strips = sorted(glob.glob(UP + 'municipio_cbers4m_*.jpg'), key=lambda p: int(p.rsplit('_', 1)[1].split('.')[0]))
    cb = np.concatenate([np.asarray(Image.open(p)) for p in strips], 0)
    print('CBERS', cb.shape)

    TS, M = 1024, 32
    mosaic = np.zeros((TY * 400, TX * 400, 3), np.uint8)  # para a visão geral
    for ty in range(TY):
        for tx in range(TX):
            n = EXT['n'] - ty * 2 * CLAT; s_ = n - 2 * CLAT
            w = EXT['w'] + tx * 2 * CLON; e = w + 2 * CLON
            E, N = grid(n, s_, w, e, TS, TS, M)
            f = fuse(cb, s2, E, N, 4, GAIN4, M)
            img = finish(f)
            Image.fromarray(img).save(f'{OUT}/cbers/t_{ty}_{tx}.jpg', quality=80, optimize=True, progressive=True)
            mosaic[ty * 400:(ty + 1) * 400, tx * 400:(tx + 1) * 400] = np.asarray(Image.fromarray(img).resize((400, 400), Image.LANCZOS))
            E2, N2 = grid(n, s_, w, e, 512, 512)
            s, _ = sample(s2, S2, E2, N2)
            Image.fromarray(finish(s)).save(f'{OUT}/s2/t_{ty}_{tx}.jpg', quality=82, optimize=True, progressive=True)
        print('linha', ty, 'ok')
    Image.fromarray(mosaic).resize((2048, 2000), Image.LANCZOS).save(f'{OUT}/overview.jpg', quality=85, optimize=True, progressive=True)

    # células da cidade em 2 m: as que tocam o recorte de 2 m
    cb2 = np.asarray(Image.open(CB2['path'])).astype(np.float32)
    E0, E1, N0, N1 = CB2['E0'], CB2['E0'] + 3000 * 2, CB2['N1'] - 3000 * 2, CB2['N1']
    town = []
    for r in range(ROWS):
        for c in range(COLS):
            n = EXT['n'] - r * CLAT; s_ = n - CLAT; w = EXT['w'] + c * CLON; e = w + CLON
            cE, cN = utm(np.array([n, n, s_, s_]), np.array([w, e, w, e]))
            if cE.max() < E0 or cE.min() > E1 or cN.max() < N0 or cN.min() > N1:
                continue
            E, N = grid(n, s_, w, e, 1024, 1024)
            hi, hv = sample(cb2, CB2, E, N)          # já está no espaço de cor final
            # fora do recorte de 2 m: bloco de 4 m correspondente
            ty, tx = r // 2, c // 2
            t4 = np.asarray(Image.open(f'{OUT}/cbers/t_{ty}_{tx}.jpg')).astype(np.float32)
            oy, ox = (r % 2) * 512, (c % 2) * 512
            lo = np.asarray(Image.fromarray(t4[oy:oy + 512, ox:ox + 512].astype(np.uint8)).resize((1024, 1024), Image.BICUBIC)).astype(np.float32)
            # borda suave de ~60 m entre os dois
            m = gaussian_filter(hv.astype(np.float32), 15)
            m = np.clip((m - 0.5) * 2 + 0.5, 0, 1) * hv
            out = hi * m[..., None] + lo * (1 - m[..., None])
            Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).save(f'{OUT}/town/c_{r}_{c}.jpg', quality=82, optimize=True, progressive=True)
            town.append([r, c])
    json.dump({'town': town}, open(f'{OUT}/town.json', 'w'))
    print('cidade:', len(town), 'células')


if __name__ == '__main__':
    main()
