-- Enable RLS on core tables
ALTER TABLE "browser_credentials" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "magic_link_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;

-- browser_credentials: only the system backend should access this, no public/client access
CREATE POLICY "System Only - Browser Credentials"
ON "browser_credentials"
AS PERMISSIVE
FOR ALL
TO authenticated, anon
USING (false)
WITH CHECK (false);

-- magic_link_tokens: system only
CREATE POLICY "System Only - Magic Links"
ON "magic_link_tokens"
AS PERMISSIVE
FOR ALL
TO authenticated, anon
USING (false)
WITH CHECK (false);

-- subscriptions: system only, read-only via API using secure keys
CREATE POLICY "System Only - Subscriptions"
ON "subscriptions"
AS PERMISSIVE
FOR ALL
TO authenticated, anon
USING (false)
WITH CHECK (false);
