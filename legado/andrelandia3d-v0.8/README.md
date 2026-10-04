# Andrelândia 3D — v0.8 (município, uso do solo, copas, luz, Strava e CAR com ficha e APP estimada)

Navegador 3D do município de Andrelândia (MG, IBGE 3102803, 1.002 km²), em Three.js, sem etapa de build.

## Estrutura

```
index.html                    interface (camadas, leitura de coordenadas, bússola, escala)
src/main.js                   montagem da cena, seletores, voo, leitura do cursor
src/cellterrain.js            terreno em 22 × 20 células (~2 km) com LOD 72/36/18/9 e saias;
                              imagens carregadas sob demanda (visão geral → 4 m → 2 m)
src/heightfield.js            grade de altitudes georreferenciada (contrato dados ↔ 3D)
src/sources/png.js            lê MDE em PNG Terrarium (R·256 + G + B/256 − 32768)
src/vectors.js                vias, ferrovia, rios, córregos, edificações e limite municipal
src/pois.js                   rótulos com distância máxima por tipo
src/sun.js                    posição do sol (NOAA), cores do céu e da luz
src/trees.js                  árvores 3D (instanciadas) nas matas e eucaliptais perto da câmera
src/car.js                    imóveis do CAR: cores por critério, sobreposições, APP, destaque, rótulos e ficha
data/muni/landuse.js          camadas MapBiomas, grades, legenda oficial
data/muni/landuse/            lc30_{1985,1995,2005,2015,2020,2025}.png · lc10_2025.png · stats.json
data/muni/layers/canopy.png   altura das copas (valor/6 = m)
tools/build_canopy.py         copas = Copernicus − ANADEM
tools/build_landuse.py        MapBiomas → PNG + áreas por classe no município
tools/build_strava.py         atividades do Strava na área (polilinha reduzida) → layers/strava.json
tools/build_car.py            imóveis do CAR (SICAR WFS) simplificados → layers/car.json
tools/build_car_stats.py      ficha de cada imóvel + APP estimada → car.json (campo s) e layers/car_id.png
data/muni/grid.js             extensão, grade e conjuntos de imagem
data/muni/models.js           ANADEM (1671×1522) e Copernicus GLO-30 (1620×1477)
data/muni/img/                overview.jpg · cbers/ (110 blocos, ~4 m) · s2/ (110 blocos, ~8 m) · town/ (16 células, 2 m)
data/muni/layers/             osm.json · drainage.json · boundary.json · places.json
tools/build_muni_tiles.py     fusão CBERS-4A + Sentinel-2 e corte em blocos
tools/build_muni_vectors.py   limite municipal, lugares e vetores do OSM
tools/derive_drainage.py      drenagem (priority-flood + D8 + Strahler) — `municipio` ou `local`
tools/fuse_imagery.py         fusão do recorte de 2 m da cidade (v0.4)
```

## Dados

| Camada | Fonte | Resolução |
|---|---|---|
| Relevo (padrão) | ANADEM v1.0, UFRGS/ANA 2024 (tile MGRS 23K) | 30 m |
| Relevo (alternativo) | Copernicus GLO-30, tile S22 W045 | 30 m |
| Imagem (padrão) | CBERS-4A WPM fundida 2 m, INPE CC BY 4.0, 23/07/2026, órbitas 200/140 e 200/141 | 4 m (2 m na cidade) |
| Cor da imagem | Sentinel-2 L2A, 18/08/2026, tiles 23KNS + 23KNR | 10 m |
| Vetores e lugares | OpenStreetMap (ODbL), 03/10/2026 | — |
| Uso do solo | MapBiomas Brasil Coleção 11 (1985–2025) e Coleção 4 de 10 m (2025) | 30 m / 10 m |
| Altura das copas | Copernicus GLO-30 − ANADEM | 30 m |
| Imóveis rurais | SICAR/CAR, WFS público sicar:sicar_imoveis_mg (3.726 na extensão, 1.605 em Andrelândia) | — |
| Rotas | Strava do usuário: 52 atividades, 806 km (2016–2021) | ~80 m entre pontos |
| Córregos | calculados do ANADEM, área mínima 0,15 km² (6.881 trechos, ordem até 7) | — |

Extensão: W −44,51 / E −44,06 / N −21,53 / S −21,94 (inclui partes dos municípios vizinhos).
Uma faixa estreita no extremo sudeste fica sem CBERS e usa só a Sentinel-2.

## Imóveis rurais (CAR)

`car_id.png` cobre a extensão do mapa (3072 × 2993, ~15 m): R·256 + G = índice do imóvel + 1 (o menor fica por cima,
como no clique); canal B = nº de cadastros no pixel (bits 0–3), APP estimada (bit 4) e APP com uso antrópico (bit 5).
O shader do terreno usa essa textura e uma paleta 64 × 64 por índice para preencher, destacar e hachurar.

APP estimada numa grade de 10 m (Lei 12.651/2012): art. 4º — 30 m dos córregos calculados, 50 m dos rios do OSM,
50 m das nascentes (cabeceiras dos córregos) e encostas > 45°; art. 61-A — 5/8/15/20 m conforme os módulos fiscais
e 15 m nas nascentes, com teto de 10% (até 2 MF) e 20% (2–4 MF). Não inclui topos de morro, veredas, reservatórios
nem Reserva Legal. Uso do solo da faixa: MapBiomas 10 m (2025).

## Luz e sombras

Posição do sol calculada para a data de hoje e a hora escolhida (horário de Brasília).
Sombras do relevo: marcha de raio na grade de altitudes do modelo ativo (textura de meia precisão),
52 passos crescentes até ~12 km, considerando o exagero vertical. Desligadas por padrão em celulares.

## Próximos passos

1. Prédios em 3D com altura (Google Open Buildings 2.5D).
2. Rótulos de ruas, rios e bairros sobre o terreno.
4. Relevo mais fino só onde importa (drone/fotogrametria), como mais um modelo em data/muni/models.js.
