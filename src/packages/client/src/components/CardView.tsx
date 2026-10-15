import { cardKey, type Card } from "@durka/shared";
import { RANK_LABEL, SUIT_SYMBOL, isRedSuit } from "../labels";

export function CardView({
  card,
  selected = false,
  playable,
  onClick,
}: {
  card: Card;
  selected?: boolean;
  /** true — картой можно ходить, false — сейчас нельзя, не задано — без подсветки. */
  playable?: boolean;
  onClick?: () => void;
}) {
  const face = cardFace(card);
  const mark = playable === true ? "card-live" : playable === false ? "card-idle" : "";
  if (!onClick) {
    return mark ? <div className={mark}>{face}</div> : face;
  }
  const className = ["card-hit", selected ? "selected" : "", mark].filter(Boolean).join(" ");
  return (
    <button type="button" className={className} onClick={onClick}>
      {face}
    </button>
  );
}

function cardFace(card: Card) {
  if (card.kind === "joker") {
    const red = card.color === "red";
    return (
      <div
        className={red ? "card card-joker card-red" : "card card-joker"}
        data-card={cardKey(card)}
        aria-label={red ? "Красный джокер" : "Чёрный джокер"}
      >
        <CardIndex rank="Дж" suit="★" />
        <span className="card-pip" aria-hidden="true">
          ★
        </span>
      </div>
    );
  }

  const red = isRedSuit(card.suit);
  const rank = RANK_LABEL[card.rank];
  const suit = SUIT_SYMBOL[card.suit];
  return (
    <div className={red ? "card card-red" : "card"} data-card={cardKey(card)}>
      <CardIndex rank={rank} suit={suit} />
      <span className="card-pip" aria-hidden="true">
        {suit}
      </span>
    </div>
  );
}

function CardIndex({ rank, suit }: { rank: string; suit: string }) {
  return (
    <>
      <span className="card-index card-index-tl">
        <b>{rank}</b>
        <i>{suit}</i>
      </span>
      <span className="card-index card-index-br" aria-hidden="true">
        <b>{rank}</b>
        <i>{suit}</i>
      </span>
    </>
  );
}

export function CardBacks({ count }: { count: number }) {
  const shown = Math.min(count, 6);
  return (
    <div className="backs" aria-label={`Карт в руке: ${count}`}>
      {Array.from({ length: shown }, (_, index) => (
        <span key={index} className="back" />
      ))}
      <span className="count">{count}</span>
    </div>
  );
}
