import { IconButton } from "../../shared/ui/icon-button";
import { FormField, TextInput, Textarea } from "../../shared/ui/form-control";
import { CheckCircle2, Eye, Pencil, Plus, RefreshCw, Trash2, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFeedback } from "../feedback";
import { ConfirmDialog } from "../../shared/ui/confirm-dialog";
import { SettingsSectionHeader } from "../../shared/ui/settings-section-header";
import { Select } from "../../shared/ui/select";
import { Tooltip } from "../../shared/ui/tooltip";
import { Button } from "../../shared/ui/button";
import styles from "./McpSettings.module.css";

const emptyServer = (): McpServerInput => ({ name: "", identifier: "", transport: "http", configuration: { url: "", headers: {} }, enabled: true });
const initials = (name: string) => name.trim().slice(0, 2).toUpperCase() || "MC";

function parseHeaders(value: string): Record<string, string> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") return null;
    return Object.values(parsed).every((item) => typeof item === "string")
      ? parsed as Record<string, string>
      : null;
  } catch {
    return null;
  }
}

export function McpSettings() {
  const { t } = useTranslation();
  const { toast } = useFeedback();
  const [servers, setServers] = useState<McpServerRecord[]>([]);
  const [editing, setEditing] = useState<McpServerInput | null>(null);
  const [headersDraft, setHeadersDraft] = useState("{}");
  const [headersInvalid, setHeadersInvalid] = useState(false);
  const [headersChanged, setHeadersChanged] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<McpServerRecord | null>(null);
  useEffect(() => {
    const reload = () => { void window.ohmycode.capabilities.listMcp().then(setServers); };
    reload();
    return window.ohmycode.capabilities.onChanged(reload);
  }, []);
  function openEditor(server: McpServerInput) {
    setEditing(server);
    setHeadersDraft(JSON.stringify(Array.isArray(server.configuration.headers) ? {} : server.configuration.headers ?? {}, null, 2));
    setHeadersInvalid(false);
    setHeadersChanged(false);
  }
  function closeEditor() {
    setEditing(null);
    setHeadersInvalid(false);
  }
  async function save() {
    if (!editing) return;
    const headers = editing.transport === "http" ? parseHeaders(headersDraft) : {};
    if (editing.transport === "http" && !headers) {
      setHeadersInvalid(true);
      toast({ type: "error", message: t("settings.invalidMcpHeaders") });
      return;
    }
    try {
      const configuration = { ...editing.configuration };
      if (editing.transport === "http") {
        if (editing.id && !headersChanged) delete configuration.headers;
        else configuration.headers = headers ?? {};
      }
      const input = { ...editing, configuration };
      const saved = await window.ohmycode.capabilities.saveMcp(input);
      setServers((items) => [...items.filter((item) => item.id !== saved.id), saved]);
      closeEditor();
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
    <SettingsSectionHeader title={t("settings.mcpTitle")} description={t("settings.mcpDescription")} actions={<Button onClick={() => openEditor(emptyServer())}><Plus />{t("settings.addMcp")}</Button>} />
    <div className={styles.list}>{servers.map((server) => <article key={server.id}>
      <div className={styles.serverIcon}>{initials(server.name)}</div>
      <div className={styles.serverInfo}><strong>{server.name}</strong><span>{server.transport.toUpperCase()} · {server.tools.length} {t("settings.tools")}</span></div>
      {!server.enabled && <span className={styles.disabledTag}>{t("settings.mcpDisabled")}</span>}
      <div className={`${styles.status} ${server.enabled ? styles[server.status] : ""}`}>{!server.enabled ? <span /> : server.status === "connected" ? <CheckCircle2 /> : server.status === "failed" ? <XCircle /> : <span />}</div>
      <Tooltip content={t("settings.viewMcpTools")}><IconButton aria-label={t("settings.viewMcpTools")} onClick={() => setViewing(server)}><Eye /></IconButton></Tooltip>
      <Tooltip content={t("common.edit")}><IconButton aria-label={t("common.edit")} onClick={() => openEditor(server)}><Pencil /></IconButton></Tooltip>
      <Tooltip content={t("settings.reconnectMcp")}><IconButton aria-label={t("settings.reconnectMcp")} disabled={!server.enabled || busyId === server.id} onClick={() => void test(server.id)}><RefreshCw className={busyId === server.id ? styles.spin : ""} /></IconButton></Tooltip>
      <Tooltip content={t("common.delete")}><IconButton tone="danger"  aria-label={t("common.delete")} onClick={() => setDeleteId(server.id)}><Trash2 /></IconButton></Tooltip>
    </article>)}</div>
    {!servers.length && <div className={styles.empty}><strong>{t("settings.noMcp")}</strong><p>{t("settings.noMcpDescription")}</p></div>}
    {editing && <div className={styles.overlay} onMouseDown={(event) => { if (event.target === event.currentTarget) closeEditor(); }}><div className={styles.dialog}>
      <header><h2>{editing.id ? t("settings.editMcp") : t("settings.addMcp")}</h2></header>
      <FormField><span>{t("settings.mcpName")}</span><TextInput value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value, identifier: editing.id ? editing.identifier : event.target.value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "") })} /></FormField>
      <FormField><span>{t("settings.mcpIdentifier")}</span><TextInput value={editing.identifier} onChange={(event) => setEditing({ ...editing, identifier: event.target.value })} /></FormField>
      <FormField><span>{t("settings.mcpAvailability")}</span><Select ariaLabel={t("settings.mcpAvailability")} value={editing.enabled ? "enabled" : "disabled"} options={[{ value: "enabled", label: t("settings.mcpEnabled") }, { value: "disabled", label: t("settings.mcpDisabled") }]} onChange={(value) => setEditing({ ...editing, enabled: value === "enabled" })} /></FormField>
      <FormField><span>{t("settings.mcpTransport")}</span><Select ariaLabel={t("settings.mcpTransport")} value={editing.transport} options={[{ value: "http", label: "HTTP / SSE" }, { value: "stdio", label: "stdio" }]} onChange={(value) => setEditing({ ...editing, transport: value as "http" | "stdio", configuration: value === "http" ? { url: "", headers: {} } : { command: "", args: [], env: {} } })} /></FormField>
      {editing.transport === "http" ? <>
        <FormField><span>URL</span><TextInput value={editing.configuration.url ?? ""} onChange={(event) => setEditing({ ...editing, configuration: { ...editing.configuration, url: event.target.value } })} /></FormField>
        <FormField><span>{t("settings.mcpHeaders")}</span><Textarea aria-invalid={headersInvalid} value={headersDraft} onChange={(event) => { setHeadersDraft(event.target.value); setHeadersInvalid(false); setHeadersChanged(true); }} />{headersInvalid && <small className={styles.fieldError} role="alert">{t("settings.invalidMcpHeaders")}</small>}</FormField>
      </> : <>
        <FormField><span>{t("settings.command")}</span><TextInput value={editing.configuration.command ?? ""} onChange={(event) => setEditing({ ...editing, configuration: { ...editing.configuration, command: event.target.value } })} /></FormField>
        <FormField><span>{t("settings.arguments")}</span><TextInput value={(editing.configuration.args ?? []).join(" ")} onChange={(event) => setEditing({ ...editing, configuration: { ...editing.configuration, args: event.target.value.split(/\s+/).filter(Boolean) } })} /></FormField>
        <FormField><span>{t("settings.workingDirectory")}</span><TextInput value={editing.configuration.cwd ?? ""} onChange={(event) => setEditing({ ...editing, configuration: { ...editing.configuration, cwd: event.target.value } })} /></FormField>
      </>}
      <footer><Button onClick={closeEditor}>{t("common.cancel")}</Button><Button variant="primary" onClick={() => void save()}>{t("common.save")}</Button></footer>
    </div></div>}
    {viewing && <div className={styles.overlay} onMouseDown={(event) => { if (event.target === event.currentTarget) setViewing(null); }}><div className={`${styles.dialog} ${styles.toolsDialog}`}>
      <header><h2>{t("settings.mcpToolsTitle", { name: viewing.name })}</h2><p>{t("settings.mcpToolsCount", { count: viewing.tools.length })}</p></header>
      <div className={styles.toolList}>{viewing.tools.map((tool) => <details key={tool.name}><summary><strong>{tool.name}</strong><span>{tool.description || t("settings.noToolDescription")}</span></summary><pre>{JSON.stringify(tool.inputSchema ?? {}, null, 2)}</pre></details>)}</div>
      {!viewing.tools.length && <div className={styles.toolsEmpty}>{t("settings.noMcpTools")}</div>}
      <footer><Button onClick={() => setViewing(null)}>{t("common.close")}</Button></footer>
    </div></div>}
    <ConfirmDialog open={Boolean(deleteId)} title={t("common.confirmDelete")} description={t("common.deleteWarning")} onCancel={() => setDeleteId(null)} onConfirm={() => { const id = deleteId; setDeleteId(null); if (id) void window.ohmycode.capabilities.deleteMcp(id).then(() => setServers((items) => items.filter((item) => item.id !== id))); }} />
  </section>;
}
