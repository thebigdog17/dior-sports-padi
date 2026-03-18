// src/App.jsx
import { useState, useEffect, useCallback, useRef } from "react";
import { auth, registerUser, loginUser, signOut, onAuthStateChanged } from "./firebase";
import * as API from "./api";

const C = {
  peach:"#FDDBB4",peachLight:"#FEF4E8",peachMid:"#F9C48A",peachDeep:"#F0A050",peachWarm:"#FBCF9A",
  blue:"#1A3A6B",blueMid:"#2E5BA8",blueLight:"#4A7ED0",bluePale:"#D0E2F5",
  white:"#FFFDF8",dark:"#0D1F3C",accent:"#E8724A",gold:"#D4A847",
  green:"#1E7A47",red:"#C0392B",gray:"#8899AA",live:"#E53E3E",
};
const IS={width:"100%",padding:"12px 14px",borderRadius:10,fontSize:14,border:`1.5px solid ${C.bluePale}`,background:C.peachLight,color:C.dark,outline:"none",fontFamily:"inherit",boxSizing:"border-box"};
const LS={fontSize:11,fontWeight:700,color:C.gray,display:"block",marginBottom:5,letterSpacing:1};

function Card({children,s={},onClick}){return<div onClick={onClick} style={{background:C.white,borderRadius:16,padding:18,boxShadow:"0 2px 16px rgba(26,58,107,.09)",border:`1.5px solid ${C.bluePale}`,cursor:onClick?"pointer":"default",...s}}>{children}</div>;}
function Btn({children,onClick,v="primary",s={},disabled}){
  const vs={primary:{background:C.blue,color:"#fff"},accent:{background:C.accent,color:"#fff"},peach:{background:C.peachDeep,color:"#fff"},ghost:{background:C.peachLight,color:C.blue,border:`1.5px solid ${C.bluePale}`},green:{background:C.green,color:"#fff"},gold:{background:C.gold,color:"#fff"}};
  return<button onClick={onClick} disabled={disabled} style={{border:"none",borderRadius:10,padding:"10px 18px",fontWeight:700,fontSize:13,cursor:disabled?"not-allowed":"pointer",transition:"all .15s",opacity:disabled?.55:1,fontFamily:"inherit",...vs[v],...s}}>{children}</button>;
}
function Spin(){return<div style={{display:"flex",justifyContent:"center",padding:32}}><div style={{width:30,height:30,borderRadius:"50%",border:`3px solid ${C.bluePale}`,borderTopColor:C.blue,animation:"sp .7s linear infinite"}}/><style>{`@keyframes sp{to{transform:rotate(360deg)}}`}</style></div>;}
function dateStr(off=0){const d=new Date();d.setDate(d.getDate()+off);return d.toISOString().split("T")[0];}
function fmtDate(s){try{return new Date(s+"T12:00:00").toLocaleDateString("en-GB",{weekday:"short",day:"numeric",month:"short"});}catch{return s;}}

function getStatus(s){
  const u=(s||"").toUpperCase();
  if(["1H","2H","ET","P","IN_PLAY","INPROGRESS","LIVE"].some(x=>u===x||u.includes(x)))return{label:"LIVE",color:C.live,live:true,done:false};
  if(u==="HT")return{label:"HT",color:C.gold,live:false,done:false};
  if(["FT","AET","PEN","FINISHED"].some(x=>u===x||u.includes(x)))return{label:"FT",color:C.gray,live:false,done:true};
  if(u==="PST"||u.includes("POSTP")||u.includes("CANCEL"))return{label:"PST",color:C.red,live:false,done:false};
  return{label:"NS",color:C.gray,live:false,done:false};
}

