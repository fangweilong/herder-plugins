# Herdr 审批中继的 Windows 弹窗助手。
#
# 由 mods/approval-relay 在启动时拉起，读取 <AppHome>\data\approval-relay\queue\*.json，
# 显示置顶窗口和托盘图标；用户点选后直接调用 hc keys / hc send --force 回答终端。
# 只转发用户明确点过的选项，不自动批准、不改 agent 配置。
#
# 视觉：颜色读 Herdr 的 settings.json + themes/<name>.json；文案读 i18n.json；
# 快捷键从 keys.json 的 approval-relay.open 绑定里取。

param(
  [string]$AppHome = (Join-Path $env:USERPROFILE ".config\herdr-app"),
  [string]$MutexName = "HerdrApprovalRelayHelper"
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$DataDir = Join-Path $AppHome "data\approval-relay"
$QueueDir = Join-Path $DataDir "queue"
$AnswersDir = Join-Path $DataDir "answers"
$BadDir = Join-Path $DataDir "bad"
$LogPath = Join-Path $DataDir "helper.log"
$BeatPath = Join-Path $DataDir "helper.json"
$WakePath = Join-Path $DataDir "wake.flag"
$StopPath = Join-Path $DataDir "stop.flag"
$I18nPath = Join-Path $AppHome "mods\approval-relay\i18n.json"
$ConfigPath = Join-Path $DataDir "config.json"
$KeysPath = Join-Path $AppHome "keys.json"
$SettingsPath = Join-Path $AppHome "settings.json"

foreach ($dir in @($DataDir, $QueueDir, $AnswersDir, $BadDir)) {
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
}

function Write-Log([string]$message) {
  try {
    $line = "{0} {1}" -f (Get-Date).ToString("s"), $message
    [System.IO.File]::AppendAllText($LogPath, $line + "`r`n", (New-Object System.Text.UTF8Encoding($false)))
  } catch {}
}

function Read-Json([string]$path) {
  try {
    if (-not (Test-Path -LiteralPath $path)) { return $null }
    return (Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json)
  } catch {
    return $null
  }
}

function Write-JsonAtomic([string]$path, $value) {
  $tmp = "$path.tmp"
  $json = $value | ConvertTo-Json -Depth 6
  [System.IO.File]::WriteAllText($tmp, $json, (New-Object System.Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $tmp -Destination $path -Force
}

function Resolve-CommandPath([string]$name, [string[]]$fallbacks) {
  $cmd = Get-Command $name -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  foreach ($path in $fallbacks) {
    if (Test-Path -LiteralPath $path) { return $path }
  }
  return $null
}

$HcPath = Resolve-CommandPath "hc.exe" @(
  (Join-Path $env:LOCALAPPDATA "Programs\herdr-core\hc.exe"),
  (Join-Path $env:USERPROFILE ".local\bin\hc.exe"),
  (Join-Path $env:USERPROFILE ".cargo\bin\hc.exe")
)
$AppPath = Resolve-CommandPath "herdr-app.exe" @(
  (Join-Path $env:LOCALAPPDATA "Programs\herdr-app\herdr-app.exe")
)

# 单实例：第二个实例只负责把已有窗口叫出来。
$mutex = New-Object System.Threading.Mutex($false, $MutexName)
if (-not $mutex.WaitOne(0)) {
  try { Set-Content -LiteralPath $WakePath -Value (Get-Date).ToUniversalTime().ToString("o") -Encoding UTF8 } catch {}
  exit 0
}

# ---------------------------------------------------------------- theme & language

$Settings = Read-Json $SettingsPath
$Config = Read-Json $ConfigPath
$script:I18n = Read-Json $I18nPath
if ($null -eq $script:I18n) { $script:I18n = [pscustomobject]@{ en = [pscustomobject]@{} } }
$script:Config = $Config
$script:IdleExitSeconds = 120
if ($null -ne $Config -and $null -ne $Config.helperIdleSeconds) {
  try { $script:IdleExitSeconds = [int]$Config.helperIdleSeconds } catch {}
}
$script:Busy = $false
$script:Active = $null
$script:Exiting = $false
$script:LastBeat = 0
$script:DefaultRow = $null
$script:OptionTranslations = @{}
$script:TranslationCache = @{}
$script:ScreenTranslated = $false
$script:ScreenTranslation = ""
$script:OtherKeys = @()
$script:MultiQuestion = $false
$script:Wizard = $false
$script:WizardQuestions = @()
$script:WizardIndex = 0
$script:WizardAnswers = @()
$script:WizardOther = $false
$script:WizardStarted = $false
$script:WizardCursor = 0
$script:LastActivity = Get-Date

function Resolve-Language([string]$requestLang) {
  if ($requestLang -eq "zh" -or $requestLang -eq "en") { return $requestLang }
  $forced = [string]$Config.language
  if ($forced -eq "zh" -or $forced -eq "en") { return $forced }
  try {
    $saved = (Get-Content -LiteralPath (Join-Path $DataDir "lang") -Raw -Encoding UTF8 -ErrorAction Stop).Trim()
    if ($saved -eq "zh" -or $saved -eq "en") { return $saved }
  } catch {}
  $culture = [System.Globalization.CultureInfo]::CurrentUICulture
  if ($culture.TwoLetterISOLanguageName -eq "zh") { return "zh" }
  return "en"
}
$script:Lang = Resolve-Language ""

function T([string]$key) {
  $table = $script:I18n.($script:Lang)
  if ($null -eq $table) { $table = $script:I18n.en }
  $text = $table.$key
  if ($null -eq $text -and $null -ne $script:I18n.en) { $text = $script:I18n.en.$key }
  if ($null -eq $text) { return $key }
  return [string]$text
}

function TF([string]$key, [string]$value) {
  return (T $key).Replace("{n}", $value)
}

function Format-Shortcut([string]$binding) {
  $names = @{
    ctrl = "Ctrl"; control = "Ctrl"; shift = "Shift"; alt = "Alt"; option = "Alt";
    meta = "Win"; super = "Win"; cmd = "Win"; win = "Win";
    enter = "Enter"; return = "Enter"; esc = "Esc"; escape = "Esc"; tab = "Tab";
    space = "Space"; backspace = "Backspace"; up = "↑"; down = "↓"; left = "←"; right = "→";
    pageup = "PgUp"; pagedown = "PgDn"; home = "Home"; end = "End"; delete = "Del"
  }
  if (-not $binding) { return "" }
  $parts = $binding -split "[-+]"
  $out = @()
  foreach ($part in $parts) {
    if (-not $part) { continue }
    $name = $part.ToLowerInvariant()
    if ($names.ContainsKey($name)) { $out += $names[$name] }
    elseif ($part.Length -eq 1) { $out += $part.ToUpperInvariant() }
    else { $out += ($part.Substring(0,1).ToUpperInvariant() + $part.Substring(1)) }
  }
  return ($out -join "+")
}

function Display-App([string]$app) {
  if (-not $app) { return "Agent" }
  $known = @{
    "claude-code" = "Claude Code"; "claude" = "Claude"; "codex" = "Codex"; "pi" = "Pi";
    "omp" = "oh-my-pi"; "opencode" = "OpenCode"; "fake-approval" = "Fake Approval";
    "fake-question" = "Fake Question"
  }
  if ($known.ContainsKey($app.ToLowerInvariant())) { return $known[$app.ToLowerInvariant()] }
  return (($app -replace "[-_]+", " ")).Trim()
}

function Get-OpenKey {
  $keys = Read-Json $KeysPath
  if ($null -ne $keys -and $null -ne $keys.global) {
    foreach ($property in $keys.global.PSObject.Properties) {
      if ($property.Value -eq "layout.toggle:approval-relay-panel" -or $property.Value -eq "approval-relay.open") { return (Format-Shortcut $property.Name) }
    }
  }
  return "Ctrl+Shift+A"
}
$script:OpenKey = Get-OpenKey

function Test-Keys($keys) {
  if ($null -eq $keys) { return $false }
  $list = @($keys)
  if ($list.Count -lt 1 -or $list.Count -gt 6) { return $false }
  foreach ($key in $list) {
    if ($key -isnot [string]) { return $false }
    if ($key -notmatch "^(enter|esc|escape|tab|space|backspace|up|down|left|right|home|end|pageup|pagedown|[A-Za-z0-9]|ctrl\+[A-Za-z0-9]|alt\+[A-Za-z0-9]|shift\+[A-Za-z0-9])$") { return $false }
  }
  return $true
}

function Test-Address([string]$address) {
  return $address -match "^(?:[A-Za-z0-9_.-]{1,64}/)?t[0-9a-z]+$"
}

$appearance = [string]$Settings.appearance
if ($appearance -ne "dark" -and $appearance -ne "light") {
  try {
    $themeReg = Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize" -ErrorAction SilentlyContinue
    if ($null -ne $themeReg.AppsUseLightTheme) { $appearance = if ($themeReg.AppsUseLightTheme) { "light" } else { "dark" } }
  } catch {}
}
if ($appearance -ne "light") { $appearance = "dark" }

$themeName = $null
if ($Settings.theme -is [string]) { $themeName = [string]$Settings.theme }
elseif ($null -ne $Settings.theme) { $themeName = [string]$Settings.theme.$appearance }
$theme = $null
if ($themeName) { $theme = Read-Json (Join-Path $AppHome ("themes\{0}.json" -f $themeName)) }

$fallbackDark = @{
  background = "#0C2732"; canvas = "#0A212A"; surface = "#0C2732"; popover = "#173540";
  raised = "#22434F"; border = "#ffffff22"; foreground = "#EDE8D7"; muted = "#B1CBCE";
  dim = "#7E9BA1"; accent = "#499DCE"; accent_foreground = "#0C2732";
  blocked = "#E64651"; done = "#86EB9E"
}
$fallbackLight = @{
  background = "#F7F4EC"; canvas = "#F1EDE3"; surface = "#FFFFFF"; popover = "#FBF8F0";
  raised = "#EDE8DC"; border = "#00000022"; foreground = "#1F2A2E"; muted = "#5D6B70";
  dim = "#8A979B"; accent = "#2F6F9E"; accent_foreground = "#FFFFFF";
  blocked = "#B33A3A"; done = "#2F7D4F"
}
$fallback = if ($appearance -eq "light") { $fallbackLight } else { $fallbackDark }

function Convert-HexColor([string]$hex, [Drawing.Color]$fallbackColor) {
  if (-not $hex) { return $fallbackColor }
  $h = $hex.Trim().TrimStart("#")
  if ($h.Length -eq 3) { $h = "" + $h[0] + $h[0] + $h[1] + $h[1] + $h[2] + $h[2] }
  if ($h.Length -lt 6) { return $fallbackColor }
  try {
    $r = [Convert]::ToInt32($h.Substring(0, 2), 16)
    $g = [Convert]::ToInt32($h.Substring(2, 2), 16)
    $b = [Convert]::ToInt32($h.Substring(4, 2), 16)
    $a = 255
    if ($h.Length -ge 8) { $a = [Convert]::ToInt32($h.Substring(6, 2), 16) }
    return [Drawing.Color]::FromArgb($a, $r, $g, $b)
  } catch {
    return $fallbackColor
  }
}

function Theme-Color([string]$name) {
  $fallbackColor = Convert-HexColor $fallback[$name] ([Drawing.Color]::Black)
  if ($null -ne $theme -and $null -ne $theme.colors -and $null -ne $theme.colors.$name) {
    return Convert-HexColor ([string]$theme.colors.$name) $fallbackColor
  }
  return $fallbackColor
}

$ColBg = Theme-Color "canvas"
$ColSurface = Theme-Color "surface"
$ColCanvas = Theme-Color "canvas"
$ColPopover = Theme-Color "popover"
$ColRaised = Theme-Color "raised"
$ColBorder = Theme-Color "border"
$ColFg = Theme-Color "foreground"
$ColMuted = Theme-Color "muted"
$ColDim = Theme-Color "dim"
$ColAccent = Theme-Color "accent"
$ColAccentFg = Theme-Color "accent_foreground"
$ColBlocked = Theme-Color "blocked"
$ColDone = Theme-Color "done"

function Paint-Blend([Drawing.Color]$a, [Drawing.Color]$b, [float]$t) {
  return [HerdrApproval.Paint]::Blend($a, $b, $t)
}

function Translate-Google([string]$text, [string]$to) {
  $url = "https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl={0}&q={1}" -f [uri]::EscapeDataString($to), [uri]::EscapeDataString($text)
  $raw = (Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 7).Content
  $data = $raw | ConvertFrom-Json
  $first = $data[0]
  $out = ""
  if ($first -is [string]) { $out = [string]$first }
  elseif ($null -ne $first -and $first[0] -is [string]) { $out = [string]$first[0] }
  else { foreach ($segment in $first) { $out += [string]$segment[0] } }
  if (-not $out) { throw "empty response" }
  return @{ ok = $true; text = $out; provider = "Google" }
}

function Translate-Microsoft([string]$text, [string]$to) {
  if ($to -eq "zh-CN") { $to = "zh-Hans" }
  $body = ConvertTo-Json -Compress -InputObject @($text)
  $uri = "https://edge.microsoft.com/translate/translatetext?from=&to=$([uri]::EscapeDataString($to))&isEnterpriseClient=false"
  $result = Invoke-RestMethod -Method Post -Uri $uri -ContentType "application/json; charset=UTF-8" -Body ([Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 7
  $translated = $result[0].translations[0].text
  if (-not $translated) { throw "empty response" }
  return @{ ok = $true; text = [string]$translated; provider = "Microsoft" }
}

function Translate-Text([string]$text) {
  $value = ([string]$text).Trim()
  if (-not $value) { return @{ ok = $false; error = (T "translate.empty") } }
  if ($value.Length -gt 1800) { $value = $value.Substring(0, 1800) }
  $runtime = Read-Json $ConfigPath
  $tcfg = if ($null -ne $runtime -and $null -ne $runtime.translation) { $runtime.translation } else { $Config.translation }
  $provider = [string]$tcfg.provider
  $enabled = if ($null -ne $tcfg.enabled) { [bool]$tcfg.enabled } else { $provider -ne "off" }
  if (-not $enabled) { return @{ ok = $false; error = (T "translate.off") } }
  $order = @($tcfg.order)
  if (-not $order -or $order.Count -eq 0) {
    $order = if ($provider -eq "microsoft") { @("microsoft", "google") } else { @("google", "microsoft") }
  }
  $targetLang = $script:Lang
  if ($null -ne $script:Active -and @("zh", "en") -contains [string]$script:Active.lang) { $targetLang = [string]$script:Active.lang }
  $to = if ($targetLang -eq "zh") { "zh-CN" } else { "en" }
  $errors = @()
  foreach ($candidate in $order) {
    if ($candidate -notin @("google", "microsoft")) { continue }
    try {
      if ($candidate -eq "google") { return Translate-Google $value $to }
      return Translate-Microsoft $value $to
    } catch {
      $errors += ("{0}: {1}" -f $candidate, $_.Exception.Message)
    }
  }
  return @{ ok = $false; error = ($errors -join " / ") }
}

function Translate-Cached([string]$text) {
  $key = "{0}|{1}" -f $script:Lang, $text
  if ($script:TranslationCache.ContainsKey($key)) { return $script:TranslationCache[$key] }
  $result = Translate-Text $text
  if ($result.ok) { $script:TranslationCache[$key] = $result }
  return $result
}

function Get-OptionLabel($option) {
  $label = [string]$option.label
  $m = [regex]::Match($label, "^\s*\d{1,2}[.)]\s+(.+)$")
  if ($m.Success) { $label = $m.Groups[1].Value }
  return $label.Trim()
}

function Update-OptionLabels {
  foreach ($control in @($optionsPanel.Controls)) {
    if ($control -isnot [HerdrApproval.RowButton] -or $null -eq $control.Tag) { continue }
    $original = [string]$control.Tag.original
    if ($script:TranslationVisible -and $script:OptionTranslations.ContainsKey($original)) {
      $control.LabelText = [string]$script:OptionTranslations[$original]
      $control.SecondaryText = $original
    } else {
      $control.LabelText = $original
      $control.SecondaryText = ""
    }
    $control.Invalidate()
  }
}

# ---------------------------------------------------------------- controls

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
try {
  Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public static class HerdrDpi { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }' -ErrorAction Stop
  [HerdrDpi]::SetProcessDPIAware() | Out-Null
} catch {}
[System.Windows.Forms.Application]::EnableVisualStyles()

Add-Type -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

namespace HerdrApproval
{
    public static class Paint
    {
        public static GraphicsPath Round(RectangleF r, float radius)
        {
            var path = new GraphicsPath();
            if (radius <= 0) { path.AddRectangle(r); return path; }
            float d = radius * 2f;
            path.AddArc(r.X, r.Y, d, d, 180, 90);
            path.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            path.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            path.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            path.CloseFigure();
            return path;
        }

        public static void FillRound(Graphics g, RectangleF r, float radius, Color fill, Color border)
        {
            using (var path = Round(r, radius))
            {
                using (var brush = new SolidBrush(fill)) g.FillPath(brush, path);
                if (border.A > 0) using (var pen = new Pen(border, 1f)) g.DrawPath(pen, path);
            }
        }

        public static Color Blend(Color a, Color b, float t)
        {
            t = Math.Max(0, Math.Min(1, t));
            return Color.FromArgb(
                (int)(a.A + (b.A - a.A) * t),
                (int)(a.R + (b.R - a.R) * t),
                (int)(a.G + (b.G - a.G) * t),
                (int)(a.B + (b.B - a.B) * t));
        }
    }

    public class Card : Panel
    {
        public int Radius = 12;
        public Color FillColor = Color.Transparent;
        public Color StrokeColor = Color.Transparent;

        public Card()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer |
                     ControlStyles.UserPaint | ControlStyles.ResizeRedraw |
                     ControlStyles.SupportsTransparentBackColor, true);
            BackColor = Color.Transparent;
        }

        protected float S(float v) { return v * DeviceDpi / 96f; }

        protected override void OnResize(EventArgs e)
        {
            base.OnResize(e);
            if (Width > 0 && Height > 0) Region = new Region(HerdrApproval.Paint.Round(ClientRectangle, S(Radius)));
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            if (FillColor.A > 0) HerdrApproval.Paint.FillRound(e.Graphics, new RectangleF(0, 0, Width - 1, Height - 1), S(Radius), FillColor, StrokeColor);
            base.OnPaint(e);
        }
    }

    public class RowButton : Control
    {
        public string Badge = "1";
        public string LabelText = "";
        public string SecondaryText = "";
        public string Hint = "";
        public bool IsDefault = false;
        public bool Hovered = false;
        public Color FillColor, BorderColor, AccentColor, AccentText, TextColor, MutedColor, HoverColor, BadgeColor;
        public Font LabelFont, SecondaryFont, HintFont, BadgeFont;

        public RowButton()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer |
                     ControlStyles.UserPaint | ControlStyles.ResizeRedraw |
                     ControlStyles.SupportsTransparentBackColor, true);
            BackColor = Color.Transparent;
            Cursor = Cursors.Hand;
            Height = 44;
        }

        protected float S(float v) { return v * DeviceDpi / 96f; }

        protected override void OnResize(EventArgs e)
        {
            base.OnResize(e);
            if (Width > 0 && Height > 0) Region = new Region(HerdrApproval.Paint.Round(ClientRectangle, S(9)));
        }

        protected override void OnMouseEnter(EventArgs e) { Hovered = true; Invalidate(); base.OnMouseEnter(e); }
        protected override void OnMouseLeave(EventArgs e) { Hovered = false; Invalidate(); base.OnMouseLeave(e); }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;
            var rect = new RectangleF(0, 0, Width - 1, Height - 1);
            var fill = IsDefault ? HerdrApproval.Paint.Blend(AccentColor, FillColor, 0.16f) : (Hovered ? HoverColor : FillColor);
            var border = (IsDefault || Hovered) ? AccentColor : BorderColor;
            HerdrApproval.Paint.FillRound(g, rect, S(9), fill, border);

            float pad = S(12);
            float badge = S(22);
            var badgeRect = new RectangleF(pad, (Height - badge) / 2f, badge, badge);
            HerdrApproval.Paint.FillRound(g, badgeRect, S(11), IsDefault ? AccentColor : BadgeColor, Color.Transparent);
            TextRenderer.DrawText(g, Badge, BadgeFont ?? LabelFont, Rectangle.Round(badgeRect),
                IsDefault ? AccentText : TextColor, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);

            int hintWidth = string.IsNullOrEmpty(Hint) ? 0 : TextRenderer.MeasureText(Hint, HintFont).Width + (int)S(10);
            int labelX = (int)(pad + badge + S(12));
            int labelRight = Width - (int)pad - hintWidth;
            bool hasSecondary = !string.IsNullOrEmpty(SecondaryText);
            int labelHeight = hasSecondary ? (int)(Height * 0.56f) : Height;
            TextRenderer.DrawText(g, LabelText, LabelFont, new Rectangle(labelX, 0, Math.Max(0, labelRight - labelX), labelHeight),
                TextColor, TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis);
            if (hasSecondary)
            {
                TextRenderer.DrawText(g, SecondaryText, SecondaryFont ?? HintFont,
                    new Rectangle(labelX, labelHeight, Math.Max(0, labelRight - labelX), Height - labelHeight),
                    MutedColor, TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis);
            }
            if (!string.IsNullOrEmpty(Hint))
            {
                var size = TextRenderer.MeasureText(Hint, HintFont);
                TextRenderer.DrawText(g, Hint, HintFont, new Rectangle(Width - (int)pad - size.Width, 0, size.Width, Height),
                    MutedColor, TextFormatFlags.Right | TextFormatFlags.VerticalCenter);
            }
        }
    }

    public class KeyCap : Control
    {
        public string Caption = "";
        public Color FillColor, BorderColor, TextColor, HoverColor;
        public bool Hovered = false;
        public Font LabelFont;

        public KeyCap()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer |
                     ControlStyles.UserPaint | ControlStyles.ResizeRedraw |
                     ControlStyles.SupportsTransparentBackColor, true);
            BackColor = Color.Transparent;
            Cursor = Cursors.Hand;
            Height = 30;
        }

        protected float S(float v) { return v * DeviceDpi / 96f; }

        protected override void OnResize(EventArgs e)
        {
            base.OnResize(e);
            if (Width > 0 && Height > 0) Region = new Region(HerdrApproval.Paint.Round(ClientRectangle, S(7)));
        }

        protected override void OnMouseEnter(EventArgs e) { Hovered = true; Invalidate(); base.OnMouseEnter(e); }
        protected override void OnMouseLeave(EventArgs e) { Hovered = false; Invalidate(); base.OnMouseLeave(e); }

        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            HerdrApproval.Paint.FillRound(e.Graphics, new RectangleF(0, 0, Width - 1, Height - 1), S(7),
                Hovered ? HoverColor : FillColor, BorderColor);
            TextRenderer.DrawText(e.Graphics, Caption, LabelFont, ClientRectangle, TextColor,
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);
        }
    }

    public class Chip : Control
    {
        public string Caption = "";
        public string Value = "";
        public Color FillColor, BorderColor, CaptionColor, ValueColor;
        public Font CaptionFont, ValueFont;

        public Chip()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer |
                     ControlStyles.UserPaint | ControlStyles.ResizeRedraw |
                     ControlStyles.SupportsTransparentBackColor, true);
            BackColor = Color.Transparent;
            Height = 24;
        }

        protected float S(float v) { return v * DeviceDpi / 96f; }

        public int PreferredWidth()
        {
            int w = (int)S(16);
            if (!string.IsNullOrEmpty(Caption)) w += TextRenderer.MeasureText(Caption, CaptionFont).Width + (int)S(6);
            if (!string.IsNullOrEmpty(Value)) w += TextRenderer.MeasureText(Value, ValueFont).Width;
            return w;
        }

        protected override void OnResize(EventArgs e)
        {
            base.OnResize(e);
            if (Width > 0 && Height > 0) Region = new Region(HerdrApproval.Paint.Round(ClientRectangle, S(8)));
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            HerdrApproval.Paint.FillRound(e.Graphics, new RectangleF(0, 0, Width - 1, Height - 1), S(8), FillColor, BorderColor);
            int x = (int)S(8);
            int mid = Height / 2;
            if (!string.IsNullOrEmpty(Caption))
            {
                var size = TextRenderer.MeasureText(Caption, CaptionFont);
                TextRenderer.DrawText(e.Graphics, Caption, CaptionFont, new Rectangle(x, 0, size.Width, Height),
                    CaptionColor, TextFormatFlags.Left | TextFormatFlags.VerticalCenter);
                x += size.Width + (int)S(6);
            }
            if (!string.IsNullOrEmpty(Value))
            {
                var size = TextRenderer.MeasureText(Value, ValueFont);
                TextRenderer.DrawText(e.Graphics, Value, ValueFont, new Rectangle(x, 0, Math.Max(0, Width - x), Height),
                    ValueColor, TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis);
            }
        }
    }

    public class TextButton : Control
    {
        public Color TextColor, HoverColor, AccentText;
        public bool IsAccent = false;
        public bool Hovered = false;
        public Font LabelFont;

        public TextButton()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer |
                     ControlStyles.UserPaint | ControlStyles.ResizeRedraw |
                     ControlStyles.SupportsTransparentBackColor, true);
            BackColor = Color.Transparent;
            Cursor = Cursors.Hand;
            Height = 28;
        }

        protected float S(float v) { return v * DeviceDpi / 96f; }

        public int PreferredWidth()
        {
            return TextRenderer.MeasureText(Text ?? "", LabelFont).Width + (int)S(16);
        }

        protected override void OnMouseEnter(EventArgs e) { Hovered = true; Invalidate(); base.OnMouseEnter(e); }
        protected override void OnMouseLeave(EventArgs e) { Hovered = false; Invalidate(); base.OnMouseLeave(e); }

        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            if (IsAccent)
            {
                HerdrApproval.Paint.FillRound(e.Graphics, new RectangleF(0, 0, Width - 1, Height - 1), S(8),
                    Hovered ? HerdrApproval.Paint.Blend(AccentText, Color.White, 0.15f) : AccentText, Color.Transparent);
                TextRenderer.DrawText(e.Graphics, Text, LabelFont, ClientRectangle, Color.White,
                    TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);
            }
            else
            {
                if (Hovered) HerdrApproval.Paint.FillRound(e.Graphics, new RectangleF(0, 0, Width - 1, Height - 1), S(8), HoverColor, Color.Transparent);
                TextRenderer.DrawText(e.Graphics, Text, LabelFont, ClientRectangle, TextColor,
                    TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);
            }
        }
    }
}
'@ -ReferencedAssemblies System.Drawing, System.Windows.Forms -ErrorAction Stop

Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class HerdrWin { [DllImport("user32.dll")] public static extern bool ReleaseCapture(); [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, int m, IntPtr w, IntPtr l); [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h, int m, IntPtr w, string l); [DllImport("user32.dll")] public static extern bool DestroyIcon(IntPtr h); }' -ErrorAction Stop

