import { handleInvoke } from "./handle-invoke.js";
import { BrowserWindow } from "electron";
import {
  getPublicSettings,
  getModels,
  saveAvatar,
  saveBackgroundTasks,
  saveModels,
  saveProfile,
  testModel,
} from "../settings/settings-service.js";
import type { BackgroundTaskSettings, ModelInput } from "../../contracts/domain.js";

export function registerSettingsIpc(): void {
  handleInvoke("settings:get", getPublicSettings);
  handleInvoke("settings:list-models", getModels);
  const publishProfile = async () => {
    const profile = (await getPublicSettings()).profile;
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send("settings:profile-changed", profile);
    }
    return profile;
  };
  handleInvoke("settings:save-profile", async (_event, displayName: string) => {
    await saveProfile(displayName);
    return publishProfile();
  });
  handleInvoke("settings:save-avatar", async (_event, data: string, contentType: string) => {
    await saveAvatar(data, contentType);
    return publishProfile();
  });
  handleInvoke("settings:save-models", async (_event, models: ModelInput[]) => {
    await saveModels(models);
    const freshModels = await getModels();
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send("settings:models-changed", freshModels);
    }
    return freshModels;
  });
  handleInvoke("settings:save-background-tasks", (_event, settings: BackgroundTaskSettings) => saveBackgroundTasks(settings));
  handleInvoke("settings:test-model", (_event, model: ModelInput) => testModel(model));
}
