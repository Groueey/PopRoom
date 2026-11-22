import { Check } from 'lucide-react-native';
import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar } from '../../src/components/ui/Avatar';
import { Button } from '../../src/components/ui/Button';
import { Card } from '../../src/components/ui/Card';
import {
  clearCachedProfile,
  saveCachedProfile,
} from '../../src/lib/profileCache';
import { supabase } from '../../src/lib/supabase';
import { AVATAR_COLORS, useAuthStore } from '../../src/stores/authStore';
import { useUiStore } from '../../src/stores/uiStore';
import type { ProfileRow } from '../../src/types/database';

const MIN_NICKNAME_LENGTH = 1;
const MAX_NICKNAME_LENGTH = 20;

/** First-time onboarding screen setting required nickname (1–20 chars) and avatar color. */
export default function OnboardingScreen() {
  const session = useAuthStore((s) => s.session);
  const pendingRoomCode = useAuthStore((s) => s.pendingRoomCode);
  const setProfile = useAuthStore((s) => s.setProfile);
  const showToast = useUiStore((s) => s.showToast);

  const [nickname, setNickname] = useState('');
  const [selectedColor, setSelectedColor] = useState<string>(AVATAR_COLORS[0]);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const trimmedNickname = nickname.trim();
  const nicknameLength = Array.from(trimmedNickname).length;

  const handleSaveProfile = async () => {
    if (
      nicknameLength < MIN_NICKNAME_LENGTH ||
      nicknameLength > MAX_NICKNAME_LENGTH
    ) {
      setErrorText('请输入 1–20 个字符的昵称');
      return;
    }

    const userId = session?.user.id;
    if (!userId) {
      setErrorText('登录状态已失效，请重新登录');
      return;
    }

    setErrorText(null);
    setSubmitting(true);

    try {
      const { data, error } = await supabase
        .from('profiles')
        .upsert(
          {
            id: userId,
            nickname: trimmedNickname,
            avatar_color: selectedColor,
          },
          { onConflict: 'id' },
        )
        .select(
          'id, nickname, avatar_color, avatar_url, expo_push_token, created_at, updated_at',
        )
        .single();

      if (error || !data) {
        setErrorText(error?.message || '保存个人资料失败，请稍后重试');
        return;
      }

      const savedProfile = data as ProfileRow;
      await saveCachedProfile(savedProfile);
      setProfile(savedProfile);
      showToast('资料已保存，欢迎来到轻橘！', 'success');
    } catch {
      setErrorText('网络异常，请稍后再试');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignOut = async () => {
    const currentUserId = session?.user.id;
    const { error } = await supabase.auth.signOut();
    if (!error) {
      await clearCachedProfile(currentUserId);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-surface">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}
          keyboardShouldPersistTaps="handled"
          className="px-5 py-6"
        >
          <View className="mb-6 items-center">
            <Avatar
              nickname={trimmedNickname || '橘'}
              color={selectedColor}
              size="xl"
            />
            <Text className="mt-4 text-2xl font-bold text-ink">
              设置你的协作名片
            </Text>
            <Text className="mt-1 text-center text-sm text-zinc-500">
              房间内的伙伴会通过昵称和头像色块认识你
            </Text>
          </View>

          {pendingRoomCode ? (
            <View className="mb-4 rounded-2xl border border-orange-200 bg-primarySoft px-4 py-3">
              <Text className="text-center text-xs font-medium text-primary">
                完成名片设置后，将自动进入房间 {pendingRoomCode}
              </Text>
            </View>
          ) : null}

          <Card className="p-5">
            <View className="mb-5">
              <View className="mb-1.5 flex-row items-center justify-between">
                <Text className="text-xs font-semibold text-zinc-600">
                  我的昵称
                </Text>
                <Text className="text-xs text-zinc-400">
                  {nicknameLength}/{MAX_NICKNAME_LENGTH}
                </Text>
              </View>
              <TextInput
                value={nickname}
                onChangeText={(text) => {
                  setNickname(text);
                  if (errorText) {
                    setErrorText(null);
                  }
                }}
                placeholder="例如：阿橘 / 小林"
                placeholderTextColor="#A1A1AA"
                maxLength={MAX_NICKNAME_LENGTH}
                autoFocus
                returnKeyType="done"
                className="rounded-2xl border border-zinc-200 bg-surface px-4 py-3 text-base text-ink"
              />
            </View>

            <View className="mb-5">
              <Text className="mb-2.5 text-xs font-semibold text-zinc-600">
                选择头像色块
              </Text>
              <View className="flex-row flex-wrap gap-3">
                {AVATAR_COLORS.map((color) => {
                  const selected = selectedColor === color;
                  return (
                    <Pressable
                      key={color}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      accessibilityLabel={`头像颜色 ${color}`}
                      onPress={() => setSelectedColor(color)}
                      style={{ backgroundColor: color }}
                      className={`h-11 w-11 items-center justify-center rounded-full ${
                        selected ? 'border-2 border-ink' : ''
                      }`}
                    >
                      {selected ? <Check size={18} color="#FFFFFF" /> : null}
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {errorText ? (
              <View className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5">
                <Text className="text-xs font-medium text-red-700">
                  {errorText}
                </Text>
              </View>
            ) : null}

            <Button
              title={pendingRoomCode ? '保存并前往房间' : '开启轻橘协作'}
              loading={submitting}
              fullWidth
              size="lg"
              onPress={handleSaveProfile}
            />
          </Card>

          <View className="mt-4 items-center">
            <Button
              title="切换其他账号登录"
              variant="ghost"
              size="sm"
              onPress={handleSignOut}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
