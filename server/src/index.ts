import { loadEnv } from "./config/env.js";
import { createApp } from "./app.js";

const env = loadEnv();
const app = createApp();

app.listen(env.PORT, () => {
  console.info(`API listening on http://localhost:${env.PORT}`);
});
