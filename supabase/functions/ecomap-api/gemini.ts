// Google Gemini implementation of VisionProvider (REST, no SDK).
// Secrets (set in Supabase: Edge Functions > Secrets):
//   GEMINI_API_KEY   required
//   GEMINI_MODEL     optional, comma-separated list tried in order
//                    (default: gemini-3.8-flash, gemini-3.6-flash, gemini-2.5-flash).
// When a model answers "quota exceeded" or "not found", the next one in the list is tried.
// If none answers, the methods return null and the app falls back to manual severity / moderator review.

import {
  CATEGORIES,
  CLEANUP_PROMPT,
  type CleanupVerification,
  type ImageInput,
  REPORT_PROMPT,
  type ReportAnalysis,
  sanitizeCleanup,
  sanitizeReport,
  type VisionProvider,
} from "./ai.ts";

const DEFAULT_MODELS = ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-2.5-flash"];
// GEMINI_BASE_URL exists for tests and proxies; normally leave it unset.
const ENDPOINT = Deno.env.get("GEMINI_BASE_URL") ?? "https://generativelanguage.googleapis.com/v1beta/models";
const ATTEMPT_TIMEOUT_MS = 25_000;

const REPORT_SCHEMA = {
  type: "OBJECT",
  properties: {
    is_pollution: { type: "BOOLEAN" },
    image_quality: { type: "STRING", enum: ["ok", "unclear"] },
    category: { type: "STRING", enum: [...CATEGORIES] },
    severity: { type: "STRING", enum: ["low", "medium", "high"] },
    hazardous: { type: "BOOLEAN" },
    confidence: { type: "NUMBER" },
    summary: { type: "STRING" },
  },
  required: ["is_pollution", "image_quality", "category", "severity", "hazardous", "confidence", "summary"],
};

const CLEANUP_SCHEMA = {
  type: "OBJECT",
  properties: {
    same_location: { type: "BOOLEAN" },
    is_clean: { type: "BOOLEAN" },
    confidence: { type: "NUMBER" },
    summary: { type: "STRING" },
  },
  required: ["same_location", "is_clean", "confidence", "summary"],
};

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function parseJsonLoosely(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

export class GeminiProvider implements VisionProvider {
  readonly name = "gemini";
  private readonly models: string[];

  constructor(private readonly apiKey: string, models?: string) {
    const list = (models ?? "").split(",").map((m) => m.trim()).filter(Boolean);
    this.models = list.length > 0 ? list : DEFAULT_MODELS;
  }

  /** Returns the parsed JSON answer and the model that produced it, or null if no model could answer. */
  private async ask(
    prompt: string,
    images: ImageInput[],
    schema: unknown,
  ): Promise<{ data: unknown; model: string } | null> {
    const parts: unknown[] = images.map((img) => ({
      inline_data: { mime_type: img.mimeType, data: toBase64(img.bytes) },
    }));
    parts.push({ text: prompt });

    for (const model of this.models) {
      // First with a response schema; if the API refuses the schema (400), once more without it.
      for (const withSchema of [true, false]) {
        const generationConfig: Record<string, unknown> = {
          temperature: 0,
          responseMimeType: "application/json",
        };
        if (withSchema) generationConfig.responseSchema = schema;

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);
        let status = 0;
        try {
          const res = await fetch(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
            method: "POST",
            headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
            body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig }),
            signal: controller.signal,
          });
          status = res.status;
          if (res.ok) {
            const body = await res.json();
            const text: string = (body?.candidates?.[0]?.content?.parts ?? [])
              .map((p: { text?: string }) => p?.text ?? "")
              .join("");
            const data = parseJsonLoosely(text);
            if (data) return { data, model };
            console.warn(`[gemini] ${model}: answer was not JSON (finish: ${body?.candidates?.[0]?.finishReason ?? "?"})`);
            break; // try the next model
          }
          const detail = (await res.text()).slice(0, 300);
          console.warn(`[gemini] ${model}: HTTP ${status} ${detail}`);
          if (status === 400 && withSchema) continue; // retry this model without the schema
          if (status === 401 || status === 403) return null; // key problem: other models will not help
          break; // 404 unknown model, 429 quota, 5xx: try the next model
        } catch (err) {
          console.warn(`[gemini] ${model}: ${err instanceof Error ? err.message : String(err)}`);
          break;
        } finally {
          clearTimeout(timer);
        }
      }
    }
    return null;
  }

  async analyzeReport(image: ImageInput): Promise<ReportAnalysis | null> {
    const answer = await this.ask(REPORT_PROMPT, [image], REPORT_SCHEMA);
    return answer ? sanitizeReport(answer.data, answer.model) : null;
  }

  async verifyCleanup(before: ImageInput, after: ImageInput): Promise<CleanupVerification | null> {
    const answer = await this.ask(CLEANUP_PROMPT, [before, after], CLEANUP_SCHEMA);
    return answer ? sanitizeCleanup(answer.data, answer.model) : null;
  }
}

/** Picks the provider from secrets. Returns null when no AI is configured. */
export function getProvider(): VisionProvider | null {
  const provider = (Deno.env.get("AI_PROVIDER") ?? "gemini").toLowerCase();
  if (provider === "gemini") {
    const key = Deno.env.get("GEMINI_API_KEY");
    return key ? new GeminiProvider(key, Deno.env.get("GEMINI_MODEL") ?? undefined) : null;
  }
  // Add other providers here, for example: if (provider === "anthropic") return new AnthropicProvider(...)
  return null;
}
