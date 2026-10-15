import { MAX_NAME_LENGTH, MAX_PLAYERS, MIN_PLAYERS } from "./constants";
import type { RoomSnapshot } from "./views";

export function normalizeName(input: string): string | null {
  const name = input.trim().replace(/\s+/g, " ");
  if (name.length < 1 || name.length > MAX_NAME_LENGTH) return null;
  return name;
}

export function normalizeRoomCode(input: string): string | null {
  const code = input.trim().toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(code)) return null;
  return code;
}

export function clampMaxPlayers(value: number | undefined): number {
  if (value === undefined) return MAX_PLAYERS;
  return Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, value));
}

/** Почему стол ещё нельзя начать. `null` — можно. */
export function startBlockReason(room: RoomSnapshot, playerId: string): string | null {
  if (room.status !== "lobby") return "Игра уже идёт";
  if (room.hostId !== playerId) return "Только создатель стола может начать игру";
  const online = room.players.filter((player) => player.connected);
  if (room.pairs && online.length !== 4) return "Для игры 2 на 2 нужны ровно четверо";
  if (online.length < MIN_PLAYERS) return "Нужно минимум два игрока";
  const waiting = online.filter((player) => player.id !== room.hostId && !player.ready);
  if (waiting.length > 0) return "Не все игроки нажали «Готов»";
  return null;
}
