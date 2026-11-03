param(
  [string]$StepsB64 = "",
  [string]$StepsJson = "",
  [int]$MinDelayMs = 20,
  [string]$StateDir = ""
)
$ErrorActionPreference = 'Continue'
. "$PSScriptRoot\opcompuse.lib.ps1"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

if (-not $StateDir) { $StateDir = "$env:TEMP\opencode\opcompuse" }
$stopPath = Join-Path $StateDir "stop.json"
$runPath = Join-Path $StateDir "running.json"
[IO.File]::WriteAllText($runPath, '{"t":' + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + ',"pid":' + $PID + '}', [Text.Encoding]::UTF8)

if ($StepsB64) { $json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($StepsB64)) }
else { $json = $StepsJson }
try { $steps = $json | ConvertFrom-Json } catch {
  [IO.File]::WriteAllText($runPath, '{"t":0}', [Text.Encoding]::UTF8)
  "#ACT bad steps json: $($_.Exception.Message)"
  exit 0
}

$out = New-Object System.Collections.Generic.List[string]
$ok = 0; $fail = 0

function Press-Button([string]$which, [int]$clicks) {
  for ($i = 0; $i -lt $clicks; $i++) {
    if ($which -eq "right") {
      [Fcu.Native]::mouse_event($script:MOUSE_RIGHT_DOWN, 0, 0, 0)
      Start-Sleep -Milliseconds 14
      [Fcu.Native]::mouse_event($script:MOUSE_RIGHT_UP, 0, 0, 0)
    } elseif ($which -eq "middle") {
      [Fcu.Native]::mouse_event([uint32]0x0020, 0, 0, 0)
      Start-Sleep -Milliseconds 14
      [Fcu.Native]::mouse_event([uint32]0x0040, 0, 0, 0)
    } else {
      [Fcu.Native]::mouse_event($script:MOUSE_LEFT_DOWN, 0, 0, 0)
      Start-Sleep -Milliseconds 14
      [Fcu.Native]::mouse_event($script:MOUSE_LEFT_UP, 0, 0, 0)
    }
    Start-Sleep -Milliseconds 45
  }
}
function Set-Mouse([int]$x, [int]$y) {
  [void][Fcu.Native]::SetCursorPos($x, $y)
  Start-Sleep -Milliseconds 12
}
function Convert-SendKeysText([string]$s) {
  $s = $s.Replace("{", "{{}").Replace("}", "{}}")
  foreach ($c in "+", "^", "%", "~", "(", ")", "[", "]") { $s = $s.Replace($c, "{" + $c + "}") }
  return $s
}
$KEYMAP = @{
  enter = "{ENTER}"; tab = "{TAB}"; esc = "{ESC}"; escape = "{ESC}"
  backspace = "{BS}"; delete = "{DEL}"; del = "{DEL}"
  up = "{UP}"; down = "{DOWN}"; left = "{LEFT}"; right = "{RIGHT}"
  home = "{HOME}"; end = "{END}"; pgup = "{PGUP}"; pgdn = "{PGDN}"
  space = " "; capslock = "{CAPSLOCK}"; insert = "{INSERT}"
}
function Convert-Combo([string]$combo) {
  $parts = $combo.ToLower().Split("+") | ForEach-Object { $_.Trim() } | Where-Object { $_ }
  $prefix = ""
  $body = ""
  foreach ($p in $parts) {
    switch ($p) {
      "ctrl"  { $prefix += "^" }
      "alt"   { $prefix += "%" }
      "shift" { $prefix += "+" }
      "win"   { return $null }
      default {
        if ($KEYMAP.ContainsKey($p)) { $body += $KEYMAP[$p] }
        elseif ($p -match "^f([1-9]|1[0-6])$") { $body += "{$($p.ToUpper())}" }
        else { $body += $p }
      }
    }
  }
  return $prefix + $body
}

function Get-WindowElByHwnd([string]$hwndStr) {
  try { return $script:AUTO::FromHandle([IntPtr][long]$hwndStr) } catch { return $null }
}
function Get-ElByPath($root, [string]$path) {
  if ($null -eq $root) { return $null }
  $el = $root
  foreach ($i in ($path -split "\.")) {
    $idx = [int]$i
    $child = $null
    $n = 0
    try { $child = $script:WALKER.GetFirstChild($el) } catch { return $null }
    while ($null -ne $child) {
      $n++
      if ($n -eq $idx) { break }
      $child = $script:WALKER.GetNextSibling($child)
    }
    if ($null -eq $child -or $idx -lt 1) { return $null }
    $el = $child
  }
  return $el
}
function Invoke-ElementOp($el, [string]$op, [string]$value) {
  if ($null -eq $el) { throw "element not found" }
  $pat = $null; $type = $null
  switch ($op) {
    "invoke" { $type = [System.Windows.Automation.InvokePattern] }
    "select" { $type = [System.Windows.Automation.SelectionItemPattern] }
    "toggle" { $type = [System.Windows.Automation.TogglePattern] }
    "expand" { $type = [System.Windows.Automation.ExpandCollapsePattern] }
    "collapse" { $type = [System.Windows.Automation.ExpandCollapsePattern] }
    "set"    { $type = [System.Windows.Automation.ValuePattern] }
  }
  if ($type) {
    try { $pat = $el.GetCurrentPattern($type) } catch { $pat = $null }
    if ($pat) {
      switch ($op) {
        "invoke"   { $pat.Invoke(); return $null }
        "select"   { $pat.Select(); return $null }
        "toggle"   { $pat.Toggle(); return $null }
        "expand"   { $pat.Expand(); return $null }
        "collapse" { $pat.Collapse(); return $null }
        "set"      { $pat.SetValue($value); return $null }
      }
    }
  }
  if ($op -eq "focus") {
    try { $el.SetFocus(); return $null } catch {}
    try {
      $pt = $el.GetClickablePoint()
      Set-Mouse ([int]$pt.X) ([int]$pt.Y)
      Press-Button "left" 1
      return "fallback-click"
    } catch {}
    try { $el.SetFocus() ; return $null } catch {}
    throw "element cannot receive focus and has no clickable point"
  }
  if ($op -in "invoke", "select", "clickel", "toggle", "expand", "collapse") {
    $pt = $el.GetClickablePoint()
    Set-Mouse ([int]$pt.X) ([int]$pt.Y)
    Press-Button "left" 1
    return "fallback-click"
  }
  throw "unsupported op on element: $op"
}
function Invoke-ElementStep($s, $op) {
  $rootEl = $null
  if ($s.hwnd) { $rootEl = Get-WindowElByHwnd "$($s.hwnd)" }
  if ($null -eq $rootEl) { $rootEl = Get-FcuWindow }
  if ($null -eq $rootEl) { throw "no active window" }
  if ($op -eq "scrollintoview") {
    $el = Get-ElByPath $rootEl "$($s.el)"
    if ($null -eq $el) { throw "element '$($s.el)' not found" }
    try { $el.GetCurrentPattern([System.Windows.Automation.ScrollItemPattern]).ScrollIntoView(); "ok" }
    catch { $el.SetFocus(); "fallback-focus" }
  } else {
    $el = Get-ElByPath $rootEl "$($s.el)"
    return (Invoke-ElementOp $el $op "$($s.value)")
  }
}

