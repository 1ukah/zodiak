Add-Type -AssemblyName System.Drawing
$fallbackIconPath = Join-Path $PSScriptRoot '../build/icon.png'

function Draw-ContainedImage([System.Drawing.Graphics]$graphics, [System.Drawing.Image]$image, [int]$x, [int]$y, [int]$width, [int]$height) {
  $scale = [Math]::Min($width / $image.Width, $height / $image.Height)
  $drawWidth = [int][Math]::Round($image.Width * $scale)
  $drawHeight = [int][Math]::Round($image.Height * $scale)
  $drawX = $x + [int][Math]::Round(($width - $drawWidth) / 2)
  $drawY = $y + [int][Math]::Round(($height - $drawHeight) / 2)
  $graphics.DrawImage($image, $drawX, $drawY, $drawWidth, $drawHeight)
}

function Convert-ToPngBytes([System.Drawing.Bitmap]$bitmap) {
  $stream = New-Object System.IO.MemoryStream
  $bitmap.Save($stream,[System.Drawing.Imaging.ImageFormat]::Png)
  $bytes = $stream.ToArray()
  $stream.Dispose()
  return $bytes
}

function Write-Icon([string]$iconFileName, [byte[]]$iconPng) {
  $iconStream = [System.IO.File]::Create((Join-Path $PSScriptRoot "../build/$iconFileName"))
  $iconWriter = New-Object System.IO.BinaryWriter $iconStream
  $iconWriter.Write([uint16]0); $iconWriter.Write([uint16]1); $iconWriter.Write([uint16]1)
  $iconWriter.Write([byte]0); $iconWriter.Write([byte]0); $iconWriter.Write([byte]0); $iconWriter.Write([byte]0)
  $iconWriter.Write([uint16]1); $iconWriter.Write([uint16]32); $iconWriter.Write([uint32]$iconPng.Length); $iconWriter.Write([uint32]22)
  $iconWriter.Write($iconPng); $iconWriter.Dispose(); $iconStream.Dispose()
}

# The executable keeps the supplied white mark.
$sourceIcon = [System.Drawing.Image]::FromFile($fallbackIconPath)
$iconBitmap = New-Object System.Drawing.Bitmap 256,256
$iconGraphics = [System.Drawing.Graphics]::FromImage($iconBitmap)
$iconGraphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$iconGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$iconGraphics.Clear([System.Drawing.Color]::Transparent)
Draw-ContainedImage $iconGraphics $sourceIcon 0 0 256 256
$iconPng = Convert-ToPngBytes $iconBitmap

$installerBitmap = New-Object System.Drawing.Bitmap 256,256
$installerGraphics = [System.Drawing.Graphics]::FromImage($installerBitmap)
$installerGraphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$installerGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$installerGraphics.Clear([System.Drawing.Color]::Transparent)
Draw-ContainedImage $installerGraphics $sourceIcon 0 0 256 256
for ($y = 0; $y -lt $installerBitmap.Height; $y++) {
  for ($x = 0; $x -lt $installerBitmap.Width; $x++) {
    $alpha = $installerBitmap.GetPixel($x, $y).A
    if ($alpha -gt 0) { $installerBitmap.SetPixel($x, $y, [System.Drawing.Color]::FromArgb($alpha, 0, 0, 0)) }
  }
}
Write-Icon 'icon.ico' $iconPng

# The assisted NSIS wizard has a white header. Give it a separate black logo
# while keeping the setup executable's icon white.
$headerBitmap = New-Object System.Drawing.Bitmap 150,57
$headerGraphics = [System.Drawing.Graphics]::FromImage($headerBitmap)
$headerGraphics.Clear([System.Drawing.Color]::White)
$headerGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
$headerGraphics.DrawImage($installerBitmap, 106, 8, 40, 40)
$headerBitmap.Save((Join-Path $PSScriptRoot '../build/installerHeader.bmp'),[System.Drawing.Imaging.ImageFormat]::Bmp)
$headerGraphics.Dispose(); $headerBitmap.Dispose(); $installerGraphics.Dispose(); $installerBitmap.Dispose(); $iconGraphics.Dispose(); $iconBitmap.Dispose(); $sourceIcon.Dispose()
