"""THROWAWAY PROTOTYPE: verify Buffalo_l + BiSeNet-R18 CPU inference."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from pathlib import Path

import cv2
import numpy as np
import torch
from insightface.app import FaceAnalysis
from PIL import Image
from torchvision import transforms

sys.path.insert(0, "/opt/face-parsing")
import resnet as face_parsing_resnet  # noqa: E402
from model import BiSeNet  # noqa: E402


FACE_REGION_CLASSES = {1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13}
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=Path("/input"))
    parser.add_argument("--output", type=Path, default=Path("/output"))
    parser.add_argument("--models", type=Path, default=Path("/models"))
    parser.add_argument("--limit", type=int, default=5)
    parser.add_argument("--det-thresh", type=float, default=0.10)
    return parser.parse_args()


def expanded_square(bbox: np.ndarray, width: int, height: int, scale: float = 1.35) -> tuple[int, int, int, int]:
    x1, y1, x2, y2 = (float(value) for value in bbox[:4])
    side = max(x2 - x1, y2 - y1) * scale
    cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
    left = max(0, int(round(cx - side / 2)))
    top = max(0, int(round(cy - side / 2)))
    right = min(width, int(round(cx + side / 2)))
    bottom = min(height, int(round(cy + side / 2)))
    return left, top, right, bottom


def face_mask(parser: BiSeNet, image_bgr: np.ndarray, bbox: np.ndarray, preprocess: transforms.Compose) -> np.ndarray:
    height, width = image_bgr.shape[:2]
    left, top, right, bottom = expanded_square(bbox, width, height)
    crop_bgr = image_bgr[top:bottom, left:right]
    crop_rgb = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2RGB)
    tensor = preprocess(Image.fromarray(crop_rgb)).unsqueeze(0)
    with torch.inference_mode():
        logits = parser(tensor)[0]
    labels = logits.squeeze(0).argmax(0).cpu().numpy().astype(np.uint8)
    selected = np.isin(labels, tuple(FACE_REGION_CLASSES)).astype(np.uint8) * 255
    selected = cv2.resize(selected, (right - left, bottom - top), interpolation=cv2.INTER_NEAREST)
    result = np.zeros((height, width), dtype=np.uint8)
    result[top:bottom, left:right] = selected
    return result


def overlay(image: np.ndarray, mask: np.ndarray, bbox: np.ndarray, landmarks: np.ndarray) -> np.ndarray:
    result = image.copy()
    tint = np.zeros_like(result)
    tint[:, :, 2] = 220
    active = mask > 0
    result[active] = cv2.addWeighted(result, 0.45, tint, 0.55, 0)[active]
    x1, y1, x2, y2 = (int(round(v)) for v in bbox[:4])
    cv2.rectangle(result, (x1, y1), (x2, y2), (0, 255, 255), 2)
    for x, y in landmarks:
        cv2.circle(result, (int(round(x)), int(round(y))), 3, (0, 255, 0), -1)
    return result


def main() -> int:
    args = parse_args()
    started = time.perf_counter()
    args.output.mkdir(parents=True, exist_ok=True)
    masks_dir = args.output / "masks"
    overlays_dir = args.output / "overlays"
    masks_dir.mkdir(exist_ok=True)
    overlays_dir.mkdir(exist_ok=True)

    buffalo_root = args.models / "insightface"
    checkpoint = args.models / "bisenet" / "79999_iter.pth"
    analyzer = FaceAnalysis(
        name="buffalo_l",
        root=str(buffalo_root),
        providers=["CPUExecutionProvider"],
        det_thresh=args.det_thresh,
    )
    analyzer.prepare(ctx_id=-1, det_thresh=args.det_thresh, det_size=(640, 640))

    # The official prototype constructor downloads an ImageNet ResNet18 before
    # the complete face-parsing checkpoint immediately replaces every weight.
    # Formal offline execution must never perform that redundant download.
    face_parsing_resnet.Resnet18.init_weight = lambda self: None
    parser = BiSeNet(n_classes=19)
    state = torch.load(checkpoint, map_location="cpu", weights_only=True)
    parser.load_state_dict(state)
    parser.eval()
    preprocess = transforms.Compose([
        transforms.Resize((512, 512)),
        transforms.ToTensor(),
        transforms.Normalize((0.485, 0.456, 0.406), (0.229, 0.224, 0.225)),
    ])

    paths = sorted(path for path in args.input.iterdir() if path.suffix.lower() in IMAGE_SUFFIXES)[: args.limit]
    records: list[dict[str, object]] = []
    embeddings: dict[str, np.ndarray] = {}
    for index, path in enumerate(paths, 1):
        item_started = time.perf_counter()
        image = cv2.imread(str(path), cv2.IMREAD_COLOR)
        if image is None:
            records.append({"image": path.name, "status": "decode_failed"})
            continue
        detected_at = time.perf_counter()
        faces = analyzer.get(image)
        detection_seconds = time.perf_counter() - detected_at
        if not faces:
            records.append({"image": path.name, "status": "no_face", "detection_seconds": detection_seconds})
            continue
        face = max(faces, key=lambda value: float((value.bbox[2] - value.bbox[0]) * (value.bbox[3] - value.bbox[1])))
        parsed_at = time.perf_counter()
        mask = face_mask(parser, image, face.bbox, preprocess)
        parsing_seconds = time.perf_counter() - parsed_at
        stem = path.stem
        cv2.imwrite(str(masks_dir / f"{stem}.png"), mask)
        cv2.imwrite(str(overlays_dir / f"{stem}.jpg"), overlay(image, mask, face.bbox, face.kps))
        embedding = np.asarray(face.normed_embedding, dtype=np.float32)
        embeddings[stem] = embedding
        records.append({
            "image": path.name,
            "status": "ok",
            "face_count": len(faces),
            "bbox": [round(float(value), 3) for value in face.bbox],
            "landmarks": [[round(float(x), 3), round(float(y), 3)] for x, y in face.kps],
            "detection_score": round(float(face.det_score), 6),
            "embedding_dim": int(embedding.size),
            "embedding_sha256": hashlib.sha256(embedding.tobytes()).hexdigest(),
            "mask_pixels": int(np.count_nonzero(mask)),
            "mask_fraction": round(float(np.count_nonzero(mask) / mask.size), 6),
            "detection_seconds": round(detection_seconds, 4),
            "parsing_seconds": round(parsing_seconds, 4),
            "total_seconds": round(time.perf_counter() - item_started, 4),
        })
        print(f"[{index}/{len(paths)}] {path.name}: faces={len(faces)} mask_fraction={records[-1]['mask_fraction']}", flush=True)

    np.savez_compressed(args.output / "embeddings.npz", **embeddings)
    manifest = {
        "prototype": True,
        "device": "cpu",
        "detection_threshold": args.det_thresh,
        "input_count": len(paths),
        "success_count": sum(record.get("status") == "ok" for record in records),
        "face_region_classes": sorted(FACE_REGION_CLASSES),
        "models": {"face_analysis": "buffalo_l", "face_parsing": "BiSeNet-R18/79999_iter.pth"},
        "elapsed_seconds": round(time.perf_counter() - started, 4),
        "records": records,
    }
    (args.output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({key: manifest[key] for key in ("input_count", "success_count", "elapsed_seconds")}, indent=2))
    return 0 if manifest["success_count"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
