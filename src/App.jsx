import { useState, useCallback, useEffect } from "react";

// ══════════════════════════════════════════════════════════════
// ENV — injected by Netlify at build time
// ══════════════════════════════════════════════════════════════
const ENV_GPLACES = import.meta.env.VITE_GOOGLE_PLACES_KEY || "";
const ENV_CRM_URL   = import.meta.env.VITE_CRM_API_URL   || "";
const ENV_CRM_TOKEN = import.meta.env.VITE_CRM_API_TOKEN || "";

// ══════════════════════════════════════════════════════════════
// LOCALSTORAGE — fast cache only
// ══════════════════════════════════════════════════════════════
function lsGet(key)       { try { const v=localStorage.getItem(key); return v?JSON.parse(v):null; } catch{ return null; } }
function lsSet(key, val)  { try { localStorage.setItem(key, JSON.stringify(val)); } catch(e) { console.warn("lsSet failed",key,e); } }

// ══════════════════════════════════════════════════════════════
// CRM API CLIENT (D1-backed)
// ══════════════════════════════════════════════════════════════
async function crmFetch(url, token, path, method = "GET", body = null) {
  const opts = {
    method,
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${url}${path}`, opts);
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`CRM ${method} ${path}: ${res.status}: ${errBody}`);
  }
  return res.json();
}

// Normalize D1 field names → legacy UI field names
function normalizeProspect(p) {
  if (!p) return p;
  return {
    ...p,
    place_id: p.id || p.place_id,
    formatted_phone_number: p.phone || p.formatted_phone_number || "",
    vicinity: p.address || p.vicinity || "",
    user_ratings_total: p.reviews ?? p.user_ratings_total ?? 0,
    sequenceStep: p.sequence_step ?? p.sequenceStep ?? 0,
    sequenceStarted: p.sequence_started || p.sequenceStarted || null,
    addedAt: p.added_at || p.addedAt || null,
    lastContact: p.last_contact || p.lastContact || null,
    activities: p.activities || [],
  };
}

// ══════════════════════════════════════════════════════════════
// SHARED HELPERS & STYLES
// ══════════════════════════════════════════════════════════════
const cleanPhone = p => p ? p.replace(/\D/g,"") : "";

function ago(iso) {
  if(!iso) return ""; const s=(Date.now()-new Date(iso))/1000;
  if(s<60) return `${~~s}s ago`; if(s<3600) return `${~~(s/60)}m ago`; if(s<86400) return `${~~(s/3600)}h ago`; return `${~~(s/86400)}d ago`;
}
function fmtDate(iso) {
  if(!iso) return "";
  return new Date(iso).toLocaleDateString("en-US",{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"});
}
function daysBetween(a, b) {
  return Math.floor((new Date(b) - new Date(a)) / (1000*60*60*24));
}
function addDays(iso, days) {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}
function isToday(iso) {
  return new Date(iso).toDateString() === new Date().toDateString();
}
function isPast(iso) {
  return new Date(iso) < new Date(new Date().toDateString());
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
// OUTREACH SEQUENCES — the automation engine
// ══════════════════════════════════════════════════════════════
const SEQUENCES = [
  {
    id: "new_prospect",
    name: "New Prospect — 5 Touch",
    description: "Full introduction sequence: email → follow-up → call → value email → breakup",
    steps: [
      { day: 0, type: "email", label: "Intro Email",
        subject: "Partner with Florence SC Services — We Send You Customers",
        template: `Hi {{firstName}},\n\nI'm Charlie with Florence SC Services. We connect homeowners and contractors in the Pee Dee region with reliable dumpster rental providers.\n\nWe're getting steady inquiries from people who need dumpster rentals, and I'm looking for a dependable local operator to send those leads to.\n\nWould you be open to a quick call this week to see if it's a fit?\n\nBest,\nCharlie\nFlorence SC Services\ncharlie@florencescservices.com`
      },
      { day: 3, type: "email", label: "Follow-up Email",
        subject: "Quick follow-up — dumpster rental leads",
        template: `Hi {{firstName}},\n\nJust circling back on my note from a few days ago. We have customers actively searching for dumpster rentals in your area.\n\nOur model is simple — we send you qualified leads, you close the jobs. No upfront cost to get started.\n\nWorth a 5-minute conversation?\n\nCharlie\ncharlie@florencescservices.com`
      },
      { day: 7, type: "call", label: "Discovery Call",
        template: `Hey, this is Charlie with Florence SC Services. I sent you a couple emails about sending dumpster rental leads your way. Wanted to connect real quick — do you have a minute?\n\n[IF YES] Great — so we generate leads for dumpster rentals in the Pee Dee region. Rather than keeping them, we partner with one local operator per area. I'd love to send you 2 free leads as a test run. Sound fair?\n\n[IF NOT INTERESTED] Totally get it. Mind if I ask — are you pretty full on jobs right now, or is it more of a timing thing? [Listen] Got it. I'll follow up in a couple months. Have a good one.`
      },
      { day: 10, type: "email", label: "Value Email",
        subject: "How {{company}} can get more dumpster jobs without ads",
        template: `Hi {{firstName}},\n\nMost dumpster rental companies in Florence rely on word of mouth or expensive Google Ads ($15-30 per click).\n\nWe do it differently — we rank organically for "dumpster rental Florence SC" and similar searches, then send those leads directly to our partners.\n\nZero ad spend on your end. Just answer the phone and close the job.\n\nIf you want to test it out, I'll send you 2 free leads this week. No strings.\n\nCharlie`
      },
      { day: 17, type: "email", label: "Breakup Email",
        subject: "Last note from me — {{company}}",
        template: `Hi {{firstName}},\n\nI've reached out a few times about sending dumpster rental leads your way. I don't want to be a pest, so this will be my last email for now.\n\nIf anything changes down the road, just reply to this and we'll pick up where we left off.\n\nWishing you a busy season.\n\nCharlie\ncharlie@florencescservices.com`
      },
    ]
  },
  {
    id: "re_engage",
    name: "Re-engage — Dead Leads",
    description: "Wake up prospects who went cold. 3 touches over 2 weeks.",
    steps: [
      { day: 0, type: "email", label: "Check-in Email",
        subject: "Still sending dumpster leads in Florence — room for one more partner",
        template: `Hi {{firstName}},\n\nWe connected a while back about sending dumpster rental leads to {{company}}. At the time it wasn't the right fit.\n\nSince then we've grown our lead volume and are looking to add one more local partner. Thought of you first.\n\nInterested in a quick test? 2 free leads, no commitment.\n\nCharlie\ncharlie@florencescservices.com`
      },
      { day: 5, type: "call", label: "Quick Call",
        template: `Hey {{firstName}}, Charlie from Florence SC Services. We chatted a while back about leads — just wanted to see if now might be better timing for you. We've got more volume now and room for one more partner. Quick 2-minute call worth it?`
      },
      { day: 12, type: "sms", label: "Final Text",
        template: `Hey {{firstName}}, Charlie from Florence SC Services. Still have dumpster rental leads if you want to test it out — 2 free, no strings. Just reply YES and I'll send them your way.`
      },
    ]
  },
  {
    id: "pilot_followup",
    name: "Pilot Follow-up",
    description: "After sending free leads — convert to paid.",
    steps: [
      { day: 0, type: "call", label: "Pilot Check-in Call",
        template: `Hey {{firstName}}, Charlie here. Just checking in on those leads I sent over. How'd they go?\n\n[IF GOOD] Awesome, glad to hear it. So here's how the full program works — we send you X exclusive leads per month for your area. Pricing starts at $45/lead or $297/month for a set number. Want me to send over the details?\n\n[IF NO RESPONSE TO LEADS] No worries — sometimes timing is tricky. Did you get a chance to call them back? I can resend the info if helpful.`
      },
      { day: 3, type: "email", label: "Pilot Results + Offer",
        subject: "Your pilot results + next steps",
        template: `Hi {{firstName}},\n\nHope the pilot leads worked out well for {{company}}.\n\nHere's what the full partnership looks like:\n\n• Exclusive leads for your area — no sharing with competitors\n• $45/lead (pay per lead) or $297/mo for a set volume\n• You're the only partner we send to in your zone\n\nWant to lock in your area before I reach out to other operators?\n\nCharlie`
      },
      { day: 7, type: "call", label: "Close Call",
        template: `Hey {{firstName}}, following up on the partnership details I sent over. Any questions? I've got another operator interested in the same area, wanted to give you first shot since you were already in the pilot. What do you think?`
      },
    ]
  }
];

