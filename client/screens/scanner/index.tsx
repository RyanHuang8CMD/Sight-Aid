import { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  StyleSheet,
  Platform,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Speech from 'expo-speech';
import * as Haptics from 'expo-haptics';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { FontAwesome6 } from '@expo/vector-icons';
import { Screen } from '@/components/Screen';

type AppState =
  | 'idle'
  | 'countdown'
  | 'recording'
  | 'processing'
  | 'result'
  | 'error';

interface AnalysisResult {
  text: string;
  timestamp: number;
}

const FRAME_COUNT = 6;
const RECORDING_DURATION = 12;

const COMMON_TARGETS = ['洗手间/厕所', '出口', '电梯', '楼梯', '收银台'];

// Colors
const COLORS = {
  bg: '#0A0E1A',
  amber: '#F59E0B',
  amberLight: '#FCD34D',
  white: '#FFFFFF',
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
  const [appState, setAppState] = useState<AppState>('idle');
  const [countdown, setCountdown] = useState(3);
  const [recordingProgress, setRecordingProgress] = useState(0);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [target, setTarget] = useState('洗手间/厕所');
  const [showTargetPicker, setShowTargetPicker] = useState(false);
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

  // Voice recognition - "Hi SightAid" style voice command
  // Voice synthesis
  const speak = useCallback((text: string) => {
    try {
      Speech.stop();
    } catch {
      // Ignore errors when stopping speech
    }
    Speech.speak(text, {
      language: 'zh-CN',
      rate: 0.9,
      pitch: 1.0,
    });
  }, []);

  const startListening = useCallback(() => {
    if (typeof window === 'undefined') {
      speak('语音识别功能需要在浏览器环境中使用');
      return;
    }
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      speak('当前浏览器不支持语音识别，请使用 Chrome 浏览器');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'zh-CN';
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => {
      setIsListening(true);
      speak('请说出您想去的地方');
    };

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript.toLowerCase();
      setIsListening(false);

      // Match spoken text to targets
      const targetMap: Record<string, string> = {
        '洗手间': '洗手间/厕所',
        '厕所': '洗手间/厕所',
        '卫生间': '洗手间/厕所',
        '出口': '出口',
        '安全出口': '出口',
        '电梯': '电梯',
        '楼梯': '楼梯',
        '扶梯': '楼梯',
        '收银台': '收银台',
        '结账': '收银台',
      };

      let matchedTarget: string | null = null;
      for (const [keyword, targetValue] of Object.entries(targetMap)) {
        if (transcript.includes(keyword)) {
          matchedTarget = targetValue;
          break;
        }
      }

      if (matchedTarget) {
        setTarget(matchedTarget);
        speak(`已选择${matchedTarget}`);
      } else {
        // 未匹配预设目标，使用用户说的内容作为自定义目标
        const customTarget = transcript.trim();
        if (customTarget.length > 0) {
          setTarget(customTarget);
          speak(`已选择${customTarget}`);
        } else {
          speak(`未识别到内容，请重试`);
        }
      }
    };

    recognition.onerror = () => {
      setIsListening(false);
      speak('语音识别失败，请重试');
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, [speak]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsListening(false);
  }, []);

  // Haptic feedback
  const hapticImpact = useCallback(
    (style: Haptics.ImpactFeedbackStyle) => {
      Haptics.impactAsync(style);
    },
    []
  );

  // Capture a single frame
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
        // Resize image to max 1024px on longest side to reduce payload size for mobile
        const manipulated = await manipulateAsync(
          photo.uri,
          [{ resize: { width: 1024 } }],
          { compress: 0.6, format: SaveFormat.JPEG, base64: true }
        );
        if (manipulated?.base64) {
          const frame = `data:image/jpeg;base64,${manipulated.base64}`;
          framesRef.current.push(frame);
          console.log(`Frame captured, size: ${Math.round(manipulated.base64.length / 1024)}KB`);
        }
      }
    } catch (e) {
      console.error('Capture error:', e);
    } finally {
      isCapturingRef.current = false;
    }
  }, []);

  // Analyze captured frames
  const analyzeFrames = useCallback(
    async (frames: string[]) => {
      setAppState('processing');
      // Release camera immediately after recording
      setCameraActive(false);
      speak('正在分析周围环境，请稍候');

      try {
        const totalSize = frames.reduce((sum, f) => sum + f.length, 0);
        console.log(`[Analyze] Sending ${frames.length} frames, total size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);

        // Use AbortController for timeout (90 seconds for large image analysis)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 90000);

        const response = await fetch(
          `${process.env.EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/analyze`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ images: frames, target }),
            signal: controller.signal,
          }
        );

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errText = await response.text();
          console.error('[Analyze] API error:', response.status, errText);
          throw new Error(`Analysis failed: ${response.status}`);
        }

        const data = await response.json();
        const analysisResult: AnalysisResult = {
          text: data.result,
          timestamp: Date.now(),
        };

        setResult(analysisResult);
        setAppState('result');

        setTimeout(() => {
          speak(data.result);
        }, 500);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        console.error('[Analyze] Error:', msg);
        setErrorMsg('分析失败，请重试');
        setAppState('error');
        speak('分析失败，请重试');
      } finally {
        // Free memory by clearing captured frames
        framesRef.current = [];
      }
    },
    [speak, target]
  );

  // Start recording
  const startRecording = useCallback(() => {
    framesRef.current = [];
    setRecordingProgress(0);

    // Capture first frame immediately
    captureFrame();
    hapticImpact(Haptics.ImpactFeedbackStyle.Medium);

    // Capture frames at intervals
    const interval = (RECORDING_DURATION * 1000) / (FRAME_COUNT + 1);
    captureTimerRef.current = setInterval(() => {
      captureFrame();
      hapticImpact(Haptics.ImpactFeedbackStyle.Light);
    }, interval);

    // Progress tracking
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
        hapticImpact(Haptics.ImpactFeedbackStyle.Heavy);
        analyzeFrames(framesRef.current);
      }
    }, 100);
  }, [captureFrame, hapticImpact, analyzeFrames]);

  // Start the whole flow
  const handleStart = useCallback(async () => {
    if (appState !== 'idle') return;

    let perm = cameraPermission;
    if (!perm?.granted) {
      perm = await requestCameraPermission();
      if (!perm.granted) {
        setErrorMsg('无法访问摄像头，请检查权限设置');
        setAppState('error');
        speak('无法访问摄像头，请检查权限设置');
        return;
      }
    }

    setAppState('countdown');
    setCountdown(3);
    setCameraActive(true);
    speak('准备开始扫描环境，请持手机在胸前');
    hapticImpact(Haptics.ImpactFeedbackStyle.Medium);

    let count = 3;
    countdownTimerRef.current = setInterval(() => {
      count--;
      setCountdown(count);

      if (count > 0) {
        speak(String(count));
        hapticImpact(Haptics.ImpactFeedbackStyle.Light);
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
  }, [
    appState,
    cameraPermission,
    requestCameraPermission,
    speak,
    hapticImpact,
    startRecording,
  ]);

  // Reset to idle
  const handleReset = useCallback(() => {
    try {
      Speech.stop();
    } catch {
      // Ignore
    }
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    if (captureTimerRef.current) {
      clearInterval(captureTimerRef.current);
      captureTimerRef.current = null;
    }
    framesRef.current = [];
    setCameraActive(false);
    setAppState('idle');
    setResult(null);
    setErrorMsg('');
    setRecordingProgress(0);
  }, []);

  // Repeat result
  const handleRepeatResult = useCallback(() => {
    if (result) {
      speak(result.text);
    }
  }, [result, speak]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      try {
        Speech.stop();
      } catch {
        // Ignore
      }
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
      if (captureTimerRef.current) clearInterval(captureTimerRef.current);
    };
  }, []);

  const isCameraActive = cameraActive && (appState === 'countdown' || appState === 'recording');

  return (
    <Screen
      safeAreaEdges={['top', 'bottom', 'left', 'right']}
      statusBarStyle="light"
    >
      <View style={styles.container}>
        {/* Camera preview (only during recording) */}
        {isCameraActive && (
          <CameraView
            ref={cameraRef}
            style={StyleSheet.absoluteFillObject}
            facing="back"
          />
        )}

        {/* Dark overlay during camera states */}
        {isCameraActive && <View style={styles.cameraOverlay} />}

        {/* ===== RECORDING STATE ===== */}
        {appState === 'recording' && (
          <View style={styles.recordingContainer}>
            <View style={styles.recordingBadge}>
              <View style={styles.recordingDot} />
              <Text style={styles.recordingText}>录制中...</Text>
            </View>
            {/* Progress bar */}
            <View style={styles.progressBarBg}>
              <View
                style={[
                  styles.progressBarFill,
                  { width: `${recordingProgress * 100}%` as unknown as number },
                ]}
              />
            </View>
            <Text style={styles.recordingHint}>请缓慢原地转一圈</Text>
          </View>
        )}

        {/* ===== COUNTDOWN STATE ===== */}
        {appState === 'countdown' && (
          <View style={styles.countdownOverlay}>
            <View style={styles.countdownCard}>
              <Text style={styles.countdownNumber}>{countdown}</Text>
              <Text style={styles.countdownHint}>准备开始...</Text>
            </View>
          </View>
        )}

        {/* ===== PROCESSING STATE ===== */}
        {appState === 'processing' && (
          <View style={styles.centerOverlay}>
            <View style={styles.processingCard}>
              <ActivityIndicator size="large" color={COLORS.amber} />
              <Text style={styles.processingTitle}>AI 正在分析环境</Text>
              <Text style={styles.processingHint}>
                请稍候，正在识别周围环境...
              </Text>
            </View>
          </View>
        )}

        {/* ===== ERROR STATE ===== */}
        {appState === 'error' && (
          <View style={styles.centerOverlay}>
            <View style={styles.resultCard}>
              <View style={[styles.iconCircle, { backgroundColor: 'rgba(239,68,68,0.2)' }]}>
                <FontAwesome6 name="triangle-exclamation" size={32} color={COLORS.redLight} />
              </View>
              <Text style={styles.errorText}>{errorMsg || '出现错误'}</Text>
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={handleReset}
                activeOpacity={0.8}
              >
                <Text style={styles.primaryButtonText}>返回首页</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ===== RESULT STATE ===== */}
        {appState === 'result' && result && (
          <View style={styles.centerOverlay}>
            <View style={styles.resultCard}>
              <View style={[styles.iconCircle, { backgroundColor: 'rgba(16,185,129,0.2)' }]}>
                <FontAwesome6 name="check" size={32} color={COLORS.greenLight} />
              </View>
              <Text style={styles.resultTitle}>分析完成</Text>
              <View style={styles.resultTextBox}>
                <Text style={styles.resultText}>{result.text}</Text>
              </View>
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={handleRepeatResult}
                activeOpacity={0.8}
              >
                <FontAwesome6 name="volume-high" size={20} color="#000" />
                <Text style={[styles.primaryButtonText, { marginLeft: 8 }]}>
                  再播报一次
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={handleReset}
                activeOpacity={0.8}
              >
                <Text style={styles.secondaryButtonText}>重新扫描</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ===== IDLE STATE ===== */}
        {appState === 'idle' && (
          <>
            {/* Voice command button - above camera preview */}
            <TouchableOpacity
              style={[styles.micButtonLarge, isListening && styles.micButtonLargeActive]}
              onPress={(e) => {
                e.stopPropagation?.();
                if (isListening) {
                  stopListening();
                } else {
                  startListening();
                }
              }}
              activeOpacity={0.7}
            >
              <FontAwesome6
                name={isListening ? 'microphone' : 'microphone-lines'}
                size={22}
                color={isListening ? COLORS.accentOrange : COLORS.white80}
              />
              <Text style={[styles.micButtonLargeText, isListening && styles.micButtonLargeTextActive]}>
                {isListening ? '正在聆听... 请说出您想去的地方' : '点击语音说出您想去的地方'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.idleContainer}
              activeOpacity={0.9}
              onPress={handleStart}
            >
            {/* Target selector */}
            <View style={styles.targetPickerContainer}>
              <TouchableOpacity
                style={styles.targetButton}
                onPress={(e) => {
                  e.stopPropagation?.();
                  const next = !showTargetPicker;
                  setShowTargetPicker(next);
                  if (next) {
                    try { Speech.speak(`当前目标：${target}`, { language: 'zh-CN', rate: 1.0 }); } catch { /* ignore */ }
                  }
                }}
                activeOpacity={0.7}
              >
                <FontAwesome6 name="magnifying-glass" size={16} color={COLORS.white60} />
                <Text style={styles.targetButtonText}>寻找: {target}</Text>
              </TouchableOpacity>

              {showTargetPicker && (
                <Modal
                  visible={showTargetPicker}
                  transparent
                  animationType="fade"
                  onRequestClose={() => setShowTargetPicker(false)}
                >
                  <TouchableOpacity
                    style={styles.modalBackdrop}
                    activeOpacity={1}
                    onPress={() => setShowTargetPicker(false)}
                  >
                    <View style={styles.targetPickerPanel}>
                      {COMMON_TARGETS.map((t) => (
                        <TouchableOpacity
                          key={t}
                          style={[
                            styles.targetOption,
                            target === t && styles.targetOptionActive,
                          ]}
                          onPress={() => {
                            setTarget(t);
                            setShowTargetPicker(false);
                            try { Speech.speak(t, { language: 'zh-CN', rate: 1.0 }); } catch { /* ignore */ }
                          }}
                        >
                          <Text
                            style={[
                              styles.targetOptionText,
                              target === t && styles.targetOptionTextActive,
                            ]}
                          >
                            {t}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </TouchableOpacity>
                </Modal>
              )}
            </View>

            {/* Main content */}
            <View style={styles.idleCard}>
              {/* Pulsing circle */}
              <View style={styles.pulseContainer}>
                <View style={[styles.pulseOuter, styles.pulseAnimSlow]} />
                <View style={[styles.pulseMiddle, styles.pulseAnimSlower]} />
                <View style={styles.pulseInner}>
                  <FontAwesome6 name="video" size={48} color={COLORS.white} />
                </View>
              </View>

              <Text style={styles.appTitle}>Sight Aid</Text>
              <Text style={styles.appSubtitle}>AI 视觉辅助</Text>
              <Text style={styles.startHint}>点击屏幕任意位置开始扫描</Text>
            </View>

            {/* Bottom hint */}
            <View style={styles.bottomHint}>
              <Text style={styles.bottomHintText}>
                打开摄像头，原地转一圈，AI 帮你找到目标
              </Text>
            </View>
          </TouchableOpacity>
          </>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  cameraOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },

  // Recording state
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

  // Countdown state
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

  // Center overlay (processing, error, result)
  centerOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(10,14,26,0.8)',
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

  // Result / Error card
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

  // Idle state
  idleContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  targetPickerContainer: {
    position: 'absolute',
    top: 60,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 30,
  },
  targetButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 999,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  micButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 999,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  micButtonActive: {
    backgroundColor: 'rgba(255,107,59,0.15)',
    borderColor: COLORS.accentOrange,
  },
  micButtonLarge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 999,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    alignSelf: 'center',
    width: '70%',
  },
  micButtonLargeActive: {
    backgroundColor: 'rgba(255,107,59,0.15)',
    borderColor: COLORS.accentOrange,
  },
  micButtonText: {
    fontSize: 16,
    color: COLORS.white60,
    fontWeight: '500',
  },
  micButtonTextActive: {
    color: COLORS.accentOrange,
  },
  targetButtonText: {
    fontSize: 16,
    color: 'rgba(255,255,255,0.8)',
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  targetPickerPanel: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 20,
    padding: 12,
    minWidth: 200,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  targetOption: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
  },
  targetOptionActive: {
    backgroundColor: 'rgba(245,158,11,0.2)',
  },
  targetOptionText: {
    fontSize: 17,
    color: 'rgba(255,255,255,0.8)',
  },
  targetOptionTextActive: {
    color: COLORS.amberLight,
    fontWeight: '600',
  },
  idleCard: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 24,
    paddingHorizontal: 48,
    paddingVertical: 40,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  pulseContainer: {
    width: 160,
    height: 160,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  pulseOuter: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: 'rgba(245,158,11,0.15)',
  },
  pulseMiddle: {
    position: 'absolute',
    width: 128,
    height: 128,
    borderRadius: 64,
    backgroundColor: 'rgba(245,158,11,0.25)',
  },
  pulseInner: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: COLORS.amber,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pulseAnimSlow: {
    // Static pulse effect for now (animation would need reanimated)
    opacity: 0.8,
  },
  pulseAnimSlower: {
    opacity: 0.9,
  },
  appTitle: {
    fontSize: 32,
    fontWeight: '700',
    color: COLORS.white,
    marginBottom: 4,
  },
  appSubtitle: {
    fontSize: 18,
    color: 'rgba(255,255,255,0.7)',
  },
  startHint: {
    fontSize: 16,
    color: COLORS.amberLight,
    marginTop: 24,
    opacity: 0.8,
  },
  bottomHint: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  bottomHintText: {
    fontSize: 14,
    color: COLORS.white40,
  },
});
