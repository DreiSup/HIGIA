"""Conexión a la base de datos.

Una conexión por petición, a propósito: la app es de UN usuario y el coste de
abrirla (~5 ms) es irrelevante frente a la complejidad de gestionar un pool con
su ciclo de vida, sus reconexiones y sus fugas. Si algún día hay concurrencia
real, aquí es donde se mete `psycopg_pool` y no hay que tocar nada más.
"""
import os
from contextlib import contextmanager
from decimal import Decimal

import psycopg
from psycopg.rows import dict_row


def _numeros(valor):
    """`numeric` de Postgres → `float`.

    Sin esto, psycopg devuelve `Decimal` y el JSON sale con los números entre
    comillas (`"67.4"`). El frontend no puede dibujar una gráfica con cadenas, y
    el fallo no da error: simplemente no se pinta nada.

    La pérdida de precisión es irrelevante aquí — se trabaja con uno o dos
    decimales — y NULL sigue siendo None, que es lo que no se puede perder.
    """
    if isinstance(valor, Decimal):
        return float(valor)
    if isinstance(valor, dict):
        return {k: _numeros(v) for k, v in valor.items()}
    if isinstance(valor, list):
        return [_numeros(v) for v in valor]
    return valor


def url() -> str:
    """La URL se arma desde piezas sueltas, nunca desde una variable ya montada.

    Es a proposito: docker-compose interpola ${...} leyendo un `.env` de SU
    directorio, y aqui el `.env` vive en el directorio PADRE, fuera del
    repositorio publico. Si la URL se montara en el compose, la contrasena
    llegaria vacia sin dar ningun error visible.
    """
    return (
        f"postgresql://{os.getenv('POSTGRES_USER', 'higia')}"
        f":{os.environ['POSTGRES_PASSWORD']}"
        f"@{os.getenv('POSTGRES_HOST', 'db')}"
        f":{os.getenv('POSTGRES_PORT', '5432')}"
        f"/{os.getenv('POSTGRES_DB', 'higia')}"
    )


@contextmanager
def cursor():
    """Cursor que devuelve dicts. Hace commit al salir sin excepción."""
    with psycopg.connect(url(), connect_timeout=5, row_factory=dict_row) as con:
        with con.cursor() as cur:
            yield cur


def consultar(sql: str, params: tuple = ()) -> list[dict]:
    with cursor() as cur:
        cur.execute(sql, params)
        return _numeros(cur.fetchall())


def consultar_uno(sql: str, params: tuple = ()) -> dict | None:
    with cursor() as cur:
        cur.execute(sql, params)
        return _numeros(cur.fetchone())
