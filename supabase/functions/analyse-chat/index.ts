import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "https://wrapchat.vercel.app",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseModelJson(rawText: string): unknown {
  const stripped = rawText.replace(/^```json\n?/, "").replace(/\n?```$/, "").trim();

  try {
    return JSON.parse(stripped);
  } catch {
    const match = stripped.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON object found in response");
    return JSON.parse(match[0]);
  }
}

function looksCanonicalAnalysis(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (!Array.isArray(value.people)) return false;
  if (!isRecord(value.shared)) return false;

  const shared = value.shared;
  const looksLikeCoreA = [
    "vibeOneLiner",
    "ghostContext",
    "funniestReason",
    "relationshipSummary",
    "kindestPerson",
    "sweetMoment",
    "growth",
  ].some(key => key in shared);

  const looksLikeCoreB = [
    "toxicity",
    "accountability",
  ].some(key => key in shared);

  return looksLikeCoreA || looksLikeCoreB;
}

async function callAnthropic(apiKey: string, system: string, userContent: string, max_tokens: number) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens,
      system,
      messages: [{ role: "user", content: userContent }],
    }),
  });

  return res;
}

async function repairAnalysisPayload(apiKey: string, system: string, userContent: string, rawOutput: string, maxTokens: number) {
  const repairSystem = [
    "You repair multilingual AI outputs into strict JSON.",
    "Use the exact JSON structure and exact English key names required by the original instructions.",
    "Preserve all free-text values in whatever language they already use unless the original instructions explicitly require an English control token.",
    "Do not add markdown fences, commentary, or extra keys.",
    "Return only valid JSON.",
  ].join(" ");

  const repairUser = `Original system instruction:
${system}

Original user instruction:
${userContent}

Model output to repair:
${rawOutput}

Rewrite that output into valid JSON that exactly follows the original schema and uses the exact English key names from the original instructions. Preserve the existing free-text content wherever possible.`;

  const repairRes = await callAnthropic(apiKey, repairSystem, repairUser, Math.max(maxTokens, 2600));
  if (!repairRes.ok) {
    await repairRes.text();
    throw new Error("Schema repair failed");
  }

  const repairData = await repairRes.json();
  return repairData.content?.[0]?.text?.trim() ?? "{}";
}

async function repairJsonPayload(apiKey: string, system: string, userContent: string, rawOutput: string, maxTokens: number) {
  const repairSystem = [
    "You repair AI outputs into strict valid JSON.",
    "Follow the original instructions exactly.",
    "Do not add markdown fences, commentary, or extra keys.",
    "Return only valid JSON.",
  ].join(" ");

  const repairUser = `Original system instruction:
${system}

Original user instruction:
${userContent}

Model output to repair:
${rawOutput}

Rewrite that output into valid JSON that follows the original instructions exactly.`;

  const repairRes = await callAnthropic(apiKey, repairSystem, repairUser, Math.max(maxTokens, 1800));
  if (!repairRes.ok) {
    await repairRes.text();
    throw new Error("JSON repair failed");
  }

  const repairData = await repairRes.json();
  return repairData.content?.[0]?.text?.trim() ?? "{}";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  // Verify JWT
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const { error: authError } = await supabase.auth.getUser();
  if (authError) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }

  try {
    const { system, userContent, max_tokens = 1500, schema_mode = "analysis" } = await req.json();

    if (!system || !userContent) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: system, userContent" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "ANTHROPIC_API_KEY secret not set" }),
        { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const res = await callAnthropic(apiKey, system, userContent, max_tokens);

    if (!res.ok) {
      await res.text(); // consume and discard — never relay raw Anthropic error body
      return new Response(
        JSON.stringify({ error: "Analysis failed. Please try again." }),
        { status: 502, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const data = await res.json();
    const raw = data.content?.[0]?.text?.trim() ?? "{}";
    let parsed: unknown = null;
    try {
      parsed = parseModelJson(raw);
    } catch {
      // We'll try a repair pass below using the raw model output.
    }

    if (schema_mode === "analysis" && !looksCanonicalAnalysis(parsed)) {
      const repairedRaw = await repairAnalysisPayload(apiKey, system, userContent, raw, max_tokens);
      parsed = parseModelJson(repairedRaw);
    } else if (parsed == null) {
      const repairedRaw = await repairJsonPayload(apiKey, system, userContent, raw, max_tokens);
      parsed = parseModelJson(repairedRaw);
    }

    return new Response(
      JSON.stringify(parsed),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: String(e) }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