// Fill template variables
function fillTemplate(template, biz) {
  const firstName = (biz.contact_name || "").split(/[\s']/)[0] || "";
  return template
    .replace(/ ?\{\{firstName\}\}/g, firstName ? ` ${firstName}` : "")
    .replace(/\{\{company\}\}/g, biz.name || "your company")
    .replace(/\{\{city\}\}/g, (biz.vicinity || "Florence, SC").split(",")[0].trim())
    .replace(/\{\{phone\}\}/g, biz.formatted_phone_number || "");
}

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
// ── D1 CRM score helpers ──
const crmScoreColor = s => s==="hot"?C.green:s==="warm"?C.amber:C.red;
const crmScoreIcon  = s => s==="hot"?"🔥":s==="warm"?"⚡":"❄️";
const crmScoreLabel = s => s==="hot"?"🔥 Hot":s==="warm"?"⚡ Warm":"❄️ Cold";
const statusColor   = s => ({new:C.blue,contacted:C.amber,qualified:C.green,delivered:C.purple,rejected:C.red,expired:C.muted})[s]||C.muted;
const statusLabel   = s => ({new:"New",contacted:"Contacted",qualified:"Qualified",delivered:"Delivered",rejected:"Rejected",expired:"Expired"})[s]||s;

function LeadsDashboard({flash}) {
  const crmUrl   = ENV_CRM_URL;
  const crmToken = ENV_CRM_TOKEN;

  const [leads,setLeads]             = useState([]);
  const [stats,setStats]             = useState(null);
  const [operators,setOperators]     = useState([]);
  const [pilotLeads,setPilotLeads]   = useState([]);
  const [loading,setLoading]         = useState(true);
  const [err,setErr]                 = useState("");
  const [selected,setSelected]       = useState(null);
  const [subTab,setSubTab]           = useState("leads"); // leads | pilots | stats

  // Filters
  const [fScore,setFScore]   = useState("all");
  const [fStatus,setFStatus] = useState("all");
  const [fSource,setFSource] = useState("all");
  const [search,setSearch]   = useState("");

  // Assignment modal
  const [assignLeadId,setAssignLeadId] = useState(null);
  const [assignTo,setAssignTo]         = useState("");

  useEffect(()=>{ loadAll(); },[]);

  async function crm(path, method="GET", body=null) {
    return crmFetch(crmUrl, crmToken, path, method, body);
  }

  async function loadAll() {
    setLoading(true); setErr("");
    try {
      const [leadsRes, statsRes, prospectsRes, pilotsRes] = await Promise.all([
        crm("/leads?limit=200"),
        crm("/stats"),
        crm("/prospects?operator_status=active"),
        crm("/pilot-leads"),
      ]);
      setLeads(leadsRes.leads || []);
      setStats(statsRes);
      setOperators((prospectsRes.prospects || []).map(normalizeProspect));
      setPilotLeads(pilotsRes.pilot_leads || []);
    } catch(e) {
      setErr(e.message);
      flash("⚠️ CRM API error","error");
    }
    setLoading(false);
  }

  async function updateLeadStatus(id, status) {
    try {
      await crm(`/leads/${id}`, "PATCH", { status });
      setLeads(prev => prev.map(l => l.id===id ? {...l, status} : l));
      if(selected?.id===id) setSelected(prev => ({...prev, status}));
      flash(`Lead → ${statusLabel(status)} ✅`);
    } catch(e) { flash("⚠️ "+e.message,"error"); }
  }

  async function assignLead(leadId, prospectId) {
    try {
      const res = await crm(`/leads/${leadId}/assign`, "POST", { prospect_id: prospectId });
      await loadAll();
      setAssignLeadId(null);
      flash("Lead reassigned ✅");
    } catch(e) { flash("⚠️ "+e.message,"error"); }
  }

  async function deleteLead(id) {
    if(!confirm("Delete this lead permanently?")) return;
    try {
      await crm(`/leads/${id}`, "DELETE");
      setLeads(prev => prev.filter(l => l.id!==id));
      if(selected?.id===id) setSelected(null);
      flash("Lead deleted");
    } catch(e) { flash("⚠️ "+e.message,"error"); }
  }

  // Filtering
  const filtered = leads.filter(l => {
    if(fScore!=="all" && l.score!==fScore) return false;
    if(fStatus!=="all" && l.status!==fStatus) return false;
    if(fSource!=="all" && l.source!==fSource) return false;
    if(search) {
      const q = search.toLowerCase();
      const hay = [l.name,l.phone,l.email,l.project_type,l.notes].filter(Boolean).join(" ").toLowerCase();
      if(!hay.includes(q)) return false;
    }
    return true;
  });

  // Counts
  const hotCount  = leads.filter(l=>l.score==="hot").length;
  const warmCount = leads.filter(l=>l.score==="warm").length;
  const coldCount = leads.filter(l=>l.score==="cold").length;
  const newCount  = leads.filter(l=>l.status==="new").length;
  const todayCount = leads.filter(l=>l.created_at&&new Date(l.created_at).toDateString()===new Date().toDateString()).length;

  const operatorName = (id) => {
    if(!id) return "Unassigned";
    const op = operators.find(o=>o.place_id===id || o.id===id);
    return op ? (op.short_name || op.name || "Unknown") : "Unknown";
  };

  // ── Loading state ──
  if(loading && leads.length===0) return (
    <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:"0.75rem"}}>
      <div style={{fontSize:36,animation:"pulse 1s infinite"}}>📊</div>
      <div style={{fontSize:14,color:C.muted}}>Loading leads from CRM…</div>
      {err&&<div style={{color:"#fca5a5",fontSize:12}}>⚠️ {err}</div>}
    </div>
  );

  // ── Main render ──
  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      {/* ── STATS BAR ── */}
      <div style={{display:"flex",gap:"0.5rem",padding:"0.65rem 1rem",borderBottom:`1px solid ${C.border}`,flexShrink:0,alignItems:"center"}}>
        {[
          {label:"Total",value:leads.length,color:C.blue,icon:"📋"},
          {label:"New",value:newCount,color:newCount>0?C.blue:C.muted,icon:"🆕"},
          {label:"Today",value:todayCount,color:todayCount>0?C.purple:C.muted,icon:"📅"},
          {label:"Hot",value:hotCount,color:C.green,icon:"🔥"},
          {label:"Warm",value:warmCount,color:C.amber,icon:"⚡"},
          {label:"Cold",value:coldCount,color:C.muted,icon:"❄️"},
          {label:"Operators",value:operators.length,color:C.purple,icon:"🚛"},
        ].map(s=>(
          <div key={s.label} style={{background:C.card,borderRadius:8,padding:"0.4rem 0.7rem",flex:1,textAlign:"center",border:`1px solid ${C.border}`,minWidth:0}}>
            <div style={{fontSize:16,fontWeight:800,color:s.color}}>{s.value}</div>
            <div style={{fontSize:8,color:C.muted,marginTop:1,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{s.icon} {s.label}</div>
          </div>
        ))}
        <button onClick={loadAll} style={{...btnBase,background:"rgba(255,255,255,0.06)",color:C.muted,padding:"0.35rem 0.6rem",fontSize:11,flexShrink:0}}>↺</button>
      </div>

      {/* ── SUB-TAB BAR ── */}
      <div style={{display:"flex",gap:3,padding:"0.4rem 1rem",borderBottom:`1px solid ${C.border}`,flexShrink:0}}>
        {[["leads","📋 All Leads"],["pilots","🧪 Pilot Tracker"],["stats","📈 Stats"]].map(([key,label])=>(
          <button key={key} onClick={()=>setSubTab(key)}
            style={{...btnBase,padding:"0.25rem 0.7rem",fontSize:10,
              background:subTab===key?"rgba(56,189,248,0.12)":"transparent",
              color:subTab===key?C.blue:C.muted,
              border:`1px solid ${subTab===key?"rgba(56,189,248,0.25)":"transparent"}`}}>
            {label}
          </button>
        ))}
        {err&&<span style={{fontSize:10,color:C.red,marginLeft:"auto"}}>⚠️ {err}</span>}
      </div>

      {/* ════════ LEADS TAB ════════ */}
      {subTab==="leads"&&(
        <div style={{display:"flex",flex:1,overflow:"hidden"}}>
          {/* ── LEFT: Lead list ── */}
          <div style={{width:300,borderRight:`1px solid ${C.border}`,display:"flex",flexDirection:"column",flexShrink:0}}>
            {/* Search + filters */}
            <div style={{padding:"0.45rem",borderBottom:`1px solid ${C.border}`}}>
              <input style={{...inp,padding:"0.3rem 0.6rem",fontSize:11}} placeholder="Search name, phone, email…" value={search} onChange={e=>setSearch(e.target.value)}/>
              <div style={{display:"flex",gap:2,marginTop:4}}>
                {["all","hot","warm","cold"].map(f=>(
                  <button key={f} onClick={()=>setFScore(f)}
                    style={{...btnBase,flex:1,justifyContent:"center",padding:"0.2rem",fontSize:9,
                      background:fScore===f?"rgba(255,255,255,0.1)":"transparent",
                      color:fScore===f?"#fff":C.muted,border:`1px solid ${fScore===f?"rgba(255,255,255,0.15)":"transparent"}`}}>
                    {f==="all"?"All":crmScoreLabel(f)}
                  </button>
                ))}
              </div>
              <div style={{display:"flex",gap:2,marginTop:3}}>
                {["all","new","contacted","delivered","rejected"].map(f=>(
                  <button key={f} onClick={()=>setFStatus(f)}
                    style={{...btnBase,flex:1,justifyContent:"center",padding:"0.15rem",fontSize:8,
                      background:fStatus===f?"rgba(255,255,255,0.1)":"transparent",
                      color:fStatus===f?"#fff":C.muted,border:`1px solid ${fStatus===f?"rgba(255,255,255,0.15)":"transparent"}`}}>
                    {f==="all"?"All":statusLabel(f)}
                  </button>
                ))}
              </div>
            </div>
            {/* Lead rows */}
            <div style={{flex:1,overflowY:"auto"}}>
              {filtered.length===0
                ? <div style={{padding:"2rem",textAlign:"center",color:C.muted,fontSize:12}}>No leads match filters</div>
                : filtered.map(lead=>{
                    const isSel = selected?.id===lead.id;
                    return (
                      <div key={lead.id} onClick={()=>setSelected(lead)}
                        style={{padding:"0.6rem 0.65rem",borderBottom:`1px solid ${C.border}`,cursor:"pointer",
                          background:isSel?"rgba(56,189,248,0.08)":"transparent",
                          borderLeft:isSel?`3px solid ${C.blue}`:"3px solid transparent"}}>
                        <div style={{display:"flex",alignItems:"center",gap:"0.35rem",marginBottom:3}}>
                          <span style={{fontSize:8,fontWeight:700,color:crmScoreColor(lead.score),background:`${crmScoreColor(lead.score)}20`,padding:"1px 6px",borderRadius:100}}>
                            {crmScoreLabel(lead.score)}
                          </span>
                          <span style={{fontSize:8,fontWeight:600,color:statusColor(lead.status),background:`${statusColor(lead.status)}15`,padding:"1px 5px",borderRadius:100}}>
                            {statusLabel(lead.status)}
                          </span>
                          {lead.is_pilot_lead===1&&<span style={{fontSize:8,color:C.purple}}>🧪</span>}
                          <span style={{fontSize:9,color:"rgba(255,255,255,0.2)",marginLeft:"auto"}}>#{lead.id}</span>
                        </div>
                        <div style={{fontSize:12,color:"#fff",fontWeight:600}}>{lead.name||"Anonymous"}</div>
                        <div style={{fontSize:10,color:C.muted}}>{lead.project_type||lead.dumpster_size||"—"}</div>
                        <div style={{display:"flex",justifyContent:"space-between",marginTop:2}}>
                          <span style={{fontSize:9,color:"rgba(255,255,255,0.2)"}}>{lead.source} · {fmtDate(lead.created_at)}</span>
                          <span style={{fontSize:9,color:C.purple}}>{operatorName(lead.assigned_to).split(" ")[0]}</span>
                        </div>
                      </div>
                    );
                  })
              }
            </div>
          </div>

          {/* ── RIGHT: Lead detail ── */}
          <div style={{flex:1,overflowY:"auto",padding:"1.25rem"}}>
            {selected ? (
              <div style={{display:"flex",flexDirection:"column",gap:"0.85rem"}}>
                {/* Header */}
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                  <div>
                    <h2 style={{color:"#fff",fontSize:17,fontWeight:800,margin:"0 0 0.3rem"}}>{selected.name||"Anonymous"}</h2>
                    <div style={{display:"flex",gap:"0.35rem",flexWrap:"wrap"}}>
                      <span style={{fontSize:11,fontWeight:700,color:crmScoreColor(selected.score),background:`${crmScoreColor(selected.score)}18`,padding:"2px 10px",borderRadius:100}}>
                        {crmScoreLabel(selected.score)}
                      </span>
                      <span style={{fontSize:11,fontWeight:700,color:statusColor(selected.status),background:`${statusColor(selected.status)}18`,padding:"2px 10px",borderRadius:100}}>
                        {statusLabel(selected.status)}
                      </span>
                      {selected.is_pilot_lead===1&&(
                        <span style={{fontSize:11,fontWeight:700,color:C.purple,background:"rgba(167,139,250,0.15)",padding:"2px 10px",borderRadius:100}}>🧪 Pilot #{selected.pilot_lead_number}</span>
                      )}
                    </div>
                  </div>
                  <div style={{display:"flex",gap:"0.35rem"}}>
                    <button onClick={()=>deleteLead(selected.id)} style={{...btnBase,background:"rgba(239,68,68,0.12)",color:C.red,padding:"0.25rem 0.6rem",fontSize:10}}>🗑</button>
                  </div>
                </div>

                {/* Contact card */}
                <div style={{background:C.card,borderRadius:10,padding:"0.8rem",border:`1px solid ${C.border}`}}>
                  <div style={{fontSize:9,color:C.muted,letterSpacing:"0.1em",marginBottom:7}}>CONTACT</div>
                  {selected.phone&&(
                    <div style={{display:"flex",alignItems:"center",padding:"0.3rem 0",borderBottom:`1px solid rgba(255,255,255,0.05)`}}>
                      <span style={{fontSize:10,color:C.muted,width:65}}>Phone</span>
                      <span style={{fontSize:12,color:"#fff",flex:1}}>{selected.phone}</span>
                      <a href={`tel:+1${cleanPhone(selected.phone)}`} style={{...btnBase,background:C.green,color:"#fff",padding:"0.15rem 0.5rem",fontSize:10,textDecoration:"none"}}>📞 Call</a>
                    </div>
                  )}
                  {selected.email&&(
                    <div style={{display:"flex",alignItems:"center",padding:"0.3rem 0",borderBottom:`1px solid rgba(255,255,255,0.05)`}}>
                      <span style={{fontSize:10,color:C.muted,width:65}}>Email</span>
                      <span style={{fontSize:12,color:"#fff",flex:1}}>{selected.email}</span>
                      <a href={`mailto:${selected.email}`} style={{...btnBase,background:C.blue,color:"#fff",padding:"0.15rem 0.5rem",fontSize:10,textDecoration:"none"}}>✉️ Email</a>
                    </div>
                  )}
                  {[
                    {label:"Source",value:selected.source},
                    {label:"Size",value:selected.dumpster_size},
                    {label:"Debris",value:selected.debris_type},
                    {label:"Timeline",value:selected.timeline},
                    {label:"Project",value:selected.project_type},
                    {label:"Created",value:fmtDate(selected.created_at)},
                  ].map(row=>row.value&&(
                    <div key={row.label} style={{display:"flex",alignItems:"center",padding:"0.3rem 0",borderBottom:`1px solid rgba(255,255,255,0.05)`}}>
                      <span style={{fontSize:10,color:C.muted,width:65}}>{row.label}</span>
                      <span style={{fontSize:12,color:"#fff",flex:1}}>{row.value}</span>
                    </div>
                  ))}
                  {selected.notes&&(
                    <div style={{padding:"0.4rem 0 0"}}>
                      <span style={{fontSize:10,color:C.muted}}>Notes: </span>
                      <span style={{fontSize:11,color:C.text}}>{selected.notes}</span>
                    </div>
                  )}
                </div>

                {/* Assignment card */}
                <div style={{background:C.card,borderRadius:10,padding:"0.8rem",border:`1px solid ${C.border}`}}>
                  <div style={{fontSize:9,color:C.muted,letterSpacing:"0.1em",marginBottom:7}}>ASSIGNED TO</div>
                  <div style={{display:"flex",alignItems:"center",gap:"0.5rem"}}>
                    <span style={{fontSize:13,color:selected.assigned_to?"#fff":C.red,fontWeight:700}}>
                      {selected.assigned_to ? `🚛 ${operatorName(selected.assigned_to)}` : "⚠️ Unassigned"}
                    </span>
                    <button onClick={()=>{setAssignLeadId(selected.id);setAssignTo(selected.assigned_to||"");}}
                      style={{...btnBase,background:"rgba(167,139,250,0.12)",color:C.purple,padding:"0.2rem 0.6rem",fontSize:10,marginLeft:"auto"}}>
                      ✏️ Reassign
                    </button>
                  </div>
                  {selected.assigned_at&&(
                    <div style={{fontSize:9,color:C.muted,marginTop:4}}>Assigned: {fmtDate(selected.assigned_at)}</div>
                  )}
                </div>

                {/* Status actions */}
                <div style={{background:C.card,borderRadius:10,padding:"0.8rem",border:`1px solid ${C.border}`}}>
                  <div style={{fontSize:9,color:C.muted,letterSpacing:"0.1em",marginBottom:7}}>UPDATE STATUS</div>
                  <div style={{display:"flex",gap:"0.35rem",flexWrap:"wrap"}}>
                    {["new","contacted","qualified","delivered","rejected"].map(s=>(
                      <button key={s} onClick={()=>updateLeadStatus(selected.id,s)}
                        style={{...btnBase,padding:"0.25rem 0.6rem",fontSize:10,
                          background:selected.status===s?`${statusColor(s)}25`:"rgba(255,255,255,0.04)",
                          color:selected.status===s?"#fff":C.muted,
                          border:`1px solid ${selected.status===s?statusColor(s):"transparent"}`}}>
                        {statusLabel(s)}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Call recording (CallRail leads) */}
                {selected.call_recording_url&&(
                  <div style={{background:C.card,borderRadius:10,padding:"0.8rem",border:`1px solid ${C.border}`}}>
                    <div style={{fontSize:9,color:C.muted,letterSpacing:"0.1em",marginBottom:7}}>CALL RECORDING</div>
                    <div style={{display:"flex",alignItems:"center",gap:"0.5rem"}}>
                      <span style={{fontSize:11,color:C.text}}>Duration: {selected.call_duration||0}s</span>
                      <a href={selected.call_recording_url} target="_blank" rel="noreferrer"
                        style={{...btnBase,background:"rgba(56,189,248,0.12)",color:C.blue,padding:"0.2rem 0.6rem",fontSize:10,textDecoration:"none",marginLeft:"auto"}}>
                        ▶ Listen
                      </a>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div style={{height:"100%",display:"flex",alignItems:"center",justifyContent:"center",color:C.muted,flexDirection:"column",gap:"0.5rem"}}>
                <div style={{fontSize:32}}>👈</div>
                <div style={{fontSize:13}}>Select a lead to view details</div>
                <div style={{fontSize:11,color:"rgba(255,255,255,0.2)"}}>{filtered.length} lead{filtered.length!==1?"s":""} showing</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ════════ PILOT TRACKER TAB ════════ */}
      {subTab==="pilots"&&(
        <div style={{flex:1,overflowY:"auto",padding:"1.25rem"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"1rem"}}>
            <h3 style={{color:"#fff",fontSize:15,fontWeight:800,margin:0}}>🧪 Pilot Lead Tracker</h3>
            <button onClick={loadAll} style={{...btnBase,background:"rgba(255,255,255,0.06)",color:C.muted,padding:"0.3rem 0.6rem",fontSize:10}}>↺ Refresh</button>
          </div>
          {pilotLeads.length===0 ? (
            <div style={{textAlign:"center",padding:"3rem",color:C.muted}}>
              <div style={{fontSize:36,marginBottom:"0.5rem"}}>🧪</div>
              <div style={{fontSize:14}}>No pilot leads yet</div>
              <div style={{fontSize:11,marginTop:"0.3rem"}}>Assign pilot leads via the API to start tracking</div>
            </div>
          ) : (
            <div style={{display:"flex",flexDirection:"column",gap:"0.65rem"}}>
              {pilotLeads.map(pl=>(
                <div key={pl.id} style={{background:C.card,borderRadius:10,padding:"0.85rem",border:`1px solid ${C.border}`}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"0.4rem"}}>
                    <div>
                      <span style={{fontSize:13,fontWeight:700,color:"#fff"}}>{pl.operator_name}</span>
                      <span style={{fontSize:10,color:C.muted,marginLeft:"0.5rem"}}>Pilot #{pl.lead_number}</span>
                    </div>
                    <span style={{fontSize:10,fontWeight:700,padding:"2px 8px",borderRadius:100,
                      color:pl.outcome==="pending"?C.amber:pl.outcome==="won"?C.green:C.red,
                      background:pl.outcome==="pending"?"rgba(245,158,11,0.12)":pl.outcome==="won"?"rgba(34,197,94,0.12)":"rgba(239,68,68,0.12)"}}>
                      {pl.outcome==="pending"?"⏳ Pending":pl.outcome==="won"?"✅ Won":pl.outcome==="lost"?"❌ Lost":pl.outcome}
                    </span>
                  </div>
                  <div style={{display:"flex",gap:"1rem",fontSize:11,color:C.muted}}>
                    <span>Lead: <span style={{color:C.text}}>{pl.lead_name||"#"+pl.lead_id}</span></span>
                    <span>Score: <span style={{color:crmScoreColor(pl.lead_score)}}>{crmScoreLabel(pl.lead_score)}</span></span>
                    <span>Source: <span style={{color:C.text}}>{pl.lead_source||"—"}</span></span>
                    <span>Sent: <span style={{color:C.text}}>{fmtDate(pl.date_sent)}</span></span>
                  </div>
                  {pl.notes&&<div style={{fontSize:10,color:C.muted,marginTop:4}}>📝 {pl.notes}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ════════ STATS TAB ════════ */}
      {subTab==="stats"&&(
        <div style={{flex:1,overflowY:"auto",padding:"1.25rem"}}>
          <h3 style={{color:"#fff",fontSize:15,fontWeight:800,margin:"0 0 1rem"}}>📈 CRM Stats</h3>
          {stats ? (
            <div style={{display:"flex",flexDirection:"column",gap:"1rem"}}>
              {/* Big numbers row */}
              <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"0.65rem"}}>
                {[
                  {label:"Total Prospects",value:stats.total_prospects,color:C.blue,icon:"👥"},
                  {label:"With Email",value:stats.with_email,color:C.green,icon:"✉️"},
                  {label:"In Sequences",value:stats.enrolled,color:C.amber,icon:"🔄"},
                  {label:"Active Operators",value:stats.active_operators,color:C.purple,icon:"🚛"},
                  {label:"Total Leads",value:stats.total_leads,color:C.blue,icon:"📋"},
                  {label:"Active Pilots",value:stats.active_pilots,color:C.purple,icon:"🧪"},
                ].map(s=>(
                  <div key={s.label} style={{background:C.card,borderRadius:10,padding:"0.75rem",border:`1px solid ${C.border}`,textAlign:"center"}}>
                    <div style={{fontSize:11,marginBottom:"0.2rem"}}>{s.icon}</div>
                    <div style={{fontSize:22,fontWeight:800,color:s.color}}>{s.value}</div>
                    <div style={{fontSize:9,color:C.muted,marginTop:2}}>{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Breakdowns */}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"0.65rem"}}>
                {[
                  {title:"Leads by Score",data:stats.leads_by_score,colorFn:s=>crmScoreColor(s.score),labelFn:s=>`${crmScoreIcon(s.score)} ${s.score}`},
                  {title:"Leads by Status",data:stats.leads_by_status,colorFn:s=>statusColor(s.status),labelFn:s=>statusLabel(s.status)},
                  {title:"Leads by Source",data:stats.leads_by_source,colorFn:()=>C.blue,labelFn:s=>s.source||"Unknown"},
                ].map(group=>(
                  <div key={group.title} style={{background:C.card,borderRadius:10,padding:"0.75rem",border:`1px solid ${C.border}`}}>
                    <div style={{fontSize:10,fontWeight:700,color:C.muted,letterSpacing:"0.05em",marginBottom:"0.5rem"}}>{group.title}</div>
                    {(group.data||[]).length===0
                      ? <div style={{fontSize:11,color:"rgba(255,255,255,0.2)"}}>No data</div>
                      : (group.data||[]).map((item,i)=>(
                        <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"0.25rem 0",borderBottom:`1px solid rgba(255,255,255,0.04)`}}>
                          <span style={{fontSize:11,color:group.colorFn(item)}}>{group.labelFn(item)}</span>
                          <span style={{fontSize:13,fontWeight:800,color:"#fff"}}>{item.c}</span>
                        </div>
                      ))
                    }
                  </div>
                ))}
              </div>

              {/* Prospects by stage */}
              <div style={{background:C.card,borderRadius:10,padding:"0.75rem",border:`1px solid ${C.border}`}}>
                <div style={{fontSize:10,fontWeight:700,color:C.muted,letterSpacing:"0.05em",marginBottom:"0.5rem"}}>Prospects by Stage</div>
                <div style={{display:"flex",gap:"0.75rem",flexWrap:"wrap"}}>
                  {(stats.prospects_by_stage||[]).map((item,i)=>(
                    <div key={i} style={{textAlign:"center"}}>
                      <div style={{fontSize:18,fontWeight:800,color:C.blue}}>{item.c}</div>
                      <div style={{fontSize:9,color:C.muted}}>{item.stage}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div style={{color:C.muted,fontSize:13}}>Loading stats…</div>
          )}
        </div>
      )}

      {/* ════════ ASSIGNMENT MODAL ════════ */}
      {assignLeadId&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}}
          onClick={()=>setAssignLeadId(null)}>
          <div style={{background:C.panel,borderRadius:14,border:`1px solid ${C.border}`,padding:"1.5rem",width:360,maxWidth:"90vw"}}
            onClick={e=>e.stopPropagation()}>
            <h3 style={{color:"#fff",fontSize:15,fontWeight:800,margin:"0 0 1rem"}}>Reassign Lead #{assignLeadId}</h3>
            <div style={{fontSize:10,fontWeight:700,color:C.muted,letterSpacing:"0.08em",marginBottom:"0.3rem"}}>SELECT OPERATOR</div>
            {operators.length===0 ? (
              <div style={{color:C.red,fontSize:12,padding:"1rem 0"}}>No active operators. Activate a prospect first.</div>
            ) : (
              <div style={{display:"flex",flexDirection:"column",gap:"0.35rem"}}>
                {operators.map(op=>(
                  <button key={op.place_id} onClick={()=>assignLead(assignLeadId, op.place_id)}
                    style={{...btnBase,width:"100%",justifyContent:"space-between",padding:"0.5rem 0.75rem",fontSize:12,
                      background:assignTo===op.place_id?"rgba(167,139,250,0.15)":"rgba(255,255,255,0.04)",
                      color:"#fff",border:`1px solid ${assignTo===op.place_id?C.purple:"transparent"}`}}>
                    <span>🚛 {op.name}</span>
                    <span style={{fontSize:10,color:C.muted}}>{op.default_zone||"—"}</span>
                  </button>
                ))}
              </div>
            )}
            <button onClick={()=>setAssignLeadId(null)}
              style={{...btnBase,width:"100%",justifyContent:"center",padding:"0.4rem",fontSize:11,color:C.muted,background:"rgba(255,255,255,0.04)",marginTop:"0.75rem"}}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// BUYER CRM — with OUTREACH AUTOMATION ENGINE
// ══════════════════════════════════════════════════════════════
function BuyerCRM({flash}) {
  // ── D1 CRM API config ──
  const crmUrl   = ENV_CRM_URL;
  const crmToken = ENV_CRM_TOKEN;
  const crm = useCallback((path, method, body) => crmFetch(crmUrl, crmToken, path, method, body), [crmUrl, crmToken]);

  // Pipeline = all prospects with stage != 'discovery'
  const [pipeline,    setPipeline]    = useState([]);
  // Prospects = ALL prospects (discovery + pipeline, used for search view)
  const [prospects,    setProspects]    = useState([]);
  const [searched,     setSearched]     = useState(false);

  const [selected,     setSelected]    = useState(null);
  const [crmView,      setCrmView]     = useState("today");  // DEFAULT to today view
  const [outreachBiz,  setOutreachBiz] = useState(null);
  const [outreachType, setOutreachType]= useState("email");
  const [outreachText, setOutreachText]= useState("");
  const [generating,   setGenerating]  = useState(false);
  const [showOutreachModal, setShowOutreachModal] = useState(false);
  const [loading,      setLoading]     = useState(false);
  const [syncing,      setSyncing]     = useState(false);
  const [filter,       setFilter]      = useState("qualified");
  const [showAddForm,  setShowAddForm] = useState(false);
  const [newBiz,       setNewBiz]      = useState({name:"",formatted_phone_number:"",vicinity:"",website:"",rating:"",user_ratings_total:"",notes:""});
  const [googleKey,    setGoogleKey]   = useState(ENV_GPLACES || lsGet("gplaces_key") || "");

  // Load from D1 CRM API on mount
  useEffect(() => {
    if (!crmUrl || !crmToken) return;
    loadCRMData();
  }, [crmUrl, crmToken]);

  async function loadCRMData() {
    setSyncing(true);
    try {
      const { prospects: all } = await crm("/prospects");
      const normalized = all.map(normalizeProspect);
      // For each prospect, fetch activities to populate the activities array
      const withActivities = await Promise.all(normalized.map(async (p) => {
        try {
          const { activities } = await crm(`/prospects/${encodeURIComponent(p.place_id)}/activities`);
          return { ...p, activities: activities || [] };
        } catch { return { ...p, activities: [] }; }
      }));
      setProspects(withActivities);
      setSearched(true);
      // Pipeline = non-discovery prospects
      setPipeline(withActivities.filter(p => p.stage !== "discovery"));
    } catch(e) {
      console.warn("CRM load error:", e.message);
      flash("⚠️ CRM API error — check connection","error");
    }
    setSyncing(false);
  }

  // Helper: reload a single prospect after mutation and update state
  async function reloadProspect(id) {
    try {
      const data = await crm(`/prospects/${encodeURIComponent(id)}`);
      const p = normalizeProspect({ ...data, activities: data.activities || [] });
      setProspects(prev => prev.map(x => x.place_id === id ? p : x));
      setPipeline(prev => {
        if (p.stage === "discovery") return prev.filter(x => x.place_id !== id);
        const exists = prev.find(x => x.place_id === id);
        if (exists) return prev.map(x => x.place_id === id ? p : x);
        return [...prev, p];
      });
      if (selected?.place_id === id) setSelected(p);
      return p;
    } catch(e) { console.warn("Reload failed:", e.message); }
  }

  async function searchProspects() {
    setLoading(true);
    if (googleKey.trim()) {
      try {
        const results = await searchGooglePlaces("dumpster rental","Florence SC", googleKey.trim());
        if (results.length === 0) throw new Error("No results returned");
        const existingIds = new Set(prospects.map(p=>p.place_id));
        const newResults = results.filter(r=>!existingIds.has(r.place_id));
        // Add each new result to D1
        for (const r of newResults) {
          try {
            await crm("/prospects", "POST", {
              place_id: r.place_id,
              name: r.name || "",
              short_name: r.short_name || "",
              phone: r.formatted_phone_number || "",
              address: r.vicinity || "",
              website: r.website || null,
              rating: r.rating || 0,
              reviews: r.user_ratings_total || 0,
              notes: r.notes || "",
              stage: "discovery",
            });
          } catch(e) { console.warn("Add prospect error:", r.name, e.message); }
        }
        await loadCRMData();
        setLoading(false);
        flash(`Found ${results.length} companies via Google Places ✅`);
        return;
      } catch(e) {
        flash(`Places API error: ${e.message}`, "error");
        setLoading(false); return;
      }
    }
    // No API key — just reload from D1
    await loadCRMData();
    setLoading(false);
    flash("Prospects loaded ✅");
  }

  async function addProspect(biz) {
    try {
      await crm("/prospects", "POST", {
        name: biz.name || "",
        short_name: biz.short_name || "",
        phone: biz.formatted_phone_number || "",
        address: biz.vicinity || "",
        website: biz.website || null,
        rating: parseFloat(biz.rating) || 0,
        reviews: parseInt(biz.user_ratings_total) || 0,
        notes: biz.notes || "",
        stage: "discovery",
      });
      await loadCRMData();
      flash(biz.name+" added ✅");
      // Auto-search for email in background
      if (!biz.email && biz.website) {
        findEmail({...biz, place_id: biz.place_id || biz.id});
      }
    } catch(e) { flash(`Add failed: ${e.message}`,"error"); }
  }

  // ── EMAIL FINDER ──
  const [emailSearching, setEmailSearching] = useState({});
  async function findEmail(prospect) {
    const pid = prospect.place_id || prospect.id;
    setEmailSearching(prev => ({...prev, [pid]: true}));
    try {
      const socialLinks = [];
      // Try to find Facebook/Yelp from the prospect data or common patterns
      if (prospect.website) {
        // Common social patterns
        socialLinks.push(`https://www.facebook.com/search/top/?q=${encodeURIComponent(prospect.name)}`);
      }
      const res = await fetch("https://florence-outreach.cball8475.workers.dev/email-search", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
          name: prospect.name,
          website: prospect.website || null,
          social_links: socialLinks,
        }),
      });
      const data = await res.json();
      if (data.emails && data.emails.length > 0) {
        const bestEmail = data.emails[0].email;
        const sources = data.emails[0].sources.join(", ");
        await crm(`/prospects/${encodeURIComponent(pid)}`, "PATCH", { email: bestEmail });
        await reloadProspect(pid);
        flash(`Found email for ${prospect.short_name||prospect.name}: ${bestEmail} (from ${sources}) ✅`);
      } else {
        flash(`No email found for ${prospect.short_name||prospect.name} — try adding manually`, "info");
      }
    } catch(e) {
      flash(`Email search failed: ${e.message}`, "error");
    } finally {
      setEmailSearching(prev => ({...prev, [pid]: false}));
    }
  }

  async function deleteProspect(place_id) {
    try {
      await crm(`/prospects/${encodeURIComponent(place_id)}`, "DELETE");
      setProspects(prev => prev.filter(p=>p.place_id!==place_id));
      setPipeline(prev => prev.filter(p=>p.place_id!==place_id));
      if (selected?.place_id === place_id) setSelected(null);
      flash("Prospect removed");
    } catch(e) { flash(`Delete failed: ${e.message}`,"error"); }
  }

  async function addToPipeline(biz) {
    if(pipeline.find(p=>p.place_id===biz.place_id)){flash("Already in pipeline","info");return;}
    try {
      await crm(`/prospects/${encodeURIComponent(biz.place_id)}`, "PATCH", {
        stage: "prospect",
        score: qualifyScore(biz),
      });
      await reloadProspect(biz.place_id);
      flash(`${biz.name} added ✅`);
    } catch(e) { flash(`Add to pipeline failed: ${e.message}`,"error"); }
  }

  async function addAllQualified() {
    const q=prospects.filter(p=>qualifyScore(p)>=55&&!pipeline.find(pl=>pl.place_id===p.place_id));
    if(!q.length){flash("No new qualified prospects","info");return;}
    for (const b of q) {
      try {
        await crm(`/prospects/${encodeURIComponent(b.place_id)}`, "PATCH", {
          stage: "prospect",
          score: qualifyScore(b),
        });
      } catch(e) { console.warn("Failed:", b.name, e.message); }
    }
    await loadCRMData();
    flash(`Added ${q.length} prospects`);
  }

  async function updateStage(id, stage) {
    try {
      await crm(`/prospects/${encodeURIComponent(id)}`, "PATCH", { stage });
      await reloadProspect(id);
    } catch(e) { flash(`Update failed: ${e.message}`,"error"); }
  }

  async function updateNotes(id, notes) {
    try {
      await crm(`/prospects/${encodeURIComponent(id)}`, "PATCH", { notes });
      // Optimistic local update (no full reload for notes)
      setPipeline(prev => prev.map(p=>p.place_id===id?{...p,notes}:p));
      setProspects(prev => prev.map(p=>p.place_id===id?{...p,notes}:p));
    } catch(e) { console.warn("Notes save failed:", e.message); }
  }

  async function removeFromPipeline(id) {
    try {
      await crm(`/prospects/${encodeURIComponent(id)}`, "PATCH", { stage: "discovery" });
      setPipeline(prev => prev.filter(p=>p.place_id!==id));
      setProspects(prev => prev.map(p=>p.place_id===id?{...p,stage:"discovery"}:p));
      setSelected(null);
      flash("Removed");
    } catch(e) { flash(`Remove failed: ${e.message}`,"error"); }
  }

  // ── SEQUENCE ENGINE (D1-backed) ──────────────────────────
  async function enrollInSequence(prospectId, sequenceId) {
    try {
      await crm(`/prospects/${encodeURIComponent(prospectId)}/enroll`, "POST", { sequence: sequenceId });
      await reloadProspect(prospectId);
      flash("Enrolled in sequence ✅");
    } catch(e) { flash(`Enroll failed: ${e.message}`,"error"); }
  }

  async function completeStep(prospectId) {
    const p = pipeline.find(x => x.place_id === prospectId);
    if (!p || !p.sequence) return;
    const seq = SEQUENCES.find(s => s.id === p.sequence);
    const currentStep = seq?.steps[p.sequenceStep];
    try {
      await crm(`/prospects/${encodeURIComponent(prospectId)}/advance`, "POST", {
        note: `✅ Completed: ${currentStep?.label || "Step " + (p.sequenceStep + 1)}`,
      });
      // If this was the last step, unenroll
      if (seq && p.sequenceStep + 1 >= seq.steps.length) {
        await crm(`/prospects/${encodeURIComponent(prospectId)}/unenroll`, "POST");
      }
      await reloadProspect(prospectId);
      flash("Step completed ✅");
    } catch(e) { flash(`Complete failed: ${e.message}`,"error"); }
  }

  async function skipStep(prospectId) {
    const p = pipeline.find(x => x.place_id === prospectId);
    if (!p || !p.sequence) return;
    const seq = SEQUENCES.find(s => s.id === p.sequence);
    const currentStep = seq?.steps[p.sequenceStep];
    try {
      await crm(`/prospects/${encodeURIComponent(prospectId)}/activities`, "POST", {
        type: "skip",
        note: `⏭ Skipped: ${currentStep?.label || "Step " + (p.sequenceStep + 1)}`,
      });
      await crm(`/prospects/${encodeURIComponent(prospectId)}/advance`, "POST", {
        note: `⏭ Skipped: ${currentStep?.label || "Step"}`,
      });
      if (seq && p.sequenceStep + 1 >= seq.steps.length) {
        await crm(`/prospects/${encodeURIComponent(prospectId)}/unenroll`, "POST");
      }
      await reloadProspect(prospectId);
      flash("Step skipped");
    } catch(e) { flash(`Skip failed: ${e.message}`,"error"); }
  }

  async function logActivity(prospectId, type, note) {
    try {
      await crm(`/prospects/${encodeURIComponent(prospectId)}/activities`, "POST", { type, note });
      await crm(`/prospects/${encodeURIComponent(prospectId)}`, "PATCH", { last_contact: new Date().toISOString() });
      await reloadProspect(prospectId);
    } catch(e) { console.warn("Log activity failed:", e.message); }
  }

  async function unenrollSequence(prospectId) {
    try {
      await crm(`/prospects/${encodeURIComponent(prospectId)}/unenroll`, "POST");
      await reloadProspect(prospectId);
      flash("Unenrolled");
    } catch(e) { flash(`Unenroll failed: ${e.message}`,"error"); }
  }

  // ── COMPUTE TODAY'S ACTIONS ──────────────────────────────
  function getTodaysActions() {
    const actions = [];
    const now = new Date();
    pipeline.forEach(p => {
      if (!p.sequence || p.stage === "dead" || p.stage === "closed") return;
      const seq = SEQUENCES.find(s => s.id === p.sequence);
      if (!seq) return;
      const step = seq.steps[p.sequenceStep];
      if (!step) return;
      const dueDate = new Date(p.sequenceStarted);
      dueDate.setDate(dueDate.getDate() + step.day);
      const dueStr = dueDate.toISOString();
      if (isPast(dueStr) || isToday(dueStr)) {
        actions.push({
          prospect: p,
          step,
          stepIndex: p.sequenceStep,
          sequence: seq,
          dueDate: dueStr,
          overdue: isPast(dueStr) && !isToday(dueStr),
        });
      }
    });
    // Sort: overdue first, then by due date
    actions.sort((a, b) => (b.overdue ? 1 : 0) - (a.overdue ? 1 : 0) || new Date(a.dueDate) - new Date(b.dueDate));
    return actions;
  }

  // Prospects not yet enrolled in any sequence
  function getUnenrolled() {
    return pipeline.filter(p => !p.sequence && p.stage !== "dead" && p.stage !== "closed");
  }

  async function generate(biz, type) {
    setGenerating(true); setOutreachBiz(biz); setOutreachType(type); setOutreachText(""); setShowOutreachModal(true);
    try { const text=await generateOutreach(biz,type); setOutreachText(text); }
    catch(e) { setOutreachText(`Error: ${e.message}`); }
    setGenerating(false);
  }

  const stats={
    total:pipeline.length,
    closed:pipeline.filter(p=>p.stage==="closed").length,
    active:pipeline.filter(p=>p.stage==="pilot_active").length,
    revenue:pipeline.filter(p=>p.stage==="closed").length*497,
    todayActions: getTodaysActions().length,
    inSequence: pipeline.filter(p=>p.sequence).length,
  };

  const todayActions = getTodaysActions();
  const unenrolled = getUnenrolled();

  const TYPE_ICONS = { email: "✉️", call: "📞", coldcall: "📞", sms: "💬", letter: "📄", enrolled: "🚀", skip: "⏭", unenroll: "🛑", action: "⚡" };

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",minHeight:0}}>
      {/* CRM Sub-tabs */}
      <div style={{display:"flex",gap:4,padding:"0.45rem 1rem",borderBottom:`1px solid ${C.border}`,flexShrink:0,alignItems:"center"}}>
        {[["today",`⚡ Today ${todayActions.length>0?"("+todayActions.length+")":""}`],["pipeline","🗂 Pipeline"],["prospects","🔍 Prospects"],["sequences","🔄 Sequences"]].map(([k,l])=>(
          <button key={k} onClick={()=>setCrmView(k)}
            style={{...btnBase,padding:"0.25rem 0.7rem",fontSize:11,
              background:crmView===k?"rgba(56,189,248,0.15)":"transparent",
              color:crmView===k?C.blue:C.muted,border:`1px solid ${crmView===k?"rgba(56,189,248,0.3)":"transparent"}`,
              ...(k==="today"&&todayActions.length>0?{background:crmView===k?"rgba(34,197,94,0.2)":"rgba(34,197,94,0.08)",color:crmView===k?C.green:C.green,border:`1px solid ${crmView===k?"rgba(34,197,94,0.4)":"rgba(34,197,94,0.2)"}`}:{})
            }}>
            {l}
          </button>
        ))}
        {syncing && <span style={{fontSize:10,color:C.muted,marginLeft:4}}>⟳ syncing…</span>}
        <div style={{marginLeft:"auto",display:"flex",gap:"1.25rem"}}>
          {[{l:"Pipeline",v:stats.total},{l:"Sequenced",v:stats.inSequence,c:C.purple},{l:"Today",v:stats.todayActions,c:stats.todayActions>0?C.green:C.muted},{l:"Active",v:stats.active,c:C.blue},{l:"Closed",v:stats.closed,c:C.green},{l:"Revenue",v:`$${stats.revenue.toLocaleString()}`,c:C.green}].map(s=>(
            <div key={s.l} style={{textAlign:"center"}}>
              <div style={{fontSize:14,fontWeight:800,color:s.c||"#fff"}}>{s.v}</div>
              <div style={{fontSize:8,color:C.muted}}>{s.l}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ══════════ TODAY'S ACTIONS ══════════ */}
      {crmView==="today"&&(
        <div style={{flex:1,overflow:"auto",padding:"0.85rem"}}>
          {todayActions.length === 0 && unenrolled.length === 0 ? (
            <div style={{textAlign:"center",padding:"3rem",color:C.muted}}>
              <div style={{fontSize:48,marginBottom:"0.6rem"}}>✅</div>
              <div style={{fontSize:16,color:"#fff",fontWeight:700,marginBottom:"0.4rem"}}>All caught up!</div>
              <div style={{fontSize:12}}>No actions due today. Enroll prospects in sequences to start the automation.</div>
              <button onClick={()=>setCrmView("sequences")} style={{...btnBase,background:C.purple,color:"#fff",padding:"0.5rem 1.25rem",fontSize:13,marginTop:"1rem"}}>
                🔄 Set Up Sequences →
              </button>
            </div>
          ) : (
            <>
              {todayActions.length > 0 && (
                <>
                  <div style={{fontSize:13,fontWeight:800,color:"#fff",marginBottom:"0.65rem",display:"flex",alignItems:"center",gap:"0.5rem"}}>
                    <span style={{fontSize:18}}>⚡</span> Today's Actions — {todayActions.length} due
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:"0.5rem",marginBottom:"1.5rem"}}>
                    {todayActions.map((action, i) => {
                      const {prospect: p, step, sequence: seq, overdue, stepIndex} = action;
                      return (
                        <div key={p.place_id+"-"+stepIndex} style={{
                          background:C.card, border:`1px solid ${overdue?"rgba(239,68,68,0.3)":C.border}`,
                          borderLeft:`4px solid ${overdue?C.red:step.type==="call"||step.type==="coldcall"?C.green:step.type==="email"?C.blue:C.amber}`,
                          borderRadius:10, padding:"0.85rem", display:"flex", gap:"0.85rem", alignItems:"flex-start"
                        }}>
                          <div style={{fontSize:28,flexShrink:0}}>{TYPE_ICONS[step.type] || "⚡"}</div>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{display:"flex",alignItems:"center",gap:"0.5rem",marginBottom:4}}>
                              <span style={{fontSize:13,fontWeight:800,color:"#fff"}}>{p.name}</span>
                              {overdue && <span style={{fontSize:9,fontWeight:700,color:C.red,background:"rgba(239,68,68,0.15)",padding:"1px 6px",borderRadius:100}}>OVERDUE</span>}
                              <span style={{fontSize:9,color:C.muted,marginLeft:"auto"}}>{seq.name} · Step {stepIndex+1}/{seq.steps.length}</span>
                            </div>
                            <div style={{fontSize:12,fontWeight:600,color:C.text,marginBottom:6}}>
                              {step.label}
                            </div>
                            {/* Show template preview */}
                            <div style={{background:"rgba(0,0,0,0.25)",borderRadius:6,padding:"0.55rem",marginBottom:8,maxHeight:120,overflowY:"auto"}}>
                              {step.subject && <div style={{fontSize:10,color:C.amber,marginBottom:3}}>Subject: {fillTemplate(step.subject, p)}</div>}
                              <div style={{fontSize:10,color:C.text,lineHeight:1.6,whiteSpace:"pre-wrap"}}>{fillTemplate(step.template, p).slice(0, 300)}{fillTemplate(step.template, p).length > 300 ? "…" : ""}</div>
                            </div>
                            <div style={{display:"flex",gap:"0.4rem",flexWrap:"wrap"}}>
                              <button onClick={()=>completeStep(p.place_id)} style={{...btnBase,background:C.green,color:"#fff",fontSize:11,padding:"0.35rem 0.85rem"}}>
                                ✅ Mark Done
                              </button>
                              {(step.type==="call"||step.type==="coldcall")&&p.formatted_phone_number&&(
                                <a href={`tel:+1${cleanPhone(p.formatted_phone_number)}`}
                                  style={{...btnBase,background:"rgba(34,197,94,0.15)",color:C.green,border:`1px solid rgba(34,197,94,0.3)`,fontSize:11,padding:"0.35rem 0.85rem",textDecoration:"none"}}>
                                  📞 Call {p.formatted_phone_number}
                                </a>
                              )}
                              {step.type==="email"&&(
                                <button onClick={()=>{navigator.clipboard.writeText(fillTemplate(step.template,p));flash("Email copied!");}}
                                  style={{...btnBase,background:"rgba(56,189,248,0.1)",color:C.blue,border:`1px solid rgba(56,189,248,0.2)`,fontSize:11,padding:"0.35rem 0.85rem"}}>
                                  📋 Copy Email
                                </button>
                              )}
                              {step.type==="sms"&&(
                                <button onClick={()=>{navigator.clipboard.writeText(fillTemplate(step.template,p));flash("SMS copied!");}}
                                  style={{...btnBase,background:"rgba(245,158,11,0.1)",color:C.amber,border:`1px solid rgba(245,158,11,0.2)`,fontSize:11,padding:"0.35rem 0.85rem"}}>
                                  📋 Copy SMS
                                </button>
                              )}
                              <button onClick={()=>generate(p, step.type==="coldcall"?"coldcall":"email")}
                                style={{...btnBase,background:"rgba(167,139,250,0.1)",color:C.purple,border:`1px solid rgba(167,139,250,0.2)`,fontSize:11,padding:"0.35rem 0.85rem"}}>
                                🤖 AI Rewrite
                              </button>
                              <button onClick={()=>skipStep(p.place_id)}
                                style={{...btnBase,background:"rgba(255,255,255,0.05)",color:C.muted,fontSize:10,padding:"0.35rem 0.65rem"}}>
                                ⏭ Skip
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {unenrolled.length > 0 && (
                <>
                  <div style={{fontSize:12,fontWeight:700,color:C.amber,marginBottom:"0.5rem",display:"flex",alignItems:"center",gap:"0.4rem"}}>
                    <span>⚠️</span> {unenrolled.length} prospect{unenrolled.length>1?"s":""} not in a sequence
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(250px,1fr))",gap:"0.5rem"}}>
                    {unenrolled.map(p => (
                      <div key={p.place_id} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:"0.65rem"}}>
                        <div style={{fontSize:11,fontWeight:700,color:"#fff",marginBottom:3}}>{p.name}</div>
                        <div style={{fontSize:9,color:C.muted,marginBottom:6}}>{p.formatted_phone_number || "No phone"} · {p.vicinity}</div>
                        <div style={{display:"flex",gap:3,flexWrap:"wrap"}}>
                          {SEQUENCES.map(seq => (
                            <button key={seq.id} onClick={()=>enrollInSequence(p.place_id, seq.id)}
                              style={{...btnBase,background:"rgba(167,139,250,0.1)",color:C.purple,border:`1px solid rgba(167,139,250,0.2)`,fontSize:9,padding:"0.2rem 0.5rem"}}>
                              🚀 {seq.name.split("—")[0].trim()}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* ══════════ SEQUENCES VIEW ══════════ */}
      {crmView==="sequences"&&(
        <div style={{flex:1,overflow:"auto",padding:"0.85rem"}}>
          <div style={{fontSize:13,fontWeight:800,color:"#fff",marginBottom:"0.75rem"}}>🔄 Outreach Sequences</div>

          {/* Sequence templates */}
          <div style={{display:"flex",flexDirection:"column",gap:"0.65rem",marginBottom:"1.5rem"}}>
            {SEQUENCES.map(seq => {
              const enrolled = pipeline.filter(p => p.sequence === seq.id);
              return (
                <div key={seq.id} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"0.85rem"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                    <div>
                      <div style={{fontSize:13,fontWeight:700,color:"#fff"}}>{seq.name}</div>
                      <div style={{fontSize:10,color:C.muted,marginTop:2}}>{seq.description}</div>
                    </div>
                    <div style={{fontSize:11,color:enrolled.length>0?C.purple:C.muted,fontWeight:700}}>
                      {enrolled.length} enrolled
                    </div>
                  </div>
                  {/* Steps timeline */}
                  <div style={{display:"flex",gap:0,alignItems:"center",marginBottom:10}}>
                    {seq.steps.map((step, i) => (
                      <div key={i} style={{display:"flex",alignItems:"center"}}>
                        <div style={{
                          background:step.type==="call"||step.type==="coldcall"?"rgba(34,197,94,0.15)":step.type==="email"?"rgba(56,189,248,0.15)":"rgba(245,158,11,0.15)",
                          border:`1px solid ${step.type==="call"||step.type==="coldcall"?"rgba(34,197,94,0.3)":step.type==="email"?"rgba(56,189,248,0.3)":"rgba(245,158,11,0.3)"}`,
                          borderRadius:6,padding:"0.3rem 0.5rem",textAlign:"center",minWidth:70
                        }}>
                          <div style={{fontSize:14}}>{TYPE_ICONS[step.type]}</div>
                          <div style={{fontSize:8,color:C.text,marginTop:1}}>{step.label}</div>
                          <div style={{fontSize:8,color:C.muted}}>Day {step.day}</div>
                        </div>
                        {i < seq.steps.length - 1 && (
                          <div style={{width:20,height:1,background:C.border,flexShrink:0}}/>
                        )}
                      </div>
                    ))}
                  </div>
                  {/* Enrolled prospects */}
                  {enrolled.length > 0 && (
                    <div style={{display:"flex",flexDirection:"column",gap:3}}>
                      {enrolled.map(p => {
                        const step = seq.steps[p.sequenceStep];
                        return (
                          <div key={p.place_id} style={{display:"flex",alignItems:"center",gap:"0.5rem",padding:"0.3rem 0.5rem",background:"rgba(0,0,0,0.2)",borderRadius:5}}>
                            <span style={{fontSize:10,color:"#fff",fontWeight:600,flex:1}}>{p.name}</span>
                            <span style={{fontSize:9,color:C.purple}}>Step {p.sequenceStep+1}/{seq.steps.length}</span>
                            <span style={{fontSize:9,color:C.muted}}>{step?.label}</span>
                            <button onClick={()=>unenrollSequence(p.place_id)}
                              style={{...btnBase,background:"transparent",color:C.red,fontSize:9,padding:"0.15rem 0.3rem"}}>✕</button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {/* Quick enroll */}
                  {unenrolled.length > 0 && (
                    <div style={{marginTop:8,display:"flex",gap:3,flexWrap:"wrap"}}>
                      {unenrolled.slice(0,5).map(p => (
                        <button key={p.place_id} onClick={()=>enrollInSequence(p.place_id, seq.id)}
                          style={{...btnBase,background:"rgba(167,139,250,0.08)",color:C.purple,border:`1px solid rgba(167,139,250,0.15)`,fontSize:9,padding:"0.2rem 0.5rem"}}>
                          + {p.name}
                        </button>
                      ))}
                      {unenrolled.length > 5 && <span style={{fontSize:9,color:C.muted,alignSelf:"center"}}>+{unenrolled.length-5} more</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Activity feed */}
          <div style={{fontSize:12,fontWeight:700,color:"#fff",marginBottom:"0.5rem"}}>📋 Recent Activity</div>
          <div style={{display:"flex",flexDirection:"column",gap:3}}>
            {pipeline
              .flatMap(p => (p.activities || []).map(a => ({...a, bizName: p.name, place_id: p.place_id})))
              .sort((a,b) => new Date(b.date) - new Date(a.date))
              .slice(0, 20)
              .map((a, i) => (
                <div key={i} style={{display:"flex",alignItems:"center",gap:"0.5rem",padding:"0.35rem 0.5rem",background:i%2===0?C.card:"transparent",borderRadius:4}}>
                  <span style={{fontSize:12}}>{TYPE_ICONS[a.type] || "📌"}</span>
                  <span style={{fontSize:10,color:"#fff",fontWeight:600,minWidth:120}}>{a.bizName}</span>
                  <span style={{fontSize:10,color:C.text,flex:1}}>{a.note}</span>
                  <span style={{fontSize:9,color:C.muted,whiteSpace:"nowrap"}}>{ago(a.date)}</span>
                </div>
              ))
            }
            {pipeline.flatMap(p => p.activities || []).length === 0 && (
              <div style={{padding:"1rem",textAlign:"center",color:C.muted,fontSize:11}}>No activity yet. Enroll prospects in sequences to get started.</div>
            )}
          </div>
        </div>
      )}

      {/* ══════════ PIPELINE VIEW ══════════ */}
      {crmView==="pipeline"&&(
        <div style={{flex:1,display:"flex",gap:"0.45rem",padding:"0.5rem",overflowX:"auto",overflowY:"auto",minHeight:0}}>
          {STAGES.map(stage=>{
            const cards=pipeline.filter(p=>p.stage===stage);
            return(
              <div key={stage} style={{width:260,minWidth:260,flexShrink:0,display:"flex",flexDirection:"column",background:"rgba(0,0,0,0.15)",borderRadius:10,padding:"0.45rem"}}>
                <div style={{display:"flex",alignItems:"center",gap:"0.35rem",padding:"0.3rem 0.35rem 0.55rem",borderBottom:`2px solid ${STAGE_COLORS[stage]}`}}>
                  <span style={{fontSize:11,fontWeight:800,color:STAGE_COLORS[stage]}}>{STAGE_LABELS[stage]}</span>
                  <span style={{fontSize:9,color:C.muted,marginLeft:"auto"}}>{cards.length}</span>
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:"0.4rem",minHeight:50,flex:1,overflowY:"auto",paddingTop:"0.4rem"}}>
                  {cards.map(p=>{
                    const isOpen = selected?.place_id===p.place_id;
                    const seq = SEQUENCES.find(s=>s.id===p.sequence);
                    const step = seq?.steps[p.sequenceStep];
                    return (
                      <div key={p.place_id}
                        style={{background:isOpen?"#1a3349":C.card,
                          border:`1px solid ${isOpen?C.blue:C.border}`,
                          borderLeft:`3px solid ${STAGE_COLORS[stage]}`,
                          borderRadius:8,overflow:"hidden"}}>
                        {/* Card header — always visible */}
                        <div onClick={()=>{console.log("CLICK",p.place_id,p.short_name);setSelected(isOpen?null:p);}}
                          style={{padding:"0.65rem 0.75rem",cursor:"pointer"}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                            <div style={{flex:1,minWidth:0}}>
                              <div style={{fontSize:13,fontWeight:700,color:"#fff",lineHeight:1.35,marginBottom:3}}>{p.short_name||p.name}</div>
                              {p.default_zone&&<span style={{fontSize:9,fontWeight:700,color:C.purple,background:"rgba(167,139,250,0.15)",padding:"2px 6px",borderRadius:100}}>Zone {p.default_zone}</span>}
                            </div>
                            <span style={{fontSize:12,color:isOpen?C.blue:C.muted,flexShrink:0,marginLeft:6}}>{isOpen?"▾":"▸"}</span>
                          </div>
                          <div style={{fontSize:10,color:C.amber,marginTop:2}}>★ {p.rating} <span style={{color:C.muted}}>({p.user_ratings_total})</span></div>
                          {p.sequence && (
                            <div style={{fontSize:9,color:C.purple,marginTop:3}}>
                              🔄 {seq?.name?.split("—")[0]?.trim()} · Step {(p.sequenceStep||0)+1}
                            </div>
                          )}
                          {p.notes&&!isOpen&&<div style={{fontSize:10,color:C.muted,marginTop:3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.notes}</div>}
                        </div>
                        {/* Expanded detail — inline */}
                        {isOpen&&(
                          <div style={{padding:"0 0.65rem 0.65rem",display:"flex",flexDirection:"column",gap:"0.5rem",borderTop:`1px solid ${C.border}`}}>
                            {/* Contact */}
                            <div style={{paddingTop:"0.5rem"}}>
                              <div style={{fontSize:9,color:C.muted,letterSpacing:"0.1em",marginBottom:4}}>CONTACT</div>
                              {p.formatted_phone_number&&(
                                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                                  <span style={{fontSize:11,color:C.text}}>{p.formatted_phone_number}</span>
                                  <a href={`tel:+1${cleanPhone(p.formatted_phone_number)}`}
                                     style={{...btnBase,background:C.green,color:"#fff",padding:"0.15rem 0.5rem",fontSize:10,textDecoration:"none"}}>📞 Call</a>
                                </div>
                              )}
                              {p.email?(
                                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                                  <span style={{fontSize:11,color:C.text}}>{p.email}</span>
                                  <a href={`mailto:${p.email}`}
                                     style={{...btnBase,background:C.blue,color:"#fff",padding:"0.15rem 0.5rem",fontSize:10,textDecoration:"none"}}>✉️</a>
                                </div>
                              ):(
                                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                                  <span style={{fontSize:10,color:C.muted,fontStyle:"italic"}}>No email</span>
                                  <button onClick={()=>findEmail(p)} disabled={emailSearching[p.place_id||p.id]}
                                    style={{...btnBase,background:"rgba(99,102,241,0.1)",color:C.blue,border:`1px solid rgba(99,102,241,0.2)`,padding:"0.15rem 0.5rem",fontSize:9}}>
                                    {emailSearching[p.place_id||p.id]?"⏳ Searching…":"🔍 Find Email"}
                                  </button>
                                </div>
                              )}
                              {p.vicinity&&<div style={{fontSize:9,color:C.muted}}>{p.vicinity}</div>}
                              {p.website&&<a href={p.website.startsWith("http")?p.website:`https://${p.website}`} target="_blank" rel="noreferrer" style={{fontSize:9,color:C.blue,textDecoration:"none"}}>{p.website}</a>}
                            </div>
                            {/* Score */}
                            <div>
                              <div style={{fontSize:9,color:C.muted,letterSpacing:"0.1em",marginBottom:3}}>SCORE</div>
                              <div style={{background:"rgba(0,0,0,0.3)",borderRadius:3,height:4,marginBottom:3}}>
                                <div style={{width:`${p.score||qualifyScore(p)}%`,height:"100%",background:`linear-gradient(90deg,${C.blue},${C.purple})`,borderRadius:3}}/>
                              </div>
                              <div style={{fontSize:10,color:"#fff"}}>{p.score||qualifyScore(p)}/100</div>
                            </div>
                            {/* Sequence */}
                            <div>
                              <div style={{fontSize:9,color:C.muted,letterSpacing:"0.1em",marginBottom:4}}>SEQUENCE</div>
                              {p.sequence ? (
                                <div>
                                  <div style={{fontSize:10,color:C.purple,fontWeight:700,marginBottom:2}}>{seq?.name}</div>
                                  <div style={{fontSize:10,color:C.text}}>Current: {step?.label} (Day {step?.day})</div>
                                  <div style={{fontSize:9,color:C.muted,marginTop:1}}>Step {(p.sequenceStep||0)+1} of {seq?.steps.length}</div>
                                  <div style={{display:"flex",gap:3,marginTop:5}}>
                                    <button onClick={()=>completeStep(p.place_id)}
                                      style={{...btnBase,background:C.green,color:"#fff",fontSize:9,padding:"0.2rem 0.5rem"}}>✅ Done</button>
                                    <button onClick={()=>skipStep(p.place_id)}
                                      style={{...btnBase,background:"rgba(255,255,255,0.06)",color:C.muted,fontSize:9,padding:"0.2rem 0.5rem"}}>⏭ Skip</button>
                                    <button onClick={()=>unenrollSequence(p.place_id)}
                                      style={{...btnBase,background:"rgba(239,68,68,0.08)",color:C.red,fontSize:9,padding:"0.2rem 0.5rem"}}>✕</button>
                                  </div>
                                </div>
                              ) : (
                                <div style={{display:"flex",flexDirection:"column",gap:2}}>
                                  <div style={{fontSize:10,color:C.muted,marginBottom:2}}>Not enrolled</div>
                                  {SEQUENCES.map(sq => (
                                    <button key={sq.id} onClick={()=>enrollInSequence(p.place_id, sq.id)}
                                      style={{...btnBase,background:"rgba(167,139,250,0.08)",color:C.purple,border:`1px solid rgba(167,139,250,0.15)`,fontSize:9,justifyContent:"flex-start",padding:"0.2rem 0.4rem"}}>
                                      🚀 {sq.name}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                            {/* Stage */}
                            <div>
                              <div style={{fontSize:9,color:C.muted,letterSpacing:"0.1em",marginBottom:4}}>STAGE</div>
                              <div style={{display:"flex",flexWrap:"wrap",gap:2}}>
                                {STAGES.map(s=>(
                                  <button key={s} onClick={()=>updateStage(p.place_id,s)}
                                    style={{...btnBase,padding:"0.2rem 0.4rem",fontSize:9,
                                      background:p.stage===s?`${STAGE_COLORS[s]}25`:"transparent",
                                      color:p.stage===s?"#fff":C.muted,
                                      border:`1px solid ${p.stage===s?STAGE_COLORS[s]:"transparent"}`}}>
                                    {STAGE_LABELS[s]}
                                  </button>
                                ))}
                              </div>
                            </div>
                            {/* AI Outreach */}
                            <div>
                              <div style={{fontSize:9,color:C.muted,letterSpacing:"0.1em",marginBottom:4}}>AI OUTREACH</div>
                              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:3}}>
                                {["email","coldcall","sms","letter"].map(t=>(
                                  <button key={t} onClick={()=>generate(p,t)}
                                    style={{...btnBase,background:"rgba(56,189,248,0.08)",color:C.blue,border:`1px solid rgba(56,189,248,0.2)`,fontSize:9,justifyContent:"center",padding:"0.25rem"}}>
                                    {t==="email"?"✉️ Email":t==="coldcall"?"📞 Script":t==="sms"?"💬 SMS":"📄 Letter"}
                                  </button>
                                ))}
                              </div>
                            </div>
                            {/* Notes */}
                            <div>
                              <div style={{fontSize:9,color:C.muted,letterSpacing:"0.1em",marginBottom:3}}>NOTES</div>
                              <textarea value={p.notes||""}
                                onChange={e=>{
                                  const val=e.target.value;
                                  setSelected(s=>({...s,notes:val}));
                                  setPipeline(prev=>prev.map(x=>x.place_id===p.place_id?{...x,notes:val}:x));
                                  updateNotes(p.place_id,val);
                                }}
                                placeholder="Add notes…"
                                style={{width:"100%",background:"rgba(0,0,0,0.3)",border:`1px solid ${C.border}`,borderRadius:5,color:C.text,fontSize:10,padding:"0.3rem",fontFamily:"inherit",minHeight:40,resize:"vertical",boxSizing:"border-box"}}/>
                            </div>
                            {/* Activity log */}
                            {(p.activities||[]).length > 0 && (
                              <div>
                                <div style={{fontSize:9,color:C.muted,letterSpacing:"0.1em",marginBottom:4}}>ACTIVITY</div>
                                <div style={{display:"flex",flexDirection:"column",gap:2,maxHeight:100,overflowY:"auto"}}>
                                  {[...(p.activities||[])].reverse().slice(0,5).map((a, i) => (
                                    <div key={i} style={{display:"flex",gap:"0.3rem",alignItems:"flex-start"}}>
                                      <span style={{fontSize:9,flexShrink:0}}>{TYPE_ICONS[a.type] || "📌"}</span>
                                      <span style={{fontSize:8,color:C.text,flex:1,lineHeight:1.3}}>{a.note}</span>
                                      <span style={{fontSize:7,color:C.muted,whiteSpace:"nowrap",flexShrink:0}}>{ago(a.date)}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            {/* Remove */}
                            <button onClick={()=>removeFromPipeline(p.place_id)}
                              style={{...btnBase,background:"rgba(239,68,68,0.1)",color:C.red,border:`1px solid rgba(239,68,68,0.2)`,justifyContent:"center",fontSize:9,padding:"0.25rem"}}>
                              Remove from Pipeline
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {cards.length===0&&<div style={{fontSize:9,color:"rgba(255,255,255,0.1)",textAlign:"center",padding:"0.85rem 0"}}>empty</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ══════════ PROSPECTS VIEW ══════════ */}
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
                <button onClick={async()=>{
                  const missing = pipeline.filter(p=>!p.email && p.website);
                  if(!missing.length){flash("All prospects with websites already have emails","info");return;}
                  flash(`Searching emails for ${missing.length} prospects…`);
                  for(const p of missing){await findEmail(p);}
                }} style={{...btnBase,background:"rgba(99,102,241,0.15)",color:C.blue,border:`1px solid rgba(99,102,241,0.2)`,fontSize:11}}>🔍 Find Missing Emails</button>
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
              <img src="/logo.png" alt="Florence SC Services" style={{width:48,height:48,borderRadius:10,marginBottom:"0.6rem"}}/>
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

      {/* ══════════ OUTREACH / AI DRAFT MODAL ══════════ */}
      {showOutreachModal&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:900,display:"flex",alignItems:"center",justifyContent:"center"}}
          onClick={e=>{if(e.target===e.currentTarget)setShowOutreachModal(false);}}>
          <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:14,width:"95%",maxWidth:600,maxHeight:"80vh",display:"flex",flexDirection:"column",overflow:"hidden"}}>
            <div style={{display:"flex",gap:"0.45rem",alignItems:"center",flexWrap:"wrap",padding:"0.85rem",borderBottom:`1px solid ${C.border}`}}>
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
              <button onClick={()=>setShowOutreachModal(false)}
                style={{...btnBase,background:"rgba(255,255,255,0.06)",color:C.muted,padding:"0.25rem 0.5rem",fontSize:12,...(outreachText?{}:{marginLeft:"auto"})}}>✕</button>
            </div>
            <div style={{flex:1,padding:"0.85rem",overflow:"auto"}}>
              <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"0.85rem",minHeight:180,position:"relative"}}>
                {generating
                  ?<div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:"0.5rem",minHeight:160}}>
                      <div style={{fontSize:26,animation:"pulse 0.8s infinite"}}>✍️</div>
                      <div style={{fontSize:12,color:C.blue}}>Generating…</div>
                    </div>
                  :<textarea value={outreachText} onChange={e=>setOutreachText(e.target.value)}
                      style={{width:"100%",minHeight:160,background:"transparent",border:"none",color:C.text,fontSize:12,fontFamily:"'Courier New',monospace",lineHeight:1.8,outline:"none",resize:"vertical"}}
                      placeholder="Select a company from Pipeline or Prospects and click an outreach type…"/>
                }
              </div>
              {outreachBiz?.formatted_phone_number&&outreachType==="coldcall"&&(
                <a href={`tel:+1${cleanPhone(outreachBiz.formatted_phone_number)}`}
                   style={{...btnBase,background:C.green,color:"#fff",fontSize:13,padding:"0.55rem 1.25rem",justifyContent:"center",textDecoration:"none",textAlign:"center",marginTop:"0.65rem",display:"flex"}}>
                  📞 Call {outreachBiz.name} — {outreachBiz.formatted_phone_number}
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// ROOT APP — CSS display toggle to prevent unmount/remount
// ══════════════════════════════════════════════════════════════
export default function App() {
  const [toast,setToast]               = useState(null);
  const [mainTab,setMainTab]           = useState("crm");

  const flash = useCallback((t,type="ok")=>{setToast({t,type});setTimeout(()=>setToast(null),3500);},[]);

  return(
    <div style={{height:"100vh",display:"flex",flexDirection:"column",background:C.dark,fontFamily:"'IBM Plex Sans',sans-serif",overflow:"hidden"}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;700&family=IBM+Plex+Sans:wght@400;600;800&display=swap');*{box-sizing:border-box;margin:0;padding:0;}::-webkit-scrollbar{width:4px;}::-webkit-scrollbar-thumb{background:rgba(99,179,237,0.2);border-radius:2px;}input::placeholder,textarea::placeholder{color:rgba(200,223,240,0.3);}@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}@keyframes slide-in{from{transform:translateY(8px);opacity:0}to{transform:none;opacity:1}}`}</style>
      <div style={{height:46,background:C.panel,borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",gap:"0.65rem",padding:"0 1rem",flexShrink:0}}>
        <img src="/logo.png" alt="FSC" style={{width:24,height:24,borderRadius:5}}/>
        <span style={{fontWeight:800,fontSize:13,color:"#fff",letterSpacing:"-0.02em"}}>Florence SC</span>
        <div style={{display:"flex",gap:3,marginLeft:"0.65rem"}}>
          {[["crm","🚀 Outreach Engine"],["leads","📊 Leads"]].map(([key,label])=>(
            <button key={key} onClick={()=>setMainTab(key)}
              style={{...btnBase,padding:"0.25rem 0.75rem",fontSize:11,
                background:mainTab===key?"rgba(56,189,248,0.15)":"transparent",
                color:mainTab===key?C.blue:C.muted,
                border:`1px solid ${mainTab===key?"rgba(56,189,248,0.3)":"transparent"}`}}>
              {label}
            </button>
          ))}
        </div>
        <div style={{marginLeft:"auto",display:"flex",gap:"0.45rem"}}>
          <a href="https://florencescservices.com" target="_blank" rel="noreferrer"
            style={{...btnBase,background:"rgba(255,255,255,0.05)",color:C.muted,padding:"0.22rem 0.65rem",fontSize:11,textDecoration:"none"}}>
            🌐 Live Site
          </a>
        </div>
      </div>
      {/* CSS display toggle — prevents unmount/remount state loss */}
      <div style={{display:mainTab==="leads"?"flex":"none",flex:1,overflow:"hidden"}}>
        <LeadsDashboard flash={flash}/>
      </div>
      <div style={{display:mainTab==="crm"?"flex":"none",flex:1,overflow:"hidden"}}>
        <BuyerCRM flash={flash}/>
      </div>
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
