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

        readonly Label lbl;
        readonly Button btn;
        readonly Timer poll;
        readonly string stateDir;

        public OpuForm(string dir)
        {
            stateDir = dir;
            TopMost = true;
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            Size = new Size(214, 34);
            var wa = Screen.PrimaryScreen.WorkingArea;
            Location = new Point(wa.Right - Width - 12, wa.Top + 8);
            BackColor = Color.FromArgb(24, 26, 32);
            PaintGradient = true;

            lbl = new Label
            {
                AutoSize = false,
                Dock = DockStyle.Left,
                Width = 158,
                TextAlign = ContentAlignment.MiddleLeft,
                ForeColor = Color.FromArgb(170, 170, 176),
                Font = new Font("Segoe UI", 9f, FontStyle.Bold),
                Text = "OPU ..."
            };
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
            Controls.Add(lbl);

            poll = new Timer { Interval = 300 };
            poll.Tick += (s, e) => OnPoll();
            poll.Start();

            HandleCreated += (s, e) => RegisterHotKey(Handle, HOTKEY_STOP, MOD_CONTROL | MOD_ALT | MOD_SHIFT, 0x58);
            HandleDestroyed += (s, e) => UnregisterHotKey(Handle, HOTKEY_STOP);

            try
            {
                using (var g = CreateGraphics())
                {
                    g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                    g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;
                }
            }
            catch { }
        }

        public bool PaintGradient { get; set; }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            try
            {
                using (var b = new LinearGradientBrush(ClientRectangle,
                    Color.FromArgb(26, 28, 36), Color.FromArgb(14, 16, 22), 60f))
                {
                    var g = e.Graphics;
                    e.Graphics.FillRectangle(b, ClientRectangle);
                    using (var pen = new Pen(Color.FromArgb(90, 110, 210), 1f))
                        g.DrawRectangle(pen, 0, 0, Width - 1, Height - 1);
                }
            }
            catch { }
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
                    JsonObject("t", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), "by", by));
            }
            catch { }
            lbl.Text = "OPU STOPPED";
            lbl.ForeColor = Color.FromArgb(255, 150, 90);
        }

        void OnPoll()
        {
            if (lbl.Text == "OPU STOPPED") return;
            try
            {
                bool stopped = File.Exists(Path.Combine(stateDir, "stop.json"));
                bool watching = Fresh(Path.Combine(stateDir, "alive.json"), 4000);
                bool running = Fresh(Path.Combine(stateDir, "running.json"), 1500);

                if (running)
                {
                    lbl.Text = "OPU RUNNING";
                    lbl.ForeColor = Color.FromArgb(255, 190, 90);
                }
                else if (watching)
                {
                    lbl.Text = "OPU WATCHING";
                    lbl.ForeColor = Color.FromArgb(120, 235, 150);
                }
                else if (stopped)
                {
                    lbl.Text = "OPU STOPPED";
                    lbl.ForeColor = Color.FromArgb(255, 150, 90);
                }
                else
                {
                    lbl.Text = "OPU idle";
                    lbl.ForeColor = Color.FromArgb(150, 150, 158);
                }
            }
            catch { }
        }

        static bool Fresh(string path, long maxAgeMs)
        {
            try
            {
                var line = File.ReadAllText(path);
                int i = line.IndexOf("\"t\":");
                if (i < 0) return false;
                int j = i + 4;
                int k = j;
                while (k < line.Length && (char.IsDigit(line[k]))) k++;
                long t = long.Parse(line.Substring(j, k - j));
                return DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - t < maxAgeMs;
            }
            catch { return false; }
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
