param(
  [string]$StateDir = "$env:LOCALAPPDATA\Temp\opencode\opcompuse"
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

if (-not $StateDir) { $StateDir = "$env:LOCALAPPDATA\Temp\opencode\opcompuse" }
New-Item -ItemType Directory -Force -Path $StateDir | Out-Null
$hudPath = Join-Path $StateDir "hud.json"
try { [IO.File]::AppendAllText((Join-Path $StateDir "hud-trace.log"), (Get-Date -f 'HH:mm:ss.fff') + " start pid=$PID sta=" + [Threading.Thread]::CurrentThread.ApartmentState + "`r`n") } catch {}
$existing = $null
try {
  $existing = Get-Content $hudPath -Raw -ErrorAction SilentlyContinue | ConvertFrom-Json
} catch {}
if ($existing -and $existing.pid -and $existing.pid -ne $PID) {
  $alive = $false
  try { $alive = $null -ne (Get-Process -Id $existing.pid -ErrorAction SilentlyContinue) } catch {}
  if ($alive) { exit 0 }
}
[IO.File]::WriteAllText($hudPath, '{"t":' + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + ',"pid":' + $PID + '}', [Text.Encoding]::UTF8)

if (-not ('OpuHud.Form' -as [type])) {
Add-Type -ReferencedAssemblies System.Windows.Forms,System.Drawing -TypeDefinition @"
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Timers;
using System.Windows.Forms;

namespace OpuHud {
public class Form : System.Windows.Forms.Form {
  [DllImport("user32.dll")] static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);
  [DllImport("user32.dll")] static extern bool UnregisterHotKey(IntPtr hWnd, int id);
  const uint MOD_ALT = 0x1, MOD_CONTROL = 0x2, MOD_SHIFT = 0x4;
  const int HOTKEY_STOP = 0xA020, WM_HOTKEY = 0x0312;

  Label lbl; Button btn; System.Windows.Forms.Timer poll;
  public string StateDir;

  public Form() {
    TopMost = true;
    FormBorderStyle = FormBorderStyle.None;
    ShowInTaskbar = false;
    StartPosition = FormStartPosition.Manual;
    Size = new System.Drawing.Size(200, 30);
    var wa = Screen.PrimaryScreen.WorkingArea;
    Location = new System.Drawing.Point(wa.Right - Width - 12, wa.Top + 8);
    BackColor = System.Drawing.Color.FromArgb(28, 28, 32);
    Opacity = 0.92;

    lbl = new Label { AutoSize = false, Dock = DockStyle.Left, Width = 140, TextAlign = System.Drawing.ContentAlignment.MiddleLeft,
                      ForeColor = System.Drawing.Color.FromArgb(170, 170, 175), Font = new System.Drawing.Font("Segoe UI", 9f, System.Drawing.FontStyle.Bold), Text = "OPU ○" };
    btn = new Button { Dock = DockStyle.Right, Width = 52, FlatStyle = FlatStyle.Flat, Text = "STOP",
                       ForeColor = System.Drawing.Color.FromArgb(255, 120, 120), BackColor = System.Drawing.Color.FromArgb(48, 28, 28) };
    btn.FlatAppearance.BorderSize = 0;
    btn.Click += OnStop;

    Controls.Add(lbl); Controls.Add(btn);

    poll = new System.Windows.Forms.Timer { Interval = 250 };
    poll.Tick += (s, e) => OnPoll();
    poll.Start();

    HandleCreated += (s, e) => {
      RegisterHotKey(Handle, HOTKEY_STOP, MOD_CONTROL | MOD_ALT | MOD_SHIFT, 0x58);
    };
    HandleDestroyed += (s, e) => { UnregisterHotKey(Handle, HOTKEY_STOP); Trace-Hud("destroyed"); };
  }

  public void TraceHud(string m) { try { Text += ""; } catch {} }
  static void TraceHudStatic(string msg, string dir) {
    try { System.IO.File.AppendAllText(System.IO.Path.Combine(dir, "hud-trace.log"), DateTime.Now.ToString("HH:mm:ss.fff") + " " + msg + "\r\n"); } catch {}
  }
  }

  protected override void WndProc(ref Message m) {
    if (m.Msg == WM_HOTKEY && m.WParam.ToInt32() == HOTKEY_STOP) { DoStop("hotkey Ctrl+Alt+Shift+X"); return; }
    if (m.Msg == 0x0084) { if ((int)m.Result == -1) m.Result = (IntPtr)2; }
    base.WndProc(ref m);
  }

  void OnStop(object sender, EventArgs e) { DoStop("STOP button"); }

  void DoStop(string by) {
    try { File.WriteAllText(Path.Combine(StateDir, "stop.json"), "{\"t\":" + DateTime.Now.Ticks + ",\"by\":\"" + by + "\"}"); } catch {}
    lbl.Text = "OPU ■ STOPPED";
    lbl.ForeColor = System.Drawing.Color.FromArgb(255, 150, 90);
  }

  void OnPoll() {
    if (lbl.Text == "OPU ■ STOPPED") return;
    try {
      string stopPath = Path.Combine(StateDir, "stop.json");
      if (File.Exists(stopPath)) {
        lbl.Text = "OPU ■ STOPPED";
        lbl.ForeColor = System.Drawing.Color.FromArgb(255, 150, 90);
        return;
      }
      string alivePath = Path.Combine(StateDir, "alive.json");
      bool watching = false;
      if (File.Exists(alivePath)) {
        var line = File.ReadAllText(alivePath);
        var tidx = line.IndexOf("\"t\":");
        if (tidx >= 0) {
          long t = long.Parse(line.Substring(tidx + 4).Trim(' ', ',', '}'));
          var t2 = System.DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
          if (t2 - t < 4000) watching = true;
        }
      }
      string runPath = Path.Combine(StateDir, "running.json");
      bool running = false;
      if (File.Exists(runPath)) {
        var line = File.ReadAllText(runPath);
        var tidx = line.IndexOf("\"t\":");
        if (tidx >= 0) {
          long t = long.Parse(line.Substring(tidx + 4).Trim(' ', ',', '}'));
          var t2 = System.DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
          if (t2 - t < 1500) running = true;
        }
      }
      if (running) {
        lbl.Text = "OPU ▶ RUNNING";
        lbl.ForeColor = System.Drawing.Color.FromArgb(255, 190, 90);
      } else if (watching) {
        lbl.Text = "OPU ● WATCHING";
        lbl.ForeColor = System.Drawing.Color.FromArgb(120, 235, 150);
      } else {
        lbl.Text = "OPU ○";
        lbl.ForeColor = System.Drawing.Color.FromArgb(150, 150, 155);
      }
    } catch {}
  }

  protected override void OnFormClosing(FormClosingEventArgs e) { base.OnFormClosing(e); }
}

static class Program {
  [STAThread]
  public static void Main(string[] args) {
    string stateDir = args.Length > 0 ? args[0] : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Temp", "opencode", "opcompuse");
    string hudPath = Path.Combine(stateDir, "hud.json");
    try {
      if (File.Exists(hudPath)) {
        string prev = File.ReadAllText(hudPath);
        int i = prev.IndexOf("\"pid\":");
        if (i >= 0) {
          int pid = Int32.Parse(prev.Substring(i + 6).Trim(' ', ',', '}'));
          bool alive = false;
          try { var p = System.Diagnostics.Process.GetProcessById(pid); alive = !p.HasExited; } catch {}
          if (alive) return;
        }
      }
      Directory.CreateDirectory(stateDir);
      File.WriteAllText(hudPath, "{\"t\":" + DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + ",\"pid\":" + System.Diagnostics.Process.GetCurrentProcess().Id + "}");
    } catch {}
    var f = new Form();
    f.StateDir = stateDir;
    Application.EnableVisualStyles();
    Application.Run(f);
    try { if (File.Exists(hudPath)) File.Delete(hudPath); } catch {}
  }
}
}
"@
}

function Trace-Hud([string]$msg) {
  try { [IO.File]::AppendAllText((Join-Path $StateDir "hud-trace.log"), (Get-Date -f 'HH:mm:ss.fff') + " $msg`r`n") } catch {}
}
[System.Windows.Forms.Application]::EnableVisualStyles()
$f = New-Object OpuHud.Form
Trace-Hud "form constructed"
if ($StateDir) { $f.StateDir = $StateDir }
try {
  [System.Windows.Forms.Application]::Run($f)
  Trace-Hud "run returned"
} catch {
  Trace-Hud "run threw: $($_.Exception.Message)"
} finally {
  try { if (Test-Path $hudPath) { Remove-Item $hudPath -Force -ErrorAction SilentlyContinue } } catch {}
}
