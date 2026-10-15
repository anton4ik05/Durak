import { DECK_SIZES, MAX_PLAYERS, MIN_PLAYERS, normalizeName, type DeckSize, type GameMode, type TableListing } from "@durka/shared";
import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { CardView } from "../components/CardView";
import { deckCaption, modeCaption } from "../labels";
import { useGame } from "../net/GameProvider";

function tableRank(table: TableListing): number {
  if (table.status === "playing") return 2;
  if (table.playerCount >= table.maxPlayers) return 1;
  return 0;
}

export function LobbyScreen() {
  const game = useGame();
  const nameInput = useRef<HTMLInputElement>(null);
  const createDialog = useRef<HTMLDialogElement>(null);
  const [code, setCode] = useState("");
  const [creating, setCreating] = useState(false);
  const [maxPlayers, setMaxPlayers] = useState(MAX_PLAYERS);
  const [deckSize, setDeckSize] = useState<DeckSize>(36);
  const [jokers, setJokers] = useState(false);
  const [mode, setMode] = useState<GameMode>("podkidnoy");
  const [pairs, setPairs] = useState(false);
  const offline = game.status !== "online";
  const tables = [...game.tables].sort((left, right) => tableRank(left) - tableRank(right) || left.code.localeCompare(right.code));
  const waiting = tables.filter((table) => table.status === "lobby");
  const playing = tables.filter((table) => table.status === "playing");
  const openCount = waiting.filter((table) => table.playerCount < table.maxPlayers).length;

  function focusNameIfMissing(): void {
    if (!normalizeName(game.name)) nameInput.current?.focus();
  }

  function openCreate(): void {
    setCreating(true);
  }

  function closeCreate(): void {
    setCreating(false);
  }

  function submitCreate(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!normalizeName(game.name)) {
      closeCreate();
      nameInput.current?.focus();
    }
    game.createRoom({ maxPlayers: pairs ? 4 : maxPlayers, deckSize, jokers, mode, pairs });
  }

  useEffect(() => {
    const dialog = createDialog.current;
    if (!dialog) return;
    if (creating && !dialog.open) dialog.showModal();
    if (!creating && dialog.open) dialog.close();
  }, [creating]);

  return (
    <main className="menu">
      <section className="menu-banner">
        <div className="menu-banner-copy">
          <p className="eyebrow">Сетевой дурак</p>
          <h2>Сядьте за стол</h2>
          <p className="lead">Подкидной или переводной. Выберите стол из списка или откройте свой.</p>
        </div>
        <div className="hero-fan" aria-hidden="true">
          <CardView card={{ kind: "regular", suit: "spades", rank: "A" }} />
          <CardView card={{ kind: "regular", suit: "hearts", rank: "10" }} />
          <CardView card={{ kind: "joker", color: "red" }} />
        </div>
        <label className="field name-field">
          <span>Ваше имя</span>
          <input
            ref={nameInput}
            value={game.name}
            maxLength={16}
            placeholder="Как к вам обращаться"
            onChange={(event) => game.setName(event.target.value)}
          />
        </label>
      </section>

      <section className="panel menu-card tables-board">
        <div className="tables-head">
          <div>
            <h2>Открытые столы</h2>
            <p className="hint">
              {openCount > 0
                ? "Нажмите «Сесть» у свободного стола. Код нужен, только если стола нет в списке."
                : waiting.length > 0
                  ? "Мест нет. Создайте новый стол или дождитесь, пока кто-то выйдет."
                  : "Свободных столов нет. Создайте свой или введите код, если вас пригласили."}
            </p>
          </div>
        </div>

        {waiting.length === 0 ? (
          <div className="empty-board">
            <p>Пока некуда сесть. Новый стол появится здесь у всех, кто открыл игру.</p>
            <button type="button" onClick={openCreate} disabled={offline}>
              Создать стол
            </button>
          </div>
        ) : (
          <ul className="table-cards">
            {waiting.map((table) => {
              const open = table.playerCount < table.maxPlayers;
              return (
                <li key={table.code} className={open ? "table-card table-card-open" : "table-card table-card-closed"}>
                  <div className="table-main">
                    <p className="table-code">{table.code}</p>
                    <p className="table-host">Хозяин: {table.hostName}</p>
                    <p className="table-meta">
                      <span>{modeCaption(table.mode)}{table.pairs ? " · 2 на 2" : ""}</span>
                      <span>{deckCaption(table.deckSize, table.jokers)}</span>
                    </p>
                    <p className="table-players">{table.playerNames.join(" · ")}</p>
                  </div>
                  <div className="table-card-side">
                    <span className="seat-stat">
                      <b>
                        {table.playerCount}/{table.maxPlayers}
                      </b>
                      <i>{open ? "ждут" : "полон"}</i>
                    </span>
                    {open ? (
                      <button
                        type="button"
                        className="table-join"
                        disabled={offline}
                        onClick={() => {
                          focusNameIfMissing();
                          game.joinRoom(table.code);
                        }}
                      >
                        Сесть
                      </button>
                    ) : (
                      <span className="table-closed">Мест нет</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {playing.length > 0 && (
          <div className="playing-board">
            <h3>Уже играют</h3>
            <ul className="table-cards">
              {playing.map((table) => (
                <li key={table.code} className="table-card table-card-closed">
                  <div className="table-main">
                    <p className="table-code">{table.code}</p>
                    <p className="table-host">Хозяин: {table.hostName}</p>
                    <p className="table-meta">
                      <span>{modeCaption(table.mode)}{table.pairs ? " · 2 на 2" : ""}</span>
                      <span>{deckCaption(table.deckSize, table.jokers)}</span>
                    </p>
                    <p className="table-players">{table.playerNames.join(" · ")}</p>
                  </div>
                  <div className="table-card-side">
                    <span className="seat-stat seat-stat-live">
                      <b>
                        {table.playerCount}/{table.maxPlayers}
                      </b>
                      <i>идёт</i>
                    </span>
                    <span className="table-closed">Партия идёт</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="tables-foot">
          <form
            className="code-join"
            onSubmit={(event) => {
              event.preventDefault();
              focusNameIfMissing();
              game.joinRoom(code);
            }}
          >
            <label className="field">
              <span>Код стола</span>
              <input
                className="code-input"
                value={code}
                maxLength={4}
                placeholder="ABCD"
                autoCapitalize="characters"
                onChange={(event) => setCode(event.target.value.toUpperCase())}
              />
            </label>
            <button type="submit" disabled={offline || code.trim().length !== 4}>
              Сесть по коду
            </button>
          </form>
          {waiting.length > 0 && (
            <button type="button" onClick={openCreate} disabled={offline}>
              Создать стол
            </button>
          )}
        </div>
      </section>

      <dialog
        ref={createDialog}
        className="create-dialog"
        onClose={closeCreate}
        onClick={(event: MouseEvent<HTMLDialogElement>) => {
          if (event.target === event.currentTarget) closeCreate();
        }}
      >
          <form className="panel menu-card create-card" onSubmit={submitCreate}>
            <div className="create-dialog-bar">
              <div className="menu-card-head">
                <h2>Новый стол</h2>
                <p className="hint">Настройки сохранятся за этим столом до конца вечера.</p>
              </div>
              <div className="modal-fan" aria-hidden="true">
                <CardView card={{ kind: "regular", suit: "diamonds", rank: "Q" }} />
                <CardView card={{ kind: "regular", suit: "clubs", rank: "K" }} />
              </div>
              <button type="button" className="ghost create-close" onClick={closeCreate} aria-label="Закрыть">
                ×
              </button>
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
              Открыть стол
            </button>
          </form>
      </dialog>
    </main>
  );
}
