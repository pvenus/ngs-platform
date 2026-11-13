import {storyCatalogRequest,type CatalogReadOperation}from '../../lib/shared-runtime/story-catalog-contract.mjs';
import {contentOperationsRpc}from './content-operations-api';
export function catalogRead(operation:CatalogReadOperation,payload:Record<string,unknown>={}){return contentOperationsRpc(storyCatalogRequest(operation,payload));}
