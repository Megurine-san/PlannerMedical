const APPT_STORE="masVidaAppointments";
const PATIENT_STORE="masVidaPatients";

const PIN_HASH_STORE="masVidaPinHash";
const PIN_SALT_STORE="masVidaPinSalt";
const SESSION_UNLOCKED="masVidaUnlocked";
let sessionPin="";

function bytesToB64(bytes){
  let binary="";
  bytes.forEach(b=>binary+=String.fromCharCode(b));
  return btoa(binary);
}
function b64ToBytes(b64){
  const binary=atob(b64);
  return Uint8Array.from(binary,c=>c.charCodeAt(0));
}
function randomBytes(n){
  const b=new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}
async function derivePinHash(pin,salt){
  const material=await crypto.subtle.importKey("raw",new TextEncoder().encode(pin),"PBKDF2",false,["deriveBits"]);
  const bits=await crypto.subtle.deriveBits(
    {name:"PBKDF2",salt,iterations:150000,hash:"SHA-256"},
    material,256
  );
  return new Uint8Array(bits);
}
async function deriveAesKey(pin,salt){
  const material=await crypto.subtle.importKey("raw",new TextEncoder().encode(pin),"PBKDF2",false,["deriveKey"]);
  return crypto.subtle.deriveKey(
    {name:"PBKDF2",salt,iterations:200000,hash:"SHA-256"},
    material,
    {name:"AES-GCM",length:256},
    false,["encrypt","decrypt"]
  );
}
async function hasPin(){
  return !!localStorage.getItem(PIN_HASH_STORE);
}
async function verifyPin(pin){
  const savedHash=localStorage.getItem(PIN_HASH_STORE);
  const savedSalt=localStorage.getItem(PIN_SALT_STORE);
  if(!savedHash||!savedSalt)return false;
  const hash=await derivePinHash(pin,b64ToBytes(savedSalt));
  return bytesToB64(hash)===savedHash;
}
async function saveNewPin(pin){
  const salt=randomBytes(16);
  const hash=await derivePinHash(pin,salt);
  localStorage.setItem(PIN_SALT_STORE,bytesToB64(salt));
  localStorage.setItem(PIN_HASH_STORE,bytesToB64(hash));
  sessionPin=pin;
  sessionStorage.setItem(SESSION_UNLOCKED,"1");
}
function showLock(){
  $("lockOverlay").classList.remove("hidden");
  $("unlockPin").value="";
  $("unlockError").textContent="";
  setTimeout(()=>$("unlockPin").focus(),50);
}
function hideLock(){
  $("lockOverlay").classList.add("hidden");
}
async function initializeSecurity(){
  if(await hasPin()){
    if(sessionStorage.getItem(SESSION_UNLOCKED)==="1"){
      hideLock();
    }else{
      showLock();
    }
  }else{
    // First use: force creating a PIN before normal use.
    $("pinModalTitle").textContent="Crear clave de acceso";
    $("pinOverlay").classList.remove("hidden");
  }
}

let appointments=JSON.parse(localStorage.getItem(APPT_STORE)||"[]");
let patients=JSON.parse(localStorage.getItem(PATIENT_STORE)||"[]");
let selectedDate=new Date();
let activeFilter=null;

const $=id=>document.getElementById(id);
const colors={consulta:"#d9a81d",cirugia:"#a85bc0",control:"#6fc56f"};
const sourceColors={Facebook:"#4d95c7",TikTok:"#9f57b8",Referido:"#63b458",Google:"#b9a84d",Otro:"#b7745f"};
const sourceOrder=["Facebook","TikTok","Referido","Google","Otro"];

