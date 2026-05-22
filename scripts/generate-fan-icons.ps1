Add-Type -AssemblyName System.Drawing

function New-RoundedRectPath {
  param(
    [float]$X,
    [float]$Y,
    [float]$W,
    [float]$H,
    [float]$R
  )

  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $d = $R * 2
  $path.AddArc($X, $Y, $d, $d, 180, 90)
  $path.AddArc($X + $W - $d, $Y, $d, $d, 270, 90)
  $path.AddArc($X + $W - $d, $Y + $H - $d, $d, $d, 0, 90)
  $path.AddArc($X, $Y + $H - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  return $path
}

function New-BladePath {
  param([float]$Scale)

  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $points = [System.Drawing.PointF[]]@(
    [System.Drawing.PointF]::new(0 * $Scale, -40 * $Scale),
    [System.Drawing.PointF]::new(62 * $Scale, -128 * $Scale),
    [System.Drawing.PointF]::new(150 * $Scale, -142 * $Scale),
    [System.Drawing.PointF]::new(176 * $Scale, -96 * $Scale),
    [System.Drawing.PointF]::new(199 * $Scale, -56 * $Scale),
    [System.Drawing.PointF]::new(157 * $Scale, -17 * $Scale),
    [System.Drawing.PointF]::new(68 * $Scale, -8 * $Scale),
    [System.Drawing.PointF]::new(37 * $Scale, -5 * $Scale),
    [System.Drawing.PointF]::new(16 * $Scale, -17 * $Scale),
    [System.Drawing.PointF]::new(0 * $Scale, -40 * $Scale)
  )
  $path.AddBeziers($points)
  $path.CloseFigure()
  return $path
}

function Save-FanPng {
  param(
    [string]$Path,
    [int]$Width,
    [int]$Height
  )

  $size = [Math]::Min($Width, $Height)
  $scale = $size / 512.0
  $bmp = [System.Drawing.Bitmap]::new($Width, $Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)

  $ox = ($Width - $size) / 2.0
  $oy = ($Height - $size) / 2.0
  $rectX = $ox + 32 * $scale
  $rectY = $oy + 32 * $scale
  $rectW = 448 * $scale
  $corner = 104 * $scale

  $bgPath = New-RoundedRectPath $rectX $rectY $rectW $rectW $corner
  $bgBrush = [System.Drawing.Drawing2D.PathGradientBrush]::new($bgPath)
  $bgBrush.CenterPoint = [System.Drawing.PointF]::new($ox + 256 * $scale, $oy + 220 * $scale)
  $bgBrush.CenterColor = [System.Drawing.Color]::FromArgb(255, 42, 42, 45)
  $bgBrush.SurroundColors = [System.Drawing.Color[]]@([System.Drawing.Color]::FromArgb(255, 0, 0, 0))
  $g.FillPath($bgBrush, $bgPath)

  $cx = $ox + 256 * $scale
  $cy = $oy + 256 * $scale
  $glowPath = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $glowPath.AddEllipse($cx - 196 * $scale, $cy - 196 * $scale, 392 * $scale, 392 * $scale)
  $glow = [System.Drawing.Drawing2D.PathGradientBrush]::new($glowPath)
  $glow.CenterColor = [System.Drawing.Color]::FromArgb(150, 255, 38, 49)
  $glow.SurroundColors = [System.Drawing.Color[]]@([System.Drawing.Color]::FromArgb(0, 229, 9, 20))
  $g.FillPath($glow, $glowPath)

  $ringPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(160, 229, 9, 20), [Math]::Max(2, 18 * $scale))
  $g.DrawEllipse($ringPen, $cx - 166 * $scale, $cy - 166 * $scale, 332 * $scale, 332 * $scale)

  for ($i = 0; $i -lt 5; $i++) {
    $state = $g.Save()
    $g.TranslateTransform($cx, $cy)
    $g.RotateTransform($i * 72)
    $blade = New-BladePath $scale
    $bladeBrush = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
      [System.Drawing.PointF]::new(-18 * $scale, -138 * $scale),
      [System.Drawing.PointF]::new(190 * $scale, -8 * $scale),
      [System.Drawing.Color]::FromArgb(255, 255, 69, 80),
      [System.Drawing.Color]::FromArgb(255, 68, 0, 8)
    )
    $g.FillPath($bladeBrush, $blade)
    $edgePen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(105, 255, 141, 147), [Math]::Max(1, 2.2 * $scale))
    $g.DrawPath($edgePen, $blade)
    $bladeBrush.Dispose()
    $edgePen.Dispose()
    $blade.Dispose()
    $g.Restore($state)
  }

  $hubOuter = [System.Drawing.RectangleF]::new($cx - 64 * $scale, $cy - 64 * $scale, 128 * $scale, 128 * $scale)
  $hubOuterBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 8, 9, 11))
  $hubPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 229, 9, 20), [Math]::Max(2, 10 * $scale))
  $g.FillEllipse($hubOuterBrush, $hubOuter)
  $g.DrawEllipse($hubPen, $hubOuter)

  $hubInner = [System.Drawing.RectangleF]::new($cx - 38 * $scale, $cy - 38 * $scale, 76 * $scale, 76 * $scale)
  $metal = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
    [System.Drawing.PointF]::new($cx - 30 * $scale, $cy - 34 * $scale),
    [System.Drawing.PointF]::new($cx + 35 * $scale, $cy + 34 * $scale),
    [System.Drawing.Color]::FromArgb(255, 245, 246, 249),
    [System.Drawing.Color]::FromArgb(255, 55, 58, 66)
  )
  $g.FillEllipse($metal, $hubInner)

  $highlight = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(210, 255, 255, 255))
  $g.FillEllipse($highlight, $cx - 23 * $scale, $cy - 25 * $scale, 18 * $scale, 18 * $scale)

  $highlight.Dispose()
  $metal.Dispose()
  $hubPen.Dispose()
  $hubOuterBrush.Dispose()
  $ringPen.Dispose()
  $glow.Dispose()
  $glowPath.Dispose()
  $bgBrush.Dispose()
  $bgPath.Dispose()
  $g.Dispose()

  $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

