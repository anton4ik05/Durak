import type { DeckSize, GameMode } from "./constants";
import type { Card, Rank, RegularCard, Suit } from "./cards";

export const GAME_LOG_KINDS = ["deal", "attack", "defend", "transfer", "flash", "throw", "take", "done", "next", "end"] as const;
export type GameLogKind = (typeof GAME_LOG_KINDS)[number];

export interface GameLogEntry {
  id: number;
  kind: GameLogKind;
  text: string;
}

export const GAME_PHASES = ["attack", "defend", "throw_in", "draw", "finished"] as const;
export type GamePhase = (typeof GAME_PHASES)[number];

export const SEAT_ROLES = ["attacker", "defender", "idle"] as const;
export type SeatRole = (typeof SEAT_ROLES)[number];

export interface RoomPlayerSnapshot {
  id: string;
  name: string;
  seat: number;
  ready: boolean;
  connected: boolean;
}

export interface RoomSnapshot {
  code: string;
  hostId: string;
  maxPlayers: number;
  deckSize: DeckSize;
  jokers: boolean;
  mode: GameMode;
  /** Четверо игроков, напарники сидят напротив. */
  pairs: boolean;
  status: "lobby" | "playing";
  players: RoomPlayerSnapshot[];
}

/** Открытый стол в общем списке: без идентификаторов игроков. */
export interface TableListing {
  code: string;
  hostName: string;
  playerNames: string[];
  playerCount: number;
  maxPlayers: number;
  deckSize: DeckSize;
  jokers: boolean;
  mode: GameMode;
  pairs: boolean;
  status: "lobby" | "playing";
}

/** Пара на столе: карта атаки и карта, которой её отбили, если уже отбили. */
export interface TablePair {
  attack: Card;
  defense: Card | null;
}

export interface PublicPlayer {
  id: string;
  name: string;
  seat: number;
  connected: boolean;
  cardCount: number;
  role: SeatRole;
  flashedRanks: Rank[];
}

export interface FlashReveal {
  playerId: string;
  card: RegularCard;
}

/**
 * То, что можно показать всем.
 * Чужие карты сюда не попадают — только количество.
 */
export interface PublicGameState {
  phase: GamePhase;
  mode: GameMode;
  /** Напарник может помочь отбиться, но чужие карты ему не присылаются. */
  pairs: boolean;
  trump: Suit;
  trumpCard: RegularCard | null;
  deckCount: number;
  discardCount: number;
  attackerId: string;
  defenderId: string;
  boutAttackerId: string;
  passedIds: string[];
  /** Кто уже сказал «бито». В парах отвечают только соперники защитника. */
  bitoIds: string[];
  flash: FlashReveal | null;
  table: TablePair[];
  tableRanks: Rank[];
  players: PublicPlayer[];
  durakId: string | null;
  /** Кто проиграл. В парах это вся команда, если соперники уже без карт. */
  loserIds: string[];
  log: GameLogEntry[];
}

/** Персональный вид партии: общее поле плюс своя рука. */
export interface PlayerGameView {
  youId: string;
  hand: Card[];
  yourTurn: boolean;
  public: PublicGameState;
}
