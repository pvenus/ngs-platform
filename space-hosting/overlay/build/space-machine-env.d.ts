declare namespace Cloudflare {
 interface Env {
  /** Only configured in the selected private Site, never in browser assets. */
  NPCGEN_SPACE_MACHINE_TOKEN?: string;
  /** Single lowercase SHA-256 of a preapproved Sites email; formal Binari queue only. */
  NPCGEN_SPACE_QUEUE_EXTRA_EMAIL_SHA256?: string;
  /** Explicit read-projection cutover; machine tools alone do not enable it. */
  NPCGEN_SPACE_REPLICA_READ_ENABLED?: string;
  NPCGEN_SPACE_MAINTENANCE?: string;
  NPCGEN_AUDIO_SEPARATION_ENABLED?: string;
 }
}
