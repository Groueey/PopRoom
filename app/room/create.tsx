import { useQueryClient } from '@tanstack/react-query';
import { type Href, useRouter } from 'expo-router';
import {
  Check,
  ChevronLeft,
  Compass,
  GraduationCap,
  LayoutGrid,
  Lock,
  PartyPopper,
  Unlock,
} from 'lucide-react-native';
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
import { QUERY_KEYS } from '../../src/lib/queryClient';
import { TEMPLATE_LIST } from '../../src/lib/templates';
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
  const color = active ? '#F97316' : '#52525B';
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
  const [title, setTitle] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [eventStartAt, setEventStartAt] = useState('');
  const [eventEndAt, setEventEndAt] = useState('');
  const [joinMode, setJoinMode] = useState<JoinMode>('passcode');
  const [errorText, setErrorText] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const titleLength = Array.from(title.trim()).length;

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
        <View className="flex-row items-center justify-between border-b border-zinc-200/70 bg-white px-4 py-3">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="返回"
            onPress={() => {
              if (router.canGoBack()) {
                router.back();
              } else {
                router.replace('/(tabs)');
              }
            }}
            className="h-9 w-9 items-center justify-center rounded-full bg-zinc-100 active:bg-zinc-200"
          >
            <ChevronLeft size={20} color="#18181B" />
          </Pressable>
          <Text className="text-base font-bold text-ink">创建协作房间</Text>
          <View className="w-9" />
        </View>

        <ScrollView
          className="flex-1 px-4 pt-4"
          contentContainerStyle={{ paddingBottom: 32 }}
          keyboardShouldPersistTaps="handled"
        >
          <Text className="mb-2.5 text-xs font-bold uppercase tracking-wider text-zinc-500">
            1. 选择场景模板（自动装配积木）
          </Text>
          <View className="mb-5 gap-2.5">
            {TEMPLATE_LIST.map((preset) => {
              const selected = templateType === preset.type;
              return (
                <Pressable
                  key={preset.type}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  onPress={() => setTemplateType(preset.type)}
                  className={`rounded-2xl border p-3.5 ${
                    selected
                      ? 'border-primary bg-primarySoft'
                      : 'border-zinc-200/80 bg-white'
                  }`}
                >
                  <View className="flex-row items-center justify-between">
                    <View className="flex-row items-center gap-2.5">
                      <View
                        className={`h-9 w-9 items-center justify-center rounded-xl ${
                          selected ? 'bg-white' : 'bg-zinc-100'
                        }`}
                      >
                        <TemplateIcon type={preset.type} active={selected} />
                      </View>
                      <View>
                        <Text
                          className={`text-sm font-bold ${
                            selected ? 'text-primary' : 'text-ink'
                          }`}
                        >
                          {preset.name}
                        </Text>
                      </View>
                    </View>
                    <View
                      className={`h-6 w-6 items-center justify-center rounded-full ${
                        selected ? 'bg-primary' : 'border border-zinc-300 bg-white'
                      }`}
                    >
                      {selected ? <Check size={14} color="#FFFFFF" /> : null}
                    </View>
                  </View>

                  <Text className="mt-2 text-xs leading-5 text-zinc-600">
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
                </Pressable>
              );
            })}
          </View>

          <Text className="mb-2.5 text-xs font-bold uppercase tracking-wider text-zinc-500">
            2. 活动基本信息
          </Text>
          <Card className="mb-5">
            <View className="mb-4">
              <View className="mb-1.5 flex-row items-center justify-between">
                <Text className="text-xs font-semibold text-zinc-700">
                  房间名称 *
                </Text>
                <Text className="text-xs text-zinc-400">
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
                placeholderTextColor="#A1A1AA"
                maxLength={MAX_ROOM_TITLE_LENGTH}
                className="rounded-2xl border border-zinc-200 bg-surface px-4 py-3 text-base text-ink"
              />
            </View>

            <View className="mb-4">
              <Text className="mb-1.5 text-xs font-semibold text-zinc-700">
                房间公告（选填）
              </Text>
              <TextInput
                value={announcement}
                onChangeText={setAnnouncement}
                placeholder="补充集合地点、注意事项或截止提示..."
                placeholderTextColor="#A1A1AA"
                multiline
                numberOfLines={3}
                textAlignVertical="top"
                maxLength={300}
                className="min-h-[84px] rounded-2xl border border-zinc-200 bg-surface px-4 py-3 text-sm text-ink"
              />
            </View>

            <View>
              <View className="mb-2 flex-row items-center justify-between">
                <Text className="text-xs font-semibold text-zinc-700">
                  活动时间（选填，YYYY-MM-DD HH:mm）
                </Text>
                {(eventStartAt || eventEndAt) ? (
                  <Pressable
                    onPress={() => {
                      setEventStartAt('');
                      setEventEndAt('');
                    }}
                  >
                    <Text className="text-xs font-medium text-primary">清空</Text>
                  </Pressable>
                ) : null}
              </View>

              <View className="mb-2.5 flex-row flex-wrap gap-2">
                <Pressable
                  onPress={() => applyQuickWindow(0, 0)}
                  className="rounded-full border border-orange-200 bg-primarySoft px-3 py-1"
                >
                  <Text className="text-xs font-medium text-primary">今天</Text>
                </Pressable>
                <Pressable
                  onPress={() => applyQuickWindow(1, 1)}
                  className="rounded-full border border-orange-200 bg-primarySoft px-3 py-1"
                >
                  <Text className="text-xs font-medium text-primary">明天</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    const sat = getNextSaturdayOffset();
                    applyQuickWindow(sat, sat + 1);
                  }}
                  className="rounded-full border border-orange-200 bg-primarySoft px-3 py-1"
                >
                  <Text className="text-xs font-medium text-primary">
                    本周末
                  </Text>
                </Pressable>
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
                  placeholderTextColor="#A1A1AA"
                  autoCapitalize="none"
                  className="rounded-2xl border border-zinc-200 bg-surface px-4 py-2.5 text-sm text-ink"
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
                  placeholderTextColor="#A1A1AA"
                  autoCapitalize="none"
                  className="rounded-2xl border border-zinc-200 bg-surface px-4 py-2.5 text-sm text-ink"
                />
              </View>
            </View>
          </Card>

          <Text className="mb-2.5 text-xs font-bold uppercase tracking-wider text-zinc-500">
            3. 进房门禁方式
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
                <Pressable
                  key={mode}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  onPress={() => setJoinMode(mode)}
                  className={`flex-row items-center justify-between rounded-2xl border p-4 ${
                    selected
                      ? 'border-primary bg-primarySoft'
                      : 'border-zinc-200/80 bg-white'
                  }`}
                >
                  <View className="flex-1 flex-row items-center gap-3 pr-3">
                    <View
                      className={`h-9 w-9 items-center justify-center rounded-xl ${
                        selected ? 'bg-white' : 'bg-zinc-100'
                      }`}
                    >
                      {mode === 'passcode' ? (
                        <Unlock
                          size={18}
                          color={selected ? '#F97316' : '#52525B'}
                        />
                      ) : (
                        <Lock
                          size={18}
                          color={selected ? '#F97316' : '#52525B'}
                        />
                      )}
                    </View>
                    <View className="flex-1">
                      <Text
                        className={`text-sm font-bold ${
                          selected ? 'text-primary' : 'text-ink'
                        }`}
                      >
                        {JOIN_MODE_LABELS[mode]}
                      </Text>
                      <Text className="mt-0.5 text-xs text-zinc-500">
                        {subtitle}
                      </Text>
                    </View>
                  </View>
                  <View
                    className={`h-5 w-5 items-center justify-center rounded-full border ${
                      selected
                        ? 'border-primary bg-primary'
                        : 'border-zinc-300 bg-white'
                    }`}
                  >
                    {selected ? (
                      <View className="h-2 w-2 rounded-full bg-white" />
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </View>

          {errorText ? (
            <View className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5">
              <Text className="text-xs font-medium text-red-700">
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
