import TurnoverCard, { type CardStock } from "./TurnoverCard";

export default function TurnoverCardList({ stocks }: { stocks: CardStock[] }) {
  return (
    <div>
      {stocks.map((s) => (
        <TurnoverCard key={s.code} stock={s} />
      ))}
    </div>
  );
}
