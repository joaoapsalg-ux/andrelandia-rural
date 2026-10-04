"""Imóveis rurais do CAR (SICAR, camada sicar:sicar_imoveis_mg) na extensão do mapa.

Simplifica os contornos (~2 m), classifica por tamanho em módulos fiscais e gera estatísticas
dos imóveis declarados em Andrelândia.
Saídas: data/muni/layers/car.json · estatísticas impressas
Uso: python3 tools/build_car.py
"""
import gzip, json
from collections import Counter
from shapely.geometry import shape
import os
RAW = os.environ.get('ANDRELANDIA_RAW', os.path.join(os.path.expanduser('~'), 'Downloads')) + os.sep   # arquivos brutos baixados

src = json.loads(gzip.decompress(open(RAW + 'andrelandia_car.json.gz', 'rb').read()))
STATUS = {'AT': 'ativo', 'PE': 'pendente', 'SU': 'suspenso', 'CA': 'cancelado'}


def size_class(mf):
    if mf < 1: return 'mini'
    if mf <= 4: return 'pequena'
    if mf <= 15: return 'media'
    return 'grande'


feats, st = [], Counter()
area = Counter()
for f in src['features']:
    p = f['properties']
    g = shape(f['geometry']).simplify(0.00002, preserve_topology=True)
    polys = list(g.geoms) if g.geom_type == 'MultiPolygon' else [g]
    rings = [[[round(y, 6), round(x, 6)] for x, y in poly.exterior.coords] for poly in polys if not poly.is_empty]
    sc = size_class(p['m_fiscal'] or 0)
    feats.append({'cod': p['cod_imovel'], 'ha': round(p['area'], 2), 'mf': round(p['m_fiscal'] or 0, 2), 'cls': sc,
                  'status': STATUS.get(p['status_imovel'], p['status_imovel']), 'cond': p['condicao'],
                  'mun': p['municipio'], 'atualizado': (p.get('data_atualizacao') or '')[:10], 'rings': rings})
    if p['municipio'] == 'Andrelândia' and p['status_imovel'] != 'CA':
        st[sc] += 1; area[sc] += p['area']
json.dump({'source': 'SICAR — Cadastro Ambiental Rural (geoserver.car.gov.br), consulta pública', 'features': feats,
           'stats_andrelandia': {k: {'n': st[k], 'ha': round(area[k], 1)} for k in ['mini', 'pequena', 'media', 'grande']}},
          open('data/muni/layers/car.json', 'w'), separators=(',', ':'), ensure_ascii=False)
print(len(feats), 'imóveis;', 'Andrelândia:', {k: (st[k], round(area[k])) for k in st}, 'total ha', round(sum(area.values())))
