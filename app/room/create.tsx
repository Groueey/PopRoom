import { useQueryClient } from '@tanstack/react-query';
import { type Href, useRouter } from 'expo-router';
import {
  ChevronLeft,
  Compass,
  GraduationCap,
  LayoutGrid,
  Lock,
  MessageCircle,
  PartyPopper,
  Unlock,
} from 'lucide-react-native';
import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  JOIN_MODE_LABELS,
  MAX_ROOM_TITLE_LENGTH,
  createRoomWithTemplate,
  mapRoomError,
  validateCreateRoomInput,
} from '../../src/api/rooms';
import { Badge } from '../../src/components/ui/Badge';
import { Button } from '../../src/components/ui/Button';
import { Card } from '../../src/components/ui/Card';
import {
  AnimatedCheckBadge,
  MotionPressable,
} from '../../src/components/ui/Motion';
import { QUERY_KEYS } from '../../src/lib/queryClient';
import { ROOM_TEMPLATES, TEMPLATE_LIST } from '../../src/lib/templates';
import { CARD_SHADOW, THEME_COLORS } from '../../src/lib/theme';
import { useAuthStore } from '../../src/stores/authStore';
import { useUiStore } from '../../src/stores/uiStore';
import type { JoinMode, TemplateType } from '../../src/types/database';

function TemplateIcon({
  type,
  active,
}: {
  type: TemplateType;
  active: boolean;
}) {
  const color = active ? THEME_COLORS.primary : THEME_COLORS.inkMuted;
  switch (type) {
    case 'campus':
      return <GraduationCap size={20} color={color} />;
    case 'travel':
      return <Compass size={20} color={color} />;
    case 'party':
      return <PartyPopper size={20} color={color} />;
    case 'custom':
      return <LayoutGrid size={20} color={color} />;
  }
}

function formatQuickDate(offsetDays: number, hour: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hh = String(hour).padStart(2, '0');
  return `${year}-${month}-${day} ${hh}:00`;
}

function getNextSaturdayOffset(): number {
  const dayOfWeek = new Date().getDay();
  return dayOfWeek === 6 ? 0 : (6 - dayOfWeek + 7) % 7;
}

