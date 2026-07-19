import { SPEECH_LOCALE } from '../config';

// Small wrapper around the Web Speech API for reading responses aloud.
export function isSpeechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

function pickVoice(locale: string): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find((v) => v.lang === locale) ||
    voices.find((v) => v.lang.startsWith(locale.split('-')[0]))
  );
}

export function speak(text: string, language: string, onEnd: () => void) {
  if (!isSpeechSupported()) return;
  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  const locale = SPEECH_LOCALE[language] || 'en-US';
  utterance.lang = locale;
  const voice = pickVoice(locale);
  if (voice) utterance.voice = voice;
  utterance.rate = 0.95;
  utterance.onend = onEnd;
  utterance.onerror = onEnd;
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking() {
  if (isSpeechSupported()) window.speechSynthesis.cancel();
}
