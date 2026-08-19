"use client";

import Link from "next/link";
import {
  traerDia, traerDias, traerNoches, traerSemanas,
  type DiaCompleto, type Noche, type Semana,
} from "@/lib/api";
import {
  DIAS_CORTOS, HUECO, denominador, duracion, fechaCorta, fechaLarga, hoyLocal,
  num, plural, sumarDias,
} from "@/lib/formato";
import { Cargando, Cifra, ErrorBloque, usar, type Estado } from "./piezas";

/** Los cuatro tipos de registro. Mismo orden, misma letra y mismo color que en
 *  la rejilla del calendario: si cambiaran de sitio a sitio habría que leer la
 *  leyenda cada vez. */
const TIPOS = [
  { letra: "S", nombre: "Subjetivo", clase: "c-subjetivo" },
  { letra: "C", nombre: "Comidas", clase: "c-comidas" },
  { letra: "T", nombre: "Consumos", clase: "c-consumos" },
  { letra: "P", nombre: "Pulsera", clase: "c-pulsera" },
] as const;

/** El lunes de la semana de `fecha`. La semana empieza en lunes, como en la
 *  rejilla y como en `/salud/semanas` (`semana_inicio` es siempre un lunes). */
function lunesDe(fecha: string): string {
  const [a, m, d] = fecha.split("-").map(Number);
  return sumarDias(fecha, -((new Date(a, m - 1, d).getDay() + 6) % 7));
}

export default function Hoy() {
  const hoy = hoyLocal();
  const lunes = lunesDe(hoy);
  const domingo = sumarDias(lunes, 6);

  const [dia, recargarDia] = usar(() => traerDia(hoy), [hoy]);
  const [semana, recargarSemana] = usar(() => traerSemanas(1), []);
  const [dias, recargarDias] = usar(() => traerDias(lunes, domingo), [lunes, domingo]);
  const [noches, recargarNoches] = usar(() => traerNoches(1), []);

  function recargarTodo() {
    recargarDia(); recargarSemana(); recargarDias(); recargarNoches();
  }

  return (
    <div className="pagina">
      <div className="columna">

        <div className="cabecera-vista">
          <div>
            <div className="kicker">Higía · Hoy</div>
            <h1>{fechaLarga(hoy)}</h1>
            <div className="subtitulo">
              Lo diario ya se ve en Google Health. Lo que aporta Higía es qué te
              falta de hoy y cómo va la semana.
            </div>
          </div>
          <div className="ruta">
            GET /dia/{hoy}<br />GET /salud/semanas
          </div>
        </div>

        <QueFalta dia={dia} recargar={recargarDia} hoy={hoy} />

        <div className="par">
          <UltimaNoche noches={noches} hoy={hoy} recargar={recargarNoches} />
          <ComoEstoy dia={dia} />
        </div>

        <LaSemana semana={semana} dias={dias} lunes={lunes} domingo={domingo}
                  recargar={() => { recargarSemana(); recargarDias(); }} />

        {(dia.error || semana.error || dias.error || noches.error) && (
          <button className="boton" onClick={recargarTodo}>Reintentar todo</button>
        )}

      </div>
    </div>
  );
}

// ── Bloque 1 · ¿Qué me falta por registrar hoy? ───────────────────────────────

