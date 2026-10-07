/* HYDRAULIC PRESS DIGITAL TWIN — app.js
   Sections: 1 Config  2 Data  3 Phase/interp  4 UI build  5 Digital twin  6 Charts  7 Alarms/Reports  8 Playback  9 Init */
"use strict";
// ---------- 1. CONFIG (SI units internally) ----------
const A1 = 0.007854;                       // piston area m²
const MACHINE = {"Cylinder bore":"100 mm","Rod diameter":"50 mm","Motor speed":"1500 rpm","Pump displacement":"62.83 cm³/rev",
  "Pump efficiency":"0.9","Dead load":"2 ton","Holding load":"10 ton","A1 (bore side)":"0.007854 m²","A2 (rod side)":"0.005890 m²"};
const S = {pLimit:170, pVeryHigh:180, vLimit:300, qLow:5, posTol:20, holdTol:5, speed:1}; // alarm limits (user-editable)
const PHASES = [[0,2,"IDLE"],[2,3,"FAST DOWN"],[3,8,"WORKING"],[8,10,"HOLDING"],[10,12,"FAST UP"],[12,1e9,"IDLE"]];
const TARGET = [[0,300],[2,300],[3,100],[8,50],[10,50],[12,300],[14,300]]; // reference stroke (mm) vs time
const VARS = {Position:{k:"stroke",u:"mm"},Velocity:{k:"vmm",u:"mm/s"},Pressure:{k:"pbar",u:"bar"},Flow:{k:"qlpm",u:"L/min"},Force:{k:"fkN",u:"kN"},"Hydraulic Power":{k:"phkW",u:"kW"}};
const $ = id => document.getElementById(id);
let D = [], T = {t:0, playing:false, last:0}, gaugeMax = {};
const AI_API_BASE_URL = window.HYDRAULIC_PRESS_CONFIG && typeof window.HYDRAULIC_PRESS_CONFIG.predictionApiBaseUrl === "string"
  ? window.HYDRAULIC_PRESS_CONFIG.predictionApiBaseUrl.replace(/\/+$/, "")
  : "http://127.0.0.1:5000";
const AI_CLASS_NAMES = ["NORMAL","PUMP_DEGRADATION","CYLINDER_INTERNAL_LEAKAGE","DCV_SPOOL_STICKING","EXCESSIVE_FRICTION","RELIEF_VALVE_FAULT","SENSOR_FAULT"];
let aiMetadata = null, aiServiceOnline = false, aiPredictionInFlight = false, lastAIPredictionAt = 0;

// ---------- 2. DATA ----------
function parseCSV(text){
  const L = text.trim().split(/\r?\n/), h = L[0].split(",").map(s=>s.trim());
  const need = ["Time_s","Position_m","Stroke_mm","Velocity_mps","Pressure_Pa","Flow_m3ps"];
  if (need.some(n=>!h.includes(n))) throw new Error("Missing columns: expected "+need.join(", "));
  const ix = n => h.indexOf(n), rows = [];
  for (let i=1;i<L.length;i++){ const c=L[i].split(",").map(Number); if (c.length<h.length||c.some(isNaN)) continue;
    const p=c[ix("Pressure_Pa")], q=c[ix("Flow_m3ps")], v=c[ix("Velocity_mps")];
    rows.push({t:c[ix("Time_s")], pos:c[ix("Position_m")], stroke:c[ix("Stroke_mm")], v, p, q,
      pbar:p/1e5, qlpm:q*60000, vmm:v*1000, F:p*A1, fkN:p*A1/1000, ph:p*Math.abs(q), phkW:p*Math.abs(q)/1000, pm:p*A1*Math.abs(v)});
  }
  if (rows.length<2) throw new Error("No valid rows"); return rows.sort((a,b)=>a.t-b.t);
}
function setData(text, src){
  try{ D = parseCSV(text); }catch(e){ $("hData").textContent="CSV DATA NOT LOADED"; $("hData").className="bad"; alert("CSV error: "+e.message); return; }
  $("hData").textContent = "CSV: "+D.length+" rows ("+src+")"; $("hData").className="ok";
  const tEnd = D[D.length-1].t; $("slider").max = tEnd; $("rTo").value = $("tTo").value = Math.ceil(tEnd);
  for (const g of GAUGES) gaugeMax[g.key] = Math.max(1, ...D.map(r=>Math.abs(r[g.key]))) * 1.1;
  resetSim(); drawAll();
}
async function autoLoad(){
  try{ const r = await fetch("data/Hydraulic_Press_Data_Combined.csv"); if(!r.ok) throw 0; setData(await r.text(),"data/ folder"); }
  catch(e){ if (window.EMBEDDED_CSV) setData(window.EMBEDDED_CSV,"embedded copy of CSV"); else $("hData").textContent="CSV DATA NOT LOADED — use LOAD CSV FILE"; }
}

