import random
import string
import threading
import time
import uuid

import numpy as np
from datetime import date
from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from vectors import WordVectors
from game import get_daily_word, get_puzzle_number
from target_words import TARGET_WORDS

app = FastAPI(title="코맨틀 - 한국어 단어 유사도 게임")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── 전역 게임 상태 ──────────────────────────────────────────────
wv: WordVectors = None
current_date: date = None
target_word: str = None
target_vec: np.ndarray = None
word_ranks: dict[str, int] = {}
sorted_sims: np.ndarray = None
sorted_order: np.ndarray = None

# ── 멀티플레이어 방 관리 ────────────────────────────────────────
rooms: dict[str, dict] = {}
ROOM_TTL = 24 * 60 * 60       # 24시간 후 삭제
MAX_ROOMS = 1000
MAX_PLAYERS_PER_ROOM = 10
_rooms_lock = threading.Lock()


def _gen_room_id() -> str:
    chars = string.ascii_uppercase + string.digits
    for _ in range(100):
        rid = "".join(random.choices(chars, k=6))
        if rid not in rooms:
            return rid
    raise RuntimeError("방 ID 생성 실패")


def _cleanup_rooms():
    """만료된 방 정리 (백그라운드 스레드에서 호출)"""
    while True:
        time.sleep(300)
        now = time.time()
        with _rooms_lock:
            expired = [rid for rid, r in rooms.items() if now - r["created_at"] > ROOM_TTL]
            for rid in expired:
                del rooms[rid]


# ── 데일리 퍼즐 ─────────────────────────────────────────────────

def refresh_daily_game():
    global current_date, target_word, target_vec, word_ranks, sorted_sims, sorted_order

    today = date.today()
    if current_date == today:
        return
    current_date = today

    candidate = get_daily_word(TARGET_WORDS, today)
    if wv.has_word(candidate):
        target_word = candidate
    else:
        for w in TARGET_WORDS:
            if wv.has_word(w):
                target_word = w
                break

    target_vec = wv.get_vector(target_word)

    sims = wv.all_similarities(target_vec)
    sorted_order = np.argsort(-sims)
    sorted_sims = sims[sorted_order]
    word_ranks = {wv.words[int(idx)]: rank + 1 for rank, idx in enumerate(sorted_order)}

    # 날짜 바뀌면 방도 초기화
    with _rooms_lock:
        rooms.clear()


@app.on_event("startup")
async def startup():
    global wv
    wv = WordVectors("data")
    refresh_daily_game()
    threading.Thread(target=_cleanup_rooms, daemon=True).start()


# ── 유틸 ────────────────────────────────────────────────────────

def _compute_guess(word: str) -> dict | None:
    """단어의 유사도/순위 계산. 없는 단어면 None."""
    if not wv.has_word(word):
        return None
    vec = wv.get_vector(word)
    sim = wv.similarity(target_vec, vec)
    rank = word_ranks.get(word, len(wv.words))
    return {
        "word": word,
        "similarity": round(sim * 100, 2),
        "rank": rank,
        "totalWords": len(wv.words),
        "isCorrect": word == target_word,
    }


def _update_top3(player: dict, rank: int, similarity: float):
    """플레이어의 top3를 갱신 (rank 기준 상위 3개 유지)"""
    top3 = player["top3"]
    # 이미 같은 순위가 있으면 무시
    if any(t["rank"] == rank for t in top3):
        return
    entry = {"rank": rank, "similarity": similarity}
    if len(top3) < 3:
        top3.append(entry)
    else:
        worst = max(range(3), key=lambda i: top3[i]["rank"])
        if rank < top3[worst]["rank"]:
            top3[worst] = entry
    top3.sort(key=lambda t: t["rank"])


# ── 솔로 API ───────────────────────────────────────────────────

@app.get("/api/puzzle")
async def puzzle_info():
    refresh_daily_game()
    return {
        "puzzleNumber": get_puzzle_number(),
        "date": str(current_date),
        "totalWords": len(wv.words),
    }


@app.post("/api/guess")
async def guess(request: Request):
    refresh_daily_game()
    body = await request.json()
    word = body.get("word", "").strip()

    if not word:
        return JSONResponse({"error": "단어를 입력해주세요."}, status_code=400)

    result = _compute_guess(word)
    if result is None:
        return JSONResponse({"error": f"'{word}'은(는) 사전에 없는 단어입니다."}, status_code=404)
    return result


