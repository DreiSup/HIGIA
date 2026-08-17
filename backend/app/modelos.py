"""Modelos de entrada de la API.

🔑 Todo lo opcional es `None` por defecto y NUNCA 0. Un hueco no es un cero:
   "no anoté la hora" y "a las 00:00" son cosas distintas, y confundirlas es la
   forma más fácil de sacar una conclusión falsa (regla 9 del vault).
"""
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

# `origen_cantidad` es lo que permite CALCULAR la banda de error en vez de
# suponerla. La incertidumbre por defecto sale de aquí.
OrigenCantidad = Literal["envase", "pesado", "estimado"]

INCERTIDUMBRE_POR_ORIGEN = {"envase": 3, "pesado": 2, "estimado": 25}


class ItemEntrada(BaseModel):
    alimento_id: str
    cantidad_g: float = Field(ge=0)
    origen_cantidad: OrigenCantidad
    # Si no se da, se deduce del origen. Ver INCERTIDUMBRE_POR_ORIGEN.
    incertidumbre_pct: float | None = Field(default=None, ge=0)
    nota: str | None = None


class ComidaEntrada(BaseModel):
    fecha: date
    descripcion: str
    # NULL = no se anotó la hora. Hará falta cuando entremos en digestión.
    momento: datetime | None = None
    metodo: str | None = None
    tanda_id: str | None = None
    foto: str | None = None
    nota: str | None = None
    items: list[ItemEntrada] = Field(min_length=1)


class DiaSubjetivoEntrada(BaseModel):
    """Escala 0-10 en las tres, fijada también por CHECK en la base (A5).

    🔴 No cambiar la escala: rompería la comparabilidad de todo el histórico.
    """
    fecha: date
    como_me_siento: int | None = Field(default=None, ge=0, le=10)
    animo: int | None = Field(default=None, ge=0, le=10)
    energia: int | None = Field(default=None, ge=0, le=10)
    nota: str | None = None


class ConsumoEntrada(BaseModel):
    """Café, L-teanina, nicotina y demás. Una fila por TOMA, no por día."""
    fecha: date
    sustancia: str
    cantidad: float | None = Field(default=None, ge=0)
    unidad: str | None = None
    # La hora importa mucho aquí: un café a las 09:00 y otro a las 18:00 no son
    # el mismo dato para el sueño de esa noche.
    momento: datetime | None = None
    nota: str | None = None
