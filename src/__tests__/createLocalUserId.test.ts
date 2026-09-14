const mockGetRandomValues = jest.fn((values: Uint8Array) => {
  values.set([10, 11, 12, 13, 14, 15])
  return values
})

jest.mock('expo-crypto', () => ({
  getRandomValues: (values: Uint8Array) => mockGetRandomValues(values),
}))

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
}))

jest.mock('@expo-google-fonts/orbitron', () => ({
  useFonts: () => [true],
  Orbitron_700Bold: 'Orbitron_700Bold',
}))

jest.mock('@expo-google-fonts/rajdhani', () => ({
  useFonts: () => [true],
  Rajdhani_300Light: 'Rajdhani_300Light',
  Rajdhani_500Medium: 'Rajdhani_500Medium',
}))

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'Ionicons',
}))

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
}))

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}))

jest.mock('../components/SimpleVoiceOrb', () => () => null)
jest.mock('../hooks/useWakeWord', () => ({
  useWakeWord: () => ({ start: jest.fn(), stop: jest.fn() }),
}))
jest.mock('../hooks/useVoiceAssistant', () => ({
  useVoiceAssistant: () => ({
    isListening: false,
    isProcessing: false,
    isSpeaking: false,
    isReady: true,
    error: null,
    transcript: '',
    response: '',
    streamingResponse: '',
    lastLatency: 0,
    startListening: jest.fn(),
    stopListening: jest.fn(),
    sendText: jest.fn(),
    cancel: jest.fn(),
  }),
}))
jest.mock('../services/apiClient', () => ({
  getOrCreateUser: jest.fn(),
}))
jest.mock('../store/settingsStore', () => ({
  useSettingsStore: (selector: (state: { userId: string | null }) => unknown) =>
    selector({ userId: 'existing-user' }),
}))

import { createLocalUserId } from '../components/JarvisVoiceScreen'

describe('createLocalUserId', () => {
  afterEach(() => {
    mockGetRandomValues.mockClear()
  })

  it('builds a local id from cryptographically strong bytes', () => {
    const userId = createLocalUserId()

    expect(mockGetRandomValues).toHaveBeenCalledTimes(1)
    expect(mockGetRandomValues.mock.calls[0]?.[0]).toBeInstanceOf(Uint8Array)
    expect(mockGetRandomValues.mock.calls[0]?.[0].length).toBe(6)
    expect(userId).toMatch(/^local-[0-9a-z]+-abcdef$/)
  })
})
