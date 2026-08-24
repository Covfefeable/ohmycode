import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Background, ConnectionLineType, Controls, MarkerType, ReactFlow, type Connection, type EdgeChange, type NodeChange, type ReactFlowInstance } from "@xyflow/react";
import { useTranslation } from "react-i18next";
import { AgentFlowNode, type AgentFlowNodeType } from "./AgentFlowNode";
import styles from "./WorkflowCanvas.module.css";

const nodeTypes = { agent: AgentFlowNode };

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
  const canvasRef = useRef<HTMLDivElement>(null);
  const flowRef = useRef<ReactFlowInstance<AgentFlowNodeType> | null>(null);
  const [canvasReady, setCanvasReady] = useState(false);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
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
    type: "default",
    markerEnd: { type: MarkerType.ArrowClosed },
    selected: edge.id === selectedEdgeId,
    style: { strokeWidth: edge.id === selectedEdgeId ? 2 : 1.5 },
  })), [task.edges, selectedEdgeId]);
  const onNodesChange = useCallback((changes: NodeChange<AgentFlowNodeType>[]) => {
    const positionChanges = changes.filter(
      (change): change is Extract<NodeChange<AgentFlowNodeType>, { type: "position" }> => change.type === "position" && Boolean(change.position),
    );
    if (positionChanges.length === 0) return;
    setNodePositions((current) => {
      const next = { ...current };
      for (const change of positionChanges) next[change.id] = change.position!;
      if (positionChanges.some((change) => !change.dragging)) onPositionsChange(next);
      return next;
    });
  }, [onPositionsChange]);
  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    for (const change of changes) {
      if (change.type === "select") setSelectedEdgeId(change.selected ? change.id : null);
      if (change.type === "remove") onDeleteEdges?.([change.id]);
    }
  }, [onDeleteEdges]);
  const fitCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!flowRef.current || !canvas || canvas.clientWidth === 0 || canvas.clientHeight === 0 || nodes.length === 0) return;
    void flowRef.current.fitView({ padding: 0.2, duration: 180 });
  }, [nodes.length]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const syncCanvas = () => {
      if (canvas.clientWidth > 0 && canvas.clientHeight > 0) setCanvasReady(true);
      fitCanvas();
    };
    const frame = requestAnimationFrame(syncCanvas);
    const observer = new ResizeObserver(syncCanvas);
    observer.observe(canvas);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [fitCanvas]);
  return <div ref={canvasRef} className={styles.canvas}>
    {canvasReady && <ReactFlow<AgentFlowNodeType>
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={(_event, node) => onNodeSelect(node.id)}
      onEdgeClick={(_event, edge) => setSelectedEdgeId(edge.id)}
      onPaneClick={() => setSelectedEdgeId(null)}
      nodesConnectable={editable}
      nodesFocusable={editable}
      edgesFocusable={editable}
      onConnect={(connection) => onConnect?.(connection)}
      onNodesDelete={(deleted) => onDeleteNodes?.(deleted.map((node) => node.id))}
      onEdgesDelete={(deleted) => onDeleteEdges?.(deleted.map((edge) => edge.id))}
      deleteKeyCode={editable ? ["Backspace", "Delete"] : null}
      onInit={(instance) => {
        flowRef.current = instance;
        requestAnimationFrame(fitCanvas);
      }}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      connectionLineType={ConnectionLineType.Bezier}
      colorMode="dark"
      aria-label={t("multiAgent.title")}
    >
      <Background gap={24} size={1} />
      <Controls showInteractive={false} />
    </ReactFlow>}
  </div>;
}
