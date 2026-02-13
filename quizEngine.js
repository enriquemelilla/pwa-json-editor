export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Convierte tu formato a un formato interno seguro y baraja opciones
 * manteniendo correcta.
 */
export function normalizeQuestionFromYourJson(q, fallbackId) {
  if (!q || typeof q !== "object") throw new Error("Pregunta inválida (objeto)");
  const enunciado = q.question;
  const options = q.options;
  const ans = q.answer_index;

  if (!enunciado || typeof enunciado !== "string") {
    throw new Error("Pregunta inválida: falta 'question'");
  }
  if (!Array.isArray(options) || options.length !== 4) {
    throw new Error(`Pregunta inválida: 'options' debe tener 4 elementos (${enunciado})`);
  }
  if (typeof ans !== "number" || ans < 0 || ans > 3) {
    throw new Error(`Pregunta inválida: 'answer_index' debe ser 0..3 (${enunciado})`);
  }

  const correctText = options[ans];

  // Barajamos las opciones y recalculamos correctaIndex
  const shuffledOptions = shuffle(options);
  const newCorrectIndex = shuffledOptions.findIndex(x => x === correctText);
  if (newCorrectIndex === -1) {
    throw new Error(`No se pudo recalcular la correcta (${enunciado})`);
  }

  return {
    id: q.id ?? fallbackId,
    question: enunciado,
    options: shuffledOptions,
    answer_index: newCorrectIndex,
    explanation: q.explanation ?? ""
  };
}

/**
 * Crea un test aleatorio sin repetir, con N preguntas (o menos si no hay tantas).
 * Devuelve { items, answers, current, startedAt }
 */
export function buildTestFromDoc(docData, n) {
  if (!docData || typeof docData !== "object") throw new Error("JSON inválido");
  if (!Array.isArray(docData.questions)) throw new Error("Falta 'questions[]' en el JSON");

  const normalized = docData.questions.map((q, idx) =>
    normalizeQuestionFromYourJson(q, `Q${idx + 1}`)
  );

  const pool = shuffle(normalized);
  const count = Math.max(1, Math.min(Number(n) || 1, pool.length));

  return {
  items: pool.slice(0, count),
  answers: Array(count).fill(null),
  explanationOpen: Array(count).fill(false),   // 👈 NUEVO
  current: 0,
  startedAt: Date.now()
};
}

export function answer(test, optionIndex) {
  test.answers[test.current] = optionIndex;
}

export function next(test) {
  if (test.current < test.items.length - 1) test.current++;
}

export function prev(test) {
  if (test.current > 0) test.current--;
}

export function score(test) {
  let ok = 0, bad = 0, blank = 0;
  test.items.forEach((q, i) => {
    const a = test.answers[i];
    if (a === null) blank++;
    else if (a === q.answer_index) ok++;
    else bad++;
  });
  return { ok, bad, blank, total: test.items.length };
}
