/**
 * Operator Library (Host half).
 *
 * Serves the Data-Juicer operator catalog to the Web client through two
 * read-only same-origin proxy routes:
 * - GET /api/operator-library/catalog          -> DJ /operator-catalog (full list + facets)
 * - GET /api/operator-library/detail?name=...  -> DJ /operator-detail (parameters etc.)
 *
 * The upstream is the local Data-Juicer service (the same process behind the
 * DJ MCP plan-flow tools) on a loopback address. Its base URL defaults to
 * http://127.0.0.1:8010 and can be overridden per profile with the plugin's
 * config (`upstreamBase`; only loopback HTTP is accepted). Responses are
 * capped and shape-validated before being passed through; when the DJ service
 * is not running the panel shows an explicit unavailable state instead of
 * hanging.
 */

export const name = "operator-library";
export const inject = ["webServer"];

const DEFAULT_UPSTREAM_BASE = "http://127.0.0.1:8010";
const UPSTREAM_TIMEOUT_MS = 10000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

const CATALOG_ROUTE = "/api/operator-library/catalog";
const DETAIL_ROUTE = "/api/operator-library/detail";

function resolveUpstreamBase(value) {
	const raw = typeof value === "string" && value.trim() ? value.trim() : DEFAULT_UPSTREAM_BASE;
	const url = new URL(raw);
	if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
		throw new Error(`operator-library: upstreamBase must be a loopback HTTP URL such as ${DEFAULT_UPSTREAM_BASE}, got: ${raw}`);
	}
	const path = url.pathname.replace(/\/+$/, "");
	return `${url.origin}${path}`;
}

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

async function proxyJson(res, upstreamUrl, validate) {
	let upstream;
	try {
		upstream = await fetch(upstreamUrl, {
			headers: { accept: "application/json" },
			signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
		});
	} catch (error) {
		sendJson(res, 502, {
			ok: false,
			error: "dj_service_unavailable",
			message: error instanceof Error ? error.message : String(error),
		});
		return;
	}
	if (upstream.status !== 200) {
		sendJson(res, upstream.status >= 400 && upstream.status <= 599 ? upstream.status : 502, {
			ok: false,
			error: "dj_upstream_error",
			status: upstream.status,
		});
		return;
	}
	const declaredLength = Number(upstream.headers.get("content-length") || 0);
	if (declaredLength > MAX_RESPONSE_BYTES) {
		sendJson(res, 502, { ok: false, error: "dj_response_too_large" });
		return;
	}
	let text;
	try {
		text = await upstream.text();
	} catch (error) {
		sendJson(res, 502, {
			ok: false,
			error: "dj_service_unavailable",
			message: error instanceof Error ? error.message : String(error),
		});
		return;
	}
	if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) {
		sendJson(res, 502, { ok: false, error: "dj_response_too_large" });
		return;
	}
	let payload;
	try {
		payload = JSON.parse(text);
	} catch {
		sendJson(res, 502, { ok: false, error: "dj_invalid_response" });
		return;
	}
	if (!validate(payload)) {
		sendJson(res, 502, { ok: false, error: "dj_invalid_response" });
		return;
	}
	sendJson(res, 200, payload);
}

export function apply(ctx, config = {}) {
	const upstreamBase = resolveUpstreamBase(config?.upstreamBase);
	const upstreamCatalog = `${upstreamBase}/operator-catalog`;
	const upstreamDetail = `${upstreamBase}/operator-detail`;

	async function handleCatalog(req, res) {
		await proxyJson(res, upstreamCatalog, (payload) => payload?.ok === true && Array.isArray(payload.operators) && payload.facets && Array.isArray(payload.facets.categories));
	}

	async function handleDetail(req, res) {
		const url = new URL(req.url || DETAIL_ROUTE, "http://localhost");
		const name = String(url.searchParams.get("name") || "").trim();
		if (!name || name.length > 200) {
			sendJson(res, 400, { ok: false, error: "invalid_operator_name" });
			return;
		}
		const target = new URL(upstreamDetail);
		target.searchParams.set("name", name);
		await proxyJson(res, target, (payload) => payload && typeof payload.ok === "boolean" && (payload.ok === false || payload.operator?.name === name || payload.operator?.candidate_id === name));
	}

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
			sendJson(res, 500, { ok: false, error: "operator_library_error", message: String(error?.message || error) });
		}
	};
	ctx.effect(() => ctx.webServer.register({ kind: "exact", path: CATALOG_ROUTE, handler: guard(handleCatalog) }), "operator-library: catalog route");
	ctx.effect(() => ctx.webServer.register({ kind: "exact", path: DETAIL_ROUTE, handler: guard(handleDetail) }), "operator-library: detail route");
}
