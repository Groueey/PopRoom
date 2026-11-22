import { Stack } from 'expo-router';
import React from 'react';

/** Auth group navigator layout keeping login and onboarding headerless. */
export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#F8FAFC' },
      }}
    />
  );
}
