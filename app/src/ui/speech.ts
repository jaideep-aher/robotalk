/**
 * Browser speech helpers: the car speaks its `response_speech` aloud with
 * speechSynthesis, and the mic button uses the Web Speech API for dictation
 * where available (Chrome), falling back silently to text elsewhere.
 */

/* Minimal typings for the non-standard Web Speech API. */
interface SpeechRecognitionResultLike {
  0: { transcript: string };
}
interface SpeechRecognitionEventLike {
  results: { 0: SpeechRecognitionResultLike };
}
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

/**
 * Speak text aloud, cancelling anything currently being spoken.
 *
 * @param text - The line for the car to say.
 */
export function speak(text: string): void {
  if (!("speechSynthesis" in window) || !text) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.02;
  utterance.pitch = 1.0;
  window.speechSynthesis.speak(utterance);
}

/**
 * Resolve the platform's SpeechRecognition constructor, if any.
 *
 * @returns The constructor, or null when unsupported.
 */
function getRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Wraps one-shot speech-to-text with graceful degradation.
 */
export class SpeechRecognizer {
  private recognition: SpeechRecognitionLike | null = null;

  /** Whether dictation is available in this browser. */
  get supported(): boolean {
    return getRecognitionCtor() !== null;
  }

  /**
   * Listen for a single utterance.
   *
   * @param onResult - Called with the recognised transcript.
   * @param onDone - Called when the session ends (success or failure).
   */
  listenOnce(onResult: (text: string) => void, onDone: () => void): void {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      onDone();
      return;
    }
    const recognition = new Ctor();
    this.recognition = recognition;
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      onResult(event.results[0][0].transcript);
    };
    recognition.onerror = () => {};
    recognition.onend = () => {
      this.recognition = null;
      onDone();
    };
    recognition.start();
  }

  /** Stop an in-progress recognition session. */
  stop(): void {
    this.recognition?.stop();
  }
}
