import { CheckCircle2, Eye, Pencil, Plus, RefreshCw, Trash2, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFeedback } from "../feedback";
import { ConfirmDialog } from "../../shared/ui/confirm-dialog";
import { SettingsSectionHeader } from "../../shared/ui/settings-section-header";
import { Select } from "../../shared/ui/select";
import { Tooltip } from "../../shared/ui/tooltip";
import styles from "./McpSettings.module.css";

const emptyServer = (): McpServerInput => ({ name: "", identifier: "", transport: "http", configuration: { url: "", headers: {} }, enabled: true });
const initials = (name: string) => name.trim().slice(0, 2).toUpperCase() || "MC";

export function McpSettings() {
  const { t } = useTranslation();
  const { toast } = useFeedback();
  const [servers, setServers] = useState<McpServerRecord[]>([]);
  const [editing, setEditing] = useState<McpServerInput | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<McpServerRecord | null>(null);
  useEffect(() => { void window.ohmycode.capabilities.listMcp().then(setServers); }, []);
  async function save() {
    if (!editing) return;
    try {
      const saved = await window.ohmycode.capabilities.saveMcp(editing);
      setServers((items) => [...items.filter((item) => item.id !== saved.id), saved]);
      setEditing(null);
      toast({ type: "success", message: t("settings.mcpSaved") });
    } catch { toast({ type: "error", message: t("settings.mcpSaveFailed") }); }
  }
  async function test(id: string) {
    setBusyId(id);
    try {
      const updated = await window.ohmycode.capabilities.testMcp(id);
      setServers((items) => items.map((item) => item.id === id ? updated : item));
      toast({ type: "success", message: t("settings.mcpConnected", { count: updated.tools.length }) });
    } catch { toast({ type: "error", message: t("settings.mcpConnectionFailed") }); }
    finally { setBusyId(null); }
  }
  return <section className={styles.section}>
    <SettingsSectionHeader title={t("settings.mcpTitle")} description={t("settings.mcpDescription")} actions={<button onClick={() => setEditing(emptyServer())}><Plus />{t("settings.addMcp")}</button>} />
    <div className={styles.list}>{servers.map((server) => <article key={server.id}>
      <div className={styles.serverIcon}>{initials(server.name)}</div>
      <div className={styles.serverInfo}><strong>{server.name}</strong><span>{server.transport.toUpperCase()} · {server.tools.length} {t("settings.tools")}</span></div>
      <div className={`${styles.status} ${styles[server.status]}`}>{server.status === "connected" ? <CheckCircle2 /> : server.status === "failed" ? <XCircle /> : <span />}</div>
      <Tooltip content={t("settings.viewMcpTools")}><button className={styles.iconButton} aria-label={t("settings.viewMcpTools")} onClick={() => setViewing(server)}><Eye /></button></Tooltip>
      <Tooltip content={t("common.edit")}><button className={styles.iconButton} aria-label={t("common.edit")} onClick={() => setEditing(server)}><Pencil /></button></Tooltip>
      <Tooltip content={t("settings.reconnectMcp")}><button className={styles.iconButton} aria-label={t("settings.reconnectMcp")} disabled={busyId === server.id} onClick={() => void test(server.id)}><RefreshCw className={busyId === server.id ? styles.spin : ""} /></button></Tooltip>
      <Tooltip content={t("common.delete")}><button className={`${styles.iconButton} ${styles.danger}`} aria-label={t("common.delete")} onClick={() => setDeleteId(server.id)}><Trash2 /></button></Tooltip>
    </article>)}</div>
    {!servers.length && <div className={styles.empty}><strong>{t("settings.noMcp")}</strong><p>{t("settings.noMcpDescription")}</p></div>}
    {editing && <div className={styles.overlay} onMouseDown={(event) => { if (event.target === event.currentTarget) setEditing(null); }}><div className={styles.dialog}>
      <header><h2>{editing.id ? t("settings.editMcp") : t("settings.addMcp")}</h2></header>
      <label><span>{t("settings.mcpName")}</span><input value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value, identifier: editing.id ? editing.identifier : event.target.value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "") })} /></label>
      <label><span>{t("settings.mcpIdentifier")}</span><input value={editing.identifier} onChange={(event) => setEditing({ ...editing, identifier: event.target.value })} /></label>
      <label><span>{t("settings.mcpTransport")}</span><Select ariaLabel={t("settings.mcpTransport")} value={editing.transport} options={[{ value: "http", label: "HTTP / SSE" }, { value: "stdio", label: "stdio" }]} onChange={(value) => setEditing({ ...editing, transport: value as "http" | "stdio", configuration: value === "http" ? { url: "", headers: {} } : { command: "", args: [], env: {} } })} /></label>
      {editing.transport === "http" ? <>
        <label><span>URL</span><input value={editing.configuration.url ?? ""} onChange={(event) => setEditing({ ...editing, configuration: { ...editing.configuration, url: event.target.value } })} /></label>
        <label><span>Headers (JSON)</span><textarea value={JSON.stringify(editing.configuration.headers ?? {}, null, 2)} onChange={(event) => { try { setEditing({ ...editing, configuration: { ...editing.configuration, headers: JSON.parse(event.target.value) } }); } catch { /* keep last valid value */ } }} /></label>
      </> : <>
        <label><span>{t("settings.command")}</span><input value={editing.configuration.command ?? ""} onChange={(event) => setEditing({ ...editing, configuration: { ...editing.configuration, command: event.target.value } })} /></label>
        <label><span>{t("settings.arguments")}</span><input value={(editing.configuration.args ?? []).join(" ")} onChange={(event) => setEditing({ ...editing, configuration: { ...editing.configuration, args: event.target.value.split(/\s+/).filter(Boolean) } })} /></label>
        <label><span>{t("settings.workingDirectory")}</span><input value={editing.configuration.cwd ?? ""} onChange={(event) => setEditing({ ...editing, configuration: { ...editing.configuration, cwd: event.target.value } })} /></label>
      </>}
      <footer><button onClick={() => setEditing(null)}>{t("common.cancel")}</button><button className={styles.primary} onClick={() => void save()}>{t("common.save")}</button></footer>
    </div></div>}
    {viewing && <div className={styles.overlay} onMouseDown={(event) => { if (event.target === event.currentTarget) setViewing(null); }}><div className={`${styles.dialog} ${styles.toolsDialog}`}>
      <header><h2>{t("settings.mcpToolsTitle", { name: viewing.name })}</h2><p>{t("settings.mcpToolsCount", { count: viewing.tools.length })}</p></header>
      <div className={styles.toolList}>{viewing.tools.map((tool) => <details key={tool.name}><summary><strong>{tool.name}</strong><span>{tool.description || t("settings.noToolDescription")}</span></summary><pre>{JSON.stringify(tool.inputSchema ?? {}, null, 2)}</pre></details>)}</div>
      {!viewing.tools.length && <div className={styles.toolsEmpty}>{t("settings.noMcpTools")}</div>}
      <footer><button onClick={() => setViewing(null)}>{t("common.close")}</button></footer>
    </div></div>}
    <ConfirmDialog open={Boolean(deleteId)} title={t("common.confirmDelete")} description={t("common.deleteWarning")} onCancel={() => setDeleteId(null)} onConfirm={() => { const id = deleteId; setDeleteId(null); if (id) void window.ohmycode.capabilities.deleteMcp(id).then(() => setServers((items) => items.filter((item) => item.id !== id))); }} />
  </section>;
}
