import { DATABASE_URL } from '../config/env.js';
import { drizzle } from 'drizzle-orm/neon-http';

const db = drizzle(DATABASE_URL!);
