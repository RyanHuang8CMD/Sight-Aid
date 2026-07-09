import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { Screen } from '@/components/Screen';
import { useSafeRouter } from '@/hooks/useSafeRouter';
import * as Speech from 'expo-speech';
import { FontAwesome6 } from '@expo/vector-icons';

export default function HomeScreen() {
  const router = useSafeRouter();
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  // TTS function
  const speak = useCallback((text: string) => {
    try { Speech.stop(); } catch {}
    Speech.speak(text, { language: 'zh-CN', rate: 0.9 });
  }, []);

  // Handle voice commands - MUST be before startListening
  const handleVoiceCommand = useCallback((text: string) => {
    setIsListening(false);
    if (text.includes('搜索') || text.includes('找') || text.includes('转圈') || text.includes('目标') || text.includes('扫描')) {
      speak('正在进入搜索模式');
      setTimeout(() => router.push('/scanner'), 1000);
    } else if (text.includes('导航') || text.includes('走路') || text.includes('走') || text.includes('避障') || text.includes('前行')) {
      speak('正在进入导航模式');
      setTimeout(() => router.push('/navigator'), 1000);
    } else {
      speak('未识别到指令，请说搜索目标或实时导航');
    }
  }, [speak, router]);

  // Voice recognition setup
  const startListening = useCallback(() => {
    if (typeof window === 'undefined') {
      speak('语音功能仅在浏览器中可用');
      return;
    }
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      speak('当前浏览器不支持语音识别，请使用 Chrome');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'zh-CN';
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => {
      setIsListening(true);
      speak('请说出指令');
    };

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript.toLowerCase();
      handleVoiceCommand(transcript);
    };

    recognition.onerror = () => {
      setIsListening(false);
      speak('未识别到指令，请重试');
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, [speak, handleVoiceCommand]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      try { recognitionRef.current?.stop(); } catch {}
      try { Speech.stop(); } catch {}
    };
  }, []);

  return (
    <Screen safeAreaEdges={['top', 'bottom', 'left', 'right']}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.appName}>SIGHT AID</Text>
          <Text style={styles.subtitle}>AI 视觉辅助</Text>
        </View>

        {/* Mode Buttons */}
        <View style={styles.modeContainer}>
          {/* Mode 1: 360° Scan */}
          <TouchableOpacity
            style={styles.modeButton}
            onPress={() => router.push('/scanner')}
            activeOpacity={0.8}
          >
            <View style={[styles.iconContainer, { backgroundColor: 'rgba(249, 115, 22, 0.15)' }]}>
              <FontAwesome6 name="rotate" size={32} color="#F97316" />
            </View>
            <Text style={styles.modeTitle}>360° 搜索目标</Text>
            <Text style={styles.modeDesc}>原地转一圈，搜索周边目标{'\n'}如洗手间、出口、电梯等</Text>
          </TouchableOpacity>

          {/* Mode 2: Real-time Navigation */}
          <TouchableOpacity
            style={styles.modeButton}
            onPress={() => router.push('/navigator')}
            activeOpacity={0.8}
          >
            <View style={[styles.iconContainer, { backgroundColor: 'rgba(59, 130, 246, 0.15)' }]}>
              <FontAwesome6 name="person-walking" size={32} color="#3B82F6" />
            </View>
            <Text style={styles.modeTitle}>实时导航</Text>
            <Text style={styles.modeDesc}>边走边识别，实时播报障碍物{'\n'}自动避障导航</Text>
          </TouchableOpacity>
        </View>

        {/* Voice Command Button */}
        <TouchableOpacity
          style={[styles.voiceButton, isListening && styles.voiceButtonActive]}
          onPress={startListening}
          activeOpacity={0.8}
        >
          <FontAwesome6
            name={isListening ? 'microphone' : 'microphone-lines'}
            size={24}
            color="#fff"
          />
          <Text style={styles.voiceButtonText}>
            {isListening ? '正在聆听...' : '语音指令'}
          </Text>
        </TouchableOpacity>

        <Text style={styles.voiceHint}>
          说「搜索目标」或「实时导航」即可进入对应模式
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0E1A',
    paddingHorizontal: 24,
    paddingTop: 60,
    alignItems: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: 48,
  },
  appName: {
    fontSize: 36,
    fontWeight: '800',
    color: '#F97316',
    letterSpacing: 4,
  },
  subtitle: {
    fontSize: 16,
    color: 'rgba(255,255,255,0.5)',
    marginTop: 8,
  },
  modeContainer: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 40,
    width: '100%',
  },
  modeButton: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 20,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  modeTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 8,
    textAlign: 'center',
  },
  modeDesc: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.5)',
    textAlign: 'center',
    lineHeight: 20,
  },
  voiceButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 32,
    gap: 10,
    marginBottom: 16,
    width: '80%',
  },
  voiceButtonActive: {
    backgroundColor: '#F97316',
  },
  voiceButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  voiceHint: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.3)',
    textAlign: 'center',
  },
});
