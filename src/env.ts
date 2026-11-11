import { loadConfig, type AppConfig } from "@/src/config";

let cachedConfig: AppConfig | undefined;

export function getConfig(): AppConfig {
  cachedConfig ??= loadConfig();
  return cachedConfig;
}

export function resetConfigForTests(): void {
  cachedConfig = undefined;
}