function dateKey(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`}
function formatDate(d,opts={weekday:"long",day:"numeric",month:"long",year:"numeric"}){return new Intl.DateTimeFormat("es-PE",opts).format(d)}
function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
function save(){localStorage.setItem(APPT_STORE,JSON.stringify(appointments));localStorage.setItem(PATIENT_STORE,JSON.stringify(patients))}
function label(t){return t==="cirugia"?"CIRUGÍA":t==="control"?"CONTROL":"CONSULTA"}
function money(n){return Number(n||0).toFixed(2)}

function normalizePatients(){
  const map=new Map(patients.map(p=>[(p.dni||p.name.toLowerCase()),p]));
  appointments.forEach(a=>{
    const k=a.dni||a.name.toLowerCase();
    if(!map.has(k)){
      const p={id:crypto.randomUUID(),name:a.name,age:a.age,dni:a.dni,phone:a.phone};
      map.set(k,p);patients.push(p);
    }
  });
  save();
}
normalizePatients();

function upsertPatientFromForm(){
  const name=$("name").value.trim(),dni=$("dni").value.trim(),phone=$("phone").value.trim(),age=$("age").value;
  if(!name)return null;
  let p=patients.find(x=>(dni&&x.dni===dni)||x.name.toLowerCase()===name.toLowerCase());
  if(!p){p={id:crypto.randomUUID(),name,age,dni,phone};patients.push(p)}
  else{p.name=name;p.age=age;p.dni=dni;p.phone=phone}
  return p;
}

function refreshPatientDatalist(){
  $("patientDatalist").innerHTML=patients.map(p=>`<option value="${esc(p.name)} — ${esc(p.dni||"sin DNI")}"></option>`).join("");
}
function loadPatientFromLookup(showAlert=true){
  const val=$("patientLookup").value.trim().toLowerCase();
  if(!val)return false;

  let p=patients.find(x=>{
    const name=(x.name||"").toLowerCase();
    const dni=(x.dni||"").toLowerCase();
    return val===`${name} — ${dni}` || val.includes(name) || (dni && val.includes(dni));
  });

  if(!p){
    if(showAlert) alert("No se encontró ese paciente.");
    return false;
  }

  // Autocompleta todos los datos personales guardados.
  $("name").value=p.name||"";
  $("age").value=p.age||"";
  $("dni").value=p.dni||"";
  $("phone").value=p.phone||"";

  // Conserva la selección visible para que sea claro qué paciente se cargó.
  $("patientLookup").value=`${p.name} — ${p.dni||"sin DNI"}`;
  return true;
}
function clearPatientFields(){
  $("patientLookup").value="";$("name").value="";$("age").value="";$("dni").value="";$("phone").value="";
}

function renderWeek(){
  const wrap=$("weekStrip");wrap.innerHTML="";
  const prev=document.createElement("button");prev.className="week-arrow";prev.textContent="‹";prev.onclick=()=>{selectedDate.setDate(selectedDate.getDate()-7);render()};wrap.appendChild(prev);
  const start=new Date(selectedDate);start.setDate(start.getDate()-3);
  for(let i=0;i<7;i++){
    const d=new Date(start);d.setDate(start.getDate()+i);const k=dateKey(d);const dayAppointments=appointments.filter(a=>a.date===k);
    const btn=document.createElement("button");btn.className="week-day"+(k===dateKey(selectedDate)?" selected":"");
    const dots=[...new Set(dayAppointments.map(a=>a.type))].map(t=>`<i class="day-dot" style="background:${colors[t]}"></i>`).join("");
    btn.innerHTML=`<span class="dow">${new Intl.DateTimeFormat("es-PE",{weekday:"short"}).format(d)}</span><span class="num">${d.getDate()}</span><span class="day-dots">${dots}</span>`;
    btn.onclick=()=>{selectedDate=d;activeFilter=null;render()};wrap.appendChild(btn);
  }
  const next=document.createElement("button");next.className="week-arrow";next.textContent="›";next.onclick=()=>{selectedDate.setDate(selectedDate.getDate()+7);render()};wrap.appendChild(next);
}

function render(){
  $("headerDate").textContent=formatDate(selectedDate).replace(/^./,c=>c.toUpperCase());
  $("selectedDateTitle").textContent=formatDate(selectedDate).replace(/^./,c=>c.toUpperCase());
  renderWeek();refreshPatientDatalist();

  const allToday=appointments.filter(a=>a.date===dateKey(selectedDate)).sort((a,b)=>a.time.localeCompare(b.time));
  const list=activeFilter?allToday.filter(a=>a.type===activeFilter):allToday;
  $("consultCount").textContent=allToday.filter(a=>a.type==="consulta").length;
  $("surgeryCount").textContent=allToday.filter(a=>a.type==="cirugia").length;
  $("controlCount").textContent=allToday.filter(a=>a.type==="control").length;

  renderTimeline(list);renderUpcoming();renderSources();renderPatients();renderAllSurgeries();renderAllControls();renderStats();
}

function paymentText(a){
  if(a.type==="cirugia"){
    const total=Number(a.surgeryAmount||0),paid=Number(a.surgeryPaid||0),balance=Math.max(0,total-paid);
    const status=balance<=0&&total>0?"Pagado completo":paid>0?"A cuenta":"Pendiente";
    return {pill:status,detail:`S/ ${money(paid)} pagado de S/ ${money(total)} · saldo S/ ${money(balance)}`,balance};
  }
  return {pill:a.simplePaymentStatus==="no_pagada"?"No pagada":"Pagada",detail:"",balance:0};
}

function renderTimeline(list){
  if(!list.length){$("timeline").innerHTML=`<div class="empty">${activeFilter?"No hay actividades de este tipo para este día.":"No hay actividades programadas para este día."}</div>`;return}
  $("timeline").innerHTML=list.map(a=>{
    const pay=paymentText(a);
    let extra="";
    if(a.type==="cirugia"){
      extra=`<div class="surgery-team"><b>EQUIPO QUIRÚRGICO</b><br>👤 Cirujano 1: ${esc(a.surgeon1||"—")}<br>👤 Cirujano 2: ${esc(a.surgeon2||"—")}<br>👤 Anestesiólogo: ${esc(a.anesthesiologist||"—")}<br>👤 Instrumentista: ${esc(a.instrumentist||"—")}<div class="surgery-payment ${pay.balance>0?"balance-due":"paid-full"}">${esc(pay.detail)}</div></div>`;
    } else if(a.type==="control"){
      extra=`<div class="postop-info"><strong>${a.postOpDays!==""?esc(a.postOpDays)+" días post cirugía":"Control postoperatorio"}</strong><span>${esc(a.controlReason||"Control")}</span></div>`;
    }
    const origin=a.source&&a.source!=="No especificado"?`<span class="origin-pill">Origen: ${esc(a.source)}</span>`:"";
    const surgeryName=a.type==="cirugia"&&a.surgeryName?` · ${esc(a.surgeryName)}`:"";
    const payBtn=a.type==="cirugia"&&pay.balance>0?`<button class="pay-btn" onclick="openPayment('${a.id}')">Agregar pago</button>`:"";
    return `<div class="appointment-row">
      <div class="time-box"><span class="time-main">${esc(a.time)}</span><span class="ampm">${parseInt(a.time,10)<12?"AM":"PM"}</span></div>
      <article class="appt-card ${a.type}">
        <div>
          <span class="type-pill">${label(a.type)}${surgeryName}</span>${origin}<span class="payment-pill">${esc(pay.pill)}</span>
          <div class="patient-line"><strong>${esc(a.name)}</strong><span class="patient-age">${a.age?esc(a.age)+" años":""}</span></div>
          <div class="patient-meta"><span>▣ DNI: ${esc(a.dni||"—")}</span><span>☎ ${esc(a.phone||"—")}</span></div>
        </div>
        ${extra}
        <div class="actions">${payBtn}<button class="edit-btn" onclick="editAppointment('${a.id}')">Editar</button><button class="more-btn" onclick="editAppointment('${a.id}')">•••</button></div>
      </article>
    </div>`;
  }).join("");
}

function renderUpcoming(){
  const today=dateKey(new Date());
  const list=appointments.filter(a=>a.type==="cirugia"&&a.date>=today).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time)).slice(0,3);
  $("upcomingSurgeries").innerHTML=list.length?list.map(a=>`<div class="upcoming-item"><span class="dot" style="background:${colors.cirugia}"></span><span class="upcoming-date">${formatDate(new Date(a.date+"T12:00:00"),{day:"2-digit",month:"short"}).toUpperCase()} · ${esc(a.time)}</span><span class="upcoming-procedure">${esc(a.surgeryName||"Cirugía")}</span><span class="upcoming-name">${esc(a.name)}</span></div>`).join(""):`<div class="upcoming-item" style="color:var(--muted)">No hay cirugías próximas.</div>`;
}

function sourceCounts(){const c={Facebook:0,TikTok:0,Referido:0,Google:0,Otro:0};appointments.forEach(a=>{if(c[a.source]!==undefined)c[a.source]++});return c}
function renderSources(){
  const c=sourceCounts(),total=Object.values(c).reduce((x,y)=>x+y,0);let angle=0,parts=[];
  sourceOrder.forEach(s=>{const p=total?c[s]/total*100:0;parts.push(`${sourceColors[s]} ${angle}% ${angle+p}%`);angle+=p});
  $("sourceDonut").style.background=total?`conic-gradient(${parts.join(",")})`:`conic-gradient(#294d49 0 100%)`;
  $("sourceLegend").innerHTML=sourceOrder.map(s=>`<div class="source-line"><i style="background:${sourceColors[s]}"></i>${s} <b>${total?Math.round(c[s]/total*100):0}%</b></div>`).join("");
}

function patientHistory(p){
  return appointments.filter(a=>(p.dni&&a.dni===p.dni)||a.name.toLowerCase()===p.name.toLowerCase()).sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time));
}
function renderPatients(q=""){
  const query=(q||$("patientSearch")?.value||"").toLowerCase().trim();
  const list=patients.filter(p=>!query||[p.name,p.dni,p.phone].join(" ").toLowerCase().includes(query));
  $("patientResults").innerHTML=list.length?list.map(p=>{
    const h=patientHistory(p).slice(0,5);
    return `<div class="result-card"><h3>${esc(p.name)}</h3><p>${p.age?esc(p.age)+" años · ":""}DNI ${esc(p.dni||"—")} · ${esc(p.phone||"—")}</p><div class="mini-history"><b>Historial reciente</b>${h.length?h.map(a=>`<p>${esc(a.date)} · ${esc(a.time)} · ${label(a.type)}${a.surgeryName?" · "+esc(a.surgeryName):""}</p>`).join(""):"<p>Sin actividades previas.</p>"}</div></div>`;
  }).join(""):`<div class="empty">No se encontraron pacientes.</div>`;
}
function renderAllSurgeries(){
  const list=appointments.filter(a=>a.type==="cirugia").sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
  $("allSurgeries").innerHTML=list.length?list.map(a=>{const p=paymentText(a);return `<div class="result-card"><h3 style="color:#c674d8">${esc(a.surgeryName||"Cirugía")} — ${esc(a.name)}</h3><p>${esc(a.date)} · ${esc(a.time)} · Origen: ${esc(a.source||"—")}</p><p>${esc(p.detail)}</p>${p.balance>0?`<button class="pay-btn" onclick="openPayment('${a.id}')">Agregar pago</button>`:""}</div>`}).join(""):`<div class="empty">No hay cirugías registradas.</div>`;
}
function renderAllControls(){
  const list=appointments.filter(a=>a.type==="control").sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
  $("allControls").innerHTML=list.length?list.map(a=>`<div class="result-card"><h3 style="color:#88d17f">${esc(a.name)}</h3><p>${esc(a.date)} · ${esc(a.time)} · ${a.postOpDays?esc(a.postOpDays)+" días post cirugía":""}</p><p>${esc(a.controlReason||"Control")} · ${a.simplePaymentStatus==="no_pagada"?"No pagada":"Pagada"}</p></div>`).join(""):`<div class="empty">No hay controles registrados.</div>`;
}
function renderStats(){
  const c=sourceCounts(),total=appointments.length;
  $("statsGrid").innerHTML=`<div class="stat-card"><span>Pacientes guardados</span><strong>${patients.length}</strong></div><div class="stat-card"><span>Actividades</span><strong>${total}</strong></div>`+sourceOrder.map(s=>`<div class="stat-card"><span style="color:${sourceColors[s]}">${s}</span><strong>${c[s]}</strong><small>${total?Math.round(c[s]/total*100):0}% del total</small></div>`).join("");
}

