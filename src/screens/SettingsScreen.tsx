import React, { useState, useEffect, useCallback } from 'react'
import { View, Text, TouchableOpacity, Switch, ScrollView, Alert, ActivityIndicator, FlatList } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../hooks/useTheme'
import { useSettingsStore } from '../store/settingsStore'
import apiClient, { getTtsVoices } from '../services/apiClient'

interface SettingsSectionProps {
  title: string
  children: React.ReactNode
}

function SettingsSection({ title, children }: SettingsSectionProps) {
  const { isDark } = useTheme()
  return (
    <View className="mb-6">
      <Text className={`text-xs uppercase font-semibold px-4 mb-2 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
        {title}
      </Text>
      <View className={`${isDark ? 'bg-gray-800' : 'bg-white'} rounded-lg mx-4`}>
        {children}
      </View>
    </View>
  )
}

interface SettingsItemProps {
  icon: keyof typeof Ionicons.glyphMap
  title: string
  subtitle?: string
  onPress?: () => void
  rightElement?: React.ReactNode
}

function SettingsItem({ icon, title, subtitle, onPress, rightElement }: SettingsItemProps) {
  const { isDark } = useTheme()
  return (
    <TouchableOpacity
      className={`flex-row items-center p-4 border-b ${isDark ? 'border-gray-700' : 'border-gray-200'} ${onPress ? '' : ''}`}
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
    >
      <Ionicons
        name={icon}
        size={24}
        color={isDark ? '#9ca3af' : '#6b7280'}
        style={{ marginRight: 12 }}
      />
      <View className="flex-1">
        <Text className={`text-base font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
          {title}
        </Text>
        {subtitle && (
          <Text className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            {subtitle}
          </Text>
        )}
      </View>
      {rightElement}
    </TouchableOpacity>
  )
}

type Props = {
  onNavigate?: () => void
}

export function SettingsScreen({ onNavigate }: Props) {
  const { isDark, themeMode, setThemeMode } = useTheme()
  const userId = useSettingsStore((state) => state.userId)
  const notificationsEnabled = useSettingsStore((state) => state.settings.notificationsEnabled)
  const hapticFeedbackEnabled = useSettingsStore((state) => state.settings.hapticFeedbackEnabled)
  const preferredTtsVoice = useSettingsStore((state) => state.settings.preferredTtsVoice)
  const updateSettings = useSettingsStore((state) => state.updateSettings)
  const [clearingMemory, setClearingMemory] = useState(false)
  const [voices, setVoices] = useState<string[]>([])
  const [voicesLoading, setVoicesLoading] = useState(true)

  useEffect(() => {
    async function fetchVoices() {
      try {
        const resp = await getTtsVoices()
        setVoices(resp.voices.length > 0 ? resp.voices : [])
      } catch {
        setVoices([])
      } finally {
        setVoicesLoading(false)
      }
    }
    void fetchVoices()
  }, [])

  const handleSelectVoice = (voice: string) => {
    updateSettings({ preferredTtsVoice: voice })
  }

  const toggleDarkMode = async (enabled: boolean) => {
    await setThemeMode(enabled ? 'dark' : 'light')
  }

  const handleClearMemory = async () => {
    if (!userId) {
      Alert.alert('Error', 'No user ID available')
      return
    }
    Alert.alert(
      'Clear Working Memory',
      'This will clear your recent conversation cache on the server. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            setClearingMemory(true)
            try {
              await apiClient.clearMessages(userId)
              Alert.alert('Done', 'Conversation cache cleared.')
            } catch {
              Alert.alert('Error', 'Failed to clear memory. Check your connection.')
            } finally {
              setClearingMemory(false)
            }
          },
        },
      ]
    )
  }

  const handleSyncKnowledge = useCallback(() => {
    // The Knowledge screen already auto-syncs on mount via getKnowledge.
    // This is a no-op placeholder — navigating to Knowledge screen refreshes data.
    Alert.alert('Sync', 'Knowledge base syncs automatically when you open the Knowledge tab.')
  }, [])

  return (
    <SafeAreaView
      className={`flex-1 ${isDark ? 'bg-gray-900' : 'bg-gray-50'}`}
    >
      <View className="flex-1">
        {/* Header */}
        <View className="flex-row items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <TouchableOpacity
            onPress={onNavigate}
            className="p-2 min-h-11 min-w-11 items-center justify-center"
            accessibilityRole="button"
            accessibilityLabel="Back to assistant"
          >
            <Ionicons
              name="arrow-back"
              size={24}
              color={isDark ? '#ffffff' : '#000000'}
            />
          </TouchableOpacity>
          <Text className={`text-xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
            Settings
          </Text>
          <View className="w-10" />
        </View>

        <ScrollView className="flex-1" contentContainerStyle={{ paddingTop: 24, paddingBottom: 40 }}>
          {/* Account Section */}
          <SettingsSection title="Account">
            <SettingsItem
              icon="person-circle-outline"
              title="User ID"
              subtitle={userId ?? 'Local user not created yet'}
            />
          </SettingsSection>

          {/* Preferences Section */}
          <SettingsSection title="Preferences">
            <SettingsItem
              icon="moon-outline"
              title="Dark Mode"
              subtitle="Use dark theme"
              rightElement={
                <Switch
                  value={themeMode === 'dark' || isDark}
                  onValueChange={toggleDarkMode}
                  trackColor={{ false: '#d1d5db', true: '#3b82f6' }}
                  accessibilityLabel="Dark mode"
                />
              }
            />
            <SettingsItem
              icon="notifications-outline"
              title="Notifications"
              subtitle="Push notifications"
              rightElement={
                <Switch
                  value={notificationsEnabled}
                  onValueChange={(value) => updateSettings({ notificationsEnabled: value })}
                  trackColor={{ false: '#d1d5db', true: '#3b82f6' }}
                  accessibilityLabel="Push notifications"
                />
              }
            />
            <SettingsItem
                          icon="phone-portrait-outline"
                          title="Haptic Feedback"
                          subtitle="Vibrate on voice controls"
                          rightElement={
                            <Switch
                              value={hapticFeedbackEnabled}
                              onValueChange={(value) => updateSettings({ hapticFeedbackEnabled: value })}
                              trackColor={{ false: '#d1d5db', true: '#3b82f6' }}
                              accessibilityLabel="Haptic feedback"
                            />
                          }
                        />
                        <View
                          className={`flex-row items-center p-4 border-b ${isDark ? 'border-gray-700' : 'border-gray-200'}`}
                        >
                          <Ionicons
                            name="construct-outline"
                            size={24}
                            color={isDark ? '#9ca3af' : '#6b7280'}
                            style={{ marginRight: 12 }}
                          />
                          <View className="flex-1">
                            <Text className={`text-base font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                              TTS Voice
                            </Text>
                            <Text className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                              {voicesLoading
                                ? 'Loading voices…'
                                : preferredTtsVoice
                                  ? preferredTtsVoice
                                  : 'Default'}
                            </Text>
                          </View>
                          <Ionicons
                            name="chevron-forward"
                            size={20}
                            color={isDark ? '#6b7280' : '#9ca3af'}
                          />
                        </View>
                        {voices.length > 0 && (
                          <FlatList
                            data={voices}
                            keyExtractor={(item) => item}
                            scrollEnabled={false}
                            renderItem={({ item }) => (
                              <TouchableOpacity
                                className={`flex-row items-center p-4 pl-12 border-b ${isDark ? 'border-gray-700' : 'border-gray-200'}`}
                                onPress={() => handleSelectVoice(item)}
                                accessibilityRole="button"
                                accessibilityLabel={`Select voice ${item}`}
                                accessibilityState={{ selected: preferredTtsVoice === item }}
                              >
                                <Text
                                  className={`flex-1 text-base ${preferredTtsVoice === item ? 'font-bold' : 'font-normal'} ${isDark ? 'text-white' : 'text-gray-900'}`}
                                >
                                  {item}
                                </Text>
                                {preferredTtsVoice === item ? (
                                  <Ionicons name="checkmark" size={20} color="#3b82f6" />
                                ) : null}
                              </TouchableOpacity>
                            )}
                          />
                        )}
                        {!voicesLoading && voices.length === 0 ? (
                          <View className={`flex-row items-center p-4 border-b ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
                            <Text className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                              No voices available
                            </Text>
                          </View>
                        ) : null}
          </SettingsSection>

          {/* Memory Section */}
          <SettingsSection title="Memory">
            <SettingsItem
              icon="trash-outline"
              title="Clear Working Memory"
              subtitle="Clear recent conversation cache"
              onPress={handleClearMemory}
              rightElement={clearingMemory ? <ActivityIndicator size="small" color="#00d4ff" /> : null}
            />
            <SettingsItem
              icon="cloud-download-outline"
              title="Sync Knowledge Base"
              subtitle="Update from server"
              onPress={handleSyncKnowledge}
            />
          </SettingsSection>

          {/* Support Section */}
          <SettingsSection title="Support">
            <SettingsItem
              icon="information-circle-outline"
              title="About JARVIS"
              subtitle="Version 1.0.0"
            />
            <SettingsItem
              icon="bug-outline"
              title="Report Bug"
            />
          </SettingsSection>

          {/* Danger Zone */}
          <SettingsSection title="Danger Zone">
            <SettingsItem
              icon="trash-outline"
              title="Delete All Data"
              subtitle="Clear all conversations and knowledge"
            />
          </SettingsSection>
        </ScrollView>
      </View>
    </SafeAreaView>
  )
}
