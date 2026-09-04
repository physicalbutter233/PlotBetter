param(
  [string]$SourcePng = (Join-Path $PSScriptRoot '..\assets\tray-icon.png'),
  [string]$OutputIco = (Join-Path $PSScriptRoot '..\assets\PlotBetter.ico')
)

Add-Type -AssemblyName System.Drawing

$SourcePng = (Resolve-Path -LiteralPath $SourcePng).Path
$OutputIco = [System.IO.Path]::GetFullPath($OutputIco)

$source = [System.Drawing.Bitmap]::FromFile($SourcePng)
$sizes = @(16, 24, 32, 48, 64, 128, 256)
$images = @()

try {
  foreach ($size in $sizes) {
    $bitmap = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
      $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $graphics.Clear([System.Drawing.Color]::Transparent)
      $graphics.DrawImage($source, 0, 0, $size, $size)
    } finally {
      $graphics.Dispose()
    }

    $stream = New-Object System.IO.MemoryStream
    try {
      $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
      $images += @{
        Size  = $size
        Bytes = $stream.ToArray()
      }
    } finally {
      $stream.Dispose()
      $bitmap.Dispose()
    }
  }
} finally {
  $source.Dispose()
}

$output = New-Object System.IO.MemoryStream
$writer = New-Object System.IO.BinaryWriter($output)
try {
  $writer.Write([uint16]0)
  $writer.Write([uint16]1)
  $writer.Write([uint16]$images.Count)

  $headerSize = 6 + (16 * $images.Count)
  $offset = $headerSize
  foreach ($image in $images) {
    $dimension = [byte]$(if ($image.Size -ge 256) { 0 } else { $image.Size })
    $writer.Write($dimension)
    $writer.Write($dimension)
    $writer.Write([byte]0)
    $writer.Write([byte]0)
    $writer.Write([uint16]1)
    $writer.Write([uint16]32)
    $writer.Write([uint32]$image.Bytes.Length)
    $writer.Write([uint32]$offset)
    $offset += $image.Bytes.Length
  }

  foreach ($image in $images) {
    $writer.Write($image.Bytes)
  }

  $writer.Flush()
  [System.IO.File]::WriteAllBytes($OutputIco, $output.ToArray())
  Write-Host "Wrote $OutputIco ($($images.Count) sizes)"
} finally {
  $writer.Dispose()
  $output.Dispose()
}