function updateFields(){
  const t=$("type").value;
  $("surgeryFields").classList.toggle("hidden",t!=="cirugia");
  $("controlFields").classList.toggle("hidden",t!=="control");
  $("consultControlPaymentFields").classList.toggle("hidden",t==="cirugia");
  updatePaymentSummary();
}
function updatePaymentSummary(){
  if($("type").value!=="cirugia")return;
  const total=Number($("surgeryAmount").value||0),paid=Number($("surgeryPaid").value||0),balance=Math.max(0,total-paid);
  $("paymentSummary").textContent=`Pagado: S/ ${money(paid)} · Saldo: S/ ${money(balance)}`;
  if(total>0&&balance<=0)$("surgeryPaymentStatus").value="pagado_completo";
  else if(paid>0)$("surgeryPaymentStatus").value="a_cuenta";
  else $("surgeryPaymentStatus").value="pendiente";
}

function openNew(){
  $("modalTitle").textContent="Nueva actividad";$("appointmentForm").reset();$("editId").value="";$("formDate").value=dateKey(selectedDate);$("source").value="Facebook";$("simplePaymentStatus").value="pagada";$("deleteBtn").classList.add("hidden");$("patientLookup").value="";updateFields();$("modal").classList.remove("hidden");
}
function editAppointment(id){
  const a=appointments.find(x=>x.id===id);if(!a)return;
  $("modalTitle").textContent="Editar actividad";$("editId").value=a.id;$("formDate").value=a.date;$("time").value=a.time;$("type").value=a.type;$("source").value=a.source||"No especificado";$("name").value=a.name;$("age").value=a.age;$("dni").value=a.dni;$("phone").value=a.phone;$("simplePaymentStatus").value=a.simplePaymentStatus||"pagada";$("surgeryName").value=a.surgeryName||"";$("surgeryAmount").value=a.surgeryAmount||"";$("surgeryPaid").value=a.surgeryPaid||"";$("surgeryPaymentStatus").value=a.surgeryPaymentStatus||"pendiente";$("surgeon1").value=a.surgeon1||"";$("surgeon2").value=a.surgeon2||"";$("anesthesiologist").value=a.anesthesiologist||"";$("instrumentist").value=a.instrumentist||"";$("postOpDays").value=a.postOpDays||"";$("controlReason").value=a.controlReason||"Control";$("notes").value=a.notes||"";$("patientLookup").value="";$("deleteBtn").classList.remove("hidden");updateFields();$("modal").classList.remove("hidden");
}
function openPayment(id){
  const a=appointments.find(x=>x.id===id);if(!a)return;
  $("paymentAppointmentId").value=id;$("paymentAddAmount").value="";$("paymentOverlay").classList.remove("hidden");
}
$("addPaymentConfirm").onclick=()=>{
  const id=$("paymentAppointmentId").value,amount=Number($("paymentAddAmount").value||0);if(amount<=0)return;
  const a=appointments.find(x=>x.id===id);if(!a)return;
  const total=Number(a.surgeryAmount||0);a.surgeryPaid=Number(a.surgeryPaid||0)+amount;if(a.surgeryPaid>total&&total>0)a.surgeryPaid=total;
  a.surgeryPaymentStatus=total>0&&a.surgeryPaid>=total?"pagado_completo":a.surgeryPaid>0?"a_cuenta":"pendiente";
  save();$("paymentOverlay").classList.add("hidden");render();
};

