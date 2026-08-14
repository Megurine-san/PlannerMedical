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
let statsDate=new Date();

const $=id=>document.getElementById(id);

function newLocalId(){
  if(window.crypto && typeof window.crypto.randomUUID==="function"){
    return window.crypto.randomUUID();
  }
  return "mv-"+Date.now()+"-"+Math.random().toString(36).slice(2,10);
}

const colors={consulta:"#e2b72f",cirugia:"#c65ddd",control:"#75cf68",postcirugia:"#55c7b8",muestra:"#69aee8",laboratorio:"#e29a61"};
const sourceColors={Facebook:"#4d95c7",TikTok:"#9f57b8",Referido:"#63b458",Google:"#b9a84d",Otro:"#b7745f"};
const sourceOrder=["Facebook","TikTok","Referido","Google","Otro"];

function dateKey(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`}
function formatDate(d,opts={weekday:"long",day:"numeric",month:"long",year:"numeric"}){return new Intl.DateTimeFormat("es-PE",opts).format(d)}
function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
function save(){
  localStorage.setItem(APPT_STORE,JSON.stringify(appointments));
  localStorage.setItem(PATIENT_STORE,JSON.stringify(patients));
}
function label(t){
  return t==="cirugia"?"CIRUGÍA":
         t==="control"?"CONTROL":
         t==="postcirugia"?"POST CIRUGÍA":
         t==="muestra"?"MUESTRA PATOLÓGICA":
         t==="laboratorio"?"APOYO LABORATORIO":"CONSULTA";
}


function toggleOtherDetail(selectId, fieldId){
  const select=$(selectId), field=$(fieldId);
  if(!select||!field)return;
  const isOther=/^otros?$/i.test(String(select.value||"").trim());
  field.classList.toggle("hidden",!isOther);
  const input=field.querySelector("input,textarea");
  if(input && !isOther) input.value="";
}

function updateControlReasonOther(){
  toggleOtherDetail("controlReason","controlReasonOtherField");
}

function updateSurgeryTeamOtherFields(){
  toggleOtherDetail("surgeon1","surgeon1OtherField");
  toggleOtherDetail("surgeon2","surgeon2OtherField");
  toggleOtherDetail("anesthesiologist","anesthesiologistOtherField");
  toggleOtherDetail("instrumentist","instrumentistOtherField");
}

function selectedTeamValue(selectId, otherId){
  const value=$(selectId).value;
  if(value==="Otro") return $(otherId).value.trim() || "Otro";
  return value;
}

function initEasyTimePicker(){
  $("timeHour").innerHTML=Array.from({length:12},(_,i)=>`<option value="${i+1}">${String(i+1).padStart(2,"0")}</option>`).join("");
  $("timeMinute").innerHTML=Array.from({length:60},(_,i)=>`<option value="${i}">${String(i).padStart(2,"0")}</option>`).join("");
}

function syncEasyTimeToHidden(){
  const h12=Number($("timeHour").value||12);
  const m=Number($("timeMinute").value||0);
  const period=$("timePeriod").value||"AM";
  let h=h12%12;
  if(period==="PM")h+=12;
  $("time").value=`${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
}

function setEasyTimeFrom24(value){
  let h=8,m=0;
  if(value && /^\d{1,2}:\d{2}/.test(value)){
    const parts=value.split(":");
    h=Number(parts[0]);m=Number(parts[1]);
  }
  $("timePeriod").value=h>=12?"PM":"AM";
  let h12=h%12;if(h12===0)h12=12;
  $("timeHour").value=String(h12);
  $("timeMinute").value=String(m);
  syncEasyTimeToHidden();
}

function updatePostOpCustomField(){
  const custom=$("postOpUnit").value==="personalizado";
  $("postOpCustomField").classList.toggle("hidden",!custom);
  $("postOpValue").disabled=custom;
  if(custom){
    $("postOpValue").value="";
  }else{
    $("postOpCustom").value="";
  }
}

function postOpDisplay(a){
  // Compatibilidad con datos antiguos: postOpDays se interpreta como días.
  if(a.postOpCustom && String(a.postOpCustom).trim()){
    return String(a.postOpCustom).trim();
  }

  const value=(a.postOpValue!==undefined && a.postOpValue!=="")
    ? a.postOpValue
    : (a.postOpDays!==undefined ? a.postOpDays : "");

  if(value==="") return "Control postoperatorio";

  const unit=a.postOpUnit || "dias";
  const n=Number(value);
  const plural=n===1 ? false : true;

  if(unit==="meses") return `${value} ${plural?"meses":"mes"}`;
  if(unit==="anios") return `${value} ${plural?"años":"año"}`;
  return `${value} ${plural?"días":"día"}`;
}


function sourceDisplay(a){
  if(!a || !a.source || a.source==="No especificado") return "";
  if(a.source==="Otro" && a.sourceOther && a.sourceOther.trim()){
    return a.sourceOther.trim();
  }
  if(a.source==="Referido" && a.referredBy && a.referredBy.trim()){
    return `Referido: ${a.referredBy.trim()}`;
  }
  return a.source;
}


function updateReferredByField(){
  const isReferred=$("source").value==="Referido";
  $("referredByField").classList.toggle("hidden",!isReferred);
  if(!isReferred)$("referredBy").value="";
}

function updateOtherSourceField(){
  const isOther=$("source").value==="Otro";
  $("otherSourceField").classList.toggle("hidden",!isOther);
  if(!isOther)$("sourceOther").value="";$("referredBy").value="";
  updateReferredByField();
}

function money(n){return Number(n||0).toFixed(2)}

function normalizePatients(){
  const map=new Map(patients.map(p=>[(p.dni||p.name.toLowerCase()),p]));
  appointments.forEach(a=>{
    const k=a.dni||a.name.toLowerCase();
    if(!map.has(k)){
      const phones=normalizePhones(a.phones,a.phone);
      const p={id:newLocalId(),name:a.name,age:a.age,dni:a.dni,phone:phones[0]?.number||a.phone||"",phones};
      map.set(k,p);patients.push(p);
    }
  });
  patients.forEach(p=>{
    if(!Array.isArray(p.phones))p.phones=normalizePhones([],p.phone);
    if(!p.phone && p.phones.length)p.phone=p.phones[0].number;
  });
  save();
}
normalizePatients();

function linkLegacyAppointmentsToPatients(){
  let changed=false;
  appointments.forEach(a=>{
    if(a.patientId)return;
    const p=patients.find(p=>
      (a.dni && p.dni && a.dni===p.dni) ||
      ((a.name||"").toLowerCase()===(p.name||"").toLowerCase())
    );
    if(p){
      a.patientId=p.id;
      changed=true;
    }
  });
  if(changed)save();
}
linkLegacyAppointmentsToPatients();


function upsertPatientFromForm(){
  const name=$("name").value.trim(),dni=$("dni").value.trim(),age=$("age").value;
  const phones=getPhoneRows();
  const phone=phones[0]?.number||"";
  if(!name)return null;
  let p=patients.find(x=>(dni&&x.dni===dni)||x.name.toLowerCase()===name.toLowerCase());
  if(!p){
    p={id:newLocalId(),name,age,dni,phone,phones};
    patients.push(p);
  }else{
    p.name=name;p.age=age;p.dni=dni;p.phone=phone;p.phones=phones;
  }
  return p;
}

function refreshPatientDatalist(){
  $("patientDatalist").innerHTML=patients.map(p=>`<option value="${esc(p.name)} — ${esc(p.dni||"sin DNI")}"></option>`).join("");
}

function normalizePhones(rawPhones, legacyPhone){
  if(Array.isArray(rawPhones) && rawPhones.length){
    return rawPhones
      .map(p=>({owner:(p.owner||"Paciente").trim(),number:(p.number||"").trim()}))
      .filter(p=>p.number);
  }
  if(legacyPhone && String(legacyPhone).trim()){
    return [{owner:"Paciente",number:String(legacyPhone).trim()}];
  }
  return [];
}

function addPhoneRow(owner="Paciente", number="", removable=true){
  const row=document.createElement("div");
  row.className="phone-row";
  row.innerHTML=`
    <label>De quién es
      <input type="text" class="phone-owner" placeholder="Ej. Paciente, esposo, hija..." value="${esc(owner)}" />
    </label>
    <label>Número
      <input type="tel" inputmode="tel" class="phone-number" placeholder="Ej. 987654321" value="${esc(number)}" />
    </label>
    <button type="button" class="remove-phone-btn" title="Quitar teléfono">×</button>
  `;
  const removeBtn=row.querySelector(".remove-phone-btn");
  removeBtn.onclick=()=>{
    const rows=$("phonesContainer").querySelectorAll(".phone-row");
    if(rows.length<=1){
      row.querySelector(".phone-owner").value="Paciente";
      row.querySelector(".phone-number").value="";
      return;
    }
    row.remove();
  };
  $("phonesContainer").appendChild(row);
}

function setPhoneRows(phones=[], legacyPhone=""){
  $("phonesContainer").innerHTML="";
  const normalized=normalizePhones(phones,legacyPhone);
  if(normalized.length){
    normalized.forEach(p=>addPhoneRow(p.owner,p.number,true));
  }else{
    addPhoneRow("Paciente","",false);
  }
}

function getPhoneRows(){
  return [...$("phonesContainer").querySelectorAll(".phone-row")]
    .map(row=>({
      owner:row.querySelector(".phone-owner").value.trim()||"Paciente",
      number:row.querySelector(".phone-number").value.trim()
    }))
    .filter(p=>p.number);
}

function phonesDisplay(phones, legacyPhone){
  const list=normalizePhones(phones,legacyPhone);
  return list.length
    ? list.map(p=>`${p.owner}: ${p.number}`).join(" · ")
    : "—";
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
  setPhoneRows(p.phones,p.phone||"");

  // Conserva la selección visible para que sea claro qué paciente se cargó.
  $("patientLookup").value=`${p.name} — ${p.dni||"sin DNI"}`;
  return true;
}
function clearPatientFields(){
  $("patientLookup").value="";$("name").value="";$("age").value="";$("dni").value="";
  setPhoneRows([],"");
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


const dailyQuotes=[
  "Cada día es una nueva oportunidad para hacer una diferencia.",
  "Lo que haces hoy puede cambiar el día de alguien.",
  "La constancia convierte los pequeños pasos en grandes logros.",
  "Un día organizado deja más espacio para cuidar lo importante.",
  "Tu trabajo de hoy también forma parte de la recuperación de alguien.",
  "Haz lo posible con calma, dedicación y propósito.",
  "Cada paciente atendido es una historia acompañada.",
  "Los buenos resultados comienzan con pequeños detalles bien cuidados.",
  "Hoy también puede ser un buen día para avanzar.",
  "La dedicación diaria construye resultados extraordinarios.",
  "Una tarea a la vez también es progreso.",
  "Que hoy no falten paciencia, claridad y una razón para sonreír.",
  "El cuidado comienza mucho antes de entrar al consultorio.",
  "Organizar también es una forma de cuidar.",
  "Tu esfuerzo cotidiano tiene más impacto del que parece.",
  "Que cada pendiente resuelto haga el día un poco más ligero.",
  "Hoy enfócate en avanzar, no en hacerlo todo de una vez.",
  "Cada nuevo día trae una nueva posibilidad de hacerlo bien.",
  "La excelencia se construye en los detalles de todos los días.",
  "Un buen comienzo puede cambiar el ritmo de todo el día.",
  "Haz espacio para lo importante y avanza con tranquilidad.",
  "El trabajo hecho con atención siempre deja huella.",
  "Hoy puede ser sencillo, productivo y bonito a la vez.",
  "Cuidar a otros también empieza por trabajar con calma.",
  "Paso a paso, cada día cuenta.",
  "La amabilidad también forma parte de una buena atención.",
  "Que el propósito sea más grande que el apuro.",
  "Hoy tienes una nueva página para organizar y avanzar.",
  "La tranquilidad y el orden hacen más llevadero un día ocupado.",
  "Cada pequeña ayuda puede significar mucho para otra persona.",
  "Empieza con lo más importante; lo demás irá encontrando su lugar."
];

function renderGreeting(){
  const now=new Date();
  const h=now.getHours();
  const greeting=h<12?"¡Buenos días!":h<19?"¡Buenas tardes!":"¡Buenas noches!";
  const title=$("greetingTitle");
  if(title) title.innerHTML=`${greeting} <span class="sun-symbol">${h<19?"☀":"☾"}</span>`;

  const label=$("todayLabel");
  if(label){
    const txt=new Intl.DateTimeFormat("es-PE",{weekday:"long",day:"numeric",month:"long",year:"numeric"}).format(now);
    label.textContent=txt.charAt(0).toUpperCase()+txt.slice(1);
  }

  const start=new Date(now.getFullYear(),0,0);
  const day=Math.floor((now-start)/86400000);
  const quote=$("dailyQuote");
  if(quote) quote.textContent=`“${dailyQuotes[(day-1)%dailyQuotes.length]}”`;
}

function startOfWeek(d){
  const x=new Date(d);
  const day=x.getDay();
  const diff=(day===0?-6:1-day);
  x.setDate(x.getDate()+diff);
  x.setHours(12,0,0,0);
  return x;
}

function renderWeekStrip(){
  const strip=$("weekStrip");
  if(!strip)return;
  const monday=startOfWeek(selectedDate);
  strip.innerHTML="";
  for(let i=0;i<7;i++){
    const d=new Date(monday);
    d.setDate(monday.getDate()+i);
    const key=dateKey(d);
    const dayActivities=appointments.filter(a=>a.date===key);
    const dots=[...new Set(dayActivities.map(a=>a.type))].slice(0,4);
    const btn=document.createElement("button");
    btn.type="button";
    btn.className="week-day"+(key===dateKey(selectedDate)?" active":"");
    btn.innerHTML=`<span>${["DOM","LUN","MAR","MIÉ","JUE","VIE","SÁB"][d.getDay()]}</span><strong>${d.getDate()}</strong><div class="week-dots">${dots.map(t=>`<i class="dot-${t}"></i>`).join("")}</div>`;
    btn.onclick=()=>{selectedDate=new Date(d);render();};
    strip.appendChild(btn);
  }
}

function render(){
  renderGreeting();
  renderWeekStrip();

  const selectedTitle=$("selectedDateTitle");
  if(selectedTitle){
    selectedTitle.textContent=formatDate(selectedDate).replace(/^./,c=>c.toUpperCase());
  }

  refreshPatientDatalist();

  const allToday=appointments.filter(a=>a.date===dateKey(selectedDate)).sort((a,b)=>a.time.localeCompare(b.time));
  const list=activeFilter?allToday.filter(a=>a.type===activeFilter):allToday;
  $("consultCount").textContent=allToday.filter(a=>a.type==="consulta").length;
  $("surgeryCount").textContent=allToday.filter(a=>a.type==="cirugia").length;
  $("controlCount").textContent=allToday.filter(a=>a.type==="control").length;
  $("postSurgeryCount").textContent=allToday.filter(a=>a.type==="postcirugia").length;
  $("pathologyCount").textContent=allToday.filter(a=>a.type==="muestra").length;
  $("labCount").textContent=allToday.filter(a=>a.type==="laboratorio").length;

  renderTimeline(list);renderUpcoming();renderSources();renderPatients();renderAllSurgeries();renderAllControls();renderStats();
}


function surgeryChargeTypeLabel(v){
  if(v==="honorarios")return "Solo honorarios";
  if(v==="todo")return "Cubre todo";
  return "Pago normal";
}

function paymentText(a){
  if(a.type==="cirugia"){
    const total=Number(a.surgeryAmount||0),paid=Number(a.surgeryPaid||0),balance=Math.max(0,total-paid);
    const status=balance<=0&&total>0?"Pagado completo":paid>0?"A cuenta":"Pendiente";
    return {pill:status,detail:`S/ ${money(paid)} pagado de S/ ${money(total)} · saldo S/ ${money(balance)}`,balance};
  }
  if(a.simplePaymentStatus==="no_pagada"){
    return {pill:"Gratis",detail:"",balance:0};
  }
  const amount=Number(a.simplePaymentAmount||0);
  return {pill:amount>0?`Pagada · S/ ${money(amount)}`:"Pagada",detail:"",balance:0};
}

function renderTimeline(list){
  if(!list.length){$("timeline").innerHTML=`<div class="empty">${activeFilter?"No hay actividades de este tipo para este día.":"No hay actividades programadas para este día."}</div>`;return}
  $("timeline").innerHTML=list.map(a=>{
    const pay=paymentText(a);
    let extra="";
    if(a.type==="cirugia"){
      extra=`<div class="surgery-team"><b>EQUIPO QUIRÚRGICO</b><br>👤 Cirujano 1: ${esc(a.surgeon1||"—")}<br>👤 Cirujano 2: ${esc(a.surgeon2||"—")}<br>👤 Anestesiólogo: ${esc(a.anesthesiologist||"—")}<br>👤 Instrumentista: ${esc(a.instrumentist||"—")}<div class="surgery-payment"><b>${esc(surgeryChargeTypeLabel(a.surgeryChargeType||"normal"))}</b></div><div class="surgery-payment ${pay.balance>0?"balance-due":"paid-full"}">${esc(pay.detail)}</div></div>`;
    } else if(a.type==="control"){
      const reason=(a.controlReason==="Otro"&&a.controlReasonOther)?`Otro: ${a.controlReasonOther}`:(a.controlReason||"Control");
      extra=`<div class="postop-info"><strong>${esc(postOpDisplay(a))} post cirugía</strong><span>${esc(reason)}</span></div>`;
    } else if(a.type==="postcirugia"){
      extra=`<div class="postop-info post-surgery-result"><strong>Resultados de la cirugía</strong><span>${esc(a.postSurgeryResults||"Sin observaciones registradas")}</span></div>`;
    } else if(a.type==="muestra"){
      const parts=[];
      if(a.pathologyType)parts.push(`Tipo: ${a.pathologyType}`);
      if(a.pathologyCharacteristics)parts.push(a.pathologyCharacteristics);
      if(a.pathologyRemovedDate)parts.push(`Retiro: ${a.pathologyRemovedDate}`);
      if(a.pathologySentDate)parts.push(`Patología: ${a.pathologySentDate}`);
      if(a.pathologyResultRequest)parts.push(`Resultados: ${a.pathologyResultRequest}`);
      extra=`<div class="postop-info pathology-summary"><strong>Muestra patológica</strong><span>${esc(parts.join(" · ")||"Sin detalles registrados")}</span></div>`;
    }
    const displayedSource=sourceDisplay(a);const origin=displayedSource?`<span class="origin-pill">Origen: ${esc(displayedSource)}</span>`:"";
    const surgeryName=a.type==="cirugia"&&a.surgeryName?` · ${esc(a.surgeryName)}`:"";
    const payBtn=a.type==="cirugia"&&pay.balance>0?`<button class="pay-btn" onclick="openPayment('${a.id}')">Agregar pago</button>`:"";
    return `<div class="appointment-row">
      <div class="time-box"><span class="time-main">${esc(a.time)}</span><span class="ampm">${parseInt(a.time,10)<12?"AM":"PM"}</span></div>
      <article class="appt-card ${a.type}">
        <div>
          <span class="type-pill">${label(a.type)}${surgeryName}</span>${origin}<span class="payment-pill">${esc(pay.pill)}</span>
          <div class="patient-line"><strong>${esc(a.name)}</strong><span class="patient-age">${a.age?esc(a.age)+" años":""}</span></div>
          <div class="patient-meta"><span>▣ DNI: ${esc(a.dni||"—")}</span><span>☎ ${esc(phonesDisplay(a.phones,a.phone))}</span></div>
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

function sourceCountsForMonth(date=selectedDate){
  const c={Facebook:0,TikTok:0,Referido:0,Google:0,Otro:0};
  const year=date.getFullYear(),month=date.getMonth();
  appointments.forEach(a=>{
    if(!a.date)return;
    const d=new Date(a.date+"T12:00:00");
    if(d.getFullYear()!==year||d.getMonth()!==month)return;
    if(c[a.source]!==undefined)c[a.source]++;
  });
  return c;
}
function sourceCounts(){
  const c={Facebook:0,TikTok:0,Referido:0,Google:0,Otro:0};
  appointments.forEach(a=>{if(c[a.source]!==undefined)c[a.source]++});
  return c;
}
function renderSources(){
  const c=sourceCountsForMonth(selectedDate);
  const total=Object.values(c).reduce((x,y)=>x+y,0);
  let angle=0,parts=[];
  sourceOrder.forEach(s=>{
    const p=total?c[s]/total*100:0;
    parts.push(`${sourceColors[s]} ${angle}% ${angle+p}%`);
    angle+=p;
  });
  $("sourceDonut").style.background=total?`conic-gradient(${parts.join(",")})`:`conic-gradient(#294d49 0 100%)`;
  $("sourceLegend").innerHTML=sourceOrder.map(s=>{
    const pct=total?Math.round(c[s]/total*100):0;
    return `<div class="source-line"><i style="background:${sourceColors[s]}"></i><span>${s}</span><b>${pct}%</b></div>`;
  }).join("");
  const text=new Intl.DateTimeFormat("es-PE",{month:"long",year:"numeric"}).format(selectedDate);
  $("sourceMonthLabel").textContent=text.charAt(0).toUpperCase()+text.slice(1);
  $("sourceMonthTotal").textContent=total;
  $("sourceCountsList").innerHTML=sourceOrder.map(s=>{
    const pct=total?Math.round(c[s]/total*100):0;
    return `<div class="source-count-row"><div class="source-count-name"><i style="background:${sourceColors[s]}"></i><span>${s}</span></div><div class="source-count-values"><strong>${c[s]}</strong><span>${pct}%</span></div></div>`;
  }).join("");
}

function patientHistory(p){
  return appointments
    .filter(a=>{
      if(a.patientId && p.id && a.patientId===p.id) return true;
      if(p.dni && a.dni && a.dni===p.dni) return true;
      return (a.name||"").toLowerCase()===(p.name||"").toLowerCase();
    })
    .sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time));
}

function historyDetail(a){
  if(a.type==="cirugia"){
    return a.surgeryName ? `Cirugía · ${a.surgeryName}` : "Cirugía";
  }
  if(a.type==="control"){
    const reason=(a.controlReason==="Otro"&&a.controlReasonOther)
      ? `Otro: ${a.controlReasonOther}`
      : (a.controlReason||"Control");
    return `${reason} · ${postOpDisplay(a)} post cirugía`;
  }
  if(a.type==="postcirugia"){
    return a.postSurgeryResults ? `Resultados: ${a.postSurgeryResults}` : "Resultados de la cirugía";
  }
  if(a.type==="muestra"){
    const type=a.pathologyType?` · ${a.pathologyType}`:"";
    return `Muestra Patológica${type}`;
  }
  if(a.type==="laboratorio") return "Apoyo en Exámenes de Laboratorio";
  return "Consulta";
}

function formatHistoryDate(dateStr){
  try{
    const d=new Date(dateStr+"T12:00:00");
    return new Intl.DateTimeFormat("es-PE",{day:"2-digit",month:"2-digit",year:"numeric"}).format(d);
  }catch{
    return dateStr;
  }
}
function renderPatients(q=""){
  const query=(q||$("patientSearch")?.value||"").toLowerCase().trim();
  const list=patients.filter(p=>!query||[p.name,p.dni,p.phone,...normalizePhones(p.phones,p.phone).map(x=>`${x.owner} ${x.number}`)].join(" ").toLowerCase().includes(query));

  $("patientResults").innerHTML=list.length ? list.map(p=>{
    const h=patientHistory(p);
    const last=h[0];

    const historyHtml=h.length
      ? `<div class="attendance-history">
          ${h.map((a,index)=>`
            <div class="attendance-row">
              <div class="attendance-marker"></div>
              <div class="attendance-content">
                <div class="attendance-topline">
                  <strong>${formatHistoryDate(a.date)}</strong>
                  <span>${esc(a.time||"")}</span>
                  <span class="attendance-type ${a.type}">${label(a.type)}</span>
                </div>
                <div class="attendance-detail">${esc(historyDetail(a))}</div>
                ${a.notes?`<div class="attendance-note">${esc(a.notes)}</div>`:""}
              </div>
            </div>`).join("")}
        </div>`
      : `<p class="no-history">Aún no tiene atenciones registradas.</p>`;

    return `<div class="result-card patient-card">
      <div class="patient-card-header">
        <div>
          <h3>${esc(p.name)}</h3>
          <p>${p.age?esc(p.age)+" años · ":""}DNI ${esc(p.dni||"—")}</p>
          <p>${esc(phonesDisplay(p.phones,p.phone))}</p>
        </div>
        <div class="attendance-count">
          <strong>${h.length}</strong>
          <span>${h.length===1?"atención":"atenciones"}</span>
        </div>
      </div>

      <div class="history-summary">
        <b>Historial de atenciones</b>
        ${last?`<span>Última: ${formatHistoryDate(last.date)} · ${esc(last.time||"")}</span>`:""}
      </div>

      ${historyHtml}
    </div>`;
  }).join("") : `<div class="empty">No se encontraron pacientes.</div>`;
}
function renderAllSurgeries(){
  const list=appointments.filter(a=>a.type==="cirugia").sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
  $("allSurgeries").innerHTML=list.length?list.map(a=>{const p=paymentText(a);return `<div class="result-card"><h3 style="color:#c674d8">${esc(a.surgeryName||"Cirugía")} — ${esc(a.name)}</h3><p>${esc(a.date)} · ${esc(a.time)} · Origen: ${esc(sourceDisplay(a)||"—")}</p><p>${esc(p.detail)}</p>${p.balance>0?`<button class="pay-btn" onclick="openPayment('${a.id}')">Agregar pago</button>`:""}</div>`}).join(""):`<div class="empty">No hay cirugías registradas.</div>`;
}
function renderAllControls(){
  const list=appointments.filter(a=>a.type==="control").sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
  $("allControls").innerHTML=list.length?list.map(a=>`<div class="result-card"><h3 style="color:#88d17f">${esc(a.name)}</h3><p>${esc(a.date)} · ${esc(a.time)} · ${esc(postOpDisplay(a))} post cirugía</p><p>${esc(a.controlReason||"Control")} · ${a.simplePaymentStatus==="no_pagada"?"Gratis":"Pagada"}</p></div>`).join(""):`<div class="empty">No hay controles registrados.</div>`;
}
function statsMonthKey(date){
  return {year:date.getFullYear(),month:date.getMonth()};
}

function appointmentsForStatsMonth(){
  const {year,month}=statsMonthKey(statsDate);
  return appointments.filter(a=>{
    if(!a.date)return false;
    const d=new Date(a.date+"T12:00:00");
    return d.getFullYear()===year && d.getMonth()===month;
  });
}

function uniquePatientsInAppointments(list){
  const keys=new Set();
  list.forEach(a=>{
    const key=a.patientId || (a.dni?`dni:${a.dni}`:`name:${(a.name||"").trim().toLowerCase()}`);
    if(key)keys.add(key);
  });
  return keys.size;
}

function renderStats(){
  const monthAppointments=appointmentsForStatsMonth();
  const totalPatients=uniquePatientsInAppointments(monthAppointments);

  $("statsTotalPatients").textContent=totalPatients;

  const monthText=new Intl.DateTimeFormat("es-PE",{month:"long",year:"numeric"}).format(statsDate);
  $("statsMonthLabel").textContent=monthText.charAt(0).toUpperCase()+monthText.slice(1);

  const types=[
    {id:"consulta",label:"Consultas",color:"#e2b72f"},
    {id:"cirugia",label:"Cirugías",color:"#c65ddd"},
    {id:"control",label:"Controles",color:"#75cf68"},
    {id:"postcirugia",label:"Post Cirugías",color:"#55c7b8"},
    {id:"muestra",label:"Muestra Patológica",color:"#69aee8"},
    {id:"laboratorio",label:"Apoyo en Exámenes de Laboratorio",color:"#e29a61"}
  ];

  $("statsActivitySummary").innerHTML=types.map(t=>{
    const count=monthAppointments.filter(a=>a.type===t.id).length;
    return `<div class="stats-type-card" style="--type-color:${t.color}">
      <span>${t.label}</span>
      <strong>${count}</strong>
    </div>`;
  }).join("");

  const sources=["Facebook","TikTok","Referido","Google","Otro"];

  $("statsDetailedBreakdown").innerHTML=types.map(t=>{
    const subset=monthAppointments.filter(a=>a.type===t.id);
    const total=subset.length;

    const rows=sources.map(source=>{
      const sourceItems=subset.filter(a=>a.source===source);
      const count=sourceItems.length;
      const pct=total?Math.round(count/total*100):0;

      let referralDetail="";
      if(source==="Referido" && count){
        const names={};
        sourceItems.forEach(a=>{
          const who=(a.referredBy||"Sin especificar").trim()||"Sin especificar";
          names[who]=(names[who]||0)+1;
        });
        const detail=Object.entries(names)
          .sort((a,b)=>b[1]-a[1])
          .map(([who,n])=>`${esc(who)} (${n})`)
          .join(" · ");
        referralDetail=`<div class="stats-referral-detail">Referidos por: ${detail}</div>`;
      }

      return `<div class="stats-source-row">
        <div class="stats-source-name">
          <i style="background:${sourceColors[source]}"></i>
          <span>${source}</span>
        </div>
        <div class="stats-source-values">
          <strong>${count}</strong>
          <span>${pct}%</span>
        </div>
        ${referralDetail}
      </div>`;
    }).join("");

    return `<div class="stats-rubric-card" style="--type-color:${t.color}">
      <div class="stats-rubric-header">
        <div>
          <span>${t.label}</span>
          <small>${total} ${total===1?"registro":"registros"}</small>
        </div>
        <strong>${total}</strong>
      </div>
      <div class="stats-source-table">${rows}</div>
    </div>`;
  }).join("");
}

function updateFields(){
  const t=$("type").value;

  $("surgeryFields").classList.toggle("hidden",t!=="cirugia");
  $("controlFields").classList.toggle("hidden",t!=="control");
  $("postSurgeryFields").classList.toggle("hidden",t!=="postcirugia");
  $("pathologyFields").classList.toggle("hidden",t!=="muestra");

  // Pago solo para Consulta y Control. Cirugía usa su propia cobranza.
  const showSimplePayment=(t==="consulta"||t==="control");
  $("consultControlPaymentFields").classList.toggle("hidden",!showSimplePayment);

  updateSimplePaymentAmountField();
  updatePaymentSummary();
}

function updateSimplePaymentAmountField(){
  const isPaid=$("simplePaymentStatus").value==="pagada";
  $("simplePaymentAmountField").classList.toggle("hidden",!isPaid);
  if(!isPaid)$("simplePaymentAmount").value="";
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
  $("modalTitle").textContent="Nueva actividad";
  $("appointmentForm").reset();
  $("editId").value="";
  $("formDate").value=dateKey(selectedDate);
  setEasyTimeFrom24("08:00");
  $("source").value="Facebook";
  $("sourceOther").value="";
  $("simplePaymentStatus").value="pagada";$("simplePaymentAmount").value="";
  $("postOpValue").value="";
  $("postOpUnit").value="dias";
  $("postOpCustom").value="";
  $("controlReason").value="Control";
  $("controlReasonOther").value="";
  $("surgeon1").value="";
  $("surgeon2").value="";
  $("anesthesiologist").value="";
  $("instrumentist").value="";
  $("surgeon1Other").value="";
  $("surgeon2Other").value="";
  $("anesthesiologistOther").value="";
  $("instrumentistOther").value="";
  $("deleteBtn").classList.add("hidden");
  $("patientLookup").value="";
  setPhoneRows([],"");
  updateOtherSourceField();
  updatePostOpCustomField();
  updateControlReasonOther();
  updateSurgeryTeamOtherFields();
  updateSimplePaymentAmountField();updateFields();
  $("modal").classList.remove("hidden");
}
function editAppointment(id){
  const a=appointments.find(x=>x.id===id);if(!a)return;
  $("modalTitle").textContent="Editar actividad";
  $("editId").value=a.id;
  $("formDate").value=a.date;
  setEasyTimeFrom24(a.time);
  $("type").value=a.type;
  $("source").value=a.source||"No especificado";
  $("sourceOther").value=a.sourceOther||"";$("referredBy").value=a.referredBy||"";
  $("name").value=a.name||"";
  $("age").value=a.age||"";
  $("dni").value=a.dni||"";
  setPhoneRows(a.phones,a.phone||"");
  $("simplePaymentStatus").value=a.simplePaymentStatus||"pagada";$("simplePaymentAmount").value=a.simplePaymentAmount||"";
  $("surgeryName").value=a.surgeryName||"";
  $("surgeryAmount").value=a.surgeryAmount||"";
  $("surgeryPaid").value=a.surgeryPaid||"";
  $("surgeryPaymentStatus").value=a.surgeryPaymentStatus||"pendiente";$("surgeryChargeType").value=a.surgeryChargeType||"normal";

  const surgeonOptions=["","Dr. Miguel","Dr. Christian","Dr. Isaias"];
  const anesthOptions=["","Dr. Millán","Dra. Juarez","Dr. Baltazar","Dra. Paula Gutierrez"];
  const instrOptions=["","Marco A.","Lic. Cecilia","Lic. Carolina"];

  if(surgeonOptions.includes(a.surgeon1||"")){$("surgeon1").value=a.surgeon1||"";$("surgeon1Other").value="";}else{$("surgeon1").value="Otro";$("surgeon1Other").value=a.surgeon1||"";}
  if(surgeonOptions.includes(a.surgeon2||"")){$("surgeon2").value=a.surgeon2||"";$("surgeon2Other").value="";}else{$("surgeon2").value="Otro";$("surgeon2Other").value=a.surgeon2||"";}
  if(anesthOptions.includes(a.anesthesiologist||"")){$("anesthesiologist").value=a.anesthesiologist||"";$("anesthesiologistOther").value="";}else{$("anesthesiologist").value="Otro";$("anesthesiologistOther").value=a.anesthesiologist||"";}
  if(instrOptions.includes(a.instrumentist||"")){$("instrumentist").value=a.instrumentist||"";$("instrumentistOther").value="";}else{$("instrumentist").value="Otro";$("instrumentistOther").value=a.instrumentist||"";}

  $("postOpValue").value=(a.postOpValue!==undefined?a.postOpValue:(a.postOpDays||""));
  $("postOpUnit").value=a.postOpUnit||"dias";
  $("postOpCustom").value=a.postOpCustom||"";
  if(a.postOpCustom)$("postOpUnit").value="personalizado";
  $("controlReason").value=a.controlReason||"Control";
  $("controlReasonOther").value=a.controlReasonOther||"";
  $("postSurgeryResults").value=a.postSurgeryResults||"";$("pathologyCharacteristics").value=a.pathologyCharacteristics||"";$("pathologyType").value=a.pathologyType||"";$("pathologyRemovedDate").value=a.pathologyRemovedDate||"";$("pathologySentDate").value=a.pathologySentDate||"";$("pathologyResultRequest").value=a.pathologyResultRequest||"";$("notes").value=a.notes||"";
  $("patientLookup").value="";
  $("deleteBtn").classList.remove("hidden");

  updateOtherSourceField();
  updatePostOpCustomField();
  updateControlReasonOther();
  updateSurgeryTeamOtherFields();
  updateSimplePaymentAmountField();updateFields();
  $("modal").classList.remove("hidden");
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

$("addBtn").onclick=openNew;
$("simplePaymentStatus").onchange=updateSimplePaymentAmountField;
if($("prevWeek"))$("prevWeek").onclick=()=>{selectedDate.setDate(selectedDate.getDate()-7);selectedDate=new Date(selectedDate);render();};
if($("nextWeek"))$("nextWeek").onclick=()=>{selectedDate.setDate(selectedDate.getDate()+7);selectedDate=new Date(selectedDate);render();};$("closeModal").onclick=()=>$("modal").classList.add("hidden");$("type").onchange=updateFields;$("source").onchange=updateOtherSourceField;$("postOpUnit").onchange=updatePostOpCustomField;$("surgeryAmount").oninput=updatePaymentSummary;$("surgeryPaid").oninput=updatePaymentSummary;$("todayBtn").onclick=()=>{selectedDate=new Date();activeFilter=null;render()};$("seeAllSurgeries").onclick=()=>switchView("cirugias");
$("statsPrevMonth").onclick=()=>{statsDate=new Date(statsDate.getFullYear(),statsDate.getMonth()-1,1);renderStats();};
$("statsNextMonth").onclick=()=>{statsDate=new Date(statsDate.getFullYear(),statsDate.getMonth()+1,1);renderStats();};document.querySelectorAll(".summary-card").forEach(b=>b.onclick=()=>{activeFilter=activeFilter===b.dataset.filter?null:b.dataset.filter;render()});$("patientSearch")?.addEventListener("input",e=>renderPatients(e.target.value));

initEasyTimePicker();
setEasyTimeFrom24("08:00");
$("timeHour").onchange=syncEasyTimeToHidden;
$("timeMinute").onchange=syncEasyTimeToHidden;
$("timePeriod").onchange=syncEasyTimeToHidden;
$("source").onchange=updateOtherSourceField;
$("postOpUnit").onchange=updatePostOpCustomField;
$("controlReason").onchange=updateControlReasonOther;
$("surgeon1").onchange=updateSurgeryTeamOtherFields;
$("surgeon2").onchange=updateSurgeryTeamOtherFields;
$("anesthesiologist").onchange=updateSurgeryTeamOtherFields;
$("instrumentist").onchange=updateSurgeryTeamOtherFields;
$("addPhoneBtn").onclick=()=>addPhoneRow("","",true);
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

function saveActivityFromForm(){
  const feedback=$("saveFeedback");
  if(feedback){feedback.textContent="";feedback.className="save-feedback";}

  try{
    syncEasyTimeToHidden();

    const date=$("formDate").value;
    const name=$("name").value.trim();

    if(!date){
      if(feedback){feedback.textContent="Selecciona una fecha.";feedback.classList.add("error");}
      $("formDate").focus();
      return;
    }

    if(!name){
      if(feedback){feedback.textContent="Ingresa el nombre del paciente.";feedback.classList.add("error");}
      $("name").focus();
      return;
    }

    const patient=upsertPatientFromForm();
    const id=$("editId").value||newLocalId();
    const type=$("type").value;
    const phones=getPhoneRows();

    const data={
      id,
      patientId:patient?.id||null,
      date,
      time:$("time").value||"08:00",
      type,
      source:$("source").value,
      sourceOther:$("source").value==="Otro"?$("sourceOther").value.trim():"",
      referredBy:$("source").value==="Referido"?$("referredBy").value.trim():"",
      name,
      age:$("age").value,
      dni:$("dni").value.trim(),
      phones,
      phone:phones[0]?.number||"",
      simplePaymentStatus:$("simplePaymentStatus").value,
      simplePaymentAmount:$("simplePaymentStatus").value==="pagada"?$("simplePaymentAmount").value:"",
      surgeryName:$("surgeryName").value.trim(),
      surgeryAmount:$("surgeryAmount").value,
      surgeryPaid:$("surgeryPaid").value,
      surgeryPaymentStatus:$("surgeryPaymentStatus").value,
      surgeryChargeType:$("surgeryChargeType").value,
      surgeon1:selectedTeamValue("surgeon1","surgeon1Other"),
      surgeon2:selectedTeamValue("surgeon2","surgeon2Other"),
      anesthesiologist:selectedTeamValue("anesthesiologist","anesthesiologistOther"),
      instrumentist:selectedTeamValue("instrumentist","instrumentistOther"),
      postOpValue:$("postOpValue").value,
      postOpUnit:$("postOpUnit").value,
      postOpCustom:$("postOpUnit").value==="personalizado"?$("postOpCustom").value.trim():"",
      postOpDays:$("postOpUnit").value==="dias"?$("postOpValue").value:"",
      controlReason:$("controlReason").value,
      controlReasonOther:$("controlReason").value==="Otro"?$("controlReasonOther").value.trim():"",
      postSurgeryResults:$("postSurgeryResults").value.trim(),
      pathologyCharacteristics:$("pathologyCharacteristics").value.trim(),
      pathologyType:$("pathologyType").value.trim(),
      pathologyRemovedDate:$("pathologyRemovedDate").value,
      pathologySentDate:$("pathologySentDate").value,
      pathologyResultRequest:$("pathologyResultRequest").value.trim(),
      notes:$("notes").value.trim()
    };

    const idx=appointments.findIndex(a=>a.id===id);
    if(idx>=0) appointments[idx]=data;
    else appointments.push(data);

    save();

    // Verify that the browser really persisted the record.
    const persisted=JSON.parse(localStorage.getItem(APPT_STORE)||"[]");
    if(!persisted.some(a=>a.id===id)){
      throw new Error("El navegador no confirmó el almacenamiento local.");
    }

    selectedDate=new Date(data.date+"T12:00:00");
    $("modal").classList.add("hidden");
    render();
  }catch(err){
    console.error("Error al guardar actividad:",err);
    if(feedback){
      feedback.textContent="No se pudo guardar. Intenta nuevamente.";
      feedback.classList.add("error");
    }else{
      alert("No se pudo guardar la actividad.");
    }
  }
}

$("appointmentForm").onsubmit=e=>{
  e.preventDefault();
  saveActivityFromForm();
};

$("saveActivityBtn").onclick=saveActivityFromForm;
$("deleteBtn").onclick=()=>{const id=$("editId").value;if(id&&confirm("¿Eliminar esta actividad?")){appointments=appointments.filter(a=>a.id!==id);save();$("modal").classList.add("hidden");render()}};

function switchView(name){
  document.querySelectorAll(".nav-btn").forEach(n=>n.classList.toggle("active",n.dataset.view===name));
  document.querySelectorAll(".view").forEach(v=>v.classList.remove("active-view"));
  $(`${name}View`).classList.add("active-view");
  if(name==="pacientes")renderPatients();
  if(name==="estadisticas"){
    statsDate=new Date(selectedDate.getFullYear(),selectedDate.getMonth(),1);
    renderStats();
  }
}
document.querySelectorAll(".nav-btn").forEach(n=>n.onclick=()=>switchView(n.dataset.view));

$("searchBtn").onclick=()=>{$("searchOverlay").classList.remove("hidden");$("globalSearch").focus();renderGlobal()};
$("closeSearch").onclick=()=>$("searchOverlay").classList.add("hidden");
$("globalSearch").oninput=renderGlobal;
function renderGlobal(){
  const q=$("globalSearch").value.toLowerCase().trim();
  const list=appointments.filter(a=>!q||[a.name,a.dni,a.phone,...normalizePhones(a.phones,a.phone).map(x=>`${x.owner} ${x.number}`),a.surgeryName,a.source,a.sourceOther,a.referredBy].join(" ").toLowerCase().includes(q)).slice(0,20);
  $("globalResults").innerHTML=list.length?list.map(a=>`<div class="result-card"><h3>${esc(a.name)}</h3><p>${esc(a.date)} · ${esc(a.time)} · ${label(a.type)}</p><p>DNI ${esc(a.dni||"—")} · ${esc(phonesDisplay(a.phones,a.phone))}</p></div>`).join(""):`<div class="empty">No se encontraron resultados.</div>`;
}

$("goDateBtn").onclick=()=>{$("jumpDateInput").value=dateKey(selectedDate);$("dateOverlay").classList.remove("hidden")};
$("closeDate").onclick=()=>$("dateOverlay").classList.add("hidden");
$("jumpDateConfirm").onclick=()=>{const v=$("jumpDateInput").value;if(!v)return;selectedDate=new Date(v+"T12:00:00");activeFilter=null;$("dateOverlay").classList.add("hidden");render()};


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
    if($("quickNotes"))$("quickNotes").value=payload.quickNotes||"";
    save();
    render();
    alert("Copia restaurada correctamente.");
  }catch(err){
    alert("No se pudo restaurar la copia. Verifica que el archivo y la clave sean correctos.");
  }
};

render();
initializeSecurity();

