import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, CircleAlert, FolderCog, Plus, RefreshCw, Smartphone } from "lucide-react";
import type { AndroidState, AndroidTarget } from "@ohmycode/android-use/types";
import { Tooltip } from "../../shared/ui/tooltip";
import { AndroidConnectionDialog } from "./AndroidConnectionDialog";
import styles from "./AndroidDevices.module.css";
import { AndroidInstallCard } from "./AndroidInstallCard";
import type { useAndroidInstallation } from "./useAndroidInstallation";
import { IconButton } from "../../shared/ui/icon-button";
import { ConfirmDialog } from "../../shared/ui/confirm-dialog";

export function AndroidDevices({ state, locked, select, installation, configureAdb, refresh, remove }: { state: AndroidState; locked: boolean; select(target: AndroidTarget): void; installation: ReturnType<typeof useAndroidInstallation>; configureAdb(): void; refresh(): void; remove(serial: string): Promise<boolean> }) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string>();
  return <section className={styles.section} aria-label={t("android.devices.title")}>
    <header><h4>{t("android.devices.title")}</h4><div className={styles.actions}>
      <Tooltip content={t("android.devices.refresh")}><IconButton disabled={locked} aria-label={t("android.devices.refresh")} onClick={refresh}><RefreshCw /></IconButton></Tooltip>
      <Tooltip content={t("android.devices.configureAdb")}><IconButton disabled={locked} aria-label={t("android.devices.configureAdb")} onClick={configureAdb}><FolderCog /></IconButton></Tooltip>
      <Tooltip content={t("android.devices.add")}><IconButton disabled={locked || !state.adbReady} aria-label={t("android.devices.add")} onClick={() => setAdding(true)}><Plus /></IconButton></Tooltip>
    </div></header>
    <div className={styles.row}>
      <Smartphone /><div className={styles.identity}><span className={styles.builtInName}>{t("android.devices.builtIn")}<Tooltip content={t("android.devices.compatibility")}><span className={styles.warning} tabIndex={0} aria-label={t("android.devices.compatibility")}><CircleAlert /></span></Tooltip></span>{state.imageName && <small>{state.imageName}</small>}</div>
      {state.managedInstalled ? <button disabled={locked || state.target.kind === "managed"} onClick={() => select({ kind: "managed" })}>{state.target.kind === "managed" && <Check />}{t(state.target.kind === "managed" ? "android.devices.selected" : "android.devices.select")}</button> : <AndroidInstallCard installation={installation} compact disabled={locked} />}
    </div>
    {state.devices.map((device) => {
      const selected = state.target.kind === "external" && state.target.serial === device.serial;
      return <div className={styles.row} key={device.serial}>
        <Smartphone /><div className={styles.identity}><Tooltip content={device.serial}><span>{device.name}</span></Tooltip><small>{t(`android.devices.transports.${device.transport}`)} · {t(`android.devices.states.${device.status}`)}</small></div>
        <button disabled={locked || selected || device.status !== "device"} onClick={() => select({ kind: "external", serial: device.serial, name: device.name })}>{selected && <Check />}{t(selected ? "android.devices.selected" : "android.devices.select")}</button>
        <button disabled={locked} onClick={() => setRemoving(device.serial)}>{t("android.devices.remove")}</button>
      </div>;
    })}
    {adding && <AndroidConnectionDialog onClose={() => setAdding(false)} />}
    <ConfirmDialog open={removing !== undefined} title={t("android.devices.remove")} description={t("android.devices.removeDescription")} confirmLabel={t("android.devices.remove")} busy={locked} onCancel={() => setRemoving(undefined)} onConfirm={() => { if (removing) void remove(removing).then((ok) => { if (ok) setRemoving(undefined); }); }} />
  </section>;
}