$("addBtn").onclick=openNew;$("closeModal").onclick=()=>$("modal").classList.add("hidden");$("type").onchange=updateFields;$("surgeryAmount").oninput=updatePaymentSummary;$("surgeryPaid").oninput=updatePaymentSummary;$("todayBtn").onclick=()=>{selectedDate=new Date();activeFilter=null;render()};$("seeAllSurgeries").onclick=()=>switchView("cirugias");document.querySelectorAll(".summary-card").forEach(b=>b.onclick=()=>{activeFilter=activeFilter===b.dataset.filter?null:b.dataset.filter;render()});$("patientSearch")?.addEventListener("input",e=>renderPatients(e.target.value));
$("loadPatientBtn").onclick=()=>loadPatientFromLookup(true);
$("clearPatientBtn").onclick=clearPatientFields;

// Al elegir un paciente guardado, sus datos se cargan automáticamente.
// No hace falta presionar "Cargar paciente".
$("patientLookup").addEventListener("change",()=>loadPatientFromLookup(false));
$("patientLookup").addEventListener("input",()=>{
  const val=$("patientLookup").value.trim().toLowerCase();
  const exact=patients.some(p=>{
    const display=`${p.name} — ${p.dni||"sin DNI"}`.toLowerCase();
    return val===display;
  });
  if(exact) loadPatientFromLookup(false);
});

