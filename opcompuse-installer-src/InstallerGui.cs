using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Linq;
using System.IO.Compression;
using System.Reflection;
using System.Text;
using System.Windows.Forms;

namespace OpuInstallerGui
{
public class Installer : Form
{
    const string PluginRel = @".opencode\plugins\opcompuse";
    const string MemRel    = @".local\share\opencode\opcompuse\apex-memory";
    int page = 0;
    readonly Panel content = new Panel();
    readonly Button back = new Button(), next = new Button(), quit = new Button();
    readonly ProgressBar bar = new ProgressBar();
    readonly Label status = new Label();
    bool accepted, restart = true, installing, done;

    public Installer(bool noRestart)
    {
        restart = !noRestart;
        Text = "OPCOMPUSE installer";
        Size = new Size(760, 560);
        MinimumSize = new Size(760, 560);
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedSingle;
        MaximizeBox = false;
        try { Icon = LoadLogoIcon(); } catch { }

        back.Text = "< Back";
        next.Text = "Next >";
        quit.Text = "Cancel";
        back.Size = next.Size = quit.Size = new Size(90, 30);
        back.Location = new Point(468, 488);
        next.Location = new Point(566, 488);
        quit.Location = new Point(664, 488);
        back.Click += (s, e) => { if (page > 0) { page--; RenderPage(); } };
        next.Click += (s, e) => Next();
        quit.Click += (s, e) => Close();
        Controls.Add(back); Controls.Add(next); Controls.Add(quit);

        content.Size = new Size(736, 470);
        content.Location = new Point(12, 10);
        content.AutoScroll = true;
        Controls.Add(content);

        bar.Size = new Size(672, 20);
        bar.Location = new Point(44, 496);
        bar.Visible = false;
        Controls.Add(bar);
        status.Size = new Size(400, 22);
        status.Location = new Point(44, 488);
        Controls.Add(status);
        RenderPage();
    }

    System.Drawing.Icon LoadLogoIcon()
    {
        using (var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("opcompuse.logo.png"))
        using (var ms = new MemoryStream())
        {
            if (s == null) return null;
            var bytes = new byte[s.Length];
            s.Read(bytes, 0, bytes.Length);
            File.WriteAllBytes(Path.Combine(Path.GetTempPath(), "opcompuse_logo.png"), bytes);
            var bmp = Image.FromFile(Path.Combine(Path.GetTempPath(), "opcompuse_logo.png"));
            return System.Drawing.Icon.FromHandle(((Bitmap)bmp).GetHicon());
        }
    }

    void RenderPage()
    {
        content.Controls.Clear();
        if (page == 0) Welcome();
        else if (page == 1) Legal();
        else if (page == 2) Finish();
        back.Visible = page > 0;
        next.Visible = page < 2;
        next.Enabled = page == 0 || (page == 1 && accepted);
    }

