import { config } from "dotenv";

config({path: `.env.${process.env.NODE_ENV || 'development'}.local`});

export const {PORT, NODE_ENV, DATABASE_URL, JWT_SECRET, JWT_EXPIRY, JWT_REFRESH_SECRET, JWT_REFRESH_EXPIRY, LOG_LEVEL} = process.env;