// ── AUTH ──────────────────────────────────────────────────────────
function AuthModal({onClose,onLogin}){
  const [mode,setMode]=useState("login");
  const [name,setName]=useState(""),[email,setEmail]=useState(""),
    [pass,setPass]=useState(""),[pass2,setPass2]=useState("");
  const [err,setErr]=useState(""),[loading,setLoading]=useState(false);
  async function submit(e){
    e.preventDefault();setErr("");
    if(!email.includes("@")){setErr("Enter a valid email");return;}
    if(pass.length<6){setErr("Password must be at least 6 characters");return;}
    if(mode==="register"&&pass!==pass2){setErr("Passwords do not match");return;}
    if(mode==="register"&&name.trim().length<2){setErr("Enter your name");return;}
    setLoading(true);
    try{
      if(mode==="register"){
        const u=await registerUser(email,pass,name.trim());
        try{await API.saveProfile(name.trim());}catch{}
        onLogin({uid:u.uid,email:u.email,name:name.trim()});
      }else{
        const u=await loginUser(email,pass);
        let p={uid:u.uid,email:u.email,name:u.displayName||email.split("@")[0]};
        try{const pr=await API.getProfile();p={...p,...pr};}catch{}
        onLogin(p);
      }
    }catch(e){
      const m=e.message||"";
      if(m.includes("email-already"))setErr("Email already registered.");
      else if(m.includes("user-not-found")||m.includes("wrong-password")||m.includes("invalid-credential"))setErr("Incorrect email or password.");
      else if(m.includes("too-many"))setErr("Too many attempts. Try later.");
      else setErr(m.replace("Firebase: ","").replace(/\(.*\)/,"").trim());
    }
    setLoading(false);
  }
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(13,31,60,.9)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div style={{background:C.white,borderRadius:24,padding:32,width:"100%",maxWidth:380,boxShadow:"0 24px 64px rgba(0,0,0,.35)",position:"relative"}}>
        <div style={{textAlign:"center",marginBottom:22}}>
          <div style={{fontSize:40,marginBottom:6}}>⚽</div>
          <div style={{fontFamily:"Georgia,serif",fontSize:22,fontWeight:900,color:C.blue}}>Dior Sports Padi</div>
        </div>
        <div style={{display:"flex",background:C.peachLight,borderRadius:12,padding:4,marginBottom:22}}>
          {["login","register"].map(m=><button key={m} onClick={()=>{setMode(m);setErr("");}} style={{flex:1,background:mode===m?C.blue:"transparent",color:mode===m?"#fff":C.gray,border:"none",borderRadius:9,padding:"10px 0",fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>{m==="login"?"Sign In":"Create Account"}</button>)}
        </div>
        <form onSubmit={submit}>
          {mode==="register"&&<div style={{marginBottom:12}}><label style={LS}>YOUR NAME</label><input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Dior" style={IS}/></div>}
          <div style={{marginBottom:12}}><label style={LS}>EMAIL</label><input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@email.com" style={IS}/></div>
          <div style={{marginBottom:mode==="register"?12:18}}><label style={LS}>PASSWORD</label><input type="password" value={pass} onChange={e=>setPass(e.target.value)} placeholder="Min 6 chars" style={IS}/></div>
          {mode==="register"&&<div style={{marginBottom:18}}><label style={LS}>CONFIRM PASSWORD</label><input type="password" value={pass2} onChange={e=>setPass2(e.target.value)} placeholder="Repeat password" style={IS}/></div>}
          {err&&<div style={{color:C.red,fontSize:13,marginBottom:12,fontWeight:600}}>⚠️ {err}</div>}
          <Btn onClick={submit} disabled={loading} s={{width:"100%",padding:13,fontSize:15}}>{loading?"Please wait...":(mode==="login"?"Sign In →":"Create Account →")}</Btn>
        </form>
        <div style={{textAlign:"center",marginTop:14,fontSize:12,color:C.gray}}>
          {mode==="login"?"No account? ":"Already registered? "}
          <span onClick={()=>{setMode(mode==="login"?"register":"login");setErr("");}} style={{color:C.blue,fontWeight:700,cursor:"pointer"}}>{mode==="login"?"Sign up":"Sign in"}</span>
        </div>
        <button onClick={onClose} style={{position:"absolute",top:14,right:18,background:"none",border:"none",fontSize:22,cursor:"pointer",color:C.gray}}>✕</button>
      </div>
    </div>
  );
}

// ── DATE STRIP ────────────────────────────────────────────────────
function DateStrip({selected,onChange}){
  const days=[];
  for(let i=-3;i<=7;i++){
    const d=new Date();d.setDate(d.getDate()+i);
    const s=d.toISOString().split("T")[0];
    const l=i===0?"Today":i===-1?"Yest":d.toLocaleDateString("en-GB",{day:"numeric",month:"short"});
    days.push({s,l,today:i===0});
  }
  return(
    <div style={{display:"flex",gap:6,overflowX:"auto",paddingBottom:6,marginBottom:16,scrollbarWidth:"none"}}>
      {days.map(d=><button key={d.s} onClick={()=>onChange(d.s)} style={{flex:"0 0 auto",background:d.s===selected?C.blue:C.white,color:d.s===selected?"#fff":C.dark,border:`1.5px solid ${d.s===selected?C.blue:C.bluePale}`,borderRadius:22,padding:"7px 16px",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap",outline:"none"}}>
        {d.l}{d.today&&d.s!==selected?<span style={{color:C.accent,marginLeft:3}}>●</span>:null}
      </button>)}
    </div>
  );
}

// ── MATCH ROW — Sofascore style with team logos ───────────────────
function MatchRow({m,onClick,selected}){
  const st=getStatus(m.status||"");
  const hs=m.home_score;
  const as_=m.away_score;
  const hasScore=hs!=null&&as_!=null;
  return(
    <div onClick={onClick} style={{background:selected?C.peachLight:C.white,borderRadius:12,padding:"12px 14px",cursor:"pointer",transition:"all .15s",border:`1.5px solid ${selected?C.blue:st.live?C.live+"55":C.bluePale}`,borderLeft:`4px solid ${st.live?C.live:st.done?C.bluePale:C.peachMid}`,boxShadow:st.live?"0 2px 12px rgba(229,62,62,.14)":"none",marginBottom:0}}>
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        {/* Status col */}
        <div style={{minWidth:42,textAlign:"center",flexShrink:0}}>
          {st.live
            ?<><div style={{background:C.live,color:"#fff",borderRadius:5,padding:"2px 6px",fontSize:9,fontWeight:800,display:"inline-block",animation:"lb 1.5s ease-in-out infinite"}}>LIVE</div>
              {m.minute&&<div style={{fontSize:10,color:C.live,fontWeight:700,marginTop:1}}>{m.minute}</div>}</>
            :<><div style={{fontSize:11,fontWeight:700,color:st.done?C.gray:C.blue}}>{st.label}</div>
              {m.time&&!st.done&&<div style={{fontSize:10,color:C.gray,marginTop:1}}>{m.time}</div>}</>}
        </div>
        {/* Teams */}
        <div style={{flex:1,minWidth:0}}>
          {/* Home */}
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:5}}>
            <div style={{display:"flex",alignItems:"center",gap:7,flex:1,minWidth:0}}>
              {m.home_logo&&<img src={m.home_logo} alt="" style={{width:18,height:18,objectFit:"contain",flexShrink:0}} onError={e=>e.target.style.display="none"}/>}
              <span style={{fontWeight:700,fontSize:13,color:C.dark,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.home_name}</span>
            </div>
            <span style={{fontWeight:900,fontSize:18,color:hasScore?C.blue:C.gray,minWidth:24,textAlign:"right",flexShrink:0}}>{hasScore?hs:""}</span>
          </div>
          {/* Away */}
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <div style={{display:"flex",alignItems:"center",gap:7,flex:1,minWidth:0}}>
              {m.away_logo&&<img src={m.away_logo} alt="" style={{width:18,height:18,objectFit:"contain",flexShrink:0}} onError={e=>e.target.style.display="none"}/>}
              <span style={{fontWeight:700,fontSize:13,color:C.dark,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.away_name}</span>
            </div>
            <span style={{fontWeight:900,fontSize:18,color:hasScore?C.blue:C.gray,minWidth:24,textAlign:"right",flexShrink:0}}>{hasScore?as_:""}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── LIVE SCORES ───────────────────────────────────────────────────
function LiveScores(){
  const [date,setDate]=useState(dateStr(0));
  const [matches,setMatches]=useState([]);
  const [loading,setLoading]=useState(false);
  const [err,setErr]=useState("");
  const [filter,setFilter]=useState("ALL");
  const [selected,setSelected]=useState(null);
  const [detail,setDetail]=useState("");
  const [detailLoading,setDetailLoading]=useState(false);
  const timerRef=useRef(null);

  const load=useCallback(async(quiet=false)=>{
    if(!quiet){setLoading(true);setErr("");}
    try{
      const res=await API.getScores(date);
      const fixtures=res?.fixtures||[];
      setMatches(fixtures);
      if(!fixtures.length&&!quiet)setErr("No fixtures found for "+fmtDate(date));
      else if(fixtures.length)setErr("");
    }catch(e){if(!quiet)setErr("Could not load scores.");}
    if(!quiet)setLoading(false);
  },[date]);

  useEffect(()=>{load();},[load]);
  useEffect(()=>{
    clearInterval(timerRef.current);
    if(date===dateStr(0))timerRef.current=setInterval(()=>load(true),60000);
    return()=>clearInterval(timerRef.current);
  },[date,load]);

  async function openMatch(m){
    if(selected===m.id){setSelected(null);setDetail("");return;}
    setSelected(m.id);setDetail("");setDetailLoading(true);
    try{
      const r=await API.askAI(`Football: ${m.home_name} vs ${m.away_name} (${m.league_name||""}${m.country?", "+m.country:""}). Score ${m.home_score!=null?m.home_score+"-"+m.away_score:"not started"}. Last 3 results each team, top betting pick. MAX 8 lines.`);
      setDetail(r.result);
    }catch{setDetail("AI unavailable.");}
    setDetailLoading(false);
  }

  const liveCount=matches.filter(m=>getStatus(m.status||"").live).length;
  let shown=matches;
  if(filter==="LIVE")shown=matches.filter(m=>getStatus(m.status||"").live);
  else if(filter==="FT")shown=matches.filter(m=>getStatus(m.status||"").done);
  else if(filter==="NS")shown=matches.filter(m=>{const s=getStatus(m.status||"");return!s.live&&!s.done;});

  const grouped={};
  shown.forEach(m=>{
    const k=(m.country?m.country+": ":"")+m.league_name||"Other";
    if(!grouped[k])grouped[k]=[];grouped[k].push(m);
  });

  return(
    <div>
      <DateStrip selected={date} onChange={d=>{setDate(d);setSelected(null);setDetail("");}}/>
      <div style={{display:"flex",gap:8,marginBottom:14,alignItems:"center",flexWrap:"wrap"}}>
        <div style={{fontSize:13,fontWeight:800,color:C.blue}}>
          {matches.length} fixtures
          {liveCount>0&&<span style={{color:C.live,marginLeft:8,animation:"lb 1.5s ease-in-out infinite",display:"inline-block"}}>● {liveCount} live</span>}
        </div>
        <div style={{marginLeft:"auto",display:"flex",gap:6,flexWrap:"wrap"}}>
          {["ALL","LIVE","FT","NS"].map(f=><button key={f} onClick={()=>setFilter(f)} style={{background:filter===f?C.blue:C.peachLight,color:filter===f?"#fff":C.dark,border:`1.5px solid ${filter===f?C.blue:C.bluePale}`,borderRadius:20,padding:"5px 12px",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>{f==="LIVE"?<span style={{color:filter==="LIVE"?"#fff":C.live}}>● LIVE</span>:f}</button>)}
          <button onClick={()=>load(false)} style={{background:C.accent,color:"#fff",border:"none",borderRadius:20,padding:"5px 12px",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>↻</button>
        </div>
      </div>
      {loading&&<Spin/>}
      {err&&!loading&&<div style={{background:"#FFF8F0",borderRadius:12,padding:"12px 16px",color:C.accent,fontWeight:600,fontSize:13,marginBottom:12}}>ℹ️ {err}</div>}
      {!loading&&!err&&!matches.length&&<Card s={{textAlign:"center",padding:40}}>
        <div style={{fontSize:40,marginBottom:10}}>⚽</div>
        <div style={{fontWeight:700,color:C.blue}}>No fixtures for {fmtDate(date)}</div>
        <div style={{color:C.gray,fontSize:13,marginTop:6}}>Try Tue/Wed for UCL, or weekends for leagues</div>
      </Card>}
      {Object.entries(grouped).map(([league,ms])=>(
        <div key={league} style={{marginBottom:16}}>
          <div style={{padding:"7px 12px",background:`linear-gradient(90deg,${C.dark},${C.blue})`,borderRadius:10,marginBottom:6,display:"flex",alignItems:"center",gap:8}}>
            {ms[0]?.league_logo&&<img src={ms[0].league_logo} alt="" style={{width:16,height:16,objectFit:"contain"}} onError={e=>e.target.style.display="none"}/>}
            <span style={{fontSize:11,fontWeight:800,color:C.peachMid,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{league.toUpperCase()}</span>
            <span style={{fontSize:10,color:C.bluePale,flexShrink:0}}>{ms.length}</span>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {ms.map((m,i)=>(
              <div key={m.id||i}>
                <MatchRow m={m} onClick={()=>openMatch(m)} selected={selected===m.id}/>
                {selected===m.id&&<div style={{background:C.peachLight,borderRadius:"0 0 12px 12px",padding:"12px 14px",border:`1.5px solid ${C.blue}`,borderTop:"none",marginTop:-2}}>
                  {detailLoading?<div style={{fontSize:12,color:C.gray}}>⏳ AI loading...</div>
                    :<div style={{fontSize:13,lineHeight:1.75,color:C.dark,whiteSpace:"pre-wrap"}}>{detail}</div>}
                </div>}
              </div>
            ))}
          </div>
        </div>
      ))}
      <style>{`@keyframes lb{0%,100%{opacity:1}50%{opacity:.4}}`}</style>
    </div>
  );
}

// ── ANALYSIS ──────────────────────────────────────────────────────
const MARKETS=[
  {id:"corners",label:"Corners",icon:"🔵"},{id:"fh_over",label:"1st Half Over",icon:"1️⃣"},
  {id:"sh_over",label:"2nd Half Over",icon:"2️⃣"},{id:"overs",label:"Goals Over/Under",icon:"📈"},
  {id:"bookings",label:"Bookings",icon:"🟨"},{id:"btts",label:"BTTS",icon:"⚽"},
  {id:"double_chance",label:"Double Chance",icon:"🎯"},{id:"1up_2up",label:"1-Up/2-Up",icon:"📊"},
  {id:"multigoal",label:"Multigoal",icon:"🎰"},{id:"team_to_nil",label:"Win to Nil",icon:"🛡️"},
  {id:"either_half",label:"Either Half Win",icon:"⚖️"},{id:"shots",label:"Shots on Target",icon:"🎯"},
  {id:"bet_builder",label:"Bet Builder",icon:"🏗️"},{id:"draw_minutes",label:"Draw Window",icon:"⏱️"},
  {id:"anytime",label:"Anytime Scorer",icon:"⚡"},{id:"clean_sheet",label:"Clean Sheet",icon:"🔒"},
  {id:"goals_row",label:"Goals in a Row",icon:"🔗"},{id:"assists",label:"Team Assists",icon:"🤝"},
  {id:"saves",label:"Team Saves",icon:"🧤"},{id:"both_halves",label:"Win Both Halves",icon:"🏆"},
];

function AnalysisTab({user,onAuthRequired}){
  const [date,setDate]=useState(dateStr(0));
  const [matches,setMatches]=useState([]);
  const [loading,setLoading]=useState(false);
  const [markets,setMarkets]=useState(["corners","overs","btts","double_chance","bookings"]);
  const [ticket,setTicket]=useState(null);
  const [ticketLoading,setTicketLoading]=useState(false);
  const [expanded,setExpanded]=useState(null);
  const [matchAI,setMatchAI]=useState({});
  const [matchLoading,setMatchLoading]=useState({});
  const [err,setErr]=useState("");
  const [savedMsg,setSavedMsg]=useState("");

  const loadFixtures=useCallback(async()=>{
    setLoading(true);setErr("");setMatches([]);setTicket(null);
    try{
      const res=await API.getScores(date);
      const f=res?.fixtures||[];
      setMatches(f);
      if(!f.length)setErr("No fixtures for "+fmtDate(date)+". Try a busier date like Tue/Wed or weekend.");
    }catch(e){setErr("Failed: "+e.message);}

    setLoading(false);
  },[date]);

  useEffect(()=>{loadFixtures();},[loadFixtures]);
  function toggleMarket(id){setMarkets(p=>p.includes(id)?p.filter(x=>x!==id):[...p,id]);}

  async function analyseMatch(m){
    if(expanded===m.id){setExpanded(null);return;}
    setExpanded(m.id);if(matchAI[m.id])return;
    setMatchLoading(p=>({...p,[m.id]:true}));
    const mktLabels=markets.map(id=>MARKETS.find(x=>x.id===id)?.label).filter(Boolean).join(", ");
    try{
      const r=await API.askAI(`Analyse ${m.home_name} vs ${m.away_name} (${m.league_name||""}, ${date}). Markets: ${mktLabels}. For each market give: [Market]: [Pick] — [1-line reason]. End with ⭐ confidence 1-5.`);
      setMatchAI(p=>({...p,[m.id]:r.result}));
    }catch(e){setMatchAI(p=>({...p,[m.id]:"AI unavailable: "+e.message}));}
    setMatchLoading(p=>({...p,[m.id]:false}));
  }

  async function buildTicket(){
    if(!user){onAuthRequired();return;}
    if(!matches.length){setErr("No fixtures loaded");return;}
    setTicketLoading(true);setTicket(null);
    const top=matches.slice(0,12);
    const matchList=top.map(m=>`• ${m.home_name} vs ${m.away_name} (${m.league_name||m.country||""})`).join("\n");
    const mktLabels=markets.map(id=>MARKETS.find(x=>x.id===id)?.label).filter(Boolean).join(", ");
    try{
      const r=await API.askAI(`Build a SMART BETTING TICKET for ${date}:\n${matchList}\n\nMarkets to cover: ${mktLabels}.\n\nFor each match use this format:\n━━━━━━━━━━\n⚽ [Home] vs [Away] ([League])\n${markets.map(id=>{const mk=MARKETS.find(x=>x.id===id);return mk?`${mk.icon} ${mk.label}: [your pick] — [brief reason]`:""}).filter(Boolean).join("\n")}\n⭐ Match confidence: X/5\n━━━━━━━━━━\n\nAt the end:\n🎟️ BEST 5-FOLD TICKET: list 5 picks\n🔥 BANKER OF THE DAY: [single best pick]\n💎 VALUE BET: [best odds value]\n🎰 3-FOLD ACCA: [3 safest picks combined]`,markets,date);
      setTicket(r.result);
    }catch(e){setErr("AI error: "+e.message);}
    setTicketLoading(false);
  }

  async function saveTicket(){
    if(!user){onAuthRequired();return;}
    try{await API.saveTicket({date,markets,content:ticket});setSavedMsg("✅ Ticket saved!");setTimeout(()=>setSavedMsg(""),3000);}
    catch(e){setSavedMsg("❌ "+e.message);}
  }

  const grouped={};
  matches.forEach(m=>{
    const k=(m.country?m.country+": ":"")+m.league_name||"Other";
    if(!grouped[k])grouped[k]=[];grouped[k].push(m);
  });

  return(
    <div>
      <DateStrip selected={date} onChange={d=>{setDate(d);setTicket(null);setExpanded(null);}}/>
      <div style={{background:`linear-gradient(135deg,${C.peachLight},${C.bluePale}55)`,borderRadius:16,padding:16,marginBottom:18,border:`1.5px solid ${C.bluePale}`}}>
        <div style={{fontWeight:800,color:C.blue,marginBottom:10,fontSize:14}}>🎯 Select Markets for Your Ticket</div>
        <div style={{display:"flex",flexWrap:"wrap",gap:7}}>
          {MARKETS.map(m=>{const on=markets.includes(m.id);return(
            <button key={m.id} onClick={()=>toggleMarket(m.id)} style={{background:on?C.blue:C.white,color:on?"#fff":C.dark,border:`1.5px solid ${on?C.blue:C.bluePale}`,borderRadius:20,padding:"6px 13px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:4}}>
              <span>{m.icon}</span><span>{m.label}</span>{on&&<span style={{fontSize:10,opacity:.7}}>✓</span>}
            </button>);})}
        </div>
        <div style={{marginTop:12,display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
          <span style={{fontSize:12,color:C.gray}}><b style={{color:C.blue}}>{markets.length}</b> markets · <b style={{color:C.blue}}>{matches.length}</b> fixtures on {fmtDate(date)}</span>
          <Btn onClick={buildTicket} disabled={ticketLoading||!matches.length||!markets.length} v="accent" s={{marginLeft:"auto",fontSize:12}}>{ticketLoading?"⏳ Building...":"🎟️ Build Day Ticket"}</Btn>
        </div>
      </div>
      {loading&&<Spin/>}
      {err&&!loading&&<div style={{background:"#FFF8F0",borderRadius:12,padding:"12px 16px",color:C.accent,fontWeight:600,fontSize:13,marginBottom:12}}>ℹ️ {err}</div>}
      {Object.entries(grouped).map(([league,ms])=>(
        <div key={league} style={{marginBottom:16}}>
          <div style={{padding:"7px 12px",background:`linear-gradient(90deg,${C.dark},${C.blue})`,borderRadius:10,marginBottom:6,display:"flex",alignItems:"center",gap:8}}>
            {ms[0]?.league_logo&&<img src={ms[0].league_logo} alt="" style={{width:16,height:16,objectFit:"contain"}} onError={e=>e.target.style.display="none"}/>}
            <span style={{fontSize:11,fontWeight:800,color:C.peachMid,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{league.toUpperCase()}</span>
            <span style={{fontSize:10,color:C.bluePale,flexShrink:0}}>{ms.length}</span>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {ms.map((m,i)=>(
              <div key={m.id||i}>
                <div style={{display:"flex",gap:6}}>
                  <div style={{flex:1}}><MatchRow m={m} onClick={()=>analyseMatch(m)} selected={expanded===m.id}/></div>
                  <button onClick={()=>analyseMatch(m)} style={{background:expanded===m.id?C.blue:C.peachLight,color:expanded===m.id?"#fff":C.blue,border:`1.5px solid ${expanded===m.id?C.blue:C.bluePale}`,borderRadius:10,padding:"0 12px",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"inherit",flexShrink:0}}>{expanded===m.id?"▲":"Analyse"}</button>
                </div>
                {expanded===m.id&&<div style={{background:C.peachLight,borderRadius:"0 0 12px 12px",padding:"14px 16px",border:`1.5px solid ${C.blue}`,borderTop:"none",marginTop:-2}}>
                  {matchLoading[m.id]?<div style={{fontSize:12,color:C.gray}}>⏳ Analysing...</div>
                    :<div style={{fontSize:13,lineHeight:1.8,color:C.dark,whiteSpace:"pre-wrap"}}>{matchAI[m.id]}</div>}
                </div>}
              </div>
            ))}
          </div>
        </div>
      ))}
      {ticketLoading&&<div style={{background:`linear-gradient(135deg,${C.peachLight},${C.bluePale}66)`,borderRadius:16,padding:36,textAlign:"center",marginTop:16}}><div style={{fontSize:28,marginBottom:8}}>🎟️</div><div style={{fontWeight:800,color:C.blue,fontSize:15}}>Building your smart ticket...</div><Spin/></div>}
      {ticket&&<div style={{borderLeft:`5px solid ${C.gold}`,borderRadius:16,padding:20,marginTop:16,background:`linear-gradient(135deg,${C.white},${C.peachLight}88)`,border:`1.5px solid ${C.bluePale}`}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14,flexWrap:"wrap"}}>
          <span style={{fontSize:22}}>🎟️</span>
          <div><div style={{fontWeight:900,color:C.blue,fontSize:15}}>Smart Ticket — {fmtDate(date)}</div><div style={{fontSize:11,color:C.gray,marginTop:2}}>{matches.length} fixtures · {markets.length} markets</div></div>
          {user&&<button onClick={saveTicket} style={{marginLeft:"auto",background:C.gold,color:"#fff",border:"none",borderRadius:10,padding:"7px 14px",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>💾 Save</button>}
        </div>
        {savedMsg&&<div style={{color:savedMsg.startsWith("✅")?C.green:C.red,fontSize:13,marginBottom:10,fontWeight:700}}>{savedMsg}</div>}
        <div style={{whiteSpace:"pre-wrap",lineHeight:1.85,color:C.dark,fontSize:13}}>{ticket}</div>
      </div>}
    </div>
  );
}

// ── LIVE TV ───────────────────────────────────────────────────────
function LiveTV({user,onAuthRequired}){
  const [liveMatches,setLiveMatches]=useState([]);
  const [loading,setLoading]=useState(false);
  const [active,setActive]=useState(null);
  const [streamIdx,setStreamIdx]=useState(0);
  const [chat,setChat]=useState([{u:"Dior",t:"🔥 Let's go!",ts:"21:03"},{u:"Kola",t:"GOOOAL!! 😱",ts:"21:05"},{u:"Tunde",t:"Ref blind 😤",ts:"21:08"}]);
  const [msg,setMsg]=useState("");
  const chatRef=useRef(null);

  useEffect(()=>{
    if(!user)return;
    setLoading(true);
    API.getLiveScores().then(res=>{
      setLiveMatches(res?.fixtures||[]);
    }).catch(()=>{}).finally(()=>setLoading(false));
  },[user]);

  // Stream sources for each match using sportsrc.org
  function getStreams(m){
    const id=m.id||"1";
    return[
      {label:"Server 1 HD",url:`https://sportsrc.org/embed/${id}/1`},
      {label:"Server 2",url:`https://sportsrc.org/embed/${id}/2`},
      {label:"Server 3 SD",url:`https://sportsrc.org/embed/${id}/3`},
    ];
  }

  function openMatch(m){if(!user){onAuthRequired();return;}setActive(m);setStreamIdx(0);}
  function sendMsg(e){
    e.preventDefault();if(!msg.trim())return;
    const ts=new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
    setChat(p=>[...p,{u:user?.name?.split(" ")[0]||"You",t:msg,ts}]);
    setMsg("");setTimeout(()=>{if(chatRef.current)chatRef.current.scrollTop=9999;},80);
  }

  if(active){
    const streams=getStreams(active);
    return(
      <div>
        <button onClick={()=>setActive(null)} style={{background:"none",border:"none",color:C.blue,fontWeight:700,cursor:"pointer",marginBottom:14,fontFamily:"inherit",fontSize:14}}>← Back to matches</button>
        <div style={{fontWeight:800,color:C.blue,marginBottom:10,fontSize:14}}>
          ⚽ {active.home_name} vs {active.away_name}
          {active.home_score!=null&&<span style={{color:C.live,marginLeft:8}}>{active.home_score} - {active.away_score}</span>}
        </div>
        <div style={{background:C.dark,borderRadius:18,overflow:"hidden",aspectRatio:"16/9",position:"relative",marginBottom:14}}>
          <iframe src={streams[streamIdx].url} style={{position:"absolute",inset:0,width:"100%",height:"100%",border:"none"}} allowFullScreen allow="autoplay;encrypted-media" title="stream"/>
          <div style={{position:"absolute",top:12,left:12,background:C.live,color:"#fff",borderRadius:6,padding:"3px 10px",fontSize:11,fontWeight:800,animation:"lb 1.5s ease-in-out infinite",pointerEvents:"none"}}>● LIVE</div>
        </div>
        <Card s={{marginBottom:14}}>
          <div style={{fontWeight:800,color:C.blue,marginBottom:8,fontSize:13}}>📡 Switch Server — if stream fails try another</div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            {streams.map((sv,i)=><button key={i} onClick={()=>setStreamIdx(i)} style={{background:streamIdx===i?C.blue:C.peachLight,color:streamIdx===i?"#fff":C.dark,border:`1.5px solid ${streamIdx===i?C.blue:C.bluePale}`,borderRadius:10,padding:"8px 16px",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>{sv.label}</button>)}
          </div>
        </Card>
        <Card s={{padding:0,overflow:"hidden"}}>
          <div style={{background:`linear-gradient(90deg,${C.dark},${C.blue})`,padding:"12px 16px"}}><div style={{color:"#fff",fontWeight:800,fontSize:13}}>💬 Live Chat</div></div>
          <div ref={chatRef} style={{height:200,overflowY:"auto",padding:"10px 14px",display:"flex",flexDirection:"column",gap:7}}>
            {chat.map((c,i)=><div key={i}><span style={{fontWeight:700,fontSize:12,color:C.blue}}>{c.u} </span><span style={{fontSize:10,color:C.gray}}>{c.ts}</span><div style={{fontSize:13,color:C.dark,marginTop:1}}>{c.t}</div></div>)}
          </div>
          <form onSubmit={sendMsg} style={{borderTop:`1.5px solid ${C.bluePale}`,padding:"8px 12px",display:"flex",gap:8}}>
            <input value={msg} onChange={e=>setMsg(e.target.value)} placeholder="Say something..." style={{...IS,height:36,padding:"7px 12px",fontSize:13}}/>
            <Btn s={{padding:"7px 14px"}}>→</Btn>
          </form>
        </Card>
      </div>
    );
  }

  return(
    <div>
      <div style={{background:`linear-gradient(135deg,${C.dark},${C.blue})`,borderRadius:16,padding:20,marginBottom:18,display:"flex",alignItems:"center",gap:14}}>
        <div style={{fontSize:34}}>📺</div>
        <div>
          <div style={{fontWeight:900,color:"#fff",fontSize:17,fontFamily:"Georgia,serif"}}>DSP Live TV</div>
          <div style={{color:C.bluePale,fontSize:12,marginTop:2}}>Tap any live match to watch · Multiple servers</div>
        </div>
        {liveMatches.length>0&&<div style={{marginLeft:"auto",background:C.live,color:"#fff",borderRadius:8,padding:"5px 12px",fontSize:11,fontWeight:800,animation:"lb 1.5s ease-in-out infinite"}}>{liveMatches.length} LIVE</div>}
      </div>

      {!user&&<div style={{background:"#FFF8F0",borderRadius:12,padding:24,textAlign:"center",marginBottom:16,border:`1.5px solid ${C.peachMid}`}}>
        <div style={{fontSize:26,marginBottom:6}}>🔒</div>
        <div style={{fontWeight:800,color:C.blue,marginBottom:4}}>Sign in to watch live streams</div>
        <div style={{color:C.gray,fontSize:13,marginBottom:12}}>Free account required</div>
        <Btn v="accent" onClick={onAuthRequired}>Sign In / Register</Btn>
      </div>}

      {user&&loading&&<Spin/>}

      {user&&!loading&&liveMatches.length===0&&<Card s={{textAlign:"center",padding:40}}>
        <div style={{fontSize:40,marginBottom:10}}>📺</div>
        <div style={{fontWeight:700,color:C.blue,marginBottom:6}}>No live matches right now</div>
        <div style={{color:C.gray,fontSize:13}}>Live matches appear here during match times. Check back on Tue/Wed evenings for UCL, or weekends for leagues.</div>
      </Card>}

      {user&&liveMatches.length>0&&<div style={{display:"flex",flexDirection:"column",gap:8}}>
        {liveMatches.map((m,i)=>(
          <div key={m.id||i} onClick={()=>openMatch(m)} style={{background:C.white,borderRadius:14,overflow:"hidden",boxShadow:"0 3px 16px rgba(26,58,107,.1)",cursor:"pointer",border:`2px solid ${C.live}44`,transition:"transform .15s"}}
            onMouseEnter={e=>e.currentTarget.style.transform="translateY(-1px)"}
            onMouseLeave={e=>e.currentTarget.style.transform="none"}>
            <div style={{background:`linear-gradient(90deg,${C.dark},${C.blue})`,padding:"8px 14px",display:"flex",alignItems:"center",gap:8}}>
              <div style={{background:C.live,color:"#fff",borderRadius:6,padding:"2px 8px",fontSize:10,fontWeight:800,animation:"lb 1.5s ease-in-out infinite"}}>● LIVE</div>
              {m.minute&&<span style={{fontSize:11,color:C.live,fontWeight:700}}>{m.minute}</span>}
              {m.league_logo&&<img src={m.league_logo} alt="" style={{width:14,height:14,objectFit:"contain"}} onError={e=>e.target.style.display="none"}/>}
              <span style={{fontSize:11,color:C.bluePale,fontWeight:600,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.league_name}</span>
              <span style={{fontSize:11,color:C.peachMid,fontWeight:700,flexShrink:0}}>▶ Watch</span>
            </div>
            <div style={{padding:"12px 14px"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:5}}>
                <div style={{display:"flex",alignItems:"center",gap:7}}>
                  {m.home_logo&&<img src={m.home_logo} alt="" style={{width:20,height:20,objectFit:"contain"}} onError={e=>e.target.style.display="none"}/>}
                  <span style={{fontWeight:700,fontSize:14,color:C.dark}}>{m.home_name}</span>
                </div>
                <span style={{fontWeight:900,fontSize:20,color:C.blue}}>{m.home_score!=null?m.home_score:""}</span>
              </div>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <div style={{display:"flex",alignItems:"center",gap:7}}>
                  {m.away_logo&&<img src={m.away_logo} alt="" style={{width:20,height:20,objectFit:"contain"}} onError={e=>e.target.style.display="none"}/>}
                  <span style={{fontWeight:700,fontSize:14,color:C.dark}}>{m.away_name}</span>
                </div>
                <span style={{fontWeight:900,fontSize:20,color:C.blue}}>{m.away_score!=null?m.away_score:""}</span>
              </div>
            </div>
          </div>
        ))}
      </div>}
    </div>
  );
}

// ── ROOT ──────────────────────────────────────────────────────────
const CATS=[{id:"scores",icon:"📡",label:"Live Scores"},{id:"analysis",icon:"🎟️",label:"Analysis"},{id:"tv",icon:"📺",label:"Live TV"}];

export default function App(){
  const [cat,setCat]=useState("scores");
  const [user,setUser]=useState(null);
  const [showAuth,setShowAuth]=useState(false);
  useEffect(()=>{
    const unsub=onAuthStateChanged(auth,async fireUser=>{
      if(fireUser){
        let p={uid:fireUser.uid,email:fireUser.email,name:fireUser.displayName||fireUser.email?.split("@")[0]||"Fan"};
        try{const pr=await API.getProfile();p={...p,...pr};}catch{}
        setUser(p);
      }else setUser(null);
    });
    return unsub;
  },[]);
  async function logout(){await signOut(auth);setUser(null);}
  return(
    <div style={{minHeight:"100vh",background:`linear-gradient(150deg,${C.peachLight},${C.peach} 55%,${C.peachWarm})`,fontFamily:"'Trebuchet MS','Gill Sans',sans-serif",paddingBottom:70}}>
      <div style={{background:`linear-gradient(90deg,${C.dark},${C.blue})`,position:"sticky",top:0,zIndex:200,boxShadow:"0 4px 20px rgba(13,31,60,.3)"}}>
        <div style={{maxWidth:980,margin:"0 auto",padding:"0 16px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
          <div style={{padding:"12px 0",fontFamily:"Georgia,serif",fontSize:18,fontWeight:900,color:C.peachMid,letterSpacing:.5}}>⚽ Dior Sports Padi</div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            {user?<><span style={{color:C.bluePale,fontSize:12,fontWeight:600,maxWidth:120,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>👤 {user.name}</span>
              <button onClick={logout} style={{background:"rgba(255,255,255,.12)",color:"#fff",border:"none",borderRadius:8,padding:"6px 12px",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Sign Out</button></>
              :<button onClick={()=>setShowAuth(true)} style={{background:C.peachDeep,color:"#fff",border:"none",borderRadius:8,padding:"7px 14px",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Sign In</button>}
          </div>
        </div>
        <div style={{maxWidth:980,margin:"0 auto",padding:"0 16px",display:"flex",borderTop:`1px solid rgba(255,255,255,.1)`}}>
          {CATS.map(c=><button key={c.id} onClick={()=>setCat(c.id)} style={{flex:1,background:"none",border:"none",borderBottom:cat===c.id?`3px solid ${C.peachDeep}`:"3px solid transparent",color:cat===c.id?C.peachMid:C.bluePale,padding:"13px 0",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
            <span style={{fontSize:16}}>{c.icon}</span><span>{c.label}</span>
          </button>)}
        </div>
      </div>
      <div style={{maxWidth:980,margin:"0 auto",padding:"18px 14px 20px"}}>
        <div style={{marginBottom:16}}>
          <div style={{fontSize:10,color:C.blueLight,fontWeight:700,letterSpacing:2,marginBottom:2}}>DIOR SPORTS PADI</div>
          <h2 style={{margin:0,fontSize:20,fontWeight:900,color:C.blue,fontFamily:"Georgia,serif"}}>{CATS.find(c=>c.id===cat)?.icon} {CATS.find(c=>c.id===cat)?.label}</h2>
          <div style={{height:3,width:38,background:C.peachDeep,borderRadius:2,marginTop:6}}/>
        </div>
        {cat==="scores"&&<LiveScores/>}
        {cat==="analysis"&&<AnalysisTab user={user} onAuthRequired={()=>setShowAuth(true)}/>}
        {cat==="tv"&&<LiveTV user={user} onAuthRequired={()=>setShowAuth(true)}/>}
      </div>
      <div style={{position:"fixed",bottom:0,left:0,right:0,zIndex:100,background:`linear-gradient(90deg,${C.dark},${C.blue})`,borderTop:`2px solid ${C.peachDeep}`,display:"flex"}}>
        {CATS.map(c=><button key={c.id} onClick={()=>setCat(c.id)} style={{flex:1,background:"none",border:"none",padding:"11px 0",color:cat===c.id?C.peachMid:C.bluePale,cursor:"pointer",fontFamily:"inherit",display:"flex",flexDirection:"column",alignItems:"center",gap:2,borderTop:cat===c.id?`2px solid ${C.peachDeep}`:"2px solid transparent",marginTop:-2}}>
          <span style={{fontSize:18}}>{c.icon}</span><span style={{fontSize:10,fontWeight:700}}>{c.label}</span>
        </button>)}
      </div>
      {showAuth&&<AuthModal onClose={()=>setShowAuth(false)} onLogin={u=>{setUser(u);setShowAuth(false);}}/>}
      <style>{`@keyframes lb{0%,100%{opacity:1}50%{opacity:.4}}@keyframes sp{to{transform:rotate(360deg)}}*{box-sizing:border-box}`}</style>
    </div>
  );
}

