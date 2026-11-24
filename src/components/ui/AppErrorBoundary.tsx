import * as Clipboard from 'expo-clipboard';
import { AlertTriangle, Check, Copy, RotateCcw } from 'lucide-react-native';
import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  formatErrorReportText,
  getRuntimeAppBuildInfo,
} from '../../lib/appVersion';
import { CARD_SHADOW, THEME_COLORS } from '../../lib/theme';
import { Button } from './Button';

interface AppErrorBoundaryProps {
  children: React.ReactNode;
}

interface AppErrorBoundaryState {
  error: Error | null;
  copied: boolean;
}

/**
 * Top-level React error boundary preventing unhandled render exceptions in standalone
 * Android release builds from silently terminating to the home screen.
 */
export class AppErrorBoundary extends React.Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  private copiedTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(props: AppErrorBoundaryProps) {
    super(props);
    this.state = { error: null, copied: false };
  }

  static getDerivedStateFromError(error: Error): Partial<AppErrorBoundaryState> {
    return { error, copied: false };
  }

  componentDidCatch(error: Error): void {
    console.error('[PopRoom] Unhandled UI render error:', error.message);
  }

  componentWillUnmount(): void {
    if (this.copiedTimer) {
      clearTimeout(this.copiedTimer);
      this.copiedTimer = null;
    }
  }

  private handleReload = (): void => {
    this.setState({ error: null, copied: false });
  };

  private handleCopyReport = async (): Promise<void> => {
    const { error } = this.state;
    if (!error) {
      return;
    }
    try {
      const report = formatErrorReportText(error, getRuntimeAppBuildInfo());
      await Clipboard.setStringAsync(report);
      this.setState({ copied: true });
      if (this.copiedTimer) {
        clearTimeout(this.copiedTimer);
      }
      this.copiedTimer = setTimeout(() => {
        this.setState({ copied: false });
      }, 2000);
    } catch {
      // Ignore clipboard failures on restricted environments.
    }
  };

  render(): React.ReactNode {
    const { error, copied } = this.state;
    if (!error) {
      return this.props.children;
    }

    const previewText = `${error.name || 'Error'}: ${error.message || '未知异常'}`;

    return (
      <SafeAreaView className="flex-1 bg-surface">
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: 'center',
            paddingHorizontal: 20,
            paddingVertical: 32,
          }}
        >
          <View
            style={CARD_SHADOW}
            className="rounded-3xl border border-line bg-white p-6"
          >
            <View className="mb-4 h-12 w-12 items-center justify-center rounded-2xl bg-primarySoft">
              <AlertTriangle size={24} color={THEME_COLORS.primary} />
            </View>
            <Text className="text-xl font-bold text-ink">页面开小差了</Text>
            <Text className="mt-2 text-sm leading-6 text-inkMuted">
              别担心，已同步到云端的协作记录不会丢失。你可以点击下方按钮重新加载，或复制报错发给开发者。
            </Text>

            <View className="mt-4 rounded-xl border border-lineSoft bg-primaryMist px-3.5 py-2.5">
              <Text
                className="text-xs leading-5 text-inkMuted"
                numberOfLines={2}
              >
                {previewText}
              </Text>
            </View>

            <View className="mt-5 gap-2.5">
              <Button
                title="重新加载"
                variant="primary"
                fullWidth
                leftIcon={<RotateCcw size={16} color={THEME_COLORS.white} />}
                onPress={this.handleReload}
              />
              <Button
                title={copied ? '已复制报错信息' : '复制报错信息'}
                variant="secondary"
                fullWidth
                leftIcon={
                  copied ? (
                    <Check size={16} color={THEME_COLORS.success} />
                  ) : (
                    <Copy size={16} color={THEME_COLORS.primaryDeep} />
                  )
                }
                onPress={() => void this.handleCopyReport()}
              />
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }
}
