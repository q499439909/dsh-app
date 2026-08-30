"""Generic mask statistics and stratified quota operators for Data-Juicer."""

from __future__ import annotations

from collections import defaultdict
from pathlib import Path
import shutil

import numpy as np
from PIL import Image

from data_juicer.ops.base_op import Mapper, OPERATORS, Selector


@OPERATORS.register_module("masked_region_statistics_mapper")
class MaskedRegionStatisticsMapper(Mapper):
    """Compute luminance and area statistics for any image and binary mask pair."""

    def __init__(
        self,
        mask_key: str = "mask_path",
        brightness_key: str = "masked_mean_luminance",
        area_key: str = "masked_area_ratio",
        small_max: float = 0.16,
        medium_max: float = 0.24,
        dark_max: float = 105.0,
        normal_max: float = 205.0,
        *args,
        **kwargs,
    ):
        super().__init__(*args, **kwargs)
        self.mask_key = mask_key
        self.brightness_key = brightness_key
        self.area_key = area_key
        self.small_max = small_max
        self.medium_max = medium_max
        self.dark_max = dark_max
        self.normal_max = normal_max

    def process_single(self, sample):
        mask_path = sample.get(self.mask_key)
        image_paths = sample.get(self.image_key) or []
        if not mask_path or not image_paths:
            sample[self.brightness_key] = None
            sample[self.area_key] = 0.0
            sample["size_bucket"] = "missing"
            sample["brightness_bucket"] = "missing"
            sample["stratum"] = "missing"
            return sample
        with Image.open(str(image_paths[0])) as loaded:
            rgb = np.asarray(loaded.convert("RGB"), dtype=np.float32)
        with Image.open(str(mask_path)) as loaded_mask:
            mask = np.asarray(loaded_mask.convert("L")) > 0
        if mask.shape != rgb.shape[:2] or not np.any(mask):
            raise ValueError("Mask must be non-empty and have the same dimensions as the image")
        luminance = 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]
        area_ratio = float(np.count_nonzero(mask) / mask.size)
        brightness = float(np.mean(luminance[mask]))
        size_bucket = "small" if area_ratio < self.small_max else "medium" if area_ratio < self.medium_max else "large"
        brightness_bucket = "dark" if brightness < self.dark_max else "normal" if brightness < self.normal_max else "bright"
        sample[self.brightness_key] = round(brightness, 4)
        sample[self.area_key] = round(area_ratio, 6)
        sample["size_bucket"] = size_bucket
        sample["brightness_bucket"] = brightness_bucket
        sample["stratum"] = f"{size_bucket}/{brightness_bucket}"
        return sample


@OPERATORS.register_module("stratified_quota_selector")
class StratifiedQuotaSelector(Selector):
    """Select deterministic per-stratum quotas with an optional distinct identity field."""

    def __init__(
        self,
        field_key: str = "stratum",
        quotas: dict | None = None,
        distinct_key: str = "source_name",
        adaptive_quantiles: bool = False,
        area_key: str = "masked_area_ratio",
        brightness_key: str = "masked_mean_luminance",
        *args,
        **kwargs,
    ):
        super().__init__(*args, **kwargs)
        self.field_key = field_key
        self.quotas = quotas or {}
        self.distinct_key = distinct_key
        self.adaptive_quantiles = adaptive_quantiles
        self.area_key = area_key
        self.brightness_key = brightness_key

    def process(self, dataset):
        if self.adaptive_quantiles:
            dataset = self._assign_quantile_strata(dataset)
        selected = []
        counts = defaultdict(int)
        seen = set()
        for index, sample in enumerate(dataset):
            stratum = sample.get(self.field_key)
            identity = sample.get(self.distinct_key)
            quota = int(self.quotas.get(stratum, 0))
            if quota <= 0 or counts[stratum] >= quota or identity in seen:
                continue
            selected.append(index)
            counts[stratum] += 1
            seen.add(identity)
        return dataset.select(selected)

    def _assign_quantile_strata(self, dataset):
        valid = [
            index for index, sample in enumerate(dataset)
            if sample.get(self.area_key) is not None and sample.get(self.brightness_key) is not None
        ]
        by_area = sorted(valid, key=lambda index: (dataset[index][self.area_key], index))
        size_labels = ["missing"] * len(dataset)
        brightness_labels = ["missing"] * len(dataset)
        size_names = ("small", "medium", "large")
        for rank, index in enumerate(by_area):
            bucket = min(2, rank * 3 // max(1, len(by_area)))
            size_labels[index] = size_names[bucket]
        for size in size_names:
            members = [index for index in valid if size_labels[index] == size]
            members.sort(key=lambda index: (dataset[index][self.brightness_key], index))
            for rank, index in enumerate(members):
                brightness_labels[index] = "dark" if rank < len(members) / 2 else "normal"
        strata = [f"{size_labels[index]}/{brightness_labels[index]}" for index in range(len(dataset))]
        for name, values in (
            ("size_bucket", size_labels),
            ("brightness_bucket", brightness_labels),
            (self.field_key, strata),
        ):
            if name in dataset.column_names:
                dataset = dataset.remove_columns(name)
            dataset = dataset.add_column(name, values)
        return dataset


@OPERATORS.register_module("file_artifact_materializer_mapper")
class FileArtifactMaterializerMapper(Mapper):
    """Copy a file referenced by a sample into a declared output directory."""

    def __init__(self, source_key: str = "mask_path", save_dir: str = "/workspace/output/masks", *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.source_key = source_key
        self.save_dir = Path(save_dir)

    def process_single(self, sample):
        source = Path(str(sample.get(self.source_key) or ""))
        if not source.is_file():
            raise ValueError(f"Referenced artifact is unavailable: {source}")
        self.save_dir.mkdir(parents=True, exist_ok=True)
        target = self.save_dir / source.name
        shutil.copy2(source, target)
        sample[self.source_key] = str(target)
        return sample
