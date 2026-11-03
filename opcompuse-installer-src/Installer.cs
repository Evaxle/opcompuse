using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Text;
using System.Collections.Generic;

namespace OpuInstaller
{
    public static class Program
    {
        const string PluginRel = @".opencode\plugins\opcompuse";
        const string MemRel    = @".local\share\opencode\opcompuse\apex-memory";

        public static int Main(string[] args)
        {
            try
            {
                Console.OutputEncoding = Encoding.UTF8;
                if (args.Length > 0)
                {
                    var f = args[0].TrimStart('-', '/').ToLowerInvariant();
                    if (f == "h" || f == "help") { ShowHelp(); return 0; }
                    if (f == "uninstall") return Uninstall();
                    if (f == "norestart" || f == "no-restart" || f == "s") return Install(true);
                }
                return Install(false);
            }
            catch (Exception ex)
            {
                Console.WriteLine("[X] " + ex.Message);
                return 1;
            }
        }

        static void ShowHelp()
        {
            Console.WriteLine("OPCOMPUSE installer for OpenCode");
            Console.WriteLine("  opcompuse-installer.exe             install / update");
            Console.WriteLine("  opcompuse-installer.exe norestart    install without service restart");
            Console.WriteLine("  opcompuse-installer.exe uninstall    remove plugin + config entries");
        }

        static string Home()
        {
            return Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        }

        static byte[] EmbeddedZip()
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

