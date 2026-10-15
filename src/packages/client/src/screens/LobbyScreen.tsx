import { DECK_SIZES, MAX_PLAYERS, MIN_PLAYERS, type DeckSize, type GameMode } from "@durka/shared";
import { useState } from "react";
import { CardView } from "../components/CardView";
import { deckCaption, modeCaption } from "../labels";
import { useGame } from "../net/GameProvider";

export function LobbyScreen() {
  const game = useGame();
  const [code, setCode] = useState("");
  const [maxPlayers, setMaxPlayers] = useState(MAX_PLAYERS);
  const [deckSize, setDeckSize] = useState<DeckSize>(36);
  const [jokers, setJokers] = useState(false);
  const [mode, setMode] = useState<GameMode>("podkidnoy");
  const [pairs, setPairs] = useState(false);
  const offline = game.status !== "online";

  return (
    <main className="menu">
      <section className="menu-hero">
        <div>
          <p className="eyebrow">Сетевой дурак</p>
          <h2>Сядьте за стол</h2>
          <p className="lead">Подкидной или переводной, колода на 36 или 52 карты, от двух до шести игроков.</p>
        </div>
        <div className="hero-fan" aria-hidden="true">
          <CardView card={{ kind: "regular", suit: "spades", rank: "A" }} />
          <CardView card={{ kind: "regular", suit: "hearts", rank: "10" }} />
          <CardView card={{ kind: "joker", color: "red" }} />
        </div>
        <label className="field">
          <span>Ваше имя</span>
          <input
            value={game.name}
            maxLength={16}
            placeholder="Как к вам обращаться"
            onChange={(event) => game.setName(event.target.value)}
          />
        </label>
      </section>

      <div className="menu-grid">
        <form
          className="panel menu-card"
          onSubmit={(event) => {
            event.preventDefault();
            game.createRoom({ maxPlayers: pairs ? 4 : maxPlayers, deckSize, jokers, mode, pairs });
          }}
        >
          <div className="menu-card-head">
            <h2>Новый стол</h2>
            <p className="hint">Настройки сохранятся за этим столом до конца вечера.</p>
          </div>

          <fieldset className="choice">
            <legend>Игра</legend>
            <div className="seg">
              <button type="button" className={mode === "podkidnoy" ? "on" : ""} onClick={() => setMode("podkidnoy")}>
                Подкидной
              </button>
              <button type="button" className={mode === "perevodnoy" ? "on" : ""} onClick={() => setMode("perevodnoy")}>
                Переводной
              </button>
            </div>
          </fieldset>
          {mode === "perevodnoy" && (
            <p className="hint">
              Защитник может перевести картой того же номинала. Козырем того же номинала можно посветить один раз — карта останется в руке.
            </p>
          )}

          <button
            type="button"
            className={pairs ? "switch on" : "switch"}
            onClick={() => {
              setPairs((value) => {
                if (!value) setMaxPlayers(4);
                return !value;
              });
            }}
          >
            <span>
              <strong>2 на 2</strong>
              <small>{pairs ? "по парам" : "каждый за себя"}</small>
            </span>
            <span className="switch-knob" aria-hidden="true" />
          </button>
          {pairs && (
            <p className="hint">
              Четверо игроков, напарники сидят напротив. Свои карты не показывают. Можно помочь отбить, а в переводном — перевести или посветить за союзника.
            </p>
          )}

          {!pairs && (
          <fieldset className="choice">
            <legend>Мест за столом</legend>
            <div className="seg">
              {Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_, index) => {
                const size = MIN_PLAYERS + index;
                return (
                  <button key={size} type="button" className={maxPlayers === size ? "on" : ""} onClick={() => setMaxPlayers(size)}>
                    {size}
                  </button>
                );
              })}
            </div>
          </fieldset>
          )}

          <fieldset className="choice">
            <legend>Колода</legend>
            <div className="seg">
              {DECK_SIZES.map((size) => (
                <button key={size} type="button" className={deckSize === size ? "on" : ""} onClick={() => setDeckSize(size)}>
                  {size === 36 ? "36 · от шестёрки" : "52 · от двойки"}
                </button>
              ))}
            </div>
          </fieldset>

          <button type="button" className={jokers ? "switch on" : "switch"} onClick={() => setJokers((value) => !value)}>
            <span>
              <strong>Джокеры</strong>
              <small>{jokers ? "в колоде" : "без джокеров"}</small>
            </span>
            <span className="switch-knob" aria-hidden="true" />
          </button>
          {jokers && (
            <p className="hint">
              Любой джокер бьёт любую карту, кроме другого джокера, и не бывает козырем. За двоих им можно ходить. Если игроков больше, ходить джокером нельзя: одна карта-джокер на руках — проигрыш. Подкинуть джокер нельзя.
            </p>
          )}

          <button type="submit" className="menu-submit" disabled={offline}>
            Создать стол
          </button>
        </form>

        <div className="menu-side">
          <form
            className="panel menu-card"
            onSubmit={(event) => {
              event.preventDefault();
              game.joinRoom(code);
            }}
          >
            <div className="menu-card-head">
              <h2>Войти по коду</h2>
              <p className="hint">Четыре символа, которые назвал хозяин стола.</p>
            </div>
            <label className="field">
              <span>Код</span>
              <input
                className="code-input"
                value={code}
                maxLength={4}
                placeholder="ABCD"
                autoCapitalize="characters"
                onChange={(event) => setCode(event.target.value.toUpperCase())}
              />
            </label>
            <button type="submit" className="menu-submit" disabled={offline || code.trim().length !== 4}>
              Сесть за стол
            </button>
          </form>

          <section className="panel menu-card">
            <div className="menu-card-head">
              <h2>Открытые столы</h2>
              <p className="hint">{game.tables.length === 0 ? "Пока пусто" : `${game.tables.length} за этим сервером`}</p>
            </div>
            {game.tables.length === 0 ? (
              <p className="empty-note">Создайте стол — он появится здесь у всех, кто открыл игру.</p>
            ) : (
              <ul className="table-cards">
                {game.tables.map((table) => {
                  const open = table.status === "lobby" && table.playerCount < table.maxPlayers;
                  return (
                    <li key={table.code} className="table-card">
                      <div>
                        <p className="table-code">{table.code}</p>
                        <p className="table-meta">
                          <span>{modeCaption(table.mode)}{table.pairs ? " · 2 на 2" : ""}</span>
                          <span>{deckCaption(table.deckSize, table.jokers)}</span>
                        </p>
                        <p className="hint">{table.playerNames.join(", ")}</p>
                      </div>
                      <div className="table-card-side">
                        <span className={table.status === "playing" ? "seat-stat seat-stat-live" : "seat-stat"}>
                          <b>
                            {table.playerCount}/{table.maxPlayers}
                          </b>
                          <i>{table.status === "playing" ? "идёт" : open ? "ждут" : "полон"}</i>
                        </span>
                        <button type="button" className="table-join" disabled={offline || !open} onClick={() => game.joinRoom(table.code)}>
                          {table.status === "playing" ? "Войти" : open ? "Сесть" : "Полон"}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
