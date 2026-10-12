(function(){
/* Clinic Patient Records – one-device version.
   Everything is stored on this phone or computer (see local-db.js). Nothing to configure. */
const CONFIG={SUPABASE_URL:'https://local.device',SUPABASE_ANON_KEY:'on-device-storage-no-key-needed'};
const LOCAL=!!window.__LOCAL_DB;

const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad=n=>String(n).padStart(2,'0');
const today=()=>{const d=new Date();return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())};
const uid=()=>Math.random().toString(36).slice(2,10);
const uuid=()=>{if(crypto.randomUUID)return crypto.randomUUID();const b=crypto.getRandomValues(new Uint8Array(16));b[6]=b[6]&15|64;b[8]=b[8]&63|128;const h=[...b].map(x=>x.toString(16).padStart(2,'0')).join('');return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20)};
const isUUID=s=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s||'');
const fmtDate=d=>{if(!d)return '';const [y,m,dd]=String(d).slice(0,10).split('-');return `${dd}/${m}/${y}`};
const fmtTime=t=>{if(!t)return '';const d=new Date(t);return fmtDate(d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()))+' '+pad(d.getHours())+':'+pad(d.getMinutes())};
const money=n=>'Rs '+Math.round(Number(n)||0).toLocaleString('en-US');
const age=dob=>{if(!dob)return '';const b=new Date(dob),n=new Date();let a=n.getFullYear()-b.getFullYear();if(n<new Date(n.getFullYear(),b.getMonth(),b.getDate()))a--;return a};
const lsGet=k=>{try{return localStorage.getItem(k)}catch(e){return null}};
const lsSet=(k,v)=>{try{localStorage.setItem(k,v)}catch(e){}};

/* ---------- clinical reference data ---------- */
const STATUS=[
 {k:'',label:'Present',de:'',col:''},
 {k:'crown',label:'Crown',de:'CR',col:'--t-crown'},
 {k:'missing',label:'Missing',de:'MIS',col:'--t-missing'},
 {k:'implant',label:'Implant',de:'IMP',col:'--t-implant'},
 {k:'bridge',label:'Bridge pontic',de:'BR',col:'--t-bridge'},
 {k:'ext',label:'For extraction',de:'XLA',col:'--t-ext'},
 {k:'frac',label:'Fractured',de:'FX',col:'--t-frac'}
];
const ST=Object.fromEntries(STATUS.map(s=>[s.k,s]));
const MODES=[
 {k:'caries',label:'Caries',col:'--t-caries'},
 {k:'fill',label:'Filling',col:''},
 {k:'sec',label:'Secondary caries',col:'--t-sec'},
 {k:'defect',label:'Fracture / defect',col:'--t-frac'},
 {k:'clear',label:'Clear',col:''}
];
const MATS=[
 {k:'comp',label:'Composite',col:'--t-fill',proc:'Filling – composite'},
 {k:'amal',label:'Amalgam',col:'--t-amal',proc:'Filling – amalgam'},
 {k:'gic',label:'Glass ionomer',col:'--t-gic',proc:'Filling – GIC'},
 {k:'cer',label:'Ceramic inlay',col:'--t-cer',proc:'Inlay / onlay'},
 {k:'gold',label:'Gold inlay',col:'--t-gold',proc:'Inlay / onlay'},
 {k:'temp',label:'Temporary',col:'--t-temp',proc:'Filling – composite'}
];
const MT=Object.fromEntries(MATS.map(m=>[m.k,m]));
const SURF_ORDER=['M','O','D','B','L'];
const isUpper=n=>Math.floor(n/10)<=2;
const isAnt=n=>n%10<=3;
function surfLabel(n,k){if(k==='O')return isAnt(n)?'I':'O';if(k==='B')return isAnt(n)?'La':'B';if(k==='L')return isUpper(n)?'P':'L';return k}
function surfName(n,k){return {M:'Mesial',D:'Distal',O:isAnt(n)?'Incisal':'Occlusal',B:isAnt(n)?'Labial':'Buccal',L:isUpper(n)?'Palatal':'Lingual'}[k]}
function surfMap(n){const q=Math.floor(n/10),up=q<=2,mr=(q===1||q===4);return {top:up?'B':'L',bottom:up?'L':'B',left:mr?'D':'M',right:mr?'M':'D',center:'O'}}
function surfColor(v){if(v.t==='caries')return '--t-caries';if(v.t==='sec')return '--t-sec';if(v.t==='defect')return '--t-frac';return (MT[v.m]||MT.comp).col}
function surfStr(n,keys){return SURF_ORDER.filter(k=>keys.includes(k)).map(k=>surfLabel(n,k)).join('')}
function toothName(n){const q=Math.floor(n/10),pos=n%10;return ['','Upper right','Upper left','Lower left','Lower right'][q]+' '+['','central incisor','lateral incisor','canine','first premolar','second premolar','first molar','second molar','third molar'][pos]}
function summaryOf(p,n){
  const sf=(p.surf&&p.surf[n])||{},g={};
  for(const k in sf){const v=sf[k],key=v.t+'|'+(v.t==='fill'||v.t==='sec'?v.m:'');(g[key]=g[key]||[]).push(k)}
  return Object.entries(g).map(([key,ks])=>{const [t,m]=key.split('|');const s=surfStr(n,ks);
    if(t==='caries')return {s,txt:'Caries'};
    if(t==='defect')return {s,txt:'Fracture / defect'};
    if(t==='sec')return {s,txt:'Secondary caries under '+(MT[m]||MT.comp).label.toLowerCase()};
    return {s,txt:(MT[m]||MT.comp).label+' filling'};});
}
const MH=[
 ['heart','Heart problems (angina, heart attack, murmur, heart failure)'],
 ['bp','High or low blood pressure'],
 ['endo','Artificial heart valve, previous endocarditis or rheumatic fever'],
 ['pacemaker','Pacemaker or other implanted device'],
 ['bleed','Bleeding disorder or bleeds for a long time after cuts'],
 ['anticoag','Blood thinners (warfarin, clopidogrel, aspirin, apixaban, rivaroxaban)'],
 ['bisphos','Bone medicines, e.g. bisphosphonates or denosumab'],
 ['diabetes','Diabetes'],
 ['asthma','Asthma, COPD or other breathing problems'],
 ['epilepsy','Epilepsy or fits'],
 ['hep','Hepatitis B or C'],
 ['liver','Other liver disease or jaundice'],
 ['kidney','Kidney disease'],
 ['infect','HIV, TB or other infectious disease'],
 ['thyroid','Thyroid problems'],
 ['radio','Radiotherapy or chemotherapy (especially head and neck)'],
 ['steroids','Steroid treatment in the last 2 years'],
 ['allergy','Allergies (penicillin, latex, local anaesthetic, other)'],
 ['pregnant','Pregnant or breastfeeding'],
 ['other','Any other illness, operation or hospital stay']
];
const ALERT_KEYS={endo:'Endocarditis risk',anticoag:'Anticoagulant',bleed:'Bleeding disorder',bisphos:'MRONJ risk',allergy:'Allergy',pacemaker:'Pacemaker',diabetes:'Diabetes',epilepsy:'Epilepsy',hep:'Hepatitis B/C',pregnant:'Pregnant',radio:'Radiotherapy',infect:'Infection control',heart:'Cardiac'};
const PROCS=[
 'Examination & diagnosis','Radiograph (BW / PA)','OPG','Scale & polish','Periodontal therapy (RSD)','Fluoride / fissure sealant',
 'Filling – composite','Filling – amalgam','Filling – GIC','Root canal treatment','Post & core','Crown – zirconia','Crown – PFM','Crown – full metal',
 'Bridge','Veneer','Inlay / onlay','Extraction','Surgical extraction','Implant placement','Implant crown','Partial denture (acrylic)','Partial denture (cobalt chrome)','Complete denture','Night guard','Whitening','Review / recall'
];
const PHASES=[[1,'Urgent / relief of pain'],[2,'Stabilisation & hygiene'],[3,'Restorative'],[4,'Prosthetic & replacement'],[5,'Maintenance & recall']];
const BPE_OPTS=['','0','1','2','3','4','*','X'];
const INSURANCE=['','Self-pay','Sehat Card','Company / panel','Private insurance','Other'];

function blankPatient(){return {id:uuid(),first:'New',last:'Patient',dob:'',sex:'',phone:'',email:'',address:'',cnic:'',insurance:'',insNo:'',gp:'',emergency:'',mh:{date:'',answers:{},meds:'',smoke:'',tobacco:'',alcohol:'',signed:false},chart:{},surf:{},rct:{},toothNotes:{},bpe:['','','','','',''],bpeDate:'',plan:[],planConsent:{agreed:false,date:''},notes:[]}}
function sample(){
  return {id:uuid(),example:true,first:'Example',last:'Patient',dob:'1979-04-17',sex:'F',phone:'0300 0000000',email:'',address:'House 12, Street 4, F-7, Islamabad',cnic:'',insurance:'Self-pay',insNo:'',gp:'Dr S. Ahmed, City Clinic',emergency:'Husband – 0300 0000001',
   mh:{date:today(),answers:{bp:{v:'y',d:'Amlodipine 5 mg'},anticoag:{v:'y',d:'Clopidogrel 75 mg – check with physician before extraction'},allergy:{v:'y',d:'Penicillin – rash'},hep:{v:'n'},diabetes:{v:'n'}},meds:'Amlodipine 5 mg od, Clopidogrel 75 mg od',smoke:'No',tobacco:'Naswar daily for 10 years',alcohol:'No',signed:true},
   chart:{16:'crown',36:'missing',38:'ext',11:'frac'},rct:{16:true,46:true},
   surf:{17:{O:{t:'fill',m:'amal'},D:{t:'fill',m:'amal'}},26:{M:{t:'caries'},O:{t:'caries'}},47:{O:{t:'fill',m:'comp'}},46:{M:{t:'fill',m:'comp'},O:{t:'fill',m:'comp'},D:{t:'fill',m:'comp'}},25:{O:{t:'fill',m:'amal'},D:{t:'sec',m:'amal'}},12:{M:{t:'fill',m:'comp'}}},
   toothNotes:{26:'MO deep, sensitive to cold',38:'Partially erupted, recurrent pericoronitis'},
   bpe:['2','2','3','3','2','2'],bpeDate:today(),
   plan:[
     {id:uid(),tooth:'38',proc:'Surgical extraction',surf:'',phase:1,fee:15000,status:'planned'},
     {id:uid(),tooth:'',proc:'Periodontal therapy (RSD)',surf:'',phase:2,fee:12000,status:'planned'},
     {id:uid(),tooth:'26',proc:'Filling – composite',surf:'MO',phase:3,fee:6000,status:'planned'},
     {id:uid(),tooth:'47',proc:'Filling – composite',surf:'O',phase:3,fee:5000,status:'completed',doneDate:today()},
     {id:uid(),tooth:'11',proc:'Crown – zirconia',surf:'',phase:4,fee:35000,status:'planned'},
     {id:uid(),tooth:'36',proc:'Implant placement',surf:'',phase:4,fee:150000,status:'planned'}
   ],
   planConsent:{agreed:false,date:''},
   notes:[{id:uid(),date:today(),title:'Examination',by:'',text:'C/O: pain lower left back, 3 days.\nO/E: 38 partially erupted, operculum inflamed. 26 MO caries. Naswar user – oral mucosa checked, no lesions. BPE 2/2/3 – 3/2/2.\nRx: irrigation, OHI, tobacco cessation advice.\nPlan: see treatment plan. Review 2 weeks.'}]};
}
function migrate(p){
  p.chart=p.chart||{};p.surf=p.surf||{};p.rct=p.rct||{};p.toothNotes=p.toothNotes||{};p.plan=p.plan||[];p.notes=p.notes||[];
  p.bpe=p.bpe||['','','','','',''];p.planConsent=p.planConsent||{agreed:false,date:''};
  p.mh=p.mh||{date:'',answers:{},meds:'',smoke:'',tobacco:'',alcohol:'',signed:false};p.mh.answers=p.mh.answers||{};
  for(const t in p.chart){const s=p.chart[t];
    if(s==='caries'){p.surf[t]=p.surf[t]||{O:{t:'caries'}};delete p.chart[t];}
    else if(s==='fill'){p.surf[t]=p.surf[t]||{O:{t:'fill',m:'comp'}};delete p.chart[t];}
    else if(s==='rct'){p.rct[t]=true;delete p.chart[t];}}
  return p;
}

/* ---------- app state ---------- */
let sb=null,user=null,memberships=[],clinic=null,me=null,team=[],chan=null,recovering=false;
let db={patients:[]};
let view={screen:'loading',pid:null,tab:'details',tooth:null,q:'',confirm:null,msg:null,authTab:'login'};
const configured=/^https:\/\//.test(CONFIG.SUPABASE_URL)&&CONFIG.SUPABASE_ANON_KEY.length>20;

function toast(m){const t=$('#toast');t.textContent=m;t.hidden=false;clearTimeout(toast._t);toast._t=setTimeout(()=>t.hidden=true,2400)}
function P(){return db.patients.find(p=>p.id===view.pid)}
const isAdmin=()=>me&&me.role==='admin';
const nameOf=id=>{const m=team.find(t=>t.user_id===id);return m?m.name:'another device'};
function friendly(err){
  const m=(err&&(err.message||err.error_description))||String(err||'Something went wrong');
  if(/Invalid login credentials/i.test(m))return LOCAL?'Username or password is wrong.':'Email or password is wrong.';
  if(/already registered|already exists/i.test(m))return 'An account with this email already exists. Log in instead.';
  if(/Invalid login credentials/i.test(m)&&LOCAL)return 'Username or password is wrong.';
  if(/Email not confirmed/i.test(m))return 'Please confirm your email first (check your inbox), then log in.';
  if(/Failed to fetch|NetworkError|Load failed/i.test(m))return 'No internet connection. Check your connection and try again.';
  if(/Password should be/i.test(m))return 'Password must be at least 8 characters.';
  return m;
}

