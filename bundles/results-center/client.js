window.__ModuleLoader__.load({
	id: "@local/results-center",
	factory(require) {
		const React = require("react");
		const h = React.createElement;

		const NS = "results-center";
		const API = "/api/results-center";

		/** Locale translate, rebound when the Client half activates. */
		let T = (key) => key;

		const dictionaries = {
			zh: {
				title: "结果中心",
				subtitle: "Data-Juicer 运行结果",
				refresh: "刷新",
				back: "返回运行列表",
				loading: "加载中…",
				loadFailed: "加载失败",
				noRuns: "还没有发现任何运行结果。完成一次 Data-Juicer 处理任务后，输出会自动出现在这里。",
				noGroups: "此运行没有可展示的记录组。",
				recordsUnit: "条记录",
				outputsUnit: "个输出",
				groupsSection: "数据分组",
				filesSection: "其他文件",
				summarySection: "汇总",
				download: "下载",
				view: "查看",
				close: "关闭",
				metadata: "元数据",
				externalFile: "位于运行目录外",
				statusSucceeded: "成功",
				statusFailed: "失败",
				statusUnknown: "未知",
				workspaceLabel: "工作区",
				startedAt: "开始",
				finishedAt: "完成",
				parseErrors: "条未解析行",
				tooLarge: "文件过大，未加载记录",
				recordsTruncated: "已截断显示前 2000 条",
			},
			en: {
				title: "Results Center",
				subtitle: "Data-Juicer run results",
				refresh: "Refresh",
				back: "Back to runs",
				loading: "Loading…",
				loadFailed: "Failed to load",
				noRuns: "No run results yet. Complete a Data-Juicer task and its outputs will appear here.",
				noGroups: "No record groups to display for this run.",
				recordsUnit: "records",
				outputsUnit: "outputs",
				groupsSection: "Dataset groups",
				filesSection: "Other files",
				summarySection: "Summary",
				download: "Download",
				view: "View",
				close: "Close",
				metadata: "Metadata",
				externalFile: "Outside run directory",
				statusSucceeded: "Succeeded",
				statusFailed: "Failed",
				statusUnknown: "Unknown",
				workspaceLabel: "Workspace",
				startedAt: "Started",
				finishedAt: "Finished",
				parseErrors: "unparsed lines",
				tooLarge: "File too large; records not loaded",
				recordsTruncated: "Showing the first 2000 records",
			},
		};

		const css = `
.rcxRoot{height:100%;min-width:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:14px}
.rcxHeader{flex:none;display:flex;align-items:center;gap:12px;padding:14px 20px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.rcxHeadText{min-width:0;flex:1}
.rcxTitle{font-size:17px;font-weight:650;line-height:24px}
.rcxSub{font-size:12px;color:var(--dsw-alias-label-secondary);margin-top:2px}
.rcxBody{flex:1;min-height:0;overflow:auto;padding:18px 20px 28px}
.rcxIconBtn{flex:none;width:30px;height:30px;display:inline-flex;align-items:center;justify-content:center;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:16px;cursor:pointer}
.rcxIconBtn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.rcxRunGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px}
.rcxRunCard{display:flex;flex-direction:column;gap:10px;text-align:left;padding:14px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1);cursor:pointer;font:inherit;color:inherit}
.rcxRunCard:hover{border-color:var(--dsw-alias-brand-primary)}
.rcxRunTop{display:flex;align-items:center;gap:8px;min-width:0}
.rcxRunId{font-weight:650;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rcxRunMeta{display:flex;flex-direction:column;gap:2px;font-size:12px;color:var(--dsw-alias-label-secondary);word-break:break-all}
.rcxChips{display:flex;flex-wrap:wrap;gap:6px}
.rcxChip{display:inline-flex;align-items:center;padding:2px 9px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);font-size:11.5px;color:var(--dsw-alias-label-secondary);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rcxChip[data-tone=success]{color:var(--dsw-alias-state-success-primary)}
.rcxChip[data-tone=error]{color:var(--dsw-alias-state-error-primary)}
.rcxChip[data-tone=warn]{color:var(--dsw-alias-state-warn-primary)}
.rcxChip[data-tone=brand]{color:var(--dsw-alias-brand-primary)}
.rcxDot{flex:none;width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-state-idle-primary)}
.rcxDot[data-status=succeeded]{background:var(--dsw-alias-state-success-primary)}
.rcxDot[data-status=failed]{background:var(--dsw-alias-state-error-primary)}
.rcxSection{margin-top:26px}
.rcxSectionHead{display:flex;align-items:baseline;gap:10px;margin-bottom:12px;flex-wrap:wrap}
.rcxSectionHead h2{margin:0;font-size:15px;font-weight:650}
.rcxSectionNote{font-size:12px;color:var(--dsw-alias-label-secondary)}
.rcxGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(185px,1fr));gap:10px}
.rcxCard{display:flex;flex-direction:column;padding:0;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1);cursor:pointer;font:inherit;color:inherit;text-align:left;overflow:hidden}
.rcxCard:hover{border-color:var(--dsw-alias-brand-primary)}
.rcxThumb{display:block;width:100%;aspect-ratio:4/3;object-fit:cover;background:var(--dsw-alias-bg-layer-2)}
.rcxThumbPh{display:flex;align-items:center;justify-content:center;width:100%;aspect-ratio:4/3;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:22px}
.rcxCardInfo{padding:8px 10px 10px}
.rcxFileName{font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rcxCardBadges{display:flex;flex-wrap:wrap;gap:4px;margin-top:7px;max-height:52px;overflow:hidden}
.rcxMini{display:inline-flex;padding:1px 7px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);font-size:10.5px;color:var(--dsw-alias-label-secondary);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rcxMini[data-tone=brand]{color:var(--dsw-alias-brand-primary)}
.rcxMini[data-tone=success]{color:var(--dsw-alias-state-success-primary)}
.rcxMini[data-tone=error]{color:var(--dsw-alias-state-error-primary)}
.rcxFiles{display:flex;flex-direction:column;gap:6px}
.rcxFileRow{display:flex;align-items:center;gap:10px;padding:8px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}
.rcxFileName{flex:1;min-width:0;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rcxFileSize{flex:none;font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.rcxBtn{flex:none;padding:4px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer;text-decoration:none}
.rcxBtn:hover{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.rcxBack{display:inline-flex;align-items:center;gap:6px;margin-bottom:14px;padding:5px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:12.5px;cursor:pointer}
.rcxBack:hover{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.rcxDetailHead{display:flex;flex-direction:column;gap:6px}
.rcxDetailTitle{display:flex;align-items:center;gap:10px;font-size:16px;font-weight:650;flex-wrap:wrap}
.rcxModal{position:fixed;inset:0;z-index:96;display:flex;align-items:center;justify-content:center;padding:28px;background:var(--dsw-alias-bg-overlay)}
.rcxModalBox{position:relative;display:flex;flex-direction:column;gap:14px;max-width:960px;width:100%;max-height:88vh;overflow:auto;padding:18px;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-alias-bg-layer-1)}
.rcxModalHead{display:flex;align-items:center;gap:12px}
.rcxModalTitle{flex:1;min-width:0;font-size:14.5px;font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rcxModalImgs{display:flex;flex-direction:column;gap:10px;align-items:center}
.rcxModalImg{max-width:100%;max-height:56vh;object-fit:contain;border-radius:10px;background:var(--dsw-alias-bg-layer-2)}
.rcxTable{display:grid;grid-template-columns:170px 1fr;gap:7px 14px;font-size:12.5px}
.rcxTableKey{color:var(--dsw-alias-label-secondary);word-break:break-all}
.rcxTableVal{word-break:break-all;white-space:pre-wrap}
.rcxPre{margin:0;max-height:56vh;overflow:auto;font-size:12px;line-height:1.55;white-space:pre-wrap;word-break:break-word}
.rcxEmpty{padding:48px 16px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:13.5px;line-height:1.7}
.rcxErr{color:var(--dsw-alias-state-error-primary);font-size:13px}
.rcxLoading{padding:40px;text-align:center;color:var(--dsw-alias-label-secondary)}
`;

		const fmtBytes = (n) => {
			const v = Number(n);
			if (!Number.isFinite(v) || v < 0) {
				return "—";
			}
			if (v < 1024) {
				return `${v} B`;
			}
			const units = ["KB", "MB", "GB", "TB"];
			let value = v;
			let unit = -1;
			do {
				value /= 1024;
				unit += 1;
			} while (value >= 1024 && unit < units.length - 1);
			return `${value.toFixed(1)} ${units[unit]}`;
		};

		const fmtTime = (iso) => {
			if (typeof iso !== "string" || !iso) {
				return "—";
			}
			const d = new Date(iso);
			return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
		};

		const fmtValue = (value) => {
			if (value === null) {
				return "null";
			}
			if (typeof value === "string") {
				return value;
			}
			if (typeof value === "number" || typeof value === "boolean") {
				return String(value);
			}
			if (Array.isArray(value)) {
				const flat = value.every((x) => typeof x === "string" || typeof x === "number");
				return flat ? value.map(String).join(", ") : JSON.stringify(value);
			}
			let text = "";
			try {
				text = JSON.stringify(value, null, 1);
			} catch {
				text = String(value);
			}
			return text.length > 1600 ? `${text.slice(0, 1600)}…` : text;
		};

		const assetUrl = (ref, path, download) => {
			const params = new URLSearchParams({ ref, path });
			if (download) {
				params.set("download", "1");
			}
			return `${API}/asset?${params.toString()}`;
		};

		const statusTone = (status) => {
			if (status === "succeeded") {
				return "success";
			}
			if (status === "failed") {
				return "error";
			}
			return "idle";
		};

		const statusLabel = (status) => {
			if (status === "succeeded") {
				return T("statusSucceeded");
			}
			if (status === "failed") {
				return T("statusFailed");
			}
			if (typeof status === "string" && status) {
				return status;
			}
			return T("statusUnknown");
		};

		const chipToneForValue = (value) => {
			if (value === true) {
				return "success";
			}
			if (value === false) {
				return "error";
			}
			if (value === "real-photo" || value === "cat" || value === "dog") {
				return "brand";
			}
			return "idle";
		};

		/** Sidebar icon: four rounded squares, filled corners when active. */
		function PanelIcon({ size = 18, active = false }) {
			const s = Math.max(10, Number(size) || 18);
			const common = { stroke: "currentColor", strokeWidth: 1.7 };
			return h(
				"svg",
				{ viewBox: "0 0 24 24", width: s, height: s, "aria-hidden": "true", style: { display: "block" } },
				h("rect", { x: 3, y: 3, width: 8, height: 8, rx: 2.2, fill: active ? "currentColor" : "none", ...common }),
				h("rect", { x: 13, y: 3, width: 8, height: 8, rx: 2.2, fill: "none", ...common }),
				h("rect", { x: 3, y: 13, width: 8, height: 8, rx: 2.2, fill: "none", ...common }),
				h("rect", { x: 13, y: 13, width: 8, height: 8, rx: 2.2, fill: active ? "currentColor" : "none", ...common }),
			);
		}

		function SummaryChips({ summary }) {
			if (!summary || typeof summary !== "object") {
				return null;
			}
			const entries = Object.entries(summary).slice(0, 12);
			if (!entries.length) {
				return null;
			}
			return h(
				"div",
				{ className: "rcxChips" },
				entries.map(([key, value]) =>
					h("span", { key, className: "rcxChip", "data-tone": chipToneForValue(value) }, `${key}: ${fmtValue(value)}`),
				),
			);
		}

		function RunCard({ run, onOpen }) {
			return h(
				"button",
				{ type: "button", className: "rcxRunCard", onClick: () => onOpen(run) },
				h(
					"div",
					{ className: "rcxRunTop" },
					h("span", { className: "rcxDot", "data-status": run.status }),
					h("span", { className: "rcxRunId" }, run.runId),
					h("span", { className: "rcxChip" }, statusLabel(run.status)),
				),
				h(
					"div",
					{ className: "rcxRunMeta" },
					h("span", null, [run.taskId, run.planVersion, run.slug].filter(Boolean).join(" · ")),
					h("span", null, `${T("workspaceLabel")}: ${run.workspace ? run.workspace.title : "—"}`),
					h(
						"span",
						null,
						`${T("finishedAt")}: ${fmtTime(run.finishedAt || run.startedAt)} · ${run.outputCount} ${T("outputsUnit")} · ${fmtBytes(run.outputSizeBytes)}`,
					),
				),
				h(SummaryChips, { summary: run.summary }),
			);
		}

		function RecordCard({ record, index, filesSet, runRef, onOpen }) {
			const [broken, setBroken] = React.useState(false);
			const inRun = (record.images || []).filter((p) => filesSet.has(p));
			const primary = inRun[0] || (record.images || [])[0] || "";
			const name = primary ? primary.split("/").pop() : `#${index + 1}`;
			const f = record.fields || {};
			const badges = [];
			if (f.category !== undefined) {
				badges.push({ tone: "brand", text: `category: ${fmtValue(f.category)}` });
			}
			if (f.capture !== undefined) {
				badges.push({
					tone: f.capture === "real-photo" ? "success" : "error",
					text: `capture: ${fmtValue(f.capture)}`,
				});
			}
			if (f.exclusion_reason !== undefined) {
				badges.push({ tone: "error", text: `exclusion: ${fmtValue(f.exclusion_reason)}` });
			}
			const tagSet = [];
			const pushTags = (tags) => {
				for (const tag of Array.isArray(tags) ? tags : []) {
					if (typeof tag === "string" && !tagSet.includes(tag)) {
						tagSet.push(tag);
					}
				}
			};
			pushTags(f.tags);
			if (f.__dj__meta__ && typeof f.__dj__meta__ === "object" && Array.isArray(f.__dj__meta__.image_tags)) {
				for (const group of f.__dj__meta__.image_tags) {
					pushTags(group);
				}
			}
			const showable = primary && filesSet.has(primary) && !broken;
			return h(
				"button",
				{ type: "button", className: "rcxCard", onClick: () => onOpen(record) },
				showable
					? h("img", {
							className: "rcxThumb",
							src: assetUrl(runRef, primary),
							alt: name,
							loading: "lazy",
							onError: () => setBroken(true),
						})
					: h("div", { className: "rcxThumbPh" }, primary ? "🖼" : "📄"),
				h(
					"div",
					{ className: "rcxCardInfo" },
					h("div", { className: "rcxFileName", title: primary || undefined }, name),
					h(
						"div",
						{ className: "rcxCardBadges" },
						badges.map((b, i) => h("span", { key: `b${i}`, className: "rcxMini", "data-tone": b.tone }, b.text)),
						tagSet.slice(0, 5).map((tag, i) => h("span", { key: `t${i}`, className: "rcxMini" }, tag)),
					),
				),
			);
		}

		function useEscape(onClose) {
			React.useEffect(() => {
				const onKey = (e) => {
					if (e.key === "Escape") {
						onClose();
					}
				};
				window.addEventListener("keydown", onKey);
				return () => window.removeEventListener("keydown", onKey);
			}, [onClose]);
		}

		function RecordModal({ record, filesSet, runRef, onClose }) {
			useEscape(onClose);
			const images = record.images || [];
			const inRun = images.filter((p) => filesSet.has(p));
			const fields = Object.entries(record.fields || {}).filter(([key]) => key !== "__dj__meta__");
			const meta = record.fields && record.fields.__dj__meta__;
			const metaEntries = meta && typeof meta === "object" ? Object.entries(meta) : [];
			return h(
				"div",
				{ className: "rcxModal", role: "dialog", "aria-modal": "true", onClick: onClose },
				h(
					"div",
					{ className: "rcxModalBox", onClick: (e) => e.stopPropagation() },
					h(
						"div",
						{ className: "rcxModalHead" },
						h("div", { className: "rcxModalTitle" }, images[0] ? images[0].split("/").pop() : T("metadata")),
						inRun.length
							? h("a", { className: "rcxBtn", href: assetUrl(runRef, inRun[0], true), download: true }, T("download"))
							: null,
						h("button", { type: "button", className: "rcxIconBtn", onClick: onClose, "aria-label": T("close") }, "×"),
					),
					inRun.length
						? h(
								"div",
								{ className: "rcxModalImgs" },
								inRun.map((path) =>
									h("img", { key: path, className: "rcxModalImg", src: assetUrl(runRef, path), alt: path.split("/").pop() }),
								),
							)
						: null,
					images.length > inRun.length
						? h(
								"div",
								{ className: "rcxChips" },
								images
									.filter((p) => !filesSet.has(p))
									.map((path) => h("span", { key: path, className: "rcxChip" }, `${path.split("/").pop()} · ${T("externalFile")}`)),
							)
						: null,
					h("div", { className: "rcxTable" },
						fields.map(([key, value]) =>
							h(React.Fragment, { key: `f-${key}` },
								h("span", { className: "rcxTableKey" }, key),
								h("span", { className: "rcxTableVal" }, fmtValue(value)),
							),
						),
						metaEntries.map(([key, value]) =>
							h(React.Fragment, { key: `m-${key}` },
								h("span", { className: "rcxTableKey" }, `__dj__meta__.${key}`),
								h("span", { className: "rcxTableVal" }, fmtValue(value)),
							),
						),
					),
				),
			);
		}

		function TextModal({ file, runRef, onClose }) {
			useEscape(onClose);
			const [state, setState] = React.useState({ loading: true, error: "", text: "" });
			React.useEffect(() => {
				let alive = true;
				setState({ loading: true, error: "", text: "" });
				fetch(assetUrl(runRef, file.path))
					.then((r) => {
						if (!r.ok) {
							throw new Error(`HTTP ${r.status}`);
						}
						return r.text();
					})
					.then((text) => {
						if (alive) {
							setState({ loading: false, error: "", text: text.length > 400000 ? `${text.slice(0, 400000)}…` : text });
						}
					})
					.catch((e) => {
						if (alive) {
							setState({ loading: false, error: String(e?.message || e), text: "" });
						}
					});
				return () => {
					alive = false;
				};
			}, [runRef, file.path]);
			return h(
				"div",
				{ className: "rcxModal", role: "dialog", "aria-modal": "true", onClick: onClose },
				h(
					"div",
					{ className: "rcxModalBox", onClick: (e) => e.stopPropagation() },
					h(
						"div",
						{ className: "rcxModalHead" },
						h("div", { className: "rcxModalTitle" }, file.path),
						h("a", { className: "rcxBtn", href: assetUrl(runRef, file.path, true), download: true }, T("download")),
						h("button", { type: "button", className: "rcxIconBtn", onClick: onClose, "aria-label": T("close") }, "×"),
					),
					state.loading
						? h("div", { className: "rcxLoading" }, T("loading"))
						: state.error
							? h("div", { className: "rcxErr" }, `${T("loadFailed")}: ${state.error}`)
							: h("pre", { className: "rcxPre" }, state.text),
				),
			);
		}

		function RunDetail({ run, onBack }) {
			const [state, setState] = React.useState({ loading: true, error: "", data: null });
			const [modal, setModal] = React.useState(null);
			const load = React.useCallback(() => {
				setState({ loading: true, error: "", data: null });
				fetch(`${API}/run?ref=${encodeURIComponent(run.ref)}`)
					.then((r) => r.json())
					.then((p) => {
						if (p.ok !== true) {
							throw new Error(p.error || `HTTP ${r.status}`);
						}
						setState({ loading: false, error: "", data: p });
					})
					.catch((e) => {
						setState({ loading: false, error: String(e?.message || e), data: null });
					});
			}, [run.ref]);
			React.useEffect(() => {
				load();
			}, [load]);
			const filesSet = React.useMemo(() => {
				const set = new Set();
				for (const file of state.data?.files || []) {
					set.add(file.path);
				}
				return set;
			}, [state.data]);
			const groups = state.data?.groups || [];
			const textLike = (path) => /\.(md|txt|json|jsonl|csv|ya?ml)$/i.test(path);
			return h(
				"div",
				null,
				h("button", { type: "button", className: "rcxBack", onClick: onBack }, `← ${T("back")}`),
				h(
					"div",
					{ className: "rcxDetailHead" },
					h(
						"div",
						{ className: "rcxDetailTitle" },
						h("span", { className: "rcxDot", "data-status": run.status }),
						run.runId,
						h("span", { className: "rcxChip" }, statusLabel(run.status)),
					),
					h(
						"div",
						{ className: "rcxRunMeta" },
						h("span", null, [run.taskId, run.planVersion, run.slug].filter(Boolean).join(" · ")),
						h(
							"span",
							null,
							`${T("workspaceLabel")}: ${run.workspace ? `${run.workspace.title} (${run.workspace.path})` : "—"}`,
						),
						h(
							"span",
							null,
							`${T("startedAt")}: ${fmtTime(run.startedAt)} · ${T("finishedAt")}: ${fmtTime(run.finishedAt)} · ${run.outputCount} ${T("outputsUnit")} · ${fmtBytes(run.outputSizeBytes)}`,
						),
					),
					h(SummaryChips, { summary: run.summary }),
				),
				state.loading
					? h("div", { className: "rcxLoading" }, T("loading"))
					: state.error
						? h("div", { className: "rcxEmpty rcxErr" }, `${T("loadFailed")}: ${state.error}`)
						: h(
								"div",
								null,
								groups.length
									? groups.map((group) =>
											h(
												"section",
												{ key: group.file, className: "rcxSection" },
												h(
													"div",
													{ className: "rcxSectionHead" },
													h("h2", null, group.name),
													h(
														"span",
														{ className: "rcxSectionNote" },
														group.tooLarge
															? T("tooLarge")
															: `${group.count} ${T("recordsUnit")}${group.parseErrors ? ` · ${group.parseErrors} ${T("parseErrors")}` : ""}${group.count >= 2000 ? ` · ${T("recordsTruncated")}` : ""}`,
													),
													h("a", { className: "rcxBtn", href: assetUrl(run.ref, group.file, true), download: true }, T("download")),
												),
												h(
													"div",
													{ className: "rcxGrid" },
													group.records.map((record, index) =>
														h(RecordCard, {
															key: index,
															record,
															index,
															filesSet,
															runRef: run.ref,
															onOpen: (r) => setModal({ kind: "record", record: r }),
														}),
													),
												),
											),
										)
									: h("div", { className: "rcxEmpty" }, T("noGroups")),
								h(
									"section",
									{ className: "rcxSection" },
									h(
										"div",
										{ className: "rcxSectionHead" },
										h("h2", null, T("filesSection")),
										h("span", { className: "rcxSectionNote" }, `${(state.data?.files || []).length}`),
									),
									h(
										"div",
										{ className: "rcxFiles" },
										(state.data?.files || []).map((file) =>
											h(
												"div",
												{ key: file.path, className: "rcxFileRow" },
												h("span", { className: "rcxFileName", title: file.path }, file.path),
												h("span", { className: "rcxFileSize" }, fmtBytes(file.size)),
												textLike(file.path)
													? h(
															"button",
															{
																type: "button",
																className: "rcxBtn",
																onClick: () => setModal({ kind: "text", file }),
															},
															T("view"),
														)
													: null,
												h("a", { className: "rcxBtn", href: assetUrl(run.ref, file.path, true), download: true }, T("download")),
											),
										),
									),
								),
							),
				modal && modal.kind === "record"
					? h(RecordModal, { record: modal.record, filesSet, runRef: run.ref, onClose: () => setModal(null) })
					: null,
				modal && modal.kind === "text"
					? h(TextModal, { file: modal.file, runRef: run.ref, onClose: () => setModal(null) })
					: null,
			);
		}

		function ResultsPanel() {
			const [runs, setRuns] = React.useState(null);
			const [error, setError] = React.useState("");
			const [loading, setLoading] = React.useState(false);
			const [selected, setSelected] = React.useState(null);
			const load = React.useCallback(() => {
				setLoading(true);
				fetch(`${API}/runs`)
					.then((r) => r.json())
					.then((p) => {
						if (p.ok !== true) {
							throw new Error(p.error || `HTTP ${r.status}`);
						}
						setRuns(Array.isArray(p.runs) ? p.runs : []);
						setError("");
					})
					.catch((e) => {
						setError(String(e?.message || e));
					})
					.finally(() => {
						setLoading(false);
					});
			}, []);
			React.useEffect(() => {
				load();
			}, [load]);
			return h(
				"div",
				{ className: "rcxRoot" },
				h("style", null, css),
				h(
					"header",
					{ className: "rcxHeader" },
					h(
						"div",
						{ className: "rcxHeadText" },
						h("div", { className: "rcxTitle" }, T("title")),
						h("div", { className: "rcxSub" }, `${T("subtitle")}${runs ? ` · ${runs.length}` : ""}`),
					),
					h(
						"button",
						{ type: "button", className: "rcxIconBtn", onClick: load, "aria-label": T("refresh"), title: T("refresh") },
						"⟳",
					),
				),
				h(
					"div",
					{ className: "rcxBody" },
					selected
						? h(RunDetail, { run: selected, onBack: () => setSelected(null) })
						: error && !loading && !runs
							? h("div", { className: "rcxEmpty rcxErr" }, `${T("loadFailed")}: ${error}`)
							: loading && !runs
								? h("div", { className: "rcxLoading" }, T("loading"))
								: runs && runs.length
									? h(
											"div",
											{ className: "rcxRunGrid" },
											runs.map((run) => h(RunCard, { key: run.ref, run, onOpen: setSelected })),
										)
									: h("div", { className: "rcxEmpty" }, T("noRuns")),
				),
			);
		}

		return {
			inject: ["slots", "locale"],
			apply(ctx) {
				ctx.effect(() => ctx.locale.register(NS, dictionaries), "results-center: dictionaries");
				T = ctx.locale.bind(NS);
				ctx.effect(
					() =>
						ctx.slots.inject("sidebar.panellist", () =>
							ctx.slots.register(
								{ name: "sidebar.panellist", id: "results-center", order: 60, label: () => T("title") },
								PanelIcon,
							),
						),
					"results-center: sidebar entry",
				);
				ctx.effect(
					() =>
						ctx.slots.inject("main", () => ctx.slots.register({ name: "main", key: "results-center" }, ResultsPanel)),
					"results-center: main panel",
				);
			},
		};
	},
});
