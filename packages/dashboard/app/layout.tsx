import type { Metadata } from "next";
import { EB_Garamond, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const serif = EB_Garamond({
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Automaton Dashboard",
  description: "Local observability dashboard for Automaton",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${serif.variable} ${mono.variable}`}>{children}</body>
    </html>
  );
}
