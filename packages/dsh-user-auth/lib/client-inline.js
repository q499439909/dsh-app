export const authStyles = `
#dsh-auth-root{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at 20% 10%,#e7eeff 0,transparent 38%),linear-gradient(145deg,#f8fafc,#eef2ff);font-family:Inter,"PingFang SC","Microsoft YaHei",sans-serif;color:#182033}
.dshAuthCard{box-sizing:border-box;width:min(420px,100%);padding:30px;border:1px solid #d9dfeb;border-radius:20px;background:#ffffff;box-shadow:0 24px 70px #23325322}
.dshAuthBrand{font-size:12px;font-weight:750;letter-spacing:.12em;color:#5b6cff;text-transform:uppercase}.dshAuthTitle{margin:8px 0 5px;font-size:27px;line-height:1.25}.dshAuthHint{margin:0 0 22px;color:#687187;font-size:13px;line-height:1.6}
.dshAuthTabs{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:20px;padding:4px;border-radius:11px;background:#f1f4f9}.dshAuthTab{height:36px;border:0;border-radius:8px;background:transparent;color:#667085;font:inherit;cursor:pointer}.dshAuthTab[data-active=true]{background:#fff;color:#1d2939;box-shadow:0 2px 8px #1d293912}
.dshAuthField{display:block;margin:13px 0}.dshAuthField span{display:block;margin-bottom:6px;font-size:12px;font-weight:650;color:#344054}.dshAuthField input{box-sizing:border-box;width:100%;height:43px;border:1px solid #d0d5dd;border-radius:10px;padding:0 12px;background:#fff;color:#101828;font:inherit;outline:none}.dshAuthField input:focus{border-color:#6b72ff;box-shadow:0 0 0 3px #6b72ff1f}
.dshAuthSubmit{width:100%;height:44px;margin-top:8px;border:0;border-radius:11px;background:#5965ed;color:#fff;font:inherit;font-weight:700;cursor:pointer}.dshAuthSubmit:disabled{cursor:wait;opacity:.62}.dshAuthError{min-height:20px;margin:10px 0 0;color:#c4320a;font-size:12px;line-height:20px}.dshAuthLoading{font-size:14px;color:#667085}
#dsh-auth-account{position:relative;z-index:1000;box-sizing:border-box;flex:0 0 auto;width:auto;margin:6px 2px 8px;font-family:Inter,"PingFang SC","Microsoft YaHei",sans-serif;color:#182033}
[class*="_collapsed"] #dsh-auth-account{display:none}
.dshAuthAccountButton{box-sizing:border-box;display:grid;grid-template-columns:34px minmax(0,1fr) 18px;align-items:center;gap:9px;width:100%;min-height:50px;padding:7px 9px;border:1px solid #d9dfeb;border-radius:12px;background:#fff;box-shadow:0 8px 24px #23325314;color:inherit;text-align:left;cursor:pointer}.dshAuthAccountButton:hover,.dshAuthAccountButton[aria-expanded=true]{border-color:#b9c1d1;background:#f8faff}
.dshAuthAvatar{display:grid;place-items:center;width:34px;height:34px;border-radius:10px;background:#e8ecff;color:#4854cf;font-size:14px;font-weight:800}.dshAuthAccountMeta{min-width:0}.dshAuthUsername{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:700}.dshAuthRole{margin-top:2px;color:#7a8499;font-size:11px}.dshAuthChevron{color:#8992a5;font-size:14px;text-align:center}
.dshAuthAccountMenu{position:absolute;left:0;right:0;bottom:58px;box-sizing:border-box;padding:8px;border:1px solid #d9dfeb;border-radius:12px;background:#fff;box-shadow:0 16px 44px #23325324}.dshAuthAccountMenu[hidden]{display:none}.dshAuthAccountSummary{padding:7px 9px 9px;border-bottom:1px solid #edf0f5;color:#667085;font-size:12px;line-height:1.55}.dshAuthLogout{width:100%;height:38px;margin-top:7px;border:0;border-radius:8px;background:transparent;color:#c4320a;font:inherit;font-size:13px;text-align:left;padding:0 9px;cursor:pointer}.dshAuthLogout:hover{background:#fff1ee}.dshAuthLogout:disabled{cursor:wait;opacity:.55}.dshAuthAccountError{min-height:0;margin:5px 9px 2px;color:#c4320a;font-size:11px}
`;

