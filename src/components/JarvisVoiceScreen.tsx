import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  Platform,
  Pressable,
  Animated,
  Easing,
  Dimensions,
  Switch,
  TextInput,
  ActivityIndicator,
  ScrollView,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { SafeAreaView } from 'react-native-safe-area-context'
import SimpleVoiceOrb from '../components/SimpleVoiceOrb'
import { getRandomValues } from 'expo-crypto'
import * as Haptics from 'expo-haptics'
import { useFonts as useOrbitron, Orbitron_700Bold } from '@expo-google-fonts/orbitron'
import { useFonts as useRajdhani, Rajdhani_300Light, Rajdhani_500Medium } from '@expo-google-fonts/rajdhani'
import { useWakeWord } from '../hooks/useWakeWord'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useVoiceAssistant } from '../hooks/useVoiceAssistant'
import apiClient from '../services/apiClient'
import { useSettingsStore } from '../store/settingsStore'

const { width: screenWidth } = Dimensions.get('window')
const SPHERE_SIZE = Math.min(screenWidth * 0.88, 340)

function WaveBars({ visible }: { visible: boolean }) {
  const heights = [10, 22, 34, 18, 30, 14, 36, 20, 26]
  const anims = useRef(heights.map(() => new Animated.Value(0.35))).current

  useEffect(() => {
    const loops = anims.map((a, i) => {
      const seq = Animated.sequence([
        Animated.timing(a, {
          toValue: 1,
          duration: 420,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
          delay: i * 80,
        }),
        Animated.timing(a, {
          toValue: 0.35,
          duration: 420,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
      return Animated.loop(seq)
    })

    if (visible) {
      loops.forEach((l) => l.start())
    }

    return () => loops.forEach((l) => l.stop())
  }, [visible, anims])

  return (
    <View style={styles.waveRow}>
      {heights.map((h, i) => (
        <Animated.View
          key={i}
          style={[
            styles.waveBar,
            {
              height: h,
              transform: [{ scaleY: anims[i] }],
              marginHorizontal: 4,
            },
          ]}
        />
      ))}
    </View>
  )
}

type Props = {
  onNavigate?: (route: 'home' | 'profile' | 'history' | 'knowledge' | 'settings') => void
}

const LOCAL_ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

export function createLocalUserId() {
  const bytes = getRandomValues(new Uint8Array(6))
  const suffix = Array.from(bytes, (byte) => LOCAL_ID_ALPHABET[byte % LOCAL_ID_ALPHABET.length] ?? '0').join(
    '',
  )
  return `local-${Date.now().toString(36)}-${suffix}`
}

function formatTtsVoiceLabel(voice: string) {
  if (voice === 'aura-2-thalia-en') {
    return 'Default voice'
  }
  return voice
    .replace(/^aura-\d+-/i, '')
    .replace(/-en$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

export default function JarvisVoiceScreen({ onNavigate }: Props) {
  const [orbitronLoaded] = useOrbitron({ Orbitron_700Bold })
  const [rajdhaniLoaded] = useRajdhani({ Rajdhani_300Light, Rajdhani_500Medium })
  const fontsLoaded = orbitronLoaded && rajdhaniLoaded

  const [wakeEnabled, setWakeEnabled] = useState(false)
  const [draft, setDraft] = useState('')
  const [isBootstrapping, setIsBootstrapping] = useState(true)
  const [backendStatus, setBackendStatus] = useState<'checking' | 'connected' | 'offline'>('checking')
  const [ttsVoices, setTtsVoices] = useState<string[]>([])
  const toggleRecordingInFlight = useRef(false)
  const backendLastSeenAt = useRef(0)
  const wake = useWakeWord()
  const userId = useSettingsStore((s) => s.userId)
  const setUser = useSettingsStore((s) => s.setUser)
  const preferredTtsVoice = useSettingsStore((s) => s.settings.preferredTtsVoice)
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const markBackendConnected = useCallback(() => {
    backendLastSeenAt.current = Date.now()
    setBackendStatus('connected')
  }, [])

  const {
    isListening,
    isProcessing,
    isSpeaking,
    isReady,
    error,
    transcript,
    response,
    streamingResponse,
    lastLatency,
    startListening,
    stopListening,
    sendText,
    cancel,
  } = useVoiceAssistant({
    streamLLM: true,
    playAudio: true,
    onComplete: markBackendConnected,
  })

  const WAKE_KEY = 'wakeEnabled_v1'

  useEffect(() => {
    let active = true

    async function bootstrapUser() {
      const stableUserId = userId || createLocalUserId()

      try {
        if (!userId) {
          setUser(stableUserId, `${stableUserId}@local.invalid`, 'Local User')
        }
      } finally {
        if (active) {
          setIsBootstrapping(false)
        }
      }

      void apiClient.getOrCreateUser(stableUserId).catch((bootstrapError) => {
        console.warn('Unable to create backend user, continuing in local mode', bootstrapError)
      })
    }

    void bootstrapUser()
    return () => {
      active = false
    }
  }, [setUser, userId])

  useEffect(() => {
    let active = true

    const checkBackend = async () => {
      try {
        await apiClient.checkHealth()
        if (active) markBackendConnected()
      } catch {
        if (active && Date.now() - backendLastSeenAt.current > 30000) {
          setBackendStatus('offline')
        }
      }
    }

    const loadVoices = async () => {
      try {
        const payload = await apiClient.getTtsVoices()
        if (!active) return
        markBackendConnected()
        setTtsVoices(payload.voices || [])
        if (!preferredTtsVoice && payload.default) {
          updateSettings({ preferredTtsVoice: payload.default })
        }
      } catch {
        if (active) setTtsVoices([])
      }
    }

    void checkBackend()
    void loadVoices()
    const intervalId = setInterval(() => {
      void checkBackend()
    }, 10000)

    return () => {
      active = false
      clearInterval(intervalId)
    }
  }, [markBackendConnected, preferredTtsVoice, updateSettings])

  const onToggleRecording = useCallback(async () => {
    if (toggleRecordingInFlight.current || isBootstrapping) {
      return
    }

    toggleRecordingInFlight.current = true
    try {
      if (isListening) {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
        void stopListening()
        return
      }

      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
      await cancel()
      await startListening()
    } finally {
      toggleRecordingInFlight.current = false
    }
  }, [cancel, isBootstrapping, isListening, startListening, stopListening])

  useEffect(() => {
    wake.onWake(() => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
      void startListening()
      setTimeout(() => {
        void stopListening()
      }, 2500)
    })
  }, [startListening, stopListening, wake])

  useEffect(() => {
    let mounted = true
    async function apply() {
      if (!mounted) return
      if (wakeEnabled) {
        await wake.start()
      } else {
        await wake.stop()
      }
    }
    void apply()
    return () => {
      mounted = false
    }
  }, [wakeEnabled, wake])

  useEffect(() => {
    let mounted = true
    async function load() {
      try {
        const value = await AsyncStorage.getItem(WAKE_KEY)
        if (!mounted) return
        setWakeEnabled(value === '1')
      } catch {
        // ignore persisted wake-word read failures
      }
    }
    void load()
    return () => {
      mounted = false
    }
  }, [])

  const toggleWake = useCallback(async (value: boolean) => {
    try {
      setWakeEnabled(value)
      await AsyncStorage.setItem(WAKE_KEY, value ? '1' : '0')
    } catch {
      // ignore wake-word persistence write errors
    }
  }, [])

  const displayResponse = streamingResponse || response
  const statusLabel = useMemo(() => {
    if (isBootstrapping) return 'Booting assistant'
    if (isListening) return 'Listening'
    if (isSpeaking) return 'Speaking'
    if (isProcessing) return 'Thinking'
    if (!isReady) return 'Preparing audio'
    return 'Ready'
  }, [isBootstrapping, isListening, isProcessing, isReady, isSpeaking])

  const recordingLabel = useMemo(() => {
    if (isBootstrapping) return 'Preparing local session'
    if (isProcessing || isSpeaking) return 'Interrupt and ask another question'
    if (isListening) return 'Stop recording and send'
    return 'Start voice recording'
  }, [isBootstrapping, isListening, isProcessing, isSpeaking])

  const backendLabel = useMemo(() => {
    if (backendStatus === 'checking') return 'Backend: checking'
    if (backendStatus === 'connected') return 'Backend: online'
    return 'Backend: offline'
  }, [backendStatus])

  const latencyLabel = useMemo(() => {
    if (lastLatency == null) return 'No reply yet'
    return `Last reply ${lastLatency} ms`
  }, [lastLatency])

  const handleSendText = useCallback(async () => {
    const trimmed = draft.trim()
    if (!trimmed || isProcessing || isBootstrapping) {
      return
    }
    setDraft('')
    await sendText(trimmed)
  }, [draft, isBootstrapping, isProcessing, sendText])

  if (!fontsLoaded) return null

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Text style={styles.logo}>JARVIS</Text>
        <View style={styles.headerRight}>
          <Switch
            value={wakeEnabled}
            onValueChange={toggleWake}
            trackColor={{ false: '#173947', true: '#00d4ff' }}
            thumbColor={wakeEnabled ? '#ffffff' : '#f4f3f4'}
            accessibilityLabel="Enable wake word"
            accessibilityHint="Listens for the wake word when enabled"
          />
          <Pressable
            onPress={() => onNavigate?.('profile')}
            style={styles.iconButton}
            accessibilityRole="button"
            accessibilityLabel="Open profile"
          >
            <Ionicons name="person-circle-outline" size={28} color="#00d4ff" />
          </Pressable>
        </View>
      </View>
      <View style={styles.quickNav} accessibilityRole="toolbar">
        <Pressable
          onPress={() => onNavigate?.('history')}
          style={styles.quickNavButton}
          accessibilityRole="button"
          accessibilityLabel="Open conversation history"
        >
          <Ionicons name="time-outline" size={22} color="#00d4ff" />
          <Text style={styles.quickNavText}>History</Text>
        </Pressable>
        <Pressable
          onPress={() => onNavigate?.('knowledge')}
          style={styles.quickNavButton}
          accessibilityRole="button"
          accessibilityLabel="Open knowledge base"
        >
          <Ionicons name="book-outline" size={22} color="#00d4ff" />
          <Text style={styles.quickNavText}>Knowledge</Text>
        </Pressable>
        <Pressable
          onPress={() => onNavigate?.('settings')}
          style={styles.quickNavButton}
          accessibilityRole="button"
          accessibilityLabel="Open settings"
        >
          <Ionicons name="settings-outline" size={22} color="#00d4ff" />
          <Text style={styles.quickNavText}>Settings</Text>
        </Pressable>
      </View>

      <View style={styles.center}>
        <View style={styles.statusPill} accessibilityRole="text" accessibilityLiveRegion="polite">
          {isBootstrapping || isProcessing ? (
            <ActivityIndicator size="small" color="#00d4ff" />
          ) : (
            <View style={[styles.statusDot, (isListening || isSpeaking) && styles.statusDotActive]} />
          )}
          <Text style={styles.statusText}>{statusLabel}</Text>
        </View>
        <Text style={[styles.backendStatus, backendStatus === 'offline' && styles.backendStatusOffline]}>
          {backendLabel}
        </Text>
        <Text style={styles.latencyStatus}>{latencyLabel}</Text>

        <View style={{ width: SPHERE_SIZE, height: SPHERE_SIZE, alignItems: 'center', justifyContent: 'center' }}>
          <SimpleVoiceOrb
            state={isListening ? 'listening' : isSpeaking ? 'speaking' : isProcessing ? 'thinking' : 'idle'}
            style={{ width: SPHERE_SIZE, height: SPHERE_SIZE, borderRadius: SPHERE_SIZE / 2 }}
          />

          <Pressable
            onPress={() => {
              void onToggleRecording()
            }}
            disabled={isBootstrapping}
            style={{
              position: 'absolute',
              width: SPHERE_SIZE,
              height: SPHERE_SIZE,
              borderRadius: SPHERE_SIZE / 2,
            }}
            android_ripple={{ color: 'transparent' }}
            accessibilityRole="button"
            accessibilityLabel={recordingLabel}
            accessibilityHint="Double tap to control voice recording"
            accessibilityState={{ disabled: isBootstrapping, busy: isProcessing }}
          />
        </View>

        <View style={{ height: 18 }} />
        <WaveBars visible={isListening || isProcessing || isSpeaking} />
        <View style={{ height: 18 }} />
        <Text style={[styles.hint, (isListening || isSpeaking) && styles.hintActive]}>
          {isListening
            ? 'Tap to send'
            : isProcessing || isSpeaking
              ? 'Tap to interrupt'
              : isBootstrapping
                ? 'Preparing local session'
                : 'Tap to speak'}
        </Text>
      </View>

      <View style={styles.outputPanel}>
        <Text style={styles.panelTitle}>Conversation</Text>
        {ttsVoices.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.voiceSelectorScroll}
            contentContainerStyle={styles.voiceSelectorContent}
          >
            {ttsVoices.slice(0, 12).map((voice) => {
              const selected = voice === preferredTtsVoice
              const voiceLabel = formatTtsVoiceLabel(voice)
              return (
                <Pressable
                  key={voice}
                  onPress={() => updateSettings({ preferredTtsVoice: voice })}
                  style={[styles.voiceChip, selected && styles.voiceChipSelected]}
                  accessibilityRole="button"
                  accessibilityLabel={`Use ${voiceLabel} voice`}
                  accessibilityState={{ selected }}
                >
                  <Text style={[styles.voiceChipText, selected && styles.voiceChipTextSelected]}>
                    {voiceLabel}
                  </Text>
                </Pressable>
              )
            })}
          </ScrollView>
        ) : null}
        <ScrollView
          style={styles.outputScroll}
          contentContainerStyle={styles.outputScrollContent}
          accessibilityLabel="Conversation messages"
        >
          {transcript ? (
            <View style={styles.messageCard}>
              <Text style={styles.messageLabel}>You</Text>
              <Text style={styles.messageText}>{transcript}</Text>
            </View>
          ) : null}

          {displayResponse ? (
            <View style={styles.messageCard}>
              <Text style={styles.messageLabel}>JARVIS</Text>
              <Text style={styles.messageText}>{displayResponse}</Text>
            </View>
          ) : (
            <View style={styles.messageCard}>
              <Text style={styles.messageLabel}>JARVIS</Text>
              <Text style={styles.placeholderText}>
                Ask a question below, or tap the orb to speak.
              </Text>
            </View>
          )}

          {error ? (
            <View style={[styles.messageCard, styles.errorCard]}>
              <Text style={styles.messageLabel}>Issue</Text>
              <Text style={styles.messageText}>{error}</Text>
              {backendStatus === 'offline' ? (
                <Text style={styles.errorHint}>
                  Start the FastAPI backend and verify `EXPO_PUBLIC_API_URL` points to it.
                </Text>
              ) : null}
            </View>
          ) : null}
        </ScrollView>

        <View style={styles.composer}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Ask JARVIS anything"
            placeholderTextColor="rgba(255,255,255,0.35)"
            style={styles.input}
            editable={!isBootstrapping && !isProcessing}
            accessibilityLabel="Text message"
            accessibilityHint="Type a question for JARVIS"
            onSubmitEditing={() => {
              void handleSendText()
            }}
            returnKeyType="send"
          />
          <Pressable
            onPress={() => {
              void handleSendText()
            }}
            disabled={!draft.trim() || isBootstrapping || isProcessing}
            style={[
              styles.sendButton,
              (!draft.trim() || isBootstrapping || isProcessing) && styles.sendButtonDisabled,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Send message"
            accessibilityState={{ disabled: !draft.trim() || isBootstrapping || isProcessing }}
          >
            <Ionicons name="arrow-up" size={20} color="#00131a" />
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#002832',
    paddingTop: Platform.OS === 'ios' ? 56 : 24,
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
    height: 48,
  },
  logo: {
    color: '#00d4ff',
    fontFamily: 'Orbitron_700Bold',
    fontSize: 18,
    letterSpacing: 4,
    textShadowColor: '#00d4ff',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  quickNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  quickNavButton: {
    minHeight: 44,
    flex: 1,
    maxWidth: 116,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(0, 212, 255, 0.18)',
    backgroundColor: 'rgba(0, 212, 255, 0.08)',
  },
  quickNavText: {
    color: '#c9f7ff',
    fontFamily: 'Rajdhani_500Medium',
    fontSize: 14,
  },
  iconButton: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(0, 212, 255, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(0, 212, 255, 0.25)',
    marginBottom: 24,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  statusDotActive: {
    backgroundColor: '#00d4ff',
  },
  statusText: {
    color: '#c9f7ff',
    fontFamily: 'Rajdhani_500Medium',
    fontSize: 14,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  backendStatus: {
    color: 'rgba(201, 247, 255, 0.7)',
    fontFamily: 'Rajdhani_500Medium',
    fontSize: 14,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  latencyStatus: {
    color: 'rgba(201, 247, 255, 0.54)',
    fontFamily: 'Rajdhani_500Medium',
    fontSize: 12,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 16,
  },
  backendStatusOffline: {
    color: '#ff8f8f',
  },
  hint: {
    marginTop: 8,
    color: '#ffffff',
    fontFamily: 'Rajdhani_300Light',
    fontSize: 13,
    letterSpacing: 4,
    textTransform: 'uppercase',
  },
  hintActive: {
    color: '#00d4ff',
  },
  waveRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  waveBar: {
    width: 6,
    backgroundColor: '#00d4ff',
    borderRadius: 3,
    shadowColor: '#00d4ff',
    shadowOpacity: 0.45,
    shadowRadius: 5,
  },
  outputPanel: {
    marginHorizontal: 16,
    padding: 14,
    borderRadius: 22,
    backgroundColor: 'rgba(0, 12, 18, 0.72)',
    borderWidth: 1,
    borderColor: 'rgba(0, 212, 255, 0.18)',
    minHeight: 280,
  },
  panelTitle: {
    color: '#7edff2',
    fontFamily: 'Rajdhani_500Medium',
    fontSize: 16,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  voiceSelectorScroll: {
    maxHeight: 42,
    marginBottom: 10,
  },
  voiceSelectorContent: {
    gap: 8,
    paddingBottom: 2,
  },
  voiceChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  voiceChipSelected: {
    borderColor: 'rgba(0, 212, 255, 0.55)',
    backgroundColor: 'rgba(0, 212, 255, 0.16)',
  },
  voiceChipText: {
    color: 'rgba(255,255,255,0.78)',
    fontFamily: 'Rajdhani_500Medium',
    fontSize: 14,
    letterSpacing: 0.6,
  },
  voiceChipTextSelected: {
    color: '#dffbff',
  },
  outputScroll: {
    maxHeight: 210,
  },
  outputScrollContent: {
    gap: 10,
    paddingBottom: 8,
  },
  messageCard: {
    borderRadius: 16,
    padding: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  errorCard: {
    borderColor: 'rgba(255, 87, 87, 0.28)',
    backgroundColor: 'rgba(255, 87, 87, 0.08)',
  },
  messageLabel: {
    color: '#59e1ff',
    fontFamily: 'Rajdhani_500Medium',
    fontSize: 13,
    letterSpacing: 1.3,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  messageText: {
    color: '#f4fcff',
    fontFamily: 'Rajdhani_300Light',
    fontSize: 18,
    lineHeight: 24,
  },
  placeholderText: {
    color: 'rgba(255,255,255,0.58)',
    fontFamily: 'Rajdhani_300Light',
    fontSize: 18,
    lineHeight: 24,
  },
  errorHint: {
    color: 'rgba(255,255,255,0.72)',
    fontFamily: 'Rajdhani_300Light',
    fontSize: 15,
    lineHeight: 20,
    marginTop: 8,
  },
  composer: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  input: {
    flex: 1,
    minHeight: 50,
    borderRadius: 16,
    paddingHorizontal: 16,
    color: '#ffffff',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    fontFamily: 'Rajdhani_500Medium',
    fontSize: 18,
  },
  sendButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#00d4ff',
  },
  sendButtonDisabled: {
    opacity: 0.45,
  },
})
