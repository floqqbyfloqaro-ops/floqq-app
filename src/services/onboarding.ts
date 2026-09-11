import AsyncStorage from '@react-native-async-storage/async-storage';

const ONBOARDING_COMPLETE_KEY = 'floqq.onboardingComplete';

export async function hasCompletedOnboarding(): Promise<boolean> {
  const value = await AsyncStorage.getItem(ONBOARDING_COMPLETE_KEY);
  return value === 'true';
}

export async function setOnboardingCompleted(): Promise<void> {
  await AsyncStorage.setItem(ONBOARDING_COMPLETE_KEY, 'true');
}
