import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

// Load environment variables from the root .env file
config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });
