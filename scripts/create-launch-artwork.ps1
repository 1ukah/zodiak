# Shown before Chromium starts; no percentage is implied by the activity track.
Add-Type -AssemblyName System.Drawing
$bitmap = New-Object System.Drawing.Bitmap 360,220
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#14151a'))
$accent = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#a8a0ff'))
$track = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#30303c'))
$pen = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml('#a8a0ff')),2
$graphics.DrawRectangle($pen,166,56,28,19)
$graphics.DrawLine($pen,180,75,180,81)
$graphics.DrawLine($pen,173,82,187,82)
$graphics.FillRectangle($track,60,151,240,3)
for ($segment = 0; $segment -lt 8; $segment++) { $graphics.FillRectangle($accent,(60 + $segment * 30),151,16,3) }
$border = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml('#34323f')),1
$graphics.DrawRectangle($border,0,0,359,219)
$bitmap.Save((Join-Path $PSScriptRoot '../build/launch-splash.bmp'),[System.Drawing.Imaging.ImageFormat]::Bmp)
$border.Dispose(); $pen.Dispose(); $accent.Dispose(); $track.Dispose(); $graphics.Dispose(); $bitmap.Dispose()

# Matching application / taskbar icon, also embedded into the portable executable.
$iconBitmap = New-Object System.Drawing.Bitmap 256,256
$iconGraphics = [System.Drawing.Graphics]::FromImage($iconBitmap)
$iconGraphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$iconGraphics.Clear([System.Drawing.Color]::Transparent)
$shape = New-Object System.Drawing.Drawing2D.GraphicsPath
$shape.AddArc(8,8,88,88,180,90); $shape.AddArc(160,8,88,88,270,90)
$shape.AddArc(160,160,88,88,0,90); $shape.AddArc(8,160,88,88,90,90); $shape.CloseFigure()
$iconBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#a8a0ff'))
$iconGraphics.FillPath($iconBrush,$shape)
$iconPen = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml('#17132b')),12
$iconPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
$iconGraphics.DrawRectangle($iconPen,59,65,138,100)
$iconGraphics.DrawLine($iconPen,128,168,128,192)
$iconGraphics.DrawLine($iconPen,98,195,158,195)
$iconBitmap.Save((Join-Path $PSScriptRoot '../build/app-icon.png'),[System.Drawing.Imaging.ImageFormat]::Png)
$iconPng = [System.IO.File]::ReadAllBytes((Join-Path $PSScriptRoot '../build/app-icon.png'))
$iconStream = [System.IO.File]::Create((Join-Path $PSScriptRoot '../build/icon.ico'))
$iconWriter = New-Object System.IO.BinaryWriter $iconStream
$iconWriter.Write([uint16]0); $iconWriter.Write([uint16]1); $iconWriter.Write([uint16]1)
$iconWriter.Write([byte]0); $iconWriter.Write([byte]0); $iconWriter.Write([byte]0); $iconWriter.Write([byte]0)
$iconWriter.Write([uint16]1); $iconWriter.Write([uint16]32); $iconWriter.Write([uint32]$iconPng.Length); $iconWriter.Write([uint32]22)
$iconWriter.Write($iconPng); $iconWriter.Dispose(); $iconStream.Dispose()
$iconPen.Dispose(); $iconBrush.Dispose(); $shape.Dispose(); $iconGraphics.Dispose(); $iconBitmap.Dispose()