$("closePayment").onclick=()=>$("paymentOverlay").classList.add("hidden");

$("appointmentForm").onsubmit=e=>{
  e.preventDefault();
  const patient=upsertPatientFromForm();
  const id=$("editId").value||crypto.randomUUID();
  const type=$("type").value;
  const data={id,patientId:patient?.id||null,date:$("formDate").value,time:$("time").value,type,source:$("source").value,name:$("name").value.trim(),age:$("age").value,dni:$("dni").value.trim(),phone:$("phone").value.trim(),simplePaymentStatus:$("simplePaymentStatus").value,surgeryName:$("surgeryName").value.trim(),surgeryAmount:$("surgeryAmount").value,surgeryPaid:$("surgeryPaid").value,surgeryPaymentStatus:$("surgeryPaymentStatus").value,surgeon1:$("surgeon1").value.trim(),surgeon2:$("surgeon2").value.trim(),anesthesiologist:$("anesthesiologist").value.trim(),instrumentist:$("instrumentist").value.trim(),postOpDays:$("postOpDays").value,controlReason:$("controlReason").value,notes:$("notes").value.trim()};
  const idx=appointments.findIndex(a=>a.id===id);if(idx>=0)appointments[idx]=data;else appointments.push(data);
  save();selectedDate=new Date(data.date+"T12:00:00");$("modal").classList.add("hidden");render();
};
$("deleteBtn").onclick=()=>{const id=$("editId").value;if(id&&confirm("¿Eliminar esta actividad?")){appointments=appointments.filter(a=>a.id!==id);save();$("modal").classList.add("hidden");render()}};

