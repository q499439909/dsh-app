window.__ModuleLoader__.load({
  id: "@dsh-dj/plan-explorer",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const React = require("react");
    const runtime = require("@deepseek-ai/dsh-client-runtime/client");
    const h = React.createElement;

    const css = `
.djPlanCard{position:relative;margin-top:16px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-business-primary) 30%,var(--dsw-alias-border-l2));border-radius:14px;padding:14px 15px;background:linear-gradient(135deg,color-mix(in srgb,var(--dsw-alias-state-business-primary) 7%,var(--dsw-alias-bg-base)),var(--dsw-alias-bg-base));max-width:620px}.djPlanDock{box-sizing:border-box;width:calc(100% - 32px);max-width:620px;margin:0 auto 8px}.djPlanDock .djPlanCard{max-width:none;margin-top:0}.djPlanCardTop{display:flex;gap:12px;align-items:flex-start}.djPlanCardIcon{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;flex:none;background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 13%,var(--dsw-alias-bg-base));color:var(--dsw-alias-state-business-primary)}.djPlanCardMain{min-width:0;flex:1}.djPlanCardTitle{font-size:14px;font-weight:680;line-height:21px;padding-right:24px}.djPlanCardMeta{margin-top:3px;color:var(--dsw-alias-label-tertiary);font-size:11px}.djPlanCardSummary{margin:10px 0 0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:19px}.djPlanCardClose{position:absolute;top:9px;right:9px;width:28px;height:28px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-tertiary);font:18px/1 sans-serif;cursor:pointer}.djPlanCardClose:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.djPlanCardActions{display:flex;gap:8px;margin-top:12px}.djPlanButton{height:32px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;padding:0 12px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer}.djPlanButton:disabled{cursor:default;opacity:.55}.djPlanButton[data-primary=true]{border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-state-business-primary);color:#fff}.djPlanCardError{margin:8px 0 0;color:var(--dsw-alias-state-error-primary);font-size:11px}
.djPlanRoot{height:100%;min-width:0;display:flex;flex-direction:column;overflow:hidden;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base)}.djPlanHeader{height:64px;box-sizing:border-box;display:flex;align-items:center;gap:9px;padding:0 18px;border-bottom:1px solid var(--dsw-alias-border-l2);flex:none}.djPlanTitleWrap{min-width:0}.djPlanTitle{font-size:16px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.djPlanVersion{font-size:10px;color:var(--dsw-alias-label-tertiary);font-family:monospace}.djPlanSpacer{flex:1}.djPlanIconButton{width:34px;height:34px;border:0;border-radius:9px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:18px}.djPlanIconButton:hover{background:var(--dsw-alias-interactive-bg-hover)}.djPlanTabs{height:44px;display:flex;align-items:end;gap:18px;padding:0 18px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none}.djPlanTab{height:38px;border:0;border-bottom:2px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}.djPlanTab[data-active=true]{color:var(--dsw-alias-state-business-primary);border-bottom-color:var(--dsw-alias-state-business-primary)}.djPlanBody{min-height:0;flex:1;overflow:auto;padding:18px;scrollbar-gutter:stable}.djPlanState{height:100%;display:grid;place-items:center;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:13px}.djPlanFlow{max-width:720px;margin:0 auto}.djPlanBoundary{text-align:center;border:1px dashed var(--dsw-alias-border-l2);border-radius:10px;padding:9px;color:var(--dsw-alias-label-tertiary);font-size:11px}.djPlanArrow{text-align:center;color:var(--dsw-alias-label-tertiary);line-height:25px}.djPlanStage{border:1px solid var(--dsw-alias-border-l2);border-radius:13px;overflow:hidden;background:var(--dsw-alias-bg-base)}.djPlanStageHead{width:100%;box-sizing:border-box;border:0;background:transparent;color:inherit;padding:12px 13px;display:flex;align-items:center;gap:10px;text-align:left;cursor:pointer}.djPlanStageHead:hover{background:var(--dsw-alias-interactive-bg-hover)}.djPlanStageName{min-width:0;flex:1}.djPlanStageTitle{font-size:13px;font-weight:680}.djPlanStageSummary{margin-top:2px;color:var(--dsw-alias-label-tertiary);font-size:10px}.djPlanStatus{width:8px;height:8px;border-radius:50%;background:#94a3b8;flex:none}.djPlanStatus[data-status=running]{background:#3b82f6;box-shadow:0 0 0 3px #3b82f622}.djPlanStatus[data-status=succeeded]{background:#22c55e}.djPlanStatus[data-status=failed]{background:#ef4444}.djPlanStatus[data-status=cancelled],.djPlanStatus[data-status=skipped]{background:#a1a1aa}.djPlanSteps{border-top:1px solid var(--dsw-alias-border-l1);padding:6px}.djPlanStep{width:100%;box-sizing:border-box;border:0;border-radius:8px;background:transparent;color:inherit;padding:9px 10px;display:flex;align-items:center;gap:9px;text-align:left;cursor:pointer}.djPlanStep:hover,.djPlanStep[data-selected=true]{background:var(--dsw-alias-interactive-bg-hover)}.djPlanStepIndex{color:var(--dsw-alias-label-tertiary);font:10px monospace}.djPlanStepName{min-width:0;flex:1;font:11px monospace;overflow-wrap:anywhere}.djPlanStepMetrics{color:var(--dsw-alias-label-tertiary);font-size:9px}.djPlanCode{margin:0;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:14px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font:11px/18px monospace;white-space:pre-wrap;overflow-wrap:anywhere}.djPlanDetailTitle{margin:0 0 10px;font-size:15px}.djPlanHint{margin-bottom:12px;border-radius:9px;padding:9px 11px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:18px}.djPlanFooter{display:flex;gap:8px;padding:12px 18px;border-top:1px solid var(--dsw-alias-border-l1);flex:none}
`;
    const styleId = "@dsh-dj/plan-explorer/client.css";
    if (typeof document !== "undefined" && !document.querySelector(`style[data-plugin-css="${styleId}"]`)) {
      const tag = document.createElement("style");
      tag.dataset.pluginCss = styleId;
      tag.textContent = css;
      document.head.appendChild(tag);
    }

    const NS = "djPlanExplorer";
    const dictionaries = {
      zh: { plan:"方案",show:"展示",create:"创建任务",adjust:"让 DSH 调整方案",submitting:"提交中…",submitFailed:"提交失败，请重试",arrangement:"编排",fullPlan:"完整 Plan",detail:"节点详情",input:"数据输入",output:"结果输出",loading:"正在加载方案…",unavailable:"方案暂时不可用",maximize:"最大化",restore:"恢复停靠",close:"关闭",reviewHint:"第一版为只读展示；确认或调整方案会通过 DSH 对话生成操作。",noSelection:"请在编排中选择一个算子步骤查看配置。",steps:"{count} 个执行步骤",stages:"{count} 个阶段" },
      en: { plan:"Plan",show:"Show",create:"Create task",adjust:"Ask DSH to adjust",submitting:"Submitting…",submitFailed:"Submission failed. Try again.",arrangement:"Flow",fullPlan:"Full plan",detail:"Step details",input:"Data input",output:"Result output",loading:"Loading plan…",unavailable:"Plan is unavailable",maximize:"Maximize",restore:"Restore",close:"Close",reviewHint:"The first version is read-only. Confirm or adjust the plan through the DSH conversation.",noSelection:"Select an operator step in the flow to inspect its configuration.",steps:"{count} execution steps",stages:"{count} stages" }
    };

    const plans = new Map();
    const runs = new Map();
    const latestPlans = new Map();
    const dismissedPlans = new Set();
    let activeSessionId = null;
    let planPanelOpen = false;
    function planKey(ref){return `${ref.workspace_root}|${ref.task_id}|${ref.plan_version}`}
    function setPlanPanelOpen(open){planPanelOpen=open;window.dispatchEvent(new CustomEvent("dsh-dj-plan-state"))}
    function openPage(page){setPlanPanelOpen(page?.kind==="plan");window.dispatchEvent(new CustomEvent("dsh-dj-open-auxiliary",{detail:page}))}
    function registerPlan(sessionId,ref){plans.set(planKey(ref),ref);latestPlans.set(sessionId,ref);window.dispatchEvent(new CustomEvent("dsh-dj-plan-state"))}
    function setActiveSession(sessionId){activeSessionId=sessionId??null;window.dispatchEvent(new CustomEvent("dsh-dj-plan-state"))}
    function activePlan(){return activeSessionId===null?null:latestPlans.get(activeSessionId)||null}
    function registerActivePlan(ref){if(activeSessionId!==null&&ref)registerPlan(activeSessionId,ref)}
    function sessionPlanKey(sessionId,ref){return `${sessionId}|${planKey(ref)}`}
    function dismissPlan(sessionId,ref){dismissedPlans.add(sessionPlanKey(sessionId,ref));window.dispatchEvent(new CustomEvent("dsh-dj-plan-state"))}
    function isPlanDismissed(sessionId,ref){return dismissedPlans.has(sessionPlanKey(sessionId,ref))}
    function registerRun(item){const run=item.run||item;if(item.workspace_root&&run?.task_id&&run?.plan_version){runs.set(`${item.workspace_root}|${run.task_id}|${run.plan_version}`,run);window.dispatchEvent(new CustomEvent("dsh-dj-plan-state"))}}

    function collectPayloadCandidates(value,candidates=[]){
      if(value==null)return candidates;
      if(typeof value==="string"){candidates.push(value);return candidates}
      if(Array.isArray(value)){for(const item of value)collectPayloadCandidates(item,candidates);return candidates}
      if(typeof value!=="object")return candidates;
      if(typeof value.text==="string")candidates.push(value.text);
      if(value.structuredContent!==undefined)candidates.push(value.structuredContent);
      if(value.content!==undefined)collectPayloadCandidates(value.content,candidates);
      return candidates;
    }
    function payloadFrom(message){
      const candidates=[message?.meta,...collectPayloadCandidates(message?.content)];
      for(const candidate of candidates){
        let value=candidate;
        if(typeof value==="string")try{value=JSON.parse(value)}catch{continue}
        if(value?.structuredContent)value=value.structuredContent;
        if(value&&typeof value==="object"&&value.ok===true)return value;
      }
      return null;
    }
    function asPlan(value){if(!value?.workspace_root||!value?.task_id||!value?.plan_version||!value?.content_hash)return null;return{workspace_root:value.workspace_root,task_id:value.task_id,plan_version:value.plan_version,content_hash:value.content_hash,title:value.plan?.user_intent||value.task_id,summary:value.plan?.summary||value.plan?.user_intent||"",valid:value.valid!==false,stage_count:value.view?.groups?.length||0,step_count:value.view?.steps?.length||value.plan?.recipe?.process?.length||0}}

    const projectionDefinition={
      kind:"dj-plans",
      match:(event)=>{
        if(event.type==="turn/start")return{id:String(event.data.turn),role:"start"};
        if(event.type==="tool/call")return{id:String(event.data.turn),role:"update"};
        if(event.type==="tool/result"&&(runtime.isAppendSurfaceEvent(event)||event.data?.surfaceOp==="append"))return{id:String(event.data.turn),role:"update"};
        return null;
      },
      start:(_context,match)=>({turn:match.event.data.turn,calls:new Map(),plans:[],runs:[]}),
      update:(context,match)=>{
        if(match.event.type==="tool/call"){const calls=new Map(context.state.calls);calls.set(String(match.event.data.callId),match.event.data.name);return{...context.state,calls}}
        if(match.event.type!=="tool/result")return context.state;
        const callId=String(match.event.data.message?.source?.callId||"");
        const name=context.state.calls.get(callId)||"";
        const value=payloadFrom(match.event.data.message);
        if(!value)return context.state;
        if(name.endsWith("prepare_plan")){const ref=asPlan(value);return ref?{...context.state,plans:[...context.state.plans,{seq:match.event.seq,ref}]}:context.state}
        if(name.endsWith("run_plan")||name.endsWith("get_run"))return{...context.state,runs:[...context.state.runs,{seq:match.event.seq,value}]};
        return context.state;
      },
      buildLocationData:(context,scope)=>scope!=="turn"||context.state===undefined?null:{kind:"turn",turn:context.state.turn,key:"dj-plans",value:{plans:context.state.plans,runs:context.state.runs}}
    };
    function selectPlanData(owner){const data=owner.turn.data.get("dj-plans");if(!data)return null;const ps=(data.plans||[]).filter(x=>x.seq<=owner.seq);const rs=(data.runs||[]).filter(x=>x.seq<=owner.seq);return ps.length||rs.length?{plans:ps,runs:rs}:null}

    function PlanCard({planRef,sessionId,t,onAction,onClose}){
      const[busy,setBusy]=React.useState(""),[error,setError]=React.useState("");
      React.useEffect(()=>{registerPlan(sessionId,planRef)},[sessionId,planRef]);
      const act=async action=>{if(busy)return;setBusy(action);setError("");try{await onAction(action,planRef);if(action==="create")onClose?.()}catch{setError(t("submitFailed"))}finally{setBusy("")}};
      const closeButton=onClose?h("button",{type:"button",className:"djPlanCardClose",title:t("close"),"aria-label":t("close"),onClick:onClose},"×"):null;
      const actions=h("div",{className:"djPlanCardActions"},
        h("button",{type:"button",className:"djPlanButton","data-primary":true,disabled:!!busy,onClick:()=>openPage({kind:"plan",planRef})},t("show")),
        h("button",{type:"button",className:"djPlanButton",disabled:!!busy,onClick:()=>act("create")},busy==="create"?t("submitting"):t("create"))
      );
      const main=h("div",{className:"djPlanCardMain"},
        h("div",{className:"djPlanCardTitle"},planRef.title),
        h("div",{className:"djPlanCardMeta"},`${planRef.plan_version} · ${t("stages").replace("{count}",planRef.stage_count)} · ${t("steps").replace("{count}",planRef.step_count)}`),
        planRef.summary?h("p",{className:"djPlanCardSummary"},planRef.summary):null,
        actions,
        error?h("p",{className:"djPlanCardError",role:"alert"},error):null
      );
      return h("section",{className:"djPlanCard"},closeButton,h("div",{className:"djPlanCardTop"},h("div",{className:"djPlanCardIcon"},"◇"),main));
    }
    function PlanTurnTail({matched,sessionId,t,onAction}){
      const[,refresh]=React.useReducer(x=>x+1,0);
      React.useEffect(()=>{for(const item of matched.runs)registerRun(item.value)},[matched.runs]);
      React.useEffect(()=>{const keys=new Set(matched.plans.map(item=>planKey(item.ref)));const listener=event=>{const detail=event.detail;if(detail?.planRef&&keys.has(planKey(detail.planRef)))onAction(detail.action,detail.planRef)};window.addEventListener("dsh-dj-plan-action",listener);return()=>window.removeEventListener("dsh-dj-plan-action",listener)},[matched.plans,onAction]);
      return h(React.Fragment,null,...matched.plans.filter(item=>!isPlanDismissed(sessionId,item.ref)).map(item=>h(PlanCard,{planRef:item.ref,sessionId,t,onAction,onClose:()=>{dismissPlan(sessionId,item.ref);refresh()},key:planKey(item.ref)})));
    }
    function SessionPlanScope({sessionId}){
      React.useEffect(()=>{setActiveSession(sessionId);return()=>{if(activeSessionId===sessionId)setActiveSession(null)}},[sessionId]);
      return null;
    }

    function mountLauncher(t){
      if(typeof document==="undefined")return()=>{};
      const button=document.createElement("button");button.type="button";button.className="djPlanLauncher";button.setAttribute("role","tab");button.textContent=t("plan");button.hidden=true;button.addEventListener("click",()=>{const plan=activePlan();if(plan)openPage({kind:"plan",planRef:plan})});
      const place=()=>{const plan=activePlan();button.hidden=!plan;button.setAttribute("aria-selected",String(planPanelOpen&&!!plan));const lists=Array.from(document.querySelectorAll('[role="tablist"]'));const list=lists.find(node=>/轨迹|Trajectory/i.test(node.textContent||""));if(!list)return;const nativeTabs=Array.from(list.querySelectorAll('[role="tab"]')).filter(node=>node!==button);const inactive=nativeTabs.find(node=>node.getAttribute("aria-selected")!=="true")||nativeTabs[0];const active=nativeTabs.find(node=>node.getAttribute("aria-selected")==="true");const baseClasses=new Set(Array.from(inactive?.classList||[]));const activeClasses=Array.from(active?.classList||[]).filter(name=>!baseClasses.has(name));button.className=[...baseClasses,...planPanelOpen&&plan?activeClasses:[],"djPlanLauncher"].join(" ");if(!list.contains(button))list.appendChild(button)};
      const observer=new MutationObserver(place);observer.observe(document.body,{childList:true,subtree:true});window.addEventListener("dsh-dj-plan-state",place);place();
      return()=>{observer.disconnect();window.removeEventListener("dsh-dj-plan-state",place);button.remove()};
    }

    function statusFor(group,stepMap){const states=group.step_refs.map(id=>stepMap.get(id)?.status||"pending");if(states.includes("failed"))return"failed";if(states.includes("running"))return"running";if(states.every(s=>s==="succeeded"))return"succeeded";if(states.every(s=>s==="cancelled"))return"cancelled";return"pending"}
    function PlanExplorer({planRef,width,maximized,t,close,toggleMaximized}){
      const[data,setData]=React.useState(null),[error,setError]=React.useState(""),[tab,setTab]=React.useState("flow"),[selected,setSelected]=React.useState(null),[expanded,setExpanded]=React.useState(()=>new Set());
      const[,refresh]=React.useReducer(x=>x+1,0);
      const key=planKey(planRef),run=runs.get(key);
      const[runState,setRunState]=React.useState(run||null);
      React.useEffect(()=>{let dead=false;setData(null);setError("");const q=new URLSearchParams({workspace_root:planRef.workspace_root,task_id:planRef.task_id,plan_version:planRef.plan_version,include_versions:"true"});fetch(`/api/dj/plan-view?${q}`).then(r=>r.json().then(p=>{if(!r.ok||p.ok!==true)throw new Error(p.message||`HTTP ${r.status}`);if(!dead)setData(p)})).catch(e=>!dead&&setError(String(e)));return()=>{dead=true}},[key]);
      React.useEffect(()=>{const sync=()=>{setRunState(runs.get(key)||null);refresh()};window.addEventListener("dsh-dj-plan-state",sync);return()=>window.removeEventListener("dsh-dj-plan-state",sync)},[key]);
      React.useEffect(()=>{const runId=runState?.run_id;if(!runId||!["starting","running"].includes(runState.status))return;let dead=false;const poll=()=>{const q=new URLSearchParams({workspace_root:planRef.workspace_root,task_id:planRef.task_id,run_id:runId});fetch(`/api/dj/run-steps?${q}`).then(r=>r.json()).then(p=>{if(dead||p.ok!==true)return;setRunState(p.run);runs.set(key,p.run);if(["starting","running"].includes(p.run.status))timer=setTimeout(poll,2000)}).catch(()=>{if(!dead)timer=setTimeout(poll,2000)})};let timer=setTimeout(poll,200);return()=>{dead=true;clearTimeout(timer)}},[key,runState?.run_id,runState?.status]);
      const stepMap=React.useMemo(()=>{const map=new Map();for(const step of data?.view?.steps||[]){const state=(runState?.steps||[]).find(item=>item.process_index===step.process_index&&item.operator_name===step.operator_name);map.set(step.id,{...step,...state})}return map},[data,runState]);
      const toggle=id=>setExpanded(old=>{const next=new Set(old);next.has(id)?next.delete(id):next.add(id);return next});
      const choose=id=>{setSelected(id);setTab("detail")};
      let body;
      if(error)body=h("div",{className:"djPlanState"},`${t("unavailable")}：${error}`);
      else if(!data)body=h("div",{className:"djPlanState"},t("loading"));
      else if(tab==="plan")body=h("pre",{className:"djPlanCode"},JSON.stringify(data.plan,null,2));
      else if(tab==="detail"){
        const step=selected?stepMap.get(selected):null,item=step?data.plan.recipe.process[step.process_index]:null;
        body=step?h("div",null,h("h2",{className:"djPlanDetailTitle"},step.operator_name),h("div",{className:"djPlanHint"},`recipe.process[${step.process_index}] · ${step.status||"pending"}`),h("pre",{className:"djPlanCode"},JSON.stringify(item,null,2))):h("div",{className:"djPlanState"},t("noSelection"));
      }else body=h("div",{className:"djPlanFlow"},h("div",{className:"djPlanBoundary"},t("input")),...data.view.groups.flatMap(group=>{const open=expanded.has(group.id);return[h("div",{className:"djPlanArrow",key:`a-${group.id}`},"↓"),h("section",{className:"djPlanStage",key:group.id},h("button",{type:"button",className:"djPlanStageHead",onClick:()=>toggle(group.id)},h("span",{className:"djPlanStatus","data-status":statusFor(group,stepMap)}),h("span",{className:"djPlanStageName"},h("div",{className:"djPlanStageTitle"},group.title),group.summary?h("div",{className:"djPlanStageSummary"},group.summary):null),h("span",null,open?"⌃":"⌄")),open?h("div",{className:"djPlanSteps"},...group.step_refs.map(id=>{const step=stepMap.get(id);return h("button",{type:"button",className:"djPlanStep","data-selected":selected===id,onClick:()=>choose(id),key:id},h("span",{className:"djPlanStatus","data-status":step.status||"pending"}),h("span",{className:"djPlanStepIndex"},String(step.process_index+1).padStart(2,"0")),h("span",{className:"djPlanStepName"},step.operator_name),step.duration_ms!==undefined?h("span",{className:"djPlanStepMetrics"},`${step.duration_ms} ms`):null) })):null)]}),h("div",{className:"djPlanArrow"},"↓"),h("div",{className:"djPlanBoundary"},t("output")));
      const action=kind=>window.dispatchEvent(new CustomEvent("dsh-dj-plan-action",{detail:{action:kind,planRef}}));
      return h("section",{className:"djPlanRoot","aria-hidden":width===0},h("header",{className:"djPlanHeader"},h("div",{className:"djPlanTitleWrap"},h("div",{className:"djPlanTitle"},data?.plan?.user_intent||planRef.title),h("div",{className:"djPlanVersion"},planRef.plan_version)),h("span",{className:"djPlanSpacer"}),h("button",{type:"button",className:"djPlanIconButton",title:maximized?t("restore"):t("maximize"),onClick:toggleMaximized},maximized?"◲":"⛶"),h("button",{type:"button",className:"djPlanIconButton",title:t("close"),onClick:close},"×")),h("nav",{className:"djPlanTabs"},...[["flow","arrangement"],["plan","fullPlan"],["detail","detail"]].map(([id,label])=>h("button",{type:"button",className:"djPlanTab","data-active":tab===id,onClick:()=>setTab(id),key:id},t(label)))),h("div",{className:"djPlanBody"},body),h("footer",{className:"djPlanFooter"},h("button",{type:"button",className:"djPlanButton","data-primary":true,onClick:()=>action("create")},t("create")),h("button",{type:"button",className:"djPlanButton",onClick:()=>action("adjust")},t("adjust"))))
    }

    function AuxiliaryHost({width,maximized,t,operatorT,close,toggleMaximized,open}){
      const[page,setPage]=React.useState({kind:"operator-library"});
      const[,operatorReady]=React.useReducer(x=>x+1,0);
      React.useEffect(()=>{const onOpen=event=>{const next=event.detail;setPlanPanelOpen(next?.kind==="plan");if(next?.kind==="plan"&&next.planRef)registerActivePlan(next.planRef);setPage(next);open()};window.addEventListener("dsh-dj-open-auxiliary",onOpen);return()=>window.removeEventListener("dsh-dj-open-auxiliary",onOpen)},[open]);
      React.useEffect(()=>{window.addEventListener("dsh-dj-operator-ready",operatorReady);return()=>window.removeEventListener("dsh-dj-operator-ready",operatorReady)},[]);
      if(page?.kind==="plan"&&page.planRef)return h(PlanExplorer,{planRef:page.planRef,width,maximized,t,close,toggleMaximized});
      const OperatorLibrary=window.__dshDjOperatorLibrary;
      return OperatorLibrary?h(OperatorLibrary,{width,maximized,t:operatorT,close,toggleMaximized}):h("div",{className:"djPlanState"},"Operator library is unavailable");
    }

    const inject=["slots","locale","layout","conversationEvents","conversation"];
    function apply(ctx){
      ctx.conversationEvents.register(projectionDefinition);
      ctx.effect(()=>ctx.locale.register(NS,dictionaries),"dj-plan-explorer: dictionaries");
      const t=ctx.locale.bind(NS),operatorT=ctx.locale.bind("djOperatorLibrary");
      ctx.effect(()=>mountLauncher(t),"dj-plan-explorer: persistent launcher");
      const onAction=(action,ref)=>ctx.conversation.send(action==="create"?`确认并创建任务：批准并执行方案 ${ref.task_id}/${ref.plan_version}，content_hash=${ref.content_hash}`:`我想调整方案 ${ref.task_id}/${ref.plan_version}，请询问我需要修改的内容。`);
      ctx.slots.inject("conversation.chat.turnTail",()=>ctx.slots.register({name:"conversation.chat.turnTail",select:selectPlanData,locale:NS,inject:(sessionId)=>({onAction,sessionId})},PlanTurnTail));
      ctx.slots.inject("conversation.input.dock",()=>ctx.slots.register({name:"conversation.input.dock",id:"dj-plan-session-scope",order:20,inject:(sessionId)=>({sessionId})},SessionPlanScope));
      ctx.slots.inject("shell.auxiliary",()=>ctx.slots.register({name:"shell.auxiliary",locale:NS,inject:()=>({operatorT,close:()=>{setPlanPanelOpen(false);ctx.layout.closeAuxiliary()},toggleMaximized:()=>ctx.layout.toggleAuxiliaryMaximized(),open:()=>ctx.layout.openAuxiliary()})},AuxiliaryHost));
    }
    exports.payloadFrom=payloadFrom;exports.projectionDefinition=projectionDefinition;exports.planSessionState={registerPlan,setActiveSession,activePlan,registerActivePlan,dismissPlan,isPlanDismissed};exports.apply=apply;exports.inject=inject;return module.exports;
  }
});