# ---------------------------------------------------------------- form

$script:Scale = 1.0
$form = New-Object System.Windows.Forms.Form
$form.Text = T "tray.title"
$form.FormBorderStyle = "None"
$form.StartPosition = "Manual"
$form.TopMost = $true
$form.ShowInTaskbar = $false
$form.BackColor = $ColBg
$form.ForeColor = $ColFg
$form.AutoScaleMode = "None"
$form.MinimumSize = New-Object System.Drawing.Size(560, 420)
$form.Width = 700
$form.Height = 640
$form.CreateControl()
try { $form.DoubleBuffered = $true } catch {}
try { $script:Scale = [System.Drawing.Graphics]::FromHwnd($form.Handle).DpiX / 96.0 } catch { $script:Scale = 1.0 }
function S([double]$value) { return [int][Math]::Round($value * $script:Scale) }

$form.Width = S 740
$form.Height = S 640
$form.MinimumSize = New-Object System.Drawing.Size((S 600), (S 460))

$card = New-Object HerdrApproval.Card
$card.Dock = "Fill"
$card.Radius = 14
$card.FillColor = $ColSurface
$card.StrokeColor = $ColBorder
$card.BackColor = $ColSurface
$form.Controls.Add($card)

$uiFont = "Segoe UI"
try { $fonts = (New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }; if ($fonts -contains "Segoe UI Variable Text") { $uiFont = "Segoe UI Variable Text" } } catch {}
$monoFont = "Consolas"
if ($Settings.font) {
  try {
    $installed = (New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }
    if ($installed -contains [string]$Settings.font) { $monoFont = [string]$Settings.font }
  } catch {}
}

