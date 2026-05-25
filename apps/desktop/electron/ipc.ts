import { clipboard, dialog, ipcMain, shell } from "electron";
import {
  createDesktopServices,
  createIpcHandlers,
  IPC_CHANNELS,
  runEventChannel,
  type DesktopServices,
  type IpcHandler
} from "./ipc-handlers";

export {
  createDesktopServices,
  createIpcHandlers,
  IPC_CHANNELS,
  runEventChannel,
  type DesktopServices,
  type IpcHandler
} from "./ipc-handlers";

export function registerAgentHubIpc(
  services: DesktopServices = createDesktopServices(undefined, {
    handoffPlatform: {
      openPath: (worktreePath) => shell.openPath(worktreePath),
      writeText: (text) => clipboard.writeText(text)
    }
  })
): void {
  const handlers = createIpcHandlers(services);
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, handler);
  }
  ipcMain.handle(IPC_CHANNELS.projectsSelectDirectory, async () => {
    const result = await dialog.showOpenDialog({
      title: "Select local project folder",
      properties: ["openDirectory"]
    });
    return result.canceled ? undefined : result.filePaths[0];
  });
}
