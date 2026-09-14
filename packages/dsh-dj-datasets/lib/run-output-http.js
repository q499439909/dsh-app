import { DatasetError } from "./dataset-catalog.js";

function loopbackBase(value) {
  const url = new URL(String(value || "http://127.0.0.1:8010"));
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
    throw new Error("run-output-http: baseUrl must be loopback HTTP");
  }
  return url;
}

export class RunOutputHttpAdapter {
  constructor(options = {}) {
    this.baseUrl = loopbackBase(options.baseUrl);
    this.token = String(options.token || "");
    if (!this.token) throw new Error("run-output-http: internal token is required");
    this.fetch = options.fetch ?? globalThis.fetch;
    this.getUserId = options.getUserId;
    this.timeoutMs = Math.max(1000, Math.min(Number(options.timeoutMs) || 30000, 120000));
  }

  resultUrl(path, origin) {
    const url = new URL(path, this.baseUrl);
    url.searchParams.set("workspace_root", String(origin.workspaceRoot));
    url.searchParams.set("task_id", String(origin.taskId));
    url.searchParams.set("plan_version", String(origin.planVersion));
    url.searchParams.set("result_ref", String(origin.resultRef));
    return url;
  }

  headers(extra = {}) {
    const userId = this.getUserId?.();
    if (this.getUserId && !userId) throw new DatasetError("account_required", "请先登录", 403);
    return { "x-dsh-internal-token": this.token, ...(userId ? {"x-dsh-user-id": userId} : {}), ...extra };
  }

  async listRuns(cursor = "0") {
    const url = new URL("/internal/task-runs", this.baseUrl);
    url.searchParams.set("cursor", cursor);
    return this.json(await this.fetch(url, { headers: this.headers(), signal: AbortSignal.timeout(this.timeoutMs) }));
  }

  async inspect(origin) {
    const response = await this.fetch(this.resultUrl("/internal/run-output", origin), {
      headers: this.headers({ accept: "application/json" }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const result = await this.json(response);
    if (result.eligible && this.getUserId && result.ownerId !== this.getUserId()) throw new DatasetError("result_owner_conflict", "结果所有者不匹配", 403);
    return result;
  }

  async openAsset(origin, assetId, options = {}) {
    const url = this.resultUrl("/internal/run-asset", origin);
    url.searchParams.set("asset_id", String(assetId));
    if (options.download) url.searchParams.set("download", "1");
    const response = await this.fetch(url, {
      headers: this.headers({
        accept: "*/*",
        ...(options.range ? { range: String(options.range) } : {}),
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) await this.json(response);
    return response;
  }

  async openArchive(origin, assetIds = []) {
    const url = this.resultUrl("/internal/run-archive", origin);
    const selected = [...new Set(assetIds.map(String).filter(Boolean))];
    if (selected.length) selected.forEach(assetId => url.searchParams.append("asset_id", assetId));
    else url.searchParams.set("all", "1");
    const response = await this.fetch(url, {
      headers: this.headers({ accept: "application/zip" }),
      signal: AbortSignal.timeout(Math.max(this.timeoutMs, 120000)),
    });
    if (!response.ok) await this.json(response);
    return response;
  }

  async delete(origin, expectedManifestHash) {
    const response = await this.fetch(this.resultUrl("/internal/run-output", origin), {
      method: "DELETE",
      headers: this.headers({ accept: "application/json", "if-match": String(expectedManifestHash) }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    return this.json(response);
  }

  async json(response) {
    let payload;
    try { payload = await response.json(); } catch { payload = null; }
    if (!response.ok || !payload || (payload.ok === false && payload.eligible === undefined)) {
      const error = payload?.error;
      throw new DatasetError(
        String(error?.code || "result_service_unavailable").toLocaleLowerCase(),
        String(error?.message || "结果服务暂时不可用"),
        response.status || 502,
      );
    }
    return payload;
  }
}