// ---------- 3. PHASE + INTERPOLATION ----------
function getPhase(t){ for (const [a,b,n] of PHASES) if (t>=a && t<b) return n; return "IDLE"; }
function targetStroke(t){ for (let i=1;i<TARGET.length;i++) if (t<=TARGET[i][0]){ const [t0,s0]=TARGET[i-1],[t1,s1]=TARGET[i]; return s0+(s1-s0)*(t-t0)/(t1-t0);} return 300; }
/* Linear interpolation between CSV samples (binary search) */
function getCurrentData(t){
  if (!D.length) return null;
  t = Math.min(Math.max(t,D[0].t), D[D.length-1].t);
  let lo=0, hi=D.length-1; while (hi-lo>1){ const m=(lo+hi)>>1; if (D[m].t<=t) lo=m; else hi=m; }
  const a=D[lo], b=D[hi], f=b.t===a.t?0:(t-a.t)/(b.t-a.t), o={t};
  for (const k in a) if (k!=="t") o[k]=a[k]+(b[k]-a[k])*f;
  o.phase=getPhase(t); o.target=targetStroke(t); o.err=o.stroke-o.target; return o;
}

// ---------- 4. UI BUILD ----------
const PAGES=[["dashboard","1 Dashboard"],["live","2 Live Monitoring"],["twin","3 Digital Twin"],["trends","4 Trends"],["alarms","5 Alarm Manager"],["reports","6 Reports"],["pm","7 Predictive Maintenance"],["settings","8 Settings"],["about","9 About"]];
const KPIS=[["Pressure","pbar","bar",1],["Flow","qlpm","L/min",1],["Position","stroke","mm",1],["Velocity","vmm","mm/s",1],["Cylinder force","fkN","kN",0],["Hydraulic power","phkW","kW",1]];
const GAUGES=[{n:"Pressure",key:"pbar",u:"bar"},{n:"Flow",key:"qlpm",u:"L/min"},{n:"Position",key:"stroke",u:"mm"},{n:"Velocity",key:"vmm",u:"mm/s"},{n:"Cylinder Force",key:"fkN",u:"kN"},{n:"Hydraulic Power",key:"phkW",u:"kW"}];
function show(id){ document.querySelectorAll(".page").forEach(p=>p.classList.toggle("on",p.id==="p-"+id));
  document.querySelectorAll("#nav a").forEach(a=>a.classList.toggle("on",a.dataset.p===id)); location.hash=id; setTimeout(()=>{drawAll(); if(id==="twin") Twin3D.resize();},30); }
