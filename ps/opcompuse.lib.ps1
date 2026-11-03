$ErrorActionPreference = 'Stop'

if (-not ('Fcu.Native' -as [type])) {
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
namespace Fcu {
public static class Native {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out PT lpPoint);
  [DllImport("kernel32.dll")] public static extern ulong GetTickCount64();
  [StructLayout(LayoutKind.Sequential)] public struct PT { public int X, Y; public PT(int x, int y){X=x;Y=y;} }
}
}
"@
}

$script:MOUSE_LEFT_DOWN  = [uint32]0x0002
$script:MOUSE_LEFT_UP    = [uint32]0x0004
$script:MOUSE_RIGHT_DOWN = [uint32]0x0008
$script:MOUSE_RIGHT_UP   = [uint32]0x0010
$script:MOUSE_WHEEL      = [uint32]0x0800

Add-Type -AssemblyName System.Windows.Forms, System.Drawing -ErrorAction SilentlyContinue
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes -ErrorAction SilentlyContinue

$script:AUTO   = [System.Windows.Automation.AutomationElement]
$script:WALKER = [System.Windows.Automation.TreeWalker]::ControlViewWalker
$script:FCU_MARKER = "@opc"

function Get-FcuCursor {
  try { $p = New-Object Fcu.Native+PT; [void][Fcu.Native]::GetCursorPos([ref]$p); return "$($p.X),$($p.Y)" } catch { return "?" }
}

function Get-FcuProcessName([IntPtr]$hwnd) {
  try {
    $p = [uint32]0
    [void][Fcu.Native]::GetWindowThreadProcessId($hwnd, [ref]$p)
    return (Get-Process -Id $p -ErrorAction Stop).ProcessName
  } catch { return "" }
}

function Get-FcuWindow {
  $fg = [Fcu.Native]::GetForegroundWindow()
  if ($fg -ne [IntPtr]::Zero) {
    try { $w = $script:AUTO::FromHandle($fg); if ($null -ne $w) { return $w } } catch {}
  }
  try {
    $el = $script:AUTO::FocusedElement
    for ($i = 0; $i -lt 15 -and $null -ne $el; $i++) {
      $parent = $script:WALKER.GetParent($el)
      if ($null -eq $parent -or $parent -eq $script:AUTO::RootElement) { return $el }
      $el = $parent
    }
    if ($null -ne $el) { return $el }
  } catch {}
  return $null
}

function Get-FcuHwndOfElement($el) {
  try { return [IntPtr]$el.Current.NativeWindowHandle } catch { return [IntPtr]::Zero }
}