$fTitle = New-Object System.Drawing.Font($uiFont, 16, [Drawing.FontStyle]::Bold)
$fBody = New-Object System.Drawing.Font($uiFont, 10)
$fBodyStrong = New-Object System.Drawing.Font($uiFont, 10, [Drawing.FontStyle]::Bold)
$fQuestion = New-Object System.Drawing.Font($uiFont, 10.5)
$fSmall = New-Object System.Drawing.Font($uiFont, 8.5)
$fSmallStrong = New-Object System.Drawing.Font($uiFont, 8.5, [Drawing.FontStyle]::Bold)
$fMono = New-Object System.Drawing.Font($monoFont, 8.5)

$appChip = New-Object HerdrApproval.Chip
$appChip.FillColor = $ColAccent
$appChip.BorderColor = [Drawing.Color]::Transparent
$appChip.CaptionColor = $ColAccentFg
$appChip.ValueColor = $ColAccentFg
$appChip.CaptionFont = $fSmallStrong
$appChip.ValueFont = $fSmallStrong
$appChip.Height = S 24

$needChip = New-Object HerdrApproval.Chip
$needChip.FillColor = $ColBlocked
$needChip.BorderColor = [Drawing.Color]::Transparent
$needChip.CaptionColor = [Drawing.Color]::White
$needChip.ValueColor = [Drawing.Color]::White
$needChip.CaptionFont = $fSmallStrong
$needChip.ValueFont = $fSmallStrong
$needChip.Height = S 24

$queueChip = New-Object HerdrApproval.Chip
$queueChip.FillColor = $ColRaised
$queueChip.BorderColor = [Drawing.Color]::Transparent
$queueChip.CaptionColor = $ColMuted
$queueChip.ValueColor = $ColMuted
$queueChip.CaptionFont = $fSmall
$queueChip.ValueFont = $fSmall
$queueChip.Height = S 24

$closeButton = New-Object HerdrApproval.TextButton
$closeButton.Text = "×"
$closeButton.LabelFont = New-Object System.Drawing.Font($uiFont, 13)
$closeButton.TextColor = $ColMuted
$closeButton.HoverColor = $ColRaised
$closeButton.Width = S 28
$closeButton.Height = S 28
$closeButton.add_Click({ $form.Hide() })

$titleLabel = New-Object System.Windows.Forms.Label
$titleLabel.AutoSize = $false
$titleLabel.BackColor = [Drawing.Color]::Transparent
$titleLabel.ForeColor = $ColFg
$titleLabel.Font = $fTitle
$titleLabel.TextAlign = "MiddleLeft"
$titleLabel.AutoEllipsis = $true

$spaceChip = New-Object HerdrApproval.Chip
$tabChip = New-Object HerdrApproval.Chip
$termChip = New-Object HerdrApproval.Chip
foreach ($chip in @($spaceChip, $tabChip, $termChip)) {
  $chip.FillColor = $ColRaised
  $chip.BorderColor = [Drawing.Color]::Transparent
  $chip.CaptionColor = $ColDim
  $chip.ValueColor = $ColMuted
  $chip.CaptionFont = $fSmall
  $chip.ValueFont = $fSmall
  $chip.Height = S 22
}

$waitLabel = New-Object System.Windows.Forms.Label
$waitLabel.AutoSize = $false
$waitLabel.BackColor = [Drawing.Color]::Transparent
$waitLabel.ForeColor = $ColMuted
$waitLabel.Font = $fSmall
$waitLabel.TextAlign = "MiddleRight"

$questionCard = New-Object HerdrApproval.Card
$questionCard.Radius = 0
$questionCard.FillColor = [Drawing.Color]::Transparent
$questionCard.StrokeColor = [Drawing.Color]::Transparent
$questionCard.BackColor = [Drawing.Color]::Transparent
$qBar = New-Object System.Windows.Forms.Panel
$qBar.BackColor = $ColAccent
$qBar.Width = S 3
$qHeadLabel = New-Object System.Windows.Forms.Label
$qHeadLabel.AutoSize = $true
$qHeadLabel.BackColor = [Drawing.Color]::Transparent
$qHeadLabel.ForeColor = $ColDim
$qHeadLabel.Font = $fSmallStrong
$qHeadLabel.Text = "问题"
$questionLabel = New-Object System.Windows.Forms.Label
$questionLabel.AutoSize = $false
$questionLabel.BackColor = [Drawing.Color]::Transparent
$questionLabel.ForeColor = $ColFg
$questionLabel.Font = $fQuestion
$questionCard.Controls.Add($qBar)
$questionCard.Controls.Add($questionLabel)

$translateButton = New-Object HerdrApproval.TextButton
$translateButton.LabelFont = $fSmallStrong
$translateButton.TextColor = $ColAccent
$translateButton.HoverColor = Paint-Blend $ColAccent $ColSurface 0.12
$translateButton.Height = S 24
$translationCard = New-Object HerdrApproval.Card
$translationCard.Radius = 0
$translationCard.FillColor = [Drawing.Color]::Transparent
$translationCard.StrokeColor = [Drawing.Color]::Transparent
$translationCard.BackColor = [Drawing.Color]::Transparent
$translationHeader = New-Object System.Windows.Forms.Label
$translationHeader.AutoSize = $false
$translationHeader.BackColor = [Drawing.Color]::Transparent
$translationHeader.ForeColor = $ColAccent
$translationHeader.Font = $fSmallStrong
$translationBox = New-Object System.Windows.Forms.TextBox
$translationBox.Multiline = $true
$translationBox.ReadOnly = $true
$translationBox.ScrollBars = "None"
$translationBox.WordWrap = $true
$translationBox.BorderStyle = "None"
$translationBox.BackColor = $ColSurface
$translationBox.ForeColor = $ColFg
$translationBox.Font = $fBody
$translationCard.Controls.Add($translationHeader)
$translationCard.Controls.Add($translationBox)

$termCard = New-Object HerdrApproval.Card
$termCard.Radius = 0
$termCard.FillColor = [Drawing.Color]::Transparent
$termCard.StrokeColor = [Drawing.Color]::Transparent
$termCard.BackColor = [Drawing.Color]::Transparent
$termTitle = New-Object System.Windows.Forms.Label
$termTitle.AutoSize = $true
$termTitle.BackColor = [Drawing.Color]::Transparent
$termTitle.ForeColor = $ColDim
$termTitle.Font = $fSmallStrong
$termToggle = New-Object HerdrApproval.TextButton
$termToggle.LabelFont = $fSmall
$termToggle.TextColor = $ColMuted
$termToggle.HoverColor = $ColRaised
$termToggle.Height = S 24
$termTranslate = New-Object HerdrApproval.TextButton
$termTranslate.LabelFont = $fSmallStrong
$termTranslate.TextColor = $ColAccent
$termTranslate.HoverColor = Paint-Blend $ColAccent $ColCanvas 0.12
$termTranslate.Height = S 24
$termRefresh = New-Object HerdrApproval.TextButton
$termRefresh.LabelFont = $fSmall
$termRefresh.TextColor = $ColMuted
$termRefresh.HoverColor = $ColRaised
$termRefresh.Height = S 24
$screenBox = New-Object System.Windows.Forms.TextBox
$screenBox.Multiline = $true
$screenBox.ReadOnly = $true
$screenBox.ScrollBars = "None"
$screenBox.WordWrap = $false
$screenBox.BorderStyle = "None"
$screenBox.BackColor = $ColSurface
$screenBox.ForeColor = $ColMuted
$screenBox.Font = $fMono
$screenTransHeader = New-Object System.Windows.Forms.Label
$screenTransHeader.AutoSize = $false
$screenTransHeader.BackColor = [Drawing.Color]::Transparent
$screenTransHeader.ForeColor = $ColAccent
$screenTransHeader.Font = $fSmallStrong
$screenTransLabel = New-Object System.Windows.Forms.Label
$screenTransLabel.AutoSize = $false
$screenTransLabel.BackColor = $ColSurface
$screenTransLabel.ForeColor = $ColFg
$screenTransLabel.Font = $fBody
$screenTransLabel.UseCompatibleTextRendering = $true
$termCard.Controls.Add($termTitle)
$termCard.Controls.Add($termTranslate)
$termCard.Controls.Add($termToggle)
$termCard.Controls.Add($termRefresh)
$termCard.Controls.Add($screenBox)
$termCard.Controls.Add($screenTransHeader)
$termCard.Controls.Add($screenTransLabel)

$optionsLabel = New-Object System.Windows.Forms.Label
$optionsLabel.AutoSize = $true
$optionsLabel.BackColor = [Drawing.Color]::Transparent
$optionsLabel.ForeColor = $ColDim
$optionsLabel.Font = $fSmallStrong
$optionsPanel = New-Object System.Windows.Forms.FlowLayoutPanel
$optionsPanel.FlowDirection = "TopDown"
$optionsPanel.WrapContents = $false
$optionsPanel.BackColor = $ColSurface
$keyPanel = New-Object System.Windows.Forms.FlowLayoutPanel
$keyPanel.FlowDirection = "LeftToRight"
$keyPanel.WrapContents = $true
$keyPanel.BackColor = $ColSurface

$inputCard = New-Object HerdrApproval.Card
$inputCard.Radius = 0
$inputCard.FillColor = [Drawing.Color]::Transparent
$inputCard.StrokeColor = [Drawing.Color]::Transparent
$inputCard.BackColor = [Drawing.Color]::Transparent
$inputBox = New-Object System.Windows.Forms.TextBox
$inputBox.BorderStyle = "None"
$inputBox.BackColor = $ColSurface
$inputBox.ForeColor = $ColFg
$inputBox.Font = $fBody
$inputLine = New-Object System.Windows.Forms.Panel
$inputLine.BackColor = $ColBorder
$inputBox.add_GotFocus({ $inputLine.BackColor = $ColAccent })
$inputBox.add_LostFocus({ $inputLine.BackColor = $ColBorder })
$sendButton = New-Object HerdrApproval.TextButton
$sendButton.IsAccent = $true
$sendButton.LabelFont = $fSmallStrong
$sendButton.AccentText = $ColAccent
$sendButton.TextColor = $ColAccentFg
$inputCard.Controls.Add($inputBox)
$inputCard.Controls.Add($sendButton)

