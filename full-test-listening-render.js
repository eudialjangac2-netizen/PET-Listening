/* =====================================================================
   FULL TEST LISTENING - RENDER FUNCTIONS THEO TYPE
   Giữ NGUYÊN class/layout gốc của bai-tap.html (split-layout / panel-question /
   panel-answer / mcq-item / bubble-row / note-box / gapfill-answer-row...).
   Khác biệt so với renderMCQ()/renderGapFill() trong bai-tap.html:
     - Không thao tác DOM sẵn có, mà TRẢ VỀ 1 chuỗi HTML (html) để engine tự
       chèn vào đúng "view" (tab) riêng của bài đó
     - Số câu hiển thị là SỐ TOÀN CỤC (global index), không phải "num" gốc
     - Không tự gọi checkHalfListenAndAllAnswered / gửi Sheet — Full Test có
       bộ máy chấm điểm + timer + palette riêng (full-test-listening-engine.js)

   Mỗi hàm nhận (data, startIndex) — data là JSON gốc của 1 bài (test1-part1.json...),
   startIndex là số câu toàn cục bắt đầu (VD Part 2 bắt đầu từ câu 8 nếu Part 1 có 7 câu).
   Trả về:
   {
     html: "...",           // toàn bộ nội dung 1 tab (đã có class split-layout...)
     questions: [ { globalIndex, localId, subskill, correctReason,
                    getValue(), setValue(val), correctValue, wrongValue, isCorrect(val) } ],
     layout: "split"
   }
   ===================================================================== */

function subskillFor(data, num) {
  const e = (data.explanation || []).find(x => x.q === num);
  return e ? (e.subskill || null) : null;
}

function ftAudioBoxHtml(exId) {
  return `<div class="ft-audio-box"><audio class="ft-audio" id="ft-audio-${exId}" data-ex-id="${exId}" controls></audio></div>`;
}

/* ===== MCQ dùng chung cho cả 2 rightPanelMode (image / text) ===== */
function ftRenderMcqCommon(data, startIndex, mode) {
  const questions = [];

  const answerHtml = data.questions.map((q, i) => {
    const g = startIndex + i;
    questions.push({
      globalIndex: g, localId: q.num,
      subskill: subskillFor(data, q.num),
      correctReason: q.script || null,
      getValue: () => {
        const el = document.querySelector(`.mcq-item[data-g="${g}"] .bubble.selected`);
        return el ? el.getAttribute('data-val') : "";
      },
      setValue: (val) => {
        const item = document.querySelector(`.mcq-item[data-g="${g}"]`);
        if (!item) return;
        item.querySelectorAll('.bubble').forEach(b => b.classList.remove('selected'));
        const target = item.querySelector(`.bubble[data-val="${val}"]`);
        if (target) target.classList.add('selected');
        FullTest.onAnswer(g);
      },
      correctValue: q.answer,
      wrongValue: ['A', 'B', 'C'].find(l => l !== q.answer),
      isCorrect: (val) => val === q.answer,
    });
    return `
      <div class="mcq-item ft-question" id="ft-q-${g}" data-g="${g}" data-answer="${q.answer}">
        <div class="bubble-row">
          <span class="q-number">${g}.</span>
          <div class="bubble" data-val="A">A</div>
          <div class="bubble" data-val="B">B</div>
          <div class="bubble" data-val="C">C</div>
        </div>
      </div>`;
  }).join("");

  let questionContentHtml;
  if (mode === 'text') {
    questionContentHtml = data.questions.map((q, i) => {
      const g = startIndex + i;
      const opts = q.options || {};
      return `
        <div class="text-q-block">
          <div class="text-q-prompt">${g}. ${q.prompt || ''}</div>
          <div class="text-q-options">
            <div><b>A.</b> ${opts.A || ''}</div>
            <div><b>B.</b> ${opts.B || ''}</div>
            <div><b>C.</b> ${opts.C || ''}</div>
          </div>
        </div>`;
    }).join("");
  } else {
    // Ảnh render tag <img> trơn, KHÔNG gắn inline onerror ở đây — engine sẽ
    // tự gắn addEventListener('error', ...) an toàn sau khi chèn vào DOM
    // (tránh lỗi "no parent node" khi ảnh lỗi ngay lúc đang parse innerHTML).
    questionContentHtml = (data.images || [])
      .map(src => `<img src="${src}" alt="Đề thi" data-fallback-src="${src}">`)
      .join("");
  }

  const html = `
    ${ftAudioBoxHtml(data.id)}
    <div class="split-layout">
      <div class="panel-question ${mode === 'image' ? 'image-mode' : ''}">${questionContentHtml}</div>
      <div class="panel-answer">
        <div class="sheet-title">ANSWER SHEET</div>
        ${answerHtml}
      </div>
    </div>
  `;
  return { html, questions, layout: "split" };
}

function ftRenderMcqImage(data, startIndex) { return ftRenderMcqCommon(data, startIndex, 'image'); }
function ftRenderMcqText(data, startIndex) { return ftRenderMcqCommon(data, startIndex, 'text'); }

/* ===== Gap Fill (Part 3) ===== */
function ftRenderGapfill(data, startIndex) {
  const questions = [];

  data.questions.forEach((q, i) => {
    const g = startIndex + i;
    const accepted = (q.acceptedAnswers || []).map(a => String(a).toLowerCase().trim());
    questions.push({
      globalIndex: g, localId: q.num,
      subskill: subskillFor(data, q.num),
      correctReason: q.script || null,
      getValue: () => { const el = document.getElementById(`ft-input-${g}`); return el ? el.value : ""; },
      setValue: (val) => { const el = document.getElementById(`ft-input-${g}`); if (el) { el.value = val; FullTest.onAnswer(g); } },
      correctValue: (q.acceptedAnswers || [])[0] || "",
      wrongValue: "khac_" + g,
      isCorrect: (val) => accepted.includes((val || "").trim().toLowerCase()),
    });
  });

  const noteLines = data.questions.map((q, i) => {
    const g = startIndex + i;
    const labelText = q.label || "";
    const marker = `<span class="gap-num">${g}</span><span class="gap-blank">&nbsp;</span>`;
    const filled = labelText.replace(/_+/, marker);
    return `<div class="note-line">${filled.includes('gap-blank') ? filled : `${marker} ${labelText}`}</div>`;
  }).join("");

  const answerRows = data.questions.map((q, i) => {
    const g = startIndex + i;
    return `
      <div class="gapfill-item ft-question" id="ft-q-${g}">
        <div class="gapfill-answer-row">
          <span class="q-number">${g}.</span>
          <input type="text" class="answer-input" id="ft-input-${g}" autocomplete="off" placeholder="Câu trả lời..." oninput="FullTest.onAnswer(${g})">
        </div>
      </div>`;
  }).join("");

  const html = `
    ${ftAudioBoxHtml(data.id)}
    <div class="split-layout">
      <div class="panel-question">
        <div class="note-box">
          ${data.noteTitle ? `<div class="note-title">${data.noteTitle}</div>` : ""}
          ${noteLines}
        </div>
      </div>
      <div class="panel-answer">
        <div class="sheet-title">ANSWER SHEET</div>
        ${answerRows}
      </div>
    </div>
  `;
  return { html, questions, layout: "split" };
}

/* Chọn đúng hàm render theo cấu trúc JSON của bài (không phụ thuộc tên field "partType") */
function pickFtRenderer(data) {
  if (data.type === 'gapfill') return ftRenderGapfill;
  if (data.rightPanelMode === 'text') return ftRenderMcqText;
  return ftRenderMcqImage;
}
