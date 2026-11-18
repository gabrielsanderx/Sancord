// Credenciais somente no diálogo; nunca armazenadas no perfil/localStorage.
let integrationRequestId = 0;
async function integrationApi(path, method = "GET", body) {
  const response = await SancordTransport.fetch(path, { method, redirect:"error",
    headers:{Authorization:`Bearer ${getStoredToken() || ""}`,"Content-Type":"application/json"},
    ...(body === undefined ? {} : {body:JSON.stringify(body)}) });
  const data = await response.json().catch(()=>null);
  if (!response.ok || !data?.ok) throw new Error(data?.message || t("integrations.failed"));
  return data;
}
function integrationChannels(srv) {
  return (srv?.text_channels || []).filter(ch=>{
    const p=getChannelPermissions(srv,ch);
    return ch.kind!=="forum" && p.view_channel && p.send_messages && (p.manage_channels || p.manage_server || p.administrator) &&
      (ch.kind!=="announcement" || p.manage_messages || p.administrator);
  });
}
async function openIntegrationsPanel(srv) {
  const select=document.getElementById("integration-channel");if(!select)return;
  const previous=select.value;select.textContent="";
  for(const ch of integrationChannels(srv)){const o=document.createElement("option");o.value=ch.id;o.textContent=`# ${ch.name}`;select.appendChild(o);}
  if([...select.options].some(o=>o.value===previous))select.value=previous;
  await loadIntegrations();
}
async function showIntegrationCredential(data) {
  const endpoint=SancordTransport.url(`/api/integrations/${encodeURIComponent(data.integration.id)}/messages`);
  await SancordUI.formDialog({title:t("integrations.credential"),description:t("integrations.credentialHint"),
    fields:[{name:"endpoint",label:"URL",value:endpoint,readOnly:true},{name:"token",label:"Token",type:"password",value:data.token,readOnly:true}],submitLabel:t("common.done"),
    extraAction:{label:t("integrations.copy"),onSelect:()=>{
      navigator.clipboard.writeText(JSON.stringify({url:endpoint,authorization:`Bearer ${data.token}`,body:{content:"Hello Sancord"}},null,2))
        .then(()=>showUiToast(t("integrations.copied"))).catch(()=>showErrorToast(t("integrations.copyFailed")));
    }},
  });
}
async function loadIntegrations() {
  const channel=document.getElementById("integration-channel")?.value,list=document.getElementById("integration-list");if(!list)return;
  const requestId=++integrationRequestId;list.textContent=t("common.loading");
  const create=document.getElementById("integration-create");if(create)create.disabled=!channel;
  if(!channel){list.textContent=t("integrations.noChannels");return;}
  try {
    const data=await integrationApi(`/api/channels/${encodeURIComponent(channel)}/integrations`);if(requestId!==integrationRequestId)return;
    list.textContent="";if(!data.integrations.length)list.textContent=t("integrations.empty");
    for(const item of data.integrations){
      const row=document.createElement("div");row.className="settings-field";
      const name=document.createElement("strong");name.textContent=`${item.name} · ${item.kind==="bot"?"BOT":"WEBHOOK"}`;
      const actions=document.createElement("div");actions.className="modal-actions";
      for(const action of ["rotate","revoke"]){
        const button=document.createElement("button");button.type="button";button.className="btn-secondary small-btn";button.textContent=t(`integrations.${action}`);
        button.addEventListener("click",async()=>{
          if(!await SancordUI.confirm({title:button.textContent,message:t("integrations.revokeHint"),danger:true}))return;
          button.disabled=true;
          try{const result=await integrationApi(`/api/integrations/${encodeURIComponent(item.id)}/${action}`,"POST",{});if(action==="rotate")await showIntegrationCredential(result);await loadIntegrations();}
          catch(err){showErrorToast(err.message);}finally{button.disabled=false;}
        });actions.appendChild(button);
      }
      row.append(name,actions);list.appendChild(row);
    }
  }catch(err){if(requestId===integrationRequestId)list.textContent=err.message;}
}
document.getElementById("integration-channel")?.addEventListener("change",loadIntegrations);
document.getElementById("integration-refresh")?.addEventListener("click",loadIntegrations);
document.getElementById("integration-create")?.addEventListener("click",async()=>{
  const channel=document.getElementById("integration-channel")?.value;if(!channel)return;
  const input=await SancordUI.formDialog({title:t("integrations.create"),fields:[
    {name:"name",label:t("integrations.name"),required:true,maxlength:40},
    {name:"kind",label:t("integrations.kind"),type:"select",value:"webhook",options:[{value:"webhook",label:"Webhook"},{value:"bot",label:t("integrations.bot")}]}],submitLabel:t("integrations.create")});
  if(!input)return;
  try{const data=await integrationApi(`/api/channels/${encodeURIComponent(channel)}/integrations`,"POST",input);await showIntegrationCredential(data);await loadIntegrations();}
  catch(err){showErrorToast(err.message);}
});
