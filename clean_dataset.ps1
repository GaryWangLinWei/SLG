# 配置
$datasetDir = "C:\Users\54459\Desktop\YOLO_v3_hero"
$yamlPath = Join-Path $datasetDir "dataset.yaml"
$labelDirs = @(
    Join-Path $datasetDir "labels\train",
    Join-Path $datasetDir "labels\val"
)

Write-Host "=== 开始清理数据集 ===" -ForegroundColor Green

# 1. 修改 dataset.yaml
Write-Host "`n[1/3] 修改 dataset.yaml (nc: 3 -> 2)"
$yamlContent = Get-Content $yamlPath -Raw
$yamlContent = $yamlContent -replace "nc: 3", "nc: 2"
$yamlContent = $yamlContent -replace "names:\s*\r?\n\s*0: gem\s*\r?\n\s*1: tieshou\s*\r?\n\s*2: hero", "names:`n  0: gem`n  1: tieshou"
Set-Content -Path $yamlPath -Value $yamlContent -NoNewline
Write-Host "  完成"

# 2. 清理标注文件（只删除 class 2）
Write-Host "`n[2/3] 清理标注文件（删除 class 2，保留 0 和 1）..."
$totalRemoved = 0
$totalFiles = 0

foreach ($dir in $labelDirs) {
    $files = Get-ChildItem (Join-Path $dir "*.txt")
    foreach ($f in $files) {
        $totalFiles++
        $lines = Get-Content $f.FullName
        $originalCount = $lines.Count
        $newLines = $lines | Where-Object { $_ -match "^[01]\s+" }
        $removed = $originalCount - $newLines.Count

        if ($removed -gt 0) {
            $totalRemoved += $removed
            Set-Content -Path $f.FullName -Value $newLines
        }
    }
}

Write-Host "  处理了 $totalFiles 个标签文件"
Write-Host "  删除了 $totalRemoved 个非 gem 标注"

# 3. 统计结果
Write-Host "`n[3/3] 统计标注数量..."
$gemCount = 0
$tieshouCount = 0
foreach ($dir in $labelDirs) {
    $files = Get-ChildItem (Join-Path $dir "*.txt")
    foreach ($f in $files) {
        $lines = Get-Content $f.FullName
        foreach ($line in $lines) {
            if ($line -match "^0\s+") { $gemCount++ }
            if ($line -match "^1\s+") { $tieshouCount++ }
        }
    }
}

Write-Host "`n=== 完成 ===" -ForegroundColor Green
Write-Host "  gem (class 0): $gemCount 个"
Write-Host "  tieshou (class 1): $tieshouCount 个"
Write-Host "  数据集配置已更新为 2 类别"
