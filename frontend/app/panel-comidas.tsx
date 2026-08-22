"use client";

/**
 * Las comidas del día. Paso 4 (D18), y la tercera hermana de
 * `panel-subjetivo.tsx` y `panel-consumos.tsx`: mismo sitio, misma tarjeta,
 * mismo «—» para el hueco, mismo bloque de error.
 *
 * 🔑 REPETIR ES EL CAMINO PRINCIPAL, y por eso va arriba del todo, encima de lo
 *    ya registrado: si casi todo lo que se come ya se ha comido, la lista de
 *    frecuentes ES la pieza y el resto es consulta.
 *
 * 🔴 Y como en consumos, aquí se BORRA: no existe `PUT /comidas/{id}`.
 *    Comprobado contra la API, no supuesto. Pero borrar cuesta mucho más que
 *    allí —hay que volver a componer la comida entera, ingrediente a
 *    ingrediente— así que la confirmación lo dice.
 *
 * ⚠️ **Componer una comida nueva NO está.** El diseño lo dejaba esbozado y su
 *    salida natural, «añadir al catálogo», no existe en la API: no hay
 *    `POST /alimentos`. Un botón que abriera un formulario que no puede guardar
 *    sería exactamente la mentira que prohíbe D19, así que no se dibuja.
 *
 * Diseño: "Higia Comidas.dc.html" (Claude Design, proyecto f5288ae1).
 */

import { useState } from "react";
import {
  borrarComida, repetirComida, traerComida, traerFrecuentes,
  type ComidaDetalle, type ComidaResumen, type DiaCompleto, type Frecuente,
} from "@/lib/api";
import { HUECO, diaYMes, hora, num, plural } from "@/lib/formato";
import { usar } from "./piezas";

/** Días enteros entre dos fechas AAAA-MM-DD, sin pasar por UTC. */
function diasEntre(desde: string, hasta: string): number {
  const [a1, m1, d1] = desde.split("-").map(Number);
  const [a2, m2, d2] = hasta.split("-").map(Number);
  return Math.round(
    (new Date(a2, m2 - 1, d2).getTime() - new Date(a1, m1 - 1, d1).getTime()) / 86_400_000,
  );
}

/** El mismo orden que el resto de la app: por hora, y las que no la tienen al
 *  final. Lo repetido entra sin hora, así que aterriza abajo. */
function ordenar(cs: ComidaResumen[]): ComidaResumen[] {
  const instante = (c: ComidaResumen) => new Date(c.momento!).getTime();
  return [
    ...cs.filter((c) => c.momento).sort((a, b) => instante(a) - instante(b)),
    ...cs.filter((c) => !c.momento),
  ];
}

/** Una pastilla de macro: el número o el hueco, y el hueco se ve en el borde.
 *
 * 🔑 Discontinuo = no hay dato. Es el mismo vocabulario del carril vacío del
 *    subjetivo y de la toma sin hora de consumos, y aquí significa lo mismo. */
function Macro({ etiqueta, valor, unidad = "g" }: {
  etiqueta: string; valor: number | null; unidad?: string;
}) {
  // Un decimal solo cuando lo tiene: 118 g y 8,1 g, nunca "118,0 g".
  const texto = valor == null ? HUECO
    : `${num(valor, Number.isInteger(valor) ? 0 : 1)} ${unidad}`;
  return (
    <span className={"macro" + (valor == null ? " hueca" : "")}>
      {etiqueta} {texto}
    </span>
  );
}

/** 🔴 Lactosa y gluten tienen TRES estados, no dos: sí, no, y **no se sabe**.
 *
 *  Un `null` aquí no es un "no": es que ninguna de las comidas del día lo
 *  declara. Colapsarlo a "sin lactosa" sería afirmar algo sobre el cuerpo del
 *  usuario que nadie ha comprobado — y esto va justo a la pregunta que tiene
 *  abierta con su médico. */
function Aviso({ que, presente }: { que: string; presente: boolean | null | undefined }) {
  if (presente == null) {
    return <span className="macro hueca">{que}: no se sabe</span>;
  }
  return (
    <span className={"macro" + (presente ? " presente" : "")}>
      {presente ? que : `sin ${que}`}
    </span>
  );
}