function Test-StopRequested {
  if (-not (Test-Path $stopPath)) { return $false }
  [IO.File]::WriteAllText($runPath, '{"t":0}', [Text.Encoding]::UTF8)
  return $true
}

$stepIdx = 0
foreach ($s in $steps) {
  if (Test-StopRequested) {
    $out.Add("#STOPPED opu stop requested before step $stepIdx")
    break
  }
  $stepIdx++
  $err = $null
  $note = ""
  try {
    $op = "$($s.op)"
    switch ($op) {
      "click" {
        $btn = if ($s.button) { "$($s.button)" } else { "left" }
        $clicks = if ($s.double) { 2 } else { 1 }
        Set-Mouse ([int]$s.x) ([int]$s.y)
        Press-Button $btn $clicks
      }
      "move" { Set-Mouse ([int]$s.x) ([int]$s.y) }
      "wheel" {
        $dy = [int]([double]$s.y * 120)
        $data = [BitConverter]::ToUInt32([BitConverter]::GetBytes([int]$dy), 0)
        [Fcu.Native]::mouse_event($script:MOUSE_WHEEL, 0, 0, $data)
      }
      "write" { [System.Windows.Forms.SendKeys]::SendWait((Convert-SendKeysText "$($s.text)")) }
      "key" {
        $combo = Convert-Combo "$($s.key)"
        if ($null -eq $combo) { throw "win key unsupported in 'key'; use a windows-mcp Shortcut call for Win combos" }
        [System.Windows.Forms.SendKeys]::SendWait($combo)
      }
      "win" {
        $target = $null
        try {
          $children = $script:AUTO::RootElement.FindAll(
            [System.Windows.Automation.TreeScope]::Children,
            [System.Windows.Automation.Condition]::TrueCondition)
          $needle = "$($s.title)"
          foreach ($c in $children) {
            try {
              $n = $c.Current.Name
              if ($n -and $n.IndexOf($needle, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) { $target = $c; break }
            } catch {}
          }
        } catch {}
        if ($null -eq $target) { throw "no top-level window like '$($s.title)'" }
        $h = Get-FcuHwndOfElement $target
        if ($h -ne [IntPtr]::Zero) { [void][Fcu.Native]::SetForegroundWindow($h) }
        Start-Sleep -Milliseconds 120
      }
      "wait" { Start-Sleep -Milliseconds ([Math]::Max(1, [int]$s.ms)) }
      "invoke" { Invoke-ElementStep $s $op | Out-Null; if ($LASTEXITCODE -eq $null) { $note = "" } }
      "select" { Invoke-ElementStep $s $op | Out-Null }
      "focus" { Invoke-ElementStep $s $op | Out-Null }
      "toggle" { Invoke-ElementStep $s $op | Out-Null }
      "expand" { Invoke-ElementStep $s $op | Out-Null }
      "collapse" { Invoke-ElementStep $s $op | Out-Null }
      "set" { Invoke-ElementStep $s $op | Out-Null }
      "clickel" { Invoke-ElementStep $s $op | Out-Null }
      "scrollintoview" { Invoke-ElementStep $s $op | Out-Null }
      default { throw "unknown op '$op'" }
    }
  } catch {
    $err = $_.Exception.Message
  }
  if ($err) { $fail++; $out.Add("#STEP $stepIdx op=$($s.op) FAILED $err") }
  else { $ok++; $out.Add("#STEP $stepIdx op=$($s.op) ok$(if ($note) { "=$note" })") }
  if ($op -ne "wait") { Start-Sleep -Milliseconds $MinDelayMs }
}

$out.Add("#ACT done ok=$ok failed=$fail")
[IO.File]::WriteAllText($runPath, '{"t":0}', [Text.Encoding]::UTF8)
try {
  $final = Get-FcuDigest -Quick -NoOcr
  foreach ($l in $final.text) { $out.Add($l) }
  $out.Add("$script:FCU_MARKER $(($final.meta | ConvertTo-Json -Depth 3 -Compress))")
} catch {}
(($out -join "`n"))
