import { Share2 } from "lucide-react";

export function ShareComposeGlyph({ isPending }: { isPending: boolean }) {
  if (isPending) {
    return (
      <span className="size-4 animate-spin rounded-full border-2 border-gold border-t-transparent" />
    );
  }
  return <Share2 className="size-4" aria-hidden="true" />;
}
