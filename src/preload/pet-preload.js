const { contextBridge, ipcRenderer } = require('electron')

// Minimal bridge for the pet window: no Node access, only IPC
contextBridge.exposeInMainWorld('petAPI', {
  on: (channel, callback) => {
    const listener = (event, ...args) => callback(event, ...args)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
  send: (channel, ...args) => ipcRenderer.send(channel, ...args),
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  getBehaviors: () => ipcRenderer.invoke('pet:getBehaviors')
})