    void Welcome()
    {
        var pic = new PictureBox { Size = new Size(96, 96), Location = new Point(20, 20) };
        try
        {
            using (var rs = Assembly.GetExecutingAssembly().GetManifestResourceStream("opcompuse.logo.png"))
            {
                pic.Image = Image.FromStream(rs);
            }
        }
        catch { }
        content.Controls.Add(pic);

        var title = new Label
        {
            Text = "OPCOMPUSE",
            Font = new Font("Segoe UI", 22, FontStyle.Bold),
            Location = new Point(130, 34),
            AutoSize = true,
            ForeColor = Color.FromArgb(24, 28, 40)
        };
        var sub = new Label
        {
            Text = "The fast, cheap, memory-smart computer-use plugin for OpenCode",
            Location = new Point(134, 78),
            AutoSize = true,
            ForeColor = Color.DimGray
        };
        var feats = new Label
        {
            Font = new Font("Segoe UI", 10),
            Location = new Point(28, 140),
            Size = new Size(660, 180),
            ForeColor = Color.FromArgb(40, 44, 56),
            Text =
                "  * Screen understanding without screenshots: Windows UI Automation + built-in OCR\n" +
                "  * ~1-5ms cached screen reads with the watch-ahead cache (24/7, $0 local CPU only)\n" +
                "  * Batched actions: clicks, keys, windows, UIA invoke/select/set - act + verify in one call\n" +
                "  * Always-on-top OPU indicator with a STOP button + global hotkey Ctrl+Alt+Shift+X\n" +
                "  * apex-memory: compressed, de-duplicated desktop knowledge any AI can reuse\n" +
                "  * Never stores usernames/passwords/tokens/API keys - saves are refused instead\n" +
                "  * Just say 'use opu' in OpenCode, or open the panel with /opcompuse"
        };
        var needs = new Label
        {
            Font = new Font("Segoe UI", 9),
            Location = new Point(28, 340),
            Size = new Size(660, 100),
            ForeColor = Color.DimGray,
            Text =
                "Requirements: Windows 10/11, .NET Framework 4.8 (built-in), OpenCode CLI in PATH.\n" +
                "Installs to %USERPROFILE%\\.opencode\\plugins\\opcompuse and creates the apex-memory\n" +
                "folder under %USERPROFILE%\\.local\\share\\opencode\\opcompuse\\apex-memory.\n" +
                "The OpenCode service restarts automatically after install."
        };
        var restartBox = new CheckBox { Text = "Restart OpenCode service after install", Checked = restart, Location = new Point(28, 430), AutoSize = true };
        restartBox.CheckedChanged += (s, e) => restart = restartBox.Checked;
        content.Controls.Add(title); content.Controls.Add(sub);
        content.Controls.Add(feats); content.Controls.Add(needs); content.Controls.Add(restartBox);
    }

    void Legal()
    {
        var box = new TextBox
        {
            Multiline = true,
            ReadOnly = true,
            ScrollBars = ScrollBars.Vertical,
            Size = new Size(700, 330),
            Location = new Point(18, 18),
            Font = new Font("Consolas", 9)
        };
        box.Text = PRIVACY + "\n\n" + TERMS;
        content.Controls.Add(box);

        var ok = new CheckBox
        {
            Text = "I have read and accept the Privacy Policy and Terms of Service",
            Location = new Point(18, 356),
            AutoSize = true,
            Enabled = true
        };
        ok.CheckedChanged += (s, e) => { accepted = ok.Checked; next.Enabled = accepted; };
        var who = new Label { Text = "Self-signed build - every change is public in the open GitHub repository.", Location = new Point(18, 390), AutoSize = true, ForeColor = Color.DimGray };
        content.Controls.Add(ok); content.Controls.Add(who);
        next.Text = "Install";
    }

    void Finish()
    {
        var pic = new PictureBox { Size = new Size(96, 96), Location = new Point(24, 26) };
        try { using (var rs = Assembly.GetExecutingAssembly().GetManifestResourceStream("opcompuse.logo.png")) pic.Image = Image.FromStream(rs); } catch { }
        content.Controls.Add(pic);
        var t = new Label { Text = "Installation complete!", Font = new Font("Segoe UI", 16, FontStyle.Bold), Location = new Point(132, 40), AutoSize = true, ForeColor = Color.FromArgb(30, 120, 90) };
        var how =
            "Getting started in OpenCode:\n\n" +
            "  1. Start a session anywhere and say:  use opu\n" +
            "  2. Or type /opcompuse in the TUI to open the right-side watcher panel\n" +
            "  3. Panel keys:  [t] watch on/off   [x] STOP   [m] memory   [r] refresh\n" +
            "  4. Files/data:\n" +
            "       plugin     %USERPROFILE%\\.opencode\\plugins\\opcompuse\n" +
            "       memory     %USERPROFILE%\\.local\\share\\opencode\\opcompuse\\apex-memory\n" +
            "       watcher    %TEMP%\\opencode\\opcompuse\n" +
            "  5. Stop everything at any time: press Ctrl+Alt+Shift+X or click STOP on the\n" +
            "     on-screen OPU indicator. Re-enable with opcompuse_watch on.\n\n" +
            "If the watcher does not restart automatically, run:  opencode service restart";
        var l = new Label { Font = new Font("Consolas", 10), Location = new Point(24, 140), Size = new Size(680, 300), Text = how };
        content.Controls.Add(t); content.Controls.Add(l);
        next.Text = "Done";
        next.Click += (s, e) => Close();
        back.Visible = false;
    }

