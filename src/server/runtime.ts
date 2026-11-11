import { getConfig } from "@/src/env";
import { AnthropicModel } from "@/src/llm/anthropic";
import { TavilySearchProvider } from "@/src/search/tavily";
import { WebSearchTool } from "@/src/search/tool";
import { JsonlTurnStore } from "@/src/store/jsonl-turn-store";
import type { ChatServiceDependencies } from "@/src/server/chat-service";

let runtimeDependencies: ChatServiceDependencies | undefined;

export function getRuntimeChatService(): ChatServiceDependencies {
  if (runtimeDependencies) {
    return runtimeDependencies;
  }

  const config = getConfig();
  const routerModel = new AnthropicModel({
    apiKey: config.llmApiKey,
    model: config.routeBudgets.direct.model,
  });
  const agentModel = new AnthropicModel({
    apiKey: config.llmApiKey,
    model: config.routeBudgets.research.model,
    maxOutputTokens: config.routeBudgets.research.maxTokens,
  });
  const provider = new TavilySearchProvider({
    apiKey: config.searchApiKey,
  });

  runtimeDependencies = {
    config,
    routerModel,
    agentModel,
    searchTool: new WebSearchTool({ provider }),
    store: new JsonlTurnStore(),
  };

  return runtimeDependencies;
}

export function resetRuntimeForTests(): void {
  runtimeDependencies = undefined;
}
