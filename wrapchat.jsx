import { useState, useEffect, useRef } from "react";

// ─────────────────────────────────────────────────────────────────
// PARSER
// ─────────────────────────────────────────────────────────────────
function parseWhatsApp(text) {
  const re = /^\[?(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AP]M)?)\]?\s*[-–]?\s*([^:]+):\s(.+)$/i;
  const messages = [];
  for (const line of text.split("\n")) {
    const m = line.match(re);
    if (!m) continue;
    const [, dateStr, timeStr, sender, body] = m;
    const name = sender.trim();
    if (/messages to this group|security code|added|removed|left|created group|changed the|end-to-end/i.test(name + body)) continue;
    const parts = dateStr.split(/[\/.\-]/).map(Number);
    let date;
    if (parts[2] > 999)      date = new Date(parts[2], parts[1]-1, parts[0]);
    else if (parts[0] > 31)  date = new Date(2000+parts[0], parts[1]-1, parts[2]);
    else                      date = new Date(parts[2]<100?2000+parts[2]:parts[2], parts[1]-1, parts[0]);
    const tp = timeStr.match(/(\d+):(\d+)(?::(\d+))?(?:\s*([AP]M))?/i);
    if (tp) {
      let h = parseInt(tp[1]);
      if (tp[4]?.toUpperCase()==="PM" && h<12) h+=12;
      if (tp[4]?.toUpperCase()==="AM" && h===12) h=0;
      date.setHours(h, parseInt(tp[2]), parseInt(tp[3]||0));
    }
    if (isNaN(date.getTime())) continue;
    messages.push({ name, body: body.trim(), date, hour: date.getHours(), month: date.getMonth(), year: date.getFullYear() });
  }
  return messages;
}

// ─────────────────────────────────────────────────────────────────
// LOCAL MATH
// ─────────────────────────────────────────────────────────────────
const STOP = new Set("the a an and or but in on at to for of is it was he she they i you we my your our this that with be are have has had not so do did all can will just if up out about me him her them what how when where who which as from by more than then there their also too very really yeah yes no ok okay hey hi haha lol omg im its dont cant wont ive youre theyre get got go going like know think said one some any been would could should even still now here see come want say make time back other into over after well way need because much only just gonna gotta kinda wanna ill aint tho though cause cuz tbh ngl fr rn".split(" "));