$termRule = New-Object System.Windows.Forms.Panel
$termRule.BackColor = $ColBorder
$inputRule = New-Object System.Windows.Forms.Panel
$inputRule.BackColor = $ColBorder
$footerLine = New-Object System.Windows.Forms.Panel
$footerLine.BackColor = $ColBorder
$shortcutLabel = New-Object System.Windows.Forms.Label
$shortcutLabel.AutoSize = $false
$shortcutLabel.BackColor = [Drawing.Color]::Transparent
$shortcutLabel.ForeColor = $ColMuted
$shortcutLabel.Font = $fSmall
$shortcutLabel.TextAlign = "MiddleLeft"
$openButton = New-Object HerdrApproval.TextButton
$openButton.LabelFont = $fSmall
$openButton.TextColor = $ColMuted
$openButton.HoverColor = $ColRaised
$ignoreButton = New-Object HerdrApproval.TextButton
$ignoreButton.LabelFont = $fSmall
$ignoreButton.TextColor = $ColDim
$ignoreButton.HoverColor = $ColRaised
$wizardPrev = New-Object HerdrApproval.TextButton
$wizardPrev.LabelFont = $fSmallStrong
$wizardPrev.TextColor = $ColMuted
$wizardPrev.HoverColor = $ColRaised
$wizardNext = New-Object HerdrApproval.TextButton
$wizardNext.LabelFont = $fSmallStrong
$wizardNext.TextColor = $ColAccent
$wizardNext.HoverColor = Paint-Blend $ColAccent $ColSurface 0.12

foreach ($control in @($appChip, $needChip, $queueChip, $closeButton, $titleLabel, $spaceChip, $tabChip, $termChip, $waitLabel,
    $qHeadLabel, $questionCard, $translateButton, $translationCard, $termCard, $optionsLabel, $optionsPanel, $keyPanel, $inputCard, $inputLine, $termRule, $inputRule, $footerLine, $shortcutLabel, $openButton, $ignoreButton, $wizardPrev, $wizardNext)) {
  $card.Controls.Add($control)
}

function Set-ChipText($chip, [string]$caption, [string]$value) {
  $chip.Caption = $caption
  $chip.Value = $value
  $chip.Width = $chip.PreferredWidth()
}

function Position-Chip($chip, [int]$x, [int]$y) {
  $chip.Location = New-Object System.Drawing.Point($x, $y)
}

function Clear-Options {
  foreach ($control in @($optionsPanel.Controls)) { $control.Dispose() }
  $optionsPanel.Controls.Clear()
  foreach ($control in @($keyPanel.Controls)) { $control.Dispose() }
  $keyPanel.Controls.Clear()
  $script:DefaultRow = $null
}

function Add-Row($option, [int]$index) {
  $row = New-Object HerdrApproval.RowButton
  $label = [string]$option.label
  $badge = [string](@($option.keys)[0])
  $text = $label
  $m = [regex]::Match($label, "^\s*(\d{1,2})[.)]\s+(.+)$")
  if ($m.Success) { $badge = $m.Groups[1].Value; $text = $m.Groups[2].Value }
  if ($badge -match "^[a-zA-Z]$") { $badge = $badge.ToUpperInvariant() }
  $row.Badge = if ($badge -match "^[0-9A-Z]$") { $badge } else { [string]($index + 1) }
  $row.LabelText = $text
  $row.IsDefault = [bool]$option.default -or [bool]$option.selected
  $row.Hint = if ($row.IsDefault) { "Enter" } else { "" }
  $row.FillColor = $ColRaised
  $row.BadgeColor = $ColPopover
  $row.BorderColor = $ColBorder
  $row.AccentColor = $ColAccent
  $row.AccentText = $ColAccentFg
  $row.TextColor = $ColFg
  $row.MutedColor = $ColMuted
  $row.HoverColor = Paint-Blend $ColAccent $ColSurface 0.10
  $row.LabelFont = $fBodyStrong
  $row.SecondaryFont = $fSmall
  $row.HintFont = $fSmall
  $row.BadgeFont = $fSmallStrong
  $row.Tag = @{ keys = @($option.keys); label = $text; original = $text; index = $index; other = [bool]$option.other }
  $row.Height = S 44
  $row.add_Click({ param($sender, $event) Invoke-Option $sender }.GetNewClosure())
  [void]$optionsPanel.Controls.Add($row)
  if ($row.IsDefault -and $null -eq $script:DefaultRow) { $script:DefaultRow = $row }
}

function Add-WizardRow($option, [int]$index) {
  $row = New-Object HerdrApproval.RowButton
  $label = [string]$option.label
  $row.Badge = [string]($index + 1)
  $row.LabelText = $label
  $row.IsDefault = $false
  $row.Hint = ""
  $row.FillColor = $ColRaised
  $row.BadgeColor = $ColPopover
  $row.BorderColor = $ColBorder
  $row.AccentColor = $ColAccent
  $row.AccentText = $ColAccentFg
  $row.TextColor = $ColFg
  $row.MutedColor = $ColMuted
  $row.HoverColor = Paint-Blend $ColAccent $ColSurface 0.10
  $row.LabelFont = $fBodyStrong
  $row.SecondaryFont = $fSmall
  $row.HintFont = $fSmall
  $row.BadgeFont = $fSmallStrong
  $row.Tag = @{ wizard = $true; index = $index; other = [bool]$option.other; label = $label; original = $label }
  $row.Height = S 44
  $row.add_Click({ param($sender, $event) Wizard-Select $sender }.GetNewClosure())
  [void]$optionsPanel.Controls.Add($row)
}

function Update-WizardRows {
  if (-not $script:Wizard) { return }
  $answer = $script:WizardAnswers[$script:WizardIndex]
  $selected = @($answer.selected)
  foreach ($row in @($optionsPanel.Controls)) {
    if ($row -isnot [HerdrApproval.RowButton] -or $null -eq $row.Tag) { continue }
    $on = $selected -contains [int]$row.Tag.index
    $row.IsDefault = $on
    $row.Hint = if ($on) { "✓" } elseif ([int]$row.Tag.index -eq $script:WizardCursor) { "›" } else { "" }
    $row.Invalidate()
  }
}

function Show-Wizard {
  if (-not $script:Wizard) { return }
  $q = $script:WizardQuestions[$script:WizardIndex]
  $answer = $script:WizardAnswers[$script:WizardIndex]
  $questionLabel.Text = [string]$q.question
  $script:Active.question = [string]$q.question
  $script:Active.options = @($q.options)
  if (-not $script:TranslationVisible) { $translationBox.Text = "" }
  $script:TranslationVisible = $false
  $translationCard.Visible = $false
  $script:WizardCursor = 0
  $pick = @($answer.selected)
  if ($pick.Count -gt 0) { $script:WizardCursor = [int]$pick[0] }
  Clear-Options
  $i = 0
  foreach ($option in @($q.options)) {
    Add-WizardRow $option $i
    $i++
  }
  Update-WizardRows
  $otherIndex = -1
  for ($j = 0; $j -lt @($q.options).Count; $j++) { if ($q.options[$j].other) { $otherIndex = $j } }
  $script:WizardOther = (@($answer.selected) -contains $otherIndex)
  if ($script:WizardOther) { Set-CueBanner (T "popup.placeholderOther") } else { Set-CueBanner }
  Update-Texts
  Layout-Form
}

function Select-WizardIndex([int]$index) {
  if (-not $script:Wizard) { return }
  $q = $script:WizardQuestions[$script:WizardIndex]
  $answer = $script:WizardAnswers[$script:WizardIndex]
  if ($index -lt 0 -or $index -ge @($q.options).Count) { return }
  $script:WizardCursor = $index
  $option = $q.options[$index]
  $otherIndex = -1
  for ($j = 0; $j -lt @($q.options).Count; $j++) { if ($q.options[$j].other) { $otherIndex = $j } }
  if ([bool]$option.other) {
    # Other is exclusive: choosing it drops ordinary options.
    $answer.selected = @($index)
    $answer.text = ""
    $script:WizardOther = $true
    Set-CueBanner (T "popup.placeholderOther")
    $form.Activate()
    $inputBox.Focus()
  } else {
    # Choosing an ordinary option always cancels Other/custom text.
    $selected = @($answer.selected | Where-Object { $_ -ne $otherIndex })
    $answer.text = ""
    if ($q.multi) {
      if ($selected -contains $index) {
        $answer.selected = @($selected | Where-Object { $_ -ne $index })
      } else {
        $answer.selected = @($selected + $index)
      }
    } else {
      $answer.selected = @($index)
    }
    $script:WizardOther = $false
  }
  Update-WizardRows
  Layout-Form
}

function Wizard-Select($control) {
  if (-not $script:Wizard -or $null -eq $control.Tag) { return }
  Select-WizardIndex ([int]$control.Tag.index)
}

function Wizard-MoveCursor([int]$delta) {
  if (-not $script:Wizard) { return }
  $count = @($script:WizardQuestions[$script:WizardIndex].options).Count
  if ($count -le 0) { return }
  $script:WizardCursor = [Math]::Max(0, [Math]::Min($count - 1, $script:WizardCursor + $delta))
  Update-WizardRows
}

function Wizard-Prev {
  if (-not $script:Wizard -or $script:WizardIndex -le 0) { return }
  $script:WizardIndex--
  Show-Wizard
}

function Send-WizardCurrent {
  $q = $script:WizardQuestions[$script:WizardIndex]
  $answer = $script:WizardAnswers[$script:WizardIndex]
  $selected = @($answer.selected | Sort-Object)
  if ($selected.Count -eq 0) { return }
  $address = [string]$script:Active.address
  $keys = @()
  $script:WizardStarted = $true
  $otherIndex = -1
  for ($i = 0; $i -lt @($q.options).Count; $i++) { if ($q.options[$i].other) { $otherIndex = $i } }
  if ($q.multi) {
    $pos = 0
    foreach ($index in $selected) {
      if ($index -eq $otherIndex) { continue }
      $delta = $index - $pos
      if ($delta -gt 0) { $keys += @("down") * $delta }
      elseif ($delta -lt 0) { $keys += @("up") * (-$delta) }
      $keys += "space"
      $pos = $index
    }
    if ($selected -contains $otherIndex) {
      $delta = $otherIndex - $pos
      if ($delta -gt 0) { $keys += @("down") * $delta } elseif ($delta -lt 0) { $keys += @("up") * (-$delta) }
      $keys += "enter"
      $result = Invoke-Hc (@("keys", $address) + $keys)
      if (-not $result.ok) { throw [Exception]::new([string]$result.error) }
      Start-Sleep -Milliseconds 250
      $textResult = Invoke-Hc @("send", "--force", $address, [string]$answer.text)
      if (-not $textResult.ok) { throw [Exception]::new([string]$textResult.error) }
      Start-Sleep -Milliseconds 250
      return
    }
    $keys += "enter"
  } else {
    $keys += @("down") * [int]$selected[0]
    $keys += "enter"
    if ($selected[0] -eq $otherIndex) {
      $result = Invoke-Hc (@("keys", $address) + $keys)
      if (-not $result.ok) { throw [Exception]::new([string]$result.error) }
      Start-Sleep -Milliseconds 250
      $textResult = Invoke-Hc @("send", "--force", $address, [string]$answer.text)
      if (-not $textResult.ok) { throw [Exception]::new([string]$textResult.error) }
      Start-Sleep -Milliseconds 250
      return
    }
  }
  $result = Invoke-Hc (@("keys", $address) + $keys)
  if (-not $result.ok) { throw [Exception]::new([string]$result.error) }
  Start-Sleep -Milliseconds 200
}

function Finish-Wizard {
  $request = $script:Active
  if ($null -eq $request) { return }
  Write-Answer @{ id = $request.id; address = $request.address; action = "keys"; choice = "multi-question"; ok = $true; stillBlocked = $false; at = (Get-Date).ToUniversalTime().ToString("o") }
  Remove-Item -LiteralPath (Join-Path $QueueDir ("{0}.json" -f $request.id)) -Force -ErrorAction SilentlyContinue
  Write-Log ("wizard {0} {1}" -f $request.id, $request.address)
  Hide-Active
}

