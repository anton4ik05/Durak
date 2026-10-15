import { randomInt } from "node:crypto";
import { clampMaxPlayers } from "@durka/shared";
import type { DeckSize, GameMode, TableListing } from "@durka/shared";
import { Room } from "./room";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function makeCode(): string {
  let code = "";
  for (let index = 0; index < 4; index += 1) {
    code += ALPHABET[randomInt(ALPHABET.length)];
  }
  return code;
}

export class RoomManager {
  private readonly rooms = new Map<string, Room>();

  create(
    host: { id: string; name: string },
    options: { maxPlayers?: number; deckSize?: DeckSize; jokers?: boolean; mode?: GameMode; pairs?: boolean },
  ): Room {
    let code = makeCode();
    for (let attempt = 0; attempt < 20 && this.rooms.has(code); attempt += 1) {
      code = makeCode();
    }
    if (this.rooms.has(code)) {
      throw new Error("cannot allocate room code");
    }

    const pairs = options.pairs === true;
    const room = new Room(
      code,
      host.id,
      pairs ? 4 : clampMaxPlayers(options.maxPlayers),
      options.deckSize ?? 36,
      options.jokers ?? false,
      options.mode ?? "podkidnoy",
      pairs,
    );
    room.players.push({ id: host.id, name: host.name, ready: false, connected: true });
    this.rooms.set(code, room);
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  findByPlayer(playerId: string): Room | undefined {
    for (const room of this.rooms.values()) {
      if (room.players.some((player) => player.id === playerId)) return room;
    }
    return undefined;
  }

  list(): TableListing[] {
    return [...this.rooms.values()]
      .map((room) => room.toListing())
      .sort((left, right) => {
        if (left.status !== right.status) return left.status === "lobby" ? -1 : 1;
        return left.code.localeCompare(right.code);
      });
  }

  delete(code: string): void {
    this.rooms.delete(code);
  }
}
