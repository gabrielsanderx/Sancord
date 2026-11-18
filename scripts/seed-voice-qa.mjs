// Dados descartáveis em backend local dedicado. Nunca aceita a porta de produção.
import fs from 'node:fs';
const cfg = JSON.parse(fs.readFileSync(process.argv[2], 'utf8').replace(/^\uFEFF/, ''));
const url = new URL(cfg.base);
if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || Number(url.port)<3106 || Number(url.port)>3199) throw Error('Este seed só aceita o backend isolado de QA.');
async function client(username) {
  const options = { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({username,password:cfg.password,remember:false}) };
  let r=await fetch(`${cfg.base}/api/login`, options);
  if(r.status===401)r=await fetch(`${cfg.base}/api/register`,options);
  if(!r.ok)throw Error(`Autenticação QA: HTTP ${r.status}`);
  const {token}=await r.json(); const ws=new WebSocket(`${cfg.base.replace('http:','ws:')}/ws`);
  const queue=[], waiting=[];
  ws.addEventListener('message',({data})=>{
    const event=JSON.parse(data);const i=waiting.findIndex(w=>w.type===event.type&&w.accept(event.payload));
    if(i<0)queue.push(event);else{const waiter=waiting.splice(i,1)[0];clearTimeout(waiter.timer);waiter.resolve(event.payload);}
  });
  const c={ws,send:(type,payload)=>ws.send(JSON.stringify({type,payload})),wait(type,accept=()=>true){
    const i=queue.findIndex(e=>e.type===type&&accept(e.payload));if(i>=0)return Promise.resolve(queue.splice(i,1)[0].payload);
    return new Promise((resolve,reject)=>{const waiter={type,accept,resolve};waiter.timer=setTimeout(()=>{const i=waiting.indexOf(waiter);if(i>=0)waiting.splice(i,1);reject(Error(`Timeout QA: ${type}`));},7000);waiting.push(waiter);});
  }};
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',()=>reject(Error('WebSocket QA indisponível')),{once:true});});
  c.send('JoinServer',{token});c.welcome=await c.wait('Welcome');return c;
}
const clients=[];
try {
  const a=await client(cfg.users[0]);clients.push(a);
  const b=await client(cfg.users[1]);clients.push(b);
  const friends=await a.wait('FriendsSync');
  if(!friends.friends.some(f=>f.username.toLowerCase()===cfg.users[1].toLowerCase())) {
    a.send('SendFriendRequest',{target_username:cfg.users[1]});
    if(!(await a.wait('FriendFeedback')).ok)throw Error('Pedido de amizade QA recusado.');
    b.send('RespondFriendRequest',{from_username:cfg.users[0],accept:true});
    await b.wait('FriendsSync',p=>p.friends.some(f=>f.username.toLowerCase()===cfg.users[0].toLowerCase()));
  }
  let server=a.welcome.servers.find(s=>s.name==='Voz QA local');
  if(!server){a.send('CreateServer',{name:'Voz QA local',template:'friends'});server=(await a.wait('ServerCreated')).server;}
  if(!b.welcome.servers.some(s=>s.id===server.id)) {
    b.send('JoinServerByInvite',{invite_code:server.invite_code});await b.wait('ServerCreated',p=>p.server.id===server.id);
  }
  console.log('Contas locais, amizade e servidor de voz de QA preparados. Nenhuma chamada foi iniciada.');
} finally {for(const c of clients)c.ws.close();}
