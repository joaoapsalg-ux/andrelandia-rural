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
    ap.add_argument('--mode', default='puro', choices=['detalhe', 'puro', 'l4'], help='detalhe: cor atual + detalhe dos 2 m · puro: 2 m inteira, cor casada · l4: fusão própria das bandas originais')
    ap.add_argument('--size', type=int, default=1024, help='lado do bloco em px (1024 ≈ 2 m, 2048 ≈ 1 m)')
    ap.add_argument('--order', type=int, default=1, help='interpolação ao reprojetar: 1 linear, 3 bicúbica')
    ap.add_argument('--unsharp', type=float, default=0.0, help='nitidez aplicada no arquivo (0 = nenhuma)')
    ap.add_argument('--quality', type=int, default=85)
    ap.add_argument('--inspect', action='store_true', help='só mostra a organização dos arquivos L4 e estima a leitura')
    a = ap.parse_args()
    if a.inspect:
        return inspect_l4(a.cells)
    global TS
    TS = a.size
    sk = TS / 1024   # os raios dos filtros acompanham o tamanho do bloco
    os.makedirs(a.out, exist_ok=True)
    if a.mode == 'l4':
        return run_l4(a, sk)
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
