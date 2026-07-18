import os
import cv2
from ultralytics import YOLO

# 配置
MODEL_PATH = r"D:\SLG\plugins\rok\models\gem.onnx"
INPUT_DIR = r"C:\Users\54459\Desktop\afternoongem\image"
OUTPUT_DIR = r"C:\Users\54459\Desktop\afternoongem\output_v2"
CONF_THRESHOLD = 0.35

# 创建输出目录
os.makedirs(OUTPUT_DIR, exist_ok=True)

# 加载模型
model = YOLO(MODEL_PATH)
print(f"Model loaded: {MODEL_PATH}")

# 获取前6张图片
image_files = sorted([f for f in os.listdir(INPUT_DIR) if f.endswith('.png')])[:6]
print(f"Found {len(image_files)} images")

# 处理每张图片
for img_file in image_files:
    img_path = os.path.join(INPUT_DIR, img_file)
    img = cv2.imread(img_path)

    # 运行检测
    results = model(img_path, conf=CONF_THRESHOLD, verbose=False)
    result = results[0]

    # 画框
    gem_count = 0
    for box in result.boxes:
        # 获取框坐标
        x1, y1, x2, y2 = box.xyxy[0].cpu().numpy().astype(int)
        conf = box.conf[0].cpu().item()
        cls = int(box.cls[0].cpu().item())

        # 只画宝石 (class 0)
        if cls == 0:
            gem_count += 1
            # 红色框
            cv2.rectangle(img, (x1, y1), (x2, y2), (0, 0, 255), 2)
            # 背景矩形
            label = f"{conf:.2f}"
            (label_w, label_h), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 2)
            cv2.rectangle(img, (x1, y1 - label_h - 5), (x1 + label_w, y1), (0, 0, 255), -1)
            cv2.putText(img, label, (x1, y1 - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 2)

    # 保存结果
    out_path = os.path.join(OUTPUT_DIR, f"det_{img_file}")
    cv2.imwrite(out_path, img)
    print(f"  {img_file}: {gem_count} gems detected, saved to {out_path}")

print("\nDone! Results saved to:", OUTPUT_DIR)
