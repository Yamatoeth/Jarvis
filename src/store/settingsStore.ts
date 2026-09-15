/**
 * Settings Store - User preferences and app configuration
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Conversation } from '../../shared/types';
import apiClient from '../services/apiClient';

interface UserSettings {
  // Notification preferences
  notificationsEnabled: boolean;
  voiceInterruptionsEnabled: boolean;

  // Display preferences
  darkModeEnabled: boolean;
  hapticFeedbackEnabled: boolean;
  preferredTtsVoice: string;
}

interface SettingsState {
  // User info
  userId: string | null;
  email: string | null;
  fullName: string | null;

  // Settings
  settings: UserSettings;
  // Onboarding
  hasCompletedOnboarding: boolean;
  hasGrantedMicrophonePermissions: boolean;

  // Conversation history (HI4)
  activeConversationId: string | null;
  conversationList: Conversation[];
  setActiveConversationId: (id: string | null) => void;
  setConversationList: (list: Conversation[]) => void;
  fetchConversations: () => Promise<void>;

  // Actions
  setUser: (userId: string, email: string, fullName: string) => void;
  updateSettings: (settings: Partial<UserSettings>) => void;
  completeOnboarding: () => void;
  setMicrophonePermissions: (granted: boolean) => void;
  logout: () => void;
}

const defaultSettings: UserSettings = {
  notificationsEnabled: true,
  voiceInterruptionsEnabled: false,
  darkModeEnabled: false,
  hapticFeedbackEnabled: true,
  preferredTtsVoice: '',
};

const initialState = {
  userId: null,
  email: null,
  fullName: null,
  settings: defaultSettings,
  hasCompletedOnboarding: false,
  hasGrantedMicrophonePermissions: false,

  // Conversation history (HI4)
  activeConversationId: null,
  conversationList: [],
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...initialState,

      setUser: (userId, email, fullName) => {
        set({ userId, email, fullName });
      },

      updateSettings: (updates) => {
        set((state) => ({
          settings: { ...state.settings, ...updates },
        }));
      },

      completeOnboarding: () => {
        set({ hasCompletedOnboarding: true });
      },

      setMicrophonePermissions: (granted) => {
        set({ hasGrantedMicrophonePermissions: granted });
      },

      logout: () => {
        set(initialState);
      },

      // Conversation history (HI4)
      setActiveConversationId: (id) => {
        set({ activeConversationId: id });
      },

      setConversationList: (list) => {
        set({ conversationList: list });
      },

      fetchConversations: async () => {
        const uid = useSettingsStore.getState().userId;
        if (!uid) {
          set({ conversationList: [] });
          return;
        }
        try {
          const convs = await apiClient.getConversations(uid);
          useSettingsStore.getState().setConversationList(convs);
        } catch {
          set({ conversationList: [] });
        }
      },
    }),
    {
      name: 'jarvis-settings',
      storage: createJSONStorage(() => AsyncStorage),
      // Only persist certain fields
      partialize: (state) => ({
        userId: state.userId,
        email: state.email,
        fullName: state.fullName,
        settings: state.settings,
        hasCompletedOnboarding: state.hasCompletedOnboarding,
        hasGrantedMicrophonePermissions: state.hasGrantedMicrophonePermissions,
      }),
    }
  )
);
