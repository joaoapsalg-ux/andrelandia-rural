# Normais climatológicas 1991–2020 em 5 pontos do município, a partir do Open-Meteo (Historical Weather API).
# Brutos (em ANDRELANDIA_RAW ou ~/Downloads), mesmos 5 pontos e período:
#   andrelandia_clima_openmeteo.json       temperatura: reanálise ERA5-Land (~9 km), já corrigida para a altitude do ponto
#   andrelandia_chuva_openmeteo_era5.json  chuva: reanálise ERA5 (~28 km; o ERA5-Land do Open-Meteo não traz chuva)
#   https://archive-api.open-meteo.com/v1/archive?latitude=-21.7402,-21.635,-21.635,-21.84,-21.84
#     &longitude=-44.3091,-44.395,-44.17,-44.395,-44.17&start_date=1991-01-01&end_date=2020-12-31
#     &daily=temperature_2m_max,temperature_2m_min[,precipitation_sum]&timezone=America%2FSao_Paulo&models=era5_land|era5
# Saída: data/muni/layers/clima.json — por ponto e mês: chuva (mm), dias de chuva (≥ 1 mm), máxima e mínima médias (°C).
# O app ajusta a temperatura pela altitude de cada propriedade (lapse). A reanálise suaviza as baixadas: não serve
# para geada (o app usa o mapa de baixadas frias para isso).
# Uso: powershell -ExecutionPolicy Bypass -File tools/build_clima.ps1
$raw = if ($env:ANDRELANDIA_RAW) { $env:ANDRELANDIA_RAW } else { Join-Path $HOME 'Downloads' }
$root = Split-Path (Split-Path $MyInvocation.MyCommand.Path)
$temp = Get-Content (Join-Path $raw 'andrelandia_clima_openmeteo.json') -Raw | ConvertFrom-Json
$chuva = Get-Content (Join-Path $raw 'andrelandia_chuva_openmeteo_era5.json') -Raw | ConvertFrom-Json
$points = for ($p = 0; $p -lt $temp.Count; $p++) {
  $d = $temp[$p].daily; $c = $chuva[$p].daily; $n = $d.time.Count
  $rain = New-Object double[] 12; $rdays = New-Object double[] 12; $tx = New-Object double[] 12; $tn = New-Object double[] 12
  $cnt = New-Object double[] 12; $years = @{}
  for ($i = 0; $i -lt $n; $i++) {
    $m = [int]$d.time[$i].Substring(5, 2) - 1; $years[$d.time[$i].Substring(0, 4)] = 1
    $pr = $c.precipitation_sum[$i]; $a = $d.temperature_2m_max[$i]; $b = $d.temperature_2m_min[$i]
    if ($null -ne $pr) { $rain[$m] += $pr; if ($pr -ge 1) { $rdays[$m]++ } }
    if ($null -ne $a -and $null -ne $b) { $tx[$m] += $a; $tn[$m] += $b; $cnt[$m]++ }
  }
  $ny = $years.Count
  [ordered]@{
    lat = [math]::Round($temp[$p].latitude, 4); lon = [math]::Round($temp[$p].longitude, 4); elev = $temp[$p].elevation
    rain = @(0..11 | ForEach-Object { [math]::Round($rain[$_] / $ny) })
    rainDays = @(0..11 | ForEach-Object { [math]::Round($rdays[$_] / $ny, 1) })
    tmax = @(0..11 | ForEach-Object { [math]::Round($tx[$_] / $cnt[$_], 1) })
    tmin = @(0..11 | ForEach-Object { [math]::Round($tn[$_] / $cnt[$_], 1) })
  }
}
$out = [ordered]@{
  source = 'Open-Meteo (Historical Weather API): temperatura ERA5-Land ~9 km, chuva ERA5 ~28 km, 1991–2020 (CC BY 4.0)'
  lapse = -0.0065; points = @($points)
}
[IO.File]::WriteAllText((Join-Path $root 'data/muni/layers/clima.json'), ($out | ConvertTo-Json -Depth 5 -Compress), (New-Object Text.UTF8Encoding $false))
"clima.json: $($points.Count) pontos"
$points | ForEach-Object { "({0}, {1}) {2} m | chuva {3} mm/ano | jul {4} mm | max fev {5} | min jul {6}" -f $_.lat, $_.lon, $_.elev, ($_.rain | Measure-Object -Sum).Sum, $_.rain[6], $_.tmax[1], $_.tmin[6] }