export function PanelComidas({ fecha, hoy, dia, onCambio }: {
  fecha: string;
  hoy: string;
  /** El día ya leído. La pantalla anfitriona tiene prohibido pasar un día a
   *  medio cargar: `comidas_detalle: []` significa "no hay ninguna". */
  dia: DiaCompleto | null;
  onCambio?: () => void;
}) {
  const [frecuentes, recargarFrecuentes] = usar(() => traerFrecuentes(6), []);
  // Igual que en las otras dos piezas: en cuanto se escribe una vez manda lo
  // local, y se aplica SIEMPRE sobre el estado anterior. Repetir son dos
  // peticiones seguidas, así que la ventana para solaparse con un borrado es
  // aún más ancha que en consumos.
  const [lista, setLista] = useState<ComidaResumen[] | null>(null);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [detalles, setDetalles] = useState<Record<string, ComidaDetalle>>({});
  const [cargandoDetalle, setCargandoDetalle] = useState<string | null>(null);
  const [errorDetalle, setErrorDetalle] = useState<{ id: string; texto: string } | null>(null);
  const [repitiendo, setRepitiendo] = useState<string | null>(null);
  const [errorRepetir, setErrorRepetir] = useState<{ origen: string; texto: string } | null>(null);
  const [armada, setArmada] = useState<string | null>(null);
  const [borrando, setBorrando] = useState<string | null>(null);
  const [errorBorrar, setErrorBorrar] = useState<{ id: string; texto: string } | null>(null);

  const comidas = lista ?? dia?.comidas_detalle ?? [];
  const atrasado = diasEntre(fecha, hoy);
  const esFuturo = atrasado < 0;
  const esHoy = atrasado === 0;
  const conHora = comidas.filter((c) => c.momento);
  const sinHora = comidas.filter((c) => !c.momento);

  async function repetir(f: Frecuente) {
    setErrorRepetir(null);
    setArmada(null);
    setRepitiendo(f.ultimo_id);
    try {
      const { id } = await repetirComida(f.ultimo_id, fecha);
      try {
        // La fila nueva se lee entera para poder pintarla sin recargar. De paso
        // queda cacheada para cuando se despliegue.
        const nueva = await traerComida(id);
        setLista((prev) => ordenar([...(prev ?? dia?.comidas_detalle ?? []), nueva]));
        setDetalles((prev) => ({ ...prev, [id]: nueva }));
      } catch {
        // ⚠️ La comida SÍ se creó: fallar aquí no es "no se pudo repetir", y
        //    decirlo sería mentir en la dirección peligrosa —el usuario
        //    repetiría y tendría dos—. Se suelta lo local y manda el servidor.
        setLista(null);
      }
      recargarFrecuentes();
      onCambio?.();
    } catch (e) {
      setErrorRepetir({
        origen: f.ultimo_id,
        texto: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setRepitiendo(null);
    }
  }

  async function borrar(c: ComidaResumen) {
    setArmada(null);
    setErrorBorrar(null);
    setBorrando(c.id);
    try {
      await borrarComida(c.id);
      setLista((prev) => (prev ?? dia?.comidas_detalle ?? []).filter((x) => x.id !== c.id));
      recargarFrecuentes();
      onCambio?.();
    } catch (e) {
      // Incluido el 404: no se quita de la pantalla lo que no se quitó de la
      // base. Si desapareciera sola sería idéntica a un borrado con éxito.
      setErrorBorrar({ id: c.id, texto: e instanceof Error ? e.message : String(e) });
    } finally {
      setBorrando(null);
    }
  }

  async function alternar(c: ComidaResumen) {
    setArmada(null);
    if (abierta === c.id) { setAbierta(null); return; }
    setAbierta(c.id);
    if (detalles[c.id]) return;
    setErrorDetalle(null);
    setCargandoDetalle(c.id);
    try {
      const d = await traerComida(c.id);
      setDetalles((prev) => ({ ...prev, [c.id]: d }));
    } catch (e) {
      setErrorDetalle({ id: c.id, texto: e instanceof Error ? e.message : String(e) });
    } finally {
      setCargandoDetalle(null);
    }
  }

  function fila(c: ComidaResumen) {
    const h = hora(c.momento);
    const enVuelo = borrando === c.id;

    if (armada === c.id) {
      return (
        <div key={c.id} className="comida-registrada">
          <div className="consumo-fila-plana">
            <span className="consumo-pregunta">
              ¿Borrar «{c.descripcion.slice(0, 42)}
              {c.descripcion.length > 42 ? "…" : ""}»? No hay deshacer, y hay
              que volver a componerla entera.
            </span>
            <button type="button" className="boton-pildora" onClick={() => setArmada(null)}>
              Dejarla
            </button>
            <button type="button" className="boton-pildora boton-borrar-de-verdad"
                    onClick={() => borrar(c)}>
              Borrar
            </button>
          </div>
        </div>
      );
    }

    const d = detalles[c.id];
    return (
      <div key={c.id} className={"comida-registrada" + (enVuelo ? " en-vuelo" : "")}>
        <div className="comida-cabecera">
          <span className={"comida-hora" + (h ? "" : " sin-hora")}>{h ?? "sin hora"}</span>
          <div className="comida-texto">
            <span className="comida-desc">{c.descripcion}</span>
            <div className="comida-linea">
              <span className={"comida-kcal" + (c.kcal == null ? " hueca" : "")}>
                {c.kcal == null ? HUECO : num(c.kcal, 0)} kcal
              </span>
              {/* 🔑 El margen viaja PEGADO al número, no en un pie ni detrás de
                  un toque: los macros vienen de foto (±30-50 %) y esconder eso
                  convierte una estimación en una medida. */}
              <span className={"comida-margen" + (c.error_pct == null ? " sin-margen" : "")}>
                {c.error_pct == null ? "sin margen" : `±${num(c.error_pct, 1)} %`}
              </span>
            </div>
          </div>
          <div className="comida-acciones">
            {/* 🔑 Clase propia, no la de la ✕: el hover de la ✕ es rojo porque
                avisa de que borra, y desplegar los ingredientes no destruye
                nada. Dos botones idénticos con el mismo aviso enseñarían a
                ignorarlo. El selector de variación (U+FE0E) fuerza el triángulo
                a presentación de texto; sin él Chrome lo pinta con la fuente de
                emoji, en su color y no en el de la interfaz. */}
            <button type="button" className="boton-desplegar" disabled={enVuelo}
                    aria-label={(abierta === c.id ? "Cerrar" : "Ver") + " los ingredientes"}
                    onClick={() => alternar(c)}>
              {abierta === c.id ? "\u25B4\uFE0E" : "\u25BE\uFE0E"}
            </button>
            {/* Sin botón de corregir: no hay `PUT /comidas/{id}`. */}
            <button type="button" className="boton-armar" disabled={enVuelo}
                    aria-label="Borrar esta comida" onClick={() => setArmada(c.id)}>
              ✕
            </button>
          </div>
        </div>

        <div className="macros">
          <Macro etiqueta="P" valor={c.prot_g} />
          <Macro etiqueta="HC" valor={c.hc_g} />
          <Macro etiqueta="G" valor={c.grasa_g} />
          <Aviso que="lactosa" presente={c.lactosa} />
          <Aviso que="gluten" presente={c.gluten} />
        </div>

        {errorBorrar?.id === c.id && (
          <div className="fallo-guardar">
            <div className="error-etiqueta"><span /> No se pudo borrar</div>
            <div className="mono-error">
              DELETE /comidas/{c.id}<br />{errorBorrar.texto}
            </div>
            <div className="consumo-reintento">
              <span className="nota-menor">Sigue en la lista.</span>
              <button type="button" className="boton-pildora boton-error-fino"
                      onClick={() => { setErrorBorrar(null); setArmada(c.id); }}>
                Reintentar
              </button>
            </div>
          </div>
        )}

        {abierta === c.id && (
          <div className="ingredientes">
            <div className="ingredientes-cabecera">
              <span className="nota-menor" style={{ fontWeight: 700, letterSpacing: ".12em" }}>
                INGREDIENTES
              </span>
              <span className="mono-fina">GET /comidas/{c.id}</span>
            </div>

            {cargandoDetalle === c.id && (
              <span className="nota-fina">Leyendo los ingredientes…</span>
            )}
            {errorDetalle?.id === c.id && (
              <div className="mono-error">{errorDetalle.texto}</div>
            )}

            {d?.items.map((i) => (
              <div key={i.alimento_id + i.cantidad_g} className="ingrediente">
                <span className={"ingrediente-cantidad" + (i.cantidad_g == null ? " hueca" : "")}>
                  {i.cantidad_g == null ? HUECO : `${num(i.cantidad_g, 0)} g`}
                </span>
                <div className="ingrediente-texto">
                  <span className="ingrediente-nombre">{i.nombre}</span>
                  <span className={"ingrediente-marca" + (i.marca ? "" : " sin-marca")}>
                    {i.marca ?? "sin marca"}
                  </span>
                </div>
                <div className="ingrediente-derecha">
                  {/* 🔑 De dónde sale la cantidad, tal cual la guarda la base:
                      `envase` es lo que viene contado y `estimado`/`pesado` no.
                      Es lo que explica el margen de la comida entera. */}
                  <span className={"ingrediente-origen"
                    + (i.origen_cantidad === "envase" ? " contado" : "")}>
                    {i.origen_cantidad}
                    {i.incertidumbre_pct == null ? "" : ` ±${num(i.incertidumbre_pct, 0)} %`}
                  </span>
                  <span className="nota-fina">
                    {i.kcal == null ? HUECO : `${num(i.kcal, 0)} kcal`}
                  </span>
                </div>
              </div>
            ))}

            {!!d && (
              <span className="nota-fina">
                {d.metodo ? `Método: ${d.metodo}. ` : ""}
                Los macros de arriba se recalculan desde estos ingredientes: no
                se guardan como total (D15).
              </span>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="tarjeta panel-comidas">

      <div className="panel-subjetivo-cabecera">
        <div className="rotulo">
          <span className="rotulo-punto" style={{ background: "var(--c-comidas)" }} />
          Comidas
        </div>
        <span className={comidas.length ? "nota-menor" : "nota-fina"}>
          {esFuturo ? diaYMes(fecha)
            : comidas.length === 0 ? "ninguna" : plural(comidas.length, "comida")}
        </span>
      </div>

      {esFuturo ? (
        <div className="vacio">
          <span className="vacio-titulo">El {diaYMes(fecha)} todavía no ha pasado</span>
          <span className="vacio-texto">
            No se apunta lo que no se ha comido. Los días futuros tampoco se
            pueden seleccionar en la rejilla del mes.
          </span>
        </div>
      ) : (
        <>
          {comidas.length > 0 && !!dia && (
            <div className="resumen-comidas">
              <div className="comida-linea">
                <span className="resumen-kcal">
                  {dia.kcal_consumidas == null ? HUECO : num(dia.kcal_consumidas, 0)}
                </span>
                <span className="nota-menor">kcal</span>
                {/* 🔴 `error_pct` viene por comida pero NO en el resumen del
                    día. Se dice que no lo hay en vez de multiplicar los de cada
                    comida: un agregado inventado por la interfaz se citaría
                    dentro de seis meses como si fuera una medida. */}
                <span className="comida-margen sin-margen">sin margen declarado</span>
              </div>
              <div className="macros">
                <Macro etiqueta="P" valor={dia.prot_g} />
                <Macro etiqueta="HC" valor={dia.hc_g} />
                <Macro etiqueta="G" valor={dia.grasa_g} />
                <Macro etiqueta="Sat" valor={dia.sat_g} />
                <Macro etiqueta="Fibra" valor={dia.fibra_g} />
                <Macro etiqueta="Sal" valor={dia.sal_g} />
              </div>
              <div className="macros">
                <Aviso que="lactosa" presente={dia.algo_con_lactosa} />
                <Aviso que="gluten" presente={dia.algo_con_gluten} />
              </div>
              <span className="nota-fina">
                Los macros vienen de foto: ±30-50 % y sesgados a la baja. El
                margen de cada comida viaja con ella y no se esconde para que el
                total quede limpio.
              </span>
            </div>
          )}

          <div className="pila" style={{ gap: 9 }}>
            <div className="panel-subjetivo-cabecera">
              <span className="nota-menor" style={{ fontWeight: 600 }}>
                Repetir una de siempre
              </span>
              <span className="mono-fina">
                {/* ⚠️ "devolvió []" solo se puede decir cuando de verdad ha
                    devuelto []. Mientras carga no se afirma nada. */}
                {frecuentes.cargando ? "GET /comidas/frecuentes…"
                  : frecuentes.error ? "no se pudo leer"
                  : frecuentes.dato?.length ? "GET /comidas/frecuentes"
                  : "devolvió []"}
              </span>
            </div>

            {frecuentes.cargando && <span className="nota-fina">Leyendo las de siempre…</span>}

            {!!frecuentes.error && (
              <div className="fallo-guardar">
                <div className="error-etiqueta"><span /> No se pudieron leer</div>
                <div className="mono-error">
                  GET /comidas/frecuentes<br />{frecuentes.error}
                </div>
                <button type="button"
                        className="boton-pildora boton-error-fino boton-en-linea"
                        onClick={recargarFrecuentes}>
                  Reintentar
                </button>
              </div>
            )}

            {frecuentes.dato?.map((f) => (
              <div key={f.ultimo_id} className="frecuente">
                <div className="frecuente-texto">
                  <span className="frecuente-desc">{f.descripcion}</span>
                  <span className="frecuente-meta">
                    {plural(f.veces, "vez", "veces")} · última {diaYMes(f.ultima)}
                    {/* "aquel día", no "~": es un dato histórico de aquella vez,
                        no una promesa de lo que va a salir esta. */}
                    {f.kcal_tipicas == null ? "" : ` · aquel día ${num(f.kcal_tipicas, 0)} kcal`}
                  </span>
                </div>
                <button type="button" className="boton-repetir"
                        disabled={repitiendo != null} onClick={() => repetir(f)}>
                  {repitiendo === f.ultimo_id ? "Repitiendo…" : "Repetir"}
                </button>
              </div>
            ))}

            {!frecuentes.cargando && !frecuentes.error && frecuentes.dato?.length === 0 && (
              <div className="vacio vacio-fino">
                <span className="vacio-titulo" style={{ fontSize: 13 }}>
                  Todavía no hay ninguna de siempre
                </span>
                <span className="vacio-texto">
                  La lista sale de lo ya registrado: cada comida aparece aquí en
                  cuanto existe, para repetirla en un toque.
                </span>
              </div>
            )}
          </div>

          {!!errorRepetir && (
            <div className="fallo-guardar">
              <div className="error-etiqueta"><span /> No se pudo repetir</div>
              {/* ⚠️ Repetir son DOS peticiones —leer la original y crear la
                  nueva— así que se nombran las dos. Escribir solo
                  "POST /comidas" señalaría a la equivocada cuando lo que se cae
                  es la lectura, y con la red caída el error literal ni siquiera
                  trae ruta: "Failed to fetch" a secas. */}
              <div className="mono-error">
                GET /comidas/{errorRepetir.origen} → POST /comidas
                <br />{errorRepetir.texto}
              </div>
              <span className="nota-menor">
                No se ha creado ninguna comida. La de siempre sigue en la lista
                de arriba.
              </span>
              <button type="button" className="boton-error boton-en-linea"
                      onClick={() => {
                        const f = frecuentes.dato?.find((x) => x.ultimo_id === errorRepetir.origen);
                        if (f) repetir(f);
                      }}>
                Reintentar
              </button>
            </div>
          )}

          {comidas.length > 0 ? (
            <div className="pila" style={{ gap: 8 }}>
              <span className="nota-menor" style={{ fontWeight: 600 }}>
                {sinHora.length && conHora.length
                  ? "Registradas · las sin hora al final"
                  : "Registradas este día"}
              </span>
              {conHora.map(fila)}
              {sinHora.map(fila)}
            </div>
          ) : (
            <div className="vacio vacio-fino">
              <span className="vacio-titulo" style={{ fontSize: 13 }}>
                {esHoy ? "Ninguna comida hoy" : "Ninguna comida ese día"}
              </span>
              <span className="vacio-texto">
                La API devolvió una lista vacía: no hay ninguna. No es que no se
                haya podido leer.
              </span>
            </div>
          )}

          <span className="nota-fina">
            {esHoy
              ? "Repetir copia los ingredientes, no los totales: si el catálogo"
                + " ha cambiado, las kcal pueden salir distintas (D15). Una"
                + " comida no se edita — se borra y se vuelve a componer."
              : `Aquí no hay «ahora»: lo que se repita entra sin hora. Nunca se`
                + ` apunta una que no cuadre con el ${diaYMes(fecha)}.`}
          </span>

          {/* Se dice lo que falta, sin dibujar un botón que no podría cumplir. */}
          <span className="nota-fina">
            Componer una comida nueva todavía no se puede desde aquí: falta el
            endpoint para añadir alimentos al catálogo.
          </span>
        </>
      )}

    </div>
  );
}