function Refresh-WizardScreen {
  $result = Invoke-Hc @("read", [string]$script:Active.address, "--lines", "0", "--json")
  if (-not $result.ok) { return }
  try {
    $payload = $result.output | ConvertFrom-Json
    if ($payload.text) {
      $script:ScreenFull = [string]$payload.text
      $screenBox.Text = Trim-Screen $script:ScreenFull $false
      $script:ScreenTranslated = $false
      $script:ScreenTranslation = ""
      $screenTransLabel.Text = ""
      $script:TranslationVisible = $false
      $translationCard.Visible = $false
    }
  } catch {}
}

function Wizard-Next {
  if (-not $script:Wizard -or $script:Busy) { return }
  $q = $script:WizardQuestions[$script:WizardIndex]
  $answer = $script:WizardAnswers[$script:WizardIndex]
  $selected = @($answer.selected)
  if ($selected.Count -eq 0) { return }
  $otherIndex = -1
  for ($i = 0; $i -lt @($q.options).Count; $i++) { if ($q.options[$i].other) { $otherIndex = $i } }
  if ($selected -contains $otherIndex -and -not ([string]$answer.text).Trim()) {
    Set-CueBanner (T "popup.placeholderOther")
    $inputBox.Focus()
    return
  }
  $script:Busy = $true
  try {
    Send-WizardCurrent
    Start-Sleep -Milliseconds 250
    Refresh-WizardScreen
    if ($script:WizardIndex + 1 -lt $script:WizardQuestions.Count) {
      $script:WizardIndex++
      Show-Wizard
    } else {
      $submit = Invoke-Hc @("keys", [string]$script:Active.address, "enter")
      Finish-Wizard
    }
  } catch {
    Write-Log ("wizard error {0}" -f $_.Exception.Message)
    try { $tray.ShowBalloonTip(5000, (T "popup.failed"), $_.Exception.Message, [System.Windows.Forms.ToolTipIcon]::Error) } catch {}
  } finally {
    $script:Busy = $false
  }
}

function Add-KeyCap([string]$label, $keys) {
  $cap = New-Object HerdrApproval.KeyCap
  $cap.Caption = $label
  $cap.LabelFont = $fSmallStrong
  $cap.FillColor = $ColRaised
  $cap.BorderColor = $ColBorder
  $cap.TextColor = $ColMuted
  $cap.HoverColor = Paint-Blend $ColAccent $ColSurface 0.16
  $cap.Width = [Math]::Max((S 32), (([System.Windows.Forms.TextRenderer]::MeasureText($label, $fSmallStrong).Width) + (S 16)))
  $cap.Height = S 30
  $cap.Tag = @{ keys = @($keys); label = $label }
  $cap.add_Click({ param($sender, $event) Invoke-Option $sender }.GetNewClosure())
  [void]$keyPanel.Controls.Add($cap)
}

function Add-GenericKeys {
  Add-KeyCap "Enter" @("enter")
  Add-KeyCap "Esc" @("esc")
  Add-KeyCap "↑" @("up")
  Add-KeyCap "↓" @("down")
  Add-KeyCap "Tab" @("tab")
  Add-KeyCap "1" @("1")
  Add-KeyCap "2" @("2")
  Add-KeyCap "3" @("3")
  Add-KeyCap "Y" @("y", "enter")
  Add-KeyCap "N" @("n", "enter")
}

function Update-WaitLabel {
  if ($null -eq $script:Active) {
    $waitLabel.Text = ""
    return
  }
  $created = [DateTimeOffset]::FromUnixTimeMilliseconds([long]$script:Active.created).UtcDateTime
  $next = TF "popup.waiting" (Format-Age ((Get-Date).ToUniversalTime() - $created).TotalSeconds)
  if ($waitLabel.Text -ne $next) { $waitLabel.Text = $next }
}

function Update-Texts {
  $form.Text = T "tray.title"
  $appChip.Caption = ""
  $needChip.Caption = ""
  $needChip.Value = T "popup.needYou"
  $needChip.Width = $needChip.PreferredWidth()
  $translateButton.Text = if ($script:TranslationVisible) { T "translate.hide" } else { T "translate.button" }
  $translateButton.Width = $translateButton.PreferredWidth()
  $translateButton.Visible = ($script:Wizard -or -not $script:MultiQuestion) -and $null -ne $script:Active -and ([bool]$script:Active.question -or @($script:Active.options).Count -gt 0)
  $trKey = if ($script:Active -and [string]$script:Active.question) { "translate.questionBy" } else { "translate.by" }
  $translationHeader.Text = if ($script:TranslationProvider) { (T $trKey).Replace("{p}", $script:TranslationProvider) } else { T "translate.failed" }
  $screenTransHeader.Text = T "popup.screenTranslated"
  $qHeadLabel.Text = T "popup.questionSection"
  $termTitle.Text = T "popup.screen"
  $termTranslate.Text = if ($script:ScreenTranslated) { T "translate.hide" } else { T "popup.translateScreen" }
  $termTranslate.Width = $termTranslate.PreferredWidth()
  $termToggle.Text = if ($script:ScreenExpanded) { T "popup.collapse" } else { T "popup.expand" }
  $termRefresh.Text = T "popup.refresh"
  if ($script:Wizard) {
    $optionsLabel.Text = (T "popup.wizardQuestion").Replace("{i}", [string]($script:WizardIndex + 1)).Replace("{n}", [string]$script:WizardQuestions.Count)
  } elseif ($script:MultiQuestion) {
    $optionsLabel.Text = (T "popup.multiQuestion").Replace("{n}", [string]$script:Active.questionCount)
  } else {
    $optionsLabel.Text = if (@($script:Active.options).Count -gt 0) { T "popup.choose" } elseif ($script:Active.kind -eq "text") { T "popup.answer" } else { T "popup.generic" }
  }
  $wizardPrev.Visible = $script:Wizard
  $wizardNext.Visible = $script:Wizard
  $wizardPrev.Text = T "popup.wizardPrev"
  $wizardNext.Text = if ($script:Wizard -and $script:WizardIndex + 1 -ge $script:WizardQuestions.Count) { T "popup.wizardSubmit" } else { T "popup.wizardNext" }
  $wizardPrev.Width = $wizardPrev.PreferredWidth()
  $wizardNext.Width = $wizardNext.PreferredWidth()
  $sendButton.Text = T "popup.send"
  $sendButton.Width = $sendButton.PreferredWidth()
  $openButton.Text = T "popup.open"
  $openButton.Width = $openButton.PreferredWidth()
  $ignoreButton.Text = T "popup.ignore"
  $ignoreButton.Width = $ignoreButton.PreferredWidth()
  if ($script:Wizard) {
    $shortcutLabel.Text = T "popup.hintWizard"
  } elseif ($script:MultiQuestion) {
    $shortcutLabel.Text = T "popup.hintMulti"
  } elseif (@($script:Active.options).Count -gt 0) {
    $shortcutLabel.Text = (T "popup.hintDefaults") + "  ·  " + (T "popup.hintTranslate")
  } elseif ($script:Active.kind -eq "text") {
    $shortcutLabel.Text = (T "popup.hintText")
  } else {
    $shortcutLabel.Text = (T "popup.hintGeneric")
  }
  if ($null -ne $script:Active) {
    Update-WaitLabel
    $queueChip.Caption = ""
    $count = @(Get-ChildItem -LiteralPath $QueueDir -Filter "*.json" -ErrorAction SilentlyContinue).Count
    $queueChip.Value = if ($count -gt 1) { (T "popup.queue").Replace("{n}", [string]($count - 1)) } else { "" }
    $queueChip.Width = $queueChip.PreferredWidth()
    $queueChip.Visible = $count -gt 1
  }
  Update-Tray
}

function Format-Age([double]$seconds) {
  if ($seconds -lt 60) { return (T "time.seconds").Replace("{n}", [string][int]$seconds) }
  return (T "time.minutes").Replace("{m}", [string][int]($seconds / 60)).Replace("{s}", [string][int]($seconds % 60))
}

# 让标题栏可拖动：按下时把消息转成 HTCAPTION。
foreach ($drag in @($titleLabel, $appChip, $needChip, $waitLabel)) {
  $drag.add_MouseDown({
    param($sender, $event)
    if ($event.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
      [HerdrWin]::ReleaseCapture() | Out-Null
      [HerdrWin]::SendMessage($form.Handle, 0xA1, [IntPtr]::new(0x2), [IntPtr]::Zero) | Out-Null
    }
  })
}

# ---------------------------------------------------------------- layout

$script:ScreenFull = ""
$script:ScreenExpanded = $false

function Set-CueBanner([string]$text = "") {
  try {
    $handle = $inputBox.Handle
    if (-not $text) { $text = T "popup.placeholder" }
    [HerdrWin]::SendMessage($handle, 0x1501, [IntPtr]::new(1), $text) | Out-Null
  } catch {}
}

function Trim-Screen([string]$text, [bool]$full) {
  $normalized = $text.Replace("`r`n", "`n").Replace("`r", "`n")
  if ($full) { return $normalized.Replace("`n", "`r`n") }
  $lines = @($normalized -split "`n")
  $tail = @($lines | Select-Object -Last 12)
  return (($tail -join "`n").Replace("`n", "`r`n"))
}

function Format-ScreenTranslation([string]$text) {
  $lines = @($text.Replace("`r`n", "`n").Replace("`r", "`n") -split "`n" | Where-Object {
    $line = $_.Trim()
    $line -and $line -notmatch "^[│┃║╭╮╰╯─━┄┅┈┉╌╍═╞╡├┤┬┴┼┌┐└┘|>❯›\s]+$"
  })
  return (($lines | Select-Object -First 10) -join "`n")
}

