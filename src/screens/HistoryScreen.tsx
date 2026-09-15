import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, TextInput } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../hooks/useTheme'
import { useSettingsStore } from '../store/settingsStore'
import apiClient from '../services/apiClient'

interface ConversationHistoryItem {
  id: string
  user_id: string
  created_at: string
  updated_at?: string
}

interface ConversationMessage {
  id: string
  conversation_id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: string
}

type Props = {
  onNavigate?: () => void
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  return date.toLocaleDateString()
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatDuration(startStr: string, endStr: string): string {
  const start = new Date(startStr).getTime()
  const end = new Date(endStr).getTime()
  const seconds = Math.floor((end - start) / 1000)
  if (seconds < 0) return '0:00'
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

export function HistoryScreen({ onNavigate }: Props) {
  const { isDark } = useTheme()
  const userId = useSettingsStore((s) => s.userId)
  const [conversations, setConversations] = useState<ConversationHistoryItem[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedConv, setSelectedConv] = useState<ConversationHistoryItem | null>(null)
  const [messages, setMessages] = useState<ConversationMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    async function fetchConversations() {
      if (!userId) return
      try {
        setLoading(true)
        setError(null)
        const convs = await apiClient.getConversations(userId)
        if (active) {
          setConversations(convs)
          // Auto-select most recent
          if (convs.length > 0 && !selectedConv) {
            setSelectedConv(convs[0])
          }
        }
      } catch (e) {
        if (active) setError('Failed to load conversation history')
      } finally {
        if (active) setLoading(false)
      }
    }
    void fetchConversations()
    return () => { active = false }
  }, [userId, selectedConv])

  useEffect(() => {
    let active = true
    async function fetchMessages() {
      if (!selectedConv) return
      try {
        setLoadingMessages(true)
        const msgs = await apiClient.getMessages(selectedConv.id)
        if (active) setMessages(msgs)
      } catch {
        if (active) setMessages([])
      } finally {
        if (active) setLoadingMessages(false)
      }
    }
    void fetchMessages()
    return () => { active = false }
  }, [selectedConv])

  const conversationTitles = useMemo(() => {
    // Build a preview from the first user message in each conversation
    const withPreviews = conversations.map(conv => {
      const firstUserMsg = messages.find(m => m.conversation_id === conv.id && m.role === 'user')
      return {
        ...conv,
        preview: firstUserMsg?.content?.slice(0, 80) || 'No messages yet',
      }
    })
    return withPreviews
  }, [conversations, messages])

  const filteredConversations = useMemo(() => {
    if (!searchQuery.trim()) return conversationTitles
    const q = searchQuery.trim().toLowerCase()
    return conversationTitles.filter(item =>
      item.preview.toLowerCase().includes(q),
    )
  }, [conversationTitles, searchQuery])

  if (loading) {
    return (
      <SafeAreaView className={`flex-1 ${isDark ? 'bg-gray-900' : 'bg-white'}`}>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#00d4ff" />
          <Text className="mt-4 text-gray-400">Loading history...</Text>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView className={`flex-1 ${isDark ? 'bg-gray-900' : 'bg-white'}`}>
      <View className="flex-1">
        <View className="flex-row items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <TouchableOpacity
            onPress={onNavigate}
            className="p-2 min-h-11 min-w-11 items-center justify-center"
            accessibilityRole="button"
            accessibilityLabel="Back to assistant"
          >
            <Ionicons name="arrow-back" size={24} color={isDark ? '#ffffff' : '#000000'} />
          </TouchableOpacity>
          <Text className={`text-xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
            Conversation History
          </Text>
          <View className="w-10" />
        </View>

        {error ? (
          <View className="flex-1 items-center justify-center p-8">
            <Ionicons name="alert-circle-outline" size={48} color={isDark ? '#f87171' : '#ef4444'} />
            <Text className="mt-4 text-center text-gray-500">{error}</Text>
            <TouchableOpacity onPress={() => window.location.reload()} className="mt-4">
              <Text className="text-blue-400">Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View className={`px-4 pt-3 pb-2 ${isDark ? 'bg-gray-900' : 'bg-white'}`}>
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Search conversations..."
                placeholderTextColor={isDark ? '#6b7280' : '#9ca3af'}
                className={`rounded-lg px-4 py-2 text-sm ${isDark ? 'bg-gray-800 border border-gray-700 text-white' : 'bg-gray-100 border border-gray-200 text-gray-900'}`}
              />
            </View>
            <FlatList
              data={filteredConversations}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <TouchableOpacity
                onPress={() => setSelectedConv(item)}
                className={`mb-3 p-4 rounded-lg shadow-sm ${isDark ? 'bg-gray-800 border border-gray-700' : 'bg-white border border-gray-200'} ${selectedConv?.id === item.id ? (isDark ? 'border-blue-500' : 'border-blue-500') : ''}`}
                accessibilityRole="button"
                accessibilityLabel={`${item.preview}. ${formatDate(item.created_at)}`}
              >
                <View className="flex-row justify-between items-start mb-2">
                  <Text className={`text-sm font-medium ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                    {formatDate(item.created_at)}
                  </Text>
                  <Text className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    {formatTime(item.created_at)}
                  </Text>
                </View>
                <Text className={`text-base ${isDark ? 'text-white' : 'text-gray-900'}`} numberOfLines={2}>
                  {item.preview}
                </Text>
              </TouchableOpacity>
            )}
            ListEmptyComponent={() => (
              <View className="flex-1 items-center justify-center p-8">
                <Ionicons name="time-outline" size={64} color={isDark ? '#4b5563' : '#d1d5db'} />
                <Text className="text-lg font-semibold mt-4 mb-2 text-gray-400">
                  No conversation history
                </Text>
                <Text className="text-center text-gray-500">
                  Start talking to JARVIS to see your history here
                </Text>
              </View>
            )}
          </FlatList>
          </>
        )}

        {selectedConv && messages.length > 0 && (
          <View className="border-t border-gray-200 dark:border-gray-700">
            <View className="p-4">
              <Text className={`text-sm font-semibold ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                Messages ({messages.length})
              </Text>
              {messages.slice(0, 20).map((msg) => (
                <View key={msg.id} className={`my-2 p-3 rounded-lg ${msg.role === 'user' ? (isDark ? 'bg-blue-900/30 text-blue-200' : 'bg-blue-50 text-blue-800') : (isDark ? 'bg-gray-800 text-gray-200' : 'bg-gray-100 text-gray-800')}`}>
                  <Text className="text-xs font-medium mb-1">{msg.role}</Text>
                  <Text className="text-sm">{msg.content}</Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </View>
    </SafeAreaView>
  )
}
