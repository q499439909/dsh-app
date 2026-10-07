import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, join, resolve, sep } from "node:path";

/**
 * Results Center (Host half).
 *
 * Serves read-only Data-Juicer run-output information to the Web client:
 * - GET /api/results-center/runs        -> discovered run list with summaries
 * - GET /api/results-center/run?ref=    -> one run's files, groups, records
 * - GET /api/results-center/asset?ref=&path= -> stream one file from a run dir
 *
 * Discovery scans `<workspace>/outputs` of every registered workspace for
 * `run_r*` directories (bounded depth, capped counts). The `ref` of every
 * payload is the absolute run directory; every route re-validates that a ref
 * stays inside a known outputs root, and asset paths are additionally forced
 * inside the run directory itself, so no arbitrary file can be requested.
 * All routes are GET-only and same-origin; responses are nosniff.
 */

export const name = "results-center";
export const inject = ["webServer", "workspaceRegistry"];

const ROUTE_RUNS = "/api/results-center/runs";
const ROUTE_RUN = "/api/results-center/run";
const ROUTE_ASSET = "/api/results-center/asset";

const MAX_RUNS = 100;
const MAX_WALK_DEPTH = 5;
const MAX_FILES_PER_RUN = 2000;
const MAX_JSONL_BYTES = 20 * 1024 * 1024;
const MAX_RECORDS_PER_GROUP = 2000;
const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
const MAX_SUMMARY_BYTES = 64 * 1024;

const RUN_DIR_RE = /^run_r\w*$/i;

const IMAGE_TYPES = {
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".png": "image/png",
	".gif": "image/gif",
	".webp": "image/webp",
	".bmp": "image/bmp",
	".svg": "image/svg+xml",
};

const TEXT_TYPES = {
	".md": "text/markdown; charset=utf-8",
	".txt": "text/plain; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".jsonl": "application/x-ndjson; charset=utf-8",
	".csv": "text/csv; charset=utf-8",
	".yaml": "text/yaml; charset=utf-8",
	".yml": "text/yaml; charset=utf-8",
};

function sendJson(res, status, payload) {
	const body = JSON.stringify(payload);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "private, no-store",
		"content-length": Buffer.byteLength(body),
		"x-content-type-options": "nosniff",
	});
	res.end(body);
}

function sameOrigin(req) {
	const origin = req.headers.origin;
	if (!origin) {
		return true;
	}
	try {
		return Boolean(req.headers.host) && new URL(origin).host === req.headers.host;
	} catch {
		return false;
	}
}

/** Every registered workspace contributes `<path>/outputs` as a scan root. */
function outputRoots(ctx) {
	const roots = new Map();
	let list = [];
	try {
		list = typeof ctx.workspaceRegistry?.list === "function" ? ctx.workspaceRegistry.list() : [];
	} catch {
		list = [];
	}
	for (const ws of list ?? []) {
		const path = typeof ws?.path === "string" ? ws.path : "";
		if (!path) {
			continue;
		}
		const root = resolve(path, "outputs");
		if (!roots.has(root)) {
			roots.set(root, { title: typeof ws.title === "string" && ws.title ? ws.title : basename(resolve(path)), path: resolve(path) });
		}
	}
	return roots;
}

