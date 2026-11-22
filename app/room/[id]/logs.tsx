import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  ChevronLeft,
  Clock,
  FileText,
  RotateCcw,
  ShieldAlert,
} from 'lucide-react-native';
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  type ActivityLogWithActor,
  fetchActivityLogs,
  restoreDeletedItem,
} from '../../../src/api/blocks';
import {
  RoomApiError,
  fetchRoomDetail,
  fetchRoomMembers,
  mapRoomError,
} from '../../../src/api/rooms';
import { Avatar } from '../../../src/components/ui/Avatar';
import { Badge } from '../../../src/components/ui/Badge';
import { Button } from '../../../src/components/ui/Button';
import { Card } from '../../../src/components/ui/Card';
import { SheetModal } from '../../../src/components/ui/SheetModal';
import { useRoomPermissions } from '../../../src/hooks/useRoomPermissions';
import {
  type ActivityLogFilterMode,
  canRestoreLogEntry,
  filterActivityLogs,
  formatActivityLogEntry,
  formatActivityLogTimestamp,
  getActivityActionMeta,
} from '../../../src/lib/activityLogHelpers';
import { QUERY_KEYS } from '../../../src/lib/queryClient';
import { useAuthStore } from '../../../src/stores/authStore';
import { useUiStore } from '../../../src/stores/uiStore';
import type { ProfileSummary } from '../../../src/types/database';

function readRoomIdParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? '';
  }
  return value ?? '';
}

interface PendingRestoreSelection {
  log: ActivityLogWithActor;
  summary: string;
  detail: string;
}