function QueFalta({ dia, recargar, hoy }: {
  dia: Estado<DiaCompleto>; recargar: () => void; hoy: string;
}) {
  if (dia.cargando) return <Cargando alto={190} />;
  if (dia.error) {
    return <ErrorBloque que="el día de hoy" ruta={`GET /dia/${hoy}`}
                        error={dia.error} recargar={recargar} />;
  }
  const d = dia.dato!;

  const haySubjetivo = d.como_me_siento != null || d.animo != null ||
    d.energia != null || d.nota_dia != null;
  const hayComidas = (d.comidas ?? 0) > 0;
  const hayConsumos = (d.consumos?.length ?? 0) > 0;
  const hayPulsera = d.minutos_dormido != null || d.pasos != null ||
    d.pulsaciones_media != null;

  const detalles: Record<string, { hay: boolean; estado: string; detalle: string }> = {
    S: {
      hay: haySubjetivo,
      estado: haySubjetivo ? "Registrado" : "Falta",
      detalle: haySubjetivo
        ? [d.como_me_siento, d.animo, d.energia].map((n) => n ?? HUECO).join(" · ")
        : "Tres números 0-10, unos segundos",
    },
    C: {
      hay: hayComidas,
      estado: hayComidas ? plural(d.comidas!, "comida") : "Falta",
      detalle: hayComidas
        ? `${num(d.kcal_consumidas, 0)} kcal calculadas de los ingredientes`
        : "Repetir una frecuente es un toque",
    },
    T: {
      hay: hayConsumos,
      estado: hayConsumos ? plural(d.consumos!.length, "toma") : "Falta",
      detalle: hayConsumos
        ? "Café, nicotina, suplementos"
        : "La hora es parte del dato",
    },
    P: {
      hay: hayPulsera,
      estado: hayPulsera ? "Sincronizado" : "Sin lectura",
      // 🔑 La pulsera no depende del usuario: no es una tarea pendiente suya.
      detalle: hayPulsera
        ? `${num(d.pasos, 0)} pasos`
        : "Entra por un export manual de Takeout",
    },
  };

  const faltan = TIPOS.filter((t) => !detalles[t.letra].hay);
  // La pulsera no cuenta como tarea: no se registra a mano.
  const pendientes = faltan.filter((t) => t.letra !== "P").length;

  return (
    <div className="tarjeta">
      <div className="tarjeta-cabecera">
        <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-.01em" }}>
          {pendientes === 0 ? "Hoy está registrado" : "¿Qué te falta de hoy?"}
        </span>
        <span className="nota-menor">
          {pendientes === 0
            ? "Nada pendiente"
            : `Faltan ${pendientes} de 3 · la pulsera no depende de ti`}
        </span>
      </div>

      <div className="senales-hoy">
        {TIPOS.map((t) => {
          const info = detalles[t.letra];
          return (
            <div key={t.letra}
                 className={"senal-caja" + (info.hay ? " presente" : "")}>
              <div className="senal-caja-cabecera">
                <span className={"senal-letra " + t.clase}>{t.letra}</span>
                <span className="senal-nombre">{t.nombre}</span>
              </div>
              <div className="senal-estado">{info.estado}</div>
              <div className="nota-fina">{info.detalle}</div>
            </div>
          );
        })}
      </div>

      {/* 🔴 El botón NO dice "registrar": todavía no se puede. El calendario es
          de solo lectura hasta el paso 2, y un botón que promete escribir es la
          clase de mentira que este proyecto no se puede permitir. */}
      <div className="fila-accion">
        <Link className="boton-accion" href="/calendario">
          Abrir el día en el calendario
        </Link>
        <span className="nota-fina">
          Escribir llega con el panel del día · paso 2
        </span>
      </div>
    </div>
  );
}

// ── Bloque 2 · La última noche ────────────────────────────────────────────────

