import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import {
  CalendarClock,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  Edit3,
  ExternalLink,
  MapPin,
  Navigation,
  Plus,
  Trash2,
} from 'lucide-react-native';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Platform, Text, View } from 'react-native';
import {
  type ParsedBlock,
  type ParsedBlockItem,
  createBlockItem,
  softDeleteBlockItem,
  updateBlockItem,
} from '../../api/blocks';
import { RoomApiError, mapRoomError } from '../../api/rooms';
import type { RoomPermissions } from '../../hooks/useRoomPermissions';
import {
  type MapNavigationOption,
  type MapPlatform,
  buildMapNavigationOptions,
} from '../../lib/mapNavigation';
import { QUERY_KEYS } from '../../lib/queryClient';
import {
  DEFAULT_SCHEDULE_GROUP_LABEL,
  formatScheduleTimeRange,
  groupAndSortScheduleItems,
  normalizeScheduleTimeInput,
} from '../../lib/scheduleHelpers';
import type { ScheduleItemData } from '../../schemas/blocks';
import { useAuthStore } from '../../stores/authStore';
import { useUiStore } from '../../stores/uiStore';
import type { ProfileSummary, RoomMemberWithProfile } from '../../types/database';
import { Avatar } from '../ui/Avatar';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import {
  AnimatedItemRow,
  LayoutAnimationConfig,
  MotionPressable,
} from '../ui/Motion';
import { SheetModal } from '../ui/SheetModal';
import { THEME_COLORS } from '../../lib/theme';

const MAX_SCHEDULE_GROUP_LENGTH = 30;
const MAX_SCHEDULE_TITLE_LENGTH = 60;
const MAX_SCHEDULE_LOCATION_LENGTH = 100;
const MAX_SCHEDULE_NOTES_LENGTH = 300;

/** Prefill draft dispatched externally (e.g., from a chat message conversion) to open the Create sheet. */
export interface ExternalBlockCreateDraft {
  nonce: number;
  title: string;
  details: string;
}

/** Props for the Visual Schedule Timeline collaborative block. */
export interface ScheduleBlockProps {
  block: ParsedBlock<'schedule'>;
  items: ParsedBlockItem<'schedule'>[];
  members: RoomMemberWithProfile[];
  permissions: RoomPermissions;
  onRequestDeleteBlock?: (block: ParsedBlock<'schedule'>) => void;
  highlighted?: boolean;
  reorderMode?: boolean;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  reordering?: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  externalCreateDraft?: ExternalBlockCreateDraft | null;
  onConsumeExternalCreateDraft?: () => void;
}

function resolveMapPlatform(): MapPlatform {
  if (Platform.OS === 'ios') {
    return 'ios';
  }
  if (Platform.OS === 'android') {
    return 'android';
  }
  return 'web';
}

/**
 * Interactive Visual Schedule Timeline block grouped by `groupAndSortScheduleItems`,
 * featuring plain-text `locationName` pills with deep-link/fallback map navigation,
 * clipboard copy (working offline and when archived), and gated CRUD + soft-delete.
 */
