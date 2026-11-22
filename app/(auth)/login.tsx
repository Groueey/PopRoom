import { Eye, EyeOff, Lock, Mail, Sparkles } from 'lucide-react-native';
import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../src/components/ui/Button';
import { Card } from '../../src/components/ui/Card';
import { MotionPressable } from '../../src/components/ui/Motion';
import { isSupabaseConfigured, supabase } from '../../src/lib/supabase';
import { PRIMARY_BUTTON_SHADOW, THEME_COLORS } from '../../src/lib/theme';
import { useAuthStore } from '../../src/stores/authStore';
import { useUiStore } from '../../src/stores/uiStore';

type AuthMode = 'signin' | 'signup';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function mapAuthErrorToChinese(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('invalid login credentials')) {
    return '邮箱或密码不正确，请核对后重试';
  }
  if (lower.includes('email not confirmed')) {
    return '该邮箱尚未验证，请先完成验证或关闭项目邮箱确认';
  }
  if (lower.includes('user already registered') || lower.includes('already been registered')) {
    return '该邮箱已注册，请直接切换至「登录」';
  }
  if (lower.includes('password should be at least')) {
    return '密码长度至少需要 6 位';
  }
  if (lower.includes('invalid format') || lower.includes('unable to validate email')) {
    return '请输入有效的邮箱地址';
  }
  if (lower.includes('rate limit') || lower.includes('too many requests')) {
    return '操作过于频繁，请稍后再试';
  }
  if (lower.includes('network') || lower.includes('fetch')) {
    return '网络连接异常，请检查网络后重试';
  }
  return message || '认证失败，请稍后重试';
}

