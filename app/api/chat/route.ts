import { runChatTurn, type ChatRequest } from "@/src/server/chat-service";

export async function POST(request: Request): Promise<Response> {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown): void => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      };

      try {
        const body = await parseRequestBody(request);
        const service = getRuntimeChatService();
        await runChatTurn(body, service, send);
        controller.close();
      } catch (error) {
        send({
          type: "error",
          message: error instanceof Error ? error.message : String(error),
        });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
    },
  });
}

async function parseRequestBody(request: Request): Promise<ChatRequest> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    throw new Error("Request body must be valid JSON");
  }

  if (!isRecord(body)) {
    throw new Error("Request body must be a JSON object");
  }

  const payload: ChatRequest = {
    userId: requireString(body.userId, "userId"),
    conversationId: requireString(body.conversationId, "conversationId"),
    message: requireString(body.message, "message"),
    ...(optionalString(body.clientTimestamp, "clientTimestamp")
      ? { clientTimestamp: optionalString(body.clientTimestamp, "clientTimestamp") }
      : {}),
    ...(optionalString(body.timeZone, "timeZone")
      ? { timeZone: optionalString(body.timeZone, "timeZone") }
      : {}),
  };

  return payload;
}

function getRuntimeChatService(): never {
  throw new Error(
    "Chat runtime is not configured. Provide the model, search, and store adapters before starting the server.",
  );
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }

  return value.trim();
}

function optionalString(value: unknown, fieldName: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return requireString(value, fieldName);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
