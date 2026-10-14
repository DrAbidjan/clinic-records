/* Clinic Patient Records – on-device storage.
   Keeps all records, logins and X-ray images in this browser's IndexedDB.
   It offers the same small set of calls the app used with Supabase, so the app works unchanged. */
(function(){
const DBN=window.__OWNER_TEST?'clinic-owner-test':'clinic-records-local';
/* Licensing: 14-day free trial per clinic, then read-only until a signed activation key is entered.
   Keys are made in the seller's private Key Maker; this public key can only check them, not make them. */
const LICENSE_PUBLIC_KEY={"kty":"EC","crv":"P-256","x":"6oT1-oIwFPO46SyzpmkPyQ_-_JAQPYNdoW8GbCkdnsA","y":"wnk5D2jCyZHtri9GETUavj9HL4hhV7pYIHULdxtKN1c"};
const TRIAL_DAYS=14;
const READONLY_MSG='Your free trial has ended, so the app is read-only. Activate it in Clinic & account → Activation.';
const TABLES=['users','clinics','members','patients','appointments','xrays','attendance','messages','payments'];
let idb=null,T={},session=null;const listeners=[];
const enc=new TextEncoder();
const now=()=>new Date().toISOString();
const clone=x=>x==null?x:JSON.parse(JSON.stringify(x));
const err=m=>({message:m});
const uuid=()=>{if(crypto.randomUUID)return crypto.randomUUID();const b=crypto.getRandomValues(new Uint8Array(16));b[6]=b[6]&15|64;b[8]=b[8]&63|128;const h=[...b].map(x=>x.toString(16).padStart(2,'0')).join('');return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20)};
const hex=buf=>[...new Uint8Array(buf)].map(x=>x.toString(16).padStart(2,'0')).join('');
const unhex=h=>new Uint8Array((h.match(/../g)||[]).map(x=>parseInt(x,16)));
const code=()=>{const a='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';const r=crypto.getRandomValues(new Uint8Array(10));return [...r].map(x=>a[x%a.length]).join('')};
const norm=s=>String(s||'').trim().toLowerCase();

function openDB(){return new Promise((res,rej)=>{const r=indexedDB.open(DBN,1);
  r.onupgradeneeded=()=>{const d=r.result;['tables','files','meta'].forEach(s=>{if(!d.objectStoreNames.contains(s))d.createObjectStore(s)})};
  r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error||err('This browser blocked storage. Turn off Private Browsing.'))})}
function tx(store,mode,fn){return new Promise((res,rej)=>{let out;const t=idb.transaction(store,mode);const r=fn(t.objectStore(store));
  if(r)r.onsuccess=()=>{out=r.result};t.oncomplete=()=>res(out);t.onerror=()=>rej(t.error);t.onabort=()=>rej(t.error||err('The phone is out of storage space.'))})}
const get=(s,k)=>tx(s,'readonly',o=>o.get(k));
const put=(s,k,v)=>tx(s,'readwrite',o=>o.put(v,k));
const del=(s,k)=>tx(s,'readwrite',o=>o.delete(k));
const keys=s=>tx(s,'readonly',o=>o.getAllKeys());
const saveT=t=>put('tables',t,T[t]);

