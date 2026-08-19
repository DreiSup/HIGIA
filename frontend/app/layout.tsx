import type { Metadata } from "next";
import localFont from "next/font/local";
import Marco from "./marco";
import "./globales.css";

// El diseño pide Inter, y aquí va **guardada en el repo** (48 KB, subconjunto
// latino, variable 400-700). Dos razones:
//   · La app tiene que funcionar con el portátil sin red. Una fuente que se
//     descarga de Google convierte una pantalla local en una que depende de
//     estar conectado.
//   · `next/font/google` no resuelve dentro del contenedor: turbopack falla con
//     "Can't resolve '@vercel/turbopack-next/internal/font/google/font'".
const inter = localFont({
  src: "./fuentes/inter-latin.woff2",
  weight: "400 700",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Higía",
  description: "Registro diario de salud. Uso individual.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={inter.className}>
      <body><Marco>{children}</Marco></body>
    </html>
  );
}
