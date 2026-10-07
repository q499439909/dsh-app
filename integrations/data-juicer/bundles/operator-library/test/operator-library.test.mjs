import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import { apply } from "../index.js";

function createResponseCapture() {
	return {
		body: "",
		headers: {},
		status: 0,
		setHeader(name, value) {
			this.headers[name.toLowerCase()] = value;
		},
		writeHead(status, headers) {
			this.status = status;
			for (const [name, value] of Object.entries(headers)) {
				this.headers[name.toLowerCase()] = value;
			}
		},
		end(body) {
			this.body = body;
		},
	};
}

function createHostRoutes() {
	const routes = new Map();
	apply(
		{
			effect(register) {
				register();
			},
			webServer: {
				register({ path, handler }) {
					routes.set(path, handler);
					return () => {};
				},
			},
		},
		{ upstreamBase: "http://127.0.0.1:8010" },
	);
	return routes;
}

test("detail proxy preserves a safe structured DJ error", async () => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () =>
		new Response(
			JSON.stringify({
				ok: false,
				error: "operator_not_found",
				message: "Operator was not found.",
				traceback: "sensitive traceback",
				internal_path: "D:/secret/operator.py",
			}),
			{ status: 404, headers: { "content-type": "application/json" } },
		);
	try {
		const routes = createHostRoutes();
		const response = createResponseCapture();
		await routes.get("/api/operator-library/detail")(
			{
				method: "GET",
				url: "/api/operator-library/detail?name=missing_operator",
				headers: { host: "localhost" },
			},
			response,
		);

		assert.equal(response.status, 404);
		assert.deepEqual(JSON.parse(response.body), {
			ok: false,
			error: "operator_not_found",
			message: "Operator was not found.",
			status: 404,
		});
		assert.equal(response.body.includes("traceback"), false);
		assert.equal(response.body.includes("D:/secret"), false);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

function createReactHarness() {
	const hooks = [];
	let hookIndex = 0;
	let pendingEffects = [];

	const sameDeps = (left, right) =>
		Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));

	const React = {
		createElement(type, props, ...children) {
			const normalized = { ...(props || {}), children };
			return typeof type === "function" ? type(normalized) : { type, props: normalized, children };
		},
		useState(initial) {
			const index = hookIndex++;
			if (!hooks[index]) {
				hooks[index] = { value: typeof initial === "function" ? initial() : initial };
			}
			return [
				hooks[index].value,
				(value) => {
					hooks[index].value = typeof value === "function" ? value(hooks[index].value) : value;
				},
			];
		},
		useRef(initial) {
			const index = hookIndex++;
			if (!hooks[index]) {
				hooks[index] = { current: initial };
			}
			return hooks[index];
		},
		useCallback(callback, deps) {
			const index = hookIndex++;
			if (!hooks[index] || !sameDeps(hooks[index].deps, deps)) {
				hooks[index] = { deps, value: callback };
			}
			return hooks[index].value;
		},
		useMemo(factory, deps) {
			const index = hookIndex++;
			if (!hooks[index] || !sameDeps(hooks[index].deps, deps)) {
				hooks[index] = { deps, value: factory() };
			}
			return hooks[index].value;
		},
		useEffect(effect, deps) {
			const index = hookIndex++;
			if (!hooks[index] || !sameDeps(hooks[index].deps, deps)) {
				hooks[index] = { deps };
				pendingEffects.push(effect);
			}
		},
	};

	return {
		React,
		render(Component) {
			hookIndex = 0;
			pendingEffects = [];
			return Component();
		},
		async flushEffects() {
			const effects = pendingEffects;
			pendingEffects = [];
			for (const effect of effects) {
				await effect();
			}
			await new Promise((resolve) => setImmediate(resolve));
		},
	};
}

function findNodes(node, predicate, result = []) {
	if (Array.isArray(node)) {
		for (const child of node) findNodes(child, predicate, result);
		return result;
	}
	if (!node || typeof node !== "object") return result;
	if (predicate(node)) result.push(node);
	findNodes(node.children, predicate, result);
	return result;
}

function textContent(node) {
	if (Array.isArray(node)) return node.map(textContent).join("");
	if (node === null || node === undefined || typeof node === "boolean") return "";
	if (typeof node !== "object") return String(node);
	return textContent(node.children);
}

async function loadClientHarness(fetchImpl) {
	const source = await readFile(new URL("../client.js", import.meta.url), "utf8");
	const harness = createReactHarness();
	let moduleDefinition;
	const context = {
		console,
		fetch: fetchImpl,
		window: {
			__ModuleLoader__: {
				load(definition) {
					moduleDefinition = definition;
				},
			},
		},
	};
	vm.runInNewContext(source, context, { filename: "operator-library/client.js" });
	const plugin = moduleDefinition.factory((name) => {
		assert.equal(name, "react");
		return harness.React;
	});
	let OperatorPanel;
	plugin.apply({
		effect(register) {
			register();
		},
		locale: {
			bind() {
				return (key) => key;
			},
			register() {
				return () => {};
			},
		},
		slots: {
			inject(_name, register) {
				return register();
			},
			register(spec, Component) {
				if (spec.name === "main") OperatorPanel = Component;
				return () => {};
			},
		},
	});
	assert.equal(typeof OperatorPanel, "function");
	return { ...harness, OperatorPanel };
}

