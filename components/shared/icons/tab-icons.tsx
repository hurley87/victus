import { Swords, Trophy, WalletMinimal } from "lucide-react";

type TabIconProps = {
  className?: string;
};

const sharedIconProps = {
  strokeWidth: 1.85,
  absoluteStrokeWidth: true,
  "aria-hidden": "true" as const,
};

export function WalletIcon({ className }: TabIconProps) {
  return <WalletMinimal className={className} {...sharedIconProps} />;
}

export function TradeIcon({ className }: TabIconProps) {
  return <Swords className={className} {...sharedIconProps} />;
}

export function StandingsIcon({ className }: TabIconProps) {
  return <Trophy className={className} {...sharedIconProps} />;
}
