"""bigGem YOLOv8n 训练脚本。先试训 5 epoch 验证链路，再正式训练。"""
import sys
from ultralytics import YOLO

DATASET = r"C:\Users\54459\Desktop\bigGem_yolo\dataset.yaml"
PROJECT = r"C:\Users\54459\Desktop\bigGem_yolo\runs"
NAME = "big_gem"

def train(epochs: int, trial: bool = False):
    model = YOLO("yolov8n.pt")
    results = model.train(
        data=DATASET,
        epochs=epochs,
        imgsz=640,
        project=PROJECT,
        name=NAME,
        exist_ok=True,
        seed=42,
        patience=20 if not trial else 5,
        device="cpu",
        verbose=True,
        plots=True,
        save=True,
        val=True,
    )
    return results

if __name__ == "__main__":
    trial = "--trial" in sys.argv
    epochs = 5 if trial else 300
    print(f"Training mode: {'trial' if trial else 'full'} ({epochs} epochs)")
    results = train(epochs, trial=trial)
    print(f"Done. best.pt metrics: {results.results_dict}")
