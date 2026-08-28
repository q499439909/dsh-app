# TaskSpec and Requirements Clarification

## Meaning of clarity

A clear TaskSpec does not require every fact to have a concrete value. It means the business intent is sufficient for the next stage and every unknown has an explicit resolution owner: the user, input inspection, capability discovery, or environment probing.

A TaskSpec is compact decision state, not a checklist that must be expanded into questions or narrated in the model's reasoning. An empty field is not itself a Material Ambiguity.

Classify each unknown as one of:

- `known`: a reliable value is available.
- `unknown_discoverable`: `inspect_input`, `search_capabilities`, or environment probing can obtain it.
- `unresolved_user_owned`: the user must decide it; data and environment facts cannot determine it.

## TaskSpec

Maintain this structure before generating any pipeline, recipe, or postprocess proposal. Fields that do not apply may remain empty, but do not omit requirement categories that affect planning.

```yaml
task_spec:
  status: draft # draft | discovery_ready | plan_ready
  input:
    sources: []
    formats: []
  output:
    artifacts: []
    formats: []
    destination: null
  scale:
    record_count: null
    data_size: null
    execution_budget: null
  categories_and_distribution:
    categories: []
    current_distribution: null
    target_distribution: null
  constraints:
    hard: []
    soft: []
  semantic_boundaries:
    positive_examples: []
    negative_examples: []
    boundary_cases: []
  acceptance_criteria: []
  optimization_objectives: []
  execution_capabilities:
    available_tools: []
    available_operators: []
    runtime_limits: []
  material_ambiguities: []
  assumptions: []
```

A TaskSpec is `discovery_ready` when the input can be located, its output and processing goals can direct inspection and discovery, and no `unresolved_user_owned` Material Ambiguity would change the inspection target or search direction. Scale, actual formats, current category distribution, and available operators may remain `unknown_discoverable`.

A TaskSpec is `plan_ready` when discovery findings have been incorporated, no Material Ambiguity remains unresolved, and its hard constraints, soft preferences, semantic boundaries, acceptance criteria, and optimization objectives are sufficient for pipeline planning.

## Material Ambiguity

Do not ask about every vague detail. An ambiguity is material only when different interpretations would substantially change one or more of:

- pipeline topology or steps;
- important parameters or thresholds;
- operator, model, or tool selection;
- data categories or target distribution;
- evaluation method or acceptance outcome;
- cost, risk, or execution feasibility.

Mark automatically obtainable facts as `unknown_discoverable` and obtain them without asking the user. For each Material Ambiguity, record the issue, why confirmation is necessary, the affected pipeline parts, and its resolution state.

```yaml
material_ambiguities:
  - issue: "The meaning of high-quality data is unclear"
    why_material: "Different definitions change filtering and evaluation"
    pipeline_impact: [operator_selection, thresholds, evaluation, acceptance]
    status: unresolved_user_owned
```

## Question method

- For vague numeric requirements, ask for an explicit range or bounds.
- When hard and soft constraints are mixed, ask the user to classify the constraint level.
- For terms such as “obvious,” “complex,” “large,” or “high quality” that are hard to quantify, prefer positive, negative, and boundary examples over asking the user for technical thresholds.
- Explain why each answer is needed and which pipeline parts different answers affect.
- Ask 1–3 high-impact questions that block the current stage per round when practical. If one question already blocks the next stage, ask only that question and defer later planning, implementation, and acceptance questions.
- Before discovery, ask only for user decisions required to reach `discovery_ready`; do not try to complete the final TaskSpec in one pass.
- After discovery, ask only about newly exposed user decisions that would still materially change the pipeline.
- Do not ask merely because acceptance criteria, expected count, output format, or execution capability fields are empty. When the user's wording establishes a conventional answer, record that reasonable interpretation; ask only if alternatives would genuinely change the pipeline.
- Determine detection approach, operator capability, and execution environment through discovery before asking the user. Only new permissions, costs, and business tradeoffs are user-owned decisions.

When the session provides `ask_user_question`, use it for questions that need a user response. Otherwise ask concise plain-text questions. Clarifying the requirement is more important than the interaction form.

## Planning gate

Once the TaskSpec is `plan_ready`, show the user its structured requirements summary and objectively decidable acceptance criteria, then obtain explicit confirmation. Do not generate a pipeline before confirmation. The original request is not confirmation of the normalized TaskSpec.
