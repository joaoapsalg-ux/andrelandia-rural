# Andrelândia Rural — guia para o Claude Code

App 3D (Three.js, sem build) do município de Andrelândia (MG, IBGE 3102803, 1.002 km²) para produtores rurais:
encontrar a propriedade (CAR), ver como a terra mudou de 1985 a 2025, o caminho da água, sol, geada, perfil e sobrevoo.
Dono: João Salgado. Toda a interface e a conversa são em **português do Brasil**.

## Rodar

```
python serve.py            # http://localhost:8000  (precisa de internet: three.js vem do jsDelivr)
```

`index.html` **não tem** `<!doctype>`, `<head>` nem `<body>`: ele é publicado como Artifact do claude.ai, que acrescenta o
esqueleto. `serve.py` faz o mesmo localmente. Não acrescente o esqueleto no arquivo.

**Site:** https://joaoapsalg-ux.github.io/andrelandia-rural/ — repositório público
https://github.com/joaoapsalg-ux/andrelandia-rural. Cada push na `main` publica sozinho (`.github/workflows/pages.yml`
acrescenta o esqueleto ao index.html e copia só `src/` e `data/`). Git e GitHub CLI ficam em
`C:\Program Files\Git\cmd\git.exe` e `C:\Program Files\GitHub CLI\gh.exe`; os commits usam o e-mail noreply do GitHub.

Versão antiga como Artifact: https://claude.ai/artifact/U4UsjSHVby97AVd9MN14cu (privado; v1.1). A versão anterior, "Andrelândia 3D" v0.8
(com Strava, Copernicus, árvores 3D), é outro artifact: https://claude.ai/artifact/So1np1JnUMUf1T6y35TeVd — o código dela
está em `legado/andrelandia3d-v0.8/` (sem os dados).

## Estrutura

```
index.html            interface + CSS (tokens claro/escuro em :root; fontes Barlow / Barlow Condensed / IBM Plex Mono)
src/main.js           montagem da cena, ferramentas (gota, perfil, antes/depois, sobrevoo), máquina do tempo, painéis
src/cellterrain.js    terreno em 22×20 células (~2 km), LOD 72/36/18/9, saias, imagens sob demanda; shader com
                      satélite (com correção de cor), uso do solo (mistura de 2 anos), sol, geada, divisória antes/depois,
                      CAR, sombras e "relevo local" (buildRelief: vale escuro/crista clara, calculado na abertura)
src/car.js            propriedades do CAR: cores por critério, ficha, busca por código, histórico (car_hist.json)
src/water.js          gota de chuva: segue fdir.png (D8) e anima com LineMaterial tracejado
src/profile.js        perfil do terreno entre dois toques
src/demo.js           demonstração da propriedade (~30 s, 6 cenas com legenda, câmera girando; restaura a vista ao fim)
src/propwater.js      "água da propriedade": área que drena para ela (D8 de trás para frente), córregos e nascentes dela
src/sheet.js          folha A4 em PNG (vista 3D + números da ficha + avisos) para salvar/imprimir
src/access.js         acesso pela estrada: menor caminho no OSM até o asfalto (surface marcado ou trunk/primary) e até
                      o centro (Igreja Matriz); grafo montado no primeiro uso
src/agro.js           clima (IDW de 5 pontos + ajuste pela altitude), solo (média das células de 250 m) e ZARC por
                      propriedade; gráfico do ano e faixas de 36 decêndios em SVG
src/vectors.js        linhas sobre o relevo (estradas, rios, córregos, limite, correnteza animada)
src/sun.js            posição do sol e cúpula do céu (SkyDome: degradê pela altura do olhar + brilho do sol)
src/pois.js, geo.js, heightfield.js, sources/png.js, config.js
data/muni/            grid.js, models.js, landuse.js + dem/, img/, landuse/, layers/
tools/                scripts Python que geram tudo em data/ a partir dos brutos
tools/dev/shot.js     captura de tela headless (Playwright + SwiftShader) para conferir mudanças visuais
```

## Dados (todos em data/muni/)

| Arquivo | O que é |
|---|---|
| dem/anadem.png | ANADEM 30 m em PNG Terrarium (R·256 + G + B/256 − 32768), 1671×1522 |
| img/overview.jpg, img/cbers/t_{ty}_{tx}.jpg, img/town/c_{r}_{c}.jpg | CBERS-4A fundido com cor Sentinel-2: visão geral, 4 m (blocos de 2×2 células), 2 m na cidade |
| landuse/lc30_{1985..2025}.png | MapBiomas Col. 11, códigos de classe em cinza 8 bits, mesma grade do ANADEM |
| landuse/hist.json | % de 6 grupos de uso no município, 41 anos; médias de sol |
| layers/car.json | 3.726 propriedades (SICAR), contornos simplificados + ficha `s` (uso, relevo, APP, sol, geada…) |
| layers/car_hist.json | por propriedade (mesmo índice): 41×6 bytes (0–100 %) em base64 |
| layers/car_id.png | raster 3072×2993 da extensão: R·256+G = índice+1; B = nº de cadastros (bits 0–3), APP (bit 4), APP com uso antrópico (bit 5) |
| layers/fdir.png | direção D8 (0 = sem saída; 1–8 = vizinhos (−1,−1)…(1,1)) |
| layers/solgeada.png | R/G = sol direto em 21/jun e 21/dez (kWh/m²/dia × 25); B = índice de geada × 255 |
| layers/osm.json, drainage.json, boundary.json, places.json | OSM; córregos calculados (Strahler); limite; lugares |
| layers/clima.json | normais 1991–2020 em 5 pontos (Open-Meteo: temperatura ERA5-Land ~9 km, chuva ERA5 ~28 km) |
| layers/solo.json | SoilGrids 2.0, 250 m, 0–30 cm: argila, areia, carbono, pH e classe WRB, em base64 (208×180) |
| layers/zarc.json | ZARC de Andrelândia (MAPA): 74 culturas, risco por decêndio para ciclo × solo × manejo |

