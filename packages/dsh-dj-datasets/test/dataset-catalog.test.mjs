import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatasetCatalog, DatasetError } from "../lib/dataset-catalog.js";

const userA = { userId: "usr_a", username: "A", role: "user", sessionId: "auth_a" };
const userB = { userId: "usr_b", username: "B", role: "user", sessionId: "auth_b" };
const admin = { userId: "usr_admin", username: "Admin", role: "admin", sessionId: "auth_admin" };

function fixture() {
  const roots = new Map([
    ["session-a", "usr_a"],
    ["session-b", "usr_b"],
  ]);
  const inspected = new Map();
  const deleted = [];
  const identityAccess = {
    sessionOwner(sessionId) { return roots.get(sessionId) ?? null; },
    canAccessSession(principal, sessionId) {
      return principal?.role === "admin" || roots.get(sessionId) === principal?.userId;
    },
  };
  const runOutputPort = {
    async inspect(origin) { return inspected.get(origin.resultRef) ?? null; },
    async delete(origin, expectedManifestHash) {
      deleted.push({ origin, expectedManifestHash });
      return { deleted: true };
    },
  };
  const catalog = new DatasetCatalog({
    databasePath: join(mkdtempSync(join(tmpdir(), "dsh-datasets-")), "datasets.sqlite"),
    identityAccess,
    runOutputPort,
    now: () => Date.UTC(2026, 7, 31),
  });
  const available = (resultRef, overrides = {}) => inspected.set(resultRef, {
    eligible: true,
    resultRef,
    taskId: "task_1",
    planVersion: "plan_v001",
    internalRunId: resultRef,
    title: "清洗结果",
    status: "available",
    createdAt: "2026-08-31T00:00:00Z",
    completedAt: "2026-08-31T00:01:00Z",
    manifestHash: `sha256:${resultRef}`,
    fileCount: 2,
    totalBytes: 30,
    recordCount: 2,
    labels: { 保留: 2 },
    metrics: { quality_score: { min: 0.4, max: 0.9, mean: 0.7 } },
    mediaTypes: { image: 2 },
    assets: [
      { assetId: "asset_image", itemId: "item_1", name: "a.png", mediaType: "image/png", size: 10, labels: ["保留"], metrics: { quality_score: 0.9 } },
      { assetId: "asset_jsonl", itemId: "item_2", name: "result.jsonl", mediaType: "application/x-ndjson", size: 20, labels: [], metrics: {} },
    ],
    ...overrides,
  });
  return { catalog, available, deleted };
}

test("registers each eligible run as a private result owned by the source conversation", async () => {
  const app = fixture();
  try {
    app.available("run_1");
    app.available("run_2", { taskId: "task_2", title: "第二次运行" });

    const first = await app.catalog.registerRunResult(userA, "session-a", {
      workspaceRoot: "D:\\workspace-a",
      taskId: "task_1",
      planVersion: "plan_v001",
      resultRef: "run_1",
    });
    const repeated = await app.catalog.registerRunResult(userA, "session-a", {
      workspaceRoot: "D:\\workspace-a",
      taskId: "task_1",
      planVersion: "plan_v001",
      resultRef: "run_1",
    });
    const second = await app.catalog.registerRunResult(userA, "session-a", {
      workspaceRoot: "D:\\workspace-a",
      taskId: "task_2",
      planVersion: "plan_v002",
      resultRef: "run_2",
    });

    assert.equal(repeated.datasetId, first.datasetId);
    assert.notEqual(second.datasetId, first.datasetId);
    assert.equal((await app.catalog.get(userA, first.datasetId)).metrics.quality_score.mean, 0.7);
    assert.deepEqual((await app.catalog.list(userA, {})).items.map(item => item.datasetId), [second.datasetId, first.datasetId]);
    assert.deepEqual((await app.catalog.list(userB, {})).items, []);
    assert.deepEqual((await app.catalog.list(admin, {})).items.map(item => item.ownerUserId), ["usr_a", "usr_a"]);
  } finally {
    app.catalog.close();
  }
});

test("does not register failed, errored, or output-free runs", async () => {
  const app = fixture();
  try {
    app.available("failed", { eligible: false, reason: "run_failed", assets: [] });
    app.available("empty", { eligible: false, reason: "no_verified_output", assets: [] });
    assert.equal(await app.catalog.registerRunResult(userA, "session-a", {
      workspaceRoot: "D:\\workspace-a", taskId: "task_1", planVersion: "plan_v001", resultRef: "failed",
    }), null);
    assert.equal(await app.catalog.registerRunResult(userA, "session-a", {
      workspaceRoot: "D:\\workspace-a", taskId: "task_1", planVersion: "plan_v001", resultRef: "empty",
    }), null);
    assert.equal((await app.catalog.list(userA, {})).total, 0);
  } finally {
    app.catalog.close();
  }
});

test("checks ownership again for detail, assets, and deletion", async () => {
  const app = fixture();
  try {
    app.available("run_private");
    const ref = await app.catalog.registerRunResult(userA, "session-a", {
      workspaceRoot: "D:\\workspace-a", taskId: "task_1", planVersion: "plan_v001", resultRef: "run_private",
    });
    for (const action of [
      () => app.catalog.get(userB, ref.datasetId),
      () => app.catalog.getAsset(userB, ref.datasetId, "asset_image"),
      () => app.catalog.getArchive(userB, ref.datasetId, ["asset_image"]),
      () => app.catalog.delete(userB, ref.datasetId, { manifestHash: "sha256:run_private", confirmed: true }),
    ]) {
      await assert.rejects(action, error => error instanceof DatasetError && error.code === "dataset_not_found");
    }
    assert.equal((await app.catalog.get(admin, ref.datasetId)).ownerUserId, "usr_a");
    assert.deepEqual((await app.catalog.getArchive(userA, ref.datasetId, ["asset_image"])).assetIds, ["asset_image"]);
    await assert.rejects(
      () => app.catalog.getArchive(userA, ref.datasetId, ["asset_unknown"]),
      error => error.code === "asset_not_found",
    );
    await app.catalog.delete(userA, ref.datasetId, { manifestHash: "sha256:run_private", confirmed: true });
    assert.equal(app.deleted.length, 1);
    await assert.rejects(() => app.catalog.get(userA, ref.datasetId), error => error.code === "dataset_not_found");
  } finally {
    app.catalog.close();
  }
});

test("filters a user's result list and items without exposing another owner", async () => {
  const app = fixture();
  try {
    app.available("run_a", { title: "图片筛选" });
    app.available("run_b", { title: "视频筛选", mediaTypes: { video: 1 }, assets: [{ assetId: "video", itemId: "v1", name: "clip.mp4", mediaType: "video/mp4", size: 12, labels: ["高清"], metrics: {} }] });
    const image = await app.catalog.registerRunResult(userA, "session-a", { workspaceRoot: "D:\\a", taskId: "task_1", planVersion: "v1", resultRef: "run_a" });
    await app.catalog.registerRunResult(userB, "session-b", { workspaceRoot: "D:\\b", taskId: "task_2", planVersion: "v1", resultRef: "run_b" });

    assert.equal((await app.catalog.list(userA, { q: "图片" })).total, 1);
    assert.equal((await app.catalog.list(userA, { mediaType: "video" })).total, 0);
    assert.deepEqual((await app.catalog.listItems(userA, image.datasetId, { q: "a.png", label: "保留", mediaType: "image" })).items.map(item => item.assetId), ["asset_image"]);
  } finally {
    app.catalog.close();
  }
});
