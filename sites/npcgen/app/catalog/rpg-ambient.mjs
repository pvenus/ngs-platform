/** Pure presentation state for trusted, host-supplied EP1 JSON.
 * Registry membership and saved-state provenance must be verified by the host.
 * This module checks structure and bounds; it cannot authenticate JSON.
 * minElapsedMs and storyExitTo are metadata, never story transition authority.
 */
const WORLD = 'ngs.scene-ambient.v1';
const WORLD_V2 = 'ngs.scene-ambient.v2';
const SAVE = 'ngs.ambient-state.v1';
const PLACES = ['entry', 'well', 'lane'];
const KINDS = ['area', 'stone', 'flowers', 'bird', 'merchant', 'resident'];
const MOVERS = ['bird', 'merchant', 'resident'];
const STATE_KEYS = ['schemaVersion', 'worldId', 'version', 'homeId', 'elapsedMs', 'visited', 'locationId', 'inspected'];
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const record = o => o !== null && typeof o === 'object' && !Array.isArray(o);
const finite = (n, lo, hi) => typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi;
const integer = (n, lo = 0, hi = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(n) && n >= lo && n <= hi;
const id = s => typeof s === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(s);
const hash = s => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
const assetId = s => typeof s === 'string' && /^asset\.[a-f0-9]{48}$/.test(s);
const normalizationId = s => typeof s === 'string' && /^pixelnorm\.[a-f0-9]{48}$/.test(s);
const text = (s, max = 2048) => typeof s === 'string' && s.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(s);
const label = s => text(s, 160) && s.trim().length > 0;
const unique = a => new Set(a).size === a.length;
function keys(o, required, optional = []) {
  if (!record(o)) return false;
  const names = Object.keys(o);
  return required.every(k => own(o, k)) && names.every(k => required.includes(k) || optional.includes(k));
}
function list(a, max) {
  if (!Array.isArray(a) || a.length > max || Object.keys(a).length !== a.length) return false;
  for (let i = 0; i < a.length; i += 1) if (!own(a, i)) return false;
  return true;
}
const point = p => keys(p, ['x', 'y']) && finite(p.x, 0, 1) && finite(p.y, 0, 1);
function rect(r) {
  return keys(r, ['x', 'y', 'width', 'height']) && finite(r.x, 0, 1) && finite(r.y, 0, 1) && finite(r.width, Number.EPSILON, 1) && finite(r.height, Number.EPSILON, 1) && r.x + r.width <= 1 && r.y + r.height <= 1;
}
const placement = p => keys(p, ['x', 'y', 'width']) && finite(p.x, 0, 1) && finite(p.y, 0, 1) && finite(p.width, Number.EPSILON, 1);
const inside = (p, r) => p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
function propValid(p, max, v2 = false) {
  if (!keys(p, ['id', 'kind', 'label', 'text', 'alternateText', 'rect', 'placement', 'inspect', 'departAtMs', 'exitDurationMs', 'exit'])) return false;
  if (!id(p.id) || !KINDS.includes(p.kind) || !label(p.label) || !text(p.text) || !text(p.alternateText) || !rect(p.rect) || !placement(p.placement) || typeof p.inspect !== 'boolean') return false;
  if (!MOVERS.includes(p.kind)) return p.departAtMs === null && p.exitDurationMs === null && p.exit === null;
  const offscreen = p.kind === 'bird' || p.kind === 'resident' || (v2 && p.kind === 'merchant');
  return integer(p.exitDurationMs, 200, 10000) && integer(p.departAtMs, 0, max - p.exitDurationMs) && keys(p.exit, ['x', 'y']) && finite(p.exit.x, offscreen ? -0.3 : 0, offscreen ? 1.3 : 1) && finite(p.exit.y, 0, 1);
}
function imageRef(a) {
  return keys(a, ['schemaVersion', 'definitionId', 'definitionVersion', 'fileAssetId', 'version', 'sha256', 'mime']) && a.schemaVersion === 'ngs.story-resource-image.v1' && id(a.definitionId) && integer(a.definitionVersion, 1) && assetId(a.fileAssetId) && a.version === 1 && hash(a.sha256) && a.mime === 'image/png';
}
function validate(d) {
  if (!keys(d, ['schemaVersion', 'id', 'version', 'currentLocationId', 'minElapsedMs', 'storyExitTo', 'puzzleNodeId', 'protagonistSprite', 'assets', 'locations', 'clock'])) return ['definition.keys'];
  if (![WORLD, WORLD_V2].includes(d.schemaVersion) || !id(d.id) || !integer(d.version, 1) || !PLACES.includes(d.currentLocationId) || !(d.storyExitTo === null || id(d.storyExitTo)) || !id(d.puzzleNodeId)) return ['definition.identity'];
  const v2 = d.schemaVersion === WORLD_V2;
  const c = d.clock;
  if (!keys(c, ['nightAtMs', 'idlePauseMs', 'maxElapsedMs', 'maxTint']) || !integer(c.maxElapsedMs, 30000, 1800000) || !integer(c.nightAtMs, 5000, c.maxElapsedMs) || !integer(c.idlePauseMs, 5000, 60000) || !finite(c.maxTint, 0, 0.7) || !integer(d.minElapsedMs, 0, c.maxElapsedMs)) return ['definition.clock'];
  const s = d.protagonistSprite;
  if (!keys(s, ['normalizationRequestId', 'fileAssetId', 'version', 'sha256', 'mime']) || !normalizationId(s.normalizationRequestId) || !assetId(s.fileAssetId) || s.version !== 1 || !hash(s.sha256) || s.mime !== 'image/png') return ['definition.protagonistSprite'];
  const assets = v2 ? ['entry', 'well', 'lane', 'stone', 'merchant', 'resident', 'flowers', 'bird'] : ['entry', 'well', 'lane', 'stone', 'life'];
  if (!keys(d.assets, assets)) return ['definition.assets'];
  for (const name of assets) if (!imageRef(d.assets[name])) return ['definition.assets.' + name];
  if (!list(d.locations, 3) || d.locations.length !== 3) return ['definition.locations'];
  const placeIds = [];
  const propIds = [];
  for (const l of d.locations) {
    if (!keys(l, ['id', 'name', 'description', 'start', 'routes', 'props']) || !PLACES.includes(l.id) || !label(l.name) || !text(l.description) || !point(l.start) || !list(l.routes, 2) || !list(l.props, 4)) return ['definition.location'];
    placeIds.push(l.id);
    const targets = [];
    for (const r of l.routes) {
      if (!keys(r, ['to', 'label', 'rect', 'arrival']) || !PLACES.includes(r.to) || r.to === l.id || !label(r.label) || !rect(r.rect) || !point(r.arrival) || !inside(r.arrival, r.rect)) return ['definition.route'];
      targets.push(r.to);
    }
    if (!unique(targets)) return ['definition.routes.duplicate'];
    for (const p of l.props) {
      if (!propValid(p, c.maxElapsedMs, v2)) return ['definition.prop'];
      propIds.push(p.id);
    }
  }
  if (!unique(placeIds) || !unique(propIds)) return ['definition.duplicateId'];
  if (v2) {
    const routes = new Map(d.locations.map(l => [l.id, l.routes.map(r => r.to)]));
    for (const [from, targets] of routes) {
      if (targets.some(to => !routes.get(to).includes(from))) return ['definition.routes.reciprocal'];
    }
    const seen = new Set([d.currentLocationId]);
    const pending = [d.currentLocationId];
    while (pending.length) {
      for (const to of routes.get(pending.pop())) {
        if (!seen.has(to)) { seen.add(to); pending.push(to); }
      }
    }
    if (seen.size !== PLACES.length) return ['definition.routes.connected'];
  }
  return [];
}
export function ambientIssues(definition) {
  try { return validate(definition); } catch { return ['definition.unreadable']; }
}
function fail(code, detail) {
  const error = new Error(code + ': ' + detail);
  error.name = 'AmbientError';
  throw Object.assign(error, { code });
}
function requireDefinition(d) {
  const issues = ambientIssues(d);
  if (issues.length) fail('AMBIENT_DEFINITION', issues.join(', '));
}
function stateShape(s, max) {
  return keys(s, STATE_KEYS) && s.schemaVersion === SAVE && id(s.worldId) && integer(s.version, 1) && PLACES.includes(s.homeId) && PLACES.includes(s.locationId) && integer(s.elapsedMs, 0, max) && list(s.visited, 3) && unique(s.visited) && s.visited.every(v => PLACES.includes(v)) && s.visited.includes(s.homeId) && s.visited.includes(s.locationId) && list(s.inspected, 12) && unique(s.inspected) && s.inspected.every(id);
}
function stateValid(d, s) {
  if (!stateShape(s, d.clock.maxElapsedMs) || s.worldId !== d.id || s.version !== d.version) return false;
  const allowed = d.locations.filter(l => s.visited.includes(l.id)).flatMap(l => l.props.filter(p => p.inspect).map(p => p.id));
  return s.inspected.every(p => allowed.includes(p));
}
function checkedState(d, s, code, requireHome) {
  let valid = false;
  try { valid = stateValid(d, s) && (!requireHome || s.homeId === d.currentLocationId); } catch { valid = false; }
  if (!valid) fail(code, 'Invalid or incompatible presentation state');
}
const copy = s => ({ ...s, visited: [...s.visited], inspected: [...s.inspected] });
export function ambientInitial(definition, saved) {
  requireDefinition(definition);
  const home = definition.currentLocationId;
  if (saved === undefined) return { schemaVersion: SAVE, worldId: definition.id, version: definition.version, homeId: home, elapsedMs: definition.minElapsedMs, visited: [home], locationId: home, inspected: [] };
  checkedState(definition, saved, 'AMBIENT_SAVED', false);
  const s = copy(saved);
  s.elapsedMs = Math.max(saved.elapsedMs, definition.minElapsedMs);
  if (s.homeId !== home) {
    s.homeId = home;
    s.locationId = home;
    if (!s.visited.includes(home)) s.visited.push(home);
  }
  return s;
}
export function ambientTick(definition, state, deltaMs, activity) {
  requireDefinition(definition);
  checkedState(definition, state, 'AMBIENT_STATE', true);
  if (!integer(deltaMs, 0, 1000) || !keys(activity, ['visible', 'focused', 'idleMs']) || typeof activity.visible !== 'boolean' || typeof activity.focused !== 'boolean' || !integer(activity.idleMs)) fail('AMBIENT_TICK', 'Expected bounded integer delta and explicit activity');
  const s = copy(state);
  if (activity.visible && activity.focused && activity.idleMs < definition.clock.idlePauseMs) s.elapsedMs += Math.min(deltaMs, definition.clock.maxElapsedMs - s.elapsedMs);
  return s;
}
export function ambientVisit(definition, state, to) {
  requireDefinition(definition);
  checkedState(definition, state, 'AMBIENT_STATE', true);
  if (!PLACES.includes(to)) fail('AMBIENT_VISIT', 'Unknown destination');
  if (to === state.locationId) return copy(state);
  const from = definition.locations.find(l => l.id === state.locationId);
  if (!state.visited.includes(to) || !from.routes.some(r => r.to === to)) fail('AMBIENT_VISIT', 'Destination must be visited and adjacent');
  return { ...copy(state), locationId: to };
}
export function ambientNight(definition, state) {
  try {
    if (ambientIssues(definition).length || !stateValid(definition, state) || state.homeId !== definition.currentLocationId) return 0;
    return Math.min(1, state.elapsedMs / definition.clock.nightAtMs) * definition.clock.maxTint;
  } catch { return 0; }
}
export function ambientDeparture(prop, state, schemaVersion = WORLD) {
  try {
    // The optional schema selects bounds; legacy two-argument calls retain v1 behavior.
    if (![WORLD, WORLD_V2].includes(schemaVersion) || !propValid(prop, 1800000, schemaVersion === WORLD_V2) || !MOVERS.includes(prop.kind) || !stateShape(state, 1800000)) return 0;
    return Math.max(0, Math.min(1, (state.elapsedMs - prop.departAtMs) / prop.exitDurationMs));
  } catch { return 0; }
}
function resultValid(r) {
  if (!keys(r, ['nodeId', 'bindingHash', 'configurationHash', 'outcome', 'nextNodeId', 'appliedAt'], ['display'])) return false;
  return id(r.nodeId) && hash(r.bindingHash) && hash(r.configurationHash) && keys(r.outcome, ['status']) && ['cleared', 'partial', 'aborted'].includes(r.outcome.status) && (r.nextNodeId === null || id(r.nextNodeId)) && (integer(r.appliedAt) || (text(r.appliedAt, 128) && r.appliedAt.trim().length > 0));
}
export function ambientStone(definition, puzzleResults) {
  try {
    if (ambientIssues(definition).length || !record(puzzleResults)) return 0;
    const attempts = Object.keys(puzzleResults);
    if (attempts.length > 128) return 0;
    let found = false;
    let cleared = false;
    for (const attempt of attempts) {
      const result = puzzleResults[attempt];
      if (!id(attempt) || !resultValid(result)) return 0;
      if (result.nodeId === definition.puzzleNodeId) {
        found = true;
        if (result.outcome.status === 'cleared') cleared = true;
      }
    }
    return cleared ? 5 : found ? 3 : 0;
  } catch { return 0; }
}
