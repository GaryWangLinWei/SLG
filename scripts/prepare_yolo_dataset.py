"""
合并 140 张原数据(只标了 gem) + 70 张新数据(gem + tieshou),
按 8:2 划分 train/val,输出到 YOLO_v2 目录。
"""
import os
import shutil
import random
from pathlib import Path

random.seed(42)

# 源目录
ORIG_IMG = Path(r"C:\Users\54459\Desktop\YOLO\image")
ORIG_LBL = Path(r"C:\Users\54459\Desktop\YOLO\label")
NEW_IMG = Path(r"C:\Users\54459\Desktop\补充\images")
NEW_LBL = Path(r"C:\Users\54459\Desktop\补充\labels")

# 目标目录
DST = Path(r"C:\Users\54459\Desktop\YOLO_v2")
DST_IMG_TRAIN = DST / "images" / "train"
DST_IMG_VAL = DST / "images" / "val"
DST_LBL_TRAIN = DST / "labels" / "train"
DST_LBL_VAL = DST / "labels" / "val"

# 收集所有样本(图片 stem)
def collect_samples(img_dir, lbl_dir):
    samples = []
    for img in img_dir.iterdir():
        if img.suffix.lower() not in {'.png', '.jpg', '.jpeg'}:
            continue
        lbl = lbl_dir / f"{img.stem}.txt"
        if not lbl.exists():
            print(f"⚠️  缺少标签: {img.name}")
            continue
        samples.append((img, lbl))
    return samples

orig_samples = collect_samples(ORIG_IMG, ORIG_LBL)
new_samples = collect_samples(NEW_IMG, NEW_LBL)

print(f"原数据: {len(orig_samples)} 张")
print(f"新数据: {len(new_samples)} 张")

# 打乱并划分(每个数据源单独 8:2,保证 val 集两类都有)
def split(samples, ratio=0.2):
    samples = list(samples)
    random.shuffle(samples)
    n_val = max(1, int(len(samples) * ratio))
    return samples[n_val:], samples[:n_val]

orig_train, orig_val = split(orig_samples)
new_train, new_val = split(new_samples)

train_samples = orig_train + new_train
val_samples = orig_val + new_val

print(f"\nTrain: {len(train_samples)} 张")
print(f"Val:   {len(val_samples)} 张")

# 复制文件
def copy_pair(samples, img_dst, lbl_dst):
    for img, lbl in samples:
        shutil.copy2(img, img_dst / img.name)
        shutil.copy2(lbl, lbl_dst / lbl.name)

copy_pair(train_samples, DST_IMG_TRAIN, DST_LBL_TRAIN)
copy_pair(val_samples, DST_IMG_VAL, DST_LBL_VAL)

# 统计 class 分布
def count_classes(lbl_dir):
    cnt = {0: 0, 1: 0}
    for f in lbl_dir.iterdir():
        if f.suffix == '.txt':
            for line in f.read_text().strip().split('\n'):
                if line.strip():
                    cls = int(line.split()[0])
                    cnt[cls] = cnt.get(cls, 0) + 1
    return cnt

print(f"\nTrain 类别分布: {count_classes(DST_LBL_TRAIN)}")
print(f"Val   类别分布: {count_classes(DST_LBL_VAL)}")

# 写 dataset.yaml
yaml_content = f"""# Auto-generated YOLO dataset
path: {DST.as_posix()}
train: images/train
val: images/val

nc: 2
names:
  0: gem
  1: tieshou
"""
(DST / "dataset.yaml").write_text(yaml_content, encoding='utf-8')
print(f"\n✅ dataset.yaml 已写入 {DST / 'dataset.yaml'}")
