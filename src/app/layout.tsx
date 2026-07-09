import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Flow Past a Cylinder — CFD in Browser",
  description: "Incompressible Navier-Stokes simulation of flow past a circular cylinder, running entirely in-browser via Web Worker.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark h-full antialiased">
      <body className="min-h-full bg-zinc-950 text-zinc-100">{children}</body>
    </html>
  );
}
