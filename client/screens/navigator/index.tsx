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
const CAPTURE_INTERVAL = 3000;

type NavState = 'idle' | 'navigating';

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
    if (permission && !permission.granted) {
      requestPermission();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

        if (advice !== lastSpokeRef.current && advice !== '安全，继续前行。') {
          lastSpokeRef.current = advice;
          speak(advice);
        } else if (advice === '安全，继续前行。') {
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

  const goToSearchMode = useCallback(() => {
    // 彻底停掉导航的一切：定时器、TTS、状态
    setNavState('idle');
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setCurrentAdvice('');
    setObstacleCount(0);
    try { Speech.stop(); } catch {}
    // 不说话，直接跳转，避免 TTS 残留被搜索页录到
    router.push('/scanner');
  }, [navState, router]);

  return (
    <Screen style={styles.container} safeAreaEdges={['top', 'bottom', 'left', 'right']}>
      {permission?.granted && (
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing="back"
        />
      )}

      <View style={styles.overlay} />

      {/* Top status bar */}
      <View style={styles.topBar}>
        <View style={styles.topBarContent}>
          <View style={styles.statusIndicator}>
            {navState === 'navigating' && (
              <>
                <View style={[styles.dot, isProcessing ? styles.dotProcessing : styles.dotActive]} />
                <Text style={styles.statusText}>导航中</Text>
              </>
            )}
            {navState === 'idle' && (
              <>
                <View style={styles.dotIdle} />
                <Text style={styles.statusTextIdle}>待命</Text>
              </>
            )}
          </View>
          {navState === 'navigating' && (
            <View style={styles.statsBadge}>
              <Text style={styles.statsText}>识别 {obstacleCount} 次</Text>
              {isProcessing && (
                <ActivityIndicator size="small" color="#F97316" />
              )}
            </View>
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
        {/* Navigation toggle button */}
        {navState === 'idle' ? (
          <TouchableOpacity style={styles.startButton} onPress={startNavigation}>
            <FontAwesome6 name="location-arrow" size={26} color="#fff" />
            <Text style={styles.startButtonText}>开始导航</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.stopButton} onPress={stopNavigation}>
            <FontAwesome6 name="stop" size={26} color="#fff" />
            <Text style={styles.stopButtonText}>停止导航</Text>
          </TouchableOpacity>
        )}

        {/* Search mode button - direct toggle */}
        <TouchableOpacity style={styles.searchButton} onPress={goToSearchMode}>
          <FontAwesome6 name="search" size={22} color="#F97316" />
          <Text style={styles.searchButtonText}>搜索目标</Text>
        </TouchableOpacity>
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
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'web' ? 20 : 50,
    paddingBottom: 12,
    zIndex: 10,
  },
  topBarContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statusIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusText: {
    color: '#22c55e',
    fontSize: 14,
    fontWeight: '600',
  },
  statusTextIdle: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 14,
    fontWeight: '600',
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  dotIdle: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  dotActive: {
    backgroundColor: '#22c55e',
  },
  dotProcessing: {
    backgroundColor: '#F97316',
  },
  statsBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  statsText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
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
  searchButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 16,
    paddingHorizontal: 36,
    borderRadius: 50,
    backgroundColor: 'rgba(249,115,22,0.15)',
    borderWidth: 1.5,
    borderColor: 'rgba(249,115,22,0.4)',
    marginTop: 16,
  },
  searchButtonText: {
    color: '#F97316',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.5,
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