function catalogResponse(operators) {
	return {
		ok: true,
		total: operators.length,
		operators,
		facets: { categories: ["filter"], modalities: ["image"], devices: ["cpu"] },
	};
}

function operator(name, candidateId) {
	return {
		name,
		candidate_id: candidateId,
		category: "filter",
		modalities: ["image"],
		devices: ["cpu"],
		parameters: [],
		provider: candidateId.startsWith("user:") ? "user" : "dj",
	};
}

test("detail requests and cache use candidate_id without colliding across custom versions", async () => {
	const operators = [
		operator("image_size_filter", "dj:image_size_filter"),
		operator("shared_filter", "user:shared_filter:aaaaaaaa"),
		operator("shared_filter", "user:shared_filter:bbbbbbbb"),
	];
	const detailRefs = [];
	const client = await loadClientHarness(async (url) => {
		if (url.endsWith("/catalog")) return { status: 200, json: async () => catalogResponse(operators) };
		const ref = new URL(url, "http://localhost").searchParams.get("name");
		detailRefs.push(ref);
		return { status: 200, json: async () => ({ ok: true, operator: { ...operators.find((item) => item.candidate_id === ref) } }) };
	});

	client.render(client.OperatorPanel);
	await client.flushEffects();
	const tree = client.render(client.OperatorPanel);
	const cards = findNodes(tree, (node) => node.type === "button" && node.props.className === "opXCard");
	assert.equal(cards.length, 3);

	await cards[0].props.onClick();
	await cards[1].props.onClick();
	await cards[2].props.onClick();
	await cards[1].props.onClick();

	assert.deepEqual(detailRefs, ["dj:image_size_filter", "user:shared_filter:aaaaaaaa", "user:shared_filter:bbbbbbbb"]);
});

test("a slower previous version request cannot replace the currently selected version", async () => {
	const first = operator("shared_filter", "user:shared_filter:aaaaaaaa");
	const second = operator("shared_filter", "user:shared_filter:bbbbbbbb");
	let resolveFirst;
	const firstResponse = new Promise((resolve) => {
		resolveFirst = resolve;
	});
	const client = await loadClientHarness(async (url) => {
		if (url.endsWith("/catalog")) return { status: 200, json: async () => catalogResponse([first, second]) };
		const ref = new URL(url, "http://localhost").searchParams.get("name");
		if (ref === first.candidate_id) return firstResponse;
		return { status: 200, json: async () => ({ ok: true, operator: { ...second, description: "current-version" } }) };
	});

	client.render(client.OperatorPanel);
	await client.flushEffects();
	let tree = client.render(client.OperatorPanel);
	const cards = findNodes(tree, (node) => node.type === "button" && node.props.className === "opXCard");
	const pendingFirst = cards[0].props.onClick();
	await cards[1].props.onClick();
	resolveFirst({ status: 200, json: async () => ({ ok: true, operator: { ...first, description: "stale-version" } }) });
	await pendingFirst;

	tree = client.render(client.OperatorPanel);
	assert.match(textContent(tree), /current-version/);
	assert.doesNotMatch(textContent(tree), /stale-version/);
});

test("selected identity and retry keep candidate_id while the UI displays op.name", async () => {
	const custom = operator("shared_filter", "user:shared_filter:cccccccc");
	const detailRefs = [];
	const client = await loadClientHarness(async (url) => {
		if (url.endsWith("/catalog")) return { status: 200, json: async () => catalogResponse([custom]) };
		const ref = new URL(url, "http://localhost").searchParams.get("name");
		detailRefs.push(ref);
		return {
			status: 404,
			json: async () => ({ ok: false, error: "operator_not_found", message: "Operator was not found." }),
		};
	});

	client.render(client.OperatorPanel);
	await client.flushEffects();
	let tree = client.render(client.OperatorPanel);
	const card = findNodes(tree, (node) => node.type === "button" && node.props.className === "opXCard")[0];
	await card.props.onClick();

	tree = client.render(client.OperatorPanel);
	const retry = findNodes(tree, (node) => node.type === "button" && node.props.className === "opXBtn")[0];
	const subtitle = findNodes(tree, (node) => node.props?.className === "opXSub")[0];
	assert.match(textContent(tree), /operator_not_found.*Operator was not found\./);
	assert.equal(textContent(subtitle), "shared_filter");
	await retry.props.onClick();

	assert.deepEqual(detailRefs, [custom.candidate_id, custom.candidate_id]);
});
