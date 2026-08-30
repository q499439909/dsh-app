"""Publish the P7 fixtures, resolve one runtime, and run the approved face plan."""

from __future__ import annotations

import hashlib
import json
import subprocess
import time
from pathlib import Path

from data_juicer.tools.plan_flow.capability_lifecycle import CapabilityLifecycle
from data_juicer.tools.plan_flow.capability_schema import CapabilityDescriptor, OperatorArtifact, OperatorDefinition
from data_juicer.tools.plan_flow.common import canonical_json, sha256_bytes, sha256_file
from data_juicer.tools.plan_flow.dataset_artifacts import OutputArtifactCollector
from data_juicer.tools.plan_flow.execution import DockerBackend, DockerResourceLimits
from data_juicer.tools.plan_flow.runner import PlanRunner
from data_juicer.tools.plan_flow.runtime_resolver import DependencyPin, RuntimeResolver
from data_juicer.tools.plan_flow.service import PlanFlowService

BASE_IMAGE_ID = "sha256:c8815bf653a3e4fe7946ce1bf1c5501a37949b44401dfe06914c77a30db76490"
RUNTIME_IMAGE = "dj-runtime-face-mask:p7"
WORKSPACE = Path(r"D:\data\face")
WORKER = Path(r"D:\data\dj-worker-p7")
HERE = Path(__file__).resolve().parent


