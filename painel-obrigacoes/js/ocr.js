// Leitura de comprovantes por OCR direto no navegador (Tesseract.js) e por
// extração de texto de PDF (pdf.js) — ambos via CDN em index.html, sem
// serviço externo pago nem backend próprio — para conferir se o arquivo
// anexado parece ser da competência (mês/ano) da ocorrência sendo
// concluída.
//
// As bibliotecas e os artefatos pesados de OCR são carregados de versões
// fixadas no jsDelivr.

const JSDELIVR_BASE = 'https://cdn.jsdelivr.net';

if (typeof window !== 'undefined' && window.pdfjsLib) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = `${JSDELIVR_BASE}/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js`;
}

const PDF_MIN_TEXT_LENGTH = 25;

const MONTH_NAMES_PT = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

function findPeriodCandidates(text) {
  const candidates = [];
  const normalized = text.toLowerCase();

  const keywordWindow = /(compet[eê]ncia|per[ií]odo de apura[cç][aã]o|m[eê]s de refer[eê]ncia)[^0-9]{0,25}(\d{1,2})[\/-](\d{4})/g;
  for (const m of normalized.matchAll(keywordWindow)) {
    candidates.push({ month: parseInt(m[2], 10), year: parseInt(m[3], 10), priority: 2 });
  }

  const monthYearNumeric = /\b(0?[1-9]|1[0-2])[\/-](\d{4})\b/g;
  for (const m of normalized.matchAll(monthYearNumeric)) {
    candidates.push({ month: parseInt(m[1], 10), year: parseInt(m[2], 10), priority: 1 });
  }

  const monthNamePattern = new RegExp(`\\b(${MONTH_NAMES_PT.join('|')})[a-z]*\\s+de\\s+(\\d{4})\\b`, 'g');
  for (const m of normalized.matchAll(monthNamePattern)) {
    candidates.push({ month: MONTH_NAMES_PT.indexOf(m[1]) + 1, year: parseInt(m[2], 10), priority: 2 });
  }

  return candidates.filter((c) => c.month >= 1 && c.month <= 12 && c.year >= 2000 && c.year <= 2100);
}

