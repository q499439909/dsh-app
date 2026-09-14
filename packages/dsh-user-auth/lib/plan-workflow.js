import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

const keyOf = r => JSON.stringify([r.workspace_root,r.task_id,r.plan_version,r.content_hash]);
const terminal = new Set(['succeeded','failed','cancelled']);
const terminalCodes = ['TASK_FORBIDDEN','WORKSPACE_FORBIDDEN','PLAN_SUPERSEDED','CONTENT_CHANGED','PLAN_INVALID','RUNTIME_PREFLIGHT_FAILED','RUNTIME_PACKAGE_MISMATCH','INPUT_SNAPSHOT_CHANGED','OPERATOR_HASH_MISMATCH','GAP_ACCEPTANCE_REQUIRED'];
const gapsOf = plan => (plan?.coverage||[]).filter(c=>c.status==='gap').map(c=>({id:c.id||c.requirement,requirement:c.requirement,evidence:c.evidence}));
const stateOf = (status,run) => status==='queued'?'queued':status==='blocked'?'blocked':run?.status==='succeeded'?(run.acceptance_status==='unverified'||run.task_status==='needs_review'?'needs_review':'succeeded'):run?.status||status||'awaiting_approval';

/** The approval identifies content; each explicit execution attempt has its own durable request. */
export class PlanWorkflow {
  constructor({databasePath,invoke}) {
    mkdirSync(dirname(databasePath),{recursive:true});this.db=new DatabaseSync(databasePath);
    this.invoke=invoke;this.inflight=new Map();this.refreshing=new Map();
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS session_plans(user_id TEXT NOT NULL,session_id TEXT NOT NULL,plan_key TEXT NOT NULL,ref TEXT NOT NULL,updated INTEGER NOT NULL,PRIMARY KEY(user_id,session_id,plan_key));
      CREATE TABLE IF NOT EXISTS plan_decisions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,session_id TEXT NOT NULL,plan_key TEXT NOT NULL,ref TEXT NOT NULL,status TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,retry_at INTEGER NOT NULL DEFAULT 0,lease_until INTEGER NOT NULL DEFAULT 0,result TEXT,error TEXT,created INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS pending_decisions ON plan_decisions(status,retry_at);
      CREATE TABLE IF NOT EXISTS workflow_events(user_id TEXT NOT NULL,session_id TEXT NOT NULL,at INTEGER NOT NULL,event TEXT NOT NULL,summary TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS session_workflow_events ON workflow_events(user_id,session_id,at);
      CREATE TABLE IF NOT EXISTS run_attempts(id TEXT PRIMARY KEY,decision_id TEXT NOT NULL,retry_of TEXT NOT NULL DEFAULT '',status TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,retry_at INTEGER NOT NULL DEFAULT 0,lease_until INTEGER NOT NULL DEFAULT 0,result TEXT,error TEXT,created INTEGER NOT NULL,refreshed_at INTEGER NOT NULL DEFAULT 0,UNIQUE(decision_id,retry_of));`);
    this.seedAttempts();
  }
  seedAttempts(){this.db.prepare(`INSERT OR IGNORE INTO run_attempts(id,decision_id,status,attempts,retry_at,lease_until,result,error,created) SELECT id,id,status,attempts,retry_at,lease_until,result,error,created FROM plan_decisions`).run()}
  close(){if(this.db){this.db.close();this.db=null}}
  record(user,session,event,summary={}){this.db.prepare('INSERT INTO workflow_events VALUES(?,?,?,?,?)').run(user,session,Date.now(),event,JSON.stringify(summary))}
  activity(user,session){return this.db.prepare('SELECT at,event,summary FROM workflow_events WHERE user_id=? AND session_id=? ORDER BY rowid DESC LIMIT 20').all(user,session).map(r=>({...r,summary:JSON.parse(r.summary)}))}
  remember(user,session,ref){
    if(!user||!session||!ref?.workspace_root||!ref.task_id||!ref.plan_version||!ref.content_hash)return;
    const old=this.db.prepare('SELECT ref FROM session_plans WHERE user_id=? AND session_id=? AND plan_key=?').get(user,session,keyOf(ref));
    ref={...(old?JSON.parse(old.ref):{}),...ref};
    this.db.prepare('INSERT INTO session_plans VALUES(?,?,?,?,?) ON CONFLICT(user_id,session_id,plan_key) DO UPDATE SET ref=excluded.ref,updated=excluded.updated').run(user,session,keyOf(ref),JSON.stringify(ref),Date.now());
  }
  decision(user,session,ref){return this.db.prepare('SELECT * FROM plan_decisions WHERE user_id=? AND session_id=? AND plan_key=? ORDER BY created LIMIT 1').get(user,session,keyOf(ref))}
  latestAttempt(id){return this.db.prepare('SELECT * FROM run_attempts WHERE decision_id=? ORDER BY created DESC,rowid DESC LIMIT 1').get(id)}
  result(ref,d,a){
    const value=a?.result?JSON.parse(a.result):{};
    const error=a?.error||value.run?.error||'';
    return {ok:true,...ref,...value,decision_id:d?.id,attempt_id:a?.id,retry_of:a?.retry_of||undefined,
      workflow_state:stateOf(a?.status||ref.workflow_state,value.run),error,
      error_code:value.run?.error_code,recovery_actions:value.run?.recovery_actions||[],last_updated:a?.refreshed_at||a?.created};
  }
  list(user,session){
    this.seedAttempts();
    return this.db.prepare('SELECT * FROM session_plans WHERE user_id=? AND session_id=? ORDER BY updated DESC').all(user,session).map(r=>{
      const ref=JSON.parse(r.ref),d=this.decision(user,session,ref);return this.result(ref,d,d&&this.latestAttempt(d.id));
    });
  }
  async refresh(user,session,item,{force=false}={}){
    if(!item.run?.run_id||!item.attempt_id)return item;
    const a=this.db.prepare('SELECT * FROM run_attempts WHERE id=?').get(item.attempt_id);
    if(terminal.has(item.run.status)&&!item.run.cleanup_pending&&a.refreshed_at)return item;
    if(!force&&Date.now()-a.refreshed_at<3000)return item;
    if(this.refreshing.has(a.id))return this.refreshing.get(a.id);
    const promise=(async()=>{
      try{
        const value=await this.invoke(user,'get_run',{workspace_root:item.workspace_root,task_id:item.task_id,run_id:item.run.run_id});
        if(!value.run)throw new Error('Invalid Run response');
        this.db.prepare('UPDATE run_attempts SET result=?,error=NULL,refreshed_at=? WHERE id=?').run(JSON.stringify(value),Date.now(),a.id);
        if(value.run.status!==item.run.status||value.run.execution_phase!==item.run.execution_phase)this.record(user,session,'run_status_changed',{task_id:item.task_id,plan_version:item.plan_version,run_id:value.run.run_id,status:value.run.status,phase:value.run.execution_phase,error_code:value.run.error_code});
        return this.result(item,this.decision(user,session,item),{...a,result:JSON.stringify(value),error:null,refreshed_at:Date.now()});
      }catch(error){return {...item,connection_state:'reconnecting',connection_error:'运行状态暂时无法同步',diagnostic_code:error.code||'RUN_STATUS_UNAVAILABLE'}}
    })().finally(()=>this.refreshing.delete(a.id));this.refreshing.set(a.id,promise);return promise;
  }
  async snapshot(user,session){
    const items=this.list(user,session),out=[];
    for(let i=0;i<items.length;i+=4)out.push(...await Promise.all(items.slice(i,i+4).map(item=>this.refresh(user,session,item))));
    return out;
  }
  async pollActive(){
    if(this.polling||!this.db)return;this.polling=true;
    try{
      const sessions=this.db.prepare("SELECT DISTINCT d.user_id,d.session_id FROM run_attempts a JOIN plan_decisions d ON d.id=a.decision_id WHERE a.status='submitted' AND (json_extract(a.result,'$.run.status') NOT IN ('succeeded','failed','cancelled') OR json_extract(a.result,'$.run.cleanup_pending')=1 OR a.refreshed_at=0) LIMIT 20").all();
      for(const s of sessions)await this.snapshot(s.user_id,s.session_id);
    }finally{this.polling=false}
  }
  async checked(user,ref,{latestOnly=true}={}){
    const plan=await this.invoke(user,'get_plan',{workspace_root:ref.workspace_root,task_id:ref.task_id,...(!latestOnly?{plan_version:ref.plan_version}:{})});
    if(plan.plan_version!==ref.plan_version)throw new Error('PLAN_SUPERSEDED: Review the latest plan version');
    if(plan.content_hash!==ref.content_hash)throw new Error('CONTENT_CHANGED: Review the exact plan hash');
    if(plan.valid===false||plan.validation?.ok===false)throw new Error('PLAN_INVALID: Fix plan validation errors');
    if(plan.runtime_assessment?.blocking_issues?.length)throw new Error('RUNTIME_PREFLIGHT_FAILED: '+JSON.stringify(plan.runtime_assessment.blocking_issues));
    return plan;
  }
  async confirm(user,session,ref,ask){
    const key=user+session+keyOf(ref)+(ref.retry_of||'');
    if(this.inflight.has(key))return this.inflight.get(key);
    const promise=this.question(user,session,ref,ask).finally(()=>this.inflight.delete(key));this.inflight.set(key,promise);return promise;
  }
  async question(user,session,ref,ask){
    const existing=this.list(user,session).find(p=>keyOf(p)===keyOf(ref)&&p.decision_id);
    if(existing&&!ref.retry_of){
      if(existing.workflow_state==='blocked'&&!existing.run)ref={...ref,retry_of:'dispatch:'+existing.attempt_id};
      else return this.refresh(user,session,existing,{force:true});
    }
    const plan=await this.checked(user,ref),gaps=gapsOf(plan.plan);
    if((plan.plan?.coverage||[]).some(c=>c.status==='needs_user_input'))throw new Error('REQUIREMENT_INPUT_REQUIRED: Clarify unresolved requirements before execution');
    this.remember(user,session,{...ref,title:plan.plan?.user_intent||ref.task_id,valid:true,error:'',gaps,workflow_state:'awaiting_approval'});
    const id=randomUUID(),label=ref.retry_of?(gaps.length?'接受缺口并重试':'重试此版本'):gaps.length?'接受缺口并运行':'批准并运行';
    const review={...ref,user_intent:plan.plan?.user_intent,recipe:plan.plan?.recipe,postprocess:plan.plan?.postprocess,expected_outputs:plan.plan?.expected_outputs,coverage:plan.plan?.coverage,risk_notes:plan.plan?.risk_notes,acceptance_checks:plan.plan?.acceptance_checks,runtime_warnings:plan.runtime_assessment?.warnings,model_readiness:plan.runtime_assessment?.model_readiness};
    const answer=await ask({questions:[{id,header:ref.retry_of?'重试运行':'确认处理方案',detail:'确认下列固定版本。\n\n```json\n'+JSON.stringify(review,null,2)+'\n```',
      question:gaps.length?`尚未覆盖：${gaps.map(g=>g.requirement).join('、')}。是否明确接受这些缺口并${ref.retry_of?'重试':'运行'} ${ref.plan_version}？`:`${String(plan.plan?.user_intent||'数据处理方案').slice(0,70)}；${ref.task_id}/${ref.plan_version}。${ref.retry_of?'是否重新执行此版本？':'是否批准并运行此版本？'}`,
      options:[{label,description:ref.retry_of?'保留失败记录，启动一次新运行。':gaps.length?'这些需求未满足；接受所列缺口后执行当前方案。':'保存审批并自动启动一次运行。'},
        {label:'调整方案',description:'补齐能力或调整规则，暂不执行。'},{label:'暂不执行',description:'保留方案，之后继续。'}],multiSelect:false}]});
    const selected=answer?.answers?.find(a=>a.id===id);
    if(selected?.custom||selected?.selected?.length!==1||selected.selected[0]!==label)return {ok:true,...ref,workflow_state:'awaiting_approval',decision:selected?.selected?.[0]||'not_approved',custom:selected?.custom};
    if(ref.retry_of)return this.retry(user,session,{...ref,accepted_gaps:gaps.map(g=>g.id)},ref.retry_of);
    return this.approve(user,session,{...ref,accepted_gaps:gaps.map(g=>g.id)},id);
  }
  async approve(user,session,ref,id=randomUUID()){
    const plan=await this.checked(user,ref);
    const gaps=gapsOf(plan.plan).map(g=>g.id);
    if(gaps.some(g=>!ref.accepted_gaps?.includes(g)))throw new Error('GAP_ACCEPTANCE_REQUIRED: Confirm the explicit requirement gaps through the structured question');
    this.remember(user,session,{...ref,valid:true,error:'',workflow_state:'awaiting_approval'});
    let inserted=false;this.db.exec('BEGIN IMMEDIATE');
    try{
      let old=this.decision(user,session,ref);
      if(old)id=old.id;
      else{this.db.prepare('INSERT INTO plan_decisions(id,user_id,session_id,plan_key,ref,status,created) VALUES(?,?,?,?,?,?,?)').run(id,user,session,keyOf(ref),JSON.stringify(ref),'queued',Date.now());inserted=true}
      this.seedAttempts();this.db.exec('COMMIT');
    }catch(e){this.db.exec('ROLLBACK');throw e}
    if(inserted)this.record(user,session,'approval_persisted',{task_id:ref.task_id,plan_version:ref.plan_version,decision_id:id,accepted_gaps:ref.accepted_gaps||[]});
    await this.drain();return this.result(ref,this.decision(user,session,ref),this.latestAttempt(id));
  }
  async retry(user,session,ref,retryOf){
    this.seedAttempts();const d=this.decision(user,session,ref);
    if(!d)throw new Error('APPROVAL_REQUIRED');
    const replay=()=>this.db.prepare('SELECT * FROM run_attempts WHERE decision_id=? AND retry_of=?').get(d.id,retryOf);
    if(replay())return this.result(ref,d,replay());
    const plan=await this.checked(user,ref),accepted=ref.accepted_gaps||JSON.parse(d.ref).accepted_gaps||[];
    if(gapsOf(plan.plan).some(g=>!accepted.includes(g.id)))throw new Error('GAP_ACCEPTANCE_REQUIRED: Explicitly accept the requirement gaps before retry');
    if(retryOf.startsWith('dispatch:')){
      const a=this.latestAttempt(d.id);
      if(retryOf!=='dispatch:'+a.id||a.status!=='blocked'||a.result)throw new Error('RETRY_NOT_ALLOWED');
      this.db.prepare('UPDATE plan_decisions SET ref=? WHERE id=?').run(JSON.stringify({...JSON.parse(d.ref),accepted_gaps:accepted}),d.id);
      this.db.prepare("UPDATE run_attempts SET status='queued',attempts=0,retry_at=0,error=NULL WHERE id=?").run(a.id);
      this.record(user,session,'dispatch_recovery_requested',{decision_id:d.id,attempt_id:a.id});
      await this.drain();return this.result(ref,d,this.latestAttempt(d.id));
    }
    const latest=await this.refresh(user,session,this.result(ref,d,this.latestAttempt(d.id)),{force:true});
    if(latest.run?.run_id!==retryOf||!['failed','cancelled'].includes(latest.run.status)||latest.run.cleanup_pending)throw new Error('RETRY_NOT_ALLOWED: Retry only the last failed or cancelled Run after cleanup');
    this.db.exec('BEGIN IMMEDIATE');
    try{
      this.db.prepare('UPDATE plan_decisions SET ref=? WHERE id=?').run(JSON.stringify({...JSON.parse(d.ref),accepted_gaps:accepted}),d.id);
      if(!replay())this.db.prepare("INSERT INTO run_attempts(id,decision_id,retry_of,status,created) VALUES(?,?,?,'queued',?)").run(randomUUID(),d.id,retryOf,Date.now());
      this.db.exec('COMMIT');
    }catch(e){this.db.exec('ROLLBACK');throw e}
    await this.drain();return this.result(ref,d,replay());
  }
  async drain({force=false}={}){
    if(this.draining||!this.db)return;this.draining=true;
    try{
      this.seedAttempts();
      const rows=this.db.prepare("SELECT a.*,d.user_id,d.session_id,d.ref FROM run_attempts a JOIN plan_decisions d ON d.id=a.decision_id WHERE a.status='queued' AND a.lease_until<? AND (a.retry_at<? OR ?) ORDER BY a.created LIMIT 10").all(Date.now(),Date.now(),Number(force));
      for(const row of rows){
        if(!this.db.prepare("UPDATE run_attempts SET lease_until=?,attempts=attempts+1 WHERE id=? AND status='queued' AND lease_until<?").run(Date.now()+120000,row.id,Date.now()).changes)continue;
        const renew=setInterval(()=>this.db?.prepare("UPDATE run_attempts SET lease_until=? WHERE id=? AND status='queued'").run(Date.now()+120000,row.id),30000);renew.unref();
        const ref=JSON.parse(row.ref);
        try{
          await this.checked(row.user_id,ref,{latestOnly:false});
          await this.invoke(row.user_id,'approve_plan',{...ref,decision_id:row.decision_id});
          const result=await this.invoke(row.user_id,'run_plan',{workspace_root:ref.workspace_root,task_id:ref.task_id,plan_version:ref.plan_version,request_id:'decision:'+row.id});
          this.db.prepare("UPDATE run_attempts SET status='submitted',result=?,error=NULL,lease_until=0 WHERE id=?").run(JSON.stringify(result),row.id);
          this.db.prepare("UPDATE plan_decisions SET status='submitted',result=?,error=NULL WHERE id=?").run(JSON.stringify(result),row.decision_id);
          this.record(row.user_id,row.session_id,'run_submitted',{task_id:ref.task_id,plan_version:ref.plan_version,decision_id:row.decision_id,attempt_id:row.id,retry_of:row.retry_of,request_id:'decision:'+row.id,run_id:result.run?.run_id});
        }catch(error){
          const message=String(error.message||error),blocked=row.attempts>=7||terminalCodes.some(code=>message.includes(code));
          this.db.prepare('UPDATE run_attempts SET status=?,error=?,retry_at=?,lease_until=0 WHERE id=?').run(blocked?'blocked':'queued',message.slice(0,2000),Date.now()+Math.min(60000,1000*2**Math.min(row.attempts,6)),row.id);
          this.record(row.user_id,row.session_id,'dispatch_failed',{decision_id:row.decision_id,attempt_id:row.id,attempt:row.attempts+1,workflow_state:blocked?'blocked':'queued',code:error.code||'DISPATCH_ERROR'});
        }finally{clearInterval(renew)}
      }
    }finally{this.draining=false}
  }
}
