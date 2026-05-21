// URL safety for agent tools that fetch caller-supplied URLs.
//
// The engineering agent has multiple tools that take a URL and fetch it
// server-side (http_fetch_full, check_url_health, verify_user_journey,
// design_critique). Without guards, a hostile or buggy prompt path could
// probe cloud metadata services (169.254.169.254 / 100.100.100.200),
// loopback (127.0.0.1), or RFC1918 private ranges (10/8, 172.16/12,
// 192.168/16) — server-side request forgery (SSRF).
//
// Strategy: parse the URL, normalize the host, reject:
//   - Non-http(s) schemes (file://, ftp://, gopher://, etc.)
//   - IP literals in private / loopback / link-local / metadata ranges
//   - Hostnames that resolve to those ranges (one DNS lookup)
//   - Bare "localhost" / "*.local" / "*.internal"
//
// What's still allowed:
//   - Public hostnames (founder app URLs like *.baljia.app, *.onrender.com)
//   - Public DNS that resolves to public IPv4 / IPv6 addresses
//
// The agent gets a clear error message naming what's blocked so it doesn't
// loop retrying. Callers handle errors via try/catch on assertUrlSafe.

import { promises as dns } from 'node:dns';
import net from 'node:net';

const BLOCKED_HOSTS = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata',
  '169.254.169.254',
  '100.100.100.200',
  'fd00:ec2::254',
]);

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

function isPrivateOrReservedIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return true;
  const [a, b] = parts;
  // 10.0.0.0/8
  if (a === 10) return true;
  // 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16
  if (a === 192 && b === 168) return true;
  // 127.0.0.0/8 — loopback
  if (a === 127) return true;
  // 169.254.0.0/16 — link-local + cloud metadata
  if (a === 169 && b === 254) return true;
  // 100.64.0.0/10 — carrier-grade NAT (Alibaba metadata uses 100.100.100.200)
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 0.0.0.0/8
  if (a === 0) return true;
  // 224.0.0.0/4 — multicast
  if (a >= 224 && a <= 239) return true;
  // 240.0.0.0/4 — reserved
  if (a >= 240) return true;
  return false;
}

function isPrivateOrReservedIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  // fc00::/7 — unique local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  // fe80::/10 — link-local
  if (lower.startsWith('fe80')) return true;
  // ff00::/8 — multicast
  if (lower.startsWith('ff')) return true;
  return false;
}

function classifyIp(ip: string): 'private' | 'public' | 'invalid' {
  const family = net.isIP(ip);
  if (family === 4) return isPrivateOrReservedIPv4(ip) ? 'private' : 'public';
  if (family === 6) return isPrivateOrReservedIPv6(ip) ? 'private' : 'public';
  return 'invalid';
}

export interface UrlSafetyResult {
  ok: boolean;
  reason?: string;
  resolved?: string;
}

export async function assertUrlSafe(rawUrl: string): Promise<UrlSafetyResult> {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0) {
    return { ok: false, reason: 'url is empty or not a string' };
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, reason: `url is not a valid URL: ${rawUrl.slice(0, 100)}` };
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return { ok: false, reason: `protocol "${parsed.protocol}" is blocked. Only http and https are allowed.` };
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host.length === 0) {
    return { ok: false, reason: 'url has no host' };
  }
  if (BLOCKED_HOSTS.has(host)) {
    return { ok: false, reason: `host "${host}" is blocked (metadata/loopback).` };
  }
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan')) {
    return { ok: false, reason: `host suffix ".${host.split('.').slice(-1)[0]}" is blocked (internal-only TLD).` };
  }
  // IP literal check
  const family = net.isIP(host);
  if (family !== 0) {
    const cls = classifyIp(host);
    if (cls !== 'public') {
      return { ok: false, reason: `IP literal "${host}" is in a private/reserved range and is blocked.` };
    }
    return { ok: true, resolved: host };
  }
  // DNS lookup — fail-OPEN on resolution failure. We only BLOCK when DNS
  // successfully resolves the host to a private/reserved IP. If DNS lookup
  // throws (host doesn't exist, network unreachable, test environment with
  // no DNS), pass through — the downstream `fetch` will fail naturally if
  // the host is unreachable. The IP-literal and BLOCKED_HOSTS checks above
  // already cover the obvious SSRF vectors; DNS resolution is only there to
  // catch the rarer "public hostname → private IP" trick.
  try {
    const addrs = await dns.lookup(host, { all: true });
    if (addrs.length === 0) {
      // Treat empty resolution as unresolved — let fetch handle it.
      return { ok: true };
    }
    for (const a of addrs) {
      const cls = classifyIp(a.address);
      if (cls !== 'public') {
        return {
          ok: false,
          reason: `host "${host}" resolves to ${a.address} which is in a private/reserved range and is blocked.`,
        };
      }
    }
    return { ok: true, resolved: addrs[0].address };
  } catch {
    // DNS unreachable (likely test env, offline, or NXDOMAIN). The fetch
    // will fail naturally; we don't want url-safety to break legit calls
    // just because DNS is slow or unavailable.
    return { ok: true };
  }
}

// Convenience: throw if unsafe. Most callers prefer the typed object so they
// can format the error message themselves; throwing version is for tool
// handlers that already wrap errors in try/catch.
export async function requireUrlSafe(rawUrl: string): Promise<void> {
  const r = await assertUrlSafe(rawUrl);
  if (!r.ok) {
    throw new Error(`URL blocked: ${r.reason}. Fetch tools only allow public http(s) hosts.`);
  }
}
