#!/usr/bin/env python3
"""Postprocess artifact: attribute deletion reasons for records dropped by the
Data-Juicer image_shape_filter + image_aspect_ratio_filter pipeline.

Data-Juicer filter operators drop records but emit no per-record "why" report,
so this script reads the original manifest and the DJ filtered export (the kept
records) and emits a JSON report aligned with the case gold schema. Decisions
are taken from the ACTUAL DJ export (which ids survived); deletion reasons are
attributed from each record's pixel dimensions (which equal the actual decoded
dimensions for these deterministic fixtures), with the minimum-dimension check
taking precedence over the aspect-ratio check, matching the gold taxonomy
(minimum_dimension | aspect_ratio).

Path resolution (works whether invoked with explicit args, run env vars, or
defaults):
  input:     argv[1] | $INPUT_PATH  | <script_dir>/input.jsonl
  export:    argv[2] | $FILTERED_EXPORT | $RUN_OUTPUT/filtered.jsonl | <script_dir>/filtered.jsonl
  report:    argv[3] | $REPORT_PATH  | $RUN_OUTPUT/deletion_reasons.json | <script_dir>/deletion_reasons.json
  checksums: <script_dir>/checksums.sha256
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
EXPORT_BASENAME = "filtered.jsonl"
REPORT_BASENAME = "deletion_reasons.json"

MIN_DIM = 512
MIN_RATIO = 0.75
MAX_RATIO = 1.50


def _run_output() -> str | None:
    for key in ("RUN_OUTPUT", "OUTPUT_DIR", "DJ_OUTPUT", "RUN_DIR", "DJ_RUN_OUTPUT"):
        val = os.environ.get(key)
        if val:
            return val
    return None


def resolve_paths(argv: list[str]) -> tuple[Path, Path, Path, Path]:
    run_out = _run_output()
    export_default = (Path(run_out) / EXPORT_BASENAME) if run_out else (SCRIPT_DIR / EXPORT_BASENAME)
    report_default = (Path(run_out) / REPORT_BASENAME) if run_out else (SCRIPT_DIR / REPORT_BASENAME)

    input_env = os.environ.get("INPUT_PATH")
    input_path = (
        Path(argv[1]) if len(argv) > 1 and argv[1]
        else (Path(input_env) if input_env else SCRIPT_DIR / "input.jsonl")
    )
    export_env = os.environ.get("FILTERED_EXPORT")
    export_path = Path(argv[2]) if len(argv) > 2 and argv[2] else (Path(export_env) if export_env else export_default)
    report_env = os.environ.get("REPORT_PATH")
    report_path = Path(argv[3]) if len(argv) > 3 and argv[3] else (Path(report_env) if report_env else report_default)
    checksums = SCRIPT_DIR / "checksums.sha256"
    return input_path, export_path, report_path, checksums


def read_jsonl(path: Path) -> list[dict]:
    out: list[dict] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                out.append(json.loads(line))
    return out


def aspect_ratio(record: dict) -> float:
    return record["width"] / record["height"]


def deletion_reason_for(record: dict) -> str | None:
    """Attribute a drop reason from pixel dimensions; dimension check first."""
    w = record["width"]
    h = record["height"]
    if w < MIN_DIM or h < MIN_DIM:
        return "minimum_dimension"
    ratio = w / h
    if ratio < MIN_RATIO or ratio > MAX_RATIO:
        return "aspect_ratio"
    return None


def load_checksums(path: Path) -> dict[str, str]:
    """Parse '<hash>  images/<name>' lines into {image_relative_path: hash}."""
    mapping: dict[str, str] = {}
    if not path.exists():
        return mapping
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            parts = line.split(None, 1)
            if len(parts) == 2:
                mapping[parts[1].strip().replace("\\", "/")] = parts[0].strip()
    return mapping


def sha256_of(path: Path) -> str | None:
    if not path.exists():
        return None
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 16), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_image_integrity(kept_records: list[dict], checksums_path: Path) -> dict:
    """Recompute sha256 of each kept image and compare to checksums.sha256.
    Confirms the filter-only pipeline never scaled/cropped/rewrote images."""
    checksums = load_checksums(checksums_path)
    checked = 0
    passed = 0
    mismatches: list[str] = []
    for record in kept_records:
        paths = record.get("image_path", [])
        if isinstance(paths, str):
            paths = [paths]
        for img in paths:
            img_path = Path(img)
            rel = "images/" + img_path.name
            expected = checksums.get(rel.replace("\\", "/"))
            actual = sha256_of(img_path)
            checked += 1
            if expected is None or actual is None:
                mismatches.append(f"{rel}: missing checksum or file")
            elif actual == expected:
                passed += 1
            else:
                mismatches.append(f"{rel}: hash mismatch expected={expected} actual={actual}")
    return {
        "checked": checked,
        "passed": passed,
        "status": "pass" if checked and passed == checked else "fail",
        "mismatches": mismatches,
    }


def main() -> int:
    input_path, export_path, report_path, checksums_path = resolve_paths(sys.argv)

    if not input_path.exists():
        print(f"error: input manifest not found: {input_path}", file=sys.stderr)
        return 2
    if not export_path.exists():
        print(f"error: DJ filtered export not found: {export_path}", file=sys.stderr)
        return 2

    inputs = read_jsonl(input_path)
    kept_ids = {r["id"] for r in read_jsonl(export_path)}

    records_out: list[dict] = []
    kept_records: list[dict] = []
    dropped_without_reason: list[str] = []
    for record in inputs:
        rid = record["id"]
        kept = rid in kept_ids
        reason = None if kept else deletion_reason_for(record)
        if not kept and reason is None:
            dropped_without_reason.append(rid)
        records_out.append({
            "id": rid,
            "width": record["width"],
            "height": record["height"],
            "aspect_ratio_width_over_height": round(aspect_ratio(record), 6),
            "gold_decision": "keep" if kept else "drop",
            "deletion_reason": reason,
        })
        if kept:
            kept_records.append(record)

    integrity = verify_image_integrity(kept_records, checksums_path)

    report = {
        "case_id": "IMG-R-L",
        "oracle_type": "deterministic_pixel_metadata",
        "boundary_semantics": "width >= 512, height >= 512, 0.75 <= width/height <= 1.50",
        "source": {
            "input": str(input_path),
            "filtered_export": str(export_path),
        },
        "summary": {
            "total": len(records_out),
            "kept": sum(1 for r in records_out if r["gold_decision"] == "keep"),
            "dropped": sum(1 for r in records_out if r["gold_decision"] == "drop"),
            "dropped_without_attributed_reason": dropped_without_reason,
            "image_integrity": integrity,
        },
        "records": records_out,
    }

    report_path.parent.mkdir(parents=True, exist_ok=True)
    with report_path.open("w", encoding="utf-8") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)

    s = report["summary"]
    print(
        f"deletion_reasons: total={s['total']} kept={s['kept']} dropped={s['dropped']} "
        f"image_integrity={integrity['status']} -> {report_path}"
    )
    if dropped_without_reason:
        print(
            f"warning: dropped without attributed reason (possible boundary behavior): "
            f"{dropped_without_reason}",
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
