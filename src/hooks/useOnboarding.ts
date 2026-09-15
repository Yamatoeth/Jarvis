import { useState, useEffect } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { startOnboarding } from '../services/apiClient'

const ONBOARDING_KEY = 'has_seen_onboarding'

export function useOnboarding(userId: string | null | undefined) {
  const [hasSeenOnboarding, setHasSeenOnboarding] = useState(true)
  const [onboardingInProgress, setOnboardingInProgress] = useState(false)

  useEffect(() => {
    AsyncStorage.getItem(ONBOARDING_KEY).then((value) => {
      if (value === 'true') {
        setHasSeenOnboarding(true)
        return
      }

      if (!userId) {
        setHasSeenOnboarding(false)
        return
      }

      setOnboardingInProgress(true)
      startOnboarding(userId)
        .then(() => {
          setHasSeenOnboarding(false)
        })
        .catch(() => {
          // Backend unreachable — fall back to showing onboarding
          setHasSeenOnboarding(false)
        })
        .finally(() => {
          setOnboardingInProgress(false)
        })
    })
  }, [userId])

  const completeOnboarding = async () => {
    await AsyncStorage.setItem(ONBOARDING_KEY, 'true')
    setHasSeenOnboarding(true)
  }

  const resetOnboarding = async () => {
    await AsyncStorage.removeItem(ONBOARDING_KEY)
    setHasSeenOnboarding(false)
  }

  const skipOnboarding = async () => {
    await AsyncStorage.setItem(ONBOARDING_KEY, 'true')
    setHasSeenOnboarding(true)
  }

  return {
    hasSeenOnboarding,
    onboardingInProgress,
    completeOnboarding,
    resetOnboarding,
    skipOnboarding,
  }
}
