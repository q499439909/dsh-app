import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export class DatasetError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "DatasetError";
    this.code = code;
    this.status = status;
  }
}

function opaqueId(prefix) {
  return `${prefix}_${randomBytes(18).toString("base64url")}`;
}

function json(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function originKey(origin) {
  return createHash("sha256").update([
    origin.workspaceRoot,
    origin.taskId,
    origin.planVersion,
    origin.resultRef,
  ].map(value => String(value ?? "")).join("\0")).digest("hex");
}

function requirePrincipal(principal) {
  if (!principal?.userId || !["admin", "user"].includes(principal.role)) {
    throw new DatasetError("authentication_required", "请先登录", 401);
  }
}

function publicDataset(row, includeAssets = false) {
  const result = {
    datasetId: row.dataset_id,
    ownerUserId: row.owner_user_id,
    title: row.title,
    status: row.status,
    taskId: row.task_id,
    planVersion: row.plan_version,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    manifestHash: row.manifest_hash,
    fileCount: row.file_count,
    totalBytes: row.total_bytes,
    recordCount: row.record_count,
    labels: json(row.labels_json, {}),
    metrics: json(row.metrics_json, {}),
    mediaTypes: json(row.media_types_json, {}),
  };
  if (includeAssets) result.assets = json(row.assets_json, []);
  return result;
}

function normalizedLimit(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? Math.min(number, MAX_LIMIT) : DEFAULT_LIMIT;
}

export class DatasetCatalog {
  constructor(options) {
    if (!options?.databasePath) throw new Error("dataset-catalog: databasePath is required");
    if (!options?.identityAccess) throw new Error("dataset-catalog: identityAccess is required");
    if (!options?.runOutputPort) throw new Error("dataset-catalog: runOutputPort is required");
    this.identityAccess = options.identityAccess;
    this.runOutputPort = options.runOutputPort;
    this.now = options.now ?? Date.now;
    mkdirSync(dirname(options.databasePath), { recursive: true });
    this.db = new DatabaseSync(options.databasePath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.migrate();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS datasets (
        dataset_id TEXT PRIMARY KEY,
        origin_key TEXT NOT NULL UNIQUE,
        owner_user_id TEXT NOT NULL,
        source_session_id TEXT NOT NULL,
        workspace_root TEXT NOT NULL,
        task_id TEXT NOT NULL,
        plan_version TEXT NOT NULL,
        result_ref TEXT NOT NULL,
        internal_run_id TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('available', 'partial')),
        created_at TEXT,
        completed_at TEXT,
        manifest_hash TEXT NOT NULL,
        file_count INTEGER NOT NULL,
        total_bytes INTEGER NOT NULL,
        record_count INTEGER,
        labels_json TEXT NOT NULL,
        metrics_json TEXT NOT NULL,
        media_types_json TEXT NOT NULL,
        assets_json TEXT NOT NULL,
        storage_kind TEXT NOT NULL DEFAULT 'local',
        storage_location_version INTEGER NOT NULL DEFAULT 1,
        indexed_at INTEGER NOT NULL,
        deleted_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS datasets_owner_recent
        ON datasets(owner_user_id, deleted_at, indexed_at DESC);
      CREATE TABLE IF NOT EXISTS dataset_tombstones (
        dataset_id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL,
        deleted_at INTEGER NOT NULL,
        manifest_hash TEXT NOT NULL
      );
    `);
  }

  close() {
    this.db.close();
  }

  async registerRunResult(principal, sessionId, origin) {
    requirePrincipal(principal);
    if (!this.identityAccess.canAccessSession(principal, sessionId)) {
      throw new DatasetError("session_not_found", "找不到对应对话", 404);
    }
    const ownerUserId = this.identityAccess.sessionOwner(sessionId);
    if (!ownerUserId) throw new DatasetError("result_unclaimed", "运行结果没有可确认的所有者", 409);
    if (principal.role !== "admin" && ownerUserId !== principal.userId) {
      throw new DatasetError("session_not_found", "找不到对应对话", 404);
    }
    const normalizedOrigin = {
      workspaceRoot: String(origin?.workspaceRoot ?? ""),
      taskId: String(origin?.taskId ?? ""),
      planVersion: String(origin?.planVersion ?? ""),
      resultRef: String(origin?.resultRef ?? ""),
    };
    if (Object.values(normalizedOrigin).some(value => !value)) {
      throw new DatasetError("invalid_result_origin", "结果引用不完整", 400);
    }
    const key = originKey(normalizedOrigin);
    const existing = this.db.prepare("SELECT * FROM datasets WHERE origin_key = ?").get(key);
    if (existing) {
      if (existing.owner_user_id !== ownerUserId) {
        throw new DatasetError("result_owner_conflict", "运行结果已经属于其他用户", 409);
      }
      return existing.deleted_at === null ? publicDataset(existing) : null;
    }

    const inspected = await this.runOutputPort.inspect(normalizedOrigin);
    if (!inspected?.eligible || !Array.isArray(inspected.assets) || inspected.assets.length === 0) return null;
    const status = inspected.status === "available" ? "available" : "partial";
    const datasetId = opaqueId("ds");
    const row = {
      dataset_id: datasetId,
      origin_key: key,
      owner_user_id: ownerUserId,
      source_session_id: String(sessionId),
      workspace_root: normalizedOrigin.workspaceRoot,
      task_id: String(inspected.taskId || normalizedOrigin.taskId),
      plan_version: String(inspected.planVersion || normalizedOrigin.planVersion),
      result_ref: normalizedOrigin.resultRef,
      internal_run_id: String(inspected.internalRunId || normalizedOrigin.resultRef),
      title: String(inspected.title || "管线结果").slice(0, 300),
      status,
      created_at: inspected.createdAt ? String(inspected.createdAt) : null,
      completed_at: inspected.completedAt ? String(inspected.completedAt) : null,
      manifest_hash: String(inspected.manifestHash || ""),
      file_count: Number(inspected.fileCount ?? inspected.assets.length),
      total_bytes: Number(inspected.totalBytes ?? 0),
      record_count: Number.isFinite(Number(inspected.recordCount)) ? Number(inspected.recordCount) : null,
      labels_json: JSON.stringify(inspected.labels ?? {}),
      metrics_json: JSON.stringify(inspected.metrics ?? {}),
      media_types_json: JSON.stringify(inspected.mediaTypes ?? {}),
      assets_json: JSON.stringify(inspected.assets),
      indexed_at: this.now(),
    };
    if (!row.manifest_hash) throw new DatasetError("invalid_result_manifest", "结果清单缺少完整性标识", 409);
    this.db.prepare(`
      INSERT INTO datasets (
        dataset_id, origin_key, owner_user_id, source_session_id, workspace_root,
        task_id, plan_version, result_ref, internal_run_id, title, status,
        created_at, completed_at, manifest_hash, file_count, total_bytes, record_count,
        labels_json, metrics_json, media_types_json, assets_json, indexed_at
      ) VALUES (
        @dataset_id, @origin_key, @owner_user_id, @source_session_id, @workspace_root,
        @task_id, @plan_version, @result_ref, @internal_run_id, @title, @status,
        @created_at, @completed_at, @manifest_hash, @file_count, @total_bytes, @record_count,
        @labels_json, @metrics_json, @media_types_json, @assets_json, @indexed_at
      )
    `).run(row);
    return publicDataset(row);
  }

  async list(principal, query = {}) {
    requirePrincipal(principal);
    const conditions = ["deleted_at IS NULL"];
    const params = {};
    if (principal.role !== "admin") {
      conditions.push("owner_user_id = @owner");
      params.owner = principal.userId;
    } else if (query.ownerId) {
      conditions.push("owner_user_id = @owner");
      params.owner = String(query.ownerId);
    }
    if (query.q) {
      conditions.push("title LIKE @q ESCAPE '\\'");
      params.q = `%${String(query.q).replace(/[\\%_]/g, "\\$&")}%`;
    }
    if (query.status) {
      conditions.push("status = @status");
      params.status = String(query.status);
    }
    if (query.mediaType) {
      conditions.push("media_types_json LIKE @media");
      params.media = `%${String(query.mediaType)}%`;
    }
    const where = conditions.join(" AND ");
    const total = Number(this.db.prepare(`SELECT COUNT(*) AS count FROM datasets WHERE ${where}`).get(params).count);
    const limit = normalizedLimit(query.limit);
    const offset = Math.max(0, Number(query.offset) || 0);
    const rows = this.db.prepare(`SELECT * FROM datasets WHERE ${where} ORDER BY indexed_at DESC, rowid DESC LIMIT @limit OFFSET @offset`)
      .all({ ...params, limit, offset });
    return { items: rows.map(row => publicDataset(row)), total, offset, limit };
  }

  visibleRow(principal, datasetId) {
    requirePrincipal(principal);
    const row = this.db.prepare("SELECT * FROM datasets WHERE dataset_id = ? AND deleted_at IS NULL").get(String(datasetId));
    if (!row || (principal.role !== "admin" && row.owner_user_id !== principal.userId)) {
      throw new DatasetError("dataset_not_found", "找不到结果", 404);
    }
    return row;
  }

  async get(principal, datasetId) {
    return publicDataset(this.visibleRow(principal, datasetId), true);
  }

  async listItems(principal, datasetId, query = {}) {
    const row = this.visibleRow(principal, datasetId);
    let items = json(row.assets_json, []);
    if (query.q) {
      const term = String(query.q).toLocaleLowerCase();
      items = items.filter(item => String(item.name || "").toLocaleLowerCase().includes(term));
    }
    if (query.label) items = items.filter(item => Array.isArray(item.labels) && item.labels.includes(String(query.label)));
    if (query.mediaType) items = items.filter(item => String(item.mediaType || "").startsWith(String(query.mediaType)));
    const total = items.length;
    const limit = normalizedLimit(query.limit);
    const offset = Math.max(0, Number(query.offset) || 0);
    return { items: items.slice(offset, offset + limit), total, offset, limit };
  }

  async getAsset(principal, datasetId, assetId) {
    const row = this.visibleRow(principal, datasetId);
    const asset = json(row.assets_json, []).find(item => item.assetId === String(assetId));
    if (!asset) throw new DatasetError("asset_not_found", "找不到结果文件", 404);
    return { dataset: publicDataset(row), asset, origin: {
      workspaceRoot: row.workspace_root,
      taskId: row.task_id,
      planVersion: row.plan_version,
      resultRef: row.result_ref,
    } };
  }

  async getArchive(principal, datasetId, assetIds = []) {
    const row = this.visibleRow(principal, datasetId);
    const assets = json(row.assets_json, []);
    const selected = [...new Set(assetIds.map(String).filter(Boolean))];
    if (selected.length) {
      const visibleIds = new Set(assets.map(item => item.assetId));
      if (selected.some(assetId => !visibleIds.has(assetId))) {
        throw new DatasetError("asset_not_found", "找不到结果文件", 404);
      }
    }
    return { assetIds: selected, origin: {
      workspaceRoot: row.workspace_root,
      taskId: row.task_id,
      planVersion: row.plan_version,
      resultRef: row.result_ref,
    } };
  }

  async delete(principal, datasetId, confirmation = {}) {
    const row = this.visibleRow(principal, datasetId);
    if (confirmation.confirmed !== true || confirmation.manifestHash !== row.manifest_hash) {
      throw new DatasetError("delete_confirmation_required", "删除确认已失效，请刷新后重试", 409);
    }
    const origin = {
      workspaceRoot: row.workspace_root,
      taskId: row.task_id,
      planVersion: row.plan_version,
      resultRef: row.result_ref,
    };
    await this.runOutputPort.delete(origin, row.manifest_hash);
    const deletedAt = this.now();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("UPDATE datasets SET deleted_at = ? WHERE dataset_id = ? AND deleted_at IS NULL").run(deletedAt, row.dataset_id);
      this.db.prepare("INSERT OR REPLACE INTO dataset_tombstones (dataset_id, owner_user_id, deleted_at, manifest_hash) VALUES (?, ?, ?, ?)")
        .run(row.dataset_id, row.owner_user_id, deletedAt, row.manifest_hash);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return { deleted: true, datasetId: row.dataset_id };
  }
}
