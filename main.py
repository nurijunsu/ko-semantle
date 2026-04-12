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


def refresh_daily_game():
    """날짜가 바뀌면 새로운 정답 단어로 갱신"""
    global current_date, target_word, target_vec, word_ranks, sorted_sims

    today = date.today()
    if current_date == today:
        return
    current_date = today

    # 정답 단어 선택 (벡터가 있는 단어만)
    candidate = get_daily_word(TARGET_WORDS, today)
    if wv.has_word(candidate):
        target_word = candidate
    else:
        # 폴백: 벡터가 있는 첫 번째 단어
        for w in TARGET_WORDS:
            if wv.has_word(w):
                target_word = w
                break

    target_vec = wv.get_vector(target_word)

    # 모든 단어와의 유사도를 미리 계산하고 순위 매기기
    sims = wv.all_similarities(target_vec)
    order = np.argsort(-sims)
    sorted_sims = sims[order]
    word_ranks = {wv.words[int(idx)]: rank + 1 for rank, idx in enumerate(order)}


@app.on_event("startup")
async def startup():
    global wv
    wv = WordVectors("data")
    refresh_daily_game()


# ── API 엔드포인트 ──────────────────────────────────────────────

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

    if not wv.has_word(word):
        return JSONResponse(
            {"error": f"'{word}'은(는) 사전에 없는 단어입니다."},
            status_code=404,
        )

    vec = wv.get_vector(word)
    sim = wv.similarity(target_vec, vec)
    rank = word_ranks.get(word, len(wv.words))
    is_correct = word == target_word

    return {
        "word": word,
        "similarity": round(sim * 100, 2),
        "rank": rank,
        "totalWords": len(wv.words),
        "isCorrect": is_correct,
    }


@app.get("/api/give-up")
async def give_up():
    """포기 시 정답 공개"""
    refresh_daily_game()
    return {"answer": target_word}


@app.get("/api/nearby")
async def nearby(start: int = 1, end: int = 10):
    """순위 범위의 이웃 단어 목록 (정답 확인 후 사용)"""
    refresh_daily_game()
    start = max(1, start)
    end = min(end, len(wv.words))

    order = np.argsort(-wv.all_similarities(target_vec))
    results = []
    for rank in range(start, end + 1):
        idx = int(order[rank - 1])
        results.append({
            "rank": rank,
            "word": wv.words[idx],
            "similarity": round(float(sorted_sims[rank - 1]) * 100, 2),
        })
    return results


# ── 정적 파일 서빙 ──────────────────────────────────────────────

app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
async def index():
    return FileResponse("static/index.html")
