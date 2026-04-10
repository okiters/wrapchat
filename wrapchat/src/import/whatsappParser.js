export const MIN_MESSAGES = 50;

const INVISIBLE_CHAR_RE = /[\u200e\u200f\u202a-\u202e\ufeff\u2066-\u2069]/g;
const LINE_BREAK_RE = /\r\n?/g;
const SYSTEM_MESSAGE_RE = /end-to-end encrypted|end-to-end şifreli|security code|messages and calls are end-to-end encrypted|messages and calls|mesajlar ve aramalar|created group|changed the subject|changed this group's icon|changed the group description|added|removed|left|joined using this group's invite link|you deleted this message|this message was deleted/i;

const HEADER_PATTERNS = [
  {
    id: "ios",
    re: /^\[(\d{1,4}[./-]\d{1,2}[./-]\d{1,4}),\s*(\d{1,2}:\d{2}(?::\d{2})?\s?(?:[APap]\.?[Mm]\.?)?)\]\s([^:]+?):\s?(.*)$/,
  },
  {
    id: "android",
    re: /^(\d{1,4}[./-]\d{1,2}[./-]\d{1,4}),\s*(\d{1,2}:\d{2}(?::\d{2})?\s?(?:[APap]\.?[Mm]\.?)?)\s[-–—]\s([^:]+?):\s?(.*)$/,
  },
];

function cleanExportText(text) {
  return String(text || "")
    .replace(INVISIBLE_CHAR_RE, "")
    .replace(LINE_BREAK_RE, "\n");
}

function getHeaderPattern(lines) {
  for (const line of lines) {
    for (const pattern of HEADER_PATTERNS) {
      if (pattern.re.test(line)) return pattern;
    }
  }
  return null;
}

function inferDateOrder(lines, pattern) {
  const counts = { dayFirst: 0, monthFirst: 0, yearFirst: 0 };

  for (const line of lines.slice(0, 80)) {
    const match = line.match(pattern.re);
    if (!match) continue;

    const parts = match[1].split(/[./-]/).map(part => part.trim());
    if (parts.length !== 3) continue;
    if (parts[0].length === 4) {
      counts.yearFirst += 1;
      continue;
    }

    const a = Number(parts[0]);
    const b = Number(parts[1]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    if (a > 12 && b <= 12) counts.dayFirst += 1;
    if (b > 12 && a <= 12) counts.monthFirst += 1;
  }

  if (counts.yearFirst > 0) return "year-first";
  if (counts.monthFirst > counts.dayFirst) return "month-first";
  return "day-first";
}

function normalizeYear(value) {
  return value < 100 ? 2000 + value : value;
}

function parseTimestamp(dateToken, timeToken, dateOrder) {
  const parts = dateToken.split(/[./-]/).map(part => Number(part));
  if (parts.length !== 3 || parts.some(part => !Number.isFinite(part))) return null;

  let day;
  let month;
  let year;

  if (dateOrder === "year-first") {
    year = parts[0];
    month = parts[1];
    day = parts[2];
  } else if (dateOrder === "month-first") {
    month = parts[0];
    day = parts[1];
    year = parts[2];
  } else {
    day = parts[0];
    month = parts[1];
    year = parts[2];
  }

  year = normalizeYear(year);

  const timeMatch = String(timeToken || "").trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([APap]\.?[Mm]\.?)?$/);
  if (!timeMatch) return null;

  let hours = Number(timeMatch[1]);
  const minutes = Number(timeMatch[2]);
  const seconds = Number(timeMatch[3] || 0);
  const meridiem = timeMatch[4]?.replace(/\./g, "").toLowerCase();

  if (meridiem === "pm" && hours < 12) hours += 12;
  if (meridiem === "am" && hours === 12) hours = 0;

  const timestamp = new Date(year, month - 1, day, hours, minutes, seconds);
  if (Number.isNaN(timestamp.getTime())) return null;
  if (
    timestamp.getFullYear() !== year ||
    timestamp.getMonth() !== month - 1 ||
    timestamp.getDate() !== day
  ) {
    return null;
  }

  return timestamp;
}

function normalizeBody(text) {
  const body = String(text || "").trim();
  if (/audio omitted|voice omitted|\.(opus|aac|m4a)$/i.test(body)) return "<Voice omitted>";
  if (/^<attached:.*>$/.test(body) || /\.(jpg|jpeg|png|mp4|pdf|webp|heic|mov)$/i.test(body)) return "<Media omitted>";
  return body;
}

function flattenBodyForAnalysis(text) {
  return String(text || "").replace(/\s*\n+\s*/g, " ").trim();
}

export function parseWhatsAppExport(text) {
  const cleanText = cleanExportText(text);
  const rawLines = cleanText.split("\n");
  const pattern = getHeaderPattern(rawLines);

  if (!pattern) {
    return {
      participants: [],
      messages: [],
      metadata: { messageCount: 0, dateRange: [null, null], format: null },
      formatDetected: false,
      tooShort: false,
    };
  }

  const dateOrder = inferDateOrder(rawLines, pattern);
  const joinedLines = [];

  for (const line of rawLines) {
    if (pattern.re.test(line)) {
      joinedLines.push(line);
    } else if (joinedLines.length > 0) {
      const trimmed = line.trimEnd();
      if (trimmed) joinedLines[joinedLines.length - 1] += `\n${trimmed}`;
    }
  }

  const participants = [];
  const seenParticipants = new Set();
  const messages = [];

  for (const line of joinedLines) {
    const match = line.match(pattern.re);
    if (!match) continue;

    const timestamp = parseTimestamp(match[1], match[2], dateOrder);
    const sender = String(match[3] || "").trim();
    const textBody = normalizeBody(match[4]);

    if (!timestamp || !sender || !textBody) continue;
    if (SYSTEM_MESSAGE_RE.test(sender) || SYSTEM_MESSAGE_RE.test(textBody)) continue;

    if (!seenParticipants.has(sender)) {
      seenParticipants.add(sender);
      participants.push(sender);
    }

    messages.push({
      sender,
      text: textBody,
      timestamp,
    });
  }

  const first = messages[0]?.timestamp || null;
  const last = messages[messages.length - 1]?.timestamp || null;

  return {
    participants,
    messages,
    metadata: {
      messageCount: messages.length,
      dateRange: [first, last],
      format: pattern.id,
      dateOrder,
    },
    formatDetected: true,
    tooShort: messages.length < MIN_MESSAGES,
  };
}

export function toAnalysisMessages(parsed) {
  return (parsed?.messages || []).map(message => {
    const timestamp = new Date(message.timestamp);
    return {
      name: message.sender,
      body: flattenBodyForAnalysis(message.text),
      date: timestamp,
      hour: timestamp.getHours(),
      month: timestamp.getMonth(),
      year: timestamp.getFullYear(),
    };
  });
}