function setAIServiceOffline(){
  aiServiceOnline = false;
  $("pmServiceStatus").textContent = "OFFLINE";
  $("pmServiceStatus").className = "warn";
  $("pmServiceMessage").textContent = "Start the ML prediction service to enable AI predictions.";
  if (!aiMetadata) $("pmModelStatus").textContent = "UNAVAILABLE";
  $("pmPrediction").textContent = "—";
  $("pmConfidence").textContent = "—";
  $("pmHealth").textContent = "—";
  $("pmProbabilities").textContent = "No live probabilities available.";
  $("pmPredictionUpdated").textContent = "No live prediction available.";
}
async function fetchAIJSON(path, options={}){
  const controller = new AbortController();
  const timeout = setTimeout(()=>controller.abort(), 4000);
  try{
    const response = await fetch(AI_API_BASE_URL+path, {...options, signal:controller.signal});
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || `ML service returned HTTP ${response.status}`);
    return body;
  }finally{ clearTimeout(timeout); }
}
async function checkAIService(){
  try{
    const metadata = await fetchAIJSON("/metadata");
    if (metadata.model_name !== "Random Forest Classifier" ||
        metadata.feature_names.join(",") !== "Time_s,Position_m,Stroke_mm,Velocity_mps,Pressure_Pa,Flow_m3ps" ||
        metadata.class_names.join(",") !== AI_CLASS_NAMES.join(",") ||
        !Number.isFinite(metadata.accuracy) || !Number.isFinite(metadata.f1_score)){
      throw new Error("The ML service returned invalid model metadata.");
    }
    aiMetadata = metadata;
    aiServiceOnline = true;
    $("pmServiceStatus").textContent = "ONLINE";
    $("pmServiceStatus").className = "ok";
    $("pmServiceMessage").textContent = "";
    $("pmModelStatus").textContent = "TRAINED";
    $("pmModelStatus").className = "ok";
    $("pmModelName").textContent = metadata.model_name;
    $("pmAccuracy").textContent = `${(metadata.accuracy*100).toFixed(2)}%`;
    $("pmF1").textContent = `${(metadata.f1_score*100).toFixed(2)}%`;
  }catch(error){
    console.warn("ML prediction service unavailable:", error);
    setAIServiceOffline();
  }
}
function renderAIPrediction(result){
  if (!AI_CLASS_NAMES.includes(result.prediction) ||
      !Number.isFinite(result.confidence) ||
      !result.probabilities || AI_CLASS_NAMES.some(name=>!Number.isFinite(result.probabilities[name]))){
    throw new Error("The ML service returned an invalid prediction.");
  }
  $("pmPrediction").textContent = result.prediction;
  $("pmConfidence").textContent = `${(result.confidence*100).toFixed(2)}%`;
  const highestFaultProbability = Math.max(...AI_CLASS_NAMES.filter(name=>name!=="NORMAL").map(name=>result.probabilities[name]));
  const health = Math.max(0, Math.min(100, 100*(1-highestFaultProbability)));
  $("pmHealth").textContent = `${health.toFixed(1)}%`;
  const probabilities = $("pmProbabilities");
  probabilities.replaceChildren(...AI_CLASS_NAMES.map(name=>{
    const item = document.createElement("span");
    item.textContent = `${name.replaceAll("_"," ")}: ${(result.probabilities[name]*100).toFixed(2)}%`;
    return item;
  }));
  $("pmPredictionUpdated").textContent = `Updated ${new Date().toLocaleTimeString()}`;
}
async function requestAIPrediction(d){
  if (!d || aiPredictionInFlight) return;
  const now = Date.now();
  const interval = aiServiceOnline ? 750 : 5000;
  if (now-lastAIPredictionAt < interval) return;
  lastAIPredictionAt = now;
  aiPredictionInFlight = true;
  try{
    const result = await fetchAIJSON("/predict", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        Time_s:d.t, Position_m:d.pos, Stroke_mm:d.stroke,
        Velocity_mps:d.v, Pressure_Pa:d.p, Flow_m3ps:d.q
      })
    });
    renderAIPrediction(result);
    aiServiceOnline = true;
    $("pmServiceStatus").textContent = "ONLINE";
    $("pmServiceStatus").className = "ok";
    $("pmServiceMessage").textContent = "";
  }catch(error){
    console.warn("ML prediction request failed:", error);
    setAIServiceOffline();
  }finally{ aiPredictionInFlight = false; }
}
function buildUI(){
  $("nav").innerHTML = PAGES.map(([id,n])=>`<a data-p="${id}">${n}</a>`).join("");
  $("nav").onclick = e => e.target.dataset.p && show(e.target.dataset.p);
  $("kpis").innerHTML = KPIS.map(([n,k,u])=>`<div class="kpi"><span>${n.toUpperCase()} (${u})</span><b id="k_${k}">—</b></div>`).join("");
  $("gauges").innerHTML = GAUGES.map(g=>`<div class="card gauge"><label>${g.n.toUpperCase()}</label><svg viewBox="0 0 160 100"><path d="M10 85 A70 70 0 0 1 150 85" fill="none" stroke="#2a3445" stroke-width="12"/>
    <path id="g_${g.key}" d="M10 85 A70 70 0 0 1 150 85" fill="none" stroke="#4fd1c5" stroke-width="12" stroke-dasharray="0 220"/></svg><b id="gv_${g.key}">—</b></div>`).join("");
  $("spd").innerHTML = [0.25,0.5,1,2].map(s=>`<button data-s="${s}" class="${s===1?"sel":""}">${s}×</button>`).join("");
  $("spd").onclick = e => { if(e.target.dataset.s){ S.speed=+e.target.dataset.s; syncSpeed(); } };
  $("tvars").innerHTML = Object.keys(VARS).map((n,i)=>`<label style="display:inline-block;margin-right:14px"><input type="checkbox" value="${n}" ${i<1?"checked":""}> ${n}</label>`).join("");
  $("tvars").onchange = drawTrends;
  const f=[["pLimit","High pressure limit (bar)"],["pVeryHigh","Very high pressure (bar)"],["vLimit","Velocity limit (mm/s)"],["qLow","Low flow limit (L/min, moving phases)"],["posTol","Position tolerance (mm)"],["holdTol","Holding tolerance (mm)"]];
  $("setForm").innerHTML = f.map(([k,n])=>`<div><label>${n}</label><input type="number" data-k="${k}" value="${S[k]}"></div>`).join("")
    + `<div><label>Animation speed</label><select id="selSpd">${[0.25,0.5,1,2].map(s=>`<option ${s===1?"selected":""}>${s}</option>`).join("")}</select></div>`;
  $("setForm").onchange = e => { if(e.target.dataset.k) S[e.target.dataset.k]=+e.target.value; if(e.target.id==="selSpd"){S.speed=+e.target.value; syncSpeed();} drawAll(); };
  $("machTbl").innerHTML = Object.entries(MACHINE).map(([k,v])=>`<tr><td>${k}</td><td>${v}</td></tr>`).join("");
  $("csvFile").onchange = e => { const f=e.target.files[0]; if(f){ const r=new FileReader(); r.onload=()=>setData(r.result,f.name); r.readAsText(f);} };
  $("bPlay").onclick=$("bStart").onclick=playSim; $("bPause").onclick=$("bStop").onclick=pauseSim; $("bRst").onclick=$("bReset").onclick=resetSim;
  $("slider").oninput = e => setSimTime(+e.target.value);
  $("rApply").onclick = drawDash; $("rAll").onclick = ()=>{ $("rFrom").value=0; $("rTo").value=Math.ceil(D[D.length-1].t); drawDash(); };
  $("tApply").onclick = drawTrends;
  $("bCsv").onclick = exportCSV; $("bPrint").onclick = ()=>{ show("reports"); window.print(); }; $("bHtml").onclick = downloadReport;
}
function syncSpeed(){ document.querySelectorAll("#spd button").forEach(b=>b.classList.toggle("sel",+b.dataset.s===S.speed)); $("selSpd").value=S.speed; }

