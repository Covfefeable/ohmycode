import { BrowserWindow, ipcMain } from "electron";
import {
  getPublicSettings,
  saveAvatar,
  saveModels,
  saveProfile,
  testModel,
} from "../settings/settings-service.js";
import type { ModelInput } from "../settings/types.js";

export function registerSettingsIpc(): void {
  ipcMain.handle("settings:get", getPublicSettings);
  const publishProfile = async () => {
    const profile = (await getPublicSettings()).profile;
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send("settings:profile-changed", profile);
    }
    return profile;
  };
  ipcMain.handle("settings:save-profile", async (_event, displayName: string) => {
    await saveProfile(displayName);
    return publishProfile();
  });
  ipcMain.handle("settings:save-avatar", async (_event, data: string, contentType: string) => {
    await saveAvatar(data, contentType);
    return publishProfile();
  });
  ipcMain.handle("settings:save-models", async (_event, models: ModelInput[]) => {
    await saveModels(models);
    const freshModels = (await getPublicSettings()).models;
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send("settings:models-changed", freshModels);
    }
    return freshModels;
  });
  ipcMain.handle("settings:test-model", (_event, model: ModelInput) => testModel(model));
}
