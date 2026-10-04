// Modelos de relevo do município (PNG Terrarium: R·256 + G + B/256 − 32768; linha 0 = norte).
export default [
  {
    id: 'anadem', name: 'ANADEM', kind: 'MDT', kindLabel: 'terreno sem vegetação', res: '30 m',
    note: 'Remove a altura das árvores do Copernicus. Melhor para ver o chão, trilhas e drenagem.',
    source: 'ANADEM v1.0 · UFRGS/ANA, 2024 · derivado do Copernicus GLO-30',
    url: 'data/muni/dem/anadem.png', width: 1671, height: 1522,
    georef: { type: 'geographic', lon0: -44.510264686724526, lat0: -21.529922414492574, dLon: 0.00026949458523585647, dLat: -0.00026949458523585647 },
  },
];
