"""Higía — API de salud personal.

De momento solo comprueba que el backend vive y que llega a la base de datos.
"""
import os

import psycopg
from fastapi import FastAPI

app = FastAPI(
    title="Higía",
    description="API de salud personal. Uso individual.",
    version="0.1.0",
)


def _database_url() -> str:
    """Construye la URL desde piezas sueltas, no desde una variable ya montada.

    Es a proposito: docker-compose interpola ${...} leyendo un `.env` de SU
    directorio, y aqui el `.env` vive en el directorio PADRE, fuera del
    repositorio publico. Si la URL se montara en el compose, la contrasena
    llegaria vacia. Montandola aqui, basta con que `env_file` inyecte la
    variable en el contenedor.
    """
    usuario = os.getenv("POSTGRES_USER", "higia")
    clave = os.environ["POSTGRES_PASSWORD"]
    host = os.getenv("POSTGRES_HOST", "db")
    puerto = os.getenv("POSTGRES_PORT", "5432")
    base = os.getenv("POSTGRES_DB", "higia")
    return f"postgresql://{usuario}:{clave}@{host}:{puerto}/{base}"


DATABASE_URL = _database_url()


@app.get("/health")
def health() -> dict:
    """Estado del backend y de su conexion con la base de datos."""
    try:
        with psycopg.connect(DATABASE_URL, connect_timeout=5) as con:
            version, tablas = con.execute(
                "SELECT current_setting('server_version'),"
                " (SELECT count(*) FROM information_schema.tables"
                "  WHERE table_schema='public')"
            ).fetchone()
        return {"estado": "ok", "postgres": version, "tablas": tablas}
    except Exception as e:  # noqa: BLE001
        return {"estado": "error", "detalle": f"{type(e).__name__}: {e}"}
