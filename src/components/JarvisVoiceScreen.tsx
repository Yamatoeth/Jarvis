/**
 * JarvisVoiceScreen — main voice interaction screen
 *
 * HI1: centralized status derived from useVoiceAssistant
 * HI2: unified error banner with dismiss
 * HI3: onboarding guard → inline loading → error
 * HI4: backend user bootstrap with local fallback
 * HI5: conversation selector (horizontal chip row + modal picker)
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  PermissionsAndroid,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { Audio } from 'expo-av'
import { useFonts, Rajdhani_400Regular, Rajdhani_500Medium, Rajdhani_700Bold } from '@expo-google-fonts/rajdhani'
import Svg, { Circle } from 'react-native-svg'

import { useVoiceAssistant } from '../hooks/useVoiceAssistant'
import { useChatHistory } from '../hooks/useChatHistory'
import { useOnboarding } from '../hooks/useOnboarding'
import { useNotificationPermission } from '../hooks/useNotificationPermission'
import { useTheme } from '../hooks/useTheme'
import { apiClient } from '../services/apiClient'
import { audioRecordingService } from '../services/audioRecording'
import { getBackendBaseUrl } from '../services/backendUrl'
import { SimpleVoiceOrb } from './SimpleVoiceOrb'

// ── Constants ────────────────────────────────────────────
const SPHERE_SIZE = 120
const MAX_DURATION_MS = 60_000
const MIN_DURATION_MS = 500

// ── Component ────────────────────────────────────────────
export function JarvisVoiceScreen({
  userId,
  onNavigate,
  onLogout,
}: {
  userId: string | null
  onNavigate?: (screen: string) => void
  onLogout?: () => void
}) {
  const insets = useSafeAreaInsets()
  const { theme } = useTheme()

  // Voice pipeline
  const {
    state,
    isListening,
    isProcessing,
    isSpeaking,
    isReady,
    error,
    transcript,
    response,
    streamingResponse,
    audioLevel,
    lastLatency,
    startListening,
    stopListening,
    cancel,
    sendText,
    clearHistory,
    initialize,
  } = useVoiceAssistant({
    streamLLM: true,
    playAudio: true,
    onTranscript: () => {},
    onResponse: () => {},
    onComplete: () => {},
    onError: () => {},
  })

  // Chat history (local fallback)
  const { messages, addMessage, clearHistory: clearLocalHistory } = useChatHistory()

  // Onboarding
  const { hasSeenOnboarding, onboardingInProgress, completeOnboarding } = useOnboarding(userId)

  // Notification permission (Phase 2 — read-only for now)
  const notificationGranted = useNotificationPermission()

  // Conversation selector state
  const [conversations, setConversations] = useState<Array<{ id: string; title: string; updated_at?: string }>>([])
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [showConvPicker, setShowConvPicker] = useState(false)
  const [convLoading, setConvLoading] = useState(false)

  // Derived
  const isSessionActive = isListening || isProcessing || isSpeaking
  const backendStatus = isReady ? 'online' : 'offline'
  const backendLabel = backendStatus === 'online' ? 'Backend connected' : 'Backend offline'
  const latencyLabel = lastLatency != null ? `${lastLatency}ms` : '—'

  const statusLabel = useMemo(() => {
    if (isBootstrapping) return 'Booting assistant'
    if (isListening) return 'Listening'
    if (isSpeaking) return 'Speaking'
    if (isProcessing) return 'Thinking'
    if (!isReady) return 'Preparing audio'
    return 'Ready'
  }, [isBootstrapping, isListening, isProcessing, isReady, isSpeaking])

  // Bootstrapping state
  const [isBootstrapping, setIsBootstrapping] = useState(true)
  const [bootstrapError, setBootstrapError] = useState<string | null>(null)

  // ── Bootstrapping ──────────────────────────────────────
  useEffect(() => {
    let active = true

    async function bootstrapUser() {
      if (!userId) {
        setIsBootstrapping(false)
        return
      }

      try {
        await initialize()
        if (!active) return

        // Ensure backend user exists
        await apiClient.getOrCreateUser(userId)
        if (!active) return

        // Load conversations
        setConvLoading(true)
        const convs = await apiClient.listConversations(userId)
        if (!active) return
        setConversations(convs)
        if (convs.length > 0 && !activeConversationId) {
          setActiveConversationId(convs[0].id)
        }
      } catch (err) {
        console.warn('[JarvisVoiceScreen] bootstrap error:', err)
        setBootstrapError(err instanceof Error ? err.message : 'Bootstrap failed')
      } finally {
        if (active) {
          setIsBootstrapping(false)
          setConvLoading(false)
        }
      }
    }

    if (hasSeenOnboarding && userId) {
      void bootstrapUser()
    } else {
      setIsBootstrapping(false)
    }

    return () => { active = false }
  }, [userId, hasSeenOnboarding, initialize])

  // ── Conversation management ────────────────────────────
  const fetchConversations = useCallback(async () => {
    if (!userId) return
    try {
      const convs = await apiClient.listConversations(userId)
      setConversations(convs)
    } catch {
      // silent — conversations list is best-effort
    }
  }, [userId])

  const handleCreateConversation = useCallback(async () => {
    if (!userId) return
    try {
      const conv = await apiClient.createConversation(userId)
      setConversations((prev) => [conv, ...prev])
      setActiveConversationId(conv.id)
      setShowConvPicker(false)
    } catch (e) {
      console.warn('Failed to create conversation', e)
    }
  }, [userId])

  const handleSelectConversation = useCallback((id: string) => {
    setActiveConversationId(id)
    setShowConvPicker(false)
  }, [])

  const handleToggleConversationPicker = useCallback(() => {
    setShowConvPicker((prev) => !prev)
  }, [])

  // ── Recording controls ─────────────────────────────────
  const onToggleRecording = useCallback(async () => {
    if (isBootstrapping || isProcessing) return

    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    if (isListening) {
      await stopListening()
    } else {
      // Ensure we have an active conversation before starting
      if (!activeConversationId && userId) {
        try {
          const conv = await apiClient.createConversation(userId)
          setActiveConversationId(conv.id)
        } catch (e) {
          console.warn('Failed to create conversation for voice session', e)
        }
      }
      await cancel()
      await startListening()
    }
  }, [cancel, isBootstrapping, isListening, isProcessing, startListening, stopListening, activeConversationId, userId])

  // ── Text submit ────────────────────────────────────────
  const onSubmitText = useCallback(async (text: string) => {
    if (!text.trim() || isBootstrapping) return
    if (!activeConversationId && userId) {
      try {
        const conv = await apiClient.createConversation(userId)
        setActiveConversationId(conv.id)
      } catch (e) {
        console.warn('Failed to create conversation', e)
      }
    }
    await sendText(text)
  }, [activeConversationId, userId, sendText, isBootstrapping])

  // ── Clear data ─────────────────────────────────────────
  const handleClearData = useCallback(async () => {
    if (!userId) return
    Alert.alert(
      'Delete All Data',
      'This will permanently delete all conversations, knowledge base entries, and memories for this user. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete All',
          style: 'destructive',
          onPress: async () => {
            try {
              await apiClient.clearMessages(userId)
              await apiClient.deleteAllKnowledge(userId)
              clearLocalHistory()
              setConversations([])
              setActiveConversationId(null)
            } catch (e) {
              console.warn('Failed to delete all data', e)
            }
          },
        },
      ]
    )
  }, [userId, clearLocalHistory])

  // ── Render ─────────────────────────────────────────────
  const [fontsLoaded] = useFonts({
    Rajdhani_400Regular,
    Rajdhani_500Medium,
    Rajdhani_700Bold,
  })

  if (!fontsLoaded) return null

  return (
    <SafeAreaView style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.logo}>JARVIS</Text>
        <View style={styles.headerRight}>
          {/* HI5: conversation selector — hidden during active session */}
          {!isSessionActive && (
            <TouchableOpacity
              onPress={handleToggleConversationPicker}
              style={styles.iconButton}
              accessibilityRole="button"
              accessibilityLabel="Select conversation"
              accessibilityHint="Choose an active conversation"
            >
              <Ionicons name="chatbox-outline" size={28} color="#00d4ff" />
            </TouchableOpacity>
          )}
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

      {/* Quick nav */}
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

      {/* Status area */}
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

        {/* Voice orb */}
        <View style={{ width: SPHERE_SIZE, height: SPHERE_SIZE, alignItems: 'center', justifyContent: 'center' }}>
          <SimpleVoiceOrb
            state={isListening ? 'listening' : isSpeaking ? 'speaking' : isProcessing ? 'thinking' : 'idle'}
            style={{ width: SPHERE_SIZE, height: SPHERE_SIZE, borderRadius: SPHERE_SIZE / 2 }}
          />

          <Pressable
            onPress={() => { void onToggleRecording() }}
            disabled={isBootstrapping}
            style={{
              position: 'absolute',
              width: SPHERE_SIZE,
              height: SPHERE_SIZE,
              borderRadius: SPHERE_SIZE / 2,
            }}
            android_ripple={{ color: 'transparent' }}
            accessibilityRole="button"
            accessibilityLabel={isListening ? 'Stop recording' : 'Start recording'}
            accessibilityHint={isListening ? 'Tap to stop recording' : 'Tap to start recording'}
          />
        </View>

        {/* Transcript / response */}
        {(transcript || streamingResponse || response) && (
          <View style={styles.chatArea}>
            {transcript ? (
              <Text style={styles.transcript}>{transcript}</Text>
            ) : null}
            {streamingResponse ? (
              <Text style={styles.response}>{streamingResponse}</Text>
            ) : response ? (
              <Text style={styles.response}>{response}</Text>
            ) : null}
          </View>
        )}
      </View>

      {/* Conversation picker modal */}
      {showConvPicker && (
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Conversations</Text>
              <Pressable
                onPress={() => setShowConvPicker(false)}
                style={styles.modalCloseButton}
                accessibilityRole="button"
                accessibilityLabel="Close conversation picker"
              >
                <Ionicons name="close-outline" size={24} color="#00d4ff" />
              </Pressable>
            </View>

            {convLoading ? (
              <Text style={styles.modalEmptyText}>Loading…</Text>
            ) : conversations.length === 0 ? (
              <Text style={styles.modalEmptyText}>No conversations yet</Text>
            ) : null}

            {conversations.map((conv) => (
              <Pressable
                key={conv.id}
                onPress={() => handleSelectConversation(conv.id)}
                style={[
                  styles.modalItem,
                  activeConversationId === conv.id && styles.modalItemActive,
                ]}
              >
                <View style={styles.modalItemLeft}>
                  <View style={[
                    styles.modalItemDot,
                    activeConversationId === conv.id && styles.modalItemDotActive,
                  ]} />
                  <Text style={styles.modalItemText}>
                    {conv.title || 'Untitled'}
                  </Text>
                </View>
                {conv.updated_at ? (
                  <Text style={[
                    styles.modalItemDate,
                    activeConversationId === conv.id && styles.modalItemDateActive,
                  ]}>
                    {conv.updated_at}
                  </Text>
                ) : null}
              </Pressable>
            ))}

            <Pressable
              onPress={handleCreateConversation}
              style={styles.modalNewButton}
              accessibilityRole="button"
              accessibilityLabel="New conversation"
            >
              <Ionicons name="add-outline" size={18} color="#00d4ff" />
              <Text style={styles.modalNewButtonText}>New Conversation</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* Bottom action bar */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom }]}>
        <Pressable
          onPress={handleClearData}
          style={styles.iconButton}
          accessibilityRole="button"
          accessibilityLabel="Delete all data"
        >
          <Ionicons name="trash-outline" size={22} color="#ff6b6b" />
        </Pressable>
        {onLogout ? (
          <Pressable
            onPress={onLogout}
            style={styles.iconButton}
            accessibilityRole="button"
            accessibilityLabel="Logout"
          >
            <Ionicons name="log-out-outline" size={22} color="#00d4ff" />
          </Pressable>
        ) : null}
      </View>
    </SafeAreaView>
  )
}

