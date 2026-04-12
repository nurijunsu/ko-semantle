#!/bin/bash
set -e

echo "=== 코맨틀 빌드 시작 ==="

# 의존성 설치
pip install -r requirements.txt

# 벡터 파일이 없으면 다운로드 및 처리
if [ ! -f data/vectors.npy ] || [ ! -f data/words.json ]; then
    echo "단어 벡터를 다운로드하고 처리합니다..."
    python setup_vectors.py 50000
else
    echo "단어 벡터가 이미 존재합니다."
fi

echo "=== 빌드 완료 ==="
