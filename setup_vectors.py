"""
한국어 FastText 단어 벡터를 다운로드하고 처리하는 스크립트.

Facebook의 cc.ko.300.vec.gz 파일을 스트리밍으로 읽어
상위 N개의 한국어 단어 벡터만 추출합니다.
(전체 1.2GB를 다운로드하지 않고, 필요한 만큼만 읽고 중단)

사용법:
    python setup_vectors.py              # 기본 30,000 단어
    python setup_vectors.py 50000        # 50,000 단어
"""

import gzip
import io
import json
import os
import re
import sys
import urllib.request

import numpy as np

FASTTEXT_URL = "https://dl.fbaipublicfiles.com/fasttext/vectors-crawl/cc.ko.300.vec.gz"
DATA_DIR = "data"

HANGUL_RE = re.compile("[가-힣]")


def is_korean_word(word: str) -> bool:
    if not HANGUL_RE.search(word):
        return False
    if re.search(r"[a-zA-Z0-9_\-\.\/\\@#$%^&*()!?<>{}|~`]", word):
        return False
    if len(word) < 1 or len(word) > 10:
        return False
    return True


def download_and_process(max_words: int = 30000):
    os.makedirs(DATA_DIR, exist_ok=True)
    vectors_path = os.path.join(DATA_DIR, "vectors.npy")
    words_path = os.path.join(DATA_DIR, "words.json")

    # 이미 처리된 파일이 있으면 건너뛰기
    if os.path.exists(vectors_path) and os.path.exists(words_path):
        print("이미 처리된 벡터 파일이 존재합니다. 건너뜁니다.")
        return

    gz_path = os.path.join(DATA_DIR, "cc.ko.300.vec.gz")

    # ── 방법 1: 이미 다운로드된 .gz 파일이 있으면 그것을 사용 ──
    if os.path.exists(gz_path):
        print(f"로컬 파일 사용: {gz_path}")
        _process_gz_file(gz_path, max_words, vectors_path, words_path)
        return

    # ── 방법 2: 스트리밍 다운로드 + 처리 (전체 파일 저장 안함) ──
    print(f"FastText 한국어 벡터를 스트리밍으로 처리합니다...")
    print(f"  URL: {FASTTEXT_URL}")
    print(f"  목표: 상위 {max_words}개 한국어 단어")

    req = urllib.request.Request(FASTTEXT_URL)
    req.add_header("User-Agent", "Mozilla/5.0")
    response = urllib.request.urlopen(req, timeout=300)

    words = []
    vectors = []
    dim = None
    bytes_read = 0

    decompressor = gzip.GzipFile(fileobj=response)
    reader = io.TextIOWrapper(decompressor, encoding="utf-8", errors="ignore")

    # 헤더 읽기
    header = reader.readline()
    parts = header.strip().split()
    dim = int(parts[1])
    print(f"  벡터 차원: {dim}")

    for line in reader:
        if len(words) >= max_words:
            break

        parts = line.rstrip().split(" ")
        word = parts[0]

        if not is_korean_word(word):
            continue

        try:
            vec = [float(x) for x in parts[1 : dim + 1]]
            if len(vec) != dim:
                continue
            words.append(word)
            vectors.append(vec)
        except ValueError:
            continue

        if len(words) % 2000 == 0:
            print(f"  {len(words)}개 단어 추출됨...")

    response.close()
    print(f"  총 {len(words)}개 한국어 단어 추출 완료")

    _save(words, vectors, dim, vectors_path, words_path)


def _process_gz_file(gz_path, max_words, vectors_path, words_path):
    """로컬 gz 파일에서 벡터 추출"""
    print(f"한국어 단어 벡터 추출 중 (최대 {max_words}개)...")
    words = []
    vectors = []

    with gzip.open(gz_path, "rt", encoding="utf-8", errors="ignore") as f:
        header = f.readline()
        parts = header.strip().split()
        dim = int(parts[1])
        print(f"  벡터 차원: {dim}")

        for line in f:
            if len(words) >= max_words:
                break
            parts = line.rstrip().split(" ")
            word = parts[0]
            if not is_korean_word(word):
                continue
            try:
                vec = [float(x) for x in parts[1 : dim + 1]]
                if len(vec) != dim:
                    continue
                words.append(word)
                vectors.append(vec)
            except ValueError:
                continue
            if len(words) % 5000 == 0:
                print(f"  {len(words)}개 단어 추출됨...")

    print(f"  총 {len(words)}개 한국어 단어 추출 완료")
    _save(words, vectors, dim, vectors_path, words_path)


def _save(words, vectors, dim, vectors_path, words_path):
    vectors_np = np.array(vectors, dtype=np.float32)
    np.save(vectors_path, vectors_np)
    with open(words_path, "w", encoding="utf-8") as f:
        json.dump(words, f, ensure_ascii=False)

    size_mb = os.path.getsize(vectors_path) / (1024 * 1024)
    print(f"  저장 완료:")
    print(f"    {vectors_path} ({size_mb:.1f} MB)")
    print(f"    {words_path}")

    # 정답 후보 단어 커버리지 확인
    try:
        from target_words import TARGET_WORDS
        word_set = set(words)
        missing = [w for w in TARGET_WORDS if w not in word_set]
        found = len(TARGET_WORDS) - len(missing)
        print(f"\n  정답 후보 단어 커버리지: {found}/{len(TARGET_WORDS)}")
        if missing and len(missing) <= 30:
            print(f"  누락된 단어: {missing}")
    except ImportError:
        pass

    print("\n설정 완료! 서버를 시작하세요:")
    print("  uvicorn main:app --reload")


if __name__ == "__main__":
    max_w = int(sys.argv[1]) if len(sys.argv) > 1 else 30000
    download_and_process(max_w)
