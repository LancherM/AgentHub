import { contextBridge, ipcRenderer } from "electron";
import type {
  AgentHubApi,
  CreateThreadInput,
  CreateRunInput,
  RunEvent,
  SendThreadMessageInput,
  VerificationSettings,
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
  threads: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.threadsList),
    create: (input?: CreateThreadInput) =>
      ipcRenderer.invoke(IPC_CHANNELS.threadsCreate, input),
    get: (threadId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.threadsGet, threadId),
    sendMessage: (input: SendThreadMessageInput) =>
      ipcRenderer.invoke(IPC_CHANNELS.threadsSendMessage, input)
  },
  review: {
    getSummary: (runId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.reviewSummary, runId),
    getDiff: (runId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.reviewDiff, runId),
    getRisk: (runId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.reviewRisk, runId),
    getVerification: (runId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.reviewVerification, runId),
    getLogs: (runId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.reviewLogs, runId),
    accept: (runId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.reviewAccept, runId),
    reject: (runId: string, reason?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.reviewReject, { runId, reason }),
    refresh: (runId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.reviewRefresh, runId)
  },
  memory: {
    listProposals: (runId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.memoryListProposals, runId),
    generateProposalsForRun: (runId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.memoryGenerateProposals, runId),
    approve: (ids: string[]) =>
      ipcRenderer.invoke(IPC_CHANNELS.memoryApprove, ids),
    ignore: (ids: string[]) =>
      ipcRenderer.invoke(IPC_CHANNELS.memoryIgnore, ids)
  },
  settings: {
    getVerification: (projectId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.settingsGetVerification, projectId),
    saveVerification: (input: VerificationSettings) =>
      ipcRenderer.invoke(IPC_CHANNELS.settingsSaveVerification, input)
  }
};

contextBridge.exposeInMainWorld("agentHub", api);
