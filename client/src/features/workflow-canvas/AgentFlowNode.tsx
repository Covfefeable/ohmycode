import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Bot, Check, Circle, LoaderCircle, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Tooltip } from "../../shared/ui/tooltip";
import styles from "./WorkflowCanvas.module.css";

export type AgentFlowNodeData = { node: MultiAgentNodeData };
export type AgentFlowNodeType = Node<AgentFlowNodeData, "agent">;

const statusIcon = (status: string) => {
  if (status === "running") return <LoaderCircle className={styles.spinner} />;
  if (status === "completed") return <Check />;
  if (status === "failed") return <TriangleAlert />;
  return <Circle />;
};

function AgentFlowNodeComponent({ data, selected }: NodeProps<AgentFlowNodeType>) {
  const { t } = useTranslation();
  const node = data.node;
  return <article className={`${styles.node} ${styles[node.status] ?? ""} ${selected ? styles.selected : ""}`}>
    <Handle type="target" position={Position.Left} />
    <div className={styles.nodeHead}><Tooltip content={t(`multiAgent.${node.status}`, { defaultValue: node.status })}><span>{statusIcon(node.status)}</span></Tooltip><Bot /><strong>{node.name}</strong></div>
    <p>{node.role}</p>
    {node.messages.length > 0 && <footer><span>{node.messages.length} messages</span></footer>}
    <Handle type="source" position={Position.Right} />
  </article>;
}

export const AgentFlowNode = memo(AgentFlowNodeComponent);
