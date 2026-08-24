import { useCallback, useMemo, useState } from "react";
import { Background, Controls, MarkerType, ReactFlow, applyNodeChanges, type Connection, type NodeChange } from "@xyflow/react";
import { useTranslation } from "react-i18next";
import { AgentFlowNode, type AgentFlowNodeType } from "./AgentFlowNode";
import styles from "./WorkflowCanvas.module.css";

type Props = {
  task: MultiAgentTask;
  selectedNodeId: string | null;
  onNodeSelect(nodeId: string): void;
  onPositionsChange(positions: Record<string, { x: number; y: number }>): void;
  editable?: boolean;
  onConnect?(connection: Connection): void;
  onDeleteNodes?(nodeIds: string[]): void;
  onDeleteEdges?(edgeIds: string[]): void;
};

export function WorkflowCanvas({ task, selectedNodeId, onNodeSelect, onPositionsChange, editable = false, onConnect, onDeleteNodes, onDeleteEdges }: Props) {
  const { t } = useTranslation();
  const [nodePositions, setNodePositions] = useState<Record<string, { x: number; y: number }>>(
    () => Object.fromEntries(task.nodes.map((node) => [node.id, node.position])),
  );
  const nodes = useMemo<AgentFlowNodeType[]>(() => task.nodes.map((node) => ({
    id: node.id,
    type: "agent",
    position: nodePositions[node.id] ?? node.position,
    data: { node },
    selected: node.id === selectedNodeId,
  })), [task.nodes, selectedNodeId, nodePositions]);
  const edges = useMemo(() => task.edges.map((edge) => ({
    ...edge,
    type: "smoothstep",
    markerEnd: { type: MarkerType.ArrowClosed },
  })), [task.edges]);
  const onNodesChange = useCallback((changes: NodeChange<AgentFlowNodeType>[]) => {
    const next = applyNodeChanges(changes, nodes);
    const nextPositions = Object.fromEntries(next.map((node) => [node.id, node.position]));
    setNodePositions(nextPositions);
    if (changes.some((change) => change.type === "position" && !change.dragging)) {
      onPositionsChange(nextPositions);
    }
  }, [nodes, onPositionsChange]);
  return <div className={styles.canvas}>
    <ReactFlow<AgentFlowNodeType>
      nodes={nodes}
      edges={edges}
      nodeTypes={{ agent: AgentFlowNode }}
      onNodesChange={onNodesChange}
      onNodeClick={(_event, node) => onNodeSelect(node.id)}
      nodesConnectable={editable}
      nodesFocusable={editable}
      edgesFocusable={editable}
      onConnect={(connection) => onConnect?.(connection)}
      onNodesDelete={(deleted) => onDeleteNodes?.(deleted.map((node) => node.id))}
      onEdgesDelete={(deleted) => onDeleteEdges?.(deleted.map((edge) => edge.id))}
      deleteKeyCode={editable ? ["Backspace", "Delete"] : null}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      colorMode="dark"
      aria-label={t("multiAgent.title")}
    >
      <Background gap={24} size={1} />
      <Controls showInteractive={false} />
    </ReactFlow>
  </div>;
}
