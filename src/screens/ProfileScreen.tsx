import { View, Text, ScrollView, TouchableOpacity, Alert, Pressable } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../hooks/useTheme'
import { useChatHistory } from '../hooks/useChatHistory'
import { useOnboarding } from '../hooks/useOnboarding'

export function ProfileScreen({ onNavigate }: { onNavigate?: (route: 'home'|'profile') => void }) {
  const { isDark, themeMode, setThemeMode } = useTheme()
  const { clearHistory: clearChatHistory } = useChatHistory()
  const { resetOnboarding } = useOnboarding(undefined)

  const handleThemeChange = async () => {
    // Cycle through: system -> light -> dark -> system
    if (themeMode === 'system') {
      await setThemeMode('light')
    } else if (themeMode === 'light') {
      await setThemeMode('dark')
    } else {
      await setThemeMode('system')
    }
  }

  const getThemeLabel = () => {
    switch (themeMode) {
      case 'system': return 'System'
      case 'light': return 'Light'
      case 'dark': return 'Dark'
    }
  }

  const handleDeleteAllData = () => {
    Alert.alert(
      'Delete All Data',
      'This will permanently delete local chat history and reset onboarding. Server knowledge must be deleted from the backend. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await clearChatHistory()
            await resetOnboarding()
            Alert.alert('Done', 'All data has been deleted.')
          },
        },
      ]
    )
  }

  const handleResetOnboarding = async () => {
    await resetOnboarding()
    Alert.alert('Done', 'Onboarding will show on next app restart.')
  }

  return (
    <SafeAreaView className={`flex-1 ${isDark ? 'bg-gray-900' : 'bg-white'}`} edges={['top']}>
      <View className={`p-4 border-b ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
        <View className="flex-row items-center justify-between">
          <Pressable onPress={() => onNavigate?.('home')} className="p-2">
            <Ionicons name="chevron-back" size={22} color={isDark ? '#fff' : '#111'} />
          </Pressable>
          <Text className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>Profile</Text>
          <View style={{ width: 40 }} />
        </View>
      </View>

      <ScrollView className="flex-1">
        <View className="p-4 gap-4">
          {/* Profile Header */}
          <View className={`p-4 rounded-xl ${isDark ? 'bg-gray-800' : 'bg-gray-50'}`}>
            <View className="flex-row items-center gap-4">
              <View className="w-16 h-16 rounded-full bg-gradient-to-r from-blue-500 to-cyan-400 items-center justify-center">
                <Text className="text-white text-2xl font-bold">U</Text>
              </View>
              <View className="flex-1">
                <Text className={`text-xl font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>User</Text>
                <Text className={isDark ? 'text-gray-400' : 'text-gray-500'}>Personal profile & settings</Text>
              </View>
              <Pressable onPress={() => Alert.alert('Edit profile', 'Profile editing not implemented here yet')} className="p-2">
                <Ionicons name="pencil" size={20} color={isDark ? '#9ca3af' : '#374151'} />
              </Pressable>
            </View>
          </View>

          {/* Stats Row */}
          <View className="flex-row gap-3">
            <View className={`flex-1 p-4 rounded-xl items-center ${isDark ? 'bg-gray-800' : 'bg-white shadow'}`}>
              <Ionicons name="mic-outline" size={22} color="#00d4ff" />
              <Text className={`text-xl font-bold mt-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>Voice</Text>
              <Text className={isDark ? 'text-gray-400' : 'text-gray-500'}>Backend-owned</Text>
            </View>
            <View className={`flex-1 p-4 rounded-xl items-center ${isDark ? 'bg-gray-800' : 'bg-white shadow'}`}>
              <Ionicons name="server-outline" size={22} color="#10b981" />
              <Text className={`text-xl font-bold mt-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>KB</Text>
              <Text className={isDark ? 'text-gray-400' : 'text-gray-500'}>PostgreSQL</Text>
            </View>
            <View className={`flex-1 p-4 rounded-xl items-center ${isDark ? 'bg-gray-800' : 'bg-white shadow'}`}>
              <Ionicons name="sync-outline" size={22} color="#8b5cf6" />
              <Text className={`text-xl font-bold mt-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>Async</Text>
              <Text className={isDark ? 'text-gray-400' : 'text-gray-500'}>Fact extraction</Text>
            </View>
          </View>

          {/* Preferences */}
          <View className={`p-4 border rounded-xl ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
            <Text className={`text-lg font-semibold mb-3 ${isDark ? 'text-white' : 'text-gray-900'}`}>Preferences</Text>
            <TouchableOpacity className="flex-row items-center justify-between py-3" onPress={handleThemeChange}>
              <View className="flex-row items-center gap-3">
                <Ionicons name={isDark ? 'moon' : 'sunny'} size={20} color={isDark ? '#9ca3af' : '#666'} />
                <Text className={`text-base ${isDark ? 'text-white' : 'text-gray-900'}`}>Theme</Text>
              </View>
              <View className="flex-row items-center gap-2">
                <Text className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{getThemeLabel()}</Text>
                <Ionicons name="chevron-forward" size={16} color={isDark ? '#6b7280' : '#9ca3af'} />
              </View>
            </TouchableOpacity>
          </View>

          {/* Architecture Summary */}
          <View className={`p-4 border rounded-xl ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
            <Text className={`text-lg font-semibold mb-3 ${isDark ? 'text-white' : 'text-gray-900'}`}>Voice Runtime</Text>
            <Text className={isDark ? 'text-gray-300' : 'text-gray-700'}>
              Voice requests are processed by the backend. This app no longer expects provider API keys in the client UI.
            </Text>
          </View>

          {/* Actions */}
          <View className={`p-4 border rounded-xl ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
            <Text className={`text-lg font-semibold mb-3 ${isDark ? 'text-white' : 'text-gray-900'}`}>Actions</Text>
            <Pressable className={`p-3 rounded-lg items-center mt-2 ${isDark ? 'bg-gray-700' : 'border border-gray-300'}`} onPress={handleResetOnboarding}>
              <Text className={`font-medium ${isDark ? 'text-gray-300' : 'text-gray-900'}`}>Show Onboarding Again</Text>
            </Pressable>
            <Pressable className={`p-3 rounded-lg items-center mt-2 border ${isDark ? 'border-red-800' : 'border-red-400'}`} onPress={handleDeleteAllData}>
              <Text className="text-red-500 font-medium">Delete All Data</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}