// ---------- 5. DIGITAL TWIN ----------
let flowOff=0;
const led=(c,t)=>`<div><span class="led ${c}"></span>${t}</div>`;
function updateDigitalTwin(d){
  if(!d) return;
  // Direction: CSV flow is negative in BOTH strokes (Hopsan sign convention), so direction comes from ram velocity; |flow| gives speed.
  d.flowOn = d.phase!=="IDLE" && Math.abs(d.qlpm)>0.5;                 // HOLD (~0.1 L/min) and IDLE -> no flow, valve neutral
  d.dir = d.vmm<-1 ? 1 : d.vmm>1 ? -1 : (d.phase==="FAST UP"?-1:1);     // +1 extend (down), -1 retract (up)
  d.dcv = d.flowOn ? (d.dir>0?"FORWARD":"REVERSE") : "NEUTRAL";
  $("tPos").textContent=`RAM POSITION: ${d.stroke.toFixed(1)} mm`; $("tPh").textContent=`CURRENT PHASE: ${d.phase}`;
  $("mini").innerHTML = [["Position",d.stroke.toFixed(1)+" mm"],["Velocity",d.vmm.toFixed(1)+" mm/s"],["Pressure",d.pbar.toFixed(1)+" bar"],["Flow",d.qlpm.toFixed(1)+" L/min"],["Force",d.fkN.toFixed(0)+" kN"],["Power",d.phkW.toFixed(1)+" kW"],["Phase",d.phase]]
    .map(([n,v])=>`<div>${n}<b>${v}</b></div>`).join("");
  Twin3D.update(d);
}
function animateLines(){}   // fluid particles are animated inside twin3d.js

