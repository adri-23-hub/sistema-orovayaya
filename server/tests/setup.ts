import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env.test if it exists, otherwise fall back to .env
const envTestPath = path.resolve(__dirname, ".env.test");
const envPath = path.resolve(__dirname, "../.env");

dotenv.config({ path: envTestPath });
dotenv.config({ path: envPath }); // fallback: won't override already-set vars
