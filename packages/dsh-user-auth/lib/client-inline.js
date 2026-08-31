export const authStyles = `
#dsh-auth-root{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at 20% 10%,#e7eeff 0,transparent 38%),linear-gradient(145deg,#f8fafc,#eef2ff);font-family:Inter,"PingFang SC","Microsoft YaHei",sans-serif;color:#182033}
.dshAuthCard{box-sizing:border-box;width:min(420px,100%);padding:30px;border:1px solid #d9dfeb;border-radius:20px;background:#ffffff;box-shadow:0 24px 70px #23325322}
.dshAuthBrand{font-size:12px;font-weight:750;letter-spacing:.12em;color:#5b6cff;text-transform:uppercase}.dshAuthTitle{margin:8px 0 5px;font-size:27px;line-height:1.25}.dshAuthHint{margin:0 0 22px;color:#687187;font-size:13px;line-height:1.6}
.dshAuthTabs{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:20px;padding:4px;border-radius:11px;background:#f1f4f9}.dshAuthTab{height:36px;border:0;border-radius:8px;background:transparent;color:#667085;font:inherit;cursor:pointer}.dshAuthTab[data-active=true]{background:#fff;color:#1d2939;box-shadow:0 2px 8px #1d293912}
.dshAuthField{display:block;margin:13px 0}.dshAuthField span{display:block;margin-bottom:6px;font-size:12px;font-weight:650;color:#344054}.dshAuthField input{box-sizing:border-box;width:100%;height:43px;border:1px solid #d0d5dd;border-radius:10px;padding:0 12px;background:#fff;color:#101828;font:inherit;outline:none}.dshAuthField input:focus{border-color:#6b72ff;box-shadow:0 0 0 3px #6b72ff1f}
.dshAuthSubmit{width:100%;height:44px;margin-top:8px;border:0;border-radius:11px;background:#5965ed;color:#fff;font:inherit;font-weight:700;cursor:pointer}.dshAuthSubmit:disabled{cursor:wait;opacity:.62}.dshAuthError{min-height:20px;margin:10px 0 0;color:#c4320a;font-size:12px;line-height:20px}.dshAuthLoading{font-size:14px;color:#667085}
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
  fetch("/auth/session",{headers:{accept:"application/json"}}).then(async response=>{const payload=await response.json();if(payload.authenticated){root.remove();return}render()}).catch(()=>render());
})();
`;