function localStats(messages) {
  if (!messages.length) return null;
  const namesAll = [...new Set(messages.map(m => m.name))];
  const isGroup  = namesAll.length > 2;
  const byName   = {};
  namesAll.forEach(n => (byName[n] = []));
  messages.forEach(m => byName[m.name]?.push(m));
  const namesSorted = [...namesAll].sort((a,b) => byName[b].length - byName[a].length);

  const wordFreq = {};
  messages.forEach(({body}) => {
    if (/media omitted|image omitted|video omitted/i.test(body) || body.startsWith("http")) return;
    body.toLowerCase().replace(/[^\w\s]/g,"").split(/\s+/).forEach(w => {
      if (w.length>2 && !STOP.has(w) && !/^\d+$/.test(w)) wordFreq[w]=(wordFreq[w]||0)+1;
    });
  });
  const topWords = Object.entries(wordFreq).sort((a,b)=>b[1]-a[1]).slice(0,10);

  const emojiRe = /\p{Emoji_Presentation}|\p{Extended_Pictographic}/gu;
  const emojiFreq = {};
  messages.forEach(({body}) => (body.match(emojiRe)||[]).forEach(e => (emojiFreq[e]=(emojiFreq[e]||0)+1)));
  const spiritEmojiAll = Object.entries(emojiFreq).sort((a,b)=>b[1]-a[1])[0]?.[0]||"💬";
  const spiritByName = {};
  namesAll.forEach(n => {
    const ef = {};
    byName[n].forEach(({body}) => (body.match(emojiRe)||[]).forEach(e => (ef[e]=(ef[e]||0)+1)));
    spiritByName[n] = Object.entries(ef).sort((a,b)=>b[1]-a[1])[0]?.[0]||"💬";
  });

  const mediaByName = {}, linkByName = {};
  namesAll.forEach(n => {
    mediaByName[n] = byName[n].filter(m => /media omitted|image omitted|video omitted/i.test(m.body)).length;
    linkByName[n]  = byName[n].filter(m => m.body.includes("http")).length;
  });

  const peakHourByName = {};
  namesAll.forEach(n => {
    const h = Array(24).fill(0);
    byName[n].forEach(m => h[m.hour]++);
    peakHourByName[n] = h.indexOf(Math.max(...h));
  });
  const fmtHour = h => h===0?"12am":h<12?`${h}am`:h===12?"12pm":`${h-12}pm`;

  const avgLenByName = {};
  namesAll.forEach(n => {
    const msgs = byName[n].filter(m => !/media omitted/i.test(m.body) && !m.body.startsWith("http"));
    avgLenByName[n] = msgs.length ? Math.round(msgs.reduce((s,m)=>s+m.body.length,0)/msgs.length) : 0;
  });

  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const monthFreq = {};
  messages.forEach(m => { const k=`${m.year}-${String(m.month).padStart(2,"0")}`; monthFreq[k]=(monthFreq[k]||0)+1; });
  const topMonths = Object.entries(monthFreq).sort((a,b)=>b[1]-a[1]).slice(0,3)
    .map(([k,v]) => { const [y,mo]=k.split("-"); return [`${MONTHS[+mo]} ${y}`,v]; });

  const daySet  = new Set(messages.map(m=>m.date.toDateString()));
  const dayList = [...daySet].map(d=>new Date(d)).sort((a,b)=>a-b);
  let maxStreak=1, cur=1;
  for(let i=1;i<dayList.length;i++){cur=(dayList[i]-dayList[i-1])/86400000===1?cur+1:1;if(cur>maxStreak)maxStreak=cur;}

  const starterCount = {};
  namesAll.forEach(n=>(starterCount[n]=0));
  const firstByDay = {};
  messages.forEach(m=>{const d=m.date.toDateString();if(!firstByDay[d])firstByDay[d]=m;});
  Object.values(firstByDay).forEach(m=>{if(m.name in starterCount)starterCount[m.name]++;});
  const topStarterEntry = Object.entries(starterCount).sort((a,b)=>b[1]-a[1])[0];
  const starterPct = topStarterEntry?`${Math.round((topStarterEntry[1]/Object.keys(firstByDay).length)*100)}%`:"50%";

  const killerCount = {};
  namesAll.forEach(n=>(killerCount[n]=0));
  for(let i=0;i<messages.length-1;i++){if((messages[i+1].date-messages[i].date)/60000>120)killerCount[messages[i].name]++;}
  const topKillerEntry = Object.entries(killerCount).sort((a,b)=>b[1]-a[1])[0];

  let ghostAvg=["?","?"], ghostName=namesSorted[0];
  if(!isGroup && namesAll.length>=2){
    const rt={};namesAll.forEach(n=>(rt[n]=[]));
    for(let i=1;i<messages.length;i++){
      const prev=messages[i-1],curr=messages[i];
      if(curr.name!==prev.name && curr.name in rt){const d=(curr.date-prev.date)/60000;if(d>1&&d<1440)rt[curr.name].push(d);}
    }
    const fmt=n=>{const a=rt[n]||[];if(!a.length)return"instant";const avg=a.reduce((s,t)=>s+t,0)/a.length;return avg<60?`${Math.round(avg)}m`:`${Math.round(avg/60)}h ${Math.round(avg%60)}m`;};
    const a0=fmt(namesSorted[0]),a1=fmt(namesSorted[1]||namesSorted[0]);
    ghostAvg=[a0,a1];
    const pm=s=>{const h=s.match(/(\d+)h/),mn=s.match(/(\d+)m/);return(h?+h[1]*60:0)+(mn?+mn[1]:0);};
    ghostName=pm(a0)>=pm(a1)?namesSorted[0]:namesSorted[1];
  }

  const sigWordByName = {};
  namesAll.forEach(n=>{
    const wf={};
    byName[n].forEach(({body})=>body.toLowerCase().replace(/[^\w\s]/g,"").split(/\s+/).forEach(w=>{if(w.length>2&&!STOP.has(w)&&!/^\d+$/.test(w))wf[w]=(wf[w]||0)+1;}));
    sigWordByName[n]=Object.entries(wf).sort((a,b)=>b[1]-a[1])[0]?.[0]||"...";
  });

  return {
    isGroup, names: namesSorted,
    msgCounts: namesSorted.map(n=>byName[n].length),
    topWords, spiritEmoji: isGroup?[spiritEmojiAll]:namesSorted.map(n=>spiritByName[n]||"💬"),
    avgMsgLen: namesSorted.map(n=>avgLenByName[n]),
    mediaCounts: namesSorted.map(n=>mediaByName[n]),
    linkCounts: namesSorted.map(n=>linkByName[n]),
    peakHour: namesSorted.map(n=>fmtHour(peakHourByName[n])),
    signatureWord: namesSorted.map(n=>sigWordByName[n]),
    ghostAvg, ghostName, streak: maxStreak,
    topMonths: topMonths.length?topMonths:[["This month",messages.length]],
    convStarter: topStarterEntry?.[0]||namesSorted[0], convStarterPct: starterPct,
    convKiller: topKillerEntry?.[0]||namesSorted[0], convKillerCount: topKillerEntry?.[1]||0,
    mainChar:     isGroup?namesSorted[0]:null,
    ghost:        isGroup?namesSorted[namesSorted.length-1]:null,
    novelist:     isGroup?[...namesAll].sort((a,b)=>avgLenByName[b]-avgLenByName[a])[0]:null,
    hype:         isGroup?topStarterEntry?.[0]||namesAll[0]:null,
    photographer: isGroup?[...namesAll].sort((a,b)=>mediaByName[b]-mediaByName[a])[0]:null,
    linkDumper:   isGroup?[...namesAll].sort((a,b)=>linkByName[b]-linkByName[a])[0]:null,
    nightOwl:     isGroup?[...namesAll].sort((a,b)=>peakHourByName[b]-peakHourByName[a])[0]:null,
    earlyBird:    isGroup?[...namesAll].sort((a,b)=>peakHourByName[a]-peakHourByName[b])[0]:null,
    mostHyped:    isGroup?namesSorted[1]||namesSorted[0]:null,
    totalMessages: messages.length,
  };
}

// ─────────────────────────────────────────────────────────────────
// SMART SAMPLE + AI
// ─────────────────────────────────────────────────────────────────
function smartSample(messages, target=600) {
  if (messages.length <= target) return messages;
  const step = messages.length / target;
  return Array.from({length:target}, (_,i) => messages[Math.floor(i*step)]);
}

function formatForAI(messages) {
  return messages.map(m => {
    const d=m.date;
    const ts=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
    return `[${ts}] ${m.name}: ${m.body}`;
  }).join("\n");
}

