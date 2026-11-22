import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  BarChart3,
  CalendarDays,
  Check,
  EyeOff,
  Flame,
  Lock,
  Plus,
  Trash2,
  Unlock,
} from 'lucide-react-native';
import React, { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import {
  type ParsedBlock,
  type ParsedBlockItem,
  createBlockItem,
  softDeleteBlockItem,
  togglePollVote,
  updateBlockConfig,
} from '../../api/blocks';
import { RoomApiError, mapRoomError } from '../../api/rooms';
import type { RoomPermissions } from '../../hooks/useRoomPermissions';
import {
  DEFAULT_POLL_TIME_SLOTS,
  POLL_TIME_SLOT_LABELS,
  applyOptimisticPollToggle,
  buildAvailabilityMatrix,
  collectAvailabilityDates,
  formatAvailabilityDateLabel,
  formatPollPercentage,
  getHeatmapTier,
  getUpcomingDateStrings,
  isPollExpired,
  isValidCalendarDate,
  sanitizePollTallyForDisplay,
} from '../../lib/pollHelpers';
import { QUERY_KEYS } from '../../lib/queryClient';
import type { PollTally, PollTimeSlot } from '../../schemas/blocks';
import { useAuthStore } from '../../stores/authStore';
import { useUiStore } from '../../stores/uiStore';
import type { ProfileSummary, RoomMemberWithProfile } from '../../types/database';
import { Avatar } from '../ui/Avatar';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { SheetModal } from '../ui/SheetModal';

const MAX_OPTION_LABEL_LENGTH = 60;

const HEATMAP_CELL_CLASSES: Record<0 | 1 | 2 | 3 | 4, string> = {
  0: 'bg-zinc-50 border-zinc-200',
  1: 'bg-orange-50 border-orange-200',
  2: 'bg-orange-100 border-orange-300',
  3: 'bg-orange-300 border-orange-400',
  4: 'bg-primary border-primary',
};

const HEATMAP_TEXT_CLASSES: Record<0 | 1 | 2 | 3 | 4, string> = {
  0: 'text-zinc-500',
  1: 'text-orange-700',
  2: 'text-orange-800',
  3: 'text-orange-950',
  4: 'text-white',
};

/** Props for the Smart Poll collaborative block (`option` voting & `availability` heatmap). */
export interface PollBlockProps {
  block: ParsedBlock<'poll'>;
  items: ParsedBlockItem<'poll'>[];
  tallies: PollTally[];
  members: RoomMemberWithProfile[];
  permissions: RoomPermissions;
  onRequestDeleteBlock?: (block: ParsedBlock<'poll'>) => void;
}

interface VoteMutationContext {
  previousTallies: PollTally[] | undefined;
}

function formatDeadlineHint(deadline: string | null): string | null {
  if (!deadline) {
    return null;
  }
  const ms = Date.parse(deadline);
  if (Number.isNaN(ms)) {
    return null;
  }
  const d = new Date(ms);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${mm}/${dd} ${hh}:${min} 截止`;
}

/**
 * Interactive Smart Poll Block supporting single/multi-choice option voting,
 * availability heatmaps (`date × morning/afternoon/evening`), anonymous masking,
 * optimistic voting with rollback, and host/admin lock & soft-delete controls.
 */
export function PollBlock({
  block,
  items,
  tallies,
  members,
  permissions,
  onRequestDeleteBlock,
}: PollBlockProps) {
  const queryClient = useQueryClient();
  const currentUserId = useAuthStore((s) => s.session?.user.id ?? '');
  const showToast = useUiStore((s) => s.showToast);

  const isAnonymous = block.config.anonymous;
  const isLocked = block.config.isLocked;
  const isExpired = isPollExpired(block.config.deadline);
  const votingDisabled =
    permissions.isReadOnly || !permissions.canVote || isLocked || isExpired;
  const canAddOption =
    !permissions.isReadOnly &&
    (permissions.isAdminOrHost ||
      (block.config.allowAddOption && !isLocked && !isExpired));

  const [addOptionVisible, setAddOptionVisible] = useState(false);
  const [optionLabelInput, setOptionLabelInput] = useState('');
  const [optionError, setOptionError] = useState<string | null>(null);

  const [addAvailabilityVisible, setAddAvailabilityVisible] = useState(false);
  const [dateInput, setDateInput] = useState('');
  const [selectedSlots, setSelectedSlots] = useState<PollTimeSlot[]>([
    ...DEFAULT_POLL_TIME_SLOTS,
  ]);
  const [availabilityError, setAvailabilityError] = useState<string | null>(
    null,
  );

  const [manageSlotsVisible, setManageSlotsVisible] = useState(false);
  const [deleteItemTarget, setDeleteItemTarget] =
    useState<ParsedBlockItem<'poll'> | null>(null);

  const memberProfileMap = useMemo(() => {
    const map = new Map<string, ProfileSummary>();
    for (const member of members) {
      if (member.profiles) {
        map.set(member.user_id, member.profiles);
      }
    }
    return map;
  }, [members]);

  // Review Focus #3: Always strip voter_ids when anonymous === true before rendering.
  const sanitizedTallyMap = useMemo(() => {
    const map = new Map<string, PollTally>();
    for (const tally of tallies) {
      map.set(tally.item_id, sanitizePollTallyForDisplay(tally, isAnonymous));
    }
    return map;
  }, [tallies, isAnonymous]);

  const totalVotes = useMemo(() => {
    let sum = 0;
    for (const item of items) {
      sum += sanitizedTallyMap.get(item.id)?.vote_count ?? 0;
    }
    return sum;
  }, [items, sanitizedTallyMap]);

  const activeSlots = useMemo<PollTimeSlot[]>(() => {
    const configured = block.config.timeSlots;
    if (configured && configured.length > 0) {
      return [...configured];
    }
    return [...DEFAULT_POLL_TIME_SLOTS];
  }, [block.config.timeSlots]);

  const availabilityDates = useMemo(
    () => collectAvailabilityDates(block.config.candidateDates, items),
    [block.config.candidateDates, items],
  );

  const availabilityMatrix = useMemo(
    () =>
      buildAvailabilityMatrix(
        availabilityDates,
        activeSlots,
        items,
        sanitizedTallyMap,
        members.length,
      ),
    [availabilityDates, activeSlots, items, sanitizedTallyMap, members.length],
  );

  const upcomingQuickDates = useMemo(() => getUpcomingDateStrings(4), []);

  const voteMutation = useMutation<
    PollTally[],
    unknown,
    string,
    VoteMutationContext
  >({
    mutationFn: (itemId) => togglePollVote(itemId),
    onMutate: async (itemId) => {
      const queryKey = QUERY_KEYS.roomPollTallies(block.room_id);
      await queryClient.cancelQueries({ queryKey });
      const previousTallies = queryClient.getQueryData<PollTally[]>(queryKey);

      queryClient.setQueryData<PollTally[]>(queryKey, (old = []) =>
        applyOptimisticPollToggle(
          old,
          itemId,
          block.id,
          block.config.multiple,
          currentUserId,
          isAnonymous,
        ),
      );

      return { previousTallies };
    },
    onError: (err, _itemId, context) => {
      const queryKey = QUERY_KEYS.roomPollTallies(block.room_id);
      if (context?.previousTallies !== undefined) {
        queryClient.setQueryData(queryKey, context.previousTallies);
      } else {
        void queryClient.invalidateQueries({ queryKey });
      }
      showToast(mapRoomError(err), 'error');
    },
    onSuccess: (updatedBlockTallies) => {
      const queryKey = QUERY_KEYS.roomPollTallies(block.room_id);
      const sanitizedUpdated = updatedBlockTallies.map((tally) =>
        sanitizePollTallyForDisplay(tally, isAnonymous),
      );
      queryClient.setQueryData<PollTally[]>(queryKey, (old = []) => {
        const otherBlocks = old.filter((tally) => tally.block_id !== block.id);
        return [...otherBlocks, ...sanitizedUpdated];
      });
    },
  });

  const lockMutation = useMutation({
    mutationFn: (nextLocked: boolean) =>
      updateBlockConfig({
        blockId: block.id,
        type: 'poll',
        config: {
          ...block.config,
          isLocked: nextLocked,
        },
      }),
    onSuccess: (updatedBlock) => {
      queryClient.setQueryData<ParsedBlock[]>(
        QUERY_KEYS.roomBlocks(block.room_id),
        (old = []) =>
          old.map((entry) =>
            entry.id === block.id && entry.type === 'poll'
              ? { ...entry, config: updatedBlock.config, updated_at: updatedBlock.updated_at }
              : entry,
          ),
      );
      showToast(
        updatedBlock.config.isLocked ? '已锁定投票，禁止继续改票' : '已解锁投票',
        'success',
      );
    },
    onError: (err) => {
      showToast(mapRoomError(err), 'error');
    },
  });

  const addOptionMutation = useMutation({
    mutationFn: (label: string) =>
      createBlockItem({
        blockId: block.id,
        roomId: block.room_id,
        type: 'poll',
        data: { label },
        sortOrder: items.length,
        createdBy: currentUserId || null,
      }),
    onSuccess: async () => {
      setAddOptionVisible(false);
      setOptionLabelInput('');
      setOptionError(null);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: QUERY_KEYS.roomBlocks(block.room_id),
        }),
        queryClient.invalidateQueries({
          queryKey: QUERY_KEYS.roomPollTallies(block.room_id),
        }),
      ]);
      showToast('已添加投票选项', 'success');
    },
    onError: (err) => {
      setOptionError(mapRoomError(err));
    },
  });

  const addAvailabilityMutation = useMutation({
    mutationFn: async (payload: { date: string; slots: PollTimeSlot[] }) => {
      const existingKeys = new Set(
        items
          .filter((item) => item.data.slotDate && item.data.slotPeriod)
          .map((item) => `${item.data.slotDate}::${item.data.slotPeriod}`),
      );
      const slotsToCreate = payload.slots.filter(
        (slot) => !existingKeys.has(`${payload.date}::${slot}`),
      );
      if (slotsToCreate.length === 0) {
        throw new RoomApiError('INVALID_INPUT', '该日期下所选时段已存在');
      }

      const { shortDate } = formatAvailabilityDateLabel(payload.date);
      let nextOrder = items.length;
      for (const slot of slotsToCreate) {
        await createBlockItem({
          blockId: block.id,
          roomId: block.room_id,
          type: 'poll',
          data: {
            label: `${shortDate} ${POLL_TIME_SLOT_LABELS[slot]}`,
            slotDate: payload.date,
            slotPeriod: slot,
          },
          sortOrder: nextOrder,
          createdBy: currentUserId || null,
        });
        nextOrder += 1;
      }
    },
    onSuccess: async () => {
      setAddAvailabilityVisible(false);
      setAvailabilityError(null);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: QUERY_KEYS.roomBlocks(block.room_id),
        }),
        queryClient.invalidateQueries({
          queryKey: QUERY_KEYS.roomPollTallies(block.room_id),
        }),
      ]);
      showToast('已添加候选日期时段', 'success');
    },
    onError: (err) => {
      setAvailabilityError(mapRoomError(err));
    },
  });

  const softDeleteMutation = useMutation({
    mutationFn: (itemId: string) => softDeleteBlockItem(itemId),
    onSuccess: async () => {
      setDeleteItemTarget(null);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: QUERY_KEYS.roomBlocks(block.room_id),
        }),
        queryClient.invalidateQueries({
          queryKey: QUERY_KEYS.roomPollTallies(block.room_id),
        }),
        queryClient.invalidateQueries({
          queryKey: QUERY_KEYS.activityLogs(block.room_id),
        }),
      ]);
      showToast('已删除该选项（可在操作日志恢复）', 'success');
    },
    onError: (err) => {
      showToast(mapRoomError(err), 'error');
    },
  });

  const handleVotePress = (itemId: string) => {
    if (permissions.isArchived) {
      showToast(mapRoomError(new RoomApiError('ROOM_ARCHIVED')), 'info');
      return;
    }
    if (!permissions.canVote) {
      showToast(mapRoomError(new RoomApiError('FORBIDDEN')), 'error');
      return;
    }
    if (isLocked) {
      showToast(mapRoomError(new RoomApiError('POLL_LOCKED')), 'info');
      return;
    }
    if (isExpired) {
      showToast(mapRoomError(new RoomApiError('POLL_EXPIRED')), 'info');
      return;
    }
    voteMutation.mutate(itemId);
  };

  const handleOpenAddOption = () => {
    setOptionLabelInput('');
    setOptionError(null);
    setAddOptionVisible(true);
  };

  const handleSubmitOption = () => {
    const trimmed = optionLabelInput.trim();
    if (!trimmed) {
      setOptionError('请输入候选项名称');
      return;
    }
    if (Array.from(trimmed).length > MAX_OPTION_LABEL_LENGTH) {
      setOptionError(`候选项名称不能超过 ${MAX_OPTION_LABEL_LENGTH} 个字`);
      return;
    }
    setOptionError(null);
    addOptionMutation.mutate(trimmed);
  };

  const handleOpenAddAvailability = (prefillDate?: string, prefillSlot?: PollTimeSlot) => {
    const defaultDate =
      prefillDate ??
      upcomingQuickDates.find((candidate) => !availabilityDates.includes(candidate)) ??
      upcomingQuickDates[0] ??
      '';
    setDateInput(defaultDate);
    setSelectedSlots(prefillSlot ? [prefillSlot] : [...activeSlots]);
    setAvailabilityError(null);
    setAddAvailabilityVisible(true);
  };

  const handleToggleSlotChoice = (slot: PollTimeSlot) => {
    setAvailabilityError(null);
    setSelectedSlots((prev) =>
      prev.includes(slot) ? prev.filter((s) => s !== slot) : [...prev, slot],
    );
  };

  const handleSubmitAvailability = () => {
    const trimmedDate = dateInput.trim();
    if (!isValidCalendarDate(trimmedDate)) {
      setAvailabilityError('请输入有效的日期（格式 YYYY-MM-DD）');
      return;
    }
    if (selectedSlots.length === 0) {
      setAvailabilityError('请至少选择一个时间段');
      return;
    }
    setAvailabilityError(null);
    addAvailabilityMutation.mutate({
      date: trimmedDate,
      slots: activeSlots.filter((slot) => selectedSlots.includes(slot)),
    });
  };

  const deadlineHint = formatDeadlineHint(block.config.deadline);
  const hasDeletableItems = items.some((item) =>
    permissions.canEditOrDeleteItem(item.created_by),
  );

  const renderOptionMode = () => {
    if (items.length === 0) {
      return (
        <View className="mt-3 rounded-xl border border-dashed border-zinc-200 bg-surface/70 px-4 py-4">
          <Text className="text-center text-xs text-zinc-400">
            暂无投票候选项{canAddOption ? '，点击下方按钮添加第一个选项' : ''}
          </Text>
        </View>
      );
    }

    return (
      <View className="mt-3 gap-2.5">
        {items.map((item) => {
          const tally = sanitizedTallyMap.get(item.id);
          const voteCount = tally?.vote_count ?? 0;
          const myVoted = tally?.my_voted ?? false;
          const percent = formatPollPercentage(voteCount, totalVotes);
          const voterIds = isAnonymous ? [] : (tally?.voter_ids ?? []);
          const canDeleteItem = permissions.canEditOrDeleteItem(item.created_by);

          return (
            <View
              key={item.id}
              className={`overflow-hidden rounded-2xl border ${
                myVoted
                  ? 'border-primary bg-primarySoft/40'
                  : 'border-zinc-200 bg-surface'
              }`}
            >
              <View
                pointerEvents="none"
                style={{ width: `${percent}%` }}
                className={`absolute bottom-0 left-0 top-0 ${
                  myVoted ? 'bg-orange-100/80' : 'bg-zinc-200/50'
                }`}
              />

              <View className="flex-row items-center justify-between px-3.5 py-3">
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{
                    selected: myVoted,
                    disabled: votingDisabled,
                  }}
                  accessibilityLabel={`为 ${item.data.label} 投票，当前 ${voteCount} 票`}
                  onPress={() => handleVotePress(item.id)}
                  className="flex-1 flex-row items-center gap-2.5 pr-2 active:opacity-80"
                >
                  <View
                    className={`h-5 w-5 items-center justify-center rounded-full border ${
                      myVoted
                        ? 'border-primary bg-primary'
                        : 'border-zinc-300 bg-white'
                    }`}
                  >
                    {myVoted ? <Check size={12} color="#FFFFFF" strokeWidth={3} /> : null}
                  </View>

                  <View className="flex-1">
                    <Text
                      className={`text-sm font-semibold ${
                        myVoted ? 'text-ink' : 'text-zinc-800'
                      }`}
                    >
                      {item.data.label}
                    </Text>

                    {!isAnonymous && voterIds.length > 0 ? (
                      <View className="mt-1.5 flex-row items-center gap-2">
                        <View className="flex-row items-center">
                          {voterIds.slice(0, 5).map((voterId, idx) => {
                            const profile = memberProfileMap.get(voterId);
                            return (
                              <View
                                key={`${item.id}-voter-${voterId}`}
                                style={{ marginLeft: idx === 0 ? 0 : -6 }}
                                className="rounded-full border border-white"
                              >
                                <Avatar
                                  nickname={profile?.nickname}
                                  color={profile?.avatar_color}
                                  imageUrl={profile?.avatar_url}
                                  size="xs"
                                />
                              </View>
                            );
                          })}
                        </View>
                        <Text
                          className="flex-1 text-[11px] text-zinc-500"
                          numberOfLines={1}
                        >
                          {voterIds
                            .slice(0, 3)
                            .map((id) => memberProfileMap.get(id)?.nickname ?? '成员')
                            .join('、')}
                          {voterIds.length > 3 ? ` 等 ${voterIds.length} 人` : ''}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                </Pressable>

                <View className="flex-row items-center gap-2">
                  <View className="items-end">
                    <Text
                      className={`text-xs font-bold ${
                        myVoted ? 'text-primary' : 'text-zinc-700'
                      }`}
                    >
                      {voteCount} 票
                    </Text>
                    <Text className="text-[10px] text-zinc-400">{percent}%</Text>
                  </View>

                  {canDeleteItem ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`删除选项 ${item.data.label}`}
                      onPress={() => setDeleteItemTarget(item)}
                      className="h-7 w-7 items-center justify-center rounded-lg bg-white/80 active:bg-red-50"
                    >
                      <Trash2 size={13} color="#71717A" />
                    </Pressable>
                  ) : null}
                </View>
              </View>
            </View>
          );
        })}
      </View>
    );
  };

  const renderAvailabilityMode = () => {
    if (availabilityDates.length === 0) {
      return (
        <View className="mt-3 rounded-xl border border-dashed border-zinc-200 bg-surface/70 px-4 py-4">
          <Text className="text-center text-xs text-zinc-400">
            尚未设置候选日期与时段
            {canAddOption ? '，点击下方按钮添加日期后即可点选空闲时间' : ''}
          </Text>
        </View>
      );
    }

    const cellByKey = new Map(
      availabilityMatrix.cells.map((cell) => [`${cell.date}::${cell.slot}`, cell]),
    );

    return (
      <View className="mt-3">
        <View className="mb-2 flex-row items-center justify-between">
          <Text className="text-[11px] text-zinc-500">
            点击时段格子打卡有空时间（橙色越深代表越多人合适）
          </Text>
        </View>

        <View className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
          <View className="flex-row border-b border-zinc-100 bg-surface px-2 py-2">
            <View className="w-20 justify-center px-1">
              <Text className="text-[11px] font-semibold text-zinc-500">日期</Text>
            </View>
            {activeSlots.map((slot) => (
              <View key={slot} className="flex-1 items-center justify-center">
                <Text className="text-[11px] font-semibold text-zinc-600">
                  {POLL_TIME_SLOT_LABELS[slot]}
                </Text>
              </View>
            ))}
          </View>

          {availabilityDates.map((dateStr, rowIdx) => {
            const { shortDate, weekday } = formatAvailabilityDateLabel(dateStr);
            return (
              <View
                key={dateStr}
                className={`flex-row items-stretch px-2 py-2 ${
                  rowIdx > 0 ? 'border-t border-zinc-100' : ''
                }`}
              >
                <View className="w-20 justify-center px-1">
                  <Text className="text-xs font-bold text-ink">{shortDate}</Text>
                  {weekday ? (
                    <Text className="text-[10px] text-zinc-400">{weekday}</Text>
                  ) : null}
                </View>

                {activeSlots.map((slot) => {
                  const cell = cellByKey.get(`${dateStr}::${slot}`);
                  const item = cell?.item ?? null;
                  const tier = cell ? getHeatmapTier(cell.ratio) : 0;

                  if (!item) {
                    return (
                      <View key={`${dateStr}-${slot}`} className="flex-1 px-1">
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`补充 ${shortDate} ${POLL_TIME_SLOT_LABELS[slot]} 候选项`}
                          disabled={!canAddOption}
                          onPress={() => handleOpenAddAvailability(dateStr, slot)}
                          className="h-12 items-center justify-center rounded-xl border border-dashed border-zinc-200 bg-zinc-50/60 active:bg-zinc-100"
                        >
                          <Text className="text-xs text-zinc-300">
                            {canAddOption ? '+' : '-'}
                          </Text>
                        </Pressable>
                      </View>
                    );
                  }

                  const voteCount = cell?.voteCount ?? 0;
                  const myVoted = cell?.myVoted ?? false;
                  const isTop = cell?.isTop ?? false;

                  return (
                    <View key={item.id} className="flex-1 px-1">
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{
                          selected: myVoted,
                          disabled: votingDisabled,
                        }}
                        accessibilityLabel={`${shortDate} ${POLL_TIME_SLOT_LABELS[slot]}，${voteCount} 人有空`}
                        onPress={() => handleVotePress(item.id)}
                        className={`h-12 items-center justify-center rounded-xl border px-1 active:opacity-85 ${
                          HEATMAP_CELL_CLASSES[tier]
                        } ${myVoted ? 'border-2 border-primary' : ''}`}
                      >
                        <View className="flex-row items-center gap-0.5">
                          {isTop ? (
                            <Flame
                              size={11}
                              color={tier === 4 ? '#FFFFFF' : '#F97316'}
                            />
                          ) : null}
                          <Text
                            className={`text-xs font-bold ${HEATMAP_TEXT_CLASSES[tier]}`}
                          >
                            {voteCount} 人
                          </Text>
                        </View>

                        {myVoted ? (
                          <View className="mt-0.5 flex-row items-center gap-0.5">
                            <Check
                              size={10}
                              color={tier === 4 ? '#FFFFFF' : '#F97316'}
                              strokeWidth={3}
                            />
                            <Text
                              className={`text-[9px] font-semibold ${
                                tier === 4 ? 'text-white/90' : 'text-primary'
                              }`}
                            >
                              已选
                            </Text>
                          </View>
                        ) : isTop ? (
                          <Text
                            className={`mt-0.5 text-[9px] font-semibold ${
                              tier === 4 ? 'text-white/90' : 'text-primary'
                            }`}
                          >
                            推荐
                          </Text>
                        ) : null}
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            );
          })}
        </View>

        {availabilityMatrix.topItemIds.length > 0 ? (
          <View className="mt-2.5 flex-row flex-wrap items-center gap-1.5 rounded-xl bg-primarySoft px-3 py-2">
            <Flame size={13} color="#F97316" />
            <Text className="text-[11px] font-semibold text-primary">
              最佳时段（{availabilityMatrix.maxVotes} 人有空）：
            </Text>
            {availabilityMatrix.topItemIds.slice(0, 3).map((topId) => {
              const topItem = items.find((entry) => entry.id === topId);
              if (!topItem) {
                return null;
              }
              return (
                <Badge
                  key={topId}
                  label={topItem.data.label}
                  variant="primary"
                />
              );
            })}
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <Card className="mb-3.5">
      <View className="flex-row items-start justify-between gap-2">
        <View className="flex-1 flex-row items-start gap-2.5">
          <View className="mt-0.5 h-9 w-9 items-center justify-center rounded-xl bg-primarySoft">
            {block.config.mode === 'availability' ? (
              <CalendarDays size={18} color="#F97316" />
            ) : (
              <BarChart3 size={18} color="#F97316" />
            )}
          </View>

          <View className="flex-1">
            <View className="mb-1 flex-row flex-wrap items-center gap-1.5">
              <Badge
                label={
                  block.config.mode === 'availability' ? '时间热力图' : '方案投票'
                }
                variant="primary"
              />
              {block.config.mode === 'option' ? (
                <Badge
                  label={block.config.multiple ? '多选' : '单选'}
                  variant="neutral"
                />
              ) : null}
              {isAnonymous ? (
                <Badge label="匿名" variant="neutral" />
              ) : null}
              {isLocked ? (
                <Badge label="已锁定" variant="warning" />
              ) : null}
              {isExpired ? (
                <Badge label="已截止" variant="danger" />
              ) : null}
            </View>

            <Text className="text-base font-bold text-ink" numberOfLines={2}>
              {block.title}
            </Text>
            <Text className="mt-0.5 text-xs text-zinc-500">
              {block.config.mode === 'availability'
                ? `${availabilityDates.length} 个候选日期 · ${members.length} 位成员`
                : `${items.length} 个候选项 · 共 ${totalVotes} 票`}
              {deadlineHint ? ` · ${deadlineHint}` : ''}
            </Text>
          </View>
        </View>

        <View className="flex-row items-center gap-1.5">
          {permissions.canLockPoll ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={isLocked ? '解锁投票' : '锁定投票'}
              disabled={lockMutation.isPending}
              onPress={() => lockMutation.mutate(!isLocked)}
              className={`h-8 flex-row items-center gap-1 rounded-xl border px-2.5 ${
                isLocked
                  ? 'border-amber-200 bg-amber-50'
                  : 'border-zinc-200 bg-surface'
              } active:opacity-80`}
            >
              {isLocked ? (
                <Unlock size={13} color="#B45309" />
              ) : (
                <Lock size={13} color="#52525B" />
              )}
              <Text
                className={`text-[11px] font-semibold ${
                  isLocked ? 'text-amber-800' : 'text-zinc-600'
                }`}
              >
                {isLocked ? '解锁' : '锁定'}
              </Text>
            </Pressable>
          ) : null}

          {permissions.canManageBlocks && onRequestDeleteBlock ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`删除积木 ${block.title}`}
              onPress={() => onRequestDeleteBlock(block)}
              className="h-8 w-8 items-center justify-center rounded-xl border border-zinc-200 bg-surface active:bg-red-50"
            >
              <Trash2 size={15} color="#71717A" />
            </Pressable>
          ) : null}
        </View>
      </View>

      {isAnonymous ? (
        <View className="mt-2.5 flex-row items-center gap-1.5 rounded-xl bg-zinc-100 px-3 py-1.5">
          <EyeOff size={12} color="#52525B" />
          <Text className="text-[11px] text-zinc-600">
            匿名投票已开启，投票人头像与身份对所有人保密
          </Text>
        </View>
      ) : null}

      {block.config.mode === 'availability'
        ? renderAvailabilityMode()
        : renderOptionMode()}

      {canAddOption || (block.config.mode === 'availability' && hasDeletableItems) ? (
        <View className="mt-3 flex-row items-center gap-2 border-t border-zinc-100 pt-3">
          {canAddOption ? (
            <Button
              title={
                block.config.mode === 'availability' ? '添加候选日期' : '添加投票选项'
              }
              variant="secondary"
              size="sm"
              leftIcon={<Plus size={14} color="#F97316" />}
              onPress={() =>
                block.config.mode === 'availability'
                  ? handleOpenAddAvailability()
                  : handleOpenAddOption()
              }
              className="flex-1"
            />
          ) : null}

          {block.config.mode === 'availability' && hasDeletableItems ? (
            <Button
              title="管理时段"
              variant="ghost"
              size="sm"
              onPress={() => setManageSlotsVisible(true)}
            />
          ) : null}
        </View>
      ) : null}

      <SheetModal
        visible={addOptionVisible}
        onClose={() => setAddOptionVisible(false)}
        title="添加投票选项"
      >
        <View className="mb-4">
          <View className="mb-1.5 flex-row items-center justify-between">
            <Text className="text-xs font-semibold text-zinc-600">选项内容</Text>
            <Text className="text-xs text-zinc-400">
              {Array.from(optionLabelInput.trim()).length}/{MAX_OPTION_LABEL_LENGTH}
            </Text>
          </View>
          <BottomSheetTextInput
            value={optionLabelInput}
            onChangeText={(text) => {
              setOptionLabelInput(text);
              if (optionError) {
                setOptionError(null);
              }
            }}
            maxLength={MAX_OPTION_LABEL_LENGTH}
            placeholder="例如：川西四姑娘山 / 周六晚海底捞"
            placeholderTextColor="#A1A1AA"
            className="rounded-2xl border border-zinc-200 bg-surface px-4 py-3 text-sm text-ink"
          />
        </View>

        {optionError ? (
          <View className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5">
            <Text className="text-xs font-medium text-red-700">{optionError}</Text>
          </View>
        ) : null}

        <Button
          title="确认添加"
          variant="primary"
          size="lg"
          fullWidth
          loading={addOptionMutation.isPending}
          onPress={handleSubmitOption}
        />
      </SheetModal>

      <SheetModal
        visible={addAvailabilityVisible}
        onClose={() => setAddAvailabilityVisible(false)}
        title="添加候选日期与时段"
      >
        <Text className="mb-2 text-xs font-semibold text-zinc-600">
          快捷选择近期日期
        </Text>
        <View className="mb-3 flex-row flex-wrap gap-2">
          {upcomingQuickDates.map((candidate) => {
            const { shortDate, weekday } = formatAvailabilityDateLabel(candidate);
            const selected = dateInput.trim() === candidate;
            return (
              <Pressable
                key={candidate}
                onPress={() => {
                  setDateInput(candidate);
                  setAvailabilityError(null);
                }}
                className={`rounded-xl border px-3 py-2 ${
                  selected
                    ? 'border-primary bg-primarySoft'
                    : 'border-zinc-200 bg-surface'
                }`}
              >
                <Text
                  className={`text-xs font-semibold ${
                    selected ? 'text-primary' : 'text-zinc-700'
                  }`}
                >
                  {shortDate} {weekday}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View className="mb-4">
          <Text className="mb-1.5 text-xs font-semibold text-zinc-600">
            日期（YYYY-MM-DD）
          </Text>
          <BottomSheetTextInput
            value={dateInput}
            onChangeText={(text) => {
              setDateInput(text);
              if (availabilityError) {
                setAvailabilityError(null);
              }
            }}
            placeholder="例如：2026-11-28"
            placeholderTextColor="#A1A1AA"
            className="rounded-2xl border border-zinc-200 bg-surface px-4 py-3 text-sm text-ink"
          />
        </View>

        <Text className="mb-2 text-xs font-semibold text-zinc-600">
          开放投票的时间段
        </Text>
        <View className="mb-4 flex-row gap-2">
          {activeSlots.map((slot) => {
            const selected = selectedSlots.includes(slot);
            return (
              <Pressable
                key={slot}
                onPress={() => handleToggleSlotChoice(slot)}
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
                  {POLL_TIME_SLOT_LABELS[slot]}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {availabilityError ? (
          <View className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5">
            <Text className="text-xs font-medium text-red-700">
              {availabilityError}
            </Text>
          </View>
        ) : null}

        <Button
          title="生成时段格子"
          variant="primary"
          size="lg"
          fullWidth
          loading={addAvailabilityMutation.isPending}
          onPress={handleSubmitAvailability}
        />
      </SheetModal>

      <SheetModal
        visible={manageSlotsVisible}
        onClose={() => setManageSlotsVisible(false)}
        title="管理候选时段"
      >
        {items.length === 0 ? (
          <Text className="py-4 text-center text-xs text-zinc-400">
            暂无可管理的候选时段
          </Text>
        ) : (
          <View className="gap-2">
            {items.map((item) => {
              const canDeleteItem = permissions.canEditOrDeleteItem(item.created_by);
              const voteCount = sanitizedTallyMap.get(item.id)?.vote_count ?? 0;
              return (
                <View
                  key={item.id}
                  className="flex-row items-center justify-between rounded-xl border border-zinc-200 bg-surface px-3.5 py-2.5"
                >
                  <View>
                    <Text className="text-sm font-semibold text-ink">
                      {item.data.label}
                    </Text>
                    <Text className="text-[11px] text-zinc-500">
                      当前 {voteCount} 人有空
                    </Text>
                  </View>
                  {canDeleteItem ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`删除时段 ${item.data.label}`}
                      onPress={() => {
                        setManageSlotsVisible(false);
                        setDeleteItemTarget(item);
                      }}
                      className="h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 bg-white active:bg-red-50"
                    >
                      <Trash2 size={14} color="#EF4444" />
                    </Pressable>
                  ) : null}
                </View>
              );
            })}
          </View>
        )}
      </SheetModal>

      <SheetModal
        visible={deleteItemTarget !== null}
        onClose={() => setDeleteItemTarget(null)}
        title="确认删除投票选项？"
      >
        <Text className="mb-5 text-sm leading-6 text-zinc-600">
          确定删除「{deleteItemTarget?.data.label ?? ''}」吗？管理员后续可在房间操作日志中恢复该选项。
        </Text>
        <View className="gap-2.5">
          <Button
            title="确认删除"
            variant="danger"
            fullWidth
            loading={softDeleteMutation.isPending}
            onPress={() => {
              if (deleteItemTarget) {
                softDeleteMutation.mutate(deleteItemTarget.id);
              }
            }}
          />
          <Button
            title="取消"
            variant="ghost"
            fullWidth
            onPress={() => setDeleteItemTarget(null)}
          />
        </View>
      </SheetModal>
    </Card>
  );
}