def tree_hash(root: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(item for item in root.rglob("*") if item.is_file()):
        digest.update(path.relative_to(root).as_posix().encode())
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return "sha256:" + digest.hexdigest()


def main() -> int:
    WORKER.mkdir(parents=True, exist_ok=True)
    wheel = next((HERE / "wheelhouse").glob("opencv_python_headless-*.whl"))
    face = OperatorArtifact.create(
        artifact_id="op-face-region-mask-v3",
        source_hash=tree_hash(HERE / "face_mask"),
        dependency_lock_hash=sha256_bytes(canonical_json({"opencv-python-headless": sha256_file(wheel)})),
        operators=(
            OperatorDefinition(
                "face_region_mask_mapper",
                "face_mask_operator",
                "mapper",
                sha256_bytes(canonical_json({"mask_key": "str", "save_dir": "path"})),
            ),
        ),
        model_refs=(),
    )
    stats = OperatorArtifact.create(
        artifact_id="op-masked-region-analysis-v2",
        source_hash=tree_hash(HERE / "region_stats"),
        dependency_lock_hash=sha256_bytes(canonical_json({})),
        operators=(
            OperatorDefinition(
                "masked_region_statistics_mapper",
                "region_stats_operator",
                "mapper",
                sha256_bytes(canonical_json({"mask_key": "str", "thresholds": "number"})),
            ),
            OperatorDefinition(
                "stratified_quota_selector",
                "region_stats_operator",
                "selector",
                sha256_bytes(canonical_json({"field_key": "str", "quotas": "mapping"})),
            ),
            OperatorDefinition(
                "file_artifact_materializer_mapper",
                "region_stats_operator",
                "mapper",
                sha256_bytes(canonical_json({"source_key": "str", "save_dir": "path"})),
            ),
        ),
        model_refs=(),
    )
    capability = CapabilityDescriptor.create(
        capability_id="face-mask-balanced-sample-v4",
        implements=("face_region_mask@1", "masked_region_statistics@1", "stratified_quota_selection@1"),
        operator_artifact_ids=(face.artifact_id, stats.artifact_id),
        model_refs=(),
        run_network="none",
        resource_profiles=("local-cpu",),
        approval_scope="local-test",
    )
    lifecycle = CapabilityLifecycle(
        WORKER,
        validator=lambda _: {
            "passed": True,
            "checks": ["docker-build-network-none", "module-import", "registry-contract"],
        },
    )
    proposal = lifecycle.prepare(capability, (face, stats))
    if proposal.status != "available":
        proposal = lifecycle.build_and_validate(proposal.proposal_id)
        lifecycle.approve(proposal.proposal_id, proposal.content_hash, note="P7 local acceptance fixture")
        lifecycle.publish(proposal.proposal_id)

    image_id = subprocess.run(
        ["docker", "image", "inspect", RUNTIME_IMAGE, "--format", "{{.Id}}"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    resolver = RuntimeResolver(
        WORKER,
        base_image_id=BASE_IMAGE_ID,
        data_juicer_identity="git:plan-flow-mcp@p7",
        image_builder=lambda _: image_id,
        dependency_pins={
            face.artifact_id: (
                DependencyPin("opencv-python-headless", "4.10.0.84", sha256_file(wheel)),
            ),
            stats.artifact_id: (),
        },
        bootstrap_version="2",
    )
    runtime = resolver.resolve(
        capability_ids=(capability.capability_id,),
        operator_names=tuple(item.name for artifact in (face, stats) for item in artifact.operators),
        profile_family="cpu",
    )

    dataset = WORKSPACE / ".dj" / "inputs" / "input_79b2919374fd" / "manifest.jsonl"
    quotas = {
        "small/dark": 5,
        "small/normal": 5,
        "medium/dark": 5,
        "medium/normal": 5,
        "large/dark": 5,
        "large/normal": 5,
    }
    plan = {
        "user_intent": "Produce 30 diverse face-region masks balanced by face size and brightness",
        "modality": "image",
        "risk_notes": ["FFHQ per-image source licenses require review before redistribution"],
        "acceptance_criteria": ["30 masks", "six size/brightness strata", "network disabled"],
        "approval_required": True,
        "execution_profile": "local-cpu",
        "capability_bindings": [
            {
                "capability_id": capability.capability_id,
                "operators": tuple(item.name for artifact in (face, stats) for item in artifact.operators),
            }
        ],
        "recipe": {
            "dataset": {"configs": [{"type": "local", "path": str(dataset)}]},
            "export_path": "selected_faces.jsonl",
            "process": [
                {"face_region_mask_mapper": {"save_dir": "/run/work/masks"}},
                {"masked_region_statistics_mapper": {}},
                {"stratified_quota_selector": {"quotas": quotas, "adaptive_quantiles": True}},
                {"file_artifact_materializer_mapper": {"save_dir": "/workspace/output/masks"}},
            ],
            "executor_type": "default",
            "np": 1,
        },
        "postprocess": [],
        "models": [],
    }
    service = PlanFlowService()
    prepared = service.prepare_plan(str(WORKSPACE), plan)
    if not prepared["valid"]:
        raise RuntimeError(json.dumps(prepared["validation"], ensure_ascii=False, indent=2))
    service.approve_plan(
        str(WORKSPACE),
        prepared["task_id"],
        prepared["plan_version"],
        prepared["content_hash"],
        "P7 local acceptance fixture",
    )
    backend = DockerBackend(
        WORKSPACE,
        WORKER,
        runtime.image_id,
        limits=DockerResourceLimits(cpus=2, memory_bytes=8 * 1024**3, pids_limit=256),
    )
    runner = PlanRunner(WORKSPACE, backend=backend)
    state = runner.start(prepared["task_id"], prepared["plan_version"], timeout_seconds=1800)
    while state["status"] in {"starting", "running"}:
        time.sleep(2)
        state = runner.get(prepared["task_id"], state["run_id"])
    if state["status"] != "succeeded":
        raise RuntimeError(json.dumps(state, ensure_ascii=False, indent=2))
    output = Path(state["output_dir"])
    artifacts = OutputArtifactCollector(max_total_bytes=1024**3).collect(output)
    recipe_output = output / "selected_faces.jsonl"
    selected = [json.loads(line) for line in recipe_output.read_text(encoding="utf-8").splitlines()]
    strata = {}
    for item in selected:
        strata[item["stratum"]] = strata.get(item["stratum"], 0) + 1
    backend_ref = state["handle"]["backend_ref"]
    backend_record = json.loads(
        (WORKSPACE / ".dj" / "execution" / "docker" / f"{backend_ref}.json").read_text(encoding="utf-8")
    )
    snapshot = json.loads(
        (Path(backend_record["worker_run_root"]) / "input" / "snapshot-0" / "snapshot-manifest.json").read_text(
            encoding="utf-8"
        )
    )
    report = {
        "ok": len(selected) == 30 and all(strata.get(key) == value for key, value in quotas.items()),
        "task_id": prepared["task_id"],
        "plan_version": prepared["plan_version"],
        "plan_content_hash": prepared["content_hash"],
        "runtime_id": runtime.runtime_id,
        "runtime_image_id": runtime.image_id,
        "dataset_snapshot": snapshot,
        "operator_artifacts": [face.to_dict(), stats.to_dict()],
        "selected_count": len(selected),
        "strata": strata,
        "output_dir": str(output),
        "output_artifacts": artifacts,
        "run": state,
    }
    (HERE / "p7-result.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["ok"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
