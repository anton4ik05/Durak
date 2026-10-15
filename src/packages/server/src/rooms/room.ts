import type { DeckSize, GameMode, RoomPlayerSnapshot, RoomSnapshot, TableListing } from "@durka/shared";
import type { DurakGame } from "../game/engine";

function pairKey(players: readonly Seat[]): string {
  if (players.length !== 4) return players.map((player) => player.id).join("|");
  const first = [players[0]?.id, players[2]?.id].sort().join("+");
  const second = [players[1]?.id, players[3]?.id].sort().join("+");
  return [first, second].sort().join("|");
}

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

  /** Меняет, кто напротив кого. Вчетвером повторяет, пока пары действительно другие. Готовность сбрасывается. */
  shuffleSeats(): void {
    if (this.players.length < 2) return;
    const pairsBefore = pairKey(this.players);
    const orderBefore = this.players.map((player) => player.id).join("|");
    for (let attempt = 0; attempt < 8; attempt += 1) {
      for (let index = this.players.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(Math.random() * (index + 1));
        const current = this.players[index];
        const other = this.players[swap];
        if (!current || !other) continue;
        this.players[index] = other;
        this.players[swap] = current;
      }
      const samePairs = this.players.length === 4 && pairKey(this.players) === pairsBefore;
      const sameOrder = this.players.map((player) => player.id).join("|") === orderBefore;
      if (!samePairs && !sameOrder) break;
    }
    for (const player of this.players) player.ready = false;
  }

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