export const authScript = `
(()=>{
  const root=document.createElement("div");root.id="dsh-auth-root";root.innerHTML='<div class="dshAuthLoading">正在检查登录状态…</div>';document.body.appendChild(root);
  let mode="login";
  const esc=value=>String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;","\\\"":"&quot;","'":"&#39;"}[ch]));
  function render(){
    const registering=mode==="register";
    root.innerHTML='<main class="dshAuthCard"><div class="dshAuthBrand">DSH</div><h1 class="dshAuthTitle">'+(registering?'创建体验账号':'欢迎回来')+'</h1><p class="dshAuthHint">'+(registering?'使用邀请码注册，处理结果只对你自己可见。':'登录后继续使用数据处理工作区。')+'</p><div class="dshAuthTabs"><button class="dshAuthTab" data-mode="login" data-active="'+(!registering)+'">登录</button><button class="dshAuthTab" data-mode="register" data-active="'+registering+'">注册</button></div><form><label class="dshAuthField"><span>用户名</span><input name="username" autocomplete="username" minlength="3" maxlength="32" required></label><label class="dshAuthField"><span>密码</span><input name="password" type="password" autocomplete="'+(registering?'new-password':'current-password')+'" minlength="10" maxlength="128" required></label>'+(registering?'<label class="dshAuthField"><span>邀请码</span><input name="inviteCode" type="password" autocomplete="off" required></label>':'')+'<button class="dshAuthSubmit" type="submit">'+(registering?'注册并进入':'登录')+'</button><p class="dshAuthError" role="alert"></p></form></main>';
    root.querySelectorAll("[data-mode]").forEach(button=>button.addEventListener("click",()=>{mode=button.dataset.mode;render()}));
    root.querySelector("form").addEventListener("submit",submit);
  }
  async function submit(event){
    event.preventDefault();const form=event.currentTarget,button=form.querySelector("button[type=submit]"),error=form.querySelector(".dshAuthError"),data=Object.fromEntries(new FormData(form));button.disabled=true;error.textContent="";
    try{const response=await fetch("/auth/"+mode,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(data)});const payload=await response.json();if(!response.ok)throw new Error(payload.message||"请求失败");location.reload()}catch(reason){error.textContent=esc(reason&&reason.message||"请求失败");button.disabled=false}
  }
  function mountAccount(user){
    document.getElementById("dsh-auth-account")?.remove();
    const account=document.createElement("div");account.id="dsh-auth-account";
    const button=document.createElement("button");button.type="button";button.className="dshAuthAccountButton";button.setAttribute("aria-expanded","false");button.setAttribute("aria-haspopup","menu");button.setAttribute("aria-label","当前账号："+user.username);
    const avatar=document.createElement("span");avatar.className="dshAuthAvatar";avatar.textContent=String(user.username||"用").trim().slice(0,1).toLocaleUpperCase()||"用";
    const meta=document.createElement("span");meta.className="dshAuthAccountMeta";
    const username=document.createElement("div");username.className="dshAuthUsername";username.textContent=user.username;
    const role=document.createElement("div");role.className="dshAuthRole";role.textContent=user.role==="admin"?"管理员账号":"用户账号";
    const chevron=document.createElement("span");chevron.className="dshAuthChevron";chevron.textContent="⌃";
    meta.append(username,role);button.append(avatar,meta,chevron);
    const menu=document.createElement("div");menu.className="dshAuthAccountMenu";menu.hidden=true;menu.setAttribute("role","menu");
    const summary=document.createElement("div");summary.className="dshAuthAccountSummary";summary.textContent="当前登录："+user.username;
    const logout=document.createElement("button");logout.type="button";logout.className="dshAuthLogout";logout.textContent="退出登录";logout.setAttribute("role","menuitem");
    const error=document.createElement("div");error.className="dshAuthAccountError";error.setAttribute("role","alert");
    menu.append(summary,logout,error);account.append(button,menu);
    const placeAccount=()=>{
      const sidebar=document.querySelector('[data-pane="sidebar"], [class*="sidebarCol"], .dshDesktopUpstreamSidebar');
      const sidebarRoot=sidebar?.querySelector('[class*="logoRow"]')?.parentElement||sidebar?.firstElementChild?.firstElementChild||sidebar?.firstElementChild;
      const footer=sidebarRoot?.querySelector('[class*="footArea"]');
      if(!sidebarRoot||!footer)return;
      if(account.parentElement===sidebarRoot&&account.nextSibling===footer)return;
      sidebarRoot.insertBefore(account,footer);
    };
    placeAccount();
    new MutationObserver(placeAccount).observe(document.body,{childList:true,subtree:true});
    const close=()=>{menu.hidden=true;button.setAttribute("aria-expanded","false")};
    button.addEventListener("click",event=>{event.stopPropagation();menu.hidden=!menu.hidden;button.setAttribute("aria-expanded",String(!menu.hidden))});
    menu.addEventListener("click",event=>event.stopPropagation());
    document.addEventListener("click",close);
    document.addEventListener("keydown",event=>{if(event.key==="Escape")close()});
    logout.addEventListener("click",async()=>{logout.disabled=true;error.textContent="";try{const response=await fetch("/auth/logout",{method:"POST",headers:{accept:"application/json"}});const payload=await response.json();if(!response.ok||payload.ok!==true)throw new Error(payload.message||"退出失败");location.reload()}catch(reason){error.textContent=esc(reason&&reason.message||"退出失败");logout.disabled=false}});
  }
  fetch("/auth/session",{headers:{accept:"application/json"}}).then(async response=>{const payload=await response.json();if(payload.authenticated){root.remove();mountAccount(payload.user);return}render()}).catch(()=>render());
})();
`;
