"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Cada fuente de datos falla por su cuenta.
 *
 * 🔑 Si `/salud/semanas` cae pero `/dia` responde, se pinta el día y solo el
 *    bloque de la semana dice que no se pudo leer. Un `try` único alrededor de
 *    toda la pantalla la dejaría en blanco escondiendo lo que sí hay. */
export type Estado<T> = { dato: T | null; error: string | null; cargando: boolean };

const enCurso = <T,>(): Estado<T> => ({ dato: null, error: null, cargando: true });

/** Lee una fuente y devuelve su estado + cómo reintentarla.
 *
 * 🔴 En el `catch` NO se pone un valor por defecto. Devolver `[]` haría que la
 *    pantalla dijera "no hay nada registrado", que es una afirmación sobre los
 *    datos que nadie ha comprobado. El error viaja hasta la pantalla. */
export function usar<T>(
  traer: () => Promise<T>,
  deps: unknown[],
): [Estado<T>, () => void] {
  const [estado, setEstado] = useState<Estado<T>>(enCurso<T>);
  // Solo la petición MÁS RECIENTE puede escribir el estado.
  //
  // 🔴 El contador va en un `ref` y no en una variable de la función a propósito.
  //    Con una variable local, cada llamada solo puede anularse a sí misma: dos
  //    "Reintentar" seguidos se quedan los dos vivos y gana el que conteste
  //    último, que puede ser el primero que se lanzó. Aquí el segundo intento
  //    invalida al primero pase lo que pase, venga del efecto o del botón.
  const ultima = useRef(0);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const recargar = useCallback(() => {
    const mia = ++ultima.current;
    const vigente = () => mia === ultima.current;
    setEstado(enCurso<T>());
    traer()
      .then((dato) => { if (vigente()) setEstado({ dato, error: null, cargando: false }); })
      .catch((e) => {
        if (!vigente()) return;
        setEstado({
          dato: null, cargando: false,
          error: e instanceof Error ? e.message : String(e),
        });
      });
  }, deps);

  useEffect(() => {
    recargar();
    // Al desmontar (o al cambiar las dependencias) se invalida lo que esté en
    // vuelo: un mes anterior no puede pisar al que ya se está viendo.
    return () => { ultima.current++; };
  }, [recargar]);

  return [estado, recargar];
}

/** Fallo de UN bloque. Dice la ruta exacta y el error literal.
 *
 * 🔴 "No se pudo leer" y "no hay nada registrado" tienen que verse distinto.
 *    Por eso aquí no se pinta ningún hueco de relleno: un hueco significaría
 *    que se ha comprobado que no hay dato, y no se ha comprobado nada. */
export function ErrorBloque({ que, ruta, error, recargar }: {
  que: string; ruta: string; error: string; recargar: () => void;
}) {
  return (
    <div className="tarjeta">
      <div className="error-etiqueta"><span /> No se pudo leer {que}</div>
      <p className="vacio-texto">
        Esto no significa que no haya datos: significa que la API no ha
        contestado. No se dibujan huecos en su lugar, porque parecerían días sin
        registrar.
      </p>
      <div className="mono">{ruta}</div>
      <div className="mono-error">{error}</div>
      <button className="boton-error" onClick={recargar}>Reintentar</button>
    </div>
  );
}

/** Esqueleto que conserva la forma del bloque para que el contenido no salte
 *  de sitio cuando llegan los datos. */
export function Cargando({ alto, retraso = 0 }: { alto: number; retraso?: number }) {
  return (
    <div className="esqueleto"
         style={{ height: alto, animationDelay: `${retraso}s` }} />
  );
}

/** Una cifra pequeña con etiqueta y, si la lleva, su denominador.
 *
 * 🔑 `valor === null` se pinta "sin dato" con borde discontinuo, nunca "0". */
export function Cifra({ etiqueta, valor, denominador, unidad }: {
  etiqueta: string;
  valor: string | null;
  denominador?: string;
  unidad?: string;
}) {
  const hay = valor != null;
  return (
    <div className={"cifra" + (hay ? "" : " sin-dato")}>
      <span className="cifra-etiqueta">{etiqueta}</span>
      <span className="cifra-valor">
        {hay ? valor : "sin dato"}
        {hay && unidad && (
          <span style={{ fontSize: 12, color: "var(--texto-3)", fontWeight: 400 }}>
            {" "}{unidad}
          </span>
        )}
      </span>
      {denominador && <span className="denominador">{denominador}</span>}
    </div>
  );
}
