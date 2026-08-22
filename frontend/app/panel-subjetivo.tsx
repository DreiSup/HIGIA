"use client";

/**
 * El panel del día: los tres números 0-10 y la nota. La única pieza de la app
 * que ESCRIBE (paso 2, D18).
 *
 * 🔑 Un SOLO componente para los dos sitios donde se registra —Hoy y el día
 *    seleccionado del calendario—. Dos formularios sobre la misma tabla
 *    divergen: uno gana un campo, el otro no, y acaban guardando cosas
 *    distintas.
 *
 * Diseño: "Higia Panel subjetivo.dc.html" (Claude Design, proyecto f5288ae1).
 */

import { useRef, useState } from "react";
import { guardarSubjetivo, type DiaCompleto, type Subjetivo } from "@/lib/api";
import { diaYMes, fechaLarga, hora } from "@/lib/formato";

const CAMPOS = [
  { campo: "como_me_siento", nombre: "Cómo me siento" },
  { campo: "animo", nombre: "Ánimo" },
  { campo: "energia", nombre: "Energía" },
] as const;

type Campo = (typeof CAMPOS)[number]["campo"];

/** Lo que el panel necesita de un día. Los nombres son los de ESCRITURA. */
export type EntradaSubjetivo = {
  como_me_siento: number | null;
  animo: number | null;
  energia: number | null;
  nota: string | null;
  registrado_en: string | null;
};

export const SIN_REGISTRO: EntradaSubjetivo = {
  como_me_siento: null, animo: null, energia: null,
  nota: null, registrado_en: null,
};

/** 🔴 La ÚNICA traducción entre cómo se lee un día y cómo se escribe.
 *
 *  Los nombres no coinciden y es a propósito: la nota es `nota_dia` al leer y
 *  `nota` al escribir; la marca es `subjetivo_registrado_en` al leer y
 *  `registrado_en` al escribir. Si esta traducción viviera en cada pantalla,
 *  una de las dos se olvidaría de un campo.
 *
 *  ⚠️ Un día sin nada no llega como fila de nulos: llega como objeto casi
 *     vacío, sin esos campos. Ausente y `null` significan lo mismo —ese día no
 *     se preguntó— y aquí se colapsan en `null` de una vez. */
export function subjetivoDeDia(d: DiaCompleto | null | undefined): EntradaSubjetivo {
  return {
    como_me_siento: d?.como_me_siento ?? null,
    animo: d?.animo ?? null,
    energia: d?.energia ?? null,
    nota: d?.nota_dia ?? null,
    registrado_en: d?.subjetivo_registrado_en ?? null,
  };
}

/** Días enteros entre dos fechas AAAA-MM-DD, sin pasar por UTC. */
function diasEntre(desde: string, hasta: string): number {
  const [a1, m1, d1] = desde.split("-").map(Number);
  const [a2, m2, d2] = hasta.split("-").map(Number);
  const uno = new Date(a1, m1 - 1, d1).getTime();
  const dos = new Date(a2, m2 - 1, d2).getTime();
  return Math.round((dos - uno) / 86_400_000);
}

