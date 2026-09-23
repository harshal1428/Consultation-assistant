export interface SpeechServiceOptions {
  onTranscript: (text: string) => void;
  onError: (error: string) => void;
  onEnd: () => void;
}

export class SpeechService {
  private recognition: any = null;
  private isSupported: boolean = false;

  constructor() {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      this.isSupported = true;
      this.recognition = new SpeechRecognition();
      this.recognition.continuous = false;
      this.recognition.interimResults = false;
      this.recognition.lang = 'en-US';
    }
  }

  public startListening(options: SpeechServiceOptions) {
    if (!this.isSupported || !this.recognition) {
      options.onError("Speech recognition is not supported in this browser.");
      options.onEnd();
      return;
    }

    this.recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      options.onTranscript(transcript);
    };

    this.recognition.onerror = (event: any) => {
      options.onError(`Speech recognition error: ${event.error}`);
    };

    this.recognition.onend = () => {
      options.onEnd();
    };

    try {
      this.recognition.start();
    } catch (err) {
      options.onError("Failed to start speech recognition.");
      options.onEnd();
    }
  }

  public stopListening() {
    if (this.recognition) {
      this.recognition.stop();
    }
  }
}

export const speechService = new SpeechService();
