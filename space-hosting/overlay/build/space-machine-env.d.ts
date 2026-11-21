declare namespace Cloudflare {
 interface Env {
  /** Only configured in the selected private Site, never in browser assets. */
  NPCGEN_SPACE_MACHINE_TOKEN?: string;
  /** Explicit read-projection cutover; machine tools alone do not enable it. */
  NPCGEN_SPACE_REPLICA_READ_ENABLED?: string;
  NPCGEN_SPACE_MAINTENANCE?: string;
 }
}
