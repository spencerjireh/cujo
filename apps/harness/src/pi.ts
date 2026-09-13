/**
 * How a pi session is built here: every collaborator supplied, so pi reads
 * nothing from the home directory, loads no extension, skill, prompt template
 * or context file, and starts with no built-in tool. What the model can do is
 * exactly the `customTools` list.
 */

import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import {
  type AgentSession,
  type LoadExtensionsResult,
  type ModelRuntime,
  type ResourceLoader,
  type SessionManager,
  SettingsManager,
  type ToolDefinition,
  createAgentSession,
  createExtensionRuntime,
} from "@earendil-works/pi-coding-agent";

export interface PiSessionOptions {
  cwd: string;
  agentDir: string;
  modelRuntime: ModelRuntime;
  model: Model<Api>;
  thinkingLevel: ThinkingLevel;
  systemPrompt: string;
  tools: ToolDefinition[];
  sessionManager: SessionManager;
  compaction: boolean;
}

/** A loader that loads nothing and answers every question with "none". */
function emptyResourceLoader(systemPrompt: string): ResourceLoader {
  // Memoized: createAgentSession asks twice, and the runner it builds must
  // see the same runtime object both times.
  const extensions: LoadExtensionsResult = {
    extensions: [],
    errors: [],
    runtime: createExtensionRuntime(),
  };
  return {
    getExtensions: () => extensions,
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => systemPrompt,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => undefined,
    reload: async () => undefined,
  };
}

export async function openPiSession(options: PiSessionOptions): Promise<AgentSession> {
  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: options.compaction },
    retry: { enabled: true, maxRetries: 3 },
  });
  const { session, modelFallbackMessage } = await createAgentSession({
    cwd: options.cwd,
    agentDir: options.agentDir,
    modelRuntime: options.modelRuntime,
    model: options.model,
    thinkingLevel: options.thinkingLevel,
    noTools: "builtin",
    customTools: options.tools,
    resourceLoader: emptyResourceLoader(options.systemPrompt),
    sessionManager: options.sessionManager,
    settingsManager,
  });
  if (modelFallbackMessage) {
    session.dispose();
    throw new Error(modelFallbackMessage);
  }
  return session;
}
