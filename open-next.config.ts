// Minimal OpenNext config for Cloudflare bundle size measurement.
// This is the SPIKE — not production config.
// Goal: find out whether Baljia's Next.js 15 build fits CF Workers 10 MiB gzipped cap.

import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig({});