/** Email + Password login and registration screen (no Confirm Email required in MVP). */
export default function LoginScreen() {
  const pendingRoomCode = useAuthStore((s) => s.pendingRoomCode);
  const showToast = useUiStore((s) => s.showToast);

  const [mode, setMode] = useState<AuthMode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleModeSwitch = (nextMode: AuthMode) => {
    setMode(nextMode);
    setErrorText(null);
  };

  const handleSubmit = async () => {
    const trimmedEmail = email.trim();

    if (!EMAIL_REGEX.test(trimmedEmail)) {
      setErrorText('请输入有效的邮箱地址');
      return;
    }
    if (password.length < 6) {
      setErrorText('密码长度至少需要 6 位');
      return;
    }
    if (!isSupabaseConfigured) {
      setErrorText('尚未配置 Supabase 环境变量，请先复制 .env.example 为 .env 并填入密钥');
      return;
    }

    setErrorText(null);
    setSubmitting(true);

    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({
          email: trimmedEmail,
          password,
        });
        if (error) {
          setErrorText(mapAuthErrorToChinese(error.message));
          return;
        }
        showToast('登录成功', 'success');
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: trimmedEmail,
          password,
        });
        if (error) {
          setErrorText(mapAuthErrorToChinese(error.message));
          return;
        }
        if (data.user && !data.session) {
          showToast('注册成功，请先完成邮箱验证后再登录', 'info', 4000);
          setMode('signin');
          return;
        }
        showToast('账号注册成功', 'success');
      }
    } catch {
      setErrorText('请求失败，请检查网络连接后重试');
    } finally {
      setSubmitting(false);
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
          <View className="mb-7 items-center">
            <View className="mb-3.5 rounded-[28px] border border-primaryBorder bg-primarySoft p-2">
              <View
                style={PRIMARY_BUTTON_SHADOW}
                className="h-14 w-14 items-center justify-center rounded-[20px] bg-primary"
              >
                <Sparkles size={28} color="#FFFFFF" />
              </View>
            </View>
            <Text className="text-2xl font-bold text-ink">
              轻橘 PopRoom
            </Text>
            <Text className="mt-1.5 text-center text-sm text-inkMuted">
              一件事一个房间 · 投票、分工、日程与分账轻巧同步
            </Text>
          </View>

          {pendingRoomCode ? (
            <View className="mb-4 rounded-2xl border border-primaryBorder bg-primarySoft px-4 py-3">
              <Text className="text-center text-xs font-medium text-primaryDeep">
                登录后将自动带你加入房间 · 房间码 {pendingRoomCode}
              </Text>
            </View>
          ) : null}

          <Card className="p-5">
            <View className="mb-5 flex-row rounded-2xl border border-lineSoft bg-surface p-1">
              <MotionPressable
                accessibilityRole="tab"
                accessibilityState={{ selected: mode === 'signin' }}
                flex
                scaleTo={0.97}
                onPress={() => handleModeSwitch('signin')}
                className={`items-center rounded-xl py-2.5 ${
                  mode === 'signin' ? 'bg-white border border-lineSoft' : 'bg-transparent'
                }`}
              >
                <Text
                  className={`text-sm font-semibold ${
                    mode === 'signin' ? 'text-primaryDeep' : 'text-inkMuted'
                  }`}
                >
                  邮箱登录
                </Text>
              </MotionPressable>
              <MotionPressable
                accessibilityRole="tab"
                accessibilityState={{ selected: mode === 'signup' }}
                flex
                scaleTo={0.97}
                onPress={() => handleModeSwitch('signup')}
                className={`items-center rounded-xl py-2.5 ${
                  mode === 'signup' ? 'bg-white border border-lineSoft' : 'bg-transparent'
                }`}
              >
                <Text
                  className={`text-sm font-semibold ${
                    mode === 'signup' ? 'text-primaryDeep' : 'text-inkMuted'
                  }`}
                >
                  注册账号
                </Text>
              </MotionPressable>
            </View>

            <View className="mb-4">
              <Text className="mb-1.5 text-xs font-semibold text-inkMuted">
                邮箱地址
              </Text>
              <View className="flex-row items-center rounded-2xl border border-line bg-surface px-3.5 py-3">
                <Mail size={18} color={THEME_COLORS.inkSubtle} />
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="name@example.com"
                  placeholderTextColor={THEME_COLORS.inkSubtle}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  textContentType="emailAddress"
                  returnKeyType="next"
                  className="ml-2.5 flex-1 text-base text-ink"
                />
              </View>
            </View>

            <View className="mb-4">
              <Text className="mb-1.5 text-xs font-semibold text-inkMuted">
                登录密码（至少 6 位）
              </Text>
              <View className="flex-row items-center rounded-2xl border border-line bg-surface px-3.5 py-3">
                <Lock size={18} color={THEME_COLORS.inkSubtle} />
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder="请输入密码"
                  placeholderTextColor={THEME_COLORS.inkSubtle}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  textContentType={mode === 'signup' ? 'newPassword' : 'password'}
                  returnKeyType="done"
                  onSubmitEditing={handleSubmit}
                  className="ml-2.5 flex-1 text-base text-ink"
                />
                <MotionPressable
                  accessibilityRole="button"
                  accessibilityLabel={showPassword ? '隐藏密码' : '显示密码'}
                  scaleTo={0.9}
                  onPress={() => setShowPassword((prev) => !prev)}
                  hitSlop={8}
                >
                  {showPassword ? (
                    <EyeOff size={18} color={THEME_COLORS.inkMuted} />
                  ) : (
                    <Eye size={18} color={THEME_COLORS.inkMuted} />
                  )}
                </MotionPressable>
              </View>
            </View>

            {errorText ? (
              <View className="mb-4 rounded-xl border border-[#FAD2D0] bg-[#FEF2F2] px-3.5 py-2.5">
                <Text className="text-xs font-medium text-[#C94545]">
                  {errorText}
                </Text>
              </View>
            ) : null}

            <Button
              title={mode === 'signin' ? '立即登录' : '注册并继续'}
              loading={submitting}
              fullWidth
              size="lg"
              onPress={handleSubmit}
            />
          </Card>

          <Text className="mt-5 text-center text-xs text-inkSubtle">
            {mode === 'signin'
              ? '还没有账号？点击上方「注册账号」即可秒开'
              : '注册后直接填写昵称即可建房或加入协作'}
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
