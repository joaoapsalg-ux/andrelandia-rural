// Pontos de interesse. `src` indica a origem da coordenada:
//   'osm'    → OpenStreetMap (nó existente)
//   'aprox'  → estimada a partir do print do mapa; refinar com GPS ou carta
export default [
  { id: 'centro',  name: 'Andrelândia',            kind: 'cidade',   lat: -21.74016, lon: -44.30906, src: 'osm' },
  { id: 'mirante', name: 'Mirante da Torre',       kind: 'mirante',  lat: -21.75530, lon: -44.31150, src: 'osm' },
  { id: 'tv',      name: 'Mirante da Torre de TV', kind: 'mirante',  lat: -21.76016, lon: -44.30875, src: 'osm' },
  { id: 'melipo',  name: 'Meliponário Mel Mágico', kind: 'atrativo', lat: -21.76970, lon: -44.32150, src: 'aprox' },
  { id: 'stoant',  name: 'Capela de Santo Antônio', kind: 'igreja',  lat: -21.77580, lon: -44.33125, src: 'osm' },
  { id: 'turvo',   name: 'Pico do Turvo',          kind: 'pico',     lat: -21.81768, lon: -44.34391, src: 'osm', ele: 1489 },
];
