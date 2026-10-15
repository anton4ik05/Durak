import { randomUUID } from "node:crypto";
import {
  PROTOCOL_VERSION,
  normalizeName,
  normalizeRoomCode,
  parseClientMessage,
  startBlockReason,
} from "@durka/shared";
import type { ClientMessage, ErrorCode, ServerMessage } from "@durka/shared";
import type { WebSocket } from "ws";
import { DurakGame } from "./game/engine";
import { RoomManager } from "./rooms/room-manager";
import type { Room } from "./rooms/room";

const MAX_MESSAGE_CHARS = 16_000;
const RETURN_GRACE_MS = 45_000;

interface Session {
  socket: WebSocket;
  playerId: string;
  name: string | null;
  roomCode: string | null;
}

export class DurakServer {
  private readonly sessions = new Map<WebSocket, Session>();
  private readonly rooms = new RoomManager();
  private readonly closing = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly returning = new Map<string, ReturnType<typeof setTimeout>>();

  handleConnection(socket: WebSocket): void {
    const session: Session = {
      socket,
      playerId: randomUUID(),
      name: null,
      roomCode: null,
    };
    this.sessions.set(socket, session);
    this.send(session, { type: "welcome", playerId: session.playerId, protocol: PROTOCOL_VERSION });
    this.publishTables();

    socket.on("message", (data) => {
      this.onMessage(session, data.toString());
    });
    socket.on("close", () => {
      this.sessions.delete(socket);
      this.holdSeat(session);
    });
    socket.on("error", () => {
      socket.close();
    });
  }

  private onMessage(session: Session, raw: string): void {
    if (raw.length > MAX_MESSAGE_CHARS) {
      this.fail(session, "bad_message", "Слишком большое сообщение");
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      this.fail(session, "bad_message", "Некорректный JSON");
      return;
    }

    const message = parseClientMessage(payload);
    if (!message) {
      this.fail(session, "bad_message", "Неизвестное сообщение");
      return;
    }

    switch (message.type) {
      case "hello":
        this.hello(session, message);
        return;
      case "create_room":
        this.createRoom(session, message);
        return;
      case "join_room":
        this.joinRoom(session, message.code);
        return;
      case "leave_room":
        this.leave(session);
        this.send(session, { type: "left_room" });
        return;
      case "return_to_table":
        this.returnToTable(session);
        return;
      case "set_ready":
        this.setReady(session, message.ready);
        return;
      case "shuffle_seats":
        this.shuffleSeats(session);
        return;
      case "start_game":
        this.startGame(session);
        return;
      case "play":
        this.play(session, message.action);
        return;
      default: {
        const unknown: never = message;
        return unknown;
      }
    }
  }

  private hello(session: Session, message: Extract<ClientMessage, { type: "hello" }>): void {
    const name = normalizeName(message.name);
    if (!name) {
      this.fail(session, "bad_name", "Имя должно быть от 1 до 16 символов");
      return;
    }
    session.name = name;
    if (message.playerId && message.playerId !== session.playerId && this.resume(session, message.playerId)) return;
    if (!session.roomCode) return;
    const room = this.rooms.get(session.roomCode);
    if (!room || room.game) return;
    const player = room.players.find((seat) => seat.id === session.playerId);
    if (!player) return;
    player.name = name;
    this.sync(room);
  }

  /** Возвращает игрока на его место после обновления страницы или обрыва связи. */
  private resume(session: Session, playerId: string): boolean {
    const room = this.rooms.findByPlayer(playerId);
    const seat = room?.players.find((player) => player.id === playerId);
    if (!room || !seat) return false;

    for (const other of this.sessions.values()) {
      if (other === session || other.playerId !== playerId) continue;
      other.roomCode = null;
      other.playerId = randomUUID();
      this.send(other, { type: "left_room" });
    }

    this.clearReturn(room.code, playerId);
    session.playerId = playerId;
    session.roomCode = room.code;
    if (session.name) seat.name = session.name;
    seat.connected = true;
    room.game?.setConnected(playerId, true);
    this.send(session, { type: "welcome", playerId, protocol: PROTOCOL_VERSION });
    this.sync(room);
    this.publishTables();
    return true;
  }

  private createRoom(
    session: Session,
    message: Extract<ClientMessage, { type: "create_room" }>,
  ): void {
    if (!session.name) {
      this.fail(session, "need_hello", "Сначала представьтесь");
      return;
    }
    if (session.roomCode) {
      this.fail(session, "already_in_room", "Вы уже за столом");
      return;
    }

    const room = this.rooms.create(
      { id: session.playerId, name: session.name },
      {
        maxPlayers: message.maxPlayers,
        deckSize: message.deckSize,
        jokers: message.jokers,
        mode: message.mode,
        pairs: message.pairs,
      },
    );
    session.roomCode = room.code;
    this.sync(room);
    this.publishTables();
  }

