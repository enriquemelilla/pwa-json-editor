import { listDocs, getDoc, putDoc, deleteDoc, addResult, listResults, clearResults } from "./db.js";
import { buildTestFromDoc, answer as setAnswer, next, prev, score } from "./quizEngine.js";

const el = (id) => document.getElementById(id);

// -------------------- Screens (SPA) --------------------
const screenMenu = el("screenMenu");
const screenLoad = el("screenLoad");
const screenTest = el("screenTest");
const screenHistory = el("screenHistory");

function showScreen(name) {
  [screenMenu, screenLoad, screenTest, screenHistory].forEach(s => s.classList.remove("active"));
  if (name === "menu") screenMenu.classList.add("active");
  if (name === "load") screenLoad.classList.add("active");
  if (name === "test") screenTest.classList.add("active");
  if (name === "history") screenHistory.classList.add("active");
  // al entrar en historial, refrescar
  if (name === "history") renderHistory();
}

// -------------------- Header + state --------------------
const headerSub = el("headerSub");
const pillState = el("pillState");

const btnGoLoad = el("btnGoLoad");
const btnGoTest = el("btnGoTest");
const btnGoHistory = el("btnGoHistory");

const btnBackFromLoad = el("btnBackFromLoad");
const btnBackFromTest = el("btnBackFromTest");
const btnBackFromHistory = el("btnBackFromHistory");

// About
const btnAbout = el("btnAbout");
const aboutBackdrop = el("aboutBackdrop");
const btnCloseAbout = el("btnCloseAbout");

// Version/autor (edítalo aquí si quieres)
const APP_VERSION = "2.0.0";
el("aboutVersion").textContent = APP_VERSION;

// Estado: doc cargado
let loadedDocId = localStorage.getItem("loadedDocId") || null;
let loadedDocTitle = localStorage.getItem("loadedDocTitle") || "Sin JSON cargado";

function setTopState() {
  const hasDoc = !!loadedDocId;
  headerSub.textContent = hasDoc ? `Cargado: ${loadedDocTitle}` : "Sin JSON cargado";
  pillState.textContent = hasDoc ? `Estado: JSON cargado (${loadedDocTitle})` : "Estado: sin JSON";
  btnGoTest.disabled = !hasDoc;
}
setTopState();

// Si venimos de una sesión anterior, sincroniza el título del JSON cargado (por si quedó "Sin título")
(async () => {
  if (!loadedDocId) return;
  try {
    const doc = await getDoc(loadedDocId);
    if (!doc) return;

    let t = (doc.title || "").trim();
    if (!t || t === "Sin título") {
      const inferred = inferTitle(doc.data, doc.source || "");
      if (inferred && inferred !== "Sin título") {
        doc.title = inferred;
        doc.updatedAt = Date.now();
        try { await putDoc(doc); } catch {}
        t = inferred;
      }
    }

    if (t && t !== loadedDocTitle) {
      loadedDocTitle = t;
      localStorage.setItem("loadedDocTitle", loadedDocTitle);
      setTopState();
    }
  } catch {}
})();


// Navegación menú
btnGoLoad.addEventListener("click", () => showScreen("load"));
btnGoTest.addEventListener("click", () => showScreen("test"));
btnGoHistory.addEventListener("click", () => showScreen("history"));

btnBackFromLoad.addEventListener("click", () => showScreen("menu"));
btnBackFromHistory.addEventListener("click", () => showScreen("menu"));

btnBackFromTest.addEventListener("click", () => {
  // Si hay un test activo, solo avisamos (no bloqueamos)
  if (currentTest && testArea.style.display === "block") {
    const ok = confirm("Hay un test en pantalla. ¿Quieres volver al menú?");
    if (!ok) return;
  }
  showScreen("menu");
});

// About modal
btnAbout.addEventListener("click", () => aboutBackdrop.classList.add("open"));
btnCloseAbout.addEventListener("click", () => aboutBackdrop.classList.remove("open"));
aboutBackdrop.addEventListener("click", (e) => {
  if (e.target === aboutBackdrop) aboutBackdrop.classList.remove("open");
});

// -------------------- Import / Docs UI --------------------
const fileInput = el("fileInput");
const dropzone = el("dropzone");
const pasteArea = el("pasteArea");
const btnImportPaste = el("btnImportPaste");
const btnClearPaste = el("btnClearPaste");

