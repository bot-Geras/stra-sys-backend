// @ts-ignore
import { DATABASE_URL } from '../config/env.js';
import { drizzle } from 'drizzle-orm/neon-http';
import { sql, gte } from 'drizzle-orm';
export const db = drizzle(DATABASE_URL!);
export {sql, gte}
