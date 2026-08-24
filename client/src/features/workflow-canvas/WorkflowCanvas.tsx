import { useCallback, useMemo, useState } from "react";
import { Background, Controls, MarkerType, ReactFlow, applyNodeChanges, type NodeChange } from "@xyflow/react";
import { useTranslation } from "react-i18next";
import { AgentFlowNode, type AgentFlowNodeType } from "./AgentFlowNode";
import styles from "./WorkflowCanvas.module.css";

type Props = {
  task: MultiAgentTask;
  selectedNodeId: string | null;
  onNodeSelect(nodeId: string): void;
  onPositionsChange(positions: Record<string, { x: number; y: number }>): void;
};

export function WorkflowCanvas({ task, selectedNodeId, onNodeSelect, onPositionsChange }: Props) {
  const { t } = useTranslation();
  const sourceNodes = useMemo<AgentFlowNodeType[]>(() => task.nodes.map((node) => ({
    id: node.id,
    type: "agent",
    position: node.position,
    data: { node },
    selected: node.id === selectedNodeId,
  })), [task.nodes, selectedNodeId]);
  const [nodes, setNodes] = useState(sourceNodes);
  const edges = useMemo(() => task.edges.map((edge) => ({
    ...edge,
    type: "smoothstep",
    markerEnd: { type: MarkerType.ArrowClosed },
  })), [task.edges]);
  const onNodesChange = useCallback((changes: NodeChange<AgentFlowNodeType>[]) => {
    setNodes((current) => {
      const next = applyNodeChanges(changes, current);
      if (changes.some((change) => change.type === "position" && !change.dragging)) {
        onPositionsChange(Object.fromEntries(next.map((node) => [node.id, node.position])));
      }
      return next;
    });
  }, [onPositionsChange]);
  return <div className={styles.canvas}>
    <ReactFlow<AgentFlowNodeType>
      nodes={nodes}
      edges={edges}
      nodeTypes={{ agent: AgentFlowNode }}
      onNodesChange={onNodesChange}
      onNodeClick={(_event, node) => onNodeSelect(node.id)}
      nodesConnectable={false}
      deleteKeyCode={null}
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
