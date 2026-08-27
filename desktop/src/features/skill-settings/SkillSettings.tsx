import { Download, FolderX, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFeedback } from "../feedback";
import { ConfirmDialog } from "../../shared/ui/confirm-dialog";
import { SettingsSectionHeader } from "../../shared/ui/settings-section-header";
import { Tooltip } from "../../shared/ui/tooltip";
import styles from "./SkillSettings.module.css";

type Removal = { skill: SkillRecord; scope: "local" | "everywhere" };
const initials = (name: string) => name.trim().slice(0, 2).toUpperCase() || "SK";

export function SkillSettings() {
  const { t } = useTranslation();
  const { toast } = useFeedback();
  const [skills, setSkills] = useState<SkillRecord[]>([]);
  const [installing, setInstalling] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Removal | null>(null);
  useEffect(() => {
    const reload = () => { void window.ohmycode.capabilities.listSkills().then(setSkills); };
    reload();
    return window.ohmycode.capabilities.onChanged(reload);
  }, []);

  async function install() {
    setInstalling(true);
    try {
      const skill = await window.ohmycode.capabilities.installSkill();
      if (skill) {
        setSkills((items) => [...items.filter((item) => item.id !== skill.id), skill]);
        toast({ type: "success", message: t("settings.skillInstalled") });
      }
    } catch { toast({ type: "error", message: t("settings.skillInstallFailed") }); }
    finally { setInstalling(false); }
  }

  async function download(skill: SkillRecord) {
    setBusyId(skill.id);
    try {
      const installed = await window.ohmycode.capabilities.downloadSkill(skill.id);
      setSkills((items) => items.map((item) => item.id === skill.id ? installed : item));
      toast({ type: "success", message: t("settings.skillDownloaded") });
    } catch { toast({ type: "error", message: t("settings.skillDownloadFailed") }); }
    finally { setBusyId(null); }
  }

  async function confirmRemoval() {
    const target = removing;
    setRemoving(null);
    if (!target) return;
    try {
      if (target.scope === "local") {
        await window.ohmycode.capabilities.removeLocalSkill(target.skill.name);
        setSkills((items) => items.map((item) => item.id === target.skill.id ? { ...item, installed: false } : item));
      } else {
        await window.ohmycode.capabilities.deleteSkill(target.skill.id, target.skill.name);
        setSkills((items) => items.filter((item) => item.id !== target.skill.id));
      }
      toast({ type: "success", message: t(target.scope === "local" ? "settings.skillRemovedLocally" : "settings.skillDeleted") });
    } catch { toast({ type: "error", message: t("settings.skillDeleteFailed") }); }
  }

  return <section className={styles.section}>
    <SettingsSectionHeader title={t("settings.skillsTitle")} description={t("settings.skillsDescription")} actions={<button disabled={installing} onClick={() => void install()}><Plus />{t("settings.uploadSkill")}</button>} />
    <div className={styles.list}>{skills.map((skill) => <article key={skill.id}>
      <div className={styles.avatar}>{initials(skill.name)}</div>
      <div className={styles.info}>
        <div className={styles.title}><strong>{skill.name}</strong><span>{skill.version.startsWith("v") ? skill.version : `v${skill.version}`}</span></div>
        <p>{skill.description || t("settings.noSkillDescription")}</p>
      </div>
      {!skill.installed && <Tooltip content={t("settings.downloadSkill")}><button className={styles.iconButton} disabled={busyId === skill.id} aria-label={t("settings.downloadSkill")} onClick={() => void download(skill)}><Download /></button></Tooltip>}
      {skill.installed && <Tooltip content={t("settings.removeLocalSkill")}><button className={styles.iconButton} aria-label={t("settings.removeLocalSkill")} onClick={() => setRemoving({ skill, scope: "local" })}><FolderX /></button></Tooltip>}
      <Tooltip content={t("settings.deleteSkillEverywhere")}><button className={`${styles.iconButton} ${styles.danger}`} aria-label={t("settings.deleteSkillEverywhere")} onClick={() => setRemoving({ skill, scope: "everywhere" })}><Trash2 /></button></Tooltip>
    </article>)}</div>
    {!skills.length && <div className={styles.empty}><strong>{t("settings.noSkills")}</strong><p>{t("settings.noSkillsDescription")}</p></div>}
    <ConfirmDialog open={Boolean(removing)} title={t(removing?.scope === "local" ? "settings.confirmRemoveLocalSkill" : "settings.confirmDeleteSkill")} description={t(removing?.scope === "local" ? "settings.removeLocalSkillWarning" : "settings.deleteSkillWarning")} onCancel={() => setRemoving(null)} onConfirm={() => void confirmRemoval()} />
  </section>;
}
