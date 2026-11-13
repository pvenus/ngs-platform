import {npcCatalogHref} from './npc-catalog-contract.mjs';

// Current authoring URLs follow the activation pointer. Historical URLs remain exact.
export function npcCatalogView(href, index) {
  const u = new URL(href), q = u.searchParams, a = index.activation || {};
  const requestedId = q.get('npcCatalogId') || '';
  const explicitHistory = q.get('npcCatalogMode') === 'history';
  const working = !explicitHistory && (q.get('npcCatalogMode') === 'current' ||
    requestedId === a.activeCatalogId || (!requestedId && !q.has('npcRevision')));
  const id = working ? a.activeCatalogId : requestedId;
  const version = working ? Number(a.activeCatalogVersion || 1) : Number(q.get('npcCatalogVersion') || 1);
  const previous = working && requestedId && (requestedId !== id || Number(q.get('npcCatalogVersion') || 1) !== version)
    ? new URL(href) : null;
  if (previous) previous.searchParams.set('npcCatalogMode', 'history');
  return {working, id, version, previousHref: previous?.href || ''};
}

export function npcCatalogViewHref(href, catalog, npcId, mode, options = {}) {
  const u = npcCatalogHref(href, catalog, npcId, options);
  u.searchParams.set('npcCatalogMode', mode);
  return u;
}
