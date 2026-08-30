"""Reusable Data-Juicer mapper that detects a face and writes its region mask."""

from __future__ import annotations

import os
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

from data_juicer.ops.base_op import Mapper, OPERATORS, UNFORKABLE

OP_NAME = "face_region_mask_mapper"


@UNFORKABLE.register_module(OP_NAME)
@OPERATORS.register_module(OP_NAME)
class FaceRegionMaskMapper(Mapper):
    """Detect the largest frontal face and emit an elliptical uint8 PNG mask."""

    def __init__(
        self,
        mask_key: str = "mask_path",
        save_dir: str = "/workspace/output/masks",
        scale_factor: float = 1.1,
        min_neighbors: int = 3,
        *args,
        **kwargs,
    ):
        super().__init__(*args, **kwargs)
        self.mask_key = mask_key
        self.save_dir = Path(save_dir)
        self.scale_factor = scale_factor
        self.min_neighbors = min_neighbors
        classifier = Path(cv2.data.haarcascades) / "haarcascade_frontalface_alt2.xml"
        self.classifier_path = str(classifier)

    def process_single(self, sample):
        image_paths = sample.get(self.image_key) or []
        sample["face_detected"] = False
        sample[self.mask_key] = ""
        sample["face_area_ratio"] = 0.0
        sample["face_bbox"] = []
        sample["source_name"] = ""
        if not image_paths:
            return sample
        image_path = str(image_paths[0])
        sample["source_name"] = os.path.basename(image_path)
        with Image.open(image_path) as loaded:
            rgb = np.asarray(loaded.convert("RGB"))
        gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
        detector = cv2.CascadeClassifier(self.classifier_path)
        if detector.empty():
            raise ValueError(f"Could not load OpenCV face classifier: {self.classifier_path}")
        detections = detector.detectMultiScale(
            gray,
            scaleFactor=self.scale_factor,
            minNeighbors=self.min_neighbors,
            minSize=(32, 32),
        )
        if len(detections) == 0:
            return sample
        x, y, width, height = max(detections, key=lambda item: int(item[2]) * int(item[3]))
        mask = np.zeros(gray.shape, dtype=np.uint8)
        center = (int(x + width / 2), int(y + height / 2))
        axes = (max(1, int(width * 0.48)), max(1, int(height * 0.58)))
        cv2.ellipse(mask, center, axes, 0, 0, 360, 255, thickness=-1)
        self.save_dir.mkdir(parents=True, exist_ok=True)
        output = self.save_dir / f"{Path(image_path).stem}.png"
        Image.fromarray(mask, mode="L").save(output)
        sample["face_detected"] = True
        sample[self.mask_key] = str(output)
        sample["face_area_ratio"] = float(np.count_nonzero(mask) / mask.size)
        sample["face_bbox"] = [int(x), int(y), int(width), int(height)]
        return sample
