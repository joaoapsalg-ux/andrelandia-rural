# Servidor local em PowerShell, equivalente ao serve.py, para máquinas sem Python:
#   powershell -ExecutionPolicy Bypass -File tools/dev/serve.ps1 [porta]   →  http://localhost:8000
# Como o serve.py, acrescenta o esqueleto <!doctype>/<head>/<body> ao index.html na página "/".
# Só para desenvolvimento (escuta apenas nesta máquina), usado pelas páginas de tools/dev/:
#   GET  /__raw/<arquivo>   lê um bruto de ANDRELANDIA_RAW (padrão ~/Downloads)
#   POST /__save/<arquivo>  grava o corpo em data/muni/layers/<arquivo> (só .json)
#   POST /__save-town/c_<linha>_<coluna>.webp  grava um bloco de 2 m em data/muni/img/town/ (correção feita no navegador)
param([int]$Port = 8000)

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Raw = if ($env:ANDRELANDIA_RAW) { $env:ANDRELANDIA_RAW } else { Join-Path $HOME 'Downloads' }
$Skeleton = '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">' +
            '<meta name="viewport" content="width=device-width,initial-scale=1"></head><body>{0}</body></html>'
$Types = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript'; '.json' = 'application/json'
  '.css' = 'text/css'; '.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.jpeg' = 'image/jpeg'
  '.svg' = 'image/svg+xml'; '.webp' = 'image/webp'; '.ico' = 'image/x-icon'; '.txt' = 'text/plain; charset=utf-8'
  '.woff' = 'font/woff'; '.woff2' = 'font/woff2'; '.gz' = 'application/gzip'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$listener.Start()
Write-Host "Andrel$([char]0xE2)ndia Rural em http://localhost:$Port"

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $res = $ctx.Response
  try {
    $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)
    $name = ($path -split '/')[-1]
    if ($ctx.Request.HttpMethod -eq 'POST' -and $path -like '/__save/*' -and $name -match '^[a-z0-9_.-]+\.json$') {
      $ms = New-Object IO.MemoryStream; $ctx.Request.InputStream.CopyTo($ms)
      [IO.File]::WriteAllBytes((Join-Path $Root "data/muni/layers/$name"), $ms.ToArray())
      $bytes = [Text.Encoding]::UTF8.GetBytes("ok $($ms.Length)")
    } elseif ($ctx.Request.HttpMethod -eq 'POST' -and $path -like '/__save-town/*' -and $name -match '^c_\d{1,2}_\d{1,2}\.webp$') {
      $ms = New-Object IO.MemoryStream; $ctx.Request.InputStream.CopyTo($ms)
      [IO.File]::WriteAllBytes((Join-Path $Root "data/muni/img/town/$name"), $ms.ToArray())
      $bytes = [Text.Encoding]::UTF8.GetBytes("ok $($ms.Length)")
    } elseif ($path -like '/__raw/*' -and $name -match '^[A-Za-z0-9_.-]+$' -and [IO.File]::Exists((Join-Path $Raw $name))) {
      $bytes = [IO.File]::ReadAllBytes((Join-Path $Raw $name))
      $res.ContentType = 'application/octet-stream'
    } elseif ($path -eq '/' -or $path -eq '/index.html') {
      $html = [IO.File]::ReadAllText((Join-Path $Root 'index.html'), [Text.Encoding]::UTF8)
      $bytes = [Text.Encoding]::UTF8.GetBytes(($Skeleton -f $html))
      $res.ContentType = 'text/html; charset=utf-8'
    } else {
      $file = [IO.Path]::GetFullPath((Join-Path $Root $path.TrimStart('/')))
      if (-not $file.StartsWith($Root) -or -not [IO.File]::Exists($file)) {
        $res.StatusCode = 404
        $bytes = [Text.Encoding]::UTF8.GetBytes('404')
      } else {
        $bytes = [IO.File]::ReadAllBytes($file)
        $ext = [IO.Path]::GetExtension($file).ToLower()
        $res.ContentType = if ($Types.ContainsKey($ext)) { $Types[$ext] } else { 'application/octet-stream' }
      }
    }
    $res.ContentLength64 = $bytes.Length
    $res.OutputStream.Write($bytes, 0, $bytes.Length)
    Write-Host "$($res.StatusCode) $path"
  } catch {
    Write-Host "erro: $_"
  } finally {
    $res.Close()
  }
}
