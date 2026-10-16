export type Sort = 'relevance'|'newest'|'oldest';
export interface ImageResult { id:number; path:string; filename:string; thumbPath:string; text:string; createdAt:string; modifiedAt:string; width:number; height:number; score:number }
export interface SearchOptions { query:string; sort:Sort; from?:string; to?:string }
export interface Status { phase:'idle'|'indexing'|'paused'|'complete'|'cancelled'|'error'; total:number; done:number; failed:number; current?:string }
export interface Stats { images:number; folders:string[]; status:Status }
export interface MemoryBoxApi { chooseFolder():Promise<string|undefined>; addFolder(path:string):Promise<void>; startIndexing():Promise<void>; control(action:'pause'|'resume'|'cancel'):Promise<void>; stats():Promise<Stats>; search(options:SearchOptions):Promise<ImageResult[]>; openImage(id:number):Promise<void>; revealImage(id:number):Promise<void>; onProgress(callback:(status:Status)=>void):()=>void }
declare global { interface Window { memorybox: MemoryBoxApi } }
