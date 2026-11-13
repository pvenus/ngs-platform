declare namespace Cloudflare {
  interface Env {
    NGS_PROCESSOR?: Fetcher;
    NPCGEN_OWNER_TEST_SETUP_EMAIL?: string;
    DB?: D1Database;
    BUCKET?: R2Bucket;
  }
}
