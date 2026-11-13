/** Memory-only verified-source cache. Context belongs to one authorized gallery. */
export function mediaReadIdentity(media,snapshot){return JSON.stringify([snapshot.authorizationScope,snapshot.projectId,snapshot.snapshotId,media.id,media.reader,media.requestId,media.mime,media.sha256,media.size]);}
export class MediaBlobCache{
 constructor(maxBytes=64*1024*1024,maxItems=32){this.maxBytes=maxBytes;this.maxItems=maxItems;this.entries=new Map();this.stats={loads:0,hits:0};}
 get(key,load){let entry=this.entries.get(key);if(entry){this.stats.hits++;this.entries.delete(key);this.entries.set(key,entry);return entry.promise;}entry={size:0,ready:false,promise:null};entry.promise=Promise.resolve().then(()=>{this.stats.loads++;return load()}).then(blob=>{if(!blob||typeof blob.size!=='number')throw Error('MEDIA_BLOB_REQUIRED');entry.size=blob.size;entry.ready=true;if(blob.size>this.maxBytes)this.entries.delete(key);this.prune();return blob;}).catch(error=>{if(this.entries.get(key)===entry)this.entries.delete(key);throw error;});this.entries.set(key,entry);return entry.promise;}
 prune(){let total=[...this.entries.values()].reduce((n,e)=>n+e.size,0);for(const[key,e]of this.entries){if(total<=this.maxBytes&&this.entries.size<=this.maxItems)break;if(e.ready){this.entries.delete(key);total-=e.size;}}}
 clear(){this.entries.clear();}
}
