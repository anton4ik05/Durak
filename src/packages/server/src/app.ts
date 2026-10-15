import websocket from "@fastify/websocket";
import Fastify from "fastify";
import type { DurakServer } from "./durak-server";

export async function createApp(game: DurakServer) {
  const app = Fastify({ logger: true });
  await app.register(websocket);

  app.get("/health", async () => ({ ok: true, service: "durka" }));

  app.get("/ws", { websocket: true }, (socket) => {
    game.handleConnection(socket);
  });

  return app;
}