@app.get("/api/give-up")
async def give_up():
    refresh_daily_game()
    return {"answer": target_word}


@app.get("/api/top100")
async def top100():
    """유사도 상위 100개 단어 반환"""
    refresh_daily_game()
    results = []
    for rank in range(1, 101):
        idx = int(sorted_order[rank - 1])
        results.append({
            "rank": rank,
            "word": wv.words[idx],
            "similarity": round(float(sorted_sims[rank - 1]) * 100, 2),
        })
    return results


# ── 멀티플레이어 API ────────────────────────────────────────────

@app.post("/api/room/create")
async def room_create(request: Request):
    refresh_daily_game()
    body = await request.json()
    name = body.get("name", "").strip()[:12] or "익명"

    with _rooms_lock:
        if len(rooms) >= MAX_ROOMS:
            return JSONResponse({"error": "서버에 방이 너무 많습니다. 나중에 다시 시도하세요."}, status_code=503)

        room_id = _gen_room_id()
        player_id = uuid.uuid4().hex[:12]
        rooms[room_id] = {
            "id": room_id,
            "created_at": time.time(),
            "players": {
                player_id: {"name": name, "top3": [], "guessCount": 0, "solved": False, "givenUp": False}
            },
        }

    return {"roomId": room_id, "playerId": player_id}


@app.post("/api/room/join")
async def room_join(request: Request):
    refresh_daily_game()
    body = await request.json()
    room_id = body.get("roomId", "").strip().upper()
    name = body.get("name", "").strip()[:12] or "익명"

    with _rooms_lock:
        room = rooms.get(room_id)
        if room is None:
            return JSONResponse({"error": "존재하지 않는 방입니다."}, status_code=404)
        if len(room["players"]) >= MAX_PLAYERS_PER_ROOM:
            return JSONResponse({"error": "방이 가득 찼습니다."}, status_code=400)

        player_id = uuid.uuid4().hex[:12]
        room["players"][player_id] = {"name": name, "top3": [], "guessCount": 0, "solved": False, "givenUp": False}

    return {"roomId": room_id, "playerId": player_id}


@app.post("/api/room/guess")
async def room_guess(request: Request):
    refresh_daily_game()
    body = await request.json()
    room_id = body.get("roomId", "").strip().upper()
    player_id = body.get("playerId", "").strip()
    word = body.get("word", "").strip()

    if not word:
        return JSONResponse({"error": "단어를 입력해주세요."}, status_code=400)

    result = _compute_guess(word)
    if result is None:
        return JSONResponse({"error": f"'{word}'은(는) 사전에 없는 단어입니다."}, status_code=404)

    with _rooms_lock:
        room = rooms.get(room_id)
        if room and player_id in room["players"]:
            player = room["players"][player_id]
            player["guessCount"] += 1
            _update_top3(player, result["rank"], result["similarity"])
            if result["isCorrect"]:
                player["solved"] = True

    return result


@app.get("/api/room/{room_id}")
async def room_status(room_id: str):
    """방 상태: 모든 플레이어의 이름, 추측 수, top3(순위+유사도)"""
    refresh_daily_game()
    room_id = room_id.strip().upper()

    with _rooms_lock:
        room = rooms.get(room_id)
        if room is None:
            return JSONResponse({"error": "존재하지 않는 방입니다."}, status_code=404)

        players = []
        for pid, p in room["players"].items():
            players.append({
                "playerId": pid,
                "name": p["name"],
                "guessCount": p["guessCount"],
                "solved": p["solved"],
                "givenUp": p["givenUp"],
                "top3": p["top3"],
            })

    return {"roomId": room_id, "players": players}


@app.post("/api/room/give-up")
async def room_give_up(request: Request):
    refresh_daily_game()
    body = await request.json()
    room_id = body.get("roomId", "").strip().upper()
    player_id = body.get("playerId", "").strip()

    with _rooms_lock:
        room = rooms.get(room_id)
        if room and player_id in room["players"]:
            room["players"][player_id]["givenUp"] = True

    return {"answer": target_word}


# ── 정적 파일 서빙 ──────────────────────────────────────────────

app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
async def index():
    return FileResponse("static/index.html")
