import type { Metadata } from "next";
import { Chakra_Petch, IBM_Plex_Sans } from "next/font/google";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import "./globals.css";

// Chosen by Théo on 2026-09-28 from captures of four pairings. Geist +
// Bricolage had become a default pairing of recent generated sites.
//
// IBM Plex Sans for UI text and every figure: open, very legible at 11-13px,
// with real tabular figures for the stat columns.
const plexSans = IBM_Plex_Sans({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

// Chakra Petch for headings, big stat numbers and the wordmark: its clipped
// corners echo the game's hextech UI. Used sparingly, never for body copy.
const chakra = Chakra_Petch({
  variable: "--font-heading",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "MetArenaStats · League of Legends Arena stats & tier lists",
  description: "Free stats, tier lists and leaderboards for League of Legends Arena (EUW).",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${plexSans.variable} ${chakra.variable} h-full antialiased`}
    >
      {/* Background/color come from the `body` rule in globals.css (tokens),
          not Tailwind classes here — keeps a single source of truth. */}
      <body className="min-h-full flex flex-col">
        <Nav />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
