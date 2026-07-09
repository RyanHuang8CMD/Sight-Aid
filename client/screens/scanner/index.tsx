import { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Platform,
  Dimensions,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Speech from 'expo-speech';
import * as Haptics from 'expo-haptics';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { FontAwesome6 } from '@expo/vector-icons';
import { Screen } from '@/components/Screen';
import { useSafeRouter } from '@/hooks/useSafeRouter';

type AppState = 'idle' | 'countdown' | 'recording' | 'processing' | 'result' | 'error';

interface AnalysisResult {
  text: string;
  timestamp: number;
}

const FRAME_COUNT = 6;
const RECORDING_DURATION = 12;

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
  white06: 'rgba(255,255,255,0.06)',
  green: '#10B981',
  greenLight: '#6EE7B7',
  red: '#EF4444',
  redLight: '#FCA5A5',
};

export default function ScannerPage() {
  const router = useSafeRouter();
  const [appState, setAppState] = useState<AppState>('idle');
  const [countdown, setCountdown] = useState(3);
  const [recordingProgress, setRecordingProgress] = useState(0);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [target, setTarget] = useState('');
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [cameraActive, setCameraActive] = useState(false);
  const [isListening, setIsListening] = useState(false);

  const cameraRef = useRef<CameraView>(null);
  const framesRef = useRef<string[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const captureTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isCapturingRef = useRef(false);
  const recognitionRef = useRef<any>(null);
  const autoBackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const speak = useCallback((text: string) => {
    try { Speech.stop(); } catch {}
    Speech.speak(text, { language: 'zh-CN', rate: 0.9, pitch: 1.0 });
  }, []);

  // ===== Voice recognition =====
  const startListening = useCallback(() => {
    if (typeof window === 'undefined') {
      speak('语音识别仅在浏览器环境中可用');
      return;
    }
    const SpeechRecognitionAPI = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) {
      speak('当前浏览器不支持语音识别');
      return;
    }

    const recognition = new SpeechRecognitionAPI();
    recognition.lang = 'zh-CN';
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => {
      setIsListening(true);
      speak('请说出你要找的东西');
    };

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript.trim();
      setIsListening(false);

      if (transcript.length > 0) {
        setTarget(transcript);
        speak(`好的，帮你找${transcript}，准备开始扫描`);
        // Auto-start scanning after a brief delay for the speak to finish
        setTimeout(() => {
          beginScan();
        }, 2500);
      } else {
        speak('没听清，请再试一次');
      }
    };

    recognition.onerror = () => {
      setIsListening(false);
      speak('语音识别失败，请再试一次');
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      speak('语音启动失败');
    }
  }, [speak]);

  // ===== Scan flow =====
  const captureFrame = useCallback(async () => {
    if (!cameraRef.current || isCapturingRef.current) return;
    isCapturingRef.current = true;
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.5,
        base64: false,
        skipProcessing: true,
      });
      if (photo?.uri) {
        const manipulated = await manipulateAsync(
          photo.uri,
          [{ resize: { width: 1024 } }],
          { compress: 0.6, format: SaveFormat.JPEG, base64: true }
        );
        if (manipulated?.base64) {
          framesRef.current.push(`data:image/jpeg;base64,${manipulated.base64}`);
        }
      }
    } catch (e) {
      console.error('Capture error:', e);
    } finally {
      isCapturingRef.current = false;
    }
  }, []);

  const analyzeFrames = useCallback(
    async (frames: string[], scanTarget: string) => {
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
            body: JSON.stringify({ images: frames, target: scanTarget }),
            signal: controller.signal,
          }
        );

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`Analysis failed: ${response.status}`);
        }

        const data = await response.json();
        const analysisResult: AnalysisResult = {
          text: data.result,
          timestamp: Date.now(),
        };

        setResult(analysisResult);
        setAppState('result');
        setTimeout(() => speak(data.result), 500);

        // Auto go back after 8 seconds
        autoBackTimerRef.current = setTimeout(() => {
          router.back();
        }, 8000);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        console.error('[Analyze] Error:', msg);
        setErrorMsg('分析失败，请重试');
        setAppState('error');
        speak('分析失败，请返回重试');
      } finally {
        framesRef.current = [];
      }
    },
    [speak, router]
  );

  const startRecording = useCallback(() => {
    framesRef.current = [];
    setRecordingProgress(0);

    captureFrame();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const interval = (RECORDING_DURATION * 1000) / (FRAME_COUNT + 1);
    captureTimerRef.current = setInterval(() => {
      captureFrame();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }, interval);

    let elapsed = 0;
    recordingTimerRef.current = setInterval(() => {
      elapsed += 0.1;
      const progress = Math.min(elapsed / RECORDING_DURATION, 1);
      setRecordingProgress(progress);

      if (elapsed >= RECORDING_DURATION) {
        if (recordingTimerRef.current) {
          clearInterval(recordingTimerRef.current);
          recordingTimerRef.current = null;
        }
        if (captureTimerRef.current) {
          clearInterval(captureTimerRef.current);
          captureTimerRef.current = null;
        }
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        analyzeFrames(framesRef.current, target);
      }
    }, 100);
  }, [captureFrame, analyzeFrames, target]);

  const beginScan = useCallback(async () => {
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

    setAppState('countdown');
    setCountdown(3);
    setCameraActive(true);
    speak('请持手机在胸前，准备转圈');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    let count = 3;
    countdownTimerRef.current = setInterval(() => {
      count--;
      setCountdown(count);

      if (count > 0) {
        speak(String(count));
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } else {
        if (countdownTimerRef.current) {
          clearInterval(countdownTimerRef.current);
          countdownTimerRef.current = null;
        }
        setAppState('recording');
        speak('请缓慢原地转一圈');
        startRecording();
      }
    }, 1000);
  }, [cameraPermission, requestCameraPermission, speak, startRecording]);

  // Cleanup
  useEffect(() => {
    return () => {
      try { Speech.stop(); } catch {}
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
      if (captureTimerRef.current) clearInterval(captureTimerRef.current);
      if (autoBackTimerRef.current) clearTimeout(autoBackTimerRef.current);
    };
  }, []);

  const goBack = useCallback(() => {
    try { Speech.stop(); } catch {}
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    if (captureTimerRef.current) clearInterval(captureTimerRef.current);
    if (autoBackTimerRef.current) clearTimeout(autoBackTimerRef.current);
    router.back();
  }, [router]);

  const isCameraActive = cameraActive && (appState === 'countdown' || appState === 'recording');

  return (
    <Screen safeAreaEdges={['top', 'bottom', 'left', 'right']} statusBarStyle="light">
      <View style={styles.container}>
        {isCameraActive && (
          <CameraView
            ref={cameraRef}
            style={StyleSheet.absoluteFillObject}
            facing="back"
          />
        )}
        {isCameraActive && <View style={styles.cameraOverlay} />}

        {/* ===== RECORDING ===== */}
        {appState === 'recording' && (
          <View style={styles.recordingContainer}>
            <View style={styles.recordingBadge}>
              <View style={styles.recordingDot} />
              <Text style={styles.recordingText}>扫描中...</Text>
            </View>
            <View style={styles.progressBarBg}>
              <View style={[styles.progressBarFill, { width: `${recordingProgress * 100}%` as unknown as number }]} />
            </View>
            <Text style={styles.recordingHint}>请缓慢原地转一圈</Text>
          </View>
        )}

        {/* ===== COUNTDOWN ===== */}
        {appState === 'countdown' && (
          <View style={styles.countdownOverlay}>
            <View style={styles.countdownCard}>
              <Text style={styles.countdownNumber}>{countdown}</Text>
              <Text style={styles.countdownHint}>准备开始...</Text>
            </View>
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

        {/* ===== IDLE: Only voice button ===== */}
        {appState === 'idle' && (
          <View style={styles.idleContainer}>
            <View style={styles.idleHeader}>
              <FontAwesome6 name="search" size={28} color={COLORS.amber} />
              <Text style={styles.idleTitle}>搜索目标</Text>
              <Text style={styles.idleSubtitle}>点击按钮，说出你要找的东西</Text>
            </View>

            <TouchableOpacity
              style={[styles.voiceButton, isListening && styles.voiceButtonActive]}
              onPress={isListening ? undefined : startListening}
              activeOpacity={0.7}
            >
              <View style={styles.voiceButtonInner}>
                <FontAwesome6
                  name={isListening ? 'microphone' : 'microphone-lines'}
                  size={40}
                  color={isListening ? COLORS.accentOrange : COLORS.white}
                />
              </View>
              <Text style={[styles.voiceButtonText, isListening && styles.voiceButtonTextActive]}>
                {isListening ? '正在听...' : '按住说话'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.backLink} onPress={goBack}>
              <FontAwesome6 name="arrow-left" size={14} color={COLORS.white40} />
              <Text style={styles.backLinkText}>返回导航</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </Screen>
  );
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  cameraOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },

  // Recording
  recordingContainer: {
    position: 'absolute',
    top: 80,
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: 16,
    zIndex: 20,
  },
  recordingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 999,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  recordingDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: COLORS.red,
  },
  recordingText: {
    fontSize: 18,
    fontWeight: '500',
    color: COLORS.white,
  },
  progressBarBg: {
    width: 240,
    height: 6,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 999,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: COLORS.amberLight,
    borderRadius: 999,
  },
  recordingHint: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.amberLight,
  },

  // Countdown
  countdownOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 20,
  },
  countdownCard: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 24,
    paddingHorizontal: 64,
    paddingVertical: 48,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  countdownNumber: {
    fontSize: 96,
    fontWeight: '700',
    color: COLORS.amber,
  },
  countdownHint: {
    fontSize: 20,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 16,
  },

  // Center overlay
  centerOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(10,14,26,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    zIndex: 20,
  },
  processingCard: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 24,
    padding: 40,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    gap: 16,
  },
  processingTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.white,
    marginTop: 16,
  },
  processingHint: {
    fontSize: 16,
    color: COLORS.white40,
  },

  // Result / Error
  resultCard: {
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 24,
    padding: 32,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    gap: 16,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  resultTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.greenLight,
  },
  errorText: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.redLight,
    textAlign: 'center',
  },
  resultTextBox: {
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    marginBottom: 8,
  },
  resultText: {
    fontSize: 17,
    lineHeight: 26,
    color: COLORS.white,
  },
  primaryButton: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.amber,
    borderRadius: 16,
    paddingVertical: 18,
    minHeight: 56,
  },
  primaryButtonText: {
    fontSize: 20,
    fontWeight: '700',
    color: '#000',
  },
  secondaryButton: {
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 16,
    paddingVertical: 18,
    minHeight: 56,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  secondaryButtonText: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.white,
  },

  // Idle - simple voice-only
  idleContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    gap: 32,
  },
  idleHeader: {
    alignItems: 'center',
    gap: 12,
  },
  idleTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: COLORS.white,
  },
  idleSubtitle: {
    fontSize: 16,
    color: COLORS.white60,
  },
  voiceButton: {
    alignItems: 'center',
    gap: 16,
  },
  voiceButtonInner: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: COLORS.amber,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: COLORS.amber,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  voiceButtonActive: {
    // Visual feedback when listening
  },
  voiceButtonText: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.white80,
  },
  voiceButtonTextActive: {
    color: COLORS.accentOrange,
  },
  backLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  backLinkText: {
    fontSize: 14,
    color: COLORS.white40,
  },
});