function ConvertFrom-FcuElement($el, $path) {
  try { $c = $el.Current } catch { return $null }
  try { $r = $el.GetCurrentPropertyValue($script:AUTO::BoundingRectangleProperty) } catch { $r = $null }
  $flags = ""
  try { if ($c.IsOffscreen)   { $flags += "o" } } catch {}
  try { if (-not $c.IsEnabled){ $flags += "d" } } catch {}
  try { if ($c.IsKeyboardFocusable) { $flags += "k" } } catch {}
  $rect = ""
  if ($r -and [double]$r.X -gt -1e12 -and [double]$r.Width -gt 0 -and [double]$r.Height -gt 0) {
    $rect = " rect=$([int]$r.X),$([int]$r.Y),$([int]($r.X + $r.Width)),$([int]($r.Y + $r.Height))"
  }
  $cp = ""
  if ($flags -notmatch "o" -and $rect) {
    try { $pt = $el.GetClickablePoint(); $cp = " cp=$([int]$pt.X),$([int]$pt.Y)" } catch {}
  }
  $name = ""
  try { $name = $c.Name } catch {}
  if ($name) { $name = (($name -replace "[\r\n\t|]+", " ") -replace "`"", "'"); if ($name.Length -gt 60) { $name = $name.Substring(0,60) } }
  $aid = ""
  try { $aid = $c.AutomationId } catch {}
  if ($aid) { $aid = ($aid -replace "[\r\n\t|]+", " ") }
  $role = ""
  try { $role = ($c.ControlType.ProgrammaticName -replace "^ControlType\.", "") } catch {}
  $val = ""
  try {
    $vp = $null
    if ($el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp)) {
      $val = $vp.Current.Value
      if ($val) {
        $val = ($val -replace "[\r\n\t|]+" , " ") -replace "`"", "'"
        if ($val.Length -gt 40) { $val = $val.Substring(0,40) + "..." }
      }
    }
  } catch {}
  $sb = "$path $role $name $aid $val $rect$cp"
  if ($flags) { $sb += " [$flags]" }
  return $sb.Trim()
}

function Get-FcuRows {
  param($root, [int]$MaxDepth = 7, [int]$MaxRows = 140)
  $rows = New-Object System.Collections.Generic.List[string]
  $st = @{ found = 0 }
  function Visit($el, $path, $depth) {
    if ($depth -ge $MaxDepth -or $st.found -ge $MaxRows) { return }
    $i = 0
    $child = $null
    try { $child = $script:WALKER.GetFirstChild($el) } catch { return }
    while ($null -ne $child) {
      if ($st.found -lt $MaxRows -and $depth + 1 -lt $MaxDepth) {
        $i++
        $childPath = if ($path -eq "") { "$i" } else { "$path.$i" }
        $st.found++
        $row = ConvertFrom-FcuElement $child $childPath
        if ($row) { $rows.Add($row) }
        Visit $child $childPath ($depth + 1)
      }
      $child = $script:WALKER.GetNextSibling($child)
    }
  }
  if ($null -ne $root) { Visit $root "" 0 }
  return $rows
}

function Get-FcuWindows {
  $list = @()
  try {
    $children = $script:AUTO::RootElement.FindAll(
      [System.Windows.Automation.TreeScope]::Children,
      [System.Windows.Automation.Condition]::TrueCondition)
    foreach ($c in $children) {
      try {
        $n = $c.Current.Name
        if (-not $n) { continue }
        $n = $n -replace "[\r\n\t|]+", " "
        if ($n.Length -gt 70) { $n = $n.Substring(0,70) }
        $h = Get-FcuHwndOfElement $c
        $pn = if ($h -ne [IntPtr]::Zero) { Get-FcuProcessName $h } else { "" }
        $r = $c.GetCurrentPropertyValue($script:AUTO::BoundingRectangleProperty)
        if (-not $r -or [double]$r.X -lt -1e12) { continue }
        $list += "$pn `"$n`" hwnd=$h rect=$([int]$r.X),$([int]$r.Y),$([int]($r.X+$r.Width)),$([int]($r.Y+$r.Height))"
      } catch {}
    }
  } catch {}
  return $list
}

function Invoke-FcuOcr {
  param([System.Drawing.Bitmap]$bmp, [int]$OffsetX = 0, [int]$OffsetY = 0, [int]$MaxLines = 30, [switch]$DebugError)
  $out = @()
  try {
    $pngPath = [System.IO.Path]::GetTempFileName() + ".png"
    $bmp.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)

    $null = [Windows.Storage.StorageFile, Windows.Foundation, ContentType = WindowsRuntime]
    $null = [Windows.Storage.Streams.RandomAccessStreamReference, Windows.Foundation, ContentType = WindowsRuntime]
    $null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Foundation, ContentType = WindowsRuntime]
    $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]
    $null = [Windows.Graphics.Imaging.BitmapPixelFormat, Windows.Foundation, ContentType = WindowsRuntime]
    $null = [Windows.Graphics.Imaging.BitmapAlphaMode, Windows.Foundation, ContentType = WindowsRuntime]
    $null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Foundation, ContentType = WindowsRuntime]
    $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
    $null = [Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType = WindowsRuntime]
    $null = [Windows.Globalization.Language, Windows.Foundation, ContentType = WindowsRuntime]
    Add-Type -AssemblyName System.Runtime.WindowsRuntime -ErrorAction SilentlyContinue
    if (-not $script:AsTaskOp) {
      $m = [System.WindowsRuntimeSystemExtensions].GetMethods() |
        Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
                       $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } |
        Select-Object -First 1
      $script:AsTaskOp = $m
    }
    function AwaitOp($op, [type]$resultType) {
      $asTask2 = $script:AsTaskOp.MakeGenericMethod($resultType)
      $task = $asTask2.Invoke($null, @($op))
      [void]$task.Wait(3000)
      return $task.Result
    }

    $ocr = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
    if ($null -eq $ocr) {
      try { $ocr = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new("en-US")) } catch {}
    }
    if ($null -eq $ocr) { return $out }

    $w = $bmp.Width; $h = $bmp.Height
    $rect2 = [System.Drawing.Rectangle]::new(0, 0, $w, $h)
    $data = $bmp.LockBits($rect2, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
      $stride = $data.Stride
      $len = $w * $h * 4
      $bytes = New-Object byte[] $len
      if ($stride -eq $w * 4) {
        [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $len)
      } else {
        for ($row = 0; $row -lt $h; $row++) {
          [System.Runtime.InteropServices.Marshal]::Copy([IntPtr]($data.Scan0.ToInt64() + $row * $stride), $bytes, $row * $w * 4, $w * 4)
        }
      }
    } finally { $bmp.UnlockBits($data) }
    Add-Type -AssemblyName System.Runtime.InteropServices.WindowsRuntime -ErrorAction SilentlyContinue
    if (-not $script:WRBExt -and (-not ("System.Runtime.InteropServices.WindowsRuntime.WindowsRuntimeBufferExtensions" -as [type]))) {
      $rtDir = [System.Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory()
      $script:WRBExt = [System.Reflection.Assembly]::LoadFrom((Join-Path $rtDir "System.Runtime.InteropServices.WindowsRuntime.dll"))
    }
    $buffer = [System.Runtime.InteropServices.WindowsRuntime.WindowsRuntimeBufferExtensions]::AsBuffer($bytes)
    $null = [Windows.Graphics.Imaging.BitmapPixelFormat, Windows.Foundation, ContentType = WindowsRuntime]
    $null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Foundation, ContentType = WindowsRuntime]
    $softBitmap = [Windows.Graphics.Imaging.SoftwareBitmap]::CreateCopyFromBuffer(
      $buffer,
      [Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8,
      $w, $h)
    $res = AwaitOp ($ocr.RecognizeAsync($softBitmap)) ([Windows.Media.Ocr.OcrResult])

    $i = 0
    foreach ($line in $res.Lines) {
      $i++; if ($i -gt $MaxLines) { break }
      $t = $line.Text
      if (-not $t) { continue }
      $t = $t -replace "[\r\n\t|]+", " "
      if ($t.Length -gt 120) { $t = $t.Substring(0,120) }
      $bb = ""
      try {
        $r = $line.BoundingBox
        if ($r -and [double]$r.X -gt -1e12 -and ([double]$r.X -ne 0 -or [double]$r.Y -ne 0)) {
          $bb = " @=$([int]($r.X + $OffsetX)),$([int]($r.Y + $OffsetY)),$([int]$r.Width),$([int]$r.Height)"
        }
      } catch {}
      if ($bb) { $out += "$t$bb" } else { $out += $t }
    }
  } catch {
    if ($DebugError) { Write-Error $_ }
  }
  return $out
}

function Get-FcuBitmap($rect) {
  try {
    $x = [int]$rect.X; $y = [int]$rect.Y
    $w = [Math]::Min([int]$rect.Width, 1920)
    $h = [Math]::Min([int]$rect.Height, 1400)
    if ($w -lt 4 -or $h -lt 4) { return $null }
    $bmp = New-Object System.Drawing.Bitmap $w, $h
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($x, $y, 0, 0, ([System.Drawing.Size]::new($w, $h)))
    $g.Dispose()
    return @{ bmp = $bmp; x = $x; y = $y }
  } catch { return $null }
}

function Get-FocusedRow {
  try {
    $f = $script:AUTO::FocusedElement
    if ($null -ne $f -and -not $f.Current.IsOffscreen) { return ConvertFrom-FcuElement $f "FOCUSED" }
  } catch {}
  return $null
}

function Format-FcuOutput($digest) {
  $m = $digest.meta | ConvertTo-Json -Depth 3 -Compress
  return ($digest.text -join "`n") + "`n$script:FCU_MARKER $m"
}

function Get-FcuDigest {
  param(
    [switch]$Quick,
    [switch]$NoOcr,
    [string]$NameRegex = "",
    [int]$FindDepth = 8,
    [int]$FindMax = 30,
    [string]$TargetsJson = ""
  )
  if ($TargetsJson) {
    $probe = $null
    $ok = $false
    try { $probe = ConvertFrom-Json $TargetsJson; $ok = $true } catch {}
    if (-not $ok) {
      try { $TargetsJson = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($TargetsJson)) } catch { $TargetsJson = "" }
    }
    if ($TargetsJson) {
      return Get-FcuDigestMulti -Quick:$Quick -NoOcr:$NoOcr -TargetsJson $TargetsJson
    }
  }
  return Get-FcuDigestSingle -Quick:$Quick -NoOcr:$NoOcr -NameRegex:$NameRegex -FindDepth:$FindDepth -FindMax:$FindMax
}

function Resolve-FcuTargets([string]$TargetsJson) {
  $specs = @()
  try { $specs = @((ConvertFrom-Json $TargetsJson)) } catch { return @() }
  $winsList = @()
  $children = $null
  try {
    $children = $script:AUTO::RootElement.FindAll(
      [System.Windows.Automation.TreeScope]::Children,
      [System.Windows.Automation.Condition]::TrueCondition)
  } catch { return @() }
  foreach ($spec in $specs) {
    $s2 = "$spec"
    $mode = ""; $val = ""
    if ($s2 -match "^([a-zA-Z]+):(.+)$") { $mode = $Matches[1].ToLower(); $val = $Matches[2] } else { $mode = "re"; $val = $s2 }
    foreach ($c in $children) {
      try {
        $n = ""; $outPid = 0
        try { $n = $c.Current.Name } catch {}
        $h = Get-FcuHwndOfElement $c
        if ($h -eq [IntPtr]::Zero) { continue }
        [void][Fcu.Native]::GetWindowThreadProcessId($h, [ref]$outPid)
        $pname = ""
        try { $pname = Get-FcuProcessName $h } catch {}
        $matched = $false
        switch ($mode) {
          "hwnd" { $matched = ("$h" -eq $val) }
          "pid"   { $matched = ("$outPid" -eq $val) }
          "proc" { $matched = ($pname -like "*$val*") }
          "re"   { if ($val) { try { $matched = ($n -match $val) } catch { $matched = ($n -like "*$val*") } } }
          default { }
        }
        if ($matched) {
          $winsList += @{ hwnd = "$h"; el = $c; name = ($n -replace "[\r\n\t|]+", " "); process = $pname }
          break
        }
      } catch {}
    }
  }
  return $winsList
}

function Get-FcuDisplayIndexForRect($rect) {
  try {
    Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue
    $cx = $rect.X + $rect.Width / 2
    $cy = $rect.Y + $rect.Height / 2
    $n = 0
    foreach ($sc in [System.Windows.Forms.Screen]::AllScreens) {
      $b = $sc.Bounds
      if ($cx -ge $b.X -and $cx -le ($b.X + $b.Width) -and $cy -ge $b.Y -and $cy -le ($b.Y + $b.Height)) { return $n }
      $n++
    }
  } catch {}
  return 0
}

function Get-FcuDisplaySegment {
  param([int]$screenIdx, [System.Collections.Generic.List[string]]$lines, [switch]$NoOcr, [int]$maxWindowRowsPer = 30)
  try { Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue } catch {}
  try { Add-Type -AssemblyName System.Drawing -ErrorAction SilentlyContinue } catch {}
  $screens = [System.Windows.Forms.Screen]::AllScreens
  if ($screenIdx -lt 0 -or $screenIdx -ge $screens.Count) {
    $lines.Add("#ERR disp:$screenIdx not found (have 0..$($screens.Count - 1))")
    return
  }
  $sc = $screens[$screenIdx]
  $b = $sc.Bounds
  $lines.Add("#DX disp:$screenIdx primary=$($sc.Primary) name=$($sc.DeviceName) rect=$($b.X),$($b.Y),$($b.X + $b.Width),$($b.Y + $b.Height)")
  try {
    $children = $script:AUTO::RootElement.FindAll(
      [System.Windows.Automation.TreeScope]::Children,
      [System.Windows.Automation.Condition]::TrueCondition)
    $n = 0
    foreach ($c in $children) {
      try {
        $r = $c.GetCurrentPropertyValue($script:AUTO::BoundingRectangleProperty)
        if (-not $r -or [double]$r.X -lt -1e12) { continue }
        $cx = $r.X + $r.Width / 2
        if ($cx -lt $b.X -or $cx -gt ($b.X + $b.Width)) { continue }
        $n++
        if ($n -gt $maxWindowRowsPer) { break }
        $h = Get-FcuHwndOfElement $c
        $pname = ""
        try { $pname = Get-FcuProcessName $h } catch {}
        $name = ""
        try { $name = $c.Current.Name } catch {}
        $name = ($name -replace "[\r\n\t|]+", " ")
        if ($name.Length -gt 70) { $name = $name.Substring(0,70) }
        $lines.Add("#V$screenIdx disp=N$screenIdx hwnd=$h rect=$([int]$r.X),$([int]$r.Y),$([int]($r.X + $r.Width)),$([int]($r.Y + $r.Height)) $pname `"$name`"")
      } catch {}
    }
  } catch {}
  if (-not $NoOcr) {
    try {
      $cap = Get-FcuBitmap ([System.Windows.Rect]::new($b.X, $b.Y, $b.Width, $b.Height))
      if ($null -ne $cap) {
        $ocr = Invoke-FcuOcr -bmp $cap.bmp -OffsetX $cap.x -OffsetY $cap.y
        $cap.bmp.Dispose()
        if ($ocr.Count -gt 0) {
          $lines.Add("#OCR --- text visible on display $screenIdx ---")
          $ocr | ForEach-Object { $lines.Add("#O $_") }
        }
      }
    } catch {}
  }
}

function Get-FcuDigestMulti {
  param(
    [switch]$Quick,
    [switch]$NoOcr,
    [string]$TargetsJson = ""
  )
  $t0 = [System.Diagnostics.Stopwatch]::StartNew()
  $lines = New-Object System.Collections.Generic.List[string]
  $specs = @()
  try { $specs = @((ConvertFrom-Json $TargetsJson)) } catch {}
  $winSpecs = @()
  $dispSpecs = @()
  foreach ($s2 in $specs) {
    if ("$s2" -match "^disp:(\d+|primary)$" -or "$s2" -match "^disp:all$") { $dispSpecs += "$s2" }
    else { $winSpecs += "$s2" }
  }
  $targets = @()
  if ($winSpecs.Count -gt 0) {
    $targets = Resolve-FcuTargets (($winSpecs | ConvertTo-Json -Compress))
  }
  $meta = [ordered]@{ t = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
  $meta.targets = $targets.Count
  $meta.disp = $dispSpecs.Count
  $meta.specs = $TargetsJson
  if ($targets.Count -eq 0 -and $dispSpecs.Count -eq 0) {
    $lines.Add("#NOTARGETS none matched; falling back to foreground")
    $meta.fallback = $true
    return Get-FcuDigestSingle -Quick:$Quick -NoOcr:$NoOcr
  }
  if ($targets.Count -eq 0 -and $winSpecs.Count -gt 0) {
    $lines.Add("#NOTARGETS window specs matched nothing (display targets still active)")
  }
  $meta.hwnds = ($targets | ForEach-Object { $_.hwnd }) -join ","
  $idx = 0
  foreach ($t in $targets) {
    $idx++
    $rowsPer = if ($targets.Count -gt 1) { 70 } else { 140 }
    try { $el = $script:AUTO::FromHandle([IntPtr][long]$t.hwnd) } catch { $el = $null }
    if ($null -eq $el -and $t.el) { $el = $t.el }
    if ($null -eq $el) { $lines.Add("#TARGET $idx FAILED hwnd=$($t.hwnd)"); continue }
    [void](Get-OneWindowDigest -el $el -idx $idx -target $t -lines $lines -Quick:$Quick -NoOcr:($NoOcr -or $idx -gt 1) -MaxRows $rowsPer)
    if ($idx -eq 1) {
      $meta.process = $t.process
      $meta.winName = $t.name
      $meta.hwnd = $t.hwnd
    }
  }
  foreach ($ds in $dispSpecs) {
    if ($ds -eq "disp:all") {
      $scrCount = 0
      try { $scrCount = [System.Windows.Forms.Screen]::AllScreens.Count } catch {}
      for ($si = 0; $si -lt $scrCount; $si++) { Get-FcuDisplaySegment -screenIdx $si -lines $lines -NoOcr:($NoOcr -or $si -gt 0) }
    } else {
      $m = [regex]::Match($ds, "^disp:(\d+|primary)$")
      $screenIdx = 0
      if ($m.Groups[1].Value -notmatch "primary") { [void]([int]::TryParse($m.Groups[1].Value, [ref]$screenIdx)) }
      Get-FcuDisplaySegment -screenIdx $screenIdx -lines $lines -NoOcr:$NoOcr
    }
  }
  try {
    $wins = Get-FcuWindows
    if ($wins.Count -gt 0) { $lines.Add("#WINS --- open windows ---"); $wins | Select-Object -First 12 | ForEach-Object { $lines.Add("#V $_") } }
  } catch {}
  $meta.ms = $t0.ElapsedMilliseconds
  $meta.visionNeeded = ($lines.Count -lt 4)
  return @{ text = [string[]]$lines; meta = $meta }
}

function Get-OneWindowDigest {
  param($el, [int]$idx, $target, [System.Collections.Generic.List[string]]$lines, [switch]$Quick, [switch]$NoOcr, [int]$MaxRows = 140)
  $wr = [System.Windows.Rect]::Empty
  try {
    $r0 = $el.GetCurrentPropertyValue($script:AUTO::BoundingRectangleProperty)
    if ($r0 -and [double]$r0.X -gt -1e12) { $wr = $r0 }
  } catch {}
  $wn = ""
  try { $wn = $target.name } catch {}
  $lines.Add("#W$idx win=$($target.process) `"$wn`" winrect=$([int]$wr.X),$([int]$wr.Y),$([int]$wr.Width),$([int]$wr.Height) hwnd=$($target.hwnd)")
  if ($Quick) {
    foreach ($r in (Get-FcuRows -root $el -MaxDepth 2 -MaxRows 10)) { $lines.Add($r) }
    return
  }
  try {
    $fr = Get-FocusedRow
    if ($fr -and $idx -eq 1) { $lines.Add("#F $fr") }
  } catch {}
  $rows = Get-FcuRows -root $el -MaxDepth 7 -MaxRows $MaxRows
  $rows | ForEach-Object { $lines.Add($_) }
  if ($rows.Count -ge $MaxRows) { $lines.Add("#TRUNCATED window tree capped at $MaxRows rows") }
  if (-not $NoOcr -and $wr.Width -gt 4) {
    try {
      $cap = Get-FcuBitmap $wr
      if ($null -ne $cap) {
        $ocr = Invoke-FcuOcr -bmp $cap.bmp -OffsetX $cap.x -OffsetY $cap.y
        $cap.bmp.Dispose()
        if ($ocr.Count -gt 0) {
          $lines.Add("#OCR --- text visible in pixels (win $idx) ---")
          $ocr | ForEach-Object { $lines.Add("#O $_") }
        }
      }
    } catch {}
  }
}

function Get-FcuDigestSingle {
  param(
    [switch]$Quick,
    [switch]$NoOcr,
    [string]$NameRegex = "",
    [int]$FindDepth = 8,
    [int]$FindMax = 30
  )
  $t0 = [System.Diagnostics.Stopwatch]::StartNew()
  $lines = New-Object System.Collections.Generic.List[string]
  $meta = [ordered]@{ t = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
  $win = $null
  try { $win = Get-FcuWindow } catch {}
  if ($null -eq $win) {
    $lines.Add("DESKTOP: no active window detected (lock screen or no foreground).")
    return @{ text = [string[]]$lines; meta = $meta }
  }
  try {
    $hwnd = Get-FcuHwndOfElement $win
    $meta.hwnd = "$hwnd"
    if ($hwnd -ne [IntPtr]::Zero) {
      $meta.process = Get-FcuProcessName $hwnd
    }
    $wr = $win.GetCurrentPropertyValue($script:AUTO::BoundingRectangleProperty)
    if (-not $wr -or [double]$wr.X -lt -1e12) { $wr = [System.Windows.Rect]::new(0, 0, 0, 0) }
    $meta.winrect = "$([int]$wr.X),$([int]$wr.Y),$([int]$wr.Width),$([int]$wr.Height)"
    $wn = ""
    try { $wn = $win.Current.Name } catch {}
    $meta.winName = ($wn -replace "[\r\n\t|]+", " ")
  } catch {}
  $lines.Add("#W win=$($meta.process) `"$($meta.winName)`" winrect=$($meta.winrect) hwnd=$($meta.hwnd) cursor=$(Get-FcuCursor)")

  if ($NameRegex) {
    $st = @{ found = @() }
    try {
      VisitFind $win "" 0 $st ([regex]$NameRegex) $FindDepth $FindMax
    } catch {}
    if ($st.found.Count -eq 0) {
      $lines.Add("#NOFIND /$NameRegex/")
    } else {
      $lines.Add("#MATCHES /$NameRegex/ ->")
      $st.found | ForEach-Object { $lines.Add("#M $_") }
    }
    $meta.ms = $t0.ElapsedMilliseconds
    return @{ text = [string[]]$lines; meta = $meta }
  }

  try {
    $f = Get-FocusedRow
    if ($f) { $lines.Add("#F $f") }
  } catch {}

  if ($Quick) {
    foreach ($r in (Get-FcuRows -root $win -MaxDepth 2 -MaxRows 14)) { $lines.Add($r) }
    $meta.ms = $t0.ElapsedMilliseconds
    return @{ text = [string[]]$lines; meta = $meta }
  }

  $rows = Get-FcuRows -root $win -MaxDepth 7 -MaxRows 140
  $rows | ForEach-Object { $lines.Add($_) }
  if ($rows.Count -ge 140) { $lines.Add("#TRUNCATED tree capped at 140 rows") }

  if (-not $NoOcr) {
    try {
      $parts = "$($meta.winrect)" -split ","
      if ($parts.Count -eq 4) {
        $rect = [System.Windows.Rect]::new([int]$parts[0], [int]$parts[1], [int]$parts[2], [int]$parts[3])
        $cap = Get-FcuBitmap $rect
        if ($null -ne $cap) {
          $ocr = Invoke-FcuOcr -bmp $cap.bmp -OffsetX $cap.x -OffsetY $cap.y
          $cap.bmp.Dispose()
          if ($ocr.Count -gt 0) {
            $lines.Add("#OCR --- text visible in pixels ---")
            $ocr | ForEach-Object { $lines.Add("#O $_") }
          }
        }
      }
    } catch {}
  }

  try {
    $wins = Get-FcuWindows
    if ($wins.Count -gt 0) {
      $lines.Add("#WINS --- open windows ---")
      $wins | Select-Object -First 12 | ForEach-Object { $lines.Add("#V $_") }
    }
  } catch {}

  $meta.ms = $t0.ElapsedMilliseconds
  $meta.visionNeeded = ($rows.Count -lt 4)
  return @{ text = [string[]]$lines; meta = $meta }
}

function VisitFind($el, $path, $depth, $st, $regex, $maxDepth, $maxFind) {
  if ($depth -ge $maxDepth -or $st.found.Count -ge $maxFind) { return }
    $i = 0
    $child = $null
    try { $child = $script:WALKER.GetFirstChild($el) } catch { return }
    while ($null -ne $child) {
      $i++
      $childPath = if ($path -eq "") { "$i" } else { "$path.$i" }
      $row = ConvertFrom-FcuElement $child $childPath
      if ($row -and $row -match $regex) {
        $st.found = $st.found + @($row)
        if ($st.found.Count -ge $maxFind) { return }
      }
      VisitFind $child $childPath ($depth + 1) $st $regex $maxDepth $maxFind
      $child = $script:WALKER.GetNextSibling($child)
    }
  }

