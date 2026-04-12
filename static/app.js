/* ══════════════════════════════════════════════════════════
   코맨틀 – 클라이언트
   ══════════════════════════════════════════════════════════ */

/* ── 상수 ──────────────────────────────────────────────── */
const STORAGE_KEY   = "ko-semantle-state";
const STATS_KEY     = "ko-semantle-stats";
const ROOM_KEY      = "ko-semantle-room";
const POLL_INTERVAL = 3000;           // 멀티 방 상태 폴링 주기(ms)

/* ── 전역 상태 ─────────────────────────────────────────── */
let puzzleNumber = null;
let totalWords   = 0;

let gameState = {
    puzzleNumber: null,
    guesses: [],
    solved: false,
    givenUp: false,
};

// 멀티플레이어
let multiState = {
    active: false,
    roomId: null,
    playerId: null,
    playerName: null,
};
let pollTimer = null;

/* ══════════════════════════════════════════════════════════
   초기화
   ══════════════════════════════════════════════════════════ */
document.addEventListener("DOMContentLoaded", init);

async function init() {
    try {
        const res  = await fetch("/api/puzzle");
        const data = await res.json();
        puzzleNumber = data.puzzleNumber;
        totalWords   = data.totalWords;
        document.getElementById("puzzle-number").textContent = `#${puzzleNumber}`;

        loadState();
        loadRoomState();
        renderGuesses();
        updateStats();

        if (gameState.solved) { showWinModal(); showTop100Btn(); }
        if (gameState.givenUp) { disableInput(); showTop100Btn(); }
        if (multiState.active) restoreMultiSession();

        document.getElementById("guess-input").focus();
    } catch {
        showError("서버에 연결할 수 없습니다.");
    }
}

/* ══════════════════════════════════════════════════════════
   로컬 스토리지
   ══════════════════════════════════════════════════════════ */
function loadState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const saved = JSON.parse(raw);
        if (saved.puzzleNumber === puzzleNumber) gameState = saved;
    } catch {/* */}
}
function saveState() {
    gameState.puzzleNumber = puzzleNumber;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(gameState));
}
function loadRoomState() {
    try {
        const raw = localStorage.getItem(ROOM_KEY);
        if (!raw) return;
        const saved = JSON.parse(raw);
        if (saved.puzzleNumber === puzzleNumber) multiState = saved;
    } catch {/* */}
}
function saveRoomState() {
    multiState.puzzleNumber = puzzleNumber;
    localStorage.setItem(ROOM_KEY, JSON.stringify(multiState));
}

/* ══════════════════════════════════════════════════════════
   추측 제출
   ══════════════════════════════════════════════════════════ */