function Get-PngSize {
  param([string]$Path)
  $img = [System.Drawing.Image]::FromFile($Path)
  try {
    return @{ Width = $img.Width; Height = $img.Height }
  } finally {
    $img.Dispose()
  }
}

function New-FanIco {
  param([string]$Path)

  $sizes = @(16, 32, 48, 64, 128, 256)
  $images = @()
  foreach ($size in $sizes) {
    $stream = [System.IO.MemoryStream]::new()
    $tmp = [System.IO.Path]::GetTempFileName()
    Save-FanPng $tmp $size $size
    $bytes = [System.IO.File]::ReadAllBytes($tmp)
    [System.IO.File]::Delete($tmp)
    $images += ,@{ Size = $size; Bytes = $bytes }
  }

  $fs = [System.IO.File]::Open($Path, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
  $bw = [System.IO.BinaryWriter]::new($fs)
  $bw.Write([UInt16]0)
  $bw.Write([UInt16]1)
  $bw.Write([UInt16]$images.Count)
  $offset = 6 + 16 * $images.Count
  foreach ($image in $images) {
    $sizeByte = if ($image.Size -eq 256) { 0 } else { [byte]$image.Size }
    $bw.Write([byte]$sizeByte)
    $bw.Write([byte]$sizeByte)
    $bw.Write([byte]0)
    $bw.Write([byte]0)
    $bw.Write([UInt16]1)
    $bw.Write([UInt16]32)
    $bw.Write([UInt32]$image.Bytes.Length)
    $bw.Write([UInt32]$offset)
    $offset += $image.Bytes.Length
  }
  foreach ($image in $images) {
    $bw.Write([byte[]]$image.Bytes)
  }
  $bw.Dispose()
  $fs.Dispose()
}

$pngTargets = Get-ChildItem -Path "src-tauri/icons" -Filter "*.png" -File | ForEach-Object {
  $size = Get-PngSize $_.FullName
  [pscustomobject]@{ Path = $_.FullName; Width = $size.Width; Height = $size.Height }
}

foreach ($target in $pngTargets) {
  Save-FanPng $target.Path $target.Width $target.Height
}

if (Test-Path "src/assets/icon.png") {
  $size = Get-PngSize "src/assets/icon.png"
  Save-FanPng "src/assets/icon.png" $size.Width $size.Height
}

if (Test-Path "app-icon.png") {
  $size = Get-PngSize "app-icon.png"
  Save-FanPng "app-icon.png" $size.Width $size.Height
}

New-FanIco "src-tauri/icons/icon.ico"

$summary = @(
  $pngTargets | Select-Object @{Name="File";Expression={$_.Path}}, Width, Height
  [pscustomobject]@{ File = (Resolve-Path "src/assets/icon.png").Path; Width = (Get-PngSize "src/assets/icon.png").Width; Height = (Get-PngSize "src/assets/icon.png").Height }
  [pscustomobject]@{ File = (Resolve-Path "app-icon.png").Path; Width = (Get-PngSize "app-icon.png").Width; Height = (Get-PngSize "app-icon.png").Height }
)

$summary | Format-Table -AutoSize
Write-Host "Generated src-tauri/icons/icon.ico"
