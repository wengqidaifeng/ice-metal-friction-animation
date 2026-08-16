const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopSerial", {
  list: () => ipcRenderer.invoke("serial:list"),
  open: (options) => ipcRenderer.invoke("serial:open", options),
  write: (text) => ipcRenderer.invoke("serial:write", text),
  close: () => ipcRenderer.invoke("serial:close"),
  onData: (listener) => ipcRenderer.on("serial:data", (_event, text) => listener(text)),
  onError: (listener) => ipcRenderer.on("serial:error", (_event, message) => listener(message))
});
