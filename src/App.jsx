import { useState, useCallback, useRef, useEffect } from "react";

// ══════════════════════════════════════════════════════════════
// ENV — injected by Netlify at build time
// ══════════════════════════════════════════════════════════════
const ENV_TOKEN   = import.meta.env.VITE_GITHUB_TOKEN  || "";
const ENV_REPO    = import.meta.env.VITE_GITHUB_REPO   || "cball8475/cball8475.github.io";
const ENV_GPLACES = import.meta.env.VITE_GOOGLE_PLACES_KEY || "";

// ══════════════════════════════════════════════════════════════
// GITHUB API
// ══════════════════════════════════════════════════════════════
class GH {
  constructor(token, repo) {
    this.token = token; this.repo = repo;
    this.h = { Authorization:`Bearer ${token}`, Accept:"application/vnd.github+json", "X-GitHub-Api-Version":"2022-11-28" };
  }
  async req(path, opts={}) {
    const r = await fetch(`https://api.github.com${path}`, { headers: this.h, ...opts });
    if (!r.ok) { const e = await r.json().catch(()=>{}); throw new Error(e?.message||`HTTP ${r.status}`); }
    return r.json();
  }
  ping()       { return this.req(`/repos/${this.repo}`); }
  ls()         { return this.req(`/repos/${this.repo}/contents`); }
  getFile(p)   { return this.req(`/repos/${this.repo}/contents/${p}`); }
  lastCommit() { return this.req(`/repos/${this.repo}/commits?per_page=1`); }
  async readFile(p) {
    const d = await this.getFile(p);
    return { content: decodeURIComponent(escape(atob(d.content.replace(/\n/g,"")))), sha: d.sha };
  }
  async write(p, content, sha, msg) {
    const enc = btoa(unescape(encodeURIComponent(content)));
    const body = { message: msg, content: enc, ...(sha ? { sha } : {}) };
    return this.req(`/repos/${this.repo}/contents/${p}`, { method:"PUT", body:JSON.stringify(body) });
  }
  async readJSON(p) {
    try {
      const { content, sha } = await this.readFile(p);
      return { data: JSON.parse(content), sha };
    } catch(e) {
      if (e.message.includes("404") || e.message.includes("Not Found")) return { data: null, sha: null };
      throw e;
    }
  }
  async writeJSON(p, data, sha, msg) {
    const res = await this.write(p, JSON.stringify(data, null, 2), sha, msg);
    return res.content?.sha || sha;
  }
}

// ══════════════════════════════════════════════════════════════
// LOCALSTORAGE — fast cache only, GitHub is source of truth
// ══════════════════════════════════════════════════════════════
function lsGet(key)       { try { const v=localStorage.getItem(key); return v?JSON.parse(v):null; } catch{ return null; } }
function lsSet(key, val)  { try { localStorage.setItem(key, JSON.stringify(val)); } catch(e) { console.warn("lsSet failed",key,e); } }

// ══════════════════════════════════════════════════════════════
// SHARED HELPERS & STYLES
// ══════════════════════════════════════════════════════════════
const EDITABLE  = [".html",".css",".js",".md",".txt",".xml",".json",".svg"];
const canEdit   = n => EDITABLE.some(e=>n.endsWith(e)) || ["CNAME","robots.txt"].includes(n);
const fileEmoji = n => n.endsWith(".html")?"🌐":n.endsWith(".css")?"🎨":n.endsWith(".js")?"⚡":n.endsWith(".md")?"📄":n.endsWith(".xml")?"📋":n==="CNAME"?"🌍":"📄";
const kb        = b => b<1024?`${b}B`:`${(b/1024).toFixed(1)}KB`;
const cleanPhone = p => p ? p.replace(/\D/g,"") : "";

function ago(iso) {
  if(!iso) return ""; const s=(Date.now()-new Date(iso))/1000;
  if(s<60) return `${~~s}s ago`; if(s<3600) return `${~~(s/60)}m ago`; if(s<86400) return `${~~(s/3600)}h ago`; return `${~~(s/86400)}d ago`;
}
function fmtDate(iso) {
  if(!iso) return "";
  return new Date(iso).toLocaleDateString("en-US",{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"});
}

const C = {
  dark:"#070d14", panel:"#0e1a26", card:"#142031",
  border:"rgba(99,179,237,0.12)", muted:"rgba(200,223,240,0.4)", text:"#c8dff0",
  green:"#22c55e", amber:"#f59e0b", blue:"#38bdf8", red:"#ef4444", purple:"#a78bfa",
};
const inp = { width:"100%", boxSizing:"border-box", padding:"0.55rem 0.8rem",
  background:"rgba(0,0,0,0.3)", border:`1.5px solid ${C.border}`, borderRadius:8,
  color:C.text, fontSize:13, fontFamily:"inherit", outline:"none" };
const btnBase = { display:"inline-flex", alignItems:"center", gap:"0.4rem", border:"none",
  borderRadius:7, cursor:"pointer", fontWeight:700, fontFamily:"inherit", transition:"opacity .15s",
  whiteSpace:"nowrap" };

// ══════════════════════════════════════════════════════════════
// LEAD SCORING
// ══════════════════════════════════════════════════════════════
function scoreLeadObj(l) {
  let s=0;
  if(l.phone) s+=25; if(l.email) s+=10;
  const high=["40yd","30yd","demolition","construction","commercial","roofing"];
  const med =["20yd","junk removal","renovation","cleanout"];
  const svc=(l.service||"").toLowerCase();
  if(high.some(k=>svc.includes(k))) s+=30; else if(med.some(k=>svc.includes(k))) s+=20; else if(l.service) s+=10;
  if((l.city||"").toLowerCase().includes("florence")) s+=20; else if(l.city) s+=10;
  const ml=(l.message||"").length; if(ml>80) s+=15; else if(ml>20) s+=8;
  if(l.source==="organic") s+=10; if(l.source==="direct") s+=5;
  return Math.min(s,100);
}
const scoreColor = s => s>=75?C.green:s>=45?C.amber:C.red;
const scoreLabel = s => s>=75?"🔥 Hot":s>=45?"⚡ Warm":"❄️ Cold";

// ══════════════════════════════════════════════════════════════
// BUYER CRM — CONFIG
// ══════════════════════════════════════════════════════════════
const STAGES=["prospect","contacted","pilot_offered","pilot_active","closed","dead"];
const STAGE_LABELS={prospect:"🎯 Prospect",contacted:"📞 Contacted",pilot_offered:"🎁 Pilot Offered",pilot_active:"⚡ Pilot Active",closed:"💰 Closed",dead:"💀 Dead"};
const STAGE_COLORS={prospect:C.blue,contacted:C.amber,pilot_offered:C.purple,pilot_active:"#06b6d4",closed:C.green,dead:"#6b7280"};

function qualifyScore(biz) {
  let s=0;
  if((biz.rating||0)>=4.5) s+=30; else if((biz.rating||0)>=4.0) s+=15;
  const r=biz.user_ratings_total||0;
  if(r>=20&&r<=150) s+=25; else if(r>150) s+=10;
  if(biz.formatted_phone_number) s+=20;
  if(biz.website) s+=10; else s+=5;
  return Math.min(s,100);
}

const SEED_PROSPECTS=[
  {place_id:"p1",name:"Lou's Contracting LLC",rating:5.0,user_ratings_total:11,formatted_phone_number:"(843) 319-8508",website:"louscontracting.com",vicinity:"1615 Misty View Ln, Florence, SC",notes:"Top target — 5 stars, active contractor"},
  {place_id:"p2",name:"SOMO Trash LLC",rating:5.0,user_ratings_total:22,formatted_phone_number:"(843) 307-3413",website:null,vicinity:"150 Nez Perce Dr, Darlington, SC",notes:"Personal contact — easiest first buyer"},
  {place_id:"p3",name:"Timmons Waste Service",rating:4.2,user_ratings_total:32,formatted_phone_number:"(843) 393-4884",website:"timmonswaste.com",vicinity:"433 Lawson Rd, Darlington, SC",notes:"Most reviews in area — established"},
  {place_id:"p4",name:"Florence Co. Recycling",rating:4.4,user_ratings_total:31,formatted_phone_number:"(843) 665-3050",website:null,vicinity:"359 S Ebenezer Rd, Florence, SC",notes:"No website — needs leads badly"},
  {place_id:"p5",name:"S&P Container Service",rating:3.5,user_ratings_total:8,formatted_phone_number:"(843) 673-0404",website:null,vicinity:"220 W Ashby Rd, Florence, SC",notes:"Lower rating — opportunity to sell quality leads"},
];

// ══════════════════════════════════════════════════════════════
// OUTREACH — via Cloudflare Worker proxy
// ══════════════════════════════════════════════════════════════
async function generateOutreach(biz, type) {
  const prompts={
    email:`Write a short punchy cold outreach email for a local lead gen business reaching "${biz.name}" in Florence SC. They do dumpster rental. We offer 2 FREE exclusive leads as a pilot, no credit card. Tone: direct, confident, not salesy. Max 120 words. Include subject line. Format: Subject: [subject]\n\n[body]`,
    coldcall:`Write a 60-second cold call script for calling "${biz.name}" (dumpster rental, Florence SC). We offer 2 free exclusive leads, pilot program, one partner per area. Tone: casual, confident, local. Include one objection handler for "not interested". Under 150 words.`,
    sms:`Write a brief friendly SMS to "${biz.name}" dumpster rental in Florence SC about our free pilot leads. Max 2 sentences. Sound human.`,
    letter:`Write 3-4 sentences for a physical letter to "${biz.name}" in Florence SC about our exclusive local lead gen pilot for dumpster rentals. Mention their strong local reputation. Professional but warm.`,
  };
  const res = await fetch("https://florence-outreach.cball8475.workers.dev", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:1000,messages:[{role:"user",content:prompts[type]}]}),
  });
  const data = await res.json();
  return data.content?.[0]?.text || "Error generating content.";
}

