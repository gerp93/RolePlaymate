/**
 * The small general-purpose model suggested for memory extraction (Settings -> Chat Dependencies).
 * Extraction is a structured summarising job, not roleplay, so an ordinary instruct model of about
 * this size does it better than a roleplay tune and fits in GPU memory beside the chat model.
 * `llama3.2` is also the example chat model the Ollama setup guide tells new users to pull, so a
 * fresh install that followed it already has this one.
 */
export const SUGGESTED_EXTRACTION_MODEL = 'llama3.2:3b';
