import { modeCaption } from "./labels";
import { GameProvider, useGame } from "./net/GameProvider";
import { LobbyScreen } from "./screens/LobbyScreen";
import { RoomScreen } from "./screens/RoomScreen";
import { TableScreen } from "./screens/TableScreen";

export function App() {
  return (
    <GameProvider>
      <Shell />
    </GameProvider>
  );
}

function Shell() {
  const game = useGame();
  const statusLabel =
    game.status === "online" ? "в сети" : game.status === "connecting" ? "соединение…" : "нет связи";
  const mode = game.view?.public.mode ?? game.room?.mode;

  return (
    <div className={game.view ? "app app-play" : "app app-menu"}>
      <header className="topbar">
        <div>
          <p className="eyebrow">{mode ? modeCaption(mode) : "подкидной · переводной"}</p>
          <h1 className="wordmark">Дурак</h1>
        </div>
        <div className={`status status-${game.status}`}>
          <span className="dot" />
          {statusLabel}
        </div>
      </header>

      {game.error && (
        <div className="banner" role="alert">
          <span>{game.error}</span>
          <button type="button" onClick={game.clearError}>
            Скрыть
          </button>
        </div>
      )}

      {game.status === "offline" && (
        <div className="banner">
          <span>Связь с сервером потеряна.</span>
          <button type="button" onClick={game.reconnect}>
            Переподключиться
          </button>
        </div>
      )}

      {!game.room && <LobbyScreen />}
      {game.room && !game.view && <RoomScreen />}
      {game.room && game.view && <TableScreen />}
    </div>
  );
}
