import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DatasetCatalog } from "../lib/dataset-catalog.js";
import { RunOutputHttpAdapter } from "../lib/run-output-http.js";

function required(name, value) {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function sha256File(path) {
  return "sha256:" + createHash("sha256").update(readFileSync(path)).digest("hex");
}

function stableId(value, length = 12) {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

function filesBelow(root) {
  const result = [];
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`symbolic links are not importable: ${path}`);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) result.push(path);
    }
  };
  visit(root);
  return result.sort();
}

function copySnapshot(sourceRoot, outputRoot) {
  if (existsSync(outputRoot)) return;
  mkdirSync(outputRoot, { recursive: false });
  for (const source of filesBelow(sourceRoot)) {
    const target = join(outputRoot, relative(sourceRoot, source));
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
  }
}

function metricSummary(records, name) {
  const values = records.map(item => Number(item?.[name])).filter(Number.isFinite);
  if (!values.length) return undefined;
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
  };
}

function buildView(sourceManifest) {
  const records = Array.isArray(sourceManifest.records) ? sourceManifest.records : [];
  const labelsFor = record => {
    if (record.status !== "ok") return ["处理失败"];
    const labels = [Number(record.face_count) > 1 ? "多人脸" : "单人脸"];
    const score = Number(record.detection_score);
    if (Number.isFinite(score)) labels.push(score < 0.3 ? "低置信度" : score < 0.6 ? "中置信度" : "高置信度");
    return labels;
  };
  const items = [];
  for (const record of records) {
    const stem = String(record.image || "").replace(/\.[^.]+$/, "");
    const metrics = {
      detection_score: record.detection_score,
      mask_fraction: record.mask_fraction,
      face_count: record.face_count,
      total_seconds: record.total_seconds,
    };
    items.push({
      item_id: `overlay_${stem}`,
      sample_id: stem,
      variant: "overlay",
      variant_label: "叠加预览",
      asset_path: `overlays/${stem}.jpg`,
      display_name: `${stem} · 叠加预览.jpg`,
      media_type: "image/jpeg",
      labels: labelsFor(record),
      metrics,
    });
    items.push({
      item_id: `mask_${stem}`,
      sample_id: stem,
      variant: "mask",
      variant_label: "蒙版",
      asset_path: `masks/${stem}.png`,
      display_name: `${stem} · 人脸蒙版.png`,
      media_type: "image/png",
      labels: labelsFor(record),
      metrics,
    });
  }
  const metrics = Object.fromEntries(
    ["detection_score", "mask_fraction", "face_count", "total_seconds"]
      .map(name => [name, metricSummary(records, name)])
      .filter(([, value]) => value),
  );
  return {
    schema_version: 1,
    title: "Buffalo + BiSeNet 人脸处理结果（CPU）",
    summary: {
      record_count: Number(sourceManifest.success_count ?? records.length),
      labels: records.flatMap(labelsFor).reduce((counts, label) => ({ ...counts, [label]: (counts[label] || 0) + 1 }), {}),
      metrics,
    },
    items,
    documents: [],
  };
}

function writeManagedMetadata({ workspaceRoot, outputRoot, taskId, planVersion, runId, sourceRoot }) {
  const sourceManifest = JSON.parse(readFileSync(join(sourceRoot, "manifest.json"), "utf8"));
  const inventory = filesBelow(outputRoot)
    .filter(path => !["result-manifest.json", "dataset-view.json"].includes(basename(path)))
    .map(path => {
      const pathRelative = relative(outputRoot, path).split(sep).join("/");
      return { path: pathRelative, size_bytes: statSync(path).size, sha256: sha256File(path) };
    });
  const now = new Date(statSync(join(sourceRoot, "manifest.json")).mtimeMs).toISOString();
  writeFileSync(join(outputRoot, "dataset-view.json"), JSON.stringify(buildView(sourceManifest), null, 2) + "\n");
  writeFileSync(join(outputRoot, "result-manifest.json"), JSON.stringify({
    schema_version: 1,
    run_id: runId,
    finished_at: now,
    output_count: inventory.length,
    output_size_bytes: inventory.reduce((sum, item) => sum + item.size_bytes, 0),
    outputs: inventory,
  }, null, 2) + "\n");

  const taskRoot = join(workspaceRoot, ".dj", "tasks", taskId);
  const runRoot = join(taskRoot, "runs", runId);
  mkdirSync(runRoot, { recursive: true });
  writeFileSync(join(taskRoot, "task.yaml"), JSON.stringify({
    schema_version: 1,
    task_id: taskId,
    title: "Buffalo + BiSeNet 人脸处理结果（CPU）",
    task_slug: "buffalo-bisenet-cpu-import",
    workspace_root: workspaceRoot,
    created_at: now,
  }, null, 2) + "\n");
  writeFileSync(join(runRoot, "run.json"), JSON.stringify({
    task_id: taskId,
    plan_version: planVersion,
    run_id: runId,
    status: "succeeded",
    output_dir: outputRoot,
    created_at: now,
    updated_at: now,
    imported_from: sourceRoot,
  }, null, 2) + "\n");
}

