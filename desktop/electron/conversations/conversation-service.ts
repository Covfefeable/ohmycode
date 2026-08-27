import { loadAgentInstructions, renderAgentInstructions } from "../files/agents-instructions.js";
import { runToolLoop, type AgentStreamEvent, type AgentTask } from "@ohmycode/agent-runtime";
import { listProjects } from "../projects/projects-service.js";
import type { LocalConversation, MessageAttachment } from "../projects/types.js";
import { RuntimeToolRegistry } from "../runtime/tool-registry.js";
import type { DesktopTurnExecution } from "../runtime/desktop-execution-adapter.js";
import { ConversationTransport } from "./conversation-transport.js";

export type ConversationStreamEvent = AgentStreamEvent;
export type { AgentTask };
export type AgentExecutionContext = { ownerId: string; workspacePath: string };

async function conversationWorkspace(
  conversationId: string,
  executionContext?: AgentExecutionContext,
): Promise<string | undefined> {
  if (executionContext) return executionContext.workspacePath;
  const project = (await listProjects()).find((item) =>
    item.conversations.some((conversation) => conversation.id === conversationId),
  );
  return project?.path;
}

export async function streamMessage(
  conversationId: string,
  content: string,
  modelId: string | undefined,
  editMessageId: string | undefined,
  attachments: MessageAttachment[] | undefined,
  onEvent: (event: ConversationStreamEvent) => void,
  execution: DesktopTurnExecution,
  executionContext?: AgentExecutionContext,
  turnId?: string,
): Promise<LocalConversation> {
  if (!turnId) throw new Error("turn_id_required");
  const workspaceRoot = await conversationWorkspace(conversationId, executionContext);
  const workspaceInstructions = workspaceRoot
    ? renderAgentInstructions(await loadAgentInstructions(workspaceRoot))
    : "";
  const transport = new ConversationTransport(execution.signal);
  const registry = new RuntimeToolRegistry({
    execution,
    executionContext,
    workspaceRoot,
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
    });
    execution.setRemoteRunId(turnId);
    await runToolLoop({
      response,
      runId: turnId,
      workspaceInstructions,
      transport,
      tools: registry,
      execution,
      onEvent: (event) => {
        if (event.type === "run.started") execution.setRemoteRunId(event.runId);
        onEvent(event);
      },
    });
  } catch (error) {
    if (!execution.signal.aborted) throw error;
  } finally {
    registry.close();
  }
  return transport.conversation(conversationId);
}