// ---------- 6. DASHBOARD / LIVE / CHARTS ----------
function updateLive(d){
  if(!d) return;
  KPIS.forEach(([n,k,u,dec])=>$("k_"+k).textContent=d[k].toFixed(dec));
  GAUGES.forEach(g=>{ const f=Math.min(1,Math.abs(d[g.key])/(gaugeMax[g.key]||1)); $("g_"+g.key).setAttribute("stroke-dasharray",`${f*220} 220`);
    $("g_"+g.key).setAttribute("stroke", g.key==="pbar"&&d.pbar>S.pLimit?"#f56565":"#4fd1c5"); $("gv_"+g.key).textContent=d[g.key].toFixed(1)+" "+g.u; });
  const hi = d.pbar>S.pLimit, vh = Math.abs(d.vmm)>S.vLimit;
  $("hPhase").textContent=d.phase; $("hTime").textContent=d.t.toFixed(1)+" s";
  $("hStatus").textContent = hi?"WARNING":(T.playing&&d.phase!=="IDLE"?"RUNNING":"IDLE"); $("hStatus").className = hi?"warn":(T.playing?"ok":"");
  $("status").innerHTML = led(d.phase==="IDLE"?"x":"g","Pump: "+(d.phase==="IDLE"?"IDLE":"ACTIVE"))
    + led(d.phase==="FAST DOWN"||d.phase==="WORKING"?"g":d.phase==="FAST UP"?"g":"y","4/3 DCV: "+(["FAST DOWN","WORKING"].includes(d.phase)?"EXTEND":d.phase==="FAST UP"?"RETRACT":"NEUTRAL"))
    + led(Math.abs(d.vmm)>2?"g":"y","Cylinder: "+(Math.abs(d.vmm)>2?"MOVING":"STATIONARY"))
    + led(hi||vh?"y":"g","Safety (monitoring): "+(hi||vh?"ENGINEERING REVIEW":"NORMAL"));
}
const LAY = {paper_bgcolor:"#161d27",plot_bgcolor:"#0f151d",font:{color:"#d8e0ec",size:11},margin:{l:55,r:15,t:30,b:35},xaxis:{title:"Time (s)",gridcolor:"#2a3445"},showlegend:false};
function cursorShape(){ return [{type:"line",x0:T.t,x1:T.t,yref:"paper",y0:0,y1:1,line:{color:"#f6ad55",width:1}}]; }
function drawDash(){
  if(!D.length) return; const a=+$("rFrom").value,b=+$("rTo").value, r=D.filter(x=>x.t>=a&&x.t<=b);
  [["c1","stroke","Position (mm)"],["c2","pbar","Pressure (bar)"],["c3","qlpm","Flow (L/min)"],["c4","vmm","Velocity (mm/s)"]].forEach(([id,k,t])=>
    Plotly.react(id,[{x:r.map(x=>x.t),y:r.map(x=>x[k]),type:"scatter",mode:"lines",line:{color:"#4fd1c5"}}],{...LAY,title:{text:t,font:{size:13}},height:260,shapes:cursorShape()},{displaylogo:false,responsive:true}));
}
function drawTrends(){
  if(!D.length) return; const sel=[...$("tvars").querySelectorAll("input:checked")].map(i=>i.value); if(!sel.length) return;
  const a=+$("tFrom").value,b=+$("tTo").value, r=D.filter(x=>x.t>=a&&x.t<=b), n=sel.length, lay={...LAY,showlegend:false,height:560,margin:{l:60,r:15,t:15,b:40},shapes:cursorShape(),hovermode:"x unified"};
  const tr=sel.map((name,i)=>{ const key=i?i+1:""; lay["yaxis"+key]={domain:[1-(i+1)/n+0.03,1-i/n-0.01],title:`${name} (${VARS[name].u})`,gridcolor:"#2a3445"};
    return {x:r.map(x=>x.t),y:r.map(x=>x[VARS[name].k]),name,type:"scatter",mode:"lines",xaxis:"x",yaxis:"y"+key}; });
  lay.xaxis={title:"Time (s)",gridcolor:"#2a3445",anchor:"y"+(n>1?n:"")}; // all share x; plotly shows axis at bottom
  Plotly.react("tchart",tr,lay,{displaylogo:false,responsive:true});
}
function drawAll(){ if(!D.length) return; const p=document.querySelector(".page.on").id;
  if(p==="p-dashboard") drawDash(); if(p==="p-trends") drawTrends(); if(p==="p-alarms") drawAlarms(); if(p==="p-reports") drawReport(); refresh(); }