    void Install()
    {
        if (installing) return;
        installing = true;
        next.Visible = false; back.Visible = false; quit.Text = "Cancel install";
        bar.Visible = true;
        try
        {
            Set(5, "Extracting plugin...");
            var pluginDir = Path.Combine(Home0(), PluginRel);
            var pluginsDir = Path.GetDirectoryName(pluginDir);
            Directory.CreateDirectory(pluginsDir);
            if (Directory.Exists(pluginDir)) Directory.Delete(pluginDir, true);
            using (var ms = new MemoryStream(EmbeddedZip()))
            using (var zip = new ZipArchive(ms, ZipArchiveMode.Read))
            {
                var extractRoot = pluginDir;
                foreach (var entry in zip.Entries)
                {
                    var target = Path.Combine(extractRoot, entry.FullName);
                    if (entry.FullName.EndsWith("/") || entry.FullName.EndsWith("\\"))
                    {
                        Directory.CreateDirectory(target);
                        continue;
                    }
                    Directory.CreateDirectory(Path.GetDirectoryName(target));
                    entry.ExtractToFile(target, true);
                }
            }
            if (!File.Exists(Path.Combine(pluginDir, "index.js")))
                throw new Exception("plugin files did not extract correctly");
            Set(35, "Plugin files in place.");

            Set(55, "Creating apex-memory folder...");
            Directory.CreateDirectory(Path.Combine(Home0(), MemRel));

            Set(75, "Updating OpenCode config...");
            var patched = PatchConfig(Path.Combine(Home0(), @".config\opencode\opencode.jsonc")) ||
                          PatchConfig(Path.Combine(Home0(), @".config\opencode\opencode.json"));
            if (!patched)
            {
                var fresh = Path.Combine(Home0(), @".config\opencode\opencode.jsonc");
                Directory.CreateDirectory(Path.GetDirectoryName(fresh));
                File.WriteAllText(fresh,
                    "{" + Environment.NewLine +
                    "  \"plugins\": [" + Environment.NewLine +
                    "    \"" + Path.Combine(Home0(), PluginRel).Replace("\\", "\\\\") + "\"" + Environment.NewLine +
                    "  ]," + Environment.NewLine +
                    "}" + Environment.NewLine);
            }

            if (restart)
            {
                Set(90, "Restarting opencode service...");
                RunTool("opencode", "service restart", 60000);
            }
            Set(100, "Done.");
            done = true;
            page = 2;
            RenderPage();
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, ex.Message, "Install failed", MessageBoxButtons.OK, MessageBoxIcon.Error);
            installing = false;
        }
        finally
        {
            bar.Visible = false;
            status.Text = done ? "Installed." : "";
        }
    }

    public void SilentRepair()
    {
        try
        {
            var pluginDir = Path.Combine(Home0(), PluginRel);
            var pluginsDir = Path.GetDirectoryName(pluginDir);
            Directory.CreateDirectory(pluginsDir);
            if (Directory.Exists(pluginDir)) Directory.Delete(pluginDir, true);
            using (var ms = new MemoryStream(EmbeddedZip()))
            using (var zip = new ZipArchive(ms, ZipArchiveMode.Read))
            {
                var extractRoot = pluginDir;
                foreach (var entry in zip.Entries)
                {
                    var target = Path.Combine(extractRoot, entry.FullName);
                    if (entry.FullName.EndsWith("/") || entry.FullName.EndsWith("\\"))
                    { Directory.CreateDirectory(target); continue; }
                    Directory.CreateDirectory(Path.GetDirectoryName(target));
                    entry.ExtractToFile(target, true);
                }
            }
            Directory.CreateDirectory(Path.Combine(Home0(), MemRel));
            var patched = PatchConfig(Path.Combine(Home0(), @".config\opencode\opencode.jsonc")) ||
                          PatchConfig(Path.Combine(Home0(), @".config\opencode\opencode.json"));
            if (!patched)
            {
                var fresh = Path.Combine(Home0(), @".config\opencode\opencode.jsonc");
                Directory.CreateDirectory(Path.GetDirectoryName(fresh));
                File.WriteAllText(fresh,
                    "{" + Environment.NewLine +
                    "  \"plugins\": [" + Environment.NewLine +
                    "    \"" + Path.Combine(Home0(), PluginRel).Replace("\\", "\\\\") + "\"" + Environment.NewLine +
                    "  ]," + Environment.NewLine +
                    "}" + Environment.NewLine);
            }
            if (restart) RunTool("opencode", "service restart", 60000);
            Console.WriteLine("[+] opcompuse installed" + (restart ? (" and service restarted") : "") + ".");
            Environment.Exit(0);
        }
        catch (Exception ex)
        {
            Console.WriteLine("[X] " + ex.Message);
            Environment.Exit(1);
        }
    }

