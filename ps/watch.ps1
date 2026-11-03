param(
  [int]$IntervalMs = 700,
  [int]$OcrEveryMs = 3000,
  [string]$OutDir = "$env:LOCALAPPDATA\Temp\opencode\opcompuse",
  [string]$TargetsJson = ""
)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\opcompuse.lib.ps1"

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Write-Atomic([string]$Path, [string]$Content) {
  for ($retry = 0; $retry -lt 3; $retry++) {
    try {
      $tmp = "$Path.tmp$PID"
      [IO.File]::WriteAllText($tmp, $Content, [Text.Encoding]::UTF8)
      Move-Item -Force $tmp $Path
      return
    } catch {
      Start-Sleep -Milliseconds 60
    }
  }
}

$prevSig = ""
$prevWindow = ""
$prevFocus = ""
$lastOcr = [System.Diagnostics.Stopwatch]::StartNew()
$lastOcrMs = 0
$events = New-Object System.Collections.Generic.List[string]
$cycle = 0

Remove-Item "$OutDir\state.json" -Force -ErrorAction SilentlyContinue

while ($true) {
  try {
  $cycle++
  $t0 = [System.Diagnostics.Stopwatch]::StartNew()
  $d = $null
  try { $d = Get-FcuDigest -Quick -NoOcr -TargetsJson:$TargetsJson } catch { Start-Sleep -Milliseconds $IntervalMs; continue }
  $sig = ($d.text -join "|")
  $meta = $d.meta
  $meta.watchHeartbeat = $true
  $meta.cycle = $cycle
  $meta.loopMs = $t0.ElapsedMilliseconds

  Write-Atomic "$OutDir\alive.json" ($meta | ConvertTo-Json -Depth 3 -Compress)

  $focus = ""
  $curWin = ""
  foreach ($l in $d.text) { if ($l -like "#F *") { $focus = $l }; if ($l -like "#W *") { $curWin = $l } }
  if ($sig -ne $prevSig) {
    $now = (Get-Date).ToString("HH:mm:ss.fff")
    if ($curWin -ne $prevWindow) {
      $events.Add("[$now] window: $curWin")
      $prevWindow = $curWin
    }
    if ($focus -ne $prevFocus) {
      $events.Add("[$now] focus: $focus")
      $prevFocus = $focus
    }
    while ($events.Count -gt 14) { $events.RemoveAt(0) }

    $full = $null
    try {
      $sinceOcr = [int]($lastOcr.ElapsedMilliseconds - $lastOcrMs)
      $full = Get-FcuDigest -NoOcr:($sinceOcr -lt $OcrEveryMs) -TargetsJson:$TargetsJson
      if ($sinceOcr -ge $OcrEveryMs) { $lastOcrMs = [int]$lastOcr.ElapsedMilliseconds }
    } catch {
      Start-Sleep -Milliseconds $IntervalMs; continue
    }
    $out = $(Format-FcuOutput $full)

    $eventsText = ""
    if ($events.Count -gt 0) { $eventsText = ($events -join "`n") }
    Write-Atomic "$OutDir\state.txt" ($out + "`n#EVENTS --- recent screen changes ---`n" + $eventsText)

    $fullMeta = $full.meta
    $fullMeta.changedAt = $now
    $fullMeta.eventCount = $events.Count
    $fullMeta.watchInterval = $IntervalMs
    Write-Atomic "$OutDir\state.json" ($fullMeta | ConvertTo-Json -Depth 3 -Compress)

    $prevSig = $sig
  }
  } catch {}

  Start-Sleep -Milliseconds $IntervalMs
}


