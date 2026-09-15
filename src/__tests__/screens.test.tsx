import React from 'react'
import { fireEvent, render } from '@testing-library/react-native'
import { HistoryScreen } from '../screens/HistoryScreen'
import { KnowledgeScreen } from '../screens/KnowledgeScreen'
import { SettingsScreen } from '../screens/SettingsScreen'

jest.mock('../services/apiClient', () => ({
  __esModule: true,
  default: {
    getKnowledge: jest.fn(),
  },
  getKnowledge: jest.fn(),
  updateKnowledgeItem: jest.fn(),
  deleteKnowledgeItem: jest.fn(),
}))

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => {
    const { View } = require('react-native')
    return <View>{children}</View>
  },
}))

jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => {
    const { Text } = require('react-native')
    return <Text>{name}</Text>
  },
}))

jest.mock('../hooks/useTheme', () => ({
  useTheme: () => ({
    isDark: false,
    themeMode: 'light',
    setThemeMode: jest.fn(),
  }),
}))

const mockSettingsState = {
  userId: 'local-test-user',
  settings: {
    notificationsEnabled: true,
    hapticFeedbackEnabled: true,
  },
  updateSettings: jest.fn(),
}

jest.mock('../store/settingsStore', () => ({
  useSettingsStore: (selector: (state: typeof mockSettingsState) => unknown) =>
    selector(mockSettingsState),
}))

describe('new app screens', () => {
  it('renders conversation history and exposes an accessible back action', () => {
    const onNavigate = jest.fn()
    const screen = render(<HistoryScreen onNavigate={onNavigate} />)

    expect(screen.getByText('Conversation History')).toBeTruthy()
    expect(screen.getByText('Set a reminder for tomorrow at 9 AM')).toBeTruthy()

    fireEvent.press(screen.getByLabelText('Back to assistant'))
    expect(onNavigate).toHaveBeenCalledTimes(1)
  })

  it('filters knowledge items by type', () => {
    const screen = render(<KnowledgeScreen />)

    expect(screen.getByText('Learn Python')).toBeTruthy()
    fireEvent.press(screen.getByLabelText('Show projects knowledge items'))

    expect(screen.getByText('JARVIS App')).toBeTruthy()
    expect(screen.queryByText('Learn Python')).toBeNull()
  })

  it('renders persisted settings state', () => {
    const screen = render(<SettingsScreen />)

    expect(screen.getByText('Settings')).toBeTruthy()
    expect(screen.getByText('local-test-user')).toBeTruthy()
    expect(screen.getByLabelText('Dark mode')).toBeTruthy()
    expect(screen.getByLabelText('Push notifications')).toBeTruthy()
    expect(screen.getByLabelText('Haptic feedback')).toBeTruthy()
  })

  it('enters edit mode when edit button is pressed', () => {
    const screen = render(<KnowledgeScreen />)

    expect(screen.getByText('Learn Python')).toBeTruthy()
    fireEvent.press(screen.getByLabelText('Edit Learn Python'))
    expect(screen.getByPlaceholderText('Edit value for Learn Python')).toBeTruthy()
  })

  it('enters delete confirmation when delete button is pressed', () => {
    const screen = render(<KnowledgeScreen />)

    expect(screen.getByText('Learn Python')).toBeTruthy()
    fireEvent.press(screen.getByLabelText('Delete Learn Python'))
    expect(screen.getByText('Delete "Learn Python"?')).toBeTruthy()
  })

  it('cancels edit mode when cancel is pressed', () => {
    const screen = render(<KnowledgeScreen />)

    fireEvent.press(screen.getByLabelText('Edit Learn Python'))
    expect(screen.getByPlaceholderText('Edit value for Learn Python')).toBeTruthy()
    fireEvent.press(screen.getByLabelText('Cancel edit'))
    expect(screen.queryByPlaceholderText('Edit value for Learn Python')).toBeNull()
  })

  it('cancels delete confirmation when cancel is pressed', () => {
    const screen = render(<KnowledgeScreen />)

    fireEvent.press(screen.getByLabelText('Delete Learn Python'))
    expect(screen.getByText('Delete "Learn Python"?')).toBeTruthy()
    fireEvent.press(screen.getByLabelText('Cancel delete'))
    expect(screen.queryByText('Delete "Learn Python"?')).toBeNull()
  })
})
