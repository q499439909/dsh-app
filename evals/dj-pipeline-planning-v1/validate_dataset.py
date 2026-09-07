"""Validate the structural and matrix invariants of dj-pipeline-planning-v1."""

from __future__ import annotations

import json
from itertools import product
from pathlib import Path

import jsonschema


ROOT = Path(__file__).resolve().parent


def load(name: str) -> dict:
    with (ROOT / name).open("r", encoding="utf-8") as handle:
        return json.load(handle)


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def main() -> None:
    dataset = load("cases.json")
    case_schema = load("case.schema.json")
    scope = load("capability-scope.json")
    rubric = load("rubric.json")
    text_fixtures = load("fixtures/text-fixtures.json")
    image_fixtures = load("fixtures/image-fixtures.json")

    require(dataset["capability_snapshot"] == scope["snapshot_id"], "capability snapshot mismatch")
    require(sum(item["points"] for item in rubric["dimensions"]) == rubric["total_points"], "rubric points do not sum to total")

    cases = dataset["cases"]
    require(len(cases) == 12, f"expected 12 cases, found {len(cases)}")
    ids = [case["case_id"] for case in cases]
    require(len(ids) == len(set(ids)), "duplicate case_id")

    expected_matrix = set(product(("text", "image"), ("reachable", "unreachable"), ("low", "medium", "high")))
    actual_matrix = {(case["modality"], case["reachability"], case["difficulty"]) for case in cases}
    require(actual_matrix == expected_matrix, f"matrix mismatch: missing={expected_matrix - actual_matrix}, extra={actual_matrix - expected_matrix}")

    fixtures = {}
    for fixture in text_fixtures["fixtures"] + image_fixtures["fixtures"]:
        fixture_id = fixture["fixture_id"]
        require(fixture_id not in fixtures, f"duplicate fixture_id: {fixture_id}")
        if "records" in fixture:
            materialized_count = len(fixture["records"])
        elif "strata" in fixture:
            materialized_count = sum(item["count"] for item in fixture["strata"])
        elif "groups" in fixture:
            materialized_count = sum(item["count"] for item in fixture["groups"])
        else:
            raise ValueError(f"{fixture_id}: no records, strata, or groups")
        require(materialized_count == fixture["record_count"], f"{fixture_id}: declared and materialized counts differ")
        fixtures[fixture_id] = fixture

    referenced = set()
    for case in cases:
        jsonschema.validate(instance=case, schema=case_schema)
        required_case_keys = {
            "case_id", "title", "modality", "reachability", "difficulty", "task_prompt",
            "input_profile", "acceptance_criteria", "gold",
        }
        require(required_case_keys <= case.keys(), f"{case['case_id']}: missing top-level fields")
        require(case["acceptance_criteria"], f"{case['case_id']}: no acceptance criteria")
        require(all(item["hard"] for item in case["acceptance_criteria"]), f"{case['case_id']}: core criteria must be hard")

        gold = case["gold"]
        require(gold["atomic_capabilities"], f"{case['case_id']}: no atomic capabilities")
        require(gold["expected_behavior"], f"{case['case_id']}: no expected behavior")
        if case["reachability"] == "reachable":
            require(gold["operator_candidates"], f"{case['case_id']}: reachable case has no operator candidates")
            require(not gold["capability_gaps"], f"{case['case_id']}: reachable case has capability gaps")
        else:
            require(not gold["operator_candidates"], f"{case['case_id']}: unreachable case has full operator candidates")
            require(gold["capability_gaps"], f"{case['case_id']}: unreachable case has no capability gap")

        for fixture_id in case["input_profile"]["fixture_ids"]:
            require(fixture_id in fixtures, f"{case['case_id']}: unknown fixture {fixture_id}")
            require(fixtures[fixture_id]["record_count"] == case["input_profile"]["records"], f"{case['case_id']}: fixture record count mismatch")
            referenced.add(fixture_id)

    require(referenced == set(fixtures), f"unreferenced fixtures: {set(fixtures) - referenced}")
    print(f"OK: {len(cases)} cases, {len(fixtures)} fixtures, full 2x2x3 matrix, rubric={rubric['total_points']} points")


if __name__ == "__main__":
    main()