// ── Styles ───────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0e17',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  logo: {
    color: '#00d4ff',
    fontFamily: 'Rajdhani_700Bold',
    fontSize: 24,
    letterSpacing: 2,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconButton: {
    padding: 8,
  },
  quickNav: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 24,
    paddingVertical: 8,
  },
  quickNavButton: {
    alignItems: 'center',
    gap: 4,
  },
  quickNavText: {
    color: '#00d4ff',
    fontFamily: 'Rajdhani_400Regular',
    fontSize: 12,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 212, 255, 0.08)',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(0, 212, 255, 0.4)',
  },
  statusDotActive: {
    backgroundColor: '#00d4ff',
  },
  statusText: {
    color: '#c9f7ff',
    fontFamily: 'Rajdhani_500Medium',
    fontSize: 14,
  },
  backendStatus: {
    color: 'rgba(201, 247, 255, 0.5)',
    fontFamily: 'Rajdhani_400Regular',
    fontSize: 12,
  },
  backendStatusOffline: {
    color: '#ff6b6b',
  },
  latencyStatus: {
    color: 'rgba(201, 247, 255, 0.35)',
    fontFamily: 'Rajdhani_300Light',
    fontSize: 11,
  },
  chatArea: {
    width: '80%',
    alignItems: 'center',
    gap: 4,
  },
  transcript: {
    color: 'rgba(201, 247, 255, 0.7)',
    fontFamily: 'Rajdhani_400Regular',
    fontSize: 14,
    textAlign: 'center',
  },
  response: {
    color: '#c9f7ff',
    fontFamily: 'Rajdhani_500Medium',
    fontSize: 15,
    textAlign: 'center',
  },
  bottomBar: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 20,
    paddingTop: 8,
    paddingHorizontal: 20,
  },
  modalOverlay: {
    position: 'absolute',
    inset: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: '85%',
    maxHeight: '60%',
    backgroundColor: '#0f1520',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(0, 212, 255, 0.2)',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  modalTitle: {
    color: '#00d4ff',
    fontFamily: 'Rajdhani_500Medium',
    fontSize: 16,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  modalCloseButton: {
    padding: 4,
    margin: -4,
  },
  modalItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  modalItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  modalItemDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(0, 212, 255, 0.5)',
  },
  modalItemText: {
    color: '#c9f7ff',
    fontFamily: 'Rajdhani_500Medium',
    fontSize: 15,
    flex: 1,
  },
  modalItemDate: {
    color: 'rgba(201, 247, 255, 0.55)',
    fontFamily: 'Rajdhani_400Regular',
    fontSize: 12,
  },
  modalItemDateActive: {
    color: '#00d4ff',
    fontFamily: 'Rajdhani_400Regular',
    fontSize: 12,
  },
  modalEmptyText: {
    color: 'rgba(201, 247, 255, 0.5)',
    fontFamily: 'Rajdhani_300Light',
    fontSize: 15,
    textAlign: 'center',
    paddingVertical: 20,
  },
  modalNewButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    marginTop: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0, 212, 255, 0.3)',
    backgroundColor: 'rgba(0, 212, 255, 0.08)',
  },
  modalNewButtonText: {
    color: '#00d4ff',
    fontFamily: 'Rajdhani_500Medium',
    fontSize: 15,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  modalItemDateActive: {
    color: '#00d4ff',
    fontFamily: 'Rajdhani_400Regular',
    fontSize: 12,
  },
})