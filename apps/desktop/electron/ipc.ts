import { ipcMain } from "electron";
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
  services: DesktopServices = createDesktopServices()
): void {
  const handlers = createIpcHandlers(services);
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, handler);
  }
}