async function handleSubmit(e) {
    e.preventDefault();
    if (gameState.solved || gameState.givenUp) return;

    const input = document.getElementById("guess-input");
    const word  = input.value.trim();
    if (!word) return;

    if (gameState.guesses.some(g => g.word === word)) {
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
        const url  = multiState.active ? "/api/room/guess" : "/api/guess";
        const body = multiState.active
            ? { word, roomId: multiState.roomId, playerId: multiState.playerId }
            : { word };

        const res  = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        const data = await res.json();

        if (data.error) { showError(data.error); return; }

        gameState.guesses.push({
            word: data.word,
            similarity: data.similarity,
            rank: data.rank,
            guessNum: gameState.guesses.length + 1,
        });

        if (data.isCorrect) {
            gameState.solved = true;
            showWinModal();
            showTop100Btn();
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

/* ══════════════════════════════════════════════════════════
   렌더링
   ══════════════════════════════════════════════════════════ */
function renderGuesses() {
    const list   = document.getElementById("guesses-list");
    const sorted = [...gameState.guesses].sort((a, b) => b.similarity - a.similarity);

    list.innerHTML = sorted.map(g => {
        const cls      = rankClass(g.rank);
        const barW     = Math.max(1, Math.min(100, g.similarity));
        const rankText = g.rank <= 1000 ? `${g.rank}위` : `${Math.ceil(g.rank/1000)}k+`;
        return `
        <div class="guess-row ${cls}" data-word="${g.word}">
            <span class="guess-num">${g.guessNum}</span>
            <span class="guess-word">${g.word}</span>
            <span class="guess-sim">${g.similarity.toFixed(2)}</span>
            <span class="guess-rank">${rankText}</span>
            <div class="guess-bar-wrap"><div class="guess-bar-fill" style="width:${barW}%"></div></div>
        </div>`;
    }).join("");
}

function rankClass(rank) {
    if (rank === 1)    return "rank-exact";
    if (rank <= 10)    return "rank-top10";
    if (rank <= 100)   return "rank-top100";
    if (rank <= 1000)  return "rank-top1000";
    return "rank-cold";
}

function updateStats() {
    document.getElementById("guess-count").textContent = gameState.guesses.length;
    if (!gameState.guesses.length) {
        document.getElementById("best-rank").textContent = "-";
        document.getElementById("best-sim").textContent  = "-";
        return;
    }
    const bestRank = Math.min(...gameState.guesses.map(g => g.rank));
    const bestSim  = Math.max(...gameState.guesses.map(g => g.similarity));
    document.getElementById("best-rank").textContent = bestRank <= 1000 ? `${bestRank}위` : `${Math.ceil(bestRank/1000)}k+`;
    document.getElementById("best-sim").textContent  = bestSim.toFixed(2);
}

function highlightGuess(word) {
    const row = document.querySelector(`.guess-row[data-word="${word}"]`);
    if (!row) return;
    row.classList.remove("highlight");
    void row.offsetWidth;
    row.classList.add("highlight");
    row.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/* ══════════════════════════════════════════════════════════
   에러
   ══════════════════════════════════════════════════════════ */
function showError(msg) {
    const el = document.getElementById("error-msg");
    el.textContent = msg;
    el.classList.remove("hidden");
    setTimeout(() => el.classList.add("hidden"), 3000);
}
function hideError() {
    document.getElementById("error-msg").classList.add("hidden");
}

/* ══════════════════════════════════════════════════════════
   포기
   ══════════════════════════════════════════════════════════ */
function openGiveUp() {
    if (gameState.solved || gameState.givenUp) return;
    document.getElementById("giveup-modal").classList.remove("hidden");
}

async function confirmGiveUp() {
    closeModal("giveup-modal");
    try {
        let url = "/api/give-up";
        let opts = {};
        if (multiState.active) {
            url = "/api/room/give-up";
            opts = {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ roomId: multiState.roomId, playerId: multiState.playerId }),
            };
        }
        const res  = await fetch(url, opts);
        const data = await res.json();
        gameState.givenUp = true;
        saveState();
        disableInput();
        showTop100Btn();
        showError(`정답은 "${data.answer}" 이었습니다.`);
    } catch {
        showError("서버 오류가 발생했습니다.");
    }
}

function disableInput() {
    document.getElementById("guess-input").disabled  = true;
    document.getElementById("submit-btn").disabled    = true;
    document.getElementById("giveup-btn").classList.add("hidden");
}

function showTop100Btn() {
    document.getElementById("top100-btn").classList.remove("hidden");
}

/* ══════════════════════════════════════════════════════════
   승리 모달
   ══════════════════════════════════════════════════════════ */
function showWinModal() {
    const best = gameState.guesses.find(g => g.rank === 1);
    document.getElementById("win-word").textContent  = best ? best.word : "???";
    document.getElementById("win-stats").textContent = `${gameState.guesses.length}번 만에 맞혔습니다!`;
    document.getElementById("win-modal").classList.remove("hidden");
    disableInput();
    saveGameStats();
}

function saveGameStats() {
    try {
        const raw   = localStorage.getItem(STATS_KEY);
        const stats = raw ? JSON.parse(raw) : { games:0, wins:0, streak:0, best:null };
        stats.games++;
        stats.wins++;
        stats.streak++;
        const tries = gameState.guesses.length;
        if (!stats.best || tries < stats.best) stats.best = tries;
        localStorage.setItem(STATS_KEY, JSON.stringify(stats));
    } catch {/* */}
}

/* ══════════════════════════════════════════════════════════
   Top 100
   ══════════════════════════════════════════════════════════ */
async function showTop100() {
    closeModal("win-modal");
    const list = document.getElementById("top100-list");
    list.innerHTML = '<p style="text-align:center;color:var(--text-dim)">불러오는 중...</p>';
    document.getElementById("top100-modal").classList.remove("hidden");

    try {
        const res  = await fetch("/api/top100");
        const data = await res.json();
        list.innerHTML = data.map(item => {
            const cls = rankClass(item.rank);
            const barW = Math.max(1, Math.min(100, item.similarity));
            return `
            <div class="top100-row ${cls}">
                <span class="t100-rank">${item.rank}</span>
                <span class="t100-word">${item.word}</span>
                <span class="t100-sim">${item.similarity.toFixed(2)}</span>
                <div class="guess-bar-wrap"><div class="guess-bar-fill" style="width:${barW}%"></div></div>
            </div>`;
        }).join("");
    } catch {
        list.innerHTML = '<p style="text-align:center;color:var(--hot)">불러오기 실패</p>';
    }
}

/* ══════════════════════════════════════════════════════════
   결과 공유
   ══════════════════════════════════════════════════════════ */
function shareResult() {
    const guesses = gameState.guesses;
    const sorted  = [...guesses].sort((a, b) => a.guessNum - b.guessNum);
    const emojis  = sorted.map(g => {
        if (g.rank === 1)    return "\u2705";
        if (g.rank <= 10)    return "\ud83d\udfe5";
        if (g.rank <= 100)   return "\ud83d\udfe7";
        if (g.rank <= 1000)  return "\ud83d\udfe8";
        return "\u2b1c";
    }).join("");

    const text = `\ucf54\ub9e8\ud2c0 #${puzzleNumber}\n${guesses.length}\ubc88 \ub9cc\uc5d0 \ub9de\ud614\uc2b5\ub2c8\ub2e4!\n${emojis}`;
    navigator.clipboard.writeText(text).then(() => {
        const el = document.getElementById("share-copied");
        el.classList.remove("hidden");
        setTimeout(() => el.classList.add("hidden"), 2000);
    });
}

/* ══════════════════════════════════════════════════════════
   멀티플레이어
   ══════════════════════════════════════════════════════════ */

// ── 모드 전환 ──
function switchSolo() {
    leaveRoom();
    document.getElementById("mode-solo-btn").classList.add("active");
    document.getElementById("mode-multi-btn").classList.remove("active");
}

function openMultiModal() {
    document.getElementById("multi-modal").classList.remove("hidden");
    document.getElementById("nickname-input").focus();
}

// ── 방 만들기 ──
async function createRoom() {
    const name = document.getElementById("nickname-input").value.trim() || "익명";
    try {
        const res  = await fetch("/api/room/create", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name }),
        });
        const data = await res.json();
        if (data.error) { showMultiError(data.error); return; }

        multiState = { active: true, roomId: data.roomId, playerId: data.playerId, playerName: name };
        saveRoomState();
        closeModal("multi-modal");
        enterMultiMode();
    } catch {
        showMultiError("서버 오류가 발생했습니다.");
    }
}