function switchView(name){
  document.querySelectorAll(".nav-btn").forEach(n=>n.classList.toggle("active",n.dataset.view===name));
  document.querySelectorAll(".view").forEach(v=>v.classList.remove("active-view"));
  $(`${name}View`).classList.add("active-view");
  if(name==="pacientes")renderPatients();
}
document.querySelectorAll(".nav-btn").forEach(n=>n.onclick=()=>switchView(n.dataset.view));

$("searchBtn").onclick=()=>{$("searchOverlay").classList.remove("hidden");$("globalSearch").focus();renderGlobal()};
$("closeSearch").onclick=()=>$("searchOverlay").classList.add("hidden");
$("globalSearch").oninput=renderGlobal;
function renderGlobal(){
  const q=$("globalSearch").value.toLowerCase().trim();
  const list=appointments.filter(a=>!q||[a.name,a.dni,a.phone,a.surgeryName,a.source].join(" ").toLowerCase().includes(q)).slice(0,20);
  $("globalResults").innerHTML=list.length?list.map(a=>`<div class="result-card"><h3>${esc(a.name)}</h3><p>${esc(a.date)} · ${esc(a.time)} · ${label(a.type)}</p><p>DNI ${esc(a.dni||"—")} · ${esc(a.phone||"—")}</p></div>`).join(""):`<div class="empty">No se encontraron resultados.</div>`;
}

$("goDateBtn").onclick=()=>{$("jumpDateInput").value=dateKey(selectedDate);$("dateOverlay").classList.remove("hidden")};
$("closeDate").onclick=()=>$("dateOverlay").classList.add("hidden");
$("jumpDateConfirm").onclick=()=>{const v=$("jumpDateInput").value;if(!v)return;selectedDate=new Date(v+"T12:00:00");activeFilter=null;$("dateOverlay").classList.add("hidden");render()};

$("quickNotes").value=localStorage.getItem("masVidaQuickNotes")||"";
$("quickNotes").oninput=e=>localStorage.setItem("masVidaQuickNotes",e.target.value);


