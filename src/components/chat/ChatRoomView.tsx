import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import {
  Archive,
  AtSign,
  Ban,
  CalendarClock,
  CheckSquare,
  Copy,
  Flag,
  Lock,
  Megaphone,
  MessageCircle,
  Send,
  Trash2,
  X,
} from 'lucide-react-native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  blockUser,
  reportRoomMessage,
  sendRoomMessage,
  softDeleteRoomMessage,
} from '../../api/chat';
import {
  ROLE_LABELS,
  detectRoomErrorCode,
  mapRoomError,
} from '../../api/rooms';
import type { RoomPermissions } from '../../hooks/useRoomPermissions';
import {
  MAX_CHAT_MESSAGE_LENGTH,
  MAX_REPORT_REASON_LENGTH,
  type ParsedRoomMessage,
  REPORT_REASON_PRESETS,
  appendOptimisticChatMessage,
  filterVisibleChatMessages,
  formatChatTimestamp,
  isCurrentUserMentioned,
  validateChatMessageInput,
  validateReportReasonInput,
} from '../../lib/chatHelpers';
import { QUERY_KEYS } from '../../lib/queryClient';
import { CARD_SHADOW, THEME_COLORS } from '../../lib/theme';
import { useAuthStore } from '../../stores/authStore';
import { useUiStore } from '../../stores/uiStore';
import type {
  BlockedUserWithProfile,
  ProfileSummary,
  RoomMemberWithProfile,
} from '../../types/database';
import { Avatar } from '../ui/Avatar';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { AnimatedCheckBadge, MotionPressable } from '../ui/Motion';
import { SheetModal } from '../ui/SheetModal';
import { BlockReminderCard } from './BlockReminderCard';

/** Props for the room-scoped real-time chat stream & composer view. */
export interface ChatRoomViewProps {
  roomId: string;
  messages: readonly ParsedRoomMessage[];
  blockedUserIds: ReadonlySet<string>;
  members: readonly RoomMemberWithProfile[];
  permissions: RoomPermissions;
  loading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onJumpToBlock: (blockId: string) => void;
  onConvertMessageToBlock: (
    message: ParsedRoomMessage,
    target: 'task' | 'schedule',
  ) => void;
}

interface SendMessageVariables {
  content: string;
  mentionAll: boolean;
  mentionUserIds: string[];
  tempId: string;
}

interface SendMessageContext {
  previousMessages: ParsedRoomMessage[] | undefined;
  previousText: string;
  previousMentionAll: boolean;
  previousMentionUserIds: string[];
}

interface BlockUserVariables {
  targetUserId: string;
  targetProfile: ProfileSummary | null;
}

interface BlockUserContext {
  previousBlocks: BlockedUserWithProfile[] | undefined;
}

interface DeleteMessageContext {
  previousMessages: ParsedRoomMessage[] | undefined;
}

interface ReportMessageVariables {
  messageId: string;
  reason: string;
}

/**
 * Room chat view with chronological stream, structured block reminder cards,
 * `@` mentions, message-to-block conversion, and App Store UGC compliance
 * (copy, report, instant local block, and soft-delete).
 */
