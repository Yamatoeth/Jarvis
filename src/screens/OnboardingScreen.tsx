import { View, Text, TouchableOpacity, Dimensions, Animated } from 'react-native'
import { useState, useRef } from 'react'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../hooks/useTheme'

const { width } = Dimensions.get('window')

type OnboardingSlide = {
  icon: keyof typeof Ionicons.glyphMap
  title: string
  description: string
  color: string
}

const slides: OnboardingSlide[] = [
  {
    icon: 'chatbubbles',
    title: 'AI Personal Assistant',
    description: 'Talk with JARVIS, your low-latency personal assistant. Voice runs through the backend so provider keys stay server-side.',
    color: '#0066ff',
  },
  {
    icon: 'server',
    title: 'Durable Memory',
    description: 'Onboarding and completed conversations extract useful facts into the PostgreSQL Knowledge Base.',
    color: '#10b981',
  },
  {
    icon: 'analytics',
    title: 'Context-Aware Replies',
    description: 'JARVIS uses saved goals, projects, preferences, and recent conversation context when it answers.',
    color: '#8b5cf6',
  },
  {
    icon: 'shield-checkmark',
    title: 'Private & Secure',
    description: 'Phase 1 does not request location, calendar, or biometric permissions. The mobile app stays thin.',
    color: '#f59e0b',
  },
  {
    icon: 'notifications',
    title: 'Stay Informed',
    description: 'Notifications are optional and can be used later for explicit reminders. They are not part of automatic interventions.',
    color: '#ef4444',
  },
]

type Props = {
  onComplete: () => void
}

import { useNotificationPermission } from '../hooks/useNotificationPermission'

export function OnboardingScreen({ onComplete }: Props) {
  const { isDark } = useTheme()
  const [currentIndex, setCurrentIndex] = useState(0)
  const translateX = useRef(new Animated.Value(0)).current
  const notificationGranted = useNotificationPermission()

  const goToSlide = (index: number) => {
    Animated.timing(translateX, {
      toValue: -index * width,
      duration: 300,
      useNativeDriver: true,
    }).start()
    setCurrentIndex(index)
  }

  const nextSlide = () => {
    // If on notification slide, request permission
    if (currentIndex === slides.length - 2) {
      // notification permission is requested automatically by hook
      goToSlide(currentIndex + 1)
      return
    }
    if (currentIndex < slides.length - 1) {
      goToSlide(currentIndex + 1)
    } else {
      onComplete()
    }
  }

  const skipOnboarding = () => {
    onComplete()
  }

  return (
    <SafeAreaView className={`flex-1 ${isDark ? 'bg-gray-900' : 'bg-white'}`}>
      {/* Skip button */}
      <View className="flex-row justify-end p-4">
        <TouchableOpacity onPress={skipOnboarding}>
          <Text className={`text-base ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            Skip
          </Text>
        </TouchableOpacity>
      </View>

      {/* Slides */}
      <View className="flex-1">
        <Animated.View 
          style={[
            { flexDirection: 'row', width: width * slides.length },
            { transform: [{ translateX }] }
          ]}
        >
          {slides.map((slide, index) => (
            <View key={index} style={{ width }} className="items-center justify-center px-8">
              <View 
                className="w-32 h-32 rounded-full items-center justify-center mb-8"
                style={{ backgroundColor: slide.color + '20' }}
              >
                <Ionicons name={slide.icon} size={64} color={slide.color} />
              </View>
              <Text className={`text-2xl font-bold text-center mb-4 ${isDark ? 'text-white' : 'text-gray-900'}`}>
                {slide.title}
              </Text>
              <Text className={`text-base text-center leading-6 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                {slide.description}
              </Text>
            </View>
          ))}
        </Animated.View>
      </View>

      {/* Pagination dots */}
      <View className="flex-row justify-center gap-2 mb-8">
        {slides.map((_, index) => (
          <TouchableOpacity 
            key={index} 
            onPress={() => goToSlide(index)}
            className={`w-2 h-2 rounded-full ${
              currentIndex === index 
                ? 'bg-primary w-6' 
                : isDark ? 'bg-gray-600' : 'bg-gray-300'
            }`}
          />
        ))}
      </View>

      {/* Bottom buttons */}
      <View className="px-6 pb-4 gap-3">
        <TouchableOpacity
          className="bg-primary py-4 rounded-xl items-center active:opacity-80"
          onPress={nextSlide}
        >
          <Text className="text-white font-semibold text-base">
            {currentIndex === slides.length - 1 ? 'Get Started' : 'Next'}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  )
}