function UltimaNoche({ noches, hoy, recargar }: {
  noches: Estado<Noche[]>; hoy: string; recargar: () => void;
}) {
  if (noches.cargando) return <Cargando alto={220} />;
  if (noches.error) {
    return <ErrorBloque que="la última noche" ruta="GET /salud/sueno?limite=1"
                        error={noches.error} recargar={recargar} />;
  }

  const n = noches.dato?.[0];
  const ayer = sumarDias(hoy, -1);
  // 🔑 "Anoche" solo si la última noche registrada es de verdad la de ayer. Con
  //    el último export del 13 de agosto, llamar "anoche" a esa noche sería
  //    falso: se dice qué noche es y cuánto hace de ella.
  const esAnoche = n?.noche === ayer;

  return (
    <div className="tarjeta">
      <div className="rotulo">
        <span className="rotulo-punto" style={{ background: "var(--c-pulsera)" }} />
        {esAnoche ? "Cómo dormiste anoche" : "La última noche registrada"}
      </div>

      {!n ? (
        <div className="vacio">
          <span className="vacio-titulo">Ninguna noche registrada</span>
          <span className="vacio-texto">
            No es una noche de 0 horas: es que no hay ninguna noche en la base.
            Los datos de la pulsera entran por un export manual de Takeout.
          </span>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <span className="cifra-grande">{duracion(n.minutos_dormido)}</span>
            <span className="nota-menor">
              dormido · {duracion(n.minutos_en_cama)} en cama
            </span>
          </div>

          {!esAnoche && (
            <div className="aviso">
              Es la noche del {fechaCorta(n.noche)}, no la de anoche. Desde
              entonces no ha entrado ningún dato nuevo de la pulsera, y eso es un
              hueco, no un cero.
            </div>
          )}

          <div className="cifras">
            <Cifra etiqueta="Eficiencia"
                   valor={n.eficiencia == null ? null : `${n.eficiencia} %`} />
            <Cifra etiqueta="Despierto" valor={duracionONada(n.minutos_despierto)} />
            <Cifra etiqueta="Horario"
                   valor={`${n.hora_acostarse} → ${n.hora_levantarse}`} />
          </div>
        </>
      )}
    </div>
  );
}

const duracionONada = (m: number | null) => (m == null ? null : duracion(m));

// ── Bloque 3 · Cómo estoy hoy ─────────────────────────────────────────────────

function ComoEstoy({ dia }: { dia: Estado<DiaCompleto> }) {
  if (dia.cargando) return <Cargando alto={220} />;
  // El error ya lo cuenta el bloque de arriba, que usa la misma petición: no
  // hace falta repetir la tarjeta de error dos veces.
  if (dia.error) return null;
  const d = dia.dato!;

  const escalas = [
    { nombre: "Cómo me siento", valor: d.como_me_siento },
    { nombre: "Ánimo", valor: d.animo },
    { nombre: "Energía", valor: d.energia },
  ];
  const vacio = escalas.every((e) => e.valor == null);

  return (
    <div className="tarjeta">
      <div className="rotulo">
        <span className="rotulo-punto" style={{ background: "var(--c-subjetivo)" }} />
        Cómo estás hoy
      </div>

      <div className="pila">
        {escalas.map((e) => (
          <div key={e.nombre} className="escala-lectura">
            <div className="escala-cabecera">
              <span>{e.nombre}</span>
              <span className={"escala-valor" + (e.valor == null ? " hueca" : "")}>
                {e.valor == null ? "sin registrar" : `${e.valor} / 10`}
              </span>
            </div>
            <div className={"escala-barra" + (e.valor == null ? " hueca" : "")}>
              {e.valor != null && (
                <div className="escala-relleno" style={{ width: `${e.valor * 10}%` }} />
              )}
            </div>
          </div>
        ))}
      </div>

      {vacio && (
        <span className="nota-fina">
          Sin registrar. Un carril vacío no es un 0: el 0 es una respuesta y esto
          es la ausencia de respuesta.
        </span>
      )}

      {d.nota_dia && <div className="aviso">{d.nota_dia}</div>}
    </div>
  );
}

// ── Bloque 4 · Cómo va la semana ──────────────────────────────────────────────

