import type { Metadata, Viewport } from "next";
import { Archivo, IBM_Plex_Mono } from "next/font/google";
import { SITE_URL } from "@/lib/site";
import "./globals.css";

const sans = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-sans", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Tagout: is anything you own recalled?", template: "%s · Tagout" },
  description:
    "Tell Tagout what you own, or photograph the label. An agent on NVIDIA Nemotron reads it, searches NHTSA, CPSC, FDA and USDA recalls and the web, and tags out anything recalled with what to do.",
  openGraph: { type: "website", siteName: "Tagout" },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = { themeColor: "#e9ecef" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
