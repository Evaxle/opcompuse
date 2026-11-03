using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace OpuHud
{
    public class OpuForm : Form
    {
        [DllImport("user32.dll")] static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);
        [DllImport("user32.dll")] static extern bool UnregisterHotKey(IntPtr hWnd, int id);
        const uint MOD_ALT = 0x1, MOD_CONTROL = 0x2, MOD_SHIFT = 0x4;
        const int HOTKEY_STOP = 0xA020, WM_HOTKEY = 0x0312;
        const int GWL_EXSTYLE = -20;
        const int WS_EX_NOACTIVATE = 0x08000000;
        const int WS_EX_TOOLWINDOW = 0x00000080;

        readonly Label lw; readonly Label lr; readonly Label linfo; readonly Button btn;
        readonly Timer poll;
        readonly string stateDir;
        string lastText = "";
        int targetCount = 0;
        int dispCount = 0;

        public OpuForm(string dir)
        {
            stateDir = dir;
            TopMost = true;
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            Size = new Size(330, 34);
            var wa = Screen.PrimaryScreen.WorkingArea;
            Location = new Point(wa.Right - Width - 12, wa.Top + 8);
            BackColor = Color.FromArgb(24, 26, 32);
            DoubleBuffered = true;

            lw = new Label { AutoSize = false, Location = new Point(4, 2), Size = new Size(96, 12), Font = new Font("Consolas", 7.5f, FontStyle.Bold), Text = "" };
            lr = new Label { AutoSize = false, Location = new Point(104, 2), Size = new Size(80, 12), Font = new Font("Consolas", 7.5f, FontStyle.Bold), Text = "" };
            linfo = new Label { AutoSize = false, Location = new Point(4, 15), Size = new Size(230, 14), Font = new Font("Consolas", 8f), ForeColor = Color.FromArgb(150, 152, 160), Text = "" };
            btn = new Button
            {
                Dock = DockStyle.Right,
                Width = 54,
                FlatStyle = FlatStyle.Flat,
                Text = "STOP",
                ForeColor = Color.FromArgb(255, 120, 120),
                BackColor = Color.FromArgb(52, 26, 26),
                Cursor = Cursors.Hand
            };
            btn.FlatAppearance.BorderSize = 0;
            btn.FlatAppearance.MouseOverBackColor = Color.FromArgb(92, 34, 34);
            btn.Click += (s, e) => DoStop("STOP button");
            Controls.Add(btn);
            Controls.Add(lw); Controls.Add(lr); Controls.Add(linfo);

            poll = new Timer { Interval = 250 };
            poll.Tick += (s, e) => OnPoll();
            poll.Start();

            HandleCreated += (s, e) => RegisterHotKey(Handle, HOTKEY_STOP, MOD_CONTROL | MOD_ALT | MOD_SHIFT, 0x58);
            HandleDestroyed += (s, e) => UnregisterHotKey(Handle, HOTKEY_STOP);
        }

        protected override CreateParams CreateParams
        {
            get
            {
                var cp = base.CreateParams;
                cp.ExStyle |= WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW;
                return cp;
            }
        }

        protected override void WndProc(ref Message m)
        {
            if (m.Msg == WM_HOTKEY && m.WParam.ToInt32() == HOTKEY_STOP) { DoStop("hotkey Ctrl+Alt+Shift+X"); return; }
            if (m.Msg == 0x0084) m.Result = (IntPtr)2;
            base.WndProc(ref m);
        }

        void DoStop(string by)
        {
            try
            {
                File.WriteAllText(Path.Combine(stateDir, "stop.json"),
                    "{\"t\":" + DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + ",\"by\":\"" + by + "\"}");
            }
            catch { }
        }

        void OnPoll()
        {
            try
            {
                string stopP = Path.Combine(stateDir, "stop.json");
                string aliveP = Path.Combine(stateDir, "alive.json");
                string runP = Path.Combine(stateDir, "running.json");

                bool stopped = File.Exists(stopP);
                long at = 0; long rt = 0; int steps = 0; string app = "";
            try
            {
                var a = File.ReadAllText(aliveP);
                at = ParseT(a);
                int i = a.IndexOf("\"process\":\""); if (i >= 0) { int j = a.IndexOf('"', i + 11); app = a.Substring(i + 11, j - i - 11); }
                int k = a.IndexOf("\"targets\":"); if (k >= 0) { int m = k + 10; int n = m; while (n < a.Length && char.IsDigit(a[n])) n++; int.TryParse(a.Substring(m, n - m), out targetCount); }
                int kd = a.IndexOf("\"disp\":"); if (kd >= 0) { int m2 = kd + 7; int n2 = m2; while (n2 < a.Length && char.IsDigit(a[n2])) n2++; int.TryParse(a.Substring(m2, n2 - m2), out dispCount); }
            }
            catch { }
                try
                {
                    var r = File.ReadAllText(runP);
                    rt = ParseT(r);
                    int i = r.IndexOf("\"steps\":"); if (i >= 0) { int j = i + 8; int k = j; while (k < r.Length && char.IsDigit(r[k])) k++; int.TryParse(r.Substring(j, k - j), out steps); }
                }
                catch { }
                int rn = 0;
                try { var c2 = GetCycle(aliveP); rn = c2; } catch { }

                bool running = rt > 0 && DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - rt < 1500;
                bool watching = at > 0 && DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - at < 4000;

                                lw.ForeColor = stopped ? Color.FromArgb(255, 150, 90) : (watching ? Color.FromArgb(120, 235, 150) : Color.FromArgb(120, 122, 130));
                lw.Text = stopped ? "W: STOPPED" : (watching ? "W: WATCHING" : "W: idle");

                lr.ForeColor = running ? Color.FromArgb(255, 190, 90) : Color.FromArgb(120, 122, 130);
                lr.Text = running ? "R: RUNNING" + (steps > 0 ? " x" + steps : "") : "R: -";

                linfo.ForeColor = stopped ? Color.FromArgb(255, 150, 90) : Color.FromArgb(150, 152, 160);
                string extra = "";
                if (stopped) extra = "press t / opcompuse_watch on to resume";
                else if (running) extra = "acting: " + app + (steps > 0 ? " (step " + steps + ")" : "");
                else if (watching) extra = "watching: " + app + (targetCount > 1 ? " +" + (targetCount - 1) + " more windows" : "") + (dispCount > 0 ? " | " + dispCount + " display(s)" : "");
                var txt = extra;
                if (txt != lastText)
                {
                    linfo.Text = txt;
                    lastText = txt;
                }
            }
            catch { }
        }

        static int GetCycle(string path) { try
        {
            var a = File.ReadAllText(path);
            int i = a.IndexOf("\"cycle\":"); if (i < 0) return 0;
            int j = i + 8, k = j; while (k < a.Length && char.IsDigit(a[k])) k++;
            int v; int.TryParse(a.Substring(j, Math.Max(1, k - j)), out v); return v;
        } catch { return 0; } }

        static long ParseT(string line)
        {
            int i = line.IndexOf("\"t\":");
            if (i < 0) return 0;
            int j = i + 4, k = j;
            while (k < line.Length && char.IsDigit(line[k])) k++;
            long v = 0; long.TryParse(line.Substring(j, Math.Max(1, k - j)), out v);
            return v;
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            try
            {
                using (var b = new LinearGradientBrush(ClientRectangle,
                    Color.FromArgb(26, 28, 36), Color.FromArgb(14, 16, 22), 60f))
                {
                    e.Graphics.FillRectangle(b, ClientRectangle);
                    using (var pen = new Pen(Color.FromArgb(90, 110, 210), 1f))
                        e.Graphics.DrawRectangle(pen, 0, 0, Width - 1, Height - 1);
                }
            }
            catch { }
        }

        internal static string JsonObject(params object[] kv)
        {
            var sb = new System.Text.StringBuilder("{");
            for (int i = 0; i < kv.Length; i += 2)
            {
                if (i > 0) sb.Append(',');
                sb.Append('"').Append(kv[i]).Append("\":");
                var v = kv[i + 1];
                if (v is string) sb.Append('"').Append(v).Append('"');
                else sb.Append(v.ToString());
            }
            sb.Append('}');
            return sb.ToString();
        }
    }

    public static class Program
    {
        [STAThread]
        public static void Main(string[] args)
        {
            string stateDir = args.Length > 0
                ? args[0]
                : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "Temp", "opencode", "opcompuse");

            string hudPath = Path.Combine(stateDir, "hud.json");
            Directory.CreateDirectory(stateDir);
            try
            {
                if (File.Exists(hudPath))
                {
                    var prev = File.ReadAllText(hudPath);
                    int i = prev.IndexOf("\"pid\":");
                    if (i >= 0)
                    {
                        int pid = int.Parse(prev.Substring(i + 6).Trim(' ', ',', '}'));
                        bool alive = false;
                        try { using (var p = System.Diagnostics.Process.GetProcessById(pid)) { if (p != null) alive = true; } } catch { }
                        if (alive) return;
                    }
                }
                File.WriteAllText(hudPath, OpuForm.JsonObject("t", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), "pid", System.Diagnostics.Process.GetCurrentProcess().Id));
            }
            catch { }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            var form = new OpuForm(stateDir);
            try
            {
                Application.Run(form);
            }
            finally
            {
                try { if (File.Exists(hudPath)) File.Delete(hudPath); } catch { }
            }
        }
    }

    }