export function PanelSubjetivo({ fecha, hoy, inicial, onGuardado }: {
  fecha: string;
  hoy: string;
  inicial: EntradaSubjetivo;
  /** Para que la pantalla anfitriona refresque lo suyo —el contador de Hoy, las
   *  señales de la rejilla— sin tocar lo que ya enseña este panel. */
  onGuardado?: (fila: Subjetivo) => void;
}) {
  // Lo que devolvió el último PUT manda sobre lo que trajo la lectura: es la
  // fila que está de verdad en la base, `registrado_en` incluido.
  const [guardado, setGuardado] = useState<Subjetivo | null>(null);
  const [edicion, setEdicion] = useState<Partial<Record<Campo, number>>>({});
  const [notaBorrador, setNotaBorrador] = useState<string | null>(null);
  const [notaDesplegada, setNotaDesplegada] = useState(false);
  const [estado, setEstado] = useState<"idle" | "guardando" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const arrastrando = useRef(false);

  const base: EntradaSubjetivo = guardado
    ? {
        como_me_siento: guardado.como_me_siento, animo: guardado.animo,
        energia: guardado.energia, nota: guardado.nota,
        registrado_en: guardado.registrado_en,
      }
    : inicial;

  const guardando = estado === "guardando";
  const esError = estado === "error";
  const esHoy = fecha === hoy;
  const esFuturo = diasEntre(hoy, fecha) > 0;
  const diasTarde = diasEntre(fecha, hoy);

  const valor = (c: Campo): number | null => edicion[c] ?? base[c];
  const valores = CAMPOS.map((c) => valor(c.campo));
  const algunValor = valores.some((v) => v != null);
  const todos = valores.every((v) => v != null);
  const registrado = base.registrado_en != null && algunValor;

  const notaTexto = notaBorrador ?? base.nota ?? "";
  // ⚠️ `notaBorrador !== null` = ya se ha tocado. Sin esa condición, borrar el
  //    texto cerraría el campo de golpe mientras se escribe —y el aviso de que
  //    una nota guardada no se puede vaciar no llegaría a verse nunca.
  const notaAbierta = !esFuturo
    && (notaDesplegada || notaBorrador !== null || notaTexto !== "");
  // 🔴 Vaciar una nota guardada NO la borra: el backend hace `coalesce`, así que
  //    mandar `null` deja la anterior. Se avisa en vez de fingir que se borra.
  const notaSeQueda = !!base.nota && notaTexto.trim() === "";

  function fijar(c: Campo, n: number) {
    if (guardando) return;
    setEdicion((e) => ({ ...e, [c]: n }));
  }

  function indiceDesde(e: React.PointerEvent<HTMLDivElement>): number {
    const r = e.currentTarget.getBoundingClientRect();
    const bruto = Math.floor(((e.clientX - r.left) / r.width) * 11);
    return Math.max(0, Math.min(10, bruto));
  }

  async function guardar() {
    setEstado("guardando");
    setError(null);
    try {
      const fila = await guardarSubjetivo({
        fecha,
        como_me_siento: valor("como_me_siento"),
        animo: valor("animo"),
        energia: valor("energia"),
        // Lo que no se envía se queda como estaba. Una nota vacía no borra nada.
        nota: notaTexto.trim() || null,
      });
      setGuardado(fila);
      setEdicion({});
      setNotaBorrador(null);
      setEstado("idle");
      onGuardado?.(fila);
    } catch (e) {
      setEstado("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // ── La pastilla ────────────────────────────────────────────────────────────
  //
  // 🔴 Los dos relojes son distintos y confundirlos rompe la regla 4:
  //
  //    · Lo YA REGISTRADO se mide con `registrado_en`, que es cuándo se escribió
  //      de verdad. Medirlo contra hoy convertiría en "recuerdo" cualquier día
  //      puntuado a su hora, con solo dejar pasar una noche.
  //    · Lo que TODAVÍA no se ha escrito se mide contra hoy, porque es un aviso
  //      de lo que va a pasar si se guarda: elegir el 12 de agosto pinta la
  //      píldora al instante, antes de marcar un solo número.
  let pastilla = "";
  if (registrado) {
    const diaEscrito = base.registrado_en!.slice(0, 10);
    const tarde = diasEntre(fecha, diaEscrito);
    if (tarde > 0) {
      pastilla = `Registrado ${tarde} ${tarde === 1 ? "día" : "días"}`
        + ` después, el ${diaYMes(diaEscrito)}`;
    } else {
      pastilla = (diaEscrito === hoy ? "Registrado hoy" : "Registrado el mismo día")
        + ` a las ${hora(base.registrado_en)}`;
    }
  } else if (!esFuturo && diasTarde > 0) {
    pastilla = `Registro retroactivo · ${diasTarde}`
      + ` ${diasTarde === 1 ? "día" : "días"} después`;
  }

  let textoBoton: string;
  let claseBoton = "boton-guardar";
  let bloqueado = false;
  if (esError) {
    textoBoton = "Reintentar";
    claseBoton += " fallo";
  } else if (guardando) {
    textoBoton = "Guardando…";
    claseBoton += " latiendo";
    bloqueado = true;
  } else {
    textoBoton = (registrado ? "Actualizar" : "Guardar")
      + (esHoy ? " hoy" : ` el ${diaYMes(fecha)}`);
    bloqueado = !algunValor;
  }

  let regla = "Se puede corregir un número; no se puede vaciar.";
  if (!algunValor) regla = "Guardar es explícito: nada se envía hasta que lo pulses.";
  else if (!todos) {
    regla = "Puedes guardar con carriles a medias. Lo que no envíes se queda"
      + " como estaba: corregir sí, vaciar no.";
  }

  return (
    <div className="tarjeta panel-subjetivo">

      <div className="panel-subjetivo-cabecera">
        <div className="rotulo">
          <span className="rotulo-punto" style={{ background: "var(--c-subjetivo)" }} />
          {/* Solo hoy y sin registrar es una pregunta; en cualquier otro día
              "cómo me ha ido hoy" sería mentira, y en pasado ya es una lectura. */}
          {esHoy && !registrado ? "Cómo me ha ido hoy" : "Cómo me fue"}
        </div>
        <span className="nota-fina">
          {esHoy ? `Hoy · ${diaYMes(fecha)}` : fechaLarga(fecha)}
        </span>
      </div>

      {!!pastilla && (
        <span className="pastilla-retro"><span />{pastilla}</span>
      )}

      {/* 🔴 Un día futuro no dibuja carriles apagados: no dibuja carriles. Un
          carril desactivado invitaría a tocarlo. */}
      {esFuturo ? (
        <div className="vacio">
          <span className="vacio-titulo">
            El {diaYMes(fecha)} todavía no ha pasado
          </span>
          <span className="vacio-texto">
            No hay nada que registrar en un día que no ha pasado. Los días
            futuros tampoco se pueden seleccionar en la rejilla del mes.
          </span>
        </div>
      ) : (
        <>
          <div className="pila" style={{ gap: 14 }}>
            {CAMPOS.map((c) => {
              const v = valor(c.campo);
              const vacio = v == null;
              return (
                <div key={c.campo} className="carril-subjetivo">
                  <div className="escala-cabecera">
                    <span className={"escala-nombre" + (vacio ? " hueca" : "")}>
                      {c.nombre}
                    </span>
                    <span>
                      <span className={"escala-valor" + (vacio ? " hueca" : "")}>
                        {vacio ? "—" : v}
                      </span>{" "}
                      <span className="nota-fina">
                        {vacio ? "sin registrar" : "/ 10"}
                      </span>
                    </span>
                  </div>

                  {/* El carril entero responde al arrastre: se apoya el pulgar y
                      se desliza hasta el número. Las once casillas siguen
                      siendo pulsables una a una. */}
                  <div
                    className={"escala-puntos" + (vacio ? " sin-marcar" : "")
                      + (guardando ? " bloqueado" : "")}
                    onPointerDown={(e) => {
                      if (guardando) return;
                      // Sin capturar el puntero, al salirse del carril deja de
                      // llegar `pointermove` y el gesto muere a media escala.
                      e.currentTarget.setPointerCapture(e.pointerId);
                      arrastrando.current = true;
                      fijar(c.campo, indiceDesde(e));
                    }}
                    onPointerMove={(e) => {
                      if (arrastrando.current) fijar(c.campo, indiceDesde(e));
                    }}
                    onPointerUp={() => { arrastrando.current = false; }}
                    onPointerCancel={() => { arrastrando.current = false; }}
                  >
                    {Array.from({ length: 11 }, (_, i) => (
                      <button key={i} type="button" disabled={guardando}
                              className={"punto-escala" + (v === i ? " elegido" : "")}
                              aria-label={`${c.nombre}: ${i} de 10`}
                              onClick={() => fijar(c.campo, i)}>
                        {i}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {!todos && (
            <span className="nota-fina">
              Un carril vacío no es un 0: es que no lo he dicho.
            </span>
          )}

          {!notaAbierta ? (
            <button type="button" className="boton boton-secundario nota-cerrada"
                    onClick={() => setNotaDesplegada(true)}>
              Añadir nota del día
            </button>
          ) : (
            <div className="pila" style={{ gap: 7 }}>
              <span className="nota-menor">Nota del día</span>
              <textarea className="campo-nota" value={notaTexto}
                        disabled={guardando}
                        placeholder="Opcional. Qué ha pasado hoy."
                        onChange={(e) => setNotaBorrador(e.target.value)} />
              {notaSeQueda && (
                <span className="nota-fina">
                  Una nota guardada no se puede vaciar desde aquí: si la dejas en
                  blanco se queda la anterior.
                </span>
              )}
            </div>
          )}

          {/* 🔴 "No se pudo guardar" no puede parecerse a "guardado": ruta,
              error literal, y lo escrito sigue en pantalla. */}
          {esError && (
            <div className="fallo-guardar">
              <div className="error-etiqueta"><span /> No se pudo guardar</div>
              <div className="mono-error">
                PUT /dia-subjetivo<br />{error}
              </div>
              <span className="nota-menor">
                Lo escrito sigue aquí. No se ha perdido nada.
              </span>
            </div>
          )}

          <div className="pila" style={{ gap: 9 }}>
            <button type="button" className={claseBoton}
                    disabled={bloqueado} onClick={guardar}>
              {textoBoton}
            </button>
            <span className="nota-fina">{regla}</span>
          </div>
        </>
      )}

    </div>
  );
}
