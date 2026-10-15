import { createApp } from "./app";
import { config } from "./config";
import { DurakServer } from "./durak-server";

const game = new DurakServer();
const app = await createApp(game);

await app.listen({ port: config.port, host: config.host });
