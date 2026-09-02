import { contextBridge, ipcRenderer } from "electron";

const desktop = {
  platform: process.platform,
  version: process.versions.electron,
  window: {
    minimize: (): Promise<void> => ipcRenderer.invoke("relay:window:minimize"),
    toggleMaximize: (): Promise<void> => ipcRenderer.invoke("relay:window:toggle-maximize"),
    close: (): Promise<void> => ipcRenderer.invoke("relay:window:close"),
  },
  docker: {
    start: (): Promise<import("../main/docker").DockerStartResult> => ipcRenderer.invoke("relay:docker:start"),
  },
};

contextBridge.exposeInMainWorld("relayDesktop", desktop);

export type RelayDesktopBridge = typeof desktop;
