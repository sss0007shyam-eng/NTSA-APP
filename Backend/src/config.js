import 'dotenv/config';
import { z } from 'zod';
export const config = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000), DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32), CORS_ORIGIN: z.string().default('http://localhost:5173'),
  DEMO_MODE: z.enum(['true', 'false']).default('false').transform(v => v === 'true'),
  // Shared secret the courier (or aggregator) sends with every tracking webhook.
  // Unset = the webhook is switched off.
  COURIER_WEBHOOK_SECRET: z.string().min(16).optional(),
  // Key for the GST-lookup provider (a reseller fronting a licensed GSP --
  // there is no free GSTN endpoint). Unset = the "Verify from portal"
  // button says so plainly and the manual tick is all there is.
  GST_VERIFY_API_KEY: z.string().min(8).optional(),
}).parse(process.env);
if (config.NODE_ENV === 'production' && (config.DEMO_MODE || config.JWT_SECRET.includes('replace-this'))) {
  throw new Error('Production requires a private JWT secret and DEMO_MODE=false');
}