async function findRunDirs(root, out, depth = 0) {
	if (depth > MAX_WALK_DEPTH || out.length >= MAX_RUNS) {
		return;
	}
	let entries;
	try {
		entries = await readdir(root, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		if (out.length >= MAX_RUNS) {
			return;
		}
		if (!entry.isDirectory()) {
			continue;
		}
		if (entry.name.startsWith(".") || entry.name === "node_modules") {
			continue;
		}
		const child = join(root, entry.name);
		if (RUN_DIR_RE.test(entry.name)) {
			out.push(child);
			continue;
		}
		await findRunDirs(child, out, depth + 1);
	}
}

async function readJsonFile(path, maxBytes) {
	let raw;
	try {
		raw = await readFile(path, "utf8");
	} catch {
		return undefined;
	}
	if (Buffer.byteLength(raw) > maxBytes) {
		return undefined;
	}
	try {
		return JSON.parse(raw);
	} catch {
		return undefined;
	}
}

async function walkFiles(root, prefix, out) {
	if (out.length >= MAX_FILES_PER_RUN) {
		return;
	}
	let entries;
	try {
		entries = await readdir(root, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		if (out.length >= MAX_FILES_PER_RUN) {
			return;
		}
		if (entry.name.startsWith(".")) {
			continue;
		}
		const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
		const full = join(root, entry.name);
		if (entry.isDirectory()) {
			await walkFiles(full, rel, out);
			continue;
		}
		if (!entry.isFile()) {
			continue;
		}
		const st = await stat(full).catch(() => null);
		out.push({ path: rel, size: st?.isFile() ? st.size : 0 });
	}
}

async function describeRun(runDir, rootInfo) {
	const manifest = await readJsonFile(join(runDir, "result-manifest.json"), MAX_MANIFEST_BYTES);
	const summary = await readJsonFile(join(runDir, "split_summary.json"), MAX_SUMMARY_BYTES);
	const st = await stat(runDir).catch(() => null);
	const segments = String(runDir).split(/[\\/]+/).filter(Boolean);
	const outputsIdx = segments.lastIndexOf("outputs");
	const tail = outputsIdx >= 0 ? segments.slice(outputsIdx + 1) : [];
	const taskId = tail.find((s) => /^task_\w+$/i.test(s)) ?? null;
	const planVersion = tail.find((s) => /^plan_v\w+$/i.test(s)) ?? null;
	const slug = tail.length > 0 ? tail[0] : null;
	return {
		ref: runDir,
		runId: typeof manifest?.run_id === "string" ? manifest.run_id : basename(runDir),
		taskId,
		planVersion,
		slug,
		workspace: rootInfo ? { title: rootInfo.title, path: rootInfo.path } : null,
		status: typeof manifest?.status === "string" ? manifest.status : "unknown",
		startedAt: typeof manifest?.started_at === "string" ? manifest.started_at : null,
		finishedAt: typeof manifest?.finished_at === "string" ? manifest.finished_at : null,
		outputCount: Number.isFinite(manifest?.output_count) ? manifest.output_count : 0,
		outputSizeBytes: Number.isFinite(manifest?.output_size_bytes) ? manifest.output_size_bytes : 0,
		mtimeMs: st ? st.mtimeMs : 0,
		summary: summary && typeof summary === "object" ? summary : null,
	};
}

function rootFor(runDir, roots) {
	const target = resolve(runDir);
	for (const root of roots.keys()) {
		if (target === root || target.startsWith(root + sep)) {
			return root;
		}
	}
	return null;
}

/** A valid ref is a `run_r*` directory strictly inside a known outputs root. */
function validRunRef(ref, roots) {
	if (typeof ref !== "string" || !ref || ref.includes("\0")) {
		return null;
	}
	const target = resolve(ref);
	if (!RUN_DIR_RE.test(basename(target))) {
		return null;
	}
	for (const root of roots.keys()) {
		if (target.startsWith(root + sep)) {
			return target;
		}
	}
	return null;
}

async function listRuns(ctx) {
	const roots = outputRoots(ctx);
	const dirs = [];
	for (const root of roots.keys()) {
		await findRunDirs(root, dirs);
	}
	const runs = [];
	for (const dir of dirs.slice(0, MAX_RUNS)) {
		const root = rootFor(dir, roots);
		runs.push(await describeRun(dir, root ? roots.get(root) : null));
	}
	runs.sort((a, b) => {
		const emptiness = (a.outputCount > 0 ? 0 : 1) - (b.outputCount > 0 ? 0 : 1);
		if (emptiness !== 0) {
			return emptiness;
		}
		return (b.mtimeMs || 0) - (a.mtimeMs || 0);
	});
	return runs;
}

async function handleRuns(ctx, req, res) {
	sendJson(res, 200, { ok: true, runs: await listRuns(ctx) });
}

async function handleRunDetail(ctx, req, res) {
	const url = new URL(req.url || ROUTE_RUN, "http://localhost");
	const roots = outputRoots(ctx);
	const runDir = validRunRef(url.searchParams.get("ref") || "", roots);
	if (!runDir) {
		sendJson(res, 403, { ok: false, error: "invalid_run_ref" });
		return;
	}
	const root = rootFor(runDir, roots);
	const run = await describeRun(runDir, root ? roots.get(root) : null);
	const files = [];
	await walkFiles(runDir, "", files);
	files.sort((a, b) => a.path.localeCompare(b.path));
	const groups = [];
	for (const file of files) {
		if (!file.path.toLowerCase().endsWith(".jsonl") || file.path.includes("/")) {
			continue;
		}
		let raw = null;
		try {
			raw = await readFile(join(runDir, file.path), "utf8");
		} catch {
			continue;
		}
		const name = file.path.replace(/\.jsonl$/i, "");
		if (Buffer.byteLength(raw) > MAX_JSONL_BYTES) {
			groups.push({ name, file: file.path, count: -1, tooLarge: true, records: [] });
			continue;
		}
		const records = [];
		let parseErrors = 0;
		for (const line of raw.split(/\r?\n/)) {
			const text = line.trim();
			if (!text) {
				continue;
			}
			if (records.length >= MAX_RECORDS_PER_GROUP) {
				parseErrors += 1;
				continue;
			}
			try {
				const record = JSON.parse(text);
				const images = Array.isArray(record?.images)
					? record.images.filter((x) => typeof x === "string")
					: [];
				const fields = {};
				if (record && typeof record === "object") {
					for (const [key, value] of Object.entries(record)) {
						if (key === "images" || key === "text") {
							continue;
						}
						fields[key] = value;
					}
				}
				records.push({ images, fields });
			} catch {
				parseErrors += 1;
			}
		}
		groups.push({ name, file: file.path, count: records.length, parseErrors, records });
	}
	sendJson(res, 200, { ok: true, run, files, groups });
}

async function handleAsset(ctx, req, res) {
	const url = new URL(req.url || ROUTE_ASSET, "http://localhost");
	const roots = outputRoots(ctx);
	const runDir = validRunRef(url.searchParams.get("ref") || "", roots);
	if (!runDir) {
		sendJson(res, 403, { ok: false, error: "invalid_run_ref" });
		return;
	}
	const rel = url.searchParams.get("path") || "";
	if (
		!rel ||
		rel.includes("\0") ||
		rel.includes("..") ||
		rel.startsWith("/") ||
		rel.startsWith("\\") ||
		/^[a-zA-Z]:/.test(rel)
	) {
		sendJson(res, 400, { ok: false, error: "invalid_path" });
		return;
	}
	const full = resolve(runDir, rel.split("/").join(sep));
	if (full !== runDir && !full.startsWith(runDir + sep)) {
		sendJson(res, 403, { ok: false, error: "path_outside_run" });
		return;
	}
	const st = await stat(full).catch(() => null);
	if (!st || !st.isFile()) {
		sendJson(res, 404, { ok: false, error: "not_found" });
		return;
	}
	const ext = extname(full).toLowerCase();
	const download = url.searchParams.get("download") === "1";
	const headers = {
		"content-type": IMAGE_TYPES[ext] || TEXT_TYPES[ext] || "application/octet-stream",
		"content-length": String(st.size),
		"cache-control": "private, max-age=300",
		"x-content-type-options": "nosniff",
	};
	if (download) {
		headers["content-disposition"] = `attachment; filename*=UTF-8''${encodeURIComponent(basename(full))}`;
	}
	res.writeHead(200, headers);
	const stream = createReadStream(full);
	stream.on("error", () => {
		res.destroy();
	});
	stream.pipe(res);
}

export function apply(ctx) {
	const guard = (handler) => async (req, res) => {
		try {
			if (!sameOrigin(req)) {
				sendJson(res, 403, { ok: false, error: "invalid_origin" });
				return;
			}
			if (req.method !== "GET") {
				res.setHeader("allow", "GET");
				sendJson(res, 405, { ok: false, error: "method_not_allowed" });
				return;
			}
			await handler(req, res);
		} catch (error) {
			sendJson(res, 500, { ok: false, error: "results_center_error", message: String(error?.message || error) });
		}
	};
	ctx.effect(() => ctx.webServer.register({ kind: "exact", path: ROUTE_RUNS, handler: guard((req, res) => handleRuns(ctx, req, res)) }), "results-center: runs route");
	ctx.effect(() => ctx.webServer.register({ kind: "exact", path: ROUTE_RUN, handler: guard((req, res) => handleRunDetail(ctx, req, res)) }), "results-center: run route");
	ctx.effect(() => ctx.webServer.register({ kind: "exact", path: ROUTE_ASSET, handler: guard((req, res) => handleAsset(ctx, req, res)) }), "results-center: asset route");
}