        static int Install(bool noRestart)
        {
            Console.WriteLine();
            Console.WriteLine("OPCOMPUSE installer");
            Console.WriteLine("-------------------");
            Console.WriteLine("[*] Extracting embedded plugin archive...");

            var pluginDir = Path.Combine(Home(), PluginRel);
            var pluginsDir = Path.GetDirectoryName(pluginDir);
            Directory.CreateDirectory(pluginsDir);
            if (Directory.Exists(pluginDir))
            {
                Console.WriteLine("[*] Removing previous installation...");
                Directory.Delete(pluginDir, true);
            }
            using (var ms = new MemoryStream(EmbeddedZip()))
            using (var zip = new ZipArchive(ms, ZipArchiveMode.Read))
            {
                foreach (var entry in zip.Entries)
                {
                    var target = Path.Combine(pluginsDir, entry.FullName);
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
            Console.WriteLine("[+] Plugin files in place: " + pluginDir);

            var memRoot = Path.Combine(Home(), MemRel);
            Directory.CreateDirectory(memRoot);
            Console.WriteLine("[+] Apex-memory data folder: " + memRoot);

            var patched = PatchConfig(Path.Combine(Home(), @".config\opencode\opencode.jsonc"));
            if (!patched) patched = PatchConfig(Path.Combine(Home(), @".config\opencode\opencode.json"));
            if (!patched)
            {
                var fresh = Path.Combine(Home(), @".config\opencode\opencode.jsonc");
                Directory.CreateDirectory(Path.GetDirectoryName(fresh));
                File.WriteAllText(fresh,
                    "{" + Environment.NewLine +
                    "  \"plugins\": [" + Environment.NewLine +
                    "    \"" + Path.Combine(Home(), PluginRel).Replace("\\", "\\\\") + "\"" + Environment.NewLine +
                    "  ]," + Environment.NewLine +
                    "}" + Environment.NewLine);
                Console.WriteLine("[+] Created fresh OpenCode config with opcompuse enabled.");
            }

            Console.WriteLine();
            if (!noRestart)
            {
                Console.WriteLine("[*] Restarting OpenCode service...");
                if (RunTool("opencode", "service restart", 60000))
                    Console.WriteLine("[+] Service restarted.");
                else
                    Console.WriteLine("[!] Auto-restart unavailable. Run manually: opencode service restart");
            }
            else
            {
                Console.WriteLine("[*] Skipping service restart. Run manually: opencode service restart");
            }

            Console.WriteLine();
            Console.WriteLine("OPCOMPUSE is installed.");
            Console.WriteLine(" - In OpenCode just say: use opu   (or /opcompuse for the watcher panel)");
            Console.WriteLine(" - Always-on-top OPU indicator appears while watching/acting, with a STOP");
            Console.WriteLine("   button + global hotkey Ctrl+Alt+Shift+X.");
            Console.WriteLine(" - apex-memory: no usernames/passwords/tokens/keys are ever stored.");
            return 0;
        }

        static bool RunTool(string exe, string argsv, int timeoutMs)
        {
            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = exe,
                    Arguments = argsv,
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
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

        static bool HasStringLiteral(char c, ref bool inString, ref char quote, StringBuilder cur)
        {
            if (inString)
            {
                if (c == '\\') { cur.Append(c); return true; }
                if (c == quote) inString = false;
                cur.Append(c);
                return true;
            }
            if (c == '"' || c == '\'') { inString = true; quote = c; cur.Append(c); return true; }
            return false;
        }

        static bool PatchConfig(string cfg)
        {
            if (!File.Exists(cfg)) return false;
            if (File.ReadAllText(cfg).Contains("opcompuse"))
            {
                Console.WriteLine("[+] Config already references opcompuse: " + cfg);
                return true;
            }
            Console.WriteLine("[*] Updating " + cfg);
            var entryIndent = "    ";
            var entryLine = entryIndent + "\"" + PluginRel.Replace("\\", "\\\\") + "\",";
            var text = File.ReadAllText(cfg);

            var rel = text.IndexOf("\"plugins\"");
            if (rel >= 0)
            {
                int open = text.IndexOf('[', rel);
                if (open < 0) throw new Exception("plugins key found but no '['");
                int i = open + 1;
                int depth = 1;
                bool inString = false; char quote = '"';
                while (i < text.Length && depth > 0)
                {
                    var c = text[i];
                    if (inString)
                    {
                        if (c == '\\') { i += 2; continue; }
                        if (c == quote) inString = false;
                    }
                    else
                    {
                        if (c == '"' || c == '\'') { inString = true; quote = c; }
                        else if (c == '[') depth++;
                        else if (c == ']') depth--;
                    }
                    i++;
                }
                if (depth != 0) throw new Exception("plugins array not closed");
                int close = i - 1;

                int back = close - 1;
                while (back > open && char.IsWhiteSpace(text[back])) back--;
                while (back > open && text[back] == '/' ) back--;
                while (back > open && char.IsWhiteSpace(text[back])) back--;
                var lastChar = back >= 0 ? text[back] : '[';
                string prefix = (lastChar == ',' || lastChar == '[') ? "" : ",";
                var entryFinal = entryLine.TrimEnd(',');
                entryFinal = prefix == "" ? entryFinal : entryFinal + ",";
                text = text.Insert(close, Environment.NewLine + entryFinal + Environment.NewLine);
            }
            else
            {
                int brace = text.IndexOf('{');
                if (brace < 0) throw new Exception("config is not JSON");
                var block = Environment.NewLine + "  \"plugins\": [" + Environment.NewLine
                          + "    \"" + PluginRel.Replace("\\", "\\\\") + "\"" + Environment.NewLine
                          + "  ],";
                text = text.Insert(brace + 1, block);
            }
            File.WriteAllText(cfg, text);
            Console.WriteLine("[+] Added opcompuse to the plugins array.");
            return true;
        }

        static int Uninstall()
        {
            var cfg = Path.Combine(Home(), @".config\opencode\opencode.jsonc");
            if (!File.Exists(cfg)) cfg = Path.Combine(Home(), @".config\opencode\opencode.json");
            if (File.Exists(cfg))
            {
                var lines = new List<string>(File.ReadAllLines(cfg));
                lines.RemoveAll(l => l.Contains("opcompuse"));
                File.WriteAllLines(cfg, lines);
                Console.WriteLine("[+] Config cleaned.");
            }
            var pluginDir = Path.Combine(Home(), PluginRel);
            if (Directory.Exists(pluginDir)) { Directory.Delete(pluginDir, true); Console.WriteLine("[+] Plugin deleted."); }
            Console.WriteLine("[*] Run: opencode service restart");
            return 0;
        }
    }
}
