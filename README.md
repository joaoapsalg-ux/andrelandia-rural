# Andrelândia Rural — v1.1

O município de Andrelândia (MG) em 3D para quem vive da terra. Derivado do "Andrelândia 3D" v0.8
(guardado em `andrelandia3d-v0.8/`), mais leve e com visualizações novas. Three.js, sem etapa de build.

## O que tem

| Recurso | Como funciona |
|---|---|
| Sua propriedade | busca pelo código do CAR (ou parte dele), toque no mapa, "É a minha" guarda no navegador |
| Ficha | 1985→2025 em gráfico, sol no inverno/verão, baixada fria, uso do solo, relevo, córregos, APP estimada |
| Máquina do tempo | uso do solo ano a ano, 1985–2025 (41 mapas MapBiomas 30 m), com play e transição entre anos no shader |
| Antes e depois | divisória arrastável: à esquerda o uso do solo de um ano antigo, à direita o chão escolhido |
| Correnteza | traços animados descendo os córregos (dashOffset do LineMaterial) |
| Gota de chuva | toque → segue a direção do escoamento D8 até sair do mapa; conta córregos, rios e a saída do município |
| Sol no inverno / verão | kWh/m²/dia de sol direto em 21/jun e 21/dez, céu limpo, com sombra do horizonte |
| Geada | baixadas onde o ar frio se acumula (ilustrativo) |
| Perfil | dois toques → corte do terreno com subida, descida e rampa mais forte |
| Sobrevoo | a câmera dá a volta na propriedade ou no ponto central da vista |
| Sombras dos morros | opcional, desligadas por padrão |

Removido em relação à v0.8: Strava, modelo Copernicus, imagem Sentinel-2 alternativa, árvores 3D, superfície de copas,
uso do solo de 10 m, leitura UTM. A ficha não mostra rotas pessoais.

## Arquivos

```
src/main.js        montagem, ferramentas, máquina do tempo, painéis
src/car.js         propriedades: cores por critério, ficha, busca, gráfico histórico
src/water.js       gota de chuva (D8) e animação
src/profile.js     perfil do terreno
src/cellterrain.js terreno; shader com mistura de anos, sol, geada e divisória antes/depois
src/vectors.js     linhas sobre o relevo; animate() move a correnteza
tools/build_rural.py      fdir.png, solgeada.png e campos novos no car.json (sol, gea)
tools/build_landuse41.py  41 PNGs do MapBiomas, hist.json (município) e car_hist.json (por propriedade)
serve.py                  servidor local (acrescenta o esqueleto HTML ao index.html)
```

`solgeada.png` (grade do ANADEM): R = sol no inverno × 25, G = sol no verão × 25 (kWh/m²/dia), B = índice de geada × 255.
`fdir.png`: 0 = sem saída, 1–8 = vizinho na ordem (−1,−1) (−1,0) (−1,1) (0,−1) (0,1) (1,−1) (1,0) (1,1).

## Fontes

ANADEM v1.0 (UFRGS/ANA); CBERS-4A (INPE, CC BY 4.0) com cor da Sentinel-2 (ESA); MapBiomas Coleção 11;
SICAR (consulta pública); OpenStreetMap (ODbL).