function Layout-Form {
  if ($script:Layouting) { return }
  $script:Layouting = $true
  $hwnd = $form.Handle
  if ($hwnd -ne [IntPtr]::Zero) { [void][HerdrWin]::SendMessage($hwnd, 0x000B, [IntPtr]::Zero, [IntPtr]::Zero) }
  $form.SuspendLayout()
  $card.SuspendLayout()
  try {
  $w = $card.ClientSize.Width
  $inner = $w - (S 44)
  if ($inner -lt (S 320)) { $inner = S 320 }
  $x = S 22
  $y = S 18

  $needChip.Location = New-Object System.Drawing.Point($x, $y)
  $queueChip.Location = New-Object System.Drawing.Point(($x + $needChip.Width + (S 10)), $y)
  $closeButton.Location = New-Object System.Drawing.Point(($x + $inner - $closeButton.Width), ($y - (S 2)))

  $titleY = $y + (S 32)
  $titleLabel.Location = New-Object System.Drawing.Point($x, $titleY)
  $titleLabel.Size = New-Object System.Drawing.Size($inner, (S 30))

  $metaY = $titleY + (S 32)
  $chipX = $x
  foreach ($chip in @($spaceChip, $tabChip, $termChip)) {
    $chip.Visible = [bool]$chip.Value
    if ($chip.Visible) {
      $chip.Location = New-Object System.Drawing.Point($chipX, $metaY)
      $chipX += $chip.Width + (S 6)
    }
  }
  $waitLabel.Location = New-Object System.Drawing.Point(($x + $inner - (S 190)), $metaY)
  $waitLabel.Size = New-Object System.Drawing.Size((S 190), (S 22))
  $headerBottom = $metaY + (S 26)

  $qHeadY = $headerBottom + (S 10)
  $qText = if ($script:Wizard) { [string]$script:WizardQuestions[$script:WizardIndex].question } else { [string]$script:Active.question }
  $hasQuestion = $qText.Trim().Length -gt 0
  $hasOptions = @($script:Active.options).Count -gt 0
  $qHeadLabel.Visible = $hasQuestion -or $hasOptions
  $qHeadLabel.Location = New-Object System.Drawing.Point($x, $qHeadY)
  $translateButton.Visible = ($script:Wizard -or -not $script:MultiQuestion) -and ($hasQuestion -or $hasOptions)
  $buttonWidth = $translateButton.PreferredWidth()
  $translateButton.Location = New-Object System.Drawing.Point(($x + $inner - $buttonWidth), ($qHeadY - (S 2)))
  $translateButton.Size = New-Object System.Drawing.Size($buttonWidth, (S 24))
  $qY = $qHeadY + (S 26)
  $qWidth = $inner - (S 28)
  $qSize = [System.Windows.Forms.TextRenderer]::MeasureText($qText, $fBody, (New-Object System.Drawing.Size($qWidth, 0)), [System.Windows.Forms.TextFormatFlags]::WordBreak)
  $qHeight = if ($hasQuestion) { [Math]::Max((S 56), ($qSize.Height + (S 26))) } else { 0 }
  $questionCard.Visible = $hasQuestion
  if ($questionCard.Visible) {
    $questionCard.Location = New-Object System.Drawing.Point($x, $qY)
    $questionCard.Size = New-Object System.Drawing.Size($inner, $qHeight)
    $qBar.Location = New-Object System.Drawing.Point(0, (S 10))
    $qBar.Size = New-Object System.Drawing.Size((S 3), ($qHeight - (S 20)))
    $questionLabel.Location = New-Object System.Drawing.Point((S 14), (S 10))
    $questionLabel.Size = New-Object System.Drawing.Size($qWidth, ($qHeight - (S 20)))
    $questionLabel.Text = $qText
  }

  $translationVisible = $script:TranslationVisible -and ($questionCard.Visible -or @($script:Active.options).Count -gt 0)
  $translationCard.Visible = $translationVisible
  $translationHeight = 0
  if ($translationVisible) {
    $trText = if ($script:TranslationText) { [string]$script:TranslationText } else { T "translate.loading" }
    $trWidth = $inner - (S 24)
    $trSize = [System.Windows.Forms.TextRenderer]::MeasureText($trText, $fBody, (New-Object System.Drawing.Size($trWidth, 0)), [System.Windows.Forms.TextFormatFlags]::WordBreak)
    $translationHeight = [Math]::Min((S 140), [Math]::Max((S 52), ($trSize.Height + (S 42))))
    $translationY = if ($questionCard.Visible) { $qY + $qHeight + (S 8) } else { $qY }
    $translationCard.Location = New-Object System.Drawing.Point($x, $translationY)
    $translationCard.Size = New-Object System.Drawing.Size($inner, $translationHeight)
    $translationHeader.Location = New-Object System.Drawing.Point((S 14), (S 8))
    $translationHeader.Size = New-Object System.Drawing.Size(($inner - (S 28)), (S 18))
    $translationBox.Location = New-Object System.Drawing.Point((S 14), (S 28))
    $translationBox.Size = New-Object System.Drawing.Size(($inner - (S 28)), ($translationHeight - (S 38)))
  }

  $afterQuestion = if ($translationVisible) { $translationHeight + (S 18) } else { S 10 }
  $tY = if ($questionCard.Visible) { $qY + $qHeight + $afterQuestion } elseif ($translationVisible) { $qY + $translationHeight + (S 10) } else { $qY }
  $termRule.Location = New-Object System.Drawing.Point($x, ($tY - (S 10)))
  $termRule.Size = New-Object System.Drawing.Size($inner, 1)
  $previewLines = @(($script:ScreenFull.Replace("`r`n", "`n") -split "`n") | Select-Object -Last 12).Count
  $baseH = if ($script:ScreenExpanded) { S 300 } else { [Math]::Min((S 150), [Math]::Max((S 96), (S 38 + $previewLines * (S 15)))) }
  $screenTransVisible = $script:ScreenTranslated -and [bool]$script:ScreenTranslation.Trim()
  $screenTransH = 0
  if ($screenTransVisible) {
    $stWidth = $inner - (S 24)
    $stSize = [System.Windows.Forms.TextRenderer]::MeasureText($script:ScreenTranslation, $fBody, (New-Object System.Drawing.Size($stWidth, 0)), [System.Windows.Forms.TextFormatFlags]::WordBreak)
    $screenTransH = [Math]::Min((S 180), [Math]::Max((S 20), ($stSize.Height + (S 4))))
  }
  $tH = $baseH + $(if ($screenTransVisible) { (S 30) + $screenTransH } else { 0 })
  $termCard.Location = New-Object System.Drawing.Point($x, $tY)
  $termCard.Size = New-Object System.Drawing.Size($inner, $tH)
  $termTitle.Location = New-Object System.Drawing.Point((S 12), (S 10))
  $termToggle.Width = $termToggle.PreferredWidth()
  $termRefresh.Width = $termRefresh.PreferredWidth()
  $termTranslate.Width = $termTranslate.PreferredWidth()
  $termToggle.Location = New-Object System.Drawing.Point(($inner - $termToggle.Width - (S 10)), (S 6))
  $termRefresh.Location = New-Object System.Drawing.Point(($inner - $termToggle.Width - $termRefresh.Width - (S 16)), (S 6))
  $termTranslate.Location = New-Object System.Drawing.Point(($inner - $termToggle.Width - $termRefresh.Width - $termTranslate.Width - (S 22)), (S 6))
  $screenBox.Location = New-Object System.Drawing.Point((S 12), (S 36))
  $screenBox.Size = New-Object System.Drawing.Size(($inner - (S 24)), ($baseH - (S 48)))
  $screenTransHeader.Location = New-Object System.Drawing.Point((S 12), ($baseH + (S 4)))
  $screenTransHeader.Size = New-Object System.Drawing.Size(($inner - (S 24)), (S 18))
  $screenTransLabel.Location = New-Object System.Drawing.Point((S 12), ($baseH + (S 22)))
  $screenTransLabel.Size = New-Object System.Drawing.Size(($inner - (S 24)), $screenTransH)
  $screenTransLabel.Visible = $screenTransVisible
  $screenTransHeader.Visible = $screenTransVisible

  $oY = $tY + $tH + (S 12)
  $optionsLabel.Location = New-Object System.Drawing.Point($x, $oY)
  $rowY = $oY + (S 24)
  $optionCount = if ($script:Wizard) { @($script:WizardQuestions[$script:WizardIndex].options).Count } else { @($script:Active.options).Count }
  if ($script:MultiQuestion -and -not $script:Wizard) {
    $optionsLabel.Visible = $true
    $optionsLabel.AutoSize = $false
    $optionsLabel.Size = New-Object System.Drawing.Size($inner, (S 44))
    $keyPanel.Visible = $false
    $optionsPanel.Visible = $false
    $inputCard.Visible = $false
    $inputRule.Visible = $false
    $inputLine.Visible = $false
    $rowY += (S 52)
  } elseif ($optionCount -gt 0) {
    $optionsLabel.Visible = $true
    $optionsLabel.AutoSize = $true
    $inputCard.Visible = $true
    $inputRule.Visible = $true
    $inputLine.Visible = $true
    $keyPanel.Visible = $false
    $optionsPanel.Visible = $true
    $optionsPanel.Location = New-Object System.Drawing.Point($x, $rowY)
    $rowHeight = if ($script:TranslationVisible) { S 58 } else { S 44 }
    $rowStep = $rowHeight + (S 8)
    $optionsPanel.Size = New-Object System.Drawing.Size($inner, [Math]::Max($rowHeight, ($optionCount * $rowStep)))
    $rowWidth = $inner
    $index = 0
    foreach ($control in @($optionsPanel.Controls)) {
      $control.Width = $rowWidth
      $control.Height = $rowHeight
      $control.Margin = New-Object System.Windows.Forms.Padding(0, 0, 0, (S 8))
      $index++
    }
    $rowY += [Math]::Max($rowHeight, ($optionCount * $rowStep))
  } else {
    $optionsLabel.Visible = $true
    $optionsPanel.Visible = $false
    $inputCard.Visible = $true
    $inputRule.Visible = $true
    $inputLine.Visible = $true
    if ($script:Active.kind -eq "text") {
      $keyPanel.Visible = $false
      $rowY += (S 4)
    } else {
      $keyPanel.Visible = $true
      $keyPanel.Location = New-Object System.Drawing.Point($x, $rowY)
      $keyPanel.Size = New-Object System.Drawing.Size($inner, (S 70))
      $rowY += (S 76)
    }
  }

  $wizardInput = $true
  if ($script:Wizard) {
    $wizardAnswer = $script:WizardAnswers[$script:WizardIndex]
    $wizardOptions = @($script:WizardQuestions[$script:WizardIndex].options)
    $wizardOtherIndex = -1
    for ($j = 0; $j -lt $wizardOptions.Count; $j++) { if ($wizardOptions[$j].other) { $wizardOtherIndex = $j } }
    $wizardInput = (@($wizardAnswer.selected) -contains $wizardOtherIndex)
    if (-not $wizardInput) {
      $inputCard.Visible = $false
      $inputRule.Visible = $false
      $inputLine.Visible = $false
    }
  }
  $iY = $rowY + (S 6)
  $inputRule.Location = New-Object System.Drawing.Point($x, ($iY - (S 10)))
  $inputRule.Size = New-Object System.Drawing.Size($inner, 1)
  $inputCard.Location = New-Object System.Drawing.Point($x, $iY)
  $inputCard.Size = New-Object System.Drawing.Size($inner, (S 46))
  $sendButton.Width = $sendButton.PreferredWidth()
  $sendButton.Height = S 28
  $sendButton.Location = New-Object System.Drawing.Point(($inner - $sendButton.Width - (S 9)), (S 9))
  $inputBox.Location = New-Object System.Drawing.Point((S 14), (S 12))
  $inputBox.Size = New-Object System.Drawing.Size(($inner - $sendButton.Width - (S 32)), (S 24))
  $inputLine.Location = New-Object System.Drawing.Point($x, ($iY + (S 45)))
  $inputLine.Size = New-Object System.Drawing.Size($inner, 1)

  $fY = if (($script:MultiQuestion -and -not $script:Wizard) -or ($script:Wizard -and -not $wizardInput)) { $iY + (S 12) } else { $iY + (S 52) }
  $footerLine.Location = New-Object System.Drawing.Point(0, $fY)
  $footerLine.Size = New-Object System.Drawing.Size($w, 1)
  $shortcutLabel.Location = New-Object System.Drawing.Point($x, ($fY + (S 12)))
  $shortcutWidth = $inner - $openButton.Width - $ignoreButton.Width - (S 24)
  if ($script:Wizard) { $shortcutWidth -= $wizardPrev.Width + $wizardNext.Width + (S 24) }
  $shortcutLabel.Size = New-Object System.Drawing.Size([Math]::Max((S 120), $shortcutWidth), (S 24))
  $ignoreButton.Location = New-Object System.Drawing.Point(($x + $inner - $ignoreButton.Width), ($fY + (S 10)))
  $openButton.Location = New-Object System.Drawing.Point(($x + $inner - $ignoreButton.Width - $openButton.Width - (S 6)), ($fY + (S 10)))
  $wizardPrev.Width = $wizardPrev.PreferredWidth()
  $wizardNext.Width = $wizardNext.PreferredWidth()
  $wizardNext.Location = New-Object System.Drawing.Point(($x + $inner - $ignoreButton.Width - $openButton.Width - $wizardNext.Width - (S 14)), ($fY + (S 10)))
  $wizardPrev.Location = New-Object System.Drawing.Point(($wizardNext.Location.X - $wizardPrev.Width - (S 8)), ($fY + (S 10)))

  $desired = $fY + (S 44)
  $area = [System.Windows.Forms.Screen]::FromPoint([System.Windows.Forms.Cursor]::Position).WorkingArea
  $form.Height = [Math]::Min($desired, $area.Height - (S 32))
  $form.Width = S 740
  Position-Form
  } finally {
    $card.ResumeLayout($true)
    $form.ResumeLayout($true)
    if ($hwnd -ne [IntPtr]::Zero) {
      [void][HerdrWin]::SendMessage($hwnd, 0x000B, [IntPtr]1, [IntPtr]::Zero)
      $form.Invalidate($true)
      $form.Update()
    }
    $script:Layouting = $false
  }
}

function Position-Form {
  $area = [System.Windows.Forms.Screen]::FromPoint([System.Windows.Forms.Cursor]::Position).WorkingArea
  $x = $area.Right - $form.Width - (S 20)
  $y = $area.Bottom - $form.Height - (S 20)
  if ($x -lt $area.Left) { $x = $area.Left }
  if ($y -lt $area.Top) { $y = $area.Top }
  $form.Location = New-Object System.Drawing.Point($x, $y)
}

$form.add_Resize({
  if ($null -ne $script:Active) { Layout-Form }
})

# ---------------------------------------------------------------- actions

function Invoke-Hc([string[]]$arguments) {
  if (-not $HcPath) { return @{ ok = $false; error = (T "error.noHc"); output = "" } }
  try {
    $output = & $HcPath @arguments 2>&1 | Out-String
    $code = $LASTEXITCODE
    return @{ ok = ($code -eq 0); error = if ($code -eq 0) { $null } else { $output.Trim() }; output = $output }
  } catch {
    return @{ ok = $false; error = $_.Exception.Message; output = "" }
  }
}

function Get-Status([string]$address) {
  $result = Invoke-Hc @("get", $address, "--json")
  if (-not $result.ok) { return $null }
  try { return ($result.output | ConvertFrom-Json).status.state } catch { return $null }
}

function Write-Answer($answer) {
  Write-JsonAtomic (Join-Path $AnswersDir ("{0}.json" -f $answer.id)) $answer
}

function Hide-Active {
  $script:Active = $null
  $form.Hide()
  Update-Tray
}

