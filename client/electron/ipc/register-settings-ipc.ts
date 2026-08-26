import { ipcMain } from "electron";
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
  ipcMain.handle("settings:save-profile", (_event, displayName: string) => saveProfile(displayName));
  ipcMain.handle("settings:save-avatar", (_event, data: string, contentType: string) => saveAvatar(data, contentType));
  ipcMain.handle("settings:save-models", (_event, models: ModelInput[]) => saveModels(models));
  ipcMain.handle("settings:test-model", (_event, model: ModelInput) => testModel(model));
}
