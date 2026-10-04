"""Rotas do Strava na área do município (a partir da lista de atividades com polilinha reduzida).

Entrada: data/raw/strava/acts_*.json (resposta de list_activities com include_polyline)
Saída:   data/muni/layers/strava.json
Uso: python3 tools/build_strava.py
"""
import glob, json

B = dict(s=-21.94, w=-44.51, n=-21.53, e=-44.06)


def decode(s):
    idx = lat = lng = 0; pts = []
    while idx < len(s):
        for which in (0, 1):
            shift = res = 0
            while True:
                b = ord(s[idx]) - 63; idx += 1; res |= (b & 0x1f) << shift; shift += 5
                if b < 0x20: break
            dv = ~(res >> 1) if res & 1 else res >> 1
            if which == 0: lat += dv
            else: lng += dv
        pts.append([round(lat / 1e5, 5), round(lng / 1e5, 5)])
    return pts


seen, out = set(), []
for f in glob.glob('data/raw/strava/acts_*.json'):
    for a in json.load(open(f))['activities']:
        p = a.get('reduced_polyline')
        if not p or a['id'] in seen: continue
        pts = decode(p)
        inside = sum(B['s'] <= la <= B['n'] and B['w'] <= lo <= B['e'] for la, lo in pts)
        if inside < len(pts) * 0.5: continue
        seen.add(a['id'])
        s = a['summary']
        out.append({'id': a['id'], 'name': a['name'].strip(), 'sport': a['sport_type'], 'date': a['start_local'],
                    'km': round(s['distance'] / 1000, 2), 'moving_s': s['moving_time'], 'gain_m': round(s.get('elevation_gain') or 0),
                    'pts': pts})
out.sort(key=lambda a: a['date'])
json.dump({'source': 'Strava — atividades do atleta (polilinha reduzida)', 'activities': out},
          open('data/muni/layers/strava.json', 'w'), separators=(',', ':'), ensure_ascii=False)
from collections import Counter
print(len(out), 'atividades', Counter(a['sport'] for a in out), '%.0f km' % sum(a['km'] for a in out),
      out[0]['date'][:10], '→', out[-1]['date'][:10], sum(len(a['pts']) for a in out), 'pontos')
