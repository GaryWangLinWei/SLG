"""将 bigGem 图集复制为标准 YOLO 数据集，固定种子 8:2 划分，单类 big_gem。"""
import os, shutil, random
from pathlib import Path

random.seed(42)

SRC_IMG = Path(r"C:\Users\54459\Desktop\bigGem\image")
SRC_LBL = Path(r"C:\Users\54459\Desktop\bigGem\label")
DST = Path(r"C:\Users\54459\Desktop\bigGem_yolo")

def collect():
    samples = []
    for img in SRC_IMG.iterdir():
        if img.suffix.lower() not in {'.png', '.jpg', '.jpeg'}:
            continue
        lbl = SRC_LBL / f"{img.stem}.txt"
        if not lbl.exists():
            raise SystemExit(f"缺少标签: {img.name}")
        # 校验标签
        for line in lbl.read_text().splitlines():
            parts = line.strip().split()
            if len(parts) != 5:
                raise SystemExit(f"标签列数异常: {lbl.name} -> {line}")
            cls = int(parts[0])
            if cls != 0:
                raise SystemExit(f"非 0 类别: {lbl.name} -> cls={cls}")
            vals = [float(x) for x in parts[1:]]
            if any(v < 0 or v > 1 for v in vals):
                raise SystemExit(f"坐标越界: {lbl.name} -> {vals}")
        samples.append((img, lbl))
    return samples

samples = collect()
print(f"有效样本: {len(samples)}")

random.shuffle(samples)
n_val = max(1, int(len(samples) * 0.2))
val = samples[:n_val]
train = samples[n_val:]

for split, pairs in [("train", train), ("val", val)]:
    (DST / "images" / split).mkdir(parents=True, exist_ok=True)
    (DST / "labels" / split).mkdir(parents=True, exist_ok=True)
    for img, lbl in pairs:
        shutil.copy2(img, DST / "images" / split / img.name)
        shutil.copy2(lbl, DST / "labels" / split / lbl.name)

print(f"train: {len(train)}, val: {len(val)}")

yaml = f"""path: {DST.as_posix()}
train: images/train
val: images/val
nc: 1
names:
  0: big_gem
"""
(DST / "dataset.yaml").write_text(yaml)
print(f"[OK] dataset.yaml -> {DST / 'dataset.yaml'}")
