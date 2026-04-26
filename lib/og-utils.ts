export async function loadGoogleFont(font: string, text: string) {
  const url = `https://fonts.googleapis.com/css2?family=${font}&text=${encodeURIComponent(
    text
  )}`;
  const css = await (await fetch(url)).text();
  const resource = css.match(
    /src: url\((.+)\) format\('(opentype|truetype)'\)/
  );

  if (resource) {
    const response = await fetch(resource[1]);
    if (response.status == 200) {
      return await response.arrayBuffer();
    }
  }

  throw new Error("failed to load font data");
}

export async function loadImage(url: string): Promise<ArrayBuffer> {
  const logoImageRes = await fetch(url);

  if (!logoImageRes.ok) {
    throw new Error(`Failed to fetch logo image: ${logoImageRes.statusText}`);
  }

  return await logoImageRes.arrayBuffer();
}

/** Absolute USDC for OG card numbers (no +/-). */
export function formatOgUsd(value: number): string {
  const abs = Math.abs(value);
  return `$${abs.toFixed(abs >= 100 ? 0 : 2)}`;
}

/** Signed USDC for PnL / notional lines on trade OG cards. */
export function formatOgSignedUsd(value: number): string {
  const sign = value >= 0 ? "+" : "-";
  const abs = Math.abs(value);
  return `${sign}$${abs.toFixed(abs >= 100 ? 0 : 2)}`;
}

export function formatOgPercent(value: number): string {
  return value.toLocaleString("en-US", {
    style: "percent",
    maximumFractionDigits: 1,
    signDisplay: "exceptZero",
  });
}
