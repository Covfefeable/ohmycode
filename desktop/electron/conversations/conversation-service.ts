import { loadAgentInstructions, renderAgentInstructions } from "../files/agents-instructions.js";
import { runToolLoop, type AgentStreamEvent, type AgentTask } from "@ohmycode/agent-runtime";
import { listProjects } from "../projects/projects-service.js";
import type { LocalConversation, MessageAttachment } from "../projects/types.js";
import { DesktopToolRegistry } from "../runtime/desktop-tool-registry.js";
import type { DesktopTurnExecution } from "../runtime/desktop-execution-adapter.js";
import type { DesktopExecutionContext } from "../runtime/types.js";
import { ConversationTransport } from "./conversation-transport.js";
import { getPublicSettings } from "../settings/settings-service.js";

export type ConversationStreamEvent = AgentStreamEvent;
export type { AgentTask };
const threadDynamicTools = new Map<string, import("@ohmycode/tool-contracts").ProviderToolDefinition[]>();
async function conversationWorkspace(
  conversationId: string,
  executionContext?: DesktopExecutionContext,
): Promise<{ projectId: string; workspaceRoot?: string }> {
  if (executionContext) {
    return { projectId: conversationId, workspaceRoot: executionContext.workspacePath };
  }
  const project = (await listProjects()).find((item) =>
    item.conversations.some((conversation) => conversation.id === conversationId),
  );
  return { projectId: project?.id ?? conversationId, workspaceRoot: project?.path };
}

export async function streamMessage(
  conversationId: string,
  content: string,
  modelId: string | undefined,
  editMessageId: string | undefined,
  attachments: MessageAttachment[] | undefined,
  onEvent: (event: ConversationStreamEvent) => void,
  execution: DesktopTurnExecution,
  executionContext?: DesktopExecutionContext,
  turnId?: string,
): Promise<LocalConversation> {
  if (!turnId) throw new Error("turn_id_required");
  const { projectId, workspaceRoot } = await conversationWorkspace(
    conversationId,
    executionContext,
  );
  const workspaceInstructions = workspaceRoot
    ? renderAgentInstructions(await loadAgentInstructions(workspaceRoot))
    : "";
  const transport = new ConversationTransport(execution.signal);
  const settings = await getPublicSettings();
  const model = modelId
    ? settings.models.find((item) => item.id === modelId)
    : settings.models[0];
  const registry = new DesktopToolRegistry({
    execution,
    executionContext,
    workspaceRoot,
    projectId,
    supportsVision: Boolean(model?.supportsVision),
    initialDynamicDefinitions: threadDynamicTools.get(conversationId),
    onDynamicDefinitionsChanged: (definitions) => threadDynamicTools.set(conversationId, definitions),
    attachmentPaths: new Set((attachments ?? []).map((item) => item.path)),
    onEvent,
  });
  try {
    const response = await transport.start({
      conversationId,
      content,
      modelId,
      editMessageId,
      attachments,
      workspaceInstructions,
      turnId,
      tools: registry.definitions(),
    });
    execution.setRemoteRunId(turnId);
    await runToolLoop({
      response,
      runId: turnId,
      workspaceInstructions,
      transport,
      tools: registry,
      toolSnapshot: () => registry.definitions(),
      execution,
      onEvent: (event) => {
        if (event.type === "run.started") execution.setRemoteRunId(event.runId);
        onEvent(event);
      },
    });
  } catch (error) {
    if (!execution.signal.aborted) throw error;
  } finally {
    await registry.close();
  }
  return transport.conversation(conversationId);
}
