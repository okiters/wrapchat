import { useState, useEffect, useLayoutEffect, useRef, createContext, useContext } from "react";
import { supabase } from "./supabase";

// Provided by App during the results phase; Shell reads it to show the close button.
// null means "no close button" (upload, auth, loading, etc.)
const CloseResultsContext = createContext(null);

// Provided by Slide; Shell reads it to animate only its content area.
const SlideContext = createContext({ dir: "fwd", id: 0 });

// ─────────────────────────────────────────────────────────────────
// PARSER
// ─────────────────────────────────────────────────────────────────

// System messages to always skip (applied to both body and sender name)
const SYSTEM_RE = /end-to-end encrypted|end-to-end şifreli|is a contact|bir kişidir|added|removed|left|created group|changed the|security code|<attached:|Messages and calls|Mesajlar ve aramalar/i;

// iOS bracket format:     [DD.MM.YY, HH:MM:SS] Name: body
// Android no-bracket fmt: DD/MM/YYYY, HH:MM - Name: body
// Both formats support optional AM/PM for 12-hour locales
const HEADER_IOS     = /^\[(\d{1,2}[./]\d{1,2}[./]\d{2,4}),\s(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[APap][Mm])?)\]\s(.+?):\s/;
const HEADER_ANDROID = /^(\d{1,2}[./]\d{1,2}[./]\d{2,4}),\s(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[APap][Mm])?)\s-\s(.+?):\s/;

// Minimum real messages required to produce a meaningful wrap
const MIN_MESSAGES = 50;

function detectFormat(lines) {
  for (const line of lines) {
    if (HEADER_IOS.test(line))     return "ios";
    if (HEADER_ANDROID.test(line)) return "android";
  }
  return null;
}

function parseTimestamp(dateStr, timeStr) {
  // Date — always day-first (DD.MM.YY / DD/MM/YYYY) matching WhatsApp's global default
  const parts = dateStr.split(/[./]/).map(Number);
  const day   = parts[0];
  const month = parts[1];
  const year  = parts[2] < 100 ? 2000 + parts[2] : parts[2];
  const date  = new Date(year, month - 1, day);

  // Time — supports HH:MM, HH:MM:SS, and 12-hour AM/PM variants
  const tp = timeStr.match(/(\d+):(\d+)(?::(\d+))?\s*([APap][Mm])?/);
  if (tp) {
    let h      = parseInt(tp[1]);
    const min  = parseInt(tp[2]);
    const sec  = parseInt(tp[3] || 0);
    const ampm = tp[4]?.toLowerCase();
    if (ampm === "pm" && h < 12) h += 12;
    if (ampm === "am" && h === 12) h = 0;
    date.setHours(h, min, sec);
  }
  return isNaN(date.getTime()) ? null : date;
}

function normalizeBody(body) {
  if (/audio omitted|voice omitted|\.(opus|aac|m4a)/i.test(body)) return "<Voice omitted>";
  if (/^<attached:.*>$/.test(body) || /\.(jpg|jpeg|png|mp4|pdf|webp)/i.test(body)) return "<Media omitted>";
  return body;
}

// Returns { messages, formatDetected, tooShort }
function parseWhatsApp(text) {
  // Strip invisible Unicode chars WhatsApp injects (LRM, ZWNBSP, directional marks etc.)
  const clean    = text.replace(/[\u200e\u200f\u202a-\u202e\ufeff\u2066-\u2069]/g, "");
  const rawLines = clean.split("\n");

  const format = detectFormat(rawLines);
  if (!format) return { messages: [], formatDetected: false, tooShort: false };

  const HEADER = format === "ios" ? HEADER_IOS : HEADER_ANDROID;

  // ── Step 1: join continuation lines ──
  // A line that does not start with a timestamp header is a continuation of the previous message
  const joined = [];
  for (const line of rawLines) {
    if (HEADER.test(line)) {
      joined.push(line);
    } else if (joined.length > 0 && line.trim().length > 0) {
      joined[joined.length - 1] += " " + line.trim();
    }
  }

  // ── Step 2: parse each joined line ──
  const messages = [];
  for (const line of joined) {
    const m = line.match(HEADER);
    if (!m) continue;

    const dateStr = m[1];
    const timeStr = m[2];
    const name    = m[3].trim();
    const body    = line.slice(m[0].length).trim();

    if (!body || SYSTEM_RE.test(body) || SYSTEM_RE.test(name)) continue;

    const date = parseTimestamp(dateStr, timeStr);
    if (!date) continue;

    messages.push({
      name,
      body:  normalizeBody(body),
      date,
      hour:  date.getHours(),
      month: date.getMonth(),
      year:  date.getFullYear(),
    });
  }

  return { messages, formatDetected: true, tooShort: messages.length < MIN_MESSAGES };
}

// ─────────────────────────────────────────────────────────────────
// LARGE-GROUP CAP
// ─────────────────────────────────────────────────────────────────
const GROUP_PARTICIPANT_THRESHOLD = 20; // above this, cap is applied
const GROUP_PARTICIPANT_CAP       = 10; // keep this many top senders

function capLargeGroup(messages) {
  const countByName = {};
  messages.forEach(m => { countByName[m.name] = (countByName[m.name] || 0) + 1; });
  const allNames = Object.keys(countByName);
  if (allNames.length <= GROUP_PARTICIPANT_THRESHOLD) {
    return { messages, cappedGroup: false, originalParticipantCount: allNames.length };
  }
  const topNames = new Set(
    Object.entries(countByName)
      .sort((a, b) => b[1] - a[1])
      .slice(0, GROUP_PARTICIPANT_CAP)
      .map(([n]) => n)
  );
  return {
    messages: messages.filter(m => topNames.has(m.name)),
    cappedGroup: true,
    originalParticipantCount: allNames.length,
  };
}
// ─────────────────────────────────────────────────────────────────
// LOCAL MATH
// ─────────────────────────────────────────────────────────────────
const STOP = new Set([
  // English
  ...("the a an and or but in on at to for of is it was he she they i you we my your our this that with be are have has had not so do did all can will just if up out about me him her them what how when where who which as from by more than then there their also too very really yeah yes no ok okay hey hi haha lol omg im its dont cant wont ive youre theyre get got go going like know think said one some any been would could should even still now here see come want say make time back other into over after well way need because much only just gonna gotta kinda wanna ill aint tho though cause cuz tbh ngl fr rn").split(" "),
  // Turkish pronouns, conjunctions, prepositions, common filler
  ...("ben benim bana beni bende benden sen senin sana seni sende senden biz bizim bize bizi bizde bizden siz sizin size sizi sizde sizden onlar onların onlara onları ve ya bir bu şu ile için de ki ama ancak fakat lakin çünkü eğer ise bile hem ne mi nasıl neden niçin nerede nereye nereden kim kimin kime kimi veya var yok daha çok az iyi kötü gibi kadar sadece artık hep hiç pek tam işte evet hayır tamam tabi tabii olur oldu olmuş oluyor olabilir olacak olsa abi abla şey yani aslında sanki galiba belki herhalde neyse peki ha he oha lan yani dee haa ama da da de ise olsa bile çünkü zaten hani dur bak gel git bak şimdi yok var mı değil misin misiniz miyim miyiz mısın mısınız oldu tamam oke okay peki bence sence herşey her şey falan filan madem keşke nasılsın iyiyim ne yapıyorsun ne var ne yok görüşürüz kolay gelsin sağol teşekkürler rica ederim").split(" ")
]);

// WhatsApp UI words that appear in exports — never count these
const WA_NOISE = new Set("edited audio video sticker gif omitted attached photo document contact location poll missed call voice message deleted this message was deleted null undefined".split(" "));

const ROMANCE_RE = /\b(love you|luv you|miss you|my love|baby|babe|bb|darling|good night love|good morning love|kiss you|date night|come over|sleep well|xoxo|sevgilim|askim|aşkım|canim|canım|ozledim|özledim|tatlim|tatlım|bebegim|bebeğim)\b/i;
const FRIEND_RE = /\b(bestie|bro|broski|dude|girl|sis|mate|homie|kanka|knk|abi|abla)\b/i;
const WORK_RE = /\b(meeting|deadline|project|client|invoice|brief|office|shift|deck|review this|sunum|mesai|müşteri|musteri|patron|toplantı|toplanti)\b/i;
const DATE_RE = /\b(date|dinner tonight|movie night|see you tonight|come over|valentine|anniversary)\b/i;
const FLIRTY_EMOJI_RE = /(❤️|❤|💕|💖|💗|💘|😍|🥰|😘|💋)/;

const CONTROL_RE = /\b(where are you|who are you with|why are you online|why were you online|why didn't you reply|why dont you reply|why didn't you answer|why didnt you answer|answer me|pick up|call me now|send me your location|share your location|send your location|reply now|reply to me|neredesin|nerde kaldın|kimlesin|kimleydin|neden cevap vermedin|niye cevap vermedin|cevap ver|cvp ver|aç telefonu|telefonu aç|konum at|konumunu at|konum paylaş|konumunu paylaş)\b/i;
const AGGRO_RE = /\b(stupid|idiot|shut up|hate you|leave me alone|you're crazy|you are crazy|disgusting|pathetic|annoying|i'm sick of this|i am sick of this|salak|gerizekal[ıi]|aptal|mal|siktir|siktir git|defol|yeter|bıktım|biktim|nefret ediyorum|manyak|saçma|sacma)\b/i;
const BREAKUP_RE = /\b(it'?s over|we'?re done|i'?m done|im done|done with you|break up|breakup|goodbye forever|don't text me|dont text me|blocked you|bitti|bitsin|ayrıl|ayrilelim|ayrılalım|beni arama|yazma bana|engelledim|sildim seni)\b/i;
const APOLOGY_RE = /\b(sorry|i'm sorry|i am sorry|my fault|forgive me|özür dilerim|ozur dilerim|affet|hata bendeydi|haklısın|haklisin)\b/i;
const LAUGH_RE   = /\b(ha(ha)+|lol+|lmao+|lmfao+|hehe+|im dead|i'm dead|dying|dead)\b|😂|💀|🤣/i;

const DUO_CONTENT_SCREENS = 20;
const GROUP_CONTENT_SCREENS = 19;
const LOADING_STEPS = ["Reading your messages...","Finding the patterns...","Figuring out who's funny...","Detecting the drama...","Reading between the lines...","Almost done..."];
const MODE_META = {
  casual: {
    label: "Casual Analysis",
    short: "Casual",
    blurb: "Funny, sweet, and stats-heavy chat wrap.",
  },
  redflags: {
    label: "Red Flags Spotter",
    short: "Red Flags",
    blurb: "Relationship status, toxicity, and warning signs.",
  },
};
const DUO_CASUAL_SCREENS = 17;
const DUO_REDFLAG_SCREENS = 7;
const GROUP_CASUAL_SCREENS = 17;
const GROUP_REDFLAG_SCREENS = 6;

function isPassiveAggressive(body) {
  const trimmed = body.trim().toLowerCase();
  return trimmed.length <= 20 && /^(fine|whatever|ok then|okay then|sure|k|kk|nvm|never mind|forget it|sen bilirsin|tamam ya|boşver|bosver|neyse|aynen|bravo|peki)$/.test(trimmed);
}

function capsBurst(body) {
  const upper = body.replace(/[^A-ZÇĞİÖŞÜ]/g, "");
  return upper.length >= 5 && /[!?]{2,}/.test(body);
}

function normalizeRedFlags(flags) {
  if (!Array.isArray(flags)) return [];
  return flags.map((flag, i) => {
    if (typeof flag === "string") {
      return { title: `Red flag ${i + 1}`, detail: flag };
    }
    if (flag && typeof flag === "object") {
      const title = String(flag.title || flag.label || flag.flag || `Red flag ${i + 1}`).trim();
      const detail = String(flag.detail || flag.reason || flag.description || "").trim();
      const evidence = String(flag.evidence || flag.example || "").trim();
      if (!title && !detail) return null;
      return { title: title || `Red flag ${i + 1}`, detail, evidence };
    }
    return null;
  }).filter(Boolean).slice(0, 3);
}

function normalizeTimeline(items) {
  if (!Array.isArray(items)) return [];
  return items.map((item, i) => {
    if (typeof item === "string") {
      return { date: `Point ${i + 1}`, title: item, detail: "" };
    }
    if (!item || typeof item !== "object") return null;
    return {
      date: String(item.date || item.when || `Point ${i + 1}`).trim(),
      title: String(item.title || item.label || item.observation || `Point ${i + 1}`).trim(),
      detail: String(item.detail || item.description || item.quote || "").trim(),
    };
  }).filter(Boolean).slice(0, 5);
}

function formatEvidenceDate(date) {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function cleanQuote(body, max = 72) {
  const text = String(body || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max - 1).trim()}…` : text;
}

function formatGap(gapMin) {
  if (gapMin < 60) return `${Math.round(gapMin)}m`;
  const hours = Math.floor(gapMin / 60);
  const mins = Math.round(gapMin % 60);
  return mins ? `${hours}h ${mins}m` : `${hours}h`;
}

function spotDynamics({ messages, namesAll, namesSorted, msgCounts, starterCount, isGroup }) {
  const tracked = new Set(namesAll);
  const stats = {};
  namesAll.forEach(name => {
    stats[name] = {
      control: 0,
      aggression: 0,
      breakup: 0,
      passive: 0,
      apology: 0,
      doubleText: 0,
      delayedReplies: 0,
      caps: 0,
    };
  });

  const evidence = {
    control: [],
    aggression: [],
    breakup: [],
    passive: [],
    apology: [],
    delayed: [],
    doubleText: [],
    romance: [],
    friendship: [],
    work: [],
  };

  const recordEvidence = (kind, item) => {
    if (!evidence[kind]) evidence[kind] = [];
    const key = `${item.ts}-${item.title}-${item.detail}`;
    if (evidence[kind].some(existing => existing.key === key)) return;
    evidence[kind].push({ ...item, key });
  };

  const messageEvidence = (message, title, detail, weight = 1) => ({
    ts: +message.date,
    date: formatEvidenceDate(message.date),
    title,
    detail,
    quote: cleanQuote(message.body),
    weight,
  });

  let romance = 0;
  let friendship = 0;
  let work = 0;

  for (const message of messages) {
    if (!tracked.has(message.name)) continue;
    const body = message.body.trim();
    const sender = stats[message.name];
    if (CONTROL_RE.test(body)) {
      sender.control++;
      recordEvidence("control", messageEvidence(message, `${message.name} pushed for an immediate reply or update.`, `"${cleanQuote(body)}"`, 5));
    }
    if (AGGRO_RE.test(body) || capsBurst(body)) {
      sender.aggression++;
      if (capsBurst(body)) sender.caps++;
      recordEvidence("aggression", messageEvidence(message, `${message.name} used escalated or hostile wording.`, `"${cleanQuote(body)}"`, 5));
    }
    if (BREAKUP_RE.test(body)) {
      sender.breakup++;
      recordEvidence("breakup", messageEvidence(message, `${message.name} used exit or breakup wording.`, `"${cleanQuote(body)}"`, 6));
    }
    if (APOLOGY_RE.test(body)) {
      sender.apology++;
      recordEvidence("apology", messageEvidence(message, `${message.name} apologized after tension.`, `"${cleanQuote(body)}"`, 2));
    }
    if (isPassiveAggressive(body)) {
      sender.passive++;
      recordEvidence("passive", messageEvidence(message, `${message.name} replied with a clipped shutdown message.`, `"${cleanQuote(body)}"`, 3));
    }

    if (!isGroup) {
      if (ROMANCE_RE.test(body) || DATE_RE.test(body) || FLIRTY_EMOJI_RE.test(body)) {
        romance++;
        recordEvidence("romance", messageEvidence(message, `${message.name} used romantic language or couple-coded affection.`, `"${cleanQuote(body)}"`, 2));
      }
      if (FRIEND_RE.test(body)) {
        friendship++;
        recordEvidence("friendship", messageEvidence(message, `${message.name} used clearly platonic language.`, `"${cleanQuote(body)}"`, 1));
      }
      if (WORK_RE.test(body)) {
        work++;
        recordEvidence("work", messageEvidence(message, `${message.name} brought the chat back to work or logistics.`, `"${cleanQuote(body)}"`, 1));
      }
    }
  }

  for (let i = 1; i < messages.length; i++) {
    const prev = messages[i - 1];
    const curr = messages[i];
    if (!tracked.has(prev.name) || !tracked.has(curr.name)) continue;
    const gapMin = (curr.date - prev.date) / 60000;

    if (curr.name === prev.name && gapMin < 180) {
      stats[curr.name].doubleText++;
      recordEvidence("doubleText", {
        ts: +curr.date,
        date: formatEvidenceDate(curr.date),
        title: `${curr.name} sent another message before getting a reply.`,
        detail: `"${cleanQuote(curr.body)}"`,
        weight: 2,
      });
      continue;
    }

    if (curr.name !== prev.name && gapMin > (isGroup ? 360 : 240)) {
      stats[curr.name].delayedReplies++;
      recordEvidence("delayed", {
        ts: +curr.date,
        date: formatEvidenceDate(curr.date),
        title: `${curr.name} replied after a long gap.`,
        detail: `${formatGap(gapMin)} after ${prev.name}'s message: "${cleanQuote(prev.body, 54)}"`,
        weight: 3,
      });
    }
  }

  const totals = Object.values(stats).reduce((acc, item) => {
    Object.entries(item).forEach(([key, value]) => {
      acc[key] = (acc[key] || 0) + value;
    });
    return acc;
  }, {});

  const topBy = key => [...namesAll].sort((a, b) => (stats[b]?.[key] || 0) - (stats[a]?.[key] || 0))[0] || namesSorted[0];
  const totalMessages = msgCounts.reduce((sum, count) => sum + count, 0) || 1;
  const leadShare = msgCounts[0] / totalMessages;
  const leadStarter = Object.entries(starterCount || {}).sort((a, b) => b[1] - a[1])[0]?.[0] || namesSorted[0];
  const firstEvidence = kind => (evidence[kind] || []).sort((a, b) => b.weight - a.weight || b.ts - a.ts)[0];

  const flagPool = [];
  const pushFlag = (score, title, detail, sample) => {
    flagPool.push({
      score,
      title,
      detail,
      evidence: sample ? `${sample.date} • ${sample.detail}` : "",
    });
  };

  if (totals.control >= (isGroup ? 2 : 1)) {
    const name = topBy("control");
    pushFlag(
      totals.control * 4,
      "Reply pressure",
      `${name} used immediate-reply or location-check language ${totals.control} time${totals.control === 1 ? "" : "s"} in the sampled chat.`,
      firstEvidence("control")
    );
  }

  if (totals.aggression + totals.caps >= (isGroup ? 2 : 1)) {
    const name = topBy("aggression");
    pushFlag(
      (totals.aggression + totals.caps) * 4,
      "Escalated wording",
      `${name} is responsible for most of the hostile wording or all-caps escalation moments in the sample.`,
      firstEvidence("aggression")
    );
  }

  if (totals.breakup >= 1) {
    pushFlag(
      totals.breakup * 5,
      isGroup ? "Exit threats" : "Breakup language",
      isGroup
        ? `The group includes explicit “I’m done” or leave-the-chat style wording instead of simple cooling-off messages.`
        : `The chat includes explicit “we’re done” or end-of-relationship wording, which points to instability rather than a one-off disagreement.`,
      firstEvidence("breakup")
    );
  }

  if (!isGroup && totals.apology >= 3 && totals.control + totals.aggression + totals.breakup + totals.passive >= 2) {
    pushFlag(
      totals.apology * 2 + totals.aggression * 2,
      "Conflict-reset cycle",
      `There are repeated apologies after tense moments, which suggests the conflict pattern returns instead of fully resolving.`,
      firstEvidence("apology")
    );
  }

  if (!isGroup) {
    const chaser = topBy("doubleText");
    if ((stats[chaser]?.doubleText || 0) >= 5 || leadShare >= 0.64) {
      pushFlag(
        (stats[chaser]?.doubleText || 0) + leadShare * 5,
        "Uneven pursuit",
        `${chaser} does substantially more follow-up messaging, so the effort balance in the conversation looks uneven.`,
        firstEvidence("doubleText")
      );
    }

    const ghoster = topBy("delayedReplies");
    if ((stats[ghoster]?.delayedReplies || 0) >= 3) {
      pushFlag(
        (stats[ghoster]?.delayedReplies || 0) * 2,
        "Long reply gaps",
        `${ghoster} is the person most associated with multi-hour reply gaps after emotionally charged messages.`,
        firstEvidence("delayed")
      );
    }

    if (romance >= 6 && totals.control + totals.aggression + totals.breakup >= 2) {
      pushFlag(
        romance + totals.control + totals.aggression + totals.breakup,
        "Affection mixed with conflict",
        `The chat shows clear romantic cues, but those sit alongside pressure, escalation, or breakup language often enough to matter.`,
        firstEvidence("romance") || firstEvidence("breakup")
      );
    }
  } else {
    const loudest = namesSorted[0];
    if (leadShare >= 0.46) {
      pushFlag(
        leadShare * 10,
        "Dominant voice",
        `${loudest} sends such a large share of the messages that the group’s tone is heavily shaped by one person.`,
        firstEvidence("doubleText") || firstEvidence("aggression")
      );
    }

    if ((starterCount?.[leadStarter] || 0) >= 5) {
      pushFlag(
        (starterCount?.[leadStarter] || 0) * 0.8,
        "Single-person reactivation",
        `${leadStarter} is repeatedly the one restarting the chat, which suggests the group depends on one engine to stay active.`
      );
    }
  }

  if (flagPool.length < 3 && totals.passive >= 2) {
    pushFlag(
      totals.passive * 2,
      "Shutdown replies",
      `The chat contains multiple clipped replies like “fine” or “whatever,” which usually close the conversation without resolving the issue.`,
      firstEvidence("passive")
    );
  }

  if (flagPool.length < 3) {
    pushFlag(
      leadShare * 4,
      isGroup ? "Participation imbalance" : "Message imbalance",
      isGroup
        ? `A small number of people carry most of the momentum, so quieter members can disappear from the actual dynamic.`
        : `${namesSorted[0]} sends a much larger share of the messages, which is a factual imbalance in effort even before tone is considered.`
    );
  }

  if (flagPool.length < 3) {
    pushFlag(
      1,
      isGroup ? "Unstable group tone" : "Mixed signals",
      isGroup
        ? `The tone shifts fast across the sample, which makes the group dynamic feel inconsistent even when no single fight dominates.`
        : `The tone and pacing change enough across the sample that the relationship looks unclear from the chat alone.`
    );
  }

  const redFlags = flagPool
    .sort((a, b) => b.score - a.score)
    .filter((flag, index, arr) => arr.findIndex(other => other.title === flag.title) === index)
    .slice(0, 3)
    .map(({ title, detail, evidence: sample }) => ({ title, detail, evidence: sample }));

  const toxicityScores = {};
  namesAll.forEach(name => {
    const item = stats[name];
    toxicityScores[name] =
      item.control * 4 +
      item.aggression * 5 +
      item.breakup * 4 +
      item.passive * 2 +
      item.caps * 2 +
      item.delayedReplies * 1.5 +
      Math.max(item.doubleText - 2, 0) * 0.4;
  });

  const toxicRank = [...namesAll].sort((a, b) => toxicityScores[b] - toxicityScores[a]);
  const topToxic = toxicRank[0] || namesSorted[0];
  const runnerUp = toxicRank[1] || topToxic;
  const toxicPerson = toxicityScores[topToxic] - toxicityScores[runnerUp] < 2 ? "Tie" : topToxic;

  let toxicReason = isGroup
    ? "The highest-risk behaviours are spread across the group rather than clearly owned by one person."
    : "The risk signals are fairly shared, so the chat does not point to one clearly more toxic person.";

  if (toxicPerson !== "Tie") {
    const winner = stats[toxicPerson];
    const drivers = [];
    if (winner.control) drivers.push(`${winner.control} control/reply-pressure message${winner.control === 1 ? "" : "s"}`);
    if (winner.aggression || winner.caps) drivers.push(`${winner.aggression + winner.caps} escalated wording moment${winner.aggression + winner.caps === 1 ? "" : "s"}`);
    if (winner.breakup) drivers.push(`${winner.breakup} breakup/exit threat${winner.breakup === 1 ? "" : "s"}`);
    if (winner.passive) drivers.push(`${winner.passive} shutdown ${winner.passive === 1 ? "reply" : "replies"}`);
    if (winner.delayedReplies) drivers.push(`${winner.delayedReplies} long reply gap${winner.delayedReplies === 1 ? "" : "s"}`);
    toxicReason = `${toxicPerson} has the highest toxicity score because the sampled chat shows ${drivers.slice(0, 3).join(", ")} from them.`;
  }

  let relationshipStatus = null;
  let relationshipStatusWhy = null;
  let statusEvidence = null;

  if (!isGroup) {
    const conflict = totals.control + totals.aggression + totals.breakup + totals.passive;
    const romanceExample = firstEvidence("romance");
    const friendExample = firstEvidence("friendship");
    const workExample = firstEvidence("work");

    if (work >= Math.max(romance, friendship) + 3) {
      relationshipStatus = "Coworkers who overshare";
      relationshipStatusWhy = `The sample contains noticeably more work/logistics cues (${work}) than romantic ones (${romance}).`;
      statusEvidence = workExample ? `${workExample.date} • ${workExample.detail}` : "";
    } else if (romance >= 8 && conflict >= 4) {
      relationshipStatus = "On-and-off romance";
      relationshipStatusWhy = `There are strong romantic cues (${romance}) alongside repeated conflict markers (${conflict}), which points to attachment with instability.`;
      statusEvidence = romanceExample ? `${romanceExample.date} • ${romanceExample.detail}` : "";
    } else if (romance >= 8) {
      relationshipStatus = "Probably dating";
      relationshipStatusWhy = `The chat shows repeated romantic language (${romance} cues) and very little purely work-style or platonic framing.`;
      statusEvidence = romanceExample ? `${romanceExample.date} • ${romanceExample.detail}` : "";
    } else if (romance >= 4 && friendship >= 2) {
      relationshipStatus = "Situationship territory";
      relationshipStatusWhy = `The sample mixes romantic cues (${romance}) with platonic framing (${friendship}), so the connection looks emotionally close but not fully defined.`;
      statusEvidence = romanceExample ? `${romanceExample.date} • ${romanceExample.detail}` : "";
    } else if (friendship >= romance + 2) {
      relationshipStatus = "Close friends";
      relationshipStatusWhy = `The chat leans more on comfort and platonic language (${friendship} cues) than overt romantic signals (${romance}).`;
      statusEvidence = friendExample ? `${friendExample.date} • ${friendExample.detail}` : "";
    } else {
      relationshipStatus = "Complicated, but not official";
      relationshipStatusWhy = "The sample shows emotional closeness, but the wording is too mixed to point cleanly to friendship, dating, or a purely practical relationship.";
      statusEvidence = romanceExample?.detail || friendExample?.detail || workExample?.detail || "";
    }
  }

  const evidenceTimeline = Object.values(evidence)
    .flat()
    .sort((a, b) => b.weight - a.weight || b.ts - a.ts)
    .slice(0, 5)
    .map(item => ({ date: item.date, title: item.title, detail: item.detail }));

  const maxToxicity = Math.max(...Object.values(toxicityScores), 0);
  const toxicityLevel = maxToxicity >= 18 ? "High" : maxToxicity >= 9 ? "Moderate" : "Low";
  const toxicityBreakdown = toxicRank.slice(0, Math.min(isGroup ? 4 : 2, toxicRank.length)).map(name => {
    const item = stats[name];
    const reasons = [];
    if (item.control) reasons.push(`${item.control} control`);
    if (item.aggression || item.caps) reasons.push(`${item.aggression + item.caps} escalation`);
    if (item.breakup) reasons.push(`${item.breakup} exit threat`);
    if (item.passive) reasons.push(`${item.passive} shutdown`);
    if (item.delayedReplies) reasons.push(`${item.delayedReplies} long-gap reply`);
    return `${name}: ${Math.round(toxicityScores[name])} points${reasons.length ? ` • ${reasons.join(", ")}` : ""}`;
  });
  const toxicityReport =
    toxicityLevel === "High"
      ? `High toxicity signal. The chat contains repeated pressure, escalation, or exit-style language that goes beyond one isolated argument.`
      : toxicityLevel === "Moderate"
        ? `Moderate toxicity signal. There are repeated patterns worth paying attention to, even if the sample is not hostile all the time.`
        : `Low toxicity signal. The sample has some tension markers, but they appear limited or inconsistent rather than dominant.`;

  return {
    relationshipStatus,
    relationshipStatusWhy,
    statusEvidence,
    toxicPerson,
    toxicReason,
    redFlags,
    toxicityScores,
    evidenceTimeline,
    toxicityLevel,
    toxicityReport,
    toxicityBreakdown,
  };
}

