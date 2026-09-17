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
.djTaskStatus{border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-base);font-size:12px;padding:8px 12px}.djTaskStatus>summary{cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.djTaskDetail{border-top:1px solid var(--dsw-alias-border-l2);margin-top:8px;padding-top:8px}.djPlanRoot{height:100%;min-width:0;display:flex;flex-direction:column;overflow:hidden;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base)}.djPlanHeader{height:64px;box-sizing:border-box;display:flex;align-items:center;gap:9px;padding:0 18px;border-bottom:1px solid var(--dsw-alias-border-l2);flex:none}.djPlanTitleWrap{min-width:0}.djPlanTitle{font-size:16px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.djPlanVersion{font-size:10px;color:var(--dsw-alias-label-tertiary);font-family:monospace}.djPlanSpacer{flex:1}.djPlanIconButton{width:34px;height:34px;border:0;border-radius:9px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:18px}.djPlanIconButton:hover{background:var(--dsw-alias-interactive-bg-hover)}.djPlanTabs{height:44px;display:flex;align-items:end;gap:18px;padding:0 18px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none}.djPlanTab{height:38px;border:0;border-bottom:2px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}.djPlanTab[data-active=true]{color:var(--dsw-alias-state-business-primary);border-bottom-color:var(--dsw-alias-state-business-primary)}.djPlanBody{min-height:0;flex:1;overflow:auto;padding:18px;scrollbar-gutter:stable}.djPlanState{height:100%;display:grid;place-items:center;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:13px}.djPlanFlow{max-width:720px;margin:0 auto}.djPlanBoundary{text-align:center;border:1px dashed var(--dsw-alias-border-l2);border-radius:10px;padding:9px;color:var(--dsw-alias-label-tertiary);font-size:11px}.djPlanArrow{text-align:center;color:var(--dsw-alias-label-tertiary);line-height:25px}.djPlanStage{border:1px solid var(--dsw-alias-border-l2);border-radius:13px;overflow:hidden;background:var(--dsw-alias-bg-base)}.djPlanStageHead{width:100%;box-sizing:border-box;border:0;background:transparent;color:inherit;padding:12px 13px;display:flex;align-items:center;gap:10px;text-align:left;cursor:pointer}.djPlanStageHead:hover{background:var(--dsw-alias-interactive-bg-hover)}.djPlanStageName{min-width:0;flex:1}.djPlanStageTitle{font-size:13px;font-weight:680}.djPlanStageSummary{margin-top:2px;color:var(--dsw-alias-label-tertiary);font-size:10px}.djPlanStatus{width:8px;height:8px;border-radius:50%;background:#94a3b8;flex:none}.djPlanStatus[data-status=running]{background:#3b82f6;box-shadow:0 0 0 3px #3b82f622}.djPlanStatus[data-status=succeeded]{background:#22c55e}.djPlanStatus[data-status=failed]{background:#ef4444}.djPlanStatus[data-status=cancelled],.djPlanStatus[data-status=skipped]{background:#a1a1aa}.djPlanSteps{border-top:1px solid var(--dsw-alias-border-l1);padding:6px}.djPlanStep{width:100%;box-sizing:border-box;border:0;border-radius:8px;background:transparent;color:inherit;padding:9px 10px;display:flex;align-items:center;gap:9px;text-align:left;cursor:pointer}.djPlanStep:hover,.djPlanStep[data-selected=true]{background:var(--dsw-alias-interactive-bg-hover)}.djPlanStepIndex{color:var(--dsw-alias-label-tertiary);font:10px monospace}.djPlanStepName{min-width:0;flex:1;font:11px monospace;overflow-wrap:anywhere}.djPlanStepMetrics{color:var(--dsw-alias-label-tertiary);font-size:9px}.djPlanCode{margin:0;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:14px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font:11px/18px monospace;white-space:pre-wrap;overflow-wrap:anywhere}.djPlanDetailTitle{margin:0 0 10px;font-size:15px}.djPlanHint{margin-bottom:12px;border-radius:9px;padding:9px 11px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:18px}.djPlanFooter{display:flex;gap:8px;padding:12px 18px;border-top:1px solid var(--dsw-alias-border-l1);flex:none}
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
      zh: { plan:"方案",show:"展示",create:"批准并运行",adjust:"让 DSH 调整方案",submitting:"提交中…",submitFailed:"提交失败，请重试",arrangement:"编排",fullPlan:"完整 Plan",detail:"节点详情",input:"数据输入",output:"结果输出",loading:"正在加载方案…",unavailable:"方案暂时不可用",maximize:"最大化",restore:"恢复停靠",close:"关闭",reviewHint:"第一版为只读展示；确认或调整方案会通过 DSH 对话生成操作。",noSelection:"请在编排中选择一个算子步骤查看配置。",steps:"{count} 个执行步骤",stages:"{count} 个阶段" },
      en: { plan:"Plan",show:"Show",create:"Approve and run",adjust:"Ask DSH to adjust",submitting:"Submitting…",submitFailed:"Submission failed. Try again.",arrangement:"Flow",fullPlan:"Full plan",detail:"Step details",input:"Data input",output:"Result output",loading:"Loading plan…",unavailable:"Plan is unavailable",maximize:"Maximize",restore:"Restore",close:"Close",reviewHint:"The first version is read-only. Confirm or adjust the plan through the DSH conversation.",noSelection:"Select an operator step in the flow to inspect its configuration.",steps:"{count} execution steps",stages:"{count} stages" }
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
    function registerPlan(sessionId,ref){const old=plans.get(planKey(ref));ref=old?.decision_id&&!ref.decision_id?{...ref,...old}:old?{...old,...ref}:ref;plans.set(planKey(ref),ref);latestPlans.set(sessionId,ref);window.dispatchEvent(new CustomEvent("dsh-dj-plan-state"))}
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
    function asPlan(value){if(!value?.workspace_root||!value?.task_id||!value?.plan_version||!value?.content_hash)return null;return{workspace_root:value.workspace_root,task_id:value.task_id,plan_version:value.plan_version,content_hash:value.content_hash,title:value.plan?.user_intent||value.task_id,summary:value.plan?.summary||value.plan?.user_intent||"",valid:value.valid!==false&&value.validation?.ok!==false&&value.runtime_assessment?.ok!==false,stage_count:value.view?.groups?.length||0,step_count:value.view?.steps?.length||value.plan?.recipe?.process?.length||0}}

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

    const uiQueue=[];
    function recordUi(event,sessionId,ref={}){if(!sessionId)return;uiQueue.push({event,session_id:sessionId,task_id:ref.task_id,plan_version:ref.plan_version,code:ref.code,request_id:ref.request_id,client_time:Date.now()});if(uiQueue.length>30)uiQueue.shift();const batch=uiQueue.splice(0);Promise.all(batch.map(item=>fetch('/api/dj/ui-event',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(item)}).catch(()=>{if(uiQueue.length<30)uiQueue.push(item)}))).catch(()=>{})}
    class PlanBoundary extends (React.Component||class{}){
      constructor(props){super(props);this.state={failed:false}}
      static getDerivedStateFromError(){return {failed:true}}
      componentDidCatch(){recordUi("render_failed",this.props.sessionId)}
      render(){return this.state.failed?h("p",{role:"alert"},"方案显示暂时异常，请通过任务状态入口查看已保存的方案。"):this.props.children}
    }
    function PlanCard({planRef,sessionId,t,onAction,onClose}){
      const[busy,setBusy]=React.useState(""),[error,setError]=React.useState("");
      React.useEffect(()=>{registerPlan(sessionId,planRef);recordUi("card_rendered",sessionId,planRef)},[sessionId,planRef]);
      const act=async action=>{if(busy)return;setBusy(action);setError("");try{await onAction(action,planRef);if(action==="create")onClose?.()}catch{setError(t("submitFailed"))}finally{setBusy("")}};
      const closeButton=onClose?h("button",{type:"button",className:"djPlanCardClose",title:t("close"),"aria-label":t("close"),onClick:onClose},"×"):null;
      const actions=h("div",{className:"djPlanCardActions"},
        h("button",{type:"button",className:"djPlanButton","data-primary":true,disabled:!!busy,onClick:()=>openPage({kind:"plan",planRef})},t("show"))
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
      return h(React.Fragment,null,...matched.plans.filter(item=>!isPlanDismissed(sessionId,item.ref)).map(item=>h(PlanCard,{planRef:item.ref,sessionId,t,onAction,onClose:()=>{dismissPlan(sessionId,item.ref);refresh()},key:planKey(item.ref)})));
    }
    function SessionPlanScope({sessionId,onAction}){
      const progressText=run=>{if(!run||['succeeded','failed','cancelled'].includes(run.status))return'';const steps=Array.isArray(run.steps)?run.steps:[],active=steps.find(step=>step.status==='running')||[...steps].reverse().find(step=>step.status==='succeeded'),done=steps.filter(step=>['succeeded','skipped'].includes(step.status)).length,index=active?Number(active.process_index)+1:null,percent=steps.length?Math.round(done/steps.length*100):null,parts=[];if(active?.operator_name)parts.push(active.operator_name);if(Number.isFinite(index)&&steps.length)parts.push(`第 ${index}/${steps.length} 步`);if(Number.isFinite(percent))parts.push(`${percent}%`);return parts.join(' · ')};
      const[items,setItems]=React.useState([]),[connection,setConnection]=React.useState("online"),[activity,setActivity]=React.useState([]),[refreshKey,reload]=React.useReducer(x=>x+1,0),[actionError,setActionError]=React.useState(""),[busy,setBusy]=React.useState(false);
      React.useEffect(()=>{setItems([]);setActivity([]);setConnection("online");setActionError("")},[sessionId]);
      React.useEffect(()=>{
        let dead=false,timer,received=false,failures=0,controller,pending=false;
        recordUi("plugin_ready",sessionId);
        const refresh=async()=>{
          if(dead||pending)return;pending=true;let delay=document.hidden?30000:5000,stop=false;
          const requestId=crypto.randomUUID();controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),10000);
          try{
            const response=await fetch(`/api/dj/session-plans?${new URLSearchParams({session_id:sessionId})}`,{signal:controller.signal,headers:{'x-dj-request-id':requestId}});
            if(response.status===401||response.status===403){setConnection(response.status===401?'auth_required':'forbidden');stop=true;return}
            const value=await response.json();if(!response.ok||!value.ok)throw new Error('WORKFLOW_UNAVAILABLE');
            if(dead)return;
            if(failures)recordUi('connection_restored',sessionId,{request_id:requestId});
            failures=0;setItems(value.plans);setActivity((value.activity||[]).filter(a=>a.event.startsWith('tool_')));setConnection('online');
            if(!received&&value.plans.length){received=true;recordUi('plan_received',sessionId,value.plans[0])}
            for(const ref of [...value.plans].reverse()){registerPlan(sessionId,ref);if(ref.run)registerRun({...ref,run:{...ref.run,task_id:ref.task_id,plan_version:ref.plan_version}})}
            if(value.plans.length&&value.plans.every(p=>['succeeded','failed','cancelled','needs_review'].includes(p.workflow_state)))delay=30000;
          }catch(error){
            if(!dead){failures++;setConnection(failures>2?'offline':'reconnecting');recordUi('connection_failed',sessionId,{code:error.name==='AbortError'?'TIMEOUT':'FETCH_FAILED',request_id:requestId});delay=Math.min(30000,1000*2**failures)}
          }finally{clearTimeout(timeout);pending=false;if(!dead&&!stop)timer=setTimeout(refresh,delay)}
        };
        const refreshNow=()=>{clearTimeout(timer);refresh()};
        window.addEventListener('dsh-dj-workflow-refresh',refreshNow);window.addEventListener('online',refreshNow);
        if(sessionId)refresh();
        return()=>{dead=true;controller?.abort();clearTimeout(timer);window.removeEventListener('dsh-dj-workflow-refresh',refreshNow);window.removeEventListener('online',refreshNow)};
      },[sessionId,refreshKey]);
      React.useEffect(()=>{setActiveSession(sessionId);return()=>{if(activeSessionId===sessionId)setActiveSession(null)}},[sessionId]);
      const labels={awaiting_approval:'待确认',queued:'已批准，等待启动',submitted:'已启动',starting:'启动中',preparing_models:'准备模型',running:'运行中',cancelling:'正在取消',succeeded:'运行成功',failed:'运行失败',cancelled:'已取消',needs_review:'处理完成，待验收',blocked:'启动受阻'};
      const latest=items.filter((p,i)=>items.findIndex(x=>x.task_id===p.task_id)===i);
      const connectionText={reconnecting:'连接中断，正在重试',offline:'暂时无法连接服务',auth_required:'登录已过期，请重新登录',forbidden:'当前账号无法访问此任务'};
      const act=async(action,ref)=>{if(busy)return;setBusy(true);setActionError('');try{await onAction(action,ref);reload()}catch{setActionError('操作未完成，请查看方案中的阻塞原因后重试。')}finally{setBusy(false)}};
      if(!latest.length&&!activity.length&&connection==='online')return null;
      return h('div',{className:'djPlanDock','data-dj-plugin':'plan-workflow-v2'},h('details',{className:'djTaskStatus'},
        h('summary',null,connectionText[connection]|| (latest.length?`${labels[latest[0].workflow_state]||'正在同步'} · ${latest[0].plan_version}${latest[0].run?' · '+latest[0].run.run_id:''}`:activity[0]?.event==='tool_failed'?'规划遇到问题':activity[0]?.event==='tool_started'?'正在准备方案':'正在整理方案')),
        connection!=='online'?h('div',{className:'djPlanCardActions'},h('span',{role:'status'},connectionText[connection]),h('button',{className:'djPlanButton',onClick:()=>connection==='auth_required'?window.location.reload():reload()},connection==='auth_required'?'重新登录':'重试连接')):null,
        actionError?h('p',{role:'alert'},actionError):null,
        ...latest.map(ref=>h('section',{key:planKey(ref),className:'djTaskDetail'},
          h('strong',null,ref.title||ref.task_id),h('p',null,`${labels[ref.workflow_state]||'正在同步'} · ${ref.plan_version}${ref.run?' · '+ref.run.run_id:''}`),
          ref.decision_id?h('p',null,'审批已保存，运行状态由服务持续维护。'):null,
          progressText(ref.run)?h('p',{role:'status'},progressText(ref.run)):null,
          ref.connection_state?h('p',{role:'status'},'暂时无法同步运行状态，以下为最后已知状态。'):null,
          ref.run?.status==='failed'?h('p',{role:'alert'},ref.error_code?.startsWith('MODEL_')?'运行失败：模型文件尚未准备完整。':ref.error_code?.startsWith('RUNTIME_')?'运行失败：运行环境与锁定版本不一致。':'运行失败，请展开诊断详情。'):null,
          h('div',{className:'djPlanCardActions'},h('button',{className:'djPlanButton',onClick:()=>openPage({kind:'plan',planRef:ref})},'查看方案与结果'),
            !ref.decision_id&&ref.workflow_state==='awaiting_approval'&&!ref.gaps?.length?h('button',{className:'djPlanButton',disabled:busy||ref.valid===false,onClick:()=>act('create',ref)},'批准并运行'):null,
            ['failed','cancelled'].includes(ref.run?.status)&&!ref.run.cleanup_pending&&!ref.gaps?.length?h('button',{className:'djPlanButton',disabled:busy,onClick:()=>act('retry',ref)},'修复后重试'):null),
          ref.gaps?.length?h('p',null,ref.decision_id?'本次运行未覆盖：'+ref.gaps.map(g=>g.requirement).join('、')+'。这些需求仍不算验收通过。':'方案仍有未覆盖需求，请在确认问题中明确选择接受或补齐。'):null,
          ref.run?h('p',null,`执行：${ref.run.execution_status||ref.run.status}；交付：${ref.run.delivery_status||'待生成'}；验收：${ref.run.acceptance_status||'待验证'}`):null,
          ref.error?h('details',null,h('summary',null,'诊断详情'),h('pre',{className:'djPlanCode'},`${ref.error_code||''}\n${ref.error}`)):null))))
    }

    function mountLauncher(t){
      if(typeof document==="undefined")return()=>{};
      const button=document.createElement("button");button.type="button";button.className="djPlanLauncher";button.setAttribute("role","tab");button.textContent=t("plan");button.hidden=true;button.addEventListener("click",()=>{const plan=activePlan();if(plan)openPage({kind:"plan",planRef:plan})});
      const place=()=>{const plan=activePlan();button.hidden=!plan;button.setAttribute("aria-selected",String(planPanelOpen&&!!plan));const lists=Array.from(document.querySelectorAll('[role="tablist"]'));const list=lists.find(node=>/轨迹|Trajectory/i.test(node.textContent||""));if(!list)return;const nativeTabs=Array.from(list.querySelectorAll('[role="tab"]')).filter(node=>node!==button);const inactive=nativeTabs.find(node=>node.getAttribute("aria-selected")!=="true")||nativeTabs[0];const active=nativeTabs.find(node=>node.getAttribute("aria-selected")==="true");const baseClasses=new Set(Array.from(inactive?.classList||[]));const activeClasses=Array.from(active?.classList||[]).filter(name=>!baseClasses.has(name));button.className=[...baseClasses,...planPanelOpen&&plan?activeClasses:[],"djPlanLauncher"].join(" ");if(!list.contains(button))list.appendChild(button)};
      const observer=new MutationObserver(place);observer.observe(document.body,{childList:true,subtree:true});window.addEventListener("dsh-dj-plan-state",place);place();
      return()=>{observer.disconnect();window.removeEventListener("dsh-dj-plan-state",place);button.remove()};
    }

    function statusFor(group,stepMap){const states=group.step_refs.map(id=>stepMap.get(id)?.status||"pending");if(states.includes("failed"))return"failed";if(states.includes("running"))return"running";if(states.every(s=>s==="skipped"))return"skipped";if(states.every(s=>s==="succeeded"||s==="skipped"))return"succeeded";if(states.every(s=>s==="cancelled"))return"cancelled";return"pending"}
    function PlanExplorer({planRef,width,maximized,t,close,toggleMaximized}){
      const[data,setData]=React.useState(null),[error,setError]=React.useState(""),[tab,setTab]=React.useState("flow"),[selected,setSelected]=React.useState(null),[expanded,setExpanded]=React.useState(()=>new Set());
      const[,refresh]=React.useReducer(x=>x+1,0);
      const key=planKey(planRef),run=runs.get(key);
      const[runState,setRunState]=React.useState(run||null);
      React.useEffect(()=>{let dead=false;setData(null);setError("");const q=new URLSearchParams({workspace_root:planRef.workspace_root,task_id:planRef.task_id,plan_version:planRef.plan_version,include_versions:"true"});fetch(`/api/dj/plan-view?${q}`).then(r=>r.json().then(p=>{if(!r.ok||p.ok!==true)throw new Error(p.message||`HTTP ${r.status}`);if(!dead)setData(p)})).catch(e=>!dead&&setError(String(e)));return()=>{dead=true}},[key]);
      React.useEffect(()=>{const sync=()=>{setRunState(runs.get(key)||null);refresh()};window.addEventListener("dsh-dj-plan-state",sync);return()=>window.removeEventListener("dsh-dj-plan-state",sync)},[key]);
      const stepMap=React.useMemo(()=>{const map=new Map();for(const step of data?.view?.steps||[]){const state=(runState?.steps||[]).find(item=>item.process_index===step.process_index&&item.operator_name===step.operator_name);map.set(step.id,{...step,...state})}return map},[data,runState]);
      const toggle=id=>setExpanded(old=>{const next=new Set(old);next.has(id)?next.delete(id):next.add(id);return next});
      const choose=id=>{setSelected(id);setTab("detail")};
      let body;
      if(error)body=h("div",{className:"djPlanState"},`${t("unavailable")}：${error}`);
      else if(!data)body=h("div",{className:"djPlanState"},t("loading"));
      else if(tab==="plan")body=h("pre",{className:"djPlanCode"},JSON.stringify(data.plan,null,2));
      else if(tab==="detail"){
        const step=selected?stepMap.get(selected):null,item=step?(step.phase==="postprocess"?step.configuration:data.plan.recipe.process[step.process_index]):null;
        body=step?h("div",null,h("h2",{className:"djPlanDetailTitle"},step.operator_name),h("div",{className:"djPlanHint"},`${step.phase||"recipe"}[${step.postprocess_index??step.process_index}] · ${step.mode||"process"} · ${step.status||"pending"}`),h("pre",{className:"djPlanCode"},JSON.stringify(item,null,2))):h("div",{className:"djPlanState"},t("noSelection"));
      }else body=h("div",{className:"djPlanFlow"},h("div",{className:"djPlanBoundary"},t("input")),...data.view.groups.flatMap(group=>{const open=expanded.has(group.id);return[h("div",{className:"djPlanArrow",key:`a-${group.id}`},"↓"),h("section",{className:"djPlanStage",key:group.id},h("button",{type:"button",className:"djPlanStageHead",onClick:()=>toggle(group.id)},h("span",{className:"djPlanStatus","data-status":statusFor(group,stepMap)}),h("span",{className:"djPlanStageName"},h("div",{className:"djPlanStageTitle"},group.title),group.summary?h("div",{className:"djPlanStageSummary"},group.summary):null),h("span",null,open?"⌃":"⌄")),open?h("div",{className:"djPlanSteps"},...group.step_refs.map(id=>{const step=stepMap.get(id);return h("button",{type:"button",className:"djPlanStep","data-selected":selected===id,onClick:()=>choose(id),key:id},h("span",{className:"djPlanStatus","data-status":step.status||"pending"}),h("span",{className:"djPlanStepIndex"},String(step.process_index+1).padStart(2,"0")),h("span",{className:"djPlanStepName"},step.operator_name),step.duration_ms!==undefined?h("span",{className:"djPlanStepMetrics"},`${step.duration_ms} ms`):null) })):null)]}),h("div",{className:"djPlanArrow"},"↓"),h("div",{className:"djPlanBoundary"},t("output")));
      const action=kind=>window.dispatchEvent(new CustomEvent("dsh-dj-plan-action",{detail:{action:kind,planRef}}));
      return h("section",{className:"djPlanRoot","aria-hidden":width===0},h("header",{className:"djPlanHeader"},h("div",{className:"djPlanTitleWrap"},h("div",{className:"djPlanTitle"},data?.plan?.user_intent||planRef.title),h("div",{className:"djPlanVersion"},planRef.plan_version)),h("span",{className:"djPlanSpacer"}),h("button",{type:"button",className:"djPlanIconButton",title:maximized?t("restore"):t("maximize"),onClick:toggleMaximized},maximized?"◲":"⛶"),h("button",{type:"button",className:"djPlanIconButton",title:t("close"),onClick:close},"×")),h("nav",{className:"djPlanTabs"},...[["flow","arrangement"],["plan","fullPlan"],["detail","detail"]].map(([id,label])=>h("button",{type:"button",className:"djPlanTab","data-active":tab===id,onClick:()=>setTab(id),key:id},t(label)))),h("div",{className:"djPlanBody"},body),h("footer",{className:"djPlanFooter"},!runState&&!planRef.decision_id&&!data?.plan?.coverage?.some(c=>c.status!=="covered")?h("button",{type:"button",className:"djPlanButton","data-primary":true,onClick:()=>action("create")},t("create")):h("span",null,runState?`运行状态：${runState.status}`:"请通过确认问题审查需求缺口"),h("button",{type:"button",className:"djPlanButton",onClick:()=>action("adjust")},t("adjust"))))
    }

    function AuxiliaryHost({width,maximized,t,operatorT,resultT,close,toggleMaximized,open}){
      const[page,setPage]=React.useState({kind:"operator-library"});
      const[,operatorReady]=React.useReducer(x=>x+1,0);
      const[,resultReady]=React.useReducer(x=>x+1,0);
      React.useEffect(()=>{const onOpen=event=>{const next=event.detail;setPlanPanelOpen(next?.kind==="plan");if(next?.kind==="plan"&&next.planRef)registerActivePlan(next.planRef);setPage(next);open()};window.addEventListener("dsh-dj-open-auxiliary",onOpen);return()=>window.removeEventListener("dsh-dj-open-auxiliary",onOpen)},[open]);
      React.useEffect(()=>{window.addEventListener("dsh-dj-operator-ready",operatorReady);return()=>window.removeEventListener("dsh-dj-operator-ready",operatorReady)},[]);
      React.useEffect(()=>{window.addEventListener("dsh-dj-results-ready",resultReady);return()=>window.removeEventListener("dsh-dj-results-ready",resultReady)},[]);
      if(page?.kind==="plan"&&page.planRef)return h(PlanExplorer,{planRef:page.planRef,width,maximized,t,close,toggleMaximized});
      if(page?.kind==="datasets"){
        const ResultCenter=window.__dshDjResultCenter;
        return ResultCenter?h(ResultCenter,{width,maximized,t:resultT,close,toggleMaximized,initialDatasetId:page.datasetId}):h("div",{className:"djPlanState"},"Result center is unavailable");
      }
      const OperatorLibrary=window.__dshDjOperatorLibrary;
      return OperatorLibrary?h(OperatorLibrary,{width,maximized,t:operatorT,close,toggleMaximized}):h("div",{className:"djPlanState"},"Operator library is unavailable");
    }

    const inject=["slots","locale","layout","conversationEvents","conversation"];
    function apply(ctx){
      ctx.conversationEvents.register(projectionDefinition);
      ctx.effect(()=>ctx.locale.register(NS,dictionaries),"dj-plan-explorer: dictionaries");
      const t=ctx.locale.bind(NS),operatorT=ctx.locale.bind("djOperatorLibrary"),resultT=ctx.locale.bind("djResults");
      ctx.effect(()=>mountLauncher(t),"dj-plan-explorer: persistent launcher");
      const pendingApprovals=new Map();
      const onAction=(action,ref,sessionId=activeSessionId)=>{
        if(!["create","retry"].includes(action))return ctx.conversation.send(`我想调整方案 ${ref.task_id}/${ref.plan_version}，请询问我需要修改的内容。`);
        const key=ref.task_id+"/"+ref.plan_version+"/"+ref.content_hash+"/"+action+"/"+(ref.run?.run_id||"");
        if(pendingApprovals.has(key))return pendingApprovals.get(key);
        const promise=fetch(action==="retry"?"/api/dj/run-retry":"/api/dj/plan-approval",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...ref,session_id:sessionId,...(action==="retry"?{retry_of:ref.run.run_id}:{})})}).then(async r=>{const p=await r.json();if(!r.ok||!p.ok)throw new Error(p.message||p.error?.message||p.error||"审批失败");if(p.run)registerRun({...ref,run:{...p.run,task_id:ref.task_id}});window.dispatchEvent(new CustomEvent("dsh-dj-workflow-refresh"));return p}).finally(()=>pendingApprovals.delete(key));
        pendingApprovals.set(key,promise);return promise;
      };
      ctx.effect(()=>{const listener=e=>{if(e.detail?.planRef)onAction(e.detail.action,e.detail.planRef).catch(()=>{})};window.addEventListener("dsh-dj-plan-action",listener);return()=>window.removeEventListener("dsh-dj-plan-action",listener)},"dj-plan-explorer: actions");
      ctx.slots.inject("conversation.chat.turnTail",()=>ctx.slots.register({name:"conversation.chat.turnTail",select:selectPlanData,locale:NS,inject:(sessionId)=>({onAction:(action,ref)=>onAction(action,ref,sessionId),sessionId})},props=>h(PlanBoundary,{sessionId:props.sessionId},h(PlanTurnTail,props))));
      ctx.slots.inject("conversation.input.dock",()=>ctx.slots.register({name:"conversation.input.dock",id:"dj-plan-session-scope",order:20,inject:(sessionId)=>({sessionId,onAction:(action,ref)=>onAction(action,ref,sessionId)})},SessionPlanScope));
      ctx.slots.inject("shell.auxiliary",()=>ctx.slots.register({name:"shell.auxiliary",locale:NS,inject:()=>({operatorT,resultT,close:()=>{setPlanPanelOpen(false);ctx.layout.closeAuxiliary()},toggleMaximized:()=>ctx.layout.toggleAuxiliaryMaximized(),open:()=>ctx.layout.openAuxiliary()})},AuxiliaryHost));
    }
    exports.payloadFrom=payloadFrom;exports.projectionDefinition=projectionDefinition;exports.planSessionState={registerPlan,setActiveSession,activePlan,registerActivePlan,dismissPlan,isPlanDismissed};exports.apply=apply;exports.inject=inject;return module.exports;
  }
});
