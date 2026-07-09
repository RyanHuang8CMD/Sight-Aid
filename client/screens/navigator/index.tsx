import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Speech from 'expo-speech';
import { useSafeRouter } from '@/hooks/useSafeRouter';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Screen } from '@/components/Screen';
import { FontAwesome6 } from '@expo/vector-icons';

const EXPO_PUBLIC_BACKEND_BASE_URL = process.env.EXPO_PUBLIC_BACKEND_BASE_URL;
const CAPTURE_INTERVAL = 3000; // Capture every 3 seconds

type NavState = 'idle' | 'navigating' | 'paused';

interface Obstacle {
  direction: string;
  description: string;
  timestamp: number;
}

export default function NavigatorScreen() {
  const router = useSafeRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [navState, setNavState] = useState<NavState>('idle');
  const [currentAdvice, setCurrentAdvice] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [obstacleCount, setObstacleCount] = useState(0);

  const cameraRef = useRef<CameraView>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSpokeRef = useRef<string>('');
  const isProcessingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
      try { Speech.stop(); } catch {}
    };
  }, []);

  const speak = useCallback((text: string) => {
    try {
      Speech.stop();
    } catch {}
    setTimeout(() => {
      Speech.speak(text, { language: 'zh-CN', rate: 1.0 });
    }, 100);
  }, []);

  useEffect(() => {
    if (!permission) return;
    if (!permission.granted) {
      requestPermission();
    }
  }, [permission, requestPermission]);

  const analyzeFrame = useCallback(async (base64: string) => {
    if (isProcessingRef.current || !mountedRef.current) return;
    isProcessingRef.current = true;
    setIsProcessing(true);

    try {
      const response = await fetch(`${EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/navigate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64 }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      if (!mountedRef.current) return;

      if (data.result && data.result.trim()) {
        const advice = data.result.trim();
        setCurrentAdvice(advice);
        setObstacleCount(prev => prev + 1);

        // Only speak if the advice is different from the last one
        if (advice !== lastSpokeRef.current && advice !== '安全，继续前行。') {
          lastSpokeRef.current = advice;
          speak(advice);
        } else if (advice === '安全，继续前行。') {
          // Only announce "safe" every 5th time to avoid repetition
          if (obstacleCount % 5 === 0) {
            speak('前方安全，继续前行。');
          }
          lastSpokeRef.current = '';
        }
      }
    } catch (err) {
      console.error('Navigation analysis error:', err);
    } finally {
      isProcessingRef.current = false;
      if (mountedRef.current) setIsProcessing(false);
    }
  }, [speak, obstacleCount]);

  const captureAndAnalyze = useCallback(async () => {
    if (!cameraRef.current || isProcessingRef.current) return;

    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.4,
        base64: true,
        skipProcessing: true,
      });

      if (!photo?.base64) return;

      let base64Data = photo.base64;
      if (base64Data.startsWith('data:')) {
        base64Data = base64Data.split(',')[1];
      }

      // Resize to reduce payload
      const manipResult = await ImageManipulator.manipulateAsync(
        `data:image/jpeg;base64,${base64Data}`,
        [{ resize: { width: 640 } }],
        { compress: 0.5, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );

      const resizedBase64 = manipResult.base64;
      if (!resizedBase64) return;

      await analyzeFrame(resizedBase64);
    } catch (err) {
      console.error('Capture error:', err);
    }
  }, [analyzeFrame]);

  const startNavigation = useCallback(() => {
    setNavState('navigating');
    setCurrentAdvice('正在启动导航...');
    speak('实时导航已启动，请注意语音提示。');

    // Start capturing immediately, then every 3 seconds
    setTimeout(() => {
      captureAndAnalyze();
      intervalRef.current = setInterval(captureAndAnalyze, CAPTURE_INTERVAL);
    }, 2000);
  }, [captureAndAnalyze, speak]);

  const stopNavigation = useCallback(() => {
    setNavState('idle');
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setCurrentAdvice('');
    setObstacleCount(0);
    try { Speech.stop(); } catch {}
  }, []);

  const goBack = useCallback(() => {
    stopNavigation();
    router.back();
  }, [stopNavigation, router]);

  return (
    <Screen style={styles.container} safeAreaEdges={['top', 'bottom', 'left', 'right']}>
      {/* Camera preview - always visible */}
      {permission?.granted && (
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing="back"
        />
      )}

      {/* Dark overlay for readability */}
      <View style={styles.overlay} />

      {/* Top bar */}
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.backButton} onPress={goBack}>
          <FontAwesome6 name="arrow-left" size={20} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.topTitle}>实时导航</Text>
        <View style={styles.statusDot}>
          {navState === 'navigating' && (
            <View style={[styles.dot, isProcessing ? styles.dotProcessing : styles.dotActive]} />
          )}
        </View>
      </View>

      {/* Center advice display */}
      {currentAdvice ? (
        <View style={styles.adviceContainer}>
          <Text style={styles.adviceText}>{currentAdvice}</Text>
        </View>
      ) : null}

      {/* Bottom controls */}
      <View style={styles.bottomBar}>
        {navState === 'idle' ? (
          <TouchableOpacity style={styles.startButton} onPress={startNavigation}>
            <FontAwesome6 name="location-arrow" size={28} color="#fff" />
            <Text style={styles.startButtonText}>开始导航</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.stopButton} onPress={stopNavigation}>
            <FontAwesome6 name="stop" size={28} color="#fff" />
            <Text style={styles.stopButtonText}>停止导航</Text>
          </TouchableOpacity>
        )}

        {navState === 'navigating' && (
          <View style={styles.statsBar}>
            <Text style={styles.statsText}>
              已识别 {obstacleCount} 次
            </Text>
            {isProcessing && (
              <ActivityIndicator size="small" color="#F97316" />
            )}
          </View>
        )}
      </View>

      {/* Permission request */}
      {!permission?.granted && (
        <View style={styles.permissionContainer}>
          <FontAwesome6 name="camera" size={48} color="#F97316" />
          <Text style={styles.permissionText}>需要摄像头权限</Text>
          <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
            <Text style={styles.permissionButtonText}>授权摄像头</Text>
          </TouchableOpacity>
        </View>
      )}
    </Screen>
  );
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'web' ? 20 : 50,
    paddingBottom: 12,
    zIndex: 10,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  topTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  statusDot: {
    width: 44,
    alignItems: 'flex-end',
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  dotActive: {
    backgroundColor: '#22c55e',
  },
  dotProcessing: {
    backgroundColor: '#F97316',
  },
  adviceContainer: {
    position: 'absolute',
    top: '35%',
    left: 20,
    right: 20,
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderRadius: 16,
    padding: 20,
    zIndex: 10,
  },
  adviceText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 30,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingBottom: Platform.OS === 'web' ? 30 : 40,
    paddingTop: 20,
    paddingHorizontal: 20,
    zIndex: 10,
  },
  startButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: '#F97316',
    paddingVertical: 20,
    paddingHorizontal: 48,
    borderRadius: 60,
    width: SCREEN_WIDTH * 0.7,
  },
  startButtonText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 1,
  },
  stopButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: '#ef4444',
    paddingVertical: 20,
    paddingHorizontal: 48,
    borderRadius: 60,
    width: SCREEN_WIDTH * 0.7,
  },
  stopButtonText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 1,
  },
  statsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 16,
  },
  statsText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
  },
  permissionContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    backgroundColor: '#0A0E1A',
    zIndex: 20,
  },
  permissionText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  permissionButton: {
    backgroundColor: '#F97316',
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
  },
  permissionButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});