const savedSelect = el("savedSelect");
const btnReload = el("btnReload");
const btnOpen = el("btnOpen");
const btnDelete = el("btnDelete");

const viewer = el("viewer");
const btnSaveEdits = el("btnSaveEdits");
const btnExport = el("btnExport");
const status = el("status");

let currentId = null; // doc "abierto" en Load screen (para borrar/editar/exportar)

function setStatus(msg) {
  status.textContent = `Estado: ${msg}`;
}

function safeString(v) {
  return (v === null || v === undefined) ? "" : String(v);
}

function inferTitle(obj, sourceLabel = "") {
  // Extrae un título de forma robusta sin imponer un esquema fijo.
  // 1) Campos típicos en raíz
  const pick = (v) => (v !== undefined && v !== null && String(v).trim() ? safeString(v) : null);

  if (obj && typeof obj === "object") {
    const direct =
      pick(obj.titulo) ?? pick(obj.title) ?? pick(obj.nombre) ?? pick(obj.name) ??
      pick(obj.temaTitulo) ?? pick(obj.tituloTema) ?? pick(obj.nombreTema);
    if (direct) return direct;

    // 2) Metadatos anidados frecuentes
    const meta = obj.meta ?? obj.metadata ?? obj.info ?? obj.cabecera ?? obj.header ?? obj.config ?? obj.settings;
    if (meta && typeof meta === "object") {
      const m =
        pick(meta.titulo) ?? pick(meta.title) ?? pick(meta.nombre) ?? pick(meta.name) ??
        (meta.tema ? pick(`Tema ${meta.tema}`) : null);
      if (m) return m;
    }

    // 3) Si hay "tema" numérico en raíz
    if (obj.tema !== undefined && obj.tema !== null && String(obj.tema).trim() !== "") {
      return `Tema ${safeString(obj.tema)}`;
    }

    // 4) Si viene como banco de preguntas
    const arr = obj.preguntas ?? obj.questions ?? obj.items ?? obj.test ?? null;
    const qlist = Array.isArray(arr) ? arr : (arr && Array.isArray(arr.preguntas) ? arr.preguntas : null);
    if (qlist && qlist.length) {
      const q0 = qlist[0];
      if (q0 && typeof q0 === "object") {
        const qtitle =
          pick(q0.tituloTema) ?? pick(q0.temaTitulo) ?? pick(q0.nombreTema) ??
          pick(q0.tema) ?? pick(q0.bloque) ?? pick(q0.materia);
        if (qtitle) return qtitle;
      }
    }
  }

  // 5) Fallback: nombre de archivo si existe (sourceLabel="archivo:xxx.json")
  if (sourceLabel && typeof sourceLabel === "string") {
    const m = sourceLabel.match(/^archivo:(.+)$/i);
    if (m) {
      const fname = m[1].trim();
      const base = fname.replace(/\.[^.]+$/, ""); // quita extensión
      if (base) return safeString(base);
    }
  }

  return "Sin título";
}


