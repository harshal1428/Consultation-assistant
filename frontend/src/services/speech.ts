/**
 * Browser Web Speech API wrapper.
 *
 * Capabilities and hard limitations (documented honestly):
 * - Relies on `SpeechRecognition` / `webkitSpeechRecognition`. In Chromium it is
 *   a *network* service — it is NOT offline and results differ per browser.
 * - Interim results, continuous mode and the supported language list are
 *   browser-dependent; unsupported capabilities are surfaced rather than faked.
 * - The browser API does not expose a reliable "is listening" event, so the
 *   lifecycle here is driven by the `onstart`/`onend`/`onerror` events.
 */

export interface SpeechServiceOptions {
  /** Partial transcript while the user is still speaking (when supported). */
  onInterim?: (text: string) => void;
  /** Final transcript for this recognition session. */
  onTranscript: (text: string) => void;
  /** One call per *finalized utterance* (continuous mode turns these per pause). */
  onFinalSegment?: (text: string) => void;
  onError: (error: string) => void;
  onEnd: () => void;
  /** BCP-47 language tag, e.g. "en-US". */
  lang?: string;
  /**
   * Keep a single recognition session open across pauses. The Web Speech API
   * still ends the session on its own in many browsers, so the caller is
   * expected to restart after `onEnd` while live mode remains active.
   */
  continuous?: boolean;
}

function mapError(code: string): string {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone access was denied. Allow microphone permission or use the typed command field.";
    case "no-speech":
      return "No speech was detected. Please try again.";
    case "audio-capture":
      return "No microphone was found. Check your audio input device.";
    case "network":
      return "Speech recognition needs a network connection in this browser.";
    case "aborted":
      return "Speech recognition was stopped.";
    default:
      return `Speech recognition error: ${code}`;
  }
}

export class SpeechService {
  private recognition: any = null;
  private supported = false;
  private active = false;
  /** Incremented per session so stale callbacks can be ignored. */
  private sessionId = 0;

  constructor() {
    const Recognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (Recognition) {
      this.supported = true;
      this.recognition = new Recognition();
      this.recognition.continuous = false;
      this.recognition.interimResults = true;
      this.recognition.lang = "en-US";
    }
  }

  public get isSupported(): boolean {
    return this.supported;
  }

  public get isListening(): boolean {
    return this.active;
  }

  public startListening(options: SpeechServiceOptions) {
    if (!this.supported || !this.recognition) {
      options.onError("Speech recognition is not supported in this browser.");
      options.onEnd();
      return;
    }

    // Never allow overlapping recognition instances.
    if (this.active) {
      return;
    }

    this.recognition.lang = options.lang || "en-US";
    this.recognition.continuous = options.continuous ?? false;

    const id = ++this.sessionId;
    const isCurrent = () => id === this.sessionId;
    this.active = true;

    let finalText = "";
    let lastEmitted = "";

    this.recognition.onresult = (event: any) => {
      if (!isCurrent()) return;
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0]?.transcript ?? "";
        if (result.isFinal) {
          finalText += transcript;
          const segment = transcript.trim();
          if (segment && options.onFinalSegment) {
            options.onFinalSegment(segment);
          }
        } else {
          interim += transcript;
        }
      }
      if (interim && options.onInterim) {
        options.onInterim(`${finalText}${interim}`.trim());
      }
      const combined = finalText.trim();
      if (combined && combined !== lastEmitted) {
        lastEmitted = combined;
        options.onTranscript(combined);
      }
    };

    this.recognition.onerror = (event: any) => {
      if (!isCurrent()) return;
      options.onError(mapError(event?.error || "unknown"));
    };

    this.recognition.onend = () => {
      if (!isCurrent()) return;
      this.active = false;
      options.onEnd();
    };

    try {
      this.recognition.start();
    } catch {
      this.active = false;
      options.onError("Failed to start speech recognition.");
      options.onEnd();
    }
  }

  public stopListening() {
    // Invalidate any in-flight callbacks from the previous session.
    this.sessionId++;
    this.active = false;
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {
        /* recognition was not running */
      }
    }
  }
}

export const speechService = new SpeechService();