/* ---------- sync ---------- */
const dirty=new Set();let flushT=null,syncState='saved';
function setSync(s){syncState=s;const el=$('#sync');if(el){el.className='sync '+s;el.textContent=syncText()}}
function syncText(){return {saved:LOCAL?'Saved on this device':'All changes saved',saving:'Saving…',error:'Not saved – check internet'}[syncState]}
function syncBadge(){return `<span id="sync" class="sync ${syncState}" role="status">${syncText()}</span>`}
function markDirty(id){if(!id)return;dirty.add(id);setSync('saving');clearTimeout(flushT);flushT=setTimeout(flush,700)}
function save(){markDirty(view.pid)}
function strip(p){const o=Object.assign({},p);delete o.id;delete o._upd;delete o._by;return o}
let flushing=false;
async function flush(){
  clearTimeout(flushT);if(flushing||!dirty.size||!clinic)return;
  flushing=true;const ids=[...dirty];dirty.clear();
  const rows=ids.map(id=>db.patients.find(p=>p.id===id)).filter(Boolean).map(p=>({id:p.id,clinic_id:clinic.id,data:strip(p)}));
  if(!rows.length){flushing=false;setSync('saved');return}
  const {data,error}=await sb.from('patients').upsert(rows).select('id,updated_at,updated_by');
  flushing=false;
  if(error){ids.forEach(i=>dirty.add(i));setSync('error');flushT=setTimeout(flush,8000);return}
  (data||[]).forEach(r=>{const p=db.patients.find(x=>x.id===r.id);if(p){p._upd=r.updated_at;p._by=r.updated_by}});
  if(dirty.size){flushT=setTimeout(flush,300);setSync('saving')}else setSync('saved');
}
function toPatient(r){return migrate(Object.assign({},r.data||{},{id:r.id,_upd:r.updated_at,_by:r.updated_by}))}
async function loadPatients(){
  const all=[];let from=0;
  for(;;){const {data,error}=await sb.from('patients').select('id,data,updated_at,updated_by').eq('clinic_id',clinic.id).order('id').range(from,from+999);
    if(error)throw error;all.push(...data);if(data.length<1000)break;from+=1000;}
  const keep=db.patients.filter(p=>dirty.has(p.id));
  db.patients=all.map(toPatient).filter(p=>!dirty.has(p.id)).concat(keep);
}
async function loadTeam(){
  const {data,error}=await sb.from('members').select('user_id,name,role,joined_at').eq('clinic_id',clinic.id).order('joined_at');
  if(!error){team=data||[];const mine=team.find(t=>t.user_id===user.id);if(mine)me=Object.assign({},me,mine);}
}
let pendingRender=false;
function softRender(){const a=document.activeElement;if(a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)&&a.id!=='search'){pendingRender=true;return}render()}
document.addEventListener('focusout',()=>{if(pendingRender){setTimeout(()=>{const a=document.activeElement;if(!(a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))){pendingRender=false;render()}},150)}});
function subscribe(){
  if(chan)sb.removeChannel(chan);
  chan=sb.channel('patients-'+clinic.id).on('postgres_changes',{event:'*',schema:'public',table:'patients',filter:'clinic_id=eq.'+clinic.id},pl=>{
    if(pl.eventType==='DELETE'){const id=pl.old&&pl.old.id;if(!id||dirty.has(id))return;const had=db.patients.some(p=>p.id===id);if(!had)return;
      db.patients=db.patients.filter(p=>p.id!==id);if(view.pid===id){view.screen='list';view.pid=null;toast('This patient was deleted on another device')}softRender();return}
    const r=pl.new;if(!r||dirty.has(r.id))return;const ix=db.patients.findIndex(p=>p.id===r.id);
    if(ix>=0&&db.patients[ix]._upd===r.updated_at)return;
    const np=toPatient(r);if(ix>=0)db.patients[ix]=np;else db.patients.push(np);
    if(view.pid===r.id)toast('Updated by '+nameOf(r.updated_by));softRender();
  }).on('postgres_changes',{event:'*',schema:'public',table:'appointments',filter:'clinic_id=eq.'+clinic.id},()=>{
    if(view.screen==='appts'||(view.screen==='patient'&&view.tab==='appts'))refreshAppts();
  }).subscribe();
}
document.addEventListener('visibilitychange',async()=>{
  if(!clinic||!sb)return;
  if(document.visibilityState==='hidden'){flush();return}
  if(!dirty.size){try{await loadPatients();softRender()}catch(e){}}
});
window.addEventListener('online',()=>{if(dirty.size)flush()});
window.addEventListener('beforeunload',e=>{if(dirty.size){flush();e.preventDefault();e.returnValue=''}});