function moveCursor(){ const p=document.querySelector(".page.on").id; const id=p==="p-dashboard"?["c1","c2","c3","c4"]:p==="p-trends"?["tchart"]:[];
  id.forEach(i=>{ if($(i).data) Plotly.relayout(i,{shapes:cursorShape()}); }); }

// ---------- 7. ALARMS + REPORTS ----------
function computeAlarms(){
  const out=[], add=(name,test,val,lim,sev,unit)=>{ let first=null,peak=null;
    for(const r of D){ if(test(r)){ const v=val(r); if(!first) first=r; if(peak===null||Math.abs(v)>Math.abs(peak.v)) peak={v,t:r.t}; } }
    if(first) out.push({t:first.t,name,value:peak.v.toFixed(1)+" "+unit+" @ "+peak.t.toFixed(1)+" s",limit:lim+" "+unit,sev,status:"ACTIVE (in data) — engineering review required"}); };
  add("HIGH PRESSURE",r=>r.pbar>S.pLimit,r=>r.pbar,S.pLimit,"WARNING","bar");
  add("VERY HIGH PRESSURE",r=>r.pbar>S.pVeryHigh,r=>r.pbar,S.pVeryHigh,"CRITICAL","bar");
  add("HIGH VELOCITY",r=>Math.abs(r.vmm)>S.vLimit,r=>r.vmm,S.vLimit,"WARNING","mm/s");
  add("LOW FLOW (moving phase)",r=>["FAST DOWN","FAST UP"].includes(getPhase(r.t))&&Math.abs(r.qlpm)<S.qLow,r=>r.qlpm,S.qLow,"INFO","L/min");
  add("POSITION ERROR",r=>Math.abs(r.stroke-targetStroke(r.t))>S.posTol,r=>r.stroke-targetStroke(r.t),S.posTol,"WARNING","mm");
  add("HOLDING POSITION DRIFT",r=>getPhase(r.t)==="HOLDING"&&Math.abs(r.stroke-50)>S.holdTol,r=>r.stroke-50,S.holdTol,"WARNING","mm");
  return out;
}
function drawAlarms(){ const a=computeAlarms(), tb=document.querySelector("#alarmTbl tbody");
  tb.innerHTML = a.length? a.map(x=>`<tr><td>${x.t.toFixed(1)} s</td><td>${x.name}</td><td>${x.value}</td><td>${x.limit}</td><td class="${x.sev}">● ${x.sev}</td><td>${x.status}</td></tr>`).join("") : `<tr><td colspan="6" class="ok">No alarms in loaded data</td></tr>`; }
const avg=k=>D.reduce((s,r)=>s+r[k],0)/D.length, mx=k=>Math.max(...D.map(r=>Math.abs(r[k])));
function stats(){ if(!D.length) return []; return [["Cycle duration",(D[D.length-1].t-D[0].t).toFixed(1)+" s"],["Maximum pressure",Math.max(...D.map(r=>r.pbar)).toFixed(1)+" bar"],["Average pressure",avg("pbar").toFixed(1)+" bar"],
  ["Maximum flow (abs)",mx("qlpm").toFixed(1)+" L/min"],["Average flow (abs)",(D.reduce((s,r)=>s+Math.abs(r.qlpm),0)/D.length).toFixed(1)+" L/min"],["Maximum velocity (abs)",mx("vmm").toFixed(1)+" mm/s"],
  ["Maximum force",Math.max(...D.map(r=>r.fkN)).toFixed(0)+" kN"],["Maximum hydraulic power",mx("phkW").toFixed(1)+" kW"],["Maximum mechanical power",(mx("pm")/1000).toFixed(1)+" kW"],
  ["Max |position error| vs reference",Math.max(...D.map(r=>Math.abs(r.stroke-targetStroke(r.t)))).toFixed(1)+" mm"],["Minimum stroke",Math.min(...D.map(r=>r.stroke)).toFixed(1)+" mm"]]; }
