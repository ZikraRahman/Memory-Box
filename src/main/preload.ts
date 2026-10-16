import { contextBridge, ipcRenderer } from 'electron';
import type { MemoryBoxApi } from '../shared/types';
const api:MemoryBoxApi = { chooseFolder:()=>ipcRenderer.invoke('folder:choose'), addFolder:(p)=>ipcRenderer.invoke('folder:add',p), startIndexing:()=>ipcRenderer.invoke('index:start'), control:(a)=>ipcRenderer.invoke('index:control',a), stats:()=>ipcRenderer.invoke('stats'), search:(o)=>ipcRenderer.invoke('search',o), openImage:(id)=>ipcRenderer.invoke('image:open',id), revealImage:(id)=>ipcRenderer.invoke('image:reveal',id), onProgress:(cb)=>{ const listener=(_:unknown,s:unknown)=>cb(s as never); ipcRenderer.on('progress',listener); return ()=>ipcRenderer.removeListener('progress',listener); } };
contextBridge.exposeInMainWorld('memorybox', api);
