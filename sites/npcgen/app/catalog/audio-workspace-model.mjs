export function audioKind(asset){if(asset?.kind==='music'||asset?.kind==='sfx')return asset.kind;const profile=asset?.provenance?.profile;if(profile==='small-sfx')return 'sfx';if(profile==='acestep-v15-turbo')return 'music';return 'unclassified';}
export const audioKinds=[['music','배경음악 (BGM)','ACE-Step 1.5 Turbo'],['sfx','효과음 (SFX)','Stable Audio 3 · small-sfx']];
