@echo off
setlocal
cd /d "%~dp0"
"C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:exe /optimize+ /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll /resource:"%~dp0..\opcompuse.zip,opcompuse.zip" /out:"%~dp0opcompuse-installer.exe" "%~dp0Installer.cs"
if errorlevel 1 (echo BUILD FAILED) else (echo BUILD OK: opcompuse-installer.exe)
