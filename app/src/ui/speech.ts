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
 * Voices worth using, best first.
 *
 * The default voice a browser picks is usually the oldest and most robotic one
 * installed. Every modern platform ships something far better, so we look for
 * those by name and only fall back to the default if none are present.
 */
const PREFERRED_VOICES = [
  "Samantha", // macOS and iOS, natural
  "Google US English",
  "Microsoft Aria Online (Natural) - English (United States)",
  "Microsoft Jenny Online (Natural) - English (United States)",
  "Ava",
  "Allison",
  "Karen",
  "Moira",
];

let cachedVoice: SpeechSynthesisVoice | null = null;

/**
 * Choose the most natural available English voice.
 *
 * @returns The chosen voice, or null to let the browser decide.
 */
function pickVoice(): SpeechSynthesisVoice | null {
  if (cachedVoice) return cachedVoice;
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return null;

  for (const name of PREFERRED_VOICES) {
    const match = voices.find((v) => v.name === name);
    if (match) {
      cachedVoice = match;
      return match;
    }
  }
  // Otherwise prefer any local English voice that is not flagged as novelty.
  const english = voices.filter((v) => v.lang.startsWith("en"));
  cachedVoice = english.find((v) => v.localService) ?? english[0] ?? null;
  return cachedVoice;
}

// Voice lists load asynchronously in most browsers, so re-pick when they land.
if ("speechSynthesis" in window) {
  window.speechSynthesis.addEventListener("voiceschanged", () => {
    cachedVoice = null;
    pickVoice();
  });
}

/**
 * Speak text aloud, cancelling anything currently being spoken.
 *
 * @param text - The line for the car to say.
 */
export function speak(text: string): void {
  if (!("speechSynthesis" in window) || !text) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  const voice = pickVoice();
  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  }
  // Slightly slower and warmer than the default, which reads as less clipped.
  utterance.rate = 0.96;
  utterance.pitch = 1.05;
  utterance.volume = 1;
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
