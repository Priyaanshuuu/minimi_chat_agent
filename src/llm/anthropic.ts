import type {
  AgentModel,
  AgentModelInput,
  AgentModelOutput,
} from "@/src/agent/loop";
import type { SearchRequest, TurnUsage } from "@/src/types/domain";

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_TIMEOUT_MS = 60_000;

interface AnthropicModelOptions {
  apiKey: string;
  model: string;
  maxOutputTokens?: number;
  timeoutMs?: number;
  fetcher?: typeof fetch;
}

interface AnthropicResponse {
  content?: Array<{ type?: unknown; text?: unknown }>;
  usage?: {
    input_tokens?: unknown;
    output_tokens?: unknown;
  };
}

export class AnthropicModel implements AgentModel {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly maxOutputTokens: number;
  private readonly timeoutMs: number;
  private readonly fetcher: typeof fetch;

  constructor(options: AnthropicModelOptions) {
    if (!options.apiKey.trim()) {
      throw new Error("Anthropic API key must be a non-empty string");
    }
    if (!options.model.trim()) {
      throw new Error("Anthropic model must be a non-empty string");
    }

    this.apiKey = options.apiKey;
    this.model = options.model;
    this.maxOutputTokens = options.maxOutputTokens ?? 2_048;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetcher = options.fetcher ?? fetch;
  }

  async complete(prompt: string): Promise<string> {
    const response = await this.request({
      system:
        "Return only the JSON object requested by the caller. Do not use markdown.",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 512,
    });

    return extractText(response);
  }

  async generate(input: AgentModelInput): Promise<AgentModelOutput> {
    const response = await this.request({
      system: `${input.systemPrompt}\n\n${structuredOutputInstruction(input.forceFinal)}`,
      messages: [
        {
          role: "user",
          content: [
            `User request: ${input.userMessage}`,
            `Round: ${input.round}`,
            `Context:\n${input.context}`,
            `Evidence cards:\n${JSON.stringify(input.evidence)}`,
          ].join("\n\n"),
        },
      ],
      max_tokens: Math.min(this.maxOutputTokens, 4_096),
    });

    return parseAgentOutput(response);
  }

  private async request(payload: Record<string, unknown>): Promise<AnthropicResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetcher(ANTHROPIC_MESSAGES_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        body: JSON.stringify({
          model: this.model,
          ...payload,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(
          await formatAnthropicError(response.status, response),
        );
      }

      const body = (await response.json()) as unknown;
      if (!isRecord(body)) {
        throw new Error("Anthropic returned an invalid response");
      }

      async function formatAnthropicError(
        status: number,
        response: Response,
      ): Promise<string> {
        let detail = "";

        try {
          const body = (await response.json()) as unknown;
          if (isRecord(body) && isRecord(body.error) && typeof body.error.message === "string") {
            detail = `: ${body.error.message}`;
          }
        } catch {
          detail = "";
        }

        return `Anthropic request failed with HTTP ${status}${detail}`;
      }

      return body as AnthropicResponse;
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`Anthropic request timed out after ${this.timeoutMs}ms`);
      }
      throw error instanceof Error ? error : new Error(String(error));
    } finally {
      clearTimeout(timeout);
    }
  }
}

function structuredOutputInstruction(forceFinal: boolean): string {
  if (forceFinal) {
    return [
      "You must finalize now.",
      'Return exactly {"kind":"final","text":"..."} as JSON.',
      "Use only the supplied evidence and conversation context.",
    ].join(" ");
  }

  return [
    'Return exactly one JSON object: {"kind":"search","searchRequests":[...]} or {"kind":"final","text":"..."}',
    "Search requests use camelCase keys: query, topic, afterDate, beforeDate, domains, depth, maxResults.",
    "Request concise searches only when evidence is needed.",
  ].join(" ");
}

function extractText(response: AnthropicResponse): string {
  const text = response.content?.find(
    (block) => block.type === "text" && typeof block.text === "string",
  )?.text;

  if (typeof text !== "string" || !text.trim()) {
    throw new Error("Anthropic response did not contain text");
  }

  return text.trim();
}

function parseAgentOutput(response: AnthropicResponse): AgentModelOutput {
  const text = extractText(response)
    .replace(/^```json\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Anthropic agent response was not valid JSON");
  }

  if (!isRecord(parsed) || (parsed.kind !== "search" && parsed.kind !== "final")) {
    throw new Error("Anthropic agent response has an invalid kind");
  }

  const usage = parseUsage(response.usage);
  if (parsed.kind === "final") {
    if (typeof parsed.text !== "string") {
      throw new Error("Anthropic final response is missing text");
    }
    return { kind: "final", text: parsed.text, usage };
  }

  if (!Array.isArray(parsed.searchRequests)) {
    throw new Error("Anthropic search response is missing searchRequests");
  }

  return {
    kind: "search",
    searchRequests: parsed.searchRequests as SearchRequest[],
    usage,
  };
}

function parseUsage(usage: AnthropicResponse["usage"]): TurnUsage {
  const inputTokens = numberOrZero(usage?.input_tokens);
  const outputTokens = numberOrZero(usage?.output_tokens);

  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  };
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
