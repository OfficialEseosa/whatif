import type { Metadata } from "next";
import { Bricolage_Grotesque, Instrument_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";

/** Wordmark and headings. */
const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
});

/** Body text. */
const instrument = Instrument_Sans({
  variable: "--font-instrument",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

/** Numbers, labels, clock, legend. */
const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["500", "700"],
});

export const metadata: Metadata = {
  title: "WhatIf ATL",
  description: "Type a transit plan; see who wins, who pays, and the history it lands on.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${bricolage.variable} ${instrument.variable} ${jetbrains.variable} antialiased`}>
      <body>{children}</body>
    </html>
  );
}