export function ScheduleBlock({
  block,
  items,
  members,
  permissions,
  onRequestDeleteBlock,
  highlighted = false,
  reorderMode = false,
  canMoveUp = false,
  canMoveDown = false,
  reordering = false,
  onMoveUp,
  onMoveDown,
  externalCreateDraft = null,
  onConsumeExternalCreateDraft,
}: ScheduleBlockProps) {
  const queryClient = useQueryClient();
  const currentUserId = useAuthStore((s) => s.session?.user.id ?? '');
  const showToast = useUiStore((s) => s.showToast);

  const [navLocation, setNavLocation] = useState<string | null>(null);
  const [formVisible, setFormVisible] = useState(false);
  const [editingItem, setEditingItem] =
    useState<ParsedBlockItem<'schedule'> | null>(null);
  const [groupLabelInput, setGroupLabelInput] = useState(
    DEFAULT_SCHEDULE_GROUP_LABEL,
  );
  const [startTimeInput, setStartTimeInput] = useState('');
  const [endTimeInput, setEndTimeInput] = useState('');
  const [titleInput, setTitleInput] = useState('');
  const [locationNameInput, setLocationNameInput] = useState('');
  const [ownerIdInput, setOwnerIdInput] = useState<string | null>(null);
  const [notesInput, setNotesInput] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const [deleteItemTarget, setDeleteItemTarget] =
    useState<ParsedBlockItem<'schedule'> | null>(null);

  const memberProfileMap = useMemo(() => {
    const map = new Map<string, ProfileSummary>();
    for (const member of members) {
      if (member.profiles) {
        map.set(member.user_id, member.profiles);
      }
    }
    return map;
  }, [members]);

  const groups = useMemo(() => groupAndSortScheduleItems(items), [items]);
  const canCreateSchedule = permissions.canCreateItem();
  const lastConsumedDraftNonceRef = useRef<number | null>(null);

  useEffect(() => {
    if (!externalCreateDraft) {
      return;
    }
    if (lastConsumedDraftNonceRef.current === externalCreateDraft.nonce) {
      return;
    }
    lastConsumedDraftNonceRef.current = externalCreateDraft.nonce;

    if (!canCreateSchedule) {
      showToast(
        mapRoomError(
          new RoomApiError(
            permissions.isArchived ? 'ROOM_ARCHIVED' : 'FORBIDDEN',
          ),
        ),
        permissions.isArchived ? 'info' : 'error',
      );
      onConsumeExternalCreateDraft?.();
      return;
    }

    const defaultGroup =
      groups[0]?.groupLabel ??
      (block.config.groupBy === 'phase'
        ? '活动中'
        : DEFAULT_SCHEDULE_GROUP_LABEL);
    setEditingItem(null);
    setGroupLabelInput(defaultGroup);
    setStartTimeInput('09:00');
    setEndTimeInput('');
    setTitleInput(externalCreateDraft.title);
    setLocationNameInput('');
    setOwnerIdInput(currentUserId || null);
    setNotesInput(
      Array.from(externalCreateDraft.details)
        .slice(0, MAX_SCHEDULE_NOTES_LENGTH)
        .join(''),
    );
    setFormError(null);
    setFormVisible(true);
    onConsumeExternalCreateDraft?.();
  }, [
    block.config.groupBy,
    canCreateSchedule,
    currentUserId,
    externalCreateDraft,
    groups,
    onConsumeExternalCreateDraft,
    permissions.isArchived,
    showToast,
  ]);

  const mapPlatform = resolveMapPlatform();
  const mapOptions = useMemo(
    () =>
      navLocation ? buildMapNavigationOptions(navLocation, mapPlatform) : [],
    [mapPlatform, navLocation],
  );

  const selectableOwnerOptions = useMemo(() => {
    const list: Array<{ userId: string; profile: ProfileSummary | null }> =
      members.map((member) => ({
        userId: member.user_id,
        profile: member.profiles,
      }));
    if (
      ownerIdInput &&
      !list.some((entry) => entry.userId === ownerIdInput)
    ) {
      list.push({
        userId: ownerIdInput,
        profile: memberProfileMap.get(ownerIdInput) ?? null,
      });
    }
    return list;
  }, [memberProfileMap, members, ownerIdInput]);

  const saveScheduleMutation = useMutation({
    mutationFn: async (payload: {
      mode: 'create' | 'edit';
      item: ParsedBlockItem<'schedule'> | null;
      data: ScheduleItemData;
    }) => {
      if (payload.mode === 'edit' && payload.item) {
        return updateBlockItem({
          itemId: payload.item.id,
          type: 'schedule',
          data: payload.data,
        });
      }

      return createBlockItem({
        blockId: block.id,
        roomId: block.room_id,
        type: 'schedule',
        data: payload.data,
        sortOrder: items.length,
        createdBy: currentUserId || null,
      });
    },
    onSuccess: async (_saved, variables) => {
      setFormVisible(false);
      setEditingItem(null);
      setFormError(null);
      await queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.roomBlocks(block.room_id),
      });
      showToast(
        variables.mode === 'edit' ? '已更新日程节点' : '已添加日程节点',
        'success',
      );
    },
    onError: (err) => {
      setFormError(mapRoomError(err));
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
          queryKey: QUERY_KEYS.activityLogs(block.room_id),
        }),
      ]);
      showToast('已删除该日程节点（可在操作日志恢复）', 'success');
    },
    onError: (err) => {
      showToast(mapRoomError(err), 'error');
    },
  });

  const handleOpenCreateForm = () => {
    if (!canCreateSchedule) {
      showToast(
        mapRoomError(
          new RoomApiError(
            permissions.isArchived ? 'ROOM_ARCHIVED' : 'FORBIDDEN',
          ),
        ),
        permissions.isArchived ? 'info' : 'error',
      );
      return;
    }
    const defaultGroup =
      groups[0]?.groupLabel ??
      (block.config.groupBy === 'phase' ? '活动中' : DEFAULT_SCHEDULE_GROUP_LABEL);
    setEditingItem(null);
    setGroupLabelInput(defaultGroup);
    setStartTimeInput('09:00');
    setEndTimeInput('');
    setTitleInput('');
    setLocationNameInput('');
    setOwnerIdInput(currentUserId || null);
    setNotesInput('');
    setFormError(null);
    setFormVisible(true);
  };

  const handleOpenEditForm = (item: ParsedBlockItem<'schedule'>) => {
    if (!permissions.canEditOrDeleteItem(item.created_by)) {
      return;
    }
    setEditingItem(item);
    setGroupLabelInput(item.data.groupLabel);
    setStartTimeInput(item.data.startTime);
    setEndTimeInput(item.data.endTime ?? '');
    setTitleInput(item.data.title);
    setLocationNameInput(item.data.locationName ?? '');
    setOwnerIdInput(item.data.ownerId);
    setNotesInput(item.data.notes);
    setFormError(null);
    setFormVisible(true);
  };

  const handleSubmitForm = () => {
    if (permissions.isArchived) {
      setFormError(mapRoomError(new RoomApiError('ROOM_ARCHIVED')));
      return;
    }

    if (editingItem) {
      if (!permissions.canEditOrDeleteItem(editingItem.created_by)) {
        setFormError(mapRoomError(new RoomApiError('FORBIDDEN')));
        return;
      }
    } else if (!canCreateSchedule) {
      setFormError(mapRoomError(new RoomApiError('FORBIDDEN')));
      return;
    }

    const trimmedGroup =
      groupLabelInput.trim() || DEFAULT_SCHEDULE_GROUP_LABEL;
    if (Array.from(trimmedGroup).length > MAX_SCHEDULE_GROUP_LENGTH) {
      setFormError(`分组名称不能超过 ${MAX_SCHEDULE_GROUP_LENGTH} 个字`);
      return;
    }

    const normalizedStart = normalizeScheduleTimeInput(startTimeInput);
    if (!normalizedStart) {
      setFormError('请输入有效开始时间（如 09:00 或 14:30）');
      return;
    }

    const trimmedEndRaw = endTimeInput.trim();
    let normalizedEnd: string | undefined;
    if (trimmedEndRaw) {
      const parsedEnd = normalizeScheduleTimeInput(trimmedEndRaw);
      if (!parsedEnd) {
        setFormError('结束时间格式无效，请使用 HH:mm（如 11:30）');
        return;
      }
      normalizedEnd = parsedEnd;
    }

    const trimmedTitle = titleInput.trim();
    if (!trimmedTitle) {
      setFormError('请输入日程主题');
      return;
    }
    if (Array.from(trimmedTitle).length > MAX_SCHEDULE_TITLE_LENGTH) {
      setFormError(`日程主题不能超过 ${MAX_SCHEDULE_TITLE_LENGTH} 个字`);
      return;
    }

    const trimmedLocation = locationNameInput.trim();
    if (Array.from(trimmedLocation).length > MAX_SCHEDULE_LOCATION_LENGTH) {
      setFormError(`地点名称不能超过 ${MAX_SCHEDULE_LOCATION_LENGTH} 个字`);
      return;
    }

    const trimmedNotes = notesInput.trim();
    if (Array.from(trimmedNotes).length > MAX_SCHEDULE_NOTES_LENGTH) {
      setFormError(`备注说明不能超过 ${MAX_SCHEDULE_NOTES_LENGTH} 个字`);
      return;
    }

    const preserveCoordinates =
      editingItem &&
      trimmedLocation &&
      trimmedLocation === editingItem.data.locationName?.trim();

    const nextData: ScheduleItemData = {
      groupLabel: trimmedGroup,
      startTime: normalizedStart,
      ...(normalizedEnd ? { endTime: normalizedEnd } : {}),
      title: trimmedTitle,
      ...(trimmedLocation ? { locationName: trimmedLocation } : {}),
      ...(preserveCoordinates && editingItem.data.latitude !== undefined
        ? { latitude: editingItem.data.latitude }
        : {}),
      ...(preserveCoordinates && editingItem.data.longitude !== undefined
        ? { longitude: editingItem.data.longitude }
        : {}),
      ownerId: ownerIdInput,
      notes: trimmedNotes,
    };

    setFormError(null);
    saveScheduleMutation.mutate({
      mode: editingItem ? 'edit' : 'create',
      item: editingItem,
      data: nextData,
    });
  };

  const handleCopyLocation = async (location: string) => {
    try {
      await Clipboard.setStringAsync(location);
      showToast('已复制地点名称', 'success');
    } catch {
      showToast('复制失败，请长按文本复制', 'error');
    }
  };

  const handleOpenMapOption = async (option: MapNavigationOption) => {
    let targetUrl = option.fallbackUrl;
    try {
      const canOpen = await Linking.canOpenURL(option.url);
      if (canOpen) {
        targetUrl = option.url;
      }
    } catch {
      targetUrl = option.fallbackUrl;
    }

    try {
      await Linking.openURL(targetUrl);
      setNavLocation(null);
    } catch {
      if (targetUrl !== option.fallbackUrl) {
        try {
          await Linking.openURL(option.fallbackUrl);
          setNavLocation(null);
          return;
        } catch {
          // Fall through to user toast when web fallback also fails.
        }
      }
      showToast('无法打开地图应用，请点击「复制地点」后手动搜索', 'error');
    }
  };

  return (
    <Card
      className={highlighted ? 'mb-3.5 border-2 border-primary' : 'mb-3.5'}
      style={
        highlighted
          ? { borderWidth: 2, borderColor: THEME_COLORS.primary }
          : undefined
      }
    >
      <View className="flex-row items-start justify-between gap-2">
        <View className="flex-1 flex-row items-start gap-2.5">
          <View className="mt-0.5 h-10 w-10 items-center justify-center rounded-2xl border border-primaryBorder bg-primarySoft">
            <CalendarClock size={18} color={THEME_COLORS.primary} />
          </View>

          <View className="flex-1">
            <View className="mb-1 flex-row flex-wrap items-center gap-1.5">
              <Badge
                label={block.config.groupBy === 'phase' ? '阶段日程' : '每日日程'}
                variant="primary"
              />
              <Badge label={`${items.length} 个节点`} variant="neutral" />
            </View>

            <Text className="text-base font-bold text-ink" numberOfLines={2}>
              {block.title}
            </Text>
            <Text className="mt-0.5 text-xs text-inkMuted">
              {groups.length === 0
                ? '暂无日程节点'
                : `${groups.length} 个分组 · 按时间升序排列`}
            </Text>
          </View>
        </View>

        <View className="flex-row items-center gap-1.5">
          {reorderMode ? (
            <>
              <MotionPressable
                accessibilityRole="button"
                accessibilityLabel={`上移积木 ${block.title}`}
                disabled={!canMoveUp || reordering}
                onPress={onMoveUp}
                scaleTo={0.9}
                className={`h-8 w-8 items-center justify-center rounded-xl border ${
                  canMoveUp && !reordering
                    ? 'border-primaryBorder bg-primarySoft'
                    : 'border-line bg-surface opacity-45'
                }`}
              >
                <ChevronUp
                  size={15}
                  color={
                    canMoveUp && !reordering
                      ? THEME_COLORS.primaryDeep
                      : THEME_COLORS.inkSubtle
                  }
                />
              </MotionPressable>
              <MotionPressable
                accessibilityRole="button"
                accessibilityLabel={`下移积木 ${block.title}`}
                disabled={!canMoveDown || reordering}
                onPress={onMoveDown}
                scaleTo={0.9}
                className={`h-8 w-8 items-center justify-center rounded-xl border ${
                  canMoveDown && !reordering
                    ? 'border-primaryBorder bg-primarySoft'
                    : 'border-line bg-surface opacity-45'
                }`}
              >
                <ChevronDown
                  size={15}
                  color={
                    canMoveDown && !reordering
                      ? THEME_COLORS.primaryDeep
                      : THEME_COLORS.inkSubtle
                  }
                />
              </MotionPressable>
            </>
          ) : permissions.canManageBlocks && onRequestDeleteBlock ? (
            <MotionPressable
              accessibilityRole="button"
              accessibilityLabel={`删除积木 ${block.title}`}
              onPress={() => onRequestDeleteBlock(block)}
              scaleTo={0.9}
              className="h-8 w-8 items-center justify-center rounded-xl border border-line bg-surface"
            >
              <Trash2 size={15} color={THEME_COLORS.inkMuted} />
            </MotionPressable>
          ) : null}
        </View>
      </View>

      {groups.length === 0 ? (
        <View className="mt-3 rounded-2xl border border-dashed border-line bg-primaryMist px-4 py-4">
          <Text className="text-center text-xs text-inkSubtle">
            暂无日程安排{canCreateSchedule ? '，点击下方按钮添加第一个时间节点' : ''}
          </Text>
        </View>
      ) : (
        <LayoutAnimationConfig skipEntering>
          <View className="mt-3.5 gap-4">
            {groups.map((group) => (
              <View key={group.groupLabel}>
                <View className="mb-2.5 flex-row items-center justify-between">
                  <View className="flex-row items-center gap-1.5 rounded-full border border-primaryBorder bg-primarySoft px-3 py-1">
                    <View className="h-1.5 w-1.5 rounded-full bg-primary" />
                    <Text className="text-xs font-bold text-primaryDeep">
                      {group.groupLabel}
                    </Text>
                  </View>
                  <Text className="text-[11px] font-medium text-inkSubtle">
                    {group.items.length} 项
                  </Text>
                </View>

                <View className="pl-1">
                  {group.items.map((item, idx) => {
                    const isLast = idx === group.items.length - 1;
                    const canEditOrDelete = permissions.canEditOrDeleteItem(
                      item.created_by,
                    );
                    const locationText = item.data.locationName?.trim() ?? '';
                    const ownerProfile = item.data.ownerId
                      ? memberProfileMap.get(item.data.ownerId)
                      : undefined;
                    const timeLabel = formatScheduleTimeRange(
                      item.data.startTime,
                      item.data.endTime,
                    );

                    return (
                      <AnimatedItemRow key={item.id}>
                        <View className="flex-row items-stretch">
                          <View className="mr-3 w-4 items-center">
                            <View className="mt-3 h-3 w-3 items-center justify-center rounded-full bg-primarySoft">
                              <View className="h-2 w-2 rounded-full bg-primary" />
                            </View>
                            {!isLast ? (
                              <View className="my-1 w-0.5 flex-1 bg-primaryBorder" />
                            ) : null}
                          </View>

                          <View
                            className={`flex-1 rounded-2xl border border-line bg-primaryMist p-3 ${
                              isLast ? '' : 'mb-2.5'
                            }`}
                          >
                            <View className="flex-row items-center justify-between gap-2">
                              <View className="flex-row items-center gap-1 rounded-full border border-primaryBorder bg-primarySoft px-2.5 py-0.5">
                                <Clock size={11} color={THEME_COLORS.primaryDeep} />
                                <Text className="text-[11px] font-bold text-primaryDeep">
                                  {timeLabel}
                                </Text>
                              </View>

                              {canEditOrDelete ? (
                                <View className="flex-row items-center gap-1.5">
                                  <MotionPressable
                                    accessibilityRole="button"
                                    accessibilityLabel={`编辑日程 ${item.data.title}`}
                                    onPress={() => handleOpenEditForm(item)}
                                    scaleTo={0.9}
                                    className="h-7 w-7 items-center justify-center rounded-lg border border-line bg-white"
                                  >
                                    <Edit3 size={13} color={THEME_COLORS.inkMuted} />
                                  </MotionPressable>
                                  <MotionPressable
                                    accessibilityRole="button"
                                    accessibilityLabel={`删除日程 ${item.data.title}`}
                                    onPress={() => setDeleteItemTarget(item)}
                                    scaleTo={0.9}
                                    className="h-7 w-7 items-center justify-center rounded-lg border border-line bg-white"
                                  >
                                    <Trash2 size={13} color={THEME_COLORS.inkMuted} />
                                  </MotionPressable>
                                </View>
                              ) : null}
                            </View>

                            <Text className="mt-1.5 text-sm font-bold text-ink">
                              {item.data.title}
                            </Text>

                            {item.data.notes.trim() ? (
                              <Text className="mt-1 text-xs leading-4 text-inkMuted">
                                {item.data.notes.trim()}
                              </Text>
                            ) : null}

                            {locationText ? (
                              <View className="mt-2.5 flex-row items-center gap-2">
                                <View className="flex-1 flex-row items-center gap-1.5 rounded-xl border border-line bg-white px-2.5 py-1.5">
                                  <MapPin size={13} color={THEME_COLORS.primary} />
                                  <Text
                                    className="flex-1 text-xs font-medium text-ink/80"
                                    numberOfLines={2}
                                  >
                                    {locationText}
                                  </Text>
                                </View>
                                <MotionPressable
                                  accessibilityRole="button"
                                  accessibilityLabel={`导航至 ${locationText}`}
                                  onPress={() => setNavLocation(locationText)}
                                  scaleTo={0.94}
                                  className="flex-row items-center gap-1 rounded-xl border border-primaryBorder bg-primarySoft px-2.5 py-1.5"
                                >
                                  <Navigation size={12} color={THEME_COLORS.primaryDeep} />
                                  <Text className="text-xs font-bold text-primaryDeep">
                                    导航
                                  </Text>
                                </MotionPressable>
                              </View>
                            ) : null}

                            {item.data.ownerId ? (
                              <View className="mt-2.5 flex-row items-center gap-1.5 border-t border-lineSoft pt-2">
                                <Avatar
                                  nickname={ownerProfile?.nickname ?? '成员'}
                                  color={ownerProfile?.avatar_color}
                                  imageUrl={ownerProfile?.avatar_url}
                                  size="xs"
                                />
                                <Text className="text-[11px] font-medium text-inkMuted">
                                  负责人：{ownerProfile?.nickname ?? '成员'}
                                </Text>
                              </View>
                            ) : null}
                          </View>
                        </View>
                      </AnimatedItemRow>
                    );
                  })}
                </View>
              </View>
            ))}
          </View>
        </LayoutAnimationConfig>
      )}

      {canCreateSchedule ? (
        <View className="mt-3.5 border-t border-lineSoft pt-3">
          <Button
            title="新增日程节点"
            variant="secondary"
            size="sm"
            fullWidth
            leftIcon={<Plus size={14} color={THEME_COLORS.primaryDeep} />}
            onPress={handleOpenCreateForm}
          />
        </View>
      ) : null}

      <SheetModal
        visible={navLocation !== null}
        onClose={() => setNavLocation(null)}
        title="地点导航"
      >
        {navLocation ? (
          <View className="gap-3.5">
            <View className="flex-row items-center gap-2 rounded-2xl border border-line bg-primaryMist p-3.5">
              <MapPin size={18} color={THEME_COLORS.primary} />
              <Text className="flex-1 text-sm font-bold text-ink">
                {navLocation}
              </Text>
            </View>

            <Button
              title="复制地点"
              variant="secondary"
              size="md"
              fullWidth
              leftIcon={<Copy size={16} color={THEME_COLORS.primaryDeep} />}
              onPress={() => void handleCopyLocation(navLocation)}
            />

            <View className="gap-2">
              <Text className="text-xs font-semibold text-inkMuted">
                选择外部地图搜索导航
              </Text>
              {mapOptions.map((option) => (
                <MotionPressable
                  key={option.id}
                  accessibilityRole="button"
                  accessibilityLabel={`使用 ${option.label} 导航`}
                  onPress={() => void handleOpenMapOption(option)}
                  scaleTo={0.98}
                  className="flex-row items-center justify-between rounded-2xl border border-line bg-white px-4 py-3.5"
                >
                  <View className="flex-row items-center gap-2.5">
                    <View className="h-8 w-8 items-center justify-center rounded-xl bg-primarySoft">
                      <Navigation size={15} color={THEME_COLORS.primary} />
                    </View>
                    <View>
                      <Text className="text-sm font-bold text-ink">
                        {option.label}
                      </Text>
                      <Text className="text-[11px] text-inkSubtle">
                        {option.id === 'web'
                          ? '在浏览器中搜索该地点'
                          : '优先唤起客户端，未安装时跳转网页版'}
                      </Text>
                    </View>
                  </View>
                  <ExternalLink size={16} color={THEME_COLORS.inkMuted} />
                </MotionPressable>
              ))}
            </View>
          </View>
        ) : null}
      </SheetModal>

      <SheetModal
        visible={formVisible}
        onClose={() => {
          setFormVisible(false);
          setEditingItem(null);
          setFormError(null);
        }}
        title={editingItem ? '编辑日程节点' : '新增日程节点'}
      >
        <View className="mb-3.5">
          <View className="mb-1.5 flex-row items-center justify-between">
            <Text className="text-xs font-semibold text-inkMuted">
              {block.config.groupBy === 'phase'
                ? '阶段分组（如：筹备期 / 活动中）'
                : '日期 / 分组（如：Day 1 / 活动当天）'}
            </Text>
            <Text className="text-xs text-inkSubtle">
              {Array.from(groupLabelInput.trim()).length}/{MAX_SCHEDULE_GROUP_LENGTH}
            </Text>
          </View>
          <BottomSheetTextInput
            value={groupLabelInput}
            onChangeText={(text) => {
              setGroupLabelInput(text);
              if (formError) {
                setFormError(null);
              }
            }}
            maxLength={MAX_SCHEDULE_GROUP_LENGTH}
            placeholder={DEFAULT_SCHEDULE_GROUP_LABEL}
            placeholderTextColor={THEME_COLORS.inkSubtle}
            className="rounded-2xl border border-line bg-surface px-4 py-3 text-sm text-ink"
          />
        </View>

        <View className="mb-3.5 flex-row gap-2.5">
          <View className="flex-1">
            <Text className="mb-1.5 text-xs font-semibold text-inkMuted">
              开始时间（必填）
            </Text>
            <BottomSheetTextInput
              value={startTimeInput}
              onChangeText={(text) => {
                setStartTimeInput(text);
                if (formError) {
                  setFormError(null);
                }
              }}
              placeholder="09:00"
              placeholderTextColor={THEME_COLORS.inkSubtle}
              className="rounded-2xl border border-line bg-surface px-4 py-3 text-sm text-ink"
            />
          </View>
          <View className="flex-1">
            <Text className="mb-1.5 text-xs font-semibold text-inkMuted">
              结束时间（选填）
            </Text>
            <BottomSheetTextInput
              value={endTimeInput}
              onChangeText={(text) => {
                setEndTimeInput(text);
                if (formError) {
                  setFormError(null);
                }
              }}
              placeholder="11:30"
              placeholderTextColor={THEME_COLORS.inkSubtle}
              className="rounded-2xl border border-line bg-surface px-4 py-3 text-sm text-ink"
            />
          </View>
        </View>

        <View className="mb-3.5">
          <View className="mb-1.5 flex-row items-center justify-between">
            <Text className="text-xs font-semibold text-inkMuted">
              日程主题（必填）
            </Text>
            <Text className="text-xs text-inkSubtle">
              {Array.from(titleInput.trim()).length}/{MAX_SCHEDULE_TITLE_LENGTH}
            </Text>
          </View>
          <BottomSheetTextInput
            value={titleInput}
            onChangeText={(text) => {
              setTitleInput(text);
              if (formError) {
                setFormError(null);
              }
            }}
            maxLength={MAX_SCHEDULE_TITLE_LENGTH}
            placeholder="例如：公园东门集合 / 破冰游戏"
            placeholderTextColor={THEME_COLORS.inkSubtle}
            className="rounded-2xl border border-line bg-surface px-4 py-3 text-sm text-ink"
          />
        </View>

        <View className="mb-3.5">
          <View className="mb-1.5 flex-row items-center justify-between">
            <Text className="text-xs font-semibold text-inkMuted">
              地点名称（选填，用于一键导航）
            </Text>
            <Text className="text-xs text-inkSubtle">
              {Array.from(locationNameInput.trim()).length}/{MAX_SCHEDULE_LOCATION_LENGTH}
            </Text>
          </View>
          <BottomSheetTextInput
            value={locationNameInput}
            onChangeText={(text) => {
              setLocationNameInput(text);
              if (formError) {
                setFormError(null);
              }
            }}
            maxLength={MAX_SCHEDULE_LOCATION_LENGTH}
            placeholder="例如：紫竹院公园东门"
            placeholderTextColor={THEME_COLORS.inkSubtle}
            className="rounded-2xl border border-line bg-surface px-4 py-3 text-sm text-ink"
          />
        </View>

        <View className="mb-3.5">
          <Text className="mb-2 text-xs font-semibold text-inkMuted">
            负责人（选填）
          </Text>
          <View className="flex-row flex-wrap gap-2">
            <MotionPressable
              accessibilityRole="radio"
              accessibilityState={{ selected: ownerIdInput === null }}
              onPress={() => setOwnerIdInput(null)}
              scaleTo={0.95}
              className={`rounded-full border px-3 py-1.5 ${
                ownerIdInput === null
                  ? 'border-primary bg-primarySoft'
                  : 'border-line bg-surface'
              }`}
            >
              <Text
                className={`text-xs font-semibold ${
                  ownerIdInput === null ? 'text-primaryDeep' : 'text-inkMuted'
                }`}
              >
                无指定
              </Text>
            </MotionPressable>

            {selectableOwnerOptions.map((entry) => {
              const selected = ownerIdInput === entry.userId;
              const label = entry.profile?.nickname ?? '成员';
              return (
                <MotionPressable
                  key={`owner-opt-${entry.userId}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  onPress={() => setOwnerIdInput(entry.userId)}
                  scaleTo={0.95}
                  className={`flex-row items-center gap-1.5 rounded-full border px-2.5 py-1 ${
                    selected
                      ? 'border-primary bg-primarySoft'
                      : 'border-line bg-surface'
                  }`}
                >
                  <Avatar
                    nickname={label}
                    color={entry.profile?.avatar_color}
                    imageUrl={entry.profile?.avatar_url}
                    size="xs"
                  />
                  <Text
                    className={`text-xs font-semibold ${
                      selected ? 'text-primaryDeep' : 'text-inkMuted'
                    }`}
                  >
                    {label}
                  </Text>
                </MotionPressable>
              );
            })}
          </View>
        </View>

        <View className="mb-4">
          <View className="mb-1.5 flex-row items-center justify-between">
            <Text className="text-xs font-semibold text-inkMuted">
              备注说明（选填）
            </Text>
            <Text className="text-xs text-inkSubtle">
              {Array.from(notesInput.trim()).length}/{MAX_SCHEDULE_NOTES_LENGTH}
            </Text>
          </View>
          <BottomSheetTextInput
            value={notesInput}
            onChangeText={(text) => {
              setNotesInput(text);
              if (formError) {
                setFormError(null);
              }
            }}
            maxLength={MAX_SCHEDULE_NOTES_LENGTH}
            multiline
            numberOfLines={3}
            placeholder="例如：建议提前 10 分钟到场签到"
            placeholderTextColor={THEME_COLORS.inkSubtle}
            textAlignVertical="top"
            className="min-h-[80px] rounded-2xl border border-line bg-surface px-4 py-3 text-sm text-ink"
          />
        </View>

        {formError ? (
          <View className="mb-4 rounded-xl border border-[#FAD2D0] bg-[#FEF2F2] px-3.5 py-2.5">
            <Text className="text-xs font-medium text-[#C94545]">{formError}</Text>
          </View>
        ) : null}

        <View className="gap-2.5">
          <Button
            title={editingItem ? '保存修改' : '确认添加日程'}
            variant="primary"
            size="lg"
            fullWidth
            loading={saveScheduleMutation.isPending}
            onPress={handleSubmitForm}
          />
          {editingItem &&
          permissions.canEditOrDeleteItem(editingItem.created_by) ? (
            <Button
              title="删除该日程"
              variant="danger"
              size="md"
              fullWidth
              leftIcon={<Trash2 size={15} color="#FFFFFF" />}
              onPress={() => {
                const target = editingItem;
                setFormVisible(false);
                setEditingItem(null);
                setDeleteItemTarget(target);
              }}
            />
          ) : null}
        </View>
      </SheetModal>

      <SheetModal
        visible={deleteItemTarget !== null}
        onClose={() => setDeleteItemTarget(null)}
        title="确认删除该日程？"
      >
        <Text className="mb-5 text-sm leading-6 text-inkMuted">
          确定删除「{deleteItemTarget?.data.title ?? ''}
          」吗？管理员后续可在房间操作日志中恢复该日程节点。
        </Text>
        <View className="gap-2.5">
          <Button
            title="确认删除"
            variant="danger"
            fullWidth
            loading={softDeleteMutation.isPending}
            disabled={
              !deleteItemTarget ||
              !permissions.canEditOrDeleteItem(deleteItemTarget.created_by)
            }
            onPress={() => {
              if (
                deleteItemTarget &&
                permissions.canEditOrDeleteItem(deleteItemTarget.created_by)
              ) {
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