$("unlockBtn").onclick=async()=>{
  const pin=$("unlockPin").value;
  if(!pin){$("unlockError").textContent="Ingresa tu clave.";return}
  const ok=await verifyPin(pin);
  if(!ok){$("unlockError").textContent="Clave incorrecta.";return}
  sessionPin=pin;
  sessionStorage.setItem(SESSION_UNLOCKED,"1");
  hideLock();
};
$("unlockPin").addEventListener("keydown",e=>{if(e.key==="Enter")$("unlockBtn").click()});

$("setPinBtn").onclick=()=>{
  $("pinModalTitle").textContent="Crear / cambiar clave";
  $("newPin").value="";$("confirmPin").value="";$("pinError").textContent="";
  $("pinOverlay").classList.remove("hidden");
};
$("closePin").onclick=async()=>{
  if(await hasPin())$("pinOverlay").classList.add("hidden");
};
$("savePinBtn").onclick=async()=>{
  const p1=$("newPin").value,p2=$("confirmPin").value;
  if(p1.length<4){$("pinError").textContent="La clave debe tener al menos 4 caracteres.";return}
  if(p1!==p2){$("pinError").textContent="Las claves no coinciden.";return}
  await saveNewPin(p1);
  $("pinOverlay").classList.add("hidden");
  hideLock();
  alert("Clave guardada.");
};
$("lockNowBtn").onclick=()=>{
  sessionStorage.removeItem(SESSION_UNLOCKED);
  sessionPin="";
  showLock();
};

async function getCurrentPin(){
  if(sessionPin)return sessionPin;
  const pin=prompt("Ingresa tu clave de Más Vida:");
  if(!pin)return null;
  if(!await verifyPin(pin)){alert("Clave incorrecta.");return null}
  sessionPin=pin;
  return pin;
}

$("exportBackupBtn").onclick=async()=>{
  const pin=await getCurrentPin();
  if(!pin)return;
  const payload={
    app:"Mas Vida",
    version:5,
    createdAt:new Date().toISOString(),
    appointments,
    patients,
    quickNotes:localStorage.getItem("masVidaQuickNotes")||""
  };
  const plaintext=new TextEncoder().encode(JSON.stringify(payload));
  const salt=randomBytes(16),iv=randomBytes(12);
  const keyObj=await deriveAesKey(pin,salt);
  const encrypted=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv},keyObj,plaintext));
  const backup={
    format:"masvida-encrypted-backup",
    version:1,
    salt:bytesToB64(salt),
    iv:bytesToB64(iv),
    data:bytesToB64(encrypted)
  };
  const blob=new Blob([JSON.stringify(backup)],{type:"application/json"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  const stamp=new Date().toISOString().slice(0,10);
  a.href=url;a.download=`Mas_Vida_respaldo_${stamp}.masvida`;
  document.body.appendChild(a);a.click();a.remove();
  URL.revokeObjectURL(url);
};

$("restoreBackupBtn").onclick=async()=>{
  const file=$("backupFileInput").files?.[0];
  if(!file){alert("Selecciona primero una copia de seguridad.");return}
  const pin=await getCurrentPin();
  if(!pin)return;
  try{
    const backup=JSON.parse(await file.text());
    if(backup.format!=="masvida-encrypted-backup")throw new Error("Formato no compatible");
    const keyObj=await deriveAesKey(pin,b64ToBytes(backup.salt));
    const decrypted=await crypto.subtle.decrypt(
      {name:"AES-GCM",iv:b64ToBytes(backup.iv)},
      keyObj,
      b64ToBytes(backup.data)
    );
    const payload=JSON.parse(new TextDecoder().decode(decrypted));
    if(!Array.isArray(payload.appointments)||!Array.isArray(payload.patients))throw new Error("Contenido inválido");
    if(!confirm("Esto reemplazará los datos actuales de Más Vida por los de la copia. ¿Continuar?"))return;
    appointments=payload.appointments;
    patients=payload.patients;
    localStorage.setItem("masVidaQuickNotes",payload.quickNotes||"");
    $("quickNotes").value=payload.quickNotes||"";
    save();
    render();
    alert("Copia restaurada correctamente.");
  }catch(err){
    alert("No se pudo restaurar la copia. Verifica que el archivo y la clave sean correctos.");
  }
};

render();
initializeSecurity();

