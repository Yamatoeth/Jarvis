import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl, TextInput, Alert } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../hooks/useTheme'
import { useSettingsStore } from '../store/settingsStore'
import apiClient, { updateKnowledgeItem, deleteKnowledgeItem } from '../services/apiClient'

interface KnowledgeItem {
  id: string
  domain: 'identity' | 'goals' | 'projects' | 'finances' | 'relationships' | 'patterns'
  field_name: string
  field_value: string
  confidence: number
  source: string
  last_updated: string
}

type Props = {
  onNavigate?: () => void
}

function mapDomainToType(domain: string): 'goal' | 'project' | 'preference' | 'fact' {
  switch (domain) {
    case 'goals': return 'goal'
    case 'projects': return 'project'
    case 'identity':
    case 'relationships':
    case 'patterns':
    case 'finances':
    default: return 'fact'
  }
}

function mapDomainToCategory(domain: string): string {
  switch (domain) {
    case 'identity': return 'identity'
    case 'goals': return 'goals'
    case 'projects': return 'work'
    case 'finances': return 'finance'
    case 'relationships': return 'people'
    case 'patterns': return 'habits'
    default: return 'other'
  }
}

const typeColors: Record<string, string> = {
  goal: 'bg-blue-500',
  project: 'bg-green-500',
  preference: 'bg-purple-500',
  fact: 'bg-yellow-500',
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString()
}

