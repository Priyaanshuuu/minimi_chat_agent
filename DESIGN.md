# Minimi — Design

## Thesis

Minimi is a web-search chat agent for questions whose answers depend on time,
conversation history, or current evidence. The product is not an unlimited
research agent. It is a bounded pipeline that spends effort deliberately and
refuses to turn missing evidence into confident prose.

## Pipeline

```text
prepare -> route -> bounded loop -> validate -> persist -> stream
```

### Prepare — deterministic, no model call

Code chooses the effective `now` from the client timestamp or server clock,
uses the browser timezone or UTC, resolves natural-language dates with
`chrono-node`, and checks resolved dates against stored turns. Recent history
is compacted before it enters the model context. Re-verification receives the
earlier answer and its evidence; ordinary history does not carry raw evidence.

This prevents the model from doing calendar arithmetic or inventing a past
conversation. Missing history is an explicit flag, not an instruction to
guess.

### Route — small structured decision

The router returns `{ route, reason }` and chooses one of:

| Route | Purpose | Search budget |
|---|---|---:|
| `direct` | Greeting, stable knowledge, conversation recall | 0 |
| `lookup` | One current or specific fact | 2 |
| `research` | Comparison or multi-part work | 8 |
| `reverify` | Re-check volatile claims from an earlier answer | 12 |

Invalid router output is retried once, then falls back to `lookup`. A
re-verification route is rejected when no earlier evidence exists. The direct
route can emit `[[SEARCH]]`; code then escalates it to `lookup`.

### Loop — one agent, one tool, hard limits

The model can request only `web_search` calls or a final answer. Code enforces
round, search, token, and duration caps. Searches within a round run in
parallel. At a cap, the loop makes one forced finalization call using the
evidence collected so far. Lookup may escalate once to research; routes never
move downward or escalate repeatedly.

Search results are treated as untrusted data. The system prompt explicitly
prohibits following instructions found in retrieved pages. The tool is
read-only, and no second tool or side-effecting action is exposed.

### Evidence and validation

Search results are normalized into evidence cards with stable IDs, URLs,
domains, excerpts, retrieval times, and optional publication dates. The search
layer removes duplicates, drops empty content, limits two results per domain,
and caps excerpt size.

After generation:

- Unknown citation IDs are removed and flagged.
- Currency amounts, percentages, versions, and similar figures are compared
  with retrieved text.
- Unsupported figures receive an explicit caveat.
- Search failures remain visible in turn flags.

Numeric validation is intentionally a soft warning: it reduces confident
unsupported output without pretending that simple string matching is a perfect
claim verifier.

### Persistence

`TurnStore` separates agent behavior from storage. The development
implementation appends validated records to one JSONL file per user. Records
retain superseded evidence rather than overwriting it, which gives
re-verification a concrete historical baseline.

## Why these choices

- **Explicit router:** budgets become observable and testable instead of being
  a prompt suggestion.
- **Custom search tool:** query dates, domains, depth, shaping, retries, and
  cache behavior remain under application control.
- **Single agent with parallel searches:** enough breadth for comparisons
  without the token and coordination cost of default multi-agent orchestration.
- **Snippet-first retrieval:** most questions need compact evidence; `deep` is
  available for dense pages.
- **Lazy claim checking:** volatile claims are identified during
  re-verification instead of paying an extraction cost on every turn.
- **JSONL:** zero native dependencies and easy inspection satisfy the local
  `npm install`/`npm run dev` constraint. It is not presented as a production
  multi-writer database.

## Failure behavior

| Failure | Behavior |
|---|---|
| Invalid router output | Retry once, then choose `lookup` |
| No record for requested date | Say there is no stored record |
| Search timeout/rate limit | Provider retries within bounds; loop finalizes honestly |
| Empty or weak results | Return an explicit inability-to-verify signal |
| Unknown citation | Remove marker and set `invalidCitations` |
| Unsupported number | Add a grounding caveat and set `unsupportedFigures` |
| Budget exhaustion | Force finalization; never leave the user waiting indefinitely |
| Prompt injection in result | Treat page text as data, never instructions |

## Evaluation

`npm run eval` runs a frozen, credential-free suite covering:

- Relative dates, explicit dates, timezone boundaries, and missing anchors
- Router JSON, markdown wrapping, invalid routes, and fallback retries
- Upward-only escalation and re-verification prerequisites
- URL normalization, duplicate removal, domain caps, and empty excerpts
- Search validation, cache semantics, provider retries, and malformed payloads
- Citation cleanup and numeric grounding
- JSONL append/read/date/conversation/evidence retrieval
- Budgeted loop finalization and search failure behavior

The suite is intentionally code-graded. A future live eval can add real
provider quality and repeated-trial latency/token measurements without
changing the deterministic baseline.

## Known limitations

- Tavily and Anthropic are single-provider dependencies in the default runtime.
- Script-rendered pricing tables may not appear in search excerpts.
- JSONL is for local development and one-process use.
- Numeric grounding is heuristic, not semantic claim extraction.
- Authentication, multi-tenant isolation, encryption, and deployment are out
  of scope.

## Success criteria

The design is successful if it searches volatile questions, avoids searching
obvious direct questions, never invents dated history, bounds cost and
latency, exposes uncertainty, and leaves every answer traceable to stored
evidence or an explicit limitation.
