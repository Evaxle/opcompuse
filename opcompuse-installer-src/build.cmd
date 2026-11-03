@echo off
setlocal
cd /d "%~dp0"
Compress-Archive.cmd 2>nul
set "CSC=C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
set "ROOT=%~dp0.."
set "ZIP=%~dp0opcompuse.zip"

if not exist "%ZIP%" (
  echo [!] opcompuse.zip not found. Build it with:
  echo     powershell -Command "Compress-Archive -Path '%ROOT%\ps','%ROOT%\index.js','%ROOT%\rpc.js','%ROOT%\tui.tsx','%ROOT%\README.md' -DestinationPath '%ZIP%' -Force"
  exit /b 1
)

"%CSC%" /nologo /t:winexe /optimize+ /win32icon:"%ROOT%\logo.ico" ^
  /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll ^
  /r:System.Windows.Forms.dll /r:System.Drawing.dll ^
  /resource:"%ZIP%,opcompuse.zip" /resource:"%ROOT%\logo.png,opcompuse.logo.png" ^
  /out:"%ROOT%\opcompuse-installer.exe" "%~dp0InstallerGui.cs"
if errorlevel 1 (echo BUILD FAILED) else (echo BUILD OK: %ROOT%\opcompuse-installer.exe)

powershell -NoProfile -Command "$c = Get-ChildItem Cert:\CurrentUser\My | Where-Object Subject -like '*OPCOMPUSE*' | Select-Object -First 1; if ($c) { $s = Set-AuthenticodeSignature -FilePath '%ROOT%\opcompuse-installer.exe' -Certificate $c; Write-Host ('sig: ' + $s.Status + ' - ' + $s.StatusMessage) } else { Write-Host '[!] no OPCOMPUSE code-signing cert in user store; run: New-SelfSignedCertificate ... 2.5.29.37 code signing EKU' }"

powershell -NoProfile -Command "$h = (Get-FileHash '%ROOT%\opcompuse-installer.exe' -Algorithm SHA256).Hash; Write-Host \"SHA256: $h\" > \"%ROOT%\SHA256SUM.txt\"; Get-Content '%ROOT%\SHA256SUM.txt'"
