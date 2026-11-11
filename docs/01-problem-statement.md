# 01 — Problem statement

> Status: this is my design before I write any code. It is the long version of the one-page `DESIGN.md` I will submit.

## The task as I understand it

I am building a chat agent whose only tool is web search, and I want it to be as good as the best web-search chat agents available today. People will chat with it like real users, read my code and read my `DESIGN.md`. The judging criterion is architecture: how I design the agent to be fast, correct and good to talk to. Feature count and UI polish do not win, so I am not spending my time there.

## Hard constraints and what I take from them

| Constraint | What it means for me |
|---|---|
| JavaScript or TypeScript on Node | I am using TypeScript in one Node process |
| `npm install`, then `npm run dev` | No native build steps, no external service to start, no setup beyond API keys |
| Every API key listed in `.env.example` | I keep the key surface small: one LLM key and one search key |
| One tool: web search | The model sees exactly one function. Memory, date handling, budgets and validation are code around the model, not tools it calls |
| Public repo and a one-page `DESIGN.md` | These three docs are the long form; `DESIGN.md` will be the short version |

## What the example prompts tell me

The published examples are not "look something up" questions. They are about time and memory:

1. "On Monday we shortlisted 5 CRM tools for a 20-person sales team. Has any of them changed pricing or shipped something big since?"
2. "What did I ask you on 3 November? Is your answer still correct today?"
3. "Last Tuesday I asked you about Postgres hosting. Has any pricing changed since then?"

Each one needs four things that a plain "LLM plus search loop" does not give me:

- **Know what today is**, and turn "Monday", "last Tuesday", "3 November" and "since then" into real dates.
- **Remember what was said, and when**, across turns and across days, including the evidence behind each earlier answer.
- **Decide what could have changed.** Prices and releases are volatile; a historical fact is not.
- **Re-check only that**, and report honestly: changed, unchanged, or could not verify.

I expect the test set to mix prompts like these with ordinary questions. So I am building the general capability (time-aware, memory-aware verification) and letting ordinary questions flow through the same pipeline, instead of special-casing the examples.

## The problems I need to solve

**P1 — Temporal grounding.** Models do not know the date. Anthropic reported that Claude kept adding the year to search queries after web search launched, which skewed results, and fixed it in the tool description. I do not want the model guessing dates at all, so I resolve relative dates in code.

**P2 — Memory with provenance.** "What did I ask on 3 November?" is a lookup, not a reasoning task. I need to store each turn with a timestamp and the sources behind the answer, and the agent must never invent a conversation that did not happen.

**P3 — Staleness detection.** "Is your answer still correct?" does not mean "search everything again". The agent has to work out which claims are volatile and spend search effort only on those.

**P4 — Effort calibration (tokens and latency).** A greeting, a stable fact, a single current-status lookup, a five-tool comparison and a re-verification are different jobs. Agents judge effort poorly on their own, which is why Anthropic's research team wrote explicit effort-scaling rules into their prompts. Cost is not a detail: in their measurements agents used roughly 4× and multi-agent systems roughly 15× the tokens of a chat interaction. Without a budget, a search agent either under-searches volatile questions or burns tokens on trivial ones. This is the problem I care about most, so I decided effort should be chosen deliberately by a router instead of being left to the model.

**P5 — Grounding reliability.** A confident wrong price is the worst failure for this kind of product. Sources vary in quality (SEO pages versus vendor pages), results may be about the wrong year or product, search can fail, and retrieved text can contain instructions aimed at the model.

**P6 — Conversation quality.** Visible progress right away, answer first, short by default, honest about uncertainty, sources present but not noisy.

## My goals, in priority order

1. **Reliability.** No unsupported figures. Time-relative questions resolved correctly. Honest degradation when search fails or evidence is thin. Consistent behaviour across repeated runs. I put this first because a confident wrong price is worse than a short or slow answer.
2. **Token efficiency.** Effort in proportion to the question, enforced by code instead of hoped for in a prompt. This is why routing by effort is the centre of my design.
3. **Speed.** Immediate feedback, and a fast first token on easy questions.
4. **Conversation quality.** Answer-first, calibrated, quiet about its own process.

When reliability and efficiency conflict, I escalate effort instead of guessing (see "Escalation" in `02-design-approach.md`).

I also decided not to use every pattern I came across while researching. I kept the few that help with reliability and token cost and left the rest out. The reasoning is in `03-tradeoffs.md`.

## What I am not building

- A long-running autonomous research agent that produces multi-minute reports.
- More than one tool (page fetch, code execution, calculators). One tool is the rule.
- Multi-agent orchestration as the default path.
- Auth, multi-tenant scale or production deployment.
- Rich UI. A clean streaming chat is enough.

## Failures I refuse to ship

1. A stale price presented as current, with no date.
2. A past conversation that never happened, "remembered" anyway.
3. A search for everything, including "hi", "thanks" and "what is a hash map".
4. No search on a volatile question because the model felt sure.
5. A confident answer after the search tool failed.
6. Instructions inside a web page being followed.
7. A re-verification that re-researches stable facts, or says "nothing changed" when it simply found nothing.
8. A long silent wait with no sign of progress.

## How I will know it works

The targets are hypotheses I will set after my first baseline run. They are not measured results.

| Dimension | Metric |
|---|---|
| Correctness | Pass rate on a hand-built eval set (time-relative, stable-fact, multi-entity, adversarial) |
| Reliability | Same task passing across repeated trials; share of answers whose figures and citations trace to retrieved evidence |
| Efficiency | Tokens and search calls per turn by route; share of turns that needed no search |
| Speed | Time to first visible event and to first token; total time, by route |
| Triggering | Over-search and under-search rates on a labelled set, measured in both directions |

## Assumptions and open questions

- **I do not know how history reaches the agent.** The grader might replay a conversation with timestamps, run one long session, or use separate sessions on different days. I persist turns server-side under a user and conversation id and accept optional client timestamps, so all three cases work.
- **Time zone.** Day boundaries such as "3 November" depend on it. I use the browser's zone when it is given, fall back to UTC, and state the assumption in the answer when it matters.
- **What "today" is in tests.** I make the clock injectable, so time-relative prompts can be tested deterministically.
- **Search quality ceiling.** With one search tool and no page fetch, my answers are only as good as the excerpts the search provider returns. Pricing tables on script-heavy pages are the weak spot I already know about.