  private joinRoom(session: Session, rawCode: string): void {
    if (!session.name) {
      this.fail(session, "need_hello", "Сначала представьтесь");
      return;
    }
    if (session.roomCode) {
      this.fail(session, "already_in_room", "Вы уже за столом");
      return;
    }

    const code = normalizeRoomCode(rawCode);
    const room = code ? this.rooms.get(code) : undefined;
    if (!room) {
      this.fail(session, "room_not_found", "Стол с таким кодом не найден");
      return;
    }
    if (room.game) {
      this.fail(session, "game_in_progress", "Партия уже началась");
      return;
    }
    if (room.players.length >= room.maxPlayers) {
      this.fail(session, "room_full", "За столом нет свободных мест");
      return;
    }

    room.players.push({
      id: session.playerId,
      name: session.name,
      ready: false,
      connected: true,
    });
    session.roomCode = room.code;
    this.sync(room);
    this.publishTables();
  }

  private shuffleSeats(session: Session): void {
    const room = this.roomOf(session);
    if (!room) return;
    if (session.playerId !== room.hostId) {
      this.fail(session, "not_allowed", "Пары тасует хозяин стола");
      return;
    }
    if (!room.pairs) {
      this.fail(session, "not_allowed", "Пары есть только в игре 2 на 2");
      return;
    }
    if (room.game) {
      this.fail(session, "game_in_progress", "Партия уже началась");
      return;
    }
    room.shuffleSeats();
    this.sync(room);
  }

  private setReady(session: Session, ready: boolean): void {
    const room = this.roomOf(session);
    if (!room) return;
    if (room.game) {
      this.fail(session, "game_in_progress", "Партия уже началась");
      return;
    }
    const player = room.players.find((seat) => seat.id === session.playerId);
    if (!player) return;
    player.ready = ready;
    this.sync(room);
  }

  /** Законченная партия снимается со стола. Игроки остаются и могут раздать ещё раз. */
  private returnToTable(session: Session): void {
    const room = this.roomOf(session);
    if (!room) return;
    if (!room.game) {
      this.sync(room);
      return;
    }
    let finished = false;
    try {
      finished = room.game.viewFor(session.playerId).public.phase === "finished";
    } catch {
      finished = false;
    }
    if (!finished) {
      this.fail(session, "game_in_progress", "Партия ещё не закончена");
      return;
    }
    this.stopClose(room.code);
    room.game = null;
    for (const player of room.players) player.ready = false;
    this.sync(room);
    this.publishTables();
  }

  private startGame(session: Session): void {
    const room = this.roomOf(session);
    if (!room) return;
    const reason = startBlockReason(room.toSnapshot(), session.playerId);
    if (reason) {
      this.fail(session, "cannot_start", reason);
      return;
    }

    const seated = room.players.filter((player) => player.connected);
    try {
      room.game = new DurakGame(
        seated.map((player) => ({
          id: player.id,
          name: player.name,
          connected: player.connected,
        })),
        { size: room.deckSize, jokers: room.jokers, mode: room.mode, pairs: room.pairs },
      );
    } catch {
      room.game = null;
      this.fail(session, "cannot_start", "Не удалось раздать карты");
      return;
    }
    this.stopClose(room.code);
    this.sync(room);
    this.publishTables();
  }

  private play(session: Session, action: Parameters<DurakGame["apply"]>[1]): void {
    const room = this.roomOf(session);
    if (!room) return;
    if (!room.game) {
      this.fail(session, "no_game", "Партия ещё не началась");
      return;
    }
    const result = room.game.apply(session.playerId, action);
    if (!result.ok) {
      this.fail(session, result.code, result.message);
      return;
    }
    this.sync(room);
    this.armClose(room);
  }

  /** После отбитого джокера стол сам уходит в сброс, «бито» не спрашиваем. */
  private armClose(room: Room): void {
    const pending = this.closing.get(room.code);
    if (pending) clearTimeout(pending);
    this.closing.delete(room.code);
    const game = room.game;
    if (!game?.wantsAutoClose()) return;
    const timer = setTimeout(() => {
      this.closing.delete(room.code);
      if (this.rooms.get(room.code)?.game !== game || !game.wantsAutoClose()) return;
      game.finishAutoClose();
      this.sync(room);
    }, 2000);
    this.closing.set(room.code, timer);
  }

