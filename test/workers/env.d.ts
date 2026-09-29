// Declaration-merged onto @cloudflare/workers-types' extensible Cloudflare.Env interface, as packages/db does, mirroring wrangler.jsonc's test-only D1 binding.
declare global {
  namespace Cloudflare {
    interface Env {
      DATABASE: D1Database;
    }
  }
}

export {};
