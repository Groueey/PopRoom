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
  LogOut,
  RefreshCw,
  Share2,
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
  formatRoomEventWindow,
  kickRoomMember,
  leaveRoom,
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
import { MotionPressable } from '../../../src/components/ui/Motion';
import { OfflineSyncBanner } from '../../../src/components/ui/OfflineSyncBanner';
import { SheetModal } from '../../../src/components/ui/SheetModal';
import { useRoomPermissions } from '../../../src/hooks/useRoomPermissions';
import { QUERY_KEYS } from '../../../src/lib/queryClient';
import { buildShareMessage } from '../../../src/lib/roomCode';
import { resolveRoomScreenState } from '../../../src/lib/roomScreenState';
import { shareRoomInvite } from '../../../src/lib/shareInvite';
import { ROOM_TEMPLATES } from '../../../src/lib/templates';
import { THEME_COLORS } from '../../../src/lib/theme';
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

function formatIsoToDateTimeInput(iso: string | null): string {
  if (!iso) {
    return '';
  }
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    return '';
  }
  const date = new Date(ms);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
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
    chatEnabled: room?.chat_enabled ?? false,
  });

  const [titleDraft, setTitleDraft] = useState('');
  const [announcementDraft, setAnnouncementDraft] = useState('');
  const [joinModeDraft, setJoinModeDraft] = useState<JoinMode>('passcode');
  const [allowMemberCreatePollDraft, setAllowMemberCreatePollDraft] =
    useState(true);
  const [chatEnabledDraft, setChatEnabledDraft] = useState(false);
  const [eventStartDraft, setEventStartDraft] = useState('');
  const [eventEndDraft, setEventEndDraft] = useState('');
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

  const [leaveModalVisible, setLeaveModalVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!room) {
      return;
    }
    setTitleDraft(room.title);
    setAnnouncementDraft(room.announcement ?? '');
    setJoinModeDraft(room.join_mode);
    setAllowMemberCreatePollDraft(room.allow_member_create_poll);
    setChatEnabledDraft(room.chat_enabled);
    setEventStartDraft(formatIsoToDateTimeInput(room.event_start_at));
    setEventEndDraft(formatIsoToDateTimeInput(room.event_end_at));
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

  const handleShareInvite = async () => {
    if (!room) {
      return;
    }
    try {
      const inviteUrl = Linking.createURL('room/join', {
        queryParams: { code: room.room_code },
      });
      const outcome = await shareRoomInvite({
        title: room.title,
        roomCode: room.room_code,
        inviteUrl,
      });
      if (outcome === 'copied') {
        showToast('已复制邀请口令与链接', 'success');
      }
    } catch {
      showToast('分享失败，请使用复制口令手动分享', 'error');
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
        chat_enabled: chatEnabledDraft,
        event_start_at: eventStartDraft.trim() || null,
        event_end_at: eventEndDraft.trim() || null,
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

  const handleConfirmLeave = async () => {
    if (!room || !permissions.canLeaveRoom) {
      return;
    }
    setLeaving(true);
    try {
      const leftRoomId = room.id;
      await leaveRoom(leftRoomId);
      void queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.rooms(currentUserId ?? undefined),
      });
      setLeaveModalVisible(false);
      showToast('已退出该房间', 'success');
      router.replace('/(tabs)');
      setTimeout(() => {
        queryClient.removeQueries({
          queryKey: QUERY_KEYS.roomDetail(leftRoomId),
        });
      }, 300);
    } catch (err) {
      showToast(mapRoomError(err), 'error');
    } finally {
      setLeaving(false);
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
        <ActivityIndicator size="large" color={THEME_COLORS.primary} />
        <Text className="mt-3 text-xs text-inkMuted">正在加载房间设置...</Text>
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
          <AlertTriangle size={28} color={THEME_COLORS.danger} />
          <Text className="mt-3 text-base font-bold text-ink">{errorTitle}</Text>
          <Text className="mt-1.5 text-center text-xs text-inkMuted">
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
  const roomEventStartFormatted = formatIsoToDateTimeInput(room.event_start_at);
  const roomEventEndFormatted = formatIsoToDateTimeInput(room.event_end_at);
  const readOnlyEventWindow = formatRoomEventWindow(
    room.event_start_at,
    room.event_end_at,
  );
  const hasMetadataChanges =
    titleDraft.trim() !== room.title ||
    announcementDraft.trim() !== (room.announcement ?? '') ||
    joinModeDraft !== room.join_mode ||
    allowMemberCreatePollDraft !== room.allow_member_create_poll ||
    chatEnabledDraft !== room.chat_enabled ||
    eventStartDraft.trim() !== roomEventStartFormatted ||
    eventEndDraft.trim() !== roomEventEndFormatted;

  return (
    <SafeAreaView className="flex-1 bg-surface" edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View className="flex-row items-center justify-between border-b border-line bg-white px-4 py-3">
          <MotionPressable
            accessibilityRole="button"
            accessibilityLabel="返回房间"
            scaleTo={0.92}
            onPress={handleBack}
            className="h-9 w-9 items-center justify-center rounded-full bg-surface"
          >
            <ChevronLeft size={20} color={THEME_COLORS.ink} />
          </MotionPressable>
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
              tintColor={THEME_COLORS.primary}
              colors={[THEME_COLORS.primary]}
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
            <View className="mb-4 flex-row items-center gap-2.5 rounded-2xl border border-[#F5DFB3] bg-[#FEF7E8] px-4 py-3">
              <Archive size={18} color={THEME_COLORS.warning} />
              <View className="flex-1">
                <Text className="text-xs font-bold text-[#8C5210]">
                  活动已归档 · 全员只读模式
                </Text>
                <Text className="mt-0.5 text-xs text-[#A66214]">
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

            <View className="mb-3 items-center rounded-2xl border border-primaryBorder bg-primarySoft py-4">
              <Text className="text-3xl font-extrabold tracking-[8px] text-primaryDeep">
                {room.room_code}
              </Text>
              <Text className="mt-1 text-xs text-inkMuted">
                {permissions.isArchived
                  ? '房间已归档，不再接受新成员加入'
                  : '把口令发给伙伴，在活动大厅输入即可入房'}
              </Text>
            </View>

            {!permissions.isArchived ? (
              <View className="gap-2.5">
                <View className="flex-row gap-2.5">
                  <View className="flex-1">
                    <Button
                      title="分享邀请"
                      variant="primary"
                      size="md"
                      fullWidth
                      leftIcon={<Share2 size={16} color="#FFFFFF" />}
                      onPress={handleShareInvite}
                    />
                  </View>
                  <View className="flex-1">
                    <Button
                      title="复制口令"
                      variant="secondary"
                      size="md"
                      fullWidth
                      leftIcon={<Copy size={16} color={THEME_COLORS.primaryDeep} />}
                      onPress={handleCopyInvite}
                    />
                  </View>
                </View>
                {permissions.canResetRoomCode ? (
                  <Button
                    title="重置房间码"
                    variant="ghost"
                    size="md"
                    fullWidth
                    leftIcon={<RefreshCw size={16} color={THEME_COLORS.inkMuted} />}
                    className="border border-line bg-white"
                    onPress={() => setResetCodeModalVisible(true)}
                  />
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
                    <Text className="text-xs font-semibold text-inkMuted">
                      房间名称
                    </Text>
                    <Text className="text-xs text-inkSubtle">
                      {titleLen}/{MAX_ROOM_TITLE_LENGTH}
                    </Text>
                  </View>
                  <TextInput
                    value={titleDraft}
                    onChangeText={setTitleDraft}
                    maxLength={MAX_ROOM_TITLE_LENGTH}
                    placeholder="输入房间名称"
                    placeholderTextColor={THEME_COLORS.inkSubtle}
                    className="rounded-2xl border border-line bg-surface px-4 py-2.5 text-sm text-ink"
                  />
                </View>

                <View className="mb-3.5">
                  <Text className="mb-1.5 text-xs font-semibold text-inkMuted">
                    房间公告
                  </Text>
                  <TextInput
                    value={announcementDraft}
                    onChangeText={setAnnouncementDraft}
                    placeholder="填写集合时间、地点或规则提示"
                    placeholderTextColor={THEME_COLORS.inkSubtle}
                    multiline
                    numberOfLines={3}
                    textAlignVertical="top"
                    maxLength={300}
                    className="min-h-[76px] rounded-2xl border border-line bg-surface px-4 py-2.5 text-sm text-ink"
                  />
                </View>

                <View className="mb-3.5">
                  <Text className="mb-2 text-xs font-semibold text-inkMuted">
                    进房门禁方式
                  </Text>
                  <View className="flex-row gap-2.5">
                    {(['passcode', 'approval'] as const).map((mode) => {
                      const selected = joinModeDraft === mode;
                      return (
                        <MotionPressable
                          key={mode}
                          accessibilityRole="radio"
                          accessibilityState={{ selected }}
                          flex
                          scaleTo={0.96}
                          onPress={() => setJoinModeDraft(mode)}
                          className={`flex-row items-center justify-center gap-1.5 rounded-xl border py-2.5 ${
                            selected
                              ? 'border-primary bg-primarySoft'
                              : 'border-line bg-surface'
                          }`}
                        >
                          {mode === 'passcode' ? (
                            <Unlock
                              size={15}
                              color={
                                selected ? THEME_COLORS.primaryDeep : THEME_COLORS.inkMuted
                              }
                            />
                          ) : (
                            <Lock
                              size={15}
                              color={
                                selected ? THEME_COLORS.primaryDeep : THEME_COLORS.inkMuted
                              }
                            />
                          )}
                          <Text
                            className={`text-xs font-semibold ${
                              selected ? 'text-primaryDeep' : 'text-inkMuted'
                            }`}
                          >
                            {JOIN_MODE_LABELS[mode]}
                          </Text>
                        </MotionPressable>
                      );
                    })}
                  </View>
                </View>

                <View className="mb-3.5 flex-row items-center justify-between rounded-2xl border border-lineSoft bg-surface px-3.5 py-2.5">
                  <View className="flex-1 pr-3">
                    <Text className="text-xs font-semibold text-ink">
                      允许普通成员发起新投票
                    </Text>
                    <Text className="mt-0.5 text-[11px] text-inkMuted">
                      关闭后仅房主与管理员可新增投票积木
                    </Text>
                  </View>
                  <Switch
                    value={allowMemberCreatePollDraft}
                    disabled={!permissions.canEditRoomSettings}
                    onValueChange={setAllowMemberCreatePollDraft}
                    trackColor={{
                      false: THEME_COLORS.switchOffTrack,
                      true: THEME_COLORS.primaryBorder,
                    }}
                    thumbColor={
                      allowMemberCreatePollDraft
                        ? THEME_COLORS.primary
                        : THEME_COLORS.switchOffThumb
                    }
                  />
                </View>

                <View className="mb-3.5 flex-row items-center justify-between rounded-2xl border border-lineSoft bg-surface px-3.5 py-2.5">
                  <View className="flex-1 pr-3">
                    <Text className="text-xs font-semibold text-ink">
                      开启房间聊天室
                    </Text>
                    <Text className="mt-0.5 text-[11px] text-inkMuted">
                      开启后房间内显示「协作看板 | 聊天室」双 Tab，支持 @提醒 与聊完转积木
                    </Text>
                  </View>
                  <Switch
                    accessibilityLabel="开启房间聊天室"
                    value={chatEnabledDraft}
                    disabled={!permissions.canEditRoomSettings}
                    onValueChange={setChatEnabledDraft}
                    trackColor={{
                      false: THEME_COLORS.switchOffTrack,
                      true: THEME_COLORS.primaryBorder,
                    }}
                    thumbColor={
                      chatEnabledDraft
                        ? THEME_COLORS.primary
                        : THEME_COLORS.switchOffThumb
                    }
                  />
                </View>

                <View className="mb-4">
                  <View className="mb-1.5 flex-row items-center justify-between">
                    <Text className="text-xs font-semibold text-inkMuted">
                      活动开始时间
                    </Text>
                    {eventStartDraft || eventEndDraft ? (
                      <MotionPressable
                        scaleTo={0.94}
                        onPress={() => {
                          setEventStartDraft('');
                          setEventEndDraft('');
                        }}
                      >
                        <Text className="text-xs font-medium text-primaryDeep">
                          清空时间
                        </Text>
                      </MotionPressable>
                    ) : null}
                  </View>
                  <TextInput
                    value={eventStartDraft}
                    onChangeText={setEventStartDraft}
                    editable={permissions.canEditRoomSettings}
                    placeholder="YYYY-MM-DD HH:mm，留空则不限制"
                    placeholderTextColor={THEME_COLORS.inkSubtle}
                    autoCapitalize="none"
                    className="mb-3 rounded-2xl border border-line bg-surface px-4 py-2.5 text-sm text-ink"
                  />

                  <Text className="mb-1.5 text-xs font-semibold text-inkMuted">
                    活动结束时间
                  </Text>
                  <TextInput
                    value={eventEndDraft}
                    onChangeText={setEventEndDraft}
                    editable={permissions.canEditRoomSettings}
                    placeholder="YYYY-MM-DD HH:mm，留空则不限制"
                    placeholderTextColor={THEME_COLORS.inkSubtle}
                    autoCapitalize="none"
                    className="rounded-2xl border border-line bg-surface px-4 py-2.5 text-sm text-ink"
                  />
                  <Text className="mt-1.5 text-[11px] leading-4 text-inkSubtle">
                    设置活动结束时间后，超过 7 天系统将自动归档为只读
                  </Text>
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
                  <Text className="text-xs text-inkSubtle">房间名称</Text>
                  <Text className="mt-0.5 text-sm font-semibold text-ink">
                    {room.title}
                  </Text>
                </View>
                <View>
                  <Text className="text-xs text-inkSubtle">房间公告</Text>
                  <Text className="mt-0.5 text-sm text-inkMuted">
                    {room.announcement || '暂无公告'}
                  </Text>
                </View>
                <View className="flex-row items-center justify-between pt-1">
                  <Text className="text-xs text-inkSubtle">房间聊天室</Text>
                  <Badge
                    label={room.chat_enabled ? '已开启' : '未开启'}
                    variant={room.chat_enabled ? 'primary' : 'neutral'}
                  />
                </View>
                {readOnlyEventWindow ? (
                  <View>
                    <Text className="text-xs text-inkSubtle">活动时间</Text>
                    <Text className="mt-0.5 text-sm text-inkMuted">
                      {readOnlyEventWindow}
                    </Text>
                  </View>
                ) : null}
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
                <Text className="py-2 text-xs text-inkSubtle">
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
                        className="rounded-2xl border border-line bg-primaryMist p-3"
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
                              <Text className="mt-0.5 text-xs text-inkMuted">
                                备注：{applicant.apply_note}
                              </Text>
                            ) : (
                              <Text className="mt-0.5 text-xs text-inkSubtle">
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
                              leftIcon={<X size={14} color={THEME_COLORS.danger} />}
                              textClassName="text-[#C94545]"
                              className="border border-[#FAD2D0] bg-white"
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
                <Users size={16} color={THEME_COLORS.inkMuted} />
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
                    className="flex-row items-center justify-between rounded-2xl border border-lineSoft bg-primaryMist px-3 py-2.5"
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
                          <MotionPressable
                            accessibilityRole="button"
                            disabled={roleUpdatingUserId === member.user_id}
                            scaleTo={0.94}
                            onPress={() => handleToggleAdminRole(member)}
                            className="flex-row items-center gap-1 rounded-xl border border-line bg-white px-2.5 py-1.5"
                          >
                            <Shield size={13} color={THEME_COLORS.inkMuted} />
                            <Text className="text-xs font-medium text-inkMuted">
                              {member.role === 'admin'
                                ? '取消管理'
                                : '设为管理'}
                            </Text>
                          </MotionPressable>
                        ) : null}

                        {canKick ? (
                          <MotionPressable
                            accessibilityRole="button"
                            accessibilityLabel={`移出 ${nickname}`}
                            scaleTo={0.9}
                            onPress={() => setKickTarget(member)}
                            className="h-8 w-8 items-center justify-center rounded-xl border border-[#FAD2D0] bg-[#FEF2F2]"
                          >
                            <UserMinus size={14} color={THEME_COLORS.danger} />
                          </MotionPressable>
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
                  <View className="h-10 w-10 items-center justify-center rounded-xl border border-primaryBorder bg-primarySoft">
                    <FileText size={18} color={THEME_COLORS.primary} />
                  </View>
                  <View className="flex-1">
                    <Text className="text-sm font-bold text-ink">
                      操作日志与防手滑撤销
                    </Text>
                    <Text className="mt-0.5 text-xs text-inkMuted">
                      {permissions.isArchived
                        ? '只读查看历史删除与成员变更记录'
                        : '查看删除、踢人记录，支持一键恢复误删条目'}
                    </Text>
                  </View>
                </View>
                <ChevronRight size={18} color={THEME_COLORS.inkSubtle} />
              </View>
            </Card>
          ) : null}

          {permissions.canArchiveRoom ? (
            <Card className="border-[#FAD2D0] bg-[#FEF2F2]/60">
              <Text className="text-sm font-bold text-ink">活动归档</Text>
              <Text className="mt-1 text-xs leading-5 text-inkMuted">
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

          {permissions.canLeaveRoom ? (
            <Card className="border-[#FAD2D0] bg-white">
              <Text className="text-sm font-bold text-ink">退出房间</Text>
              <Text className="mt-1 text-xs leading-5 text-inkMuted">
                退出后你将离开此房间，后续可凭有效房间码重新加入。
              </Text>
              <View className="mt-3">
                <Button
                  title="退出房间"
                  variant="ghost"
                  fullWidth
                  leftIcon={<LogOut size={16} color={THEME_COLORS.danger} />}
                  textClassName="text-[#C94545] font-semibold"
                  className="border border-[#FAD2D0] bg-[#FEF2F2]/60"
                  onPress={() => setLeaveModalVisible(true)}
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
        <Text className="mb-5 text-sm leading-6 text-inkMuted">
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
        <Text className="mb-5 text-sm leading-6 text-inkMuted">
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
        <Text className="mb-5 text-sm leading-6 text-inkMuted">
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

      <SheetModal
        visible={leaveModalVisible}
        onClose={() => setLeaveModalVisible(false)}
        title="确认退出该房间？"
      >
        <Text className="mb-5 text-sm leading-6 text-inkMuted">
          退出后你将离开此房间，后续可凭有效房间码重新加入
        </Text>
        <View className="gap-2.5">
          <Button
            title="确认退出房间"
            variant="danger"
            fullWidth
            loading={leaving}
            onPress={handleConfirmLeave}
          />
          <Button
            title="取消"
            variant="ghost"
            fullWidth
            onPress={() => setLeaveModalVisible(false)}
          />
        </View>
      </SheetModal>
    </SafeAreaView>
  );
}
