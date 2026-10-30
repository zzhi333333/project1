# Legal Assistant - static server (zero dependency, PowerShell 3+)
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File serve.ps1  [port]
param([int]$Port = 8080)
$root = $PSScriptRoot
$mime = @{
  '.html'='text/html; charset=utf-8'; '.js'='text/javascript; charset=utf-8';
  '.css'='text/css; charset=utf-8'; '.json'='application/json; charset=utf-8';
  '.svg'='image/svg+xml'; '.png'='image/png'; '.ico'='image/x-icon'; '.md'='text/plain; charset=utf-8'
}
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
try { $listener.Start() } catch {
  Write-Host "Port $Port is busy. Try: powershell -File serve.ps1 -Port 8081"
  Read-Host "Press Enter to exit"
  exit 1
}
Write-Host "====================================================="
Write-Host "  Legal Assistant server running"
Write-Host "  Open:  http://127.0.0.1:$Port"
Write-Host "  Root:  $root"
Write-Host "  Keep this window open. Press Ctrl+C to stop."
Write-Host "====================================================="
while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  try {
    $path = $ctx.Request.Url.AbsolutePath
    if ($path -eq '/') { $path = '/index.html' }
    $file = Join-Path $root ($path -replace '/', '\').Substring(1)
    if ((Test-Path $file -PathType Leaf) -and ($file.StartsWith($root))) {
      $bytes = [IO.File]::ReadAllBytes($file)
      $ext = [IO.Path]::GetExtension($file).ToLower()
      if ($mime.ContainsKey($ext)) { $ctx.Response.ContentType = $mime[$ext] }
      $ctx.Response.ContentLength64 = $bytes.Length
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $ctx.Response.StatusCode = 404
      $b = [Text.Encoding]::UTF8.GetBytes('404 Not Found: ' + $path)
      $ctx.Response.ContentLength64 = $b.Length
      $ctx.Response.OutputStream.Write($b, 0, $b.Length)
    }
  } catch {}
  finally { try { $ctx.Response.Close() } catch {} }
}
