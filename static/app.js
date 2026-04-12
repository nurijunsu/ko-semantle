/* ── 게임 상태 ──────────────────────────────────────── */
let puzzleNumber = null;
let totalWords = 0;
let gameState = {
    puzzleNumber: null,
    guesses: [],
    solved: false,
    givenUp: false,
};

const STORAGE_KEY = "ko-semantle-state";
const STATS_KEY = "ko-semantle-stats";

/* ── 초기화 ────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", init);

async function init() {
    try {
        const res = await fetch("/api/puzzle");
        const data = await res.json();
        puzzleNumber = data.puzzleNumber;
        totalWords = data.totalWords;
        document.getElementById("puzzle-number").textContent = `#${puzzleNumber}`;

        loadState();
        renderGuesses();
        updateStats();

        if (gameState.solved) showWinModal();
        if (gameState.givenUp) disableInput();

        document.getElementById("guess-input").focus();
    } catch {
        showError("서버에 연결할 수 없습니다.");
    }
}

/* ── 상태 저장/불러오기 ──────────────────────────────── */
function loadState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const saved = JSON.parse(raw);
        if (saved.puzzleNumber === puzzleNumber) {
            gameState = saved;
        }
    } catch { /* 무시 */ }
}

function saveState() {
    gameState.puzzleNumber = puzzleNumber;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(gameState));
}

/* ── 추측 제출 ─────────────────────────────────────── */
async function handleSubmit(e) {
    e.preventDefault();
    if (gameState.solved || gameState.givenUp) return;

    const input = document.getElementById("guess-input");
    const word = input.value.trim();
    if (!word) return;

    // 이미 추측한 단어인지 확인
    const existing = gameState.guesses.find((g) => g.word === word);
    if (existing) {
        showError("이미 추측한 단어입니다.");
        highlightGuess(word);
        input.value = "";
        return;
    }

    hideError();
    const btn = document.getElementById("submit-btn");
    btn.disabled = true;
    btn.textContent = "...";

    try {
        const res = await fetch("/api/guess", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ word }),
        });

        const data = await res.json();

        if (data.error) {
            showError(data.error);
            return;
        }

        gameState.guesses.push({
            word: data.word,
            similarity: data.similarity,
            rank: data.rank,
            guessNum: gameState.guesses.length + 1,
        });

        if (data.isCorrect) {
            gameState.solved = true;
            showWinModal();
            launchConfetti();
        }

        saveState();
        renderGuesses();
        updateStats();
        input.value = "";
        input.focus();
    } catch {
        showError("서버 오류가 발생했습니다.");
    } finally {
        btn.disabled = false;
        btn.textContent = "추측";
    }
}

/* ── 렌더링 ────────────────────────────────────────── */
function renderGuesses() {
    const list = document.getElementById("guesses-list");
    const sorted = [...gameState.guesses].sort(
        (a, b) => b.similarity - a.similarity
    );

    list.innerHTML = sorted
        .map((g) => {
            const cls = rankClass(g.rank);
            const barW = Math.max(1, Math.min(100, g.similarity));
            const rankText = g.rank <= 1000 ? `${g.rank}위` : `${Math.ceil(g.rank / 1000)}k+`;
            return `
        <div class="guess-row ${cls}" data-word="${g.word}">
            <span class="guess-num">${g.guessNum}</span>
            <span class="guess-word">${g.word}</span>
            <span class="guess-sim">${g.similarity.toFixed(2)}</span>
            <span class="guess-rank">${rankText}</span>
            <div class="guess-bar-wrap">
                <div class="guess-bar-fill" style="width:${barW}%"></div>
            </div>
        </div>`;
        })
        .join("");
}

function rankClass(rank) {
    if (rank === 1) return "rank-exact";
    if (rank <= 10) return "rank-top10";
    if (rank <= 100) return "rank-top100";
    if (rank <= 1000) return "rank-top1000";
    return "rank-cold";
}

function updateStats() {
    document.getElementById("guess-count").textContent = gameState.guesses.length;

    if (gameState.guesses.length === 0) {
        document.getElementById("best-rank").textContent = "-";
        document.getElementById("best-sim").textContent = "-";
        return;
    }

    const bestRank = Math.min(...gameState.guesses.map((g) => g.rank));
    const bestSim = Math.max(...gameState.guesses.map((g) => g.similarity));
    document.getElementById("best-rank").textContent =
        bestRank <= 1000 ? `${bestRank}위` : `${Math.ceil(bestRank / 1000)}k+`;
    document.getElementById("best-sim").textContent = bestSim.toFixed(2);
}

