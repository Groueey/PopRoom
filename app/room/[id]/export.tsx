import { useQuery } from '@tanstack/react-query';
import * as Print from 'expo-print';
import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import {
  AlertTriangle,
  Archive,
  ArrowRight,
  BarChart3,
  Calendar,
  CalendarClock,
  CheckSquare,
  ChevronLeft,
  Crown,
  EyeOff,
  FileText,
  Image as ImageIcon,
  MapPin,
  ShieldAlert,
  Sparkles,
  Users,
  Wallet,
} from 'lucide-react-native';
import React, { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ViewShot from 'react-native-view-shot';
import {
  fetchRoomBlocksWithItems,
  fetchRoomPollTallies,
} from '../../../src/api/blocks';
import {
  fetchRoomDetail,
  fetchRoomMembers,
  mapRoomError,
} from '../../../src/api/rooms';
import { Avatar } from '../../../src/components/ui/Avatar';
import { Badge } from '../../../src/components/ui/Badge';
import { Button } from '../../../src/components/ui/Button';
import { Card } from '../../../src/components/ui/Card';
import { OfflineSyncBanner } from '../../../src/components/ui/OfflineSyncBanner';
import { useRoomPermissions } from '../../../src/hooks/useRoomPermissions';
import { QUERY_KEYS } from '../../../src/lib/queryClient';
import {
  buildRoomRecapData,
  renderRecapHtml,
} from '../../../src/lib/recapBuilder';
import { resolveRoomScreenState } from '../../../src/lib/roomScreenState';
import { useAuthStore } from '../../../src/stores/authStore';
import { useUiStore } from '../../../src/stores/uiStore';
import type { TaskStatus } from '../../../src/schemas/blocks';

type ExportKind = 'png' | 'pdf';

function readRoomIdParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? '';
  }
  return value ?? '';
}

function getTaskBadgeVariant(
  status: TaskStatus,
): 'success' | 'primary' | 'neutral' {
  switch (status) {
    case 'done':
      return 'success';
    case 'in_progress':
      return 'primary';
    case 'unclaimed':
      return 'neutral';
  }
}