const b64uBytes=s=>{s=String(s).replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';const bin=atob(s);const u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);return u};
let pubKey=null;const verified={};
async function verifyKey(key){
  key=String(key||'').replace(/\s+/g,'');
  if(key in verified)return verified[key];
  let out=null;
  try{const m=key.match(/^CPR1-([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/);
    if(m){pubKey=pubKey||await crypto.subtle.importKey('jwk',LICENSE_PUBLIC_KEY,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
      const payload=b64uBytes(m[1]);
      if(await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},pubKey,b64uBytes(m[2]),payload))out=JSON.parse(new TextDecoder().decode(payload));}}catch(e){out=null}
  verified[key]=out;return out;
}
const clinicCode=c=>{const h=String(c.id).replace(/-/g,'').slice(0,10).toUpperCase();return h.slice(0,5)+'-'+h.slice(5)};
function licenceOf(c){
  if(window.__OWNER_TEST)return{state:'active',name:'Owner test clinic',date:''};
  if(c.license){const p=verified[String(c.license).replace(/\s+/g,'')];if(p&&p.t!=='del'&&p.c===clinicCode(c).replace('-',''))return{state:'active',name:p.n,date:p.d}}
  const left=Math.ceil((new Date(c.created_at).getTime()+TRIAL_DAYS*864e5-Date.now())/864e5);
  return left>0?{state:'trial',daysLeft:left}:{state:'expired'};
}
async function checkLicences(){for(const c of T.clinics)if(c.license)await verifyKey(c.license)}
function canWrite(){
  if(!session)return true;
  const mine=T.members.filter(m=>m.user_id===session.user.id).map(m=>T.clinics.find(c=>c.id===m.clinic_id)).filter(Boolean);
  return !mine.length||mine.some(c=>licenceOf(c).state!=='expired');
}

const ready=(async()=>{
  idb=await openDB();
  for(const t of TABLES)T[t]=(await get('tables',t))||[];
  session=(await get('meta','session'))||null;
  await checkLicences();
  if(session&&!T.users.some(u=>u.id===session.user.id))session=null;
  try{if(navigator.storage&&navigator.storage.persist)navigator.storage.persist()}catch(e){}
})();

async function hash(pw,saltHex){
  const k=await crypto.subtle.importKey('raw',enc.encode(pw),'PBKDF2',false,['deriveBits']);
  return hex(await crypto.subtle.deriveBits({name:'PBKDF2',salt:unhex(saltHex),iterations:150000,hash:'SHA-256'},k,256));
}
async function makeUser(username,password,meta){
  const salt=hex(crypto.getRandomValues(new Uint8Array(16)));
  const u={id:uuid(),username,salt,hash:await hash(password,salt),meta:meta||{},created_at:now()};
  T.users.push(u);await saveT('users');return u;
}
const pub=u=>({id:u.id,email:u.username,user_metadata:clone(u.meta||{})});
async function setSession(u){session=u?{user:pub(u)}:null;if(u)await put('meta','session',session);else await del('meta','session')}

function stamp(table,row,uid){if(table==='patients'){row.updated_at=now();row.updated_by=uid}}
function defaults(table,row,uid){
  if(table==='appointments'){if(!row.status)row.status='scheduled';if(row.reminded_at===undefined)row.reminded_at=null;row.created_at=row.created_at||now()}
  if(table==='xrays'){row.uploaded_by=row.uploaded_by||uid;row.created_at=row.created_at||now();row.taken_on=row.taken_on||now().slice(0,10)}
}
async function cascade(table,gone){
  if(table==='patients'&&gone.length){const ids=new Set(gone.map(g=>g.id));
    T.appointments=T.appointments.filter(a=>!ids.has(a.patient_id));await saveT('appointments');
    const xs=T.xrays.filter(x=>ids.has(x.patient_id));for(const x of xs)await del('files',x.path);
    T.xrays=T.xrays.filter(x=>!ids.has(x.patient_id));await saveT('xrays');}
  if(table==='members'&&gone.length){let changed=false;
    for(const g of gone){if(!T.members.some(m=>m.user_id===g.user_id)){T.users=T.users.filter(u=>u.id!==g.user_id);changed=true}}
    if(changed)await saveT('users');}
}

function query(table){
  let op='select',payload=null,sel='*',single=false,ord=null,rng=null,lim=null;const filters=[];
  const api={
    select(s){if(op==='select')sel=s||'*';return api},
    eq(c,v){filters.push(r=>r[c]===v);return api},
    gte(c,v){filters.push(r=>r[c]>=v);return api},
    lt(c,v){filters.push(r=>r[c]<v);return api},
    order(c,o){ord={c,asc:!(o&&o.ascending===false)};return api},
    range(a,b){rng=[a,b];return api},limit(n){lim=n;return api},single(){single=true;return api},
    insert(p){op='insert';payload=p;return api},upsert(p){op='upsert';payload=p;return api},
    update(p){op='update';payload=p;return api},delete(){op='delete';return api},
    then(res,rej){return run().then(res,rej)}
  };
  async function run(){
    await ready;
    if(!session)return{data:null,error:err('Please log in again.')};
    if(table==='users')return{data:null,error:err('Not allowed')};
    const uid=session.user.id,m=r=>filters.every(f=>f(r));
    if(op!=='select'&&table!=='attendance'&&!canWrite())return{data:null,error:{message:READONLY_MSG,code:'readonly'}};
    try{
      if(op==='select'){
        let out=T[table].filter(m).map(r=>Object.assign({},r));
        if(table==='members'&&/clinics\(/.test(sel))out=out.map(r=>{const c=T.clinics.find(x=>x.id===r.clinic_id);r.clinics=c?Object.assign({},c):null;return r});
        out=out.map(r=>{const c=table==='clinics'?r:r.clinics;if(c){c.has_recovery=!!c.recovery;delete c.recovery;c.lic=licenceOf(c);c.clinic_code=clinicCode(c);delete c.license}return r});
        if(ord)out.sort((a,b)=>(a[ord.c]>b[ord.c]?1:a[ord.c]<b[ord.c]?-1:0)*(ord.asc?1:-1));
        if(rng)out=out.slice(rng[0],rng[1]+1);if(lim)out=out.slice(0,lim);
        if(single)return out[0]?{data:clone(out[0]),error:null}:{data:null,error:err('Not found')};
        return{data:clone(out),error:null};
      }
      if(op==='insert'||op==='upsert'){
        const list=Array.isArray(payload)?payload:[payload],out=[];
        for(const p of list){const row=clone(p);if(!row.id)row.id=uuid();stamp(table,row,uid);
          const ix=T[table].findIndex(r=>r.id===row.id);
          if(ix>=0){if(op==='insert')throw err('This record already exists');T[table][ix]=Object.assign(T[table][ix],row);out.push(T[table][ix])}
          else{defaults(table,row,uid);T[table].push(row);out.push(row)}}
        await saveT(table);return{data:clone(out),error:null};
      }
      if(op==='update'){const hit=T[table].filter(m);hit.forEach(r=>{Object.assign(r,clone(payload));stamp(table,r,uid)});await saveT(table);return{data:clone(hit),error:null}}
      if(op==='delete'){const gone=T[table].filter(m);T[table]=T[table].filter(r=>!m(r));await saveT(table);await cascade(table,gone);return{data:clone(gone),error:null}}
    }catch(e){return{data:null,error:e&&e.message?e:err(String(e))}}
  }
  return api;
}

async function rpc(name,a){
  await ready;if(!session)return{data:null,error:err('Please log in first')};
  const uid=session.user.id;a=a||{};
  const isAdmin=c=>T.members.some(m=>m.clinic_id===c&&m.user_id===uid&&m.role==='admin');
  const needAdmin=c=>{if(!isAdmin(c))throw err('Only a clinic admin can do this')};
  if(!['activate','admin_reset_password','new_recovery_code','rename_me','set_my_pmdc'].includes(name)&&!canWrite())return{data:null,error:{message:READONLY_MSG,code:'readonly'}};
  try{switch(name){
    case 'create_clinic':{const nm=String(a.p_name||'').trim();if(!nm)throw err('Clinic name is required');const id=uuid();
      T.clinics.push({id,name:nm,address:String(a.p_address||'').trim(),phone:String(a.p_phone||'').trim(),invite_code:code(),reminder_template:'',created_by:uid,created_at:now()});
      T.members.push({clinic_id:id,user_id:uid,name:String(a.p_my_name||'').trim()||'Dentist',role:'admin',joined_at:now()});
      await saveT('clinics');await saveT('members');return{data:id,error:null}}
    case 'join_clinic':{const c=T.clinics.find(x=>x.invite_code===String(a.p_code||'').trim().toUpperCase());if(!c)throw err('Invite code not found. Check it with your clinic admin.');
      if(!T.members.some(m=>m.clinic_id===c.id&&m.user_id===uid)){T.members.push({clinic_id:c.id,user_id:uid,name:String(a.p_my_name||'').trim()||'Dentist',role:'dentist',joined_at:now()});await saveT('members')}
      return{data:c.id,error:null}}
    case 'new_invite_code':{needAdmin(a.p_clinic);const c=T.clinics.find(x=>x.id===a.p_clinic);c.invite_code=code();await saveT('clinics');return{data:c.invite_code,error:null}}
    case 'set_member_role':{needAdmin(a.p_clinic);if(!['admin','dentist','accountant'].includes(a.p_role))throw err('Unknown role');
      const mem=T.members.find(m=>m.clinic_id===a.p_clinic&&m.user_id===a.p_user);if(!mem)throw err('Not in this clinic');
      if(a.p_role==='dentist'&&mem.role==='admin'&&T.members.filter(m=>m.clinic_id===a.p_clinic&&m.role==='admin').length<=1)throw err('A clinic needs at least one admin');
      mem.role=a.p_role;await saveT('members');return{data:null,error:null}}
    case 'rename_me':{const nm=String(a.p_name||'').trim();if(!nm)throw err('Name is required');const mem=T.members.find(m=>m.clinic_id===a.p_clinic&&m.user_id===uid);if(mem){mem.name=nm;await saveT('members')}return{data:null,error:null}}
    case 'add_dentist':{needAdmin(a.p_clinic);const un=norm(a.p_username);if(!/^[a-z0-9._-]{3,}$/.test(un))throw err('Username: at least 3 letters or numbers, no spaces.');
      if(T.users.some(u=>u.username===un))throw err('That username is already taken.');if(String(a.p_password||'').length<8)throw err('Password must be at least 8 characters.');
      const u=await makeUser(un,a.p_password,{full_name:a.p_name});
      T.members.push({clinic_id:a.p_clinic,user_id:u.id,name:String(a.p_name||'').trim()||un,role:['admin','accountant'].includes(a.p_role)?a.p_role:'dentist',pmdc:String(a.p_pmdc||'').trim(),joined_at:now()});await saveT('members');return{data:u.id,error:null}}
    case 'activate':{needAdmin(a.p_clinic);const c=T.clinics.find(x=>x.id===a.p_clinic);
      const key=String(a.p_key||'').replace(/\s+/g,'');const p=await verifyKey(key);
      if(!p||p.t==='del')throw err('This activation key is not valid. Copy the whole key exactly as you received it.');
      if(p.c!==clinicCode(c).replace('-',''))throw err('This key was made for a different clinic code. Your clinic code is '+clinicCode(c)+'.');
      c.license=key;await saveT('clinics');return{data:{name:p.n,date:p.d},error:null}}
    case 'new_recovery_code':{needAdmin(a.p_clinic);const c=T.clinics.find(x=>x.id===a.p_clinic);
      const raw=code()+code().slice(0,2);const pretty=raw.slice(0,4)+'-'+raw.slice(4,8)+'-'+raw.slice(8,12);
      const salt=hex(crypto.getRandomValues(new Uint8Array(16)));c.recovery={salt,hash:await hash(raw,salt)};await saveT('clinics');return{data:pretty,error:null}}
    case 'set_my_pmdc':{const mem=T.members.find(m=>m.clinic_id===a.p_clinic&&m.user_id===uid);if(mem){mem.pmdc=String(a.p_pmdc||'').trim();await saveT('members')}return{data:null,error:null}}
    case 'admin_reset_password':{needAdmin(a.p_clinic);if(!T.members.some(m=>m.clinic_id===a.p_clinic&&m.user_id===a.p_user))throw err('Not in this clinic');
      if(String(a.p_password||'').length<8)throw err('Password must be at least 8 characters.');
      const u=T.users.find(x=>x.id===a.p_user);u.salt=hex(crypto.getRandomValues(new Uint8Array(16)));u.hash=await hash(a.p_password,u.salt);await saveT('users');return{data:null,error:null}}
  }throw err('Unknown action')}catch(e){return{data:null,error:e&&e.message?e:err(String(e))}}
}

let recoverFails=0,recoverWait=0;
async function recover(username,codeIn,newpw){
  await ready;
  if(Date.now()<recoverWait)throw err('Too many wrong tries. Wait one minute and try again.');
  const raw=String(codeIn||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  const u=T.users.find(x=>x.username===norm(username));
  if(String(newpw||'').length<8)throw err('New password must be at least 8 characters.');
  let ok=false;
  if(u&&raw.length===12){for(const c of T.clinics){if(!c.recovery)continue;
    if(await hash(raw,c.recovery.salt)===c.recovery.hash&&T.members.some(m=>m.clinic_id===c.id&&m.user_id===u.id&&m.role==='admin')){ok=true;break}}}
  if(!ok){recoverFails++;if(recoverFails>=5){recoverWait=Date.now()+60000;recoverFails=0}throw err('Username or recovery code is wrong. The code only works for an admin of that clinic.')}
  recoverFails=0;u.salt=hex(crypto.getRandomValues(new Uint8Array(16)));u.hash=await hash(newpw,u.salt);await saveT('users');
}
const auth={
  getSession:async()=>{await ready;return{data:{session:clone(session)},error:null}},
  onAuthStateChange(fn){listeners.push(fn);return{data:{subscription:{unsubscribe(){}}}}},
  signUp:async({email,password,options})=>{await ready;const un=norm(email);
    if(!/^[a-z0-9._@-]{3,}$/.test(un))return{data:{},error:err('Username: at least 3 letters or numbers, no spaces.')};
    if(T.users.some(u=>u.username===un))return{data:{},error:err('That username is already taken.')};
    if(String(password||'').length<8)return{data:{},error:err('Password should be at least 8 characters')};
    const u=await makeUser(un,password,options&&options.data);await setSession(u);return{data:{user:clone(session.user),session:clone(session)},error:null}},
  signInWithPassword:async({email,password})=>{await ready;const u=T.users.find(x=>x.username===norm(email));
    if(!u||await hash(String(password||''),u.salt)!==u.hash)return{data:{},error:err('Invalid login credentials')};
    await setSession(u);return{data:{user:clone(session.user),session:clone(session)},error:null}},
  signOut:async()=>{await ready;await setSession(null);listeners.forEach(f=>{try{f('SIGNED_OUT',null)}catch(e){}});return{error:null}},
  updateUser:async({password,data})=>{await ready;if(!session)return{data:{},error:err('Please log in again.')};
    if(data&&password===undefined){const u=T.users.find(x=>x.id===session.user.id);u.meta=Object.assign({},u.meta||{},data);await saveT('users');await setSession(u);return{data:{user:clone(session.user)},error:null}}
    if(String(password||'').length<8)return{data:{},error:err('Password should be at least 8 characters')};
    const u=T.users.find(x=>x.id===session.user.id);u.salt=hex(crypto.getRandomValues(new Uint8Array(16)));u.hash=await hash(password,u.salt);await saveT('users');
    return{data:{user:clone(session.user)},error:null}},
  resetPasswordForEmail:async()=>({error:err('Ask your clinic admin to reset your password in Clinic & account → Team.')})
};

const urlCache={};
const storage={from(){return{
  upload:async(path,blob)=>{await ready;const buf=await blob.arrayBuffer();await put('files',path,{type:blob.type||'application/octet-stream',buf});return{data:{path},error:null}},
  createSignedUrls:async(paths)=>{await ready;const out=[];for(const p of paths){if(!urlCache[p]){const f=await get('files',p);if(f)urlCache[p]=URL.createObjectURL(new Blob([f.buf],{type:f.type}))}out.push({path:p,signedUrl:urlCache[p]||null})}return{data:out,error:null}},
  remove:async(ps)=>{await ready;for(const p of ps){await del('files',p);if(urlCache[p]){URL.revokeObjectURL(urlCache[p]);delete urlCache[p]}}return{data:null,error:null}},
  download:async(p)=>{await ready;const f=await get('files',p);return f?{data:new Blob([f.buf],{type:f.type}),error:null}:{data:null,error:err('File not found')}}
}}};

/* Full backup: every table plus every X-ray file, as one JSON file */
function b64(buf){const u=new Uint8Array(buf);let s='';for(let i=0;i<u.length;i+=0x8000)s+=String.fromCharCode.apply(null,u.subarray(i,i+0x8000));return btoa(s)}
function unb64(s){const bin=atob(s);const u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);return u.buffer}
async function exportAll(){
  await ready;const files=[];for(const k of await keys('files')){const f=await get('files',k);if(f)files.push({path:k,type:f.type,data:b64(f.buf)})}
  return{app:'clinic-records-local',version:1,exported:now(),clinics:T.clinics.map(c=>c.name),tables:clone(T),files};
}
async function importAll(obj){
  await ready;if(!obj||obj.app!=='clinic-records-local'||!obj.tables)throw err('That file is not a full backup from this app.');
  await tx('files','readwrite',o=>o.clear());
  for(const f of obj.files||[])await put('files',f.path,{type:f.type,buf:unb64(f.data)});
  for(const t of TABLES){T[t]=Array.isArray(obj.tables[t])?obj.tables[t]:[];await saveT(t)}
  await checkLicences();
  await setSession(null);
}

/* Automatic daily copies inside the device (records only; X-ray image files are kept once). Last 7 days. */
const SNAP_KEEP=7;
const localDay=()=>{const n=new Date(),p=x=>String(x).padStart(2,'0');return n.getFullYear()+'-'+p(n.getMonth()+1)+'-'+p(n.getDate())};
async function autoSnapshot(){
  await ready;if(!T.clinics.length)return false;
  const key='snap:'+localDay();const ks=(await keys('meta')).map(String);if(ks.includes(key))return false;
  await put('meta',key,{date:localDay(),at:now(),tables:clone(T)});
  const all=ks.filter(k=>k.startsWith('snap:')).concat(key).sort();
  while(all.length>SNAP_KEEP)await del('meta',all.shift());
  return true;
}
async function listSnapshots(){await ready;const out=[];for(const k of (await keys('meta')).map(String).filter(k=>k.startsWith('snap:')).sort().reverse()){const s=await get('meta',k);out.push({date:s.date,at:s.at,patients:(s.tables.patients||[]).length})}return out}
async function restoreSnapshot(date){
  await ready;const s=await get('meta','snap:'+date);if(!s)throw err('That copy was not found.');
  for(const t of TABLES){T[t]=Array.isArray(s.tables[t])?clone(s.tables[t]):[];await saveT(t)}
  await checkLicences();await setSession(null);
}
async function wipeAll(){
  await ready;for(const st of ['tables','files','meta'])await tx(st,'readwrite',o=>o.clear());
  for(const t of TABLES)T[t]=[];session=null;
}
async function checkDeleteCode(clinicId,key){
  await ready;const c=T.clinics.find(x=>x.id===clinicId);if(!c)return 'Clinic not found.';
  const p=await verifyKey(key);
  if(!p||p.t!=='del')return 'This deletion code is not valid. Copy the whole code exactly as you received it.';
  if(p.c!==clinicCode(c).replace('-',''))return 'This deletion code was made for a different clinic code. Your clinic code is '+clinicCode(c)+'.';
  const day=d=>{const x=new Date(d+'T12:00:00');return Math.round(x.getTime()/864e5)};const pad=n=>String(n).padStart(2,'0');const n=new Date();
  const today=day(n.getFullYear()+'-'+pad(n.getMonth()+1)+'-'+pad(n.getDate()));
  if(Math.abs(today-day(p.d))>1)return 'This deletion code has expired. Ask for a new one.';
  return null;
}
ready.then(()=>autoSnapshot()).catch(()=>{});
window.__LOCAL_DB={ready,metaGet:async k=>{await ready;return get('meta','dev:'+k)},metaSet:async(k,v)=>{await ready;return put('meta','dev:'+k,v)},wipeAll,autoSnapshot,listSnapshots,restoreSnapshot,checkDeleteCode,userCount:()=>T.users.length,recover,usernames:()=>T.users.map(u=>{const m=T.members.find(x=>x.user_id===u.id);return{username:u.username,name:(m&&m.name)||(u.meta&&u.meta.full_name)||''}}),exportAll,importAll};
window.supabase={createClient(){return{
  auth,from:query,rpc,storage,
  channel(){const c={on(){return c},subscribe(){return c}};return c},removeChannel(){}
}}};
})();
