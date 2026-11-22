import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import {
  AlertTriangle,
  Archive,
  BarChart3,
  Calendar,
  CalendarClock,
  CheckSquare,
  ChevronLeft,
  Copy,
  LayoutGrid,
  Megaphone,
  Plus,
  Settings,
  Share2,
  Users,
  Wallet,
} from 'lucide-react-native';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  BLOCK_TYPE_LABELS,
  type CreateBlockInput,
  MAX_BLOCK_TITLE_LENGTH,
  type ParsedBlock,
  VALID_BLOCK_TYPES,
  createBlock,
  deleteBlock,
  fetchRoomBlocksWithItems,
  fetchRoomPollTallies,
} from '../../../src/api/blocks';
import {
  ROLE_LABELS,
  RoomApiError,
  fetchRoomDetail,
  fetchRoomMembers,
  formatRoomEventWindow,
  mapRoomError,
} from '../../../src/api/rooms';
import { Avatar } from '../../../src/components/ui/Avatar';
import { Badge } from '../../../src/components/ui/Badge';
import { Button } from '../../../src/components/ui/Button';
import { Card } from '../../../src/components/ui/Card';
import { OfflineSyncBanner } from '../../../src/components/ui/OfflineSyncBanner';
import { SheetModal } from '../../../src/components/ui/SheetModal';
import { ExpenseBlock } from '../../../src/components/blocks/ExpenseBlock';
import { PollBlock } from '../../../src/components/blocks/PollBlock';
import { ScheduleBlock } from '../../../src/components/blocks/ScheduleBlock';
import { TaskBlock } from '../../../src/components/blocks/TaskBlock';
import { useRoomPermissions } from '../../../src/hooks/useRoomPermissions';
import { useRoomRealtime } from '../../../src/hooks/useRoomRealtime';
import { QUERY_KEYS } from '../../../src/lib/queryClient';
import { buildShareMessage } from '../../../src/lib/roomCode';
import { resolveRoomScreenState } from '../../../src/lib/roomScreenState';
import { ROOM_TEMPLATES } from '../../../src/lib/templates';
import type { PollTally } from '../../../src/schemas/blocks';
import { useAuthStore } from '../../../src/stores/authStore';
import { useUiStore } from '../../../src/stores/uiStore';
import type { BlockType } from '../../../src/types/database';

const DEFAULT_BLOCK_TITLES: Record<BlockType, string> = {
  poll: '方案与时间投票',
  task: '分工与物资认领',
  schedule: '活动日程轴',
  expense: '费用 AA / 预算',
};

const BLOCK_TYPE_DESCRIPTIONS: Record<BlockType, string> = {
  poll: '支持方案投票与空闲时间热力图',
  task: '支持公开认领、进度流转与实拍图',
  schedule: '按天或按阶段展示并支持地图导航',
  expense: '支持 AA 最小转账分账与社团预算',
};

function readRoomIdParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? '';
  }
  return value ?? '';
}

function BlockTypeIcon({
  type,
  color = '#F97316',
  size = 18,
}: {
  type: BlockType;
  color?: string;
  size?: number;
}) {
  switch (type) {
    case 'poll':
      return <BarChart3 size={size} color={color} />;
    case 'task':
      return <CheckSquare size={size} color={color} />;
    case 'schedule':
      return <CalendarClock size={size} color={color} />;
    case 'expense':
      return <Wallet size={size} color={color} />;
  }
}

