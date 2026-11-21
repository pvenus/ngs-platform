/** Space-specific bindings for the shared object replica. */
import {createObjectReplica} from '../ngs-local/sites/npcgen/build/object-replica.mjs';
export {objectReplicaSyncTools as spaceFileSyncTools,
 objectReplicaChunkSize as spaceFileChunkSize} from '../ngs-local/sites/npcgen/build/object-replica.mjs';

export function createSpaceFileReplica(options={}){
 return createObjectReplica({...options,fixedLengthStream:options.fixedLengthStream??(n=>new FixedLengthStream(n))});
}