  private stopClose(code: string): void {
    const pending = this.closing.get(code);
    if (pending) clearTimeout(pending);
    this.closing.delete(code);
  }

  private roomOf(session: Session): Room | null {
    if (!session.roomCode) {
      this.fail(session, "not_in_room", "Вы не за столом");
      return null;
    }
    const room = this.rooms.get(session.roomCode);
    if (!room) {
      session.roomCode = null;
      this.fail(session, "room_not_found", "Стол уже закрыт");
      return null;
    }
    return room;
  }

  private holdSeat(session: Session): void {
    const code = session.roomCode;
    if (!code) return;
    session.roomCode = null;
    const room = this.rooms.get(code);
    if (!room) return;
    const player = room.players.find((seat) => seat.id === session.playerId);
    if (!player) return;

    player.connected = false;
    room.game?.setConnected(session.playerId, false);
    this.sync(room);
    this.publishTables();

    const key = `${code}:${player.id}`;
    const previous = this.returning.get(key);
    if (previous) clearTimeout(previous);
    this.returning.set(
      key,
      setTimeout(() => {
        this.returning.delete(key);
        this.dropIfStillGone(code, player.id);
      }, RETURN_GRACE_MS),
    );
  }

  private dropIfStillGone(code: string, playerId: string): void {
    const room = this.rooms.get(code);
    if (!room) return;
    const player = room.players.find((seat) => seat.id === playerId);
    if (!player || player.connected) return;

    if (room.game) {
      if (room.players.every((seat) => !seat.connected)) {
        this.stopClose(code);
        this.rooms.delete(code);
        this.publishTables();
      }
      return;
    }

    room.players = room.players.filter((seat) => seat.id !== playerId);
    if (room.players.length === 0) {
      this.stopClose(code);
      this.rooms.delete(code);
    } else {
      if (room.hostId === playerId) {
        const nextHost = room.players[0];
        if (nextHost) room.hostId = nextHost.id;
      }
      this.sync(room);
    }
    this.publishTables();
  }

  private clearReturn(code: string, playerId: string): void {
    const key = `${code}:${playerId}`;
    const pending = this.returning.get(key);
    if (pending) clearTimeout(pending);
    this.returning.delete(key);
  }

  private leave(session: Session): void {
    const code = session.roomCode;
    if (!code) return;
    session.roomCode = null;
    const room = this.rooms.get(code);
    if (!room) return;

    const player = room.players.find((seat) => seat.id === session.playerId);
    if (!player) return;
    this.clearReturn(code, player.id);

    if (room.game) {
      player.connected = false;
      room.game.setConnected(session.playerId, false);
      room.players = room.players.filter((seat) => seat.id !== session.playerId);
      if (room.players.length === 0 || room.players.every((seat) => !seat.connected)) {
        this.stopClose(code);
        this.rooms.delete(code);
      } else {
        if (room.hostId === session.playerId) {
          const nextHost = room.players[0];
          if (nextHost) room.hostId = nextHost.id;
        }
        this.sync(room);
      }
      this.publishTables();
      return;
    }

    room.players = room.players.filter((seat) => seat.id !== session.playerId);
    if (room.players.length === 0) {
      this.stopClose(code);
      this.rooms.delete(code);
    } else {
      if (room.hostId === session.playerId) {
        const nextHost = room.players[0];
        if (nextHost) room.hostId = nextHost.id;
      }
      this.sync(room);
    }
    this.publishTables();
  }

  private publishTables(): void {
    const tables = this.rooms.list();
    for (const session of this.sessions.values()) {
      if (session.roomCode) continue;
      this.send(session, { type: "tables", tables });
    }
  }

  private sync(room: Room): void {
    const snapshot = room.toSnapshot();
    for (const session of this.sessions.values()) {
      if (session.roomCode !== room.code) continue;
      this.send(session, { type: "room", room: snapshot });
      if (!room.game) continue;
      try {
        this.send(session, { type: "game", view: room.game.viewFor(session.playerId) });
      } catch {
        this.fail(session, "not_in_game", "Не удалось собрать вид партии");
      }
    }
  }

  private fail(session: Session, code: ErrorCode, message: string): void {
    this.send(session, { type: "error", code, message });
  }

  private send(session: Session, message: ServerMessage): void {
    if (session.socket.readyState !== session.socket.OPEN) return;
    session.socket.send(JSON.stringify(message));
  }
}