/* ---------- auth & clinic ---------- */
async function boot(){
  if(!configured){view.screen='config';render();return}
  if(!window.supabase){view.screen='offline';render();return}
  sb=window.supabase.createClient(CONFIG.SUPABASE_URL,CONFIG.SUPABASE_ANON_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  recovering=/type=recovery/.test(location.hash);
  sb.auth.onAuthStateChange((ev,s)=>{
    if(ev==='PASSWORD_RECOVERY'){recovering=true;user=s&&s.user;view.screen='newpw';render();}
    else if(ev==='SIGNED_OUT'){resetState();view.screen='auth';render();}
  });
  const {data:{session}}=await sb.auth.getSession();
  if(recovering){if(session){user=session.user;view.screen='newpw';render()}return}
  if(!session){view.screen='auth';render();return}
  user=session.user;await afterLogin();
}
function resetState(){if(chan&&sb)sb.removeChannel(chan);chan=null;user=null;memberships=[];clinic=null;me=null;team=[];db={patients:[]};dirty.clear();setSync('saved')}
async function afterLogin(prefer){
  view={screen:'loading',pid:null,tab:'details',tooth:null,q:'',confirm:null,msg:null,authTab:'login'};render();
  const {data,error}=await sb.from('members').select('clinic_id,role,name,clinics(id,name,address,phone,invite_code,reminder_template)').eq('user_id',user.id);
  if(error){view.screen='auth';view.msg={t:'err',m:friendly(error)};render();return}
  memberships=(data||[]).filter(m=>m.clinics);
  if(!memberships.length){view.screen='onboard';render();return}
  const want=prefer||lsGet('clinicId');
  await openClinic(memberships.find(x=>x.clinic_id===want)||memberships[0]);
}
async function openClinic(m){
  if(dirty.size)await flush();
  clinic=m.clinics;me={user_id:user.id,name:m.name,role:m.role};lsSet('clinicId',clinic.id);
  view.screen='loading';render();
  try{db={patients:[]};await Promise.all([loadPatients(),loadTeam()]);}
  catch(e){view.screen='error';view.msg={t:'err',m:friendly(e)};render();return}
  subscribe();
  view={screen:'list',pid:null,tab:'details',tooth:null,q:'',confirm:null,msg:null,authTab:'login'};render();
}
async function refreshClinic(){const {data}=await sb.from('clinics').select('id,name,address,phone,invite_code,reminder_template').eq('id',clinic.id).single();if(data)clinic=data;}

/* ---------- PDF record ---------- */
function chartLines(p){
  const out=[];const all=[18,17,16,15,14,13,12,11,21,22,23,24,25,26,27,28,48,47,46,45,44,43,42,41,31,32,33,34,35,36,37,38];
  for(const n of all){const parts=[];const st=p.chart&&p.chart[n];if(st&&ST[st])parts.push(ST[st].label);if(p.rct&&p.rct[n])parts.push('RCT');
    summaryOf(p,n).forEach(x=>parts.push(x.s+' '+x.txt.toLowerCase()));if(p.toothNotes&&p.toothNotes[n])parts.push(p.toothNotes[n]);
    if(parts.length)out.push(n+': '+parts.join(', '));}
  return out;
}
function buildRecord(p,date){
  const {jsPDF}=window.jspdf;const doc=new jsPDF({unit:'mm',format:'a4'});
  const W=210,M=16,CW=W-2*M;let y=16;
  const clean=s=>String(s??'').replace(/[^\n\x20-\x7E -ÿ–—•…‘’“”]/g,'');
  const ACC=[31,95,107],MUT=[93,107,114],INK=[24,35,42],LINE=[200,209,207],RED=[179,38,30];
  const ensure=h=>{if(y+h>278){doc.addPage();y=18;}};
  const sec=t=>{ensure(14);y+=3;doc.setFillColor(225,238,239);doc.rect(M,y-4,CW,6.5,'F');doc.setFont('helvetica','bold');doc.setFontSize(8.5);doc.setTextColor(...ACC);doc.text(t.toUpperCase(),M+2,y);y+=7;doc.setTextColor(...INK);doc.setFont('helvetica','normal');doc.setFontSize(9.5);};
  const para=t=>{const lines=doc.splitTextToSize(clean(t),CW);for(const l of lines){ensure(5);doc.text(l,M,y);y+=4.6;}};
  doc.setFillColor(...ACC);doc.rect(0,0,W,3,'F');
  doc.setFont('helvetica','bold');doc.setFontSize(17);doc.setTextColor(...INK);doc.text('Treatment Record',M,y+4);
  doc.setFontSize(10.5);doc.text(clean(clinic.name),W-M,y+4,{align:'right'});
  doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor(...MUT);
  const cl2=[clinic.address,clinic.phone].filter(Boolean).join('  ·  ');if(cl2)doc.text(clean(cl2),W-M,y+8.5,{align:'right'});
  y+=13;doc.setFontSize(9);
  doc.text('Visit date: '+fmtDate(date)+'     Dentist: '+clean(me.name),M,y);
  doc.text('Printed '+fmtDate(today()),W-M,y,{align:'right'});y+=3;
  doc.setDrawColor(...LINE);doc.line(M,y,W-M,y);y+=4;
  sec('Patient');
  const kv=[['Name',p.first+' '+p.last],['Date of birth',p.dob?fmtDate(p.dob)+' ('+age(p.dob)+' yrs)':'–'],['Phone',p.phone||'–'],['CNIC',p.cnic||'–'],['Payment',[p.insurance,p.insNo].filter(Boolean).join(' · ')||'–'],['Address',p.address||'–']];
  kv.forEach(([k,v],i)=>{const x=M+(i%2)*(CW/2);if(i%2===0)ensure(6);doc.setTextColor(...MUT);doc.setFontSize(8);doc.text(k,x,y);doc.setTextColor(...INK);doc.setFontSize(9.5);doc.text(doc.splitTextToSize(clean(v),CW/2-26)[0]||'',x+24,y);if(i%2===1)y+=5.5;});
  const al=alertsOf(p);sec('Medical alerts');
  if(al.length){doc.setTextColor(...RED);doc.setFont('helvetica','bold');para(al.join('  ·  '));doc.setFont('helvetica','normal');doc.setTextColor(...INK);
    const ans=p.mh.answers;MH.forEach(([k])=>{if(ans[k]&&ans[k].v==='y'&&ans[k].d)para('– '+(ALERT_KEYS[k]||'Note')+': '+ans[k].d);});}
  else para('No medical alerts recorded.');
  if(p.mh.meds)para('Medicines: '+p.mh.meds);
  const habits=[p.mh.smoke&&'Smoking: '+p.mh.smoke,p.mh.tobacco&&'Paan / gutka / naswar: '+p.mh.tobacco].filter(Boolean);if(habits.length)para(habits.join('   ·   '));
  doc.setTextColor(...MUT);doc.setFontSize(8.5);para('Medical history last reviewed: '+(p.mh.date?fmtDate(p.mh.date):'never'));doc.setTextColor(...INK);doc.setFontSize(9.5);
  const done=p.plan.filter(i=>i.status==='completed'&&i.doneDate===date);
  sec('Treatment carried out on '+fmtDate(date));
  if(done.length){
    const cx=[M,M+18,M+120];doc.setFont('helvetica','bold');doc.setFontSize(8.5);doc.setTextColor(...MUT);
    ['Tooth','Treatment','Surfaces'].forEach((h,i)=>doc.text(h,cx[i],y));doc.text('Fee',W-M,y,{align:'right'});y+=2;doc.line(M,y,W-M,y);y+=4.5;
    doc.setFont('helvetica','normal');doc.setFontSize(9.5);doc.setTextColor(...INK);let tot=0;
    done.forEach(i=>{ensure(6);doc.text(clean(i.tooth||'–'),cx[0],y);doc.text(doc.splitTextToSize(clean(i.proc),98)[0],cx[1],y);doc.text(clean(i.surf||''),cx[2],y);doc.text(money(i.fee),W-M,y,{align:'right'});tot+=+i.fee||0;y+=5.5;});
    doc.line(M,y-3.5,W-M,y-3.5);doc.setFont('helvetica','bold');doc.text('Total today',cx[1],y+0.5);doc.text(money(tot),W-M,y+0.5,{align:'right'});doc.setFont('helvetica','normal');y+=6;
  } else para('No treatment items were marked completed on this date.');
  const notes=p.notes.filter(n=>n.date===date);
  sec('Clinical notes');
  if(notes.length)notes.forEach(n=>{doc.setFont('helvetica','bold');para(n.title+(n.by?' – '+n.by:''));doc.setFont('helvetica','normal');para(n.text);y+=1.5;});
  else para('No clinical notes for this date.');
  const open=p.plan.filter(i=>i.status!=='completed');
  sec('Treatment still planned');
  if(open.length)open.sort((a,b)=>a.phase-b.phase).forEach(i=>para('Phase '+i.phase+'   '+(i.tooth?i.tooth+'  ':'')+i.proc+(i.surf?' ('+i.surf+')':'')+'   '+money(i.fee)));
  else para('Treatment plan complete.');
  const cl=chartLines(p);
  sec('Current chart findings (FDI)');
  if(cl.length)cl.forEach(l=>para(l));else para('No findings charted.');
  if(p.bpe.some(Boolean))para('BPE: '+p.bpe.slice(0,3).map(v=>v||'–').join(' / ')+'  |  '+p.bpe.slice(3).map(v=>v||'–').join(' / ')+(p.bpeDate?'   ('+fmtDate(p.bpeDate)+')':''));
  ensure(26);y+=14;doc.setDrawColor(...INK);
  doc.line(M,y,M+70,y);doc.line(M+90,y,M+130,y);doc.line(M+140,y,W-M,y);
  doc.setFontSize(8);doc.setTextColor(...MUT);doc.text('Dentist signature',M,y+4);doc.text('Date',M+90,y+4);doc.text('Patient signature',M+140,y+4);
  const pages=doc.getNumberOfPages();
  for(let i=1;i<=pages;i++){doc.setPage(i);doc.setFontSize(7.5);doc.setTextColor(...MUT);
    doc.text('Confidential patient record – '+clean(p.first+' '+p.last)+(p.dob?', '+fmtDate(p.dob):''),M,290);doc.text('Page '+i+' of '+pages,W-M,290,{align:'right'});}
  return doc.output('blob');
}
/* Phones: share sheet (Print / Save to Files). Computers: open PDF to print, or download it. */
function deliverFile(blob,filename,mode){
  const touch=window.matchMedia&&matchMedia('(pointer:coarse)').matches;
  let file=null;try{file=new File([blob],filename,{type:blob.type})}catch(e){}
  if(touch&&file&&navigator.canShare&&navigator.canShare({files:[file]}))
    return navigator.share({files:[file],title:filename}).then(()=>true,e=>{if(e&&e.name==='AbortError')return false;throw e});
  const url=URL.createObjectURL(blob);setTimeout(()=>URL.revokeObjectURL(url),120000);
  if(mode==='print'){const w=window.open(url,'_blank');if(w)return Promise.resolve(true);}
  const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();return Promise.resolve(true);
}
function printRecord(p,date,mode){
  if(!window.jspdf){toast('The PDF tool did not load. Check your internet and reload the page.');return}
  const has=p.plan.some(i=>i.status==='completed'&&i.doneDate===date)||p.notes.some(n=>n.date===date);
  if(!has){toast('Nothing recorded on '+fmtDate(date));return}
  const fn=('Treatment_Record_'+p.last+'_'+p.first+'_'+date+'.pdf').replace(/[^\w.\-]+/g,'_');
  let blob;try{blob=buildRecord(p,date)}catch(e){toast('Could not create the record');return}
  deliverFile(blob,fn,mode).then(ok=>{if(ok)toast(mode==='print'?'Choose Print to print the record':'Record saved')},()=>toast('Could not share the file'));
}

/* ---------- appointments & reminders ---------- */
let apptsDay=[],apptsPatient=[],apptsLoading=false;
const DEFAULT_TEMPLATE='Assalam-o-Alaikum {name}, this is a reminder of your dental appointment at {clinic} on {date} at {time}. To change it, please call {phone}. Shukriya.';
const REASONS=['Check-up','Scaling & polishing','Filling','Root canal treatment','Extraction','Crown / bridge','Denture','Braces / orthodontics','Review','Emergency','Other'];
const hhmm=t=>{const d=new Date(t);let h=d.getHours();const m=pad(d.getMinutes());const ap=h>=12?'pm':'am';h=h%12||12;return h+':'+m+' '+ap};
const dayOf=t=>{const d=new Date(t);return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())};
const longDay=d=>{const x=new Date(d+'T12:00');return x.toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'})};
const shiftDay=(d,n)=>{const x=new Date(d+'T12:00');x.setDate(x.getDate()+n);return dayOf(x)};
const STATUS_A={scheduled:['Booked','info'],done:['Attended','ok'],noshow:['Did not come','alert'],cancelled:['Cancelled','warn']};
function waNumber(ph){let d=String(ph||'').replace(/\D/g,'');if(d.startsWith('00'))d=d.slice(2);if(d.startsWith('0'))d='92'+d.slice(1);return d.length>=10?d:''}
function smsNumber(ph){return String(ph||'').replace(/[^\d+]/g,'')}
function reminderText(a,p){
  const tpl=(clinic.reminder_template||'').trim()||DEFAULT_TEMPLATE;
  const dn=team.find(t=>t.user_id===a.dentist_id);
  const date=new Date(a.starts_at).toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'});
  return tpl.replace(/\{name\}/g,p?(p.first||'').trim():'').replace(/\{clinic\}/g,clinic.name||'').replace(/\{date\}/g,date).replace(/\{time\}/g,hhmm(a.starts_at)).replace(/\{phone\}/g,clinic.phone||'').replace(/\{dentist\}/g,dn?dn.name:'');
}
async function loadDay(day){
  const s=new Date(day+'T00:00:00'),e=new Date(s);e.setDate(e.getDate()+1);
  const {data,error}=await sb.from('appointments').select('*').eq('clinic_id',clinic.id).gte('starts_at',s.toISOString()).lt('starts_at',e.toISOString()).order('starts_at');
  if(error)throw error;apptsDay=data||[];
}
async function loadPatientAppts(pid){
  const {data,error}=await sb.from('appointments').select('*').eq('patient_id',pid).order('starts_at',{ascending:false}).limit(50);
  if(error)throw error;apptsPatient=data||[];
}
async function refreshAppts(){
  try{
    if(view.screen==='appts'){apptsLoading=true;await loadDay(view.day||today());}
    else if(view.screen==='patient'&&view.tab==='appts'&&view.pid){apptsLoading=true;await loadPatientAppts(view.pid);}
  }catch(e){toast(friendly(e))}
  apptsLoading=false;softRender();
}
function homeNav(active){return `<nav class="tabs homenav" role="tablist"><button class="tab" role="tab" aria-selected="${active==='list'}" data-home="list">Patients</button><button class="tab" role="tab" aria-selected="${active==='appts'}" data-home="appts">Appointments</button></nav>`}
function apptCard(a,showPatient){
  const p=db.patients.find(x=>x.id===a.patient_id);const dn=team.find(t=>t.user_id===a.dentist_id);const st=STATUS_A[a.status]||STATUS_A.scheduled;
  const nm=p?(p.first+' '+p.last):'Patient record deleted';const phone=p&&p.phone;
  const upcoming=a.status==='scheduled'&&new Date(a.starts_at)>new Date(Date.now()-36e5);
  return `<div class="appt ${a.status}">
    <div class="tm"><b>${showPatient?hhmm(a.starts_at):fmtDate(dayOf(a.starts_at))}</b><span>${showPatient?a.duration+' min':hhmm(a.starts_at)}</span></div>
    <div class="ai">
      ${showPatient&&p?`<button class="linkbtn pn" data-open="${a.patient_id}">${esc(nm)}</button>`:showPatient?`<b>${esc(nm)}</b>`:''}
      <span class="small">${esc(a.reason||'Appointment')}${dn?' · '+esc(dn.name):''}${a.note?' · '+esc(a.note):''}</span>
      <span class="alerts"><span class="pill ${st[1]}">${st[0]}</span>${a.reminded_at?`<span class="pill ok">Reminder opened ${fmtTime(a.reminded_at)}</span>`:(upcoming?'<span class="pill warn">No reminder yet</span>':'')}${p&&!phone?'<span class="pill alert">No mobile number</span>':''}</span>
      ${upcoming&&phone?`<div class="row"><button class="btn small primary" data-sms="${a.id}">SMS reminder</button><button class="btn small wa" data-wa="${a.id}">WhatsApp</button></div>`:''}
      <div class="row">${a.status==='scheduled'?`<button class="btn small" data-ast="done" data-aid="${a.id}">Attended</button><button class="btn small" data-ast="noshow" data-aid="${a.id}">Did not come</button><button class="btn small" data-ast="cancelled" data-aid="${a.id}">Cancel</button>`:`<button class="btn small" data-ast="scheduled" data-aid="${a.id}">Back to booked</button>`}
      ${view.confirm==='adel:'+a.id?`<button class="btn small" data-act="cancelConfirm">Keep</button><button class="btn small danger" data-adel="${a.id}">Yes, delete</button>`:`<button class="btn small danger" data-askadel="${a.id}">Delete</button>`}</div>
    </div>
  </div>`;
}
function apptsView(){
  const day=view.day||today();
  const act=apptsDay.filter(a=>a.status!=='cancelled');
  const need=apptsDay.filter(a=>a.status==='scheduled'&&!a.reminded_at).length;
  return `
  <header class="top">
    <div style="min-width:0"><h1>${esc(clinic.name)}</h1><div class="sub">${esc(me.name)} ${syncBadge()}</div></div>
    <button class="btn small" data-act="settings">Clinic & account</button>
  </header>
  ${homeNav('appts')}
  <section class="panel">
    <div class="row daynav"><button class="btn small" data-day="${shiftDay(day,-1)}" aria-label="Previous day">‹</button>
      <div style="flex:1;min-width:0;text-align:center"><b>${day===today()?'Today':day===shiftDay(today(),1)?'Tomorrow':longDay(day).split(' ')[0]}</b><div class="small muted">${longDay(day)}</div></div>
      <button class="btn small" data-day="${shiftDay(day,1)}" aria-label="Next day">›</button></div>
    <div class="row"><input type="date" id="dayPick" value="${day}" style="max-width:180px"><span class="spacer"></span>
      ${day!==today()?'<button class="btn small" data-day="'+today()+'">Today</button>':''}<button class="btn small" data-day="${shiftDay(today(),1)}">Tomorrow</button></div>
    <div class="small muted">${apptsLoading?'Loading…':act.length+' appointment'+(act.length===1?'':'s')+(need?' · '+need+' without a reminder':'')}</div>
    ${apptsDay.length?`<div class="appts">${apptsDay.map(a=>apptCard(a,true)).join('')}</div>`:(apptsLoading?'':'<div class="empty">No appointments this day. Book one from a patient’s file, in the Appointments tab.</div>')}
  </section>
  <p class="small muted">Reminders open the SMS or WhatsApp app on this phone with the message ready. You tap Send. Change the message in Clinic & account.</p>`;
}
function apptTab(p){
  const f=view.apptForm||{};
  return `<section class="panel">
    <h2>Book appointment</h2>
    <form id="apptForm" class="grid2">
      <label class="f"><span>Date</span><input type="date" id="ap-date" value="${f.date||shiftDay(today(),1)}" required></label>
      <label class="f"><span>Time</span><input type="time" id="ap-time" value="${f.time||'10:00'}" step="300" required></label>
      <label class="f"><span>Reason</span><select id="ap-reason">${REASONS.map(r=>`<option ${f.reason===r?'selected':''}>${r}</option>`).join('')}</select></label>
      <label class="f"><span>Length</span><select id="ap-dur">${[15,20,30,45,60,90,120].map(m=>`<option value="${m}" ${(+f.dur||30)===m?'selected':''}>${m} min</option>`).join('')}</select></label>
      <label class="f"><span>Dentist</span><select id="ap-dentist">${team.map(t=>`<option value="${t.user_id}" ${(f.dentist||user.id)===t.user_id?'selected':''}>${esc(t.name)}</option>`).join('')}</select></label>
      <label class="f"><span>Note (optional)</span><input type="text" id="ap-note" value="${esc(f.note||'')}" placeholder="e.g. bring old X-ray"></label>
      <div class="row" style="grid-column:1/-1"><button class="btn primary" type="submit">Book appointment</button>${p.phone?'':'<span class="small" style="color:var(--alert)">Add a mobile number in Details to send reminders.</span>'}</div>
    </form>
  </section>
  <section class="panel">
    <h2>Appointments</h2>
    ${apptsLoading?'<div class="empty">Loading…</div>':apptsPatient.length?`<div class="appts">${apptsPatient.map(a=>apptCard(a,false)).join('')}</div>`:'<div class="empty">No appointments yet.</div>'}
  </section>`;
}
async function sendReminder(id,via){
  const a=apptsDay.concat(apptsPatient).find(x=>x.id===id);if(!a)return;
  const p=db.patients.find(x=>x.id===a.patient_id);if(!p||!p.phone){toast('Add a mobile number first');return}
  const msg=reminderText(a,p);
  if(via==='wa'){const n=waNumber(p.phone);if(!n){toast('Check the mobile number');return}window.open('https://wa.me/'+n+'?text='+encodeURIComponent(msg),'_blank');}
  else{const ios=/iPhone|iPad|iPod/.test(navigator.userAgent);location.href='sms:'+smsNumber(p.phone)+(ios?'&':'?')+'body='+encodeURIComponent(msg);}
  const now=new Date().toISOString();
  const {error}=await sb.from('appointments').update({reminded_at:now}).eq('id',id);
  if(!error){[apptsDay,apptsPatient].forEach(l=>{const x=l.find(y=>y.id===id);if(x)x.reminded_at=now});setTimeout(softRender,300);}
}

/* ---------- X-rays ---------- */
let xrays=[],xrLoading=false,xrUrls={},xrView=null,xrBusy=false;
const XR_KINDS=['OPG','Periapical (PA)','Bitewing (BW)','Lateral ceph','CBCT / scan report','Intraoral photo','Extraoral photo','Other'];
async function loadXrays(pid){
  const {data,error}=await sb.from('xrays').select('*').eq('patient_id',pid).order('taken_on',{ascending:false});
  if(error)throw error;xrays=data||[];
  const need=xrays.map(x=>x.path).filter(p=>!xrUrls[p]);
  if(need.length){const {data:urls}=await sb.storage.from('xrays').createSignedUrls(need,3600);(urls||[]).forEach(u=>{if(u.signedUrl)xrUrls[u.path]=u.signedUrl});}
}
async function refreshXrays(){xrLoading=true;softRender();try{await loadXrays(view.pid)}catch(e){toast(friendly(e))}xrLoading=false;softRender()}
function shrinkImage(file){
  return new Promise(res=>{
    if(!/^image\/(jpeg|png|webp)$/.test(file.type)){res({blob:file,type:file.type||'application/octet-stream'});return}
    const img=new Image(),url=URL.createObjectURL(file);
    img.onload=()=>{const max=3000,w=img.naturalWidth,h=img.naturalHeight,sc=Math.min(1,max/Math.max(w,h));
      if(sc===1&&file.size<4e6){URL.revokeObjectURL(url);res({blob:file,type:file.type});return}
      const c=document.createElement('canvas');c.width=Math.round(w*sc);c.height=Math.round(h*sc);c.getContext('2d').drawImage(img,0,0,c.width,c.height);
      c.toBlob(b=>{URL.revokeObjectURL(url);res(b?{blob:b,type:'image/jpeg'}:{blob:file,type:file.type})},'image/jpeg',0.92)};
    img.onerror=()=>{URL.revokeObjectURL(url);res({blob:file,type:file.type})};img.src=url;
  });
}
async function uploadXrays(files){
  const p=P();if(!p||!files.length)return;
  const meta={kind:$('#xr-kind').value,teeth:$('#xr-teeth').value.trim(),taken_on:$('#xr-date').value||today(),note:$('#xr-note').value.trim()};
  if(dirty.has(p.id))await flush();
  xrBusy=true;render();let ok=0;
  for(const f of files){
    try{
      const {blob,type}=await shrinkImage(f);
      const ext=type==='application/pdf'?'pdf':type==='image/png'?'png':'jpg';
      const path=clinic.id+'/'+p.id+'/'+uuid()+'.'+ext;
      const up=await sb.storage.from('xrays').upload(path,blob,{contentType:type,upsert:false});if(up.error)throw up.error;
      const row={clinic_id:clinic.id,patient_id:p.id,path,kind:meta.kind,teeth:meta.teeth,taken_on:meta.taken_on,note:meta.note,mime:type,size_bytes:blob.size||0};
      const ins=await sb.from('xrays').insert(row);if(ins.error){await sb.storage.from('xrays').remove([path]);throw ins.error}
      ok++;
    }catch(e){toast('Could not upload '+(f.name||'file')+': '+friendly(e))}
  }
  xrBusy=false;if(ok)toast(ok+' X-ray'+(ok>1?'s':'')+' saved');await refreshXrays();
}
function xrayTab(p){
  const fmtSize=b=>b>1e6?(b/1e6).toFixed(1)+' MB':Math.round(b/1e3)+' KB';
  return `<section class="panel">
    <h2>Add X-ray</h2>
    <div class="grid2">
      <label class="f"><span>Type</span><select id="xr-kind">${XR_KINDS.map(k=>`<option ${k===(view.xrKind||'Periapical (PA)')?'selected':''}>${k}</option>`).join('')}</select></label>
      <label class="f"><span>Date taken</span><input type="date" id="xr-date" value="${today()}"></label>
      <label class="f"><span>Teeth (FDI)</span><input type="text" id="xr-teeth" placeholder="e.g. 36, 37 or full mouth"></label>
      <label class="f"><span>Note (optional)</span><input type="text" id="xr-note" placeholder="e.g. periapical radiolucency 36"></label>
    </div>
    <label class="btn primary filebtn ${xrBusy?'busy':''}">${xrBusy?'Uploading…':'Take photo or choose X-ray'}<input type="file" id="xr-file" accept="image/*,application/pdf" multiple ${xrBusy?'disabled':''}></label>
    <p class="small muted" style="margin:0">On a phone you can photograph the X-ray screen or film, or pick images and PDFs from Photos or Files. Large photos are reduced to about 3000 pixels to save space.</p>
  </section>
  <section class="panel">
    <h2>X-rays · ${xrays.length}</h2>
    ${xrLoading&&!xrays.length?'<div class="empty">Loading…</div>':xrays.length?`<div class="xgrid">${xrays.map(x=>`<button class="xcard" data-xr="${x.id}">
      ${x.mime==='application/pdf'?'<span class="xthumb pdf">PDF</span>':`<span class="xthumb">${xrUrls[x.path]?`<img src="${esc(xrUrls[x.path])}" alt="" loading="lazy">`:''}</span>`}
      <span class="xmeta"><b>${esc(x.kind)}</b><span>${fmtDate(x.taken_on)}${x.teeth?' · '+esc(x.teeth):''}</span><span>${fmtSize(x.size_bytes)}</span></span>
    </button>`).join('')}</div>`:'<div class="empty">No X-rays yet.</div>'}
  </section>`;
}
function xrViewer(){
  const x=xrays.find(y=>y.id===xrView&&y);if(!x)return '';
  const url=xrUrls[x.path];const f=view.xrf||{b:100,c:100,inv:false,zoom:false};
  const pdf=x.mime==='application/pdf';
  return `<div class="xview" role="dialog" aria-label="${esc(x.kind)}">
    <div class="xbar"><div style="min-width:0"><b>${esc(x.kind)}</b><span class="small">${fmtDate(x.taken_on)}${x.teeth?' · '+esc(x.teeth):''}${x.note?' · '+esc(x.note):''} · ${esc(x.uploaded_by===user.id?'you':nameOf(x.uploaded_by))}</span></div><button class="btn small" data-act="xrClose">Close</button></div>
    <div class="ximg ${f.zoom?'zoom':''}">${pdf?`<div class="empty" style="color:inherit">PDF file. Tap “Open full size” to view it.</div>`:`<img src="${esc(url||'')}" alt="${esc(x.kind)}" data-act="xrZoom" style="filter:brightness(${f.b}%) contrast(${f.c}%)${f.inv?' invert(1)':''}">`}</div>
    <div class="xtools">
      ${pdf?'':`<label>Brightness<input type="range" id="xr-b" min="40" max="200" value="${f.b}"></label><label>Contrast<input type="range" id="xr-c" min="40" max="250" value="${f.c}"></label>
      <button class="btn small" data-act="xrInv">${f.inv?'Normal':'Invert'}</button><button class="btn small" data-act="xrZoom">${f.zoom?'Fit to screen':'Full size'}</button>`}
      ${url?`<a class="btn small" href="${esc(url)}" target="_blank" rel="noopener">Open full size</a>`:''}
      <button class="btn small" data-act="xrSave">Save / share</button>
      ${view.confirm==='xrdel'?`<button class="btn small" data-act="cancelConfirm">Keep</button><button class="btn small danger" data-act="xrDelete">Yes, delete</button>`:`<button class="btn small danger" data-act="xrAskDel">Delete</button>`}
    </div>
  </div>`;
}

/* ---------- alerts ---------- */
function alertsOf(p){const a=[];const ans=p.mh.answers;for(const k in ALERT_KEYS){if(ans[k]&&ans[k].v==='y')a.push(ALERT_KEYS[k]);}return a}
function mhStatus(p){
  if(!p.mh.date)return {cls:'warn',t:'No medical history'};
  if((Date.now()-new Date(p.mh.date))/864e5>365)return {cls:'warn',t:'MH over 12 months old'};
  return {cls:'ok',t:'MH '+fmtDate(p.mh.date)};
}

/* ---------- screens ---------- */
function render(){
  const app=$('#app');const s=view.screen;
  const v={config:configView,offline:offlineView,loading:loadingView,error:errorView,auth:authView,newpw:newpwView,onboard:onboardView,recovery:recoveryView,list:listView,appts:apptsView,settings:settingsView,patient:patientView}[s]||loadingView;
  app.innerHTML=v();
}
const msgHtml=()=>view.msg?`<div class="msg ${view.msg.t}" role="alert">${esc(view.msg.m)}</div>`:'';
const brand=()=>`<div class="brand"><svg viewBox="0 0 100 100" aria-hidden="true"><polygon points="4,4 96,4 68,32 32,32" fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="5"/><polygon points="4,96 96,96 68,68 32,68" fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="5"/><polygon points="4,4 32,32 32,68 4,96" fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="5"/><polygon points="96,4 68,32 68,68 96,96" fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="5"/><rect x="32" y="32" width="36" height="36" fill="var(--accent)"/></svg><div><b>Clinic Patient Records</b><span>Dental records for your clinic</span></div></div>`;
function configView(){return `<div class="auth">${brand()}<section class="panel"><h2>Almost ready</h2><p style="margin:0">This app is not connected to its database yet. Open <b>app.js</b> and paste your Supabase <b>Project URL</b> and <b>anon public key</b> at the top, as shown in the setup guide.</p></section></div>`}
function offlineView(){return `<div class="auth">${brand()}<section class="panel"><h2>Can't connect</h2><p style="margin:0">The app could not load. Check your internet connection, then reload the page.</p><div class="row"><button class="btn primary" data-act="reload">Reload</button></div></section></div>`}
function loadingView(){return `<div class="auth">${brand()}<p class="muted" style="text-align:center">Loading…</p></div>`}
function errorView(){return `<div class="auth">${brand()}${msgHtml()}<div class="row"><button class="btn primary" data-act="reload">Try again</button><button class="btn" data-act="logout">Log out</button></div></div>`}
function authView(){
  const t=LOCAL?(window.__LOCAL_DB.userCount()===0?'signup':'login'):view.authTab;
  return `<div class="auth">${brand()}
  ${LOCAL?'':`<div class="tabs" role="tablist"><button class="tab" role="tab" aria-selected="${t==='login'}" data-authtab="login">Log in</button><button class="tab" role="tab" aria-selected="${t==='signup'}" data-authtab="signup">${LOCAL?'First-time setup':'Create account'}</button></div>`}
  ${msgHtml()}
  ${t==='login'?`<form class="panel" id="loginForm" novalidate>
    <label class="f"><span>${LOCAL?'Username':'Email'}</span><input type="${LOCAL?'text':'email'}" id="li-email" autocomplete="username" autocapitalize="off" autocorrect="off" ${LOCAL?'':'inputmode="email"'} value="${esc(view.email||'')}" required></label>
    <label class="f"><span>Password</span><input type="password" id="li-pw" autocomplete="current-password" required></label>
    <button class="btn primary" type="submit">Log in</button>
    ${LOCAL?`<button class="linkbtn" type="button" data-act="showUsers">${view.showUsers?'Hide usernames':'Forgot your username?'}</button>
    ${view.showUsers?`<div class="summary">${window.__LOCAL_DB.usernames().map(u=>`<span><b>${esc(u.username)}</b>${u.name?' · '+esc(u.name):''}</span>`).join('')}</div>`:''}
    <p class="small muted" style="margin:0">Forgot your password? Your clinic admin can reset it in Clinic & account → Team.</p>
    <button class="linkbtn" type="button" data-act="showRecover">${view.showRecover?'Hide':'Admin forgot password?'}</button>`:'<button class="linkbtn" type="button" data-act="forgot">Forgot password?</button>'}
  </form>
  ${LOCAL&&view.showRecover?`<form class="panel" id="recoverForm" novalidate><h3>Reset admin password</h3>
    <label class="f"><span>Admin username</span><input type="text" id="rv-user" autocapitalize="off" autocorrect="off" value="${esc(view.email||'')}" required></label>
    <label class="f"><span>Recovery code</span><input type="text" id="rv-code" class="codein" autocapitalize="characters" autocomplete="off" placeholder="XXXX-XXXX-XXXX" value="${esc(view.rvCode||'')}" required></label>
    <label class="f"><span>New password (at least 8 characters)</span><input type="password" id="rv-pw" autocomplete="new-password" minlength="8" required></label>
    <button class="btn primary" type="submit">Set new password</button></form>`:''}`:`<form class="panel" id="signupForm" novalidate>
    <label class="f"><span>Your name (as shown on records)</span><input type="text" id="su-name" placeholder="e.g. Dr Ayesha Khan" autocomplete="name" required></label>
    <label class="f"><span>${LOCAL?'Choose a username (for logging in)':'Email'}</span><input type="${LOCAL?'text':'email'}" id="su-email" autocomplete="username" autocapitalize="off" autocorrect="off" ${LOCAL?'placeholder="e.g. ayesha"':'inputmode="email"'} required></label>
    <label class="f"><span>Password (at least 8 characters)</span><input type="password" id="su-pw" autocomplete="new-password" minlength="8" required></label>
    <button class="btn primary" type="submit">${LOCAL?'Continue':'Create account'}</button>
    <p class="small muted" style="margin:0">${LOCAL?'You become the clinic admin. Next you enter your clinic name, then you can add other dentists.':'After this you can create your clinic, or join one with an invite code from your clinic admin.'}</p>
  </form>
  ${LOCAL?`<section class="panel"><h3>Moving from another phone?</h3>
    <label class="f"><span>Restore a full backup file instead</span><input type="file" id="restoreFile" accept=".json,application/json"></label>
    ${view.confirm==='restore'?`<div class="confirm">Restore the backup of ${esc(view.restoreInfo||'')}? Then log in with your usual username.<span class="spacer"></span><button class="btn small" data-act="cancelConfirm">Cancel</button><button class="btn small primary" data-act="doRestore">Restore</button></div>`:''}
  </section>`:''}`}
  <p class="small muted" style="text-align:center">${LOCAL?'Records are saved on this device only.':'Works on phone, tablet and computer. Your records sync between them.'}</p></div>`;
}
function newpwView(){return `<div class="auth">${brand()}${msgHtml()}<form class="panel" id="newpwForm"><h2>Set a new password</h2>
  <label class="f"><span>New password (at least 8 characters)</span><input type="password" id="np-pw" autocomplete="new-password" minlength="8" required></label>
  <button class="btn primary" type="submit">Save password</button></form></div>`}
function onboardView(){
  const nm=(user&&user.user_metadata&&user.user_metadata.full_name)||'';
  return `<div class="auth">${brand()}${msgHtml()}
  <form class="panel" id="createForm"><h2>Create your clinic</h2>
    <p class="small muted" style="margin:0">${LOCAL?'You become the clinic admin and can add dentists with their own logins.':'You become the clinic admin and get an invite code for your dentists.'}</p>
    <label class="f"><span>Clinic name</span><input type="text" id="cc-name" placeholder="e.g. Smile Dental Clinic" required></label>
    <label class="f"><span>Address</span><input type="text" id="cc-address" placeholder="Street, city"></label>
    <label class="f"><span>Phone</span><input type="tel" id="cc-phone"></label>
    <label class="f"><span>Your name on records</span><input type="text" id="cc-me" value="${esc(nm)}" required></label>
    <button class="btn primary" type="submit">Create clinic</button>
  </form>
  <div class="or" ${LOCAL?'hidden':''}><span>or</span></div>
  <form class="panel" id="joinForm" ${LOCAL?'hidden':''}><h2>Join a clinic</h2>
    <label class="f"><span>Invite code (from your clinic admin)</span><input type="text" id="jc-code" class="codein" autocapitalize="characters" autocomplete="off" required></label>
    <label class="f"><span>Your name on records</span><input type="text" id="jc-me" value="${esc(nm)}" required></label>
    <button class="btn" type="submit">Join clinic</button>
  </form>
  <div class="row" style="justify-content:center">${memberships.length?'<button class="btn small" data-act="back">← Back to my clinic</button>':''}<button class="btn small" data-act="logout">Log out</button></div></div>`;
}

function listView(){
  const q=view.q.toLowerCase();
  const list=db.patients.filter(p=>(p.first+' '+p.last+' '+(p.phone||'')+' '+(p.cnic||'')).toLowerCase().includes(q))
   .sort((a,b)=>(a.last||'').localeCompare(b.last||''));
  return `
  <header class="top">
    <div style="min-width:0"><h1>${esc(clinic.name)}</h1><div class="sub">${db.patients.length} patient${db.patients.length===1?'':'s'} · ${esc(me.name)} ${syncBadge()}</div></div>
    <button class="btn small" data-act="settings">Clinic & account</button>
  </header>
  ${homeNav('list')}
  ${deviceBanner()}
  <div class="row">
    <input type="search" id="search" placeholder="Search name, phone or CNIC" value="${esc(view.q)}" style="flex:1;min-width:0">
    <button class="btn primary" data-act="newPatient">+ New patient</button>
  </div>
  <section class="panel">
    ${list.length?`<div class="plist">${list.map(p=>{
      const al=alertsOf(p),ms=mhStatus(p),open=p.plan.filter(i=>i.status!=='completed').length;
      return `<button class="pitem" data-open="${p.id}">
        <span class="avatar">${esc(((p.first||' ')[0]+(p.last||' ')[0]).trim())}</span>
        <span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:3px">
          <span class="nm">${esc(p.last)}, ${esc(p.first)} ${p.example?'<span class="pill warn">Example</span>':''}</span>
          <span class="meta">${p.dob?fmtDate(p.dob)+' · '+age(p.dob)+' yrs':'No date of birth'}${p.phone?' · '+esc(p.phone):''}${open?' · '+open+' item'+(open>1?'s':'')+' to do':''}</span>
          <span class="alerts">${al.length?`<span class="pill alert">⚠ ${al.length} medical alert${al.length>1?'s':''}</span>`:''}<span class="pill ${ms.cls}">${ms.t}</span></span>
        </span>
      </button>`}).join('')}</div>`:(q?`<div class="empty">No patient matches that search.</div>`:`<div class="empty">No patients yet. Tap “New patient” to add the first one.</div><div class="row"><button class="btn small" data-act="example">Add an example patient to try the app</button></div>`)}
  </section>`;
}

function settingsView(){
  const admin=isAdmin();const oldLocal=lsGet('clinicRecords.v1');
  return `
  <header class="top"><button class="btn small" data-act="back">← Patients</button>${syncBadge()}</header>
  <h1>Clinic & account</h1>
  ${msgHtml()}
  <form class="panel" id="clinicForm">
    <h3>Clinic details</h3>
    <label class="f"><span>Clinic name</span><input type="text" id="cl-name" value="${esc(clinic.name)}" ${admin?'':'readonly'} required></label>
    <label class="f"><span>Address</span><input type="text" id="cl-address" value="${esc(clinic.address)}" ${admin?'':'readonly'}></label>
    <label class="f"><span>Phone</span><input type="tel" id="cl-phone" value="${esc(clinic.phone)}" ${admin?'':'readonly'}></label>
    <label class="f"><span>Appointment reminder message (English or Urdu)</span><textarea id="cl-tpl" rows="4" ${admin?'':'readonly'} placeholder="${esc(DEFAULT_TEMPLATE)}">${esc(clinic.reminder_template||'')}</textarea></label>
    <p class="small muted" style="margin:0">Leave empty to use the standard message. These words are filled in for each patient: {name} {clinic} {date} {time} {phone} {dentist}</p>
    ${admin?'<div class="row"><button class="btn primary" type="submit">Save clinic details</button></div>':'<p class="small muted" style="margin:0">Only a clinic admin can change these.</p>'}
  </form>
  ${LOCAL?addDentistHtml(admin):''}
  ${LOCAL&&admin?recoveryPanel():''}
  <section class="panel" ${LOCAL?'hidden':''}>
    <h3>Invite dentists</h3>
    ${admin?`<p class="small muted" style="margin:0">Send this code to a dentist. They create an account, choose “Join a clinic” and enter it.</p>
    <div class="row"><span class="invite" id="invite">${esc(clinic.invite_code)}</span><span class="spacer"></span><button class="btn small" data-act="copyCode">Copy</button>
    ${view.confirm==='newcode'?`<button class="btn small" data-act="cancelConfirm">Keep code</button><button class="btn small danger" data-act="newCode">Make new code</button>`:`<button class="btn small" data-act="askNewCode">New code</button>`}</div>
    ${view.confirm==='newcode'?'<p class="small" style="margin:0">The old code will stop working. People already in the clinic stay.</p>':''}`
    :'<p class="small muted" style="margin:0">Ask your clinic admin for the invite code.</p>'}
  </section>
  <section class="panel">
    <h3>Team · ${team.length}</h3>
    <div class="plist">${team.map(t=>{const self=t.user_id===user.id;return `<div class="member">
      <span class="avatar">${esc((t.name||'?').replace(/^Dr\.?\s*/i,'').slice(0,1))}</span>
      <span style="flex:1;min-width:0"><b>${esc(t.name)}</b>${self?' <span class="muted small">(you)</span>':''}<br><span class="small muted">Joined ${fmtDate(String(t.joined_at).slice(0,10))}</span></span>
      <span class="pill ${t.role==='admin'?'info':'ok'}">${t.role==='admin'?'Admin':'Dentist'}</span>
      ${admin&&!self?`<span class="row" style="gap:6px;width:100%;justify-content:flex-end">
        ${LOCAL?(view.confirm==='pw:'+t.user_id?`<form id="resetPwForm" class="row" style="width:100%;gap:6px" data-uid="${t.user_id}"><input type="password" id="rp-pw" placeholder="New password (8+ characters)" minlength="8" autocomplete="new-password" style="flex:1;min-width:0"><button class="btn small primary" type="submit">Save</button><button class="btn small" type="button" data-act="cancelConfirm">Cancel</button></form>`:`<button class="btn small" data-askpw="${t.user_id}">Reset password</button>`):''}
        <button class="btn small" data-role="${t.role==='admin'?'dentist':'admin'}" data-uid="${t.user_id}">${t.role==='admin'?'Make dentist':'Make admin'}</button>
        ${view.confirm==='rm:'+t.user_id?`<button class="btn small" data-act="cancelConfirm">Keep</button><button class="btn small danger" data-rm="${t.user_id}">Yes, remove</button>`:`<button class="btn small danger" data-askrm="${t.user_id}">Remove</button>`}
      </span>`:''}
    </div>`}).join('')}</div>
  </section>
  <form class="panel" id="meForm">
    <h3>Your account</h3>
    <p class="small muted" style="margin:0">Logged in as ${LOCAL?'username ':''}${esc(user.email)}</p>
    <label class="f"><span>Your name on records in this clinic</span><input type="text" id="me-name" value="${esc(me.name)}" required></label>
    <div class="row"><button class="btn" type="submit">Save name</button></div>
  </form>
  <form class="panel" id="pwForm">
    <h3>Change password</h3>
    <label class="f"><span>New password (at least 8 characters)</span><input type="password" id="pw-new" autocomplete="new-password" minlength="8" required></label>
    <div class="row"><button class="btn" type="submit">Change password</button></div>
  </form>
  <section class="panel" ${LOCAL?'hidden':''}>
    <h3>Clinics</h3>
    ${memberships.length>1?`<label class="f"><span>Switch clinic</span><select id="switchClinic">${memberships.map(m=>`<option value="${m.clinic_id}" ${m.clinic_id===clinic.id?'selected':''}>${esc(m.clinics.name)}</option>`).join('')}</select></label>`:''}
    <div class="row"><button class="btn small" data-act="onboard">Create or join another clinic</button>
    ${view.confirm==='leave'?`<button class="btn small" data-act="cancelConfirm">Stay</button><button class="btn small danger" data-act="leave">Yes, leave ${esc(clinic.name)}</button>`:`<button class="btn small danger" data-act="askLeave">Leave this clinic</button>`}</div>
  </section>
  ${LOCAL?localBackupHtml(admin):''}
  <section class="panel" ${LOCAL?'hidden':''}>
    <h3>Backup</h3>
    <p class="small muted" style="margin:0">Records are stored online and sync automatically. You can also save a copy of all ${db.patients.length} patient records as a file.</p>
    <div class="row"><button class="btn" data-act="exportBackup">Save backup file</button></div>
    ${admin?`<label class="f"><span>Import patients from a backup file</span><input type="file" id="importFile" accept=".json,application/json"></label>`:''}
    ${admin&&oldLocal?`<div class="row"><button class="btn small" data-act="importLocal">Bring in records saved on this device by the earlier app</button></div>`:''}
  </section>
  <section class="panel">
    <h3>Keeping records safe</h3>
    <p class="small" style="margin:0">Patient records are confidential. Use a strong password, log out on shared computers, and remove dentists who leave the clinic.</p>
    <div class="row"><button class="btn danger" data-act="logout">Log out</button></div>
  </section>`;
}

function recoveryView(){
  return `<div class="auth">${brand()}
  <section class="panel"><h2>Save your recovery code</h2>
    <p style="margin:0">If you ever forget the admin password, this code lets you set a new one. Without it, a forgotten admin password cannot be reset.</p>
    <div class="row" style="justify-content:center"><span class="invite" id="rcode">${esc(view.recoveryCode)}</span></div>
    <p class="small muted" style="margin:0">Write it on paper and keep it in the clinic, or take a screenshot and keep it in a private place. It is shown only now. You can make a new one later in Clinic & account.</p>
    <label class="row small" style="gap:10px"><input type="checkbox" id="rc-ok" style="width:22px;height:22px"> I have saved the recovery code</label>
    <button class="btn primary" data-act="rcDone">Continue</button>
  </section></div>`;
}
function deviceBanner(){
  if(!LOCAL)return '';
  const ios=/iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone=navigator.standalone||(window.matchMedia&&matchMedia('(display-mode: standalone)').matches);
  const last=+lsGet('lastFullBackup')||0,old=!last||Date.now()-last>7*864e5;let h='';
  if(ios&&!standalone)h+=`<div class="msg warn">Add this app to your Home Screen (Share → Add to Home Screen) and always open it from there. Safari and the Home Screen app keep separate records, and Safari can delete records of a site you don't open for 7 days.</div>`;
  if(isAdmin()&&!clinic.has_recovery)h+=`<div class="msg warn">Set up an admin recovery code, so a forgotten admin password can be reset. <button class="linkbtn" data-act="settings">Set it up</button></div>`;
  if(old&&db.patients.length)h+=`<div class="msg warn">${last?'Your last full backup was more than a week ago.':'You have no backup yet.'} Records are only on this device. <button class="linkbtn" data-act="settings">Save a backup</button></div>`;
  return h;
}
function recoveryPanel(){
  return `<section class="panel"><h3>Admin recovery code</h3>
    <p class="small muted" style="margin:0">Resets a forgotten admin password from the login screen. ${clinic.has_recovery?'A code is set. Making a new one stops the old one.':'<b style="color:var(--warn)">No code yet.</b>'}</p>
    ${view.newRecovery?`<div class="row" style="justify-content:center"><span class="invite">${esc(view.newRecovery)}</span></div><p class="small" style="margin:0">Write this down or take a screenshot now. It won't be shown again.</p>`:
    view.confirm==='newrc'?`<div class="row"><button class="btn small" data-act="cancelConfirm">Cancel</button><button class="btn small primary" data-act="makeRecovery">Yes, make a new code</button></div>`:
    `<div class="row"><button class="btn ${clinic.has_recovery?'':'primary'}" data-act="${clinic.has_recovery?'askRecovery':'makeRecovery'}">${clinic.has_recovery?'Make a new recovery code':'Create recovery code'}</button></div>`}
  </section>`;
}
function addDentistHtml(admin){
  if(!admin)return `<section class="panel"><h3>Dentists</h3><p class="small muted" style="margin:0">Your clinic admin adds dentists and resets passwords.</p></section>`;
  return `<form class="panel" id="addDentistForm">
    <h3>Add a dentist</h3>
    <p class="small muted" style="margin:0">Each dentist logs in on this device with their own username and password. Their name appears on the notes they write.</p>
    <div class="grid2">
      <label class="f"><span>Name on records</span><input type="text" id="ad-name" placeholder="e.g. Dr Bilal Ahmed" required></label>
      <label class="f"><span>Username</span><input type="text" id="ad-user" autocapitalize="off" autocorrect="off" autocomplete="off" placeholder="e.g. bilal" required></label>
    </div>
    <div class="grid2">
      <label class="f"><span>Password (at least 8 characters)</span><input type="password" id="ad-pw" autocomplete="new-password" minlength="8" required></label>
      <label class="f"><span>Role</span><select id="ad-role"><option value="dentist">Dentist</option><option value="admin">Admin (can add dentists)</option></select></label>
    </div>
    <div class="row"><button class="btn primary" type="submit">Add dentist</button></div>
  </form>`;
}
function localBackupHtml(admin){
  const last=+lsGet('lastFullBackup')||0;const days=last?Math.floor((Date.now()-last)/864e5):0;
  return `<section class="panel">
    <h3>Backup</h3>
    <p class="small" style="margin:0">All records and X-rays are stored only on this device. If the phone is lost, broken or reset, they are gone. Save a full backup every week and keep it in iCloud Drive or Google Drive. The same file moves everything to a new phone.</p>
    <p class="small muted" style="margin:0">Last full backup: ${last?fmtDate(dayOf(last))+(days?' ('+days+' day'+(days>1?'s':'')+' ago)':' (today)'):'never'}</p>
    <div class="row">${view.backupBlob?`<button class="btn primary" data-act="shareBackup">Save backup file now</button><span class="small muted">${(view.backupBlob.size/1e6).toFixed(1)} MB ready</span>`:`<button class="btn primary" data-act="fullBackup" ${view.backupBusy?'disabled':''}>${view.backupBusy?'Preparing backup…':'Save full backup (with X-rays)'}</button>`}</div>
    ${admin?`<label class="f"><span>Restore a full backup (replaces everything on this device)</span><input type="file" id="restoreFile" accept=".json,application/json"></label>`:''}
    ${view.confirm==='restore'?`<div class="confirm">Replace ALL records on this device with the backup of ${esc(view.restoreInfo||'')}? Everyone is logged out afterwards.<span class="spacer"></span><button class="btn small" data-act="cancelConfirm">Cancel</button><button class="btn small danger" data-act="doRestore">Replace</button></div>`:''}
  </section>`;
}
function patientView(){
  const p=P();if(!p){view.screen='list';return listView();}
  const al=alertsOf(p),ms=mhStatus(p);
  const tabs=[['details','Details'],['mh','Medical history'],['chart','Chart'],['plan','Treatment plan'],['notes','Clinical notes'],['xrays','X-rays'],['appts','Appointments']];
  const body={details:detailsTab,mh:mhTab,chart:chartTab,plan:planTab,notes:notesTab,xrays:xrayTab,appts:apptTab}[view.tab](p);
  return `
  <header class="top"><button class="btn small" data-act="back">← Patients</button>${syncBadge()}</header>
  ${p.example?'<span class="note-ex">Example record – delete it once you add real patients</span>':''}
  <div class="banner">
    <div class="row"><span class="nm">${esc(p.first)} ${esc(p.last)}</span><span class="spacer"></span><span class="small muted">${p.dob?fmtDate(p.dob)+' · '+age(p.dob)+' yrs':''}</span></div>
    <div class="alerts">${al.map(a=>`<span class="pill alert">⚠ ${esc(a)}</span>`).join('')}<span class="pill ${ms.cls}">${ms.t}</span></div>
    ${p._upd?`<div class="small muted">Last saved ${fmtTime(p._upd)} by ${esc(p._by===user.id?'you':nameOf(p._by))}</div>`:''}
    <div class="tabs" role="tablist">${tabs.map(([k,l])=>`<button class="tab" role="tab" aria-selected="${view.tab===k}" data-tab="${k}">${l}</button>`).join('')}</div>
  </div>
  ${body}
  ${xrView?xrViewer():''}`;
}

function fld(id,label,val,type='text',extra=''){return `<label class="f"><span>${label}</span><input type="${type}" data-f="${id}" id="f-${id}" value="${esc(val)}" ${extra}></label>`}
function detailsTab(p){
  return `<section class="panel">
    <h3>Personal details</h3>
    <div class="grid2">${fld('first','First name',p.first)}${fld('last','Surname / family name',p.last)}${fld('dob','Date of birth',p.dob,'date')}
    <label class="f"><span>Sex</span><select data-f="sex" id="f-sex">${['','F','M','O'].map(o=>`<option ${p.sex===o?'selected':''} value="${o}">${{'':'—',F:'Female',M:'Male',O:'Other'}[o]}</option>`).join('')}</select></label>
    ${fld('phone','Mobile',p.phone,'tel')}${fld('cnic','CNIC',p.cnic,'text','inputmode="numeric" placeholder="00000-0000000-0"')}</div>
    ${fld('email','Email',p.email,'email')}${fld('address','Address',p.address)}
  </section>
  <section class="panel">
    <h3>Payment & contacts</h3>
    <div class="grid2">
    <label class="f"><span>Payment</span><select data-f="insurance" id="f-insurance">${INSURANCE.map(o=>`<option ${p.insurance===o?'selected':''}>${o}</option>`).join('')}</select></label>
    ${fld('insNo','Card / panel number',p.insNo)}</div>
    ${fld('gp','Family doctor / physician',p.gp)}${fld('emergency','Emergency contact',p.emergency)}
  </section>
  <section class="panel">
    <h3>Delete record</h3>
    ${view.confirm==='delete'?`<div class="confirm">Delete ${esc(p.first)} ${esc(p.last)} and all their records for everyone in the clinic? This cannot be undone.<span class="spacer"></span><button class="btn small" data-act="cancelConfirm">Cancel</button><button class="btn small danger" data-act="deletePatient">Delete</button></div>`:`<div class="row"><button class="btn danger" data-act="askDelete">Delete patient</button></div>`}
  </section>`;
}
function mhTab(p){
  const mh=p.mh;
  return `<section class="panel">
    <div class="row"><h2>Medical history questionnaire</h2><span class="spacer"></span><span class="pill ${mhStatus(p).cls}">${mhStatus(p).t}</span></div>
    <p class="small muted" style="margin:0">Go through each question with the patient. Update at every check-up and before any treatment. A “Yes” answer adds a medical alert to the banner.</p>
    <div class="mhq">${MH.map(([k,q])=>{const a=mh.answers[k]||{};return `<div class="q">
      <span>${q}</span>
      <span class="yn"><button class="y ${a.v==='y'?'on':''}" data-mh="${k}" data-v="y">Yes</button><button class="n ${a.v==='n'?'on':''}" data-mh="${k}" data-v="n">No</button></span>
      ${a.v==='y'?`<input type="text" class="det" data-mhd="${k}" id="mhd-${k}" placeholder="Details" value="${esc(a.d)}">`:''}
    </div>`}).join('')}</div>
    <label class="f"><span>Current medicines (name, dose, how often)</span><textarea data-mhf="meds" id="mh-meds">${esc(mh.meds)}</textarea></label>
    <div class="grid2">
      <label class="f"><span>Smoking / vaping / sheesha</span><input type="text" data-mhf="smoke" id="mh-smoke" placeholder="e.g. 10 cigarettes / day" value="${esc(mh.smoke)}"></label>
      <label class="f"><span>Paan, gutka, naswar or chhalia</span><input type="text" data-mhf="tobacco" id="mh-tobacco" placeholder="what, how often, how many years" value="${esc(mh.tobacco)}"></label>
    </div>
    <label class="row small" style="gap:10px"><input type="checkbox" data-mhf="signed" id="mh-signed" ${mh.signed?'checked':''} style="width:22px;height:22px"> Patient confirmed this information is correct</label>
    <div class="row"><button class="btn primary" data-act="mhDate">Mark as reviewed today</button><span class="small muted">Last reviewed: ${mh.date?fmtDate(mh.date):'never'}</span></div>
  </section>`;
}
function toothSVG(p,n,big){
  const sf=p.surf[n]||{},st=p.chart[n]||'',map=surfMap(n);
  const polys={top:'4,4 96,4 68,32 32,32',bottom:'4,96 96,96 68,68 32,68',left:'4,4 32,32 32,68 4,96',right:'96,4 68,32 68,68 96,96',center:'32,32 68,32 68,68 32,68'};
  const lp={top:[50,19],bottom:[50,86],left:[17,53],right:[83,53],center:[50,53]};
  let s=`<svg viewBox="0 0 100 100" ${big?'role="group" aria-label="Surfaces of tooth '+n+'"':'aria-hidden="true"'}><g ${st==='missing'?'opacity=".3"':''}>`;
  for(const pos in polys){const k=map[pos],v=sf[k];
    s+=`<polygon points="${polys[pos]}" fill="${v?`var(${surfColor(v)})`:'var(--paper)'}" stroke="var(--ink)" stroke-width="${big?1.5:3.5}" stroke-linejoin="round"${big?` data-surf="${k}" tabindex="0" role="button" aria-label="${surfName(n,k)} surface${v?', '+(v.t==='fill'?(MT[v.m]||MT.comp).label+' filling':v.t):''}"`:''}/>`;}
  s+='</g>';
  const ov=w=>`pointer-events="none" stroke-width="${w}"`;
  if(st==='crown')s+=`<rect x="3" y="3" width="94" height="94" fill="none" stroke="var(--t-crown)" ${ov(big?5:9)}/>`;
  if(st==='implant')s+=`<rect x="3" y="3" width="94" height="94" fill="none" stroke="var(--t-implant)" ${ov(big?5:9)}/>`;
  if(st==='bridge')s+=`<rect x="3" y="3" width="94" height="94" fill="none" stroke="var(--t-bridge)" stroke-dasharray="10 6" ${ov(big?5:9)}/>`;
  if(st==='frac')s+=`<polyline points="20,8 45,40 35,55 70,92" fill="none" stroke="var(--t-frac)" ${ov(big?4:8)}/>`;
  if(st==='missing'||st==='ext')s+=`<path d="M10 10L90 90M90 10L10 90" fill="none" stroke="var(${st==='ext'?'--t-ext':'--t-missing'})" stroke-linecap="round" ${ov(big?5:10)}/>`;
  if(big)for(const pos in lp){const k=map[pos];s+=`<text x="${lp[pos][0]}" y="${lp[pos][1]}" text-anchor="middle" dominant-baseline="middle">${surfLabel(n,k)}</text>`}
  return s+'</svg>';
}
function toothBtn(p,n,lower){
  const st=ST[p.chart[n]||'']||ST[''];
  const code=[st.de,p.rct[n]?'RCT':''].filter(Boolean).join(' ');
  const sum=summaryOf(p,n).map(x=>x.s+' '+x.txt).join(', ');
  return `<button class="tooth ${lower?'lo':''} ${view.tooth===n?'sel':''}" data-tooth="${n}" aria-label="Tooth ${n}: ${st.label}${p.rct[n]?', root canal treated':''}${sum?', '+sum:''}"><span>${n}</span>${toothSVG(p,n,false)}<span class="code">${esc(code)||(p.toothNotes[n]?'•':'')}</span></button>`;
}
function editor(p,t,mode,mat,sum){
  const cur=p.chart[t]||'';
  return `<div class="panel" style="background:var(--bg)" id="editor">
    <div class="row"><h2>Tooth ${t}</h2><span class="small muted">${toothName(t)}</span><span class="spacer"></span><button class="btn small" data-act="closeTooth">Done</button></div>
    <div class="sedit">
      <div class="big">${toothSVG(p,t,true)}<p class="small muted" style="text-align:center;margin:6px 0 0">Tap a surface to mark it</p></div>
      <div style="display:flex;flex-direction:column;gap:10px;min-width:0">
        <h3>1 · Finding</h3>
        <div class="chips">${MODES.map(m=>`<button class="chip ${mode===m.k?'on':''}" data-mode="${m.k}">${m.col?`<i style="background:var(${m.col})"></i>`:''}${m.label}</button>`).join('')}</div>
        ${mode==='fill'||mode==='sec'?`<h3>2 · ${mode==='sec'?'Existing filling':'Material'}</h3>
        <div class="chips">${MATS.map(m=>`<button class="chip ${mat===m.k?'on':''}" data-mat="${m.k}"><i style="background:var(${m.col})"></i>${m.label}</button>`).join('')}</div>`:''}
        <div class="summary">${sum.length?sum.map(x=>`<span><b>${t} ${x.s}</b> · ${x.txt}</span>`).join(''):'<span class="muted">No surfaces charted yet</span>'}</div>
      </div>
    </div>
    <h3>Whole tooth</h3>
    <div class="statusgrid">${STATUS.map(s=>`<button class="${cur===s.k?'on':''}" data-setst="${s.k}"><i style="width:12px;height:12px;border-radius:3px;flex:none;background:${s.col?`var(${s.col})`:'var(--paper)'};border:1px solid var(--line)"></i>${s.label}${s.de?`<b>${s.de}</b>`:''}</button>`).join('')}</div>
    <label class="row small" style="gap:10px"><input type="checkbox" id="rct" data-rct="${t}" ${p.rct[t]?'checked':''} style="width:22px;height:22px"> Root canal treated (RCT)</label>
    <label class="f"><span>Note for tooth ${t}</span><input type="text" id="toothnote" data-tnote="${t}" value="${esc(p.toothNotes[t])}" placeholder="e.g. deep caries, TTP +, mobility I"></label>
    <div class="row"><button class="btn" data-act="addToPlan">+ Add treatment for ${t}</button><span class="spacer"></span>${view.confirm==='clearTooth'?`<button class="btn small" data-act="cancelConfirm">Keep</button><button class="btn small danger" data-act="clearTooth">Yes, clear ${t}</button>`:`<button class="btn small danger" data-act="askClearTooth">Clear tooth</button>`}</div>
  </div>`;
}
function chartTab(p){
  const t=view.tooth,mode=view.mode||'caries',mat=view.mat||'comp';
  const UR=[18,17,16,15,14,13,12,11],UL=[21,22,23,24,25,26,27,28],LR=[48,47,46,45,44,43,42,41],LL=[31,32,33,34,35,36,37,38];
  const rowHtml=(a,b,lo)=>a.map(n=>toothBtn(p,n,lo)).join('')+'<span class="mid"></span>'+b.map(n=>toothBtn(p,n,lo)).join('');
  const legend=[...MODES.filter(m=>m.col).map(m=>[m.label,`background:var(${m.col})`]),...MATS.map(m=>[m.label,`background:var(${m.col})`]),
    ['Crown (CR)','border:2.5px solid var(--t-crown)'],['Implant (IMP)','border:2.5px solid var(--t-implant)'],['Bridge pontic (BR)','border:2.5px dashed var(--t-bridge)'],['Missing (MIS) / extraction (XLA)','background:linear-gradient(45deg,transparent 40%,var(--t-ext) 40% 60%,transparent 60%)'],['RCT = root canal treated','']];
  const sum=t?summaryOf(p,t):[];
  return `<section class="panel">
    <div class="row"><h2>Dental chart</h2><span class="spacer"></span><span class="small muted">FDI · tap a tooth</span></div>
    <div class="opg"><div class="opg-in">
      <span class="side" style="grid-column:1/9">Upper right · Q1</span><span></span><span class="side r" style="grid-column:10/18">Upper left · Q2</span>
      ${rowHtml(UR,UL,false)}
      <span class="occ"></span>
      ${rowHtml(LR,LL,true)}
      <span class="side" style="grid-column:1/9">Lower right · Q4</span><span></span><span class="side r" style="grid-column:10/18">Lower left · Q3</span>
    </div></div>
    <p class="small muted" style="margin:0">Charted like an OPG: patient's right on your left. On a phone, swipe the chart sideways.</p>
    <div class="legend">${legend.map(([l,s])=>`<span>${s?`<i style="${s}"></i>`:''}${l}</span>`).join('')}</div>
    ${t?editor(p,t,mode,mat,sum):''}
  </section>
  <section class="panel">
    <div class="row"><h2>BPE</h2><span class="spacer"></span><span class="small muted">Basic Periodontal Examination</span></div>
    <div class="bpe">${p.bpe.map((v,i)=>`<select data-bpe="${i}" id="bpe-${i}" aria-label="Sextant ${['17–14','13–23','24–27','47–44','43–33','34–37'][i]}">${BPE_OPTS.map(o=>`<option ${v===o?'selected':''} value="${o}">${o||'–'}</option>`).join('')}</select>`).join('')}</div>
    <p class="small muted" style="margin:0">Upper: 17–14 · 13–23 · 24–27 &nbsp;|&nbsp; Lower: 47–44 · 43–33 · 34–37. Codes 0–4, * = furcation, X = edentulous. Code 3 or 4 → full periodontal chart.</p>
    <label class="f" style="max-width:220px"><span>Recorded on</span><input type="date" data-bpedate id="bpe-date" value="${esc(p.bpeDate)}"></label>
  </section>`;
}
function planTab(p){
  const tot=p.plan.reduce((a,i)=>a+(+i.fee||0),0),done=p.plan.filter(i=>i.status==='completed').reduce((a,i)=>a+(+i.fee||0),0);
  const form=view.addItem;
  return `<section class="panel">
    <div class="row"><h2>Treatment plan</h2><span class="spacer"></span><button class="btn small primary" data-act="newItem">+ Add item</button></div>
    <div class="totals"><div><span>Total</span><b>${money(tot)}</b></div><div><span>Completed</span><b>${money(done)}</b></div><div><span>Outstanding</span><b>${money(tot-done)}</b></div></div>
    ${p.plan.some(i=>i.status==='completed'&&i.doneDate===today())?`<div class="row"><button class="btn" data-act="printToday">Print today's record</button><button class="btn" data-act="saveToday">Save today's record (PDF)</button></div>`:''}
    ${form?itemForm(form):''}
    ${p.plan.length?PHASES.map(([n,l])=>{const items=p.plan.filter(i=>+i.phase===n);if(!items.length)return '';
      return `<div class="phase"><h3><span class="pill info">Phase ${n}</span>${l}</h3>${items.map(i=>`<div class="item ${i.status==='completed'?'done':''}">
        <span class="tn">${esc(i.tooth||'—')}</span>
        <span class="pr">${esc(i.proc)}${i.surf?`<small>Surfaces: ${esc(i.surf)}</small>`:''}${i.status==='completed'&&i.doneDate?`<small>Completed ${fmtDate(i.doneDate)}${i.doneBy?' by '+esc(i.doneBy):''}</small>`:''}</span>
        <span class="fee">${money(i.fee)}</span>
        <span class="acts">${i.status==='completed'?`<span class="pill ok">✓ Completed</span><button class="btn small" data-undo="${i.id}">Undo</button>`:`<button class="btn small" data-done="${i.id}">Mark completed</button>`}<span class="spacer"></span><button class="btn small" data-edit="${i.id}">Edit</button><button class="btn small danger" data-del="${i.id}">Remove</button></span>
      </div>`).join('')}</div>`}).join(''):`<div class="empty">No treatment planned yet. Add items here or from the chart.</div>`}
  </section>
  <section class="panel">
    <h3>Patient consent</h3>
    <label class="row small" style="gap:10px"><input type="checkbox" id="consent" ${p.planConsent.agreed?'checked':''} style="width:22px;height:22px"> Plan, options, risks and costs explained; patient agrees to the treatment</label>
    ${p.planConsent.agreed?`<span class="small muted">Agreed on ${fmtDate(p.planConsent.date)}</span>`:''}
  </section>`;
}
function itemForm(f){
  return `<div class="panel" style="background:var(--bg)">
    <h3>${f.id?'Edit item':'New item'}</h3>
    <div class="grid2">
      <label class="f"><span>Tooth (FDI) or area</span><input type="text" id="it-tooth" value="${esc(f.tooth)}" placeholder="e.g. 26, UL, full mouth"></label>
      <label class="f"><span>Surfaces</span><input type="text" id="it-surf" value="${esc(f.surf)}" placeholder="M O D B L"></label>
    </div>
    <label class="f"><span>Treatment</span><select id="it-proc">${PROCS.map(o=>`<option ${f.proc===o?'selected':''}>${o}</option>`).join('')}</select></label>
    <div class="grid2">
      <label class="f"><span>Phase</span><select id="it-phase">${PHASES.map(([n,l])=>`<option value="${n}" ${+f.phase===n?'selected':''}>${n} · ${l}</option>`).join('')}</select></label>
      <label class="f"><span>Fee (Rs)</span><input type="number" inputmode="numeric" id="it-fee" value="${esc(f.fee)}" min="0" step="1"></label>
    </div>
    <div class="row"><button class="btn primary" data-act="saveItem">Save item</button><button class="btn" data-act="cancelItem">Cancel</button></div>
  </div>`;
}
function notesTab(p){
  const ns=[...p.notes].sort((a,b)=>b.date.localeCompare(a.date));
  return `<section class="panel">
    <h2>Print visit record</h2>
    <p class="small muted" style="margin:0">A PDF of the treatment done that day, clinical notes, medical alerts, chart findings and what is still planned, with signature lines. On a phone, choose Print or Save to Files in the share sheet. On a computer, Print opens the PDF and Save PDF downloads it.</p>
    <div class="row"><input type="date" id="pr-date" value="${today()}" style="max-width:180px"><button class="btn primary" data-act="printRecord">Print record</button><button class="btn" data-act="saveRecord">Save PDF</button></div>
  </section>
  <section class="panel">
    <h2>New clinical note</h2>
    <div class="grid2">
      <label class="f"><span>Date</span><input type="date" id="n-date" value="${today()}"></label>
      <label class="f"><span>Visit type</span><select id="n-title">${['Examination','Emergency','Treatment','Hygiene','Review','Phone call','Other'].map(o=>`<option>${o}</option>`).join('')}</select></label>
    </div>
    <label class="f"><span>Note</span><textarea id="n-text" rows="6" placeholder="C/O: \nO/E: \nDx: \nTx: \nNext visit: "></textarea></label>
    <div class="row"><button class="btn small" data-act="template">Insert template</button><span class="spacer"></span><button class="btn primary" data-act="addNote">Save note</button></div>
  </section>
  <section class="panel">
    <h2>Treatment history</h2>
    ${ns.length?`<div class="tl">${ns.map(n=>`<div class="ev"><div class="d">${fmtDate(n.date)} · ${esc(n.title)}${n.by?' · '+esc(n.by):''}</div><div class="t">${esc(n.text)}</div></div>`).join('')}</div>`:'<div class="empty">No notes yet.</div>'}
  </section>`;
}

/* ---------- forms (login, clinic, account) ---------- */
function busy(form,on){form.querySelectorAll('button,input').forEach(el=>el.disabled=on)}
document.addEventListener('submit',async e=>{
  e.preventDefault();const f=e.target;const v=id=>($('#'+id)?$('#'+id).value.trim():'');
  view.msg=null;busy(f,true);
  try{
    if(f.id==='loginForm'){
      view.email=v('li-email');
      if(!v('li-email')||!$('#li-pw').value)throw new Error('Enter your email and password.');
      const {data,error}=await sb.auth.signInWithPassword({email:v('li-email'),password:$('#li-pw').value});if(error)throw error;
      user=data.user;await afterLogin();return;
    }
    if(f.id==='signupForm'){
      if(!v('su-name'))throw new Error('Enter your name.');
      if($('#su-pw').value.length<8)throw new Error('Password must be at least 8 characters.');
      const {data,error}=await sb.auth.signUp({email:v('su-email'),password:$('#su-pw').value,options:{data:{full_name:v('su-name')},emailRedirectTo:location.origin+location.pathname}});
      if(error)throw error;
      if(!data.session){view.email=v('su-email');view.authTab='login';view.msg={t:'ok',m:'Account created. Check your email and tap the confirmation link, then log in.'};render();return}
      user=data.user;await afterLogin();return;
    }
    if(f.id==='newpwForm'){
      if($('#np-pw').value.length<8)throw new Error('Password must be at least 8 characters.');
      const {data,error}=await sb.auth.updateUser({password:$('#np-pw').value});if(error)throw error;
      recovering=false;history.replaceState(null,'',location.pathname);user=data.user;toast('Password saved');await afterLogin();return;
    }
    if(f.id==='createForm'){
      if(!v('cc-name'))throw new Error('Enter the clinic name.');
      const {data,error}=await sb.rpc('create_clinic',{p_name:v('cc-name'),p_address:v('cc-address'),p_phone:v('cc-phone'),p_my_name:v('cc-me')});if(error)throw error;
      let rc=null;if(LOCAL){const r=await sb.rpc('new_recovery_code',{p_clinic:data});rc=r.data}
      await afterLogin(data);if(rc){view.recoveryCode=rc;view.screen='recovery';render()}else toast('Clinic created');return;
    }
    if(f.id==='joinForm'){
      if(!v('jc-code'))throw new Error('Enter the invite code.');
      const {data,error}=await sb.rpc('join_clinic',{p_code:v('jc-code'),p_my_name:v('jc-me')});if(error)throw error;
      toast('You joined the clinic');await afterLogin(data);return;
    }
    if(f.id==='recoverForm'){
      view.email=v('rv-user');view.rvCode=v('rv-code');
      await window.__LOCAL_DB.recover(v('rv-user'),v('rv-code'),$('#rv-pw').value);
      view.email=v('rv-user').toLowerCase();view.rvCode='';view.showRecover=false;view.msg={t:'ok',m:'Password changed. Log in with your new password.'};render();return;
    }
    if(f.id==='addDentistForm'){
      const {error}=await sb.rpc('add_dentist',{p_clinic:clinic.id,p_name:v('ad-name'),p_username:v('ad-user'),p_password:$('#ad-pw').value,p_role:$('#ad-role').value});if(error)throw error;
      await loadTeam();toast(v('ad-name')+' added. Username: '+v('ad-user').toLowerCase());
    }
    if(f.id==='resetPwForm'){
      const {error}=await sb.rpc('admin_reset_password',{p_clinic:clinic.id,p_user:f.dataset.uid,p_password:$('#rp-pw').value});if(error)throw error;
      view.confirm=null;toast('Password changed');
    }
    if(f.id==='apptForm'){
      const d=$('#ap-date').value,t=$('#ap-time').value;if(!d||!t)throw new Error('Choose a date and time.');
      const starts=new Date(d+'T'+t);
      view.apptForm={date:d,time:t,reason:$('#ap-reason').value,dur:$('#ap-dur').value,dentist:$('#ap-dentist').value,note:''};
      if(dirty.has(view.pid))await flush();
      const {error}=await sb.from('appointments').insert({clinic_id:clinic.id,patient_id:view.pid,starts_at:starts.toISOString(),duration:+$('#ap-dur').value,reason:$('#ap-reason').value,note:v('ap-note'),dentist_id:$('#ap-dentist').value||null});
      if(error)throw error;await loadPatientAppts(view.pid);toast('Booked for '+fmtDate(d)+' at '+hhmm(starts));
    }
    if(f.id==='clinicForm'){
      if(!v('cl-name'))throw new Error('Clinic name cannot be empty.');
      const {error}=await sb.from('clinics').update({name:v('cl-name'),address:v('cl-address'),phone:v('cl-phone'),reminder_template:$('#cl-tpl').value.trim()}).eq('id',clinic.id);if(error)throw error;
      await refreshClinic();const m=memberships.find(x=>x.clinic_id===clinic.id);if(m)m.clinics=clinic;toast('Clinic details saved');
    }
    if(f.id==='meForm'){
      const {error}=await sb.rpc('rename_me',{p_clinic:clinic.id,p_name:v('me-name')});if(error)throw error;
      me.name=v('me-name');const m=memberships.find(x=>x.clinic_id===clinic.id);if(m)m.name=me.name;await loadTeam();toast('Name saved');
    }
    if(f.id==='pwForm'){
      if($('#pw-new').value.length<8)throw new Error('Password must be at least 8 characters.');
      const {error}=await sb.auth.updateUser({password:$('#pw-new').value});if(error)throw error;toast('Password changed');
    }
    render();
  }catch(err){view.msg={t:'err',m:friendly(err)};render();}
});

/* ---------- clicks ---------- */
document.addEventListener('click',async e=>{
  const sfEl=e.target.closest('[data-surf]');
  if(sfEl){const p=P(),t=view.tooth,k=sfEl.dataset.surf,mode=view.mode||'caries',mat=view.mat||'comp';
    p.surf[t]=p.surf[t]||{};const cur=p.surf[t][k];
    if(mode==='clear')delete p.surf[t][k];
    else{const nv={t:mode};if(mode==='fill'||mode==='sec')nv.m=mat;
      if(cur&&cur.t===nv.t&&cur.m===nv.m)delete p.surf[t][k];else p.surf[t][k]=nv;}
    if(!Object.keys(p.surf[t]).length)delete p.surf[t];
    save();render();return}
  const b=e.target.closest('button');if(!b)return;
  const p=P(),d=b.dataset;
  if(d.home){view=Object.assign(view,{screen:d.home,pid:null,confirm:null,msg:null});if(d.home==='appts'){view.day=view.day||today();apptsDay=[];render();refreshAppts();}else render();return}
  if(d.day){view.day=d.day;view.confirm=null;render();refreshAppts();return}
  if(d.sms){sendReminder(d.sms,'sms');return}
  if(d.wa){sendReminder(d.wa,'wa');return}
  if(d.ast){const {error}=await sb.from('appointments').update({status:d.ast}).eq('id',d.aid);if(error){toast(friendly(error));return}[apptsDay,apptsPatient].forEach(l=>{const x=l.find(y=>y.id===d.aid);if(x)x.status=d.ast});render();return}
  if(d.xr){xrView=d.xr;view.xrf={b:100,c:100,inv:false,zoom:false};view.confirm=null;view.xrBlob=null;render();
    const x0=xrays.find(y=>y.id===d.xr);if(x0)sb.storage.from('xrays').download(x0.path).then(r=>{if(xrView===d.xr&&r.data)view.xrBlob=r.data});return}
  if(d.askpw){view.confirm='pw:'+d.askpw;render();const i=$('#rp-pw');if(i)i.focus();return}
  if(d.askadel){view.confirm='adel:'+d.askadel;render();return}
  if(d.adel){const {error}=await sb.from('appointments').delete().eq('id',d.adel);if(error){toast(friendly(error));return}apptsDay=apptsDay.filter(a=>a.id!==d.adel);apptsPatient=apptsPatient.filter(a=>a.id!==d.adel);view.confirm=null;render();toast('Appointment deleted');return}
  if(d.authtab){view.authTab=d.authtab;view.msg=null;render();return}
  if(d.open){xrView=null;if(view.screen==='appts')view.backTo='appts';else view.backTo='list';view=Object.assign(view,{screen:'patient',pid:d.open,tab:'details',tooth:null,confirm:null,addItem:null,msg:null});render();scrollTo(0,0);return}
  if(d.tab){view.tab=d.tab;view.tooth=null;view.addItem=null;view.confirm=null;if(d.tab==='appts'){apptsPatient=[];apptsLoading=true;render();refreshAppts();}else if(d.tab==='xrays'){xrays=[];xrView=null;render();refreshXrays();}else render();return}
  if(d.mh){p.mh.answers[d.mh]=Object.assign(p.mh.answers[d.mh]||{},{v:d.v});save();render();return}
  if(d.tooth){view.tooth=+d.tooth===view.tooth?null:+d.tooth;view.confirm=null;render();const ed=$('#editor');if(ed)ed.scrollIntoView({block:'nearest'});return}
  if(d.mode){view.mode=d.mode;render();return}
  if(d.mat){view.mat=d.mat;if(view.mode!=='sec')view.mode='fill';render();return}
  if(d.setst!==undefined){if(d.setst)p.chart[view.tooth]=d.setst;else delete p.chart[view.tooth];save();render();return}
  if(d.done){const i=p.plan.find(x=>x.id===d.done);i.status='completed';i.doneDate=today();i.doneBy=me.name;
    p.notes.push({id:uid(),date:today(),title:'Treatment',by:me.name,text:`Completed: ${i.proc}${i.tooth?' – tooth '+i.tooth:''}${i.surf?' ('+i.surf+')':''}`});save();render();toast('Completed – you can print today\'s record now');return}
  if(d.undo){const i=p.plan.find(x=>x.id===d.undo);i.status='planned';delete i.doneDate;delete i.doneBy;save();render();return}
  if(d.edit){view.addItem=Object.assign({},p.plan.find(x=>x.id===d.edit));render();return}
  if(d.del){p.plan=p.plan.filter(x=>x.id!==d.del);save();render();toast('Item removed');return}
  if(d.role){const {error}=await sb.rpc('set_member_role',{p_clinic:clinic.id,p_user:d.uid,p_role:d.role});if(error){toast(friendly(error));return}await loadTeam();render();toast('Role changed');return}
  if(d.askrm){view.confirm='rm:'+d.askrm;render();return}
  if(d.rm){const {error}=await sb.from('members').delete().eq('clinic_id',clinic.id).eq('user_id',d.rm);if(error){toast(friendly(error));return}view.confirm=null;await loadTeam();render();toast('Removed from the clinic');return}
  switch(d.act){
    case 'reload':location.reload();break;
    case 'showRecover':view.email=$('#li-email')?$('#li-email').value:'';view.showRecover=!view.showRecover;view.msg=null;render();break;
    case 'rcDone':if(!$('#rc-ok').checked){toast('Tick the box once you have saved the code');break;}view.recoveryCode=null;clinic.has_recovery=true;view.screen='list';render();toast('Clinic created');break;
    case 'askRecovery':view.confirm='newrc';render();break;
    case 'makeRecovery':{const {data,error}=await sb.rpc('new_recovery_code',{p_clinic:clinic.id});if(error){toast(friendly(error));break;}
      view.newRecovery=data;view.confirm=null;clinic.has_recovery=true;const m=memberships.find(x=>x.clinic_id===clinic.id);if(m)m.clinics.has_recovery=true;render();break;}
    case 'showUsers':view.email=$('#li-email')?$('#li-email').value:'';view.showUsers=!view.showUsers;render();break;
    case 'fullBackup':{view.backupBusy=true;render();try{const data=await window.__LOCAL_DB.exportAll();view.backupBlob=new Blob([JSON.stringify(data)],{type:'application/json'});}catch(err){toast('Could not prepare the backup')}view.backupBusy=false;render();break;}
    case 'shareBackup':{const bl=view.backupBlob;if(!bl)break;deliverFile(bl,('Full_Backup_'+clinic.name+'_'+today()+'.json').replace(/[^\w.\-]+/g,'_'),'save').then(ok=>{if(ok){lsSet('lastFullBackup',String(Date.now()));view.backupBlob=null;toast('Backup saved – keep it in iCloud Drive or Google Drive');render()}},()=>toast('Could not save the backup'));break;}
    case 'doRestore':{try{await window.__LOCAL_DB.importAll(view.restoreData);toast('Backup restored');setTimeout(()=>location.reload(),600)}catch(err){toast(friendly(err))}break;}
    case 'xrClose':xrView=null;view.confirm=null;render();break;
    case 'xrInv':view.xrf.inv=!view.xrf.inv;render();break;
    case 'xrZoom':view.xrf.zoom=!view.xrf.zoom;render();break;
    case 'xrAskDel':view.confirm='xrdel';render();break;
    case 'xrDelete':{const x=xrays.find(y=>y.id===xrView);if(!x)break;
      const r1=await sb.from('xrays').delete().eq('id',x.id);if(r1.error){toast(friendly(r1.error));break;}
      await sb.storage.from('xrays').remove([x.path]);xrays=xrays.filter(y=>y.id!==x.id);xrView=null;view.confirm=null;render();toast('X-ray deleted');break;}
    case 'xrSave':{const x=xrays.find(y=>y.id===xrView);if(!x)break;
      const data=view.xrBlob;if(!data){toast('Still loading the image – try again in a moment');break;}
      const pp=P();const fn=((pp?pp.last+'_'+pp.first+'_':'')+x.kind+'_'+x.taken_on+'.'+(x.path.split('.').pop())).replace(/[^\w.\-]+/g,'_');
      deliverFile(data,fn,'save').then(ok=>{if(ok)toast('X-ray ready to save')},()=>toast('Could not share the file'));break;}
    case 'logout':if(dirty.size)await flush();await sb.auth.signOut();break;
    case 'forgot':{const em=$('#li-email')?$('#li-email').value.trim():'';if(!em){view.msg={t:'err',m:'Type your email above first, then tap “Forgot password?”.'};render();break;}
      const {error}=await sb.auth.resetPasswordForEmail(em,{redirectTo:location.origin+location.pathname});
      view.msg=error?{t:'err',m:friendly(error)}:{t:'ok',m:'If that email has an account, a reset link is on its way. Open it on this device.'};render();break;}
    case 'back':if(view.screen==='patient'&&view.backTo==='appts'){view=Object.assign(view,{screen:'appts',pid:null,confirm:null});render();refreshAppts();break;}
      view=Object.assign(view,{screen:memberships.length?'list':'onboard',pid:null,tab:'details',tooth:null,confirm:null,addItem:null,msg:null});render();break;
    case 'settings':view.newRecovery=null;view.screen='settings';view.confirm=null;view.msg=null;render();loadTeam().then(()=>{if(view.screen==='settings')softRender()});break;
    case 'onboard':view.screen='onboard';view.msg=null;render();break;
    case 'newPatient':{const np=blankPatient();db.patients.push(np);markDirty(np.id);view=Object.assign(view,{screen:'patient',pid:np.id,tab:'details',tooth:null,q:'',confirm:null});render();const f=$('#f-first');if(f){f.focus();f.select()}break;}
    case 'example':{const np=sample();np.notes[0].by=me.name;db.patients.push(np);markDirty(np.id);render();toast('Example patient added');break;}
    case 'askDelete':view.confirm='delete';render();break;
    case 'cancelConfirm':view.confirm=null;render();break;
    case 'deletePatient':{const id=p.id;dirty.delete(id);
      try{const {data:xs}=await sb.from('xrays').select('path').eq('patient_id',id);if(xs&&xs.length)await sb.storage.from('xrays').remove(xs.map(x=>x.path));}catch(err){}const {error}=await sb.from('patients').delete().eq('id',id);if(error){toast(friendly(error));break;}
      db.patients=db.patients.filter(x=>x.id!==id);view=Object.assign(view,{screen:'list',pid:null,confirm:null});render();toast('Patient deleted');break;}
    case 'mhDate':p.mh.date=today();save();render();toast('Medical history reviewed today');break;
    case 'closeTooth':view.tooth=null;render();break;
    case 'addToPlan':{const t=view.tooth,sf=p.surf[t]||{},ks=Object.keys(sf).filter(k=>['caries','sec','defect'].includes(sf[k].t));
      const sec=Object.values(sf).find(v=>v.t==='sec'),st=p.chart[t]||'';
      let proc=(MT[(sec&&sec.m)||view.mat||'comp']||MT.comp).proc,phase=3;
      if(st==='ext'){proc='Extraction';phase=1}else if(st==='missing'){proc='Implant placement';phase=4}else if(st==='frac'&&!ks.length){proc='Crown – zirconia';phase=4}
      view.tab='plan';view.addItem={tooth:String(t),surf:(st==='ext'||st==='missing')?'':surfStr(t,ks),proc,phase,fee:''};view.tooth=null;render();scrollTo(0,0);break;}
    case 'askClearTooth':view.confirm='clearTooth';render();break;
    case 'clearTooth':{const t=view.tooth;delete p.chart[t];delete p.surf[t];delete p.rct[t];delete p.toothNotes[t];view.confirm=null;save();render();toast('Tooth '+t+' cleared');break;}
    case 'printRecord':printRecord(p,$('#pr-date').value||today(),'print');break;
    case 'saveRecord':printRecord(p,$('#pr-date').value||today(),'save');break;
    case 'printToday':printRecord(p,today(),'print');break;
    case 'saveToday':printRecord(p,today(),'save');break;
    case 'newItem':view.addItem={tooth:'',surf:'',proc:PROCS[0],phase:3,fee:''};render();break;
    case 'cancelItem':view.addItem=null;render();break;
    case 'saveItem':{const f=view.addItem,it={id:f.id||uid(),tooth:$('#it-tooth').value.trim(),surf:$('#it-surf').value.trim().toUpperCase(),proc:$('#it-proc').value,phase:+$('#it-phase').value,fee:parseFloat($('#it-fee').value)||0,status:f.status||'planned'};
      if(f.doneDate){it.doneDate=f.doneDate;it.doneBy=f.doneBy}
      const ix=p.plan.findIndex(x=>x.id===it.id);if(ix>=0)p.plan[ix]=it;else p.plan.push(it);view.addItem=null;save();render();toast('Item saved');break;}
    case 'template':$('#n-text').value='C/O: \nMH: reviewed, no changes\nO/E: \nRadiographs: \nDx: \nTx: \nLA: \nPost-op advice given\nNext visit: ';break;
    case 'addNote':{const t=$('#n-text').value.trim();if(!t){toast('Write the note first');break;}
      p.notes.push({id:uid(),date:$('#n-date').value||today(),title:$('#n-title').value,by:me.name,text:t});save();render();toast('Note saved');break;}
    case 'copyCode':{const c=clinic.invite_code;
      const sel=()=>{const r=document.createRange();r.selectNodeContents($('#invite'));const s=getSelection();s.removeAllRanges();s.addRange(r);toast('Code selected – copy it')};
      try{navigator.clipboard.writeText(c).then(()=>toast('Invite code copied'),sel)}catch(err){sel()}break;}
    case 'askNewCode':view.confirm='newcode';render();break;
    case 'newCode':{const {data,error}=await sb.rpc('new_invite_code',{p_clinic:clinic.id});if(error){toast(friendly(error));break;}clinic.invite_code=data;view.confirm=null;render();toast('New invite code made');break;}
    case 'askLeave':view.confirm='leave';render();break;
    case 'leave':{if(isAdmin()&&team.filter(t=>t.role==='admin').length<=1){view.confirm=null;view.msg={t:'err',m:'Make another dentist admin before you leave, so the clinic keeps an admin.'};render();break;}
      if(dirty.size)await flush();const {error}=await sb.from('members').delete().eq('clinic_id',clinic.id).eq('user_id',user.id);if(error){toast(friendly(error));break;}
      lsSet('clinicId','');if(chan)sb.removeChannel(chan);chan=null;clinic=null;await afterLogin();break;}
    case 'exportBackup':{const blob=new Blob([JSON.stringify({app:'clinic-patient-records',clinic:clinic.name,exported:new Date().toISOString(),patients:db.patients.map(x=>Object.assign(strip(x),{id:x.id}))},null,1)],{type:'application/json'});
      deliverFile(blob,('Backup_'+clinic.name+'_'+today()+'.json').replace(/[^\w.\-]+/g,'_'),'save').then(ok=>{if(ok)toast('Backup saved')},()=>toast('Could not save the backup'));break;}
    case 'importLocal':{try{const d=JSON.parse(lsGet('clinicRecords.v1')||'{}');const list=(d.patients||[]).filter(x=>!x.example);await importPatients(list);}catch(err){toast('Could not read the old records')}break;}
  }
});
async function importPatients(list){
  if(!list.length){toast('No patients found to import');return}
  const have=new Set(db.patients.map(x=>x.id));
  const rows=list.map(x=>{const pt=migrate(Object.assign({},x));if(!isUUID(pt.id)||have.has(pt.id))pt.id=uuid();delete pt._upd;delete pt._by;return pt});
  rows.forEach(pt=>{db.patients.push(pt);dirty.add(pt.id)});setSync('saving');await flush();render();
  toast(rows.length+' patient'+(rows.length>1?'s':'')+' imported');
}
document.addEventListener('change',async e=>{
  const el=e.target;
  if(el.id==='restoreFile'&&el.files&&el.files[0]){try{const d=JSON.parse(await el.files[0].text());if(!d||d.app!=='clinic-records-local'||!d.tables)throw 0;
    view.restoreData=d;view.restoreInfo=(d.clinics||[]).join(', ')+' from '+fmtDate(String(d.exported||'').slice(0,10));view.confirm='restore';render();}catch(err){toast('That file is not a full backup from this app')}el.value='';return}
  if(el.id==='xr-file'&&el.files&&el.files.length){view.xrKind=$('#xr-kind').value;await uploadXrays([...el.files]);return}
  if(el.id==='dayPick'&&el.value){view.day=el.value;render();refreshAppts();return}
  if(el.id==='switchClinic'){const m=memberships.find(x=>x.clinic_id===el.value);if(m)await openClinic(m);return}
  if(el.id==='importFile'&&el.files&&el.files[0]){try{const d=JSON.parse(await el.files[0].text());const list=Array.isArray(d)?d:(d.patients||[]);await importPatients(list);}catch(err){toast('That file is not a valid backup')}el.value='';return}
  if(el.dataset.f||el.dataset.mhf==='signed'||el.dataset.bpe!==undefined)render();
});
document.addEventListener('input',e=>{
  const el=e.target;
  if((el.id==='xr-b'||el.id==='xr-c')&&view.xrf){view.xrf[el.id==='xr-b'?'b':'c']=+el.value;const im=document.querySelector('.ximg img');if(im)im.style.filter=`brightness(${view.xrf.b}%) contrast(${view.xrf.c}%)${view.xrf.inv?' invert(1)':''}`;return}
  if(el.id==='search'){view.q=el.value;const pos=el.selectionStart;render();const s=$('#search');s.focus();s.setSelectionRange(pos,pos);return}
  const p=P();if(!p||view.screen!=='patient')return;
  if(el.dataset.f){p[el.dataset.f]=el.value;delete p.example;save();return}
  if(el.dataset.mhd){p.mh.answers[el.dataset.mhd].d=el.value;save();return}
  if(el.dataset.mhf){p.mh[el.dataset.mhf]=el.type==='checkbox'?el.checked:el.value;save();return}
  if(el.dataset.rct){if(el.checked)p.rct[el.dataset.rct]=true;else delete p.rct[el.dataset.rct];save();render();return}
  if(el.dataset.tnote){p.toothNotes[el.dataset.tnote]=el.value;save();return}
  if(el.dataset.bpe!==undefined){p.bpe[+el.dataset.bpe]=el.value;if(!p.bpeDate)p.bpeDate=today();save();return}
  if(el.hasAttribute('data-bpedate')){p.bpeDate=el.value;save();return}
  if(el.id==='consent'){p.planConsent={agreed:el.checked,date:el.checked?today():''};save();render();return}
});
document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches&&e.target.matches('[data-surf]')){e.preventDefault();e.target.dispatchEvent(new MouseEvent('click',{bubbles:true}))}});

render();
boot().catch(e=>{view.screen='error';view.msg={t:'err',m:friendly(e)};render()});
})();
