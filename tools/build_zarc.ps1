# ZARC (Zoneamento Agrícola de Risco Climático, MAPA) de Andrelândia → data/muni/layers/zarc.json
# Brutos (em ANDRELANDIA_RAW ou ~/Downloads): só as linhas de Andrelândia (geocódigo 3102803) das tábuas de risco de
# https://dados.agricultura.gov.br/dataset/tabua-de-risco-zoneamento-agricola-de-risco-climatico (CC BY), filtradas em
# fluxo na hora de baixar (os CSVs do Brasil inteiro passam de 200 MB):
#   andrelandia_zarc_2026-2027.csv   safra 2026/2027
#   andrelandia_zarc_perene.csv      perenes, olerícolas e sem safra (café, frutas…)
# Saída: por cultura, as combinações [ciclo, solo, manejo, clima, risco, produtividade], com o risco de cada um dos
# 36 decêndios do ano numa sequência de 36 caracteres: 0 = não indicado, 1 = 20 %, 2 = 30 %, 3 = 40 %.
# Uso: powershell -ExecutionPolicy Bypass -File tools/build_zarc.ps1
$raw = if ($env:ANDRELANDIA_RAW) { $env:ANDRELANDIA_RAW } else { Join-Path $HOME 'Downloads' }
$root = Split-Path (Split-Path $MyInvocation.MyCommand.Path)
$rows = @()
foreach ($f in 'andrelandia_zarc_2026-2027.csv', 'andrelandia_zarc_perene.csv') { $rows += Import-Csv (Join-Path $raw $f) -Delimiter ';' -Encoding UTF8 }
$code = @{ '0' = '0'; '20' = '1'; '30' = '2'; '40' = '3' }
$crops = $rows | Group-Object { $_.Nome_cultura.Trim() -replace '\s+', ' ' } | Sort-Object Name | ForEach-Object {
  $list = foreach ($r in $_.Group) {
    $risk = -join (1..36 | ForEach-Object { $v = $r."dec$_"; if ($code.ContainsKey($v)) { $code[$v] } else { '0' } })
    $prod = if ($r.Produtividade) { [double]($r.Produtividade -replace ',', '.') } else { $null }   # nível de produtividade (ex.: lotação), quando há vários
    if ($risk -match '[123]') { , @([int]$r.Cod_Ciclo, [int]$r.Cod_Solo, $r.Nome_Outros_Manejos, $r.Nome_Clima, $risk, $prod) }
  }
  if ($list) { [ordered]@{ n = $_.Name; safra = $_.Group[0].SafraFin; portaria = $_.Group[0].Portaria; r = @($list) } }
}
$out = [ordered]@{
  source = 'ZARC — tábuas de risco do MAPA (dados.agricultura.gov.br, CC BY): safra 2026/2027 e perenes'
  ciclos = @{ '13' = 'perene'; '19' = 'semiperene'; '20' = 'Grupo I (ciclo curto)'; '21' = 'Grupo II (ciclo médio)'; '22' = 'Grupo III (ciclo longo)'; '24' = 'Grupo IV'; '25' = 'Grupo V'; '26' = 'Grupo VI' }
  solos = @{ '1' = 'arenoso'; '2' = 'textura média'; '3' = 'argiloso'; '11' = 'AD1'; '12' = 'AD2'; '13' = 'AD3'; '14' = 'AD4'; '15' = 'AD5'; '16' = 'AD6' }
  crops = @($crops)
}
[IO.File]::WriteAllText((Join-Path $root 'data/muni/layers/zarc.json'), ($out | ConvertTo-Json -Depth 6 -Compress), (New-Object Text.UTF8Encoding $false))
"zarc.json: $($crops.Count) culturas, $(($crops | ForEach-Object { $_.r.Count } | Measure-Object -Sum).Sum) combinações, $((Get-Item (Join-Path $root 'data/muni/layers/zarc.json')).Length) bytes"
