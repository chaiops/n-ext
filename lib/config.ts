const CONFIG_KEY = Symbol.for("__nni_config__");
const g = globalThis as unknown as Record<symbol, NNIConfig | undefined>;

export interface NNIConfig {
  cookieName: string;
  maxBodySize: number;
  maxRequests: number;
  ttlMs: number;
  enabled: boolean;
  corsOrigin: string;
  apiPath: string;
}

const defaults: NNIConfig = {
  cookieName: "__nni_fp",
  maxBodySize: 64 * 1024,
  maxRequests: 50,
  ttlMs: 60 * 60 * 1000,
  enabled: process.env.NODE_ENV === "development",
  corsOrigin: "*",
  apiPath: "/api/nni",
};

export function defineNNIConfig(overrides: Partial<NNIConfig>) {
  g[CONFIG_KEY] = { ...defaults, ...overrides };
}

export function getConfig(): NNIConfig {
  return g[CONFIG_KEY] ?? defaults;
}
