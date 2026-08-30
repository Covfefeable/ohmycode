import { useTranslation } from "react-i18next";
import { MultiAgentSidebar } from "../../features/multi-agent-sidebar";
import { ConfirmDialog } from "../../shared/ui/confirm-dialog";
import { AppShell } from "../../shared/layout/app-shell";
import { NavigationRail } from "../../widgets/navigation-rail";
import { ActivityDrawer } from "./ActivityDrawer";
import { CreateCollaborationDialog, RunTaskDialog } from "./CollaborationDialogs";
import { GroupChatPanel } from "./GroupChatPanel";
import { TaskRoster } from "./TaskRoster";
import { TeamEditor } from "./TeamEditor";
import { useCollaborationWorkspace } from "./useCollaborationWorkspace";
import { useMultiAgentExecution } from "./useMultiAgentExecution";
import styles from "./MultiAgentPage.module.css";

export function MultiAgentPage() {
  const { t } = useTranslation();
  const workspace = useCollaborationWorkspace();
  const execution = useMultiAgentExecution({
    models: workspace.models,
    selectedAgentId: workspace.selectedAgentId,
    task: workspace.task,
    setTask: workspace.setTask,
    setSelectedTaskId: workspace.setSelectedTaskId,
    reloadAgents: workspace.reloadAgents,
    reloadModels: workspace.reloadModels,
  });

  const task = workspace.task;
  const isTemplate = task?.status === "template";
  return <AppShell navigation={<NavigationRail />} sidebar={<MultiAgentSidebar
    agents={workspace.agents}
    selectedAgentId={workspace.selectedAgentId}
    selectedTaskId={workspace.selectedTaskId}
    busy={workspace.creating}
    onCreateAgent={() => workspace.setCreateDialogOpen(true)}
    onSelectAgent={workspace.selectAgent}
    onRunAgent={(agentId) => { workspace.setSelectedAgentId(agentId); execution.setRunDialogOpen(true); }}
    onSelectTask={workspace.selectTask}
    onDeleteAgent={(id) => workspace.setDeleteTarget({ type: "agent", id })}
    onDeleteTask={(id) => workspace.setDeleteTarget({ type: "task", id })}
  />}>
    <main className={styles.page}>
      {task ? <>
        <header className={styles.header}><div><h1>{task.title}</h1><p>{task.request}</p></div></header>
        {isTemplate ? <TeamEditor
          task={task}
          models={workspace.models}
          selectedMember={workspace.selectedMember}
          selectedMemberId={workspace.selectedMemberId}
          onSelectMember={workspace.setSelectedMemberId}
          onAddMember={workspace.addMember}
          onRemoveMember={workspace.removeMember}
          onUpdateMember={workspace.updateMember}
          onSave={() => void workspace.saveTeam()}
          onRun={() => execution.setRunDialogOpen(true)}
        /> : <div className={styles.chatLayout}>
          <GroupChatPanel
            task={task}
            message={execution.message}
            sending={execution.sending}
            onMessageChange={execution.changeGroupMessage}
            onSend={() => void execution.sendGroupMessage()}
          />
          <TaskRoster
            task={task}
            selectedMemberId={workspace.selectedMemberId}
            running={task.status === "running"}
            onSelectMember={workspace.setSelectedMemberId}
            onStop={() => void execution.stopTask()}
            onRerun={() => void execution.executeTask(task)}
          />
          {workspace.selectedMember && <ActivityDrawer
            member={workspace.selectedMember}
            models={workspace.models}
            onClose={() => workspace.setSelectedMemberId(null)}
          />}
        </div>}
      </> : <div className={styles.welcome}>
        <div className={styles.promptMark}>›_</div>
        <p>{t("multiAgent.collaboration")}</p>
        <h1>{t("multiAgent.welcomeTitle")}</h1>
        <span>{t("multiAgent.welcomeDescriptionChat")}</span>
      </div>}

      <CreateCollaborationDialog
        open={workspace.createDialogOpen}
        creating={workspace.creating}
        draft={workspace.draft}
        onDraftChange={workspace.setDraft}
        onClose={() => workspace.setCreateDialogOpen(false)}
        onCreate={() => void workspace.createCollaboration()}
      />
      <RunTaskDialog
        open={execution.runDialogOpen && Boolean(workspace.selectedAgentId)}
        description={execution.runDescription}
        workspacePath={execution.runWorkspacePath}
        executionLimit={execution.runExecutionLimit}
        onDescriptionChange={execution.setRunDescription}
        onWorkspaceChange={execution.setRunWorkspacePath}
        onExecutionLimitChange={execution.setRunExecutionLimit}
        onClose={() => execution.setRunDialogOpen(false)}
        onRun={() => void execution.runCollaboration()}
      />
      <ConfirmDialog
        open={Boolean(workspace.deleteTarget)}
        title={t("common.confirmDelete")}
        description={t("common.deleteWarning")}
        onCancel={() => workspace.setDeleteTarget(null)}
        onConfirm={() => void workspace.confirmDelete()}
      />
    </main>
  </AppShell>;
}
