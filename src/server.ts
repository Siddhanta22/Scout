import "dotenv/config";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDb } from "./db.js";
import { createPropublicaClient } from "./propublica.js";

const config = loadConfig();
const db = createDb();
const client = createPropublicaClient({ baseUrl: config.propublicaBaseUrl });
const port = Number(process.env.PORT ?? 3000);

createApp({ config, db, client }).listen(port, () => {
  console.log(`Scout listening on http://localhost:${port}`);
});
