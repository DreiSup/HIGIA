#!/usr/bin/env python3
"""
Inspector de exportaciones de Google Takeout (Fitbit / Google Health).

NO analiza datos: describe su ESTRUCTURA. Responde a "¿qué forma tienen estos datos?",
que es lo que hace falta para decidir el modelo de base de datos.

Uso:
    python3 inspeccionar_takeout.py <ruta-al-zip-o-carpeta>
    python3 inspeccionar_takeout.py takeout.zip --detalle   # muestra una muestra por fichero

Funciona sobre el ZIP directamente, sin descomprimir.
"""
import sys, os, json, csv, zipfile, io, re
from collections import defaultdict, Counter

# Takeout mezcla formatos: ISO (2026-08-12) y el americano MM/DD/AA (08/12/26).
# Hay que cubrir los dos o los ficheros intradía parecen no tener fechas.
FECHA_ISO = re.compile(r'(20\d{2})-(\d{2})-(\d{2})')
FECHA_US = re.compile(r'\b(\d{2})/(\d{2})/(\d{2})\b')


def humano(n):
    for u in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.0f} {u}"
        n /= 1024
    return f"{n:.1f} TB"


def abrir(ruta):
    """Devuelve [(nombre_relativo, tamaño, funcion_lectora_bytes)]."""
    if zipfile.is_zipfile(ruta):
        z = zipfile.ZipFile(ruta)
        return [(i.filename, i.file_size, (lambda n=i.filename: z.read(n)))
                for i in z.infolist() if not i.is_dir()]
    out = []
    for base, _, files in os.walk(ruta):
        for f in files:
            p = os.path.join(base, f)
            out.append((os.path.relpath(p, ruta), os.path.getsize(p),
                        (lambda pp=p: open(pp, 'rb').read())))
    return out


def aplanar(obj, pref="", prof=0):
    """Claves de un dict anidado, con tipo. Máx 3 niveles."""
    claves = {}
    if prof > 2 or not isinstance(obj, dict):
        return claves
    for k, v in obj.items():
        nom = f"{pref}{k}"
        if isinstance(v, dict):
            claves[nom] = "objeto"
            claves.update(aplanar(v, nom + ".", prof + 1))
        elif isinstance(v, list):
            claves[nom] = f"lista[{len(v)}]"
            if v and isinstance(v[0], dict):
                claves.update(aplanar(v[0], nom + "[].", prof + 1))
        else:
            claves[nom] = type(v).__name__
    return claves


def fechas_en(texto):
    """Devuelve (min, max, formato). Normaliza a ISO para poder ordenar."""
    t = texto[:400000]
    iso = ["-".join(x) for x in FECHA_ISO.findall(t)]
    us = [f"20{a}-{m}-{d}" for m, d, a in FECHA_US.findall(t)]
    if iso and len(iso) >= len(us):
        s = sorted(iso)
        return s[0], s[-1], "ISO"
    if us:
        s = sorted(us)
        return s[0], s[-1], "MM/DD/AA → normalizado"
    return None


def analizar_json(raw):
    try:
        d = json.loads(raw.decode("utf-8", "replace"))
    except Exception as e:
        return {"error": f"JSON ilegible: {e}"}
    info = {}
    if isinstance(d, list):
        info["forma"] = f"array de {len(d)} elementos"
        info["registros"] = len(d)
        if d and isinstance(d[0], dict):
            info["claves"] = aplanar(d[0])
            info["muestra"] = d[0]
    elif isinstance(d, dict):
        info["forma"] = "objeto"
        info["registros"] = 1
        info["claves"] = aplanar(d)
        info["muestra"] = d
    return info


