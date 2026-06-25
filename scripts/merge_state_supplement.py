"""把补充样本(平铺 images/labels)按 8:2 并入现有 state 数据集的 train/val。"""
import shutil
import random
from pathlib import Path

random.seed(42)

STATE = Path(r"C:\Users\54459\Desktop\state")
SUP = Path(r"C:\Users\54459\Desktop\补充")

img_train = STATE / "images" / "train"
img_val = STATE / "images" / "val"
lbl_train = STATE / "labels" / "train"
lbl_val = STATE / "labels" / "val"

# 收集补充样本（图片 + 同名标签）
samples = []
for img in sorted((SUP / "images").iterdir()):
    if img.suffix.lower() not in {".png", ".jpg", ".jpeg"}:
        continue
    lbl = SUP / "labels" / f"{img.stem}.txt"
    if not lbl.exists():
        print(f"⚠️ 缺少标签: {img.name}")
        continue
    samples.append((img, lbl))

random.shuffle(samples)
n_val = max(1, int(len(samples) * 0.2))
val = samples[:n_val]
train = samples[n_val:]
print(f"补充: {len(samples)} 张 → train {len(train)} / val {len(val)}")

def copy(pairs, idst, ldst):
    for img, lbl in pairs:
        dst_img = idst / img.name
        if dst_img.exists():
            print(f"⚠️ 重名跳过: {img.name}")
            continue
        shutil.copy2(img, dst_img)
        shutil.copy2(lbl, ldst / lbl.name)

copy(train, img_train, lbl_train)
copy(val, img_val, lbl_val)

# 清掉旧 cache
for c in [lbl_train.parent / "train.cache", lbl_val.parent / "val.cache"]:
    if c.exists():
        c.unlink()
        print(f"删除缓存: {c.name}")

print(f"\n合并后 train: {len(list(img_train.glob('*')))} 张  val: {len(list(img_val.glob('*')))} 张")
