import { strict as assert } from "node:assert";

import { resolveDateReferences } from "@/src/agent/date-resolver";
import { getEscalatedRoute, shouldEscalate } from "@/src/agent/escalation";
import { parseRouteDecision } from "@/src/agent/router";
import { validateResponse } from "@/src/agent/validate";
import { shapeSearchResults } from "@/src/search/result-shaper";

interface EvalCase {
  name: string;
  run: () => void | Promise<void>;
}

const evidence = [
  {
    id: "[1]",
    url: "https://example.com/pricing",
    title: "Pricing",
    domain: "example.com",
    excerpt: "The professional plan costs $49 per user per month.",
    retrievedAt: "2026-11-11T00:00:00.000Z",
  },
];

const cases: EvalCase[] = [
  {
    name: "resolves relative weekday to a past date",
    run: () => {
      const result = resolveDateReferences(
        "What did I ask on Monday?",
        new Date("2026-11-11T10:00:00.000Z"),
        "Asia/Kolkata",
      );

      assert.equal(result.references[0]?.date, "2026-11-09");
    },
  },
  {
    name: "anchors since then to history",
    run: () => {
      const result = resolveDateReferences(
        "Has anything changed since then?",
        new Date("2026-11-11T10:00:00.000Z"),
        "UTC",
        "2026-11-03",
      );

      assert.equal(result.references[0]?.date, "2026-11-03");
      assert.equal(result.references[0]?.source, "history");
    },
  },
  {
    name: "reports unresolved since then",
    run: () => {
      const result = resolveDateReferences(
        "Has anything changed since then?",
        new Date("2026-11-11T10:00:00.000Z"),
        "UTC",
      );

      assert.equal(result.hasUnresolvedReference, true);
    },
  },
  {
    name: "accepts a valid router decision",
    run: () => {
      assert.deepEqual(parseRouteDecision('{"route":"research","reason":"Compare several current options"}'), {
        route: "research",
        reason: "Compare several current options",
        fallbackUsed: false,
      });
    },
  },
  {
    name: "rejects overlong router reasons",
    run: () => {
      assert.throws(() =>
        parseRouteDecision(
          JSON.stringify({
            route: "lookup",
            reason: "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty one",
          }),
        ),
      );
    },
  },
  {
    name: "escalates only upward",
    run: () => {
      assert.equal(getEscalatedRoute("lookup"), "research");
      assert.equal(getEscalatedRoute("research"), "reverify");
      assert.equal(getEscalatedRoute("reverify"), undefined);
      assert.equal(
        shouldEscalate("lookup", "no-usable-results", {
          searchesRequested: false,
          usableEvidence: false,
        }),
        true,
      );
      assert.equal(
        shouldEscalate("research", "no-usable-results", {
          searchesRequested: false,
          usableEvidence: false,
        }),
        false,
      );
    },
  },
  {
    name: "shapes and limits evidence by domain",
    run: () => {
      const cards = shapeSearchResults(
        [
          {
            url: "https://www.example.com/a#section",
            title: "A",
            content: "first",
          },
          {
            url: "https://example.com/a",
            title: "Duplicate",
            content: "duplicate",
          },
          {
            url: "https://example.com/b",
            title: "B",
            content: "second",
          },
          {
            url: "https://example.com/c",
            title: "C",
            content: "third",
          },
        ],
        { query: "pricing", maxResults: 8 },
        "2026-11-11T00:00:00.000Z",
        (() => `[${cardsId++}]`),
      );

      assert.equal(cards.length, 2);
      assert.deepEqual(cards.map(({ domain }) => domain), [
        "example.com",
        "example.com",
      ]);
    },
  },
  {
    name: "flags unsupported figures and unknown citations",
    run: () => {
      const result = validateResponse({
        answer: "The plan costs $99 [1] and has 30 seats [4].",
        evidence,
      });

      assert.equal(result.flags.invalidCitations, true);
      assert.equal(result.flags.unsupportedFigures, true);
      assert.match(result.answer, /could not verify every figure/i);
      assert.doesNotMatch(result.answer, /\[4\]/);
    },
  },
  {
    name: "accepts figures grounded in evidence",
    run: () => {
      const result = validateResponse({
        answer: "The plan costs $49 per user per month [1].",
        evidence,
      });

      assert.equal(result.flags.unsupportedFigures, undefined);
      assert.equal(result.flags.invalidCitations, undefined);
    },
  },
];

let cardsId = 1;

export async function runEvaluations(): Promise<void> {
  let failures = 0;

  for (const evaluationCase of cases) {
    try {
      cardsId = 1;
      await evaluationCase.run();
      console.log(`PASS ${evaluationCase.name}`);
    } catch (error) {
      failures += 1;
      console.error(
        `FAIL ${evaluationCase.name}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  console.log(`\n${cases.length - failures}/${cases.length} evaluations passed`);

  if (failures > 0) {
    process.exitCode = 1;
  }
}
