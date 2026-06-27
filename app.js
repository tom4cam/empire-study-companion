(() => {
  "use strict";

  const state = {
    index: null,        // index.json
    courseId: null,
    course: null,       // loaded course bundle
    moduleId: null,
    tab: "read",
    cardIndex: 0,
    cardFlipped: false,
    quizIndex: 0,
    quizScore: 0,
    quizAnswered: false,
  };

  const $ = (sel) => document.querySelector(sel);
  const view = $("#view");

  const LS_COURSE = "re_study_last_course";
  const LS_MODULE = "re_study_last_module";   // keyed object: { courseId: moduleId }
  const LS_BEST = "re_study_best_scores";     // keyed: "courseId/moduleId": pct

  async function loadJSON(path) {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    return res.json();
  }

  async function init() {
    try {
      state.index = await loadJSON("data/index.json");
    } catch (err) {
      return fail(err);
    }
    const courseIds = state.index.courses.map((c) => c.id);
    const savedCourse = localStorage.getItem(LS_COURSE);
    state.courseId = courseIds.includes(savedCourse) ? savedCourse : courseIds[0];

    buildCoursePicker();
    bindTabs();
    await loadCourse(state.courseId);
  }

  function fail(err) {
    console.error(err);
    view.innerHTML = `<div class="empty">Couldn't load study material.<br><br>
      <button class="btn" onclick="location.reload()">Reload</button></div>`;
  }

  function buildCoursePicker() {
    const picker = $("#course-picker");
    picker.innerHTML = "";
    state.index.courses.forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = c.title;
      picker.appendChild(opt);
    });
    picker.value = state.courseId;
    picker.addEventListener("change", () => {
      localStorage.setItem(LS_COURSE, picker.value);
      resetTransient();
      loadCourse(picker.value);
    });
  }

  async function loadCourse(courseId) {
    state.courseId = courseId;
    const meta = state.index.courses.find((c) => c.id === courseId);
    view.innerHTML = '<div class="empty">Loading course…</div>';
    try {
      state.course = await loadJSON(`data/${meta.file}`);
    } catch (err) {
      return fail(err);
    }
    // pick remembered module within this course, else first
    const ids = state.course.modules.map((m) => m.id);
    const remembered = rememberedModule(courseId);
    state.moduleId = ids.includes(remembered) ? remembered : ids[0];
    buildModulePicker();
    render();
  }

  function buildModulePicker() {
    const picker = $("#module-picker");
    picker.innerHTML = "";
    state.course.modules.forEach((m) => {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.title;
      picker.appendChild(opt);
    });
    picker.value = state.moduleId;
    picker.onchange = () => {
      state.moduleId = picker.value;
      if (state.moduleId !== "__mixed__") rememberModule(state.courseId, state.moduleId);
      resetTransient();
      render();
    };
  }

  function syncMixedOption() {
    const picker = $("#module-picker");
    const hasMixed = !!picker.querySelector('option[value="__mixed__"]');
    if (state.tab === "quiz" && !hasMixed) {
      const opt = document.createElement("option");
      opt.value = "__mixed__";
      opt.textContent = "★ Mixed (all units)";
      picker.appendChild(opt);
    } else if (state.tab !== "quiz" && hasMixed) {
      if (state.moduleId === "__mixed__") {
        state.moduleId = state.course.modules[0].id;
        rememberModule(state.courseId, state.moduleId);
      }
      picker.querySelector('option[value="__mixed__"]').remove();
    }
    picker.value = state.moduleId;
  }

  function bindTabs() {
    document.querySelectorAll(".tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".tab").forEach((b) =>
          b.setAttribute("aria-selected", String(b === btn))
        );
        state.tab = btn.dataset.tab;
        resetTransient();
        render();
      });
    });
  }

  function resetTransient() {
    state.cardIndex = 0;
    state.cardFlipped = false;
    state.quizIndex = 0;
    state.quizScore = 0;
    state.quizAnswered = false;
  }

  function currentModule() {
    return state.course.modules.find((m) => m.id === state.moduleId);
  }

  function render() {
    if (!state.course) return;
    syncMixedOption();
    if (state.tab === "read") return renderReader();
    if (state.tab === "summary") return renderSummary();
    if (state.tab === "cards") return renderCards();
    if (state.tab === "quiz") return renderQuiz();
  }

  /* ---------- Reader ---------- */
  function renderReader() {
    const m = currentModule();
    const note = state.course.note
      ? `<div class="note-banner">${escapeHTML(state.course.note)}</div>` : "";
    const paras = (m.body || "")
      .split(/\n+/).filter(Boolean)
      .map((p) => `<p>${escapeHTML(p)}</p>`).join("");
    view.innerHTML = `<section class="reader">${note}
      <h2>${escapeHTML(m.title)}</h2>${paras || '<p class="empty">No text for this unit yet.</p>'}</section>`;
  }

  /* ---------- Summary ---------- */
  function renderSummary() {
    const m = currentModule();
    const items = m.summary || [];
    const list = items.length
      ? `<ul>${items.map((s) => `<li>${escapeHTML(s)}</li>`).join("")}</ul>`
      : '<p class="empty">No summary for this unit yet.</p>';
    view.innerHTML = `<section class="summary"><h2>${escapeHTML(m.title)} — Key Points</h2>${list}</section>`;
  }

  /* ---------- Flashcards ---------- */
  function moduleCards() {
    return (state.course.flashcards && state.course.flashcards[state.moduleId]) || [];
  }

  function renderCards() {
    const cards = moduleCards();
    if (!cards.length) {
      view.innerHTML = '<div class="empty">No flashcards for this unit yet.</div>';
      return;
    }
    const i = Math.min(state.cardIndex, cards.length - 1);
    const card = cards[i];
    const showing = state.cardFlipped ? card.back : card.front;
    const label = state.cardFlipped ? "Definition" : "Term";
    view.innerHTML = `<section class="cards-wrap">
      <div class="card ${state.cardFlipped ? "is-back" : ""}" id="flashcard">
        <div class="card-inner">
          <span class="side-label">${label}</span>
          ${escapeHTML(showing)}
        </div>
      </div>
      <div class="card-progress">Card ${i + 1} of ${cards.length} — tap to flip</div>
      <div class="card-controls">
        <button class="btn ghost" id="prev-card">‹ Prev</button>
        <button class="btn ghost" id="shuffle-cards">Shuffle</button>
        <button class="btn" id="next-card">Next ›</button>
      </div>
    </section>`;

    $("#flashcard").addEventListener("click", () => {
      state.cardFlipped = !state.cardFlipped;
      renderCards();
    });
    $("#prev-card").addEventListener("click", () => {
      state.cardIndex = (i - 1 + cards.length) % cards.length;
      state.cardFlipped = false;
      renderCards();
    });
    $("#next-card").addEventListener("click", () => {
      state.cardIndex = (i + 1) % cards.length;
      state.cardFlipped = false;
      renderCards();
    });
    $("#shuffle-cards").addEventListener("click", () => {
      shuffle(cards);
      state.cardIndex = 0;
      state.cardFlipped = false;
      renderCards();
    });
  }

  /* ---------- Quiz ---------- */
  function quizQuestions() {
    const q = state.course.quiz || {};
    if (state.moduleId === "__mixed__") return Object.values(q).flat();
    return q[state.moduleId] || [];
  }

  function renderQuiz() {
    const qs = quizQuestions();
    if (!qs.length) {
      view.innerHTML = '<div class="empty">No quiz questions for this unit yet.</div>';
      return;
    }
    if (state.quizIndex >= qs.length) return renderScore(qs.length);

    const q = qs[state.quizIndex];
    const choices = q.choices
      .map((c, idx) => `<button class="choice" data-idx="${idx}">${escapeHTML(c)}</button>`)
      .join("");
    view.innerHTML = `<section class="quiz">
      <h2>Practice Quiz</h2>
      <div class="progress-line">Question ${state.quizIndex + 1} of ${qs.length} · Score ${state.quizScore}</div>
      <div class="question">${escapeHTML(q.q)}</div>
      <div id="choices">${choices}</div>
      <div id="after"></div>
    </section>`;

    view.querySelectorAll(".choice").forEach((btn) => {
      btn.addEventListener("click", () => answer(parseInt(btn.dataset.idx, 10), q, qs.length));
    });
  }

  function answer(idx, q, total) {
    if (state.quizAnswered) return;
    state.quizAnswered = true;
    view.querySelectorAll(".choice").forEach((b, i) => {
      b.disabled = true;
      if (i === q.answer) b.classList.add("correct");
      else if (i === idx) b.classList.add("wrong");
    });
    if (idx === q.answer) state.quizScore++;
    $("#after").innerHTML = `<div class="explanation">${escapeHTML(q.explanation || "")}</div>
      <button class="btn" id="next-q">${state.quizIndex + 1 < total ? "Next question ›" : "See score"}</button>`;
    $("#next-q").addEventListener("click", () => {
      state.quizIndex++;
      state.quizAnswered = false;
      renderQuiz();
    });
  }

  function renderScore(total) {
    const pct = Math.round((state.quizScore / total) * 100);
    saveBest(pct);
    const best = bestScore();
    view.innerHTML = `<section class="quiz score-card">
      <h2>Quiz complete</h2>
      <div class="big">${state.quizScore}/${total}</div>
      <p>${pct}% correct${best != null ? ` · best ${best}%` : ""}</p>
      <div class="card-controls">
        <button class="btn" id="retry">Try again</button>
      </div>
    </section>`;
    $("#retry").addEventListener("click", () => {
      state.quizIndex = 0;
      state.quizScore = 0;
      state.quizAnswered = false;
      renderQuiz();
    });
  }

  /* ---------- persistence helpers ---------- */
  function rememberedModule(courseId) {
    try { return (JSON.parse(localStorage.getItem(LS_MODULE) || "{}"))[courseId]; }
    catch { return null; }
  }
  function rememberModule(courseId, moduleId) {
    try {
      const all = JSON.parse(localStorage.getItem(LS_MODULE) || "{}");
      all[courseId] = moduleId;
      localStorage.setItem(LS_MODULE, JSON.stringify(all));
    } catch { /* ignore */ }
  }
  function bestKey() { return `${state.courseId}/${state.moduleId}`; }
  function bestScore() {
    try { return (JSON.parse(localStorage.getItem(LS_BEST) || "{}"))[bestKey()] ?? null; }
    catch { return null; }
  }
  function saveBest(pct) {
    try {
      const all = JSON.parse(localStorage.getItem(LS_BEST) || "{}");
      const k = bestKey();
      if (all[k] == null || pct > all[k]) { all[k] = pct; localStorage.setItem(LS_BEST, JSON.stringify(all)); }
    } catch { /* ignore */ }
  }

  /* ---------- misc ---------- */
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  function escapeHTML(s) {
    return String(s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  init();
})();
