import { contextBridge, ipcRenderer } from "electron";

const UPDATE_STATUS_CHANNEL = "desktop-update:status";
const UPDATE_GET_STATUS_CHANNEL = "desktop-update:get-status";
const UPDATE_CHECK_CHANNEL = "desktop-update:check";
const UPDATE_INSTALL_CHANNEL = "desktop-update:install";

contextBridge.exposeInMainWorld(
  "aotuDesktop",
  Object.freeze({
    updates: Object.freeze({
      getStatus: () => ipcRenderer.invoke(UPDATE_GET_STATUS_CHANNEL),
      check: () => ipcRenderer.invoke(UPDATE_CHECK_CHANNEL),
      install: () => ipcRenderer.invoke(UPDATE_INSTALL_CHANNEL),
      onStatus: (listener) => {
        if (typeof listener !== "function") return () => {};
        const handler = (_event, status) => listener(status);
        ipcRenderer.on(UPDATE_STATUS_CHANNEL, handler);
        return () => ipcRenderer.removeListener(UPDATE_STATUS_CHANNEL, handler);
      },
    }),
  }),
);