/** Admin/host room activity log timeline with one-click undo rollback for soft-deleted items. */
export default function RoomLogsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const roomId = readRoomIdParam(params.id);

  const session = useAuthStore((s) => s.session);
  const showToast = useUiStore((s) => s.showToast);
  const currentUserId = session?.user.id ?? null;

  const [filterMode, setFilterMode] = useState<ActivityLogFilterMode>('all');
  const [restoreTarget, setRestoreTarget] =
    useState<PendingRestoreSelection | null>(null);
  const [restoring, setRestoring] = useState(false);

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
    refetch: refetchMembers,
  } = useQuery({
    queryKey: QUERY_KEYS.roomMembers(roomId),
    queryFn: () => fetchRoomMembers(roomId),
    enabled: Boolean(roomId),
  });

  const activeMembers = useMemo(
    () => members.filter((m) => m.status === 'active'),
    [members],
  );

  const myMembership = useMemo(
    () => activeMembers.find((m) => m.user_id === currentUserId) ?? null,
    [activeMembers, currentUserId],
  );

  const permissions = useRoomPermissions({
    role: myMembership?.role ?? null,
    roomStatus: room?.status ?? 'active',
    currentUserId,
    allowMemberCreatePoll: room?.allow_member_create_poll ?? true,
  });

  const canUndoDelete = permissions.canRestoreDeletedItem;

  const {
    data: logs = [],
    isLoading: logsLoading,
    isRefetching: logsRefetching,
    error: logsError,
    refetch: refetchLogs,
  } = useQuery({
    queryKey: QUERY_KEYS.activityLogs(roomId),
    queryFn: () => fetchActivityLogs(roomId),
    enabled: Boolean(roomId) && Boolean(room) && permissions.canViewLogs,
  });

  const memberProfileByUserId = useMemo(() => {
    const map = new Map<string, ProfileSummary>();
    for (const member of members) {
      if (member.profiles) {
        map.set(member.user_id, member.profiles);
      }
    }
    return map;
  }, [members]);

  const restorableCount = useMemo(
    () =>
      logs.filter((log) => canRestoreLogEntry(log, canUndoDelete)).length,
    [logs, canUndoDelete],
  );

  const visibleLogs = useMemo(
    () => filterActivityLogs(logs, filterMode, canUndoDelete),
    [logs, filterMode, canUndoDelete],
  );

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
    const tasks: Array<Promise<unknown>> = [refetchRoom(), refetchMembers()];
    if (permissions.canViewLogs) {
      tasks.push(refetchLogs());
    }
    void Promise.all(tasks);
  };

  const invalidateAfterRestore = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.roomBlocks(roomId),
      }),
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.roomPollTallies(roomId),
      }),
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.activityLogs(roomId),
      }),
    ]);
  };

  const handleConfirmRestore = async () => {
    if (!restoreTarget || !canUndoDelete) {
      return;
    }

    setRestoring(true);
    try {
      await restoreDeletedItem(restoreTarget.log.id);
      setRestoreTarget(null);
      await invalidateAfterRestore();
      showToast('已恢复该条目到对应积木', 'success');
    } catch (err) {
      if (err instanceof RoomApiError && err.code === 'LOG_ALREADY_RESTORED') {
        setRestoreTarget(null);
        await invalidateAfterRestore();
      }
      showToast(mapRoomError(err), 'error');
    } finally {
      setRestoring(false);
    }
  };

  if (roomLoading || (membersLoading && members.length === 0)) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-surface">
        <ActivityIndicator size="large" color="#F97316" />
        <Text className="mt-3 text-xs text-zinc-500">正在加载操作日志...</Text>
      </SafeAreaView>
    );
  }

  if (roomError || !room) {
    return (
      <SafeAreaView className="flex-1 bg-surface px-4 pt-6">
        <Card className="items-center p-6">
          <AlertTriangle size={28} color="#EF4444" />
          <Text className="mt-3 text-base font-bold text-ink">
            无法加载操作日志
          </Text>
          <Text className="mt-1.5 text-center text-xs text-zinc-500">
            {mapRoomError(roomError)}
          </Text>
          <View className="mt-5 w-full gap-2">
            <Button title="返回" fullWidth onPress={handleBack} />
          </View>
        </Card>
      </SafeAreaView>
    );
  }

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
        <View className="items-center">
          <Text className="text-base font-bold text-ink">操作日志</Text>
          <Text className="text-[11px] text-zinc-400" numberOfLines={1}>
            {room.title}
          </Text>
        </View>
        <View className="w-9" />
      </View>

      {!permissions.canViewLogs ? (
        <View className="flex-1 justify-center px-4">
          <Card className="items-center p-6">
            <View className="h-12 w-12 items-center justify-center rounded-2xl bg-amber-50">
              <ShieldAlert size={24} color="#D97706" />
            </View>
            <Text className="mt-3 text-base font-bold text-ink">
              仅房主与管理员可查看操作日志
            </Text>
            <Text className="mt-1.5 text-center text-xs leading-5 text-zinc-500">
              当前账号为只读普通成员视角，暂不开放操作审计记录与误删撤销功能。如需恢复误删内容，请联系房主或管理员。
            </Text>
            <View className="mt-5 w-full">
              <Button title="返回房间" fullWidth onPress={handleBack} />
            </View>
          </Card>
        </View>
      ) : (
        <ScrollView
          className="flex-1 px-4 pt-4"
          contentContainerStyle={{ paddingBottom: 40 }}
          refreshControl={
            <RefreshControl
              refreshing={roomRefetching || membersRefetching || logsRefetching}
              onRefresh={handleRefreshAll}
              tintColor="#F97316"
              colors={['#F97316']}
            />
          }
        >
          {permissions.isArchived ? (
            <View className="mb-4 flex-row items-center gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
              <Archive size={18} color="#B45309" />
              <View className="flex-1">
                <Text className="text-xs font-bold text-amber-900">
                  活动已归档 · 只读查看日志
                </Text>
                <Text className="mt-0.5 text-xs text-amber-700">
                  当前仅支持浏览历史操作记录，归档房间不支持一键恢复条目
                </Text>
              </View>
            </View>
          ) : (
            <View className="mb-4 flex-row items-center gap-2.5 rounded-2xl border border-orange-200 bg-primarySoft px-4 py-3">
              <RotateCcw size={17} color="#F97316" />
              <View className="flex-1">
                <Text className="text-xs font-bold text-ink">
                  防手滑撤销保护已开启
                </Text>
                <Text className="mt-0.5 text-xs text-zinc-600">
                  误删的任务、投票选项、日程或账单都会保留快照，可随时一键恢复
                </Text>
              </View>
            </View>
          )}

          <View className="mb-4 flex-row items-center gap-2">
            {(
              [
                { key: 'all', label: `全部日志 (${logs.length})` },
                {
                  key: 'restorable',
                  label: `可撤销删除 (${restorableCount})`,
                },
              ] as const
            ).map((option) => {
              const selected = filterMode === option.key;
              return (
                <Pressable
                  key={option.key}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => setFilterMode(option.key)}
                  className={`rounded-full border px-3.5 py-1.5 ${
                    selected
                      ? 'border-primary bg-primarySoft'
                      : 'border-zinc-200 bg-white'
                  }`}
                >
                  <Text
                    className={`text-xs font-semibold ${
                      selected ? 'text-primary' : 'text-zinc-600'
                    }`}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {logsLoading && logs.length === 0 ? (
            <Card className="items-center py-10">
              <ActivityIndicator size="small" color="#F97316" />
              <Text className="mt-2.5 text-xs text-zinc-500">
                正在读取审计日志...
              </Text>
            </Card>
          ) : logsError ? (
            <Card className="items-center p-6">
              <AlertTriangle size={24} color="#EF4444" />
              <Text className="mt-2.5 text-sm font-bold text-ink">
                日志加载失败
              </Text>
              <Text className="mt-1 text-center text-xs text-zinc-500">
                {mapRoomError(logsError)}
              </Text>
              <View className="mt-4">
                <Button
                  title="重新加载"
                  size="sm"
                  variant="secondary"
                  onPress={() => void refetchLogs()}
                />
              </View>
            </Card>
          ) : visibleLogs.length === 0 ? (
            <Card className="items-center py-10">
              <View className="h-11 w-11 items-center justify-center rounded-2xl bg-zinc-100">
                <FileText size={20} color="#71717A" />
              </View>
              <Text className="mt-3 text-sm font-bold text-ink">
                {filterMode === 'restorable'
                  ? permissions.isArchived
                    ? '已归档房间不可恢复条目'
                    : '暂无可撤销的删除记录'
                  : '暂无房间操作日志'}
              </Text>
              <Text className="mt-1 text-center text-xs text-zinc-500">
                {filterMode === 'restorable'
                  ? '所有删除记录都已恢复，或尚未发生条目删除'
                  : '成员删除积木条目或管理员移出成员时会自动记录在此'}
              </Text>
            </Card>
          ) : (
            <View className="gap-3">
              {visibleLogs.map((log) => {
                const actorProfile =
                  log.profiles ??
                  (log.actor_id
                    ? (memberProfileByUserId.get(log.actor_id) ?? null)
                    : null);
                const actorName = actorProfile?.nickname ?? '系统成员';
                const formatted = formatActivityLogEntry(
                  log,
                  actorName,
                  canUndoDelete,
                );
                const actionMeta = getActivityActionMeta(log.action);
                const timeLabel = formatActivityLogTimestamp(
                  formatted.createdAt,
                );

                return (
                  <Card key={log.id} className="p-4">
                    <View className="flex-row items-start gap-3">
                      <Avatar
                        nickname={actorName}
                        color={actorProfile?.avatar_color}
                        imageUrl={actorProfile?.avatar_url}
                        size="sm"
                      />

                      <View className="flex-1">
                        <View className="flex-row flex-wrap items-center gap-1.5">
                          <Badge
                            label={actionMeta.label}
                            variant={actionMeta.badgeVariant}
                          />
                          {formatted.isRestored ? (
                            <Badge variant="success">
                              <View className="flex-row items-center gap-1">
                                <CheckCircle2 size={11} color="#15803D" />
                                <Text className="text-[11px] font-semibold text-emerald-700">
                                  已恢复
                                </Text>
                              </View>
                            </Badge>
                          ) : null}
                          <View className="ml-auto flex-row items-center gap-1">
                            <Clock size={11} color="#A1A1AA" />
                            <Text className="text-[11px] text-zinc-400">
                              {timeLabel}
                            </Text>
                          </View>
                        </View>

                        <Text className="mt-2 text-sm font-semibold leading-5 text-ink">
                          {formatted.summary}
                        </Text>
                        <Text className="mt-1 text-xs leading-5 text-zinc-500">
                          {formatted.detail}
                        </Text>

                        {formatted.canRestore ? (
                          <View className="mt-3 flex-row justify-end">
                            <Button
                              title="一键恢复"
                              size="sm"
                              variant="secondary"
                              leftIcon={
                                <RotateCcw size={14} color="#F97316" />
                              }
                              onPress={() =>
                                setRestoreTarget({
                                  log,
                                  summary: formatted.summary,
                                  detail: formatted.detail,
                                })
                              }
                            />
                          </View>
                        ) : null}
                      </View>
                    </View>
                  </Card>
                );
              })}
            </View>
          )}
        </ScrollView>
      )}

      <SheetModal
        visible={restoreTarget !== null}
        onClose={() => {
          if (!restoring) {
            setRestoreTarget(null);
          }
        }}
        title="确认一键恢复条目？"
      >
        {restoreTarget ? (
          <View>
            <View className="mb-4 rounded-2xl border border-zinc-200 bg-surface p-3.5">
              <Text className="text-sm font-semibold text-ink">
                {restoreTarget.summary}
              </Text>
              <Text className="mt-1 text-xs leading-5 text-zinc-500">
                {restoreTarget.detail}
              </Text>
            </View>

            <Text className="mb-5 text-sm leading-6 text-zinc-600">
              恢复后该条目会立即重新出现在原积木中，原有的投票、认领或评论关联也会一并还原。
            </Text>

            <View className="gap-2.5">
              <Button
                title="一键恢复"
                variant="primary"
                fullWidth
                loading={restoring}
                leftIcon={<RotateCcw size={16} color="#FFFFFF" />}
                onPress={handleConfirmRestore}
              />
              <Button
                title="取消"
                variant="ghost"
                fullWidth
                disabled={restoring}
                onPress={() => setRestoreTarget(null)}
              />
            </View>
          </View>
        ) : null}
      </SheetModal>
    </SafeAreaView>
  );
}
