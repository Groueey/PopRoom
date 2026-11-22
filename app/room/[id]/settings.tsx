import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import {
  AlertTriangle,
  Archive,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileText,
  Lock,
  RefreshCw,
  Shield,
  Unlock,
  UserMinus,
  Users,
  X,
} from 'lucide-react-native';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
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
  ROLE_LABELS,
  archiveRoom,
  fetchRoomDetail,
  fetchRoomMembers,
  kickRoomMember,
  mapRoomError,
  resetRoomCode,
  reviewMemberApplication,
  updateMemberRole,
  updateRoomMetadata,
} from '../../../src/api/rooms';
import { Avatar } from '../../../src/components/ui/Avatar';
import { Badge } from '../../../src/components/ui/Badge';
import { Button } from '../../../src/components/ui/Button';
import { Card } from '../../../src/components/ui/Card';
import { OfflineSyncBanner } from '../../../src/components/ui/OfflineSyncBanner';
import { SheetModal } from '../../../src/components/ui/SheetModal';
import { useRoomPermissions } from '../../../src/hooks/useRoomPermissions';
import { QUERY_KEYS } from '../../../src/lib/queryClient';
import { buildShareMessage } from '../../../src/lib/roomCode';
import { resolveRoomScreenState } from '../../../src/lib/roomScreenState';
import { ROOM_TEMPLATES } from '../../../src/lib/templates';
import { useAuthStore } from '../../../src/stores/authStore';
import { useUiStore } from '../../../src/stores/uiStore';
import type {
  JoinMode,
  MemberRole,
  RoomMemberWithProfile,
} from '../../../src/types/database';

const ROLE_ORDER: Record<MemberRole, number> = {
  host: 0,
  admin: 1,
  member: 2,
};

function readRoomIdParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? '';
  }
  return value ?? '';
}

function getRoleBadgeVariant(
  role: MemberRole,
): 'primary' | 'warning' | 'neutral' {
  if (role === 'host') {
    return 'primary';
  }
  if (role === 'admin') {
    return 'warning';
  }
  return 'neutral';
}

