// Native counterpart of client/src/hooks/useVoiceInput.ts. The web hook
// wraps the browser's built-in SpeechRecognition API (free, on-device or
// browser-mediated, no backend call); there's no DOM equivalent on native,
// so this wraps expo-speech-recognition — a config-plugin-installed native
// module that mirrors the same start/stop/result/error event shape and
// likewise never touches our own backend (recognition happens via the OS's
// speech service, same "reuse the platform's own STT" choice as the web).
// Requires a custom dev client build (app.json's "expo-speech-recognition"
// plugin entry) — it does not work under Expo Go.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';

export function useVoiceInput(locale: string, onResult: (text: string) => void) {
  const [listening, setListening] = useState(false);
  // Sync, on-device check (no permission prompt) — same gating role as the
  // web hook's `supported` (there: does `window.SpeechRecognition` exist;
  // here: is a speech recognition service available on this device at all).
  const [supported] = useState(() => {
    try {
      return ExpoSpeechRecognitionModule.isRecognitionAvailable();
    } catch {
      return false;
    }
  });
  const onResultRef = useRef(onResult);
  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  useSpeechRecognitionEvent('end', () => setListening(false));
  useSpeechRecognitionEvent('result', (e) => {
    // continuous:false + interimResults:false below means the native side
    // only ever emits one, final result — matching the web hook's single
    // `e.results[0]?.[0]?.transcript` read.
    const transcript = e.results[0]?.transcript || '';
    if (transcript) onResultRef.current(transcript);
  });
  useSpeechRecognitionEvent('error', (e) => {
    setListening(false);
    // A denied permission is a dead end the teacher can only fix in device
    // Settings — worth a nudge, same as AddMenu's camera-permission Alert.
    // Every other code (no-speech, network blip, recognizer busy, etc.) is
    // transient and retried by just tapping the mic again, so — like the
    // web hook, which silently resets on any onerror — we stay quiet there.
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      Alert.alert(
        'Microphone access needed',
        'Allow microphone and speech recognition access in your device Settings to use voice input.',
      );
    }
  });

  useEffect(() => {
    return () => {
      ExpoSpeechRecognitionModule.abort();
    };
  }, []);

  const toggle = useCallback(async () => {
    if (listening) {
      ExpoSpeechRecognitionModule.stop();
      return;
    }

    const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!result.granted) {
      Alert.alert(
        'Microphone access needed',
        'Allow microphone and speech recognition access in your device Settings to use voice input.',
      );
      return;
    }

    ExpoSpeechRecognitionModule.start({
      lang: locale,
      continuous: false,
      interimResults: false,
    });
    setListening(true);
  }, [listening, locale]);

  return { supported, listening, toggle };
}
