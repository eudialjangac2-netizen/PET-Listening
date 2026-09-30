/* =====================================================================
   FULL TEST LISTENING - ENGINE
   ===================================================================== */
(function (window, document) {
  "use strict";

  const FullTest = {};

  const STUDENT_TEST_CODE = "72PETRB"; // mã xác nhận bài tập (giữ chung với hệ thống Listening hiện tại)
  const TEACHER_NAME = "GVPET72";
  const TEACHER_CODE = "72GRADEBPET";
  // ⚠️ Webhook dùng theo ghi chú "dùng chung toàn hệ thống" — ĐỐI CHIẾU LẠI với
  // đúng giá trị SHEET_WEBHOOK_URL hiện có trong config.js thật trên GitHub trước khi deploy.
  const WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbwriNrQ7B7sLQqb5pOIGkFk8mOsrOmS1aAvZJ4m6jS3VWreAtcG_x2d6ToSnOF8mdmfrg/exec";

  // Bảng quy đổi CHÍNH THỨC Cambridge PET Listening (0-25 câu đúng -> PET Score /170)
  // Chỉ áp dụng khi Full Test có ĐỦ 25 câu (đủ cả 4 Part) — chọn ít hơn thì không quy đổi.
  const LISTENING_SCORE_TABLE = {
    0: 0, 1: 20, 2: 41, 3: 61, 4: 82, 5: 102, 6: 105, 7: 108, 8: 111, 9: 114,
    10: 117, 11: 120, 12: 123, 13: 126, 14: 129, 15: 131, 16: 134, 17: 137, 18: 140, 19: 144,
    20: 148, 21: 152, 22: 156, 23: 160, 24: 165, 25: 170,
  };
  const FULL_LISTENING_TOTAL = 25;

  let testLabel = "Listening full test";
  let exerciseIds = [];
  let durationMinutes = 45;
  let exercises = []; // [{ id, data, html, questions, layout }]
  let allQuestions = [];
  let answeredSet = new Set();
  let markedSet = new Set();
  let activeTabIndex = 0;

  let studentRoster = null;
  let studentName = "";
  let studentCodeUsed = "";
  let isTeacher = false;
  let antiCheatBypassed = false;
  let tabSwitchCount = 0;
  let startTime = null;
  let timerInterval = null;
  let endTimestamp = null;
  let submitted = false;
  let lastPerQuestionResult = [];

  // Trạng thái nghe audio riêng từng bài (key = exercise id)
  let halfListenedMap = {};
  let lastAudioTimeMap = {};
  let currentActiveAudioEl = null;

  // Chống spam-click bubble / gõ nhanh
  let isSpamBlocked = false;
  let rapidClickCount = 0;
  let lastMCQClickTime = 0;
  let lastClickedItem = null;
  let lastGapInputTime = 0;
  let lastGapInputEl = null;

  // ---------------------------------------------------------------------
  // KHỞI ĐỘNG
  // ---------------------------------------------------------------------
  async function boot() {
    const params = new URLSearchParams(window.location.search);
    exerciseIds = (params.get("ids") || "").split(",").map(s => s.trim()).filter(Boolean);
    durationMinutes = Math.max(1, parseInt(params.get("duration"), 10) || 45);
    testLabel = params.get("label") || ("Listening full test - " + formatShortDate(new Date()));

    if (exerciseIds.length === 0) {
      document.body.innerHTML = "<p style='padding:40px;font-family:sans-serif;'>⚠️ Thiếu tham số <code>?ids=</code> trên URL.</p>";
      return;
    }

    wireAntiCopy();
    wireTabSwitchCounter();
    wireSpamGuards();

    const [rosterList, loadedExercises] = await Promise.all([loadRoster(), loadExercises()]);
    studentRoster = rosterList;
    exercises = loadedExercises;

    if (exercises.length === 0) {
      document.body.innerHTML = "<p style='padding:40px;font-family:sans-serif;'>⚠️ Không tải được bài nào từ danh sách đã chọn.</p>";
      return;
    }

    buildGlobalQuestionList();
    renderLoginInfoBadge();
    wireLoginForm();
    wireTeacherToolbar();
    wirePalette();
  }

  async function loadRoster() {
    try {
      const res = await fetch("students.json");
      if (!res.ok) throw new Error("HTTP " + res.status);
      const list = await res.json();
      return new Map(list.map(s => [String(s.code).toUpperCase(), s.name]));
    } catch (err) {
      console.warn("Không tải được students.json", err);
      return new Map();
    }
  }

  async function loadExercises() {
    const results = await Promise.all(exerciseIds.map(async (id) => {
      try {
        const res = await fetch(`exercises/${id}.json`);
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();
        return { id, data };
      } catch (err) {
        console.warn("⚠️ Bỏ qua bài lỗi:", id, err);
        return null;
      }
    }));
    return results.filter(Boolean);
  }

  function buildGlobalQuestionList() {
    let cursor = 1;
    exercises.forEach(ex => {
      const renderFn = pickFtRenderer(ex.data);
      const result = renderFn(ex.data, cursor);
      ex.html = result.html;
      ex.questions = result.questions;
      ex.layout = result.layout;
      result.questions.forEach(q => { q.partLabel = ex.data.part || ex.data.id; });
      cursor += result.questions.length;
      allQuestions = allQuestions.concat(result.questions);
    });
  }

  function formatShortDate(d) {
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yy = String(d.getFullYear()).slice(-2);
    return `${dd}.${mm}.${yy}`;
  }

  function renderLoginInfoBadge() {
    const badge = document.getElementById("ftInfoBadge");
    badge.innerHTML = `📋 <b>${testLabel}</b><br>Gồm <b>${allQuestions.length} câu</b> · Thời gian làm bài: <b>${durationMinutes} phút</b>`;
  }

  // ---------------------------------------------------------------------
  // ĐĂNG NHẬP
  // ---------------------------------------------------------------------
  function wireLoginForm() {
    document.getElementById("ftStartBtn").addEventListener("click", handleLogin);
  }

  function handleLogin() {
    const codeInput = (document.getElementById("ftStudentCode").value || "").trim();
    const accessInput = (document.getElementById("ftAccessCode").value || "").trim();
    const errEl = document.getElementById("ftLoginErr");
    errEl.textContent = "";

    if (!codeInput) { alert("Vui lòng nhập Mã học sinh!"); return; }

    if (codeInput === TEACHER_NAME && accessInput === TEACHER_CODE) {
      isTeacher = true;
      antiCheatBypassed = true;
      studentName = "Giáo viên (QA)";
      studentCodeUsed = codeInput;
      document.getElementById("ftTeacherBar").style.display = "flex";
      document.body.classList.add("ft-teacher");
      startApp();
      return;
    }

    if (accessInput !== STUDENT_TEST_CODE) {
      alert("Mã xác nhận bài tập không đúng!");
      return;
    }

    const matchedName = studentRoster ? studentRoster.get(codeInput.toUpperCase()) : undefined;
    if (!matchedName) {
      errEl.textContent = "Mã học sinh không có trong danh sách lớp. Kiểm tra lại hoặc hỏi giáo viên.";
      return;
    }

    isTeacher = false;
    studentName = matchedName;
    studentCodeUsed = codeInput.toUpperCase();
    startApp();
  }

  function startApp() {
    startTime = new Date();
    endTimestamp = Date.now() + durationMinutes * 60 * 1000;
    buildWatermark();
    buildTabs();
    buildPaletteGrid();
    showTab(0);
    startTimer();

    document.getElementById("ftLoginScreen").style.display = "none";
    document.getElementById("ftApp").style.display = "flex";
    document.getElementById("ftPaletteToggle").style.display = "flex";
    document.getElementById("ftTestTitle").textContent = "🐋 " + testLabel;

    document.getElementById("ftSubmitBtn").addEventListener("click", () => confirmSubmit(false));
    document.getElementById("ftConfirmCancelBtn").addEventListener("click", () => {
      document.getElementById("ftConfirmSubmitModal").classList.remove("show");
    });
    document.getElementById("ftConfirmOkBtn").addEventListener("click", () => {
      document.getElementById("ftConfirmSubmitModal").classList.remove("show");
      submitFullTest(false);
    });
    document.getElementById("ftBackToResultBtn").addEventListener("click", () => {
      document.getElementById("ftApp").style.display = "none";
      document.getElementById("ftPaletteDrawer").classList.remove("open");
      document.getElementById("ftPaletteToggle").style.display = "none";
      document.getElementById("ftResultScreen").style.display = "block";
    });
    checkPendingRedo();
  }

  async function checkPendingRedo() {
    if (isTeacher || !studentCodeUsed) return;
    try {
      const res = await fetch(`${WEBHOOK_URL}?studentCode=${encodeURIComponent(studentCodeUsed)}`);
      if (!res.ok) return;
      const data = await res.json();
      const currentIds = new Set(exercises.map(e => e.id));
      const pending = (data.pending || []).filter(id => !currentIds.has(id));
      if (pending.length === 0) return;
      const banner = document.createElement("div");
      banner.id = "ftRedoBanner";
      banner.style.cssText = "background:#fff3e1;border-bottom:2px solid #f6ad55;padding:10px 20px;font-size:13px;color:#9a6a1c;";
      banner.innerHTML = `⏳ <b>Bạn còn ${pending.length} Part khác từ lần thi trước chưa làm lại đúng 100%:</b> ` +
        pending.map(id => `<a href="bai-tap.html?id=${id}" style="color:#c05621;font-weight:700;">${id}</a>`).join(", ");
      const app = document.getElementById("ftApp");
      app.insertBefore(banner, app.firstChild);
    } catch (err) {
      console.warn("Không tra được danh sách cần làm lại:", err);
    }
  }

  // ---------------------------------------------------------------------
  // TABS THEO PART
  // ---------------------------------------------------------------------
  function buildTabs() {
    const bar = document.getElementById("ftTabbar");
    bar.innerHTML = exercises.map((ex, i) => `<div class="ft-tab" data-index="${i}">🐋 ${ex.data.part || ex.id}</div>`).join("");

    const content = document.getElementById("ftMainContent");
    content.innerHTML = exercises.map((ex, i) => `
      <div class="ft-part-view" data-index="${i}">${ex.html}</div>
    `).join("");

    bar.querySelectorAll(".ft-tab").forEach(tab => {
      tab.addEventListener("click", () => showTab(Number(tab.getAttribute("data-index"))));
    });

    // Gắn error-handler an toàn cho ảnh (thay vì inline onerror trong chuỗi HTML)
    content.querySelectorAll("img[data-fallback-src]").forEach(img => {
      img.addEventListener("error", function () {
        const ph = document.createElement("div");
        ph.className = "img-placeholder";
        ph.innerHTML = `🖼️ Hình ảnh câu hỏi chưa có sẵn<br><small>${img.getAttribute("data-fallback-src")}</small>`;
        if (img.parentNode) img.parentNode.replaceChild(ph, img);
      });
    });

    // Gán src audio + gắn khoá tua (mỗi bài riêng, theo dõi trạng thái nghe qua 1/2 riêng)
    content.querySelectorAll(".ft-audio").forEach(audio => {
      const exId = audio.getAttribute("data-ex-id");
      const ex = exercises.find(e => e.id === exId);
      if (ex) audio.src = ex.data.audio;
      halfListenedMap[exId] = false;
      lastAudioTimeMap[exId] = 0;
      attachAudioGuards(audio, exId);
    });
  }

  function attachAudioGuards(audio, exId) {
    audio.addEventListener("play", function () { currentActiveAudioEl = audio; });
    audio.addEventListener("seeking", function () {
      if (isTeacher) return;
      if (!halfListenedMap[exId]) {
        if (Math.abs(this.currentTime - lastAudioTimeMap[exId]) > 1.0) {
          this.currentTime = lastAudioTimeMap[exId];
          showToast("⚠️ <b>Tính năng tua bị khoá trong 1/2 thời lượng đầu!</b><br>Chỉ có thể Phát/Dừng hoặc chỉnh Tốc độ.");
        }
      }
    });
    audio.addEventListener("timeupdate", function () {
      if (Math.abs(this.currentTime - lastAudioTimeMap[exId]) <= 1.0) lastAudioTimeMap[exId] = this.currentTime;
      if (!halfListenedMap[exId] && !isNaN(this.duration) && this.currentTime >= this.duration / 2) {
        halfListenedMap[exId] = true;
      }
    });
  }

  function showTab(index, scrollToGlobalIndex) {
    activeTabIndex = index;
    // Tạm dừng audio của tab đang rời đi, tránh chồng tiếng khi đổi tab
    document.querySelectorAll(".ft-audio").forEach(a => a.pause());

    document.querySelectorAll(".ft-part-view").forEach(v => {
      v.classList.toggle("active", Number(v.getAttribute("data-index")) === index);
    });
    document.querySelectorAll(".ft-tab").forEach(tab => {
      tab.classList.toggle("active", Number(tab.getAttribute("data-index")) === index);
    });

    if (scrollToGlobalIndex) {
      setTimeout(() => {
        const el = document.getElementById(`ft-q-${scrollToGlobalIndex}`);
        if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 50);
    }
  }

  function tabIndexForGlobalQuestion(g) {
    return exercises.findIndex(ex => ex.questions.some(q => q.globalIndex === g));
  }

  // ---------------------------------------------------------------------
  // TRẢ LỜI + PALETTE
  // ---------------------------------------------------------------------
  FullTest.onAnswer = function (g) {
    const q = allQuestions.find(x => x.globalIndex === g);
    if (!q) return;
    const val = q.getValue();
    if (val && val !== "") answeredSet.add(g); else answeredSet.delete(g);
    updatePaletteBox(g);
  };

  function buildPaletteGrid() {
    const grid = document.getElementById("ftPaletteGrid");
    grid.innerHTML = allQuestions.map(q => `<div class="ft-pal-box" data-g="${q.globalIndex}">${q.globalIndex}</div>`).join("");
    grid.querySelectorAll(".ft-pal-box").forEach(box => {
      const g = Number(box.getAttribute("data-g"));
      box.addEventListener("click", () => {
        const idx = tabIndexForGlobalQuestion(g);
        showTab(idx, g);
        document.getElementById("ftPaletteDrawer").classList.remove("open");
      });
      box.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        if (submitted) return;
        showContextMenu(e.pageX, e.pageY, g);
      });
    });
  }

  function updatePaletteBox(g) {
    const box = document.querySelector(`.ft-pal-box[data-g="${g}"]`);
    if (!box) return;
    box.classList.toggle("answered", answeredSet.has(g));
    box.classList.toggle("marked", markedSet.has(g));
  }

  function showContextMenu(x, y, g) {
    const menu = document.getElementById("ftContextMenu");
    const isMarked = markedSet.has(g);
    menu.innerHTML = `<div id="ftCtxToggleMark">${isMarked ? "✅ Bỏ đánh dấu" : "🚩 Đánh dấu xem lại"}</div>`;
    menu.style.left = x + "px";
    menu.style.top = y + "px";
    menu.style.display = "block";
    document.getElementById("ftCtxToggleMark").addEventListener("click", () => {
      if (markedSet.has(g)) markedSet.delete(g); else markedSet.add(g);
      updatePaletteBox(g);
      menu.style.display = "none";
    });
  }
  document.addEventListener("click", () => {
    const menu = document.getElementById("ftContextMenu");
    if (menu) menu.style.display = "none";
  });

  function wirePalette() {
    document.getElementById("ftPaletteToggle").addEventListener("click", () => {
      document.getElementById("ftPaletteDrawer").classList.toggle("open");
    });
    document.getElementById("ftPaletteCloseBtn").addEventListener("click", () => {
      document.getElementById("ftPaletteDrawer").classList.remove("open");
    });
    const rotateBtn = document.getElementById("ftRotateDismissBtn");
    if (rotateBtn) rotateBtn.addEventListener("click", () => document.body.classList.add("ft-rotate-dismissed"));
  }

  // ---------------------------------------------------------------------
  // CHỐNG SPAM-CLICK BUBBLE / GÕ NHANH (giống bai-tap.html, bỏ qua nếu giáo viên)
  // ---------------------------------------------------------------------
  function showToast(msg) {
    const toastEl = document.getElementById("toast");
    toastEl.innerHTML = msg;
    toastEl.classList.add("show");
    setTimeout(() => toastEl.classList.remove("show"), 4000);
  }

  function triggerSpamBlock(secs) {
    isSpamBlocked = true;
    const overlay = document.getElementById("spam-overlay");
    const countdownEl = document.getElementById("spam-countdown");
    overlay.style.display = "flex";
    let left = secs;
    countdownEl.textContent = left;
    const intv = setInterval(() => {
      left--;
      if (left <= 0) { clearInterval(intv); overlay.style.display = "none"; isSpamBlocked = false; }
      else countdownEl.textContent = left;
    }, 1000);
  }

  function wireSpamGuards() {
    document.addEventListener("click", function (e) {
      if (!e.target.classList.contains("bubble")) return;
      if (submitted) return; // đã nộp bài (đang ở chế độ xem lại) -> khoá, không cho đổi đáp án nữa
      const item = e.target.closest(".mcq-item");
      const g = item ? Number(item.getAttribute("data-g")) : null;
      if (isSpamBlocked) return;
      if (!isTeacher) {
        const now = Date.now();
        if (now - lastMCQClickTime < 1500) {
          if (lastClickedItem !== item) {
            rapidClickCount++;
            let penalty = 3; if (rapidClickCount === 3 || rapidClickCount === 4) penalty = 5; if (rapidClickCount >= 5) penalty = 7;
            triggerSpamBlock(penalty);
            return;
          }
        } else if (now - lastMCQClickTime > 5000) { rapidClickCount = 0; }
        lastMCQClickTime = now; lastClickedItem = item;
      }
      const row = e.target.closest(".bubble-row");
      if (row) { row.querySelectorAll(".bubble").forEach(b => b.classList.remove("selected")); e.target.classList.add("selected"); }
      if (g !== null) FullTest.onAnswer(g);
    });

    document.addEventListener("input", function (e) {
      if (!e.target.classList.contains("answer-input")) return;
      if (isSpamBlocked) { e.target.value = ""; e.target.blur(); return; }
      if (isTeacher) return;
      const now = Date.now();
      if (lastGapInputEl !== null && lastGapInputEl !== e.target && (now - lastGapInputTime < 2000)) {
        e.target.value = ""; e.target.blur(); triggerSpamBlock(3);
      }
      lastGapInputEl = e.target; lastGapInputTime = now;
    });
  }

  // ---------------------------------------------------------------------
  // ĐỒNG HỒ ĐẾM NGƯỢC
  // ---------------------------------------------------------------------
  function startTimer() {
    updateTimerDisplay();
    timerInterval = setInterval(() => {
      const remaining = endTimestamp - Date.now();
      if (remaining <= 0) { clearInterval(timerInterval); updateTimerDisplay(); confirmSubmit(true); return; }
      updateTimerDisplay();
    }, 1000);
  }

  function updateTimerDisplay() {
    const remaining = Math.max(0, endTimestamp - Date.now());
    const totalSec = Math.ceil(remaining / 1000);
    const mm = Math.floor(totalSec / 60);
    const ss = totalSec % 60;
    const el = document.getElementById("ftTimer");
    el.textContent = `${mm}:${String(ss).padStart(2, "0")}`;
    el.classList.toggle("low", totalSec <= 300);
  }

  // ---------------------------------------------------------------------
  // NỘP BÀI + CHẤM ĐIỂM
  // ---------------------------------------------------------------------
  function confirmSubmit(isAuto) {
    if (submitted) return;
    if (isAuto) { submitFullTest(true); return; }
    showConfirmSubmitModal();
  }

  function showConfirmSubmitModal() {
    const total = allQuestions.length;
    const unansweredIds = allQuestions.filter(q => !answeredSet.has(q.globalIndex)).map(q => q.globalIndex);
    const markedIds = Array.from(markedSet);

    const modal = document.getElementById("ftConfirmSubmitModal");
    const body = document.getElementById("ftConfirmSubmitBody");

    let html = `<p><b>Đã làm ${total - unansweredIds.length}/${total} câu.</b></p>`;
    if (unansweredIds.length > 0) {
      html += `<p style="color:#c53030; margin-top:10px;">⚠️ Còn <b>${unansweredIds.length} câu chưa làm</b>:</p>
        <div class="ft-confirm-chip-row">${unansweredIds.map(g => `<span class="ft-confirm-chip ft-confirm-chip-unanswered" data-g="${g}">${g}</span>`).join("")}</div>`;
    } else {
      html += `<p style="color:#2e9b5f; margin-top:10px;">✅ Đã làm đủ tất cả các câu.</p>`;
    }
    if (markedIds.length > 0) {
      html += `<p style="margin-top:14px;">🚩 Đã đánh dấu xem lại <b>${markedIds.length} câu</b>:</p>
        <div class="ft-confirm-chip-row">${markedIds.map(g => `<span class="ft-confirm-chip ft-confirm-chip-marked" data-g="${g}">${g}</span>`).join("")}</div>`;
    }
    html += `<p style="margin-top:16px; font-weight:700;">Bạn có chắc chắn muốn nộp bài không? Sau khi nộp sẽ không thể sửa lại đáp án.</p>`;

    body.innerHTML = html;
    modal.classList.add("show");

    body.querySelectorAll(".ft-confirm-chip").forEach(chip => {
      chip.addEventListener("click", () => {
        const g = Number(chip.getAttribute("data-g"));
        modal.classList.remove("show");
        const idx = tabIndexForGlobalQuestion(g);
        showTab(idx, g);
      });
    });
  }

  function submitFullTest(isAuto) {
    submitted = true;
    if (timerInterval) clearInterval(timerInterval);
    document.querySelectorAll(".ft-audio").forEach(a => a.pause());

    let correctCount = 0;
    const subskillWrongCount = {};
    const perQuestionResult = [];
    allQuestions.forEach(q => {
      const val = q.getValue();
      const ok = q.isCorrect(val);
      const isMissing = !val || val === "";
      if (ok) { correctCount++; }
      else if (q.subskill) { subskillWrongCount[q.subskill] = (subskillWrongCount[q.subskill] || 0) + 1; }
      perQuestionResult.push({
        globalIndex: q.globalIndex, localId: q.localId, partLabel: q.partLabel, subskill: q.subskill,
        isCorrect: ok, status: ok ? "correct" : (isMissing ? "missing" : "wrong"),
        correctReason: ok ? q.correctReason : null,
      });
    });

    const total = allQuestions.length;
    const isFullListening = total === FULL_LISTENING_TOTAL;
    const petScore = isFullListening ? LISTENING_SCORE_TABLE[correctCount] : null;

    const weakest = Object.entries(subskillWrongCount)
      .sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([skill, count]) => `${skill} (sai ${count} câu)`);

    const weakPartIds = exercises
      .filter(ex => ex.questions.some(q => !q.isCorrect(q.getValue())))
      .map(ex => ex.id);

    const partsStatusSummary = exercises.map(ex => {
      const partTotal = ex.questions.length;
      const missingCount = ex.questions.filter(q => !q.getValue() || q.getValue() === "").length;
      const label = ex.data.part || ex.id;
      return missingCount === 0
        ? `${label}: Hoàn thành (${partTotal}/${partTotal})`
        : `${label}: Thiếu ${missingCount} câu (đã làm ${partTotal - missingCount}/${partTotal})`;
    }).join("; ");

    const now = new Date();
    const durationUsedMs = startTime ? (now - startTime) : 0;
    const durationUsedText = formatDuration(durationUsedMs);

    lastPerQuestionResult = perQuestionResult;
    renderResultScreen({ correctCount, total, petScore, isFullListening, weakest, perQuestionResult, durationUsedText, isAuto, now });

    const wrongItems = perQuestionResult.filter(r => !r.isCorrect);
    if (wrongItems.length > 0) {
      sendToGoogleSheets({
        recordType: "full_test_detail",
        studentCode: studentCodeUsed,
        studentName: studentName + (isTeacher ? " [TEST]" : ""),
        testName: testLabel,
        submittedAt: now.toLocaleString("vi-VN"),
        wrongItems: wrongItems.map(w => ({ partLabel: w.partLabel, localId: w.localId, globalIndex: w.globalIndex, subskill: w.subskill || "-" })),
      });
    }

    sendToGoogleSheets({
      recordType: "full_test",
      startTime: startTime ? startTime.toLocaleString("vi-VN") : "",
      endTime: now.toLocaleString("vi-VN"),
      studentName: studentName + (isTeacher ? " [TEST]" : ""),
      studentCode: studentCodeUsed,
      testName: testLabel,
      partsIncluded: exercises.map(e => e.data.title || e.id).join(", "),
      totalQuestions: total,
      correctCount: correctCount,
      scoreBand: isFullListening ? `PET Score: ${petScore}/170` : "Không đủ 25 câu - chưa quy đổi",
      weakestSubskills: weakest.join("; ") || "-",
      weakPartIds: weakPartIds.join(","),
      partsStatusSummary: partsStatusSummary,
      tabSwitchCount: tabSwitchCount,
      durationUsed: durationUsedText,
      autoSubmitted: isAuto,
    });
  }

  function formatDuration(ms) {
    const totalSeconds = Math.max(0, Math.round(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes === 0) return `${seconds} giây`;
    return `${minutes} phút ${seconds} giây`;
  }

  function renderResultScreen({ correctCount, total, petScore, isFullListening, weakest, perQuestionResult, durationUsedText, isAuto, now }) {
    document.getElementById("ftApp").style.display = "none";
    document.getElementById("ftPaletteToggle").style.display = "none";
    document.getElementById("ftPaletteDrawer").classList.remove("open");
    const screen = document.getElementById("ftResultScreen");
    screen.style.display = "block";

    const pct = total > 0 ? Math.round((correctCount / total) * 100) : 0;
    let emoji, heading;
    if (pct >= 80) { emoji = "🎉"; heading = "Đã hoàn thành xuất sắc!"; }
    else if (pct >= 50) { emoji = "👍"; heading = "Đã hoàn thành bài thi"; }
    else { emoji = "📝"; heading = "Đã hoàn thành bài thi — cần luyện tập thêm"; }
    document.getElementById("ftResultEmoji").textContent = emoji;
    document.getElementById("ftResultHeading").textContent = heading;

    document.getElementById("ftResultSummary").innerHTML = `
      <div><span class="label">👤 Học sinh</span><span class="value">${studentName}</span></div>
      <div><span class="label">📅 Ngày làm bài</span><span class="value">${now.toLocaleDateString("vi-VN")}</span></div>
      <div><span class="label">⏱️ Thời gian làm bài</span><span class="value">${durationUsedText}</span></div>
      <div><span class="label">✅ Số câu đúng</span><span class="value">${correctCount}/${total}</span></div>
      ${isAuto ? `<div><span class="label">⏰ Trạng thái</span><span class="value">Tự động nộp (hết giờ)</span></div>` : ""}
    `;

    if (isFullListening) {
      document.getElementById("ftBandBox").innerHTML = `
        <div class="band">${petScore} / 170</div>
        <div class="ft-band-disclaimer">📊 Điểm PET Score (Listening) — quy đổi theo bảng chính thức Cambridge cho bài Listening đầy đủ (25 câu).</div>
      `;
    } else {
      document.getElementById("ftBandBox").innerHTML = `
        <div class="band" style="font-size:16px;">Chưa đủ điều kiện quy đổi PET Score</div>
        <div class="ft-band-disclaimer">Bài thi này chỉ gồm ${total}/25 câu (chưa đủ cả 4 Part) nên không tra được điểm PET Score chính thức. Làm đủ Full Test 4 Part (25 câu) để xem điểm quy đổi.</div>
      `;
    }

    const improveList = document.getElementById("ftImproveList");
    const allCorrect = correctCount === total;
    if (weakest.length > 0) {
      improveList.innerHTML = weakest.map(w => `<li>${w}</li>`).join("");
    } else if (allCorrect) {
      improveList.innerHTML = `<li>🎉 Không có điểm yếu nổi bật — làm rất tốt!</li>`;
    } else {
      improveList.innerHTML = `<li>Bài này có ${total - correctCount} câu sai, nhưng chưa có đủ dữ liệu phân loại kỹ năng (subskill) để đưa ra gợi ý cụ thể. Xem lại đáp án đúng trực tiếp trong từng Part.</li>`;
    }

    const detailBox = document.getElementById("ftDetailList");
    if (detailBox) {
      detailBox.innerHTML = perQuestionResult.map(r => {
        if (r.status === "correct") {
          return `<li class="ft-detail-item ft-detail-correct">
            <div class="ft-detail-head">✅ Câu ${r.globalIndex} — ${r.partLabel}</div>
            ${r.correctReason ? `<div class="ft-detail-reason">${r.correctReason}</div>` : ""}
          </li>`;
        }
        if (r.status === "missing") {
          return `<li class="ft-detail-item ft-detail-missing"><div class="ft-detail-head">⚠️ Câu ${r.globalIndex} — ${r.partLabel} (chưa làm)</div></li>`;
        }
        return `<li class="ft-detail-item ft-detail-wrong"><div class="ft-detail-head">❌ Câu ${r.globalIndex} — ${r.partLabel}</div></li>`;
      }).join("");
    }

    const retryBtn = document.getElementById("ftRetryBtn");
    if (retryBtn) retryBtn.onclick = () => window.location.reload();
    const reviewBtn = document.getElementById("ftReviewBtn");
    if (reviewBtn) reviewBtn.onclick = enterReviewMode;
  }

  // ---------------------------------------------------------------------
  // CHẾ ĐỘ XEM LẠI BÀI LÀM
  // ---------------------------------------------------------------------
  function enterReviewMode() {
    document.getElementById("ftResultScreen").style.display = "none";
    document.getElementById("ftApp").style.display = "flex";
    document.getElementById("ftSubmitBtn").style.display = "none";
    document.getElementById("ftBackToResultBtn").style.display = "inline-block";
    document.getElementById("ftReviewModeBadge").style.display = "inline-block";
    document.getElementById("ftTimer").style.display = "none";

    document.querySelectorAll("#ftMainContent input, #ftMainContent select, #ftMainContent textarea").forEach(el => { el.disabled = true; });

    lastPerQuestionResult.forEach(r => {
      const item = document.getElementById(`ft-q-${r.globalIndex}`);
      if (item) {
        const bubble = item.querySelector(".bubble.selected");
        const input = item.querySelector(".answer-input");
        if (bubble) bubble.classList.add(`ft-review-${r.status === "correct" ? "correct" : "wrong"}`);
        if (input) input.classList.add(`ft-review-${r.status === "correct" ? "correct" : "wrong"}`);
      }
      const box = document.querySelector(`.ft-pal-box[data-g="${r.globalIndex}"]`);
      if (box) { box.classList.remove("answered", "marked"); box.classList.add(`review-${r.status}`); }
    });

    showTab(0);
    document.getElementById("ftPaletteToggle").style.display = "flex";
  }

  function sendToGoogleSheets(payload) {
    fetch(WEBHOOK_URL, {
      method: "POST", mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
    }).catch(err => console.log("Google Sheets logging error: ", err));
  }

  // ---------------------------------------------------------------------
  // WATERMARK / ANTI-COPY / TAB-SWITCH
  // ---------------------------------------------------------------------
  function buildWatermark() {
    const wm = document.getElementById("watermark");
    if (!wm) return;
    const label = (studentName || "PET Listening Full Test") + " • " + new Date().toLocaleDateString("vi-VN");
    const html = [];
    for (let i = 0; i < 40; i++) html.push(`<span>${label}</span>`);
    wm.innerHTML = html.join("");
  }

  function wireAntiCopy() {
    document.addEventListener("copy", function (e) {
      if (antiCheatBypassed) return;
      e.preventDefault();
      if (e.clipboardData) e.clipboardData.setData("text/plain", "");
      showToast("🔒 Nội dung không thể sao chép.");
    });
    document.addEventListener("cut", function (e) { if (!antiCheatBypassed) e.preventDefault(); });
    document.addEventListener("contextmenu", function (e) {
      if (e.target.closest && e.target.closest(".ft-pal-box")) return;
      if (!antiCheatBypassed) e.preventDefault();
    });
    document.addEventListener("dragstart", function (e) { if (!antiCheatBypassed) e.preventDefault(); });
    document.addEventListener("keydown", function (e) {
      if (antiCheatBypassed) return;
      if ((e.ctrlKey || e.metaKey) && ["c", "C", "x", "X", "p", "P"].includes(e.key)) { e.preventDefault(); showToast("🔒 Thao tác sao chép / in ấn bị cấm!"); }
    });
  }

  function wireTabSwitchCounter() {
    document.addEventListener("visibilitychange", function () {
      if (document.hidden && !antiCheatBypassed) {
        tabSwitchCount++;
        const badge = document.getElementById("ftTabBadge");
        if (badge) badge.textContent = `Chuyển tab: ${tabSwitchCount} lần`;
      }
    });
  }

  // ---------------------------------------------------------------------
  // TEACHER QA TOOLBAR
  // ---------------------------------------------------------------------
  function wireTeacherToolbar() {
    document.getElementById("ftAutoFillCorrect").addEventListener("click", () => {
      allQuestions.forEach(q => q.setValue(q.correctValue));
    });
    document.getElementById("ftAutoFillMixed").addEventListener("click", () => {
      allQuestions.forEach((q, i) => q.setValue(i % 2 === 0 ? q.correctValue : (q.wrongValue || q.correctValue)));
    });
    document.getElementById("ftForceTimeout").addEventListener("click", () => { endTimestamp = Date.now() - 1000; });
    document.getElementById("ftTestSendSheet").addEventListener("click", () => {
      sendToGoogleSheets({
        recordType: "full_test",
        startTime: new Date().toLocaleString("vi-VN"),
        endTime: new Date().toLocaleString("vi-VN"),
        studentName: "TEST (giáo viên)",
        studentCode: "TEST",
        testName: "Full Test (test gửi Sheet)",
        partsIncluded: exercises.map(e => e.data.title || e.id).join(", "),
        totalQuestions: allQuestions.length,
        correctCount: 0,
        scoreBand: "-",
        weakestSubskills: "-",
        tabSwitchCount: 0,
        durationUsed: "-",
        autoSubmitted: false,
      });
      showToast("📤 Đã gửi 1 gói dữ liệu test tới Google Sheet.");
    });
    document.getElementById("ftTestRedoLookup").addEventListener("click", async () => {
      const testCode = prompt("Nhập mã học sinh cần tra cứu (vd: 72013NT):", "");
      if (!testCode) return;
      const url = `${WEBHOOK_URL}?studentCode=${encodeURIComponent(testCode)}`;
      try {
        const res = await fetch(url);
        const rawText = await res.text();
        alert(`URL đã gọi:\n${url}\n\nHTTP status: ${res.status}\n\nPhản hồi thô nhận được:\n${rawText}`);
      } catch (err) {
        alert(`LỖI khi gọi: ${err.message}\n\nURL đã gọi:\n${url}`);
      }
    });
  }

  window.FullTest = FullTest;
  window.addEventListener("DOMContentLoaded", boot);
})(window, document);