// ══════════════════════════════════════════════════════════════
// GOOGLE PLACES SEARCH
// ══════════════════════════════════════════════════════════════
async function searchGooglePlaces(keyword, location, apiKey) {
  const res = await fetch(`https://places.googleapis.com/v1/places:searchText`, {
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":"places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.rating,places.userRatingCount,places.websiteUri"
    },
    body: JSON.stringify({
      textQuery:`${keyword} near ${location}`, maxResultCount:20,
      locationBias:{ circle:{ center:{latitude:34.1954,longitude:-79.7626}, radius:50000 } }
    })
  });
  if(!res.ok) { const e=await res.json().catch(()=>{}); throw new Error(`Places API ${res.status}: ${e?.error?.message||res.status}`); }
  const data = await res.json();
  return (Array.isArray(data.places)?data.places:[]).map(p=>({
    place_id: String(p.id||"p_"+Math.random().toString(36).slice(2)),
    name: p.displayName?.text||"Unknown",
    formatted_phone_number: p.nationalPhoneNumber||null,
    vicinity: p.formattedAddress||"",
    rating: typeof p.rating==="number"?p.rating:0,
    user_ratings_total: typeof p.userRatingCount==="number"?p.userRatingCount:0,
    website: p.websiteUri||null,
    notes:""
  })).filter(Boolean);
}

