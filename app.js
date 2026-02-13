import { listDocs, getDoc, putDoc, deleteDoc } from "./db.js";
import { buildTestFromDoc, answer as setAnswer, next, prev, score } from "./quizEngine.js";


const el = (id) => document.getElementById(id);

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

let currentId = null;

function setStatus(msg) {
  status.textContent = `Estado: ${msg}`;
}

function safeString(v) {
  return (v === null || v === undefined) ? "" : String(v);
}

function inferTitle(obj) {
  // Intentos comunes (sin imponer esquema):
  // tema/titulo, title/name, etc.
  if (obj && typeof obj === "object") {
    const t =
      obj.titulo ?? obj.title ?? obj.nombre ?? obj.name ??
      (obj.tema ? `Tema ${obj.tema}` : null);
    if (t) return safeString(t);
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
  const docs = await listDocs();

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

async function importJsonObject(obj, sourceLabel = "importado") {
  const title = inferTitle(obj);
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
  setNumQuestionsToMax(doc.data, true);

  btnDelete.disabled = false;
  btnSaveEdits.disabled = false;
  btnExport.disabled = false;

  setStatus(`guardado: "${title}"`);
}

function parseJsonText(text) {
  try {
    const obj = JSON.parse(text);
    return { ok: true, obj };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
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

  // ✅ Poner SIEMPRE el nº preguntas al máximo del JSON abierto
  setNumQuestionsToMax(doc.data, true);

  btnDelete.disabled = false;
  btnSaveEdits.disabled = false;
  btnExport.disabled = false;
  setStatus(`abierto: "${doc.title}"`);
});



btnDelete.addEventListener("click", async () => {
  if (!currentId) return;
  await deleteDoc(currentId);

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
    try {
      await navigator.serviceWorker.register("./sw.js");
      // no spamear logs
    } catch (e) {
      // si falla, sigue funcionando online
    }
  }
}

await refreshList();
await registerSW();
// ---- UI Test ----
const numQuestions = document.getElementById("numQuestions");
const btnStartTest = document.getElementById("btnStartTest");
const btnFinishTest = document.getElementById("btnFinishTest");
const testArea = document.getElementById("testArea");
const testProgress = document.getElementById("testProgress");
const testScoreMini = document.getElementById("testScoreMini");
const testQuestionText = document.getElementById("testQuestionText");
const optionsArea = document.getElementById("optionsArea");
const btnPrev = document.getElementById("btnPrev");
const btnNext = document.getElementById("btnNext");
const btnShowExplanation = document.getElementById("btnShowExplanation");
const explanationArea = document.getElementById("explanationArea");
const finalArea = document.getElementById("finalArea");

let currentTest = null;



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

  // Ajusta límites y pone el valor al máximo
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
    btn.style.textAlign = "left";
    btn.style.width = "100%";
    btn.style.padding = "12px";
    btn.style.borderRadius = "12px";
    btn.style.border = "1px solid #374151";
    btn.style.background = "#0b1020";
    btn.style.color = "#e5e7eb";
    btn.style.cursor = "pointer";

    const chosen = currentTest.answers[i];
    if (chosen === idx) {
      btn.style.outline = "2px solid #60a5fa";
    }

    btn.addEventListener("click", () => {
      setAnswer(currentTest, idx);
      //explanationArea.style.display = "none";
      renderTest();
    });

    optionsArea.appendChild(btn);
  });

  // explicación
  explanationArea.textContent = q.explanation || "Sin explicación.";

  // 👇 Mostrar según estado guardado
  if (currentTest.explanationOpen[currentTest.current]) {
    explanationArea.style.display = "block";
  } else {
    //explanationArea.style.display = "none";
  }


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
    <div style="font-weight:800; font-size:16px; margin-bottom:8px;">Resultado</div>
    <div class="muted small">Aciertos: <b>${s.ok}</b> · Fallos: <b>${s.bad}</b> · Blancas: <b>${s.blank}</b> · Total: <b>${s.total}</b></div>
    <div style="margin-top:6px;" class="muted small">Nota: <b>${pct}%</b></div>
    <div style="margin-top:10px;" class="muted small">Consejo: puedes volver atrás y revisar preguntas con “Anterior/Siguiente”.</div>
  `;
}

btnStartTest.addEventListener("click", async () => {
  const id = savedSelect.value;
  if (!id) {
    setStatus("Selecciona primero un JSON guardado para hacer el test.");
    return;
  }

  const doc = await getDoc(id);
  if (!doc) {
    setStatus("No se encontró el JSON seleccionado.");
    return;
  }

  const total = Array.isArray(doc.data?.questions) ? doc.data.questions.length : 0;
  if (total <= 0) {
    setStatus("ERROR: el JSON no tiene preguntas (questions[] vacío o inexistente).");
    return;
  }

  // ✅ Si el usuario puso más, avisar y volver al máximo
  let n = Number(numQuestions.value || total);
  if (n > total) {
    alert(`Has puesto ${n}, pero este JSON solo tiene ${total} preguntas. Se ajusta a ${total}.`);
    n = total;
    numQuestions.value = String(total);
  }

  try {
    currentTest = buildTestFromDoc(doc.data, n);
    setStatus(`Test iniciado con ${currentTest.items.length} preguntas.`);
    renderTest();
  } catch (e) {
    setStatus(`ERROR al iniciar test: ${e?.message || e}`);
  }
});


btnFinishTest.addEventListener("click", () => {
  if (!currentTest) return;
  renderFinal();
  setStatus("Test finalizado (resultado mostrado).");
});

btnPrev.addEventListener("click", () => {
  if (!currentTest) return;
  prev(currentTest);
  explanationArea.style.display = "none";
  renderTest();
});

btnNext.addEventListener("click", () => {
  if (!currentTest) return;
  next(currentTest);
  //explanationArea.style.display = "none";
  renderTest();
});

btnShowExplanation.addEventListener("click", () => {
  if (!currentTest) return;

  const i = currentTest.current;

  // Cambiamos estado guardado
  currentTest.explanationOpen[i] = !currentTest.explanationOpen[i];

  renderTest();  // vuelve a pintar respetando estado
});




