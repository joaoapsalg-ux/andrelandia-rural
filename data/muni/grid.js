// Grade geográfica do município — compartilhada com tools/build_muni_tiles.py.
// Células de ~2,1 × 2,3 km; imagens em blocos de 2 × 2 células.

export const EXTENT = { w: -44.51, e: -44.06, n: -21.53, s: -21.94 };
export const COLS = 22, ROWS = 20;

export const IMAGERY_SETS = [
  {
    id: 'cbers', name: 'CBERS-4A', res: '2 m cidade · 4 m',
    source: 'CBERS-4A WPM (INPE, CC BY 4.0), 23/07/2026, órbitas 200/140 e 200/141, com a cor da Sentinel-2 de 18/08/2026',
    tile: (ty, tx) => `data/muni/img/cbers/t_${ty}_${tx}.jpg`,
    town: (r, c) => `data/muni/img/town/c_${r}_${c}.jpg`,
  },
];
export const OVERVIEW = 'data/muni/img/overview.jpg';
// células com imagem de 2 m (geradas por tools/build_muni_tiles.py → img/town.json)
export const TOWN_CELLS = new Set(["9_8", "9_9", "9_10", "9_11", "10_8", "10_9", "10_10", "10_11", "11_8", "11_9", "11_10", "11_11", "12_8", "12_9", "12_10", "12_11"]);
