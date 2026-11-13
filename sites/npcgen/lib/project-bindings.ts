import registry from './project-bindings.json';
/** Identity metadata only; never rewrite source documents or merge mirror histories. */
export const projectBindings=registry.bindings;
export function projectBinding(mirrorProjectId:string){return projectBindings.find(b=>b.mirrorProjectId===mirrorProjectId);}
/** Keep the published compatibility namespace until canonical publication is verified. */
export const defaultMirrorProjectId='masterconcept';

export const preferredMirrorProjectId='binari';

/** Compatibility mirrors remain readable, but are not selectable projects. */
export function selectableProject(mirrorProjectId:string,bindings:readonly (typeof projectBindings[number])[]=projectBindings){const binding=bindings.find(b=>b.mirrorProjectId===mirrorProjectId);return !!binding&&binding.enabled&&!binding.compatibilityAlias&&binding.canonicalProjectId===binding.mirrorProjectId;}