// ── 방 참여 ──
async function joinRoom() {
    const name   = document.getElementById("nickname-input").value.trim() || "익명";
    const roomId = document.getElementById("room-code-input").value.trim().toUpperCase();
    if (!roomId) { showMultiError("방 코드를 입력해주세요."); return; }

    try {
        const res  = await fetch("/api/room/join", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ roomId, name }),
        });
        const data = await res.json();
        if (data.error) { showMultiError(data.error); return; }

        multiState = { active: true, roomId: data.roomId, playerId: data.playerId, playerName: name };
        saveRoomState();
        closeModal("multi-modal");
        enterMultiMode();
    } catch {
        showMultiError("서버 오류가 발생했습니다.");
    }
}

// ── 멀티 모드 진입 ──
function enterMultiMode() {
    document.getElementById("mode-solo-btn").classList.remove("active");
    document.getElementById("mode-multi-btn").classList.add("active");
    document.getElementById("room-panel").classList.remove("hidden");
    document.getElementById("room-code-display").textContent = multiState.roomId;
    startPolling();
    pollRoomStatus();
}

function restoreMultiSession() {
    enterMultiMode();
}

// ── 방 나가기 ──
function leaveRoom() {
    multiState = { active: false, roomId: null, playerId: null, playerName: null };
    localStorage.removeItem(ROOM_KEY);
    document.getElementById("room-panel").classList.add("hidden");
    document.getElementById("mode-solo-btn").classList.add("active");
    document.getElementById("mode-multi-btn").classList.remove("active");
    stopPolling();
}

