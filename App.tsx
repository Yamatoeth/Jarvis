import 'react-native-gesture-handler'
import 'react-native-reanimated'
import './global.css'

import { StatusBar } from 'expo-status-bar'
import { NavigationContainer, DarkTheme, DefaultTheme } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { View, ActivityIndicator } from 'react-native'
import JarvisVoiceScreen from './src/components/JarvisVoiceScreen'
import { ProfileScreen } from './src/screens/ProfileScreen'
import { ThemeProvider, useTheme } from './src/hooks/useTheme'
import { OnboardingScreen } from './src/screens/OnboardingScreen'
import { HistoryScreen } from './src/screens/HistoryScreen'
import { KnowledgeScreen } from './src/screens/KnowledgeScreen'
import { SettingsScreen } from './src/screens/SettingsScreen'
import { useOnboarding } from './src/hooks/useOnboarding'
import { useEffect } from 'react'
import { ErrorBoundary } from './src/components/ErrorBoundary'
import { addNotificationActionListener, registerForPushNotificationsAsync } from './src/services/notificationService'
import { useSettingsStore } from './src/store/settingsStore'

type RootStackParamList = {
  Home: undefined
  Profile: undefined
  History: undefined
  Knowledge: undefined
  Settings: undefined
  Onboarding: undefined
}

const Stack = createNativeStackNavigator<RootStackParamList>()

function AppContent() {
  const { isDark } = useTheme()
  const userId = useSettingsStore((state) => state.userId)
  const { hasSeenOnboarding, onboardingInProgress, completeOnboarding } = useOnboarding(userId)
  
  const navigationTheme = isDark ? {
    ...DarkTheme,
    colors: {
      ...DarkTheme.colors,
      background: '#002832',
      card: '#002832',
    },
  } : {
    ...DefaultTheme,
    colors: {
      ...DefaultTheme.colors,
      background: '#002832',
      card: '#002832',
    },
  }
  // notification triggers hook removed in pivot
  useEffect(() => {
    const subscription = addNotificationActionListener((response: { actionIdentifier: string }) => {
      // Example: handle notification actions
      const action = response.actionIdentifier
      if (action === 'dismiss') {
        // Dismiss logic
      } else if (action === 'snooze') {
        // Snooze logic (reschedule notification)
      } else if (action === 'open_app') {
        // Open app logic (navigate if needed)
      }
    })
    return () => {
      if (subscription && typeof subscription.remove === 'function') {
        subscription.remove()
      }
    }
  }, [])

  // Register for push notifications after onboarding
  useEffect(() => {
    if (hasSeenOnboarding && userId) {
      registerForPushNotificationsAsync(userId)
    }
  }, [hasSeenOnboarding, userId])

  if (onboardingInProgress) {
    return (
      <View style={{ flex: 1, backgroundColor: '#002832', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#00d4aa" />
      </View>
    )
  }

  if (!hasSeenOnboarding) {
    return (
      <View style={{ flex: 1, backgroundColor: '#002832' }}>
        <OnboardingScreen onComplete={completeOnboarding} />
        <StatusBar style={isDark ? 'light' : 'dark'} />
      </View>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#002832' }}>
      <NavigationContainer theme={navigationTheme}>
        <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#002832' } }}>
          <Stack.Screen name="Home">
            {(props) => (
              <JarvisVoiceScreen
                onNavigate={(route) => {
                  const routeName = route.charAt(0).toUpperCase() + route.slice(1)
                  props.navigation.navigate(routeName as keyof RootStackParamList)
                }}
              />
            )}
          </Stack.Screen>
          <Stack.Screen name="Profile">
            {(props) => <ProfileScreen onNavigate={() => props.navigation.navigate('Home')} />}
          </Stack.Screen>
          <Stack.Screen name="History">
            {(props) => <HistoryScreen onNavigate={() => props.navigation.navigate('Home')} />}
          </Stack.Screen>
          <Stack.Screen name="Knowledge">
            {(props) => <KnowledgeScreen onNavigate={() => props.navigation.navigate('Home')} />}
          </Stack.Screen>
          <Stack.Screen name="Settings">
            {(props) => <SettingsScreen onNavigate={() => props.navigation.navigate('Home')} />}
          </Stack.Screen>
        </Stack.Navigator>
      </NavigationContainer>
      <StatusBar style={isDark ? 'light' : 'dark'} />
    </View>
  )
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <ErrorBoundary>
          <AppContent />
        </ErrorBoundary>
      </ThemeProvider>
    </SafeAreaProvider>
  )
}