/** Activity Recap preview and HD PNG / A4 PDF export screen (accessible in active and archived rooms). */
export default function RoomExportScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const roomId = readRoomIdParam(params.id);

  const session = useAuthStore((s) => s.session);
  const showToast = useUiStore((s) => s.showToast);
  const currentUserId = session?.user.id ?? null;

  const viewShotRef = useRef<ViewShot>(null);
  const [exportingType, setExportingType] = useState<ExportKind | null>(null);

  const {
    data: room,
    isLoading: roomLoading,
    isRefetching: roomRefetching,
    error: roomError,
    refetch: refetchRoom,
  } = useQuery({
    queryKey: QUERY_KEYS.roomDetail(roomId),
    queryFn: () => fetchRoomDetail(roomId),
    enabled: Boolean(roomId),
  });

  const {
    data: members = [],
    isLoading: membersLoading,
    isRefetching: membersRefetching,
    error: membersError,
    refetch: refetchMembers,
  } = useQuery({
    queryKey: QUERY_KEYS.roomMembers(roomId),
    queryFn: () => fetchRoomMembers(roomId),
    enabled: Boolean(roomId),
  });

  const {
    data: blocks = [],
    isLoading: blocksLoading,
    isRefetching: blocksRefetching,
    error: blocksError,
    refetch: refetchBlocks,
  } = useQuery({
    queryKey: QUERY_KEYS.roomBlocks(roomId),
    queryFn: () => fetchRoomBlocksWithItems(roomId),
    enabled: Boolean(roomId),
  });

  const {
    data: pollTallies,
    isLoading: talliesLoading,
    isRefetching: talliesRefetching,
    error: talliesError,
    refetch: refetchTallies,
  } = useQuery({
    queryKey: QUERY_KEYS.roomPollTallies(roomId),
    queryFn: () => fetchRoomPollTallies(roomId),
    enabled: Boolean(roomId),
  });

  const activeMembers = useMemo(
    () => members.filter((member) => member.status === 'active'),
    [members],
  );

  const myRawMembership = useMemo(
    () => members.find((member) => member.user_id === currentUserId) ?? null,
    [members, currentUserId],
  );

  const myMembership = useMemo(
    () =>
      activeMembers.find((member) => member.user_id === currentUserId) ?? null,
    [activeMembers, currentUserId],
  );

  const permissions = useRoomPermissions({
    role: myMembership?.role ?? null,
    roomStatus: room?.status ?? 'active',
    currentUserId,
    allowMemberCreatePoll: room?.allow_member_create_poll ?? true,
  });

  const recap = useMemo(() => {
    if (!room) {
      return null;
    }
    return buildRoomRecapData({
      room,
      members,
      blocks,
      pollTallies: pollTallies ?? [],
    });
  }, [room, members, blocks, pollTallies]);

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else if (roomId) {
      router.replace(`/room/${roomId}` as Href);
    } else {
      router.replace('/(tabs)');
    }
  };

  const handleRefreshAll = () => {
    void Promise.all([
      refetchRoom(),
      refetchMembers(),
      refetchBlocks(),
      refetchTallies(),
    ]);
  };

  const shareFileUri = async (
    uri: string,
    mimeType: string,
    uti: string,
    dialogTitle: string,
    successMessage: string,
  ) => {
    const canShare = await Sharing.isAvailableAsync();
    if (!canShare) {
      showToast('当前设备暂不支持系统分享', 'error');
      return;
    }
    await Sharing.shareAsync(uri, {
      mimeType,
      UTI: uti,
      dialogTitle,
    });
    showToast(successMessage, 'success');
  };

  const handleExportPng = async () => {
    if (!recap || !permissions.canExportRecap || exportingType !== null) {
      return;
    }
    setExportingType('png');
    try {
      const uri = await viewShotRef.current?.capture?.();
      if (!uri) {
        showToast('生成长图失败，请稍后重试', 'error');
        return;
      }
      await shareFileUri(
        uri,
        'image/png',
        'public.png',
        `分享「${recap.room.title}」复盘长图`,
        '复盘长图已生成，请选择保存或分享方式',
      );
    } catch {
      showToast('导出高清长图失败，请稍后重试', 'error');
    } finally {
      setExportingType(null);
    }
  };

  const handleExportPdf = async () => {
    if (!recap || !permissions.canExportRecap || exportingType !== null) {
      return;
    }
    setExportingType('pdf');
    try {
      const html = renderRecapHtml(recap);
      const { uri } = await Print.printToFileAsync({ html });
      if (!uri) {
        showToast('生成 PDF 文件失败，请稍后重试', 'error');
        return;
      }
      await shareFileUri(
        uri,
        'application/pdf',
        'com.adobe.pdf',
        `分享「${recap.room.title}」复盘 PDF`,
        '复盘 PDF 已生成，请选择保存或分享方式',
      );
    } catch {
      showToast('导出 PDF 失败，请稍后重试', 'error');
    } finally {
      setExportingType(null);
    }
  };

  const screenState = resolveRoomScreenState({
    mode: 'export',
    room,
    roomLoading,
    roomError,
    members,
    membersLoading,
    membersError,
    myRawMembership,
    canAccess: permissions.canExportRecap,
    blocksCount: blocks.length,
    blocksLoading,
    blocksError,
    hasPollTallies: pollTallies !== undefined,
    talliesLoading,
    talliesError,
  });

  if (screenState.kind === 'loading') {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-surface">
        <ActivityIndicator size="large" color="#F97316" />
        <Text className="mt-3 text-xs text-zinc-500">正在汇总活动复盘...</Text>
      </SafeAreaView>
    );
  }

  if (screenState.kind === 'full_error' || !room || !recap) {
    const errorTitle =
      screenState.kind === 'full_error'
        ? screenState.title
        : '无法加载活动复盘';
    const errorMessage =
      screenState.kind === 'full_error'
        ? screenState.message
        : mapRoomError(roomError);
    const canRetry =
      screenState.kind === 'full_error' ? screenState.canRetry : true;

    return (
      <SafeAreaView className="flex-1 bg-surface px-4 pt-6">
        <Card className="items-center p-6">
          <AlertTriangle size={28} color="#EF4444" />
          <Text className="mt-3 text-base font-bold text-ink">{errorTitle}</Text>
          <Text className="mt-1.5 text-center text-xs leading-5 text-zinc-500">
            {errorMessage}
          </Text>
          <View className="mt-5 w-full gap-2.5">
            {canRetry ? (
              <Button
                title="重新加载"
                variant="secondary"
                fullWidth
                onPress={handleRefreshAll}
              />
            ) : null}
            <Button
              title="返回"
              variant="primary"
              fullWidth
              onPress={handleBack}
            />
          </View>
        </Card>
      </SafeAreaView>
    );
  }

  if (screenState.kind === 'members_error') {
    return (
      <SafeAreaView className="flex-1 bg-surface" edges={['top', 'bottom']}>
        <View className="flex-row items-center justify-between border-b border-zinc-200/70 bg-white px-4 py-3">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="返回上一页"
            onPress={handleBack}
            className="h-9 w-9 items-center justify-center rounded-full bg-zinc-100 active:bg-zinc-200"
          >
            <ChevronLeft size={20} color="#18181B" />
          </Pressable>
          <Text className="text-base font-bold text-ink">活动复盘与导出</Text>
          <View className="w-9" />
        </View>
        <View className="flex-1 justify-center px-4">
          <Card className="items-center p-6">
            <AlertTriangle size={28} color="#EF4444" />
            <Text className="mt-3 text-base font-bold text-ink">
              成员权限加载失败
            </Text>
            <Text className="mt-1.5 text-center text-xs leading-5 text-zinc-500">
              {screenState.message}
            </Text>
            <View className="mt-5 w-full gap-2.5">
              <Button
                title="重新加载"
                variant="secondary"
                fullWidth
                onPress={handleRefreshAll}
              />
              <Button title="返回" fullWidth onPress={handleBack} />
            </View>
          </Card>
        </View>
      </SafeAreaView>
    );
  }

  if (screenState.kind === 'permission_denied') {
    return (
      <SafeAreaView className="flex-1 bg-surface" edges={['top', 'bottom']}>
        <View className="flex-row items-center justify-between border-b border-zinc-200/70 bg-white px-4 py-3">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="返回上一页"
            onPress={handleBack}
            className="h-9 w-9 items-center justify-center rounded-full bg-zinc-100 active:bg-zinc-200"
          >
            <ChevronLeft size={20} color="#18181B" />
          </Pressable>
          <Text className="text-base font-bold text-ink">活动复盘与导出</Text>
          <View className="w-9" />
        </View>
        <View className="flex-1 justify-center px-4">
          <Card className="items-center p-6">
            <ShieldAlert size={28} color="#F97316" />
            <Text className="mt-3 text-base font-bold text-ink">
              仅房间成员可导出复盘
            </Text>
            <Text className="mt-1.5 text-center text-xs leading-5 text-zinc-500">
              当前账号不是该房间的活跃成员，无法查看或导出活动结案卡片。
            </Text>
            <View className="mt-5 w-full">
              <Button title="返回" fullWidth onPress={handleBack} />
            </View>
          </Card>
        </View>
      </SafeAreaView>
    );
  }

  const isRefreshing =
    roomRefetching || membersRefetching || blocksRefetching || talliesRefetching;

  return (
    <SafeAreaView className="flex-1 bg-surface" edges={['top', 'bottom']}>
      <View className="flex-row items-center justify-between border-b border-zinc-200/70 bg-white px-4 py-3">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="返回房间看板"
          onPress={handleBack}
          className="h-9 w-9 items-center justify-center rounded-full bg-zinc-100 active:bg-zinc-200"
        >
          <ChevronLeft size={20} color="#18181B" />
        </Pressable>
        <View className="items-center">
          <Text className="text-base font-bold text-ink">活动复盘与导出</Text>
          <Text className="text-[11px] text-zinc-400" numberOfLines={1}>
            {recap.room.title}
          </Text>
        </View>
        <View className="w-9" />
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefreshAll}
            tintColor="#F97316"
            colors={['#F97316']}
          />
        }
      >
        {screenState.syncWarning ? (
          <OfflineSyncBanner
            message={screenState.syncWarning}
            onRetry={handleRefreshAll}
            retrying={isRefreshing}
          />
        ) : null}

        <ViewShot
          ref={viewShotRef}
          options={{ format: 'png', quality: 1 }}
        >
          <View
            collapsable={false}
            className="overflow-hidden rounded-3xl border border-orange-200/80 bg-white"
          >
            {/* Warm Tangerine Hero Header */}
            <View className="border-b border-orange-200/70 bg-primarySoft px-5 py-5">
              <View className="mb-3 flex-row items-center justify-between gap-2">
                <View className="flex-row items-center gap-1.5 rounded-full bg-primary px-3 py-1">
                  <Sparkles size={12} color="#FFFFFF" />
                  <Text className="text-[11px] font-bold text-white">
                    轻橘 PopRoom · 活动复盘单
                  </Text>
                </View>
                <Badge
                  label={recap.room.statusLabel}
                  variant={recap.room.status === 'archived' ? 'warning' : 'success'}
                />
              </View>

              <Text className="text-xl font-extrabold text-ink">
                {recap.room.title}
              </Text>

              <View className="mt-2.5 flex-row flex-wrap items-center gap-2">
                <Badge label={recap.room.templateLabel} variant="primary" />
                <View className="flex-row items-center gap-1 rounded-full bg-white/90 px-2.5 py-0.5">
                  <Users size={11} color="#52525B" />
                  <Text className="text-[11px] font-medium text-zinc-700">
                    {recap.room.activeMemberCount} 人参与
                  </Text>
                </View>
                {recap.room.eventWindow ? (
                  <View className="flex-row items-center gap-1 rounded-full bg-white/90 px-2.5 py-0.5">
                    <Calendar size={11} color="#52525B" />
                    <Text className="text-[11px] font-medium text-zinc-700">
                      {recap.room.eventWindow}
                    </Text>
                  </View>
                ) : null}
              </View>

              {recap.room.announcement ? (
                <View className="mt-3 rounded-2xl border border-orange-200/70 bg-white/90 px-3.5 py-2.5">
                  <Text className="text-xs leading-5 text-zinc-700">
                    {recap.room.announcement}
                  </Text>
                </View>
              ) : null}

              {activeMembers.length > 0 ? (
                <View className="mt-3 flex-row flex-wrap items-center gap-2">
                  {activeMembers.slice(0, 8).map((member) => (
                    <View
                      key={member.id}
                      className="flex-row items-center gap-1 rounded-full border border-orange-200/70 bg-white px-2 py-0.5"
                    >
                      <Avatar
                        nickname={member.profiles?.nickname}
                        color={member.profiles?.avatar_color}
                        imageUrl={member.profiles?.avatar_url}
                        size="xs"
                      />
                      <Text className="text-[11px] font-medium text-zinc-700">
                        {member.profiles?.nickname?.trim() || '协作伙伴'}
                      </Text>
                    </View>
                  ))}
                  {activeMembers.length > 8 ? (
                    <Text className="text-[11px] font-semibold text-zinc-500">
                      +{activeMembers.length - 8} 人
                    </Text>
                  ) : null}
                </View>
              ) : null}
            </View>

            <View className="gap-5 px-5 py-5">
              {/* 1. Poll Conclusions */}
              <View>
                <View className="mb-2.5 flex-row items-center gap-2">
                  <BarChart3 size={16} color="#F97316" />
                  <Text className="text-sm font-extrabold text-ink">
                    投票结论
                  </Text>
                </View>

                {recap.polls.length === 0 ? (
                  <Text className="text-xs text-zinc-400">暂无投票积木记录</Text>
                ) : (
                  <View className="gap-3">
                    {recap.polls.map((poll) => (
                      <View
                        key={poll.blockId}
                        className="rounded-2xl border border-zinc-200/80 bg-surface p-3.5"
                      >
                        <View className="mb-2 flex-row items-center justify-between gap-2">
                          <Text className="flex-1 text-xs font-bold text-ink">
                            {poll.title}
                          </Text>
                          <View className="flex-row items-center gap-1.5">
                            {poll.anonymous ? (
                              <View className="flex-row items-center gap-1 rounded-full bg-zinc-200/70 px-2 py-0.5">
                                <EyeOff size={10} color="#52525B" />
                                <Text className="text-[10px] font-semibold text-zinc-600">
                                  匿名
                                </Text>
                              </View>
                            ) : null}
                            <Text className="text-[11px] text-zinc-500">
                              共 {poll.totalVotes} 票
                            </Text>
                          </View>
                        </View>

                        {poll.winners.length > 0 ? (
                          <View className="mb-2.5 flex-row items-center gap-1.5 rounded-xl border border-orange-200 bg-primarySoft px-3 py-2">
                            <Crown size={14} color="#F97316" />
                            <Text className="flex-1 text-xs font-bold text-ink">
                              {poll.winners.length > 1 ? '并列胜出：' : '最终胜出：'}
                              {poll.winners.map((w) => w.label).join(' / ')}
                            </Text>
                            <Text className="text-[11px] font-bold text-primary">
                              {poll.maxVotes} 票
                            </Text>
                          </View>
                        ) : (
                          <Text className="mb-2 text-[11px] text-zinc-400">
                            暂无人投票
                          </Text>
                        )}

                        <View className="gap-2">
                          {poll.options.map((opt) => (
                            <View key={opt.itemId}>
                              <View className="mb-1 flex-row items-center justify-between gap-2">
                                <Text
                                  className={`flex-1 text-xs ${
                                    opt.isWinner
                                      ? 'font-bold text-ink'
                                      : 'text-zinc-600'
                                  }`}
                                >
                                  {opt.label}
                                </Text>
                                <Text className="text-[11px] font-medium text-zinc-500">
                                  {opt.voteCount} 票 ({opt.percentage}%)
                                </Text>
                              </View>
                              <View className="h-1.5 overflow-hidden rounded-full bg-zinc-200">
                                <View
                                  style={{ width: `${opt.percentage}%` }}
                                  className={`h-full rounded-full ${
                                    opt.isWinner ? 'bg-primary' : 'bg-zinc-400'
                                  }`}
                                />
                              </View>
                            </View>
                          ))}
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </View>

              {/* 2. Task Completion & Checklist */}
              <View>
                <View className="mb-2.5 flex-row items-center gap-2">
                  <CheckSquare size={16} color="#F97316" />
                  <Text className="text-sm font-extrabold text-ink">
                    分工完成度
                  </Text>
                </View>

                {recap.tasks.sections.length === 0 ? (
                  <Text className="text-xs text-zinc-400">暂无分工清单记录</Text>
                ) : (
                  <View className="gap-3">
                    <View className="rounded-2xl border border-orange-200 bg-primarySoft p-3.5">
                      <View className="mb-2 flex-row items-center justify-between">
                        <Text className="text-xs font-bold text-ink">
                          已完成 {recap.tasks.done} / {recap.tasks.total} 项
                        </Text>
                        <Text className="text-sm font-extrabold text-primary">
                          {recap.tasks.completionPercent}%
                        </Text>
                      </View>
                      <View className="h-2.5 overflow-hidden rounded-full bg-orange-100">
                        <View
                          style={{ width: `${recap.tasks.completionPercent}%` }}
                          className="h-full rounded-full bg-primary"
                        />
                      </View>
                      <Text className="mt-2 text-[11px] text-zinc-600">
                        进行中 {recap.tasks.inProgress} 项 · 待认领{' '}
                        {recap.tasks.unclaimed} 项
                      </Text>
                    </View>

                    {recap.tasks.sections.map((section) => (
                      <View
                        key={section.blockId}
                        className="rounded-2xl border border-zinc-200/80 bg-surface p-3.5"
                      >
                        <View className="mb-2 flex-row items-center justify-between">
                          <Text className="text-xs font-bold text-ink">
                            {section.title}
                          </Text>
                          <Text className="text-[11px] text-zinc-500">
                            {section.done}/{section.total}
                          </Text>
                        </View>
                        {section.items.length === 0 ? (
                          <Text className="text-[11px] text-zinc-400">
                            暂无任务条目
                          </Text>
                        ) : (
                          <View className="gap-2">
                            {section.items.map((item, idx) => (
                              <View
                                key={item.itemId}
                                className={`flex-row items-start justify-between gap-2 ${
                                  idx < section.items.length - 1
                                    ? 'border-b border-zinc-200/60 pb-2'
                                    : ''
                                }`}
                              >
                                <View className="flex-1">
                                  <Text className="text-xs font-semibold text-ink">
                                    {item.title}
                                  </Text>
                                  <Text className="mt-0.5 text-[11px] text-zinc-500">
                                    负责人：
                                    {item.assigneeNames.length > 0
                                      ? item.assigneeNames.join('、')
                                      : '未认领'}
                                    {item.dueLabel ? ` · 截止 ${item.dueLabel}` : ''}
                                  </Text>
                                </View>
                                <Badge
                                  label={item.statusLabel}
                                  variant={getTaskBadgeVariant(item.status)}
                                />
                              </View>
                            ))}
                          </View>
                        )}
                      </View>
                    ))}
                  </View>
                )}
              </View>

              {/* 3. Final Schedule Timeline */}
              <View>
                <View className="mb-2.5 flex-row items-center gap-2">
                  <CalendarClock size={16} color="#F97316" />
                  <Text className="text-sm font-extrabold text-ink">
                    最终日程轴
                  </Text>
                </View>

                {recap.schedule.sections.length === 0 ||
                recap.schedule.totalItems === 0 ? (
                  <Text className="text-xs text-zinc-400">暂无日程轴安排</Text>
                ) : (
                  <View className="gap-3">
                    {recap.schedule.sections.map((section) => (
                      <View
                        key={section.blockId}
                        className="rounded-2xl border border-zinc-200/80 bg-surface p-3.5"
                      >
                        <Text className="mb-2.5 text-xs font-bold text-ink">
                          {section.title}
                        </Text>
                        <View className="gap-3">
                          {section.groups.map((group) => (
                            <View key={group.groupLabel}>
                              <Text className="mb-1.5 text-[11px] font-bold text-primary">
                                {group.groupLabel}
                              </Text>
                              <View className="gap-2 border-l-2 border-orange-200 pl-3">
                                {group.items.map((item) => (
                                  <View key={item.itemId}>
                                    <View className="flex-row items-center gap-2">
                                      <View className="rounded-md bg-primarySoft px-2 py-0.5">
                                        <Text className="text-[11px] font-bold text-primary">
                                          {item.timeDisplay}
                                        </Text>
                                      </View>
                                      <Text className="flex-1 text-xs font-semibold text-ink">
                                        {item.title}
                                      </Text>
                                    </View>
                                    {item.locationName || item.ownerName ? (
                                      <View className="mt-1 flex-row flex-wrap items-center gap-2">
                                        {item.locationName ? (
                                          <View className="flex-row items-center gap-1">
                                            <MapPin size={10} color="#71717A" />
                                            <Text className="text-[11px] text-zinc-500">
                                              {item.locationName}
                                            </Text>
                                          </View>
                                        ) : null}
                                        {item.ownerName ? (
                                          <Text className="text-[11px] text-zinc-500">
                                            负责人：{item.ownerName}
                                          </Text>
                                        ) : null}
                                      </View>
                                    ) : null}
                                  </View>
                                ))}
                              </View>
                            </View>
                          ))}
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </View>

              {/* 4. Budget & AA Settlement */}
              <View>
                <View className="mb-2.5 flex-row items-center gap-2">
                  <Wallet size={16} color="#F97316" />
                  <Text className="text-sm font-extrabold text-ink">
                    费用与 AA 结算
                  </Text>
                </View>

                {recap.expenses.sections.length === 0 ? (
                  <Text className="text-xs text-zinc-400">
                    暂无费用与 AA 分账记录
                  </Text>
                ) : (
                  <View className="gap-3">
                    <View className="flex-row gap-2.5">
                      <View className="flex-1 rounded-2xl border border-zinc-200/80 bg-surface p-3">
                        <Text className="text-[11px] text-zinc-500">
                          累计支出
                        </Text>
                        <Text className="mt-0.5 text-lg font-extrabold text-primary">
                          {recap.expenses.formattedTotalSpent}
                        </Text>
                      </View>
                      {recap.expenses.formattedTotalBudget ? (
                        <View className="flex-1 rounded-2xl border border-zinc-200/80 bg-surface p-3">
                          <Text className="text-[11px] text-zinc-500">
                            总预算
                          </Text>
                          <Text className="mt-0.5 text-lg font-extrabold text-ink">
                            {recap.expenses.formattedTotalBudget}
                          </Text>
                        </View>
                      ) : null}
                    </View>

                    {recap.expenses.transfers.length > 0 ? (
                      <View className="rounded-2xl border border-orange-200 bg-primarySoft p-3.5">
                        <Text className="mb-2 text-xs font-bold text-amber-900">
                          AA 最小化结算方案
                        </Text>
                        <View className="gap-1.5">
                          {recap.expenses.transfers.map((transfer) => (
                            <View
                              key={`${transfer.fromUserId}-${transfer.toUserId}`}
                              className="flex-row items-center justify-between rounded-xl bg-white px-3 py-2"
                            >
                              <View className="flex-row items-center gap-1.5">
                                <Text className="text-xs font-bold text-ink">
                                  {transfer.fromName}
                                </Text>
                                <ArrowRight size={12} color="#F97316" />
                                <Text className="text-xs font-bold text-ink">
                                  {transfer.toName}
                                </Text>
                              </View>
                              <Text className="text-xs font-extrabold text-primary">
                                {transfer.formattedAmount}
                              </Text>
                            </View>
                          ))}
                        </View>
                      </View>
                    ) : null}

                    {recap.expenses.sections.map((section) => (
                      <View
                        key={section.blockId}
                        className="rounded-2xl border border-zinc-200/80 bg-surface p-3.5"
                      >
                        <View className="mb-2 flex-row items-center justify-between">
                          <Text className="text-xs font-bold text-ink">
                            {section.title}
                          </Text>
                          <Text className="text-[11px] font-semibold text-zinc-500">
                            已支 {section.formattedTotalSpent}
                          </Text>
                        </View>
                        {section.items.length === 0 ? (
                          <Text className="text-[11px] text-zinc-400">
                            暂无账单记录
                          </Text>
                        ) : (
                          <View className="gap-1.5">
                            {section.items.map((item, idx) => (
                              <View
                                key={item.itemId}
                                className={`flex-row items-center justify-between gap-2 ${
                                  idx < section.items.length - 1
                                    ? 'border-b border-zinc-200/60 pb-1.5'
                                    : ''
                                }`}
                              >
                                <View className="flex-1">
                                  <Text className="text-xs font-semibold text-ink">
                                    {item.title}
                                  </Text>
                                  <Text className="text-[11px] text-zinc-500">
                                    {item.paidByName} 付款 ·{' '}
                                    {item.participantNames.length} 人分摊
                                  </Text>
                                </View>
                                <Text className="text-xs font-bold text-ink">
                                  {item.formattedAmount}
                                </Text>
                              </View>
                            ))}
                          </View>
                        )}
                      </View>
                    ))}
                  </View>
                )}
              </View>
            </View>

            {/* Recap Footer */}
            <View className="flex-row items-center justify-between border-t border-zinc-100 bg-zinc-50 px-5 py-3">
              <Text className="text-[10px] font-semibold text-zinc-400">
                轻橘 PopRoom · 让每次活动清晰落地
              </Text>
              <Text className="text-[10px] text-zinc-400">
                {recap.generatedAtLabel}
              </Text>
            </View>
          </View>
        </ViewShot>

        {permissions.isArchived ? (
          <View className="mt-3 flex-row items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-3.5 py-2.5">
            <Archive size={15} color="#B45309" />
            <Text className="flex-1 text-[11px] text-amber-800">
              当前房间已归档为只读状态，仍可随时导出复盘长图与 A4 PDF。
            </Text>
          </View>
        ) : null}
      </ScrollView>

      {/* Bottom Action Bar */}
      <View className="border-t border-zinc-200/70 bg-white px-4 py-3">
        <View className="flex-row gap-2.5">
          <View className="flex-1">
            <Button
              title="导出高清长图"
              variant="secondary"
              size="md"
              fullWidth
              loading={exportingType === 'png'}
              disabled={exportingType !== null}
              leftIcon={<ImageIcon size={16} color="#F97316" />}
              onPress={handleExportPng}
            />
          </View>
          <View className="flex-1">
            <Button
              title="导出 PDF"
              variant="primary"
              size="md"
              fullWidth
              loading={exportingType === 'pdf'}
              disabled={exportingType !== null}
              leftIcon={<FileText size={16} color="#FFFFFF" />}
              onPress={handleExportPdf}
            />
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}
