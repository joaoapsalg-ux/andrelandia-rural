"""Prepara as camadas vetoriais do município a partir do OSM baixado.

Saídas (data/muni/layers/):
  boundary.json   contorno do município (anel lat/lon simplificado)
  places.json     localidades, picos e mirantes nomeados, com flag "dentro do município"
  osm.json        vias, ferrovia, rios e edificações (sem nós de lugares)
Uso: python3 tools/build_muni_vectors.py
"""
import json
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import linemerge, polygonize, unary_union
import os
RAW = os.environ.get('ANDRELANDIA_RAW', os.path.join(os.path.expanduser('~'), 'Downloads')) + os.sep   # arquivos brutos baixados

src = json.load(open(RAW + 'municipio_osm.json'))

# --- contorno: junta os trechos (lon, lat) e poligoniza ---
lines = [LineString([(p[1], p[0]) for p in w['geom']]) for w in src['boundary'] if len(w['geom']) > 1]
polys = list(polygonize(unary_union(lines)))
poly = max(polys, key=lambda p: p.area)
simple = poly.simplify(0.00015, preserve_topology=True)  # ~15 m
ring = [[round(y, 6), round(x, 6)] for x, y in simple.exterior.coords]
area_km2 = poly.area * (111.32 * 0.9289) * 110.6  # aproximação em 21,7°S
json.dump({'name': 'Andrelândia', 'ibge': '3102803', 'area_km2': round(area_km2, 1), 'ring': ring},
          open('data/muni/layers/boundary.json', 'w'), separators=(',', ':'))
print('contorno:', len(ring), 'vértices; área ≈ %.0f km²' % area_km2)

# --- lugares ---
KIND = {'town': 'cidade', 'village': 'vila', 'hamlet': 'povoado', 'locality': 'localidade',
        'isolated_dwelling': 'localidade', 'peak': 'pico', 'viewpoint': 'mirante', 'camp_site': 'atrativo'}
places, seen = [], set()
for f in src['features']:
    if f['kind'] not in ('place', 'peak', 'tourism') or not f.get('name'):
        continue
    k = KIND.get(f['sub'])
    if not k or (f['name'], k) in seen and k != 'localidade':
        continue
    lat, lon = f['pt'] if 'pt' in f else f['geom'][0][0]
    seen.add((f['name'], k))
    ele = f.get('ele')
    places.append({'id': f['id'], 'name': f['name'], 'kind': k, 'lat': lat, 'lon': lon,
                   'ele': float(ele) if ele else None, 'inside': poly.contains(Point(lon, lat)), 'src': 'osm'})
json.dump(places, open('data/muni/layers/places.json', 'w'), ensure_ascii=False, indent=0)
print('lugares:', len(places), '(dentro:', sum(p['inside'] for p in places), ')')
print([p['name'] for p in places if p['kind'] in ('vila', 'cidade')], [(p['name'], p['inside']) for p in places if p['kind'] == 'vila'])

# --- vias, ferrovia, rios, edificações ---
keep = [f for f in src['features'] if f['kind'] in ('highway', 'railway', 'waterway', 'building', 'water')
        and not (f['kind'] == 'railway' and f['sub'] != 'rail') and 'geom' in f]
json.dump({'source': src['source'], 'date': src['date'], 'features': keep},
          open('data/muni/layers/osm.json', 'w'), separators=(',', ':'), ensure_ascii=False)
print('vetores:', len(keep))
