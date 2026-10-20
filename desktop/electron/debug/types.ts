export type ContextSnapshot = {
  conversationId: string;
  title: string;
  snapshot: null | {
    capturedAt: string;
    runId: string;
    executionId: string;
    step: number;
    status: string;
    body: { model: string; messages: unknown[]; tools?: unknown[]; [key: string]: unknown };
    estimatedTokens: number;
    contextLength: number;
    compacted: boolean;
    messageCount: number;
    toolCount: number;
    requestBytes: number;
    usage: null | {
      prompt_tokens?: number;
      input_tokens?: number;
      completion_tokens?: number;
      output_tokens?: number;
      prompt_cache_hit_tokens?: number;
      prompt_cache_miss_tokens?: number;
      prompt_tokens_details?: { cached_tokens?: number };
    };
  };
};
