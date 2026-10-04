// Uso e cobertura do solo — MapBiomas Brasil.
// Coleção 11 (30 m, 1985–2025). Códigos e cores: legenda oficial da Coleção 11
// (classes 19 e 36 só existem na legenda de 10 m).
// 41 anos: 1985–2025 (um PNG de 8 bits por ano, códigos de classe)
export const LANDUSE_LAYERS = Array.from({ length: 41 }, (_, i) => {
  const year = 1985 + i;
  return { id: String(year), year, res: '30 m', url: `data/muni/landuse/lc30_${year}.png`, grid: 'g30' };
});

// canto superior esquerdo + tamanho do pixel (graus)
export const GRIDS = {
  g30: { w: 1671, h: 1522, lon0: -44.51026468672453, lat0: -21.529922414492574, d: 0.00026949458523585647 },
  g10: { w: 5011, h: 4565, lon0: -44.51008502366769, lat0: -21.52992241449257, d: 0.00008983152841195215 },
};

export const CLASSES = {
  3: ['Formação florestal', '#1f8d49'],
  4: ['Formação savânica', '#7dc975'],
  11: ['Campo alagado e área pantanosa', '#519799'],
  12: ['Formação campestre', '#d6bc74'],
  29: ['Afloramento rochoso', '#ad5100'],
  15: ['Pastagem', '#edde8e'],
  19: ['Lavoura temporária', '#c27ba0'],
  41: ['Outras lavouras temporárias', '#f54ca9'],
  36: ['Lavoura perene', '#d082de'],
  46: ['Café', '#d68fe2'],
  47: ['Citrus', '#9932cc'],
  48: ['Outras lavouras perenes', '#e6ccff'],
  9: ['Silvicultura (eucalipto)', '#7a5900'],
  21: ['Mosaico de usos', '#ffefc3'],
  24: ['Área urbanizada', '#d4271e'],
  30: ['Mineração', '#9c0027'],
  25: ['Outras áreas não vegetadas', '#db4d4f'],
  33: ['Rio, lago', '#2532e4'],
  31: ['Aquicultura', '#091077'],
};

// classes com árvores (para posicionar árvores 3D)
export const TREE_CLASSES = new Set([3, 4, 9]);

export const LANDUSE_SOURCE = 'MapBiomas Brasil — Coleção 11 (30 m) e Coleção 4 de 10 m, bucket público mapbiomas-public';
