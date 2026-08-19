"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/** Las pestañas, en el orden en que se leen: primero lo que se hace a diario,
 *  luego lo que se consulta.
 *
 * 🔑 Aquí solo van pantallas que EXISTEN. Hubo un momento con pestañas «Sueño»
 *    y «Corazón» apuntando a rutas sin código: una pestaña que da 404 promete
 *    una pieza que nadie ha decidido construir. Cuando se decidan, se añaden. */
const PESTANAS = [
  { ruta: "/", nombre: "Hoy" },
  { ruta: "/calendario", nombre: "Calendario" },
];

type Tema = "oscuro" | "claro";

/** El marco de la app: barra lateral en escritorio, barra de pestañas en móvil.
 *
 * 🔑 Es lo ÚNICO que se hidrata del armazón. El resto del layout es servidor.
 *    Si el marco entero fuera cliente, cada navegación remontaría la app.
 *
 * 🔴 El tema arranca como `null` y solo se resuelve tras montar. Un script que
 *    lo adivinara antes de pintar es exactamente lo que rompía la hidratación
 *    en la primera versión: el servidor no puede saber qué tema toca. Mientras
 *    tanto el primer pintado ya sale bien porque el CSS lo resuelve con
 *    `prefers-color-scheme` sin ayuda de nadie. */
export default function Marco({ children }: { children: React.ReactNode }) {
  const ruta = usePathname();
  const [tema, setTema] = useState<Tema | null>(null);

  useEffect(() => {
    const guardado = localStorage.getItem("higia-tema");
    if (guardado === "claro" || guardado === "oscuro") {
      setTema(guardado);
      document.documentElement.dataset.tema = guardado;
      return;
    }
    setTema(window.matchMedia("(prefers-color-scheme: light)").matches
      ? "claro" : "oscuro");
  }, []);

  function alternarTema() {
    const nuevo: Tema = tema === "claro" ? "oscuro" : "claro";
    setTema(nuevo);
    localStorage.setItem("higia-tema", nuevo);
    document.documentElement.dataset.tema = nuevo;
  }

  const activa = (r: string) => r === "/" ? ruta === "/" : ruta.startsWith(r);

  return (
    <div className="marco">
      <nav className="barra-lateral">
        <div className="marca-lateral">Higía</div>
        <div className="pestanas">
          {PESTANAS.map((p) => (
            <Link key={p.ruta} href={p.ruta}
                  className={"pestana" + (activa(p.ruta) ? " activa" : "")}>
              {p.nombre}
            </Link>
          ))}
        </div>
        <button className="boton-pildora tema-lateral" onClick={alternarTema}>
          {tema === "claro" ? "Tema oscuro" : "Tema claro"}
        </button>
      </nav>

      <main className="contenido">{children}</main>

      <nav className="barra-pestanas">
        {PESTANAS.map((p) => (
          <Link key={p.ruta} href={p.ruta}
                className={"pestana-movil" + (activa(p.ruta) ? " activa" : "")}>
            {p.nombre}
          </Link>
        ))}
      </nav>
    </div>
  );
}
