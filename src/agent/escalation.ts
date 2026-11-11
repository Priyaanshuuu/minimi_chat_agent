import type { RouteType } from "@/src/types/domain";

const ROUTE_ORDER: readonly RouteType[] = [
  "direct",
  "lookup",
  "research",
  "reverify",
];

export function getEscalatedRoute(route: RouteType): RouteType | undefined {
  const routeIndex = ROUTE_ORDER.indexOf(route);
  const nextRoute = ROUTE_ORDER[routeIndex + 1];

  return nextRoute;
}

export function shouldEscalate(
  route: RouteType,
  reason: "direct-search-sentinel" | "search-cap" | "no-usable-results",
  options: { searchesRequested: boolean; usableEvidence: boolean },
): boolean {
  if (route === "reverify") {
    return false;
  }

  if (reason === "direct-search-sentinel") {
    return route === "direct";
  }

  if (reason === "search-cap") {
    return route === "lookup" && options.searchesRequested;
  }

  return route === "lookup" && !options.usableEvidence;
}
