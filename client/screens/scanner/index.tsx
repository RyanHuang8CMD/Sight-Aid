import { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Speech from 'expo-speech';
import * as Haptics from 'expo-haptics';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { FontAwesome6 } from '@expo/vector-icons';
import { Screen } from '@/components/Screen';
import { useSafeRouter } from '@/hooks/useSafeRouter';

type AppState = 'voice' | 'countdown' | 'recording' | 'processing' | 'result' | 'error';

interface AnalysisResult {
  text: string;
  timestamp: number;
}

const FRAME_COUNT = 6;
const RECORDING_DURATION = 12;
// Estimated TTS duration per character (ms) + base latency
const TTS_CHAR_MS = 280;
const TTS_BASE_MS = 400;

const COLORS = {
  bg: '#0A0E1A',
  amber: '#F59E0B',
  amberLight: '#FCD34D',
  accentOrange: '#FF6B3B',
  white: '#FFFFFF',
  white80: 'rgba(255,255,255,0.8)',
  white60: 'rgba(255,255,255,0.6)',
  white40: 'rgba(255,255,255,0.4)',
  white20: 'rgba(255,255,255,0.2)',
  white10: 'rgba(255,255,255,0.1)',
  green: '#10B981',
  greenLight: '#6EE7B7',
  red: '#EF4444',
  redLight: '#FCA5A5',
};

// Wait for TTS to finish speaking before proceeding
function waitForSpeech(text: string): Promise<void> {
  return new Promise((resolve) => {
    const estimatedMs = TTS_BASE_MS + text.length * TTS_CHAR_MS;
    setTimeout(resolve, estimatedMs);
  });
}

export default function ScannerPage() {
  const router = useSafeRouter();
  const [appState, setAppState] = useState<AppState>('voice');
  const [countdown, setCountdown] = useState(3);
  const [recordingProgress, setRecordingProgress] = useState(0);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [target, setTarget] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [cameraActive, setCameraActive] = useState(false);

  const cameraRef = useRef<CameraView>(null);
  const framesRef = useRef<string[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const captureTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isCapturingRef = useRef(false);
  const recognitionRef = useRef<any>(null);
  const autoBackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const targetRef = useRef('');

  // Keep targetRef in sync
  useEffect(() => {
    targetRef.current = target;
  }, [target]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const speak = useCallback((text: string) => {
    try { Speech.stop(); } catch {}
    Speech.speak(text, { language: 'zh-CN', rate: 0.9, pitch: 1.0 });
  }, []);

  // ===== Cleanup =====
  const cleanupAll = useCallback(() => {
    try { Speech.stop(); } catch {}
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch {}
      recognitionRef.current = null;
    }
    if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    if (countdownTimerRef.current) { clearInterval(countdownTimerRef.current); countdownTimerRef.current = null; }
    if (captureTimerRef.current) { clearInterval(captureTimerRef.current); captureTimerRef.current = null; }
    if (autoBackTimerRef.current) { clearTimeout(autoBackTimerRef.current); autoBackTimerRef.current = null; }
  }, []);

  const goBack = useCallback(() => {
    cleanupAll();
    router.back();
  }, [cleanupAll, router]);

  // ===== Step 4: Analyze frames =====
  const analyzeFrames = useCallback(
    async (frames: string[]) => {
      if (!mountedRef.current) return;
      setAppState('processing');
      setCameraActive(false);
      speak('正在分析，请稍候');

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 90000);

        const response = await fetch(
          `${process.env.EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/analyze`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ images: frames, target: targetRef.current }),
            signal: controller.signal,
          }
        );
        clearTimeout(timeoutId);

        if (!response.ok) throw new Error(`Analysis failed: ${response.status}`);

        const data = await response.json();
        const analysisResult: AnalysisResult = { text: data.result, timestamp: Date.now() };
        setResult(analysisResult);
        setAppState('result');

        await waitForSpeech(''); // small gap
        speak(data.result);

        // Auto go back after result fully spoken + generous buffer
        // Chinese TTS at rate 0.9: ~4 chars/sec, add 5s buffer after speech ends
        const resultText = data.result || '';
        const estimatedSpeechSec = resultText.length / 4 + 5;
        autoBackTimerRef.current = setTimeout(() => {
          if (mountedRef.current) router.back();
        }, estimatedSpeechSec * 1000);
      } catch (err) {
        if (!mountedRef.current) return;
        const msg = err instanceof Error ? err.message : 'Unknown error';
        console.error('[Analyze] Error:', msg);
        setErrorMsg('分析失败');
        setAppState('error');
        speak('分析失败，请返回重试');
      } finally {
        framesRef.current = [];
      }
    },
    [speak, router]
  );

  // ===== Step 3: Record video frames (12s) =====
  const startRecording = useCallback(() => {
    if (!mountedRef.current) return;
    framesRef.current = [];
    setRecordingProgress(0);

    // Capture first frame immediately
    if (cameraRef.current && !isCapturingRef.current) {
      isCapturingRef.current = true;
      cameraRef.current.takePictureAsync({
        quality: 0.5, base64: false, skipProcessing: true,
      }).then(async (photo) => {
        if (photo?.uri) {
          const m = await manipulateAsync(photo.uri, [{ resize: { width: 1024 } }], { compress: 0.6, format: SaveFormat.JPEG, base64: true });
          if (m?.base64) framesRef.current.push(`data:image/jpeg;base64,${m.base64}`);
        }
        isCapturingRef.current = false;
      }).catch(() => { isCapturingRef.current = false; });
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const interval = (RECORDING_DURATION * 1000) / (FRAME_COUNT + 1);
    captureTimerRef.current = setInterval(() => {
      if (cameraRef.current && !isCapturingRef.current) {
        isCapturingRef.current = true;
        cameraRef.current.takePictureAsync({
          quality: 0.5, base64: false, skipProcessing: true,
        }).then(async (photo) => {
          if (photo?.uri) {
            const m = await manipulateAsync(photo.uri, [{ resize: { width: 1024 } }], { compress: 0.6, format: SaveFormat.JPEG, base64: true });
            if (m?.base64) framesRef.current.push(`data:image/jpeg;base64,${m.base64}`);
          }
          isCapturingRef.current = false;
        }).catch(() => { isCapturingRef.current = false; });
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    }, interval);

    let elapsed = 0;
    recordingTimerRef.current = setInterval(() => {
      elapsed += 0.1;
      setRecordingProgress(Math.min(elapsed / RECORDING_DURATION, 1));
      if (elapsed >= RECORDING_DURATION) {
        if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
        if (captureTimerRef.current) { clearInterval(captureTimerRef.current); captureTimerRef.current = null; }
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        analyzeFrames(framesRef.current);
      }
    }, 100);
  }, [analyzeFrames]);

  // ===== Step 2: Countdown 3-2-1 then record =====
  const beginCountdown = useCallback(async () => {
    if (!mountedRef.current) return;

    // Ensure camera permission
    let perm = cameraPermission;
    if (!perm?.granted) {
      perm = await requestCameraPermission();
      if (!perm.granted) {
        setErrorMsg('需要摄像头权限');
        setAppState('error');
        speak('无法访问摄像头');
        return;
      }
    }

    setCameraActive(true);
    setAppState('countdown');
    setCountdown(3);
    speak('请持手机在胸前');
    await waitForSpeech('请持手机在胸前');

    if (!mountedRef.current) return;

    let count = 3;
    countdownTimerRef.current = setInterval(() => {
      count--;
      setCountdown(count);
      if (count > 0) {
        speak(String(count));
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } else {
        if (countdownTimerRef.current) { clearInterval(countdownTimerRef.current); countdownTimerRef.current = null; }
        setAppState('recording');
        speak('请缓慢原地转一圈');
        // Wait for TTS then start recording
        waitForSpeech('请缓慢原地转一圈').then(() => {
          if (mountedRef.current) startRecording();
        });
      }
    }, 1200);
  }, [cameraPermission, requestCameraPermission, speak, startRecording]);

  // ===== Step 1: Auto-start voice recognition on mount =====
  useEffect(() => {
    const autoStart = async () => {
      // Brief delay for page transition to settle
      await new Promise(r => setTimeout(r, 800));
      if (!mountedRef.current) return;

      if (typeof window === 'undefined') {
        speak('语音识别仅在浏览器中可用');
        return;
      }
      const SpeechRecognitionAPI = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognitionAPI) {
        speak('当前浏览器不支持语音识别');
        return;
      }

      // Speak prompt first, THEN start recognition after TTS finishes
      speak('请说出你想去的地方');
      await waitForSpeech('请说出你想去的地方');
      if (!mountedRef.current) return;

      // Now start recognition (TTS is done, mic won't pick up app voice)
      const recognition = new SpeechRecognitionAPI();
      recognition.lang = 'zh-CN';
      recognition.continuous = false;
      recognition.interimResults = false;

      recognition.onstart = () => {
        if (mountedRef.current) setIsListening(true);
      };

      recognition.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript.trim();
        if (mountedRef.current) setIsListening(false);

        if (transcript.length > 0) {
          setTarget(transcript);
          targetRef.current = transcript;
          // Speak confirmation, then auto-chain to countdown
          const confirmText = `好的，帮你找${transcript}`;
          speak(confirmText);
          waitForSpeech(confirmText).then(() => {
            if (mountedRef.current) beginCountdown();
          });
        } else {
          speak('没听清，请重试');
          // Restart voice after a pause
          waitForSpeech('没听清，请重试').then(() => {
            if (mountedRef.current) autoStart();
          });
        }
      };

      recognition.onerror = () => {
        if (mountedRef.current) setIsListening(false);
        speak('语音识别失败，请重试');
        waitForSpeech('语音识别失败，请重试').then(() => {
          if (mountedRef.current) autoStart();
        });
      };

      recognition.onend = () => {
        if (mountedRef.current) setIsListening(false);
      };

      recognitionRef.current = recognition;
      try { recognition.start(); } catch { speak('语音启动失败'); }
    };

    autoStart();

    return () => {
      cleanupAll();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isCameraActive = cameraActive && (appState === 'countdown' || appState === 'recording');

  return (
    <Screen safeAreaEdges={['top', 'bottom', 'left', 'right']} statusBarStyle="light">
      <View style={styles.container}>
        {isCameraActive && (
          <CameraView ref={cameraRef} style={StyleSheet.absoluteFillObject} facing="back" />
        )}
        {isCameraActive && <View style={styles.cameraOverlay} />}

        {/* ===== VOICE INPUT STATE ===== */}
        {appState === 'voice' && (
          <View style={styles.voiceContainer}>
            <View style={styles.voiceHeader}>
              <Text style={styles.voiceTitle}>搜索目标</Text>
            </View>

            <View style={[styles.micCircle, isListening && styles.micCircleActive]}>
              <FontAwesome6
                name={isListening ? 'microphone' : 'microphone-lines'}
                size={44}
                color={isListening ? COLORS.accentOrange : COLORS.white}
              />
            </View>

            <Text style={styles.voiceStatus}>
              {isListening ? '正在听，请说...' : '准备中...'}
            </Text>

            <TouchableOpacity style={styles.backLink} onPress={goBack}>
              <FontAwesome6 name="arrow-left" size={14} color={COLORS.white40} />
              <Text style={styles.backLinkText}>返回导航</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ===== COUNTDOWN ===== */}
        {appState === 'countdown' && (
          <View style={styles.countdownOverlay}>
            <View style={styles.countdownCard}>
              <Text style={styles.countdownNumber}>{countdown}</Text>
              <Text style={styles.countdownHint}>找「{target}」</Text>
            </View>
          </View>
        )}

        {/* ===== RECORDING ===== */}
        {appState === 'recording' && (
          <View style={styles.recordingContainer}>
            <View style={styles.recordingBadge}>
              <View style={styles.recordingDot} />
              <Text style={styles.recordingText}>扫描中</Text>
            </View>
            <View style={styles.progressBarBg}>
              <View style={[styles.progressBarFill, { width: `${recordingProgress * 100}%` as unknown as number }]} />
            </View>
            <Text style={styles.recordingHint}>请缓慢原地转一圈</Text>
          </View>
        )}

        {/* ===== PROCESSING ===== */}
        {appState === 'processing' && (
          <View style={styles.centerOverlay}>
            <View style={styles.processingCard}>
              <ActivityIndicator size="large" color={COLORS.amber} />
              <Text style={styles.processingTitle}>AI 正在分析</Text>
              <Text style={styles.processingHint}>正在识别「{target}」的位置...</Text>
            </View>
          </View>
        )}

        {/* ===== RESULT ===== */}
        {appState === 'result' && result && (
          <View style={styles.centerOverlay}>
            <View style={styles.resultCard}>
              <View style={[styles.iconCircle, { backgroundColor: 'rgba(16,185,129,0.2)' }]}>
                <FontAwesome6 name="check" size={32} color={COLORS.greenLight} />
              </View>
              <Text style={styles.resultTitle}>找到结果</Text>
              <View style={styles.resultTextBox}>
                <Text style={styles.resultText}>{result.text}</Text>
              </View>
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={() => speak(result.text)}
                activeOpacity={0.8}
              >
                <FontAwesome6 name="volume-high" size={18} color="#000" />
                <Text style={[styles.primaryButtonText, { marginLeft: 8 }]}>再播报一次</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondaryButton} onPress={goBack} activeOpacity={0.8}>
                <Text style={styles.secondaryButtonText}>返回导航</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ===== ERROR ===== */}
        {appState === 'error' && (
          <View style={styles.centerOverlay}>
            <View style={styles.resultCard}>
              <View style={[styles.iconCircle, { backgroundColor: 'rgba(239,68,68,0.2)' }]}>
                <FontAwesome6 name="triangle-exclamation" size={32} color={COLORS.redLight} />
              </View>
              <Text style={styles.errorText}>{errorMsg || '出现错误'}</Text>
              <TouchableOpacity style={styles.primaryButton} onPress={goBack} activeOpacity={0.8}>
                <Text style={styles.primaryButtonText}>返回导航</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  cameraOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.3)' },

  // Voice state
  voiceContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 28, paddingHorizontal: 24 },
  voiceHeader: { alignItems: 'center' },
  voiceTitle: { fontSize: 26, fontWeight: '700', color: COLORS.white },
  micCircle: {
    width: 130, height: 130, borderRadius: 65,
    backgroundColor: COLORS.amber,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: COLORS.amber, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 16, elevation: 8,
  },
  micCircleActive: { backgroundColor: COLORS.accentOrange },
  voiceStatus: { fontSize: 18, fontWeight: '600', color: COLORS.white60 },
  backLink: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 12, paddingHorizontal: 20,
    position: 'absolute', bottom: 50,
  },
  backLinkText: { fontSize: 14, color: COLORS.white40 },

  // Countdown
  countdownOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', zIndex: 20 },
  countdownCard: { alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 24, paddingHorizontal: 64, paddingVertical: 48, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  countdownNumber: { fontSize: 96, fontWeight: '700', color: COLORS.amber },
  countdownHint: { fontSize: 20, color: COLORS.white80, marginTop: 16 },

  // Recording
  recordingContainer: { position: 'absolute', top: 80, left: 0, right: 0, alignItems: 'center', gap: 16, zIndex: 20 },
  recordingBadge: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 999, paddingHorizontal: 24, paddingVertical: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  recordingDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: COLORS.red },
  recordingText: { fontSize: 18, fontWeight: '500', color: COLORS.white },
  progressBarBg: { width: 240, height: 6, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 999, overflow: 'hidden' },
  progressBarFill: { height: '100%', backgroundColor: COLORS.amberLight, borderRadius: 999 },
  recordingHint: { fontSize: 20, fontWeight: '700', color: COLORS.amberLight },

  // Center overlay
  centerOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(10,14,26,0.85)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24, zIndex: 20 },
  processingCard: { alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 24, padding: 40, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', gap: 16 },
  processingTitle: { fontSize: 24, fontWeight: '700', color: COLORS.white, marginTop: 16 },
  processingHint: { fontSize: 16, color: COLORS.white40 },

  // Result / Error
  resultCard: { width: '100%', maxWidth: 400, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 24, padding: 32, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', gap: 16 },
  iconCircle: { width: 64, height: 64, borderRadius: 32, justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  resultTitle: { fontSize: 22, fontWeight: '700', color: COLORS.greenLight },
  errorText: { fontSize: 20, fontWeight: '700', color: COLORS.redLight, textAlign: 'center' },
  resultTextBox: { width: '100%', backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 16, padding: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', marginBottom: 8 },
  resultText: { fontSize: 17, lineHeight: 26, color: COLORS.white },
  primaryButton: { width: '100%', flexDirection: 'row', justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.amber, borderRadius: 16, paddingVertical: 18, minHeight: 56 },
  primaryButtonText: { fontSize: 20, fontWeight: '700', color: '#000' },
  secondaryButton: { width: '100%', justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 16, paddingVertical: 18, minHeight: 56, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  secondaryButtonText: { fontSize: 20, fontWeight: '700', color: COLORS.white },
});
