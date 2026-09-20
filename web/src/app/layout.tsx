import type { Metadata } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

const title = "How I’m using Jev in an agent harness — JCR";
const description =
  "I built JCR to explore how Jev can help agents find deterministic commands across providers. It’s a capability lookup designed to complement skills.";

export const metadata: Metadata = {
  metadataBase: new URL("https://jcr.niazmorshed.dev"),
  title,
  description,
  openGraph: { title, description, type: "article" },
  twitter: { card: "summary_large_image", creator: "@niazmorshed_" },
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
