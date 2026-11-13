import handler from 'vinext/server/fetch-handler';
import { createSpaceCandidateHandler } from './space-candidate-boundary.mjs';

// No local process, DB, bucket, connector, credentials, or transport is provisioned here.
export default createSpaceCandidateHandler(handler);
