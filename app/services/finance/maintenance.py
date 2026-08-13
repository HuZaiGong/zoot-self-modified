"""
财务维护服务 - 自动每日扣费，预缴罗德岛维修费用的接口
"""

import sqlite3
import time
from typing import Any, Dict, Optional

from ...models.finance_db import FinanceDB
from ...utils.writable import get_writable_path

from .manager import FinanceManager


class MaintenanceService:
    """财务维护服务 - 单例模式"""

    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self.finance_manager = FinanceManager()
        self.db = FinanceDB()
        self._base_maintenance_cost = 100
        self._cost_per_room = 10
        self._initialized = True

    def _get_maintenance_config(self) -> Dict[str, Any]:
        conn = self.db.conn
        try:
            cursor = conn.execute("SELECT value FROM config WHERE key='maintenance_config'")
            row = cursor.fetchone()
        except sqlite3.OperationalError:
            self._ensure_config_table(conn)
            row = None
        if row:
            import json

            try:
                return json.loads(row[0])
            except Exception:
                pass
        return {"last_maintenance_time": 0, "total_rooms": 0, "base_cost": 100, "cost_per_room": 10}

    def _save_maintenance_config(self, config: Dict) -> None:
        import json

        conn = self.db.conn
        try:
            conn.execute(
                "INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)",
                ("maintenance_config", json.dumps(config, ensure_ascii=False)),
            )
        except sqlite3.OperationalError:
            self._ensure_config_table(conn)
            conn.execute(
                "INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)",
                ("maintenance_config", json.dumps(config, ensure_ascii=False)),
            )
        conn.commit()

    @staticmethod
    def _ensure_config_table(conn) -> None:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT)"
        )
        conn.commit()

    def calculate_maintenance_cost(self) -> int:
        config = self._get_maintenance_config()
        rooms = config.get("total_rooms", 0)
        base = config.get("base_cost", self._base_maintenance_cost)
        per_room = config.get("cost_per_room", self._cost_per_room)
        cost = base + rooms * per_room
        last_time = config.get("last_maintenance_time", 0)
        if last_time > 0:
            days_since = (time.time() - last_time) / 86400
            if days_since > 1:
                cost = int(cost * (1 + (days_since - 1) * 0.05))
        return min(cost, 5000)

    def set_room_count(self, room_count: int) -> None:
        config = self._get_maintenance_config()
        config["total_rooms"] = room_count
        self._save_maintenance_config(config)

    def get_last_maintenance_time(self) -> float:
        config = self._get_maintenance_config()
        return config.get("last_maintenance_time", 0)

    def apply_maintenance(self, force: bool = False) -> Dict[str, Any]:
        config = self._get_maintenance_config()
        now = time.time()
        last_time = config.get("last_maintenance_time", 0)
        if not force and last_time > 0:
            hours_since = (now - last_time) / 3600
            if hours_since < 24:
                return {
                    "status": "skipped",
                    "message": f"距离上次维护不到24小时 ({hours_since:.1f}h)不可用",
                    "next_available_in": 24 - hours_since,
                }
        cost = self.calculate_maintenance_cost()
        rhodes_balance = self.finance_manager.get_balance("rhodes")
        if rhodes_balance < cost:
            return {
                "status": "failed",
                "message": f"罗德岛资金不足，需要 {cost}（当前 {rhodes_balance}）",
                "required": cost,
                "current": rhodes_balance,
            }
        try:
            result = self.finance_manager.subtract(
                "rhodes",
                cost,
                f"自动日常维护 (房间: {config.get('total_rooms', 0)})",
                "maintenance",
                {"rooms": config.get("total_rooms", 0), "cost": cost},
            )
            config["last_maintenance_time"] = now
            self._save_maintenance_config(config)
            return {
                "status": "success",
                "message": f"自动维护完成，扣除 {cost} 龙门币",
                "cost": cost,
                "balance_after": result["balance_after"],
                "rooms": config.get("total_rooms", 0),
            }
        except Exception as e:
            return {"status": "error", "message": f"维护失败: {str(e)}"}

    def get_maintenance_status(self) -> Dict[str, Any]:
        config = self._get_maintenance_config()
        now = time.time()
        last_time = config.get("last_maintenance_time", 0)
        hours_since = (now - last_time) / 3600 if last_time > 0 else 999
        is_ready = hours_since >= 24
        cost = self.calculate_maintenance_cost()
        return {
            "last_maintenance_time": last_time,
            "last_maintenance_hours_ago": hours_since,
            "is_ready": is_ready,
            "estimated_cost": cost,
            "rooms": config.get("total_rooms", 0),
            "next_maintenance_in": max(0, 24 - hours_since),
        }


_maintenance_service = None


def get_maintenance_service() -> MaintenanceService:
    global _maintenance_service
    if _maintenance_service is None:
        _maintenance_service = MaintenanceService()
    return _maintenance_service
