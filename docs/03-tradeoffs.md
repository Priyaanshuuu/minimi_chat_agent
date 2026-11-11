# 03 — Tradeoffs

> Status: my design before I write code. For each decision I list what I chose, why, what it costs me, what I rejected, and what would make me revisit it. Budgets and thresholds are starting values until eval traces say otherwise.

My priorities come from `01-problem-statement.md`: reliability first, then token efficiency, then speed and conversation quality. Where they conflict, reliability wins.

## Decision log

### D1 — I own the control flow and rent the plumbing

- **I chose:** my own orchestrator (prepare, route, loop, validate, persist), with a thin SDK for provider calls and streaming.
- **Why:** the budgets, escalation, evidence clearing and validation are the product. Anthropic advises starting with direct API calls and warns that frameworks can hide prompts. Reviewers also read the code, so a short loop I can fully explain beats a framework I only half understand.
- **What it costs me:** more code than an off-the-shelf agent class, and I re-implement small pieces such as retries and step accounting. SDK APIs also change between versions (the loop-control docs use different helper names across major versions), so I pin one version and check names against it.
- **What I rejected:** a full agent framework or graph runtime (more abstraction than a four-route pipeline needs); the raw provider SDK alone (loses model portability and streaming helpers); a hosted agent product.
- **I would revisit if:** I need durable multi-step workflows or human approval steps.

### D2 — An explicit router with an extra hop, instead of prompt-only effort scaling

- **I chose:** a small-model router picks `direct`, `lookup`, `research` or `reverify`, and code enforces the budget for that route.
- **Why:** effort becomes a hard cap and a testable decision. It also selects the model tier and keeps the tool schema out of `direct` turns. Agents judge effort poorly on their own, which is why Anthropic put scaling rules in prompts. I go one step further and enforce them.
- **What it costs me:** one extra small call on every turn (a few hundred input tokens, tens of output) and a little latency. A wrong `direct` on a volatile question is the dangerous miss.
- **How I limit that:** the router fails open to `lookup`; I bias toward search when freshness matters; the `[[SEARCH]]` sentinel on `direct`; one-way escalation; evals that measure under-search and over-search.
- **What I rejected:** prompt-only rules (free but soft, the model can ignore them); keyword or regex routing alone (free but brittle); letting the main model decide through tool choice (saves the hop but ties the decision to the expensive model and cannot choose the tier).
- **I would revisit if:** traces show router latency outweighs its savings. Then I add deterministic fast paths for obvious cases such as greetings.

### D3 — My own `web_search` tool over a search API, instead of provider-hosted search

- **I chose:** a custom function tool backed by one search API.
- **Why:** I control query parameters (dates, domains, depth), result shaping (token cost), caching, tracing, failure handling and fixture-based tests. The AI SDK docs describe provider-executed tools as running on the provider's side and tied to that provider; custom tools give full control and portability.
- **What it costs me:** one more vendor and API key. I own retrieval quality, retries and rate limits. A hosted search stack may rank and cite better than I do.
- **What I rejected:** hosted search from Anthropic, OpenAI or Google. It is the fastest route to a working product and a legitimate choice there, but retrieval becomes a black box in an exercise judged on architecture, and I could not shape, cache or replay it. I also rejected answer-style search APIs that retrieve and synthesise in one call, because the reasoning would sit outside my control.
- **I would revisit if:** my eval set shows my retrieval is clearly worse than hosted search. Then I add hosted search as another provider behind the same interface.

### D4 — One agent with parallel tool calls, instead of multi-agent orchestration

- **I chose:** a single agent loop that issues several searches per step, bounded by route caps.
- **Why:** Anthropic's own numbers put multi-agent systems at roughly 15× chat tokens versus roughly 4× for a single agent, and multi-agent pays off mainly on valuable, breadth-heavy work. A five-tool comparison fits in one agent with parallel calls. Coordination also adds latency.
- **What it costs me:** no context isolation between sub-questions. A very wide task (say 20 entities) crowds one context window. Caps and evidence clearing soften this but do not remove it.
- **What I rejected:** an orchestrator plus subagents as the default path.
- **I would revisit if:** `research` turns regularly hit caps and traces show context crowding. Then I fan out to subagents only above a set number of entities.