function makeId(prefix = "doc") {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function pretty(obj) {
  return JSON.stringify(obj, null, 2);
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function refreshList(selectIdToKeep = null) {
  let docs = await listDocs();

  // Si hay JSON antiguos guardados como "Sin título", intentamos inferir y actualizar
  let changed = false;
  for (const d of docs) {
    if (!d) continue;
    const t = (d.title || "").trim();
    if (!t || t === "Sin título") {
      const inferred = inferTitle(d.data, d.source || "");
      if (inferred && inferred !== t) {
        d.title = inferred;
        d.updatedAt = Date.now();
        try { await putDoc(d); changed = true; } catch {}
      }
    }
  }

  if (changed) docs = await listDocs();

  savedSelect.innerHTML = `<option value="">— (ninguno) —</option>`;
  for (const d of docs) {
    const opt = document.createElement("option");
    opt.value = d.id;
    const when = d.updatedAt ? new Date(d.updatedAt).toLocaleString() : "";
    opt.textContent = `${d.title}  (${when})`;
    savedSelect.appendChild(opt);
  }

  if (selectIdToKeep) {
    savedSelect.value = selectIdToKeep;
  }

  setStatus(`lista cargada (${docs.length} JSON).`);
}


function parseJsonText(text) {
  try {
    const obj = JSON.parse(text);
    return { ok: true, obj };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

function setLoadedDoc(doc) {
  loadedDocId = doc?.id || null;
  loadedDocTitle = doc?.title || "Sin título";
  localStorage.setItem("loadedDocId", loadedDocId || "");
  localStorage.setItem("loadedDocTitle", loadedDocTitle || "Sin título");
  setTopState();

  // Poner el número de preguntas al máximo del JSON cargado
  setNumQuestionsToMax(doc?.data, true);

  // Título arriba en pantalla test
  testDocTitle.textContent = loadedDocTitle;
}

async function importJsonObject(obj, sourceLabel = "importado") {
  const title = inferTitle(obj, sourceLabel);
  const now = Date.now();

  const doc = {
    id: makeId("json"),
    title,
    source: sourceLabel,
    createdAt: now,
    updatedAt: now,
    data: obj
  };

  await putDoc(doc);
  await refreshList(doc.id);

  currentId = doc.id;
  viewer.value = pretty(doc.data);

  btnDelete.disabled = false;
  btnSaveEdits.disabled = false;
  btnExport.disabled = false;

  // ✅ se considera "cargado" para menú/test
  setLoadedDoc(doc);

  setStatus(`guardado y cargado: "${title}"`);
}

async function handleFile(file) {
  const text = await file.text();
  const parsed = parseJsonText(text);
  if (!parsed.ok) {
    setStatus(`ERROR JSON: ${parsed.error}`);
    return;
  }
  await importJsonObject(parsed.obj, `archivo:${file.name}`);
}

fileInput.addEventListener("change", async () => {
  const files = Array.from(fileInput.files || []);
  if (!files.length) return;
  for (const f of files) await handleFile(f);
  fileInput.value = "";
});

dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("dragover");
});
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
dropzone.addEventListener("drop", async (e) => {
  e.preventDefault();
  dropzone.classList.remove("dragover");

  const files = Array.from(e.dataTransfer?.files || []).filter(f =>
    f.type === "application/json" || f.name.toLowerCase().endsWith(".json")
  );
  if (!files.length) {
    setStatus("No se detectó ningún .json en el drop.");
    return;
  }
  for (const f of files) await handleFile(f);
});

btnImportPaste.addEventListener("click", async () => {
  const text = pasteArea.value.trim();
  if (!text) { setStatus("Pega un JSON primero."); return; }

  const parsed = parseJsonText(text);
  if (!parsed.ok) {
    setStatus(`ERROR JSON: ${parsed.error}`);
    return;
  }
  await importJsonObject(parsed.obj, "pegado");
});

btnClearPaste.addEventListener("click", () => {
  pasteArea.value = "";
  setStatus("pegado limpiado.");
});

btnReload.addEventListener("click", async () => {
  await refreshList(savedSelect.value || null);
});

btnOpen.addEventListener("click", async () => {
  const id = savedSelect.value;
  if (!id) { setStatus("Selecciona un JSON."); return; }

  const doc = await getDoc(id);
  if (!doc) { setStatus("No encontrado."); return; }

  currentId = id;
  viewer.value = pretty(doc.data);

  btnDelete.disabled = false;
  btnSaveEdits.disabled = false;
  btnExport.disabled = false;

  // ✅ Cargarlo para menú/test
  setLoadedDoc(doc);

  setStatus(`cargado: "${doc.title}"`);
});

btnDelete.addEventListener("click", async () => {
  if (!currentId) return;
  await deleteDoc(currentId);

  // Si borras el que estaba cargado, quitamos estado
  if (loadedDocId === currentId) {
    loadedDocId = null;
    loadedDocTitle = "Sin JSON cargado";
    localStorage.removeItem("loadedDocId");
    localStorage.removeItem("loadedDocTitle");
    testDocTitle.textContent = "(sin título)";
    setTopState();
  }

  currentId = null;
  viewer.value = "";
  btnDelete.disabled = true;
  btnSaveEdits.disabled = true;
  btnExport.disabled = true;

  await refreshList();
  setStatus("borrado.");
});

btnSaveEdits.addEventListener("click", async () => {
  if (!currentId) return;

  const text = viewer.value.trim();
  const parsed = parseJsonText(text);
  if (!parsed.ok) {
    setStatus(`ERROR JSON: ${parsed.error}`);
    return;
  }

  const doc = await getDoc(currentId);
  if (!doc) { setStatus("No encontrado."); return; }

  doc.data = parsed.obj;
  doc.title = inferTitle(parsed.obj);
  doc.updatedAt = Date.now();

  await putDoc(doc);
  await refreshList(doc.id);

  // Si el editado es el cargado, actualizamos título/num preguntas
  if (loadedDocId === doc.id) setLoadedDoc(doc);

  setStatus(`cambios guardados: "${doc.title}"`);
});

btnExport.addEventListener("click", async () => {
  if (!currentId) return;
  const doc = await getDoc(currentId);
  if (!doc) { setStatus("No encontrado."); return; }

  const filename = (doc.title || "json_export")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .slice(0, 80) + ".json";

  downloadText(filename, pretty(doc.data));
  setStatus(`exportado: ${filename}`);
});

// Registrar SW (PWA offline)
async function registerSW() {
  if ("serviceWorker" in navigator) {
    try { await navigator.serviceWorker.register("./sw.js"); } catch {}
  }
}

// -------------------- Test UI --------------------
const testDocTitle = el("testDocTitle");
const numQuestions = el("numQuestions");
const btnStartTest = el("btnStartTest");
const btnFinishTest = el("btnFinishTest");
const testArea = el("testArea");
const testProgress = el("testProgress");
const testScoreMini = el("testScoreMini");
const testQuestionText = el("testQuestionText");
const optionsArea = el("optionsArea");
const btnPrev = el("btnPrev");
const btnNext = el("btnNext");
const btnShowExplanation = el("btnShowExplanation");
const explanationArea = el("explanationArea");
const finalArea = el("finalArea");

let currentTest = null;
let currentTestDoc = null; // doc completo para guardar resultados

numQuestions.addEventListener("change", () => {
  const max = Number(numQuestions.max || 1);
  let val = Number(numQuestions.value || 1);

  if (val > max) {
    alert(`Has puesto ${val}, pero este JSON solo tiene ${max} preguntas. Se ajusta a ${max}.`);
    numQuestions.value = String(max);
  } else if (val < 1) {
    numQuestions.value = "1";
  }
});

function setNumQuestionsToMax(docData, showMsg = false) {
  const total = Array.isArray(docData?.questions) ? docData.questions.length : 0;

  if (total <= 0) {
    numQuestions.min = "1";
    numQuestions.max = "1";
    numQuestions.value = "1";
    if (showMsg) setStatus("Aviso: el JSON no tiene questions[] o está vacío.");
    return 0;
  }

  numQuestions.min = "1";
  numQuestions.max = String(total);
  numQuestions.value = String(total);

  if (showMsg) setStatus(`Cargado JSON para test: máximo ${total} preguntas. Se ha puesto ${total}.`);
  return total;
}

function renderTest() {
  if (!currentTest) return;

  const i = currentTest.current;
  const q = currentTest.items[i];
  const s = score(currentTest);

  testArea.style.display = "block";
  btnFinishTest.disabled = false;

  testProgress.textContent = `Pregunta ${i + 1}/${currentTest.items.length}`;
  testScoreMini.textContent = `Aciertos: ${s.ok} · Fallos: ${s.bad} · Blancas: ${s.blank}`;

  testQuestionText.textContent = q.question;

  // opciones (4)
  optionsArea.innerHTML = "";
  q.options.forEach((optText, idx) => {
    const btn = document.createElement("button");
    btn.textContent = optText;
    btn.className = "option-btn";

    const chosen = currentTest.answers[i];
    if (chosen === idx) {
      btn.style.outline = "2px solid #60a5fa";
    }

    btn.addEventListener("click", () => {
      setAnswer(currentTest, idx);
      renderTest();
    });

    optionsArea.appendChild(btn);
  });

  // explicación
  explanationArea.textContent = q.explanation || "Sin explicación.";
  explanationArea.style.display = currentTest.explanationOpen[i] ? "block" : "none";

  // botones nav
  btnPrev.disabled = (i === 0);
  btnNext.disabled = (i === currentTest.items.length - 1);

  // final area
  finalArea.style.display = "none";
  finalArea.innerHTML = "";
}

function renderFinal() {
  if (!currentTest) return;
  const s = score(currentTest);

  finalArea.style.display = "block";
  const pct = Math.round((s.ok / s.total) * 100);

  finalArea.innerHTML = `
    <div style="font-weight:900; font-size:16px; margin-bottom:8px;">Resultado</div>
    <div class="muted small">Aciertos: <b>${s.ok}</b> · Fallos: <b>${s.bad}</b> · Blancas: <b>${s.blank}</b> · Total: <b>${s.total}</b></div>
    <div style="margin-top:6px;" class="muted small">Nota: <b>${pct}%</b></div>
  `;
}

btnStartTest.addEventListener("click", async () => {
  if (!loadedDocId) {
    alert("Primero carga un JSON en 'Cargar JSON'.");
    return;
  }

  const doc = await getDoc(loadedDocId);
  if (!doc) {
    alert("No se encontró el JSON cargado. Vuelve a cargarlo.");
    return;
  }
  currentTestDoc = doc;

  const total = Array.isArray(doc.data?.questions) ? doc.data.questions.length : 0;
  if (total <= 0) {
    alert("ERROR: el JSON no tiene preguntas (questions[] vacío o inexistente).");
    return;
  }

  let n = Number(numQuestions.value || total);
  if (n > total) {
    alert(`Has puesto ${n}, pero este JSON solo tiene ${total} preguntas. Se ajusta a ${total}.`);
    n = total;
    numQuestions.value = String(total);
  }

  try {
    currentTest = buildTestFromDoc(doc.data, n);
    testDocTitle.textContent = doc.title || "Sin título";
    setStatus(`Test iniciado con ${currentTest.items.length} preguntas.`);
    renderTest();
  } catch (e) {
    alert(`ERROR al iniciar test: ${e?.message || e}`);
  }
});

btnFinishTest.addEventListener("click", async () => {
  if (!currentTest) return;

  renderFinal();

  // Guardar resultado en historial
  try {
    const s = score(currentTest);
    await addResult({
      docId: currentTestDoc?.id || loadedDocId,
      docTitle: currentTestDoc?.title || loadedDocTitle,
      startedAt: currentTest.startedAt,
      endedAt: Date.now(),
      ok: s.ok,
      bad: s.bad,
      blank: s.blank,
      total: s.total
    });
  } catch {
    // si falla, no rompemos UX
  }

  setStatus("Test finalizado (resultado guardado).");
});

btnPrev.addEventListener("click", () => {
  if (!currentTest) return;
  prev(currentTest);
  renderTest();
});

btnNext.addEventListener("click", () => {
  if (!currentTest) return;
  next(currentTest);
  renderTest();
});

btnShowExplanation.addEventListener("click", () => {
  if (!currentTest) return;
  const i = currentTest.current;
  currentTest.explanationOpen[i] = !currentTest.explanationOpen[i];
  renderTest();
});

// -------------------- Historial --------------------
const historyList = el("historyList");
const btnClearHistory = el("btnClearHistory");

function fmtDate(ts) {
  try { return new Date(ts).toLocaleString(); } catch { return ""; }
}

async function renderHistory() {
  const items = await listResults(200);

  if (!items.length) {
    historyList.textContent = "Aún no hay resultados.";
    return;
  }

  const html = items.map(r => {
    const when = fmtDate(r.endedAt || r.startedAt);
    return `
      <div style="border:1px solid #1f2937; background:#0f172a; border-radius:14px; padding:12px; margin-bottom:10px;">
        <div style="font-weight:900; margin-bottom:4px;">${r.docTitle || "Sin título"}</div>
        <div class="muted small">${when}</div>
        <div style="margin-top:8px;" class="muted small">
          ✅ Aciertos: <b>${r.ok}</b> · ❌ Fallos: <b>${r.bad}</b> · ⬜ Blancas: <b>${r.blank}</b> · Total: <b>${r.total}</b>
        </div>
      </div>
    `;
  }).join("");

  historyList.innerHTML = html;
}

btnClearHistory.addEventListener("click", async () => {
  const ok = confirm("¿Borrar todo el historial?");
  if (!ok) return;
  await clearResults();
  renderHistory();
});

// -------------------- Boot --------------------
await refreshList();
await registerSW();

// Si había un doc cargado de antes, reflejar título/num preguntas
if (loadedDocId) {
  const doc = await getDoc(loadedDocId);
  if (doc) {
    setLoadedDoc(doc);
  } else {
    loadedDocId = null;
    localStorage.removeItem("loadedDocId");
    localStorage.removeItem("loadedDocTitle");
    setTopState();
  }
}
