import "@testing-library/jest-dom/vitest";

if (typeof window !== "undefined" && !("SpeechRecognition" in window)) {
  (window as any).SpeechRecognition = class {};
}
if (typeof window !== "undefined" && !("webkitSpeechRecognition" in window)) {
  (window as any).webkitSpeechRecognition = class {};
}