Georreferência: extensão W −44,51 / E −44,06 / N −21,53 / S −21,94. Grade 30 m (ANADEM = MapBiomas):
lon0 −44.510264686724526, lat0 −21.529922414492574, passo 0.00026949458523585647° (canto do pixel [0,0]).
Sistema local da cena: x = leste, z = sul, origem na Igreja Matriz (−21.74016, −44.30906); y = altitude × exagero.

## Como os brutos foram obtidos

A nuvem do Cowork não alcançava os servidores; os dados foram lidos pelo navegador do app (geotiff.js em COGs) e salvos
na pasta Downloads. Os scripts leem os brutos de `ANDRELANDIA_RAW` (padrão `~/Downloads`).

- MapBiomas Col. 11: `https://storage.googleapis.com/mapbiomas-public/initiatives/brasil/collection11/lulc/coverage/brazil_coverage/brazil_coverage-col11_{ano}.tif`, janela x0 = 109504, y0 = 100013, 1671×1522 → `municipio_mapbiomas30m_1985-2025.bin.gz`
- CAR: WFS público `https://geoserver.car.gov.br/geoserver/sicar/wfs`, camada `sicar:sicar_imoveis_mg` → `andrelandia_car.json.gz`
- ANADEM (UFRGS/ANA), CBERS-4A WPM (INPE, CC BY 4.0), Sentinel-2 L2A (ESA), OSM via Overpass.

Ordem dos scripts: build_muni_tiles → build_muni_vectors → derive_drainage municipio → build_car → build_car_stats →
build_rural → build_landuse41.

Dados acrescentados em 03/10/2026 sem Python (a máquina não tem): PowerShell + navegador do app.
- Clima: Open-Meteo Historical Weather API (5 pontos, 1991–2020) → `andrelandia_clima_openmeteo.json` (ERA5-Land) e
  `andrelandia_chuva_openmeteo_era5.json` (ERA5) → `tools/build_clima.ps1`.
- Solo: WCS da ISRIC (`maps.isric.org`, recortes EPSG:4326) → `andrelandia_soilgrids_*.tif` →
  `tools/dev/build_solo.html` (geotiff.js; grava pelo `POST /__save/` do `tools/dev/serve.ps1`).
- ZARC: tábuas de risco de `dados.agricultura.gov.br` (CSVs nacionais de 200–500 MB) lidas em fluxo, guardando só as
  linhas do geocódigo 3102803 → `andrelandia_zarc_*.csv` → `tools/build_zarc.ps1`. Solo do ZARC estimado pela argila
  (tipo 1/2/3 da IN 2/2008; classe AD mais cautelosa da faixa) — a equação oficial de AD não foi usada.

## Restrições e decisões

- Artifact do claude.ai: arquivos de tipos web comuns (sem .bin — por isso PNG/JSON), ≤255 arquivos e ≤64 MB por publicação.
- Publicar com `capabilities: {downloads: true}`: a "folha da propriedade" sai por `claude.use('downloads')` (fora do
  Artifact, download comum). O link de compartilhar usa `config.share.url` + `#car=código`.
- O app precisa rodar em celular: nada pesado ligado por padrão (sombras desligadas; os 41 anos ficam como PNG
  compactado e só ~6 viram textura por vez, com LRU em `loadYear`).
- APP, sol e geada são **estimativas** do app; os textos deixam isso claro. Não apresentar como laudo.
- Sem dados pessoais: nada de rotas do Strava no app rural; o CAR público não tem nome nem CPF.
- O MapBiomas classifica muito do "campo nativo" de 1985 como pasto hoje; o app avisa que parte é diferença de método.

## Conferir mudanças

`node tools/dev/shot.js saida.png 15000 teste.js` com o `serve.py` rodando. `window.app` expõe
`{ camera, controls, terrain, carLayer, openCarCard, demo, setWater, makeSheet, rain, profile, setSurface, setYearPos, setSplit, startOrbit, setTool }`
(`makeSheet(x)` devolve o PNG sem baixar: bom para conferir a folha).
SwiftShader roda a ~1 quadro/s: confira estado (DOM, valores) pelo script e use espera longa para a imagem.

## Preferências do João

- Responder em português, curto. Quando ele pergunta "como melhorar", oferecer uma lista numerada e deixar ele escolher.
- Pedir permissão antes de baixar qualquer arquivo (dizer nome, origem e tamanho).
- Testar antes de entregar e dizer o que não foi testado (ex.: GPU real, celular de verdade).