// ── 방 코드 복사 ──
function copyRoomCode() {
    if (!multiState.roomId) return;
    navigator.clipboard.writeText(multiState.roomId).then(() => {
        const btn = document.querySelector(".room-header-bar .btn-tiny");
        btn.textContent = "복사됨!";
        setTimeout(() => btn.textContent = "복사", 1500);
    });
}

// ── 폴링 ──
function startPolling() {
    stopPolling();
    pollTimer = setInterval(pollRoomStatus, POLL_INTERVAL);
}
function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

async function pollRoomStatus() {
    if (!multiState.active) return;
    try {
        const res  = await fetch(`/api/room/${multiState.roomId}`);
        const data = await res.json();
        if (data.error) { leaveRoom(); return; }
        renderPlayers(data.players);
    } catch {/* 네트워크 에러 무시 */}
}

function renderPlayers(players) {
    const list = document.getElementById("players-list");
    list.innerHTML = players.map(p => {
        const isMe   = p.playerId === multiState.playerId;
        const status = p.solved ? "정답!" : p.givenUp ? "포기" : `${p.guessCount}번 추측`;
        const top3   = p.top3.length
            ? p.top3.map(t => `<span class="p-top3-entry ${rankClass(t.rank)}">${t.rank}위 · ${t.similarity.toFixed(1)}</span>`).join("")
            : '<span class="p-top3-empty">아직 기록 없음</span>';

        return `
        <div class="player-card ${isMe ? 'player-me' : ''} ${p.solved ? 'player-solved' : ''}">
            <div class="player-info">
                <span class="player-name">${p.name}${isMe ? ' (나)' : ''}</span>
                <span class="player-status">${status}</span>
            </div>
            <div class="player-top3">${top3}</div>
        </div>`;
    }).join("");
}

function showMultiError(msg) {
    const el = document.getElementById("multi-error");
    el.textContent = msg;
    el.classList.remove("hidden");
    setTimeout(() => el.classList.add("hidden"), 3000);
}

/* ══════════════════════════════════════════════════════════
   모달 / 도움말
   ══════════════════════════════════════════════════════════ */
function openHelp()          { document.getElementById("help-modal").classList.remove("hidden"); }
function closeModal(id)      { document.getElementById(id).classList.add("hidden"); }

document.addEventListener("click", e => {
    if (e.target.classList.contains("modal-backdrop"))
        e.target.closest(".modal").classList.add("hidden");
});
document.addEventListener("keydown", e => {
    if (e.key === "Escape")
        document.querySelectorAll(".modal:not(.hidden)").forEach(m => m.classList.add("hidden"));
});

/* ══════════════════════════════════════════════════════════
   컨페티
   ══════════════════════════════════════════════════════════ */
function launchConfetti() {
    const canvas = document.getElementById("confetti-canvas");
    const ctx    = canvas.getContext("2d");
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;

    const colors    = ["#6366f1","#22c55e","#f59e0b","#ef4444","#3b82f6","#c084fc","#f472b6"];
    const particles = Array.from({ length: 120 }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height - canvas.height,
        w: Math.random() * 8 + 4,
        h: Math.random() * 6 + 3,
        color: colors[Math.floor(Math.random() * colors.length)],
        vx: (Math.random() - 0.5) * 4,
        vy: Math.random() * 3 + 2,
        rot: Math.random() * 360,
        rs: (Math.random() - 0.5) * 10,
    }));

    let frame = 0;
    const max = 180;
    (function animate() {
        if (frame >= max) { ctx.clearRect(0, 0, canvas.width, canvas.height); return; }
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const fade = frame > max * 0.7 ? 1 - (frame - max * 0.7) / (max * 0.3) : 1;
        particles.forEach(p => {
            p.x += p.vx; p.y += p.vy; p.vy += 0.05; p.rot += p.rs;
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rot * Math.PI / 180);
            ctx.globalAlpha = fade;
            ctx.fillStyle = p.color;
            ctx.fillRect(-p.w/2, -p.h/2, p.w, p.h);
            ctx.restore();
        });
        frame++;
        requestAnimationFrame(animate);
    })();
}