### D5 — Snippet-first results with a `deep` option, instead of full pages

- **I chose:** compact excerpts by default, and `deep` for longer excerpts when needed.
- **Why:** most questions are answered by the best excerpt, and full pages are the biggest source of wasted tokens. With no fetch tool, `deep` is how my single tool gets more text out of a page.
- **What it costs me:** a price that sits in a table the excerpt did not capture can be missed or misread, and the fix costs a second call.
- **What I rejected:** full-page text on every search (token-heavy and slow); a separate fetch tool (breaks the one-tool rule).
- **I would revisit if:** evals show a high miss rate on pricing pages. Then I make `deep` the default for pricing-like queries.

### D6 — An evidence store with lazy claim identification, instead of an eager ledger, graph memory or vector memory

- **I chose:** I store every turn with the answer, its evidence cards and `retrieved_at`, and identify volatile claims only when a re-verification is requested.
- **Why:** I pay only when the question is asked. The baseline is exactly what the user was told. Fewer moving parts means fewer extraction errors. "What did I ask on 3 November?" is a date lookup, not a similarity search.
- **What it costs me:** a `reverify` turn carries the earlier answer and its evidence, so that turn has more input tokens. There is no structured cross-turn query such as "everything whose price changed this month".
- **What I rejected:** extracting claims on every answer (an extra call or extra output on every turn, for claims most users never re-check); a temporal knowledge graph in the style of Zep's Graphiti (powerful, but heavy infrastructure for chat-sized history and at odds with a simple `npm install`); vector memory (the wrong tool for date lookups).
- **I would revisit if:** re-verifying large entity sets becomes costly. Then I have the answer step emit a compact claims footer.

### D7 — Deterministic date resolution checked against the store, instead of model-resolved dates

- **I chose:** a parsing library plus my own rules, with the result verified against stored turn dates.
- **Why:** models are unreliable at calendar arithmetic, and code can check its answer against real timestamps.
- **What it costs me:** a dependency and rules to maintain. A bare weekday can resolve to the nearest occurrence instead of the past one, so I add a past-bias rule and unit tests. Ambiguous cases ("Monday" said on a Monday) need a stated assumption.
- **What I rejected:** asking the model to compute dates (cheap to build, quietly wrong at boundaries); demanding explicit dates from the user (poor experience).
- **I would revisit if:** the test set has many unusual or non-English date phrasings. Then I add a small-model fallback for expressions the parser misses, validated against the store.

### D8 — Stream first and verify after, instead of verifying before showing

- **I chose:** stream tokens immediately, validate citation markers in flight, and run the numeric grounding check after the stream, appending a short note if it fails.
- **Why:** perceived speed is part of the brief, most answers should pass, and marker validation costs almost nothing.
- **What it costs me:** a wrong figure can be on screen briefly before the note appears. The numeric check has false positives (formatting, per-seat versus per-year arithmetic).
- **What I rejected:** buffering every answer until verified (adds seconds to every turn); an LLM verifier pass on every answer (an extra call per turn, the opposite of my token goal).
- **I would revisit if:** flagged figures turn out to be frequent. Then I buffer and verify on pricing and `reverify` answers only.

### D9 — Hard budgets with one-way escalation, instead of an open loop or fixed pipelines

- **I chose:** per-route caps on steps, searches, tokens and time; forced finalisation at a cap; at most one escalation per turn, always upward.
- **Why:** cost and latency are bounded and testable. Escalation protects reliability when the cheap route was not enough. Forced finalisation guarantees an answer.
- **What it costs me:** some questions get less depth than the model would have chosen. The caps are informed guesses until I tune them.
- **What I rejected:** an unlimited loop (can spiral on thin results); moving down a route mid-loop (saves tokens but risks missing the answer).
- **I would revisit if:** traces show a route's p90 turn regularly sitting at its cap. I retune from the data.

### D10 — A JSONL file store, instead of SQLite or Postgres

