import {
  normalizeName,
  parseServerMessage,
  type ClientMessage,
  type DeckSize,
  type GameAction,
  type GameMode,
  type PlayerGameView,
  type RoomSnapshot,
  type TableListing,
} from "@durka/shared";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

const NAME_KEY = "durka:name";
const PLAYER_KEY = "durka:player";

function readPlayerId(): string | undefined {
  try {
    const saved = localStorage.getItem(PLAYER_KEY);
    return saved && /^[0-9a-f-]{36}$/i.test(saved) ? saved : undefined;
  } catch {
    return undefined;
  }
}

function rememberPlayerId(playerId: string): void {
  try {
    localStorage.setItem(PLAYER_KEY, playerId);
  } catch {
    // место за столом восстановится, пока вкладка открыта
  }
}

function readSavedName(): string {
  try {
    const saved = localStorage.getItem(NAME_KEY);
    if (saved) return saved;
    const legacy = sessionStorage.getItem(NAME_KEY);
    if (!legacy) return "";
    localStorage.setItem(NAME_KEY, legacy);
    return legacy;
  } catch {
    return "";
  }
}

type ConnectionStatus = "connecting" | "online" | "offline";

interface GameClient {
  status: ConnectionStatus;
  playerId: string | null;
  name: string;
  setName: (name: string) => void;
  room: RoomSnapshot | null;
  tables: TableListing[];
  view: PlayerGameView | null;
  error: string | null;
  clearError: () => void;
  createRoom: (options: { maxPlayers: number; deckSize: DeckSize; jokers: boolean; mode: GameMode; pairs: boolean }) => void;
  play: (action: GameAction) => void;
  joinRoom: (code: string) => void;
  leaveRoom: () => void;
  returnToTable: () => void;
  setReady: (ready: boolean) => void;
  startGame: () => void;
  reconnect: () => void;
}

const GameContext = createContext<GameClient | null>(null);

function socketUrl(): string {
  const explicit = import.meta.env.VITE_WS_URL;
  if (explicit) return explicit;
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}/ws`;
}

export function GameProvider({ children }: { children: ReactNode }) {
  const socketRef = useRef<WebSocket | null>(null);
  const pendingRef = useRef<string[]>([]);
  const nameRef = useRef("");
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [name, setNameState] = useState(readSavedName);
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [tables, setTables] = useState<TableListing[]>([]);
  const [view, setView] = useState<PlayerGameView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  nameRef.current = name;

  const setName = useCallback((next: string) => {
    setNameState(next);
    try {
      localStorage.setItem(NAME_KEY, next);
    } catch {
      // имя останется до обновления страницы
    }
  }, []);

  const send = useCallback((message: ClientMessage) => {
    const raw = JSON.stringify(message);
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(raw);
      return;
    }
    pendingRef.current.push(raw);
  }, []);

  useEffect(() => {
    const socket = new WebSocket(socketUrl());
    socketRef.current = socket;
    setStatus("connecting");

    socket.addEventListener("open", () => {
      if (socketRef.current !== socket) return;
      const queued = pendingRef.current;
      pendingRef.current = [];
      for (const raw of queued) socket.send(raw);
      const normalized = normalizeName(nameRef.current);
      const playerId = readPlayerId();
      if (normalized) {
        socket.send(
          JSON.stringify({ type: "hello", name: normalized, ...(playerId ? { playerId } : {}) } satisfies ClientMessage),
        );
      }
    });

    socket.addEventListener("message", (event) => {
      if (socketRef.current !== socket) return;
      let payload: unknown;
      try {
        payload = JSON.parse(String(event.data));
      } catch {
        setError("Сервер прислал не JSON");
        return;
      }
      const message = parseServerMessage(payload);
      if (!message) {
        setError("Сервер прислал непонятное сообщение");
        return;
      }
      switch (message.type) {
        case "welcome":
          setPlayerId(message.playerId);
          rememberPlayerId(message.playerId);
          setStatus("online");
          return;
        case "error":
          setError(message.message);
          return;
        case "tables":
          setTables(message.tables);
          return;
        case "room":
          setRoom(message.room);
          setView((current) => (message.room.status === "lobby" ? null : current));
          setError(null);
          return;
        case "game":
          setView(message.view);
          setError(null);
          return;
        case "left_room":
          setRoom(null);
          setView(null);
          return;
        default: {
          const unknown: never = message;
          return unknown;
        }
      }
    });

    socket.addEventListener("close", () => {
      if (socketRef.current !== socket) return;
      setStatus("offline");
      setPlayerId(null);
      setRoom(null);
      setTables([]);
      setView(null);
    });

    return () => {
      if (socketRef.current === socket) socketRef.current = null;
      socket.close();
    };
  }, [attempt]);

  const introduce = useCallback((): boolean => {
    const normalized = normalizeName(nameRef.current);
    if (!normalized) {
      setError("Введите имя от 1 до 16 символов");
      return false;
    }
    setName(normalized);
    const playerId = readPlayerId();
    send({ type: "hello", name: normalized, ...(playerId ? { playerId } : {}) });
    setError(null);
    return true;
  }, [send, setName]);

  const value = useMemo<GameClient>(
    () => ({
      status,
      playerId,
      name,
      setName,
      room,
      tables,
      view,
      error,
      clearError: () => setError(null),
      createRoom: ({ maxPlayers, deckSize, jokers, mode, pairs }) => {
        if (!introduce()) return;
        send({ type: "create_room", maxPlayers, deckSize, jokers, mode, pairs });
      },
      play: (action) => {
        setError(null);
        send({ type: "play", action });
      },
      joinRoom: (code) => {
        if (!introduce()) return;
        send({ type: "join_room", code });
      },
      leaveRoom: () => send({ type: "leave_room" }),
      returnToTable: () => send({ type: "return_to_table" }),
      setReady: (ready) => send({ type: "set_ready", ready }),
      startGame: () => send({ type: "start_game" }),
      reconnect: () => setAttempt((current) => current + 1),
    }),
    [error, introduce, name, playerId, room, send, setName, status, tables, view],
  );

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGame(): GameClient {
  const context = useContext(GameContext);
  if (!context) throw new Error("useGame должен вызываться внутри GameProvider");
  return context;
}