/** Room Collaboration Board Shell with realtime sync, read-only archive guard, and gated block builder. */
export default function RoomBoardScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const roomId = readRoomIdParam(params.id);

  const session = useAuthStore((s) => s.session);
  const showToast = useUiStore((s) => s.showToast);
  const currentUserId = session?.user.id ?? null;

  useRoomRealtime(roomId, currentUserId);

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
    data: pollTallies = [],
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

  const talliesByBlockId = useMemo(() => {
    const grouped = new Map<string, PollTally[]>();
    for (const tally of pollTallies) {
      const list = grouped.get(tally.block_id);
      if (list) {
        list.push(tally);
      } else {
        grouped.set(tally.block_id, [tally]);
      }
    }
    return grouped;
  }, [pollTallies]);

  const allowedBlockTypes = useMemo<BlockType[]>(() => {
    if (permissions.canManageBlocks) {
      return [...VALID_BLOCK_TYPES];
    }
    if (permissions.canCreatePollBlock) {
      return ['poll'];
    }
    return [];
  }, [permissions.canCreatePollBlock, permissions.canManageBlocks]);

  const canOpenAddBlockSheet = allowedBlockTypes.length > 0;

  const [addSheetVisible, setAddSheetVisible] = useState(false);
  const [selectedType, setSelectedType] = useState<BlockType>('poll');
  const [blockTitleInput, setBlockTitleInput] = useState(
    DEFAULT_BLOCK_TITLES.poll,
  );
  const [titleManuallyEdited, setTitleManuallyEdited] = useState(false);
  const [pollMode, setPollMode] = useState<'option' | 'availability'>('option');
  const [pollMultiple, setPollMultiple] = useState(false);
  const [pollAnonymous, setPollAnonymous] = useState(false);
  const [taskAllowMemberCreate, setTaskAllowMemberCreate] = useState(true);
  const [scheduleGroupBy, setScheduleGroupBy] = useState<'day' | 'phase'>(
    'day',
  );
  const [expenseMode, setExpenseMode] = useState<'split' | 'budget'>('split');
  const [expenseBudgetInput, setExpenseBudgetInput] = useState('');
  const [addBlockError, setAddBlockError] = useState<string | null>(null);
  const [creatingBlock, setCreatingBlock] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<ParsedBlock | null>(null);
  const [deletingBlock, setDeletingBlock] = useState(false);

  useEffect(() => {
    if (!canOpenAddBlockSheet && addSheetVisible) {
      setAddSheetVisible(false);
    }
  }, [addSheetVisible, canOpenAddBlockSheet]);

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
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

  const handleCopyRoomCode = async () => {
    if (!room) {
      return;
    }
    try {
      const inviteUrl = Linking.createURL('room/join', {
        queryParams: { code: room.room_code },
      });
      const shareText = buildShareMessage(room.title, room.room_code, inviteUrl);
      await Clipboard.setStringAsync(shareText);
      showToast('已复制房间口令与邀请链接', 'success');
    } catch {
      showToast('复制失败，请前往房间设置复制', 'error');
    }
  };

  const handleOpenAddSheet = () => {
    const firstAllowed = allowedBlockTypes[0] ?? 'poll';
    setSelectedType(firstAllowed);
    setBlockTitleInput(DEFAULT_BLOCK_TITLES[firstAllowed]);
    setTitleManuallyEdited(false);
    setPollMode('option');
    setPollMultiple(false);
    setPollAnonymous(false);
    setTaskAllowMemberCreate(true);
    setScheduleGroupBy('day');
    setExpenseMode('split');
    setExpenseBudgetInput('');
    setAddBlockError(null);
    setAddSheetVisible(true);
  };

  const handleSelectBlockType = (nextType: BlockType) => {
    setSelectedType(nextType);
    if (!titleManuallyEdited) {
      setBlockTitleInput(DEFAULT_BLOCK_TITLES[nextType]);
    }
    if (addBlockError) {
      setAddBlockError(null);
    }
  };

  const buildCreateBlockPayload = (): CreateBlockInput => {
    const trimmedTitle = blockTitleInput.trim();
    const base = {
      roomId,
      title: trimmedTitle,
      sortOrder: blocks.length,
      createdBy: currentUserId,
    };

    switch (selectedType) {
      case 'poll':
        return {
          ...base,
          type: 'poll',
          config:
            pollMode === 'availability'
              ? {
                  mode: 'availability',
                  multiple: true,
                  anonymous: pollAnonymous,
                  allowAddOption: true,
                  deadline: null,
                  isLocked: false,
                  candidateDates: [],
                  timeSlots: ['morning', 'afternoon', 'evening'],
                }
              : {
                  mode: 'option',
                  multiple: pollMultiple,
                  anonymous: pollAnonymous,
                  allowAddOption: true,
                  deadline: null,
                  isLocked: false,
                },
        };

      case 'task':
        return {
          ...base,
          type: 'task',
          config: {
            allowMemberCreate: taskAllowMemberCreate,
          },
        };

      case 'schedule':
        return {
          ...base,
          type: 'schedule',
          config: {
            groupBy: scheduleGroupBy,
          },
        };

      case 'expense': {
        const parsedBudget = expenseBudgetInput.trim()
          ? Number(expenseBudgetInput.trim())
          : null;
        if (
          expenseMode === 'budget' &&
          parsedBudget !== null &&
          (!Number.isFinite(parsedBudget) || parsedBudget < 0)
        ) {
          throw new RoomApiError('INVALID_INPUT', '请输入有效的非负预算金额');
        }
        return {
          ...base,
          type: 'expense',
          config: {
            mode: expenseMode,
            totalBudget: expenseMode === 'budget' ? parsedBudget : null,
            currency: 'CNY',
          },
        };
      }
    }
  };

  const handleCreateBlock = async () => {
    if (!room || !canOpenAddBlockSheet) {
      return;
    }
    setAddBlockError(null);
    setCreatingBlock(true);

    try {
      const payload = buildCreateBlockPayload();
      await createBlock(payload);
      setAddSheetVisible(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.roomBlocks(roomId) }),
        queryClient.invalidateQueries({
          queryKey: QUERY_KEYS.roomPollTallies(roomId),
        }),
      ]);
      showToast('已添加新积木', 'success');
    } catch (err) {
      setAddBlockError(mapRoomError(err));
    } finally {
      setCreatingBlock(false);
    }
  };

  const handleConfirmDeleteBlock = async () => {
    if (!deleteTarget || !permissions.canManageBlocks) {
      return;
    }
    setDeletingBlock(true);
    try {
      await deleteBlock(deleteTarget.id);
      setDeleteTarget(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.roomBlocks(roomId) }),
        queryClient.invalidateQueries({
          queryKey: QUERY_KEYS.roomPollTallies(roomId),
        }),
      ]);
      showToast('已移除该积木模块', 'success');
    } catch (err) {
      showToast(mapRoomError(err), 'error');
    } finally {
      setDeletingBlock(false);
    }
  };

  const screenState = resolveRoomScreenState({
    mode: 'board',
    room,
    roomLoading,
    roomError,
    members,
    membersLoading,
    membersError,
    myRawMembership,
    canAccess: true,
    blocksCount: blocks.length,
    blocksLoading,
    blocksError,
    hasPollTallies: true,
    talliesLoading: false,
    talliesError,
  });

  if (screenState.kind === 'loading') {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-surface">
        <ActivityIndicator size="large" color="#F97316" />
        <Text className="mt-3 text-xs text-zinc-500">正在加载协作看板...</Text>
      </SafeAreaView>
    );
  }

  if (screenState.kind === 'full_error' || !room) {
    const errorTitle =
      screenState.kind === 'full_error'
        ? screenState.title
        : '无法进入该协作房间';
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
              title="返回活动大厅"
              variant="primary"
              fullWidth
              onPress={() => router.replace('/(tabs)')}
            />
          </View>
        </Card>
      </SafeAreaView>
    );
  }

  const templateMeta = ROOM_TEMPLATES[room.template_type];
  const eventWindow = formatRoomEventWindow(
    room.event_start_at,
    room.event_end_at,
  );
  const isRefreshing =
    roomRefetching || membersRefetching || blocksRefetching || talliesRefetching;

  return (
    <SafeAreaView className="flex-1 bg-surface" edges={['top', 'bottom']}>
      <View className="flex-row items-center justify-between border-b border-zinc-200/70 bg-white px-4 py-3">
        <View className="flex-1 flex-row items-center gap-2.5 pr-2">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="返回活动大厅"
            onPress={handleBack}
            className="h-9 w-9 items-center justify-center rounded-full bg-zinc-100 active:bg-zinc-200"
          >
            <ChevronLeft size={20} color="#18181B" />
          </Pressable>

          <View className="flex-1">
            <Text className="text-base font-bold text-ink" numberOfLines={1}>
              {room.title}
            </Text>
            <View className="mt-0.5 flex-row items-center gap-1.5">
              <Text className="text-[11px] text-zinc-500" numberOfLines={1}>
                {templateMeta.name} · {activeMembers.length} 人
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`复制房间码 ${room.room_code}`}
                onPress={handleCopyRoomCode}
                className="flex-row items-center gap-1 rounded-full bg-primarySoft px-2 py-0.5 active:opacity-80"
              >
                <Text className="text-[11px] font-bold tracking-wider text-primary">
                  {room.room_code}
                </Text>
                <Copy size={10} color="#F97316" />
              </Pressable>
            </View>
          </View>
        </View>

        <View className="flex-row items-center gap-2">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="导出复盘"
            onPress={() => router.push(`/room/${room.id}/export` as Href)}
            className="h-9 w-9 items-center justify-center rounded-full bg-zinc-100 active:bg-zinc-200"
          >
            <Share2 size={17} color="#18181B" />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="房间设置"
            onPress={() => router.push(`/room/${room.id}/settings` as Href)}
            className="h-9 w-9 items-center justify-center rounded-full bg-zinc-100 active:bg-zinc-200"
          >
            <Settings size={17} color="#18181B" />
          </Pressable>
        </View>
      </View>

      <ScrollView
        className="flex-1 px-4 pt-4"
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing && !blocksLoading}
            onRefresh={handleRefreshAll}
            tintColor="#F97316"
            colors={['#F97316']}
          />
        }
      >
        {screenState.kind === 'ready' && screenState.syncWarning ? (
          <OfflineSyncBanner
            message={screenState.syncWarning}
            onRetry={handleRefreshAll}
            retrying={isRefreshing}
          />
        ) : null}

        {permissions.isArchived ? (
          <View className="mb-4 flex-row items-center gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
            <Archive size={18} color="#B45309" />
            <View className="flex-1">
              <Text className="text-xs font-bold text-amber-900">
                活动已归档 · 全员只读模式
              </Text>
              <Text className="mt-0.5 text-xs text-amber-700">
                归档后仅支持浏览记录与导出复盘长图 / PDF，不可再修改积木或条目
              </Text>
            </View>
          </View>
        ) : null}

        <Card className="mb-4">
          <View className="mb-2 flex-row items-center justify-between gap-2">
            <View className="flex-row items-center gap-1.5">
              <Megaphone size={15} color="#F97316" />
              <Text className="text-xs font-bold text-ink">房间公告</Text>
            </View>
            <View className="flex-row items-center gap-1.5">
              {myMembership ? (
                <Badge
                  label={ROLE_LABELS[myMembership.role]}
                  variant={
                    myMembership.role === 'host'
                      ? 'primary'
                      : myMembership.role === 'admin'
                        ? 'warning'
                        : 'neutral'
                  }
                />
              ) : null}
              {eventWindow ? (
                <View className="flex-row items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5">
                  <Calendar size={11} color="#71717A" />
                  <Text className="text-[11px] font-medium text-zinc-600">
                    {eventWindow}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>

          <Text
            className={`text-sm leading-5 ${
              room.announcement ? 'text-zinc-700' : 'text-zinc-400'
            }`}
          >
            {room.announcement ||
              '暂无公告，房主或管理员可在右上角设置中发布集合通知与活动规则'}
          </Text>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="查看房间成员"
            onPress={() => router.push(`/room/${room.id}/settings` as Href)}
            className="mt-3 flex-row items-center justify-between border-t border-zinc-100 pt-2.5 active:opacity-80"
          >
            <View className="flex-row items-center">
              {activeMembers.slice(0, 6).map((member, index) => (
                <View
                  key={member.id}
                  style={{ marginLeft: index === 0 ? 0 : -6 }}
                  className="rounded-full border border-white"
                >
                  <Avatar
                    nickname={member.profiles?.nickname}
                    color={member.profiles?.avatar_color}
                    imageUrl={member.profiles?.avatar_url}
                    size="xs"
                  />
                </View>
              ))}
              {activeMembers.length > 6 ? (
                <View className="ml-1.5 rounded-full bg-zinc-100 px-1.5 py-0.5">
                  <Text className="text-[10px] font-semibold text-zinc-600">
                    +{activeMembers.length - 6}
                  </Text>
                </View>
              ) : null}
            </View>
            <View className="flex-row items-center gap-1">
              <Users size={13} color="#71717A" />
              <Text className="text-xs font-medium text-zinc-500">
                {activeMembers.length} 人协作中
              </Text>
            </View>
          </Pressable>
        </Card>

        {blocksLoading && blocks.length === 0 ? (
          <View className="items-center py-12">
            <ActivityIndicator size="large" color="#F97316" />
            <Text className="mt-3 text-xs text-zinc-500">正在同步协作积木...</Text>
          </View>
        ) : blocks.length === 0 ? (
          <Card className="items-center py-10">
            <View className="mb-3 h-12 w-12 items-center justify-center rounded-2xl bg-primarySoft">
              <LayoutGrid size={24} color="#F97316" />
            </View>
            <Text className="text-base font-bold text-ink">
              房间还没有协作积木
            </Text>
            <Text className="mt-1.5 px-6 text-center text-xs leading-5 text-zinc-500">
              {canOpenAddBlockSheet
                ? '点击下方「添加积木」，自由拼装投票、分工、日程轴或 AA 分账模块'
                : permissions.isArchived
                  ? '该活动已归档，当前处于只读复盘模式'
                  : '等待房主或管理员添加协作积木'}
            </Text>
          </Card>
        ) : (
          blocks.map((block) => {
            switch (block.type) {
              case 'poll':
                return (
                  <PollBlock
                    key={block.id}
                    block={block}
                    items={block.items}
                    tallies={talliesByBlockId.get(block.id) ?? []}
                    members={activeMembers}
                    permissions={permissions}
                    onRequestDeleteBlock={
                      permissions.canManageBlocks ? setDeleteTarget : undefined
                    }
                  />
                );
              case 'task':
                return (
                  <TaskBlock
                    key={block.id}
                    block={block}
                    items={block.items}
                    members={activeMembers}
                    permissions={permissions}
                    onRequestDeleteBlock={
                      permissions.canManageBlocks ? setDeleteTarget : undefined
                    }
                  />
                );
              case 'schedule':
                return (
                  <ScheduleBlock
                    key={block.id}
                    block={block}
                    items={block.items}
                    members={activeMembers}
                    permissions={permissions}
                    onRequestDeleteBlock={
                      permissions.canManageBlocks ? setDeleteTarget : undefined
                    }
                  />
                );
              case 'expense':
                return (
                  <ExpenseBlock
                    key={block.id}
                    block={block}
                    items={block.items}
                    members={activeMembers}
                    permissions={permissions}
                    onRequestDeleteBlock={
                      permissions.canManageBlocks ? setDeleteTarget : undefined
                    }
                  />
                );
            }
          })
        )}
      </ScrollView>

      {canOpenAddBlockSheet ? (
        <View className="border-t border-zinc-200/70 bg-white px-4 pb-3 pt-2.5">
          <Button
            title={permissions.canManageBlocks ? '添加积木' : '发起新投票'}
            variant="primary"
            size="lg"
            fullWidth
            leftIcon={<Plus size={18} color="#FFFFFF" />}
            onPress={handleOpenAddSheet}
          />
        </View>
      ) : null}

      <SheetModal
        visible={addSheetVisible}
        onClose={() => setAddSheetVisible(false)}
        title="添加积木"
      >
        {!permissions.canManageBlocks && permissions.canCreatePollBlock ? (
          <View className="mb-3 rounded-xl bg-primarySoft px-3.5 py-2.5">
            <Text className="text-xs font-medium text-primary">
              房主已允许成员发起投票，你可以为当前房间新建一个投票积木
            </Text>
          </View>
        ) : null}

        <Text className="mb-2 text-xs font-semibold text-zinc-600">
          选择积木类型
        </Text>
        <View className="mb-4 gap-2">
          {allowedBlockTypes.map((type) => {
            const selected = selectedType === type;
            return (
              <Pressable
                key={type}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                onPress={() => handleSelectBlockType(type)}
                className={`flex-row items-center gap-3 rounded-2xl border px-3.5 py-3 ${
                  selected
                    ? 'border-primary bg-primarySoft'
                    : 'border-zinc-200 bg-surface'
                }`}
              >
                <View
                  className={`h-9 w-9 items-center justify-center rounded-xl ${
                    selected ? 'bg-white' : 'bg-zinc-100'
                  }`}
                >
                  <BlockTypeIcon
                    type={type}
                    color={selected ? '#F97316' : '#52525B'}
                  />
                </View>
                <View className="flex-1">
                  <Text
                    className={`text-sm font-bold ${
                      selected ? 'text-primary' : 'text-ink'
                    }`}
                  >
                    {BLOCK_TYPE_LABELS[type]}
                  </Text>
                  <Text className="mt-0.5 text-[11px] text-zinc-500">
                    {BLOCK_TYPE_DESCRIPTIONS[type]}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        <View className="mb-4">
          <View className="mb-1.5 flex-row items-center justify-between">
            <Text className="text-xs font-semibold text-zinc-600">
              积木标题
            </Text>
            <Text className="text-xs text-zinc-400">
              {Array.from(blockTitleInput.trim()).length}/{MAX_BLOCK_TITLE_LENGTH}
            </Text>
          </View>
          <BottomSheetTextInput
            value={blockTitleInput}
            onChangeText={(text) => {
              setBlockTitleInput(text);
              setTitleManuallyEdited(true);
              if (addBlockError) {
                setAddBlockError(null);
              }
            }}
            maxLength={MAX_BLOCK_TITLE_LENGTH}
            placeholder={DEFAULT_BLOCK_TITLES[selectedType]}
            placeholderTextColor="#A1A1AA"
            className="rounded-2xl border border-zinc-200 bg-surface px-4 py-3 text-sm text-ink"
          />
        </View>

        {selectedType === 'poll' ? (
          <View className="mb-4 gap-3">
            <View>
              <Text className="mb-2 text-xs font-semibold text-zinc-600">
                投票模式
              </Text>
              <View className="flex-row gap-2.5">
                {(
                  [
                    { key: 'option', label: '方案投票' },
                    { key: 'availability', label: '时间热力图' },
                  ] as const
                ).map((modeOption) => {
                  const selected = pollMode === modeOption.key;
                  return (
                    <Pressable
                      key={modeOption.key}
                      onPress={() => setPollMode(modeOption.key)}
                      className={`flex-1 items-center rounded-xl border py-2.5 ${
                        selected
                          ? 'border-primary bg-primarySoft'
                          : 'border-zinc-200 bg-surface'
                      }`}
                    >
                      <Text
                        className={`text-xs font-semibold ${
                          selected ? 'text-primary' : 'text-zinc-600'
                        }`}
                      >
                        {modeOption.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {pollMode === 'option' ? (
              <View className="flex-row items-center justify-between rounded-2xl bg-surface px-3.5 py-2.5">
                <Text className="text-xs font-semibold text-ink">允许多选</Text>
                <Switch
                  value={pollMultiple}
                  onValueChange={setPollMultiple}
                  trackColor={{ false: '#D4D4D8', true: '#FDBA74' }}
                  thumbColor={pollMultiple ? '#F97316' : '#F4F4F5'}
                />
              </View>
            ) : null}

            <View className="flex-row items-center justify-between rounded-2xl bg-surface px-3.5 py-2.5">
              <Text className="text-xs font-semibold text-ink">
                匿名投票（隐藏投票人头像）
              </Text>
              <Switch
                value={pollAnonymous}
                onValueChange={setPollAnonymous}
                trackColor={{ false: '#D4D4D8', true: '#FDBA74' }}
                thumbColor={pollAnonymous ? '#F97316' : '#F4F4F5'}
              />
            </View>
          </View>
        ) : null}

        {selectedType === 'task' ? (
          <View className="mb-4 flex-row items-center justify-between rounded-2xl bg-surface px-3.5 py-2.5">
            <View className="flex-1 pr-3">
              <Text className="text-xs font-semibold text-ink">
                允许普通成员新增任务
              </Text>
              <Text className="mt-0.5 text-[11px] text-zinc-500">
                关闭后仅房主与管理员可发布任务条目
              </Text>
            </View>
            <Switch
              value={taskAllowMemberCreate}
              onValueChange={setTaskAllowMemberCreate}
              trackColor={{ false: '#D4D4D8', true: '#FDBA74' }}
              thumbColor={taskAllowMemberCreate ? '#F97316' : '#F4F4F5'}
            />
          </View>
        ) : null}

        {selectedType === 'schedule' ? (
          <View className="mb-4">
            <Text className="mb-2 text-xs font-semibold text-zinc-600">
              日程分组方式
            </Text>
            <View className="flex-row gap-2.5">
              {(
                [
                  { key: 'day', label: '按天数分组' },
                  { key: 'phase', label: '按阶段分组' },
                ] as const
              ).map((groupOpt) => {
                const selected = scheduleGroupBy === groupOpt.key;
                return (
                  <Pressable
                    key={groupOpt.key}
                    onPress={() => setScheduleGroupBy(groupOpt.key)}
                    className={`flex-1 items-center rounded-xl border py-2.5 ${
                      selected
                        ? 'border-primary bg-primarySoft'
                        : 'border-zinc-200 bg-surface'
                    }`}
                  >
                    <Text
                      className={`text-xs font-semibold ${
                        selected ? 'text-primary' : 'text-zinc-600'
                      }`}
                    >
                      {groupOpt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}

        {selectedType === 'expense' ? (
          <View className="mb-4 gap-3">
            <View>
              <Text className="mb-2 text-xs font-semibold text-zinc-600">
                费用管理模式
              </Text>
              <View className="flex-row gap-2.5">
                {(
                  [
                    { key: 'split', label: 'AA 最小转账分账' },
                    { key: 'budget', label: '社团预算报销' },
                  ] as const
                ).map((expOpt) => {
                  const selected = expenseMode === expOpt.key;
                  return (
                    <Pressable
                      key={expOpt.key}
                      onPress={() => setExpenseMode(expOpt.key)}
                      className={`flex-1 items-center rounded-xl border py-2.5 ${
                        selected
                          ? 'border-primary bg-primarySoft'
                          : 'border-zinc-200 bg-surface'
                      }`}
                    >
                      <Text
                        className={`text-xs font-semibold ${
                          selected ? 'text-primary' : 'text-zinc-600'
                        }`}
                      >
                        {expOpt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {expenseMode === 'budget' ? (
              <View>
                <Text className="mb-1.5 text-xs font-semibold text-zinc-600">
                  活动总预算（元，选填）
                </Text>
                <BottomSheetTextInput
                  value={expenseBudgetInput}
                  onChangeText={(text) => {
                    setExpenseBudgetInput(text);
                    if (addBlockError) {
                      setAddBlockError(null);
                    }
                  }}
                  keyboardType="decimal-pad"
                  placeholder="例如：1500"
                  placeholderTextColor="#A1A1AA"
                  className="rounded-2xl border border-zinc-200 bg-surface px-4 py-3 text-sm text-ink"
                />
              </View>
            ) : null}
          </View>
        ) : null}

        {addBlockError ? (
          <View className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5">
            <Text className="text-xs font-medium text-red-700">
              {addBlockError}
            </Text>
          </View>
        ) : null}

        <Button
          title="确认添加积木"
          variant="primary"
          size="lg"
          fullWidth
          loading={creatingBlock}
          onPress={handleCreateBlock}
        />
      </SheetModal>

      <SheetModal
        visible={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="确认移除积木模块？"
      >
        <Text className="mb-5 text-sm leading-6 text-zinc-600">
          确定删除「{deleteTarget?.title ?? ''}
          」吗？删除后该积木下的所有条目也将一并移除。
        </Text>
        <View className="gap-2.5">
          <Button
            title="确认移除"
            variant="danger"
            fullWidth
            loading={deletingBlock}
            onPress={handleConfirmDeleteBlock}
          />
          <Button
            title="取消"
            variant="ghost"
            fullWidth
            onPress={() => setDeleteTarget(null)}
          />
        </View>
      </SheetModal>
    </SafeAreaView>
  );
}