function Finish-Answer([string]$action, [string]$choice, $keys, [string]$text) {
  if ($null -eq $script:Active -or $script:Busy) { return }
  $request = $script:Active
  $address = [string]$request.address
  if (-not (Test-Address $address)) {
    Write-Answer @{ id = $request.id; address = $address; action = $action; choice = $choice; ok = $false; error = (T "error.address"); at = (Get-Date).ToUniversalTime().ToString("o") }
    Hide-Active
    return
  }
  $script:Busy = $true
  $form.Cursor = [System.Windows.Forms.Cursors]::WaitCursor
  try {
    if ($action -eq "keys") {
      if (-not (Test-Keys $keys)) { throw (T "error.keys") }
      $result = Invoke-Hc (@("keys", $address) + @($keys))
    } elseif ($action -eq "text") {
      $value = ([string]$text).Replace("`r", " ").Replace("`n", " ").Trim()
      if (-not $value) { throw (T "error.empty") }
      if ($value.Length -gt 2000) { throw (T "error.long") }
      $result = Invoke-Hc @("send", "--force", $address, $value)
    } elseif ($action -eq "dismiss") {
      Write-Answer @{ id = $request.id; address = $address; action = "dismiss"; hash = $request.hash; ok = $true; at = (Get-Date).ToUniversalTime().ToString("o") }
      Remove-Item -LiteralPath (Join-Path $QueueDir ("{0}.json" -f $request.id)) -Force -ErrorAction SilentlyContinue
      Write-Log ("dismiss {0} {1}" -f $request.id, $address)
      Hide-Active
      return
    } else {
      throw (T "error.unknown")
    }

    Start-Sleep -Milliseconds 700
    $status = Get-Status $address
    $stillBlocked = ($status -eq "blocked")
    Write-Answer @{
      id = $request.id
      address = $address
      action = $action
      choice = $choice
      keys = @($keys)
      text = if ($action -eq "text") { $text } else { $null }
      hash = $request.hash
      ok = [bool]$result.ok
      error = $result.error
      stillBlocked = $stillBlocked
      status = $status
      at = (Get-Date).ToUniversalTime().ToString("o")
    }
    Remove-Item -LiteralPath (Join-Path $QueueDir ("{0}.json" -f $request.id)) -Force -ErrorAction SilentlyContinue
    Write-Log ("answer {0} {1} {2} ok={3} still={4}" -f $request.id, $address, $choice, $result.ok, $stillBlocked)
    if (-not $result.ok) {
      try { $tray.ShowBalloonTip(5000, (T "popup.failed"), ([string]$result.error), [System.Windows.Forms.ToolTipIcon]::Error) } catch {}
    }
    Hide-Active
  } catch {
    Write-Log ("error {0} {1}" -f $script:Active.id, $_.Exception.Message)
    Write-Answer @{ id = $script:Active.id; address = $address; action = $action; choice = $choice; ok = $false; error = $_.Exception.Message; at = (Get-Date).ToUniversalTime().ToString("o") }
    Hide-Active
  } finally {
    $script:Busy = $false
    $form.Cursor = [System.Windows.Forms.Cursors]::Default
    Update-Tray
  }
}

function Invoke-Option($control) {
  if ($script:Busy -or $null -eq $script:Active -or $null -eq $control.Tag) { return }
  if ($control.Tag.other) {
    $script:OtherKeys = @($control.Tag.keys)
    foreach ($row in @($optionsPanel.Controls)) {
      if ($row -is [HerdrApproval.RowButton]) {
        $row.IsDefault = ($row -eq $control)
        $row.Hint = if ($row.IsDefault) { "Enter" } else { "" }
        $row.Invalidate()
      }
    }
    $script:DefaultRow = $control
    Set-CueBanner (T "popup.placeholderOther")
    $form.Activate()
    $inputBox.Focus()
    return
  }
  $script:OtherKeys = @()
  $keys = @($control.Tag.keys)
  Finish-Answer "keys" ([string]$control.Tag.label) $keys "" | Out-Null
}

function Send-FreeText {
  if ($script:Busy -or $null -eq $script:Active) { return }
  $value = $inputBox.Text
  if (-not $value.Trim()) { return }
  if ($script:Wizard) {
    $q = $script:WizardQuestions[$script:WizardIndex]
    $answer = $script:WizardAnswers[$script:WizardIndex]
    $otherIndex = -1
    for ($i = 0; $i -lt @($q.options).Count; $i++) { if ($q.options[$i].other) { $otherIndex = $i } }
    if ($otherIndex -ge 0) {
      if (-not (@($answer.selected) -contains $otherIndex)) { $answer.selected = @($answer.selected + $otherIndex) }
      $answer.text = $value
      $script:WizardOther = $true
      Update-WizardRows
      Layout-Form
    }
    return
  }
  $otherKeys = @($script:OtherKeys)
  if ($otherKeys.Count -gt 0) {
    $address = [string]$script:Active.address
    $selected = Invoke-Hc (@("keys", $address) + $otherKeys)
    if (-not $selected.ok) {
      try { $tray.ShowBalloonTip(5000, (T "popup.failed"), ([string]$selected.error), [System.Windows.Forms.ToolTipIcon]::Error) } catch {}
      Write-Log ("other-select failed {0} {1}" -f $address, $selected.error)
      return
    }
    Start-Sleep -Milliseconds 120
    $script:OtherKeys = @()
  }
  Finish-Answer "text" $value @() $value | Out-Null
}

function Open-InHerdr {
  if ($null -eq $script:Active) { return }
  if (-not $AppPath) {
    try { $tray.ShowBalloonTip(4000, (T "popup.failed"), (T "error.noApp"), [System.Windows.Forms.ToolTipIcon]::Error) } catch {}
    return
  }
  try {
    & $AppPath do agent.focus --terminal $script:Active.address 2>&1 | Out-Null
    $form.Hide()
  } catch {
    Write-Log ("open-herdr failed: " + $_.Exception.Message)
  }
}

function Refresh-Screen {
  if ($null -eq $script:Active -or $script:Busy) { return }
  $result = Invoke-Hc @("read", $script:Active.address, "--lines", "0", "--json")
  if (-not $result.ok) { return }
  try {
    $payload = $result.output | ConvertFrom-Json
    if ($payload.text) {
      $script:ScreenFull = [string]$payload.text
      $script:ScreenTranslated = $false
      $script:ScreenTranslation = ""
      $screenTransLabel.Text = ""
      $screenBox.Text = Trim-Screen $script:ScreenFull $script:ScreenExpanded
      $screenBox.SelectionStart = $screenBox.TextLength
      $screenBox.ScrollToCaret()
      Update-Texts
      Layout-Form
    }
  } catch {}
}

function Toggle-Screen {
  $script:ScreenExpanded = -not $script:ScreenExpanded
  $termToggle.Text = if ($script:ScreenExpanded) { T "popup.collapse" } else { T "popup.expand" }
  $screenBox.Text = Trim-Screen $script:ScreenFull $script:ScreenExpanded
  if ($script:ScreenExpanded) { $screenBox.SelectionStart = $screenBox.TextLength; $screenBox.ScrollToCaret() }
  Layout-Form
}

function Translate-Screen {
  if ($null -eq $script:Active -or $script:Busy -or -not $script:ScreenFull.Trim()) { return }
  if ($script:ScreenTranslated) {
    $script:ScreenTranslated = $false
    $script:ScreenTranslation = ""
    $screenTransLabel.Text = ""
    Update-Texts
    Layout-Form
    return
  }
  $script:Busy = $true
  $termTranslate.Enabled = $false
  $termTranslate.Text = T "translate.loading"
  $form.Cursor = [System.Windows.Forms.Cursors]::WaitCursor
  [System.Windows.Forms.Application]::DoEvents()
  try {
    $source = Trim-Screen $script:ScreenFull $false
    $result = Translate-Cached $source
    Write-Log ("translate screen lang={0} ok={1} text={2}" -f $script:Lang, $result.ok, ([string]$result.text))
    if ($result.ok) {
      $script:ScreenTranslation = Format-ScreenTranslation ([string]$result.text)
      if (-not $script:ScreenTranslation) { $script:ScreenTranslation = [string]$result.text }
      $script:ScreenTranslated = $true
      $screenTransLabel.Text = $script:ScreenTranslation.Replace("`n", "`r`n")
    } else {
      $termTitle.Text = T "translate.failed"
    }
  } finally {
    $termTranslate.Enabled = $true
    $script:Busy = $false
    $form.Cursor = [System.Windows.Forms.Cursors]::Default
    Update-Texts
    Layout-Form
  }
}

function Translate-Current {
  if ($null -eq $script:Active -or $script:Busy) { return }
  $script:LastActivity = Get-Date
  if ($script:TranslationVisible) {
    $script:TranslationVisible = $false
    Update-OptionLabels
    Update-Texts
    Layout-Form
    return
  }
  $question = [string]$script:Active.question
  $rows = @($optionsPanel.Controls | Where-Object { $_ -is [HerdrApproval.RowButton] -and $null -ne $_.Tag })
  if (-not $question.Trim() -and $rows.Count -eq 0) { return }
  $script:Busy = $true
  $translateButton.Enabled = $false
  $translateButton.Text = T "translate.loading"
  $form.Cursor = [System.Windows.Forms.Cursors]::WaitCursor
  [System.Windows.Forms.Application]::DoEvents()
  try {
    $script:OptionTranslations = @{}
    $provider = ""
    $errors = @()
    $questionResult = $null
    if ($question.Trim()) {
      $questionResult = Translate-Cached $question
      if ($questionResult.ok) { $provider = [string]$questionResult.provider }
      else { $errors += ("question: " + [string]$questionResult.error) }
    }
    foreach ($row in $rows) {
      $original = [string]$row.Tag.original
      if (-not $original.Trim() -or $original -notmatch "[A-Za-z]") { continue }
      $result = Translate-Cached $original
      if ($result.ok) {
        $script:OptionTranslations[$original] = [string]$result.text
        if (-not $provider) { $provider = [string]$result.provider }
      } else {
        $errors += ("option: " + [string]$result.error)
      }
    }
    Write-Log ("translate ok={0} options={1} provider={2} errors={3}" -f ($null -ne $questionResult -and $questionResult.ok), $script:OptionTranslations.Count, $provider, ($errors -join " / "))
    $script:TranslationVisible = $true
    $script:TranslationProvider = $provider
    if ($questionResult -and $questionResult.ok) {
      $script:TranslationText = [string]$questionResult.text
    } elseif ($script:OptionTranslations.Count -gt 0) {
      $script:TranslationText = T "translate.optionsOnly"
    } else {
      $script:TranslationText = (T "translate.failed") + " " + ($errors -join " / ")
    }
    $translationBox.Text = $script:TranslationText.Replace("`r`n", "`n").Replace("`n", "`r`n")
    $translationBox.SelectionStart = 0
    $translationBox.ScrollToCaret()
  } finally {
    $script:Busy = $false
    $translateButton.Enabled = $true
    $form.Cursor = [System.Windows.Forms.Cursors]::Default
  }
  Update-OptionLabels
  Update-Texts
  Layout-Form
}

$translateButton.add_Click({ Translate-Current })
$wizardPrev.add_Click({ Wizard-Prev })
$wizardNext.add_Click({ Wizard-Next })
$termToggle.add_Click({ Toggle-Screen })
$termTranslate.add_Click({ Translate-Screen })
$termRefresh.add_Click({ Refresh-Screen })
$sendButton.add_Click({ Send-FreeText })
$openButton.add_Click({ Open-InHerdr })
$ignoreButton.add_Click({ Finish-Answer "dismiss" (T "popup.ignore") @() "" | Out-Null })
$inputBox.add_KeyDown({
  param($sender, $event)
  if ($event.KeyCode -eq [System.Windows.Forms.Keys]::Enter) {
    $event.SuppressKeyPress = $true
    Send-FreeText
  }
})

# ---------------------------------------------------------------- keyboard

