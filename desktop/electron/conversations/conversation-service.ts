import { loadAgentInstructions, renderAgentInstructions } from "../files/agents-instructions.js";
import { listProjects } from "../projects/projects-service.js";
import type { LocalConversation, MessageAttachment } from "../projects/types.js";
import { runToolLoop } from "../runtime/tool-loop.js";
import { RuntimeToolRegistry } from "../runtime/tool-registry.js";
import type { TurnExecution } from "../runtime/turn-execution.js";
import { ConversationTransport } from "./conversation-transport.js";
import type { ConversationStreamEvent } from "./server-stream.js";

export type { AgentTask, ConversationStreamEvent } from "./server-stream.js";
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
  execution: TurnExecution,
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
      registry,
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
