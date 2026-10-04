// Configuração central. Para trocar a fonte de relevo, mude `terrain.source`.
export default {
  region: {
    name: 'Andrelândia',
    state: 'MG',
    // origem do sistema local de coordenadas: Igreja Matriz (centro da cidade)
    origin: { lat: -21.74016, lon: -44.30906 },
  },
  terrain: {
    // modelos de relevo: data/muni/models.js · grade e imagens: data/muni/grid.js
    // (src/sources/terrarium.js baixa tiles na hora, útil só fora do claude.ai)
    baseElevation: 900,          // m — nível zero da cena (igual para todos os modelos)
    colorRange: [910, 1660],     // m — faixa da rampa hipsométrica (igual para todos os modelos)
    contourInterval: 20, // m — equidistância das cartas IBGE 1:50.000
  },
  camera: {
    // vista inicial: de sudeste, olhando a cidade e a serra das torres
    position: { x: 3600, y: 1500, z: 6000 },
    target: { x: -400, y: 150, z: 1500 },
  },
};