- **I chose:** append-only JSONL behind a `TurnStore` interface.
- **Why:** no native dependency, so `npm install` then `npm run dev` works on any machine, which is a stated rule. A reviewer can read it, and date scans at this scale are cheap.
- **What it costs me:** no concurrency control, no indexes, linear scans, one process only.
- **What I rejected:** a native SQLite module (native modules can fail to install on some machines); Postgres (needs a running service); a vector database (not needed).
- **I would revisit if:** history grows large or needs concurrent writers. I swap the implementation behind the interface.

### D11 — Small, code-graded evals in both directions with repeated trials, instead of spot-checks or LLM judging for everything

- **I chose:** 25 to 30 hand-built tasks, mostly code-graded, one LLM judge for groundedness, three trials each.
- **Why:** the claims in these docs (fewer tokens, no unsupported figures) need numbers. Anthropic suggests starting with a few dozen tasks drawn from real failures and testing search triggering in both directions, because tuning one side alone makes the other worse. Repeated trials show inconsistency.
- **What it costs me:** time to author fixtures. A frozen clock and canned results do not test live retrieval quality, and the LLM judge adds its own error.
- **What I rejected:** manual spot-checking only; public benchmarks (they do not test time-relative memory).
- **I would revisit if:** live-search regressions appear. Then I record real search responses and replay them.

### D12 — One search provider (Tavily by default), instead of several with fallback

- **I chose:** one provider behind an interface.
- **Why:** fewer keys (every key must be listed), simpler code, and Tavily's request parameters map directly onto my tool schema.
- **What it costs me:** a single point of failure and vendor-specific quirks with undated or script-heavy pages. I picked it by reading docs, not from a head-to-head test.
- **What I rejected:** fanning out to several providers (more tokens, more keys, more de-duplication); Exa as the default. Exa is a strong candidate with per-request freshness control and compact highlights, so I am keeping it as the swap-in.
- **I would revisit if:** running the same eval set on both providers shows a clear difference. Then I pick by pass rate and add the other as a fallback.

### D13 — State an assumption instead of asking a clarifying question

- **I chose:** when an ambiguity is cheap to resolve, the agent answers with a one-clause assumption ("Taking Monday as 9 November…").
- **Why:** fewer turns and faster answers. The user can correct me in one line.
- **What it costs me:** sometimes the assumption is wrong and the answer has to be redone.
- **What I rejected:** asking before every ambiguous answer.
- **I would revisit if:** evals show wrong assumptions are common for a particular class of question. Then I ask for that class.

## Known risks

| Risk | My mitigation | What remains |
|---|---|---|
| Pricing pages are script-rendered or undated, so excerpts miss the price | `deep` depth, a `domains` filter for vendor sites, and an explicit "could not confirm the current page" | Some pricing changes will be missed |
| The router sends a volatile question to `direct` | Fail-open default, freshness bias, `[[SEARCH]]` sentinel, evals | Rare misses on unusual phrasing |
| Date ambiguity or time-zone mismatch | Resolution checked against stored turns, UTC plus zone stored, assumption stated | Edge cases near midnight |
| Search outage or rate limiting | Bounded retries, honest finalise | No fallback provider in v1 |
| Prompt injection through results | Results treated as data, rule in the system prompt, read-only tool | The model's text could still be nudged; there is no side-effecting action to abuse |
| Numeric check false positives | Soft note only, and I track the rate | Occasional unnecessary caveats |
| Caching below the minimum cacheable length does nothing | I measure cache-read tokens in traces | The saving may be zero for a short prefix |

## What I left out on purpose

- Multi-agent orchestration by default.
- A second tool of any kind, including page fetch.
- Graph or vector memory.
- Claim extraction on every answer.
- An LLM verifier on every answer.
- Hosted search as the primary path.
- UI polish beyond a clean streaming chat.

## If I had another week

In priority order:

1. Run both search providers through the evals, pick by data, and add the other as a fallback.
2. Tune the router and caps from real traces, and add deterministic fast paths for obvious cases.
3. Add a buffered verify mode for pricing and `reverify` answers.
4. Emit a compact claims footer at answer time, to make large re-verifications cheaper.
5. Add cached LLM-written digests of old turns, replacing my v1 truncation.
6. Add subagent fan-out for `research` turns above a set number of entities.
7. Record and replay live search runs for regression tests.
8. Add simple source-quality scoring from domain and entity match.