def analizar_csv(raw):
    txt = raw.decode("utf-8", "replace")
    try:
        dialecto = csv.Sniffer().sniff(txt[:4096])
        sep = dialecto.delimiter
    except Exception:
        sep = ","
    r = list(csv.reader(io.StringIO(txt), delimiter=sep))
    if not r:
        return {"error": "CSV vacío"}
    return {"forma": f"CSV (sep '{sep}')", "registros": max(0, len(r) - 1),
            "claves": {c: "" for c in r[0]},
            "muestra": dict(zip(r[0], r[1])) if len(r) > 1 else None}


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    ruta = sys.argv[1]
    detalle = "--detalle" in sys.argv
    if not os.path.exists(ruta):
        print(f"No existe: {ruta}")
        sys.exit(1)

    ficheros = abrir(ruta)
    print(f"\n{'='*78}\n  {ruta}\n  {len(ficheros)} ficheros · {humano(sum(f[1] for f in ficheros))}\n{'='*78}")

    # --- Mapa de carpetas ---
    carpetas = defaultdict(lambda: [0, 0])
    exts = Counter()
    for nom, tam, _ in ficheros:
        c = os.path.dirname(nom) or "."
        carpetas[c][0] += 1
        carpetas[c][1] += tam
        exts[os.path.splitext(nom)[1].lower() or "(sin ext)"] += 1

    print("\n## CARPETAS\n")
    for c in sorted(carpetas, key=lambda x: -carpetas[x][1]):
        n, t = carpetas[c]
        print(f"  {humano(t):>9}  {n:>5} fich.  {c}")

    print("\n## EXTENSIONES\n  " + " · ".join(f"{e} ×{n}" for e, n in exts.most_common()))

    # --- Agrupar por "familia": mismo nombre sin fechas ni números ---
    familias = defaultdict(list)
    for nom, tam, leer in ficheros:
        base = os.path.basename(nom)
        fam = re.sub(r'[-_]?\d{4}[-_]\d{2}[-_]\d{2}', '', base)
        fam = re.sub(r'\d+', '#', fam)
        familias[os.path.join(os.path.dirname(nom), fam)].append((nom, tam, leer))

    print(f"\n## FAMILIAS DE FICHEROS  ({len(familias)})\n")
    print("Una familia = mismo esquema repetido por fecha o por lote.\n")

    for fam in sorted(familias, key=lambda f: -sum(x[1] for x in familias[f])):
        grupo = familias[fam]
        total = sum(x[1] for x in grupo)
        print(f"\n{'─'*78}\n▸ {fam}")
        print(f"  {len(grupo)} fichero(s) · {humano(total)}")

        nom, tam, leer = max(grupo, key=lambda x: x[1])  # el mayor como representante
        ext = os.path.splitext(nom)[1].lower()
        if tam > 60_000_000:
            print(f"  (representante {os.path.basename(nom)} demasiado grande, se omite)")
            continue
        try:
            raw = leer()
        except Exception as e:
            print(f"  ERROR al leer: {e}")
            continue

        if ext == ".json":
            info = analizar_json(raw)
        elif ext == ".csv":
            info = analizar_csv(raw)
        else:
            print(f"  tipo {ext}: no se inspecciona")
            continue

        if "error" in info:
            print(f"  {info['error']}")
            continue

        print(f"  forma: {info['forma']}")

        # rango de fechas y granularidad estimada
        rg = fechas_en(raw.decode("utf-8", "replace"))
        if rg:
            print(f"  fechas detectadas: {rg[0]} → {rg[1]}   [formato {rg[2]}]")
        n = info.get("registros", 0)
        if rg and n > 1 and rg[0] != rg[1]:
            print(f"  registros: {n}")
        elif n:
            print(f"  registros: {n}")
        if n > 500:
            print("  ⚠️ GRANULARIDAD ALTA: muchos registros — probable serie intradía")

        claves = info.get("claves") or {}
        if claves:
            print(f"  campos ({len(claves)}):")
            for k, t in list(claves.items())[:40]:
                print(f"     {k:<44}{t}")
            if len(claves) > 40:
                print(f"     … y {len(claves)-40} más")

        if detalle and info.get("muestra") is not None:
            m = json.dumps(info["muestra"], ensure_ascii=False, indent=2)[:900]
            print("  muestra:")
            for ln in m.splitlines():
                print("     " + ln)

    print(f"\n{'='*78}")
    print("""
SIGUIENTE PASO — qué mirar en lo de arriba:

  1. ¿Qué métricas hay realmente? (sueño, FC, HRV, SpO2, pasos, temperatura)
  2. ¿Qué granularidad tiene cada una? Un fichero con miles de registros es
     serie intradía; uno con una fila por día es un resumen.
  3. ¿Las fases de sueño vienen ya segmentadas o hay que derivarlas?
  4. ¿Cuántos días de histórico hay de verdad?
  5. ¿Qué campos llegan vacíos? Una noche sin pulsera es un HUECO, no un cero.

Eso es lo que decide el modelo de datos. Antes de eso, no se elige motor.
""")


if __name__ == "__main__":
    main()
