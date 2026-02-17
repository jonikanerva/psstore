import { createApp } from './app.js';
import { env } from './config/env.js';
const app = createApp();
app.listen(env.PORT, () => {
    console.info(`server listening on http://localhost:${env.PORT}`);
});
