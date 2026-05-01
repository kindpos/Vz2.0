import json
import os
from typing import List
from fastapi import APIRouter
from pydantic import BaseModel
import aiosqlite

from .hardware import HARDWARE_DB_PATH

router = APIRouter(prefix="/favorites", tags=["favorites"])

_DB = HARDWARE_DB_PATH


async def _ensure_table():
    async with aiosqlite.connect(_DB) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS employee_favorites (
                employee_id TEXT PRIMARY KEY,
                item_ids    TEXT NOT NULL DEFAULT '[]'
            )
        """)
        await db.commit()


class SaveFavoritesRequest(BaseModel):
    employee_id: str
    item_ids: List[str]


@router.get("")
async def get_favorites(employee_id: str):
    await _ensure_table()
    async with aiosqlite.connect(_DB) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT item_ids FROM employee_favorites WHERE employee_id = ?",
            (employee_id,),
        ) as cur:
            row = await cur.fetchone()
    if not row:
        return {"item_ids": []}
    return {"item_ids": json.loads(row["item_ids"])}


@router.post("")
async def save_favorites(request: SaveFavoritesRequest):
    await _ensure_table()
    async with aiosqlite.connect(_DB) as db:
        await db.execute(
            """
            INSERT INTO employee_favorites (employee_id, item_ids)
            VALUES (?, ?)
            ON CONFLICT(employee_id) DO UPDATE SET item_ids = excluded.item_ids
            """,
            (request.employee_id, json.dumps(request.item_ids)),
        )
        await db.commit()
    return {"ok": True}
