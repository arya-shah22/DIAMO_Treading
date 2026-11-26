import { contextBridge, ipcRenderer } from 'electron'
import type { Api } from '../shared/contracts'

const api: Api = {
  logo: (companyId) => ipcRenderer.invoke('diamo:logo', { companyId }),
  saveRecoveryPdf: () => ipcRenderer.invoke('diamo:saveRecoveryPdf'),
  command: (name, input, companyId, operationKey) =>
    ipcRenderer.invoke('diamo:command', { name, input, companyId, operationKey }),
  state: (companyId, query) => ipcRenderer.invoke('diamo:state', { companyId, query }),
  export: (format, title, rows) => ipcRenderer.invoke('diamo:export', { format, title, rows }),
  backup: (action, options) => ipcRenderer.invoke('diamo:backup', { action, options }),
}

contextBridge.exposeInMainWorld('diamo', Object.freeze(api))