export function KnowledgeScreen({ onNavigate }: Props) {
  const { isDark } = useTheme()
  const userId = useSettingsStore((s) => s.userId)
  const [items, setItems] = useState<KnowledgeItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [selectedFilter, setSelectedFilter] = useState('All')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  const fetchKnowledge = useCallback(async (resetError = true) => {
    if (!userId) return
    try {
      if (resetError) setError(null)
      const data = await apiClient.getKnowledge(userId)
      setItems(data)
    } catch (e) {
      setError('Failed to load knowledge base')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [userId])

  const handleEditStart = (item: KnowledgeItem) => {
    setEditingId(item.id)
    setEditValue(item.field_value)
  }

  const handleEditCancel = () => {
    setEditingId(null)
    setEditValue('')
  }

  const handleEditSave = async () => {
    if (!editingId || !userId) return
    try {
      await updateKnowledgeItem(editingId, userId, { field_value: editValue })
      setEditingId(null)
      setEditValue('')
      await fetchKnowledge()
    } catch {
      setError('Failed to update knowledge item')
    }
  }

  const handleDeletePress = (item: KnowledgeItem) => {
    setDeleteConfirmId(item.id)
  }

  const handleDeleteConfirm = async () => {
    if (!deleteConfirmId || !userId) return
    try {
      await deleteKnowledgeItem(deleteConfirmId, userId)
      setDeleteConfirmId(null)
      await fetchKnowledge()
    } catch {
      setError('Failed to delete knowledge item')
    }
  }

  const handleDeleteCancel = () => {
    setDeleteConfirmId(null)
  }

  useEffect(() => {
    void fetchKnowledge()
  }, [fetchKnowledge])

  const filteredKnowledge = useMemo(() => {
    if (selectedFilter === 'All') return items
    return items.filter(item => mapDomainToType(item.domain) === selectedFilter.toLowerCase())
  }, [items, selectedFilter])

  const filters = ['All', 'Goals', 'Projects', 'Preferences', 'Facts']

  if (loading && items.length === 0) {
    return (
      <SafeAreaView className={`flex-1 ${isDark ? 'bg-gray-900' : 'bg-white'}`}>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#00d4ff" />
          <Text className="mt-4 text-gray-400">Loading knowledge base...</Text>
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
            Knowledge Base
          </Text>
          <View className="w-10" />
        </View>

        <View className="flex-row p-3 border-b border-gray-200 dark:border-gray-700">
          <FlatList
            horizontal
            data={filters}
            keyExtractor={(item) => item}
            renderItem={({ item }) => (
              <TouchableOpacity
                onPress={() => setSelectedFilter(item)}
                className={`px-4 py-2 rounded-full mr-2 ${selectedFilter === item ? 'bg-blue-600' : isDark ? 'bg-gray-700' : 'bg-gray-200'}`}
                accessibilityRole="button"
                accessibilityLabel={`Show ${item.toLowerCase()} knowledge items`}
                accessibilityState={{ selected: selectedFilter === item }}
              >
                <Text className={`text-sm font-medium ${selectedFilter === item ? 'text-white' : isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                  {item}
                </Text>
              </TouchableOpacity>
            )}
          />
        </View>

        {error && items.length === 0 ? (
          <View className="flex-1 items-center justify-center p-8">
            <Ionicons name="alert-circle-outline" size={48} color={isDark ? '#f87171' : '#ef4444'} />
            <Text className="mt-4 text-center text-gray-500">{error}</Text>
            <TouchableOpacity onPress={() => fetchKnowledge(true)} className="mt-4">
              <Text className="text-blue-400">Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            data={filteredKnowledge}
            keyExtractor={(item) => item.id}
            contentContainerClassName="p-4"
            accessibilityLabel="Knowledge base list"
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => { setRefreshing(true); void fetchKnowledge(false) }}
                tintColor="#00d4ff"
              />
            }
            renderItem={({ item }) => {
              const type = mapDomainToType(item.domain)
              const category = mapDomainToCategory(item.domain)
              const isEditing = editingId === item.id
              const isDeleteConfirming = deleteConfirmId === item.id
              return (
                <View className={`mb-3 p-4 rounded-lg shadow-sm ${isDark ? 'bg-gray-800 border border-gray-700' : 'bg-white border border-gray-200'}`}>
                  {isEditing ? (
                    <View>
                      <Text className={`text-sm font-semibold uppercase tracking-wide ${isDark ? 'text-gray-300' : 'text-gray-600'} mb-2`}>
                        Edit {type}
                      </Text>
                      <TextInput
                        className={`border rounded px-3 py-2 mb-2 text-base ${isDark ? 'bg-gray-700 border-gray-600 text-white' : 'bg-gray-50 border-gray-300 text-gray-900'}`}
                        value={editValue}
                        onChangeText={setEditValue}
                        accessibilityLabel={`Edit value for ${item.field_name}`}
                      />
                      <View className="flex-row">
                        <TouchableOpacity
                          onPress={handleEditSave}
                          className="mr-2 px-4 py-2 rounded-lg bg-green-600"
                          accessibilityRole="button"
                          accessibilityLabel="Save edit"
                        >
                          <Text className="text-white text-sm font-medium">Save</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={handleEditCancel}
                          className="px-4 py-2 rounded-lg bg-gray-500"
                          accessibilityRole="button"
                          accessibilityLabel="Cancel edit"
                        >
                          <Text className="text-white text-sm font-medium">Cancel</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : isDeleteConfirming ? (
                    <View>
                      <Text className={`text-sm mb-2 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                        Delete "{item.field_name}"?
                      </Text>
                      <View className="flex-row">
                        <TouchableOpacity
                          onPress={handleDeleteConfirm}
                          className="mr-2 px-4 py-2 rounded-lg bg-red-600"
                          accessibilityRole="button"
                          accessibilityLabel="Confirm delete"
                        >
                          <Text className="text-white text-sm font-medium">Delete</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={handleDeleteCancel}
                          className="px-4 py-2 rounded-lg bg-gray-500"
                          accessibilityRole="button"
                          accessibilityLabel="Cancel delete"
                        >
                          <Text className="text-white text-sm font-medium">Cancel</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : (
                    <>
                      <View className="flex-row items-start justify-between mb-2">
                        <View className="flex-row items-center">
                          <View className={`w-2 h-2 rounded-full ${typeColors[type] || 'bg-gray-500'} mr-2`} />
                          <Text className={`text-sm font-semibold uppercase tracking-wide ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                            {type}
                          </Text>
                        </View>
                        <View className="flex-row items-center">
                          <Text className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'} mr-3`}>
                            {formatDate(item.last_updated)}
                          </Text>
                          <TouchableOpacity
                            onPress={() => handleEditStart(item)}
                            accessibilityRole="button"
                            accessibilityLabel={`Edit ${item.field_name}`}
                            className="mr-2"
                          >
                            <Ionicons name="create-outline" size={18} color={isDark ? '#60a5fa' : '#2563eb'} />
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => handleDeletePress(item)}
                            accessibilityRole="button"
                            accessibilityLabel={`Delete ${item.field_name}`}
                          >
                            <Ionicons name="trash-outline" size={18} color={isDark ? '#f87171' : '#dc2626'} />
                          </TouchableOpacity>
                        </View>
                      </View>
                      <Text className={`text-base font-semibold mb-1 ${isDark ? 'text-white' : 'text-gray-900'}`}>
                        {item.field_name}
                      </Text>
                      <View className="flex-row items-center">
                        <Text className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                          {item.field_value}
                        </Text>
                        <View className={`ml-auto px-2 py-1 rounded-full ${isDark ? 'bg-gray-700' : 'bg-gray-100'}`}>
                          <Text className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                            {category}
                          </Text>
                        </View>
                      </View>
                    </>
                  )}
                </View>
              )
            }}
            ListEmptyComponent={() => (
              <View className="flex-1 items-center justify-center p-8">
                <Ionicons name="book-outline" size={64} color={isDark ? '#4b5563' : '#d1d5db'} />
                <Text className="text-lg font-semibold mt-4 mb-2 text-gray-400">
                  No knowledge items yet
                </Text>
                <Text className="text-center text-gray-500">
                  Talk to JARVIS and it will learn about you
                </Text>
              </View>
            )}
          />
        )}
      </View>
    </SafeAreaView>
  )
}
