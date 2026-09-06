/* Minimal Gemini client. Runs in the side-panel context only.
 * Sends product-label photos + your own listing patterns. Never sends
 * order data, buyer data, or Flipkart credentials. */

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

export async function listModels(apiKey) {
  const r = await fetch(`${BASE}/models?key=${encodeURIComponent(apiKey)}`);
  if (!r.ok) throw new Error(await friendlyError(r));
  const j = await r.json();
  return (j.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''))
    .filter((n) => /gemini/i.test(n))
    .sort();
}

async function friendlyError(r) {
  let detail = '';
  try {
    detail = (await r.json())?.error?.message || '';
  } catch { /* body was not JSON */ }
  if (r.status === 400 && /API key not valid/i.test(detail)) return 'Gemini rejected the API key.';
  if (r.status === 403) return 'Gemini denied the request (key lacks access, or API not enabled).';
  if (r.status === 429) return 'Gemini rate limit hit. Wait a minute and retry.';
  return `Gemini ${r.status}: ${detail || r.statusText}`;
}

export function fileToInlineData(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error(`Could not read ${file.name}`));
    fr.onload = () =>
      resolve({ inline_data: { mime_type: file.type, data: String(fr.result).split(',')[1] } });
    fr.readAsDataURL(file);
  });
}

/** One call. Returns parsed JSON matching `schema`. */
export async function extract({ apiKey, model, prompt, images, schema, signal }) {
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }, ...images] }],
    generationConfig: {
      temperature: 0.2,               // extraction, not creative writing
      responseMimeType: 'application/json',
      responseSchema: schema,
    },
    // Label photos are ordinary product packaging; keep filters from tripping on
    // ingredient words, but leave the defaults in place otherwise.
    safetySettings: [],
  };
  const r = await fetch(
    `${BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal }
  );
  if (!r.ok) throw new Error(await friendlyError(r));
  const j = await r.json();
  const cand = j.candidates?.[0];
  if (!cand) throw new Error('Gemini returned no result (the request may have been filtered).');
  const text = (cand.content?.parts || []).map((p) => p.text).filter(Boolean).join('');
  if (!text) throw new Error(`Gemini returned an empty answer (finishReason: ${cand.finishReason}).`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Gemini did not return valid JSON. Try again, or pick a different model.');
  }
}
