import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });
import { verifyMagicLink, createMagicLink } from '@/lib/services/auth.service';

async function main() {
  console.log("Creating link...");
  const result = await createMagicLink("test-verify@example.com");
  
  if (!result.magicLink) {
    console.error("No magic link returned. (Postmark error?)");
    process.exit(1);
  }
  
  console.log("Generated Link:", result.magicLink);
  
  // Extract token from URL
  const url = new URL(result.magicLink);
  const token = url.searchParams.get("token");
  
  if (!token) {
    console.error("No token found in generated link.");
    process.exit(1);
  }
  
  console.log("Token extracted:", token);
  
  console.log("Verifying token...");
  const user = await verifyMagicLink(token);
  
  console.log("Verification Result:", user);
  process.exit(0);
}
main().catch(console.error);
