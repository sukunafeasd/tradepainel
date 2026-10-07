param([string]$Version, [string]$Notes)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$project=Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
if(!$Version){$Version=$project.version}
if(!$Notes){$Notes="DiefTrade $Version. Consulte o CHANGELOG.md do repositorio para as alteracoes desta versao. Sem ordens reais. Sem certificado Authenticode publico."}
if($Version -ne $project.version -or $Version -notmatch '^\d+\.\d+\.\d+$'){throw 'Version mismatch'}
$name="DiefTrade.exe"
$file=Get-Item -LiteralPath (Join-Path $root "dist/$name")
if($file.Length -lt 1000000){throw 'Invalid release artifact'}
$hash=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
$metadata=@{product='DiefTrade';version=$Version;platform='win32';arch='x64';size=$file.Length;sha256=$hash;authenticode=[string](Get-AuthenticodeSignature -LiteralPath $file.FullName).Status}
$metadataPath=Join-Path $root 'dist/dieftrade-release.json'
[IO.File]::WriteAllText($metadataPath,($metadata|ConvertTo-Json),(New-Object Text.UTF8Encoding($false)))
$credential="protocol=https`nhost=github.com`n`n" | git credential fill 2>$null
$fields=@{}
foreach($line in $credential){if($line -match '^([^=]+)=(.*)$'){$fields[$Matches[1]]=$Matches[2]}}
if(!$fields.password){throw 'GitHub credential unavailable'}
$headers=@{Authorization=('Bearer '+$fields.password);'User-Agent'='DiefTrade-Release';Accept='application/vnd.github+json'}
$base='https://api.github.com/repos/sukunafeasd/tradepainel'
$release=Invoke-RestMethod "$base/releases" -Method Post -Headers $headers -ContentType 'application/json; charset=utf-8' -Body (@{tag_name="v$Version";target_commitish=(git -C $root rev-parse HEAD).Trim();name="DiefTrade $Version";draft=$true;prerelease=$false;body=$Notes}|ConvertTo-Json)
Add-Type -AssemblyName System.Net.Http
$client=New-Object System.Net.Http.HttpClient
$client.Timeout=[TimeSpan]::FromMinutes(30)
$client.DefaultRequestHeaders.Authorization=New-Object System.Net.Http.Headers.AuthenticationHeaderValue('Bearer',$fields.password)
$client.DefaultRequestHeaders.UserAgent.ParseAdd('DiefTrade-Release')
try {
  foreach($assetName in @($name,'dieftrade-release.json')){
    $assetPath=Join-Path $root "dist/$assetName"
    $stream=[IO.File]::OpenRead($assetPath)
    $content=New-Object System.Net.Http.StreamContent($stream)
    $content.Headers.ContentType=New-Object System.Net.Http.Headers.MediaTypeHeaderValue('application/octet-stream')
    $content.Headers.ContentLength=$stream.Length
    try {
      $url="https://uploads.github.com/repos/sukunafeasd/tradepainel/releases/$($release.id)/assets?name="+[Uri]::EscapeDataString($assetName)
      $response=$client.PostAsync($url,$content).GetAwaiter().GetResult()
      if(!$response.IsSuccessStatusCode){throw ('Upload failed: '+$response.StatusCode)}
      $asset=$response.Content.ReadAsStringAsync().GetAwaiter().GetResult()|ConvertFrom-Json
      $expected=(Get-FileHash $assetPath -Algorithm SHA256).Hash.ToLowerInvariant()
      if($asset.digest -ne ('sha256:'+$expected) -or $asset.size -ne (Get-Item $assetPath).Length){throw 'Remote artifact mismatch'}
      Write-Output ('PASS uploaded '+$assetName+' SHA-256 and size')
    }finally{$content.Dispose();$stream.Dispose()}
  }
  $result=Invoke-RestMethod "$base/releases/$($release.id)" -Method Patch -Headers $headers -ContentType 'application/json' -Body (@{draft=$false;make_latest='true'}|ConvertTo-Json)
  Write-Output ('Published: '+$result.html_url)
}finally{$client.Dispose()}
