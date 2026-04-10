import JSZip from "jszip";
import { parseWhatsAppExport, toAnalysisMessages } from "./whatsappParser";

const MAX_IMPORT_BYTES = 50 * 1024 * 1024;

function isZipFile(file) {
  return /\.zip$/i.test(file?.name || "") || file?.type === "application/zip" || file?.type === "application/x-zip-compressed";
}

function isTextFile(file) {
  return /\.txt$/i.test(file?.name || "") || file?.type === "text/plain";
}

function scoreZipEntry(entry) {
  const name = entry.name.toLowerCase();
  let score = entry._data?.uncompressedSize || 0;
  if (name.includes("whatsapp chat")) score += 1_000_000;
  if (!name.includes("/")) score += 100_000;
  if (name.startsWith("__macosx/")) score -= 1_000_000;
  return score;
}

function pickBestTextEntry(zip) {
  return Object.values(zip.files)
    .filter(entry => !entry.dir && /\.txt$/i.test(entry.name) && !entry.name.startsWith("__MACOSX/"))
    .sort((a, b) => scoreZipEntry(b) - scoreZipEntry(a))[0] || null;
}

function formatParticipantLabel(participants) {
  const names = Array.isArray(participants) ? participants.filter(Boolean) : [];
  if (names.length === 0) return "this chat";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} others`;
}

function formatDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function buildSummary(parsed) {
  const [start, end] = parsed.metadata.dateRange || [];
  return {
    participants: parsed.participants,
    participantLabel: formatParticipantLabel(parsed.participants),
    messageCount: parsed.metadata.messageCount || 0,
    dateRange: [start || null, end || null],
    dateRangeLabel: start && end ? `${formatDate(start)} - ${formatDate(end)}` : "Date range unavailable",
  };
}

async function extractChatText(file) {
  if (isTextFile(file)) return file.text();

  if (isZipFile(file)) {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const textEntry = pickBestTextEntry(zip);
    if (!textEntry) {
      throw new Error("We couldn't find the chat text inside that export. Try exporting again, or export without media.");
    }
    return textEntry.async("string");
  }

  throw new Error("Please share a WhatsApp export as a .txt or .zip file.");
}

export async function processImportedChatFile(file, { onStatus } = {}) {
  if (!file) throw new Error("Choose a WhatsApp export to continue.");
  if (file.size > MAX_IMPORT_BYTES) {
    throw new Error("This export is too large to open here. Try exporting a shorter date range.");
  }

  onStatus?.({ key: "opening", message: "Opening your chat..." });

  let rawText = "";
  try {
    rawText = await extractChatText(file);
    onStatus?.({ key: "reading", message: "Reading messages..." });

    const parsed = parseWhatsAppExport(rawText);
    if (!parsed.formatDetected || !parsed.messages.length) {
      throw new Error("We couldn't read that chat. Try exporting the chat again, or export without media.");
    }

    const analysisMessages = toAnalysisMessages(parsed);
    const summary = buildSummary(parsed);
    onStatus?.({
      key: "found",
      message: `Found ${summary.messageCount.toLocaleString()} messages with ${summary.participantLabel}.`,
    });

    return {
      parsed,
      analysisMessages,
      tooShort: parsed.tooShort,
      summary,
      payload: {
        messages: analysisMessages,
        tooShort: parsed.tooShort,
      },
    };
  } catch (error) {
    const message = String(error?.message || "");
    if (/corrupt|unsupported|zip/i.test(message)) {
      throw new Error("We couldn't open that export cleanly. Try exporting the chat again without media.");
    }
    throw error;
  } finally {
    rawText = "";
  }
}
