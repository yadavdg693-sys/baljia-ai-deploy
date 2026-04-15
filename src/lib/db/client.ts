// Neon + Drizzle database client
// Single connection pool for the platform database

import { neon, Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { drizzle as drizzleWs } from 'drizzle-orm/neon-serverless';
import * as schema from './schema';

// Create the Neon SQL function (HTTP-based, edge-compatible)
const sql = neon(process.env.DATABASE_URL!);

// Export the Drizzle instance with full schema for relational queries
export const db = drizzle(sql, { schema });

// WebSocket-based pool for operations requiring real transactions
// (advisory locks, multi-statement atomicity). Use sparingly —
// HTTP driver is preferred for most queries.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const txDb = drizzleWs(pool, { schema });