    void Set(int v, string msg)
    {
        Method(() =>
        {
            bar.Value = Math.Max(1, Math.Min(100, v));
            status.Text = msg;
        });
    }

    void Method(Action a)
    {
        if (InvokeRequired) BeginInvoke(a); else a();
    }

    string Home0()
    {
        return Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
    }

    byte[] EmbeddedZip()
    {
        using (var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("opcompuse.zip"))
        {
            if (s == null) throw new Exception("embedded plugin archive missing");
            using (var ms = new MemoryStream())
            {
                s.CopyTo(ms);
                return ms.ToArray();
            }
        }
    }

    bool PatchConfig(string cfg)
    {
        if (!File.Exists(cfg) || File.ReadAllText(cfg).Contains("opcompuse")) return File.Exists(cfg);
        try
        {
            var text = File.ReadAllText(cfg);
            var entry = "    \"" + PluginRel.Replace("\\", "\\\\") + "\"";
            var k = text.IndexOf("\"plugins\"");
            if (k >= 0)
            {
                int o = text.IndexOf('[', k);
                int i = o + 1, depth = 1;
                bool ins = false; char q = '"';
                while (i < text.Length && depth > 0)
                {
                    var c = text[i];
                    if (ins) { if (c == '\\') { i += 2; continue; } if (c == q) ins = false; }
                    else
                    {
                        if (c == '"' || c == '\'') { ins = true; q = c; }
                        else if (c == '[') depth++;
                        else if (c == ']') depth--;
                    }
                    i++;
                }
                if (depth != 0) return false;
                int close = i - 1;
                int back = close - 1;
                while (back > o && char.IsWhiteSpace(text[back])) back--;
                var last = text[back];
                var line = (last == ',' || last == '[') ? entry : "," + entry;
                text = text.Insert(close, Environment.NewLine + line + Environment.NewLine);
            }
            else
            {
                var b = text.IndexOf('{');
                if (b < 0) return false;
                text = text.Insert(b + 1, Environment.NewLine + "  \"plugins\": [" + Environment.NewLine + "  " + entry + Environment.NewLine + "  ],");
            }
            File.WriteAllText(cfg, text);
            return true;
        }
        catch { return false; }
    }

    bool RunTool(string exe, string argsv, int timeoutMs)
    {
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = exe,
                Arguments = argsv,
                UseShellExecute = false,
                CreateNoWindow = true
            };
            using (var p = Process.Start(psi))
            {
                if (!p.WaitForExit(timeoutMs)) { try { p.Kill(); } catch { } return false; }
                return p.ExitCode == 0;
            }
        }
        catch { return false; }
    }

    void Next()
    {
        if (page == 1)
        {
            if (!accepted) { MessageBox.Show(this, "Please accept the Privacy Policy and Terms of Service first.", "Required", MessageBoxButtons.OK, MessageBoxIcon.Information); return; }
            Install();
            return;
        }
        if (page < 2) { page++; RenderPage(); }
    }

    static readonly string PRIVACY = PRIVACY_TEXT;
    static readonly string TERMS = TERMS_TEXT;

    const string PRIVACY_TEXT =
