import { startBlockReason, type RoomPlayerSnapshot } from "@durka/shared";
import { useState } from "react";
import { deckCaption, modeCaption } from "../labels";
import { useGame } from "../net/GameProvider";

function SeatCard({ player, youId, hostId }: { player: RoomPlayerSnapshot; youId: string | null; hostId: string }) {
  return (
    <li className={[player.connected ? "" : "offline", player.ready ? "ready" : ""].filter(Boolean).join(" ")}>
      <span className="avatar" aria-hidden="true">
        {player.name.slice(0, 1).toUpperCase()}
      </span>
      <span className="seat-name">
        {player.name}
        {player.id === youId ? " · вы" : ""}
      </span>
      <span className="seat-role">
        {player.id === hostId ? "хозяин стола" : "гость"}
        {!player.connected ? " · не в сети" : ""}
      </span>
      <span className={player.ready ? "pill pill-ready" : "pill"}>{player.ready ? "готов" : "думает"}</span>
    </li>
  );
}

export function RoomScreen() {
  const game = useGame();
  const room = game.room;
  const [copied, setCopied] = useState(false);
  if (!room || !game.playerId) return null;

  const me = room.players.find((player) => player.id === game.playerId);
  const block = startBlockReason(room, game.playerId);
  const isHost = room.hostId === game.playerId;
  const readyCount = room.players.filter((player) => player.ready).length;

  return (
    <main className="menu">
      <section className="panel menu-card room-hero">
        <div>
          <p className="eyebrow">Код стола</p>
          <p className="code">{room.code}</p>
          <div className="room-tags">
            <span className="pill">{modeCaption(room.mode)}{room.pairs ? " · 2 на 2" : ""}</span>
            <span className="pill">{deckCaption(room.deckSize, room.jokers)}</span>
            <span className="pill">
              {room.players.length}/{room.maxPlayers}
            </span>
          </div>
        </div>
        <div className="row">
          <button
            type="button"
            className="ghost"
            onClick={() => {
              void navigator.clipboard.writeText(room.code).then(
                () => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1600);
                },
                () => setCopied(false),
              );
            }}
          >
            {copied ? "Скопировано" : "Скопировать код"}
          </button>
          <button type="button" className="ghost" onClick={game.leaveRoom}>
            На главный экран
          </button>
        </div>
      </section>

      <section className="panel menu-card">
        <div className="menu-card-head">
          <h2>Кто за столом</h2>
          <p className="hint">
            Готовы {readyCount} из {room.players.length}
          </p>
        </div>
        {room.pairs ? (
          <div className="pair-board">
            {[0, 1].map((side) => (
              <div key={side} className="pair-column">
                <p className="eyebrow">{side === 0 ? "Пара 1" : "Пара 2"}</p>
                <ul className="seat-grid">
                  {room.players
                    .filter((player) => player.seat % 2 === side)
                    .map((player) => (
                      <SeatCard key={player.id} player={player} youId={game.playerId} hostId={room.hostId} />
                    ))}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <ul className="seat-grid">
            {room.players.map((player) => (
              <SeatCard key={player.id} player={player} youId={game.playerId} hostId={room.hostId} />
            ))}
          </ul>
        )}

        <div className="row room-actions">
          <button type="button" className={me?.ready ? "ghost" : ""} onClick={() => game.setReady(!me?.ready)}>
            {me?.ready ? "Пока не готов" : "Я готов"}
          </button>
          {isHost && room.pairs && (
            <button type="button" className="ghost" disabled={room.players.length < 2} onClick={game.shuffleSeats}>
              Перетасовать пары
            </button>
          )}
          {isHost && (
            <button type="button" disabled={block !== null} onClick={game.startGame}>
              Раздать карты
            </button>
          )}
        </div>
        {isHost && room.pairs && <p className="hint">Напарники сидят напротив. Перетасовка сбрасывает «готов».</p>}
        {isHost && block && <p className="hint">{block}</p>}
        {!isHost && <p className="hint">Ждём, пока хозяин стола раздаст карты.</p>}
      </section>
    </main>
  );
}
