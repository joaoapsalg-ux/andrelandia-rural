"""Funde a imagem CBERS-4A (2 m / 4 m) com a Sentinel-2 (10 m).

Cor e brilho vêm da Sentinel-2 L2A (corrigida da atmosfera, sem névoa);
o detalhe fino (bordas, telhados, ruas) vem da CBERS-4A WPM.
    saída = suave(S2) + ganho · (L_cbers − suave(L_cbers))
Assim a névoa e a dominante arroxeada da CBERS (variações lentas) somem,
e fica só a textura de alta frequência dela.

Uso: python3 tools/fuse_imagery.py
"""
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, map_coordinates
import os
RAW = os.environ.get('ANDRELANDIA_RAW', os.path.join(os.path.expanduser('~'), 'Downloads')) + os.sep   # arquivos brutos baixados

UP = RAW
S2 = dict(path=UP + 'andrelandia_sentinel2.jpg', E0=563380, N1=7600650, res=10)
JOBS = [
    dict(path=UP + 'andrelandia_cbers_4m.jpg', E0=563378, N1=7600652, res=4, out='data/layers/cbers_4m.jpg'),
    dict(path=UP + 'andrelandia_cbers_2m.jpg', E0=568500, N1=7597500, res=2, out='data/layers/cbers_2m.jpg'),
]
# mesmo realce usado na camada Sentinel-2 (tools: lo/hi/gama/saturação)
LO, HI, GAMMA, SAT = 11.0, 201.0, 0.8, 1.1

s2 = np.asarray(Image.open(S2['path'])).astype(np.float32)

def lum(a):
    return a[..., 0] * 0.299 + a[..., 1] * 0.587 + a[..., 2] * 0.114

for job in JOBS:
    cb = np.asarray(Image.open(job['path'])).astype(np.float32)
    h, w, _ = cb.shape
    # coordenadas (fracionárias) da S2 para cada pixel CBERS (centros), mesma zona UTM
    jj, ii = np.mgrid[0:h, 0:w].astype(np.float32)
    E = job['E0'] + (ii + 0.5) * job['res']
    N = job['N1'] - (jj + 0.5) * job['res']
    si = (E - S2['E0']) / S2['res'] - 0.5
    sj = (S2['N1'] - N) / S2['res'] - 0.5
    s2up = np.stack([map_coordinates(s2[..., c], [sj, si], order=1, mode='nearest') for c in range(3)], -1)

    sigma = 10.0 / job['res']                      # escala de ~10 m em pixels
    low_s2 = np.stack([gaussian_filter(s2up[..., c], sigma * 0.6) for c in range(3)], -1)
    L = lum(cb)
    detail = L - gaussian_filter(L, sigma)
    # ganho: casa a amplitude de contraste local da CBERS com a da S2 (robusto, por percentis)
    s2L = lum(s2up)
    ref = np.percentile(np.abs(s2L - gaussian_filter(s2L, sigma * 2)), 90)
    cur = np.percentile(np.abs(L - gaussian_filter(L, sigma * 2)), 90)
    gain = 1.05 * ref / max(cur, 1e-3)
    fused = low_s2 + gain * detail[..., None]

    out = np.clip((fused - LO) / (HI - LO), 0, 1) ** GAMMA
    g = out.mean(-1, keepdims=True)
    out = np.clip(g + (out - g) * SAT, 0, 1)
    Image.fromarray((out * 255).astype(np.uint8)).save(job['out'], quality=86, optimize=True, progressive=True)
    print(job['out'], w, h, 'ganho %.2f' % gain)
