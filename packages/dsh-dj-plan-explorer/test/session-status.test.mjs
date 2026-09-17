import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../lib/client.js',import.meta.url),'utf8');
const component=source.slice(source.indexOf('    function SessionPlanScope('),source.indexOf('    function mountLauncher('));
function fixture(fetch){
 let slots=[],cursor=0,effects=[],timers=[],listeners=new Map();
 const state=initial=>{const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v}]};
 const context={React:{useState:state,useReducer:(_r,v)=>state(v),useEffect:fn=>effects.push(fn)},h:(tag,props,...children)=>({tag,props,children}),recordUi(){},fetch,URLSearchParams,AbortController,crypto:{randomUUID:()=> 'req-test'},document:{hidden:false},window:{addEventListener:(n,f)=>listeners.set(n,f),removeEventListener(){},location:{reload(){}}},setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length},clearTimeout(){},setActiveSession(){},activeSessionId:null,registerPlan(){},registerRun(){},planKey:r=>r.task_id,openPage(){}};
 vm.createContext(context);vm.runInContext(component+'\nthis.render=SessionPlanScope;',context);
 function render(){cursor=0;effects=[];return context.render({sessionId:'test',onAction(){}})}
 render();effects.forEach(f=>f());
 return {render,listeners,timers,settle:()=>new Promise(r=>setImmediate(r))};
}
test('network failure retains the last Run and hides transport/internal instructions',async()=>{
 let fail=false;const f=fixture(async()=>{if(fail)throw new TypeError('Failed to fetch');return {ok:true,status:200,json:async()=>({ok:true,plans:[{task_id:'t',plan_version:'plan_v001',workflow_state:'failed',decision_id:'d',run:{run_id:'run_1',status:'failed'}}]})}});
 await f.settle();fail=true;f.listeners.get('dsh-dj-workflow-refresh')();await f.settle();
 const tree=JSON.stringify(f.render());assert.match(tree,/run_1/);assert.match(tree,/连接中断，正在重试/);assert.doesNotMatch(tree,/TypeError|Failed to fetch|confirm_plan/);
 fail=false;f.listeners.get('dsh-dj-workflow-refresh')();await f.settle();assert.doesNotMatch(JSON.stringify(f.render()),/连接中断/);
});
test('expired authentication stops automatic polling and offers login',async()=>{
 const f=fixture(async()=>({status:401}));await f.settle();assert.match(JSON.stringify(f.render()),/重新登录/);assert.equal(f.timers.filter(t=>t.ms!==10000).length,0);
});
test('the persistent Run card shows operator and step progress in place',async()=>{
 const f=fixture(async()=>({ok:true,status:200,json:async()=>({ok:true,plans:[{task_id:'t',plan_version:'plan_v001',workflow_state:'running',decision_id:'d',run:{run_id:'run_1',status:'running',steps:[{process_index:0,operator_name:'first_mapper',status:'succeeded'},{process_index:1,operator_name:'second_filter',status:'running'}]}}]})}));
 await f.settle();const tree=JSON.stringify(f.render());assert.match(tree,/second_filter/);assert.match(tree,/第 2\/2 步/);assert.match(tree,/50%/);
});
