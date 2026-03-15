// src/App.jsx
import { useState, useEffect, useCallback, useRef } from "react";
import { auth, setupRecaptcha, sendOTP, verifyOTP, signOut, onAuthStateChanged } from "./firebase";
import * as API from "./api";

// ── PALETTE ───────────────────────────────────────────────────────
const C = {
  peach:"#FDDBB4",peachLight:"#FEF4E8",peachMid:"#F9C48A",
  peachDeep:"#F0A050",peachWarm:"#FBCF9A",
  blue:"#1A3A6B",blueMid:"#2E5BA8",blueLight:"#4A7ED0",bluePale:"#D0E2F5",
  white:"#FFFDF8",dark:"#0D1F3C",accent:"#E8724A",
  gold:"#D4A847",green:"#1E7A47",greenLight:"#E8F7EF",
  red:"#C0392B",gray:"#8899AA",live:"#E53E3E",
};

// ── ATOMS ─────────────────────────────────────────────────────────
const IS={width:"100%",padding:"12px 14px",borderRadius:10,fontSize:14,
  border:`1.5px solid ${C.bluePale}`,background:C.peachLight,color:C.dark,
  outline:"none",fontFamily:"inherit",boxSizing:"border-box"};
const LS={fontSize:11,fontWeight:700,color:C.gray,display:"block",marginBottom:5,letterSpacing:1};

function Card({ch,s={},onClick}){
  return<div onClick={onClick} style={{background:C.white,borderRadius:16,padding:18,
    boxShadow:"0 2px 16px rgba(26,58,107,.09)",border:`1.5px solid ${C.bluePale}`,
    cursor:onClick?"pointer":"default",...s}}>{ch}</div>;
}
function Btn({ch,onClick,v="primary",s={},disabled}){
  const vs={primary:{background:C.blue,color:"#fff"},accent:{background:C.accent,color:"#fff"},
    peach:{background:C.peachDeep,color:"#fff"},ghost:{background:C.peachLight,color:C.blue,border:`1.5px solid ${C.bluePale}`},
    green:{background:C.green,color:"#fff"},gold:{background:C.gold,color:"#fff"},dark:{background:C.dark,color:"#fff"}};
  return<button onClick={onClick} disabled={disabled} style={{border:"none",borderRadius:10,
    padding:"10px 18px",fontWeight:700,fontSize:13,cursor:disabled?"not-allowed":"pointer",
    transition:"all .15s",opacity:disabled?.55:1,fontFamily:"inherit",...vs[v],...s}}>{ch}</button>;
}
function Pill({text,color=C.blue,s={}}){
  return<span style={{background:color+"18",color,borderRadius:20,padding:"3px 10px",
    fontSize:11,fontWeight:700,border:`1px solid ${color}33`,...s}}>{text}</span>;
}
function Spin(){return<div style={{display:"flex",justifyContent:"center",padding:32}}>
  <div style={{width:30,height:30,borderRadius:"50%",border:`3px solid ${C.bluePale}`,
    borderTopColor:C.blue,animation:"sp .7s linear infinite"}}/>
  <style>{`@keyframes sp{to{transform:rotate(360deg)}}`}</style></div>;}

function dateStr(off=0){const d=new Date();d.setDate(d.getDate()+off);return d.toISOString().split("T")[0];}
function fmtTime(utc){if(!utc)return"";return new Date(utc).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});}
function fmtDate(s){return new Date(s+"T12:00:00").toLocaleDateString("en-GB",{weekday:"short",day:"numeric",month:"short"});}

