import logging
from typing import Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from ..services.diary_service import DiaryService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/operator/diary", tags=["diary"])


class DiaryGenerateRequest(BaseModel):
    operator_id: str
    date: str
    force: bool = False


_operator_engines = None


def set_operator_engines(engines):
    global _operator_engines
    _operator_engines = engines


def get_operator_engines():
    if _operator_engines is None:
        raise HTTPException(500, "operator_engines not initialized")
    return _operator_engines


@router.get("/global")
async def get_global_diaries(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    engines: Dict = Depends(get_operator_engines),
):
    service = DiaryService("")
    diaries = await service.get_global_diaries(limit, offset)
    total = await service.count_global_diaries()
    for diary in diaries:
        op_eng = diary["operator_eng"]
        engine = engines.get(op_eng)
        diary["codename"] = engine.profile.codename if engine else op_eng
    return {"diaries": diaries, "total": total, "limit": limit, "offset": offset}


@router.post("/generate")
async def generate_diary(
    req: DiaryGenerateRequest,
    engines: Dict = Depends(get_operator_engines),
):
    engine = engines.get(req.operator_id)
    if not engine:
        raise HTTPException(404, f"干员 {req.operator_id} 不存在")
    service = DiaryService(req.operator_id)
    diary = await service.get_or_generate_diary(req.date, force=req.force, engine=engine)
    if not diary:
        raise HTTPException(500, "日记生成失败")
    return {"diary": diary}


@router.get("/{operator_id}")
async def get_diary(
    operator_id: str,
    date: str = Query(..., description="YYYY-MM-DD"),
    engines: Dict = Depends(get_operator_engines),
):
    engine = engines.get(operator_id)
    if not engine:
        raise HTTPException(404, f"干员 {operator_id} 不存在")
    service = DiaryService(operator_id)
    diary = await service.get_or_generate_diary(date, force=False, engine=engine)
    if not diary:
        raise HTTPException(404, "日记不存在或生成失败")
    return {"diary": diary}


@router.delete("/{operator_id}")
async def delete_diary(
    operator_id: str,
    date: str = Query(...),
    engines: Dict = Depends(get_operator_engines),
):
    if operator_id not in engines:
        raise HTTPException(404, f"干员 {operator_id} 不存在")
    service = DiaryService(operator_id)
    service.db.delete_diary(operator_id, date)
    return {"status": "ok"}


@router.get("/list/{operator_id}")
async def list_diaries(
    operator_id: str,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    engines: Dict = Depends(get_operator_engines),
):
    if operator_id not in engines:
        raise HTTPException(404, f"干员 {operator_id} 不存在")
    service = DiaryService(operator_id)
    diaries = await service.get_all_diaries(limit, offset)
    total = await service.count_diaries()
    return {"diaries": diaries, "total": total, "limit": limit, "offset": offset}
