import { FarcasterIcon } from "@/components/shared/icons/farcaster-icon";
import { Button } from "@/components/shared/ui/button";
import { env } from "@/lib/env";
import Image from "next/image";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";

export const Website = ({ page }: { page?: string }) => {
  const farcasterUrl = `https://farcaster.xyz/?launchFrameUrl=${encodeURIComponent(
    env.NEXT_PUBLIC_URL
  )}${page ? `/${encodeURIComponent(page)}` : ""}`;

  return (
    <main className="min-h-screen w-full bg-imperial-bg text-zinc-200">
      <div className="mx-auto flex min-h-screen w-full max-w-lg flex-col items-center justify-center gap-10 px-6 py-12">
        <div className="flex flex-col items-center gap-5 text-center">
          <Image
            alt="Victus Imperium"
            className="size-20 rounded-xl border border-gold/20 object-contain"
            height={96}
            src="/images/icon.png"
            width={96}
            priority
          />
          <div className="flex flex-col gap-2">
            <h1 className="font-serif text-3xl uppercase tracking-[0.2em] text-gold">
              Victus Imperium
            </h1>
            <p className="text-sm text-zinc-400">
              A public trading game on Farcaster
            </p>
          </div>
        </div>

        <div className="hidden rounded-xl border border-imperial-border bg-imperial-surface p-3 sm:block">
          <QRCodeSVG
            value={farcasterUrl}
            size={192}
            bgColor="#141414"
            fgColor="#C8A84E"
            level="M"
          />
        </div>

        <Button asChild variant="imperial" size="lg" className="w-full max-w-xs">
          <Link href={farcasterUrl} target="_blank" rel="noreferrer">
            <FarcasterIcon className="size-5" />
            <span>Open on Farcaster</span>
          </Link>
        </Button>
      </div>
    </main>
  );
};