async function aiAnalysis(messages, math) {
  const sample   = smartSample(messages, 600);
  const chatText = formatForAI(sample);
  const names    = math.names;
  const isGroup  = math.isGroup;

  const duoFields = `{
  "funniestPerson": "name of who genuinely made the other laugh most",
  "funniestReason": "1 sentence — what specifically makes them funny (their style, timing, content)",
  "ghostContext": "1 sentence — explain the ghost pattern with real context, not just 'they take long to reply'",
  "biggestTopic": "1 sentence — the main recurring thing they talk about (be very specific, e.g. 'Planning trips they never take' not 'travel')",
  "dramaStarter": "name of who tends to stir things or create tension",
  "dramaContext": "1 sentence — how they do it, with specific examples from the chat",
  "signaturePhrase": ["a real phrase or expression ${names[0]} uses constantly", "a real phrase or expression ${names[1]||names[0]} uses constantly"],
  "relationshipSummary": "2 sentences — honest, slightly sassy read of the real dynamic. What's actually going on between these two?",
  "tensionMoment": "1 sentence — the most awkward or tense moment in the chat",
  "sweetMoment": "1 sentence — the most wholesome or affectionate moment",
  "vibeOneLiner": "one punchy sentence that perfectly captures this chat's energy"
}`;

  const groupFields = `{
  "funniestPerson": "name of who the group finds funniest based on how they react to them",
  "funniestReason": "1 sentence — what makes them funny",
  "biggestTopic": "1 sentence — the main thing this group talks about (be specific, not generic)",
  "dramaStarter": "name of who causes the most chaos or tension",
  "dramaContext": "1 sentence — how and why they start drama",
  "groupDynamic": "2 sentences — honest read of the group's energy and relationships. Be specific.",
  "mostMissed": "name of who, when they go quiet, the group misses most",
  "insideJoke": "1 sentence — a recurring joke, meme or reference that keeps coming up",
  "tensionMoment": "1 sentence — the most tense moment in the group history",
  "sweetMoment": "1 sentence — the most wholesome group moment",
  "vibeOneLiner": "one punchy sentence capturing this group's energy"
}`;

  try {
    const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("No API key found. Add VITE_ANTHROPIC_API_KEY to your .env file.");
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        system: `You are WrapChat — a sharp, witty chat analyst who reads WhatsApp conversations and gives honest, funny, insightful analysis like a friend who has read everything. Be specific — reference real patterns, real phrases, real moments from the chat. Avoid generic observations. Return ONLY valid JSON with no markdown fences and no explanation outside the JSON.`,
        messages: [{ role: "user", content: `Here is a ${isGroup?"group":"two-person"} WhatsApp chat between ${names.slice(0,6).join(", ")}. The full chat has ${math.totalMessages.toLocaleString()} messages — this is a representative sample spread across the full history.\n\n${chatText}\n\nAnalyse this deeply and return exactly this JSON structure:\n${isGroup?groupFields:duoFields}\n\nBe specific, funny, and reference real things from the chat.` }],
      }),
    });
    const data = await res.json();
    const raw  = data.content?.[0]?.text?.trim() || "{}";
    return JSON.parse(raw.replace(/^```json\n?/,"").replace(/\n?```$/,"").trim());
  } catch(e) {
    console.error("AI failed:", e);
    return {};
  }
}

// ─────────────────────────────────────────────────────────────────
// UI PRIMITIVES
// ─────────────────────────────────────────────────────────────────
const PAL = {
  roast:  ["#6B1A08","#B83A10"], lovely: ["#241660","#7A1C48"],
  funny:  ["#143404","#6E4006"], stats:  ["#04244A","#083870"],
  ai:     ["#0A1A3A","#1A3060"], finale: ["#160A34","#5E1228"],
  upload: ["#160A34","#2C1268"],
};
const PILL = { roast:"The Roast", lovely:"The Lovely", funny:"The Funny", stats:"The Stats", ai:"AI Insight", finale:"WrapChat" };

