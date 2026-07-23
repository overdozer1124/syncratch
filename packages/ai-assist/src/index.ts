export {
  detectProviderFromApiKey,
  normalizeApiKey,
  preferCheapModel,
  resolveProviderAndModel,
  providerEndpoint,
  providerLabel,
  parseAiProviderId,
  isOpenAiCompatible,
  supportedKeyExamples,
  KNOWN_AI_PROVIDERS,
  type AiProviderId,
  type ProviderDetectResult,
  type ProviderModelChoice,
} from "./providers.js";

export {
  DEFAULT_AI_LEVEL,
  clampAiLevel,
  aiLevelPolicy,
  allAiLevelPolicies,
  effectiveAiLevel,
  type AiAssistLevel,
  type AiLevelPolicy,
} from "./levels.js";

export {
  AI_SETTINGS_STORAGE_KEY,
  DEFAULT_AI_SETTINGS,
  normalizeAiAssistSettings,
  loadAiAssistSettings,
  saveAiAssistSettings,
  clearAiAssistSettings,
  resolveAiAssistConfig,
  maskApiKey,
  type AiAssistSettings,
  type AiAssistResolvedConfig,
  type StorageLike,
} from "./settings.js";

export {sanitizeAiText, truncateForTokens, type SanitizeResult} from "./sanitize.js";

export {
  AI_QUESTION_TARGET_ALL,
  buildAiProjectContext,
  listAiQuestionTargets,
  resolveQuestionTargetName,
  type AiBlockSummary,
  type AiSpriteContext,
  type AiProjectContext,
  type AiQuestionTargetOption,
  type ScratchProjectJsonLike,
  type BuildAiProjectContextOptions,
} from "./context.js";

export {
  buildAdviceMessages,
  formatQuestionTargetLabel,
  inferAdviceMode,
  resolveAdviceMode,
  type AiAdviceMode,
  type AiChatMessage,
  type BuildAdvicePromptInput,
} from "./prompt.js";

export {
  BLOCK_IR_VERSION,
  createEmptyBlockIRProposal,
  requiresExplicitApproval,
  type BlockIROperationType,
  type BlockIROperation,
  type BlockIRProposal,
} from "./ir.js";

export {
  AI_CHAT_PROXY_PATH,
  AI_CHAT_MAX_MESSAGES,
  AI_CHAT_MAX_MESSAGE_CHARS,
  AI_CHAT_DEFAULT_MAX_TOKENS,
  AI_CHAT_HARD_MAX_TOKENS,
  type AiChatProxyRequest,
  type AiChatProxySuccess,
  type AiChatProxyFailure,
  type AiChatProxyResponse,
} from "./proxy-protocol.js";

export {
  requestAiChat,
  chatViaProxy,
  chatDirect,
  type AiChatRequest,
  type AiChatResult,
} from "./client.js";

export {
  parseAiChatProxyBody,
  extractBearerToken,
  extractUpstreamErrorMessage,
  forwardAiChat,
  type ForwardAiChatOptions,
} from "./forward.js";
