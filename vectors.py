import numpy as np
import json
import os


class WordVectors:
    """한국어 단어 벡터를 관리하고 유사도를 계산하는 클래스"""

    def __init__(self, data_dir="data"):
        words_path = os.path.join(data_dir, "words.json")
        vectors_path = os.path.join(data_dir, "vectors.npy")

        if not os.path.exists(words_path) or not os.path.exists(vectors_path):
            raise FileNotFoundError(
                "단어 벡터 파일이 없습니다. 먼저 setup_vectors.py를 실행하세요.\n"
                "  python setup_vectors.py"
            )

        with open(words_path, "r", encoding="utf-8") as f:
            self.words = json.load(f)

        self.vectors = np.load(vectors_path).astype(np.float32)

        # 코사인 유사도를 위해 벡터 정규화
        norms = np.linalg.norm(self.vectors, axis=1, keepdims=True)
        self.vectors = self.vectors / np.maximum(norms, 1e-10)

        self.word_to_idx = {w: i for i, w in enumerate(self.words)}

    def get_vector(self, word: str) -> np.ndarray | None:
        idx = self.word_to_idx.get(word)
        if idx is None:
            return None
        return self.vectors[idx]

    def has_word(self, word: str) -> bool:
        return word in self.word_to_idx

    def similarity(self, vec1: np.ndarray, vec2: np.ndarray) -> float:
        return float(np.dot(vec1, vec2))

    def all_similarities(self, target_vec: np.ndarray) -> np.ndarray:
        return self.vectors @ target_vec

    def nearest_neighbors(self, target_vec: np.ndarray, n: int = 1000):
        sims = self.all_similarities(target_vec)
        top_indices = np.argsort(-sims)[:n]
        return [(self.words[i], float(sims[i])) for i in top_indices]