function pickBestCandidate(candidates) {
  if (!candidates.length) return null;
  const maxPriority = Math.max(...candidates.map((c) => c.priority));
  const top = candidates.filter((c) => c.priority === maxPriority);
  const counts = new Map();
  top.forEach((c) => {
    const key = `${c.month}/${c.year}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  const [bestKey] = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0];
  const [month, year] = bestKey.split('/').map(Number);
  return { month, year };
}

function fmtPeriod({ month, year }) {
  return `${String(month).padStart(2, '0')}/${year}`;
}

function periodsMatch(occMonth, occYear, extracted) {
  const prevMonth = occMonth === 1 ? 12 : occMonth - 1;
  const prevYear = occMonth === 1 ? occYear - 1 : occYear;
  return (extracted.month === occMonth && extracted.year === occYear)
    || (extracted.month === prevMonth && extracted.year === prevYear);
}

// --- PDF text extraction --------------------------------------------------
async function extractPdfText(file) {
  const buffer = await file.arrayBuffer();
  // O pdf.js tenta, por padrão, testar otimizações com `new Function()`. Além
  // de não ser necessário para a leitura dos comprovantes, isso é bloqueado
  // pela nossa CSP. Desabilitar explicitamente o recurso mantém a política
  // segura sem recorrer a `unsafe-eval`.
  const pdf = await window.pdfjsLib.getDocument({
    data: buffer,
    isEvalSupported: false,
  }).promise;
  const pagesToRead = Math.min(pdf.numPages, 2);
  let text = '';
  for (let i = 1; i <= pagesToRead; i++) {
    // eslint-disable-next-line no-await-in-loop
    const page = await pdf.getPage(i);
    // eslint-disable-next-line no-await-in-loop
    const content = await page.getTextContent();
    text += `${content.items.map((it) => it.str).join(' ')}\n`;
  }
  return { pdf, text };
}

async function renderPdfPageToCanvas(pdf, pageNumber = 1, scale = 2) {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  return canvas;
}

// --- Tesseract worker helper (singleton) ---------------------------------
// Usa URLs explícitas e versões fixas. O worker é criado como um Worker real;
// não é necessário liberar `unsafe-eval` na CSP.
let _tessWorker = null;
let _tessWorkerInitPromise = null;

async function getTesseractWorker() {
  if (_tessWorker) return _tessWorker;
  if (_tessWorkerInitPromise) return _tessWorkerInitPromise;

  if (typeof window === 'undefined' || !window.Tesseract || !window.Tesseract.createWorker) {
    throw new Error('Tesseract não está disponível (assegure que o script foi carregado via CDN em index.html)');
  }

  const workerPath = `${JSDELIVR_BASE}/npm/tesseract.js@5.1.1/dist/worker.min.js`;
  const corePath = `${JSDELIVR_BASE}/npm/tesseract.js-core@5.1.1`;
  const langPath = `${JSDELIVR_BASE}/npm/@tesseract.js-data/por@1.0.0/4.0.0_best_int`;

  // A assinatura do Tesseract.js 5 recebe idioma/OEM antes das opções.
  _tessWorkerInitPromise = window.Tesseract.createWorker('por', 1, {
    workerPath,
    corePath,
    langPath,
  });

  try {
    _tessWorker = await _tessWorkerInitPromise;
    return _tessWorker;
  } finally {
    _tessWorkerInitPromise = null;
  }
}

export async function terminateTesseractWorker() {
  if (_tessWorker) {
    try {
      await _tessWorker.terminate();
    } catch (err) {
      // ignore
    }
    _tessWorker = null;
  }
}

async function tesseractRecognize(target) {
  const worker = await getTesseractWorker();
  const { data } = await worker.recognize(target);
  return data.text || '';
}

// --- text extraction (PDF or image) --------------------------------------
async function extractText(file) {
  if (file.type === 'application/pdf') {
    if (!window.pdfjsLib) throw new Error('pdf.js não carregou');
    const { pdf, text: pdfText } = await extractPdfText(file);
    if (pdfText.replace(/\s+/g, '').length >= PDF_MIN_TEXT_LENGTH) {
      return pdfText; // PDF nativo, já tem camada de texto — não precisa de OCR
    }
    // Fallback to OCR of rendered page
    const canvas = await renderPdfPageToCanvas(pdf, 1);
    return tesseractRecognize(canvas);
  }

  // images: use OCR
  return tesseractRecognize(file);
}

export async function analyzeAttachment(file, occurrenceDate) {
  const [occYear, occMonth] = occurrenceDate.split('-').map(Number);
  const occPeriodLabel = fmtPeriod({ month: occMonth, year: occYear });

  const isImage = file?.type?.startsWith('image/');
  const isPdf = file?.type === 'application/pdf';
  if (!isImage && !isPdf) {
    return {
      status: 'not_checked',
      extractedPeriod: null,
      message: 'Conferência automática de competência só funciona em imagens (foto/print) ou PDF. Revise manualmente se necessário.',
    };
  }

  try {
    const text = await extractText(file);
    const best = pickBestCandidate(findPeriodCandidates(text));

    if (!best) {
      return {
        status: 'not_checked',
        extractedPeriod: null,
        message: 'Não foi possível identificar a competência no comprovante automaticamente. Revise manualmente se necessário.',
      };
    }

    const extractedPeriod = fmtPeriod(best);
    if (periodsMatch(occMonth, occYear, best)) {
      return { status: 'ok', extractedPeriod, message: `Competência do comprovante (${extractedPeriod}) confere com esta ocorrência.` };
    }
    return {
      status: 'mismatch',
      extractedPeriod,
      message: `O comprovante parece ser da competência ${extractedPeriod}, mas esta ocorrência é de ${occPeriodLabel}. Confira se anexou o arquivo certo antes de concluir.`,
    };
  } catch (err) {
    console.error('Falha ao analisar o comprovante', err);
    return {
      status: 'not_checked',
      extractedPeriod: null,
      message: 'Não foi possível analisar o comprovante automaticamente agora. Revise manualmente se necessário.',
    };
  }
}
