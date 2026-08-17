import type { Metadata } from "next";
import "./globales.css";

export const metadata: Metadata = {
  title: "Higía",
  description: "Registro diario de salud. Uso individual.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