export function ChatRoomView({
  roomId,
  messages,
  blockedUserIds,
  members,
  permissions,
  loading,
  refreshing,
  onRefresh,
  onJumpToBlock,
  onConvertMessageToBlock,
}: ChatRoomViewProps) {
  const session = useAuthStore((state) => state.session);
  const profile = useAuthStore((state) => state.profile);
  const currentUserId = session?.user.id ?? null;
  const showToast = useUiStore((state) => state.showToast);
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();

  const flatListRef = useRef<FlatList<ParsedRoomMessage>>(null);
  const prevVisibleCountRef = useRef(0);

  const [composerText, setComposerText] = useState('');
  const [mentionAll, setMentionAll] = useState(false);
  const [mentionUserIds, setMentionUserIds] = useState<string[]>([]);
  const [mentionPickerVisible, setMentionPickerVisible] = useState(false);

  const [actionMessage, setActionMessage] = useState<ParsedRoomMessage | null>(
    null,
  );
  const [reportTarget, setReportTarget] = useState<ParsedRoomMessage | null>(
    null,
  );
  const [selectedReportPreset, setSelectedReportPreset] = useState<
    string | null
  >(null);
  const [customReportReason, setCustomReportReason] = useState('');
  const [blockTarget, setBlockTarget] = useState<ParsedRoomMessage | null>(
    null,
  );
  const [deleteTarget, setDeleteTarget] = useState<ParsedRoomMessage | null>(
    null,
  );

  const memberProfileMap = useMemo(() => {
    const map = new Map<string, ProfileSummary>();
    for (const member of members) {
      if (member.profiles) {
        map.set(member.user_id, member.profiles);
      }
    }
    if (profile) {
      map.set(profile.id, {
        id: profile.id,
        nickname: profile.nickname,
        avatar_color: profile.avatar_color,
        avatar_url: profile.avatar_url,
      });
    }
    return map;
  }, [members, profile]);

  const currentSenderProfile = useMemo<ProfileSummary | null>(() => {
    if (profile) {
      return {
        id: profile.id,
        nickname: profile.nickname,
        avatar_color: profile.avatar_color,
        avatar_url: profile.avatar_url,
      };
    }
    if (currentUserId) {
      return memberProfileMap.get(currentUserId) ?? null;
    }
    return null;
  }, [profile, currentUserId, memberProfileMap]);

  const mentionableMembers = useMemo(
    () =>
      members.filter(
        (member) =>
          member.status === 'active' && member.user_id !== currentUserId,
      ),
    [members, currentUserId],
  );

  const visibleMessages = useMemo(
    () => filterVisibleChatMessages(messages, blockedUserIds),
    [messages, blockedUserIds],
  );

  useEffect(() => {
    const currentCount = visibleMessages.length;
    const previousCount = prevVisibleCountRef.current;
    prevVisibleCountRef.current = currentCount;

    if (currentCount > previousCount && currentCount > 0) {
      const timer = setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: previousCount > 0 });
      }, 40);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [visibleMessages.length]);

  const effectiveMentionAll = permissions.canMentionAll && mentionAll;
  const hasSelectedMentions = effectiveMentionAll || mentionUserIds.length > 0;

  const resolveSenderProfile = useCallback(
    (msg: ParsedRoomMessage): ProfileSummary | null =>
      msg.profiles ?? memberProfileMap.get(msg.sender_id) ?? null,
    [memberProfileMap],
  );

  const resolveSenderName = useCallback(
    (msg: ParsedRoomMessage): string => {
      const sender = resolveSenderProfile(msg);
      if (sender?.nickname?.trim()) {
        return sender.nickname.trim();
      }
      if (currentUserId !== null && msg.sender_id === currentUserId) {
        return '我';
      }
      return '成员';
    },
    [resolveSenderProfile, currentUserId],
  );

  const sendMutation = useMutation<
    ParsedRoomMessage,
    unknown,
    SendMessageVariables,
    SendMessageContext
  >({
    mutationFn: (vars) =>
      sendRoomMessage({
        roomId,
        msgType: 'text',
        content: vars.content,
        metadata: {
          mentionAll: vars.mentionAll,
          mentionUserIds: vars.mentionUserIds,
        },
      }),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({
        queryKey: QUERY_KEYS.roomMessages(roomId),
      });
      const previousMessages = queryClient.getQueryData<ParsedRoomMessage[]>(
        QUERY_KEYS.roomMessages(roomId),
      );

      if (currentUserId) {
        queryClient.setQueryData<ParsedRoomMessage[]>(
          QUERY_KEYS.roomMessages(roomId),
          (old) =>
            appendOptimisticChatMessage(old ?? [], {
              tempId: vars.tempId,
              roomId,
              senderId: currentUserId,
              senderProfile: currentSenderProfile,
              content: vars.content,
              mentionAll: vars.mentionAll,
              mentionUserIds: vars.mentionUserIds,
            }),
        );
      }

      return {
        previousMessages,
        previousText: vars.content,
        previousMentionAll: vars.mentionAll,
        previousMentionUserIds: vars.mentionUserIds,
      };
    },
    onError: (err, vars, context) => {
      if (context?.previousMessages !== undefined) {
        queryClient.setQueryData<ParsedRoomMessage[]>(
          QUERY_KEYS.roomMessages(roomId),
          context.previousMessages,
        );
      } else {
        queryClient.setQueryData<ParsedRoomMessage[]>(
          QUERY_KEYS.roomMessages(roomId),
          (old) => (old ?? []).filter((item) => item.id !== vars.tempId),
        );
      }

      const errorCode = detectRoomErrorCode(err);
      if (errorCode === 'CHAT_DISABLED' || errorCode === 'ROOM_ARCHIVED') {
        void queryClient.invalidateQueries({
          queryKey: QUERY_KEYS.roomDetail(roomId),
        });
      } else if (context) {
        setComposerText((prev) => (prev.trim() ? prev : context.previousText));
        if (context.previousMentionAll) {
          setMentionAll(true);
        }
        if (context.previousMentionUserIds.length > 0) {
          setMentionUserIds((prev) =>
            prev.length > 0 ? prev : context.previousMentionUserIds,
          );
        }
      }

      showToast(mapRoomError(err), 'error');
    },
    onSuccess: (serverMessage, vars) => {
      const hydrated: ParsedRoomMessage = serverMessage.profiles
        ? serverMessage
        : {
            ...serverMessage,
            profiles: currentSenderProfile,
          };

      queryClient.setQueryData<ParsedRoomMessage[]>(
        QUERY_KEYS.roomMessages(roomId),
        (old) => {
          const filtered = (old ?? []).filter(
            (item) => item.id !== vars.tempId && item.id !== hydrated.id,
          );
          return [...filtered, hydrated].sort((a, b) => {
            const timeA = Date.parse(a.created_at);
            const timeB = Date.parse(b.created_at);
            if (!Number.isNaN(timeA) && !Number.isNaN(timeB) && timeA !== timeB) {
              return timeA - timeB;
            }
            return a.created_at.localeCompare(b.created_at);
          });
        },
      );

      void queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.roomMessages(roomId),
      });
      if (currentUserId) {
        void queryClient.invalidateQueries({
          queryKey: QUERY_KEYS.roomChatRead(roomId, currentUserId),
        });
      }
    },
  });

  const reportMutation = useMutation<void, unknown, ReportMessageVariables>({
    mutationFn: ({ messageId, reason }) => reportRoomMessage(messageId, reason),
    onSuccess: () => {
      setReportTarget(null);
      setSelectedReportPreset(null);
      setCustomReportReason('');
      showToast('已提交举报，感谢反馈', 'success');
    },
    onError: (err) => {
      showToast(mapRoomError(err), 'error');
    },
  });

  const blockMutation = useMutation<
    void,
    unknown,
    BlockUserVariables,
    BlockUserContext
  >({
    mutationFn: async ({ targetUserId }) => {
      if (!currentUserId) {
        throw new Error('NOT_AUTHENTICATED');
      }
      await blockUser(currentUserId, targetUserId);
    },
    onMutate: async ({ targetUserId, targetProfile }) => {
      if (!currentUserId) {
        return { previousBlocks: undefined };
      }

      const blocksKey = QUERY_KEYS.userBlocks(currentUserId);
      await queryClient.cancelQueries({ queryKey: blocksKey });
      const previousBlocks =
        queryClient.getQueryData<BlockedUserWithProfile[]>(blocksKey);

      const optimisticEntry: BlockedUserWithProfile = {
        blocker_id: currentUserId,
        blocked_id: targetUserId,
        created_at: new Date().toISOString(),
        profiles: targetProfile,
      };

      queryClient.setQueryData<BlockedUserWithProfile[]>(blocksKey, (old) => {
        const list = old ?? [];
        if (list.some((entry) => entry.blocked_id === targetUserId)) {
          return list;
        }
        return [optimisticEntry, ...list];
      });

      return { previousBlocks };
    },
    onError: (err, _vars, context) => {
      if (currentUserId && context?.previousBlocks !== undefined) {
        queryClient.setQueryData<BlockedUserWithProfile[]>(
          QUERY_KEYS.userBlocks(currentUserId),
          context.previousBlocks,
        );
      }
      showToast(mapRoomError(err), 'error');
    },
    onSuccess: (_data, { targetUserId, targetProfile }) => {
      setBlockTarget(null);
      if (currentUserId) {
        const blocksKey = QUERY_KEYS.userBlocks(currentUserId);
        queryClient.setQueryData<BlockedUserWithProfile[]>(blocksKey, (old) => {
          const list = old ?? [];
          if (list.some((entry) => entry.blocked_id === targetUserId)) {
            return list;
          }
          return [
            {
              blocker_id: currentUserId,
              blocked_id: targetUserId,
              created_at: new Date().toISOString(),
              profiles: targetProfile,
            },
            ...list,
          ];
        });
        void queryClient.invalidateQueries({ queryKey: blocksKey });
      }
      void queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.roomMessages(roomId),
      });
      showToast('已屏蔽该用户，后续可在「我的」解除', 'success');
    },
  });

  const deleteMutation = useMutation<
    void,
    unknown,
    string,
    DeleteMessageContext
  >({
    mutationFn: (messageId) => softDeleteRoomMessage(messageId),
    onMutate: async (messageId) => {
      const messagesKey = QUERY_KEYS.roomMessages(roomId);
      await queryClient.cancelQueries({ queryKey: messagesKey });
      const previousMessages =
        queryClient.getQueryData<ParsedRoomMessage[]>(messagesKey);
      queryClient.setQueryData<ParsedRoomMessage[]>(messagesKey, (old) =>
        (old ?? []).filter((item) => item.id !== messageId),
      );
      return { previousMessages };
    },
    onError: (err, _messageId, context) => {
      if (context?.previousMessages !== undefined) {
        queryClient.setQueryData<ParsedRoomMessage[]>(
          QUERY_KEYS.roomMessages(roomId),
          context.previousMessages,
        );
      }
      showToast(mapRoomError(err), 'error');
    },
    onSuccess: () => {
      setDeleteTarget(null);
      void queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.roomMessages(roomId),
      });
      void queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.activityLogs(roomId),
      });
      showToast('已删除该消息', 'success');
    },
  });

  const handleSendMessage = useCallback(() => {
    if (!permissions.canSendChatMessage || !currentUserId || sendMutation.isPending) {
      return;
    }

    let validatedContent: string;
    try {
      validatedContent = validateChatMessageInput(composerText);
    } catch (err) {
      showToast(mapRoomError(err), 'error');
      return;
    }

    const nextMentionAll = effectiveMentionAll;
    const nextMentionUserIds = [...mentionUserIds];
    const tempId = `optimistic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    setComposerText('');
    setMentionAll(false);
    setMentionUserIds([]);

    sendMutation.mutate({
      content: validatedContent,
      mentionAll: nextMentionAll,
      mentionUserIds: nextMentionUserIds,
      tempId,
    });
  }, [
    permissions.canSendChatMessage,
    currentUserId,
    sendMutation,
    composerText,
    effectiveMentionAll,
    mentionUserIds,
    showToast,
  ]);

  const handleToggleMentionUser = useCallback((userId: string) => {
    setMentionUserIds((prev) =>
      prev.includes(userId)
        ? prev.filter((id) => id !== userId)
        : [...prev, userId],
    );
  }, []);

  const handleOpenMessageActions = useCallback((msg: ParsedRoomMessage) => {
    if (msg.optimistic || msg.msg_type === 'system') {
      return;
    }
    setActionMessage(msg);
  }, []);

  const handleCopyMessage = useCallback(
    async (msg: ParsedRoomMessage) => {
      try {
        await Clipboard.setStringAsync(msg.content);
        setActionMessage(null);
        showToast('已复制消息内容', 'success');
      } catch {
        showToast('复制失败，请稍后重试', 'error');
      }
    },
    [showToast],
  );

  const handleSubmitReport = useCallback(() => {
    if (!reportTarget || reportMutation.isPending) {
      return;
    }

    const customTrimmed = customReportReason.trim();
    let combinedReason = customTrimmed;
    if (selectedReportPreset) {
      if (selectedReportPreset === '其他原因') {
        combinedReason = customTrimmed || selectedReportPreset;
      } else {
        combinedReason = customTrimmed
          ? `${selectedReportPreset}：${customTrimmed}`
          : selectedReportPreset;
      }
    }

    let validatedReason: string;
    try {
      validatedReason = validateReportReasonInput(combinedReason);
    } catch (err) {
      showToast(mapRoomError(err), 'error');
      return;
    }

    reportMutation.mutate({
      messageId: reportTarget.id,
      reason: validatedReason,
    });
  }, [
    reportTarget,
    reportMutation,
    customReportReason,
    selectedReportPreset,
    showToast,
  ]);

  const handleConfirmBlock = useCallback(() => {
    if (!blockTarget || blockMutation.isPending) {
      return;
    }
    blockMutation.mutate({
      targetUserId: blockTarget.sender_id,
      targetProfile: resolveSenderProfile(blockTarget),
    });
  }, [blockTarget, blockMutation, resolveSenderProfile]);

  const handleConfirmDelete = useCallback(() => {
    if (!deleteTarget || deleteMutation.isPending) {
      return;
    }
    deleteMutation.mutate(deleteTarget.id);
  }, [deleteTarget, deleteMutation]);

  const renderMessageItem = useCallback(
    ({ item: msg }: { item: ParsedRoomMessage }) => {
      if (msg.msg_type === 'system') {
        return (
          <View className="my-2 items-center px-4">
            <View className="rounded-full bg-lineSoft px-3.5 py-1.5">
              <Text className="text-center text-[11px] font-medium text-inkMuted">
                {msg.content}
              </Text>
            </View>
          </View>
        );
      }

      const senderProfile = resolveSenderProfile(msg);
      const senderName = resolveSenderName(msg);
      const timestamp = formatChatTimestamp(msg.created_at);
      const isMine = currentUserId !== null && msg.sender_id === currentUserId;
      const mentionedMe = isCurrentUserMentioned(msg.metadata, currentUserId);

      if (msg.msg_type === 'block_card') {
        return (
          <View className="mb-3.5">
            <View className="mb-1.5 flex-row items-center gap-2 px-1">
              <Avatar
                nickname={senderProfile?.nickname ?? senderName}
                color={senderProfile?.avatar_color}
                imageUrl={senderProfile?.avatar_url}
                size="xs"
              />
              <Text className="text-xs font-semibold text-inkMuted">
                {senderName}
              </Text>
              {timestamp ? (
                <Text className="text-[11px] text-inkSubtle">{timestamp}</Text>
              ) : null}
            </View>
            <Pressable
              onLongPress={() => handleOpenMessageActions(msg)}
              delayLongPress={260}
              accessibilityHint="长按可打开消息操作菜单"
            >
              <BlockReminderCard
                metadata={msg.metadata}
                content={msg.content}
                onPressBlock={onJumpToBlock}
              />
            </Pressable>
          </View>
        );
      }

      const mentionDisplayNames = msg.metadata.mentionUserIds
        .map((uid) => memberProfileMap.get(uid)?.nickname?.trim())
        .filter((name): name is string => Boolean(name));

      return (
        <View
          className={`mb-3.5 flex-row items-start gap-2.5 ${
            isMine ? 'justify-end' : 'justify-start'
          }`}
        >
          {!isMine ? (
            <Avatar
              nickname={senderProfile?.nickname ?? senderName}
              color={senderProfile?.avatar_color}
              imageUrl={senderProfile?.avatar_url}
              size="sm"
              className="mt-0.5"
            />
          ) : null}

          <View
            className={`max-w-[78%] ${isMine ? 'items-end' : 'items-start'}`}
          >
            <View
              className={`mb-1 flex-row flex-wrap items-center gap-1.5 ${
                isMine ? 'justify-end' : 'justify-start'
              }`}
            >
              {!isMine ? (
                <Text className="text-xs font-semibold text-inkMuted">
                  {senderName}
                </Text>
              ) : null}
              {timestamp ? (
                <Text className="text-[11px] text-inkSubtle">{timestamp}</Text>
              ) : null}
              {mentionedMe ? (
                <Badge
                  label={msg.metadata.mentionAll ? '@全体成员' : '@了你'}
                  variant={msg.metadata.mentionAll ? 'primary' : 'warning'}
                  size="sm"
                />
              ) : null}
            </View>

            <Pressable
              disabled={msg.optimistic}
              onLongPress={() => handleOpenMessageActions(msg)}
              delayLongPress={260}
              accessibilityHint={
                msg.optimistic ? undefined : '长按可打开消息操作菜单'
              }
              style={isMine ? undefined : CARD_SHADOW}
              className={`rounded-2xl px-3.5 py-2.5 ${
                isMine
                  ? 'rounded-tr-sm bg-primary'
                  : 'rounded-tl-sm border border-line bg-white'
              } ${msg.optimistic ? 'opacity-75' : ''}`}
            >
              {!msg.metadata.mentionAll && mentionDisplayNames.length > 0 ? (
                <Text
                  className={`mb-1 text-xs font-semibold ${
                    isMine ? 'text-white/90' : 'text-primaryDeep'
                  }`}
                >
                  {mentionDisplayNames.map((name) => `@${name}`).join(' ')}
                </Text>
              ) : null}
              <Text
                className={`text-[14px] leading-5 ${
                  isMine ? 'text-white' : 'text-ink'
                }`}
              >
                {msg.content}
              </Text>
            </Pressable>

            {msg.optimistic ? (
              <View className="mt-1 flex-row items-center gap-1">
                <ActivityIndicator size="small" color={THEME_COLORS.inkSubtle} />
                <Text className="text-[11px] text-inkSubtle">发送中...</Text>
              </View>
            ) : null}
          </View>

          {isMine ? (
            <Avatar
              nickname={senderProfile?.nickname ?? senderName}
              color={senderProfile?.avatar_color}
              imageUrl={senderProfile?.avatar_url}
              size="sm"
              className="mt-0.5"
            />
          ) : null}
        </View>
      );
    },
    [
      resolveSenderProfile,
      resolveSenderName,
      currentUserId,
      handleOpenMessageActions,
      onJumpToBlock,
      memberProfileMap,
    ],
  );

  const composerBottomPadding = Math.max(insets.bottom, 10);
  const canSubmitComposer =
    permissions.canSendChatMessage &&
    composerText.trim().length > 0 &&
    !sendMutation.isPending;

  const canConvertActionMessage =
    actionMessage !== null &&
    actionMessage.msg_type === 'text' &&
    !permissions.isReadOnly;
  const canReportActionMessage =
    actionMessage !== null &&
    permissions.canReportChatMessage(actionMessage.sender_id);
  const canBlockActionMessage =
    actionMessage !== null && permissions.canBlockUser(actionMessage.sender_id);
  const canDeleteActionMessage =
    actionMessage !== null &&
    permissions.canDeleteChatMessage(actionMessage.sender_id);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 96 : 0}
      className="flex-1 bg-surface"
    >
      {loading && visibleMessages.length === 0 ? (
        <View className="flex-1 items-center justify-center gap-2.5 px-6">
          <ActivityIndicator size="small" color={THEME_COLORS.primary} />
          <Text className="text-xs font-medium text-inkMuted">
            正在加载聊天记录...
          </Text>
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={visibleMessages}
          keyExtractor={(item) => item.id}
          renderItem={renderMessageItem}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            flexGrow: 1,
            paddingHorizontal: 16,
            paddingTop: 14,
            paddingBottom: 16,
          }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={THEME_COLORS.primary}
              colors={[THEME_COLORS.primary]}
            />
          }
          ListEmptyComponent={
            <View className="flex-1 items-center justify-center px-8 py-16">
              <View className="mb-3 h-14 w-14 items-center justify-center rounded-2xl border border-primaryBorder bg-primarySoft">
                <MessageCircle size={26} color={THEME_COLORS.primary} />
              </View>
              <Text className="text-center text-sm font-semibold text-inkMuted">
                暂无消息，长按消息可一键转为分工或日程
              </Text>
            </View>
          }
        />
      )}

      {permissions.isArchived || !permissions.canSendChatMessage ? (
        <View
          style={{ paddingBottom: composerBottomPadding }}
          className="border-t border-line bg-white px-4 pt-3"
        >
          <View className="flex-row items-center justify-center gap-2 rounded-2xl border border-line bg-surface px-4 py-3">
            {permissions.isArchived ? (
              <Archive size={15} color={THEME_COLORS.inkMuted} />
            ) : (
              <Lock size={15} color={THEME_COLORS.inkMuted} />
            )}
            <Text className="text-xs font-medium text-inkMuted">
              {permissions.isArchived
                ? '活动已归档，聊天室当前为只读模式'
                : '当前无法发送消息'}
            </Text>
          </View>
        </View>
      ) : (
        <View
          style={{ paddingBottom: composerBottomPadding }}
          className="border-t border-line bg-white px-3.5 pt-2.5"
        >
          {hasSelectedMentions ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              className="mb-2"
              contentContainerStyle={{ gap: 6, paddingHorizontal: 2 }}
            >
              {effectiveMentionAll ? (
                <MotionPressable
                  accessibilityRole="button"
                  accessibilityLabel="移除全体成员提醒"
                  onPress={() => setMentionAll(false)}
                  scaleTo={0.95}
                  className="flex-row items-center gap-1 rounded-full border border-primaryBorder bg-primarySoft px-2.5 py-1"
                >
                  <Text className="text-xs font-semibold text-primaryDeep">
                    @全体成员
                  </Text>
                  <X size={12} color={THEME_COLORS.primaryDeep} />
                </MotionPressable>
              ) : null}

              {mentionUserIds.map((uid) => {
                const nickname =
                  memberProfileMap.get(uid)?.nickname?.trim() || '成员';
                return (
                  <MotionPressable
                    key={uid}
                    accessibilityRole="button"
                    accessibilityLabel={`移除@${nickname}`}
                    onPress={() => handleToggleMentionUser(uid)}
                    scaleTo={0.95}
                    className="flex-row items-center gap-1 rounded-full border border-primaryBorder bg-primarySoft px-2.5 py-1"
                  >
                    <Text className="text-xs font-semibold text-primaryDeep">
                      @{nickname}
                    </Text>
                    <X size={12} color={THEME_COLORS.primaryDeep} />
                  </MotionPressable>
                );
              })}
            </ScrollView>
          ) : null}

          <View className="flex-row items-end gap-2">
            <MotionPressable
              accessibilityRole="button"
              accessibilityLabel="选择提醒成员"
              onPress={() => setMentionPickerVisible(true)}
              scaleTo={0.92}
              className={`h-10 w-10 items-center justify-center rounded-2xl border ${
                hasSelectedMentions
                  ? 'border-primaryBorder bg-primarySoft'
                  : 'border-line bg-surface'
              }`}
            >
              <AtSign
                size={18}
                color={
                  hasSelectedMentions
                    ? THEME_COLORS.primaryDeep
                    : THEME_COLORS.inkMuted
                }
              />
            </MotionPressable>

            <TextInput
              value={composerText}
              onChangeText={setComposerText}
              multiline
              maxLength={MAX_CHAT_MESSAGE_LENGTH}
              placeholder="发条消息，或点 @ 提醒伙伴..."
              placeholderTextColor={THEME_COLORS.inkSubtle}
              textAlignVertical="center"
              style={{ maxHeight: 96, minHeight: 40 }}
              className="flex-1 rounded-2xl border border-line bg-surface px-3.5 py-2 text-sm text-ink"
            />

            <MotionPressable
              accessibilityRole="button"
              accessibilityLabel="发送消息"
              disabled={!canSubmitComposer}
              onPress={handleSendMessage}
              scaleTo={0.92}
              className={`h-10 w-10 items-center justify-center rounded-2xl ${
                canSubmitComposer ? 'bg-primary' : 'bg-line'
              }`}
            >
              {sendMutation.isPending ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Send size={17} color="#FFFFFF" />
              )}
            </MotionPressable>
          </View>
        </View>
      )}

      {/* Mention Picker Sheet */}
      <SheetModal
        visible={mentionPickerVisible}
        onClose={() => setMentionPickerVisible(false)}
        title="选择提醒成员"
      >
        <View className="gap-3">
          {permissions.canMentionAll ? (
            <MotionPressable
              accessibilityRole="button"
              onPress={() => setMentionAll((prev) => !prev)}
              scaleTo={0.98}
              className={`flex-row items-center justify-between rounded-2xl border px-3.5 py-3 ${
                effectiveMentionAll
                  ? 'border-primaryBorder bg-primarySoft'
                  : 'border-line bg-surface'
              }`}
            >
              <View className="flex-row items-center gap-3">
                <View className="h-9 w-9 items-center justify-center rounded-full bg-primary">
                  <Megaphone size={16} color="#FFFFFF" />
                </View>
                <View>
                  <Text className="text-sm font-bold text-ink">@全体成员</Text>
                  <Text className="text-xs text-inkMuted">
                    提醒房间内所有活跃伙伴
                  </Text>
                </View>
              </View>
              <AnimatedCheckBadge checked={effectiveMentionAll} />
            </MotionPressable>
          ) : null}

          <View className="gap-2">
            <Text className="px-1 text-xs font-semibold text-inkMuted">
              房间活跃成员（{mentionableMembers.length}）
            </Text>

            {mentionableMembers.length === 0 ? (
              <View className="rounded-2xl border border-line bg-surface px-4 py-5">
                <Text className="text-center text-xs text-inkSubtle">
                  当前暂无其他活跃成员可提醒
                </Text>
              </View>
            ) : (
              mentionableMembers.map((member) => {
                const selected = mentionUserIds.includes(member.user_id);
                const nickname =
                  member.profiles?.nickname?.trim() || '房间成员';
                return (
                  <MotionPressable
                    key={member.user_id}
                    accessibilityRole="button"
                    onPress={() => handleToggleMentionUser(member.user_id)}
                    scaleTo={0.98}
                    className={`flex-row items-center justify-between rounded-2xl border px-3.5 py-2.5 ${
                      selected
                        ? 'border-primaryBorder bg-primarySoft'
                        : 'border-line bg-white'
                    }`}
                  >
                    <View className="flex-row items-center gap-3">
                      <Avatar
                        nickname={nickname}
                        color={member.profiles?.avatar_color}
                        imageUrl={member.profiles?.avatar_url}
                        size="sm"
                      />
                      <View className="flex-row items-center gap-2">
                        <Text className="text-sm font-semibold text-ink">
                          {nickname}
                        </Text>
                        <Badge
                          label={ROLE_LABELS[member.role]}
                          variant={
                            member.role === 'host'
                              ? 'primary'
                              : member.role === 'admin'
                                ? 'warning'
                                : 'neutral'
                          }
                          size="sm"
                        />
                      </View>
                    </View>
                    <AnimatedCheckBadge checked={selected} />
                  </MotionPressable>
                );
              })
            )}
          </View>

          <View className="mt-1 flex-row gap-2.5">
            <Button
              title="清空已选"
              variant="ghost"
              size="md"
              disabled={!hasSelectedMentions}
              onPress={() => {
                setMentionAll(false);
                setMentionUserIds([]);
              }}
              className="flex-1 border border-line bg-surface"
            />
            <Button
              title="完成"
              variant="primary"
              size="md"
              onPress={() => setMentionPickerVisible(false)}
              className="flex-1"
            />
          </View>
        </View>
      </SheetModal>

      {/* Message Long-Press Action Sheet */}
      <SheetModal
        visible={actionMessage !== null}
        onClose={() => setActionMessage(null)}
        title="消息操作"
      >
        {actionMessage ? (
          <View className="gap-2.5">
            <View className="rounded-2xl border border-line bg-surface px-3.5 py-2.5">
              <Text className="text-[11px] font-semibold text-inkSubtle">
                {resolveSenderName(actionMessage)}
              </Text>
              <Text
                numberOfLines={2}
                className="mt-0.5 text-xs leading-5 text-inkMuted"
              >
                {actionMessage.content}
              </Text>
            </View>

            {canConvertActionMessage ? (
              <MotionPressable
                accessibilityRole="button"
                onPress={() => {
                  const target = actionMessage;
                  setActionMessage(null);
                  onConvertMessageToBlock(target, 'task');
                }}
                scaleTo={0.98}
                className="flex-row items-center gap-3 rounded-2xl border border-primaryBorder bg-primarySoft px-4 py-3.5"
              >
                <CheckSquare size={18} color={THEME_COLORS.primaryDeep} />
                <View className="flex-1">
                  <Text className="text-sm font-semibold text-primaryDeep">
                    转为分工任务
                  </Text>
                  <Text className="text-[11px] text-inkMuted">
                    一键预填并创建到房间的分工任务积木
                  </Text>
                </View>
              </MotionPressable>
            ) : null}

            {canConvertActionMessage ? (
              <MotionPressable
                accessibilityRole="button"
                onPress={() => {
                  const target = actionMessage;
                  setActionMessage(null);
                  onConvertMessageToBlock(target, 'schedule');
                }}
                scaleTo={0.98}
                className="flex-row items-center gap-3 rounded-2xl border border-primaryBorder bg-primarySoft px-4 py-3.5"
              >
                <CalendarClock size={18} color={THEME_COLORS.primaryDeep} />
                <View className="flex-1">
                  <Text className="text-sm font-semibold text-primaryDeep">
                    加入日程轴
                  </Text>
                  <Text className="text-[11px] text-inkMuted">
                    一键预填并加入房间的活动日程轴
                  </Text>
                </View>
              </MotionPressable>
            ) : null}

            <MotionPressable
              accessibilityRole="button"
              onPress={() => void handleCopyMessage(actionMessage)}
              scaleTo={0.98}
              className="flex-row items-center gap-3 rounded-2xl border border-line bg-white px-4 py-3.5"
            >
              <Copy size={18} color={THEME_COLORS.ink} />
              <Text className="text-sm font-semibold text-ink">复制内容</Text>
            </MotionPressable>

            {canReportActionMessage ? (
              <MotionPressable
                accessibilityRole="button"
                onPress={() => {
                  const target = actionMessage;
                  setActionMessage(null);
                  setSelectedReportPreset(null);
                  setCustomReportReason('');
                  setReportTarget(target);
                }}
                scaleTo={0.98}
                className="flex-row items-center gap-3 rounded-2xl border border-line bg-white px-4 py-3.5"
              >
                <Flag size={18} color={THEME_COLORS.warning} />
                <Text className="text-sm font-semibold text-ink">举报消息</Text>
              </MotionPressable>
            ) : null}

            {canBlockActionMessage ? (
              <MotionPressable
                accessibilityRole="button"
                onPress={() => {
                  const target = actionMessage;
                  setActionMessage(null);
                  setBlockTarget(target);
                }}
                scaleTo={0.98}
                className="flex-row items-center gap-3 rounded-2xl border border-[#FAD2D0] bg-[#FEF2F2] px-4 py-3.5"
              >
                <Ban size={18} color={THEME_COLORS.danger} />
                <Text className="text-sm font-semibold text-[#C94545]">
                  屏蔽此人
                </Text>
              </MotionPressable>
            ) : null}

            {canDeleteActionMessage ? (
              <MotionPressable
                accessibilityRole="button"
                onPress={() => {
                  const target = actionMessage;
                  setActionMessage(null);
                  setDeleteTarget(target);
                }}
                scaleTo={0.98}
                className="flex-row items-center gap-3 rounded-2xl border border-[#FAD2D0] bg-[#FEF2F2] px-4 py-3.5"
              >
                <Trash2 size={18} color={THEME_COLORS.danger} />
                <Text className="text-sm font-semibold text-[#C94545]">
                  删除消息
                </Text>
              </MotionPressable>
            ) : null}
          </View>
        ) : null}
      </SheetModal>

      {/* Report Message Sheet */}
      <SheetModal
        visible={reportTarget !== null}
        onClose={() => {
          if (!reportMutation.isPending) {
            setReportTarget(null);
          }
        }}
        title="举报消息"
      >
        {reportTarget ? (
          <View className="gap-3.5">
            <View className="rounded-2xl border border-line bg-surface px-3.5 py-2.5">
              <Text className="text-[11px] font-semibold text-inkSubtle">
                被举报消息（{resolveSenderName(reportTarget)}）
              </Text>
              <Text
                numberOfLines={2}
                className="mt-0.5 text-xs leading-5 text-inkMuted"
              >
                {reportTarget.content}
              </Text>
            </View>

            <View className="gap-2">
              <Text className="text-xs font-semibold text-inkMuted">
                选择举报原因
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {REPORT_REASON_PRESETS.map((preset) => {
                  const active = selectedReportPreset === preset;
                  return (
                    <MotionPressable
                      key={preset}
                      accessibilityRole="button"
                      onPress={() =>
                        setSelectedReportPreset((prev) =>
                          prev === preset ? null : preset,
                        )
                      }
                      scaleTo={0.96}
                      className={`rounded-full border px-3.5 py-2 ${
                        active
                          ? 'border-primary bg-primarySoft'
                          : 'border-line bg-surface'
                      }`}
                    >
                      <Text
                        className={`text-xs font-semibold ${
                          active ? 'text-primaryDeep' : 'text-inkMuted'
                        }`}
                      >
                        {preset}
                      </Text>
                    </MotionPressable>
                  );
                })}
              </View>
            </View>

            <View className="gap-1.5">
              <Text className="text-xs font-semibold text-inkMuted">
                补充说明（选填，最多 {MAX_REPORT_REASON_LENGTH} 字）
              </Text>
              <BottomSheetTextInput
                value={customReportReason}
                onChangeText={setCustomReportReason}
                multiline
                maxLength={MAX_REPORT_REASON_LENGTH}
                placeholder="请描述具体违规或打扰情况..."
                placeholderTextColor={THEME_COLORS.inkSubtle}
                textAlignVertical="top"
                style={{ minHeight: 84 }}
                className="rounded-2xl border border-line bg-surface px-3.5 py-2.5 text-sm text-ink"
              />
            </View>

            <View className="flex-row gap-2.5 pt-1">
              <Button
                title="取消"
                variant="ghost"
                size="md"
                disabled={reportMutation.isPending}
                onPress={() => setReportTarget(null)}
                className="flex-1 border border-line bg-surface"
              />
              <Button
                title="提交举报"
                variant="danger"
                size="md"
                loading={reportMutation.isPending}
                onPress={handleSubmitReport}
                className="flex-1"
              />
            </View>
          </View>
        ) : null}
      </SheetModal>

      {/* Block User Confirmation Sheet */}
      <SheetModal
        visible={blockTarget !== null}
        onClose={() => {
          if (!blockMutation.isPending) {
            setBlockTarget(null);
          }
        }}
        title="屏蔽此人"
      >
        {blockTarget ? (
          <View className="gap-4">
            <View className="rounded-2xl border border-[#FAD2D0] bg-[#FEF2F2] p-3.5">
              <Text className="text-sm font-semibold text-[#C94545]">
                确认屏蔽「{resolveSenderName(blockTarget)}」？
              </Text>
              <Text className="mt-1.5 text-xs leading-5 text-inkMuted">
                屏蔽后你将立即不再看到对方发送的聊天消息，后续可随时在「我的」页面解除屏蔽。
              </Text>
            </View>

            <View className="flex-row gap-2.5">
              <Button
                title="取消"
                variant="ghost"
                size="md"
                disabled={blockMutation.isPending}
                onPress={() => setBlockTarget(null)}
                className="flex-1 border border-line bg-surface"
              />
              <Button
                title="确认屏蔽"
                variant="danger"
                size="md"
                loading={blockMutation.isPending}
                onPress={handleConfirmBlock}
                className="flex-1"
              />
            </View>
          </View>
        ) : null}
      </SheetModal>

      {/* Delete Message Confirmation Sheet */}
      <SheetModal
        visible={deleteTarget !== null}
        onClose={() => {
          if (!deleteMutation.isPending) {
            setDeleteTarget(null);
          }
        }}
        title="删除消息"
      >
        {deleteTarget ? (
          <View className="gap-4">
            <View className="rounded-2xl border border-line bg-surface p-3.5">
              <Text className="text-xs font-semibold text-inkMuted">
                删除后房间内所有成员都将无法看到这条消息：
              </Text>
              <Text
                numberOfLines={3}
                className="mt-1.5 text-sm leading-5 text-ink"
              >
                {deleteTarget.content}
              </Text>
            </View>

            <View className="flex-row gap-2.5">
              <Button
                title="取消"
                variant="ghost"
                size="md"
                disabled={deleteMutation.isPending}
                onPress={() => setDeleteTarget(null)}
                className="flex-1 border border-line bg-surface"
              />
              <Button
                title="确认删除"
                variant="danger"
                size="md"
                loading={deleteMutation.isPending}
                onPress={handleConfirmDelete}
                className="flex-1"
              />
            </View>
          </View>
        ) : null}
      </SheetModal>
    </KeyboardAvoidingView>
  );
}