// ══════════════════════════════════════════════════════════════
// LEADS DASHBOARD
// ══════════════════════════════════════════════════════════════
function LeadsDashboard({gh, flash}) {
  const [leads,setLeads]     = useState(null);
  const [sha,setSha]         = useState(null);
  const [loading,setLoading] = useState(false);
  const [filter,setFilter]   = useState("all");
  const [search,setSearch]   = useState("");
  const [selected,setSelected] = useState(null);
  const [err,setErr]         = useState("");

  useEffect(()=>{ if(gh) loadLeads(); },[gh]);

  async function loadLeads() {
    setLoading(true); setErr("");
    try {
      const {content,sha:s} = await gh.readFile("data/leads.json");
      const parsed = JSON.parse(content);
      const scored = parsed.map(l=>({...l,score:l.score??scoreLeadObj(l)})).sort((a,b)=>b.score-a.score);
      setLeads(scored); setSha(s);
    } catch(e) {
      if(e.message.includes("404")||e.message.includes("Not Found")) {
        await gh.write("data/leads.json","[]",null,"Initialize leads database");
        setLeads([]); flash("Created data/leads.json ✅");
      } else { setErr(e.message); }
    }
    setLoading(false);
  }

  async function markContacted(id) {
    const updated = leads.map(l=>l.id===id?{...l,contacted:true,contactedAt:new Date().toISOString()}:l);
    const {sha:s} = await gh.readFile("data/leads.json");
    await gh.write("data/leads.json",JSON.stringify(updated,null,2),s,"Mark lead contacted");
    setLeads(updated); setSha(s); flash("Marked as contacted ✅");
  }

  async function deleteLead(id) {
    if(!confirm("Delete this lead?")) return;
    const updated = leads.filter(l=>l.id!==id);
    await gh.write("data/leads.json",JSON.stringify(updated,null,2),sha,"Delete lead");
    setLeads(updated); setSelected(null); flash("Lead deleted");
  }

  const filtered=(leads||[]).filter(l=>{
    const s=l.score||0;
    if(filter==="hot"&&s<75) return false;
    if(filter==="warm"&&(s<45||s>=75)) return false;
    if(filter==="cold"&&s>=45) return false;
    if(search&&!JSON.stringify(l).toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const hot   = (leads||[]).filter(l=>(l.score||0)>=75).length;
  const warm  = (leads||[]).filter(l=>(l.score||0)>=45&&(l.score||0)<75).length;
  const cold  = (leads||[]).filter(l=>(l.score||0)<45).length;
  const today = (leads||[]).filter(l=>l.date&&new Date(l.date).toDateString()===new Date().toDateString()).length;

  if(!leads) return (
    <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:"1rem"}}>
      {loading
        ? <><div style={{fontSize:36,animation:"pulse 1s infinite"}}>⏳</div><div style={{fontSize:14,color:C.muted}}>Loading leads…</div></>
        : <><div style={{fontSize:48}}>📊</div>
            <div style={{fontSize:16,color:"#fff",fontWeight:700}}>Leads Dashboard</div>
            <div style={{fontSize:13,color:C.muted}}>Reads from <code style={{background:C.card,padding:"2px 6px",borderRadius:4}}>data/leads.json</code></div>
            {err&&<div style={{color:"#fca5a5",fontSize:12}}>⚠️ {err}</div>}
            <button onClick={loadLeads} style={{...btnBase,background:C.green,color:"#fff",padding:"0.6rem 1.5rem",fontSize:14}}>Load Leads →</button>
          </>
      }
    </div>
  );

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{display:"flex",gap:"0.65rem",padding:"0.75rem 1rem",borderBottom:`1px solid ${C.border}`,flexShrink:0}}>
        {[{label:"Total",value:(leads||[]).length,color:C.blue},{label:"Today",value:today,color:C.blue},
          {label:"🔥 Hot",value:hot,color:C.green},{label:"⚡ Warm",value:warm,color:C.amber},{label:"❄️ Cold",value:cold,color:C.muted}
        ].map(s=>(
          <div key={s.label} style={{background:C.card,borderRadius:10,padding:"0.55rem 0.85rem",flex:1,textAlign:"center",border:`1px solid ${C.border}`}}>
            <div style={{fontSize:18,fontWeight:800,color:s.color}}>{s.value}</div>
            <div style={{fontSize:9,color:C.muted,marginTop:2}}>{s.label}</div>
          </div>
        ))}
        <button onClick={loadLeads} style={{...btnBase,background:"rgba(255,255,255,0.06)",color:C.muted,padding:"0 0.7rem",fontSize:12}}>↺</button>
      </div>
      <div style={{display:"flex",flex:1,overflow:"hidden"}}>
        <div style={{width:300,borderRight:`1px solid ${C.border}`,display:"flex",flexDirection:"column",flexShrink:0}}>
          <div style={{padding:"0.55rem",borderBottom:`1px solid ${C.border}`,display:"flex",flexDirection:"column",gap:"0.35rem"}}>
            <input style={{...inp,padding:"0.35rem 0.6rem",fontSize:12}} placeholder="Search…" value={search} onChange={e=>setSearch(e.target.value)}/>
            <div style={{display:"flex",gap:"0.25rem"}}>
              {["all","hot","warm","cold"].map(f=>(
                <button key={f} onClick={()=>setFilter(f)}
                  style={{...btnBase,flex:1,justifyContent:"center",padding:"0.2rem",fontSize:10,
                    background:filter===f?"rgba(255,255,255,0.1)":"transparent",
                    color:filter===f?"#fff":C.muted,border:`1px solid ${filter===f?"rgba(255,255,255,0.2)":"transparent"}`}}>
                  {f.charAt(0).toUpperCase()+f.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div style={{flex:1,overflowY:"auto"}}>
            {filtered.length===0
              ? <div style={{padding:"2rem",textAlign:"center",color:C.muted,fontSize:13}}>No leads</div>
              : filtered.map(lead=>{
                  const s=lead.score||0; const isSel=selected?.id===lead.id;
                  return (
                    <div key={lead.id} onClick={()=>setSelected(lead)}
                      style={{padding:"0.65rem",borderBottom:`1px solid ${C.border}`,cursor:"pointer",
                        background:isSel?"rgba(56,189,248,0.08)":"transparent",
                        borderLeft:isSel?`3px solid ${C.blue}`:"3px solid transparent",opacity:lead.contacted?0.5:1}}>
                      <div style={{display:"flex",alignItems:"center",gap:"0.4rem",marginBottom:3}}>
                        <span style={{fontSize:9,fontWeight:700,color:scoreColor(s),background:`${scoreColor(s)}20`,padding:"1px 6px",borderRadius:100}}>{scoreLabel(s)}</span>
                        <span style={{fontSize:10,fontWeight:800,color:scoreColor(s),marginLeft:"auto"}}>{s}</span>
                        {lead.contacted&&<span style={{fontSize:9,color:C.muted}}>✓</span>}
                      </div>
                      <div style={{fontSize:12,color:"#fff",fontWeight:600}}>{lead.name||"Anonymous"}</div>
                      <div style={{fontSize:10,color:C.muted}}>{lead.service||"No service"}</div>
                      <div style={{fontSize:9,color:"rgba(255,255,255,0.2)",marginTop:2}}>{lead.city} · {fmtDate(lead.date)}</div>
                    </div>
                  );
                })
            }
          </div>
        </div>
        <div style={{flex:1,overflowY:"auto",padding:"1.25rem"}}>
          {selected ? (
            <div style={{display:"flex",flexDirection:"column",gap:"0.85rem"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                <div>
                  <h2 style={{color:"#fff",fontSize:17,fontWeight:800,margin:"0 0 0.25rem"}}>{selected.name||"Anonymous"}</h2>
                  <span style={{fontSize:11,fontWeight:700,color:scoreColor(selected.score),background:`${scoreColor(selected.score)}20`,padding:"2px 10px",borderRadius:100}}>
                    {scoreLabel(selected.score)} · {selected.score}/100
                  </span>
                </div>
                <div style={{display:"flex",gap:"0.4rem"}}>
                  {!selected.contacted&&<button onClick={()=>markContacted(selected.id)} style={{...btnBase,background:C.green,color:"#fff",padding:"0.3rem 0.75rem",fontSize:11}}>✓ Contacted</button>}
                  <button onClick={()=>deleteLead(selected.id)} style={{...btnBase,background:"rgba(239,68,68,0.15)",color:C.red,padding:"0.3rem 0.75rem",fontSize:11}}>🗑</button>
                </div>
              </div>
              <div style={{background:C.card,borderRadius:10,padding:"0.8rem",border:`1px solid ${C.border}`}}>
                <div style={{background:"rgba(0,0,0,0.3)",borderRadius:4,height:5,marginBottom:"0.35rem"}}>
                  <div style={{width:`${selected.score}%`,height:"100%",background:scoreColor(selected.score),borderRadius:4}}/>
                </div>
                <div style={{fontSize:11,color:C.muted}}>{selected.score>=75?"Priority call":selected.score>=45?"Follow up within 24h":"Low priority"}</div>
              </div>
              <div style={{background:C.card,borderRadius:10,padding:"0.8rem",border:`1px solid ${C.border}`}}>
                <div style={{fontSize:9,color:C.muted,letterSpacing:"0.1em",marginBottom:7}}>CONTACT</div>
                {selected.phone&&(
                  <div style={{display:"flex",alignItems:"center",padding:"0.3rem 0",borderBottom:`1px solid rgba(255,255,255,0.05)`}}>
                    <span style={{fontSize:10,color:C.muted,width:55}}>Phone</span>
                    <span style={{fontSize:12,color:"#fff",flex:1}}>{selected.phone}</span>
                    <a href={`tel:+1${cleanPhone(selected.phone)}`} style={{...btnBase,background:C.green,color:"#fff",padding:"0.15rem 0.5rem",fontSize:10,textDecoration:"none"}}>📞 Call</a>
                  </div>
                )}
                {selected.email&&(
                  <div style={{display:"flex",alignItems:"center",padding:"0.3rem 0",borderBottom:`1px solid rgba(255,255,255,0.05)`}}>
                    <span style={{fontSize:10,color:C.muted,width:55}}>Email</span>
                    <span style={{fontSize:12,color:"#fff",flex:1}}>{selected.email}</span>
                    <a href={`mailto:${selected.email}`} style={{...btnBase,background:C.blue,color:"#fff",padding:"0.15rem 0.5rem",fontSize:10,textDecoration:"none"}}>✉️ Email</a>
                  </div>
                )}
                {[{label:"City",value:selected.city},{label:"Source",value:selected.source},{label:"Date",value:fmtDate(selected.date)}
                ].map(row=>row.value&&(
                  <div key={row.label} style={{display:"flex",alignItems:"center",padding:"0.3rem 0",borderBottom:`1px solid rgba(255,255,255,0.05)`}}>
                    <span style={{fontSize:10,color:C.muted,width:55}}>{row.label}</span>
                    <span style={{fontSize:12,color:"#fff",flex:1}}>{row.value}</span>
                  </div>
                ))}
              </div>
              {(selected.service||selected.message)&&(
                <div style={{background:C.card,borderRadius:10,padding:"0.8rem",border:`1px solid ${C.border}`}}>
                  <div style={{fontSize:9,color:C.muted,letterSpacing:"0.1em",marginBottom:7}}>REQUEST</div>
                  {selected.service&&<div style={{fontSize:12,color:"#fff",marginBottom:4}}><span style={{color:C.muted}}>Service: </span>{selected.service}</div>}
                  {selected.message&&<div style={{fontSize:12,color:C.text,lineHeight:1.6}}>{selected.message}</div>}
                </div>
              )}
            </div>
          ) : (
            <div style={{height:"100%",display:"flex",alignItems:"center",justifyContent:"center",color:C.muted,flexDirection:"column",gap:"0.5rem"}}>
              <div style={{fontSize:32}}>👈</div><div style={{fontSize:13}}>Select a lead</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// BUYER CRM
// ══════════════════════════════════════════════════════════════
function BuyerCRM({gh, flash}) {
  // Pipeline — synced to GitHub data/pipeline.json + localStorage cache
  const [pipeline,    setPipeline]    = useState(() => lsGet("pipeline_v2") || []);
  const [pipelineSha, setPipelineSha] = useState(null);

  // Prospects — synced to GitHub data/prospects.json + localStorage cache
  const [prospects,    setProspects]    = useState(() => lsGet("prospects_v2") || []);
  const [prospectsSha, setProspectsSha] = useState(null);
  const [searched,     setSearched]     = useState(() => !!(lsGet("prospects_v2")?.length));

  const [selected,     setSelected]    = useState(null);
  const [crmView,      setCrmView]     = useState("pipeline");
  const [outreachBiz,  setOutreachBiz] = useState(null);
  const [outreachType, setOutreachType]= useState("email");
  const [outreachText, setOutreachText]= useState("");
  const [generating,   setGenerating]  = useState(false);
  const [loading,      setLoading]     = useState(false);
  const [syncing,      setSyncing]     = useState(false);
  const [filter,       setFilter]      = useState("qualified");
  const [showAddForm,  setShowAddForm] = useState(false);
  const [newBiz,       setNewBiz]      = useState({name:"",formatted_phone_number:"",vicinity:"",website:"",rating:"",user_ratings_total:"",notes:""});
  const [googleKey,    setGoogleKey]   = useState(ENV_GPLACES || lsGet("gplaces_key") || "");

  // Load from GitHub on mount — this is the source of truth
  useEffect(() => {
    if (!gh) return;
    loadCRMData();
  }, [gh]);

  async function loadCRMData() {
    setSyncing(true);
    try {
      // Load pipeline
      const { data: pData, sha: pSha } = await gh.readJSON("data/pipeline.json");
      if (pData !== null) {
        setPipeline(pData);
        setPipelineSha(pSha);
        lsSet("pipeline_v2", pData);
      }
      // Load prospects
      const { data: prData, sha: prSha } = await gh.readJSON("data/prospects.json");
      if (prData !== null) {
        setProspects(prData);
        setProspectsSha(prSha);
        lsSet("prospects_v2", prData);
        setSearched(true);
      }
    } catch(e) {
      console.warn("CRM load error:", e.message);
      // Fall back to localStorage (already loaded in useState initializer)
    }
    setSyncing(false);
  }

  async function savePipeline(next) {
    setPipeline(next);
    lsSet("pipeline_v2", next); // instant local save
    try {
      const newSha = await gh.writeJSON("data/pipeline.json", next, pipelineSha, "Update CRM pipeline");
      setPipelineSha(newSha);
    } catch(e) {
      console.error("Pipeline save to GitHub failed:", e.message);
      flash("⚠️ GitHub sync failed — saved locally only","error");
    }
  }

  async function saveProspects(next) {
    setProspects(next);
    lsSet("prospects_v2", next);
    try {
      const newSha = await gh.writeJSON("data/prospects.json", next, prospectsSha, "Update CRM prospects");
      setProspectsSha(newSha);
    } catch(e) {
      console.error("Prospects save to GitHub failed:", e.message);
    }
  }

  async function searchProspects() {
    setLoading(true);
    if (googleKey.trim()) {
      try {
        const results = await searchGooglePlaces("dumpster rental","Florence SC", googleKey.trim());
        if (results.length === 0) throw new Error("No results returned");
        const existingIds = new Set(prospects.map(p=>p.place_id));
        const merged = [...prospects, ...results.filter(r=>!existingIds.has(r.place_id))];
        await saveProspects(merged);
        setSearched(true); setLoading(false);
        flash(`Found ${results.length} companies via Google Places ✅`);
        return;
      } catch(e) {
        flash(`Places API error: ${e.message}`, "error");
        setLoading(false); return;
      }
    }
    // No API key — use seed list
    if (!prospects.length) {
      await saveProspects(SEED_PROSPECTS);
    }
    setSearched(true); setLoading(false);
    flash("Prospects loaded ✅");
  }

  async function addProspect(biz) {
    const entry = {...biz, place_id:"p_"+Date.now(), rating:parseFloat(biz.rating)||0, user_ratings_total:parseInt(biz.user_ratings_total)||0};
    await saveProspects([...prospects, entry]);
    flash(biz.name+" added ✅");
  }

  async function deleteProspect(place_id) {
    await saveProspects(prospects.filter(p=>p.place_id!==place_id));
    flash("Prospect removed");
  }

  async function addToPipeline(biz) {
    if(pipeline.find(p=>p.place_id===biz.place_id)){flash("Already in pipeline","info");return;}
    const entry={...biz,stage:"prospect",addedAt:new Date().toISOString(),lastContact:null,notes:biz.notes||"",score:qualifyScore(biz)};
    await savePipeline([...pipeline, entry]);
    flash(`${biz.name} added ✅`);
  }

  async function addAllQualified() {
    const q=prospects.filter(p=>qualifyScore(p)>=55&&!pipeline.find(pl=>pl.place_id===p.place_id));
    if(!q.length){flash("No new qualified prospects","info");return;}
    const entries=q.map(b=>({...b,stage:"prospect",addedAt:new Date().toISOString(),lastContact:null,notes:b.notes||"",score:qualifyScore(b)}));
    await savePipeline([...pipeline,...entries]);
    flash(`Added ${entries.length} prospects`);
  }

  async function updateStage(id, stage) {
    const next=pipeline.map(p=>p.place_id===id?{...p,stage,lastContact:new Date().toISOString()}:p);
    await savePipeline(next);
    if(selected?.place_id===id) setSelected(s=>({...s,stage}));
  }

  async function updateNotes(id, notes) {
    const next=pipeline.map(p=>p.place_id===id?{...p,notes}:p);
    await savePipeline(next);
  }

  async function removeFromPipeline(id) {
    await savePipeline(pipeline.filter(p=>p.place_id!==id));
    setSelected(null); flash("Removed");
  }

  async function generate(biz, type) {
    setGenerating(true); setOutreachBiz(biz); setOutreachType(type); setOutreachText(""); setCrmView("outreach");
    try { const text=await generateOutreach(biz,type); setOutreachText(text); }
    catch(e) { setOutreachText(`Error: ${e.message}`); }
    setGenerating(false);
  }

  const stats={
    total:pipeline.length,
    closed:pipeline.filter(p=>p.stage==="closed").length,
    active:pipeline.filter(p=>p.stage==="pilot_active").length,
    revenue:pipeline.filter(p=>p.stage==="closed").length*497,
  };

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{display:"flex",gap:4,padding:"0.45rem 1rem",borderBottom:`1px solid ${C.border}`,flexShrink:0,alignItems:"center"}}>
        {[["pipeline","🗂 Pipeline"],["prospects","🔍 Prospects"],["outreach","✍️ Outreach"]].map(([k,l])=>(
          <button key={k} onClick={()=>setCrmView(k)}
            style={{...btnBase,padding:"0.25rem 0.7rem",fontSize:11,
              background:crmView===k?"rgba(56,189,248,0.15)":"transparent",
              color:crmView===k?C.blue:C.muted,border:`1px solid ${crmView===k?"rgba(56,189,248,0.3)":"transparent"}`}}>
            {l}
          </button>
        ))}
        {syncing && <span style={{fontSize:10,color:C.muted,marginLeft:4}}>⟳ syncing…</span>}
        <div style={{marginLeft:"auto",display:"flex",gap:"1.25rem"}}>
          {[{l:"Pipeline",v:stats.total},{l:"Active",v:stats.active,c:C.blue},{l:"Closed",v:stats.closed,c:C.green},{l:"Revenue",v:`$${stats.revenue.toLocaleString()}`,c:C.green}].map(s=>(
            <div key={s.l} style={{textAlign:"center"}}>
              <div style={{fontSize:14,fontWeight:800,color:s.c||"#fff"}}>{s.v}</div>
              <div style={{fontSize:9,color:C.muted,letterSpacing:"0.07em"}}>{s.l.toUpperCase()}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── PIPELINE VIEW ── */}
      {crmView==="pipeline"&&(
        <div style={{flex:1,display:"flex",overflow:"hidden"}}>
          <div style={{flex:1,overflowX:"auto",padding:"0.85rem",display:"flex",gap:"0.6rem",alignItems:"flex-start"}}>
            {STAGES.map(stage=>{
              const cards=pipeline.filter(p=>p.stage===stage);
              return(
                <div key={stage} style={{width:200,flexShrink:0}}>
                  <div style={{display:"flex",alignItems:"center",gap:"0.35rem",marginBottom:"0.45rem"}}>
                    <div style={{width:6,height:6,borderRadius:"50%",background:STAGE_COLORS[stage]}}/>
                    <span style={{fontSize:10,fontWeight:700,color:"#fff",letterSpacing:"0.04em"}}>{STAGE_LABELS[stage]}</span>
                    <span style={{fontSize:9,color:C.muted,marginLeft:"auto"}}>{cards.length}</span>
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:"0.4rem",minHeight:50}}>
                    {cards.map(p=>(
                      <div key={p.place_id} onClick={()=>setSelected(p)}
                        style={{background:selected?.place_id===p.place_id?"#1a3349":C.card,
                          border:`1px solid ${selected?.place_id===p.place_id?C.blue:C.border}`,
                          borderLeft:`3px solid ${STAGE_COLORS[stage]}`,
                          borderRadius:8,padding:"0.55rem 0.65rem",cursor:"pointer"}}>
                        <div style={{fontSize:11,fontWeight:700,color:"#fff",lineHeight:1.3,marginBottom:2}}>{p.name}</div>
                        <div style={{fontSize:9,color:C.amber}}>★ {p.rating} <span style={{color:C.muted}}>({p.user_ratings_total})</span></div>
                        {p.notes&&<div style={{fontSize:9,color:C.muted,marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.notes}</div>}
                      </div>
                    ))}
                    {cards.length===0&&<div style={{fontSize:9,color:"rgba(255,255,255,0.1)",textAlign:"center",padding:"0.85rem 0"}}>empty</div>}
                  </div>
                </div>
              );
            })}
          </div>
          {selected&&(
            <div style={{width:285,background:C.panel,borderLeft:`1px solid ${C.border}`,overflowY:"auto",padding:"0.85rem",display:"flex",flexDirection:"column",gap:"0.7rem",flexShrink:0}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                <div>
                  <div style={{fontSize:13,fontWeight:800,color:"#fff",lineHeight:1.3}}>{selected.name}</div>
                  <div style={{fontSize:10,color:C.muted,marginTop:2}}>{selected.vicinity}</div>
                </div>
                <button onClick={()=>setSelected(null)} style={{...btnBase,background:"transparent",color:C.muted,padding:"0.15rem 0.35rem"}}>✕</button>
              </div>
              <div style={{background:C.card,borderRadius:8,padding:"0.6rem",border:`1px solid ${C.border}`}}>
                <div style={{fontSize:9,color:C.muted,letterSpacing:"0.1em",marginBottom:4}}>SCORE</div>
                <div style={{background:"rgba(0,0,0,0.3)",borderRadius:3,height:4,marginBottom:3}}>
                  <div style={{width:`${selected.score}%`,height:"100%",background:`linear-gradient(90deg,${C.blue},${C.purple})`,borderRadius:3}}/>
                </div>
                <div style={{fontSize:10,color:"#fff"}}>{selected.score}/100</div>
              </div>
              <div style={{background:C.card,borderRadius:8,padding:"0.6rem",border:`1px solid ${C.border}`}}>
                <div style={{fontSize:9,color:C.muted,letterSpacing:"0.1em",marginBottom:5}}>CONTACT</div>
                {selected.formatted_phone_number&&(
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                    <span style={{fontSize:11,color:C.text}}>{selected.formatted_phone_number}</span>
                    <a href={`tel:+1${cleanPhone(selected.formatted_phone_number)}`}
                       style={{...btnBase,background:C.green,color:"#fff",padding:"0.15rem 0.5rem",fontSize:10,textDecoration:"none"}}>📞 Call</a>
                  </div>
                )}
                <div style={{fontSize:10,color:C.amber}}>★ {selected.rating} ({selected.user_ratings_total})</div>
              </div>
              <div style={{background:C.card,borderRadius:8,padding:"0.6rem",border:`1px solid ${C.border}`}}>
                <div style={{fontSize:9,color:C.muted,letterSpacing:"0.1em",marginBottom:5}}>STAGE</div>
                <div style={{display:"flex",flexDirection:"column",gap:2}}>
                  {STAGES.map(s=>(
                    <button key={s} onClick={()=>updateStage(selected.place_id,s)}
                      style={{...btnBase,padding:"0.2rem 0.45rem",fontSize:10,justifyContent:"flex-start",
                        background:selected.stage===s?`${STAGE_COLORS[s]}25`:"transparent",
                        color:selected.stage===s?"#fff":C.muted,
                        border:`1px solid ${selected.stage===s?STAGE_COLORS[s]:"transparent"}`}}>
                      {STAGE_LABELS[s]}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{background:C.card,borderRadius:8,padding:"0.6rem",border:`1px solid ${C.border}`}}>
                <div style={{fontSize:9,color:C.muted,letterSpacing:"0.1em",marginBottom:5}}>AI OUTREACH</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:3}}>
                  {["email","coldcall","sms","letter"].map(t=>(
                    <button key={t} onClick={()=>generate(selected,t)}
                      style={{...btnBase,background:"rgba(56,189,248,0.08)",color:C.blue,border:`1px solid rgba(56,189,248,0.2)`,fontSize:9,justifyContent:"center",padding:"0.3rem"}}>
                      {t==="email"?"✉️ Email":t==="coldcall"?"📞 Script":t==="sms"?"💬 SMS":"📄 Letter"}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{background:C.card,borderRadius:8,padding:"0.6rem",border:`1px solid ${C.border}`}}>
                <div style={{fontSize:9,color:C.muted,letterSpacing:"0.1em",marginBottom:4}}>NOTES</div>
                <textarea value={selected.notes||""}
                  onChange={e=>{setSelected(s=>({...s,notes:e.target.value}));updateNotes(selected.place_id,e.target.value);}}
                  placeholder="Add notes…"
                  style={{width:"100%",background:"rgba(0,0,0,0.3)",border:`1px solid ${C.border}`,borderRadius:5,color:C.text,fontSize:11,padding:"0.35rem",fontFamily:"inherit",minHeight:60,resize:"vertical",boxSizing:"border-box"}}/>
              </div>
              <button onClick={()=>removeFromPipeline(selected.place_id)}
                style={{...btnBase,background:"rgba(239,68,68,0.1)",color:C.red,border:`1px solid rgba(239,68,68,0.2)`,justifyContent:"center",fontSize:10}}>
                Remove from Pipeline
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── PROSPECTS VIEW ── */}
      {crmView==="prospects"&&(
        <div style={{flex:1,overflow:"auto",padding:"0.85rem"}}>
          <div style={{display:"flex",gap:"0.5rem",marginBottom:"0.85rem",alignItems:"center",flexWrap:"wrap"}}>
            <button onClick={searchProspects} disabled={loading}
              style={{...btnBase,background:`linear-gradient(135deg,${C.blue},${C.purple})`,color:"#fff",padding:"0.45rem 1rem",fontSize:12,opacity:loading?0.6:1}}>
              {loading?"⏳ Searching…":"🔍 Search Google Places"}
            </button>
            <button onClick={()=>setShowAddForm(f=>!f)}
              style={{...btnBase,background:C.green,color:"#fff",fontSize:11,padding:"0.45rem 0.85rem"}}>
              ➕ Add Prospect
            </button>
            {/* Only show API key input if not injected via env */}
            {!ENV_GPLACES && (
              <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:"0.4rem"}}>
                <div style={{fontSize:9,color:googleKey?C.green:C.muted,whiteSpace:"nowrap"}}>
                  {googleKey?"🟢 Places API":"⚪ No API Key"}
                </div>
                <input type="password" placeholder="Paste Google API key…" value={googleKey}
                  onChange={e=>{setGoogleKey(e.target.value);lsSet("gplaces_key",e.target.value);}}
                  style={{width:180,background:"rgba(0,0,0,0.3)",border:`1px solid ${googleKey?C.green:C.border}`,borderRadius:5,color:C.text,fontSize:10,padding:"0.3rem 0.5rem",fontFamily:"inherit"}}/>
              </div>
            )}
            {ENV_GPLACES && (
              <div style={{marginLeft:"auto",fontSize:9,color:C.green}}>🟢 Places API connected</div>
            )}
            {searched&&(
              <>
                <button onClick={addAllQualified} style={{...btnBase,background:C.green,color:"#fff",fontSize:11}}>✅ Add All Qualified</button>
                <div style={{display:"flex",gap:3}}>
                  {["all","qualified","unqualified"].map(f=>(
                    <button key={f} onClick={()=>setFilter(f)}
                      style={{...btnBase,padding:"0.22rem 0.6rem",fontSize:10,
                        background:filter===f?"rgba(56,189,248,0.15)":"transparent",
                        color:filter===f?C.blue:C.muted,border:`1px solid ${filter===f?"rgba(56,189,248,0.3)":"transparent"}`}}>
                      {f.charAt(0).toUpperCase()+f.slice(1)}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          {showAddForm&&(
            <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"0.85rem",marginBottom:"0.75rem"}}>
              <div style={{fontSize:11,fontWeight:700,color:"#fff",marginBottom:"0.6rem"}}>➕ Add New Prospect</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.4rem",marginBottom:"0.4rem"}}>
                {[["name","Company Name *"],["formatted_phone_number","Phone"],["vicinity","Address / City"],["website","Website"],["rating","Rating (0-5)"],["user_ratings_total","# Reviews"]].map(([k,label])=>(
                  <div key={k}>
                    <div style={{fontSize:9,color:C.muted,marginBottom:2}}>{label}</div>
                    <input value={newBiz[k]} onChange={e=>setNewBiz(b=>({...b,[k]:e.target.value}))}
                      style={{width:"100%",boxSizing:"border-box",background:"rgba(0,0,0,0.3)",border:`1px solid ${C.border}`,borderRadius:5,color:C.text,fontSize:11,padding:"0.3rem 0.45rem",fontFamily:"inherit"}}/>
                  </div>
                ))}
              </div>
              <div style={{marginBottom:"0.4rem"}}>
                <div style={{fontSize:9,color:C.muted,marginBottom:2}}>Notes</div>
                <input value={newBiz.notes} onChange={e=>setNewBiz(b=>({...b,notes:e.target.value}))}
                  style={{width:"100%",boxSizing:"border-box",background:"rgba(0,0,0,0.3)",border:`1px solid ${C.border}`,borderRadius:5,color:C.text,fontSize:11,padding:"0.3rem 0.45rem",fontFamily:"inherit"}}/>
              </div>
              <div style={{display:"flex",gap:"0.4rem"}}>
                <button onClick={async()=>{
                  if(!newBiz.name.trim()){flash("Name required","info");return;}
                  await addProspect(newBiz);
                  setNewBiz({name:"",formatted_phone_number:"",vicinity:"",website:"",rating:"",user_ratings_total:"",notes:""});
                  setShowAddForm(false); setSearched(true);
                }} style={{...btnBase,background:C.green,color:"#fff",fontSize:11}}>Save Prospect</button>
                <button onClick={()=>setShowAddForm(false)} style={{...btnBase,background:"transparent",color:C.muted,fontSize:11}}>Cancel</button>
              </div>
            </div>
          )}
          {!searched&&(
            <div style={{textAlign:"center",padding:"3rem",color:C.muted}}>
              <div style={{fontSize:36,marginBottom:"0.6rem"}}>🗑️</div>
              <div style={{fontSize:14,color:"#fff",fontWeight:700,marginBottom:"0.4rem"}}>Florence SC Prospects</div>
              <div style={{fontSize:12}}>Click Search Google Places or Add Prospect to get started</div>
            </div>
          )}
          {searched&&(
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(270px,1fr))",gap:"0.6rem"}}>
              {prospects.filter(p=>{
                const s=qualifyScore(p);
                if(filter==="qualified") return s>=55;
                if(filter==="unqualified") return s<55;
                return true;
              }).sort((a,b)=>qualifyScore(b)-qualifyScore(a)).map(p=>{
                const s=qualifyScore(p); const qual=s>=55;
                const already=pipeline.some(pl=>pl.place_id===p.place_id);
                return(
                  <div key={p.place_id} style={{background:C.card,border:`1px solid ${qual?"rgba(34,197,94,0.2)":C.border}`,borderRadius:10,padding:"0.85rem",opacity:already?0.6:1}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                      <div style={{flex:1}}>
                        <div style={{fontSize:12,fontWeight:700,color:"#fff",lineHeight:1.3}}>{p.name}</div>
                        <div style={{fontSize:10,color:C.muted,marginTop:1}}>{p.vicinity}</div>
                      </div>
                      <div style={{fontSize:11,fontWeight:700,color:s>=70?C.green:s>=55?C.amber:C.red,marginLeft:8}}>{s}/100</div>
                    </div>
                    <div style={{display:"flex",gap:"0.5rem",marginBottom:8,flexWrap:"wrap"}}>
                      <span style={{fontSize:10,color:C.amber}}>★ {p.rating}</span>
                      <span style={{fontSize:10,color:C.muted}}>{p.user_ratings_total} reviews</span>
                      {p.formatted_phone_number&&<span style={{fontSize:10,color:C.text}}>{p.formatted_phone_number}</span>}
                    </div>
                    {p.notes&&<div style={{fontSize:10,color:C.blue,marginBottom:6,fontStyle:"italic"}}>💡 {p.notes}</div>}
                    <div style={{display:"flex",gap:3}}>
                      {!already
                        ?<button onClick={()=>addToPipeline(p)} style={{...btnBase,background:qual?C.green:"rgba(255,255,255,0.06)",color:qual?"#fff":C.muted,fontSize:10,flex:1,justifyContent:"center"}}>+ Add to Pipeline</button>
                        :<div style={{fontSize:10,color:C.muted,flex:1,textAlign:"center",padding:"0.35rem"}}>✓ In Pipeline</div>
                      }
                      <button onClick={()=>generate(p,"email")} style={{...btnBase,background:"rgba(56,189,248,0.1)",color:C.blue,border:`1px solid rgba(56,189,248,0.2)`,fontSize:10}}>✉️ Draft</button>
                      <button onClick={()=>deleteProspect(p.place_id)} style={{...btnBase,background:"rgba(239,68,68,0.08)",color:C.red,border:`1px solid rgba(239,68,68,0.15)`,fontSize:10}}>🗑</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── OUTREACH VIEW ── */}
      {crmView==="outreach"&&(
        <div style={{flex:1,display:"flex",flexDirection:"column",padding:"0.85rem",gap:"0.65rem",overflow:"auto"}}>
          <div style={{display:"flex",gap:"0.45rem",alignItems:"center",flexWrap:"wrap"}}>
            {outreachBiz&&<div style={{fontSize:13,fontWeight:700,color:"#fff"}}>{outreachBiz.name}</div>}
            <div style={{display:"flex",gap:3}}>
              {["email","coldcall","sms","letter"].map(t=>(
                <button key={t} onClick={()=>outreachBiz&&generate(outreachBiz,t)}
                  style={{...btnBase,padding:"0.22rem 0.6rem",fontSize:10,
                    background:outreachType===t?"rgba(56,189,248,0.15)":"transparent",
                    color:outreachType===t?C.blue:C.muted,border:`1px solid ${outreachType===t?"rgba(56,189,248,0.3)":"transparent"}`}}>
                  {t==="email"?"✉️ Email":t==="coldcall"?"📞 Script":t==="sms"?"💬 SMS":"📄 Letter"}
                </button>
              ))}
            </div>
            {outreachText&&<button onClick={()=>{navigator.clipboard.writeText(outreachText);flash("Copied!");}}
              style={{...btnBase,background:C.green,color:"#fff",fontSize:10,marginLeft:"auto"}}>📋 Copy</button>}
          </div>
          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"0.85rem",flex:1,minHeight:180,position:"relative"}}>
            {generating
              ?<div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:"0.5rem"}}>
                  <div style={{fontSize:26,animation:"pulse 0.8s infinite"}}>✍️</div>
                  <div style={{fontSize:12,color:C.blue}}>Generating…</div>
                </div>
              :<textarea value={outreachText} onChange={e=>setOutreachText(e.target.value)}
                  style={{width:"100%",height:"100%",minHeight:160,background:"transparent",border:"none",color:C.text,fontSize:12,fontFamily:"'Courier New',monospace",lineHeight:1.8,outline:"none",resize:"none"}}
                  placeholder="Select a company from Pipeline or Prospects and click an outreach type…"/>
            }
          </div>
          {outreachBiz?.formatted_phone_number&&outreachType==="coldcall"&&(
            <a href={`tel:+1${cleanPhone(outreachBiz.formatted_phone_number)}`}
               style={{...btnBase,background:C.green,color:"#fff",fontSize:13,padding:"0.55rem 1.25rem",justifyContent:"center",textDecoration:"none",textAlign:"center"}}>
              📞 Call {outreachBiz.name} — {outreachBiz.formatted_phone_number}
            </a>
          )}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// SITE EDITOR
// ══════════════════════════════════════════════════════════════
function SiteEditor({gh, flash, editorStatus, setEditorStatus}) {
  const [files,setFiles]   = useState([]);
  const [active,setActive] = useState(null);
  const [err,setErr]       = useState("");
  const [search,setSearch] = useState("");
  const [msg,setMsg]       = useState("");
  const [showMsg,setShowMsg]= useState(false);
  const taRef = useRef(null);

  useEffect(()=>{
    if(!gh) return;
    gh.ls().then(ls=>setFiles(ls.filter(f=>f.type==="file").sort((a,b)=>a.name.localeCompare(b.name)))).catch(()=>{});
  },[gh]);

  async function openFile(f) {
    if(!canEdit(f.name)){flash(`${f.name} is binary`,"info");return;}
    if(active?.dirty&&!confirm("Discard unsaved changes?")) return;
    setEditorStatus("loading"); setErr("");
    try {
      const{content,sha}=await gh.readFile(f.path);
      setActive({name:f.name,path:f.path,content,sha,orig:content,dirty:false});
      setMsg(`Update ${f.name}`); setShowMsg(false);
    } catch(e){setErr(e.message);}
    setEditorStatus("idle");
  }

  async function save() {
    if(!active||!msg.trim()) return;
    setEditorStatus("saving"); setErr("");
    try {
      const res=await gh.write(active.path,active.content,active.sha,msg.trim());
      const newSha=res.content?.sha||active.sha;
      setActive(a=>({...a,sha:newSha,orig:a.content,dirty:false}));
      setEditorStatus("deployed");
      flash(`✅ ${active.name} pushed — deploying (~60s)`);
      setShowMsg(false);
      setTimeout(()=>setEditorStatus("idle"),65000);
    } catch(e){setErr(e.message);setEditorStatus("idle");}
  }

  function edit(v){setActive(a=>({...a,content:v,dirty:v!==a.orig}));}
  const lines=active?(active.content.match(/\n/g)||[]).length+1:0;
  const filtered=files.filter(f=>!search||f.name.toLowerCase().includes(search.toLowerCase()));

  return(
    <div style={{display:"flex",flex:1,overflow:"hidden"}}>
      <div style={{width:225,background:C.panel,borderRight:`1px solid ${C.border}`,display:"flex",flexDirection:"column",flexShrink:0}}>
        <div style={{padding:"0.5rem",borderBottom:`1px solid ${C.border}`}}>
          <input style={{...inp,padding:"0.33rem 0.6rem",fontSize:11}} placeholder="Search files…" value={search} onChange={e=>setSearch(e.target.value)}/>
        </div>
        <div style={{flex:1,overflowY:"auto"}}>
          {filtered.map(f=>{
            const isA=active?.name===f.name; const ok=canEdit(f.name);
            return(
              <div key={f.sha||f.name} onClick={()=>ok&&openFile(f)}
                style={{display:"flex",alignItems:"center",gap:"0.4rem",padding:"0.42rem 0.65rem",cursor:ok?"pointer":"default",
                  background:isA?"rgba(34,197,94,0.1)":"transparent",
                  borderLeft:isA?`2px solid ${C.green}`:"2px solid transparent",opacity:ok?1:0.4}}
                onMouseEnter={e=>{if(ok&&!isA)e.currentTarget.style.background="rgba(255,255,255,0.04)";}}
                onMouseLeave={e=>{if(!isA)e.currentTarget.style.background="transparent";}}>
                <span style={{fontSize:11,flexShrink:0}}>{fileEmoji(f.name)}</span>
                <span style={{fontSize:11,color:isA?"#4ade80":C.text,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{f.name}</span>
                <span style={{fontSize:9,color:"rgba(255,255,255,0.2)"}}>{kb(f.size||0)}</span>
              </div>
            );
          })}
        </div>
        <div style={{padding:"0.45rem",borderTop:`1px solid ${C.border}`,fontSize:9,color:"rgba(255,255,255,0.2)",textAlign:"center"}}>{files.length} files</div>
      </div>
      <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
        {active?(
          <>
            <div style={{background:"#172333",borderBottom:`1px solid ${C.border}`,padding:"0.38rem 1rem",display:"flex",alignItems:"center",gap:"0.6rem",flexShrink:0}}>
              <span style={{fontSize:12}}>{fileEmoji(active.name)}</span>
              <span style={{fontWeight:700,fontSize:12,color:"#fff"}}>{active.name}</span>
              {active.dirty&&<span style={{fontSize:9,background:C.amber,color:"#fff",padding:"1px 6px",borderRadius:100,fontWeight:700}}>UNSAVED</span>}
              <span style={{fontSize:10,color:"rgba(255,255,255,0.25)"}}>{lines} lines · {kb(new Blob([active.content]).size)}</span>
              <div style={{marginLeft:"auto",display:"flex",gap:"0.45rem",alignItems:"center"}}>
                {err&&<span style={{fontSize:10,color:"#fca5a5"}}>⚠️ {err}</span>}
                <a href={`https://cball8475.github.io/${active.name==="index.html"?"":active.name}`} target="_blank" rel="noreferrer"
                  style={{...btnBase,background:"transparent",border:`1px solid rgba(255,255,255,0.1)`,color:C.muted,padding:"0.22rem 0.6rem",fontSize:10,textDecoration:"none"}}>Preview →</a>
                <button onClick={()=>setShowMsg(v=>!v)} disabled={!active.dirty||editorStatus==="saving"}
                  style={{...btnBase,background:active.dirty?C.green:"rgba(255,255,255,0.06)",color:active.dirty?"#fff":"rgba(255,255,255,0.3)",padding:"0.28rem 0.8rem",fontSize:11,opacity:editorStatus==="saving"?0.6:1}}>
                  {editorStatus==="saving"?"Saving…":"💾 Save & Deploy"}
                </button>
              </div>
            </div>
            {showMsg&&(
              <div style={{background:"#1e3347",borderBottom:`1px solid ${C.border}`,padding:"0.5rem 1rem",display:"flex",gap:"0.5rem",alignItems:"flex-start",flexShrink:0}}>
                <div style={{flex:1}}>
                  <input style={{...inp,padding:"0.35rem 0.65rem",fontSize:12}} value={msg} onChange={e=>setMsg(e.target.value)}
                    onKeyDown={e=>e.key==="Enter"&&save()} autoFocus placeholder="Commit message…"/>
                  <div style={{display:"flex",gap:"0.25rem",marginTop:"0.25rem",flexWrap:"wrap"}}>
                    {[`Update ${active.name}`,"Fix content","SEO update","Phone/email update"].map(s=>(
                      <button key={s} onClick={()=>setMsg(s)} style={{fontSize:9,padding:"2px 5px",borderRadius:100,background:"rgba(255,255,255,0.06)",border:`1px solid rgba(255,255,255,0.1)`,color:"rgba(255,255,255,0.4)",cursor:"pointer",fontFamily:"inherit"}}>{s}</button>
                    ))}
                  </div>
                </div>
                <button onClick={save} style={{...btnBase,background:C.green,color:"#fff",padding:"0.38rem 0.9rem",fontSize:12}}>🚀 Push</button>
                <button onClick={()=>setShowMsg(false)} style={{...btnBase,background:"rgba(255,255,255,0.06)",color:C.muted,padding:"0.38rem 0.5rem"}}>✕</button>
              </div>
            )}
            <div style={{flex:1,display:"flex",overflow:"hidden"}}>
              <div style={{background:"#0b1520",borderRight:`1px solid rgba(255,255,255,0.04)`,padding:"1rem 0.45rem 1rem 0.3rem",fontFamily:"'Courier New',monospace",fontSize:11,color:"rgba(255,255,255,0.18)",lineHeight:"1.6rem",textAlign:"right",minWidth:38,userSelect:"none",overflowY:"hidden",flexShrink:0,pointerEvents:"none"}}>
                {Array.from({length:Math.min(lines,800)},(_,i)=><div key={i}>{i+1}</div>)}
              </div>
              <textarea ref={taRef} value={active.content} onChange={e=>edit(e.target.value)} spellCheck={false}
                style={{flex:1,background:"#0d1b2a",color:"#dde6f0",border:"none",outline:"none",fontFamily:"'Courier New',monospace",fontSize:12,lineHeight:"1.6rem",padding:"1rem 1rem 1rem 0.65rem",resize:"none",overflowY:"auto",tabSize:2}}
                onKeyDown={e=>{
                  if(e.key==="Tab"){e.preventDefault();const s=e.target.selectionStart,end=e.target.selectionEnd;const v=active.content.slice(0,s)+"  "+active.content.slice(end);edit(v);setTimeout(()=>{e.target.selectionStart=e.target.selectionEnd=s+2;},0);}
                  if((e.metaKey||e.ctrlKey)&&e.key==="s"){e.preventDefault();setShowMsg(true);}
                }}/>
            </div>
            <div style={{height:21,background:"#0f1a28",borderTop:`1px solid rgba(255,255,255,0.05)`,display:"flex",alignItems:"center",gap:"1rem",padding:"0 1rem",fontSize:10,color:"rgba(255,255,255,0.2)"}}>
              <span>{lines} lines</span><span>{kb(new Blob([active.content]).size)}</span>
              <span style={{marginLeft:"auto"}}>Ctrl+S to save</span>
            </div>
          </>
        ):(
          <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:"0.65rem",color:"rgba(255,255,255,0.2)"}}>
            {editorStatus==="loading"
              ?<><div style={{fontSize:30}}>⏳</div><div style={{fontSize:13}}>Loading…</div></>
              :<><div style={{fontSize:42}}>📝</div><div style={{fontSize:14}}>Select a file to edit</div><div style={{fontSize:11,color:"rgba(255,255,255,0.1)"}}>HTML · CSS · JS · MD · JSON</div></>
            }
          </div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// ROOT APP
// ══════════════════════════════════════════════════════════════
export default function App() {
  const [token,setToken]               = useState(ENV_TOKEN);
  const [repo,setRepo]                 = useState(ENV_REPO);
  const [gh,setGh]                     = useState(null);
  const [commit,setCommit]             = useState(null);
  const [loginStatus,setLoginStatus]   = useState(ENV_TOKEN ? "loading" : "idle");
  const [loginErr,setLoginErr]         = useState("");
  const [toast,setToast]               = useState(null);
  const [mainTab,setMainTab]           = useState("editor");
  const [editorStatus,setEditorStatus] = useState("idle");

  const flash = useCallback((t,type="ok")=>{setToast({t,type});setTimeout(()=>setToast(null),3500);},[]);

  // Auto-connect if token is baked in via env
  useEffect(()=>{
    if(ENV_TOKEN) connect(ENV_TOKEN, ENV_REPO);
  },[]);

  async function connect(tok=token, rep=repo) {
    const t=tok.trim(); const r=rep.trim();
    if(!t){setLoginErr("Token required");return;}
    setLoginStatus("loading"); setLoginErr("");
    try {
      const api=new GH(t,r);
      let repoData;
      try { repoData=await api.ping(); }
      catch(e) {
        const m=e.message||"";
        if(m.toLowerCase().includes("failed to fetch")||m.toLowerCase().includes("networkerror"))
          setLoginErr("Network error — check connection");
        else if(m.includes("404")||m.toLowerCase().includes("not found"))
          setLoginErr(`Repo "${r}" not found`);
        else if(m.includes("401")||m.toLowerCase().includes("bad credential"))
          setLoginErr("Bad token — use classic token with 'repo' scope");
        else setLoginErr(m);
        setLoginStatus("idle"); return;
      }
      const [,commits]=await Promise.all([api.ls(),api.lastCommit()]);
      setGh(api); setCommit(commits[0]||null); setLoginStatus("idle");
      if(!ENV_TOKEN) flash(`Connected — ${repoData.full_name}`);
    } catch(e){setLoginErr(e.message);setLoginStatus("idle");}
  }

  // Auto-connect loading splash
  if(ENV_TOKEN && !gh && loginStatus==="loading") return (
    <div style={{minHeight:"100vh",background:C.dark,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'IBM Plex Sans',sans-serif"}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;600;800&display=swap');*{box-sizing:border-box;margin:0;padding:0;}@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}`}</style>
      <div style={{textAlign:"center",color:C.muted}}>
        <div style={{fontSize:42,marginBottom:"1rem",animation:"pulse 1s infinite"}}>🗑️</div>
        <div style={{fontSize:16,color:"#fff",fontWeight:700}}>Florence SC Services</div>
        <div style={{fontSize:12,marginTop:"0.5rem"}}>Connecting…</div>
        {loginErr&&<div style={{marginTop:"1rem",color:"#fca5a5",fontSize:12}}>⚠️ {loginErr}</div>}
      </div>
    </div>
  );

  // Manual login screen (only shown when no env token)
  if(!gh) return (
    <div style={{minHeight:"100vh",background:C.dark,display:"flex",alignItems:"center",justifyContent:"center",padding:"1.5rem",fontFamily:"'IBM Plex Sans',sans-serif"}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;700&family=IBM+Plex+Sans:wght@400;600;800&display=swap');*{box-sizing:border-box;margin:0;padding:0;}input::placeholder{color:rgba(200,223,240,0.3);}`}</style>
      <div style={{width:"100%",maxWidth:420}}>
        <div style={{display:"flex",alignItems:"center",gap:"0.75rem",marginBottom:"2rem",justifyContent:"center"}}>
          <div style={{width:44,height:44,background:`linear-gradient(135deg,${C.blue},${C.purple})`,borderRadius:10,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22}}>🗑️</div>
          <div>
            <div style={{fontWeight:800,fontSize:18,color:"#fff",letterSpacing:"-0.02em"}}>Florence SC Services</div>
            <div style={{fontSize:11,color:C.muted,letterSpacing:"0.1em",textTransform:"uppercase"}}>Admin Platform</div>
          </div>
        </div>
        <div style={{background:C.panel,borderRadius:14,border:`1px solid ${C.border}`,padding:"2rem"}}>
          <h2 style={{fontWeight:800,fontSize:20,color:"#fff",margin:"0 0 0.25rem",letterSpacing:"-0.02em"}}>Connect to GitHub</h2>
          <p style={{fontSize:12,color:C.muted,marginBottom:"1.5rem",lineHeight:1.6}}>Site editor, leads dashboard, and buyer CRM.</p>
          <div style={{display:"flex",flexDirection:"column",gap:"0.75rem"}}>
            <div>
              <label style={{fontSize:10,fontWeight:700,color:C.muted,letterSpacing:"0.08em",textTransform:"uppercase",display:"block",marginBottom:"0.3rem"}}>Repository</label>
              <input style={inp} value={repo} onChange={e=>setRepo(e.target.value)}/>
            </div>
            <div>
              <label style={{fontSize:10,fontWeight:700,color:C.muted,letterSpacing:"0.08em",textTransform:"uppercase",display:"block",marginBottom:"0.3rem"}}>Personal Access Token</label>
              <input style={inp} type="password" value={token} onChange={e=>setToken(e.target.value)} onKeyDown={e=>e.key==="Enter"&&connect()} placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"/>
            </div>
          </div>
          {loginErr&&<div style={{marginTop:"0.75rem",background:"rgba(239,68,68,0.1)",border:"1px solid rgba(239,68,68,0.25)",borderRadius:8,padding:"0.5rem 0.75rem",fontSize:11,color:"#fca5a5"}}>⚠️ {loginErr}</div>}
          <button onClick={()=>connect()} disabled={loginStatus==="loading"}
            style={{...btnBase,background:`linear-gradient(135deg,${C.blue},${C.purple})`,color:"#fff",padding:"0.6rem 1.25rem",fontSize:14,width:"100%",justifyContent:"center",marginTop:"1.25rem",opacity:loginStatus==="loading"?0.6:1}}>
            {loginStatus==="loading"?"Connecting…":"Connect →"}
          </button>
        </div>
      </div>
    </div>
  );

  return(
    <div style={{height:"100vh",display:"flex",flexDirection:"column",background:C.dark,fontFamily:"'IBM Plex Sans',sans-serif",overflow:"hidden"}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;700&family=IBM+Plex+Sans:wght@400;600;800&display=swap');*{box-sizing:border-box;margin:0;padding:0;}::-webkit-scrollbar{width:4px;}::-webkit-scrollbar-thumb{background:rgba(99,179,237,0.2);border-radius:2px;}input::placeholder,textarea::placeholder{color:rgba(200,223,240,0.3);}@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}@keyframes slide-in{from{transform:translateY(8px);opacity:0}to{transform:none;opacity:1}}`}</style>
      <div style={{height:46,background:C.panel,borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",gap:"0.65rem",padding:"0 1rem",flexShrink:0}}>
        <div style={{width:24,height:24,background:`linear-gradient(135deg,${C.blue},${C.purple})`,borderRadius:5,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12}}>🗑️</div>
        <span style={{fontWeight:800,fontSize:13,color:"#fff",letterSpacing:"-0.02em"}}>Florence SC</span>
        <span style={{fontSize:10,color:C.muted,fontFamily:"'IBM Plex Mono'"}}>/ {repo}</span>
        <div style={{display:"flex",gap:3,marginLeft:"0.65rem"}}>
          {[["editor","✍️ Site Editor"],["leads","📊 Leads"],["crm","🤝 Buyer CRM"]].map(([key,label])=>(
            <button key={key} onClick={()=>setMainTab(key)}
              style={{...btnBase,padding:"0.25rem 0.75rem",fontSize:11,
                background:mainTab===key?"rgba(56,189,248,0.15)":"transparent",
                color:mainTab===key?C.blue:C.muted,
                border:`1px solid ${mainTab===key?"rgba(56,189,248,0.3)":"transparent"}`}}>
              {label}
            </button>
          ))}
        </div>
        {editorStatus==="deployed"&&(
          <div style={{display:"flex",alignItems:"center",gap:"0.3rem",fontSize:11,color:C.amber}}>
            <span style={{width:5,height:5,borderRadius:"50%",background:C.amber,display:"inline-block",animation:"pulse 1s infinite"}}/>Deploying…
          </div>
        )}
        {commit&&editorStatus!=="deployed"&&(
          <span style={{fontSize:10,color:"rgba(255,255,255,0.2)"}}>Last commit: {ago(commit.commit?.author?.date)}</span>
        )}
        <div style={{marginLeft:"auto",display:"flex",gap:"0.45rem"}}>
          <a href="https://florencescservices.com" target="_blank" rel="noreferrer"
            style={{...btnBase,background:"rgba(255,255,255,0.05)",color:C.muted,padding:"0.22rem 0.65rem",fontSize:11,textDecoration:"none"}}>
            🌐 Live Site
          </a>
        </div>
      </div>
      {mainTab==="editor"&&<SiteEditor gh={gh} flash={flash} editorStatus={editorStatus} setEditorStatus={setEditorStatus}/>}
      {mainTab==="leads"&&<div style={{display:"flex",flex:1,overflow:"hidden"}}><LeadsDashboard gh={gh} flash={flash}/></div>}
      {mainTab==="crm"&&<BuyerCRM gh={gh} flash={flash}/>}
      {toast&&(
        <div style={{position:"fixed",bottom:20,right:20,background:toast.type==="ok"?C.green:toast.type==="info"?C.blue:C.red,
          color:"#fff",padding:"0.5rem 1rem",borderRadius:8,fontWeight:700,fontSize:12,zIndex:999,
          boxShadow:"0 8px 30px rgba(0,0,0,0.5)",animation:"slide-in 0.2s ease",maxWidth:300}}>
          {toast.t}
        </div>
      )}
    </div>
  );
}