$form.KeyPreview = $true
$form.add_KeyDown({
  param($sender, $event)
  if ($null -eq $script:Active -or $script:Busy) { return }
  if ($script:Wizard -and $form.ActiveControl -ne $inputBox) {
    if ($event.KeyCode -eq [System.Windows.Forms.Keys]::Escape) {
      $form.Hide()
      $event.SuppressKeyPress = $true
      return
    }
    if ($event.KeyCode -eq [System.Windows.Forms.Keys]::Up) { Wizard-MoveCursor -1; $event.SuppressKeyPress = $true; return }
    if ($event.KeyCode -eq [System.Windows.Forms.Keys]::Down) { Wizard-MoveCursor 1; $event.SuppressKeyPress = $true; return }
    if ($event.KeyCode -eq [System.Windows.Forms.Keys]::Left -or ($event.KeyCode -eq [System.Windows.Forms.Keys]::Tab -and $event.Shift)) {
      Wizard-Prev
      $event.SuppressKeyPress = $true
      return
    }
    if ($event.KeyCode -eq [System.Windows.Forms.Keys]::Right -or $event.KeyCode -eq [System.Windows.Forms.Keys]::Tab) {
      Wizard-Next
      $event.SuppressKeyPress = $true
      return
    }
    if ($event.KeyCode -eq [System.Windows.Forms.Keys]::Space) {
      Select-WizardIndex $script:WizardCursor
      $event.SuppressKeyPress = $true
      return
    }
    if ($event.KeyCode -eq [System.Windows.Forms.Keys]::Enter) {
      $selected = @($script:WizardAnswers[$script:WizardIndex].selected)
      if ($selected.Count -gt 0) { Wizard-Next } else { Select-WizardIndex $script:WizardCursor }
      $event.SuppressKeyPress = $true
      return
    }
    $keyChar = [string]([char]$event.KeyCode)
    if ($keyChar -match "^[1-9]$") {
      Select-WizardIndex ([int]$keyChar - 1)
      $event.SuppressKeyPress = $true
      return
    }
    if ($keyChar -eq "T") {
      Translate-Current
      $event.SuppressKeyPress = $true
      return
    }
  }
  if ($form.ActiveControl -eq $inputBox -and $event.KeyCode -ne [System.Windows.Forms.Keys]::Escape) { return }
  if ($event.KeyCode -eq [System.Windows.Forms.Keys]::Escape) {
    $form.Hide()
    $event.SuppressKeyPress = $true
    return
  }
  if ($event.KeyCode -eq [System.Windows.Forms.Keys]::Enter) {
    if ($form.ActiveControl -eq $inputBox) { Send-FreeText }
    elseif ($null -ne $script:DefaultRow) { Invoke-Option $script:DefaultRow }
    $event.SuppressKeyPress = $true
    return
  }
  $keyChar = [string]([char]$event.KeyCode)
  if ($keyChar -eq "T") {
    Translate-Current
    $event.SuppressKeyPress = $true
    return
  }
  if ($keyChar -match "^[1-9]$") {
    foreach ($control in $optionsPanel.Controls) {
      if ($null -eq $control.Tag) { continue }
      $keys = @($control.Tag.keys)
      $position = [int]$control.Tag.index + 1
      if (($keys.Count -gt 0 -and $keys[0] -eq $keyChar) -or [string]$position -eq $keyChar) {
        Invoke-Option $control
        $event.SuppressKeyPress = $true
        return
      }
    }
    foreach ($control in $keyPanel.Controls) {
      if ($null -eq $control.Tag) { continue }
      $keys = @($control.Tag.keys)
      if ($keys.Count -gt 0 -and $keys[0] -eq $keyChar) {
        Invoke-Option $control
        $event.SuppressKeyPress = $true
        return
      }
    }
  }
})

# ---------------------------------------------------------------- tray

$script:TrayIconHandle = [IntPtr]::Zero
function New-TrayIcon([int]$count) {
  $bmp = New-Object System.Drawing.Bitmap 32, 32
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([Drawing.Color]::Transparent)
  $fill = if ($count -gt 0) { $ColBlocked } else { $ColAccent }
  $brush = New-Object System.Drawing.SolidBrush($fill)
  $g.FillEllipse($brush, 2, 2, 28, 28)
  $font = New-Object System.Drawing.Font("Segoe UI", 13, [Drawing.FontStyle]::Bold, [Drawing.GraphicsUnit]::Pixel)
  $white = New-Object System.Drawing.SolidBrush([Drawing.Color]::White)
  $g.DrawString("H", $font, $white, 7, 5)
  if ($count -gt 0) {
    $badge = New-Object System.Drawing.SolidBrush([Drawing.Color]::FromArgb(255, 32, 32, 32))
    $g.FillEllipse($badge, 17, 17, 14, 14)
    $bfont = New-Object System.Drawing.Font("Segoe UI", 9, [Drawing.FontStyle]::Bold, [Drawing.GraphicsUnit]::Pixel)
    $g.DrawString([string][Math]::Min($count, 9), $bfont, $white, 20, 18)
    $badge.Dispose(); $bfont.Dispose()
  }
  $handle = $bmp.GetHicon()
  $icon = [System.Drawing.Icon]::FromHandle($handle)
  if ($script:TrayIconHandle -ne [IntPtr]::Zero) { [void][HerdrWin]::DestroyIcon($script:TrayIconHandle) }
  $script:TrayIconHandle = $handle
  $g.Dispose(); $bmp.Dispose(); $brush.Dispose(); $font.Dispose(); $white.Dispose()
  return $icon
}

$script:TrayCount = -1
$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Icon = New-TrayIcon 0
$tray.Text = T "tray.title"
$tray.Visible = $true
$trayMenu = New-Object System.Windows.Forms.ContextMenuStrip
$menuOpen = New-Object System.Windows.Forms.ToolStripMenuItem((T "tray.open"))
$menuCount = New-Object System.Windows.Forms.ToolStripMenuItem((T "tray.none"))
$menuCount.Enabled = $false
$menuExit = New-Object System.Windows.Forms.ToolStripMenuItem((T "tray.exit"))
[void]$trayMenu.Items.Add($menuOpen)
[void]$trayMenu.Items.Add($menuCount)
[void]$trayMenu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
[void]$trayMenu.Items.Add($menuExit)
$tray.ContextMenuStrip = $trayMenu

function Update-Tray {
  $count = 0
  try { $count = @(Get-ChildItem -LiteralPath $QueueDir -Filter "*.json" -ErrorAction SilentlyContinue).Count } catch {}
  $menuOpen.Text = T "tray.open"
  $menuExit.Text = T "tray.exit"
  $menuCount.Text = if ($count -gt 0) { (T "tray.pending").Replace("{n}", [string]$count) } else { T "tray.none" }
  $tray.Text = if ($count -gt 0) { (T "tray.pending").Replace("{n}", [string]$count) } else { T "tray.title" }
  if ($count -ne $script:TrayCount) {
    $script:TrayCount = $count
    $tray.Icon = New-TrayIcon $count
  }
}

$tray.add_MouseClick({
  param($sender, $event)
  if ($event.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
    if ($null -ne $script:Active) {
      $form.Show()
      $form.Activate()
      $form.TopMost = $true
    } else {
      Update-Tray
      try { $tray.ShowBalloonTip(3000, (T "tray.title"), (T "tray.none"), [System.Windows.Forms.ToolTipIcon]::Info) } catch {}
    }
  }
})
$menuOpen.add_Click({
  if ($null -ne $script:Active) { $form.Show(); $form.Activate() }
})
$menuExit.add_Click({
  $script:Exiting = $true
  $tray.Visible = $false
  $tray.Dispose()
  $form.Close()
  [System.Windows.Forms.Application]::Exit()
})

$form.add_FormClosing({
  param($sender, $event)
  if (-not $script:Exiting) {
    $event.Cancel = $true
    $form.Hide()
  }
})

# ---------------------------------------------------------------- show / loop

function Show-Request($request) {
  if ($null -eq $request) { return }
  $script:Active = $request
  $script:MultiQuestion = [bool]$request.multiQuestion
  $script:Wizard = $false
  $script:WizardQuestions = @($request.questions)
  if ($script:MultiQuestion -and $script:WizardQuestions.Count -ge 2) { $script:Wizard = $true }
  $script:Lang = Resolve-Language ([string]$request.lang)
  $script:OpenKey = Get-OpenKey
  if ($request.options) { $script:DefaultRow = $null }
  $appTitle = Display-App ([string]$request.app)
  $appChip.Value = $appTitle
  $appChip.Width = 0
  $appChip.Visible = $false
  Set-ChipText $spaceChip (T "popup.space") ([string]$request.space)
  Set-ChipText $tabChip (T "popup.tab") ([string]$request.tab)
  Set-ChipText $termChip (T "popup.terminal") ([string]$request.address)
  $titleLabel.Text = $appTitle
  $script:ScreenFull = [string]$request.screen
  $script:ScreenExpanded = $false
  $script:OtherKeys = @()
  if ($script:Wizard) {
    $script:WizardIndex = 0
    $script:WizardAnswers = @()
    foreach ($question in $script:WizardQuestions) {
      $script:WizardAnswers += [pscustomobject]@{ selected = @(); text = "" }
    }
    $script:WizardStarted = $false
  }
  $script:ScreenTranslated = $false
  $script:ScreenTranslation = ""
  $termTitle.Text = T "popup.screen"
  $screenTransLabel.Text = ""
  $script:TranslationVisible = $false
  $script:TranslationText = ""
  $script:TranslationProvider = ""
  $script:OptionTranslations = @{}
  $script:LastActivity = Get-Date
  $script:TranslationError = $null
  $translationBox.Text = ""
  $translationCard.Visible = $false
  $screenBox.Text = Trim-Screen $script:ScreenFull $false
  $inputBox.Text = ""
  Clear-Options
  if ($script:Wizard) {
    Show-Wizard
  } else {
    $options = @($request.options)
    if ($options.Count -gt 0) {
      $index = 0
      foreach ($option in $options) {
        if ($null -eq $option) { continue }
        if (-not (Test-Keys $option.keys)) { continue }
        Add-Row $option $index
        $index++
      }
      if ($index -eq 0 -and $request.kind -ne "text") { Add-GenericKeys }
    } elseif ($request.kind -ne "text") {
      Add-GenericKeys
    }
  }
  Update-OptionLabels
  Update-Texts
  Layout-Form
  $form.Show()
  Layout-Form
  Set-CueBanner
  $form.Activate()
  $form.BringToFront()
  $form.TopMost = $true
  Write-Log ("form visible={0} state={1} bounds={2} handle={3}" -f $form.Visible, $form.WindowState, $form.Bounds, $form.Handle)
  if ($script:Wizard) {
    $form.ActiveControl = $null
  } elseif ($request.kind -eq "text" -and -not $script:MultiQuestion) {
    $form.ActiveControl = $inputBox
    $inputBox.Focus()
  } else {
    $form.ActiveControl = $null
    if ($null -ne $script:DefaultRow) { $script:DefaultRow.Focus() } else { $form.ActiveControl = $null }
  }
  try { [System.Media.SystemSounds]::Exclamation.Play() } catch {}
  Write-Log ("show {0} {1} options={2} lang={3}" -f $request.id, $request.address, $options.Count, $script:Lang)
}

function Write-Heartbeat {
  $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  if ($now - $script:LastBeat -lt 2000) { return }
  $script:LastBeat = $now
  try { Write-JsonAtomic $BeatPath @{ pid = $PID; at = $now; version = "0.2.0" } } catch {}
}

function Get-NextRequest {
  $files = @(Get-ChildItem -LiteralPath $QueueDir -Filter "*.json" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime)
  foreach ($file in $files) {
    $request = Read-Json $file.FullName
    if ($null -eq $request -or -not $request.id -or -not $request.address -or -not (Test-Address ([string]$request.address))) {
      Move-Item -LiteralPath $file.FullName -Destination (Join-Path $BadDir $file.Name) -Force -ErrorAction SilentlyContinue
      continue
    }
    return $request
  }
  return $null
}

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 700
$timer.add_Tick({
  if ($script:Busy) { return }
  try {
    Write-Heartbeat
    if (Test-Path -LiteralPath $StopPath) {
      Remove-Item -LiteralPath $StopPath -Force -ErrorAction SilentlyContinue
      $script:Exiting = $true
      $tray.Visible = $false
      $tray.Dispose()
      $form.Close()
      [System.Windows.Forms.Application]::Exit()
      return
    }
    if (Test-Path -LiteralPath $WakePath) {
      Remove-Item -LiteralPath $WakePath -Force -ErrorAction SilentlyContinue
      if ($null -ne $script:Active) { $form.Show(); $form.Activate() }
    }
    if ($null -ne $script:Active) {
      $path = Join-Path $QueueDir ("{0}.json" -f $script:Active.id)
      if (-not (Test-Path -LiteralPath $path)) { Hide-Active }
    }
    if ($null -eq $script:Active) {
      $next = Get-NextRequest
      if ($null -ne $next) { Show-Request $next }
    }
    if ($null -ne $script:Active -or (Get-ChildItem -LiteralPath $QueueDir -Filter "*.json" -ErrorAction SilentlyContinue)) {
      $script:LastActivity = Get-Date
    } elseif ($script:IdleExitSeconds -gt 0 -and ((Get-Date) - $script:LastActivity).TotalSeconds -gt $script:IdleExitSeconds) {
      Write-Log ("idle exit after {0}s" -f $script:IdleExitSeconds)
      Remove-Item -LiteralPath $BeatPath -Force -ErrorAction SilentlyContinue
      $script:Exiting = $true
      $tray.Visible = $false
      $tray.Dispose()
      $form.Close()
      [System.Windows.Forms.Application]::Exit()
      return
    }
    Update-WaitLabel
    Update-Tray
  } catch {
    Write-Log ("tick: " + $_.Exception.Message)
  }
})

Write-Log ("start pid={0} home={1} hc={2} theme={3} lang={4}" -f $PID, $AppHome, $HcPath, $themeName, $script:Lang)
Write-Heartbeat
Update-Tray
$timer.Start()
[System.Windows.Forms.Application]::Run()
$timer.Stop()
try { $mutex.ReleaseMutex() } catch {}
