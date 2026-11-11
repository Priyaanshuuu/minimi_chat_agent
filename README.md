This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
# minimi_chat_agent

## Getting started

Install dependencies and start the development server:

```bash
npm install
npm run dev
```

Copy `.env.example` to `.env.local` and provide the LLM, search-provider, and
model configuration before starting the application. The application validates
required configuration when a server-side feature first accesses it; missing
or invalid values produce an explicit error.

## Project direction

The application is being built as a time-aware, evidence-grounded web-search
chat agent. The implementation follows the architecture described in
[`docs/02-design-approach.md`](./docs/02-design-approach.md): deterministic
preparation, route-specific budgets, a single search tool, validation, and
append-only turn persistence.

The initial shared contracts and route configuration live in `src/`. Agent
behavior, persistence, search integration, streaming, and evaluations will be
added in subsequent implementation steps.

Turn history is stored as append-only JSONL files under the ignored `data/`
directory. The storage implementation is exposed through a `TurnStore`
interface, so the persistence backend can be replaced without changing agent
logic.

The preparation layer in `src/agent/prepare.ts` uses an injectable clock,
time-zone-aware date resolution, and bounded history compaction before any
model call. Relative dates are resolved with `chrono-node`; missing historical
records are surfaced through explicit preparation flags.

Routing is defined in `src/agent/router.ts` and `src/agent/prompts.ts`. Router
responses are strict JSON, limited to 20-word reasons, and fail open to the
search-backed `lookup` route when validation or the router model fails.

The single search tool is defined in `src/search/tool.ts`, with the provider
contract in `src/search/provider.ts`. Tavily responses are validated, shaped
into compact evidence cards, de-duplicated by URL, capped by domain, and
cached briefly for repeated non-reverification queries.

The budgeted loop in `src/agent/loop.ts` runs bounded search rounds in parallel,
forces a final answer at route limits, and permits at most one upward
escalation. Search and model failures remain explicit in the loop result rather
than becoming silent success responses.

Response validation lives in `src/agent/validate.ts`. Citation IDs are checked
against retrieved evidence, numeric figures are compared with evidence text,
and uncertain figures receive an explicit caveat instead of being silently
accepted.

The chat transport is exposed at `app/api/chat/route.ts` as a Node.js
Route Handler using server-sent events. It validates request payloads and
streams preparation, routing, validation, answer, and error events. The route
intentionally requires model, search, and store adapters to be wired before
live requests are enabled.
