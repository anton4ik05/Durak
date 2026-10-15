import { isCard, isRank, isRegularCard, isSuit } from "./cards";
import { MAX_PLAYERS, MIN_PLAYERS, PROTOCOL_VERSION, isDeckSize, isGameMode } from "./constants";
import type { DeckSize, GameMode } from "./constants";
import { GAME_LOG_KINDS, GAME_PHASES, SEAT_ROLES } from "./views";
import type { Card } from "./cards";
import type { FlashReveal, GameLogEntry, PlayerGameView, PublicGameState, PublicPlayer, RoomPlayerSnapshot, RoomSnapshot, TableListing, TablePair } from "./views";

export { PROTOCOL_VERSION };

export type GameAction =
  | { type: "attack"; cards: Card[] }
  | { type: "defend"; card: Card; against: Card }
  | { type: "transfer"; card: Card }
  | { type: "flash"; card: Card }
  | { type: "throw_in"; cards: Card[] }
  | { type: "take" }
  | { type: "pass" }
  | { type: "done" };

export type ClientMessage =
  | { type: "hello"; name: string; playerId?: string }
  | { type: "create_room"; maxPlayers?: number; deckSize?: DeckSize; jokers?: boolean; mode?: GameMode; pairs?: boolean }
  | { type: "join_room"; code: string }
  | { type: "leave_room" }
  | { type: "return_to_table" }
  | { type: "set_ready"; ready: boolean }
  | { type: "start_game" }
  | { type: "play"; action: GameAction };

export const ERROR_CODES = [
  "bad_message",
  "need_hello",
  "bad_name",
  "already_in_room",
  "room_not_found",
  "room_full",
  "game_in_progress",
  "not_in_room",
  "cannot_start",
  "not_in_game",
  "not_implemented",
  "illegal_move",
  "no_game",
  "protocol",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export type ServerMessage =
  | { type: "welcome"; playerId: string; protocol: number }
  | { type: "error"; code: ErrorCode; message: string }
  | { type: "tables"; tables: TableListing[] }
  | { type: "room"; room: RoomSnapshot }
  | { type: "left_room" }
  | { type: "game"; view: PlayerGameView };

function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && (ERROR_CODES as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isCardList(value: unknown): value is Card[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 6 && value.every(isCard);
}

function parseAction(value: unknown): GameAction | null {
  if (!isRecord(value)) return null;
  switch (value.type) {
    case "attack":
    case "throw_in":
      return isCardList(value.cards) ? { type: value.type, cards: value.cards } : null;
    case "defend":
      return isCard(value.card) && isCard(value.against)
        ? { type: "defend", card: value.card, against: value.against }
        : null;
    case "transfer":
    case "flash":
      return isCard(value.card) ? { type: value.type, card: value.card } : null;
    case "take":
    case "pass":
    case "done":
      return { type: value.type };
    default:
      return null;
  }
}

export function parseClientMessage(value: unknown): ClientMessage | null {
  if (!isRecord(value)) return null;
  switch (value.type) {
    case "hello": {
      if (typeof value.name !== "string") return null;
      const message: Extract<ClientMessage, { type: "hello" }> = { type: "hello", name: value.name };
      if (value.playerId !== undefined) {
        if (typeof value.playerId !== "string" || !/^[0-9a-f-]{36}$/i.test(value.playerId)) return null;
        message.playerId = value.playerId;
      }
      return message;
    }
    case "create_room": {
      const message: Extract<ClientMessage, { type: "create_room" }> = { type: "create_room" };
      if (value.maxPlayers !== undefined) {
        if (typeof value.maxPlayers !== "number" || !Number.isInteger(value.maxPlayers)) return null;
        if (value.maxPlayers < MIN_PLAYERS || value.maxPlayers > MAX_PLAYERS) return null;
        message.maxPlayers = value.maxPlayers;
      }
      if (value.deckSize !== undefined) {
        if (!isDeckSize(value.deckSize)) return null;
        message.deckSize = value.deckSize;
      }
      if (value.jokers !== undefined) {
        if (typeof value.jokers !== "boolean") return null;
        message.jokers = value.jokers;
      }
      if (value.mode !== undefined) {
        if (!isGameMode(value.mode)) return null;
        message.mode = value.mode;
      }
      if (value.pairs !== undefined) {
        if (typeof value.pairs !== "boolean") return null;
        message.pairs = value.pairs;
      }
      return message;
    }
    case "join_room":
      return typeof value.code === "string" ? { type: "join_room", code: value.code } : null;
    case "leave_room":
      return { type: "leave_room" };
    case "return_to_table":
      return { type: "return_to_table" };
    case "set_ready":
      return typeof value.ready === "boolean" ? { type: "set_ready", ready: value.ready } : null;
    case "start_game":
      return { type: "start_game" };
    case "play": {
      const action = parseAction(value.action);
      return action ? { type: "play", action } : null;
    }
    default:
      return null;
  }
}

function isRoomPlayer(value: unknown): value is RoomPlayerSnapshot {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.seat === "number" &&
    typeof value.ready === "boolean" &&
    typeof value.connected === "boolean"
  );
}

function isTableListing(value: unknown): value is TableListing {
  if (!isRecord(value) || !Array.isArray(value.playerNames)) return false;
  return (
    typeof value.code === "string" &&
    typeof value.hostName === "string" &&
    value.playerNames.every((name) => typeof name === "string") &&
    typeof value.playerCount === "number" &&
    typeof value.maxPlayers === "number" &&
    isDeckSize(value.deckSize) &&
    typeof value.jokers === "boolean" &&
    isGameMode(value.mode) &&
    typeof value.pairs === "boolean" &&
    (value.status === "lobby" || value.status === "playing")
  );
}

function isRoomSnapshot(value: unknown): value is RoomSnapshot {
  if (!isRecord(value) || !Array.isArray(value.players)) return false;
  return (
    typeof value.code === "string" &&
    typeof value.hostId === "string" &&
    typeof value.maxPlayers === "number" &&
    isDeckSize(value.deckSize) &&
    typeof value.jokers === "boolean" &&
    isGameMode(value.mode) &&
    typeof value.pairs === "boolean" &&
    (value.status === "lobby" || value.status === "playing") &&
    value.players.every(isRoomPlayer)
  );
}

function isTablePair(value: unknown): value is TablePair {
  if (!isRecord(value) || !isCard(value.attack)) return false;
  return value.defense === null || isCard(value.defense);
}

function isPublicPlayer(value: unknown): value is PublicPlayer {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.seat === "number" &&
    typeof value.connected === "boolean" &&
    typeof value.cardCount === "number" &&
    typeof value.role === "string" &&
    (SEAT_ROLES as readonly string[]).includes(value.role) &&
    Array.isArray(value.flashedRanks) &&
    value.flashedRanks.every(isRank)
  );
}

