# Agent-Managed Data Pipeline

This context describes how a DSH Agent turns a data-processing requirement into an approved, reproducible Data-Juicer run, including capabilities that do not yet exist in the built-in operator catalog.

## Language

**TaskSpec**:
The confirmed statement of a user's data-processing intent, constraints, acceptance criteria, and discoverable unknowns.
_Avoid_: Prompt, request text, questionnaire

**Atomic Requirement**:
A smallest independently testable statement of required data-processing behaviour. It is semantic and does not imply a one-to-one relationship with an operator.
_Avoid_: Operator, package, implementation step

**Operator**:
A Data-Juicer-compatible transformation, filter, selector, deduplicator, aggregator, or pipeline operation with a reusable data contract.
_Avoid_: Atomic requirement, script fragment

**Operator Artifact**:
An immutable, validated bundle containing one or more external Data-Juicer operators and their schema metadata.
_Avoid_: Capability image, loose Python file

**Capability**:
An approved implementation of one or more Atomic Requirements, backed by Operator Artifacts, Model Artifacts, dependency facts, and an explicit security contract.
_Avoid_: Docker image, operator name

**Capability Proposal**:
An immutable candidate capability together with its sources, licenses, hashes, tests, resource needs, and requested permissions, awaiting approval.
_Avoid_: Install command, unreviewed patch

**Model Artifact**:
An immutable, verified model file set identified by source revision, inventory, license state, and content hash.
_Avoid_: Model name, mutable cache directory

**Runtime Manifest**:
The immutable composition of a base runtime, approved Operator Artifacts, locked dependencies, Model Artifact references, and an execution policy needed by one or more Plans.
_Avoid_: Capability, Docker tag

**Plan**:
An immutable, approved Data-Juicer recipe plus exact capability bindings, acceptance criteria, resource profile, and output contract for a specific task.
_Avoid_: Runtime, capability proposal

**Dataset Snapshot**:
An immutable staged copy of a task's input manifest and referenced local assets, with container-safe paths and verified hashes.
_Avoid_: Workspace mount, source folder

**Run**:
One execution of an approved Plan against its Dataset Snapshot using a resolved Runtime Manifest.
_Avoid_: Plan, container

**Business Output**:
A file intentionally produced for the user by a Run, including result media, structured records, reports, or model artifacts; it excludes logs, caches, temporary files, and private runtime state.
_Avoid_: Every file in the Run directory, input file

**Result Manifest**:
The immutable integrity inventory of a Run's Business Outputs, identified by relative path, size, and content hash.
_Avoid_: Dataset View, directory listing

**Dataset View**:
The presentation-neutral description that groups Business Outputs into samples, file roles, labels, metrics, and dataset documents.
_Avoid_: Result Manifest, UI layout

**Sample Label**:
A Plan-declared categorical fact about one result sample, represented by a stable machine key and a display name.
_Avoid_: File role, quality metric, run status

**File Role**:
The relationship of one Business Output to its sample, such as original, mask, overlay, result, or attachment.
_Avoid_: Sample label, file extension

**Quality Metric**:
A Plan-declared finite measurement about a sample or dataset, with an explicit type, range, and missing-value policy.
_Avoid_: Sample label, display text

**Result Publication**:
The idempotent transition that verifies a Run's Business Outputs, publishes their storage location, registers ownership, and yields an opaque Dataset reference.
_Avoid_: Run completion, file copy

**Dataset Result**:
The user-owned, durable catalog entry created by Result Publication for one Run.
_Avoid_: Run output directory, input dataset, shared dataset

**Promotion**:
The reviewed movement of a proven external Operator Artifact into the department operator library or the maintained Data-Juicer fork.
_Avoid_: Capability approval, automatic publication