function Shell({ sec, prog, total, children }) {
  const [a,b]=PAL[sec]||PAL.upload;
  return (
    <div style={{ minHeight:520, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"2.5rem 1.5rem 1.5rem", background:`linear-gradient(148deg,${a},${b})`, position:"relative", borderRadius:16, overflow:"hidden" }}>
      <div style={{ position:"absolute", top:0, left:0, right:0, height:3, background:"rgba(255,255,255,0.1)" }}>
        <div style={{ height:"100%", background:"rgba(255,255,255,0.7)", borderRadius:"0 2px 2px 0", width:`${total>0?Math.round((prog/total)*100):0}%`, transition:"width 0.4s" }} />
      </div>
      {PILL[sec] && <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", color:"rgba(255,255,255,0.45)", background:"rgba(255,255,255,0.08)", padding:"3px 12px", borderRadius:20, marginBottom:16 }}>{PILL[sec]}</div>}
      {children}
    </div>
  );
}

const T    = ({s=28,children}) => <div style={{ fontSize:s, fontWeight:800, textAlign:"center", lineHeight:1.2, color:"#fff", marginBottom:8, letterSpacing:-0.5 }}>{children}</div>;
const Big  = ({children})      => <div style={{ fontSize:40, fontWeight:800, textAlign:"center", color:"#fff", margin:"10px 0 4px", letterSpacing:-1 }}>{children}</div>;
const Sub  = ({children,mt=0}) => <div style={{ fontSize:14, textAlign:"center", color:"rgba(255,255,255,0.62)", lineHeight:1.55, maxWidth:300, marginTop:mt }}>{children}</div>;
const Quip = ({children})      => <div style={{ fontSize:13, textAlign:"center", color:"rgba(255,255,255,0.75)", background:"rgba(255,255,255,0.08)", padding:"9px 16px", borderRadius:10, marginTop:14, maxWidth:290, lineHeight:1.45, fontStyle:"italic" }}>{children}</div>;

function Dots() {
  return (
    <>
      <div style={{ display:"flex", gap:5 }}>{[0,1,2].map(i=><div key={i} style={{ width:7,height:7,borderRadius:"50%",background:"rgba(255,255,255,0.35)",animation:`blink 1.2s ${i*0.2}s infinite` }} />)}</div>
      <style>{`@keyframes blink{0%,80%,100%{opacity:.15}40%{opacity:1}}`}</style>
    </>
  );
}

function AICard({ label, value, loading }) {
  return (
    <div style={{ background:"rgba(255,255,255,0.07)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:12, padding:"12px 16px", maxWidth:310, width:"100%", marginTop:12 }}>
      <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", color:"rgba(255,255,255,0.38)", marginBottom:6 }}>{label}</div>
      {loading ? <Dots /> : <div style={{ fontSize:14, color:"#fff", lineHeight:1.6 }}>{value||"—"}</div>}
    </div>
  );
}

function Btn({ onClick, children }) {
  const [h,setH]=useState(false);
  return <button onClick={onClick} onMouseEnter={()=>setH(true)} onMouseLeave={()=>setH(false)} style={{ padding:"9px 22px", borderRadius:10, border:"1px solid rgba(255,255,255,0.2)", background:h?"rgba(255,255,255,0.18)":"rgba(255,255,255,0.08)", color:"#fff", fontSize:14, cursor:"pointer", fontWeight:600, transition:"background 0.15s" }}>{children}</button>;
}
function Nav({ back, next, showBack=true, nextLabel="Next" }) {
  return <div style={{ display:"flex", gap:10, marginTop:24 }}>{showBack&&<Btn onClick={back}>Back</Btn>}<Btn onClick={next}>{nextLabel}</Btn></div>;
}
function Bar({ value, max, color, label, delay=0 }) {
  const [w,setW]=useState(0);
  useEffect(()=>{const t=setTimeout(()=>setW(Math.round((value/Math.max(max,1))*100)),120+delay);return()=>clearTimeout(t);},[value,max,delay]);
  return (
    <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:9 }}>
      <div style={{ width:86, textAlign:"right", fontSize:12, color:"rgba(255,255,255,0.6)", flexShrink:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{label}</div>
      <div style={{ flex:1, height:24, borderRadius:6, background:"rgba(255,255,255,0.08)", overflow:"hidden" }}>
        <div style={{ height:"100%", width:`${w}%`, background:color, borderRadius:6, display:"flex", alignItems:"center", paddingLeft:8, fontSize:12, fontWeight:700, color:"#fff", transition:"width 0.9s cubic-bezier(.4,0,.2,1)", whiteSpace:"nowrap" }}>{value.toLocaleString()}</div>
      </div>
    </div>
  );
}
function MonthBadge({ month, count, medal }) {
  return <div style={{ background:"rgba(255,255,255,0.1)", borderRadius:12, padding:"12px 16px", textAlign:"center", minWidth:82 }}><div style={{ fontSize:22 }}>{medal}</div><div style={{ fontSize:14, fontWeight:700, color:"#fff", marginTop:4 }}>{month}</div><div style={{ fontSize:11, color:"rgba(255,255,255,0.5)", marginTop:2 }}>{count.toLocaleString()} msgs</div></div>;
}
function Words({ words }) {
  const M=["🥇","🥈","🥉"];
  return <div style={{ width:"100%", maxWidth:300, marginTop:10 }}>{words.map(([w,c],i)=>(
    <div key={i} style={{ display:"flex", alignItems:"center", gap:10, padding:"7px 0", borderBottom:"1px solid rgba(255,255,255,0.07)" }}>
      <span style={{ width:28, fontSize:13, color:"rgba(255,255,255,0.38)" }}>{M[i]||i+1}</span>
      <span style={{ flex:1, fontWeight:700, color:"#fff", fontSize:15 }}>{w}</span>
      <span style={{ fontSize:13, color:"rgba(255,255,255,0.42)" }}>{c.toLocaleString()}x</span>
    </div>
  ))}</div>;
}
function Cell({ label, value }) {
  return <div style={{ background:"rgba(255,255,255,0.08)", borderRadius:10, padding:"10px 14px" }}><div style={{ fontSize:11, color:"rgba(255,255,255,0.42)", marginBottom:3 }}>{label}</div><div style={{ fontWeight:700, color:"#fff", fontSize:14 }}>{value}</div></div>;
}

// ─────────────────────────────────────────────────────────────────
// DUO SCREENS
// ─────────────────────────────────────────────────────────────────
function DuoScreen({ s, ai, aiLoading, step, back, next }) {
  const total  = s.msgCounts[0]+s.msgCounts[1];
  const pct0   = Math.round((s.msgCounts[0]/total)*100);
  const mMax   = Math.max(...s.msgCounts);
  const nov    = s.avgMsgLen[0]>=s.avgMsgLen[1]?0:1;
  const TOTAL  = 17;
  const screens = [
    <Shell sec="roast" prog={1} total={TOTAL}>
      <T>Who's more obsessed?</T>
      <div style={{width:"100%",maxWidth:300,marginTop:16}}>
        <Bar value={s.msgCounts[0]} max={mMax} color="#E06030" label={s.names[0]} />
        <Bar value={s.msgCounts[1]} max={mMax} color="#4A90D4" label={s.names[1]} delay={160} />
      </div>
      <Sub mt={14}>{pct0}% of all messages came from {s.names[0]}.</Sub>
      <Quip>"{s.names[pct0>=50?0:1]}, you might want to check your screen time."</Quip>
      <Nav back={back} next={next} showBack={false} />
    </Shell>,

    <Shell sec="roast" prog={2} total={TOTAL}>
      <T>The Ghost Award</T>
      <Big>{s.ghostName}</Big>
      <Sub>{s.names[0]} avg reply: <strong style={{color:"#fff"}}>{s.ghostAvg[0]}</strong>&nbsp;&nbsp;{s.names[1]} avg reply: <strong style={{color:"#fff"}}>{s.ghostAvg[1]}</strong></Sub>
      <AICard label="But what's actually going on" value={ai?.ghostContext} loading={aiLoading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="roast" prog={3} total={TOTAL}>
      <T>Conversation Killer</T>
      <Big>{s.convKiller}</Big>
      <Sub>Left {s.convKillerCount} messages hanging with no reply for 2+ hours.</Sub>
      <Quip>"And then silence. Beautiful silence."</Quip>
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="lovely" prog={4} total={TOTAL}>
      <T>Your longest streak</T>
      <Big>{s.streak} days</Big>
      <Sub>Texted every single day for {s.streak} days straight.</Sub>
      <AICard label="The sweetest moment" value={ai?.sweetMoment} loading={aiLoading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="lovely" prog={5} total={TOTAL}>
      <T>Top 3 most active months</T>
      <div style={{display:"flex",gap:10,marginTop:16,flexWrap:"wrap",justifyContent:"center"}}>
        {s.topMonths.map((m,i)=><MonthBadge key={i} month={m[0]} count={m[1]} medal={["🥇","🥈","🥉"][i]} />)}
      </div>
      <Sub mt={14}>{s.topMonths[0][0]} was your month. Something was going on.</Sub>
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="lovely" prog={6} total={TOTAL}>
      <T>Who always reaches out first?</T>
      <Big>{s.convStarter}</Big>
      <Sub>Started {s.convStarterPct} of all conversations.</Sub>
      <Quip>"Someone's always thinking of the other one first."</Quip>
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="funny" prog={7} total={TOTAL}>
      <T>The Funny One</T>
      <Big>{aiLoading?"...":(ai?.funniestPerson||s.names[0])}</Big>
      <AICard label="Why they're funny" value={ai?.funniestReason} loading={aiLoading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="funny" prog={8} total={TOTAL}>
      <T>Spirit emojis</T>
      <div style={{display:"flex",gap:"2.5rem",margin:"16px 0",justifyContent:"center"}}>
        {[0,1].map(i=>(
          <div key={i} style={{textAlign:"center"}}>
            <div style={{fontSize:64,lineHeight:1}}>{s.spiritEmoji[i]}</div>
            <div style={{fontSize:13,color:"rgba(255,255,255,0.5)",marginTop:8}}>{s.names[i]}</div>
          </div>
        ))}
      </div>
      <Sub>These two emojis basically ARE this friendship.</Sub>
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="funny" prog={9} total={TOTAL}>
      <T>Top 10 most used words</T>
      <Words words={s.topWords} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="funny" prog={10} total={TOTAL}>
      <T>Signature phrases</T>
      <div style={{display:"flex",gap:"1rem",margin:"16px 0",justifyContent:"center",flexWrap:"wrap"}}>
        {[0,1].map(i=>(
          <div key={i} style={{background:"rgba(255,255,255,0.08)",padding:"14px 18px",borderRadius:12,textAlign:"center",maxWidth:145}}>
            {aiLoading?<Dots />:<div style={{fontSize:14,fontWeight:700,color:"#fff",fontStyle:"italic"}}>"{ai?.signaturePhrase?.[i]||s.signatureWord[i]}"</div>}
            <div style={{fontSize:12,color:"rgba(255,255,255,0.42)",marginTop:6}}>{s.names[i]}</div>
          </div>
        ))}
      </div>
      <Sub>The phrases that define each of you.</Sub>
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="stats" prog={11} total={TOTAL}>
      <T>The Novelist vs The Texter</T>
      <div style={{display:"flex",gap:"2.5rem",margin:"16px 0",justifyContent:"center",alignItems:"center"}}>
        {[0,1].map(i=>(
          <div key={i} style={{textAlign:"center"}}>
            <div style={{fontSize:40,fontWeight:800,color:"#fff"}}>{s.avgMsgLen[i]}</div>
            <div style={{fontSize:12,color:"rgba(255,255,255,0.5)",marginTop:4}}>avg chars<br/>{s.names[i]}</div>
          </div>
        ))}
      </div>
      <Quip>"{s.names[nov]} writes essays. {s.names[nov===0?1:0]} sends 'k'."</Quip>
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="stats" prog={12} total={TOTAL}>
      <T>Media and links</T>
      <div style={{width:"100%",maxWidth:300,marginTop:16}}>
        <div style={{fontSize:11,color:"rgba(255,255,255,0.38)",marginBottom:6,textTransform:"uppercase",letterSpacing:"0.07em"}}>Photos & videos</div>
        <Bar value={s.mediaCounts[0]} max={Math.max(...s.mediaCounts,1)} color="#3ABDA0" label={s.names[0]} />
        <Bar value={s.mediaCounts[1]} max={Math.max(...s.mediaCounts,1)} color="#4A90D4" label={s.names[1]} delay={160} />
        <div style={{fontSize:11,color:"rgba(255,255,255,0.38)",margin:"12px 0 6px",textTransform:"uppercase",letterSpacing:"0.07em"}}>Links shared</div>
        <Bar value={s.linkCounts[0]} max={Math.max(...s.linkCounts,1)} color="#3ABDA0" label={s.names[0]} />
        <Bar value={s.linkCounts[1]} max={Math.max(...s.linkCounts,1)} color="#4A90D4" label={s.names[1]} delay={160} />
      </div>
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="stats" prog={13} total={TOTAL}>
      <T>Night owl vs early bird</T>
      <div style={{display:"flex",gap:"3rem",margin:"20px 0",justifyContent:"center"}}>
        {[0,1].map(i=>(
          <div key={i} style={{textAlign:"center"}}>
            <div style={{fontSize:28,fontWeight:800,color:"#fff"}}>{s.peakHour[i]}</div>
            <div style={{fontSize:12,color:"rgba(255,255,255,0.5)",marginTop:6}}>{s.names[i]}</div>
          </div>
        ))}
      </div>
      <Quip>"{s.names[0]} at {s.peakHour[0]} is a different person entirely."</Quip>
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="ai" prog={14} total={TOTAL}>
      <T>What you actually talk about</T>
      <AICard label="Biggest topic" value={ai?.biggestTopic} loading={aiLoading} />
      <AICard label="Most tense moment" value={ai?.tensionMoment} loading={aiLoading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="ai" prog={15} total={TOTAL}>
      <T>The Drama Report</T>
      <Big>{aiLoading?"...":(ai?.dramaStarter||s.names[0])}</Big>
      <AICard label="How they do it" value={ai?.dramaContext} loading={aiLoading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="ai" prog={16} total={TOTAL}>
      <T>What's really going on</T>
      <AICard label="Relationship read" value={ai?.relationshipSummary} loading={aiLoading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="ai" prog={17} total={TOTAL}>
      <T>Chat vibe</T>
      <div style={{background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:14,padding:"1.4rem 1.5rem",maxWidth:300,textAlign:"center",marginTop:16,fontSize:16,lineHeight:1.7,fontStyle:"italic",color:"#fff",minHeight:80,display:"flex",alignItems:"center",justifyContent:"center"}}>
        {aiLoading?<Dots />:(ai?.vibeOneLiner||"A chaotic, wholesome connection.")}
      </div>
      <Sub mt={14}>Powered by AI — your messages never left your device.</Sub>
      <Nav back={back} next={next} nextLabel="See summary" />
    </Shell>,
  ];
  return screens[step]??null;
}

// ─────────────────────────────────────────────────────────────────
// GROUP SCREENS
// ─────────────────────────────────────────────────────────────────
function GroupScreen({ s, ai, aiLoading, step, back, next }) {
  const mMax   = Math.max(...s.msgCounts,1);
  const COLORS = ["#E06030","#4A90D4","#3ABDA0","#C4809A","#8A70D4","#D4A840"];
  const TOTAL  = 16;
  const screens = [
    <Shell sec="roast" prog={1} total={TOTAL}>
      <T>The Main Character</T>
      <Big>{s.mainChar}</Big>
      <div style={{width:"100%",maxWidth:300,marginTop:10}}>
        {s.names.slice(0,6).map((n,i)=><Bar key={n} value={s.msgCounts[i]} max={mMax} color={COLORS[i%COLORS.length]} label={n} delay={i*80} />)}
      </div>
      <Quip>"{s.mainChar}, this is basically your personal blog."</Quip>
      <Nav back={back} next={next} showBack={false} />
    </Shell>,

    <Shell sec="roast" prog={2} total={TOTAL}>
      <T>The Ghost</T>
      <Big>{s.ghost}</Big>
      <Sub>{s.msgCounts[s.msgCounts.length-1].toLocaleString()} messages total. Why are they even here?</Sub>
      <Quip>"Read receipts but never replies. A legend."</Quip>
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="roast" prog={3} total={TOTAL}>
      <T>Conversation Killer</T>
      <Big>{s.convKiller}</Big>
      <Sub>Their messages most often end in complete silence.</Sub>
      <Quip>"They said something. Nobody responded. Moving on."</Quip>
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="lovely" prog={4} total={TOTAL}>
      <T>Top 3 most active months</T>
      <div style={{display:"flex",gap:10,marginTop:16,flexWrap:"wrap",justifyContent:"center"}}>
        {s.topMonths.map((m,i)=><MonthBadge key={i} month={m[0]} count={m[1]} medal={["🥇","🥈","🥉"][i]} />)}
      </div>
      <Sub mt={14}>The group was most alive in {s.topMonths[0][0]}.</Sub>
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="lovely" prog={5} total={TOTAL}>
      <T>Longest active streak</T>
      <Big>{s.streak} days</Big>
      <Sub>The group kept the chat alive for {s.streak} days straight.</Sub>
      <Quip>"You all actually like each other. Surprising."</Quip>
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="lovely" prog={6} total={TOTAL}>
      <T>The Hype Person</T>
      <Big>{s.hype}</Big>
      <Sub>Most likely to kick off conversations and keep things going.</Sub>
      <AICard label="The sweetest group moment" value={ai?.sweetMoment} loading={aiLoading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="funny" prog={7} total={TOTAL}>
      <T>The Funny One</T>
      <Big>{aiLoading?"...":(ai?.funniestPerson||s.names[0])}</Big>
      <AICard label="Why they're funny" value={ai?.funniestReason} loading={aiLoading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="funny" prog={8} total={TOTAL}>
      <T>Group spirit emoji</T>
      <div style={{fontSize:90,textAlign:"center",margin:"16px 0",lineHeight:1}}>{s.spiritEmoji[0]}</div>
      <Sub>This one emoji basically summarises the entire group energy.</Sub>
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="funny" prog={9} total={TOTAL}>
      <T>Top 10 most used words</T>
      <Words words={s.topWords} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="stats" prog={10} total={TOTAL}>
      <T>The Novelist</T>
      <Big>{s.novelist}</Big>
      <Sub>Longest average message. Nobody asked for an essay.</Sub>
      <Quip>"{s.novelist} had things to say. Many things."</Quip>
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="stats" prog={11} total={TOTAL}>
      <T>Group roles</T>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginTop:16,width:"100%",maxWidth:300}}>
        <Cell label="Photographer" value={s.photographer} />
        <Cell label="Link dumper" value={s.linkDumper} />
        <Cell label="Night owl" value={s.nightOwl} />
        <Cell label="Early bird" value={s.earlyBird} />
      </div>
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="ai" prog={12} total={TOTAL}>
      <T>What you actually talk about</T>
      <AICard label="Biggest topic" value={ai?.biggestTopic} loading={aiLoading} />
      <AICard label="The inside joke" value={ai?.insideJoke} loading={aiLoading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="ai" prog={13} total={TOTAL}>
      <T>The Drama Report</T>
      <Big>{aiLoading?"...":(ai?.dramaStarter||s.names[0])}</Big>
      <AICard label="How they do it" value={ai?.dramaContext} loading={aiLoading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="ai" prog={14} total={TOTAL}>
      <T>Most missed member</T>
      <Big>{aiLoading?"...":(ai?.mostMissed||s.names[0])}</Big>
      <Sub>When they go quiet, the group feels it.</Sub>
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="ai" prog={15} total={TOTAL}>
      <T>The group read</T>
      <AICard label="Group dynamic" value={ai?.groupDynamic} loading={aiLoading} />
      <AICard label="Most tense moment" value={ai?.tensionMoment} loading={aiLoading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="ai" prog={16} total={TOTAL}>
      <T>Group vibe</T>
      <div style={{background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:14,padding:"1.4rem 1.5rem",maxWidth:300,textAlign:"center",marginTop:16,fontSize:16,lineHeight:1.7,fontStyle:"italic",color:"#fff",minHeight:80,display:"flex",alignItems:"center",justifyContent:"center"}}>
        {aiLoading?<Dots />:(ai?.vibeOneLiner||"Chaotic. Wholesome. Somehow still going.")}
      </div>
      <Sub mt={14}>Powered by AI — your messages never left your device.</Sub>
      <Nav back={back} next={next} nextLabel="See summary" />
    </Shell>,
  ];
  return screens[step]??null;
}

// ─────────────────────────────────────────────────────────────────
// FINALE
// ─────────────────────────────────────────────────────────────────
function Finale({ s, ai, aiLoading, restart, prog, total }) {
  const cells = s.isGroup
    ? [{label:"Main character",value:s.mainChar},{label:"The ghost",value:s.ghost},{label:"Funniest",value:aiLoading?"...":(ai?.funniestPerson||"—")},{label:"Drama",value:aiLoading?"...":(ai?.dramaStarter||"—")},{label:"Top word",value:`"${s.topWords[0]?.[0]}"`},{label:"Top month",value:s.topMonths[0]?.[0]}]
    : [{label:"Most texts",value:s.names[0]},{label:"Ghost award",value:s.ghostName},{label:"Funniest",value:aiLoading?"...":(ai?.funniestPerson||"—")},{label:"Top word",value:`"${s.topWords[0]?.[0]}"`},{label:"Spirit emojis",value:s.spiritEmoji.join(" ")},{label:"Best streak",value:`${s.streak} days`}];
  return (
    <Shell sec="finale" prog={prog} total={total}>
      <T s={24}>{s.isGroup?"Your group, unwrapped.":"Your chat, unwrapped."}</T>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginTop:16,width:"100%",maxWidth:300}}>
        {cells.map((c,i)=><Cell key={i} label={c.label} value={c.value} />)}
      </div>
      {!aiLoading&&ai?.vibeOneLiner&&(
        <div style={{background:"rgba(255,255,255,0.06)",borderRadius:12,padding:"12px 16px",maxWidth:300,width:"100%",marginTop:14,fontSize:13,fontStyle:"italic",color:"rgba(255,255,255,0.65)",textAlign:"center",lineHeight:1.5}}>"{ai.vibeOneLiner}"</div>
      )}
      <div style={{marginTop:24}}><Btn onClick={restart}>Start over</Btn></div>
    </Shell>
  );
}

// ─────────────────────────────────────────────────────────────────
// UPLOAD
// ─────────────────────────────────────────────────────────────────
function Upload({ onReady }) {
  const fileRef=useRef();
  const [err,setErr]=useState("");
  const [busy,setBusy]=useState(false);
  const hasKey = !!import.meta.env.VITE_ANTHROPIC_API_KEY;
  const handle=file=>{
    if(!file)return; setBusy(true); setErr("");
    const r=new FileReader();
    r.onload=e=>{
      const msgs=parseWhatsApp(e.target.result);
      if(msgs.length<5){setErr("Couldn't read this file. Make sure it's a WhatsApp .txt export.");setBusy(false);return;}
      onReady(msgs);
    };
    r.readAsText(file);
  };
  return (
    <Shell sec="upload" prog={0} total={1}>
      <div style={{fontSize:38,fontWeight:800,color:"#fff",letterSpacing:-1.5,marginBottom:4}}>WrapChat</div>
      <div style={{fontSize:14,color:"rgba(255,255,255,0.38)",marginBottom:30}}>Your chats, unwrapped.</div>
      <div onClick={()=>fileRef.current?.click()} onDrop={e=>{e.preventDefault();handle(e.dataTransfer.files[0]);}} onDragOver={e=>e.preventDefault()}
        style={{border:"1.5px dashed rgba(255,255,255,0.18)",borderRadius:14,padding:"2.2rem 2rem",textAlign:"center",cursor:"pointer",maxWidth:320,width:"100%",transition:"background 0.2s"}}
        onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.05)"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
        <div style={{fontSize:14,fontWeight:700,color:"#fff"}}>{busy?"Reading your chat...":"Upload your WhatsApp export"}</div>
        <div style={{fontSize:12,color:"rgba(255,255,255,0.32)",marginTop:10,lineHeight:1.8}}>
          WhatsApp → open a chat → menu → More<br/>→ Export Chat → Without Media<br/>Drop or tap to upload the .txt file
        </div>
        <input ref={fileRef} type="file" accept=".txt" style={{display:"none"}} onChange={e=>handle(e.target.files[0])} />
      </div>
      {err&&<div style={{fontSize:13,color:"#FFB090",marginTop:12,textAlign:"center"}}>{err}</div>}
      {!hasKey&&<div style={{fontSize:13,color:"#FFB090",marginTop:12,textAlign:"center",background:"rgba(255,100,50,0.15)",padding:"10px 14px",borderRadius:10,maxWidth:300,lineHeight:1.6}}>No API key found. Create a <strong style={{color:"#fff"}}>.env</strong> file with <strong style={{color:"#fff"}}>VITE_ANTHROPIC_API_KEY=sk-ant-...</strong> then restart the dev server.</div>}
      <div style={{fontSize:11,color:"rgba(255,255,255,0.22)",marginTop:12,textAlign:"center"}}>Group or duo detected automatically. Nothing leaves your device.</div>
    </Shell>
  );
}

// ─────────────────────────────────────────────────────────────────
// LOADING
// ─────────────────────────────────────────────────────────────────
function Loading({ math }) {
  const [tick,setTick]=useState(0);
  const steps=["Reading your messages...","Finding the patterns...","Figuring out who's funny...","Detecting the drama...","Reading between the lines...","Almost done..."];
  useEffect(()=>{const t=setInterval(()=>setTick(x=>Math.min(x+1,steps.length-1)),1800);return()=>clearInterval(t);},[]);
  return (
    <Shell sec="upload" prog={tick+1} total={steps.length}>
      <div style={{fontSize:38,fontWeight:800,color:"#fff",letterSpacing:-1.5,marginBottom:4}}>WrapChat</div>
      <div style={{fontSize:14,color:"rgba(255,255,255,0.38)",marginBottom:30}}>AI is analysing {math.totalMessages.toLocaleString()} messages...</div>
      <div style={{background:"rgba(255,255,255,0.07)",borderRadius:14,padding:"1.5rem 2rem",maxWidth:300,textAlign:"center"}}>
        <div style={{fontSize:15,color:"#fff",lineHeight:1.6,minHeight:48}}>{steps[tick]}</div>
        <div style={{display:"flex",gap:6,justifyContent:"center",marginTop:16}}>
          {[0,1,2].map(i=><div key={i} style={{width:8,height:8,borderRadius:"50%",background:"rgba(255,255,255,0.4)",animation:`blink 1.2s ${i*0.2}s infinite`}} />)}
        </div>
      </div>
      <div style={{fontSize:12,color:"rgba(255,255,255,0.28)",marginTop:20,textAlign:"center",lineHeight:1.7}}>
        Sending a smart sample to Claude for deep analysis.<br/>Your raw messages never leave your device.
      </div>
      <style>{`@keyframes blink{0%,80%,100%{opacity:.12}40%{opacity:1}}`}</style>
    </Shell>
  );
}

// ─────────────────────────────────────────────────────────────────
// SLIDE
// ─────────────────────────────────────────────────────────────────
function Slide({ children, dir, id }) {
  return (
    <div key={id} style={{animation:`${dir==="fwd"?"slideR":"slideL"} 0.38s cubic-bezier(.77,0,.18,1) both`}}>
      {children}
      <style>{`@keyframes slideR{from{transform:translateX(110%);opacity:0}to{transform:translateX(0);opacity:1}}@keyframes slideL{from{transform:translateX(-110%);opacity:0}to{transform:translateX(0);opacity:1}}`}</style>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// APP
// ─────────────────────────────────────────────────────────────────
export default function App() {
  const [phase,     setPhase]     = useState("upload");
  const [math,      setMath]      = useState(null);
  const [ai,        setAi]        = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [step,      setStep]      = useState(0);
  const [dir,       setDir]       = useState("fwd");
  const [sid,       setSid]       = useState(0);

  const go      = d => { setDir(d); setSid(s=>s+1); setStep(s=>d==="fwd"?s+1:s-1); };
  const back    = () => go("bk");
  const next    = () => go("fwd");
  const restart = () => { setPhase("upload"); setMath(null); setAi(null); setAiLoading(false); setStep(0); setDir("fwd"); setSid(s=>s+1); };

  const onReady = async (messages) => {
    const m = localStats(messages);
    setMath(m);
    setPhase("loading");
    setAiLoading(true);
    try {
      const result = await aiAnalysis(messages, m);
      setAi(result);
    } catch { setAi({}); }
    setAiLoading(false);
    setPhase("results");
    setStep(0);
    setSid(s=>s+1);
  };

  if (phase==="upload")  return <Slide dir="fwd" id={sid}><Upload onReady={onReady} /></Slide>;
  if (phase==="loading") return <Loading math={math} />;

  const contentCount = math.isGroup ? 16 : 17;
  const total        = contentCount + 1;

  let screen;
  if (step < contentCount) {
    screen = math.isGroup
      ? <GroupScreen s={math} ai={ai} aiLoading={aiLoading} step={step} back={back} next={next} />
      : <DuoScreen   s={math} ai={ai} aiLoading={aiLoading} step={step} back={back} next={next} />;
  } else {
    screen = <Finale s={math} ai={ai} aiLoading={aiLoading} restart={restart} prog={total} total={total} />;
  }

  return <div style={{maxWidth:480,margin:"0 auto"}}><Slide dir={dir} id={sid}>{screen}</Slide></div>;
}