/** Template-based room creation screen supporting 4 scenario presets and 2-tier join gatekeeping. */
export default function CreateRoomScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const session = useAuthStore((s) => s.session);
  const showToast = useUiStore((s) => s.showToast);

  const userId = session?.user.id ?? '';

  const [templateType, setTemplateType] = useState<TemplateType>('campus');
  const [chatEnabled, setChatEnabled] = useState<boolean>(
    ROOM_TEMPLATES.campus.chatEnabled,
  );
  const [chatManuallyToggled, setChatManuallyToggled] = useState(false);
  const [title, setTitle] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [eventStartAt, setEventStartAt] = useState('');
  const [eventEndAt, setEventEndAt] = useState('');
  const [joinMode, setJoinMode] = useState<JoinMode>('passcode');
  const [errorText, setErrorText] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const titleLength = Array.from(title.trim()).length;

  const handleSelectTemplate = (nextType: TemplateType) => {
    setTemplateType(nextType);
    if (!chatManuallyToggled) {
      setChatEnabled(ROOM_TEMPLATES[nextType].chatEnabled);
    }
  };

  const applyQuickWindow = (startOffsetDays: number, endOffsetDays: number) => {
    setEventStartAt(formatQuickDate(startOffsetDays, 9));
    setEventEndAt(formatQuickDate(endOffsetDays, 18));
    if (errorText) {
      setErrorText(null);
    }
  };

  const handleCreate = async () => {
    setErrorText(null);

    try {
      validateCreateRoomInput({
        title,
        templateType,
        joinMode,
        announcement,
        eventStartAt: eventStartAt || null,
        eventEndAt: eventEndAt || null,
        chatEnabled,
      });
    } catch (err) {
      setErrorText(mapRoomError(err));
      return;
    }

    setSubmitting(true);
    try {
      const room = await createRoomWithTemplate({
        title,
        templateType,
        joinMode,
        announcement,
        eventStartAt: eventStartAt || null,
        eventEndAt: eventEndAt || null,
        chatEnabled,
      });

      queryClient.setQueryData(QUERY_KEYS.roomDetail(room.id), room);
      if (userId) {
        await queryClient.invalidateQueries({
          queryKey: QUERY_KEYS.rooms(userId),
        });
      }

      showToast(`已创建「${room.title}」`, 'success');
      router.replace(`/room/${room.id}` as Href);
    } catch (err) {
      setErrorText(mapRoomError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-surface" edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View className="flex-row items-center justify-between border-b border-line bg-white px-4 py-3">
          <MotionPressable
            accessibilityRole="button"
            accessibilityLabel="返回"
            scaleTo={0.92}
            onPress={() => {
              if (router.canGoBack()) {
                router.back();
              } else {
                router.replace('/(tabs)');
              }
            }}
            className="h-9 w-9 items-center justify-center rounded-full bg-surface"
          >
            <ChevronLeft size={20} color={THEME_COLORS.ink} />
          </MotionPressable>
          <Text className="text-base font-bold text-ink">创建协作房间</Text>
          <View className="w-9" />
        </View>

        <ScrollView
          className="flex-1 px-4 pt-4"
          contentContainerStyle={{ paddingBottom: 36 }}
          keyboardShouldPersistTaps="handled"
        >
          <Text className="mb-2.5 text-sm font-bold text-ink">
            选择场景模板（自动装配积木）
          </Text>
          <View className="mb-5 gap-2.5">
            {TEMPLATE_LIST.map((preset) => {
              const selected = templateType === preset.type;
              return (
                <MotionPressable
                  key={preset.type}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  scaleTo={0.98}
                  onPress={() => handleSelectTemplate(preset.type)}
                  style={CARD_SHADOW}
                  className={`rounded-[22px] border p-4 ${
                    selected
                      ? 'border-primary bg-primarySoft'
                      : 'border-line bg-white'
                  }`}
                >
                  <View className="flex-row items-center justify-between">
                    <View className="flex-row items-center gap-2.5">
                      <View
                        className={`h-10 w-10 items-center justify-center rounded-xl border ${
                          selected
                            ? 'border-primaryBorder bg-white'
                            : 'border-lineSoft bg-surface'
                        }`}
                      >
                        <TemplateIcon type={preset.type} active={selected} />
                      </View>
                      <View>
                        <Text
                          className={`text-sm font-bold ${
                            selected ? 'text-primaryDeep' : 'text-ink'
                          }`}
                        >
                          {preset.name}
                        </Text>
                      </View>
                    </View>
                    <AnimatedCheckBadge checked={selected} size={22} iconSize={13} />
                  </View>

                  <Text className="mt-2 text-xs leading-5 text-inkMuted">
                    {preset.description}
                  </Text>

                  <View className="mt-2.5 flex-row flex-wrap gap-1.5">
                    {preset.blocks.length === 0 ? (
                      <Badge label="进入后自由添加积木" variant="neutral" />
                    ) : (
                      preset.blocks.map((block) => (
                        <Badge
                          key={`${preset.type}-${block.sortOrder}`}
                          label={block.title}
                          variant={selected ? 'primary' : 'neutral'}
                        />
                      ))
                    )}
                  </View>
                </MotionPressable>
              );
            })}
          </View>

          <Text className="mb-2.5 text-sm font-bold text-ink">
            活动基本信息
          </Text>
          <Card className="mb-5">
            <View className="mb-4">
              <View className="mb-1.5 flex-row items-center justify-between">
                <Text className="text-xs font-semibold text-inkMuted">
                  房间名称 *
                </Text>
                <Text className="text-xs text-inkSubtle">
                  {titleLength}/{MAX_ROOM_TITLE_LENGTH}
                </Text>
              </View>
              <TextInput
                value={title}
                onChangeText={(text) => {
                  setTitle(text);
                  if (errorText) {
                    setErrorText(null);
                  }
                }}
                placeholder="例如：周末西湖野餐 / 社团迎新晚会"
                placeholderTextColor={THEME_COLORS.inkSubtle}
                maxLength={MAX_ROOM_TITLE_LENGTH}
                className="rounded-2xl border border-line bg-surface px-4 py-3 text-base text-ink"
              />
            </View>

            <View className="mb-4">
              <Text className="mb-1.5 text-xs font-semibold text-inkMuted">
                房间公告（选填）
              </Text>
              <TextInput
                value={announcement}
                onChangeText={setAnnouncement}
                placeholder="补充集合地点、注意事项或截止提示..."
                placeholderTextColor={THEME_COLORS.inkSubtle}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
                maxLength={300}
                className="min-h-[84px] rounded-2xl border border-line bg-surface px-4 py-3 text-sm text-ink"
              />
            </View>

            <View>
              <View className="mb-2 flex-row items-center justify-between">
                <Text className="text-xs font-semibold text-inkMuted">
                  活动时间（选填，YYYY-MM-DD HH:mm）
                </Text>
                {(eventStartAt || eventEndAt) ? (
                  <MotionPressable
                    scaleTo={0.94}
                    onPress={() => {
                      setEventStartAt('');
                      setEventEndAt('');
                    }}
                  >
                    <Text className="text-xs font-medium text-primaryDeep">清空</Text>
                  </MotionPressable>
                ) : null}
              </View>

              <View className="mb-2.5 flex-row flex-wrap gap-2">
                <MotionPressable
                  scaleTo={0.95}
                  onPress={() => applyQuickWindow(0, 0)}
                  className="rounded-full border border-primaryBorder bg-primarySoft px-3 py-1"
                >
                  <Text className="text-xs font-medium text-primaryDeep">今天</Text>
                </MotionPressable>
                <MotionPressable
                  scaleTo={0.95}
                  onPress={() => applyQuickWindow(1, 1)}
                  className="rounded-full border border-primaryBorder bg-primarySoft px-3 py-1"
                >
                  <Text className="text-xs font-medium text-primaryDeep">明天</Text>
                </MotionPressable>
                <MotionPressable
                  scaleTo={0.95}
                  onPress={() => {
                    const sat = getNextSaturdayOffset();
                    applyQuickWindow(sat, sat + 1);
                  }}
                  className="rounded-full border border-primaryBorder bg-primarySoft px-3 py-1"
                >
                  <Text className="text-xs font-medium text-primaryDeep">
                    本周末
                  </Text>
                </MotionPressable>
              </View>

              <View className="gap-2.5">
                <TextInput
                  value={eventStartAt}
                  onChangeText={(text) => {
                    setEventStartAt(text);
                    if (errorText) {
                      setErrorText(null);
                    }
                  }}
                  placeholder="开始时间，如 2026-11-28 09:00"
                  placeholderTextColor={THEME_COLORS.inkSubtle}
                  autoCapitalize="none"
                  className="rounded-2xl border border-line bg-surface px-4 py-2.5 text-sm text-ink"
                />
                <TextInput
                  value={eventEndAt}
                  onChangeText={(text) => {
                    setEventEndAt(text);
                    if (errorText) {
                      setErrorText(null);
                    }
                  }}
                  placeholder="结束时间，如 2026-11-29 18:00"
                  placeholderTextColor={THEME_COLORS.inkSubtle}
                  autoCapitalize="none"
                  className="rounded-2xl border border-line bg-surface px-4 py-2.5 text-sm text-ink"
                />
              </View>
            </View>
          </Card>

          <Text className="mb-2.5 text-sm font-bold text-ink">
            进房门禁方式
          </Text>
          <View className="mb-5 gap-2.5">
            {(
              [
                {
                  mode: 'passcode' as JoinMode,
                  subtitle: '伙伴输入 6 位房间码或点击邀请链接即可直接入房',
                },
                {
                  mode: 'approval' as JoinMode,
                  subtitle: '输入房间码后需经房主或管理员审批通过方可进入',
                },
              ] as const
            ).map(({ mode, subtitle }) => {
              const selected = joinMode === mode;
              return (
                <MotionPressable
                  key={mode}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  scaleTo={0.98}
                  onPress={() => setJoinMode(mode)}
                  style={CARD_SHADOW}
                  className={`flex-row items-center justify-between rounded-[22px] border p-4 ${
                    selected
                      ? 'border-primary bg-primarySoft'
                      : 'border-line bg-white'
                  }`}
                >
                  <View className="flex-1 flex-row items-center gap-3 pr-3">
                    <View
                      className={`h-9 w-9 items-center justify-center rounded-xl border ${
                        selected
                          ? 'border-primaryBorder bg-white'
                          : 'border-lineSoft bg-surface'
                      }`}
                    >
                      {mode === 'passcode' ? (
                        <Unlock
                          size={18}
                          color={selected ? THEME_COLORS.primary : THEME_COLORS.inkMuted}
                        />
                      ) : (
                        <Lock
                          size={18}
                          color={selected ? THEME_COLORS.primary : THEME_COLORS.inkMuted}
                        />
                      )}
                    </View>
                    <View className="flex-1">
                      <Text
                        className={`text-sm font-bold ${
                          selected ? 'text-primaryDeep' : 'text-ink'
                        }`}
                      >
                        {JOIN_MODE_LABELS[mode]}
                      </Text>
                      <Text className="mt-0.5 text-xs text-inkMuted">
                        {subtitle}
                      </Text>
                    </View>
                  </View>
                  <AnimatedCheckBadge checked={selected} size={20} iconSize={12} />
                </MotionPressable>
              );
            })}
          </View>

          <Text className="mb-2.5 text-sm font-bold text-ink">
            房间聊天室
          </Text>
          <Card className="mb-5">
            <View className="flex-row items-center justify-between gap-3">
              <View className="flex-1 flex-row items-start gap-3">
                <View
                  className={`mt-0.5 h-9 w-9 items-center justify-center rounded-xl border ${
                    chatEnabled
                      ? 'border-primaryBorder bg-primarySoft'
                      : 'border-lineSoft bg-surface'
                  }`}
                >
                  <MessageCircle
                    size={18}
                    color={
                      chatEnabled ? THEME_COLORS.primary : THEME_COLORS.inkMuted
                    }
                  />
                </View>
                <View className="flex-1">
                  <View className="flex-row flex-wrap items-center gap-1.5">
                    <Text className="text-sm font-bold text-ink">
                      开启房间聊天室
                    </Text>
                    <Badge
                      label={
                        ROOM_TEMPLATES[templateType].chatEnabled
                          ? '当前模板默认开启'
                          : '当前模板默认关闭'
                      }
                      variant={
                        ROOM_TEMPLATES[templateType].chatEnabled
                          ? 'primary'
                          : 'neutral'
                      }
                    />
                  </View>
                  <Text className="mt-1 text-xs leading-5 text-inkMuted">
                    开启后房间内显示「协作看板 | 聊天室」双 Tab，支持 @提醒 与聊完转积木
                  </Text>
                </View>
              </View>
              <Switch
                accessibilityLabel="开启房间聊天室"
                value={chatEnabled}
                onValueChange={(nextValue) => {
                  setChatManuallyToggled(true);
                  setChatEnabled(nextValue);
                }}
                trackColor={{
                  false: THEME_COLORS.switchOffTrack,
                  true: THEME_COLORS.primaryBorder,
                }}
                thumbColor={
                  chatEnabled ? THEME_COLORS.primary : THEME_COLORS.switchOffThumb
                }
              />
            </View>
          </Card>

          {errorText ? (
            <View className="mb-4 rounded-xl border border-[#FAD2D0] bg-[#FEF2F2] px-3.5 py-2.5">
              <Text className="text-xs font-medium text-[#C94545]">
                {errorText}
              </Text>
            </View>
          ) : null}

          <Button
            title="立即创建房间"
            loading={submitting}
            fullWidth
            size="lg"
            onPress={handleCreate}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
