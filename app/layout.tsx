import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VisualTracker Studio",
  description: "Compare single-object tracking algorithms in one workspace"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