@"OPCOMPUSE Privacy Policy (last updated 2026-11-02)
===================================================
OPCOMPUSE is an open-source, local-first computer-use plugin for OpenCode.

WHAT IS STORED ON YOUR PC
- Screen digests (active window element tree + OCR text) while the watcher
  runs. Cached in %TEMP%\opencode\opcompuse, refreshed in place, never synced.
- apex-memory (%USERPROFILE%\.local\share\opencode\opcompuse\apex-memory):
  app names, window titles, action chains (op chains only), element paths,
  file/URL places, your manual notes, watcher screen-change notes.

WHAT IS NEVER STORED
- usernames, passwords, PINs, OTP codes, tokens, API keys, credentials of any
  kind. The text you type or values you fill are NEVER memorized (only the
  op chain). Credential-like saves are refused at write time.

WHAT LEAVES YOUR MACHINE
- Nothing by default. Only if you use opcompuse_decide or enable watcherModel
  does the TEXT digest (no screenshots) go to the model provider you chose.
  Local providers (LM Studio / KoboldCpp) keep everything on-device.

TELEMETRY: none.

CONTROLS: opcompuse_settings {set memory:false} to disable memory;
opcompuse_memory {forget}; opcompuse_watch off; uninstall removes plugin
(folder apex-memory is yours to keep or delete).";

    const string TERMS_TEXT =
@"OPCOMPUSE Terms of Service (last updated 2026-11-02)
=====================================================
By installing or using OPCOMPUSE you accept these terms.

1. LICENSE: open-source, AS IS; use/modify/distribute per the repository
   license (MIT-style).
2. WHAT IT DOES: observes your Windows screen via Windows UI Automation and
   OCR and performs actions (clicks, keys, window management) you request
   through OpenCode.
3. YOUR RESPONSIBILITY: you are responsible for every action OPCOMPUSE takes
   on your machine; review agent intent; do not operate systems you are not
   authorized to control.
4. STOP SAFETY: STOP button, global hotkey Ctrl+Alt+Shift+X, and step-level
   stop checks allow interruption at any time.
5. NO WARRANTY: provided AS IS, without warranty; not affiliated with
   OpenCode, Microsoft, or any model provider.
6. DATA: see the Privacy Policy shown here - local-first, no telemetry.
7. CHANGES: continue using the Plugin after changes these terms to the
   published repository text.
   (Note: 'use' = 'continue using'; see repository TERMS.md for latest.)";
}

public static class Program
{
    [STAThread]
    public static int Main(string[] args)
    {
        var a0 = args.Length > 0 ? args[0].TrimStart('-', '/').ToLowerInvariant() : "";
        var all = string.Join(" ", args).ToLowerInvariant();
        if (a0 == "h" || a0 == "help")
        {
            Console.WriteLine("OPCOMPUSE installer (GUI). Flags: silent [norestart] | uninstall | help");
            return 0;
        }
        if (a0 == "uninstall")
        {
            try
            {
                var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
                var cfg = Path.Combine(home, @".config\opencode\opencode.jsonc");
                if (!File.Exists(cfg)) cfg = Path.Combine(home, @".config\opencode\opencode.json");
                if (File.Exists(cfg))
                {
                    var lines = new System.Collections.Generic.List<string>(File.ReadAllLines(cfg));
                    lines.RemoveAll(l => l.Contains("opcompuse"));
                    File.WriteAllLines(cfg, lines);
                }
                var dir = Path.Combine(home, @".opencode\plugins\opcompuse");
                if (Directory.Exists(dir)) Directory.Delete(dir, true);
                Console.WriteLine("[+] opcompuse removed. Run: opencode service restart");
                return 0;
            }
            catch (Exception ex) { Console.WriteLine("[X] " + ex.Message); return 1; }
        }

        var gui = new Installer(all.Contains("norestart"));
        if (all.Contains("silent"))
        {
            gui.SilentRepair();
        }
        else
        {
            Application.Run(gui);
        }
        return 0;
    }
}
}
