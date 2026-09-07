"""Build runnable image fixtures for IMG-R-L/M/H and IMG-U-L.

The generated source images are immutable inputs. This script creates deterministic
geometry, watermark, quality, collage, and near-duplicate variants, then emits a
self-contained JSONL manifest for each case and mirrors it into the two DSH input
trees used by this workspace.
"""

from __future__ import annotations

import hashlib
import json
import math
import shutil
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parent
SOURCES = ROOT / "sources"
EVAL_ROOT = ROOT.parent
MIRRORS = [
    EVAL_ROOT / "dsh-workspace" / "inputs",
    Path(r"D:\shishi\evals\dj-pipeline-planning-v1\inputs"),
]


def open_rgb(name: str) -> Image.Image:
    return Image.open(SOURCES / name).convert("RGB")


def save_jpeg(image: Image.Image, path: Path, quality: int = 94) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.convert("RGB").save(path, "JPEG", quality=quality, subsampling=0, optimize=True)


def fit(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    return ImageOps.fit(image, size, method=Image.Resampling.LANCZOS)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def pixel_sha256(image: Image.Image) -> str:
    return hashlib.sha256(image.convert("RGB").tobytes()).hexdigest()


def font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidate = Path(r"C:\Windows\Fonts\arialbd.ttf")
    return ImageFont.truetype(str(candidate), size) if candidate.exists() else ImageFont.load_default()


def add_watermark(image: Image.Image, text: str = "EVAL SAMPLE") -> Image.Image:
    base = image.convert("RGBA")
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    fnt = font(max(44, min(base.size) // 11))
    bbox = draw.textbbox((0, 0), text, font=fnt)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    for y in range(-base.height, base.height * 2, th * 4):
        for x in range(-base.width, base.width * 2, tw + 140):
            draw.text((x, y), text, font=fnt, fill=(255, 255, 255, 165), stroke_width=2, stroke_fill=(0, 0, 0, 120))
    layer = layer.rotate(28, resample=Image.Resampling.BICUBIC, center=(base.width // 2, base.height // 2))
    return Image.alpha_composite(base, layer).convert("RGB")


def make_low_aesthetic(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    tiny = fit(image, (72, 72))
    degraded = tiny.resize(size, Image.Resampling.NEAREST).filter(ImageFilter.GaussianBlur(3.2))
    degraded = ImageEnhance.Color(degraded).enhance(0.35)
    degraded = ImageEnhance.Contrast(degraded).enhance(0.55)
    draw = ImageDraw.Draw(degraded, "RGBA")
    for y in range(0, size[1], 38):
        draw.rectangle((0, y, size[0], y + 10), fill=(45, 65, 80, 30))
    return degraded


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def annotate_outputs(case_dir: Path, rows: list[dict], gold: dict) -> None:
    manifest_rows = []
    for row in rows:
        materialized = dict(row)
        # Data-Juicer multimodal operators expect image_key to reference a
        # list of image paths, even when a record contains exactly one image.
        materialized["image_path"] = [str((case_dir / row["image_path"]).resolve())]
        manifest_rows.append(materialized)
    write_jsonl(case_dir / "input.jsonl", manifest_rows)
    write_json(case_dir / "gold.json", gold)

    image_files = sorted((case_dir / "images").glob("*"))
    checksum_lines = [f"{sha256(path)}  images/{path.name}" for path in image_files]
    (case_dir / "checksums.sha256").write_text("\n".join(checksum_lines) + "\n", encoding="ascii")

    for mirror_root in MIRRORS:
        target = mirror_root / case_dir.name
        target_images = target / "images"
        target_images.mkdir(parents=True, exist_ok=True)
        for path in image_files:
            shutil.copy2(path, target_images / path.name)
        mirrored_rows = []
        for row in rows:
            mirrored = dict(row)
            mirrored["image_path"] = [str((target / row["image_path"]).resolve())]
            mirrored_rows.append(mirrored)
        write_jsonl(target / "input.jsonl", mirrored_rows)
        shutil.copy2(case_dir / "gold.json", target / "gold.json")
        shutil.copy2(case_dir / "checksums.sha256", target / "checksums.sha256")


def build_low() -> None:
    case_dir = ROOT / "IMG-R-L"
    images = case_dir / "images"
    source = open_rgb("still-life.png")
    specs = [
        ("square-pass", 512, 512, "keep", None),
        ("portrait-boundary-pass", 512, 682, "keep", None),
        ("landscape-boundary-pass", 768, 512, "keep", None),
        ("width-too-small", 511, 512, "drop", "minimum_dimension"),
        ("height-too-small", 512, 511, "drop", "minimum_dimension"),
        ("too-tall", 512, 800, "drop", "aspect_ratio"),
        ("too-wide", 900, 512, "drop", "aspect_ratio"),
        ("large-pass", 2048, 1536, "keep", None),
    ]
    rows, gold_records = [], []
    for item_id, width, height, decision, reason in specs:
        name = f"{item_id}.jpg"
        save_jpeg(fit(source, (width, height)), images / name)
        rows.append({"id": item_id, "image_path": f"images/{name}", "width": width, "height": height})
        gold_records.append({
            "id": item_id,
            "width": width,
            "height": height,
            "aspect_ratio_width_over_height": round(width / height, 6),
            "gold_decision": decision,
            "deletion_reason": reason,
        })
    annotate_outputs(case_dir, rows, {
        "case_id": "IMG-R-L",
        "oracle_type": "deterministic_pixel_metadata",
        "boundary_semantics": "width >= 512, height >= 512, 0.75 <= width/height <= 1.50",
        "records": gold_records,
    })


def build_medium() -> None:
    case_dir = ROOT / "IMG-R-M"
    images = case_dir / "images"
    portrait = open_rgb("portrait.png")
    portrait_1024 = fit(portrait, (1024, 1024))

    # The manual face box on the 1536x1536 source is [440, 230, 1090, 930].
    # It is used to engineer ratio strata, not as a claim about any runtime detector.
    variants: list[tuple[str, Image.Image, str, str | None, dict]] = []
    variants.append(("valid-portrait-01", portrait_1024, "keep_then_blur_face", None,
                     {"face_count_gold": 1, "face_ratio_gold_approx": 0.193}))
    variants.append(("valid-portrait-02", ImageOps.mirror(ImageEnhance.Brightness(portrait_1024).enhance(1.04)),
                     "keep_then_blur_face", None, {"face_count_gold": 1, "face_ratio_gold_approx": 0.193}))
    cropped_valid = portrait.crop((68, 68, 1468, 1468))
    variants.append(("valid-portrait-03", fit(ImageEnhance.Color(cropped_valid).enhance(0.92), (1024, 1024)),
                     "keep_then_blur_face", None, {"face_count_gold": 1, "face_ratio_gold_approx": 0.232}))
    variants.append(("no-face", fit(open_rgb("alpine-lake.png"), (1024, 768)), "drop", "face_count_not_one",
                     {"face_count_gold": 0}))
    variants.append(("multiple-faces", fit(open_rgb("group-three.png"), (1024, 768)), "drop", "face_count_not_one",
                     {"face_count_gold": 3}))

    small_canvas = Image.new("RGB", (1024, 1024), (202, 202, 202))
    small_portrait = portrait.resize((660, 660), Image.Resampling.LANCZOS)
    small_canvas.paste(small_portrait, (182, 182))
    variants.append(("face-too-small", small_canvas, "drop", "face_ratio_below_0.15",
                     {"face_count_gold": 1, "face_ratio_gold_approx": 0.08}))

    large_crop = portrait.crop((378, 190, 1152, 964))
    variants.append(("face-too-large", fit(large_crop, (1024, 1024)), "drop", "face_ratio_above_0.60",
                     {"face_count_gold": 1, "face_ratio_gold_approx": 0.76}))

    beach = open_rgb("adult-swimwear-safety-proxy.png").crop((330, 0, 1150, 820))
    variants.append(("nsfw-proxy", fit(beach, (1024, 1024)), "drop", "nsfw_threshold_runtime_dependent",
                     {"face_count_gold": 1, "safety_fixture": "benign adult swimwear proxy; non-explicit"}))
    variants.append(("watermark", add_watermark(portrait_1024), "drop", "watermark",
                     {"face_count_gold": 1, "face_ratio_gold_approx": 0.193}))
    variants.append(("low-aesthetic", make_low_aesthetic(portrait, (1024, 1024)), "drop", "low_aesthetic",
                     {"face_count_gold": 1, "quality_defect": "pixelation_blur_low_contrast_banding"}))

    rows, gold_records = [], []
    for item_id, image, decision, reason, annotations in variants:
        name = f"{item_id}.jpg"
        quality = 16 if item_id == "low-aesthetic" else 94
        save_jpeg(image, images / name, quality=quality)
        rows.append({"id": item_id, "image_path": f"images/{name}"})
        gold_records.append({"id": item_id, "gold_decision": decision, "deletion_reason": reason, **annotations})
    annotate_outputs(case_dir, rows, {
        "case_id": "IMG-R-M",
        "oracle_type": "semantic_strata_with_manual_annotations",
        "important": [
            "Face counts and ratios are fixture annotations; calibrate Data-Juicer detector thresholds on these images before scoring.",
            "nsfw-proxy is deliberately non-explicit adult swimwear. Its score is a safety-model calibration probe, not guaranteed to cross every model's NSFW threshold.",
            "Only the three valid-portrait records should reach image_face_blur_mapper.",
        ],
        "records": gold_records,
    })


def build_high() -> None:
    case_dir = ROOT / "IMG-R-H"
    images = case_dir / "images"
    lake = fit(open_rgb("alpine-lake.png"), (1024, 768))
    still = fit(open_rgb("still-life.png"), (1024, 1024))
    bike = fit(open_rgb("cargo-bicycle.png"), (1024, 768))
    cat = fit(open_rgb("cat-suitcase.png"), (1024, 1024))
    dog_chair = fit(open_rgb("dog-left-chair-right.png"), (1024, 768))
    portrait = fit(open_rgb("portrait.png"), (1024, 1024))

    records: list[tuple[str, Image.Image, str, str, str, str | None, dict]] = [
        ("good-alpine-lake", lake, "一座红色小屋坐落在高山湖泊右岸。", "alpine_lake", "keep", None, {}),
        ("good-vase-sunflower", still, "灰色桌面上摆着蓝绿色花瓶、向日葵、亚麻布和一本蓝色书。", "still_life", "keep", None, {}),
        ("good-cargo-bicycle", bike, "一辆带藤编前篮的绿色载货自行车停在黄色墙边。", "cargo_bicycle", "keep", None, {}),
        ("good-cat-suitcase", cat, "一只橘猫蜷缩在打开的旧蓝色手提箱里睡觉。", "cat_in_suitcase", "keep", None, {}),
        ("undersized", fit(dog_chair, (256, 192)), "一只黑狗坐在红椅子左侧。", "dog_and_chair", "drop", "minimum_dimension", {}),
        ("extreme-aspect", fit(bike, (1600, 300)), "一辆绿色载货自行车靠着黄色墙。", "cargo_bicycle", "drop", "extreme_aspect_ratio", {}),
        ("nsfw-proxy", fit(open_rgb("adult-swimwear-safety-proxy.png"), (1024, 1024)), "一名成年女性穿着连体泳衣和罩衫站在海滩上。", "adult_beachwear", "drop", "nsfw_threshold_runtime_dependent", {"safety_fixture": "benign non-explicit proxy"}),
        ("watermark", add_watermark(lake), "一座红色小屋位于高山湖泊旁。", "alpine_lake", "drop", "watermark", {}),
        ("low-aesthetic", make_low_aesthetic(still, (1024, 1024)), "花瓶里插着一朵向日葵。", "still_life", "drop", "low_aesthetic", {}),
        ("duplicate-portrait-a", portrait, "一名成年女性在灰色背景前拍摄证件式肖像。", "adult_portrait", "keep_one", None, {"duplicate_cluster_gold": "portrait-cluster-1"}),
        ("caption-hard-mismatch", dog_chair, "一把红色椅子位于一只黑狗的左侧。", "dog_and_chair", "drop", "caption_spatial_relation_mismatch", {"visual_relation_gold": "dog_left_of_chair"}),
        ("missing-tag", fit(open_rgb("group-three.png"), (1024, 768)), "三名成年人并排站在灰色摄影棚背景前。", "", "keep_and_tag", None, {"generated_subject_gold": "adult_group_portrait"}),
    ]

    tile_size = (480, 480)
    collage = Image.new("RGB", (1024, 1024), (245, 245, 245))
    for image, xy in zip((lake, still, bike, cat), ((16, 16), (528, 16), (16, 528), (528, 528))):
        collage.paste(fit(image, tile_size), xy)
    records.insert(6, ("subplot", collage, "湖泊、花瓶、自行车和猫组成的四宫格。", "multi_subject_collage", "drop", "subplot", {}))

    # Near duplicate: a 1.2% inward crop plus mild contrast/JPEG change.
    inset = 12
    near = portrait.crop((inset, inset, portrait.width - inset, portrait.height - inset))
    near = fit(ImageEnhance.Contrast(near).enhance(1.015), portrait.size)
    records.insert(11, ("duplicate-portrait-b", near, "灰色背景前是一名成年女性的正面肖像。", "adult_portrait", "keep_one", None,
                        {"duplicate_cluster_gold": "portrait-cluster-1", "near_duplicate_transform": "1.2% crop + 1.5% contrast + JPEG"}))

    rows, gold_records = [], []
    for item_id, image, caption, subject, decision, reason, annotations in records:
        name = f"{item_id}.jpg"
        quality = 15 if item_id == "low-aesthetic" else (86 if item_id == "duplicate-portrait-b" else 94)
        save_jpeg(image, images / name, quality=quality)
        rows.append({"id": item_id, "image_path": f"images/{name}", "caption": caption, "subject_hint": subject})
        gold_records.append({"id": item_id, "gold_decision": decision, "deletion_reason": reason, **annotations})

    annotate_outputs(case_dir, rows, {
        "case_id": "IMG-R-H",
        "oracle_type": "mixed_deterministic_and_semantic_strata",
        "expected_record_count": 14,
        "expected_duplicate_clusters": {"portrait-cluster-1": ["duplicate-portrait-a", "duplicate-portrait-b"]},
        "caption_mismatch_explanation": "The image shows dog LEFT of chair; the caption claims chair LEFT of dog while retaining the same nouns.",
        "expected_final_subjects_after_keep_one_and_tagging": [
            "alpine_lake", "still_life", "cargo_bicycle", "cat_in_suitcase", "adult_portrait", "adult_group_portrait"
        ],
        "expected_max_subject_ratio": round(1 / 6, 6),
        "important": [
            "Run cheap geometry and subplot checks before watermark/aesthetic/alignment models.",
            "nsfw-proxy is deliberately non-explicit and is a runtime calibration probe.",
            "Model-derived scores are not baked into gold; record actual scores and calibrate thresholds on this canary set.",
        ],
        "records": gold_records,
    })


def build_unreachable_low() -> None:
    """Create all eight EXIF orientation cases with removable device/GPS tags."""
    case_dir = ROOT / "IMG-U-L"
    images = case_dir / "images"
    upright = fit(open_rgb("still-life.png"), (640, 480))
    draw = ImageDraw.Draw(upright)
    draw.rectangle((18, 18, 222, 92), fill=(245, 245, 245), outline=(15, 15, 15), width=4)
    draw.text((32, 30), "UP  /  LEFT", font=font(30), fill=(10, 10, 10))
    draw.polygon([(590, 40), (620, 70), (602, 70), (602, 132), (578, 132), (578, 70), (560, 70)], fill=(220, 30, 40))

    # Pillow's exif_transpose applies these raw->upright transforms.  Build each
    # raw raster with the inverse so all eight records display identically.
    inverse = {
        1: None,
        2: Image.Transpose.FLIP_LEFT_RIGHT,
        3: Image.Transpose.ROTATE_180,
        4: Image.Transpose.FLIP_TOP_BOTTOM,
        5: Image.Transpose.TRANSPOSE,
        6: Image.Transpose.ROTATE_90,
        7: Image.Transpose.TRANSVERSE,
        8: Image.Transpose.ROTATE_270,
    }

    rows, gold_records = [], []
    for orientation in range(1, 9):
        item_id = f"orientation-{orientation}"
        raw = upright.copy() if inverse[orientation] is None else upright.transpose(inverse[orientation])
        exif = Image.Exif()
        exif[0x0112] = orientation  # Orientation
        exif[0x010F] = "DSH Eval Camera"  # Make
        exif[0x0110] = f"EXIF-O{orientation}"  # Model
        exif[0x0131] = "fixture-builder"  # Software
        has_gps = orientation in {1, 3, 5, 6, 8}
        if has_gps:
            exif[0x8825] = {
                0x0001: "N",
                0x0002: (31.0, 13.0, float(orientation)),
                0x0003: "E",
                0x0004: (121.0, 28.0, float(orientation)),
            }
        name = f"{item_id}.jpg"
        path = images / name
        path.parent.mkdir(parents=True, exist_ok=True)
        raw.save(path, "JPEG", quality=94, subsampling=0, optimize=True, exif=exif)
        with Image.open(path) as stored:
            displayed = ImageOps.exif_transpose(stored).convert("RGB")
            raw_size = list(stored.size)
        rows.append({
            "id": item_id,
            "image_path": f"images/{name}",
            "exif_orientation": orientation,
            "has_gps": has_gps,
        })
        gold_records.append({
            "id": item_id,
            "input_orientation": orientation,
            "input_has_gps": has_gps,
            "input_raw_size": raw_size,
            "expected_output_size": [640, 480],
            "expected_display_pixel_sha256": pixel_sha256(displayed),
            "expected_metadata_residual_count": 0,
        })

    annotate_outputs(case_dir, rows, {
        "case_id": "IMG-U-L",
        "oracle_type": "deterministic_exif_orientation_and_metadata",
        "validation": {
            "orientation": "Every output must be stored upright with no Orientation tag.",
            "metadata": "EXIF, GPS, camera/device, software, comment, XMP and ICC metadata must be absent.",
            "pixels": "Compare output to the input after its EXIF display transform: dimensions and full frame must match, max per-channel decoded error must be <= 4 and RGB RMSE <= 0.5. This tolerance only covers IDCT rounding after a lossless JPEG coefficient transform; resizing, cropping, color adjustment and lossy re-encoding remain forbidden.",
            "decoded_pixel_tolerance": {"max_channel_absolute_error": 4, "rgb_rmse": 0.5},
        },
        "implementation_note": "A lossless JPEG coefficient transform such as jpegtran is acceptable. Exact decoded RGB equality is not required because rotated DCT blocks can differ by a few IDCT rounding levels; ordinary Pillow decode/transpose/save should still exceed the stated tolerance because it re-encodes JPEG data.",
        "records": gold_records,
    })


def validate() -> None:
    expected = {"IMG-R-L": 8, "IMG-R-M": 10, "IMG-R-H": 14, "IMG-U-L": 8}
    for case_id, count in expected.items():
        case_dir = ROOT / case_id
        rows = [json.loads(line) for line in (case_dir / "input.jsonl").read_text(encoding="utf-8").splitlines() if line]
        if len(rows) != count:
            raise ValueError(f"{case_id}: expected {count} rows, got {len(rows)}")
        for row in rows:
            image_paths = row["image_path"]
            if not isinstance(image_paths, list) or len(image_paths) != 1:
                raise ValueError(f"{row['id']}: image_path must be a single-item list")
            path = Path(image_paths[0])
            if not path.exists():
                raise FileNotFoundError(path)
            with Image.open(path) as image:
                width, height = image.size
                if case_id == "IMG-U-L":
                    expected_orientation = int(row["exif_orientation"])
                    if image.getexif().get(0x0112) != expected_orientation:
                        raise ValueError(f"{row['id']}: EXIF orientation mismatch")
                    if bool(image.getexif().get_ifd(0x8825)) != bool(row["has_gps"]):
                        raise ValueError(f"{row['id']}: GPS metadata mismatch")
            if case_id == "IMG-R-L" and (row["width"], row["height"]) != (width, height):
                raise ValueError(f"{row['id']}: manifest/image dimension mismatch")
        print(f"OK {case_id}: {count} records")


if __name__ == "__main__":
    build_low()
    build_medium()
    build_high()
    build_unreachable_low()
    validate()
