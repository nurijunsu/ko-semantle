import hashlib
from datetime import date

# 게임 시작 기준일 (퍼즐 번호 계산용)
PUZZLE_START_DATE = date(2024, 1, 1)


def get_puzzle_number(d: date = None) -> int:
    if d is None:
        d = date.today()
    return (d - PUZZLE_START_DATE).days


def get_daily_word(target_words: list[str], d: date = None) -> str:
    """날짜 기반으로 오늘의 정답 단어를 결정적으로 선택"""
    puzzle_num = get_puzzle_number(d)
    h = hashlib.sha256(f"ko-semantle-v2-{puzzle_num}".encode()).hexdigest()
    index = int(h, 16) % len(target_words)
    return target_words[index]
