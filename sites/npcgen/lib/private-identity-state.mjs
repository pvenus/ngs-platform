// Browser-safe default-deny state. Only the server bootstrap loads private bindings.
// No filesystem, environment lookup, private values, or policy-derived defaults here.
let configured = null;
export function installPrivateIdentityConfig(value) {
 if (typeof window !== 'undefined') throw Error('PRIVATE_IDENTITY_SERVER_ONLY');
 configured = value;
}
export function requirePrivateIdentitySection(section) {
 const value = configured?.[section];
 if (value === undefined || value === null) throw Error('PRIVATE_IDENTITY_CONFIG_REQUIRED');
 return value;
}
