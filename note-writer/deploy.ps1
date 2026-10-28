# Windows（PowerShell）から deploy.sh を動かすための入口
#   powershell -ExecutionPolicy Bypass -File .\note-writer\deploy.ps1 "My Project 42532"
# 引数はプロジェクトの名前でも ID でもよい。
# gcloud がなければ winget で入れ、ログインし、Git for Windows の bash で deploy.sh を実行する。
param([Parameter(Mandatory = $true)][string]$Project)
# gcloud は警告を標準エラーに出すので、Stop にすると警告だけで止まってしまう
$ErrorActionPreference = "Continue"

function Find-GcloudBin {
  $candidates = @(
    "$env:LOCALAPPDATA\Google\Cloud SDK\google-cloud-sdk\bin",
    "${env:ProgramFiles(x86)}\Google\Cloud SDK\google-cloud-sdk\bin",
    "$env:ProgramFiles\Google\Cloud SDK\google-cloud-sdk\bin"
  )
  foreach ($c in $candidates) { if (Test-Path "$c\gcloud.cmd") { return $c } }
  return $null
}

# 1. gcloud
if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
  $bin = Find-GcloudBin
  if (-not $bin) {
    Write-Host "Google Cloud CLI をインストールします..."
    winget install -e --id Google.CloudSDK --accept-source-agreements --accept-package-agreements
    $bin = Find-GcloudBin
    if (-not $bin) { throw "gcloud のインストール先が見つかりません。PowerShell を開き直して、もう一度実行してください。" }
  }
  $env:Path = "$bin;$env:Path"
}

# 2. ログイン（まだなら）
$account = gcloud auth list --filter="status:ACTIVE" --format="value(account)" 2>$null
if (-not $account) { gcloud auth login }

# 3. 名前で渡されたら ID に変換
# プロジェクト ID の形（英小文字・数字・ハイフン）ならそのまま使う。名前なら ID を調べる
if ($Project -match '^[a-z][a-z0-9-]{4,28}[a-z0-9]$') {
  $id = $Project
} else {
  $id = gcloud projects list --filter="name:'$Project'" --format="value(projectId)"
  if (-not $id) {
    throw "プロジェクト「$Project」が見つかりません。gcloud auth login でログインし直すか、プロジェクト ID（例：top-footing-512918-n0）を直接指定してください。"
  }
}
$id = ($id -split "`n")[0].Trim()
Write-Host "プロジェクト ID: $id"

# 4. Git for Windows の bash で deploy.sh を実行
$bash = @("$env:ProgramFiles\Git\bin\bash.exe", "${env:ProgramFiles(x86)}\Git\bin\bash.exe", "$env:LOCALAPPDATA\Programs\Git\bin\bash.exe") |
  Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $bash) { throw "Git for Windows の bash が見つかりません。https://git-scm.com/download/win から入れてください。" }

# Git が改行を CRLF に変えていると bash が読めないので、LF に直したコピーを実行する
$lfScript = Join-Path $PSScriptRoot ".deploy-lf.sh"
$text = [IO.File]::ReadAllText((Join-Path $PSScriptRoot "deploy.sh"), [Text.Encoding]::UTF8) -replace "`r`n", "`n"
[IO.File]::WriteAllText($lfScript, $text, (New-Object Text.UTF8Encoding $false))
try {
  & $bash $lfScript $id
} finally {
  Remove-Item $lfScript -ErrorAction SilentlyContinue
}