function resolveOwner(authDatabasePath, username) {
  const db = new DatabaseSync(authDatabasePath, { readOnly: true });
  try {
    const user = username
      ? db.prepare("SELECT user_id, username_display, role FROM users WHERE username_normalized = ? AND status = 'active'").get(username.toLocaleLowerCase("und"))
      : db.prepare("SELECT user_id, username_display, role FROM users WHERE status = 'active' ORDER BY created_at LIMIT 1").get();
    if (!user) throw new Error("no matching active user");
    const source = db.prepare("SELECT session_id FROM session_owners WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").get(user.user_id);
    if (!source) throw new Error("the selected user owns no DSH conversation");
    return { user, sessionId: source.session_id };
  } finally {
    db.close();
  }
}

const sourceRoot = resolve(required("source directory", process.argv[2]));
const workspaceRoot = resolve(process.argv[3] || dirname(dirname(sourceRoot)));
const username = process.argv[4] || "";
const refresh = process.argv.includes("--refresh");
if (!existsSync(join(sourceRoot, "manifest.json"))) throw new Error("source manifest.json was not found");
const sourceFingerprint = stableId(sourceRoot.toLocaleLowerCase("und"));
const taskId = `task_import${sourceFingerprint}`;
const planVersion = "plan_v001";
const runId = "run_r001";
const outputRoot = join(workspaceRoot, "outputs", "imports", `buffalo-bisenet-cpu-${sourceFingerprint}`);
mkdirSync(dirname(outputRoot), { recursive: true });
copySnapshot(sourceRoot, outputRoot);
writeManagedMetadata({ workspaceRoot, outputRoot, taskId, planVersion, runId, sourceRoot });

const appRoot = resolve(import.meta.dirname, "..", "..", "..");
const authDatabasePath = join(appRoot, ".dsh", "auth.sqlite");
const datasetDatabasePath = join(appRoot, ".dsh", "datasets.sqlite");
const token = readFileSync(join(appRoot, ".dsh", "dj-internal-token"), "utf8").trim();
const { user, sessionId } = resolveOwner(authDatabasePath, username);
if (refresh) {
  const db = new DatabaseSync(datasetDatabasePath);
  try {
    db.prepare(`DELETE FROM datasets
      WHERE owner_user_id = ? AND workspace_root = ? AND task_id = ? AND plan_version = ? AND result_ref = ?`)
      .run(user.user_id, workspaceRoot, taskId, planVersion, runId);
  } finally {
    db.close();
  }
}
const identityAccess = {
  sessionOwner(candidate) { return candidate === sessionId ? user.user_id : null; },
  canAccessSession(principal, candidate) { return candidate === sessionId && principal.userId === user.user_id; },
};
const catalog = new DatasetCatalog({
  databasePath: datasetDatabasePath,
  identityAccess,
  runOutputPort: new RunOutputHttpAdapter({ token }),
});
try {
  const dataset = await catalog.registerRunResult({
    userId: user.user_id,
    username: user.username_display,
    role: user.role,
    sessionId: "local-maintenance-import",
  }, sessionId, { workspaceRoot, taskId, planVersion, resultRef: runId });
  console.log(JSON.stringify({ ok: true, dataset, managedOutputRoot: outputRoot, sourceRoot }, null, 2));
} finally {
  catalog.close();
}