function localStats(messages) {
  if (!messages.length) return null;
  const rawNames = [...new Set(messages.map(m => m.name))];
  const byNameRaw = {};
  rawNames.forEach(n => (byNameRaw[n] = []));
  messages.forEach(m => byNameRaw[m.name]?.push(m));
  // Filter out group name — any "sender" with fewer than 3 messages is likely the group name or a system entry
  const namesAll = rawNames.filter(n => byNameRaw[n].length >= 3);
  const isGroup  = namesAll.length > 2;
  const byName   = {};
  namesAll.forEach(n => (byName[n] = byNameRaw[n]));
  const namesSorted = [...namesAll].sort((a,b) => byName[b].length - byName[a].length);

  const wordFreq = {};
  messages.forEach(({body}) => {
    if (/media omitted|image omitted|video omitted|voice omitted|audio omitted|<media|<attached/i.test(body) || body.startsWith("http")) return;
    body.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu,"").split(/\s+/).forEach(w => {
      if (w.length>2 && !STOP.has(w) && !WA_NOISE.has(w) && !/^\d+$/.test(w)) wordFreq[w]=(wordFreq[w]||0)+1;
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

  const mediaByName = {}, linkByName = {}, voiceByName = {};
  namesAll.forEach(n => {
    mediaByName[n] = byName[n].filter(m => /media omitted|image omitted|video omitted/i.test(m.body)).length;
    linkByName[n]  = byName[n].filter(m => m.body.includes("http")).length;
    voiceByName[n] = byName[n].filter(m => /voice omitted|audio omitted/i.test(m.body)).length;
  });

  const peakHourByName = {};
  namesAll.forEach(n => {
    const h = new Array(24).fill(0);  // fresh array per person
    byName[n].forEach(m => { if(m.hour>=0 && m.hour<24) h[m.hour]++; });
    const maxVal = Math.max(...h);
    peakHourByName[n] = maxVal > 0 ? h.indexOf(maxVal) : 12; // default noon if no data
  });
  const fmtHour = h => h===0?"12am":h<12?`${h}am`:h===12?"12pm":`${h-12}pm`;

  const avgLenByName = {}, maxLenByName = {};
  namesAll.forEach(n => {
    const msgs = byName[n].filter(m => !/media omitted|voice omitted|audio omitted/i.test(m.body) && !m.body.startsWith("http"));
    avgLenByName[n] = msgs.length ? Math.round(msgs.reduce((s,m)=>s+m.body.length,0)/msgs.length) : 0;
    maxLenByName[n] = msgs.length ? Math.max(...msgs.map(m=>m.body.length)) : 0;
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

  let ghostAvg=["?","?"], ghostName=namesSorted[0], ghostEqual=false;
  if(!isGroup && namesAll.length>=2){
    const rt={};namesAll.forEach(n=>(rt[n]=[]));
    for(let i=1;i<messages.length;i++){
      const prev=messages[i-1],curr=messages[i];
      if(curr.name!==prev.name && curr.name in rt){const d=(curr.date-prev.date)/60000;if(d>1&&d<1440)rt[curr.name].push(d);}
    }
    const rawAvgMin=n=>{const a=rt[n]||[];return a.length?a.reduce((s,t)=>s+t,0)/a.length:0;};
    const fmt=n=>{const a=rt[n]||[];if(!a.length)return"instant";const avg=a.reduce((s,t)=>s+t,0)/a.length;return avg<60?`${Math.round(avg)}m`:`${Math.round(avg/60)}h ${Math.round(avg%60)}m`;};
    const a0=fmt(namesSorted[0]),a1=fmt(namesSorted[1]||namesSorted[0]);
    ghostAvg=[a0,a1];
    const pm=s=>{const h=s.match(/(\d+)h/),mn=s.match(/(\d+)m/);return(h?+h[1]*60:0)+(mn?+mn[1]:0);};
    ghostName=pm(a0)>=pm(a1)?namesSorted[0]:namesSorted[1];
    const raw0=rawAvgMin(namesSorted[0]),raw1=rawAvgMin(namesSorted[1]);
    const maxRaw=Math.max(raw0,raw1);
    ghostEqual=maxRaw>0&&Math.abs(raw0-raw1)/maxRaw<0.20;
  }

  // ── Therapist detection ──
  // Who sends their longest replies in response to emotional or heavy messages?
  // Emotional triggers: messages with feeling words OR messages >120 chars
  const EMOTIONAL = /sad|miss|cry|tired|stressed|anxious|scared|worried|hurt|sorry|hard|difficult|broken|lost|alone|upset|angry|feel|pain|help|support|struggling/i;
  const therapistScore = {};
  namesAll.forEach(n => (therapistScore[n] = []));
  for (let i = 1; i < messages.length; i++) {
    const prev = messages[i-1], curr = messages[i];
    if (curr.name === prev.name) continue;
    if (!(curr.name in therapistScore)) continue;
    const prevIsEmotional = EMOTIONAL.test(prev.body) || prev.body.length > 120;
    if (prevIsEmotional && curr.body.length > 60 && !/media omitted|voice omitted|audio omitted|<attached/i.test(curr.body)) {
      therapistScore[curr.name].push(curr.body.length);
    }
  }
  // Score = avg length of emotional replies × number of them (weighted)
  const therapistRank = {};
  namesAll.forEach(n => {
    const arr = therapistScore[n];
    therapistRank[n] = arr.length > 0 ? (arr.reduce((s,v)=>s+v,0)/arr.length) * Math.log(arr.length+1) : 0;
  });
  const therapist = [...namesAll].sort((a,b) => therapistRank[b]-therapistRank[a])[0] || namesAll[0];
  const therapistCount = therapistScore[therapist]?.length || 0;

  const sigWordByName = {};
  namesAll.forEach(n=>{
    const wf={};
    byName[n].forEach(({body})=>{
      if(/media omitted|image omitted|video omitted|voice omitted|audio omitted|<media|<attached/i.test(body)||body.startsWith("http"))return;
      body.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu,"").split(/\s+/).forEach(w=>{if(w.length>2&&!STOP.has(w)&&!WA_NOISE.has(w)&&!/^\d+$/.test(w))wf[w]=(wf[w]||0)+1;});
    });
    sigWordByName[n]=Object.entries(wf).sort((a,b)=>b[1]-a[1])[0]?.[0]||"...";
  });

  // ── Funniest person — who CAUSED laugh reactions ──
  // LAUGH_RE is defined at module scope
  const isLaughReaction = body => {
    const b = body.trim().toLowerCase();
    if (LAUGH_RE.test(b)) return true;
    // keyboard smash: 8+ letters, low vowel ratio, no spaces
    if (/^[a-z]{8,}$/i.test(b)) {
      const vowelRatio = (b.match(/[aeiou]/g)||[]).length / b.length;
      return vowelRatio < 0.30;
    }
    return false;
  };
  const laughCausedBy = {};
  namesAll.forEach(n => (laughCausedBy[n] = 0));
  for (let i = 0; i < messages.length - 1; i++) {
    const curr = messages[i], next = messages[i+1];
    if (curr.name === next.name) continue;
    if (!(curr.name in laughCausedBy)) continue;
    if (isLaughReaction(next.body)) laughCausedBy[curr.name]++;
  }
  const funniestPerson = !isGroup && namesAll.length >= 2
    ? [...namesAll].sort((a,b) => laughCausedBy[b] - laughCausedBy[a])[0]
    : namesAll[0];

  const msgCounts = namesSorted.map(n => byName[n].length);
  const dynamics = spotDynamics({
    messages,
    namesAll,
    namesSorted,
    msgCounts,
    starterCount,
    isGroup,
  });

  return {
    isGroup, names: namesSorted,
    msgCounts,
    topWords, spiritEmoji: isGroup?[spiritEmojiAll]:namesSorted.map(n=>spiritByName[n]||"💬"),
    avgMsgLen: namesSorted.map(n=>avgLenByName[n]),
    maxMsgLen: namesSorted.map(n=>maxLenByName[n]),
    mediaCounts: namesSorted.map(n=>mediaByName[n]),
    linkCounts: namesSorted.map(n=>linkByName[n]),
    voiceCounts: namesSorted.map(n=>voiceByName[n]),
    peakHour: namesSorted.map(n=>fmtHour(peakHourByName[n])),
    signatureWord: namesSorted.map(n=>sigWordByName[n]),
    ghostAvg, ghostName, ghostEqual, streak: maxStreak, funniestPerson, laughCausedBy,
    topMonths: topMonths.length?topMonths:[["This month",messages.length]],
    convStarter: topStarterEntry?.[0]||namesSorted[0], convStarterPct: starterPct,
    convKiller: topKillerEntry?.[0]||namesSorted[0], convKillerCount: topKillerEntry?.[1]||0,
    mainChar:     isGroup?namesSorted[0]:null,
    ghost:        isGroup?namesSorted[namesSorted.length-1]:null,
    novelist:     isGroup?[...namesAll].sort((a,b)=>avgLenByName[b]-avgLenByName[a])[0]:null,
    novelistMaxLen: isGroup?maxLenByName[[...namesAll].sort((a,b)=>avgLenByName[b]-avgLenByName[a])[0]]||0:0,
    novelistLongestTopic: (() => {
      if (!isGroup) return null;
      const nov = [...namesAll].sort((a,b)=>avgLenByName[b]-avgLenByName[a])[0];
      const msgs = (byName[nov]||[]).filter(m=>!/media omitted|voice omitted|audio omitted|<attached/i.test(m.body)&&!m.body.startsWith("http"));
      const longest = msgs.sort((a,b)=>b.body.length-a.body.length)[0];
      if (!longest) return null;
      const wf = {};
      longest.body.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu,"").split(/\s+/).forEach(w=>{
        if(w.length>3&&!STOP.has(w)&&!WA_NOISE.has(w)&&!/^\d+$/.test(w))wf[w]=(wf[w]||0)+1;
      });
      return Object.entries(wf).sort((a,b)=>b[1]-a[1])[0]?.[0]||null;
    })(),
    hype:         isGroup?topStarterEntry?.[0]||namesAll[0]:null,
    photographer: isGroup?(()=>{ const p=[...namesAll].sort((a,b)=>mediaByName[b]-mediaByName[a])[0]; return p||null; })():null,
    photographerIsVoice: isGroup?(()=>{ const p=[...namesAll].sort((a,b)=>mediaByName[b]-mediaByName[a])[0]; return p&&voiceByName[p]>mediaByName[p]; })():false,
    voiceChampion: isGroup?[...namesAll].sort((a,b)=>voiceByName[b]-voiceByName[a])[0]:null,
    linkDumper:   isGroup?[...namesAll].sort((a,b)=>linkByName[b]-linkByName[a])[0]:null,
    therapist:    isGroup?therapist:null,
    therapistCount: isGroup?therapistCount:0,
    nightOwl:     isGroup?[...namesAll].sort((a,b)=>peakHourByName[b]-peakHourByName[a])[0]:null,
    earlyBird:    isGroup?[...namesAll].sort((a,b)=>peakHourByName[a]-peakHourByName[b])[0]:null,
    mostHyped:    isGroup?namesSorted[1]||namesSorted[0]:null,
    totalMessages: messages.length,
    relationshipStatus: dynamics.relationshipStatus,
    relationshipStatusWhy: dynamics.relationshipStatusWhy,
    statusEvidence: dynamics.statusEvidence,
    toxicPerson: dynamics.toxicPerson,
    toxicReason: dynamics.toxicReason,
    redFlags: dynamics.redFlags,
    toxicityScores: namesSorted.map(name => Math.round(dynamics.toxicityScores[name] || 0)),
    evidenceTimeline: dynamics.evidenceTimeline,
    toxicityLevel: dynamics.toxicityLevel,
    toxicityReport: dynamics.toxicityReport,
    toxicityBreakdown: dynamics.toxicityBreakdown,
  };
}

// ─────────────────────────────────────────────────────────────────
// EVENT-BASED SAMPLING PIPELINE
// ─────────────────────────────────────────────────────────────────

const DAY_ABBR = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

// Format a single message line — timestamp always includes speaker name
function formatMessageLine(m) {
  const d  = m.date;
  const ts = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")} ${DAY_ABBR[d.getDay()]} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  return `[${ts}] ${m.name}: ${m.body}`;
}

// Flat formatter kept for growth analysis early/late contiguous slices
function formatForAI(messages) {
  return messages.map(formatMessageLine).join("\n");
}

// Assign an event score and tag set to every message position.
// Higher score = more valuable to anchor a context window on.
function scoreMessages(messages) {
  return messages.map((msg, i) => {
    let score = 0;
    const tags = [];
    // Skip pure media placeholders for signal detection
    const body = /^<(Voice|Media) omitted>$/.test(msg.body) ? "" : msg.body;

    // Reply-gap signal — long silences often bracket important exchanges
    if (i > 0) {
      const gapMin = (msg.date - messages[i - 1].date) / 60000;
      if (gapMin > 240)     { score += 4; tags.push("long-gap"); }
      else if (gapMin > 60) { score += 2; tags.push("gap"); }
    }

    // Conflict signals
    if (body && (CONTROL_RE.test(body) || AGGRO_RE.test(body) || BREAKUP_RE.test(body))) {
      score += 6; tags.push("conflict");
    }

    // Apology clusters
    if (body && APOLOGY_RE.test(body)) {
      score += 4; tags.push("apology");
    }

    // Romantic / affection spikes
    if (body && (ROMANCE_RE.test(body) || DATE_RE.test(body) || FLIRTY_EMOJI_RE.test(body))) {
      score += 4; tags.push("affection");
    }

    // Long message — likely something substantive
    if (body.length > 200) { score += 2; tags.push("long-msg"); }

    // Laugh-trigger: this message caused a laugh reaction from a DIFFERENT speaker
    // in the next 1–3 messages. Preserving these windows (with their tail) lets
    // Claude see exactly whose line made someone laugh — not just what sounds funny.
    for (let j = i + 1; j <= Math.min(i + 3, messages.length - 1); j++) {
      if (messages[j].name !== msg.name && LAUGH_RE.test(messages[j].body)) {
        score += 5; tags.push("laugh-trigger");
        break;
      }
    }

    return { score, tags };
  });
}

// Merge overlapping or adjacent [start, end, tags[]] intervals
function mergeIntervals(intervals) {
  if (!intervals.length) return [];
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const out = [[...sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1];
    if (sorted[i][0] <= last[1] + 1) {
      last[1] = Math.max(last[1], sorted[i][1]);
      last[2] = [...new Set([...(last[2] || []), ...(sorted[i][2] || [])])];
    } else {
      out.push([...sorted[i]]);
    }
  }
  return out;
}

// Human-readable label for a chunk header, derived from its tag set
function chunkLabel(tags = []) {
  if (tags.includes("conflict"))      return "conflict";
  if (tags.includes("apology"))       return "apology";
  if (tags.includes("laugh-trigger")) return "funny moment";
  if (tags.includes("affection"))     return "affection";
  if (tags.includes("long-gap"))      return "after silence";
  if (tags.includes("long-msg"))      return "long message";
  return "excerpt";
}

// Build the ordered list of [startIdx, endIdx, tags[]] windows to send to Claude.
//
// Two-pass strategy:
//   1. Event windows  — anchor on high-scoring messages, include enough surrounding
//      context that speaker direction and laugh reactions are unambiguous.
//   2. Timeline fill  — add short baseline windows for time buckets not yet covered,
//      so Claude always sees something from every major period of the chat.
function buildChunks(messages) {
  if (!messages.length) return [];

  const CONTEXT_BEFORE      = 4;   // lines before each event center
  const CONTEXT_AFTER       = 5;   // lines after event center (default)
  const CONTEXT_AFTER_LAUGH = 8;   // extended tail for laugh-trigger windows
                                   //   — captures the reaction(s) that follow the funny line
  const EVENT_SCORE_MIN     = 4;   // minimum score to qualify as an event center
  const MAX_EVENT_WINDOWS   = 55;  // hard cap on event-based windows
  const TIMELINE_BUCKETS    = 28;  // time segments for baseline coverage
  const LINES_PER_BUCKET    = 5;   // messages per uncovered timeline window
  const MSG_LINE_LIMIT      = 1400; // hard cap on total message lines (headers not counted)

  const n      = messages.length;
  const scores = scoreMessages(messages);

  // ── Pass 1: event windows ──
  // Sort all candidates by descending score, then limit density so we never
  // take more than one event center within any 8-message neighbourhood.
  const candidates = scores
    .map((s, i) => ({ i, score: s.score, tags: s.tags }))
    .filter(x => x.score >= EVENT_SCORE_MIN)
    .sort((a, b) => b.score - a.score);

  const takenCenters  = new Set();
  const eventWindows  = [];
  for (const c of candidates) {
    if (takenCenters.has(c.i)) continue;
    for (let k = Math.max(0, c.i - 4); k <= Math.min(n - 1, c.i + 4); k++) takenCenters.add(k);
    const after = c.tags.includes("laugh-trigger") ? CONTEXT_AFTER_LAUGH : CONTEXT_AFTER;
    eventWindows.push([
      Math.max(0, c.i - CONTEXT_BEFORE),
      Math.min(n - 1, c.i + after),
      c.tags,
    ]);
    if (eventWindows.length >= MAX_EVENT_WINDOWS) break;
  }

  // ── Pass 2: timeline fill ──
  // Divide the chat's time span into equal buckets.  Any bucket with no event
  // coverage gets a short window centred on its midpoint message.
  const firstTs = messages[0].date.getTime();
  const lastTs  = messages[n - 1].date.getTime();
  const span    = Math.max(lastTs - firstTs, 1);

  const mergedEvents = mergeIntervals(eventWindows);
  const coveredSet   = new Set();
  mergedEvents.forEach(([s, e]) => { for (let k = s; k <= e; k++) coveredSet.add(k); });

  const timelineWindows = [];
  for (let b = 0; b < TIMELINE_BUCKETS; b++) {
    const lo = firstTs + (b / TIMELINE_BUCKETS) * span;
    const hi = firstTs + ((b + 1) / TIMELINE_BUCKETS) * span;
    const bucket = [];
    for (let i = 0; i < n; i++) {
      const ts = messages[i].date.getTime();
      if (ts >= lo && ts < hi) bucket.push(i);
    }
    if (!bucket.length || bucket.some(i => coveredSet.has(i))) continue;
    const center = bucket[Math.floor(bucket.length / 2)];
    timelineWindows.push([
      Math.max(0, center - 2),
      Math.min(n - 1, center + LINES_PER_BUCKET - 1),
      ["timeline"],
    ]);
  }

  // ── Merge, sort, enforce line budget ──
  const all = mergeIntervals([...eventWindows, ...timelineWindows])
    .sort((a, b) => a[0] - b[0]);

  let msgLines = 0;
  const result = [];
  for (const chunk of all) {
    const sz = chunk[1] - chunk[0] + 1;
    if (msgLines + sz > MSG_LINE_LIMIT) break;
    result.push(chunk);
    msgLines += sz;
  }
  return result;
}

// Render chunks as windowed text with ━━━ separators.
// Each header tells Claude: isolated excerpt, date, type of signal.
// Speaker name is always present on every message line — attribution is unambiguous.
function formatChunksForAI(messages, chunks) {
  const total = chunks.length;
  const parts = [];
  chunks.forEach(([start, end, tags], idx) => {
    const d       = messages[start].date;
    const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")} ${DAY_ABBR[d.getDay()]}`;
    parts.push(`\n━━━ WINDOW ${idx + 1}/${total} · ${dateStr} · ${chunkLabel(tags)} ━━━`);
    for (let i = start; i <= end; i++) parts.push(formatMessageLine(messages[i]));
  });
  return parts.join("\n");
}

// Main entry point — replaces the old smartSample(messages,N) + formatForAI(sample) pair.
// Short chats (≤600 messages) are delivered in full as a single window.
function buildSampleText(messages) {
  if (!messages.length) return "";
  if (messages.length <= 600) {
    return formatChunksForAI(messages, [[0, messages.length - 1, ["full-history"]]]);
  }
  return formatChunksForAI(messages, buildChunks(messages));
}

async function callClaude(systemPrompt, userContent, maxTokens = 1500) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyse-chat`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${session?.access_token}`,
      },
      body: JSON.stringify({ system: systemPrompt, userContent, max_tokens: maxTokens }),
    }
  );
  if (!res.ok) throw new Error(`Edge function error ${res.status}`);
  return res.json();
}

const CORE_ANALYSIS_VERSION = 2;
const CORE_A_MAX_TOKENS = 2200;
const CORE_B_MAX_TOKENS = 2200;

function buildRelationshipContextBlock(relType) {
  const relCtx = relContextStr(relType);
  return relCtx
    ? ` RELATIONSHIP CONTEXT: ${relCtx}. Frame all analysis, tone, and language accordingly. Do not label a partner dynamic as friendship or chosen family. Do not label a family dynamic as romantic.`
    : "";
}

function buildAnalystSystemPrompt(role, relationshipType, extraRules = "") {
  return `You are WrapChat, ${role}. Be specific, grounded, and evidence-led. Reference real patterns, real phrases, and real moments from the chat instead of generic observations. Be conservative before singling out one person: if the evidence is mixed, close, or mostly based on tone, prefer balanced labels like "Tie", "Shared", "Balanced", or "None clearly identified" instead of over-assigning blame. Do not pile onto the loudest or most active person unless multiple distinct examples support it. Keep the tone honest but not cruel, mocking, or absolute. Avoid repetitive wording across fields: if two answers overlap, make them distinct in angle and concrete detail rather than repeating the same judgment. When negative and positive evidence coexist, acknowledge both. Return ONLY valid JSON with no markdown fences or explanation outside the JSON.${buildRelationshipContextBlock(relationshipType)}${extraRules ? ` ${extraRules}` : ""}`;
}

function clampScore(value, fallback = 5) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(1, Math.min(10, Math.round(num)));
}