function highlightGuess(word) {
    const row = document.querySelector(`.guess-row[data-word="${word}"]`);
    if (!row) return;
    row.classList.remove("highlight");
    void row.offsetWidth; // reflow
    row.classList.add("highlight");
    row.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/* ── 에러 메시지 ───────────────────────────────────── */
function showError(msg) {
    const el = document.getElementById("error-msg");
    el.textContent = msg;
    el.classList.remove("hidden");
    setTimeout(() => el.classList.add("hidden"), 3000);
}

function hideError() {
    document.getElementById("error-msg").classList.add("hidden");
}

/* ── 포기 ──────────────────────────────────────────── */
function openGiveUp() {
    if (gameState.solved || gameState.givenUp) return;
    document.getElementById("giveup-modal").classList.remove("hidden");
}

function closeGiveUp() {
    document.getElementById("giveup-modal").classList.add("hidden");
}

async function confirmGiveUp() {
    closeGiveUp();
    try {
        const res = await fetch("/api/give-up");
        const data = await res.json();
        gameState.givenUp = true;
        saveState();
        disableInput();
        showError(`정답은 "${data.answer}" 이었습니다.`);
    } catch {
        showError("서버 오류가 발생했습니다.");
    }
}

function disableInput() {
    document.getElementById("guess-input").disabled = true;
    document.getElementById("submit-btn").disabled = true;
    document.getElementById("giveup-btn").classList.add("hidden");
}

/* ── 승리 모달 ─────────────────────────────────────── */
function showWinModal() {
    const modal = document.getElementById("win-modal");
    const bestGuess = gameState.guesses.find((g) => g.rank === 1);
    document.getElementById("win-word").textContent = bestGuess
        ? bestGuess.word
        : "???";
    document.getElementById("win-stats").textContent =
        `${gameState.guesses.length}번 만에 맞혔습니다!`;
    modal.classList.remove("hidden");
    disableInput();
    saveGameStats();
}

function closeWin() {
    document.getElementById("win-modal").classList.add("hidden");
}

/* ── 통계 기록 ─────────────────────────────────────── */
function saveGameStats() {
    try {
        const raw = localStorage.getItem(STATS_KEY);
        const stats = raw ? JSON.parse(raw) : { games: 0, wins: 0, streak: 0, best: null };
        stats.games++;
        stats.wins++;
        stats.streak++;
        const tries = gameState.guesses.length;
        if (!stats.best || tries < stats.best) stats.best = tries;
        localStorage.setItem(STATS_KEY, JSON.stringify(stats));
    } catch { /* 무시 */ }
}

/* ── 결과 공유 ─────────────────────────────────────── */
function shareResult() {
    const guesses = gameState.guesses;
    const sorted = [...guesses].sort((a, b) => a.guessNum - b.guessNum);
    const emojis = sorted
        .map((g) => {
            if (g.rank === 1) return "\u2705";
            if (g.rank <= 10) return "\ud83d\udfe5";
            if (g.rank <= 100) return "\ud83d\udfe7";
            if (g.rank <= 1000) return "\ud83d\udfe8";
            return "\u2b1c";
        })
        .join("");

    const text =
        `\ucf54\ub9e8\ud2c0 #${puzzleNumber}\n` +
        `${guesses.length}\ubc88 \ub9cc\uc5d0 \ub9de\ud614\uc2b5\ub2c8\ub2e4!\n` +
        emojis;

    navigator.clipboard.writeText(text).then(() => {
        const el = document.getElementById("share-copied");
        el.classList.remove("hidden");
        setTimeout(() => el.classList.add("hidden"), 2000);
    });
}

/* ── 도움말 ────────────────────────────────────────── */
function openHelp() {
    document.getElementById("help-modal").classList.remove("hidden");
}

function closeHelp() {
    document.getElementById("help-modal").classList.add("hidden");
}

// 모달 배경 클릭으로 닫기
document.addEventListener("click", (e) => {
    if (e.target.classList.contains("modal-backdrop")) {
        e.target.closest(".modal").classList.add("hidden");
    }
});

// ESC로 모달 닫기
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
        document.querySelectorAll(".modal:not(.hidden)").forEach((m) =>
            m.classList.add("hidden")
        );
    }
});

/* ── 컨페티 애니메이션 ─────────────────────────────── */
function launchConfetti() {
    const canvas = document.getElementById("confetti-canvas");
    const ctx = canvas.getContext("2d");
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const particles = [];
    const colors = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#3b82f6", "#c084fc", "#f472b6"];

    for (let i = 0; i < 120; i++) {
        particles.push({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height - canvas.height,
            w: Math.random() * 8 + 4,
            h: Math.random() * 6 + 3,
            color: colors[Math.floor(Math.random() * colors.length)],
            vx: (Math.random() - 0.5) * 4,
            vy: Math.random() * 3 + 2,
            rot: Math.random() * 360,
            rotSpeed: (Math.random() - 0.5) * 10,
            opacity: 1,
        });
    }

    let frame = 0;
    const maxFrames = 180;

    function animate() {
        if (frame >= maxFrames) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            return;
        }
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const fade = frame > maxFrames * 0.7 ? 1 - (frame - maxFrames * 0.7) / (maxFrames * 0.3) : 1;

        particles.forEach((p) => {
            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.05;
            p.rot += p.rotSpeed;

            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate((p.rot * Math.PI) / 180);
            ctx.globalAlpha = fade * p.opacity;
            ctx.fillStyle = p.color;
            ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
            ctx.restore();
        });

        frame++;
        requestAnimationFrame(animate);
    }

    animate();
}