/** Room settings, 6-char invite/reset, approval queue, member roles, logs link, and archival screen. */
export default function RoomSettingsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const roomId = readRoomIdParam(params.id);

  const session = useAuthStore((s) => s.session);
  const showToast = useUiStore((s) => s.showToast);
  const currentUserId = session?.user.id ?? null;

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

  const activeMembers = useMemo(() => {
    return members
      .filter((m) => m.status === 'active')
      .slice()
      .sort((a, b) => {
        const roleDiff = ROLE_ORDER[a.role] - ROLE_ORDER[b.role];
        if (roleDiff !== 0) {
          return roleDiff;
        }
        return Date.parse(a.joined_at) - Date.parse(b.joined_at);
      });
  }, [members]);

  const pendingMembers = useMemo(
    () => members.filter((m) => m.status === 'pending'),
    [members],
  );

  const myRawMembership = useMemo(
    () => members.find((m) => m.user_id === currentUserId) ?? null,
    [members, currentUserId],
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

  const [titleDraft, setTitleDraft] = useState('');
  const [announcementDraft, setAnnouncementDraft] = useState('');
  const [joinModeDraft, setJoinModeDraft] = useState<JoinMode>('passcode');
  const [allowMemberCreatePollDraft, setAllowMemberCreatePollDraft] =
    useState(true);
  const [savingMetadata, setSavingMetadata] = useState(false);

  const [resetCodeModalVisible, setResetCodeModalVisible] = useState(false);
  const [resettingCode, setResettingCode] = useState(false);

  const [reviewingUserId, setReviewingUserId] = useState<string | null>(null);
  const [roleUpdatingUserId, setRoleUpdatingUserId] = useState<string | null>(
    null,
  );
  const [kickTarget, setKickTarget] = useState<RoomMemberWithProfile | null>(
    null,
  );
  const [kicking, setKicking] = useState(false);

  const [archiveModalVisible, setArchiveModalVisible] = useState(false);
  const [archiving, setArchiving] = useState(false);

  useEffect(() => {
    if (!room) {
      return;
    }
    setTitleDraft(room.title);
    setAnnouncementDraft(room.announcement ?? '');
    setJoinModeDraft(room.join_mode);
    setAllowMemberCreatePollDraft(room.allow_member_create_poll);
  }, [room]);

  const invalidateRoomQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.roomDetail(roomId) }),
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.roomMembers(roomId),
      }),
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.rooms(currentUserId ?? undefined),
      }),
    ]);
  };

  const handleRefreshAll = () => {
    void Promise.all([refetchRoom(), refetchMembers()]);
  };

  const handleCopyInvite = async () => {
    if (!room) {
      return;
    }
    try {
      const inviteUrl = Linking.createURL('room/join', {
        queryParams: { code: room.room_code },
      });
      const message = buildShareMessage(room.title, room.room_code, inviteUrl);
      await Clipboard.setStringAsync(message);
      showToast('已复制邀请口令与链接', 'success');
    } catch {
      showToast('复制失败，请长按房间码手动复制', 'error');
    }
  };

  const handleConfirmResetCode = async () => {
    if (!room || !permissions.canResetRoomCode) {
      return;
    }
    setResettingCode(true);
    try {
      const nextCode = await resetRoomCode(room.id);
      setResetCodeModalVisible(false);
      await invalidateRoomQueries();
      showToast(`房间码已重置为 ${nextCode}`, 'success');
    } catch (err) {
      showToast(mapRoomError(err), 'error');
    } finally {
      setResettingCode(false);
    }
  };

  const handleSaveMetadata = async () => {
    if (!room || !permissions.canEditRoomSettings) {
      return;
    }
    setSavingMetadata(true);
    try {
      const updated = await updateRoomMetadata(room.id, {
        title: titleDraft,
        announcement: announcementDraft,
        join_mode: joinModeDraft,
        allow_member_create_poll: allowMemberCreatePollDraft,
      });
      queryClient.setQueryData(QUERY_KEYS.roomDetail(room.id), updated);
      await invalidateRoomQueries();
      showToast('房间设置已保存', 'success');
    } catch (err) {
      showToast(mapRoomError(err), 'error');
    } finally {
      setSavingMetadata(false);
    }
  };

  const handleReviewApplication = async (
    targetUserId: string,
    decision: 'approve' | 'reject',
  ) => {
    if (!room || !permissions.canReviewMembers) {
      return;
    }
    setReviewingUserId(targetUserId);
    try {
      await reviewMemberApplication(room.id, targetUserId, decision);
      await invalidateRoomQueries();
      showToast(
        decision === 'approve' ? '已通过入房申请' : '已拒绝该入房申请',
        'success',
      );
    } catch (err) {
      showToast(mapRoomError(err), 'error');
    } finally {
      setReviewingUserId(null);
    }
  };

  const handleToggleAdminRole = async (member: RoomMemberWithProfile) => {
    if (!room || !permissions.canManageAdmins || member.role === 'host') {
      return;
    }
    const nextRole = member.role === 'admin' ? 'member' : 'admin';
    setRoleUpdatingUserId(member.user_id);
    try {
      await updateMemberRole(room.id, member.user_id, nextRole);
      await invalidateRoomQueries();
      showToast(
        nextRole === 'admin' ? '已设为房间管理员' : '已取消管理员身份',
        'success',
      );
    } catch (err) {
      showToast(mapRoomError(err), 'error');
    } finally {
      setRoleUpdatingUserId(null);
    }
  };

  const handleConfirmKick = async () => {
    if (!room || !kickTarget || !permissions.canKickTarget(kickTarget.role)) {
      return;
    }
    setKicking(true);
    try {
      await kickRoomMember(room.id, kickTarget.user_id);
      setKickTarget(null);
      await Promise.all([
        invalidateRoomQueries(),
        queryClient.invalidateQueries({
          queryKey: QUERY_KEYS.activityLogs(room.id),
        }),
      ]);
      showToast('已将该成员移出房间', 'success');
    } catch (err) {
      showToast(mapRoomError(err), 'error');
    } finally {
      setKicking(false);
    }
  };

  const handleConfirmArchive = async () => {
    if (!room || !permissions.canArchiveRoom) {
      return;
    }
    setArchiving(true);
    try {
      const archived = await archiveRoom(room.id);
      queryClient.setQueryData(QUERY_KEYS.roomDetail(room.id), archived);
      setArchiveModalVisible(false);
      await invalidateRoomQueries();
      showToast('活动已归档，当前全员只读', 'success');
    } catch (err) {
      showToast(mapRoomError(err), 'error');
    } finally {
      setArchiving(false);
    }
  };

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else if (roomId) {
      router.replace(`/room/${roomId}` as Href);
    } else {
      router.replace('/(tabs)');
    }
  };

  const screenState = resolveRoomScreenState({
    mode: 'settings',
    room,
    roomLoading,
    roomError,
    members,
    membersLoading,
    membersError,
    myRawMembership,
    canAccess: true,
  });

  if (screenState.kind === 'loading') {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-surface">
        <ActivityIndicator size="large" color="#F97316" />
        <Text className="mt-3 text-xs text-zinc-500">正在加载房间设置...</Text>
      </SafeAreaView>
    );
  }

  if (screenState.kind === 'full_error' || !room) {
    const errorTitle =
      screenState.kind === 'full_error'
        ? screenState.title
        : '无法加载房间设置';
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
          <Text className="mt-1.5 text-center text-xs text-zinc-500">
            {errorMessage}
          </Text>
          <View className="mt-5 w-full gap-2">
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
              fullWidth
              onPress={() => router.replace('/(tabs)')}
            />
          </View>
        </Card>
      </SafeAreaView>
    );
  }

  const isRefreshing = roomRefetching || membersRefetching;
  const templateName = ROOM_TEMPLATES[room.template_type].name;
  const titleLen = Array.from(titleDraft.trim()).length;
  const hasMetadataChanges =
    titleDraft.trim() !== room.title ||
    announcementDraft.trim() !== (room.announcement ?? '') ||
    joinModeDraft !== room.join_mode ||
    allowMemberCreatePollDraft !== room.allow_member_create_poll;

  return (
    <SafeAreaView className="flex-1 bg-surface" edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View className="flex-row items-center justify-between border-b border-zinc-200/70 bg-white px-4 py-3">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="返回房间"
            onPress={handleBack}
            className="h-9 w-9 items-center justify-center rounded-full bg-zinc-100 active:bg-zinc-200"
          >
            <ChevronLeft size={20} color="#18181B" />
          </Pressable>
          <Text className="text-base font-bold text-ink">房间设置</Text>
          <View className="w-9" />
        </View>

        <ScrollView
          className="flex-1 px-4 pt-4"
          contentContainerStyle={{ paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
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
                  当前仅支持查看成员名单与操作日志，不可修改房间或成员状态
                </Text>
              </View>
            </View>
          ) : null}

          <Card className="mb-4">
            <View className="mb-3 flex-row items-center justify-between">
              <Text className="text-sm font-bold text-ink">6 位房间邀请码</Text>
              <View className="flex-row items-center gap-1.5">
                <Badge label={templateName} variant="primary" />
                <Badge
                  label={JOIN_MODE_LABELS[room.join_mode]}
                  variant="neutral"
                />
              </View>
            </View>

            <View className="mb-3 items-center rounded-2xl bg-primarySoft py-4">
              <Text className="text-3xl font-extrabold tracking-[8px] text-primary">
                {room.room_code}
              </Text>
              <Text className="mt-1 text-xs text-zinc-500">
                {permissions.isArchived
                  ? '房间已归档，不再接受新成员加入'
                  : '把口令发给伙伴，在活动大厅输入即可入房'}
              </Text>
            </View>

            {!permissions.isArchived ? (
              <View className="flex-row gap-2.5">
                <View className="flex-1">
                  <Button
                    title="复制口令"
                    variant="secondary"
                    size="md"
                    fullWidth
                    leftIcon={<Copy size={16} color="#F97316" />}
                    onPress={handleCopyInvite}
                  />
                </View>
                {permissions.canResetRoomCode ? (
                  <View className="flex-1">
                    <Button
                      title="重置房间码"
                      variant="ghost"
                      size="md"
                      fullWidth
                      leftIcon={<RefreshCw size={16} color="#52525B" />}
                      className="border border-zinc-200 bg-white"
                      onPress={() => setResetCodeModalVisible(true)}
                    />
                  </View>
                ) : null}
              </View>
            ) : null}
          </Card>

          <Card className="mb-4">
            <Text className="mb-3 text-sm font-bold text-ink">
              房间信息与门禁
            </Text>

            {permissions.canEditRoomSettings ? (
              <>
                <View className="mb-3.5">
                  <View className="mb-1.5 flex-row items-center justify-between">
                    <Text className="text-xs font-semibold text-zinc-600">
                      房间名称
                    </Text>
                    <Text className="text-xs text-zinc-400">
                      {titleLen}/{MAX_ROOM_TITLE_LENGTH}
                    </Text>
                  </View>
                  <TextInput
                    value={titleDraft}
                    onChangeText={setTitleDraft}
                    maxLength={MAX_ROOM_TITLE_LENGTH}
                    placeholder="输入房间名称"
                    placeholderTextColor="#A1A1AA"
                    className="rounded-2xl border border-zinc-200 bg-surface px-4 py-2.5 text-sm text-ink"
                  />
                </View>

                <View className="mb-3.5">
                  <Text className="mb-1.5 text-xs font-semibold text-zinc-600">
                    房间公告
                  </Text>
                  <TextInput
                    value={announcementDraft}
                    onChangeText={setAnnouncementDraft}
                    placeholder="填写集合时间、地点或规则提示"
                    placeholderTextColor="#A1A1AA"
                    multiline
                    numberOfLines={3}
                    textAlignVertical="top"
                    maxLength={300}
                    className="min-h-[76px] rounded-2xl border border-zinc-200 bg-surface px-4 py-2.5 text-sm text-ink"
                  />
                </View>

                <View className="mb-3.5">
                  <Text className="mb-2 text-xs font-semibold text-zinc-600">
                    进房门禁方式
                  </Text>
                  <View className="flex-row gap-2.5">
                    {(['passcode', 'approval'] as const).map((mode) => {
                      const selected = joinModeDraft === mode;
                      return (
                        <Pressable
                          key={mode}
                          accessibilityRole="radio"
                          accessibilityState={{ selected }}
                          onPress={() => setJoinModeDraft(mode)}
                          className={`flex-1 flex-row items-center justify-center gap-1.5 rounded-xl border py-2.5 ${
                            selected
                              ? 'border-primary bg-primarySoft'
                              : 'border-zinc-200 bg-surface'
                          }`}
                        >
                          {mode === 'passcode' ? (
                            <Unlock
                              size={15}
                              color={selected ? '#F97316' : '#71717A'}
                            />
                          ) : (
                            <Lock
                              size={15}
                              color={selected ? '#F97316' : '#71717A'}
                            />
                          )}
                          <Text
                            className={`text-xs font-semibold ${
                              selected ? 'text-primary' : 'text-zinc-600'
                            }`}
                          >
                            {JOIN_MODE_LABELS[mode]}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>

                <View className="mb-4 flex-row items-center justify-between rounded-2xl bg-surface px-3.5 py-2.5">
                  <View className="flex-1 pr-3">
                    <Text className="text-xs font-semibold text-ink">
                      允许普通成员发起新投票
                    </Text>
                    <Text className="mt-0.5 text-[11px] text-zinc-500">
                      关闭后仅房主与管理员可新增投票积木
                    </Text>
                  </View>
                  <Switch
                    value={allowMemberCreatePollDraft}
                    onValueChange={setAllowMemberCreatePollDraft}
                    trackColor={{ false: '#D4D4D8', true: '#FDBA74' }}
                    thumbColor={
                      allowMemberCreatePollDraft ? '#F97316' : '#F4F4F5'
                    }
                  />
                </View>

                <Button
                  title={hasMetadataChanges ? '保存房间设置' : '设置已是最新'}
                  variant={hasMetadataChanges ? 'primary' : 'secondary'}
                  loading={savingMetadata}
                  disabled={!hasMetadataChanges && !savingMetadata}
                  fullWidth
                  onPress={handleSaveMetadata}
                />
              </>
            ) : (
              <View className="gap-2.5">
                <View>
                  <Text className="text-xs text-zinc-400">房间名称</Text>
                  <Text className="mt-0.5 text-sm font-semibold text-ink">
                    {room.title}
                  </Text>
                </View>
                <View>
                  <Text className="text-xs text-zinc-400">房间公告</Text>
                  <Text className="mt-0.5 text-sm text-zinc-600">
                    {room.announcement || '暂无公告'}
                  </Text>
                </View>
              </View>
            )}
          </Card>

          {permissions.canReviewMembers &&
          (pendingMembers.length > 0 || room.join_mode === 'approval') ? (
            <Card className="mb-4">
              <View className="mb-3 flex-row items-center justify-between">
                <Text className="text-sm font-bold text-ink">
                  待审批入房申请 ({pendingMembers.length})
                </Text>
                {pendingMembers.length > 0 ? (
                  <Badge label="需处理" variant="warning" />
                ) : null}
              </View>

              {pendingMembers.length === 0 ? (
                <Text className="py-2 text-xs text-zinc-400">
                  暂无待审批申请，新成员输入房间码后会出现在这里
                </Text>
              ) : (
                <View className="gap-2.5">
                  {pendingMembers.map((applicant) => {
                    const nickname =
                      applicant.profiles?.nickname ?? '待审批伙伴';
                    const isBusy = reviewingUserId === applicant.user_id;
                    return (
                      <View
                        key={applicant.id}
                        className="rounded-2xl border border-zinc-200/80 bg-surface p-3"
                      >
                        <View className="flex-row items-center gap-2.5">
                          <Avatar
                            nickname={nickname}
                            color={applicant.profiles?.avatar_color}
                            imageUrl={applicant.profiles?.avatar_url}
                            size="sm"
                          />
                          <View className="flex-1">
                            <Text className="text-sm font-semibold text-ink">
                              {nickname}
                            </Text>
                            {applicant.apply_note ? (
                              <Text className="mt-0.5 text-xs text-zinc-500">
                                备注：{applicant.apply_note}
                              </Text>
                            ) : (
                              <Text className="mt-0.5 text-xs text-zinc-400">
                                未填写申请备注
                              </Text>
                            )}
                          </View>
                        </View>

                        <View className="mt-2.5 flex-row gap-2">
                          <View className="flex-1">
                            <Button
                              title="通过"
                              size="sm"
                              variant="primary"
                              fullWidth
                              loading={isBusy}
                              disabled={reviewingUserId !== null}
                              leftIcon={<Check size={14} color="#FFFFFF" />}
                              onPress={() =>
                                handleReviewApplication(
                                  applicant.user_id,
                                  'approve',
                                )
                              }
                            />
                          </View>
                          <View className="flex-1">
                            <Button
                              title="拒绝"
                              size="sm"
                              variant="ghost"
                              fullWidth
                              disabled={reviewingUserId !== null}
                              leftIcon={<X size={14} color="#EF4444" />}
                              textClassName="text-red-500"
                              className="border border-red-200 bg-white"
                              onPress={() =>
                                handleReviewApplication(
                                  applicant.user_id,
                                  'reject',
                                )
                              }
                            />
                          </View>
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
            </Card>
          ) : null}

          <Card className="mb-4">
            <View className="mb-3 flex-row items-center justify-between">
              <View className="flex-row items-center gap-2">
                <Users size={16} color="#52525B" />
                <Text className="text-sm font-bold text-ink">
                  房间成员 ({activeMembers.length})
                </Text>
              </View>
              {permissions.isArchived ? (
                <Badge label="只读" variant="neutral" />
              ) : null}
            </View>

            <View className="gap-2.5">
              {activeMembers.map((member) => {
                const nickname = member.profiles?.nickname ?? '协作伙伴';
                const isSelf = member.user_id === currentUserId;
                const canToggleAdmin =
                  permissions.canManageAdmins &&
                  !isSelf &&
                  member.role !== 'host';
                const canKick = !isSelf && permissions.canKickTarget(member.role);

                return (
                  <View
                    key={member.id}
                    className="flex-row items-center justify-between rounded-2xl bg-surface px-3 py-2.5"
                  >
                    <View className="flex-1 flex-row items-center gap-2.5 pr-2">
                      <Avatar
                        nickname={nickname}
                        color={member.profiles?.avatar_color}
                        imageUrl={member.profiles?.avatar_url}
                        size="sm"
                      />
                      <View className="flex-1">
                        <View className="flex-row items-center gap-1.5">
                          <Text
                            className="text-sm font-semibold text-ink"
                            numberOfLines={1}
                          >
                            {nickname}
                            {isSelf ? '（我）' : ''}
                          </Text>
                          <Badge
                            label={ROLE_LABELS[member.role]}
                            variant={getRoleBadgeVariant(member.role)}
                          />
                        </View>
                      </View>
                    </View>

                    {canToggleAdmin || canKick ? (
                      <View className="flex-row items-center gap-1.5">
                        {canToggleAdmin ? (
                          <Pressable
                            accessibilityRole="button"
                            disabled={roleUpdatingUserId === member.user_id}
                            onPress={() => handleToggleAdminRole(member)}
                            className="flex-row items-center gap-1 rounded-xl border border-zinc-200 bg-white px-2.5 py-1.5 active:bg-zinc-100"
                          >
                            <Shield size={13} color="#52525B" />
                            <Text className="text-xs font-medium text-zinc-700">
                              {member.role === 'admin'
                                ? '取消管理'
                                : '设为管理'}
                            </Text>
                          </Pressable>
                        ) : null}

                        {canKick ? (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`移出 ${nickname}`}
                            onPress={() => setKickTarget(member)}
                            className="h-8 w-8 items-center justify-center rounded-xl border border-red-200 bg-red-50 active:bg-red-100"
                          >
                            <UserMinus size={14} color="#EF4444" />
                          </Pressable>
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          </Card>

          {permissions.canViewLogs ? (
            <Card
              onPress={() => router.push(`/room/${room.id}/logs` as Href)}
              className="mb-4"
            >
              <View className="flex-row items-center justify-between gap-3">
                <View className="flex-1 flex-row items-center gap-3">
                  <View className="h-10 w-10 items-center justify-center rounded-xl bg-primarySoft">
                    <FileText size={18} color="#F97316" />
                  </View>
                  <View className="flex-1">
                    <Text className="text-sm font-bold text-ink">
                      操作日志与防手滑撤销
                    </Text>
                    <Text className="mt-0.5 text-xs text-zinc-500">
                      {permissions.isArchived
                        ? '只读查看历史删除与成员变更记录'
                        : '查看删除、踢人记录，支持一键恢复误删条目'}
                    </Text>
                  </View>
                </View>
                <ChevronRight size={18} color="#A1A1AA" />
              </View>
            </Card>
          ) : null}

          {permissions.canArchiveRoom ? (
            <Card className="border-red-200/80 bg-red-50/40">
              <Text className="text-sm font-bold text-ink">活动归档</Text>
              <Text className="mt-1 text-xs leading-5 text-zinc-500">
                活动结束后归档房间，全员将转为只读模式，仍可随时查看并导出复盘长图与 PDF。
              </Text>
              <View className="mt-3">
                <Button
                  title="归档活动（归档后全员只读）"
                  variant="danger"
                  fullWidth
                  leftIcon={<Archive size={16} color="#FFFFFF" />}
                  onPress={() => setArchiveModalVisible(true)}
                />
              </View>
            </Card>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      <SheetModal
        visible={resetCodeModalVisible}
        onClose={() => setResetCodeModalVisible(false)}
        title="确认重置房间码？"
      >
        <Text className="mb-5 text-sm leading-6 text-zinc-600">
          重置后将立即生成新的 6 位房间码，旧房间码和历史邀请链接会立刻失效。已加入房间的成员不受影响。
        </Text>
        <View className="gap-2.5">
          <Button
            title="确认生成新房间码"
            variant="primary"
            fullWidth
            loading={resettingCode}
            onPress={handleConfirmResetCode}
          />
          <Button
            title="取消"
            variant="ghost"
            fullWidth
            onPress={() => setResetCodeModalVisible(false)}
          />
        </View>
      </SheetModal>

      <SheetModal
        visible={kickTarget !== null}
        onClose={() => setKickTarget(null)}
        title="确认移出成员？"
      >
        <Text className="mb-5 text-sm leading-6 text-zinc-600">
          确定将「{kickTarget?.profiles?.nickname ?? '该成员'}
          」移出房间吗？移出后对方将无法再通过房间码重新加入，操作会记入房间日志。
        </Text>
        <View className="gap-2.5">
          <Button
            title="确认移出房间"
            variant="danger"
            fullWidth
            loading={kicking}
            onPress={handleConfirmKick}
          />
          <Button
            title="取消"
            variant="ghost"
            fullWidth
            onPress={() => setKickTarget(null)}
          />
        </View>
      </SheetModal>

      <SheetModal
        visible={archiveModalVisible}
        onClose={() => setArchiveModalVisible(false)}
        title="确认归档此活动？"
      >
        <Text className="mb-5 text-sm leading-6 text-zinc-600">
          归档后房间将永久锁定为只读状态：全员不可再投票、认领任务、编辑日程、记账或审批成员，但仍可随时浏览内容并导出高清复盘长图与
          PDF。
        </Text>
        <View className="gap-2.5">
          <Button
            title="确认归档（不可撤销）"
            variant="danger"
            fullWidth
            loading={archiving}
            onPress={handleConfirmArchive}
          />
          <Button
            title="暂不归档"
            variant="ghost"
            fullWidth
            onPress={() => setArchiveModalVisible(false)}
          />
        </View>
      </SheetModal>
    </SafeAreaView>
  );
}
