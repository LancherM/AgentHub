import { contextBridge, ipcRenderer } from "electron";
import type {
  AgentHubApi,
  CreateRunInput,
  RunEvent,
  Unsubscribe
} from "../src/lib/types";
import { IPC_CHANNELS, runEventChannel } from "./ipc-channels";

const api: AgentHubApi = {
  projects: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.projectsList),
    open: (projectPath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.projectsOpen, projectPath)
  },
  runs: {
    list: (projectId?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.runsList, projectId),
    get: (runId: string) => ipcRenderer.invoke(IPC_CHANNELS.runsGet, runId),
    create: (input: CreateRunInput) =>
      ipcRenderer.invoke(IPC_CHANNELS.runsCreate, input),
    cancel: (runId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.runsCancel, runId),
    onEvent: (runId: string, callback: (event: RunEvent) => void): Unsubscribe => {
      const channel = runEventChannel(runId);
      const listener = (_event: Electron.IpcRendererEvent, runEvent: RunEvent) => {
        callback(runEvent);
      };
      ipcRenderer.on(channel, listener);
      void ipcRenderer.invoke(IPC_CHANNELS.runsSubscribe, runId);
      return () => {
        ipcRenderer.off(channel, listener);
        void ipcRenderer.invoke(IPC_CHANNELS.runsUnsubscribe, runId);
      };
    }
  },
  review: {
    getDiff: (runId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.reviewDiff, runId),
    getRisk: (runId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.reviewRisk, runId),
    getVerification: (runId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.reviewVerification, runId)
  },
  memory: {
    listProposals: (runId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.memoryListProposals, runId),
    approve: (ids: string[]) =>
      ipcRenderer.invoke(IPC_CHANNELS.memoryApprove, ids),
    ignore: (ids: string[]) =>
      ipcRenderer.invoke(IPC_CHANNELS.memoryIgnore, ids)
  }
};

contextBridge.exposeInMainWorld("agentHub", api);
