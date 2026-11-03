param(
  [ValidateSet("full", "quick", "find")] [string]$Mode = "full",
  [string]$NameRegex = "",
  [switch]$NoOcr
)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\opcompuse.lib.ps1"
$d = Get-FcuDigest -Quick:($Mode -eq "quick") -NoOcr:$NoOcr -NameRegex:$NameRegex
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Format-FcuOutput $d