function LaSemana({ semana, dias, lunes, domingo, recargar }: {
  semana: Estado<Semana[]>; dias: Estado<DiaCompleto[]>;
  lunes: string; domingo: string; recargar: () => void;
}) {
  if (semana.cargando || dias.cargando) return <Cargando alto={280} />;
  if (semana.error || dias.error) {
    return <ErrorBloque que="la semana"
                        ruta={semana.error ? "GET /salud/semanas"
                                           : `GET /dias?desde=${lunes}&hasta=${domingo}`}
                        error={(semana.error ?? dias.error)!} recargar={recargar} />;
  }

  // 🔑 `/salud/semanas` devuelve las semanas que TIENEN algo. Si la semana en
  //    curso no aparece, no se coge la anterior y se hace pasar por esta: se
  //    dice que esta semana no tiene nada todavía.
  const s = semana.dato!.find((x) => x.semana_inicio === lunes) ?? null;

  // El eje de siete días lo construye la pantalla. `/dias` solo devuelve los
  // días que existen: las fechas que falten son huecos reales.
  const porFecha = new Map((dias.dato ?? []).map((d) => [d.fecha, d]));
  const noches = Array.from({ length: 7 }, (_, i) => {
    const f = sumarDias(lunes, i);
    return { fecha: f, minutos: porFecha.get(f)?.minutos_dormido ?? null };
  });
  const conDato = noches.filter((n) => n.minutos != null).length;
  // Escala fija a 9 h: si el máximo lo pusiera la propia semana, una semana
  // mala se vería igual de alta que una buena.
  const TOPE = 9 * 60;

  return (
    <div className="tarjeta">
      <div className="tarjeta-cabecera">
        <div className="rotulo">Cómo va la semana</div>
        <span className="nota-menor">
          {fechaCorta(lunes)} → {fechaCorta(domingo)}
        </span>
      </div>

      {!s ? (
        <div className="vacio">
          <span className="vacio-titulo">Esta semana no tiene nada todavía</span>
          <span className="vacio-texto">
            No se enseñan las medias de la semana pasada en su lugar: serían las
            de otra semana.
          </span>
        </div>
      ) : (
        <div className="cifras">
          {/* 🔴 Cada media con SU denominador pegado debajo. Una media de 2
              noches y una de 7 no pueden parecer lo mismo. */}
          <Cifra etiqueta="Sueño medio" valor={valorODuracion(s.dormido_min_media)}
                 denominador={denominador(s.noches_con_dato, 7, "noches")} />
          <Cifra etiqueta="Pasos medios" valor={valorONulo(s.pasos_media)}
                 denominador={denominador(s.dias_con_dato, 7, "días con dato")} />
          <Cifra etiqueta="Kcal consumidas" valor={valorONulo(s.kcal_consumidas_media)}
                 denominador={denominador(s.dias_con_comida, 7, "días con comida")} />
          {/* 🔴 Va la última y separada de las consumidas: no se restan. */}
          <Cifra etiqueta="Kcal quemadas" valor={valorONulo(s.kcal_quemadas_media)}
                 denominador="estimación de la pulsera ±20-30 %" />
        </div>
      )}

      <div className="pila" style={{ gap: 8 }}>
        <span className="nota-menor">
          Sueño por noche · {conDato === 0
            ? "ninguna noche medida esta semana"
            : `${plural(conDato, "noche")} con dato de 7`}
        </span>
        <div className="barras-semana">
          {noches.map((n) => (
            <div key={n.fecha}
                 className={"barra-noche" + (n.minutos == null ? " hueca" : "")}
                 title={`${fechaCorta(n.fecha)} · ${n.minutos == null
                   ? "sin medir" : duracion(n.minutos)}`}
                 style={n.minutos == null ? undefined
                   : { height: `${Math.min((n.minutos / TOPE) * 100, 100)}%` }} />
          ))}
        </div>
        <div className="pie-semana">
          {DIAS_CORTOS.map((d) => <span key={d}>{d}</span>)}
        </div>
      </div>

      <span className="nota-fina">
        Cada barra es la noche que EMPIEZA ese día: la del sábado es la del
        sábado al domingo. Los días sin medir son carriles vacíos, no barras a 0.
      </span>
    </div>
  );
}

const valorONulo = (n: number | null) => (n == null ? null : num(n, 0));
const valorODuracion = (n: number | null) => (n == null ? null : duracion(n));
