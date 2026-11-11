"use client";

import { FormEvent, useState } from "react";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  isError?: boolean;
}

interface StreamEvent {
  type: "status" | "answer" | "error";
  message: string;
}

const INITIAL_MESSAGE: ChatMessage = {
  id: "welcome",
  role: "assistant",
  content:
    "Ask me about a current topic, compare options, or revisit something we discussed.",
};

export default function Home() {
  const [messages, setMessages] = useState<ChatMessage[]>([INITIAL_MESSAGE]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = input.trim();

    if (!message || isLoading) {
      return;
    }

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: message,
    };
    setMessages((currentMessages) => [...currentMessages, userMessage]);
    setInput("");
    setStatus("Starting...");
    setIsLoading(true);

    try {
      await streamChat(message);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Something went wrong.";
      appendMessage({
        id: crypto.randomUUID(),
        role: "assistant",
        content: errorMessage,
        isError: true,
      });
      setStatus("");
    } finally {
      setIsLoading(false);
    }
  }

  async function streamChat(message: string): Promise<void> {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: getUserId(),
        conversationId: getConversationId(),
        message,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        clientTimestamp: new Date().toISOString(),
      }),
    });

    if (!response.body) {
      throw new Error("The server returned an empty response.");
    }

    if (!response.ok) {
      throw new Error(`The request failed with status ${response.status}.`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });

      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";

      for (const rawEvent of events) {
        const event = parseStreamEvent(rawEvent);
        if (event) {
          handleStreamEvent(event);
        }
      }

      if (done) {
        break;
      }
    }
  }

  function handleStreamEvent(event: StreamEvent): void {
    if (event.type === "status") {
      setStatus(event.message);
      return;
    }

    if (event.type === "error") {
      appendMessage({
        id: crypto.randomUUID(),
        role: "assistant",
        content: event.message,
        isError: true,
      });
      setStatus("");
      return;
    }

    appendMessage({
      id: crypto.randomUUID(),
      role: "assistant",
      content: event.message,
    });
    setStatus("");
  }

  function appendMessage(message: ChatMessage): void {
    setMessages((currentMessages) => [...currentMessages, message]);
  }

  return (
    <main className="chat-shell">
      <section className="chat-panel" aria-label="Minimi chat">
        <header className="chat-header">
          <div>
            <p className="eyebrow">MINIMI</p>
            <h1>Research clearly.</h1>
            <p className="header-description">
              A focused web-search assistant for answers that stay grounded.
            </p>
          </div>
          <span className="status-dot" aria-label="Ready" />
        </header>

        <div className="message-list" aria-live="polite">
          {messages.map((chatMessage) => (
            <article
              className={`message-row ${chatMessage.role === "user" ? "message-row-user" : ""}`}
              key={chatMessage.id}
            >
              <div
                className={`message-bubble ${chatMessage.role === "user" ? "message-bubble-user" : "message-bubble-assistant"} ${chatMessage.isError ? "message-bubble-error" : ""}`}
              >
                {chatMessage.content}
              </div>
            </article>
          ))}
          {status && (
            <p className="status-message" role="status">
              <span className="status-pulse" />
              {status}
            </p>
          )}
        </div>

        <form className="composer" onSubmit={handleSubmit}>
          <label className="sr-only" htmlFor="chat-input">
            Message
          </label>
          <textarea
            id="chat-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder="Ask a question..."
            rows={1}
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            aria-label="Send message"
          >
            <span aria-hidden="true">↑</span>
          </button>
          <p>Enter to send · Shift + Enter for a new line</p>
        </form>
      </section>
    </main>
  );
}

function parseStreamEvent(rawEvent: string): StreamEvent | undefined {
  const dataLine = rawEvent
    .split("\n")
    .find((line) => line.startsWith("data:"));

  if (!dataLine) {
    return undefined;
  }

  try {
    return JSON.parse(dataLine.slice(5).trim()) as StreamEvent;
  } catch {
    return {
      type: "error",
      message: "The server returned an unreadable event.",
    };
  }
}

function getUserId(): string {
  return getOrCreateStorageId("minimi-user-id", "user");
}

function getConversationId(): string {
  return getOrCreateStorageId("minimi-conversation-id", "conversation");
}

function getOrCreateStorageId(key: string, prefix: string): string {
  const existingId = window.localStorage.getItem(key);
  if (existingId) {
    return existingId;
  }

  const newId = `${prefix}-${crypto.randomUUID()}`;
  window.localStorage.setItem(key, newId);
  return newId;
}
