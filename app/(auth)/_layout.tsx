import { Stack } from 'expo-router';
import React from 'react';
import { THEME_COLORS } from '../../src/lib/theme';

/** Auth group navigator layout keeping login and onboarding headerless. */
export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: THEME_COLORS.surface },
      }}
    />
  );
}