function strOr(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function cleanStringArray(items, limit = 10) {
  if (!Array.isArray(items)) return [];
  return items.map(item => String(item || "").trim()).filter(Boolean).slice(0, limit);
}

function normalizeNamedScoreRows(items, limit = 10) {
  if (!Array.isArray(items)) return [];
  return items.map((item, i) => {
    if (!item || typeof item !== "object") return null;
    return {
      name: strOr(item.name, `Person ${i + 1}`),
      score: clampScore(item.score, 5),
      detail: strOr(item.detail),
    };
  }).filter(Boolean).slice(0, limit);
}

function normalizeApologySummary(item) {
  const safe = item && typeof item === "object" ? item : {};
  return {
    name: strOr(safe.name, "None clearly identified"),
    count: Math.max(0, Math.round(Number(safe.count) || 0)),
    context: strOr(safe.context),
  };
}

function normalizeMomentRows(items, limit = 10) {
  if (!Array.isArray(items)) return [];
  return items.map((item, i) => {
    if (!item || typeof item !== "object") return null;
    return {
      date: strOr(item.date, `Moment ${i + 1}`),
      person: strOr(item.person),
      description: strOr(item.description || item.title),
      quote: strOr(item.quote || item.detail),
    };
  }).filter(Boolean).slice(0, limit);
}

function normalizePromiseMoment(item) {
  const safe = item && typeof item === "object" ? item : {};
  return {
    person: strOr(safe.person, "None clearly identified"),
    promise: strOr(safe.promise),
    date: strOr(safe.date),
    outcome: strOr(safe.outcome),
  };
}

function normalizeCorePersonA(person, fallbackName = "") {
  const safe = person && typeof person === "object" ? person : {};
  const care = safe.careStyle && typeof safe.careStyle === "object" ? safe.careStyle : {};
  const energy = safe.energy && typeof safe.energy === "object" ? safe.energy : {};
  return {
    name: strOr(safe.name, fallbackName || "Unknown"),
    summaryRole: strOr(safe.summaryRole),
    careStyle: {
      language: strOr(care.language, "Mixed"),
      languageEmoji: strOr(care.languageEmoji, "💝"),
      examples: strOr(care.examples),
      score: clampScore(care.score, 5),
    },
    energy: {
      netScore: clampScore(energy.netScore, 5),
      type: strOr(energy.type, "mixed"),
      goodNews: strOr(energy.goodNews),
      venting: strOr(energy.venting, "minimal venting"),
      hypeQuote: strOr(energy.hypeQuote),
    },
  };
}

function normalizeCorePersonB(person, fallbackName = "") {
  const safe = person && typeof person === "object" ? person : {};
  const health = safe.health && typeof safe.health === "object" ? safe.health : {};
  const accountability = safe.accountability && typeof safe.accountability === "object" ? safe.accountability : {};
  return {
    name: strOr(safe.name, fallbackName || "Unknown"),
    health: {
      score: clampScore(health.score, 5),
      detail: strOr(health.detail),
      apologyCount: Math.max(0, Math.round(Number(health.apologyCount) || 0)),
      apologyContext: strOr(health.apologyContext),
    },
    accountability: {
      total: Math.max(0, Math.round(Number(accountability.total) || 0)),
      kept: Math.max(0, Math.round(Number(accountability.kept) || 0)),
      broken: Math.max(0, Math.round(Number(accountability.broken) || 0)),
      score: clampScore(accountability.score, 5),
      detail: strOr(accountability.detail),
    },
  };
}

function normalizeCoreAnalysisA(raw, math, relationshipType) {
  const source = raw && typeof raw === "object" ? raw : {};
  const meta = source.meta && typeof source.meta === "object" ? source.meta : {};
  const shared = source.shared && typeof source.shared === "object" ? source.shared : {};
  const growth = shared.growth && typeof shared.growth === "object" ? shared.growth : {};
  const inputPeople = Array.isArray(source.people) ? source.people : [];
  const expectedPeople = Math.max(
    inputPeople.length,
    Math.min(math?.names?.length || 0, math?.isGroup ? Math.min(math?.names?.length || 0, 6) : 2)
  );

  const people = Array.from({ length: expectedPeople }, (_, i) =>
    normalizeCorePersonA(inputPeople[i], math?.names?.[i] || `Person ${i + 1}`)
  );

  return {
    schemaVersion: CORE_ANALYSIS_VERSION,
    part: "a",
    relationshipType: relationshipType ?? null,
    meta: {
      confidenceNote: strOr(meta.confidenceNote),
      dominantTone: strOr(meta.dominantTone),
    },
    people,
    shared: {
      vibeOneLiner: strOr(shared.vibeOneLiner),
      biggestTopic: strOr(shared.biggestTopic),
      ghostContext: strOr(shared.ghostContext),
      funniestPerson: strOr(shared.funniestPerson),
      funniestReason: strOr(shared.funniestReason),
      dramaStarter: strOr(shared.dramaStarter),
      dramaContext: strOr(shared.dramaContext),
      signaturePhrases: cleanStringArray(shared.signaturePhrases, 2),
      relationshipStatus: strOr(shared.relationshipStatus),
      relationshipStatusWhy: strOr(shared.relationshipStatusWhy),
      statusEvidence: strOr(shared.statusEvidence),
      toxicPerson: strOr(shared.toxicPerson),
      toxicReason: strOr(shared.toxicReason),
      toxicityReport: strOr(shared.toxicityReport),
      redFlags: normalizeRedFlags(shared.redFlags),
      evidenceTimeline: normalizeTimeline(shared.evidenceTimeline),
      relationshipSummary: strOr(shared.relationshipSummary),
      groupDynamic: strOr(shared.groupDynamic),
      tensionMoment: strOr(shared.tensionMoment),
      kindestPerson: strOr(shared.kindestPerson),
      sweetMoment: strOr(shared.sweetMoment),
      mostMissed: strOr(shared.mostMissed),
      insideJoke: strOr(shared.insideJoke),
      hypePersonReason: strOr(shared.hypePersonReason),
      loveLanguageMismatch: strOr(shared.loveLanguageMismatch),
      mostLovingMoment: strOr(shared.mostLovingMoment),
      compatibilityScore: clampScore(shared.compatibilityScore, 5),
      compatibilityRead: strOr(shared.compatibilityRead),
      mostEnergising: strOr(shared.mostEnergising),
      mostDraining: strOr(shared.mostDraining),
      energyCompatibility: strOr(shared.energyCompatibility),
      growth: {
        thenDepth: strOr(growth.thenDepth),
        nowDepth: strOr(growth.nowDepth),
        depthChange: strOr(growth.depthChange),
        whoChangedMore: strOr(growth.whoChangedMore),
        whoChangedHow: strOr(growth.whoChangedHow),
        topicsAppeared: strOr(growth.topicsAppeared),
        topicsDisappeared: strOr(growth.topicsDisappeared),
        trajectory: strOr(growth.trajectory),
        trajectoryDetail: strOr(growth.trajectoryDetail),
        arcSummary: strOr(growth.arcSummary),
      },
    },
  };
}

function normalizeCoreAnalysisB(raw, math, relationshipType) {
  const source = raw && typeof raw === "object" ? raw : {};
  const meta = source.meta && typeof source.meta === "object" ? source.meta : {};
  const shared = source.shared && typeof source.shared === "object" ? source.shared : {};
  const toxicity = shared.toxicity && typeof shared.toxicity === "object" ? shared.toxicity : {};
  const accountability = shared.accountability && typeof shared.accountability === "object" ? shared.accountability : {};
  const inputPeople = Array.isArray(source.people) ? source.people : [];
  const expectedPeople = Math.max(
    inputPeople.length,
    Math.min(math?.names?.length || 0, 2)
  );

  const people = Array.from({ length: expectedPeople }, (_, i) =>
    normalizeCorePersonB(inputPeople[i], math?.names?.[i] || `Person ${i + 1}`)
  );

  return {
    schemaVersion: CORE_ANALYSIS_VERSION,
    part: "b",
    relationshipType: relationshipType ?? null,
    meta: {
      confidenceNote: strOr(meta.confidenceNote),
      dominantTone: strOr(meta.dominantTone),
    },
    people,
    shared: {
      toxicity: {
        chatHealthScore: clampScore(toxicity.chatHealthScore, 5),
        healthScores: normalizeNamedScoreRows(toxicity.healthScores),
        apologiesLeader: normalizeApologySummary(toxicity.apologiesLeader),
        apologiesOther: normalizeApologySummary(toxicity.apologiesOther),
        redFlagMoments: normalizeMomentRows(toxicity.redFlagMoments, 5),
        conflictPattern: strOr(toxicity.conflictPattern),
        powerBalance: strOr(toxicity.powerBalance),
        powerHolder: strOr(toxicity.powerHolder, "Balanced"),
        verdict: strOr(toxicity.verdict),
      },
      accountability: {
        notableBroken: normalizePromiseMoment(accountability.notableBroken),
        notableKept: normalizePromiseMoment(accountability.notableKept),
        overallVerdict: strOr(accountability.overallVerdict),
      },
    },
  };
}

function attachReportMeta(report, relationshipType, coreAnalysis = null) {
  return {
    ...(report && typeof report === "object" ? report : {}),
    relationshipType: relationshipType ?? null,
    ...(coreAnalysis ? { coreAnalysis } : {}),
  };
}

function pickCorePairA(core, math) {
  const fallbackA = math?.names?.[0] || "Person A";
  const fallbackB = math?.names?.[1] || fallbackA || "Person B";
  const personA = normalizeCorePersonA(core?.people?.[0], fallbackA);
  const personB = normalizeCorePersonA(core?.people?.[1] || core?.people?.[0], fallbackB);
  return [personA, personB];
}

function pickCorePairB(core, math) {
  const fallbackA = math?.names?.[0] || "Person A";
  const fallbackB = math?.names?.[1] || fallbackA || "Person B";
  const personA = normalizeCorePersonB(core?.people?.[0], fallbackA);
  const personB = normalizeCorePersonB(core?.people?.[1] || core?.people?.[0], fallbackB);
  return [personA, personB];
}

function deriveGeneralReportFromCore(core, math, relationshipType) {
  const shared = core?.shared || {};
  return attachReportMeta({
    funniestPerson: shared.funniestPerson || math?.funniestPerson || "",
    funniestReason: shared.funniestReason,
    ghostContext: shared.ghostContext,
    biggestTopic: shared.biggestTopic,
    dramaStarter: shared.dramaStarter,
    dramaContext: shared.dramaContext,
    signaturePhrase: shared.signaturePhrases?.length ? shared.signaturePhrases : undefined,
    relationshipStatus: shared.relationshipStatus,
    relationshipStatusWhy: shared.relationshipStatusWhy,
    statusEvidence: shared.statusEvidence,
    toxicPerson: shared.toxicPerson,
    toxicReason: shared.toxicReason,
    evidenceTimeline: shared.evidenceTimeline,
    redFlags: shared.redFlags,
    toxicityReport: shared.toxicityReport,
    relationshipSummary: shared.relationshipSummary,
    tensionMoment: shared.tensionMoment,
    kindestPerson: shared.kindestPerson,
    sweetMoment: shared.sweetMoment,
    vibeOneLiner: shared.vibeOneLiner,
    groupDynamic: shared.groupDynamic,
    mostMissed: shared.mostMissed,
    insideJoke: shared.insideJoke,
    hypePersonReason: shared.hypePersonReason,
  }, relationshipType, core);
}

function deriveEnergyReportFromCore(core, math, relationshipType) {
  const [personA, personB] = pickCorePairA(core, math);
  const shared = core?.shared || {};
  return attachReportMeta({
    personA: {
      name: personA.name,
      netScore: personA.energy.netScore,
      type: personA.energy.type,
      goodNews: personA.energy.goodNews,
      venting: personA.energy.venting,
      hypeQuote: personA.energy.hypeQuote,
    },
    personB: {
      name: personB.name,
      netScore: personB.energy.netScore,
      type: personB.energy.type,
      goodNews: personB.energy.goodNews,
      venting: personB.energy.venting,
      hypeQuote: personB.energy.hypeQuote,
    },
    mostEnergising: shared.mostEnergising,
    mostDraining: shared.mostDraining,
    compatibility: shared.energyCompatibility,
  }, relationshipType, core);
}

function deriveToxicityReportFromCore(core, math, relationshipType) {
  const [personA, personB] = pickCorePairB(core, math);
  const shared = core?.shared || {};
  const toxicity = shared.toxicity || {};
  const healthScores = toxicity.healthScores?.length
    ? toxicity.healthScores
    : [personA, personB].map(person => ({
        name: person.name,
        score: person.health.score,
        detail: person.health.detail,
      }));

  const apologyLeader = toxicity.apologiesLeader?.name && toxicity.apologiesLeader.name !== "None clearly identified"
    ? toxicity.apologiesLeader
    : (personA.health.apologyCount >= personB.health.apologyCount
        ? { name: personA.name, count: personA.health.apologyCount, context: personA.health.apologyContext }
        : { name: personB.name, count: personB.health.apologyCount, context: personB.health.apologyContext });
  const apologyOther = toxicity.apologiesOther?.name && toxicity.apologiesOther.name !== "None clearly identified"
    ? toxicity.apologiesOther
    : (apologyLeader.name === personA.name
        ? { name: personB.name, count: personB.health.apologyCount, context: personB.health.apologyContext }
        : { name: personA.name, count: personA.health.apologyCount, context: personA.health.apologyContext });

  return attachReportMeta({
    chatHealthScore: toxicity.chatHealthScore,
    healthScores,
    apologiesLeader: apologyLeader,
    apologiesOther: apologyOther,
    redFlagMoments: toxicity.redFlagMoments,
    conflictPattern: toxicity.conflictPattern,
    powerBalance: toxicity.powerBalance,
    powerHolder: toxicity.powerHolder,
    verdict: toxicity.verdict,
  }, relationshipType, core);
}

function deriveLoveLangReportFromCore(core, math, relationshipType) {
  const [personA, personB] = pickCorePairA(core, math);
  const shared = core?.shared || {};
  return attachReportMeta({
    personA: {
      name: personA.name,
      language: personA.careStyle.language,
      languageEmoji: personA.careStyle.languageEmoji,
      examples: personA.careStyle.examples,
      score: personA.careStyle.score,
    },
    personB: {
      name: personB.name,
      language: personB.careStyle.language,
      languageEmoji: personB.careStyle.languageEmoji,
      examples: personB.careStyle.examples,
      score: personB.careStyle.score,
    },
    mismatch: shared.loveLanguageMismatch,
    mostLovingMoment: shared.mostLovingMoment,
    compatibilityScore: shared.compatibilityScore,
    compatibilityRead: shared.compatibilityRead,
  }, relationshipType, core);
}

function deriveGrowthReportFromCore(core, math, relationshipType) {
  const growth = core?.shared?.growth || {};
  return attachReportMeta({
    thenDepth: growth.thenDepth,
    nowDepth: growth.nowDepth,
    depthChange: growth.depthChange,
    whoChangedMore: growth.whoChangedMore,
    whoChangedHow: growth.whoChangedHow,
    topicsAppeared: growth.topicsAppeared,
    topicsDisappeared: growth.topicsDisappeared,
    trajectory: growth.trajectory,
    trajectoryDetail: growth.trajectoryDetail,
    arcSummary: growth.arcSummary,
  }, relationshipType, core);
}

function deriveAccountaReportFromCore(core, math, relationshipType) {
  const [personA, personB] = pickCorePairB(core, math);
  const accountability = core?.shared?.accountability || {};
  return attachReportMeta({
    personA: {
      name: personA.name,
      total: personA.accountability.total,
      kept: personA.accountability.kept,
      broken: personA.accountability.broken,
      score: personA.accountability.score,
      detail: personA.accountability.detail,
    },
    personB: {
      name: personB.name,
      total: personB.accountability.total,
      kept: personB.accountability.kept,
      broken: personB.accountability.broken,
      score: personB.accountability.score,
      detail: personB.accountability.detail,
    },
    notableBroken: accountability.notableBroken,
    notableKept: accountability.notableKept,
    overallVerdict: accountability.overallVerdict,
  }, relationshipType, core);
}

async function generateCoreAnalysisA(messages, math, relationshipType) {
  const chatText = buildSampleText(messages);
  const names = math.names || [];
  const isGroup = math.isGroup;
  const personCount = Math.min(names.length || 0, isGroup ? Math.min(names.length || 0, 6) : 2);
  const earlyMsgs = messages.slice(0, Math.min(120, Math.max(40, Math.floor(messages.length * 0.18))));
  const lateMsgs  = messages.slice(Math.max(0, messages.length - Math.min(120, Math.max(40, Math.floor(messages.length * 0.18)))));
  const earlyText = formatForAI(earlyMsgs);
  const lateText  = formatForAI(lateMsgs);
  const fields = `{
  "schemaVersion": ${CORE_ANALYSIS_VERSION},
  "meta": {
    "confidenceNote": "1 sentence — how confident the read is, noting if evidence is mixed or limited",
    "dominantTone": "short phrase naming the dominant overall tone"
  },
  "people": [
    {
      "name": "first person's first name",
      "summaryRole": "1 short phrase describing their role in the dynamic",
      "careStyle": {
        "language": "one of: Words of Affirmation / Acts of Service / Receiving Gifts / Quality Time / Physical Touch / Mixed",
        "languageEmoji": "1 emoji representing that care style",
        "examples": "1-2 sentences with concrete examples of how they show care or affection",
        "score": [1-10]
      },
      "energy": {
        "netScore": [1-10],
        "type": "net positive / mixed / net draining",
        "goodNews": "1 sentence — how they bring positive energy, with a real example",
        "venting": "1 sentence — how or how much they vent/drain, or 'minimal venting' if low",
        "hypeQuote": "a short real quote or near-verbatim example of them bringing energy"
      }
    }
  ],
  "shared": {
    "vibeOneLiner": "one punchy sentence capturing the whole chat's energy",
    "biggestTopic": "1 sentence — the biggest recurring topic, very specific not generic",
    "ghostContext": "1 sentence — explain the ghost pattern with real context",
    "funniestPerson": "ONLY the first name of the funniest person, or 'None clearly identified'",
    "funniestReason": "1 short concrete example of the kind of line or moment they drop",
    "dramaStarter": "ONLY a first name, 'Shared', or 'None clearly identified'",
    "dramaContext": "1 sentence — how tension usually gets started, with real evidence",
    "signaturePhrases": ["real phrase or expression person 1 uses a lot", "real phrase or expression person 2 uses a lot"],
    "relationshipStatus": "duo only: short relationship-status label, or 'None clearly identified'",
    "relationshipStatusWhy": "1 sentence — why that status fits, using objective evidence",
    "statusEvidence": "1 short line with a concrete dated example if possible",
    "toxicPerson": "ONLY a first name, 'Tie', or 'None clearly identified'",
    "toxicReason": "1 sentence — factual and conservative explanation of that read",
    "toxicityReport": "2 sentences — balanced, observable summary of tension or health",
    "redFlags": [
      { "title": "2-4 word factual pattern label", "detail": "1 sentence with objective evidence", "evidence": "dated example or short quote" },
      { "title": "2-4 word factual pattern label", "detail": "1 sentence with objective evidence", "evidence": "dated example or short quote" },
      { "title": "2-4 word factual pattern label", "detail": "1 sentence with objective evidence", "evidence": "dated example or short quote" }
    ],
    "evidenceTimeline": [
      { "date": "exact or approximate date", "title": "short factual headline", "detail": "1 short factual detail with quote or clear paraphrase" },
      { "date": "exact or approximate date", "title": "short factual headline", "detail": "1 short factual detail with quote or clear paraphrase" },
      { "date": "exact or approximate date", "title": "short factual headline", "detail": "1 short factual detail with quote or clear paraphrase" }
    ],
    "relationshipSummary": "2 sentences — honest read of the duo dynamic",
    "groupDynamic": "2 sentences — honest read of the group dynamic",
    "tensionMoment": "1 sentence — the most tense moment or recurring tension pattern",
    "kindestPerson": "ONLY a first name — the warmest/caring person, or 'None clearly identified'",
    "sweetMoment": "1 sentence — a specific, concrete sweet moment",
    "mostMissed": "group only: ONLY a first name, or 'None clearly identified'",
    "insideJoke": "group only: 1 sentence — recurring joke, meme or reference",
    "hypePersonReason": "group only: 1 sentence — why this person is the group's hype",
    "loveLanguageMismatch": "2 sentences — how their care styles align or mismatch in practice",
    "mostLovingMoment": "1 sentence — the most genuinely warm/loving moment with specific detail",
    "compatibilityScore": [1-10],
    "compatibilityRead": "1 sentence — love-language compatibility summary",
    "mostEnergising": "1 sentence — the most energising moment in the chat",
    "mostDraining": "1 sentence — the most draining moment or pattern, with specific detail",
    "energyCompatibility": "1 sentence — how their energy styles work together (or don't)",
    "growth": {
      "thenDepth": "2 sentences describing the conversation style and topics in the EARLY snapshot",
      "nowDepth": "2 sentences describing the conversation style and topics in the RECENT snapshot",
      "depthChange": "deeper / shallower / about the same",
      "whoChangedMore": "first name of who changed more, or 'Both equally'",
      "whoChangedHow": "1 sentence — specifically how they changed, with evidence",
      "topicsAppeared": "topics or themes that appear in recent messages but were not present early on",
      "topicsDisappeared": "topics or themes from the early messages that seem to have faded away",
      "trajectory": "closer / drifting / stable",
      "trajectoryDetail": "1 sentence — the overall arc based on evidence",
      "arcSummary": "1 punchy sentence capturing the full growth arc"
    }
  }
}`;

  const system = buildAnalystSystemPrompt(
    "a sharp, observant chat analyst building a canonical core-analysis object that later reports will reuse",
    relationshipType,
    `CORE-A SCOPE: relationship dynamic, communication patterns, funny moments, kindness moments, energy, love language, and growth trajectory. WINDOW FORMAT: The chat is delivered as isolated windows separated by ━━━ headers — each window is a non-contiguous excerpt from the full history. Never connect or combine events from different windows unless the messages themselves explicitly link them. You will also receive EARLY and RECENT contiguous snapshots; use those specifically for growth/change fields, and use the event windows for specific moments and recurring patterns. SPEAKER ATTRIBUTION: Every message line is formatted as [timestamp] SpeakerName: body — the name before the colon is always and only the sender. Assign every quote, action, and behaviour to the name shown on that exact line. Never swap or infer the sender. FUNNY ATTRIBUTION: In windows labelled "funny moment", the sequence is [trigger line] → [laugh reaction from a different person]. The funny person is the sender of the trigger line — the one whose message caused the other person to laugh. Do not attribute the humour to the person who laughed. DIRECTION OF ACTIONS: For sweetMoment, kindestPerson, and energy/love-language reads, the actor is the sender of that exact line. For all "name" fields return ONLY the person's first name, with no explanation. Each timestamp already includes the day of week — read it directly and never calculate it yourself. Only report findings you can directly cite from the chat — if evidence is weak, use "None clearly identified". When quoting messages in any language, quote them as-is — do not translate them. Make the people array follow the provided name order for the first ${personCount || 1} participant${personCount === 1 ? "" : "s"}, with one people entry per participant in that subset.`
  );

  const userContent = `Here is a ${isGroup ? "group" : "two-person"} WhatsApp chat between ${names.slice(0, 6).join(", ")}. The full chat has ${math.totalMessages.toLocaleString()} messages. The content below is divided into ISOLATED WINDOWS from across the full history — each labelled ━━━ WINDOW N/N · date · type ━━━. Windows are non-contiguous excerpts; do not infer connections between separate windows. Every line shows the speaker: [timestamp] SpeakerName: body — assign all quotes and actions only to the name on that specific line.

IMPORTANT CONTEXT: ${isGroup ? `The least active member (the ghost) is ${math.ghost}. The conversation starter is ${math.convStarter}.` : `By reply time, ${math.ghostName} is slower to respond. The conversation starter is ${math.convStarter}. Local analysis found that ${math.funniestPerson} caused the most laugh reactions from the other person (${math.laughCausedBy?.[math.funniestPerson] || 0} times) — confirm or correct this based on the chat.`}

EARLY SNAPSHOT (contiguous excerpt from the start of the chat):
${earlyText}

RECENT SNAPSHOT (contiguous excerpt from the end of the chat):
${lateText}

${chatText}

Return exactly this JSON structure:
${fields}`;

  const raw = await callClaude(system, userContent, CORE_A_MAX_TOKENS);
  return normalizeCoreAnalysisA(raw, math, relationshipType);
}

async function generateCoreAnalysisB(messages, math, relationshipType) {
  const chatText = buildSampleText(messages);
  const names = math.names || [];
  const personCount = Math.min(names.length || 0, 2);
  const fields = `{
  "schemaVersion": ${CORE_ANALYSIS_VERSION},
  "meta": {
    "confidenceNote": "1 sentence — how confident the risk/accountability read is",
    "dominantTone": "short phrase naming the overall tension level"
  },
  "people": [
    {
      "name": "first person's first name",
      "health": {
        "score": [1-10, this person's contribution to chat health],
        "detail": "1 sentence — specific behaviours driving their health score",
        "apologyCount": [estimated apology count in the sample],
        "apologyContext": "1 sentence — how and when they tend to apologise"
      },
      "accountability": {
        "total": [estimated number of real commitments/promises made],
        "kept": [estimated number kept],
        "broken": [estimated number broken or dropped],
        "score": [1-10],
        "detail": "1 sentence — pattern of how they handle commitments"
      }
    }
  ],
  "shared": {
    "toxicity": {
      "chatHealthScore": [1-10, overall chat health],
      "healthScores": [
        { "name": "first name", "score": [1-10], "detail": "1 sentence — behaviours driving their score" },
        { "name": "first name", "score": [1-10], "detail": "1 sentence — behaviours driving their score" }
      ],
      "apologiesLeader": { "name": "first name or None clearly identified", "count": [estimated count], "context": "1 sentence — context and pattern" },
      "apologiesOther": { "name": "first name or None clearly identified", "count": [estimated count], "context": "1 sentence — context and pattern" },
      "redFlagMoments": [
        { "date": "approximate date", "person": "first name", "description": "what happened specifically", "quote": "short real quote from that moment" },
        { "date": "approximate date", "person": "first name", "description": "what happened specifically", "quote": "short real quote from that moment" },
        { "date": "approximate date", "person": "first name", "description": "what happened specifically", "quote": "short real quote from that moment" }
      ],
      "conflictPattern": "2 sentences — how arguments usually start, escalate, and resolve or fail to resolve",
      "powerBalance": "2 sentences — who holds more power in this dynamic and how it shows up",
      "powerHolder": "first name of who holds more power, or 'Balanced'",
      "verdict": "1 punchy sentence verdict on the overall health of this chat"
    },
    "accountability": {
      "notableBroken": {
        "person": "first name or None clearly identified",
        "promise": "what they said they'd do — quote or close paraphrase",
        "date": "approximate date",
        "outcome": "what actually happened, or didn't"
      },
      "notableKept": {
        "person": "first name or None clearly identified",
        "promise": "what they committed to — quote or close paraphrase",
        "date": "approximate date",
        "outcome": "how they followed through"
      },
      "overallVerdict": "1 sentence verdict on accountability in this chat overall"
    }
  }
}`;

  const system = buildAnalystSystemPrompt(
    "a careful risk, conflict, and accountability analyst building the canonical core-b object",
    relationshipType,
    `CORE-B SCOPE: toxicity, health scores, apology patterns, conflict patterns, power balance, red flag moments, and accountability. WINDOW FORMAT: The chat is delivered as isolated windows separated by ━━━ headers — never connect separate windows unless the messages explicitly link them. SPEAKER ATTRIBUTION: Every line is [timestamp] SpeakerName: body — all behaviour belongs only to the sender on that exact line. Be conservative: one or two examples do not prove a stable pattern. If the balance is mixed, prefer "Balanced", "Tie", or "None clearly identified" over forcing one villain. For accountability: a promise is BROKEN only if there is clear evidence it was never fulfilled or the person explicitly backed out. A promise fulfilled late is still KEPT. Do not count vague ideas like "we should hang out sometime" as promises. Never combine two separate events into one story. Make the people array follow the provided name order for the first ${personCount || 1} participant${personCount === 1 ? "" : "s"}, with one people entry per participant in that subset.`
  );

  const userContent = `Here is a WhatsApp chat between ${names.slice(0, 6).join(", ")} (${math.totalMessages.toLocaleString()} messages total). The content below is ISOLATED WINDOWS from across the full history. Do not connect events across windows unless the messages explicitly link them. Every line shows the speaker: [timestamp] SpeakerName: body.

${chatText}

Return exactly this JSON structure:
${fields}`;

  const raw = await callClaude(system, userContent, CORE_B_MAX_TOKENS);
  return normalizeCoreAnalysisB(raw, math, relationshipType);
}

async function aiAnalysis(messages, math, relationshipType, coreAnalysis = null) {
  try {
    const core = coreAnalysis || await generateCoreAnalysisA(messages, math, relationshipType);
    return deriveGeneralReportFromCore(core, math, relationshipType);
  } catch (e) {
    console.error("AI failed:", e);
    return attachReportMeta({}, relationshipType);
  }
}

async function aiToxicityAnalysis(messages, math, relationshipType, coreAnalysis = null) {
  try {
    const core = coreAnalysis || await generateCoreAnalysisB(messages, math, relationshipType);
    return deriveToxicityReportFromCore(core, math, relationshipType);
  } catch (e) {
    console.error("AI toxicity failed:", e);
    return attachReportMeta({}, relationshipType);
  }
}

async function aiLoveLangAnalysis(messages, math, relationshipType, coreAnalysis = null) {
  try {
    const core = coreAnalysis || await generateCoreAnalysisA(messages, math, relationshipType);
    return deriveLoveLangReportFromCore(core, math, relationshipType);
  } catch (e) {
    console.error("AI love language failed:", e);
    return attachReportMeta({}, relationshipType);
  }
}

async function aiGrowthAnalysis(messages, math, relationshipType, coreAnalysis = null) {
  try {
    const core = coreAnalysis || await generateCoreAnalysisA(messages, math, relationshipType);
    return deriveGrowthReportFromCore(core, math, relationshipType);
  } catch (e) {
    console.error("AI growth failed:", e);
    return attachReportMeta({}, relationshipType);
  }
}

async function aiAccountaAnalysis(messages, math, relationshipType, coreAnalysis = null) {
  try {
    const core = coreAnalysis || await generateCoreAnalysisB(messages, math, relationshipType);
    return deriveAccountaReportFromCore(core, math, relationshipType);
  } catch (e) {
    console.error("AI accountability failed:", e);
    return attachReportMeta({}, relationshipType);
  }
}

async function aiEnergyAnalysis(messages, math, relationshipType, coreAnalysis = null) {
  try {
    const core = coreAnalysis || await generateCoreAnalysisA(messages, math, relationshipType);
    return deriveEnergyReportFromCore(core, math, relationshipType);
  } catch (e) {
    console.error("AI energy failed:", e);
    return attachReportMeta({}, relationshipType);
  }
}

function getCoreAnalysisCacheKey(math, relationshipType) {
  return [
    math?.isGroup ? "group" : "duo",
    relationshipType || "none",
    math?.totalMessages || 0,
    ...(math?.names || []),
  ].join("::");
}

const REPORT_PIPELINES = {
  general:  { strategy: "core", cache: "a", derive: deriveGeneralReportFromCore },
  toxicity: { strategy: "core", cache: "b", derive: deriveToxicityReportFromCore },
  lovelang: { strategy: "core", cache: "a", derive: deriveLoveLangReportFromCore },
  growth:   { strategy: "core", cache: "a", derive: deriveGrowthReportFromCore },
  accounta: { strategy: "core", cache: "b", derive: deriveAccountaReportFromCore },
  energy:   { strategy: "core", cache: "a", derive: deriveEnergyReportFromCore },
};

// ─────────────────────────────────────────────────────────────────
// UI PRIMITIVES  — bold rounded-card aesthetic
// ─────────────────────────────────────────────────────────────────

// Category accent colors — used for inner cards
const PAL = {
  roast:    { bg:"#B83A10", inner:"#E8592A", text:"#fff", accent:"#FF8B6A" },
  lovely:   { bg:"#7A1C48", inner:"#A02860", text:"#fff", accent:"#F08EBF" },
  funny:    { bg:"#4A6A04", inner:"#6E9A08", text:"#fff", accent:"#C8F06A" },
  stats:    { bg:"#083870", inner:"#0E5AAA", text:"#fff", accent:"#6AB4F0" },
  ai:       { bg:"#1A3060", inner:"#2A4A90", text:"#fff", accent:"#8AACF0" },
  finale:   { bg:"#5E1228", inner:"#8A1C3C", text:"#fff", accent:"#F08EBF" },
  upload:   { bg:"#2C1268", inner:"#4A1EA0", text:"#fff", accent:"#A08AF0" },
  toxicity: { bg:"#3D0A0A", inner:"#8B1A1A", text:"#fff", accent:"#E04040" },
  lovelang: { bg:"#3D1A2E", inner:"#8B3A5A", text:"#fff", accent:"#F08EBF" },
  growth:   { bg:"#0A2E2E", inner:"#1A6B5A", text:"#fff", accent:"#3AF0C0" },
  accounta: { bg:"#0A1A3D", inner:"#1A3A8B", text:"#fff", accent:"#6AB4F0" },
  energy:   { bg:"#2E1A0A", inner:"#8B5A1A", text:"#fff", accent:"#F0A040" },
};

const PILL_LABEL = {
  roast:"The Roast", lovely:"The Lovely", funny:"The Funny", stats:"The Stats", ai:"Insight", finale:"WrapChat",
  toxicity:"Toxicity Report", lovelang:"Love Language", growth:"Growth Report", accounta:"Accountability", energy:"Energy Report",
};

// ─────────────────────────────────────────────────────────────────
// REPORT TYPES — shown on the report selection screen
// ─────────────────────────────────────────────────────────────────
const REPORT_TYPES = [
  { id:"general",  label:"General Wrapped",       desc:"The full Wrapped-style deep dive — stats, AI insights, and your chat personality.",         palette:"upload"   },
  { id:"toxicity", label:"Toxicity Report",        desc:"Red flags, power imbalances, who apologises more, conflict patterns, health scores.",        palette:"toxicity" },
  { id:"lovelang", label:"Love Language Report",   desc:"How each person shows affection, mapped to the 5 love languages. Works for friends too.",   palette:"lovelang" },
  { id:"growth",   label:"Growth Report",          desc:"First 3 months vs last 3 months — are you growing together or drifting apart?",             palette:"growth"   },
  { id:"accounta", label:"Accountability Report",  desc:"Promises made in the chat and whether they were followed through. Receipts for both.",       palette:"accounta" },
  { id:"energy",   label:"Energy Report",          desc:"Who brings good energy vs drains it — net energy score per person.",                         palette:"energy"   },
];

const LEGAL_VERSION = "1.1";

// ─── Legal document text — rendered inline, no external links ───
// Replace the placeholder strings below with the full text from your PDFs.
const TERMS_OF_SERVICE_TEXT = `TERMS OF SERVICE
Version 1.1 — Last updated 2025

PLEASE READ THESE TERMS CAREFULLY BEFORE USING WRAPCHAT.

1. ACCEPTANCE OF TERMS
By accessing or using WrapChat ("the Service"), you agree to be bound by these Terms of Service ("Terms"). If you do not agree to these Terms, do not use the Service.

2. DESCRIPTION OF SERVICE
WrapChat is a chat analysis tool that processes WhatsApp chat exports you provide. The Service uses AI to generate reports about communication patterns, relationship dynamics, and related insights from the text you upload.

3. ELIGIBILITY
You must be at least 18 years old to use the Service. By using the Service, you represent that you are at least 18 years of age.

4. YOUR CONTENT
You retain ownership of any chat data you upload. By uploading a chat export, you grant WrapChat a limited licence to process that data for the sole purpose of generating your requested reports. Chat content is analysed in transit and is not stored on our servers beyond what is necessary to produce your results.

5. CONSENT AND THIRD PARTIES
You are responsible for ensuring you have the right to upload any conversation. You should only upload chats in which you are a participant. You must not upload chats belonging to other people without their knowledge and consent. WrapChat is not responsible for any claims arising from your use of third-party data.

6. PROHIBITED USES
You agree not to use the Service to:
- Upload content belonging to others without consent
- Circumvent security or access controls
- Reverse-engineer, copy, or reproduce any part of the Service
- Use the Service for any unlawful purpose
- Attempt to gain unauthorised access to any system or network

7. INTELLECTUAL PROPERTY
All intellectual property rights in the Service, including but not limited to its software, design, and methodology, are owned by WrapChat. Nothing in these Terms grants you any rights in the Service other than the right to use it as expressly set out herein.

8. DISCLAIMER OF WARRANTIES
The Service is provided "as is" and "as available" without any warranties of any kind, express or implied. WrapChat does not warrant that the Service will be uninterrupted, error-free, or that any results generated will be accurate, complete, or reliable.

9. LIMITATION OF LIABILITY
To the maximum extent permitted by applicable law, WrapChat shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising out of or relating to your use of the Service.

10. CHANGES TO TERMS
WrapChat reserves the right to modify these Terms at any time. Continued use of the Service after changes are posted constitutes your acceptance of the revised Terms. Material changes will require explicit re-acceptance.

11. GOVERNING LAW
These Terms shall be governed by and construed in accordance with applicable law. Any disputes shall be resolved through binding arbitration or in the courts of the applicable jurisdiction.

12. CONTACT
For questions about these Terms, contact us at support@wrapchat.app.

By accepting these Terms, you confirm you have read and understood them in full.`;

const PRIVACY_POLICY_TEXT = `PRIVACY POLICY
Version 1.1 — Last updated 2025

This Privacy Policy explains how WrapChat ("we", "us", "our") collects, uses, and protects your information when you use our Service.

1. INFORMATION WE COLLECT

Account Information
When you create an account, we collect your email address and a hashed version of your password. We do not collect your real name unless you voluntarily provide it.

Chat Data
You upload WhatsApp chat exports to generate reports. These chat exports contain messages written by you and other participants. Chat content is transmitted securely and processed solely to generate your requested analysis. Chat text is not stored on our servers after processing is complete.

Usage Data
We may collect anonymised information about how you use the Service, including which report types you generate and general usage patterns. This data cannot be used to identify you and is used only to improve the Service.

Results Data
The reports generated from your analysis (not the underlying chat text) may be stored on your account so you can access them later. You can delete your saved results at any time.

2. HOW WE USE YOUR INFORMATION

We use your information to:
- Provide and operate the Service
- Generate the analysis reports you request
- Maintain and improve the Service
- Communicate with you about your account
- Comply with legal obligations

We do not sell, rent, or share your personal information with third parties for marketing purposes.

3. AI PROCESSING
Your chat content is processed by AI models to generate insights. Excerpts of your chat may be sent to a third-party AI provider (Anthropic) as part of this processing. Anthropic's use of this data is governed by their API usage policies and privacy practices. Chat content processed through the AI pipeline is not used to train AI models under our current agreements.

4. DATA RETENTION
Account data is retained while your account is active. Processed chat content is not retained after your report is generated. Saved report results are retained until you delete them or close your account.

5. DATA SECURITY
We implement industry-standard security measures to protect your data, including encryption in transit (TLS) and at rest. No method of transmission over the internet is 100% secure. We cannot guarantee absolute security but will notify you promptly in the event of a breach affecting your data.

6. YOUR RIGHTS
Depending on your location, you may have rights including:
- Access to the personal data we hold about you
- Correction of inaccurate data
- Deletion of your account and associated data
- Portability of your data in a machine-readable format
- Withdrawal of consent at any time

To exercise these rights, contact us at privacy@wrapchat.app.

7. COOKIES AND TRACKING
The Service uses essential cookies required for authentication and session management. We do not use tracking or advertising cookies.

8. CHILDREN'S PRIVACY
The Service is not directed to individuals under 18. We do not knowingly collect personal information from anyone under 18. If you believe we have inadvertently collected such information, contact us immediately.

9. CHANGES TO THIS POLICY
We may update this Privacy Policy periodically. We will notify you of material changes by requiring re-acceptance within the app. The version number and date at the top of this document will always reflect the most recent update.

10. CONTACT
For privacy-related questions or to exercise your rights:
Email: privacy@wrapchat.app

By accepting this Privacy Policy, you confirm you have read and understood it in full.`;

const SLIDE_MS   = 480;
const SLIDE_EASE = "cubic-bezier(0.4, 0, 0.2, 1)";

function Shell({ sec, prog, total, children }) {
  const p = PAL[sec] || PAL.upload;
  const onClose = useContext(CloseResultsContext);
  const { dir, id } = useContext(SlideContext);

  // Content-only slide animation — chrome (bg, bar, pill, X) stays perfectly still.
  const prevContentRef = useRef(null);
  const prevIdRef      = useRef(id);
  const [exitContent, setExitContent] = useState(null);

  useLayoutEffect(() => {
    if (id !== prevIdRef.current) {
      setExitContent({ node: prevContentRef.current, dir });
      prevIdRef.current = id;
      const t = setTimeout(() => setExitContent(null), SLIDE_MS);
      return () => clearTimeout(t);
    }
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  prevContentRef.current = children;

  const enterFrom = dir === "fwd" ? "100%"  : "-100%";
  const exitTo    = dir === "fwd" ? "-100%" : "100%";

  return (
    <>
      <style>{`
        .wc-root * { box-sizing: border-box; }
        @keyframes blink { 0%,80%,100%{opacity:.15} 40%{opacity:1} }
        @keyframes fadeUp { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
        .wc-fadeup   { animation: fadeUp 0.4s cubic-bezier(.2,0,.1,1) both; }
        .wc-fadeup-2 { animation: fadeUp 0.4s 0.07s cubic-bezier(.2,0,.1,1) both; }
        .wc-fadeup-3 { animation: fadeUp 0.4s 0.14s cubic-bezier(.2,0,.1,1) both; }
        .wc-btn:hover { opacity:0.82; transform:scale(0.98); }
        @media (max-width: 430px) { .wc-root { border-radius: 0 !important; } }
        @keyframes wcContentIn {
          from { transform: translateX(var(--wc-enter-from)); }
          to   { transform: translateX(0); }
        }
      `}</style>
      <div className="wc-root" style={{
        width: "min(420px, 100vw)",
        minHeight: "100svh",
        margin: "0 auto",
        background: p.bg,
        transition: `background ${SLIDE_MS}ms ${SLIDE_EASE}`,
        borderRadius: 32,
        overflow: "hidden",
        position: "relative",
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        fontFamily: "system-ui, sans-serif",
      }}>
        {/* ── STATIC CHROME — never moves ── */}
        {/* Thin progress bar at very top */}
        <div style={{ position:"absolute", top:0, left:0, right:0, height:3, background:"rgba(255,255,255,0.12)", zIndex:5 }}>
          <div style={{ height:"100%", background:"rgba(255,255,255,0.75)", borderRadius:"0 2px 2px 0", width:`${total>0?Math.round((prog/total)*100):0}%`, transition:"width 0.4s" }} />
        </div>
        {/* Close button */}
        {onClose && (
          <button
            onClick={onClose}
            className="wc-btn"
            aria-label="Close results"
            style={{
              position: "absolute",
              top: 14, right: 14,
              width: 30, height: 30,
              borderRadius: "50%",
              border: "none",
              background: "rgba(255,255,255,0.12)",
              color: "rgba(255,255,255,0.45)",
              fontSize: 15, lineHeight: 1,
              cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              zIndex: 10, padding: 0,
              transition: "all 0.15s",
            }}
          >✕</button>
        )}
        {/* Pill label */}
        {PILL_LABEL[sec] && (
          <div style={{ paddingTop:18, display:"flex", justifyContent:"center", position:"relative", zIndex:4 }}>
            <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:"rgba(255,255,255,0.5)", background:"rgba(255,255,255,0.12)", padding:"5px 14px", borderRadius:20 }}>
              {PILL_LABEL[sec]}
            </div>
          </div>
        )}

        {/* ── SLIDING CONTENT AREA ── */}
        <div style={{ flex:1, position:"relative", overflow:"hidden", display:"flex", flexDirection:"column" }}>
          {/* Outgoing content */}
          {exitContent && (
            <div style={{
              position:"absolute", inset:0,
              display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
              padding:"16px 20px 24px", gap:10,
              transform:`translateX(${exitTo})`,
              transition:`transform ${SLIDE_MS}ms ${SLIDE_EASE}`,
              willChange:"transform",
              pointerEvents:"none",
            }}>
              {exitContent.node}
            </div>
          )}
          {/* Incoming content */}
          <div style={{
            position: exitContent ? "absolute" : "relative",
            inset: exitContent ? 0 : "auto",
            flex: exitContent ? "none" : 1,
            display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
            padding:"16px 20px 24px", gap:10,
            animation: exitContent ? `wcContentIn ${SLIDE_MS}ms ${SLIDE_EASE} both` : "none",
            ["--wc-enter-from"]: enterFrom,
            willChange: exitContent ? "transform" : "auto",
          }}>
            {children}
          </div>
        </div>
      </div>
    </>
  );
}

// Typography — system font, same weights as before
const T   = ({s=26,children}) => (
  <div className="wc-fadeup" style={{ fontSize:s, fontWeight:800, textAlign:"center", lineHeight:1.2, color:"#fff", letterSpacing:-0.5, width:"100%", marginBottom:4 }}>{children}</div>
);
const Big = ({children}) => (
  <div className="wc-fadeup-2" style={{ fontSize:44, fontWeight:800, textAlign:"center", color:"#fff", letterSpacing:-1.5, width:"100%", lineHeight:1.05, wordBreak:"break-word", margin:"6px 0 2px" }}>{children}</div>
);
const Sub = ({children, mt=6}) => (
  <div className="wc-fadeup-3" style={{ fontSize:14, textAlign:"center", color:"rgba(255,255,255,0.65)", lineHeight:1.6, width:"100%", marginTop:mt, fontWeight:400 }}>{children}</div>
);

// Inner card — the chunky rounded inner panel from the reference
function Card({ children, accent, style={} }) {
  const p = accent || PAL.upload;
  const bg = typeof p === "string" ? p : p.inner;
  return (
    <div className="wc-fadeup-2" style={{ width:"100%", background:bg, borderRadius:24, padding:"16px 18px", ...style }}>
      {children}
    </div>
  );
}
// Seeded pick — consistent within a session, different per chat
// Seed is set once when chat is analysed, stored in module scope
let _seed = Date.now();
const setSeed = (n) => { _seed = n; };
const seededRand = (offset) => {
  let x = Math.sin(_seed + offset) * 10000;
  return x - Math.floor(x);
};
// Each call site passes a unique offset so different cards get different picks
// but the same card always shows the same quip within a session
let _pickCount = 0;
const pick = arr => {
  const idx = Math.floor(seededRand(_pickCount++) * arr.length);
  return arr[idx];
};
const resetPicks = () => { _pickCount = 0; };

const Quip = ({children}) => <div className="wc-fadeup-3" style={{ fontSize:14, textAlign:"center", color:"rgba(255,255,255,0.8)", background:"rgba(255,255,255,0.1)", padding:"12px 18px", borderRadius:18, width:"100%", lineHeight:1.55, fontStyle:"italic", fontWeight:500 }}>{children}</div>;

function Dots() {
  return (
    <div style={{ display:"flex", gap:6, padding:"4px 0" }}>
      {[0,1,2].map(i=><div key={i} style={{ width:8,height:8,borderRadius:"50%",background:"rgba(255,255,255,0.4)",animation:`blink 1.2s ${i*0.2}s infinite` }} />)}
    </div>
  );
}

function AICard({ label, value, loading }) {
  return (
    <div className="wc-fadeup-2" style={{ background:"rgba(0,0,0,0.2)", borderRadius:20, padding:"14px 18px", width:"100%" }}>
      <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", color:"rgba(255,255,255,0.45)", marginBottom:8 }}>{label}</div>
      {loading ? <Dots /> : <div style={{ fontSize:15, color:"#fff", lineHeight:1.65, fontWeight:400 }}>{value||"—"}</div>}
    </div>
  );
}

function Btn({ onClick, children }) {
  return <button onClick={onClick} className="wc-btn" style={{ padding:"12px 28px", borderRadius:50, border:"none", background:"rgba(255,255,255,0.15)", color:"#fff", fontSize:15, cursor:"pointer", fontWeight:700, transition:"all 0.15s", flexShrink:0, letterSpacing:0.2 }}>{children}</button>;
}
function Nav({ back, next, showBack=true, nextLabel="Next" }) {
  return (
    <div style={{ display:"flex", gap:10, marginTop:8, width:"100%", justifyContent:"center" }}>
      {showBack && <Btn onClick={back}>← Back</Btn>}
      <Btn onClick={next}>{nextLabel} →</Btn>
    </div>
  );
}
function Bar({ value, max, color, label, delay=0 }) {
  const [w,setW]=useState(0);
  useEffect(()=>{const t=setTimeout(()=>setW(Math.round((value/Math.max(max,1))*100)),120+delay);return()=>clearTimeout(t);},[value,max,delay]);
  const lbl = (label||"").split(" ")[0].slice(0,10);
  return (
    <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8, width:"100%" }}>
      <div style={{ width:58, textAlign:"right", fontSize:13, color:"rgba(255,255,255,0.65)", flexShrink:0, fontWeight:600 }}>{lbl}</div>
      <div style={{ flex:1, minWidth:0, height:32, borderRadius:50, background:"rgba(0,0,0,0.2)", overflow:"hidden" }}>
        <div style={{ height:"100%", width:`${w}%`, minWidth:w>0?"52px":"0", background:color, borderRadius:50, display:"flex", alignItems:"center", paddingLeft:12, fontSize:13, fontWeight:700, color:"#fff", transition:"width 0.9s cubic-bezier(.4,0,.2,1)", whiteSpace:"nowrap" }}>{value.toLocaleString()}</div>
      </div>
    </div>
  );
}
function MonthBadge({ month, count, medal }) {
  return (
    <div style={{ background:"rgba(0,0,0,0.2)", borderRadius:20, padding:"16px 12px", textAlign:"center", flex:1, minWidth:80 }}>
      <div style={{ fontSize:26 }}>{medal}</div>
      <div className="" style={{ fontSize:15, fontWeight:800, color:"#fff", marginTop:8, letterSpacing:-0.3 }}>{month}</div>
      <div style={{ fontSize:12, color:"rgba(255,255,255,0.5)", marginTop:4, fontWeight:500 }}>{count.toLocaleString()} msgs</div>
    </div>
  );
}
function Words({ words }) {
  const M=["🥇","🥈","🥉"];
  return (
    <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:4 }}>
      {words.map(([w,c],i)=>(
        <div key={i} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px", background: i<3 ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.15)", borderRadius:14 }}>
          <span style={{ width:26, fontSize:14, flexShrink:0 }}>{M[i]||i+1}</span>
          <span style={{ flex:1, fontWeight:700, color:"#fff", fontSize:15, letterSpacing:-0.2 }}>{w}</span>
          <span style={{ fontSize:13, color:"rgba(255,255,255,0.55)", fontWeight:600 }}>{c.toLocaleString()}x</span>
        </div>
      ))}
    </div>
  );
}
function Cell({ label, value }) {
  return (
    <div style={{ background:"rgba(0,0,0,0.2)", borderRadius:18, padding:"14px 16px" }}>
      <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", color:"rgba(255,255,255,0.4)", marginBottom:6 }}>{label}</div>
      <div className="" style={{ fontWeight:800, color:"#fff", fontSize:16, wordBreak:"break-word", letterSpacing:-0.3 }}>{value}</div>
    </div>
  );
}
function FlagList({ flags, loading }) {
  const items = normalizeRedFlags(flags);
  if (loading && !items.length) {
    return (
      <div style={{ width:"100%", display:"flex", justifyContent:"center", padding:"12px 0" }}>
        <Dots />
      </div>
    );
  }

  return (
    <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:10 }}>
      {items.map((flag, index) => (
        <div key={`${flag.title}-${index}`} style={{ background:"rgba(0,0,0,0.2)", borderRadius:18, padding:"14px 16px", textAlign:"left" }}>
          <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", color:"rgba(255,255,255,0.45)", marginBottom:7 }}>
            Red flag {index + 1}
          </div>
          <div style={{ fontSize:16, fontWeight:800, color:"#fff", letterSpacing:-0.3, marginBottom:6 }}>
            {flag.title}
          </div>
          <div style={{ fontSize:14, color:"rgba(255,255,255,0.78)", lineHeight:1.6 }}>
            {flag.detail || "This pattern showed up enough to feel worth watching."}
          </div>
          {flag.evidence && (
            <div style={{ fontSize:12, color:"rgba(255,255,255,0.5)", lineHeight:1.5, marginTop:8 }}>
              Evidence: {flag.evidence}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function EvidenceList({ items, loading }) {
  const entries = normalizeTimeline(items);
  if (loading && !entries.length) {
    return (
      <div style={{ width:"100%", display:"flex", justifyContent:"center", padding:"12px 0" }}>
        <Dots />
      </div>
    );
  }

  return (
    <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:10 }}>
      {entries.map((item, index) => (
        <div key={`${item.date}-${index}`} style={{ background:"rgba(0,0,0,0.2)", borderRadius:18, padding:"14px 16px", textAlign:"left" }}>
          <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", color:"rgba(255,255,255,0.45)", marginBottom:7 }}>
            {item.date}
          </div>
          <div style={{ fontSize:15, fontWeight:800, color:"#fff", letterSpacing:-0.25, marginBottom:6 }}>
            {item.title}
          </div>
          {item.detail && (
            <div style={{ fontSize:13, color:"rgba(255,255,255,0.75)", lineHeight:1.6 }}>
              {item.detail}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function TextList({ items }) {
  if (!Array.isArray(items) || !items.length) return null;
  return (
    <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:8 }}>
      {items.map((item, index) => (
        <div key={`${item}-${index}`} style={{ background:"rgba(0,0,0,0.2)", borderRadius:16, padding:"12px 14px", color:"rgba(255,255,255,0.78)", textAlign:"left", fontSize:13, lineHeight:1.55 }}>
          {item}
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// DUO SCREENS
// ─────────────────────────────────────────────────────────────────
function DuoScreen({ s, ai, aiLoading, step, back, next, mode, relationshipType }) {
  const total  = s.msgCounts[0]+s.msgCounts[1];
  const pct0   = Math.round((s.msgCounts[0]/total)*100);
  const mMax   = Math.max(...s.msgCounts);
  const nov    = s.avgMsgLen[0]>=s.avgMsgLen[1]?0:1;
  const TOTAL  = mode === "redflags" ? DUO_REDFLAG_SCREENS : DUO_CASUAL_SCREENS;
  const toxicMax = Math.max(...s.toxicityScores, 1);
  const toxicName = ai?.toxicPerson || s.toxicPerson || (aiLoading ? "..." : s.names[0]);
  const toxicReason = ai?.toxicReason || s.toxicReason;
  const relationshipStatus = ai?.relationshipStatus || s.relationshipStatus || (aiLoading ? "..." : "Complicated");
  const relationshipStatusWhy = ai?.relationshipStatusWhy || s.relationshipStatusWhy;
  const statusEvidence = ai?.statusEvidence || s.statusEvidence;
  const duoFlags = normalizeRedFlags(ai?.redFlags).length ? normalizeRedFlags(ai?.redFlags) : s.redFlags;
  const evidenceTimeline = normalizeTimeline(ai?.evidenceTimeline).length ? normalizeTimeline(ai?.evidenceTimeline) : s.evidenceTimeline;
  const toxicityReport = ai?.toxicityReport || s.toxicityReport;
  const toxicityLevel = s.toxicityLevel;
  const toxicityBreakdown = s.toxicityBreakdown;
  const casualScreens = [
    <Shell sec="roast" prog={1} total={TOTAL}>
      <T>Who's more obsessed?</T>
      <div style={{width:"100%",marginTop:16}}>
        <Bar value={s.msgCounts[0]} max={mMax} color="#E06030" label={s.names[0]} />
        <Bar value={s.msgCounts[1]} max={mMax} color="#4A90D4" label={s.names[1]} delay={160} />
      </div>
      <Sub mt={14}>{pct0}% of all messages came from {s.names[0]}.</Sub>
      {(() => {
      const name = s.names[pct0>=50?0:1];
      const q = pick([
        `"${name}, you might want to check your screen time."`,
        `"${name} really said 'I'll just send one more'... 60,000 times."`,
        `"Therapists call this attachment. ${name} calls it texting."`,
        `"${name} carries this conversation like a backpack they can't take off."`,
        `"${name}'s thumbs deserve a raise."`,
        `"Not obsessed, just... very enthusiastic. Sure, ${name}."`,
      ]);
      return <Quip>{q}</Quip>;
    })()}
      <Nav back={back} next={next} showBack={false} />
    </Shell>,

    <Shell sec="roast" prog={2} total={TOTAL}>
      {s.ghostEqual ? (
        <>
          <T>Response times</T>
          <Big>Balanced</Big>
          <Sub>{s.names[0]} avg reply: <strong style={{color:"#fff"}}>{s.ghostAvg[0]}</strong>&nbsp;&nbsp;{s.names[1]} avg reply: <strong style={{color:"#fff"}}>{s.ghostAvg[1]}</strong></Sub>
          {(() => { const q = pick([
            `"Both of you are equally responsive. No ghosts here."`,
            `"Neither of you keeps the other waiting. Refreshing."`,
            `"Reply times are basically the same. Communication unlocked."`,
            `"Both responsive, both showing up. This is what balance looks like."`,
            `"No ghost award today — you're both equally good at this."`,
          ]); return <Quip>{q}</Quip>; })()}
        </>
      ) : (
        <>
          <T>The Ghost Award</T>
          <Big>{s.ghostName}</Big>
          <Sub>{s.names[0]} avg reply: <strong style={{color:"#fff"}}>{s.ghostAvg[0]}</strong>&nbsp;&nbsp;{s.names[1]} avg reply: <strong style={{color:"#fff"}}>{s.ghostAvg[1]}</strong></Sub>
          <AICard label="What's really going on" value={ai?.ghostContext} loading={aiLoading} />
          {(() => { const q = pick([
            `"${s.ghostName} was 'busy'. Sure."`,
            `"${s.ghostName} saw the message. ${s.ghostName} chose peace."`,
            `"Somewhere, ${s.ghostName} is staring at the message deciding if they feel like it."`,
            `"${s.ghostName}: read at 14:32. Replied at... eventually."`,
            `"${s.ghostName} treats replies like a limited resource."`,
            `"The audacity of ${s.ghostName} taking that long. Iconic, honestly."`,
          ]); return <Quip>{q}</Quip>; })()}
        </>
      )}
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="roast" prog={3} total={TOTAL}>
      <T>The Last Word</T>
      <Big>{s.convKiller}</Big>
      <Sub>Sends the last message that nobody replies to — {s.convKillerCount} times.</Sub>
      {(() => {
      const q = pick([
        `"${s.convKiller} sends a message. The chat decides not to continue. Every time."`,
        `"Last seen: ${s.convKiller}'s message, unanswered."`,
        `"${s.convKiller} has a gift for sending the final word."`,
        `"After ${s.convKiller}'s message — nothing. A recurring pattern."`,
        `"${s.convKiller} says something. The conversation ends. Repeatedly."`,
        `"${s.convKiller}'s messages have a habit of going unanswered."`,
      ]);
      return <Quip>{q}</Quip>;
    })()}
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="lovely" prog={4} total={TOTAL}>
      <T>Your longest streak</T>
      <Big>{s.streak} days</Big>
      <Sub>Texted every single day for {s.streak} days straight.</Sub>
      {(() => {
        const q = s.streak >= 100 ? pick([
          `"${s.streak} days. That's not a streak, that's a lifestyle."`,
          `"Over ${s.streak} consecutive days. Whatever this is, it's real."`,
          `"Most relationships don't have a ${s.streak}-day streak. This one does."`,
          `"${s.streak} days straight. That's dedication most people only have for Netflix."`,
          `"Not one day missed in ${s.streak} days. Someone was always there first."`,
        ]) : s.streak >= 30 ? pick([
          `"${s.streak} days without a gap. That kind of consistency is rare."`,
          `"Whatever was going on during those ${s.streak} days, it was good."`,
          `"A whole month-plus of showing up. That means something."`,
          `"No gaps. No excuses. Just ${s.streak} days straight."`,
          `"Consistent. Reliable. Wholesome. Almost suspicious."`,
        ]) : s.streak >= 10 ? pick([
          `"${s.streak} days in a row. Not bad at all."`,
          `"Okay, that's actually kind of cute."`,
          `"${s.streak} days without missing a single one. That counts."`,
          `"Some people do yoga streaks. These two do this."`,
          `"A solid run. Something was clearly working during those ${s.streak} days."`,
        ]) : pick([
          `"${s.streak} days. Short but real."`,
          `"Even a ${s.streak}-day streak is something."`,
          `"Quality over quantity. These ${s.streak} days counted."`,
          `"${s.streak} days of not missing each other. That's the important part."`,
        ]);
        return <Quip>{q}</Quip>;
      })()}
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="lovely" prog={5} total={TOTAL}>
      <T>The Kindest One</T>
      <Big>{aiLoading ? "..." : (ai?.kindestPerson || "")}</Big>
      <AICard label="The sweetest moment" value={ai?.sweetMoment} loading={aiLoading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="lovely" prog={7} total={TOTAL}>
      <T>Top 3 most active months</T>
      <div style={{display:"flex",gap:10,marginTop:16,width:"100%",justifyContent:"center"}}>
        {s.topMonths.map((m,i)=><MonthBadge key={i} month={m[0]} count={m[1]} medal={["🥇","🥈","🥉"][i]} />)}
      </div>
      <Sub mt={14}>{s.topMonths[0][0]} was your month. Something was going on.</Sub>
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="lovely" prog={6} total={TOTAL}>
      <T>Who always reaches out first?</T>
      <Big>{s.convStarter}</Big>
      <Sub>Started {s.convStarterPct} of all conversations.</Sub>
      {(() => {
      const q = pick([
        `"Someone's always thinking of the other one first."`,
        `"${s.convStarter} woke up and chose communication."`,
        `"${s.convStarter} carries the emotional labour of starting every chat. Respect."`,
        `"${s.convStarter} is always the one who breaks the silence first."`,
        `"${s.convStarter} out here keeping this friendship alive single-handedly."`,
        `"The first text is always from ${s.convStarter}. That says everything."`,
      ]);
      return <Quip>{q}</Quip>;
    })()}
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="funny" prog={8} total={TOTAL}>
      <T>The Funny One</T>
      <Big>{aiLoading?"...":(ai?.funniestPerson||s.names[0])}</Big>
      <AICard label="Drops lines like" value={ai?.funniestReason} loading={aiLoading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="funny" prog={9} total={TOTAL}>
      <T>Spirit emojis</T>
      <div style={{display:"flex",gap:0,marginTop:16,width:"100%",justifyContent:"space-around"}}>
        {[0,1].map(i=>(
          <div key={i} style={{textAlign:"center"}}>
            <div style={{fontSize:64,lineHeight:1}}>{s.spiritEmoji[i]}</div>
            <div style={{fontSize:13,color:"rgba(255,255,255,0.5)",marginTop:8}}>{s.names[i]}</div>
          </div>
        ))}
      </div>
      <Sub>These two emojis basically ARE this chat.</Sub>
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="funny" prog={10} total={TOTAL}>
      <T>Top 10 most used words</T>
      <Words words={s.topWords} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="funny" prog={11} total={TOTAL}>
      <T>Signature phrases</T>
      <div style={{display:"flex",gap:"1rem",marginTop:16,width:"100%",justifyContent:"center"}}>
        {[0,1].map(i=>(
          <div key={i} style={{background:"rgba(255,255,255,0.08)",padding:"14px 18px",borderRadius:12,textAlign:"center",flex:1}}>
            {aiLoading?<Dots />:<div style={{fontSize:14,fontWeight:700,color:"#fff",fontStyle:"italic"}}>"{ai?.signaturePhrase?.[i]||s.signatureWord[i]}"</div>}
            <div style={{fontSize:12,color:"rgba(255,255,255,0.42)",marginTop:6}}>{s.names[i]}</div>
          </div>
        ))}
      </div>
      <Sub>The phrases that define each of you.</Sub>
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="stats" prog={12} total={TOTAL}>
      {(() => {
        const diff = Math.abs(s.avgMsgLen[0] - s.avgMsgLen[1]);
        const ratio = Math.max(...s.avgMsgLen) / Math.max(Math.min(...s.avgMsgLen), 1);
        const isSimilar = diff < 15 || ratio < 1.3;
        const novelist = s.names[nov];
        const texter   = s.names[nov===0?1:0];
        return <>
          <T>{isSimilar ? "Message length" : "The Novelist vs The Texter"}</T>
          <div style={{display:"flex",gap:0,marginTop:16,width:"100%",justifyContent:"space-around",alignItems:"center"}}>
            {[0,1].map(i=>(
              <div key={i} style={{textAlign:"center"}}>
                <div style={{fontSize:36,fontWeight:800,color:"#fff"}}>{s.avgMsgLen[i]}</div>
                <div style={{fontSize:11,color:"rgba(255,255,255,0.45)",marginTop:2}}>avg chars</div>
                <div style={{fontSize:11,color:"rgba(255,255,255,0.3)",marginTop:1}}>max {(s.maxMsgLen?.[i] ?? 0).toLocaleString()}</div>
                <div style={{fontSize:12,color:"rgba(255,255,255,0.5)",marginTop:4}}>{s.names[i]}</div>
              </div>
            ))}
          </div>
          {(() => {
            const q = isSimilar ? pick([
              `"Both of you say exactly as much as you need to. Efficient."`,
              `"Almost identical message lengths. Either you're perfectly matched or both just bad at texting."`,
              `"No novelist here, no texter either. Just two people who type about the same amount."`,
              `"Balanced. No essays, no one-word replies. Suspiciously normal."`,
            ]) : pick([
              `"${novelist} treats every text like a letter to posterity."`,
              `"${novelist} could've said it in five words. They used forty. Beautifully."`,
              `"Somewhere ${novelist} is still typing."`,
              `"${texter} replies. ${novelist} responds. There's a difference."`,
              `"${novelist} sends paragraphs. ${texter} sends sentences. Both somehow work."`,
            ]);
            return <Quip>{q}</Quip>;
          })()}
        </>;
      })()}
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="stats" prog={13} total={TOTAL}>
      <T>Media and links</T>
      <div style={{width:"100%",marginTop:16}}>
        <div style={{fontSize:11,color:"rgba(255,255,255,0.38)",marginBottom:8,textTransform:"uppercase",letterSpacing:"0.07em"}}>Photos & videos</div>
        <Bar value={s.mediaCounts[0]} max={Math.max(...s.mediaCounts,1)} color="#3ABDA0" label={s.names[0]} />
        <Bar value={s.mediaCounts[1]} max={Math.max(...s.mediaCounts,1)} color="#4A90D4" label={s.names[1]} delay={160} />
        <div style={{fontSize:11,color:"rgba(255,255,255,0.38)",margin:"16px 0 8px",textTransform:"uppercase",letterSpacing:"0.07em"}}>Voice memos</div>
        <Bar value={s.voiceCounts[0]} max={Math.max(...s.voiceCounts,1)} color="#C880F0" label={s.names[0]} />
        <Bar value={s.voiceCounts[1]} max={Math.max(...s.voiceCounts,1)} color="#9050D0" label={s.names[1]} delay={160} />
        <div style={{fontSize:11,color:"rgba(255,255,255,0.38)",margin:"16px 0 8px",textTransform:"uppercase",letterSpacing:"0.07em"}}>Links shared</div>
        <Bar value={s.linkCounts[0]} max={Math.max(...s.linkCounts,1)} color="#3ABDA0" label={s.names[0]} />
        <Bar value={s.linkCounts[1]} max={Math.max(...s.linkCounts,1)} color="#4A90D4" label={s.names[1]} delay={160} />
      </div>
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
      <AICard label={relReadLabel(relationshipType)} value={ai?.relationshipSummary} loading={aiLoading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="ai" prog={17} total={TOTAL}>
      <T>Chat vibe</T>
      <div style={{background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:14,padding:"1.4rem 1.5rem",width:"100%",textAlign:"center",marginTop:16,fontSize:16,lineHeight:1.7,fontStyle:"italic",color:"#fff",minHeight:80,display:"flex",alignItems:"center",justifyContent:"center",boxSizing:"border-box"}}>
        {aiLoading?<Dots />:(ai?.vibeOneLiner||"A chaotic, wholesome connection.")}
      </div>
      <Sub mt={14}>Powered by AI — your messages never left your device.</Sub>
      <Nav back={back} next={next} nextLabel="See summary" />
    </Shell>,
  ];
  const redFlagScreens = [
    <Shell sec="ai" prog={1} total={TOTAL}>
      <T>Relationship reading</T>
      <Big>{relationshipStatus}</Big>
      <AICard label="Observed pattern" value={relationshipStatusWhy} loading={aiLoading && !relationshipStatusWhy} />
      <AICard label="Concrete example" value={statusEvidence} loading={aiLoading && !statusEvidence} />
      <Nav back={back} next={next} showBack={false} />
    </Shell>,

    <Shell sec="ai" prog={2} total={TOTAL}>
      <T>Evidence log</T>
      <EvidenceList items={evidenceTimeline} loading={aiLoading && !evidenceTimeline?.length} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="roast" prog={3} total={TOTAL}>
      <T>What the chat shows</T>
      <FlagList flags={duoFlags} loading={aiLoading && !duoFlags?.length} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="stats" prog={4} total={TOTAL}>
      <T>Toxicity scorecard</T>
      <Big>{toxicName}</Big>
      <div style={{width:"100%",marginTop:10}}>
        <Bar value={s.toxicityScores[0]} max={toxicMax} color="#E06030" label={s.names[0]} />
        <Bar value={s.toxicityScores[1]} max={toxicMax} color="#4A90D4" label={s.names[1]} delay={160} />
      </div>
      <AICard label="Why this person scores highest" value={toxicReason} loading={aiLoading && !toxicReason} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="ai" prog={5} total={TOTAL}>
      <T>Tension snapshot</T>
      <AICard label="Most tense moment" value={ai?.tensionMoment} loading={aiLoading} />
      <AICard label={relReadLabel(relationshipType)} value={ai?.relationshipSummary} loading={aiLoading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="ai" prog={6} total={TOTAL}>
      <T>What keeps repeating</T>
      <AICard label="Main topic" value={ai?.biggestTopic} loading={aiLoading} />
      <AICard label="Pattern note" value={duoFlags[0]?.detail || "The strongest pattern is shown above."} loading={aiLoading && !duoFlags[0]?.detail} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="roast" prog={7} total={TOTAL}>
      <T>Toxicity report</T>
      <Big>{toxicityLevel}</Big>
      <AICard label="Overall read" value={toxicityReport} loading={aiLoading && !toxicityReport} />
      <AICard label="Score breakdown" value={toxicityBreakdown?.join(" • ")} loading={false} />
      <Sub mt={14}>This mode is meant to surface patterns and examples, not make the decision for you.</Sub>
      <Nav back={back} next={next} nextLabel="See summary" />
    </Shell>,
  ];
  const screens = mode === "redflags" ? redFlagScreens : casualScreens;
  return screens[step]??null;
}

// ─────────────────────────────────────────────────────────────────
// GROUP SCREENS
// ─────────────────────────────────────────────────────────────────
function GroupScreen({ s, ai, aiLoading, step, back, next, mode }) {
  const mMax   = Math.max(...s.msgCounts,1);
  const COLORS = ["#E06030","#4A90D4","#3ABDA0","#C4809A","#8A70D4","#D4A840"];
  const TOTAL  = mode === "redflags" ? GROUP_REDFLAG_SCREENS : GROUP_CASUAL_SCREENS;
  const toxicMax = Math.max(...s.toxicityScores, 1);
  const toxicName = ai?.toxicPerson || s.toxicPerson || s.names[0];
  const toxicReason = ai?.toxicReason || s.toxicReason;
  const groupFlags = normalizeRedFlags(ai?.redFlags).length ? normalizeRedFlags(ai?.redFlags) : s.redFlags;
  const evidenceTimeline = normalizeTimeline(ai?.evidenceTimeline).length ? normalizeTimeline(ai?.evidenceTimeline) : s.evidenceTimeline;
  const toxicityReport = ai?.toxicityReport || s.toxicityReport;
  const toxicityLevel = s.toxicityLevel;
  const toxicityBreakdown = s.toxicityBreakdown;
  const casualScreens = [
    <Shell sec="roast" prog={1} total={TOTAL}>
      <T>The Main Character</T>
      <Big>{s.mainChar}</Big>
      <div style={{width:"100%",marginTop:10}}>
        {s.names.slice(0,6).map((n,i)=><Bar key={n} value={s.msgCounts[i]} max={mMax} color={COLORS[i%COLORS.length]} label={n} delay={i*80} />)}
      </div>
      {(() => {
      const q = pick([
        `"${s.mainChar}, this is basically your personal blog."`,
        `"${s.mainChar} came here to talk and is absolutely doing that."`,
        `"The group chat exists because ${s.mainChar} needed an audience."`,
        `"${s.mainChar} didn't start the group but they certainly run it."`,
        `"Without ${s.mainChar} this chat would be a graveyard."`,
        `"${s.mainChar}: present, vocal, and apparently never sleeping."`,
      ]);
      return <Quip>{q}</Quip>;
    })()}
      <Nav back={back} next={next} showBack={false} />
    </Shell>,

    <Shell sec="roast" prog={2} total={TOTAL}>
      <T>The Ghost</T>
      <Big>{s.ghost}</Big>
      <Sub>{s.msgCounts[s.msgCounts.length-1].toLocaleString()} messages total. Why are they even here?</Sub>
      {(() => {
      const q = pick([
        `"Read receipts but never replies. A legend."`,
        `"${s.ghost} is here in spirit. Only in spirit."`,
        `"${s.ghost} joined the group and immediately went into witness protection."`,
        `"The group carries ${s.ghost}. ${s.ghost} does not carry the group."`,
        `"${s.ghost} has seen everything. Said nothing. Knows everything."`,
        `"A silent observer. A lurker. A mystery. ${s.ghost}."`,
      ]);
      return <Quip>{q}</Quip>;
    })()}
      <AICard label="What's really going on" value={ai?.ghostContext} loading={aiLoading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="roast" prog={3} total={TOTAL}>
      <T>The Last Word</T>
      <Big>{s.convKiller}</Big>
      <Sub>Sends the last message that nobody replies to.</Sub>
      {(() => {
      const q = pick([
        `"${s.convKiller} sends a message. The group doesn't respond. Classic."`,
        `"The last word, unanswered — that's ${s.convKiller}'s signature move."`,
        `"After ${s.convKiller}'s message, the group goes quiet every time."`,
        `"${s.convKiller} has a habit of sending messages into the void."`,
        `"A message was sent. The group moved on. A pattern was born."`,
        `"${s.convKiller}'s messages have a way of ending the conversation."`,
      ]);
      return <Quip>{q}</Quip>;
    })()}
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="lovely" prog={4} total={TOTAL}>
      <T>Top 3 most active months</T>
      <div style={{display:"flex",gap:10,marginTop:16,width:"100%",justifyContent:"center"}}>
        {s.topMonths.map((m,i)=><MonthBadge key={i} month={m[0]} count={m[1]} medal={["🥇","🥈","🥉"][i]} />)}
      </div>
      <Sub mt={14}>The group was most alive in {s.topMonths[0][0]}.</Sub>
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="lovely" prog={5} total={TOTAL}>
      <T>Longest active streak</T>
      <Big>{s.streak} days</Big>
      <Sub>The group kept the chat alive for {s.streak} days straight.</Sub>
      {(() => {
        const q = s.streak >= 100 ? pick([
          `"${s.streak} days without a single gap. This group is built different."`,
          `"Over ${s.streak} consecutive days. That's not a group chat, that's a commitment."`,
          `"${s.streak} days straight. Most group chats are lucky to last ${s.streak} weeks."`,
          `"Whatever keeps this group going, bottle it."`,
        ]) : s.streak >= 30 ? pick([
          `"${s.streak} days of showing up. That's a real group."`,
          `"Not a single day off. This group has commitment issues in reverse."`,
          `"A streak like that doesn't happen by accident."`,
          `"Most group chats go quiet after 2 weeks. This one didn't."`,
        ]) : s.streak >= 10 ? pick([
          `"${s.streak} days in a row. The group was alive."`,
          `"You all actually like each other. Surprising."`,
          `"${s.streak} consecutive days. That's more than most groups manage."`,
        ]) : pick([
          `"${s.streak} days. Small but it counts."`,
          `"A ${s.streak}-day run. Something was going on in the group."`,
          `"Even ${s.streak} days in a row takes effort."`,
        ]);
        return <Quip>{q}</Quip>;
      })()}
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="lovely" prog={6} total={TOTAL}>
      <T>The Hype Person</T>
      <Big>{s.hype}</Big>
      <Sub>Started {s.convStarterPct} of all conversations. The engine of this group.</Sub>
      <AICard label={`Why ${s.hype} is the hype`} value={ai?.hypePersonReason} loading={aiLoading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="lovely" prog={7} total={TOTAL}>
      <T>The Kindest One</T>
      <Big>{aiLoading ? "..." : (ai?.kindestPerson || "")}</Big>
      <AICard label="The sweetest moment" value={ai?.sweetMoment} loading={aiLoading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="funny" prog={8} total={TOTAL}>
      <T>The Funny One</T>
      <Big>{aiLoading?"...":(ai?.funniestPerson||s.names[0])}</Big>
      <AICard label="Drops lines like" value={ai?.funniestReason} loading={aiLoading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="funny" prog={9} total={TOTAL}>
      <T>Group spirit emoji</T>
      <div style={{fontSize:90,textAlign:"center",marginTop:16,lineHeight:1,width:"100%"}}>{s.spiritEmoji[0]}</div>
      <Sub>This one emoji basically summarises the entire group energy.</Sub>
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="funny" prog={10} total={TOTAL}>
      <T>Top 10 most used words</T>
      <Words words={s.topWords} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="stats" prog={11} total={TOTAL}>
      <T>The Novelist</T>
      <Big>{s.novelist}</Big>
      <div style={{display:"flex",gap:0,marginTop:12,width:"100%",justifyContent:"space-around"}}>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:28,fontWeight:800,color:"#fff"}}>{s.avgMsgLen[[...s.names].sort((a,b)=>s.msgCounts[s.names.indexOf(b)]-s.msgCounts[s.names.indexOf(a)]).indexOf(s.novelist)]||s.avgMsgLen[0]}</div>
          <div style={{fontSize:11,color:"rgba(255,255,255,0.45)",marginTop:3}}>avg chars</div>
        </div>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:28,fontWeight:800,color:"#fff"}}>{s.novelistMaxLen.toLocaleString()}</div>
          <div style={{fontSize:11,color:"rgba(255,255,255,0.45)",marginTop:3}}>longest message</div>
        </div>
      </div>
      {s.novelistLongestTopic && <Sub mt={8}>Their longest message was mostly about <strong style={{color:"#fff"}}>"{s.novelistLongestTopic}"</strong>.</Sub>}
      <Quip>"{s.novelist} types like the word limit doesn't exist."</Quip>
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="stats" prog={12} total={TOTAL}>
      <T>Group roles</T>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginTop:16,width:"100%"}}>
        <Cell label={s.photographerIsVoice ? "Voice Note Addict" : "Photographer"} value={s.photographer} />
        <Cell label="The Therapist" value={s.therapist} />
        <Cell label="Night owl" value={s.nightOwl} />
        <Cell label="Early bird" value={s.earlyBird} />
        <Cell label="Voice memo king" value={s.voiceChampion} />
      </div>
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="ai" prog={13} total={TOTAL}>
      <T>What you actually talk about</T>
      <AICard label="Biggest topic" value={ai?.biggestTopic} loading={aiLoading} />
      <AICard label="The inside joke" value={ai?.insideJoke} loading={aiLoading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="ai" prog={14} total={TOTAL}>
      <T>The Drama Report</T>
      <Big>{aiLoading?"...":(ai?.dramaStarter||s.names[0])}</Big>
      <AICard label="How they do it" value={ai?.dramaContext} loading={aiLoading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="ai" prog={15} total={TOTAL}>
      <T>Most missed member</T>
      <Big>{aiLoading?"...":(ai?.mostMissed||s.names[0])}</Big>
      <Sub>When they go quiet, the group feels it.</Sub>
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="ai" prog={16} total={TOTAL}>
      <T>The group read</T>
      <AICard label="Group dynamic" value={ai?.groupDynamic} loading={aiLoading} />
      <AICard label="Most tense moment" value={ai?.tensionMoment} loading={aiLoading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="ai" prog={17} total={TOTAL}>
      <T>Group vibe</T>
      <div style={{background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:14,padding:"1.4rem 1.5rem",width:"100%",textAlign:"center",marginTop:16,fontSize:16,lineHeight:1.7,fontStyle:"italic",color:"#fff",minHeight:80,display:"flex",alignItems:"center",justifyContent:"center",boxSizing:"border-box"}}>
        {aiLoading?<Dots />:(ai?.vibeOneLiner||"Chaotic. Wholesome. Somehow still going.")}
      </div>
      <Sub mt={14}>Powered by AI — your messages never left your device.</Sub>
      <Nav back={back} next={next} nextLabel="See summary" />
    </Shell>,
  ];
  const redFlagScreens = [
    <Shell sec="ai" prog={1} total={TOTAL}>
      <T>Group pattern read</T>
      <AICard label="Group dynamic" value={ai?.groupDynamic} loading={aiLoading} />
      <AICard label="Most tense moment" value={ai?.tensionMoment} loading={aiLoading} />
      <Nav back={back} next={next} showBack={false} />
    </Shell>,

    <Shell sec="ai" prog={2} total={TOTAL}>
      <T>Evidence log</T>
      <EvidenceList items={evidenceTimeline} loading={aiLoading && !evidenceTimeline?.length} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="roast" prog={3} total={TOTAL}>
      <T>What the chat shows</T>
      <FlagList flags={groupFlags} loading={aiLoading && !groupFlags?.length} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="stats" prog={4} total={TOTAL}>
      <T>Toxicity scorecard</T>
      <Big>{aiLoading && !toxicName ? "..." : toxicName}</Big>
      <div style={{width:"100%",marginTop:10}}>
        {s.names.slice(0,4).map((n,i)=><Bar key={n} value={s.toxicityScores[i]} max={toxicMax} color={COLORS[i%COLORS.length]} label={n} delay={i*80} />)}
      </div>
      <AICard label="Why this person scores highest" value={toxicReason} loading={aiLoading && !toxicReason} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="ai" prog={5} total={TOTAL}>
      <T>Support and strain</T>
      <AICard label="Who keeps it going" value={s.hype ? `${s.hype} started ${s.convStarterPct} of conversations.` : "The group shares the conversation starts."} loading={false} />
      <AICard label="Who goes quiet" value={s.ghost ? `${s.ghost} is the least active member in the sampled history.` : "No clear ghost in this sample."} loading={false} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="roast" prog={6} total={TOTAL}>
      <T>Toxicity report</T>
      <Big>{toxicityLevel}</Big>
      <AICard label="Overall read" value={toxicityReport} loading={aiLoading && !toxicityReport} />
      <AICard label="Score breakdown" value={toxicityBreakdown?.join(" • ")} loading={false} />
      <Sub mt={14}>This mode is meant to surface patterns and examples, not make the decision for you.</Sub>
      <Nav back={back} next={next} nextLabel="See summary" />
    </Shell>,
  ];
  const screens = mode === "redflags" ? redFlagScreens : casualScreens;
  return screens[step]??null;
}

// ─────────────────────────────────────────────────────────────────
// SCORE RING — animated circular score display
// ─────────────────────────────────────────────────────────────────
function ScoreRing({ score, max=10, size=110, color="#fff" }) {
  const [pct, setPct] = useState(0);
  useEffect(() => { const t = setTimeout(() => setPct(score / max), 150); return () => clearTimeout(t); }, [score, max]);
  const r = (size - 16) / 2;
  const circ = 2 * Math.PI * r;
  return (
    <div style={{ position:"relative", width:size, height:size, flexShrink:0 }}>
      <svg width={size} height={size} style={{ transform:"rotate(-90deg)" }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={8} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={8}
          strokeDasharray={circ} strokeDashoffset={circ * (1 - pct)}
          strokeLinecap="round" style={{ transition:"stroke-dashoffset 1s cubic-bezier(.4,0,.2,1)" }} />
      </svg>
      <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" }}>
        <div style={{ fontSize:size > 90 ? 28 : 20, fontWeight:800, color:"#fff", lineHeight:1 }}>{score}</div>
        <div style={{ fontSize:10, color:"rgba(255,255,255,0.45)", marginTop:2 }}>/{max}</div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// TOXICITY REPORT SCREENS  (7 cards)
// ─────────────────────────────────────────────────────────────────
const TOXICITY_SCREENS = 7;
function ToxicityReportScreen({ s, ai, aiLoading, step, back, next }) {
  const loading = aiLoading && !ai;
  const screens = [
    <Shell sec="toxicity" prog={1} total={TOXICITY_SCREENS}>
      <T>Chat Health Score</T>
      <div style={{ marginTop:16, display:"flex", justifyContent:"center" }}>
        <ScoreRing score={loading ? 0 : (ai?.chatHealthScore || 5)} max={10} size={130} color="#E04040" />
      </div>
      <Sub mt={12}>Out of 10 — based on conflict patterns, communication style, and overall dynamic.</Sub>
      <AICard label="Verdict" value={ai?.verdict} loading={loading} />
      <Nav back={back} next={next} showBack={false} />
    </Shell>,

    <Shell sec="toxicity" prog={2} total={TOXICITY_SCREENS}>
      <T>Individual health scores</T>
      <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:12, marginTop:16 }}>
        {(loading ? s.names.slice(0,2).map(n=>({name:n,score:5,detail:"Analysing…"})) : (ai?.healthScores||[])).map((p, i) => (
          <div key={i} style={{ background:"rgba(0,0,0,0.2)", borderRadius:20, padding:"16px 18px", display:"flex", alignItems:"center", gap:14 }}>
            <ScoreRing score={loading ? 0 : (p.score||5)} max={10} size={80} color={i===0?"#E06030":"#4A90D4"} />
            <div style={{ flex:1 }}>
              <div style={{ fontSize:17, fontWeight:800, color:"#fff", marginBottom:4 }}>{p.name}</div>
              <div style={{ fontSize:13, color:"rgba(255,255,255,0.65)", lineHeight:1.55 }}>{loading ? "…" : (p.detail||"—")}</div>
            </div>
          </div>
        ))}
      </div>
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="toxicity" prog={3} total={TOXICITY_SCREENS}>
      <T>Who apologises more</T>
      <Big>{loading ? "…" : (ai?.apologiesLeader?.name || s.names[0])}</Big>
      <AICard label={`${(loading?"…":ai?.apologiesLeader?.name) || s.names[0]} — context`} value={ai?.apologiesLeader?.context} loading={loading} />
      <AICard label={`${(loading?"…":ai?.apologiesOther?.name) || s.names[1]||s.names[0]} — context`} value={ai?.apologiesOther?.context} loading={loading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="toxicity" prog={4} total={TOXICITY_SCREENS}>
      <T>Red flag moments</T>
      {loading
        ? <div style={{ display:"flex", justifyContent:"center", padding:"20px 0" }}><Dots /></div>
        : <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:10, marginTop:8 }}>
            {(ai?.redFlagMoments||[]).map((m, i) => (
              <div key={i} style={{ background:"rgba(0,0,0,0.2)", borderRadius:18, padding:"14px 16px", textAlign:"left" }}>
                <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", color:"rgba(255,255,255,0.45)", marginBottom:6 }}>{m.date} • {m.person}</div>
                <div style={{ fontSize:14, fontWeight:700, color:"#fff", marginBottom:4 }}>{m.description}</div>
                {m.quote && <div style={{ fontSize:12, color:"rgba(255,255,255,0.55)", fontStyle:"italic" }}>"{m.quote}"</div>}
              </div>
            ))}
          </div>
      }
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="toxicity" prog={5} total={TOXICITY_SCREENS}>
      <T>Conflict pattern</T>
      <AICard label="How arguments unfold" value={ai?.conflictPattern} loading={loading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="toxicity" prog={6} total={TOXICITY_SCREENS}>
      <T>Power balance</T>
      <Big>{loading ? "…" : (ai?.powerHolder || "Balanced")}</Big>
      <AICard label="Power dynamic" value={ai?.powerBalance} loading={loading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="toxicity" prog={7} total={TOXICITY_SCREENS}>
      <T>The verdict</T>
      <div style={{ marginTop:16, display:"flex", justifyContent:"center" }}>
        <ScoreRing score={loading ? 0 : (ai?.chatHealthScore||5)} max={10} size={130} color="#E04040" />
      </div>
      <Sub mt={8}>Overall chat health score.</Sub>
      <AICard label="Final read" value={ai?.verdict} loading={loading} />
      <Sub mt={8}>Reflects patterns in this sample — not a final judgment.</Sub>
      <Nav back={back} next={next} nextLabel="Done" />
    </Shell>,
  ];
  return screens[step] ?? null;
}

// ─────────────────────────────────────────────────────────────────
// LOVE LANGUAGE REPORT SCREENS  (5 cards)
// ─────────────────────────────────────────────────────────────────
const LOVELANG_SCREENS = 5;
function LoveLangReportScreen({ s, ai, aiLoading, step, back, next }) {
  const loading = aiLoading && !ai;
  const screens = [
    <Shell sec="lovelang" prog={1} total={LOVELANG_SCREENS}>
      <T>{loading ? "…" : (ai?.personA?.name || s.names[0])}'s love language</T>
      <div style={{ marginTop:12, display:"flex", flexDirection:"column", alignItems:"center", gap:4 }}>
        <div style={{ fontSize:60, lineHeight:1 }}>{loading ? "💝" : (ai?.personA?.languageEmoji || "💝")}</div>
        <Big>{loading ? "…" : (ai?.personA?.language || "—")}</Big>
      </div>
      <AICard label="How they show it" value={ai?.personA?.examples} loading={loading} />
      <Nav back={back} next={next} showBack={false} />
    </Shell>,

    <Shell sec="lovelang" prog={2} total={LOVELANG_SCREENS}>
      <T>{loading ? "…" : (ai?.personB?.name || s.names[1]||s.names[0])}'s love language</T>
      <div style={{ marginTop:12, display:"flex", flexDirection:"column", alignItems:"center", gap:4 }}>
        <div style={{ fontSize:60, lineHeight:1 }}>{loading ? "💝" : (ai?.personB?.languageEmoji || "💝")}</div>
        <Big>{loading ? "…" : (ai?.personB?.language || "—")}</Big>
      </div>
      <AICard label="How they show it" value={ai?.personB?.examples} loading={loading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="lovelang" prog={3} total={LOVELANG_SCREENS}>
      <T>The language gap</T>
      <AICard label="Do they speak the same language?" value={ai?.mismatch} loading={loading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="lovelang" prog={4} total={LOVELANG_SCREENS}>
      <T>Most loving moment</T>
      <div style={{ fontSize:40, textAlign:"center", marginTop:16 }}>💕</div>
      <AICard label="The moment" value={ai?.mostLovingMoment} loading={loading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="lovelang" prog={5} total={LOVELANG_SCREENS}>
      <T>Love language compatibility</T>
      <div style={{ marginTop:16, display:"flex", justifyContent:"center" }}>
        <ScoreRing score={loading ? 0 : (ai?.compatibilityScore||5)} max={10} size={130} color="#F08EBF" />
      </div>
      <AICard label="Compatibility read" value={ai?.compatibilityRead} loading={loading} />
      <Nav back={back} next={next} nextLabel="Done" />
    </Shell>,
  ];
  return screens[step] ?? null;
}

// ─────────────────────────────────────────────────────────────────
// GROWTH REPORT SCREENS  (5 cards)
// ─────────────────────────────────────────────────────────────────
const GROWTH_SCREENS = 5;
function GrowthReportScreen({ s, ai, aiLoading, step, back, next }) {
  const loading = aiLoading && !ai;
  const arrowMap = { deeper:"↑", shallower:"↓", "about the same":"→" };
  const trajMap  = { closer:"Getting closer", drifting:"Drifting apart", stable:"Holding steady" };
  const screens = [
    <Shell sec="growth" prog={1} total={GROWTH_SCREENS}>
      <T>Then vs Now</T>
      <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:10, marginTop:16 }}>
        <div style={{ background:"rgba(0,0,0,0.2)", borderRadius:20, padding:"16px 18px", borderLeft:"3px solid rgba(255,255,255,0.2)" }}>
          <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", color:"rgba(255,255,255,0.5)", marginBottom:6 }}>Early messages</div>
          <div style={{ fontSize:14, color:"#fff", lineHeight:1.6 }}>{loading ? <Dots /> : (ai?.thenDepth||"—")}</div>
        </div>
        <div style={{ background:"rgba(0,0,0,0.2)", borderRadius:20, padding:"16px 18px", borderLeft:"3px solid #3AF0C0" }}>
          <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", color:"rgba(255,255,255,0.5)", marginBottom:6 }}>Recent messages</div>
          <div style={{ fontSize:14, color:"#fff", lineHeight:1.6 }}>{loading ? <Dots /> : (ai?.nowDepth||"—")}</div>
        </div>
      </div>
      {!loading && ai?.depthChange && (
        <Sub mt={8}>Conversations got <strong style={{color:"#3AF0C0"}}>{ai.depthChange}</strong> {arrowMap[ai.depthChange]||""} over time.</Sub>
      )}
      <Nav back={back} next={next} showBack={false} />
    </Shell>,

    <Shell sec="growth" prog={2} total={GROWTH_SCREENS}>
      <T>Who changed more</T>
      <Big>{loading ? "…" : (ai?.whoChangedMore||"—")}</Big>
      <AICard label="How they changed" value={ai?.whoChangedHow} loading={loading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="growth" prog={3} total={GROWTH_SCREENS}>
      <T>What changed in the chat</T>
      <AICard label="Topics that appeared" value={ai?.topicsAppeared} loading={loading} />
      <AICard label="Topics that faded" value={ai?.topicsDisappeared} loading={loading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="growth" prog={4} total={GROWTH_SCREENS}>
      <T>Relationship trajectory</T>
      <Big>{loading ? "…" : (trajMap[ai?.trajectory]||ai?.trajectory||"—")}</Big>
      <AICard label="What the data shows" value={ai?.trajectoryDetail} loading={loading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="growth" prog={5} total={GROWTH_SCREENS}>
      <T>The arc</T>
      <div style={{ background:"rgba(255,255,255,0.07)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:14, padding:"1.4rem 1.5rem", width:"100%", textAlign:"center", marginTop:16, fontSize:16, lineHeight:1.7, fontStyle:"italic", color:"#fff", minHeight:80, display:"flex", alignItems:"center", justifyContent:"center" }}>
        {loading ? <Dots /> : (ai?.arcSummary||"—")}
      </div>
      <Nav back={back} next={next} nextLabel="Done" />
    </Shell>,
  ];
  return screens[step] ?? null;
}

// ─────────────────────────────────────────────────────────────────
// ACCOUNTABILITY REPORT SCREENS  (5 cards)
// ─────────────────────────────────────────────────────────────────
const ACCOUNTA_SCREENS = 5;
function AccountaReportScreen({ s, ai, aiLoading, step, back, next }) {
  const loading = aiLoading && !ai;
  const screens = [
    <Shell sec="accounta" prog={1} total={ACCOUNTA_SCREENS}>
      <T>Promises made</T>
      <div style={{ width:"100%", display:"flex", gap:12, marginTop:16, justifyContent:"center" }}>
        {[ai?.personA, ai?.personB].filter(Boolean).map((p, i) => (
          <div key={i} style={{ flex:1, background:"rgba(0,0,0,0.2)", borderRadius:20, padding:"16px 12px", textAlign:"center" }}>
            <div style={{ fontSize:34, fontWeight:800, color:"#fff" }}>{loading ? "—" : (p.total||0)}</div>
            <div style={{ fontSize:11, color:"rgba(255,255,255,0.45)", marginTop:4 }}>promises</div>
            <div style={{ fontSize:13, fontWeight:700, color:"rgba(255,255,255,0.7)", marginTop:6 }}>{p.name}</div>
          </div>
        ))}
      </div>
      <AICard label="Overall verdict" value={ai?.overallVerdict} loading={loading} />
      <Nav back={back} next={next} showBack={false} />
    </Shell>,

    <Shell sec="accounta" prog={2} total={ACCOUNTA_SCREENS}>
      <T>{loading ? "…" : (ai?.personA?.name || s.names[0])}'s accountability</T>
      <div style={{ marginTop:16, display:"flex", justifyContent:"center" }}>
        <ScoreRing score={loading ? 0 : (ai?.personA?.score||5)} max={10} size={120} color="#6AB4F0" />
      </div>
      <div style={{ width:"100%", display:"flex", gap:12, marginTop:12 }}>
        <div style={{ flex:1, background:"rgba(0,0,0,0.2)", borderRadius:16, padding:"12px 14px", textAlign:"center" }}>
          <div style={{ fontSize:22, fontWeight:800, color:"#5AF080" }}>{loading ? "—" : (ai?.personA?.kept||0)}</div>
          <div style={{ fontSize:11, color:"rgba(255,255,255,0.45)", marginTop:2 }}>kept</div>
        </div>
        <div style={{ flex:1, background:"rgba(0,0,0,0.2)", borderRadius:16, padding:"12px 14px", textAlign:"center" }}>
          <div style={{ fontSize:22, fontWeight:800, color:"#E06060" }}>{loading ? "—" : (ai?.personA?.broken||0)}</div>
          <div style={{ fontSize:11, color:"rgba(255,255,255,0.45)", marginTop:2 }}>broken</div>
        </div>
      </div>
      <AICard label="Pattern" value={ai?.personA?.detail} loading={loading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="accounta" prog={3} total={ACCOUNTA_SCREENS}>
      <T>{loading ? "…" : (ai?.personB?.name || s.names[1]||s.names[0])}'s accountability</T>
      <div style={{ marginTop:16, display:"flex", justifyContent:"center" }}>
        <ScoreRing score={loading ? 0 : (ai?.personB?.score||5)} max={10} size={120} color="#6AB4F0" />
      </div>
      <div style={{ width:"100%", display:"flex", gap:12, marginTop:12 }}>
        <div style={{ flex:1, background:"rgba(0,0,0,0.2)", borderRadius:16, padding:"12px 14px", textAlign:"center" }}>
          <div style={{ fontSize:22, fontWeight:800, color:"#5AF080" }}>{loading ? "—" : (ai?.personB?.kept||0)}</div>
          <div style={{ fontSize:11, color:"rgba(255,255,255,0.45)", marginTop:2 }}>kept</div>
        </div>
        <div style={{ flex:1, background:"rgba(0,0,0,0.2)", borderRadius:16, padding:"12px 14px", textAlign:"center" }}>
          <div style={{ fontSize:22, fontWeight:800, color:"#E06060" }}>{loading ? "—" : (ai?.personB?.broken||0)}</div>
          <div style={{ fontSize:11, color:"rgba(255,255,255,0.45)", marginTop:2 }}>broken</div>
        </div>
      </div>
      <AICard label="Pattern" value={ai?.personB?.detail} loading={loading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="accounta" prog={4} total={ACCOUNTA_SCREENS}>
      <T>Most notable broken promise</T>
      {loading
        ? <div style={{ display:"flex", justifyContent:"center", padding:"20px 0" }}><Dots /></div>
        : <div style={{ width:"100%", marginTop:16 }}>
            <div style={{ background:"rgba(0,0,0,0.2)", borderRadius:20, padding:"16px 18px" }}>
              <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", color:"rgba(255,255,255,0.45)", marginBottom:6 }}>{ai?.notableBroken?.date||""}{ai?.notableBroken?.date&&ai?.notableBroken?.person?" • ":""}{ai?.notableBroken?.person||""}</div>
              <div style={{ fontSize:15, fontWeight:800, color:"#fff", marginBottom:6 }}>"{ai?.notableBroken?.promise||"—"}"</div>
              <div style={{ fontSize:13, color:"rgba(255,255,255,0.6)", lineHeight:1.55 }}>{ai?.notableBroken?.outcome||""}</div>
            </div>
          </div>
      }
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="accounta" prog={5} total={ACCOUNTA_SCREENS}>
      <T>Most notable kept promise</T>
      {loading
        ? <div style={{ display:"flex", justifyContent:"center", padding:"20px 0" }}><Dots /></div>
        : <div style={{ width:"100%", marginTop:16 }}>
            <div style={{ background:"rgba(0,0,0,0.2)", borderRadius:20, padding:"16px 18px" }}>
              <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", color:"rgba(255,255,255,0.45)", marginBottom:6 }}>{ai?.notableKept?.date||""}{ai?.notableKept?.date&&ai?.notableKept?.person?" • ":""}{ai?.notableKept?.person||""}</div>
              <div style={{ fontSize:15, fontWeight:800, color:"#fff", marginBottom:6 }}>"{ai?.notableKept?.promise||"—"}"</div>
              <div style={{ fontSize:13, color:"rgba(255,255,255,0.6)", lineHeight:1.55 }}>{ai?.notableKept?.outcome||""}</div>
            </div>
          </div>
      }
      <Nav back={back} next={next} nextLabel="Done" />
    </Shell>,
  ];
  return screens[step] ?? null;
}

// ─────────────────────────────────────────────────────────────────
// ENERGY REPORT SCREENS  (6 cards)
// ─────────────────────────────────────────────────────────────────
const ENERGY_SCREENS = 6;
function EnergyReportScreen({ s, ai, aiLoading, step, back, next }) {
  const loading = aiLoading && !ai;
  const screens = [
    <Shell sec="energy" prog={1} total={ENERGY_SCREENS}>
      <T>Net energy scores</T>
      <div style={{ width:"100%", display:"flex", gap:16, marginTop:16, justifyContent:"center" }}>
        {(loading ? s.names.slice(0,2).map(n=>({name:n,netScore:5,type:""})) : [ai?.personA,ai?.personB].filter(Boolean)).map((p, i) => (
          <div key={i} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:8 }}>
            <ScoreRing score={loading ? 0 : (p.netScore||5)} max={10} size={90} color={i===0?"#F0A040":"#F0C860"} />
            <div style={{ fontSize:13, fontWeight:700, color:"rgba(255,255,255,0.7)" }}>{p.name}</div>
            <div style={{ fontSize:11, color:"rgba(255,255,255,0.45)", textAlign:"center" }}>{loading ? "…" : (p.type||"")}</div>
          </div>
        ))}
      </div>
      <AICard label="Energy compatibility" value={ai?.compatibility} loading={loading} />
      <Nav back={back} next={next} showBack={false} />
    </Shell>,

    <Shell sec="energy" prog={2} total={ENERGY_SCREENS}>
      <T>{loading ? "…" : (ai?.personA?.name || s.names[0])}'s energy</T>
      <AICard label="Positive energy" value={ai?.personA?.goodNews} loading={loading} />
      <AICard label="Draining patterns" value={ai?.personA?.venting} loading={loading} />
      {!loading && ai?.personA?.hypeQuote && <Quip>"{ai.personA.hypeQuote}"</Quip>}
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="energy" prog={3} total={ENERGY_SCREENS}>
      <T>{loading ? "…" : (ai?.personB?.name || s.names[1]||s.names[0])}'s energy</T>
      <AICard label="Positive energy" value={ai?.personB?.goodNews} loading={loading} />
      <AICard label="Draining patterns" value={ai?.personB?.venting} loading={loading} />
      {!loading && ai?.personB?.hypeQuote && <Quip>"{ai.personB.hypeQuote}"</Quip>}
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="energy" prog={4} total={ENERGY_SCREENS}>
      <T>Most energising moment</T>
      <div style={{ fontSize:40, textAlign:"center", marginTop:16 }}>⚡</div>
      <AICard label="The moment" value={ai?.mostEnergising} loading={loading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="energy" prog={5} total={ENERGY_SCREENS}>
      <T>Most draining moment</T>
      <div style={{ fontSize:40, textAlign:"center", marginTop:16 }}>🪫</div>
      <AICard label="The moment" value={ai?.mostDraining} loading={loading} />
      <Nav back={back} next={next} />
    </Shell>,

    <Shell sec="energy" prog={6} total={ENERGY_SCREENS}>
      <T>Energy compatibility</T>
      <div style={{ width:"100%", display:"flex", gap:12, marginTop:16, justifyContent:"center" }}>
        {(loading ? s.names.slice(0,2).map(n=>({name:n,netScore:5})) : [ai?.personA,ai?.personB].filter(Boolean)).map((p, i) => (
          <div key={i} style={{ flex:1, background:"rgba(0,0,0,0.2)", borderRadius:20, padding:"14px 12px", textAlign:"center", display:"flex", flexDirection:"column", alignItems:"center", gap:8 }}>
            <ScoreRing score={loading ? 0 : (p.netScore||5)} max={10} size={72} color={i===0?"#F0A040":"#F0C860"} />
            <div style={{ fontSize:12, fontWeight:700, color:"rgba(255,255,255,0.7)" }}>{p.name}</div>
          </div>
        ))}
      </div>
      <AICard label="Overall read" value={ai?.compatibility} loading={loading} />
      <Nav back={back} next={next} nextLabel="Done" />
    </Shell>,
  ];
  return screens[step] ?? null;
}

// ─────────────────────────────────────────────────────────────────
// PREMIUM FINALE — wrap-up for non-general reports
// ─────────────────────────────────────────────────────────────────
function PremiumFinale({ s, restart, back, reportType }) {
  const rtype = REPORT_TYPES.find(r => r.id === reportType);
  const sec = rtype?.palette || "upload";
  return (
    <Shell sec={sec} prog={1} total={1}>
      <T s={22}>{rtype?.label || "Report complete"}</T>
      <Sub mt={4}>{s.names?.join(" & ") || ""} · {s.totalMessages?.toLocaleString()} messages</Sub>
      <div style={{ display:"flex", gap:10, marginTop:24, justifyContent:"center", width:"100%" }}>
        <Btn onClick={back}>← Back</Btn>
        <Btn onClick={restart}>Start over</Btn>
      </div>
    </Shell>
  );
}

// ─────────────────────────────────────────────────────────────────
// FINALE
// ─────────────────────────────────────────────────────────────────
function Finale({ s, ai, aiLoading, restart, back, prog, total, mode }) {
  const cells = mode === "redflags"
    ? (s.isGroup
      ? [
          {label:"Most toxic",value:ai?.toxicPerson || s.toxicPerson || "—"},
          {label:"Top red flag",value:normalizeRedFlags(ai?.redFlags)[0]?.title || s.redFlags?.[0]?.title || "—"},
          {label:"Drama",value:aiLoading?"...":(ai?.dramaStarter||"—")},
          {label:"Tension",value:aiLoading?"...":(ai?.tensionMoment||"—")},
          {label:"Ghost",value:s.ghost},
          {label:"Top word",value:`"${s.topWords[0]?.[0]}"`},
        ]
      : [
          {label:"Status guess",value:ai?.relationshipStatus || s.relationshipStatus || "—"},
          {label:"More toxic",value:ai?.toxicPerson || s.toxicPerson || "—"},
          {label:"Top red flag",value:normalizeRedFlags(ai?.redFlags)[0]?.title || s.redFlags?.[0]?.title || "—"},
          {label:"Drama",value:aiLoading?"...":(ai?.dramaStarter||"—")},
          {label:"Tension",value:aiLoading?"...":(ai?.tensionMoment||"—")},
          {label:"Top word",value:`"${s.topWords[0]?.[0]}"`},
        ])
    : (s.isGroup
      ? [
          {label:"Main character",value:s.mainChar},
          {label:"The ghost",value:s.ghost},
          {label:"Funniest",value:aiLoading?"...":(ai?.funniestPerson||"—")},
          {label:"Drama",value:aiLoading?"...":(ai?.dramaStarter||"—")},
          {label:"Top word",value:`"${s.topWords[0]?.[0]}"`},
          {label:"Top month",value:s.topMonths[0]?.[0]},
        ]
      : [
          {label:"Most texts",value:s.names[0]},
          {label:"Ghost award",value:s.ghostName},
          {label:"Funniest",value:aiLoading?"...":(ai?.funniestPerson||"—")},
          {label:"Top word",value:`"${s.topWords[0]?.[0]}"`},
          {label:"Spirit emojis",value:s.spiritEmoji.join(" ")},
          {label:"Best streak",value:`${s.streak} days`},
        ]);
  return (
    <Shell sec="finale" prog={prog} total={total}>
      <T s={24}>{mode === "redflags" ? "Red flags, unwrapped." : (s.isGroup?"Your group, unwrapped.":"Your chat, unwrapped.")}</T>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginTop:16,width:"100%"}}>
        {cells.map((c,i)=><Cell key={i} label={c.label} value={c.value} />)}
      </div>
      {!aiLoading&&ai?.vibeOneLiner&&(
        <div style={{background:"rgba(0,0,0,0.2)",borderRadius:20,padding:"14px 18px",width:"100%",fontSize:14,fontStyle:"italic",color:"rgba(255,255,255,0.75)",textAlign:"center",lineHeight:1.6,fontWeight:500}}>"{ai.vibeOneLiner}"</div>
      )}
      <div style={{display:"flex",gap:10,marginTop:20,justifyContent:"center",width:"100%"}}>
        <Btn onClick={back}>Back</Btn>
        <Btn onClick={restart}>Start over</Btn>
      </div>
    </Shell>
  );
}

// ─────────────────────────────────────────────────────────────────
// RELATIONSHIP CONTEXT HELPERS
// ─────────────────────────────────────────────────────────────────
function relContextStr(relType) {
  const map = {
    partner:   "committed romantic partner or spouse",
    dating:    "early stage or casual romantic relationship",
    ex:        "former romantic partner — the relationship has ended",
    family:    "This is a chat between the user and a family member (parent, sibling, or relative).",
    friend:    "This is a chat between the user and a close friend.",
    colleague: "This is a chat between the user and a work colleague.",
    other:     "This is a chat between the user and someone they know.",
  };
  return relType ? (map[relType] || "") : "";
}

function relReadLabel(relType) {
  return {
    partner:   "Partnership read",
    family:    "Family dynamic",
    friend:    "Friendship read",
    colleague: "Work dynamic",
  }[relType] || "Relationship read";
}

function hasAcceptedCurrentTerms(user) {
  const meta = user?.user_metadata || {};
  return meta.terms_accepted === true && meta.terms_version === LEGAL_VERSION;
}

function postAuthPhaseForUser(user) {
  const meta = user?.user_metadata || {};
  if (hasAcceptedCurrentTerms(user)) return "upload";
  if (meta.has_onboarded === true) return "terms";
  return "onboarding";
}

// ─────────────────────────────────────────────────────────────────
// RELATIONSHIP SELECT SCREEN
// ─────────────────────────────────────────────────────────────────
function RelationshipSelect({ onSelect, onBack }) {
  const romanticOptions = [
    { id:"partner", label:"Partner", emoji:"💍", desc:"Committed" },
    { id:"dating",  label:"Dating",  emoji:"💕", desc:"Early stages" },
    { id:"ex",      label:"Ex",      emoji:"💔", desc:"Former" },
  ];
  const options = [
    { id:"family",    label:"Family",    emoji:"👨‍👩‍👧", desc:"Parent, sibling or relative" },
    { id:"friend",    label:"Friend",    emoji:"👯",  desc:"Close friend or bestie" },
    { id:"colleague", label:"Colleague", emoji:"💼",  desc:"Coworker or professional contact" },
    { id:"other",     label:"Other",     emoji:"👤",  desc:"Someone you know" },
  ];
  const optionButtonStyle = {
    background:"rgba(255,255,255,0.08)",
    border:"1px solid rgba(255,255,255,0.14)",
    borderRadius:20,
    color:"#fff",
    cursor:"pointer",
    transition:"all 0.15s",
    width:"100%",
    minHeight:80,
  };
  return (
    <Shell sec="upload" prog={0} total={1}>
      <div style={{ fontSize:22, fontWeight:800, color:"#fff", letterSpacing:-1, lineHeight:1.15, textAlign:"center", width:"100%" }}>Who is this chat with?</div>
      <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:10, marginTop:6 }}>
        <div style={{ display:"flex", gap:10, width:"100%" }}>
          {romanticOptions.map(opt => (
            <button
              key={opt.id}
              type="button"
              onClick={() => onSelect(opt.id)}
              className="wc-btn"
              style={{ ...optionButtonStyle, flex:1, padding:"12px 10px", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", textAlign:"center" }}
            >
              <div style={{ fontSize:28, lineHeight:1, marginBottom:8 }}>{opt.emoji}</div>
              <div style={{ fontSize:15, fontWeight:800, letterSpacing:-0.3 }}>{opt.label}</div>
              <div style={{ fontSize:12, color:"rgba(255,255,255,0.5)", marginTop:4 }}>{opt.desc}</div>
            </button>
          ))}
        </div>
        {options.map(opt => (
          <button
            key={opt.id}
            type="button"
            onClick={() => onSelect(opt.id)}
            className="wc-btn"
            style={{ ...optionButtonStyle, padding:"16px 18px", display:"flex", alignItems:"center", gap:14, textAlign:"left" }}
          >
            <div style={{ fontSize:28, flexShrink:0 }}>{opt.emoji}</div>
            <div>
              <div style={{ fontSize:15, fontWeight:800, letterSpacing:-0.3 }}>{opt.label}</div>
              <div style={{ fontSize:12, color:"rgba(255,255,255,0.5)", marginTop:2 }}>{opt.desc}</div>
            </div>
          </button>
        ))}
      </div>
      <Btn onClick={onBack}>← Back</Btn>
    </Shell>
  );
}

// ─────────────────────────────────────────────────────────────────
// UPLOAD
// ─────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────────────────────────
function Auth() {
  const [tab,      setTab]      = useState("login");
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [err,      setErr]      = useState("");
  const [info,     setInfo]     = useState("");
  const [busy,     setBusy]     = useState(false);

  const switchTab = (t) => { setTab(t); setErr(""); setInfo(""); };

  const submit = async () => {
    if (!email || !password) { setErr("Please fill in both fields."); return; }
    setBusy(true); setErr(""); setInfo("");
    try {
      if (tab === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) setErr(error.message);
      } else {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) setErr(error.message);
        else setInfo("Check your email to confirm your account, then log in.");
      }
    } catch { setErr("Something went wrong. Please try again."); }
    setBusy(false);
  };

  const inputStyle = {
    width: "100%",
    background: "rgba(0,0,0,0.25)",
    border: "1.5px solid rgba(255,255,255,0.12)",
    borderRadius: 14,
    padding: "13px 16px",
    fontSize: 15,
    color: "#fff",
    outline: "none",
    fontFamily: "inherit",
  };

  return (
    <Shell sec="upload" prog={0} total={0}>
      <div style={{ fontSize:44, fontWeight:800, color:"#fff", letterSpacing:-3, lineHeight:1, textAlign:"center", width:"100%" }}>WrapChat</div>
      <div style={{ fontSize:15, color:"rgba(255,255,255,0.5)", marginBottom:4, textAlign:"center", fontWeight:500 }}>Your chats, unwrapped.</div>

      {/* Tab toggle */}
      <div style={{ display:"flex", background:"rgba(0,0,0,0.25)", borderRadius:50, padding:4, width:"100%", gap:4 }}>
        {[["login","Log in"],["signup","Sign up"]].map(([t,label]) => (
          <button key={t} onClick={() => switchTab(t)}
            style={{
              flex:1, border:"none", borderRadius:46, padding:"10px 0",
              fontSize:14, fontWeight:700, cursor:"pointer", transition:"all 0.2s",
              background: tab === t ? "rgba(255,255,255,0.18)" : "transparent",
              color: tab === t ? "#fff" : "rgba(255,255,255,0.38)",
              letterSpacing: 0.2,
            }}
          >{label}</button>
        ))}
      </div>

      {/* Inputs */}
      <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:10 }}>
        <input
          type="email" placeholder="Email" value={email}
          onChange={e => setEmail(e.target.value)}
          onKeyDown={e => e.key === "Enter" && submit()}
          style={inputStyle}
        />
        <input
          type="password" placeholder="Password" value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={e => e.key === "Enter" && submit()}
          style={inputStyle}
        />
      </div>

      {err  && <div style={{ fontSize:13, color:"#FFB090", background:"rgba(200,60,20,0.2)", padding:"10px 16px", borderRadius:16, width:"100%", textAlign:"center", lineHeight:1.5 }}>{err}</div>}
      {info && <div style={{ fontSize:13, color:"#B0F4C8", background:"rgba(20,160,80,0.15)", padding:"10px 16px", borderRadius:16, width:"100%", textAlign:"center", lineHeight:1.5 }}>{info}</div>}

      <button
        onClick={submit} disabled={busy} className="wc-btn"
        style={{ width:"100%", padding:"14px 0", borderRadius:50, border:"none", background: PAL.upload.inner, color:"#fff", fontSize:16, cursor: busy ? "default" : "pointer", fontWeight:700, transition:"all 0.15s", letterSpacing:0.2, opacity: busy ? 0.65 : 1 }}
      >
        {busy ? "…" : tab === "login" ? "Log in" : "Create account"}
      </button>

      <div style={{ fontSize:11, color:"rgba(255,255,255,0.2)", textAlign:"center" }}>Your chat is analysed by AI and never stored. Only results are saved.</div>
    </Shell>
  );
}

// ─────────────────────────────────────────────────────────────────
// ONBOARDING (3 screens, first-login only)
// ─────────────────────────────────────────────────────────────────
const ONBOARD_PILLS = [
  { label: "Toxicity",       palette: "toxicity" },
  { label: "Love Languages", palette: "lovelang" },
  { label: "Accountability", palette: "accounta" },
  { label: "Energy",         palette: "energy"   },
  { label: "Growth",         palette: "growth"   },
  { label: "Chat Wrapped",   palette: "upload"   },
];

const EXPORT_STEPS = [
  "Open WhatsApp",
  "Tap the chat you want to analyse",
  "Tap ··· menu → More → Export Chat",
  "Choose Without Media",
  "Save the .txt file to your device",
];

function OnboardingFlow({ step, next, onOnboarded, onLogout }) {
  const [busy, setBusy] = useState(false);
  const [err]           = useState("");

  const markOnboarded = async (thenCb) => {
    if (busy) return;
    setBusy(true);
    try {
      await supabase.auth.updateUser({ data: { has_onboarded: true } });
    } catch { /* silent — non-critical */ }
    thenCb?.();
  };

  const handleSkip    = () => markOnboarded(onOnboarded);
  const handleLetsGo  = () => markOnboarded(onOnboarded);

  const linkBtn = { background:"none", border:"none", color:"rgba(255,255,255,0.3)", fontSize:12, cursor:"pointer", padding:"4px 8px", fontWeight:600, letterSpacing:0.1 };

  return (
    <Shell sec="upload" prog={step + 1} total={3}>

      {/* ── Screen 1: hook ── */}
      {step === 0 && (<>
        <div style={{ fontSize:34, fontWeight:800, color:"#fff", letterSpacing:-1.5, lineHeight:1.1, textAlign:"center", width:"100%" }}>
          Your relationship, in data.
        </div>
        <div style={{ fontSize:14, color:"rgba(255,255,255,0.6)", textAlign:"center", lineHeight:1.75, width:"100%" }}>
          Reads your WhatsApp chat and shows you what's actually going on. Who shows up. Who ghosts. Who carries the conversation.
        </div>
        <Btn onClick={next}>Next →</Btn>
        <button onClick={handleSkip} style={linkBtn}>Skip</button>
      </>)}

      {/* ── Screen 2: export instructions ── */}
      {step === 1 && (<>
        <div style={{ fontSize:34, fontWeight:800, color:"#fff", letterSpacing:-1.5, lineHeight:1.1, textAlign:"center", width:"100%" }}>
          Start with your chat.
        </div>
        <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:9 }}>
          {EXPORT_STEPS.map((label, i) => (
            <div key={i} style={{ display:"flex", alignItems:"center", gap:14, background:"rgba(255,255,255,0.07)", border:"1px solid rgba(255,255,255,0.10)", borderRadius:18, padding:"13px 16px" }}>
              <div style={{ width:28, height:28, borderRadius:"50%", background:PAL.upload.inner, display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, fontWeight:800, color:"#fff", flexShrink:0 }}>
                {i + 1}
              </div>
              <div style={{ fontSize:14, fontWeight:600, color:"#fff", lineHeight:1.4 }}>{label}</div>
            </div>
          ))}
        </div>
        <Btn onClick={next}>Next →</Btn>
      </>)}

      {/* ── Screen 3: launch ── */}
      {step === 2 && (<>
        <div style={{ fontSize:34, fontWeight:800, color:"#fff", letterSpacing:-1.5, lineHeight:1.1, textAlign:"center", width:"100%" }}>
          Upload. Analyse. See it clearly.
        </div>
        <div style={{ fontSize:14, color:"rgba(255,255,255,0.6)", textAlign:"center", lineHeight:1.75, width:"100%" }}>
          Six reports. Toxicity, love languages, accountability, energy, growth, and your full chat wrapped. Results in under a minute.
        </div>
        <div style={{ display:"flex", flexWrap:"wrap", gap:8, justifyContent:"center", width:"100%" }}>
          {ONBOARD_PILLS.map(pill => {
            const p = PAL[pill.palette] || PAL.upload;
            return (
              <div key={pill.label} style={{ background:p.inner, color:"#fff", borderRadius:50, padding:"7px 16px", fontSize:13, fontWeight:700, letterSpacing:0.1 }}>
                {pill.label}
              </div>
            );
          })}
        </div>
        {err && <div style={{ fontSize:13, color:"#FFB090", background:"rgba(200,60,20,0.2)", padding:"10px 16px", borderRadius:16, width:"100%", textAlign:"center" }}>{err}</div>}
        <button
          type="button"
          onClick={handleLetsGo}
          disabled={busy}
          className="wc-btn"
          style={{ width:"100%", padding:"14px 0", borderRadius:50, border:"none", background:PAL.upload.inner, color:"#fff", fontSize:16, cursor:busy?"default":"pointer", fontWeight:700, transition:"all 0.15s", letterSpacing:0.2, opacity:busy?0.65:1 }}
        >
          {busy ? "…" : "Let's go"}
        </button>
      </>)}

      <div style={{ display:"flex", gap:16, justifyContent:"center" }}>
        {onLogout && <button onClick={onLogout} className="wc-btn" style={linkBtn}>Log out</button>}
      </div>
    </Shell>
  );
}

// ─────────────────────────────────────────────────────────────────
// TERMS & PRIVACY ACCEPTANCE (separate step, after onboarding)
// ─────────────────────────────────────────────────────────────────
function TermsFlow({ onAccepted, onLogout }) {
  const [activeTab,    setActiveTab]    = useState("tos");
  const [tosRead,      setTosRead]      = useState(false);
  const [privacyRead,  setPrivacyRead]  = useState(false);
  const [busy,         setBusy]         = useState(false);
  const [err,          setErr]          = useState("");
  const tosRef     = useRef(null);
  const privacyRef = useRef(null);

  const bothRead = tosRead && privacyRead;

  const checkRead = (tab) => {
    const el = tab === "tos" ? tosRef.current : privacyRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 28) {
      if (tab === "tos")     setTosRead(true);
      else                   setPrivacyRead(true);
    }
  };

  // check on mount in case content is shorter than container
  useEffect(() => { checkRead("tos"); checkRead("privacy"); }, []); // eslint-disable-line

  const acceptTerms = async () => {
    if (!bothRead || busy) return;
    setBusy(true); setErr("");
    try {
      const { error } = await supabase.auth.updateUser({
        data: {
          terms_accepted: true,
          terms_version: LEGAL_VERSION,
          terms_accepted_at: new Date().toISOString(),
        },
      });
      if (error) { setErr(error.message || "Could not save. Please try again."); setBusy(false); return; }
      onAccepted?.();
    } catch {
      setErr("Could not save. Please try again.");
      setBusy(false);
    }
  };

  const tabBtn = (tab, isRead) => ({
    flex:1, border:"none", borderRadius:46, padding:"10px 6px",
    fontSize:13, fontWeight:700, cursor:"pointer", transition:"all 0.2s",
    background: activeTab === tab ? "rgba(255,255,255,0.18)" : "transparent",
    color: activeTab === tab ? "#fff" : "rgba(255,255,255,0.38)",
    letterSpacing:0.1,
    display:"flex", alignItems:"center", justifyContent:"center", gap:5,
    opacity: isRead && activeTab !== tab ? 0.7 : 1,
  });

  const scrollBox = {
    height:"40vh", overflowY:"auto",
    background:"rgba(0,0,0,0.22)", borderRadius:20,
    padding:"18px 20px", width:"100%",
    fontSize:12.5, color:"rgba(255,255,255,0.62)", lineHeight:1.8,
    fontFamily:"inherit", whiteSpace:"pre-wrap",
  };

  const checkMark = (read) => read
    ? <span style={{ color:PAL.growth.accent, fontWeight:800 }}>✓</span>
    : null;

  const linkBtn = { background:"none", border:"none", color:"rgba(255,255,255,0.3)", fontSize:12, cursor:"pointer", padding:"4px 8px", fontWeight:600, letterSpacing:0.1 };

  return (
    <Shell sec="upload" prog={0} total={1}>
      <div style={{ fontSize:26, fontWeight:800, color:"#fff", letterSpacing:-1, lineHeight:1.15, textAlign:"center", width:"100%" }}>
        One thing before you start.
      </div>
      <div style={{ fontSize:13, color:"rgba(255,255,255,0.5)", textAlign:"center", lineHeight:1.6, width:"100%" }}>
        Read both documents below before continuing.
      </div>

      {/* Tab switcher */}
      <div style={{ display:"flex", background:"rgba(0,0,0,0.25)", borderRadius:50, padding:4, width:"100%", gap:4 }}>
        <button onClick={() => setActiveTab("tos")} style={tabBtn("tos", tosRead)}>
          Terms of Service {checkMark(tosRead)}
        </button>
        <button onClick={() => setActiveTab("privacy")} style={tabBtn("privacy", privacyRead)}>
          Privacy Policy {checkMark(privacyRead)}
        </button>
      </div>

      {/* Scrollable document bodies — both mounted so scroll position is preserved */}
      <div
        ref={tosRef}
        onScroll={() => checkRead("tos")}
        style={{ ...scrollBox, display: activeTab === "tos" ? "block" : "none" }}
      >
        {TERMS_OF_SERVICE_TEXT}
      </div>
      <div
        ref={privacyRef}
        onScroll={() => checkRead("privacy")}
        style={{ ...scrollBox, display: activeTab === "privacy" ? "block" : "none" }}
      >
        {PRIVACY_POLICY_TEXT}
      </div>

      {!bothRead && (
        <div style={{ fontSize:11, color:"rgba(255,255,255,0.28)", textAlign:"center" }}>
          {!tosRead && !privacyRead
            ? "Scroll through both documents to continue."
            : !tosRead
              ? "Scroll to the bottom of Terms of Service."
              : "Scroll to the bottom of Privacy Policy."}
        </div>
      )}

      {err && <div style={{ fontSize:13, color:"#FFB090", background:"rgba(200,60,20,0.2)", padding:"10px 16px", borderRadius:16, width:"100%", textAlign:"center" }}>{err}</div>}

      <button
        type="button"
        onClick={acceptTerms}
        disabled={!bothRead || busy}
        className="wc-btn"
        style={{
          width:"100%", padding:"14px 0", borderRadius:50, border:"none",
          background: PAL.upload.inner, color:"#fff", fontSize:15,
          cursor: !bothRead || busy ? "default" : "pointer",
          fontWeight:700, transition:"all 0.15s", letterSpacing:0.1,
          opacity: !bothRead || busy ? 0.38 : 1,
        }}
      >
        {busy ? "Saving…" : "I have read and accept both documents."}
      </button>

      <div style={{ display:"flex", gap:16, justifyContent:"center" }}>
        {onLogout && <button onClick={onLogout} className="wc-btn" style={linkBtn}>Log out</button>}
      </div>
    </Shell>
  );
}

function TooShort({ onBack }) {
  return (
    <Shell sec="upload" prog={0} total={1}>
      <div style={{ fontSize:44, fontWeight:800, color:"#fff", letterSpacing:-3, lineHeight:1, textAlign:"center", width:"100%" }}>WrapChat</div>
      <div style={{ background:"rgba(0,0,0,0.25)", borderRadius:24, padding:"32px 24px", textAlign:"center", width:"100%" }}>
        <div style={{ fontSize:40, lineHeight:1 }}>🤐</div>
        <div style={{ fontSize:22, fontWeight:800, color:"#fff", letterSpacing:-0.5, marginTop:14, lineHeight:1.2 }}>
          Not enough messages to wrap
        </div>
        <div style={{ fontSize:13, color:"rgba(255,255,255,0.5)", marginTop:10, lineHeight:1.75 }}>
          This chat has fewer than {MIN_MESSAGES} messages after filtering system messages. WrapChat needs more to work with.
        </div>
      </div>
      <div style={{ fontSize:12, color:"rgba(255,255,255,0.35)", textAlign:"center", lineHeight:1.8 }}>
        Try exporting a longer chat history.
      </div>
      <Btn onClick={onBack}>← Upload a different file</Btn>
    </Shell>
  );
}

function Upload({ onParsed, onLogout, onHistory }) {
  const fileRef = useRef();
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const handle = file => {
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) {
      setErr("This file is too large (max 50 MB). Try exporting a shorter date range.");
      return;
    }
    setBusy(true); setErr("");
    const r = new FileReader();
    r.onload = e => {
      const result = parseWhatsApp(e.target.result);
      if (!result.formatDetected) {
        setErr("Couldn't read this file. Make sure it's a WhatsApp .txt export.");
        setBusy(false);
        return;
      }
      onParsed(result);
    };
    r.readAsText(file);
  };
  return (
    <Shell sec="upload" prog={0} total={1}>
      <div style={{ fontSize:44, fontWeight:800, color:"#fff", letterSpacing:-3, lineHeight:1, textAlign:"center", width:"100%" }}>WrapChat</div>
      <div style={{ fontSize:15, color:"rgba(255,255,255,0.5)", marginBottom:8, textAlign:"center", fontWeight:500 }}>Your chats, unwrapped.</div>
      <div
        onClick={() => fileRef.current?.click()}
        onDrop={e => { e.preventDefault(); handle(e.dataTransfer.files[0]); }}
        onDragOver={e => e.preventDefault()}
        style={{ background:"rgba(0,0,0,0.25)", borderRadius:24, padding:"28px 24px", textAlign:"center", cursor:"pointer", width:"100%", transition:"background 0.2s" }}
        onMouseEnter={e => e.currentTarget.style.background = "rgba(0,0,0,0.35)"}
        onMouseLeave={e => e.currentTarget.style.background = "rgba(0,0,0,0.25)"}
      >
        <div style={{ fontSize:17, fontWeight:800, color:"#fff", letterSpacing:-0.3 }}>{busy ? "Reading your chat…" : "Upload your chat"}</div>
        <input ref={fileRef} type="file" accept=".txt" style={{ display:"none" }} onChange={e => handle(e.target.files[0])} />
      </div>
      {err && <div style={{ fontSize:13, color:"#FFB090", marginTop:8, textAlign:"center", background:"rgba(200,60,20,0.2)", padding:"10px 16px", borderRadius:16, width:"100%" }}>{err}</div>}
      <div style={{ fontSize:11, color:"rgba(255,255,255,0.2)", marginTop:8, textAlign:"center" }}>Group or duo detected automatically. Your chat is analysed by AI and never stored. Only results are saved.</div>
      <div style={{ display:"flex", gap:16, justifyContent:"center" }}>
        {onHistory && (
          <button onClick={onHistory} className="wc-btn" style={{ background:"none", border:"none", color:"rgba(255,255,255,0.4)", fontSize:12, cursor:"pointer", padding:"4px 8px", fontWeight:600, letterSpacing:0.1 }}>
            My Results
          </button>
        )}
        {onLogout && (
          <button onClick={onLogout} className="wc-btn" style={{ background:"none", border:"none", color:"rgba(255,255,255,0.3)", fontSize:12, cursor:"pointer", padding:"4px 8px", fontWeight:600, letterSpacing:0.1 }}>
            Log out
          </button>
        )}
      </div>
    </Shell>
  );
}

// ─────────────────────────────────────────────────────────────────
// LOADING
// ─────────────────────────────────────────────────────────────────
function Loading({ math, reportType }) {
  const [tick, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick(x => Math.min(x+1, LOADING_STEPS.length-1)), 1800); return () => clearInterval(t); }, []);
  const label = REPORT_TYPES.find(r => r.id === reportType)?.label || "Analysis";
  return (
    <Shell sec="upload" prog={tick+1} total={LOADING_STEPS.length}>
      <div style={{ fontSize:44, fontWeight:800, color:"#fff", letterSpacing:-3, lineHeight:1, textAlign:"center", width:"100%" }}>WrapChat</div>
      <div style={{ fontSize:14, color:"rgba(255,255,255,0.45)", textAlign:"center", fontWeight:500 }}>
        {label} · {math.totalMessages.toLocaleString()} messages
      </div>
      <div style={{ background:"rgba(0,0,0,0.25)", borderRadius:24, padding:"24px 20px", width:"100%", textAlign:"center" }}>
        <div style={{ fontSize:18, fontWeight:800, color:"#fff", minHeight:52, letterSpacing:-0.3 }}>{LOADING_STEPS[tick]}</div>
        <div style={{ display:"flex", gap:8, justifyContent:"center", marginTop:16 }}>
          {[0,1,2].map(i => <div key={i} style={{ width:10, height:10, borderRadius:"50%", background:"rgba(255,255,255,0.4)", animation:`blink 1.2s ${i*0.2}s infinite` }} />)}
        </div>
      </div>
      <div style={{ fontSize:12, color:"rgba(255,255,255,0.25)", textAlign:"center", lineHeight:1.8 }}>
        Your chat is analysed by AI and never stored. Only results are saved.
      </div>
    </Shell>
  );
}

// ─────────────────────────────────────────────────────────────────
// REPORT SELECT
// ─────────────────────────────────────────────────────────────────
function ReportSelect({ math, onSelect, onBack }) {
  return (
    <Shell sec="upload" prog={0} total={1}>
      <div style={{ fontSize:28, fontWeight:800, color:"#fff", letterSpacing:-1.5, lineHeight:1.1, textAlign:"center", width:"100%" }}>Choose your report</div>
      <Sub mt={4}>{math?.totalMessages?.toLocaleString()} messages · {math?.names?.slice(0,3).join(", ") || ""}{(math?.names?.length||0)>3?` +${math.names.length-3}`:""}</Sub>
      {math?.cappedGroup && (
        <div style={{ fontSize:12, color:"rgba(255,255,255,0.55)", background:"rgba(255,255,255,0.08)", borderRadius:14, padding:"8px 14px", width:"100%", textAlign:"center", lineHeight:1.6 }}>
          Large group detected — analysing the top {GROUP_PARTICIPANT_CAP} members out of {math.originalParticipantCount}.
        </div>
      )}
      <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:10, marginTop:6 }}>
        {REPORT_TYPES.map((r) => {
          const pal = PAL[r.palette] || PAL.upload;
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => onSelect(r.id)}
              className="wc-btn"
              style={{
                background: pal.bg,
                border: "1px solid rgba(255,255,255,0.14)",
                borderRadius: 20,
                padding: "16px 18px",
                textAlign: "left",
                color: "#fff",
                cursor: "pointer",
                width: "100%",
                transition: "all 0.15s",
              }}
            >
              <div style={{ fontSize:15, fontWeight:800, letterSpacing:-0.3, marginBottom:4 }}>{r.label}</div>
              <div style={{ fontSize:12, lineHeight:1.5, color:"rgba(255,255,255,0.58)" }}>{r.desc}</div>
            </button>
          );
        })}
      </div>
      <Btn onClick={onBack}>← Upload different file</Btn>
    </Shell>
  );
}

// ─────────────────────────────────────────────────────────────────
// SLIDE
// ─────────────────────────────────────────────────────────────────
// SLIDE_MS and SLIDE_EASE are defined above Shell, which consumes them.

// Slide is now a thin context provider only.
// Shell consumes SlideContext and animates its content area internally,
// keeping the chrome (background, progress bar, pill, close button) perfectly still.
function Slide({ children, dir, id }) {
  return (
    <SlideContext.Provider value={{ dir, id }}>
      {children}
    </SlideContext.Provider>
  );
}

// ─────────────────────────────────────────────────────────────────
// SAVE RESULT
// ─────────────────────────────────────────────────────────────────
async function saveResult(type, result, mathData) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const safeMathData = {
      ...mathData,
      evidenceTimeline: mathData.evidenceTimeline?.map(({ date, title }) => ({ date, title })) ?? [],
      redFlags: mathData.redFlags?.map(({ title }) => ({ title })) ?? [],
    };
    await supabase.from("results").insert({
      user_id:     user.id,
      report_type: type,
      chat_type:   mathData.isGroup ? "group" : "duo",
      names:       mathData.names,
      result_data: result,
      math_data:   safeMathData,
    });
  } catch { /* silent — never interrupt the user flow */ }
}

// ─────────────────────────────────────────────────────────────────
// MY RESULTS
// ─────────────────────────────────────────────────────────────────
function MyResults({ onBack, onRestoreResult }) {
  const [rows, setRows] = useState(null);
  const [err,  setErr]  = useState("");

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { setRows([]); return; }
      const { data, error } = await supabase
        .from("results")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      if (error) setErr("Couldn't load results. Try again.");
      else setRows(data || []);
    });
  }, []);

  const headline = (row) => {
    const ai   = row.result_data || {};
    const math = row.math_data   || {};
    switch (row.report_type) {
      case "general":  return `${(math.totalMessages || 0).toLocaleString()} messages`;
      case "toxicity": return math.toxicityLevel || ai.toxicityLevel || "—";
      case "lovelang": return ai.compatibilityScore != null ? `${ai.compatibilityScore}/10 compatibility` : "—";
      case "growth":   return ai.trajectory   || "—";
      case "accounta": return ai.overallVerdict || "—";
      case "energy":   return ai.compatibility  || "—";
      default:         return "—";
    }
  };

  return (
    <Shell sec="upload" prog={0} total={0}>
      <div style={{ fontSize:28, fontWeight:800, color:"#fff", letterSpacing:-1, lineHeight:1.1, textAlign:"center", width:"100%" }}>My Results</div>
      <Sub mt={2}>Tap any result to view it again.</Sub>

      {rows === null && !err && (
        <div style={{ width:"100%", display:"flex", justifyContent:"center", padding:"24px 0" }}><Dots /></div>
      )}
      {err && (
        <div style={{ fontSize:13, color:"#FFB090", background:"rgba(200,60,20,0.2)", padding:"10px 16px", borderRadius:16, width:"100%", textAlign:"center" }}>{err}</div>
      )}
      {rows?.length === 0 && (
        <div style={{ fontSize:14, color:"rgba(255,255,255,0.38)", textAlign:"center", padding:"24px 0", lineHeight:1.6 }}>No saved results yet.<br/>Run an analysis to see it here.</div>
      )}

      <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:10, maxHeight:"58vh", overflowY:"auto", paddingRight:2 }}>
        {rows?.map(row => {
          const rt  = REPORT_TYPES.find(r => r.id === row.report_type);
          const pal = PAL[rt?.palette] || PAL.upload;
          const names = Array.isArray(row.names) ? row.names.slice(0, 3).join(", ") + (row.names.length > 3 ? ` +${row.names.length - 3}` : "") : "—";
          const date  = new Date(row.created_at).toLocaleDateString("en-US", { month:"short", day:"numeric", year:"numeric" });
          const stat  = headline(row);
          return (
            <button key={row.id} onClick={() => onRestoreResult(row)} className="wc-btn"
              style={{ background:pal.bg, border:"1px solid rgba(255,255,255,0.14)", borderRadius:20, padding:"14px 18px", textAlign:"left", color:"#fff", cursor:"pointer", width:"100%", transition:"all 0.15s" }}
            >
              <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", color:"rgba(255,255,255,0.45)", marginBottom:4 }}>{rt?.label || row.report_type} · {date}</div>
              <div style={{ fontSize:15, fontWeight:800, letterSpacing:-0.3, marginBottom:3 }}>{names}</div>
              {stat !== "—" && <div style={{ fontSize:12, fontWeight:600, color:pal.accent }}>{stat}</div>}
            </button>
          );
        })}
      </div>

      <Btn onClick={onBack}>← Back</Btn>
    </Shell>
  );
}

// ─────────────────────────────────────────────────────────────────
// APP
// ─────────────────────────────────────────────────────────────────
export default function App() {
  const [phase,            setPhase]            = useState("auth");
  const [messages,         setMessages]         = useState(null);
  const [math,             setMath]             = useState(null);
  const [ai,               setAi]               = useState(null);
  const [coreAnalysisA,    setCoreAnalysisA]    = useState(null);
  const [coreAnalysisAKey, setCoreAnalysisAKey] = useState("");
  const [coreAnalysisB,    setCoreAnalysisB]    = useState(null);
  const [coreAnalysisBKey, setCoreAnalysisBKey] = useState("");
  const [aiLoading,        setAiLoading]        = useState(false);
  const [reportType,       setReportType]       = useState(null);
  const [relationshipType, setRelationshipType] = useState(null);
  const [step,             setStep]             = useState(0);
  const [dir,              setDir]              = useState("fwd");
  const [sid,              setSid]              = useState(0);
  const [resultsOrigin,    setResultsOrigin]    = useState("upload"); // "upload" | "history"

  // Keep a ref so the visibilitychange handler always sees the current phase
  // without being re-registered on every render.
  const phaseRef = useRef(phase);
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  // When the tab becomes visible again while stuck on the loading screen,
  // check if a result was already saved (e.g. the fetch completed in the
  // background) and restore it without asking the user to re-upload.
  useEffect(() => {
    const handleVisibility = async () => {
      if (document.visibilityState !== "visible") return;
      if (phaseRef.current !== "loading") return;

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from("results")
        .select("*")
        .eq("user_id", user.id)
        .gte("created_at", tenMinutesAgo)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (!data) return;

      setAi(data.result_data || {});
      if (data.result_data?.coreAnalysis?.part === "a") {
        setCoreAnalysisA(data.result_data.coreAnalysis);
        setCoreAnalysisAKey(getCoreAnalysisCacheKey(data.math_data || null, data.result_data?.relationshipType ?? null));
      } else if (data.result_data?.coreAnalysis?.part === "b") {
        setCoreAnalysisB(data.result_data.coreAnalysis);
        setCoreAnalysisBKey(getCoreAnalysisCacheKey(data.math_data || null, data.result_data?.relationshipType ?? null));
      }
      setMath(data.math_data || null);
      setReportType(data.report_type || null);
      setRelationshipType(data.result_data?.relationshipType ?? null);
      setAiLoading(false);
      setStep(0);
      setDir("fwd");
      setResultsOrigin("upload");
      setPhase("results");
      setSid(s => s + 1);
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []); // registered once — reads phase via phaseRef

  // Check for an existing session on mount and listen for auth changes
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setStep(0);
        setDir("fwd");
        setPhase(postAuthPhaseForUser(session.user));
        setSid(s => s + 1);
      }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setStep(0);
        setDir("fwd");
        setPhase(postAuthPhaseForUser(session.user));
        setSid(s => s + 1);
      } else {
        setStep(0);
        setDir("fwd");
        setPhase("auth");
        setSid(s => s + 1);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  const logout = async () => {
    await supabase.auth.signOut();
  };

  // Called when onboarding completes → proceed to terms acceptance
  const onOnboarded = () => {
    setStep(0);
    setDir("fwd");
    setPhase("terms");
    setSid(s => s + 1);
  };

  // Called when terms are accepted → proceed to upload
  const onAcceptedTerms = () => {
    setStep(0);
    setDir("fwd");
    setPhase("upload");
    setSid(s => s + 1);
  };

  const go      = d => { setDir(d); setSid(s => s+1); setStep(s => d==="fwd" ? s+1 : s-1); };
  const back    = () => go("bk");
  const next    = () => go("fwd");
  const restart = () => {
    setPhase("upload"); setMessages(null); setMath(null); setAi(null);
    setCoreAnalysisA(null); setCoreAnalysisAKey("");
    setCoreAnalysisB(null); setCoreAnalysisBKey("");
    setAiLoading(false); setReportType(null); setRelationshipType(null);
    setStep(0); setDir("fwd"); setSid(s => s+1);
  };

  // Step 1: file parsed → check thresholds, cap large groups, compute local stats
  const onParsed = ({ messages: msgs, tooShort }) => {
    if (tooShort) {
      setPhase("tooshort");
      setSid(s => s + 1);
      return;
    }
    const { messages: cappedMsgs, cappedGroup, originalParticipantCount } = capLargeGroup(msgs);
    const m = localStats(cappedMsgs);
    if (m) {
      m.cappedGroup = cappedGroup;
      m.originalParticipantCount = originalParticipantCount;
    }
    setSeed((m?.totalMessages||1) * 31 + (m?.names?.[0]?.charCodeAt(0)||7) * 17);
    resetPicks();
    setMessages(cappedMsgs);
    setMath(m);
    setAi(null);
    setCoreAnalysisA(null);
    setCoreAnalysisAKey("");
    setCoreAnalysisB(null);
    setCoreAnalysisBKey("");
    setRelationshipType(null);
    setPhase("select");
    setSid(s => s+1);
  };

  // Run AI analysis with the selected report type and relationship type
  const runAnalysis = async (type, relType) => {
    setStep(0);
    setPhase("loading");
    setSid(s => s+1);
    setAiLoading(true);
    setAi(null);
    try {
      const pipeline = REPORT_PIPELINES[type];
      let result;

      if (pipeline?.strategy === "core") {
        const cacheKey = getCoreAnalysisCacheKey(math, relType);
        const useCoreA = pipeline.cache === "a";
        let core = useCoreA
          ? (coreAnalysisAKey === cacheKey ? coreAnalysisA : null)
          : (coreAnalysisBKey === cacheKey ? coreAnalysisB : null);
        if (!core) {
          core = useCoreA
            ? await generateCoreAnalysisA(messages, math, relType)
            : await generateCoreAnalysisB(messages, math, relType);
          if (useCoreA) {
            setCoreAnalysisA(core);
            setCoreAnalysisAKey(cacheKey);
          } else {
            setCoreAnalysisB(core);
            setCoreAnalysisBKey(cacheKey);
          }
        }
        result = pipeline.derive(core, math, relType);
      }

      setAi(result || {});
      if (result) saveResult(type, result, math);
    } catch { setAi({}); }
    setAiLoading(false);
    setResultsOrigin("upload");
    setPhase("results");
    setStep(0);
    setSid(s => s+1);
  };

  // Step 2: user picks a report → for duo chats, show relationship screen first
  const onSelectReport = (type) => {
    setReportType(type);
    if (!math.isGroup) {
      setPhase("relationship");
      setSid(s => s+1);
    } else {
      runAnalysis(type, null);
    }
  };

  // Step 3 (duo only): user picks relationship type → run analysis
  const onSelectRelationship = (relType) => {
    setRelationshipType(relType);
    runAnalysis(reportType, relType);
  };

  const closeResults = () => {
    const dest = resultsOrigin === "history" ? "history" : "upload";
    setPhase(dest);
    setSid(s => s + 1);
  };
  const wrap = child => (
    <div style={{ width:"min(420px, 100vw)", margin:"0 auto", overflow:"hidden" }}>
      <Slide dir={dir} id={sid}>
        <CloseResultsContext.Provider value={closeResults}>
          {child}
        </CloseResultsContext.Provider>
      </Slide>
    </div>
  );

  const onRestoreResult = (row) => {
    setMath(row.math_data);
    setAi(row.result_data);
    if (row.result_data?.coreAnalysis?.part === "a") {
      setCoreAnalysisA(row.result_data.coreAnalysis);
      setCoreAnalysisAKey(getCoreAnalysisCacheKey(row.math_data || null, row.result_data?.relationshipType ?? null));
    } else if (row.result_data?.coreAnalysis?.part === "b") {
      setCoreAnalysisB(row.result_data.coreAnalysis);
      setCoreAnalysisBKey(getCoreAnalysisCacheKey(row.math_data || null, row.result_data?.relationshipType ?? null));
    }
    setReportType(row.report_type);
    setRelationshipType(row.result_data?.relationshipType ?? null);
    setAiLoading(false);
    setStep(0);
    setDir("fwd");
    setResultsOrigin("history");
    setPhase("results");
    setSid(s => s + 1);
  };

  if (phase === "auth")     return <Slide dir="fwd" id={sid}><Auth /></Slide>;
  if (phase === "onboarding") return (
    <Slide dir={dir} id={sid}>
      <OnboardingFlow step={step} next={next} onOnboarded={onOnboarded} onLogout={logout} />
    </Slide>
  );
  if (phase === "terms") return (
    <Slide dir="fwd" id={sid}>
      <TermsFlow onAccepted={onAcceptedTerms} onLogout={logout} />
    </Slide>
  );
  if (phase === "history")  return <Slide dir="fwd" id={sid}><MyResults onBack={() => { setPhase("upload"); setSid(s => s+1); }} onRestoreResult={onRestoreResult} /></Slide>;
  if (phase === "upload")   return <Slide dir="fwd" id={sid}><Upload onParsed={onParsed} onLogout={logout} onHistory={() => { setPhase("history"); setSid(s => s+1); }} /></Slide>;
  if (phase === "tooshort") return <Slide dir="fwd" id={sid}><TooShort onBack={() => { setPhase("upload"); setSid(s => s+1); }} /></Slide>;
  if (phase === "select") return (
    <Slide dir="fwd" id={sid}>
      <ReportSelect math={math} onSelect={onSelectReport} onBack={() => { setPhase("upload"); setSid(s => s+1); }} />
    </Slide>
  );
  if (phase === "relationship") return (
    <Slide dir="fwd" id={sid}>
      <RelationshipSelect onSelect={onSelectRelationship} onBack={() => { setPhase("select"); setSid(s => s+1); }} />
    </Slide>
  );
  if (phase === "loading") return <Loading math={math} reportType={reportType} />;

  // ── Premium report routing ──
  if (reportType === "toxicity") {
    if (step < TOXICITY_SCREENS) return wrap(<ToxicityReportScreen s={math} ai={ai} aiLoading={aiLoading} step={step} back={back} next={next} />);
    return wrap(<PremiumFinale s={math} restart={restart} back={back} reportType={reportType} />);
  }
  if (reportType === "lovelang") {
    if (step < LOVELANG_SCREENS) return wrap(<LoveLangReportScreen s={math} ai={ai} aiLoading={aiLoading} step={step} back={back} next={next} />);
    return wrap(<PremiumFinale s={math} restart={restart} back={back} reportType={reportType} />);
  }
  if (reportType === "growth") {
    if (step < GROWTH_SCREENS) return wrap(<GrowthReportScreen s={math} ai={ai} aiLoading={aiLoading} step={step} back={back} next={next} />);
    return wrap(<PremiumFinale s={math} restart={restart} back={back} reportType={reportType} />);
  }
  if (reportType === "accounta") {
    if (step < ACCOUNTA_SCREENS) return wrap(<AccountaReportScreen s={math} ai={ai} aiLoading={aiLoading} step={step} back={back} next={next} />);
    return wrap(<PremiumFinale s={math} restart={restart} back={back} reportType={reportType} />);
  }
  if (reportType === "energy") {
    if (step < ENERGY_SCREENS) return wrap(<EnergyReportScreen s={math} ai={ai} aiLoading={aiLoading} step={step} back={back} next={next} />);
    return wrap(<PremiumFinale s={math} restart={restart} back={back} reportType={reportType} />);
  }

  // ── General Wrapped (existing casual analysis) ──
  const contentCount = math.isGroup ? GROUP_CASUAL_SCREENS : DUO_CASUAL_SCREENS;
  const total = contentCount + 1;
  let screen;
  if (step < contentCount) {
    screen = math.isGroup
      ? <GroupScreen s={math} ai={ai} aiLoading={aiLoading} step={step} back={back} next={next} mode="casual" />
      : <DuoScreen   s={math} ai={ai} aiLoading={aiLoading} step={step} back={back} next={next} mode="casual" relationshipType={relationshipType} />;
  } else {
    screen = <Finale s={math} ai={ai} aiLoading={aiLoading} restart={restart} back={back} prog={total} total={total} mode="casual" />;
  }
  return wrap(screen);
}