function phaseTable(){ return PHASES.slice(0,5).map(([a,b,n])=>{ const r=D.filter(x=>x.t>=a&&x.t<b); if(!r.length) return ""; const m=k=>Math.max(...r.map(x=>x[k]));
  return `<tr><td>${n}</td><td>${a}–${b} s</td><td>${m("pbar").toFixed(1)} bar</td><td>${Math.max(...r.map(x=>Math.abs(x.qlpm))).toFixed(1)} L/min</td><td>${r[0].stroke.toFixed(0)} → ${r[r.length-1].stroke.toFixed(0)} mm</td></tr>`; }).join(""); }
function reportHTML(){ return `<h2>Cycle performance summary</h2><table>${stats().map(([k,v])=>`<tr><td>${k}</td><td><b>${v}</b></td></tr>`).join("")}</table>
  <h3>Per-phase summary</h3><table><tr><th>Phase</th><th>Time</th><th>Max pressure</th><th>Max |flow|</th><th>Stroke</th></tr>${phaseTable()}</table>
  <p class="note">Simulation/engineering monitoring only. Pressure above ${S.pLimit} bar requires engineering review.</p>`; }
function drawReport(){ $("repTbl").innerHTML = D.length? reportHTML() : "CSV DATA NOT LOADED"; }
function download(name,txt,type){ const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([txt],{type})); a.download=name; a.click(); }
function exportCSV(){ if(!D.length) return; const h="Time_s,Stroke_mm,Velocity_mmps,Pressure_bar,Flow_Lpm,Force_kN,HydraulicPower_kW,MechanicalPower_kW,Phase";
  download("press_derived.csv",h+"\n"+D.map(r=>[r.t,r.stroke,r.vmm,r.pbar,r.qlpm,r.fkN,r.phkW,r.pm/1000,getPhase(r.t)].join(",")).join("\n"),"text/csv"); }
function downloadReport(){ if(!D.length) return; download("press_report.html",`<html><body style="font-family:Arial">${reportHTML()}</body></html>`,"text/html"); }

// ---------- 8. PLAYBACK ----------
function refresh(){ const d=getCurrentData(T.t); if(!d) return; updateDigitalTwin(d); updateLive(d); requestAIPrediction(d);
  $("slider").value=T.t; $("sTime").textContent=T.t.toFixed(2)+" s"; return d; }
function setSimTime(t){ T.t=Math.max(0,Math.min(t,D.length?D[D.length-1].t:14)); refresh(); moveCursor(); }
function playSim(){ if(!D.length) return alert("CSV DATA NOT LOADED"); if(T.t>=D[D.length-1].t) T.t=0; T.playing=true; T.last=performance.now(); requestAnimationFrame(loop); }
function pauseSim(){ T.playing=false; refresh(); }
function resetSim(){ T.playing=false; $("hCycle").textContent=1; setSimTime(0); }
let lastCur=0;
function loop(now){
  if(!T.playing) return; T.t += (now-T.last)/1000*S.speed; T.last=now;
  const end=D[D.length-1].t; if(T.t>=end){ T.t=end; T.playing=false; }
  const d=refresh(); animateLines(d); if(now-lastCur>120){ moveCursor(); lastCur=now; }
  requestAnimationFrame(loop);
}

// ---------- 9. INIT ----------
const initialPage = (location.hash || "#dashboard").slice(1);
buildUI(); Twin3D.init(); show(initialPage in {dashboard:1,live:1,twin:1,trends:1,alarms:1,reports:1,pm:1,settings:1,about:1} ? initialPage : "dashboard"); checkAIService(); setInterval(checkAIService,5000); autoLoad();