// ── AUTH MODAL (real Firebase Phone OTP) ──────────────────────────
function AuthModal({onClose,onLogin}){
  const [step,setStep]=useState("phone"); // phone | otp | name
  const [phone,setPhone]=useState("+234");
  const [otp,setOtp]=useState("");
  const [name,setName]=useState("");
  const [err,setErr]=useState("");
  const [loading,setLoading]=useState(false);
  const recapRef=useRef(null);

  useEffect(()=>{
    // set up invisible recaptcha
    try{ setupRecaptcha("recaptcha-container"); }catch(e){}
  },[]);

  async function handleSendOTP(e){
    e.preventDefault();setErr("");
    if(!phone.match(/^\+[1-9]\d{7,14}$/)){
      setErr("Enter phone with country code e.g. +2348012345678");return;
    }
    setLoading(true);
    try{
      await sendOTP(phone);
      setStep("otp");
    }catch(e){
      // reset recaptcha on error
      if(window.recaptchaVerifier){try{window.recaptchaVerifier.clear();}catch{}}
      try{setupRecaptcha("recaptcha-container");}catch{}
      setErr(e.message||"Failed to send OTP. Check your number.");
    }
    setLoading(false);
  }

  async function handleVerifyOTP(e){
    e.preventDefault();setErr("");
    if(otp.length<6){setErr("Enter the 6-digit code");return;}
    setLoading(true);
    try{
      const user=await verifyOTP(otp);
      // check if new user
      const isNew=user.metadata.creationTime===user.metadata.lastSignInTime;
      if(isNew){ setStep("name"); }
      else {
        // existing user — fetch profile
        try{const profile=await API.getProfile();onLogin(profile);}
        catch{onLogin({phone:user.phoneNumber,name:"Dior Fan"});}
      }
    }catch(e){setErr("Wrong code. Try again.");}
    setLoading(false);
  }

  async function handleSaveName(e){
    e.preventDefault();setErr("");
    if(name.trim().length<2){setErr("Enter your name");return;}
    setLoading(true);
    try{
      const profile=await API.saveProfile(name.trim());
      onLogin(profile);
    }catch(e){setErr(e.message);}
    setLoading(false);
  }

  return(
    <div style={{position:"fixed",inset:0,background:"rgba(13,31,60,.9)",zIndex:9999,
      display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div style={{background:C.white,borderRadius:24,padding:32,width:"100%",maxWidth:380,
        boxShadow:"0 24px 64px rgba(0,0,0,.35)",position:"relative"}}>
        <div style={{textAlign:"center",marginBottom:24}}>
          <div style={{fontSize:40,marginBottom:6}}>⚽</div>
          <div style={{fontFamily:"Georgia,serif",fontSize:22,fontWeight:900,color:C.blue}}>Dior Sports Padi</div>
        </div>

        {step==="phone"&&(
          <form onSubmit={handleSendOTP}>
            <div style={{textAlign:"center",marginBottom:18,color:C.gray,fontSize:13}}>
              Enter your phone number to receive a verification code
            </div>
            <label style={LS}>PHONE NUMBER (with country code)</label>
            <input value={phone} onChange={e=>setPhone(e.target.value)}
              placeholder="+2348012345678" style={{...IS,marginBottom:16}}/>
            {err&&<div style={{color:C.red,fontSize:13,marginBottom:12}}>⚠️ {err}</div>}
            <Btn ch={loading?"Sending code...":"Send OTP →"} onClick={handleSendOTP}
              disabled={loading} s={{width:"100%",padding:13,fontSize:15}}/>
            <div id="recaptcha-container" ref={recapRef} style={{marginTop:8}}/>
          </form>
        )}

        {step==="otp"&&(
          <form onSubmit={handleVerifyOTP}>
            <div style={{textAlign:"center",marginBottom:18,color:C.gray,fontSize:13}}>
              Enter the 6-digit code sent to<br/>
              <strong style={{color:C.blue}}>{phone}</strong>
            </div>
            <label style={LS}>VERIFICATION CODE</label>
            <input value={otp} onChange={e=>setOtp(e.target.value.replace(/\D/g,""))}
              placeholder="123456" maxLength={6} style={{...IS,fontSize:22,textAlign:"center",letterSpacing:8,marginBottom:16}}/>
            {err&&<div style={{color:C.red,fontSize:13,marginBottom:12}}>⚠️ {err}</div>}
            <Btn ch={loading?"Verifying...":"Verify & Continue →"} onClick={handleVerifyOTP}
              disabled={loading} s={{width:"100%",padding:13,fontSize:15}}/>
            <div onClick={()=>{setStep("phone");setOtp("");setErr("");}}
              style={{textAlign:"center",marginTop:12,color:C.blue,fontSize:12,cursor:"pointer",fontWeight:700}}>
              ← Change number
            </div>
          </form>
        )}

        {step==="name"&&(
          <form onSubmit={handleSaveName}>
            <div style={{textAlign:"center",marginBottom:18,color:C.gray,fontSize:13}}>
              Welcome! What should we call you?
            </div>
            <label style={LS}>YOUR NAME</label>
            <input value={name} onChange={e=>setName(e.target.value)}
              placeholder="e.g. Dior" style={{...IS,marginBottom:16}}/>
            {err&&<div style={{color:C.red,fontSize:13,marginBottom:12}}>⚠️ {err}</div>}
            <Btn ch={loading?"Saving...":"Let's Go →"} onClick={handleSaveName}
              disabled={loading} s={{width:"100%",padding:13,fontSize:15}}/>
          </form>
        )}

        <button onClick={onClose} style={{position:"absolute",top:14,right:18,background:"none",
          border:"none",fontSize:22,cursor:"pointer",color:C.gray}}>✕</button>
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
      {days.map(d=>(
        <button key={d.s} onClick={()=>onChange(d.s)} style={{
          flex:"0 0 auto",background:d.s===selected?C.blue:C.white,
          color:d.s===selected?"#fff":C.dark,
          border:`1.5px solid ${d.s===selected?C.blue:C.bluePale}`,
          borderRadius:22,padding:"7px 16px",fontSize:12,fontWeight:700,
          cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap",outline:"none",
        }}>{d.l}{d.today&&d.s!==selected?<span style={{color:C.accent,marginLeft:3}}>●</span>:null}</button>
      ))}
    </div>
  );
}

// ── MATCH ROW ─────────────────────────────────────────────────────
function getStatus(s){
  const u=(s||"").toUpperCase();
  if(["1H","2H","ET","P","LIVE","INPROGRESS"].some(x=>u.includes(x)))return{label:"LIVE",color:C.live,live:true,done:false};
  if(u==="HT")return{label:"HT",color:C.gold,live:false,done:false};
  if(["FT","AET","PEN","FINISHED"].some(x=>u.includes(x)))return{label:"FT",color:C.gray,live:false,done:true};
  if(u.includes("POSTP"))return{label:"PST",color:C.red,live:false,done:false};
  return{label:"NS",color:C.gray,live:false,done:false};
}

function MatchRow({m,onClick,selected}){
  const fi=m.fixture,teams=m.teams,goals=m.goals,league=m.league;
  const home=teams?.home?.name||"Home";
  const away=teams?.away?.name||"Away";
  const hs=goals?.home;const as_=goals?.away;
  const st=getStatus(fi?.status?.short||fi?.status?.long);
  const ko=fi?.date?fmtTime(fi.date):"";
  const min=fi?.status?.elapsed;
  return(
    <div onClick={onClick} style={{background:selected?C.peachLight:C.white,
      borderRadius:12,padding:"13px 16px",cursor:"pointer",transition:"all .15s",
      border:`1.5px solid ${selected?C.blue:st.live?C.live+"55":C.bluePale}`,
      borderLeft:`4px solid ${st.live?C.live:st.done?C.bluePale:C.peachMid}`,
      boxShadow:st.live?"0 2px 12px rgba(229,62,62,.14)":"none"}}>
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        <div style={{minWidth:46,textAlign:"center"}}>
          {st.live
            ?<div style={{background:C.live,color:"#fff",borderRadius:6,padding:"2px 7px",
              fontSize:10,fontWeight:800,display:"inline-block",animation:"lb 1.5s ease-in-out infinite"}}>
              {min?min+"'":"LIVE"}</div>
            :<><div style={{fontSize:12,fontWeight:700,color:st.done?C.gray:C.blue}}>{st.label}</div>
              {!st.done&&ko&&<div style={{fontSize:10,color:C.gray,marginTop:1}}>{ko}</div>}</>}
        </div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:3}}>
            <span style={{fontWeight:700,fontSize:13,color:C.dark,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{home}</span>
            <span style={{fontWeight:900,fontSize:18,color:hs!=null?C.blue:C.gray,minWidth:24,textAlign:"right"}}>{hs??""}</span>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{fontWeight:700,fontSize:13,color:C.dark,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{away}</span>
            <span style={{fontWeight:900,fontSize:18,color:as_!=null?C.blue:C.gray,minWidth:24,textAlign:"right"}}>{as_??""}</span>
          </div>
        </div>
        {league?.logo&&<img src={league.logo} alt="" style={{width:22,height:22,objectFit:"contain",opacity:.7,flexShrink:0}}/>}
      </div>
    </div>
  );
}

// ── LIVE SCORES TAB ───────────────────────────────────────────────
function LiveScores(){
  const [date,setDate]=useState(dateStr(0));
  const [data,setData]=useState(null);
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
      const res=await(date===dateStr(0)?API.getLiveScores().catch(()=>API.getScores(date)):API.getScores(date));
      setData(res);
    }catch(e){if(!quiet)setErr(e.message);}
    if(!quiet)setLoading(false);
  },[date]);

  useEffect(()=>{load();},[load]);

  // auto-refresh every 45s on today
  useEffect(()=>{
    clearInterval(timerRef.current);
    if(date===dateStr(0))timerRef.current=setInterval(()=>load(true),45000);
    return()=>clearInterval(timerRef.current);
  },[date,load]);

  async function openMatch(m){
    if(selected===m.fixture?.id){setSelected(null);setDetail("");return;}
    setSelected(m.fixture?.id);setDetail("");setDetailLoading(true);
    try{
      const res=await API.askAI(
        `Quick stats on ${m.teams?.home?.name} vs ${m.teams?.away?.name} (${m.league?.name}).
Last 3 results each, current score if live, best remaining bet if not finished. MAX 7 lines.`
      );
      setDetail(res.result);
    }catch(e){setDetail("Could not load match info.");}
    setDetailLoading(false);
  }

  const fixtures=data?.fixtures||data?.response||[];
  const liveCount=fixtures.filter(f=>getStatus(f.fixture?.status?.short).live).length;

  let shown=fixtures;
  if(filter==="LIVE")shown=fixtures.filter(f=>getStatus(f.fixture?.status?.short).live);
  else if(filter==="FT")shown=fixtures.filter(f=>getStatus(f.fixture?.status?.short).done);
  else if(filter==="NS")shown=fixtures.filter(f=>{const s=getStatus(f.fixture?.status?.short);return!s.live&&!s.done;});

  // group by league
  const grouped={};
  shown.forEach(f=>{
    const k=f.league?.name||"Other";
    if(!grouped[k])grouped[k]=[];
    grouped[k].push(f);
  });

  return(
    <div>
      <DateStrip selected={date} onChange={d=>{setDate(d);setSelected(null);setDetail("");}}/>
      <div style={{display:"flex",gap:8,marginBottom:14,alignItems:"center",flexWrap:"wrap"}}>
        <div style={{fontSize:13,fontWeight:800,color:C.blue}}>
          {fixtures.length} fixtures
          {liveCount>0&&<span style={{color:C.live,marginLeft:8,animation:"lb 1.5s ease-in-out infinite",display:"inline-block"}}>
            ● {liveCount} live</span>}
        </div>
        <div style={{marginLeft:"auto",display:"flex",gap:6,flexWrap:"wrap"}}>
          {["ALL","LIVE","FT","NS"].map(f=>(
            <button key={f} onClick={()=>setFilter(f)} style={{
              background:filter===f?C.blue:C.peachLight,color:filter===f?"#fff":C.dark,
              border:`1.5px solid ${filter===f?C.blue:C.bluePale}`,
              borderRadius:20,padding:"5px 12px",fontSize:11,fontWeight:700,
              cursor:"pointer",fontFamily:"inherit"}}>
              {f==="LIVE"?<span style={{color:filter==="LIVE"?"#fff":C.live}}>● LIVE</span>:f}
            </button>
          ))}
          <button onClick={()=>load(false)} style={{background:C.accent,color:"#fff",border:"none",
            borderRadius:20,padding:"5px 12px",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>↻</button>
        </div>
      </div>

      {loading&&<Spin/>}
      {err&&!loading&&<div style={{background:"#FFF8F0",borderRadius:12,padding:"12px 16px",
        color:C.accent,fontWeight:600,fontSize:13,marginBottom:12}}>⚠️ {err}</div>}

      {Object.entries(grouped).map(([league,ms])=>(
        <div key={league} style={{marginBottom:18}}>
          <div style={{padding:"7px 14px",background:`linear-gradient(90deg,${C.dark},${C.blue})`,
            borderRadius:10,marginBottom:8,display:"flex",alignItems:"center",gap:8}}>
            {ms[0]?.league?.logo&&<img src={ms[0].league.logo} alt="" style={{width:18,height:18,objectFit:"contain"}}/>}
            <span style={{fontSize:12,fontWeight:800,color:C.peachMid,flex:1,overflow:"hidden",
              textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{league.toUpperCase()}</span>
            <span style={{fontSize:10,color:C.bluePale,flexShrink:0}}>{ms.length}</span>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:7}}>
            {ms.map(m=>(
              <div key={m.fixture?.id}>
                <MatchRow m={m} onClick={()=>openMatch(m)} selected={selected===m.fixture?.id}/>
                {selected===m.fixture?.id&&(
                  <div style={{background:C.peachLight,borderRadius:"0 0 12px 12px",padding:"12px 16px",
                    border:`1.5px solid ${C.blue}`,borderTop:"none",marginTop:-4}}>
                    {detailLoading?<div style={{fontSize:12,color:C.gray}}>⏳ Loading...</div>
                      :<div style={{fontSize:13,lineHeight:1.75,color:C.dark,whiteSpace:"pre-wrap"}}>{detail}</div>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── ANALYSIS TAB ──────────────────────────────────────────────────
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
  const [data,setData]=useState(null);
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
    setLoading(true);setErr("");setData(null);setTicket(null);
    try{
      const res=await API.getScores(date);
      setData(res);
      if(!(res.fixtures||res.response||[]).length)setErr("No fixtures for "+fmtDate(date));
    }catch(e){setErr(e.message);}
    setLoading(false);
  },[date]);

  useEffect(()=>{loadFixtures();},[loadFixtures]);

  const fixtures=data?.fixtures||data?.response||[];

  function toggleMarket(id){setMarkets(p=>p.includes(id)?p.filter(x=>x!==id):[...p,id]);}

  async function analyseMatch(m){
    const fid=m.fixture?.id;
    if(expanded===fid){setExpanded(null);return;}
    setExpanded(fid);
    if(matchAI[fid])return;
    setMatchLoading(p=>({...p,[fid]:true}));
    const mktLabels=markets.map(id=>MARKETS.find(x=>x.id===id)?.label).filter(Boolean).join(", ");
    try{
      const res=await API.askAI(
        `Search web for current info on ${m.teams?.home?.name} vs ${m.teams?.away?.name} (${m.league?.name}, ${date}).
Quick market picks for: ${mktLabels||"goals, corners, bookings"}.
Format: [Market]: [Pick] — [one-line reason]. Then ⭐ confidence 1–5.`
      );
      setMatchAI(p=>({...p,[fid]:res.result}));
    }catch(e){setMatchAI(p=>({...p,[fid]:"AI unavailable: "+e.message}));}
    setMatchLoading(p=>({...p,[fid]:false}));
  }

  async function buildTicket(){
    if(!user){onAuthRequired();return;}
    if(!fixtures.length){setErr("No fixtures loaded");return;}
    setTicketLoading(true);setTicket(null);

    const top=fixtures.slice(0,12);
    const matchList=top.map(m=>
      `• ${m.teams?.home?.name} vs ${m.teams?.away?.name} (${m.league?.name}) @ ${fmtTime(m.fixture?.date)||"TBD"}`
    ).join("\n");
    const mktLabels=markets.map(id=>MARKETS.find(x=>x.id===id)?.label).filter(Boolean).join(", ");

    try{
      const res=await API.askAI(
        `Search web RIGHT NOW for form, injuries, stats on these ${date} fixtures:
${matchList}

Build a COMPLETE SMART TICKET for markets: ${mktLabels}.

For each match:
━━━━━━━━━━━━━━━━
⚽ [Home] vs [Away] — [Competition] ⏰ [Time]
${markets.map(id=>{const mk=MARKETS.find(x=>x.id===id);return mk?`${mk.icon} ${mk.label}: [pick] — [reason]`:""}).filter(Boolean).join("\n")}
⭐ Confidence: X/5
━━━━━━━━━━━━━━━━

🎟️ RECOMMENDED 5-FOLD:
1. [pick]  2. [pick]  3. [pick]  4. [pick]  5. [pick]

🔥 BANKER: [best single pick]
💎 VALUE BET: [best odds value today]
🎰 3-FOLD ACCA: [3 safe picks]`,
        markets, date
      );
      setTicket(res.result);
    }catch(e){setErr("AI error: "+e.message);}
    setTicketLoading(false);
  }

  async function saveTicket(){
    if(!user){onAuthRequired();return;}
    try{
      await API.saveTicket({date,markets,content:ticket});
      setSavedMsg("✅ Ticket saved!");
      setTimeout(()=>setSavedMsg(""),3000);
    }catch(e){setSavedMsg("❌ "+e.message);}
  }

  // group by league
  const grouped={};
  fixtures.forEach(f=>{const k=f.league?.name||"Other";if(!grouped[k])grouped[k]=[];grouped[k].push(f);});

  return(
    <div>
      <DateStrip selected={date} onChange={d=>{setDate(d);setTicket(null);setExpanded(null);}}/>

      {/* Market picker */}
      <div style={{background:`linear-gradient(135deg,${C.peachLight},${C.bluePale}55)`,
        borderRadius:16,padding:16,marginBottom:18,border:`1.5px solid ${C.bluePale}`}}>
        <div style={{fontWeight:800,color:C.blue,marginBottom:10,fontSize:14}}>🎯 Select Markets</div>
        <div style={{display:"flex",flexWrap:"wrap",gap:7}}>
          {MARKETS.map(m=>{const on=markets.includes(m.id);return(
            <button key={m.id} onClick={()=>toggleMarket(m.id)} style={{
              background:on?C.blue:C.white,color:on?"#fff":C.dark,
              border:`1.5px solid ${on?C.blue:C.bluePale}`,borderRadius:20,
              padding:"6px 13px",fontSize:12,fontWeight:600,cursor:"pointer",
              fontFamily:"inherit",display:"flex",alignItems:"center",gap:4}}>
              <span>{m.icon}</span><span>{m.label}</span>{on&&<span style={{fontSize:10,opacity:.7}}>✓</span>}
            </button>
          );})}
        </div>
        <div style={{marginTop:12,display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
          <span style={{fontSize:12,color:C.gray}}>
            <b style={{color:C.blue}}>{markets.length}</b> markets · <b style={{color:C.blue}}>{fixtures.length}</b> fixtures on {fmtDate(date)}
          </span>
          <Btn ch={ticketLoading?"⏳ Building...":"🎟️ Build Day Ticket"} onClick={buildTicket}
            disabled={ticketLoading||!fixtures.length||!markets.length} v="accent" s={{marginLeft:"auto",fontSize:12}}/>
        </div>
      </div>

      {loading&&<Spin/>}
      {err&&!loading&&<div style={{background:"#FFF8F0",borderRadius:12,padding:"12px 16px",
        color:C.accent,fontWeight:600,fontSize:13,marginBottom:12}}>ℹ️ {err}</div>}

      {/* Fixtures grouped */}
      {Object.entries(grouped).map(([league,ms])=>(
        <div key={league} style={{marginBottom:18}}>
          <div style={{padding:"7px 14px",background:`linear-gradient(90deg,${C.dark},${C.blue})`,
            borderRadius:10,marginBottom:8,display:"flex",alignItems:"center",gap:8}}>
            {ms[0]?.league?.logo&&<img src={ms[0].league.logo} alt="" style={{width:18,height:18,objectFit:"contain"}}/>}
            <span style={{fontSize:12,fontWeight:800,color:C.peachMid,flex:1,overflow:"hidden",
              textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{league.toUpperCase()}</span>
            <span style={{fontSize:10,color:C.bluePale,flexShrink:0}}>{ms.length}</span>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:7}}>
            {ms.map(m=>{const fid=m.fixture?.id;return(
              <div key={fid}>
                <div style={{display:"flex",gap:6}}>
                  <div style={{flex:1}}><MatchRow m={m} onClick={()=>analyseMatch(m)} selected={expanded===fid}/></div>
                  <button onClick={()=>analyseMatch(m)} style={{
                    background:expanded===fid?C.blue:C.peachLight,color:expanded===fid?"#fff":C.blue,
                    border:`1.5px solid ${expanded===fid?C.blue:C.bluePale}`,borderRadius:10,
                    padding:"0 12px",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"inherit",
                    flexShrink:0}}>
                    {expanded===fid?"▲":"Analyse"}
                  </button>
                </div>
                {expanded===fid&&(
                  <div style={{background:C.peachLight,borderRadius:"0 0 12px 12px",padding:"14px 16px",
                    border:`1.5px solid ${C.blue}`,borderTop:"none",marginTop:-4}}>
                    {matchLoading[fid]
                      ?<div style={{fontSize:12,color:C.gray}}>⏳ Searching & analysing...</div>
                      :<div style={{fontSize:13,lineHeight:1.8,color:C.dark,whiteSpace:"pre-wrap"}}>{matchAI[fid]}</div>}
                  </div>
                )}
              </div>
            );})}
          </div>
        </div>
      ))}

      {/* Ticket */}
      {ticketLoading&&<div style={{background:`linear-gradient(135deg,${C.peachLight},${C.bluePale}66)`,
        borderRadius:16,padding:36,textAlign:"center",marginTop:16}}>
        <div style={{fontSize:28,marginBottom:8}}>🎟️</div>
        <div style={{fontWeight:800,color:C.blue,fontSize:15}}>Building your ticket...</div>
        <div style={{color:C.gray,fontSize:12,marginTop:4}}>Searching web for {fixtures.length} fixtures</div>
        <Spin/>
      </div>}

      {ticket&&(
        <div style={{borderLeft:`5px solid ${C.gold}`,borderRadius:16,padding:20,marginTop:16,
          background:`linear-gradient(135deg,${C.white},${C.peachLight}88)`,
          border:`1.5px solid ${C.bluePale}`,borderLeftWidth:5,borderLeftColor:C.gold}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14,flexWrap:"wrap"}}>
            <span style={{fontSize:22}}>🎟️</span>
            <div>
              <div style={{fontWeight:900,color:C.blue,fontSize:15}}>Smart Ticket — {fmtDate(date)}</div>
              <div style={{fontSize:11,color:C.gray,marginTop:2}}>{fixtures.length} fixtures · {markets.length} markets</div>
            </div>
            {user&&<button onClick={saveTicket} style={{marginLeft:"auto",background:C.gold,color:"#fff",
              border:"none",borderRadius:10,padding:"7px 14px",fontSize:12,fontWeight:700,
              cursor:"pointer",fontFamily:"inherit"}}>💾 Save Ticket</button>}
          </div>
          {savedMsg&&<div style={{color:savedMsg.startsWith("✅")?C.green:C.red,fontSize:13,
            marginBottom:10,fontWeight:700}}>{savedMsg}</div>}
          <div style={{whiteSpace:"pre-wrap",lineHeight:1.85,color:C.dark,fontSize:13}}>{ticket}</div>
        </div>
      )}
    </div>
  );
}

// ── LIVE TV TAB ───────────────────────────────────────────────────
const CHANNELS=[
  {id:"c1",name:"DSP Sports 1",league:"Premier League",viewers:"14.2K",quality:["HD","SD"],
   thumb:"https://images.unsplash.com/photo-1574629810360-7efbbe195018?w=400&q=80",
   streamUrl:""},
  {id:"c2",name:"DSP UCL",league:"Champions League",viewers:"38.5K",quality:["4K","HD","SD"],
   thumb:"https://images.unsplash.com/photo-1511886929837-354d827aae26?w=400&q=80",
   streamUrl:""},
  {id:"c3",name:"DSP La Liga",league:"La Liga",viewers:"9.1K",quality:["HD","SD"],
   thumb:"https://images.unsplash.com/photo-1520091748571-19f36dc8d21e?w=400&q=80",
   streamUrl:""},
  {id:"c4",name:"DSP Africa",league:"AFCON / CAF",viewers:"22.7K",quality:["HD","SD"],
   thumb:"https://images.unsplash.com/photo-1540747913346-19e32dc3e97e?w=400&q=80",
   streamUrl:""},
];

function LiveTV({user,onAuthRequired}){
  const [active,setActive]=useState(null);
  const [quality,setQuality]=useState("HD");
  const [chat,setChat]=useState([
    {u:"Dior",t:"🔥 Let's go!",ts:"21:03"},
    {u:"Kola",t:"GOOOAL!! 😱",ts:"21:05"},
    {u:"Tunde",t:"Ref is blind 😤",ts:"21:08"},
  ]);
  const [msg,setMsg]=useState("");
  const chatRef=useRef(null);

  function open(c){if(!user){onAuthRequired();return;}setActive(c);setQuality(c.quality[0]);}
  function sendMsg(e){
    e.preventDefault();if(!msg.trim())return;
    const ts=new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
    setChat(p=>[...p,{u:user?.name?.split(" ")[0]||"You",t:msg,ts}]);
    setMsg("");
    setTimeout(()=>{if(chatRef.current)chatRef.current.scrollTop=9999;},80);
  }

  if(active)return(
    <div>
      <button onClick={()=>setActive(null)} style={{background:"none",border:"none",color:C.blue,
        fontWeight:700,cursor:"pointer",marginBottom:14,fontFamily:"inherit",fontSize:14}}>← Back</button>
      <div style={{background:C.dark,borderRadius:18,overflow:"hidden",aspectRatio:"16/9",
        position:"relative",display:"flex",alignItems:"center",justifyContent:"center",marginBottom:14}}>
        {active.streamUrl
          ?<iframe src={active.streamUrl} style={{position:"absolute",inset:0,width:"100%",height:"100%"}}
              frameBorder="0" allowFullScreen title="stream"/>
          :<>
            <img src={active.thumb} alt="" style={{position:"absolute",inset:0,width:"100%",height:"100%",objectFit:"cover",opacity:.2}}/>
            <div style={{position:"relative",textAlign:"center",padding:20}}>
              <div style={{background:C.live,color:"#fff",borderRadius:8,padding:"5px 14px",
                fontSize:12,fontWeight:800,display:"inline-block",marginBottom:12,
                animation:"lb 1.5s ease-in-out infinite"}}>● LIVE</div>
              <div style={{color:"#fff",fontWeight:900,fontSize:18,marginBottom:8}}>{active.league}</div>
              <div style={{color:C.peachMid,fontSize:13,marginBottom:14}}>{active.name}</div>
              <div style={{color:C.gray,fontSize:12,lineHeight:1.6}}>
                Add your HLS/RTMP stream URL in<br/>
                <code style={{color:C.peachMid}}>frontend/src/App.jsx → CHANNELS[].streamUrl</code>
              </div>
            </div>
          </>}
        <div style={{position:"absolute",top:12,left:12,display:"flex",gap:8}}>
          <div style={{background:C.live,color:"#fff",borderRadius:6,padding:"3px 10px",
            fontSize:11,fontWeight:800,animation:"lb 1.5s ease-in-out infinite"}}>● LIVE</div>
          <div style={{background:"rgba(0,0,0,.65)",color:"#fff",borderRadius:6,padding:"3px 10px",fontSize:11}}>
            👁 {active.viewers}</div>
        </div>
        <div style={{position:"absolute",top:12,right:12,display:"flex",gap:4}}>
          {active.quality.map(q=><button key={q} onClick={()=>setQuality(q)} style={{
            background:quality===q?"rgba(255,255,255,.9)":"rgba(0,0,0,.55)",
            color:quality===q?C.dark:"#fff",border:"none",borderRadius:6,
            padding:"3px 9px",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>{q}</button>)}
        </div>
      </div>
      {/* chat */}
      <div style={{background:C.white,borderRadius:16,overflow:"hidden",
        border:`1.5px solid ${C.bluePale}`}}>
        <div style={{background:`linear-gradient(90deg,${C.dark},${C.blue})`,padding:"12px 16px"}}>
          <div style={{color:"#fff",fontWeight:800,fontSize:13}}>💬 Live Chat</div>
        </div>
        <div ref={chatRef} style={{height:200,overflowY:"auto",padding:"10px 14px",
          display:"flex",flexDirection:"column",gap:7}}>
          {chat.map((c,i)=><div key={i}>
            <span style={{fontWeight:700,fontSize:12,color:C.blue}}>{c.u} </span>
            <span style={{fontSize:10,color:C.gray}}>{c.ts}</span>
            <div style={{fontSize:13,color:C.dark,marginTop:1}}>{c.t}</div>
          </div>)}
        </div>
        <form onSubmit={sendMsg} style={{borderTop:`1.5px solid ${C.bluePale}`,padding:"8px 12px",display:"flex",gap:8}}>
          <input value={msg} onChange={e=>setMsg(e.target.value)} placeholder="Say something..."
            style={{...IS,height:36,padding:"7px 12px",fontSize:13}}/>
          <Btn ch="→" s={{padding:"7px 14px"}}/>
        </form>
      </div>
    </div>
  );

  return(
    <div>
      <div style={{background:`linear-gradient(135deg,${C.dark},${C.blue})`,borderRadius:16,
        padding:20,marginBottom:18,display:"flex",alignItems:"center",gap:14}}>
        <div style={{fontSize:34}}>📺</div>
        <div>
          <div style={{fontWeight:900,color:"#fff",fontSize:17,fontFamily:"Georgia,serif"}}>DSP Live TV</div>
          <div style={{color:C.bluePale,fontSize:12,marginTop:2}}>Watch football live · HD streams · Live chat</div>
        </div>
        <div style={{marginLeft:"auto",background:C.live,color:"#fff",borderRadius:8,
          padding:"5px 12px",fontSize:11,fontWeight:800,animation:"lb 1.5s ease-in-out infinite"}}>
          {CHANNELS.length} LIVE</div>
      </div>

      {!user&&<div style={{background:"#FFF8F0",borderRadius:12,padding:24,
        textAlign:"center",marginBottom:16,border:`1.5px solid ${C.peachMid}`}}>
        <div style={{fontSize:26,marginBottom:6}}>🔒</div>
        <div style={{fontWeight:800,color:C.blue,marginBottom:4}}>Sign in to watch live streams</div>
        <div style={{color:C.gray,fontSize:13,marginBottom:12}}>Free account required</div>
        <Btn ch="Sign In / Register" v="accent" onClick={onAuthRequired}/>
      </div>}

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:14}}>
        {CHANNELS.map(c=>(
          <div key={c.id} onClick={()=>open(c)} style={{borderRadius:16,overflow:"hidden",
            boxShadow:"0 4px 18px rgba(26,58,107,.12)",cursor:"pointer",
            border:`1.5px solid ${C.bluePale}`,transition:"transform .18s"}}
            onMouseEnter={e=>e.currentTarget.style.transform="translateY(-2px)"}
            onMouseLeave={e=>e.currentTarget.style.transform="none"}>
            <div style={{position:"relative",aspectRatio:"16/9",background:C.dark,overflow:"hidden"}}>
              <img src={c.thumb} alt="" style={{width:"100%",height:"100%",objectFit:"cover",opacity:.7}}/>
              <div style={{position:"absolute",inset:0,background:"linear-gradient(to top,rgba(0,0,0,.8),transparent 60%)"}}/>
              <div style={{position:"absolute",top:10,left:10,background:C.live,color:"#fff",
                borderRadius:6,padding:"2px 9px",fontSize:10,fontWeight:800,
                animation:"lb 1.5s ease-in-out infinite"}}>● LIVE</div>
              <div style={{position:"absolute",top:10,right:10,background:"rgba(0,0,0,.6)",
                color:"#fff",borderRadius:6,padding:"2px 8px",fontSize:10}}>👁 {c.viewers}</div>
              <div style={{position:"absolute",bottom:10,left:12,right:12}}>
                <div style={{color:C.peachMid,fontSize:11,fontWeight:700,marginBottom:1}}>{c.league}</div>
                <div style={{color:"#fff",fontWeight:800,fontSize:14}}>{c.name}</div>
              </div>
            </div>
            <div style={{background:C.white,padding:"9px 14px",display:"flex",alignItems:"center",gap:8}}>
              <div style={{flex:1}}>
                <div style={{fontSize:12,fontWeight:700,color:C.dark}}>{c.name}</div>
                <div style={{fontSize:11,color:C.gray,marginTop:1}}>{c.quality.join(" · ")}</div>
              </div>
              <span style={{background:C.green+"18",color:C.green,borderRadius:20,
                padding:"3px 10px",fontSize:11,fontWeight:700}}>WATCH</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── ROOT ──────────────────────────────────────────────────────────
const CATS=[
  {id:"scores",icon:"📡",label:"Live Scores"},
  {id:"analysis",icon:"🎟️",label:"Analysis"},
  {id:"tv",icon:"📺",label:"Live TV"},
];

export default function App(){
  const [cat,setCat]=useState("scores");
  const [user,setUser]=useState(null);
  const [showAuth,setShowAuth]=useState(false);

  useEffect(()=>{
    const unsub=onAuthStateChanged(auth,async fireUser=>{
      if(fireUser){
        try{const p=await API.getProfile();setUser(p);}
        catch{setUser({phone:fireUser.phoneNumber,name:"Fan"});}
      } else { setUser(null); }
    });
    return unsub;
  },[]);

  function login(u){setUser(u);setShowAuth(false);}
  async function logout(){await signOut(auth);setUser(null);}

  return(
    <div style={{minHeight:"100vh",background:`linear-gradient(150deg,${C.peachLight},${C.peach} 55%,${C.peachWarm})`,
      fontFamily:"'Trebuchet MS','Gill Sans',sans-serif",paddingBottom:70}}>

      {/* Header */}
      <div style={{background:`linear-gradient(90deg,${C.dark},${C.blue})`,
        position:"sticky",top:0,zIndex:200,boxShadow:"0 4px 20px rgba(13,31,60,.3)"}}>
        <div style={{maxWidth:980,margin:"0 auto",padding:"0 16px",
          display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
          <div style={{padding:"12px 0",fontFamily:"Georgia,serif",fontSize:18,
            fontWeight:900,color:C.peachMid,letterSpacing:.5}}>⚽ Dior Sports Padi</div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            {user
              ?<><span style={{color:C.bluePale,fontSize:12,fontWeight:600}}>👤 {user.name}</span>
                <button onClick={logout} style={{background:"rgba(255,255,255,.12)",color:"#fff",border:"none",
                  borderRadius:8,padding:"6px 12px",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                  Sign Out</button></>
              :<button onClick={()=>setShowAuth(true)} style={{background:C.peachDeep,color:"#fff",border:"none",
                borderRadius:8,padding:"7px 14px",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                Sign In</button>}
          </div>
        </div>
        <div style={{maxWidth:980,margin:"0 auto",padding:"0 16px",display:"flex",
          borderTop:`1px solid rgba(255,255,255,.1)`}}>
          {CATS.map(c=><button key={c.id} onClick={()=>setCat(c.id)} style={{
            flex:1,background:"none",border:"none",
            borderBottom:cat===c.id?`3px solid ${C.peachDeep}`:"3px solid transparent",
            color:cat===c.id?C.peachMid:C.bluePale,padding:"13px 0",fontSize:13,fontWeight:700,
            cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",
            justifyContent:"center",gap:6}}>
            <span style={{fontSize:16}}>{c.icon}</span><span>{c.label}</span>
          </button>)}
        </div>
      </div>

      <div style={{maxWidth:980,margin:"0 auto",padding:"18px 14px 20px"}}>
        <div style={{marginBottom:16}}>
          <div style={{fontSize:10,color:C.blueLight,fontWeight:700,letterSpacing:2,marginBottom:2}}>DIOR SPORTS PADI</div>
          <h2 style={{margin:0,fontSize:20,fontWeight:900,color:C.blue,fontFamily:"Georgia,serif"}}>
            {CATS.find(c=>c.id===cat)?.icon} {CATS.find(c=>c.id===cat)?.label}
          </h2>
          <div style={{height:3,width:38,background:C.peachDeep,borderRadius:2,marginTop:6}}/>
        </div>
        {cat==="scores"  &&<LiveScores/>}
        {cat==="analysis"&&<AnalysisTab user={user} onAuthRequired={()=>setShowAuth(true)}/>}
        {cat==="tv"      &&<LiveTV user={user} onAuthRequired={()=>setShowAuth(true)}/>}
      </div>

      {/* Bottom nav */}
      <div style={{position:"fixed",bottom:0,left:0,right:0,zIndex:100,
        background:`linear-gradient(90deg,${C.dark},${C.blue})`,
        borderTop:`2px solid ${C.peachDeep}`,display:"flex"}}>
        {CATS.map(c=><button key={c.id} onClick={()=>setCat(c.id)} style={{
          flex:1,background:"none",border:"none",padding:"11px 0",
          color:cat===c.id?C.peachMid:C.bluePale,cursor:"pointer",fontFamily:"inherit",
          display:"flex",flexDirection:"column",alignItems:"center",gap:2,
          borderTop:cat===c.id?`2px solid ${C.peachDeep}`:"2px solid transparent",marginTop:-2}}>
          <span style={{fontSize:18}}>{c.icon}</span>
          <span style={{fontSize:10,fontWeight:700}}>{c.label}</span>
        </button>)}
      </div>

      {showAuth&&<AuthModal onClose={()=>setShowAuth(false)} onLogin={login}/>}
      <style>{`@keyframes lb{0%,100%{opacity:1}50%{opacity:.4}}@keyframes sp{to{transform:rotate(360deg)}}*{box-sizing:border-box}`}</style>
    </div>
  );
}
