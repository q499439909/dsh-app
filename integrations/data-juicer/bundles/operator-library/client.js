window.__ModuleLoader__.load({
	id: "@local/operator-library",
	factory(require) {
		const React = require("react");
		const h = React.createElement;

		const NS = "operator-library";
		const API = "/api/operator-library";

		/** Locale translate, rebound when the Client half activates. */
		let T = (key) => key;

		const dictionaries = {
			zh: {
				title: "算子库",
				countUnit: "个算子",
				search: "搜索中文名、英文名或简介",
				allCategories: "全部分类",
				allModalities: "全部模态",
				allDevices: "全部设备",
				allProviders: "全部来源",
				clearFilters: "清除筛选",
				refresh: "刷新",
				loading: "正在加载算子目录…",
				loadingDetail: "正在加载算子详情…",
				unavailable: "算子目录暂时不可用",
				unavailableHint: "DJ 服务未启动或暂时无法访问，稍后可点击重试。",
				detailUnavailable: "算子详情暂时不可用",
				retry: "重试",
				empty: "没有符合条件的算子",
				emptyHint: "调整搜索词或清除筛选后重试。",
				back: "返回算子列表",
				detailTitle: "算子详情",
				mod_text: "文本",
				mod_image: "图片",
				mod_audio: "音频",
				mod_video: "视频",
				mod_multimodal: "多模态",
				mod_general: "通用",
				cat_mapper: "映射器",
				cat_filter: "过滤器",
				cat_deduplicator: "去重器",
				cat_selector: "选择器",
				cat_aggregator: "聚合器",
				cat_grouper: "分组器",
				cat_pipeline: "流水线",
				mine: "自定义",
				experimental: "实验性",
				parameters: "参数",
				required: "必填",
				optional: "可选",
				defaultValue: "默认值",
				noDescription: "暂无说明",
				noParameters: "该算子没有公开的初始化参数",
				englishOriginal: "查看英文原文",
				pending: "待翻译",
				providerDj: "DJ 内置",
				providerUser: "我的自定义",
			},
			en: {
				title: "Operator Library",
				countUnit: "operators",
				search: "Search Chinese or English name and description",
				allCategories: "All categories",
				allModalities: "All modalities",
				allDevices: "All devices",
				allProviders: "All sources",
				clearFilters: "Clear filters",
				refresh: "Refresh",
				loading: "Loading operator catalog…",
				loadingDetail: "Loading operator details…",
				unavailable: "Operator catalog is unavailable",
				unavailableHint: "The DJ service is not running or unreachable. Try again later.",
				detailUnavailable: "Operator details are unavailable",
				retry: "Retry",
				empty: "No operators match these filters",
				emptyHint: "Change the search or clear the filters and try again.",
				back: "Back to operator list",
				detailTitle: "Operator details",
				mod_text: "Text",
				mod_image: "Image",
				mod_audio: "Audio",
				mod_video: "Video",
				mod_multimodal: "Multimodal",
				mod_general: "General",
				cat_mapper: "Mapper",
				cat_filter: "Filter",
				cat_deduplicator: "Deduplicator",
				cat_selector: "Selector",
				cat_aggregator: "Aggregator",
				cat_grouper: "Grouper",
				cat_pipeline: "Pipeline",
				mine: "Custom",
				experimental: "Experimental",
				parameters: "Parameters",
				required: "Required",
				optional: "Optional",
				defaultValue: "Default",
				noDescription: "No description",
				noParameters: "This operator has no public initialization parameters",
				englishOriginal: "View original English",
				pending: "Pending translation",
				providerDj: "DJ built-in",
				providerUser: "My custom",
			},
		};

		const css = `
[data-category="mapper"]{--opx-cat:#3b82f6}
[data-category="filter"]{--opx-cat:#f97316}
[data-category="deduplicator"]{--opx-cat:#8b5cf6}
[data-category="selector"]{--opx-cat:#06b6d4}
[data-category="aggregator"]{--opx-cat:#22c55e}
[data-category="grouper"]{--opx-cat:#ec4899}
[data-category="pipeline"]{--opx-cat:#6366f1}
.opXRoot{height:100%;min-width:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:14px}
.opXHeader{flex:none;display:flex;align-items:center;gap:12px;padding:14px 20px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.opXHeadText{min-width:0;flex:1}
.opXTitle{font-size:17px;font-weight:650;line-height:24px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.opXSub{font-size:12px;color:var(--dsw-alias-label-secondary);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.opXIconBtn{flex:none;width:30px;height:30px;display:inline-flex;align-items:center;justify-content:center;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:16px;cursor:pointer}
.opXIconBtn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.opXBody{flex:1;min-height:0;overflow:auto;padding:16px 20px 28px}
.opXToolbar{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}
.opXSearchWrap{position:relative;flex:1;min-width:220px;display:flex}
.opXSearchWrap .opXInput{width:100%;padding-left:32px}
.opXSearchIcon{position:absolute;left:10px;top:50%;transform:translateY(-50%);width:14px;height:14px;color:var(--dsw-alias-label-secondary);pointer-events:none}
.opXInput{flex:1;min-width:220px;padding:7px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;font-size:13px}
.opXInput:focus{outline:none;border-color:var(--dsw-alias-brand-primary)}
.opXSelect{padding:6px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;font-size:12.5px;max-width:180px}
.opXSelect:focus{outline:none;border-color:var(--dsw-alias-brand-primary)}
.opXBtn{padding:6px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;cursor:pointer}
.opXBtn:hover{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.opXBtn:disabled{opacity:.5;cursor:default}
.opXChips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
.opXChip{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-1);font-size:11.5px;color:var(--dsw-alias-label-primary);cursor:pointer;font:inherit}
.opXChip:hover{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.opXGroupHead{--opx-cat:var(--dsw-alias-brand-primary);position:sticky;top:0;z-index:1;display:flex;align-items:center;gap:8px;padding:10px 2px 8px;margin:10px 0;background:var(--dsw-alias-bg-base);border-bottom:1px solid var(--dsw-alias-border-l1)}
.opXDot{flex:none;width:9px;height:9px;border-radius:50%;background:var(--opx-cat)}
.opXGroupName{font-size:13.5px;font-weight:650}
.opXGroupEn{font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.opXGroupCount{font-size:12px;color:var(--dsw-alias-label-secondary);margin-left:auto}
.opXGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(285px,1fr));gap:10px}
.opXCard{--opx-cat:var(--dsw-alias-brand-primary);display:flex;flex-direction:column;gap:8px;text-align:left;padding:12px 14px;border:1px solid var(--dsw-alias-border-l2);border-left:3px solid var(--opx-cat);border-radius:10px;background:var(--dsw-alias-bg-layer-1);cursor:pointer;font:inherit;color:inherit}
.opXCard:hover{border-color:var(--opx-cat);background:var(--dsw-alias-bg-layer-2)}
.opXCardTop{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}
.opXNames{min-width:0}
.opXNameZh{font-size:13.5px;font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.opXNameEn{font-size:11.5px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:1px}
.opXCat{--opx-cat:var(--dsw-alias-brand-primary);flex:none;padding:1px 8px;border-radius:999px;background:color-mix(in srgb,var(--opx-cat) 12%,transparent);font-size:10.5px;font-weight:600;color:var(--opx-cat)}
.opXMine{display:inline-flex;padding:1px 7px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent);font-size:10.5px;font-weight:600;color:var(--dsw-alias-brand-primary)}
.opXStatus{display:inline-flex;padding:1px 7px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);font-size:10.5px;color:var(--dsw-alias-label-secondary)}
.opXPending{font-size:10px;color:var(--dsw-alias-state-warn-primary);margin-left:5px}
.opXDesc{margin:0;font-size:12.5px;color:var(--dsw-alias-label-secondary);line-height:1.5;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.opXTags{display:flex;flex-wrap:wrap;gap:4px}
.opXTag{display:inline-flex;padding:1px 7px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);font-size:10.5px;color:var(--dsw-alias-label-secondary)}
.opXDetail{max-width:860px}
.opXHero{--opx-cat:var(--dsw-alias-brand-primary);display:flex;flex-direction:column;gap:8px;padding:16px 18px;border:1px solid var(--dsw-alias-border-l2);border-top:3px solid var(--opx-cat);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}
.opXHeroName{font-size:16px;font-weight:650}
.opXHeroEn{font-size:12px;color:var(--dsw-alias-label-secondary);word-break:break-all}
.opXHeroMeta{font-size:12px;color:var(--dsw-alias-label-secondary)}
.opXHeroDesc{margin:0;font-size:13px;line-height:1.6;white-space:pre-wrap;word-break:break-word}
.opXSectionHead{display:flex;align-items:baseline;gap:10px;margin:22px 0 10px}
.opXSectionHead h3{margin:0;font-size:15px;font-weight:650}
.opXCount{font-size:12px;color:var(--dsw-alias-label-secondary)}
.opXParam{display:flex;flex-direction:column;gap:6px;padding:12px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1);margin-bottom:8px}
.opXParamTop{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px}
.opXParamName{display:inline-flex;align-items:baseline;gap:7px;min-width:0}
.opXParamNameZh{font-size:13px;font-weight:650}
.opXParamNameEn{font-size:11px;color:var(--dsw-alias-label-secondary)}
.opXParamType{font-family:ui-monospace,Consolas,monospace;font-size:11.5px;padding:1px 7px;border-radius:6px;background:var(--dsw-alias-bg-layer-2)}
.opXReq{font-size:10.5px;color:var(--dsw-alias-label-secondary)}
.opXReq[data-required=true]{color:var(--dsw-alias-state-error-primary)}
.opXParamDesc{margin:0;font-size:12.5px;line-height:1.55}
.opXFaint{color:var(--dsw-alias-label-secondary)}
.opXParamDefault{display:flex;align-items:baseline;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.opXParamDefault code{font-family:ui-monospace,Consolas,monospace;font-size:11.5px;padding:1px 7px;border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);word-break:break-all}
.opXDetails summary{font-size:11.5px;color:var(--dsw-alias-label-secondary);cursor:pointer;list-style:none}
.opXDetails summary:hover{color:var(--dsw-alias-brand-primary)}
.opXDetails summary::before{content:"▸ "}
.opXDetails[open] summary::before{content:"▾ "}
.opXDetails p{margin:6px 0 0}
.opXState{padding:48px 16px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:13.5px;line-height:1.7}
.opXStateTitle{font-size:14px;font-weight:650;color:var(--dsw-alias-label-primary)}
.opXStateHint{margin-top:4px}
.opXState .opXBtn{margin-top:12px}
.opXErr{color:var(--dsw-alias-state-error-primary);font-size:12.5px;word-break:break-all}
`;

		function localeLabel(prefix, value) {
			const key = `${prefix}${String(value)}`;
			const text = T(key);
			return text === key ? String(value) : text;
		}

		function modalityLabel(value) {
			return localeLabel("mod_", value);
		}

		function categoryLabel(value) {
			return localeLabel("cat_", value);
		}

		function providerLabel(value) {
			if (value === "dj") {
				return T("providerDj");
			}
			if (value === "user") {
				return T("providerUser");
			}
			return String(value);
		}

		function fmtDefault(value) {
			if (value === undefined) {
				return "—";
			}
			if (value === null) {
				return "null";
			}
			if (typeof value === "string") {
				return JSON.stringify(value);
			}
			try {
				const text = JSON.stringify(value);
				return text === undefined ? String(value) : text;
			} catch {
				return String(value);
			}
		}

		/** Sidebar icon: a book, filled spine when active. */
		function PanelIcon({ size = 18, active = false }) {
			const s = Math.max(10, Number(size) || 18);
			return h(
				"svg",
				{
					viewBox: "0 0 24 24",
					width: s,
					height: s,
					"aria-hidden": "true",
					style: { display: "block" },
					fill: "none",
					stroke: "currentColor",
					strokeWidth: 1.7,
					strokeLinecap: "round",
					strokeLinejoin: "round",
				},
				h("path", { d: "M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5z", fill: active ? "currentColor" : "none" }),
				h("path", { d: "M4 5.5v16" }),
				h("path", { d: "M8 7h8M8 11h6" }),
			);
		}

		function SearchIcon() {
			return h(
				"svg",
				{
					viewBox: "0 0 24 24",
					className: "opXSearchIcon",
					"aria-hidden": "true",
					fill: "none",
					stroke: "currentColor",
					strokeWidth: 2,
					strokeLinecap: "round",
				},
				h("circle", { cx: 11, cy: 11, r: 7 }),
				h("path", { d: "m20 20-3.5-3.5" }),
			);
		}

		function StateMessage({ title, hint, error, actionLabel, onAction }) {
			return h(
				"div",
				{ className: "opXState" },
				h("div", { className: "opXStateTitle" }, title),
				hint ? h("div", { className: "opXStateHint" }, hint) : null,
				error ? h("div", { className: "opXErr" }, error) : null,
				onAction ? h("button", { type: "button", className: "opXBtn", onClick: onAction }, actionLabel) : null,
			);
		}

		function apiError(payload, status) {
			const nested = payload?.error && typeof payload.error === "object" ? payload.error : null;
			const code = typeof payload?.error === "string" ? payload.error : nested?.code || payload?.code;
			const message = nested?.message || payload?.message;
			return [code, message].filter(Boolean).join(": ") || `HTTP ${status}`;
		}

		function OperatorCard({ op, onOpen }) {
			const modalities = Array.isArray(op.modalities) ? op.modalities : [];
			const devices = Array.isArray(op.devices) ? op.devices : [];
			const desc = op.description_zh || op.description || "";
			const hasTags = modalities.length > 0 || devices.length > 0 || op.provider === "user" || op.status === "experimental";
			return h(
				"button",
				{ type: "button", className: "opXCard", "data-category": op.category || undefined, onClick: () => onOpen(op) },
				h(
					"div",
					{ className: "opXCardTop" },
					h(
						"div",
						{ className: "opXNames" },
						h(
							"div",
							{ className: "opXNameZh" },
							op.display_name_zh || op.name,
							op.translation_status === "pending" ? h("span", { className: "opXPending" }, T("pending")) : null,
						),
						h("div", { className: "opXNameEn" }, op.name),
					),
					op.category ? h("span", { className: "opXCat", "data-category": op.category }, categoryLabel(op.category)) : null,
				),
				desc ? h("p", { className: "opXDesc" }, desc) : null,
				hasTags
					? h(
							"div",
							{ className: "opXTags" },
							op.provider === "user" ? h("span", { className: "opXMine" }, T("mine")) : null,
							op.status === "experimental" ? h("span", { className: "opXStatus" }, T("experimental")) : null,
							modalities.map((v) => h("span", { key: `m-${v}`, className: "opXTag" }, modalityLabel(v))),
							devices.map((v) => h("span", { key: `d-${v}`, className: "opXTag" }, String(v).toUpperCase())),
						)
					: null,
			);
		}

		function ParamCard({ parameter }) {
			const descZh = parameter.description_zh || "";
			return h(
				"section",
				{ className: "opXParam" },
				h(
					"div",
					{ className: "opXParamTop" },
					h(
						"span",
						{ className: "opXParamName" },
						h("span", { className: "opXParamNameZh" }, parameter.display_name_zh || parameter.name),
						h("span", { className: "opXParamNameEn" }, parameter.name),
					),
					parameter.type ? h("code", { className: "opXParamType" }, String(parameter.type)) : null,
					h(
						"span",
						{ className: "opXReq", "data-required": parameter.required ? "true" : "false" },
						parameter.required ? T("required") : T("optional"),
					),
				),
				descZh
					? h("p", { className: "opXParamDesc" }, descZh)
					: h("p", { className: "opXParamDesc opXFaint" }, T("noDescription")),
				parameter.required
					? null
					: h(
							"div",
							{ className: "opXParamDefault" },
							h("span", null, T("defaultValue")),
							h("code", null, fmtDefault(parameter.default)),
						),
				parameter.description
					? h(
							"details",
							{ className: "opXDetails" },
							h("summary", null, T("englishOriginal")),
							h("p", { className: "opXParamDesc" }, parameter.description),
						)
					: null,
			);
		}

		function OperatorDetail({ operator }) {
			const modalities = Array.isArray(operator.modalities) ? operator.modalities : [];
			const devices = Array.isArray(operator.devices) ? operator.devices : [];
			const parameters = Array.isArray(operator.parameters) ? operator.parameters : [];
			const heroDesc = operator.description_zh || operator.description || T("noDescription");
			const metaLine = [
				operator.provider === "user" ? T("providerUser") : T("providerDj"),
				operator.status || "—",
				operator.version ? `v${operator.version}` : null,
			]
				.filter(Boolean)
				.join(" · ");
			return h(
				"div",
				{ className: "opXDetail" },
				h(
					"div",
					{ className: "opXHero", "data-category": operator.category || undefined },
					h(
						"div",
						{ className: "opXCardTop" },
						h(
							"div",
							{ className: "opXNames" },
							h(
								"div",
								{ className: "opXHeroName" },
								operator.display_name_zh || operator.name,
								operator.translation_status === "pending" ? h("span", { className: "opXPending" }, T("pending")) : null,
							),
							h("div", { className: "opXHeroEn" }, operator.name),
						),
						operator.category
							? h("span", { className: "opXCat", "data-category": operator.category }, categoryLabel(operator.category))
							: null,
					),
					h("div", { className: "opXHeroMeta" }, metaLine),
					modalities.length || devices.length
						? h(
								"div",
								{ className: "opXTags" },
								modalities.map((v) => h("span", { key: `m-${v}`, className: "opXTag" }, modalityLabel(v))),
								devices.map((v) => h("span", { key: `d-${v}`, className: "opXTag" }, String(v).toUpperCase())),
							)
						: null,
					h("p", { className: "opXHeroDesc" }, heroDesc),
					operator.description
						? h(
								"details",
								{ className: "opXDetails" },
								h("summary", null, T("englishOriginal")),
								h("p", { className: "opXHeroDesc" }, operator.description),
							)
						: null,
				),
				h(
					"div",
					{ className: "opXSectionHead" },
					h("h3", null, T("parameters")),
					h("span", { className: "opXCount" }, String(parameters.length)),
				),
				parameters.length
					? parameters.map((parameter, index) => h(ParamCard, { parameter, key: parameter.name || index }))
					: h("div", { className: "opXStateHint" }, T("noParameters")),
			);
		}

		function GroupHead({ category, count }) {
			return h(
				"div",
				{ className: "opXGroupHead", "data-category": category },
				h("span", { className: "opXDot" }),
				h("span", { className: "opXGroupName" }, categoryLabel(category)),
				h("span", { className: "opXGroupEn" }, category),
				h("span", { className: "opXGroupCount" }, `${count} ${T("countUnit")}`),
			);
		}

		function OperatorPanel() {
			const [data, setData] = React.useState(null);
			const [error, setError] = React.useState("");
			const [loading, setLoading] = React.useState(false);
			const [filters, setFilters] = React.useState({ query: "", category: "", modality: "", device: "", provider: "" });
			const [selectedRef, setSelectedRef] = React.useState("");
			const [selectedDisplayName, setSelectedDisplayName] = React.useState("");
			const [selected, setSelected] = React.useState(null);
			const [detailLoading, setDetailLoading] = React.useState(false);
			const [detailError, setDetailError] = React.useState("");
			const cacheRef = React.useRef(new Map());
			const activeDetailRef = React.useRef("");

			const load = React.useCallback(async () => {
				setLoading(true);
				setError("");
				try {
					const r = await fetch(`${API}/catalog`);
					const p = await r.json();
					if (p.ok !== true || !Array.isArray(p.operators)) {
						throw new Error(p.error || `HTTP ${r.status}`);
					}
					setData(p);
				} catch (e) {
					setError(String(e?.message || e));
				} finally {
					setLoading(false);
				}
			}, []);
			React.useEffect(() => {
				load();
			}, [load]);

			const openDetail = React.useCallback(async (op) => {
				const ref = op.candidate_id || op.name;
				const displayName = op.name || ref;
				activeDetailRef.current = ref;
				const cached = cacheRef.current.get(ref);
				if (cached) {
					setSelectedRef(ref);
					setSelectedDisplayName(displayName);
					setSelected(cached);
					setDetailError("");
					return;
				}
				setSelectedRef(ref);
				setSelectedDisplayName(displayName);
				setSelected(null);
				setDetailError("");
				setDetailLoading(true);
				try {
					const r = await fetch(`${API}/detail?name=${encodeURIComponent(ref)}`);
					const p = await r.json();
					if (p.ok !== true || !p.operator) {
						throw new Error(apiError(p, r.status));
					}
					cacheRef.current.set(ref, p.operator);
					if (activeDetailRef.current === ref) {
						setSelected(p.operator);
					}
				} catch (e) {
					if (activeDetailRef.current === ref) {
						setDetailError(String(e?.message || e));
					}
				} finally {
					if (activeDetailRef.current === ref) {
						setDetailLoading(false);
					}
				}
			}, []);

			const setFilter = (key, value) => {
				setFilters((prev) => ({ ...prev, [key]: value }));
			};
			const clearFilters = () => {
				setFilters({ query: "", category: "", modality: "", device: "", provider: "" });
			};
			const backToList = () => {
				activeDetailRef.current = "";
				setSelectedRef("");
				setSelectedDisplayName("");
				setSelected(null);
				setDetailError("");
			};

			const filtered = React.useMemo(() => {
				if (!data) {
					return [];
				}
				const q = filters.query.trim().toLowerCase();
				return data.operators.filter((op) => {
					if (filters.category && op.category !== filters.category) {
						return false;
					}
					if (filters.modality && !(Array.isArray(op.modalities) ? op.modalities : []).includes(filters.modality)) {
						return false;
					}
					if (filters.device && !(Array.isArray(op.devices) ? op.devices : []).includes(filters.device)) {
						return false;
					}
					if (filters.provider && op.provider !== filters.provider) {
						return false;
					}
					if (q) {
						const searchable = [op.name, op.display_name_zh, op.description, op.description_zh]
							.filter(Boolean)
							.join("\n")
							.toLowerCase();
						if (!searchable.includes(q)) {
							return false;
						}
					}
					return true;
				});
			}, [data, filters]);

			/** Operators grouped by category, sections sorted by size (largest first). */
			const groups = React.useMemo(() => {
				const byCategory = new Map();
				for (const op of filtered) {
					const category = op.category || "other";
					const bucket = byCategory.get(category);
					if (bucket) {
						bucket.push(op);
					} else {
						byCategory.set(category, [op]);
					}
				}
				return [...byCategory.entries()].sort((a, b) => b[1].length - a[1].length);
			}, [filtered]);

			const total = data ? (typeof data.total === "number" ? data.total : data.operators.length) : 0;
			const activeFilters = [
				filters.category ? { key: "category", label: categoryLabel(filters.category) } : null,
				filters.modality ? { key: "modality", label: modalityLabel(filters.modality) } : null,
				filters.device ? { key: "device", label: String(filters.device).toUpperCase() } : null,
				filters.provider ? { key: "provider", label: providerLabel(filters.provider) } : null,
			].filter(Boolean);

			const gridOf = (operators) =>
				h(
					"div",
					{ className: "opXGrid" },
					operators.map((op) => h(OperatorCard, { op, key: op.candidate_id || op.name, onOpen: openDetail })),
				);

			const listBody = !data
				? h(StateMessage, { title: T("loading") })
				: h(
						"div",
						null,
						h(
							"div",
							{ className: "opXToolbar" },
							h(
								"div",
								{ className: "opXSearchWrap" },
								h(SearchIcon, null),
								h("input", {
									className: "opXInput",
									value: filters.query,
									placeholder: T("search"),
									"aria-label": T("search"),
									onChange: (e) => setFilter("query", e.target.value),
								}),
							),
							h(
								"select",
								{ className: "opXSelect", value: filters.category, "aria-label": T("allCategories"), onChange: (e) => setFilter("category", e.target.value) },
								h("option", { value: "" }, T("allCategories")),
								(data.facets?.categories || []).map((v) => h("option", { value: v, key: v }, categoryLabel(v))),
							),
							h(
								"select",
								{ className: "opXSelect", value: filters.modality, "aria-label": T("allModalities"), onChange: (e) => setFilter("modality", e.target.value) },
								h("option", { value: "" }, T("allModalities")),
								(data.facets?.modalities || []).map((v) => h("option", { value: v, key: v }, modalityLabel(v))),
							),
							h(
								"select",
								{ className: "opXSelect", value: filters.device, "aria-label": T("allDevices"), onChange: (e) => setFilter("device", e.target.value) },
								h("option", { value: "" }, T("allDevices")),
								(data.facets?.devices || []).map((v) => h("option", { value: v, key: v }, String(v).toUpperCase())),
							),
							h(
								"select",
								{ className: "opXSelect", value: filters.provider, "aria-label": T("allProviders"), onChange: (e) => setFilter("provider", e.target.value) },
								h("option", { value: "" }, T("allProviders")),
								(data.facets?.providers || []).map((v) => h("option", { value: v, key: v }, providerLabel(v))),
							),
							activeFilters.length || filters.query
								? h("button", { type: "button", className: "opXBtn", onClick: clearFilters }, T("clearFilters"))
								: null,
						),
						activeFilters.length
							? h(
									"div",
									{ className: "opXChips" },
									activeFilters.map((f) =>
										h(
											"button",
											{ type: "button", className: "opXChip", key: f.key, onClick: () => setFilter(f.key, "") },
											`${f.label} ×`,
										),
									),
								)
							: null,
						filtered.length
							? filters.category
								? gridOf(filtered)
								: groups.map(([category, operators]) =>
										h("div", { key: category }, h(GroupHead, { category, count: operators.length }), gridOf(operators)),
									)
							: h(StateMessage, { title: T("empty"), hint: T("emptyHint"), actionLabel: T("clearFilters"), onAction: clearFilters }),
					);

			const detailBody = detailError
				? h(StateMessage, {
						title: T("detailUnavailable"),
						error: detailError,
						actionLabel: T("retry"),
						onAction: () => openDetail({ candidate_id: selectedRef, name: selectedDisplayName }),
					})
				: selected
					? h(OperatorDetail, { operator: selected })
					: h(StateMessage, { title: T("loadingDetail") });

			const bodyContent = selectedRef
				? detailBody
				: error && !data
					? h(StateMessage, { title: T("unavailable"), hint: T("unavailableHint"), error, actionLabel: T("retry"), onAction: load })
					: listBody;

			return h(
				"div",
				{ className: "opXRoot" },
				h("style", null, css),
				h(
					"header",
					{ className: "opXHeader" },
					h(
						"div",
						{ className: "opXHeadText" },
						h("div", { className: "opXTitle" }, selectedRef ? T("detailTitle") : T("title")),
						h(
							"div",
							{ className: "opXSub" },
							selectedRef ? selectedDisplayName : data ? `${filtered.length} / ${total} ${T("countUnit")}` : T("loading"),
						),
					),
					selectedRef
						? h("button", { type: "button", className: "opXIconBtn", onClick: backToList, title: T("back"), "aria-label": T("back") }, "←")
						: h("button", { type: "button", className: "opXIconBtn", onClick: load, title: T("refresh"), "aria-label": T("refresh") }, "⟳"),
				),
				h("div", { className: "opXBody" }, bodyContent),
			);
		}

		return {
			inject: ["slots", "locale"],
			apply(ctx) {
				ctx.effect(() => ctx.locale.register(NS, dictionaries), "operator-library: dictionaries");
				T = ctx.locale.bind(NS);
				ctx.effect(
					() =>
						ctx.slots.inject("sidebar.panellist", () =>
							ctx.slots.register(
								{ name: "sidebar.panellist", id: "operator-library", order: 61, label: () => T("title") },
								PanelIcon,
							),
						),
					"operator-library: sidebar entry",
				);
				ctx.effect(
					() => ctx.slots.inject("main", () => ctx.slots.register({ name: "main", key: "operator-library" }, OperatorPanel)),
					"operator-library: main panel",
				);
			},
		};
	},
});