function isFlashReveal(value: unknown): value is FlashReveal {
  return isRecord(value) && typeof value.playerId === "string" && isRegularCard(value.card);
}

function isGameLogEntry(value: unknown): value is GameLogEntry {
  return (
    isRecord(value) &&
    typeof value.id === "number" &&
    Number.isInteger(value.id) &&
    typeof value.kind === "string" &&
    (GAME_LOG_KINDS as readonly string[]).includes(value.kind) &&
    typeof value.text === "string" &&
    value.text.length > 0 &&
    value.text.length <= 280
  );
}

function isPublicGameState(value: unknown): value is PublicGameState {
  if (!isRecord(value) || !Array.isArray(value.table) || !Array.isArray(value.players)) return false;
  if (!Array.isArray(value.tableRanks) || !Array.isArray(value.log) || value.log.length > 500) return false;
  return (
    typeof value.phase === "string" &&
    (GAME_PHASES as readonly string[]).includes(value.phase) &&
    isGameMode(value.mode) &&
    typeof value.pairs === "boolean" &&
    isSuit(value.trump) &&
    (value.trumpCard === null || isRegularCard(value.trumpCard)) &&
    typeof value.deckCount === "number" &&
    typeof value.discardCount === "number" &&
    typeof value.attackerId === "string" &&
    typeof value.defenderId === "string" &&
    typeof value.boutAttackerId === "string" &&
    Array.isArray(value.passedIds) &&
    value.passedIds.every((id) => typeof id === "string") &&
    Array.isArray(value.bitoIds) &&
    value.bitoIds.every((id) => typeof id === "string") &&
    (value.flash === null || isFlashReveal(value.flash)) &&
    value.table.every(isTablePair) &&
    value.tableRanks.every(isRank) &&
    value.players.every(isPublicPlayer) &&
    value.log.every(isGameLogEntry) &&
    (value.durakId === null || typeof value.durakId === "string") &&
    Array.isArray(value.loserIds) &&
    value.loserIds.every((id) => typeof id === "string")
  );
}

function isPlayerGameView(value: unknown): value is PlayerGameView {
  if (!isRecord(value) || !Array.isArray(value.hand)) return false;
  return (
    typeof value.youId === "string" &&
    typeof value.yourTurn === "boolean" &&
    value.hand.every(isCard) &&
    isPublicGameState(value.public)
  );
}

export function parseServerMessage(value: unknown): ServerMessage | null {
  if (!isRecord(value)) return null;
  switch (value.type) {
    case "welcome":
      return typeof value.playerId === "string" && value.protocol === PROTOCOL_VERSION
        ? { type: "welcome", playerId: value.playerId, protocol: PROTOCOL_VERSION }
        : null;
    case "error":
      return isErrorCode(value.code) && typeof value.message === "string"
        ? { type: "error", code: value.code, message: value.message }
        : null;
    case "tables":
      return Array.isArray(value.tables) && value.tables.every(isTableListing)
        ? { type: "tables", tables: value.tables }
        : null;
    case "room":
      return isRoomSnapshot(value.room) ? { type: "room", room: value.room } : null;
    case "left_room":
      return { type: "left_room" };
    case "game":
      return isPlayerGameView(value.view) ? { type: "game", view: value.view } : null;
    default:
      return null;
  }
}
