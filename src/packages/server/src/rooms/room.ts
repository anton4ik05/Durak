import type { DeckSize, GameMode, RoomPlayerSnapshot, RoomSnapshot, TableListing } from "@durka/shared";
import type { DurakGame } from "../game/engine";

export interface Seat {
  id: string;
  name: string;
  ready: boolean;
  connected: boolean;
}

export class Room {
  players: Seat[] = [];
  game: DurakGame | null = null;

  constructor(
    readonly code: string,
    public hostId: string,
    readonly maxPlayers: number,
    readonly deckSize: DeckSize,
    readonly jokers: boolean,
    readonly mode: GameMode,
    readonly pairs: boolean,
  ) {}

  toSnapshot(): RoomSnapshot {
    const players: RoomPlayerSnapshot[] = this.players.map((player, seat) => ({
      id: player.id,
      name: player.name,
      seat,
      ready: player.ready,
      connected: player.connected,
    }));

    return {
      code: this.code,
      hostId: this.hostId,
      maxPlayers: this.maxPlayers,
      deckSize: this.deckSize,
      jokers: this.jokers,
      mode: this.mode,
      pairs: this.pairs,
      status: this.game ? "playing" : "lobby",
      players,
    };
  }

  toListing(): TableListing {
    const host = this.players.find((player) => player.id === this.hostId);
    return {
      code: this.code,
      hostName: host?.name ?? "—",
      playerNames: this.players.map((player) => player.name),
      playerCount: this.players.length,
      maxPlayers: this.maxPlayers,
      deckSize: this.deckSize,
      jokers: this.jokers,
      mode: this.mode,
      pairs: this.pairs,
      status: this.game ? "playing" : "lobby",
    };
  }
}
