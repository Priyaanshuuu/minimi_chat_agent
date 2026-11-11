# Minimi

Minimi is a time-aware, evidence-grounded web-search chat agent. Its central
design choice is to keep deterministic responsibilities in code date
resolution, memory lookup, budgets, evidence shaping, and validation and use
the model for language decisions and answer composition.

## What it solves

Minimi is designed for questions such as:

- “What did I ask you on 3 November?”
- “Has the pricing of those tools changed since Monday?”
- “Which current option is best for a small sales team?”

The system resolves relative dates against an injectable clock and timezone,
retrieves timestamped history with provenance, routes each turn to a bounded
effort level, searches through one controlled tool, and validates citations and
figures before persistence.

## Architecture

```text
request
  -> prepare: clock, timezone, dates, history
  -> router: direct | lookup | research | reverify
  -> loop: bounded model rounds and web_search calls
  -> validate: citations, figures, failure flags
  -> persist: append-only JSONL turn record
  -> SSE response
```

### Source map

| Area | Location | Responsibility |
|---|---|---|
| Request/UI | [`app/`](./app) | Next.js page and SSE Route Handler |
| Preparation | [`src/agent/prepare.ts`](./src/agent/prepare.ts) | Time, dates, history selection, compaction |
| Routing | [`src/agent/router.ts`](./src/agent/router.ts) | Structured route choice and fail-open fallback |
| Loop | [`src/agent/loop.ts`](./src/agent/loop.ts) | Budgets, parallel searches, forced finalization |
| Search | [`src/search/`](./src/search) | Tavily adapter, shaping, validation, caching |
| Persistence | [`src/store/`](./src/store) | `TurnStore` and JSONL implementation |
| LLM | [`src/llm/anthropic.ts`](./src/llm/anthropic.ts) | Anthropic Messages API adapter |
| Evaluation | [`evals/`](./evals) | Frozen-clock, fixture-based reliability checks |

The longer reasoning and tradeoff record is in [`docs/`](./docs). The concise
design submission is [`DESIGN.md`](./DESIGN.md).

## Getting started

Requirements:

- Node.js 20 or newer
- npm
- Anthropic and Tavily API keys for live requests

```bash
npm install
Copy-Item .env.example .env.local
npm run dev
```

Open `http://localhost:3000`.

The API route is `POST /api/chat`. It accepts:

```json
{
  "userId": "demo-user",
  "conversationId": "demo-conversation",
  "message": "What changed since Monday?",
  "clientTimestamp": "2026-11-11T10:00:00.000Z",
  "timeZone": "Asia/Kolkata"
}
```

The response is an SSE stream containing `status`, `answer`, or `error`
events. API keys are read server-side only; never expose them as
`NEXT_PUBLIC_*` variables or commit `.env.local`.

## Configuration

Copy [`.env.example`](./.env.example) to `.env.local`:

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Server-side Anthropic API key |
| `TAVILY_API_KEY` | Server-side Tavily API key |
| `MODEL_FAST` | Router and direct/lookup model |
| `MODEL_MAIN` | Research and re-verification model |
| `*_MAX_TOKENS` | Per-route output-token cap |
| `*_MAX_DURATION_MS` | Per-route wall-clock cap |

Configuration is validated lazily when the first server request needs it.
Missing or invalid values fail explicitly.

## Validation commands

All local validation is credential-free:

```bash
npm run lint
npm run build
npx tsc --noEmit
npm run eval
```

`npm run eval` compiles the deterministic harness and runs the fixture suite.
It uses no network calls or API keys. Live provider testing is intentionally
separate from the default validation path.

## Persistence and privacy

Turn history is written as one append-only JSONL file per user under
`data/turns/`. The directory is ignored by Git. Each record contains the
timestamp, timezone, route, evidence cards, queries, usage, trace, and
validation flags needed for later memory lookup and re-verification.

This is a local-development store, not a multi-tenant production database. It
has no authentication, encryption, or concurrency coordination; those are
explicitly outside the project scope.

## Design priorities

1. Reliability over confident guessing
2. Token and search efficiency
3. Fast visible progress
4. Concise, honest conversation

See [`DESIGN.md`](./DESIGN.md) for the implementation decisions, failure
behavior, evaluation strategy, and known limitations.
