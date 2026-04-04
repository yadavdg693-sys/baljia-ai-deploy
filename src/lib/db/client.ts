// Neon + Drizzle database client
// Single connection pool for the platform database

import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

// Create the Neon SQL function (HTTP-based, edge-compatible)
const sql = neon(process.env.DATABASE_URL!);

// Export the Drizzle instance with full schema for relational queries
export const db = drizzle(sql, { schema });
