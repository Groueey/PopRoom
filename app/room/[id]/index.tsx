import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import {
  AlertTriangle,
  Archive,
  ArrowUpDown,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  LayoutGrid,
  Megaphone,
  MessageCircle,
  Plus,
  Settings,
  Share2,
  Wallet,
} from 'lucide-react-native';
import React, {
  type ComponentRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
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
  reorderRoomBlocks,
} from '../../../src/api/blocks';
import {
  fetchMyBlockedUsers,
  fetchRoomChatRead,
  fetchRoomMessages,
  markRoomChatRead,
  sendRoomMessage,
} from '../../../src/api/chat';
import {
  ROLE_LABELS,
  RoomApiError,
  acknowledgeRoomAnnouncement,
  fetchRoomAnnouncementAcks,
  fetchRoomDetail,
  fetchRoomMembers,
  formatRoomEventWindow,
  mapRoomError,
} from '../../../src/api/rooms';
import { ExpenseBlock } from '../../../src/components/blocks/ExpenseBlock';
import { PollBlock } from '../../../src/components/blocks/PollBlock';
import { ScheduleBlock } from '../../../src/components/blocks/ScheduleBlock';
import {
  type ExternalBlockCreateDraft,
  TaskBlock,
} from '../../../src/components/blocks/TaskBlock';
import { ChatRoomView } from '../../../src/components/chat/ChatRoomView';
import { Avatar } from '../../../src/components/ui/Avatar';
import { Badge } from '../../../src/components/ui/Badge';
import { Button } from '../../../src/components/ui/Button';
import { Card } from '../../../src/components/ui/Card';
import {
  AnimatedCheckBadge,
  AnimatedPanelReveal,
  AnimatedProgressBar,
  MotionPressable,
} from '../../../src/components/ui/Motion';
import { OfflineSyncBanner } from '../../../src/components/ui/OfflineSyncBanner';
import { SheetModal } from '../../../src/components/ui/SheetModal';
import { useRoomPermissions } from '../../../src/hooks/useRoomPermissions';
import { useRoomRealtime } from '../../../src/hooks/useRoomRealtime';
import {
  applyOptimisticAnnouncementAck,
  computeAnnouncementAckSummary,
  formatAckTimestamp,
} from '../../../src/lib/announcementAckHelpers';
import {
  type BlockMoveDirection,
  applyBlockOrderToList,
  moveBlockInOrder,
} from '../../../src/lib/blockOrderHelpers';
import {
  type BlockOverviewPreview,
  buildBlockOverviewSummary,
  collectBoardPendingActions,
  formatCompactChatTime,
  selectRecentChatPreviewMessages,
} from '../../../src/lib/boardOverviewHelpers';
import {
  type ParsedRoomMessage,
  buildBlockPrefillFromMessage,
  buildBlockReminderMessage,
  countUnreadChatMessages,
} from '../../../src/lib/chatHelpers';
import { QUERY_KEYS } from '../../../src/lib/queryClient';
import { resolveRoomScreenState } from '../../../src/lib/roomScreenState';
import { shareRoomInvite } from '../../../src/lib/shareInvite';
import { ROOM_TEMPLATES } from '../../../src/lib/templates';
import { BLOCK_ACCENTS, CARD_SHADOW, THEME_COLORS } from '../../../src/lib/theme';
import type { PollTally } from '../../../src/schemas/blocks';
import { useAuthStore } from '../../../src/stores/authStore';
import { useUiStore } from '../../../src/stores/uiStore';
import type {
  BlockType,
  RoomAnnouncementAckRow,
} from '../../../src/types/database';

type RoomActiveTab = 'board' | 'chat';

interface PendingBlockCreateDraft extends ExternalBlockCreateDraft {
  targetBlockId: string;
}

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
  color = THEME_COLORS.primary,
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

  const {
    data: messages = [],
    isLoading: messagesLoading,
    isRefetching: messagesRefetching,
    refetch: refetchMessages,
  } = useQuery({
    queryKey: QUERY_KEYS.roomMessages(roomId),
    queryFn: () => fetchRoomMessages(roomId),
    enabled: Boolean(roomId && room?.chat_enabled),
  });

  const { data: lastReadAt, isFetched: chatReadFetched } = useQuery({
    queryKey: QUERY_KEYS.roomChatRead(roomId, currentUserId ?? undefined),
    queryFn: () => fetchRoomChatRead(roomId, currentUserId ?? ''),
    enabled: Boolean(roomId && currentUserId && room?.chat_enabled),
  });

  const { data: blockedUsers = [], refetch: refetchBlockedUsers } = useQuery({
    queryKey: QUERY_KEYS.userBlocks(currentUserId ?? undefined),
    queryFn: () => fetchMyBlockedUsers(currentUserId ?? ''),
    enabled: Boolean(currentUserId),
  });

  const {
    data: announcementAcks = [],
    refetch: refetchAnnouncementAcks,
  } = useQuery({
    queryKey: QUERY_KEYS.roomAnnouncementAcks(roomId),
    queryFn: () => fetchRoomAnnouncementAcks(roomId),
    enabled: Boolean(roomId),
  });

  const [ackSheetVisible, setAckSheetVisible] = useState(false);
  const [remindingUnacked, setRemindingUnacked] = useState(false);

  const blockedUserIds = useMemo(
    () => new Set(blockedUsers.map((entry) => entry.blocked_id)),
    [blockedUsers],
  );

  const activeMembers = useMemo(
    () => members.filter((member) => member.status === 'active'),
    [members],
  );

  const announcementSummary = useMemo(
    () =>
      computeAnnouncementAckSummary({
        announcement: room?.announcement ?? '',
        announcementVersion:
          room?.announcement_updated_at ?? room?.updated_at ?? null,
        members: activeMembers,
        acks: announcementAcks,
        currentUserId,
      }),
    [
      room?.announcement,
      room?.announcement_updated_at,
      room?.updated_at,
      activeMembers,
      announcementAcks,
      currentUserId,
    ],
  );

  const ackAnnouncementMutation = useMutation<
    RoomAnnouncementAckRow,
    unknown,
    void,
    { previousAcks: RoomAnnouncementAckRow[] | undefined }
  >({
    mutationFn: () => acknowledgeRoomAnnouncement(roomId),
    onMutate: async () => {
      const acksKey = QUERY_KEYS.roomAnnouncementAcks(roomId);
      await queryClient.cancelQueries({ queryKey: acksKey });
      const previousAcks =
        queryClient.getQueryData<RoomAnnouncementAckRow[]>(acksKey);

      if (currentUserId) {
        const version =
          room?.announcement_updated_at ??
          room?.updated_at ??
          new Date().toISOString();
        queryClient.setQueryData<RoomAnnouncementAckRow[]>(acksKey, (old = []) =>
          applyOptimisticAnnouncementAck(old, {
            roomId,
            userId: currentUserId,
            announcementVersion: version,
          }),
        );
      }

      return { previousAcks };
    },
    onError: (err, _vars, context) => {
      const acksKey = QUERY_KEYS.roomAnnouncementAcks(roomId);
      if (context?.previousAcks !== undefined) {
        queryClient.setQueryData(acksKey, context.previousAcks);
      } else {
        void queryClient.invalidateQueries({ queryKey: acksKey });
      }
      showToast(mapRoomError(err), 'error');
    },
    onSuccess: (savedAck) => {
      const acksKey = QUERY_KEYS.roomAnnouncementAcks(roomId);
      queryClient.setQueryData<RoomAnnouncementAckRow[]>(acksKey, (old = []) =>
        applyOptimisticAnnouncementAck(old, {
          roomId: savedAck.room_id,
          userId: savedAck.user_id,
          announcementVersion: savedAck.announcement_version,
          ackedAt: savedAck.acked_at,
        }),
      );
      showToast('已确认收到房间公告', 'success');
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.roomAnnouncementAcks(roomId),
      });
    },
  });

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
    chatEnabled: room?.chat_enabled ?? false,
  });

  const handleRemindUnackedInChat = useCallback(async () => {
    if (
      !room ||
      !room.chat_enabled ||
      permissions.isReadOnly ||
      !permissions.isAdminOrHost ||
      announcementSummary.unackedMembers.length === 0 ||
      remindingUnacked
    ) {
      return;
    }

    setRemindingUnacked(true);
    try {
      const mentionUserIds = announcementSummary.unackedMembers.map(
        (m) => m.user_id,
      );
      const mentionNames = announcementSummary.unackedMembers
        .map((m) => `@${m.profiles?.nickname ?? '成员'}`)
        .join(' ');
      const content = `${mentionNames} 请查看房间公告并点击「我已阅读并确认收到」`;
      await sendRoomMessage({
        roomId: room.id,
        msgType: 'text',
        content,
        metadata: {
          mentionAll: false,
          mentionUserIds,
        },
      });
      setAckSheetVisible(false);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: QUERY_KEYS.roomMessages(room.id),
        }),
        queryClient.invalidateQueries({
          queryKey: QUERY_KEYS.roomChatRead(room.id, currentUserId ?? undefined),
        }),
      ]);
      showToast('已在聊天室提醒未确认成员', 'success');
    } catch (err) {
      showToast(mapRoomError(err), 'error');
    } finally {
      setRemindingUnacked(false);
    }
  }, [
    room,
    permissions.isReadOnly,
    permissions.isAdminOrHost,
    announcementSummary.unackedMembers,
    remindingUnacked,
    queryClient,
    currentUserId,
    showToast,
  ]);

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

  const [activeTab, setActiveTab] = useState<RoomActiveTab>('board');
  const [selectedBoardView, setSelectedBoardView] = useState<'overview' | string>(
    'overview',
  );
  const [announcementExpanded, setAnnouncementExpanded] = useState(false);
  const [reorderMode, setReorderMode] = useState(false);
  const [highlightedBlockId, setHighlightedBlockId] = useState<string | null>(
    null,
  );
  const [sendingReminderBlockId, setSendingReminderBlockId] = useState<
    string | null
  >(null);
  const [pendingBlockDraft, setPendingBlockDraft] =
    useState<PendingBlockCreateDraft | null>(null);
  const [convertingMessage, setConvertingMessage] = useState(false);

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

  const boardScrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastMarkedReadStampRef = useRef<string | null>(null);
  const prevRoomChatRef = useRef<{
    roomId: string;
    chatEnabled: boolean;
  } | null>(null);

  const clearPendingBlockDraft = useCallback(() => {
    setPendingBlockDraft(null);
  }, []);

  const unreadChatCount = useMemo(() => {
    if (!room?.chat_enabled || (!chatReadFetched && lastReadAt === undefined)) {
      return 0;
    }
    return countUnreadChatMessages(
      messages,
      lastReadAt ?? null,
      currentUserId,
      blockedUserIds,
    );
  }, [
    room?.chat_enabled,
    chatReadFetched,
    messages,
    lastReadAt,
    currentUserId,
    blockedUserIds,
  ]);

  const latestServerMessageStamp = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const entry = messages[i];
      if (entry && !entry.optimistic && !entry.is_deleted) {
        return `${entry.id}:${entry.created_at}`;
      }
    }
    return null;
  }, [messages]);

  useEffect(() => {
    setActiveTab('board');
    setSelectedBoardView('overview');
    setAnnouncementExpanded(false);
    setReorderMode(false);
    setHighlightedBlockId(null);
    setPendingBlockDraft(null);
    lastMarkedReadStampRef.current = null;
  }, [roomId]);

  useEffect(() => {
    if (
      selectedBoardView !== 'overview' &&
      !blocks.some((entry) => entry.id === selectedBoardView)
    ) {
      setSelectedBoardView('overview');
    }
  }, [blocks, selectedBoardView]);

  useEffect(() => {
    lastMarkedReadStampRef.current = null;
  }, [currentUserId]);

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!room) {
      return;
    }
    const prev = prevRoomChatRef.current;
    if (!room.chat_enabled && activeTab === 'chat') {
      setActiveTab('board');
      if (
        prev !== null &&
        prev.roomId === room.id &&
        prev.chatEnabled === true
      ) {
        showToast('房主已关闭聊天室', 'info');
      }
    }
    prevRoomChatRef.current = {
      roomId: room.id,
      chatEnabled: room.chat_enabled,
    };
  }, [room, activeTab, showToast]);

  useEffect(() => {
    if (reorderMode && (!permissions.canReorderBlocks || blocks.length <= 1)) {
      setReorderMode(false);
    }
  }, [reorderMode, permissions.canReorderBlocks, blocks.length]);

  useEffect(() => {
    if (!canOpenAddBlockSheet && addSheetVisible) {
      setAddSheetVisible(false);
    }
  }, [addSheetVisible, canOpenAddBlockSheet]);

  useEffect(() => {
    if (
      activeTab !== 'chat' ||
      !room?.chat_enabled ||
      !roomId ||
      !currentUserId ||
      !chatReadFetched
    ) {
      return;
    }
    if (unreadChatCount <= 0) {
      return;
    }

    const stampKey = latestServerMessageStamp ?? `unread:${unreadChatCount}`;
    if (lastMarkedReadStampRef.current === stampKey) {
      return;
    }
    lastMarkedReadStampRef.current = stampKey;

    const readKey = QUERY_KEYS.roomChatRead(roomId, currentUserId);
    const latestMsgMs = messages.reduce((maxMs, msg) => {
      const ms = Date.parse(msg.created_at);
      return Number.isNaN(ms) ? maxMs : Math.max(maxMs, ms);
    }, 0);
    const optimisticReadIso = new Date(
      Math.max(Date.now(), latestMsgMs),
    ).toISOString();

    queryClient.setQueryData<string | null>(readKey, optimisticReadIso);

    void markRoomChatRead(roomId, currentUserId, optimisticReadIso)
      .then((serverReadIso) => {
        const serverMs = Date.parse(serverReadIso);
        const resolvedIso =
          !Number.isNaN(serverMs) && serverMs >= latestMsgMs
            ? serverReadIso
            : optimisticReadIso;
        queryClient.setQueryData<string | null>(readKey, resolvedIso);
      })
      .catch(() => {
        if (lastMarkedReadStampRef.current === stampKey) {
          lastMarkedReadStampRef.current = null;
        }
      });
  }, [
    activeTab,
    room?.chat_enabled,
    roomId,
    currentUserId,
    chatReadFetched,
    unreadChatCount,
    latestServerMessageStamp,
    messages,
    queryClient,
  ]);

  const reorderBlocksMutation = useMutation<
    void,
    unknown,
    { nextIds: string[] },
    { previousBlocks: ParsedBlock[] | undefined }
  >({
    mutationFn: ({ nextIds }) => reorderRoomBlocks(roomId, nextIds),
    onMutate: async ({ nextIds }) => {
      const blocksKey = QUERY_KEYS.roomBlocks(roomId);
      await queryClient.cancelQueries({ queryKey: blocksKey });
      const previousBlocks =
        queryClient.getQueryData<ParsedBlock[]>(blocksKey);
      const sourceBlocks = previousBlocks ?? blocks;
      queryClient.setQueryData<ParsedBlock[]>(
        blocksKey,
        applyBlockOrderToList(sourceBlocks, nextIds),
      );
      return { previousBlocks };
    },
    onError: (err, _vars, context) => {
      const blocksKey = QUERY_KEYS.roomBlocks(roomId);
      if (context?.previousBlocks !== undefined) {
        queryClient.setQueryData(blocksKey, context.previousBlocks);
      } else {
        void queryClient.invalidateQueries({ queryKey: blocksKey });
      }
      showToast(mapRoomError(err), 'error');
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.roomBlocks(roomId),
      });
    },
  });

  const handleMoveBlock = useCallback(
    (blockId: string, direction: BlockMoveDirection) => {
      if (!permissions.canReorderBlocks || reorderBlocksMutation.isPending) {
        return;
      }
      const currentBlocks =
        queryClient.getQueryData<ParsedBlock[]>(
          QUERY_KEYS.roomBlocks(roomId),
        ) ?? blocks;
      const nextIds = moveBlockInOrder(
        currentBlocks.map((entry) => entry.id),
        blockId,
        direction,
      );
      if (!nextIds) {
        return;
      }
      reorderBlocksMutation.mutate({ nextIds });
    },
    [
      permissions.canReorderBlocks,
      reorderBlocksMutation,
      queryClient,
      roomId,
      blocks,
    ],
  );

  const triggerHighlightBlock = useCallback((blockId: string) => {
    if (highlightTimerRef.current) {
      clearTimeout(highlightTimerRef.current);
    }
    setHighlightedBlockId(blockId);
    highlightTimerRef.current = setTimeout(() => {
      setHighlightedBlockId((prev) => (prev === blockId ? null : prev));
      highlightTimerRef.current = null;
    }, 2000);
  }, []);

  const handleJumpToBlock = useCallback(
    (blockId: string) => {
      const exists = blocks.some((entry) => entry.id === blockId);
      setActiveTab('board');
      if (!exists) {
        showToast('该协作积木已不存在或已被移除', 'info');
        return;
      }
      setReorderMode(false);
      setSelectedBoardView(blockId);
      triggerHighlightBlock(blockId);
      boardScrollRef.current?.scrollTo({ y: 0, animated: false });
    },
    [blocks, showToast, triggerHighlightBlock],
  );

  const handleSendBlockReminder = useCallback(
    async (block: ParsedBlock<'poll' | 'task'>) => {
      if (
        !room ||
        !room.chat_enabled ||
        !permissions.canSendBlockReminder ||
        sendingReminderBlockId !== null
      ) {
        return;
      }
      setSendingReminderBlockId(block.id);
      try {
        const tallies =
          block.type === 'poll'
            ? (talliesByBlockId.get(block.id) ?? [])
            : undefined;
        const payload = buildBlockReminderMessage(block, tallies);
        await sendRoomMessage({
          roomId: room.id,
          msgType: 'block_card',
          content: payload.content,
          metadata: payload.metadata,
        });
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: QUERY_KEYS.roomMessages(room.id),
          }),
          ...(currentUserId
            ? [
                queryClient.invalidateQueries({
                  queryKey: QUERY_KEYS.roomChatRead(room.id, currentUserId),
                }),
              ]
            : []),
        ]);
        showToast('已发送提醒到聊天室', 'success');
      } catch (err) {
        showToast(mapRoomError(err), 'error');
      } finally {
        setSendingReminderBlockId(null);
      }
    },
    [
      room,
      permissions.canSendBlockReminder,
      sendingReminderBlockId,
      talliesByBlockId,
      queryClient,
      currentUserId,
      showToast,
    ],
  );

  const handleConvertMessageToBlock = useCallback(
    async (message: ParsedRoomMessage, target: 'task' | 'schedule') => {
      if (
        !room ||
        permissions.isArchived ||
        permissions.isReadOnly ||
        convertingMessage
      ) {
        return;
      }

      const { title, details } = buildBlockPrefillFromMessage(
        message.content,
        target,
      );

      let targetBlockId: string | null = null;
      if (target === 'task') {
        const taskBlocks = blocks.filter(
          (entry): entry is ParsedBlock<'task'> => entry.type === 'task',
        );
        const writableTaskBlock = taskBlocks.find((entry) =>
          permissions.canCreateItem(entry.config.allowMemberCreate),
        );
        if (writableTaskBlock) {
          targetBlockId = writableTaskBlock.id;
        } else if (taskBlocks.length > 0) {
          showToast('当前分工积木仅允许管理员新增任务', 'info');
          return;
        }
      } else {
        const scheduleBlock = blocks.find(
          (entry): entry is ParsedBlock<'schedule'> =>
            entry.type === 'schedule',
        );
        if (scheduleBlock) {
          targetBlockId = scheduleBlock.id;
        }
      }

      if (!targetBlockId) {
        if (!permissions.canManageBlocks) {
          showToast('房间暂未添加分工/日程积木，请联系房主添加后再转换', 'info');
          return;
        }

        setConvertingMessage(true);
        try {
          const created =
            target === 'task'
              ? await createBlock({
                  roomId: room.id,
                  type: 'task',
                  title: DEFAULT_BLOCK_TITLES.task,
                  sortOrder: blocks.length,
                  createdBy: currentUserId,
                  config: { allowMemberCreate: true },
                })
              : await createBlock({
                  roomId: room.id,
                  type: 'schedule',
                  title: DEFAULT_BLOCK_TITLES.schedule,
                  sortOrder: blocks.length,
                  createdBy: currentUserId,
                  config: { groupBy: 'day' },
                });

          targetBlockId = created.id;
          queryClient.setQueryData<ParsedBlock[]>(
            QUERY_KEYS.roomBlocks(room.id),
            (old = []) =>
              old.some((entry) => entry.id === created.id)
                ? old
                : [...old, created],
          );
          await queryClient.invalidateQueries({
            queryKey: QUERY_KEYS.roomBlocks(room.id),
          });
        } catch (err) {
          showToast(mapRoomError(err), 'error');
          return;
        } finally {
          setConvertingMessage(false);
        }
      }

      setReorderMode(false);
      setActiveTab('board');
      setSelectedBoardView(targetBlockId);
      triggerHighlightBlock(targetBlockId);
      boardScrollRef.current?.scrollTo({ y: 0, animated: false });
      setPendingBlockDraft({
        targetBlockId,
        nonce: Date.now(),
        title,
        details,
      });
    },
    [
      room,
      permissions,
      convertingMessage,
      blocks,
      currentUserId,
      queryClient,
      showToast,
      triggerHighlightBlock,
    ],
  );

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
      refetchAnnouncementAcks(),
      ...(room?.chat_enabled ? [refetchMessages()] : []),
    ]);
  };

  const handleRefreshChat = useCallback(() => {
    void Promise.all([
      refetchMessages(),
      refetchRoom(),
      refetchMembers(),
      ...(currentUserId ? [refetchBlockedUsers()] : []),
    ]);
  }, [
    refetchMessages,
    refetchRoom,
    refetchMembers,
    currentUserId,
    refetchBlockedUsers,
  ]);

  const handleShareRoomInvite = async () => {
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
        showToast('已复制房间口令与邀请链接', 'success');
      }
    } catch {
      showToast('分享失败，请前往房间设置复制', 'error');
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
      const created = (await createBlock(payload)) as ParsedBlock;
      setAddSheetVisible(false);
      queryClient.setQueryData<ParsedBlock[]>(
        QUERY_KEYS.roomBlocks(roomId),
        (old = []) =>
          old.some((entry) => entry.id === created.id) ? old : [...old, created],
      );
      setReorderMode(false);
      setSelectedBoardView(created.id);
      triggerHighlightBlock(created.id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.roomBlocks(roomId) }),
        queryClient.invalidateQueries({
          queryKey: QUERY_KEYS.roomPollTallies(roomId),
        }),
      ]);
      boardScrollRef.current?.scrollTo({ y: 0, animated: false });
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
    const deletedId = deleteTarget.id;
    setDeletingBlock(true);
    try {
      await deleteBlock(deletedId);
      setDeleteTarget(null);
      if (selectedBoardView === deletedId) {
        setSelectedBoardView('overview');
      }
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

  const blockOverviewSummaries = useMemo(
    () =>
      new Map(
        blocks.map((block) => [
          block.id,
          buildBlockOverviewSummary(
            block,
            talliesByBlockId.get(block.id) ?? [],
            activeMembers.length,
          ),
        ]),
      ),
    [blocks, talliesByBlockId, activeMembers.length],
  );

  const pendingBoardActions = useMemo(
    () =>
      collectBoardPendingActions({
        blocks,
        talliesByBlockId,
        currentUserId,
        isReadOnly: permissions.isReadOnly,
      }),
    [blocks, talliesByBlockId, currentUserId, permissions.isReadOnly],
  );

  const focusedBlock = useMemo(() => {
    if (selectedBoardView === 'overview') {
      return null;
    }
    return blocks.find((entry) => entry.id === selectedBoardView) ?? null;
  }, [blocks, selectedBoardView]);

  const memberNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of activeMembers) {
      map.set(member.user_id, member.profiles?.nickname ?? '成员');
    }
    return map;
  }, [activeMembers]);

  const recentChatMessages = useMemo(
    () =>
      room?.chat_enabled
        ? selectRecentChatPreviewMessages(messages, blockedUserIds, 2)
        : [],
    [room?.chat_enabled, messages, blockedUserIds],
  );

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
        <ActivityIndicator size="large" color={THEME_COLORS.primary} />
        <Text className="mt-3 text-xs text-inkMuted">正在加载协作看板...</Text>
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
          <AlertTriangle size={28} color={THEME_COLORS.danger} />
          <Text className="mt-3 text-base font-bold text-ink">{errorTitle}</Text>
          <Text className="mt-1.5 text-center text-xs leading-5 text-inkMuted">
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

  const isChatVisible = room.chat_enabled && activeTab === 'chat';
  const unreadBadgeText = unreadChatCount > 99 ? '99+' : String(unreadChatCount);
  const isFocusedBlockView = !isChatVisible && focusedBlock !== null;

  const shouldShowExpandedAnnouncement =
    announcementSummary.hasAnnouncement &&
    ((!announcementSummary.hasCurrentUserAcked && !permissions.isReadOnly) ||
      announcementExpanded);

  const renderFocusedBlock = (block: ParsedBlock) => {
    const isHighlighted = highlightedBlockId === block.id;
    switch (block.type) {
      case 'poll':
        return (
          <PollBlock
            block={block}
            items={block.items}
            tallies={talliesByBlockId.get(block.id) ?? []}
            members={activeMembers}
            permissions={permissions}
            onRequestDeleteBlock={
              permissions.canManageBlocks ? setDeleteTarget : undefined
            }
            highlighted={isHighlighted}
            onSendReminder={
              permissions.canSendBlockReminder
                ? () => void handleSendBlockReminder(block)
                : undefined
            }
            sendingReminder={sendingReminderBlockId === block.id}
          />
        );
      case 'task':
        return (
          <TaskBlock
            block={block}
            items={block.items}
            members={activeMembers}
            permissions={permissions}
            onRequestDeleteBlock={
              permissions.canManageBlocks ? setDeleteTarget : undefined
            }
            highlighted={isHighlighted}
            onSendReminder={
              permissions.canSendBlockReminder
                ? () => void handleSendBlockReminder(block)
                : undefined
            }
            sendingReminder={sendingReminderBlockId === block.id}
            externalCreateDraft={
              pendingBlockDraft?.targetBlockId === block.id
                ? pendingBlockDraft
                : null
            }
            onConsumeExternalCreateDraft={clearPendingBlockDraft}
          />
        );
      case 'schedule':
        return (
          <ScheduleBlock
            block={block}
            items={block.items}
            members={activeMembers}
            permissions={permissions}
            onRequestDeleteBlock={
              permissions.canManageBlocks ? setDeleteTarget : undefined
            }
            highlighted={isHighlighted}
            externalCreateDraft={
              pendingBlockDraft?.targetBlockId === block.id
                ? pendingBlockDraft
                : null
            }
            onConsumeExternalCreateDraft={clearPendingBlockDraft}
          />
        );
      case 'expense':
        return (
          <ExpenseBlock
            block={block}
            items={block.items}
            members={activeMembers}
            permissions={permissions}
            onRequestDeleteBlock={
              permissions.canManageBlocks ? setDeleteTarget : undefined
            }
            highlighted={isHighlighted}
          />
        );
    }
  };

  return (
    <SafeAreaView
      className={isFocusedBlockView ? 'flex-1 bg-white' : 'flex-1 bg-surface'}
      edges={isChatVisible ? ['top'] : ['top', 'bottom']}
    >
      <View className="flex-row items-center justify-between bg-white px-4 pb-2.5 pt-2.5">
        <View className="flex-1 flex-row items-center gap-2 pr-2">
          <MotionPressable
            accessibilityRole="button"
            accessibilityLabel="返回活动大厅"
            onPress={handleBack}
            scaleTo={0.92}
            className="h-9 w-9 items-center justify-center rounded-full bg-surface"
          >
            <ChevronLeft size={20} color={THEME_COLORS.ink} />
          </MotionPressable>

          <View className="flex-1">
            <Text className="text-[16px] font-bold text-ink" numberOfLines={1}>
              {room.title}
            </Text>
            <View className="mt-0.5 flex-row items-center gap-1.5">
              <Text className="text-[11px] text-inkMuted" numberOfLines={1}>
                {templateMeta.name} · {activeMembers.length} 人
              </Text>
              <MotionPressable
                accessibilityRole="button"
                accessibilityLabel={`分享或复制房间码 ${room.room_code}`}
                onPress={() => void handleShareRoomInvite()}
                scaleTo={0.94}
                className="flex-row items-center gap-1 rounded-full bg-primarySoft px-2 py-0.5"
              >
                <Text className="text-[11px] font-bold tracking-wider text-primaryDeep">
                  {room.room_code}
                </Text>
                <Share2 size={10} color={THEME_COLORS.primaryDeep} />
              </MotionPressable>
            </View>
          </View>
        </View>

        <View className="flex-row items-center gap-1.5">
          <MotionPressable
            accessibilityRole="button"
            accessibilityLabel="导出复盘"
            onPress={() => router.push(`/room/${room.id}/export` as Href)}
            scaleTo={0.92}
            className="h-9 w-9 items-center justify-center rounded-full bg-surface"
          >
            <Share2 size={16} color={THEME_COLORS.inkMuted} />
          </MotionPressable>
          <MotionPressable
            accessibilityRole="button"
            accessibilityLabel="房间设置"
            onPress={() => router.push(`/room/${room.id}/settings` as Href)}
            scaleTo={0.92}
            className="h-9 w-9 items-center justify-center rounded-full bg-surface"
          >
            <Settings size={16} color={THEME_COLORS.inkMuted} />
          </MotionPressable>
        </View>
      </View>

      {room.chat_enabled ? (
        <View
          className={`bg-white px-4 pb-2 ${
            isChatVisible ? 'border-b border-line' : ''
          }`}
        >
          <View className="flex-row gap-1 rounded-xl bg-surface p-1">
            <MotionPressable
              accessibilityRole="tab"
              accessibilityState={{ selected: activeTab === 'board' }}
              accessibilityLabel="协作看板"
              onPress={() => setActiveTab('board')}
              flex
              scaleTo={0.98}
              style={activeTab === 'board' ? CARD_SHADOW : undefined}
              className={`flex-row items-center justify-center gap-1.5 rounded-[10px] py-1.5 ${
                activeTab === 'board' ? 'bg-white' : 'bg-transparent'
              }`}
            >
              <LayoutGrid
                size={13}
                color={
                  activeTab === 'board'
                    ? THEME_COLORS.primary
                    : THEME_COLORS.inkMuted
                }
              />
              <Text
                className={`text-xs ${
                  activeTab === 'board'
                    ? 'font-bold text-ink'
                    : 'font-medium text-inkMuted'
                }`}
              >
                协作看板
              </Text>
            </MotionPressable>

            <MotionPressable
              accessibilityRole="tab"
              accessibilityState={{ selected: activeTab === 'chat' }}
              accessibilityLabel={
                activeTab === 'board' && unreadChatCount > 0
                  ? `聊天室，${unreadBadgeText} 条未读消息`
                  : '聊天室'
              }
              onPress={() => {
                setReorderMode(false);
                setActiveTab('chat');
              }}
              flex
              scaleTo={0.98}
              style={activeTab === 'chat' ? CARD_SHADOW : undefined}
              className={`flex-row items-center justify-center gap-1.5 rounded-[10px] py-1.5 ${
                activeTab === 'chat' ? 'bg-white' : 'bg-transparent'
              }`}
            >
              <MessageCircle
                size={13}
                color={
                  activeTab === 'chat'
                    ? THEME_COLORS.primary
                    : THEME_COLORS.inkMuted
                }
              />
              <Text
                className={`text-xs ${
                  activeTab === 'chat'
                    ? 'font-bold text-ink'
                    : 'font-medium text-inkMuted'
                }`}
              >
                聊天室
              </Text>
              {activeTab === 'board' && unreadChatCount > 0 ? (
                <View
                  style={{ backgroundColor: THEME_COLORS.primary }}
                  className="min-w-[18px] items-center justify-center rounded-full px-1.5 py-0.5"
                >
                  <Text className="text-[10px] font-bold leading-3 text-white">
                    {unreadBadgeText}
                  </Text>
                </View>
              ) : null}
            </MotionPressable>
          </View>
        </View>
      ) : null}

      {!isChatVisible ? (
        <View className="flex-row items-center border-b border-line bg-white py-2.5">
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            className="flex-1"
            contentContainerStyle={{
              paddingLeft: 16,
              paddingRight: canOpenAddBlockSheet && !reorderMode ? 10 : 16,
              gap: 8,
              alignItems: 'center',
            }}
          >
            <MotionPressable
              accessibilityRole="tab"
              accessibilityState={{ selected: selectedBoardView === 'overview' }}
              accessibilityLabel="看板总览"
              onPress={() => {
                setSelectedBoardView('overview');
                boardScrollRef.current?.scrollTo({ y: 0, animated: false });
              }}
              scaleTo={0.96}
              style={{
                backgroundColor:
                  selectedBoardView === 'overview'
                    ? THEME_COLORS.primary
                    : THEME_COLORS.lineSoft,
              }}
              className="flex-row items-center gap-1.5 rounded-full px-3.5 py-1.5"
            >
              <LayoutGrid
                size={12}
                color={
                  selectedBoardView === 'overview'
                    ? '#FFFFFF'
                    : THEME_COLORS.inkMuted
                }
              />
              <Text
                className={`text-xs ${
                  selectedBoardView === 'overview'
                    ? 'font-bold text-white'
                    : 'font-medium text-inkMuted'
                }`}
              >
                总览
              </Text>
            </MotionPressable>

            {blocks.map((block) => {
              const isSelected = selectedBoardView === block.id;
              const palette = BLOCK_ACCENTS[block.type];
              const summary = blockOverviewSummaries.get(block.id);

              return (
                <MotionPressable
                  key={`pill-${block.id}`}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={block.title}
                  onPress={() => {
                    setReorderMode(false);
                    setSelectedBoardView(block.id);
                    boardScrollRef.current?.scrollTo({ y: 0, animated: false });
                  }}
                  scaleTo={0.96}
                  style={{
                    backgroundColor: isSelected
                      ? palette.accent
                      : THEME_COLORS.lineSoft,
                  }}
                  className="flex-row items-center gap-1.5 rounded-full px-3.5 py-1.5"
                >
                  <View
                    style={{
                      backgroundColor: isSelected ? '#FFFFFF' : palette.accent,
                    }}
                    className="h-1.5 w-1.5 rounded-full"
                  />
                  <Text
                    className={`text-xs ${
                      isSelected
                        ? 'font-bold text-white'
                        : 'font-medium text-ink/85'
                    }`}
                    numberOfLines={1}
                  >
                    {summary?.pillText ?? block.title}
                  </Text>
                </MotionPressable>
              );
            })}
          </ScrollView>

          {canOpenAddBlockSheet && !reorderMode ? (
            <View className="border-l border-lineSoft pl-2.5 pr-4">
              <MotionPressable
                accessibilityRole="button"
                accessibilityLabel={
                  permissions.canManageBlocks ? '添加积木' : '发起新投票'
                }
                onPress={handleOpenAddSheet}
                scaleTo={0.92}
                className="h-7 w-7 items-center justify-center rounded-full border border-primaryBorder bg-primarySoft"
              >
                <Plus
                  size={14}
                  color={THEME_COLORS.primaryDeep}
                  strokeWidth={2.5}
                />
              </MotionPressable>
            </View>
          ) : null}
        </View>
      ) : null}

      {isChatVisible ? (
        <View className="flex-1">
          <ChatRoomView
            roomId={room.id}
            messages={messages}
            blockedUserIds={blockedUserIds}
            members={activeMembers}
            permissions={permissions}
            loading={messagesLoading}
            refreshing={messagesRefetching}
            onRefresh={handleRefreshChat}
            onJumpToBlock={handleJumpToBlock}
            onConvertMessageToBlock={(msg, target) =>
              void handleConvertMessageToBlock(msg, target)
            }
          />
        </View>
      ) : isFocusedBlockView && focusedBlock ? (
        <ScrollView
          ref={boardScrollRef}
          className="flex-1 bg-white"
          contentContainerStyle={{ paddingBottom: 40 }}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing && !blocksLoading}
              onRefresh={handleRefreshAll}
              tintColor={BLOCK_ACCENTS[focusedBlock.type].accent}
              colors={[BLOCK_ACCENTS[focusedBlock.type].accent]}
            />
          }
        >
          {screenState.kind === 'ready' && screenState.syncWarning ? (
            <View className="px-4 pt-3">
              <OfflineSyncBanner
                message={screenState.syncWarning}
                onRetry={handleRefreshAll}
                retrying={isRefreshing}
              />
            </View>
          ) : null}

          {permissions.isArchived ? (
            <View className="mx-4 mt-3 flex-row items-center gap-2 rounded-2xl border border-[#F3DFB8] bg-[#FDF6E9] px-3.5 py-2.5">
              <Archive size={15} color={THEME_COLORS.warning} />
              <Text className="flex-1 text-xs font-medium text-[#9B5F0F]">
                活动已归档 · 当前为只读复盘模式
              </Text>
            </View>
          ) : null}

          <View className="px-4 pt-4">{renderFocusedBlock(focusedBlock)}</View>
        </ScrollView>
      ) : (
        <ScrollView
          ref={boardScrollRef}
          className="flex-1 bg-surface px-4 pt-3.5"
          contentContainerStyle={{ paddingBottom: 36 }}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing && !blocksLoading}
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
            <View className="mb-3.5 flex-row items-center gap-2.5 rounded-2xl border border-[#F3DFB8] bg-[#FDF6E9] px-3.5 py-3">
              <Archive size={17} color={THEME_COLORS.warning} />
              <View className="flex-1">
                <Text className="text-xs font-bold text-[#8A510A]">
                  活动已归档 · 全员只读模式
                </Text>
                <Text className="mt-0.5 text-[11px] text-[#9B5F0F]">
                  仅支持浏览记录与导出复盘长图 / PDF
                </Text>
              </View>
            </View>
          ) : null}

          {announcementSummary.hasAnnouncement ? (
            shouldShowExpandedAnnouncement ? (
              <View className="mb-3.5 rounded-2xl border border-[#F3E2D4] bg-[#FDF6F0] px-3.5 py-3">
                <View className="flex-row items-center justify-between gap-2">
                  <View className="flex-row items-center gap-2">
                    <Megaphone size={14} color={THEME_COLORS.primary} />
                    <Text className="text-xs font-bold text-ink">房间公告</Text>
                    <Text className="text-[11px] text-[#8C6B54]">
                      已收到 {announcementSummary.ackedCount}/
                      {announcementSummary.totalCount}
                    </Text>
                  </View>
                  {myMembership && myMembership.role !== 'member' ? (
                    <Badge
                      label={ROLE_LABELS[myMembership.role]}
                      variant={
                        myMembership.role === 'host' ? 'primary' : 'warning'
                      }
                    />
                  ) : null}
                </View>

                <Text className="mt-2 text-[13px] leading-5 text-ink/90">
                  {room.announcement}
                </Text>

                <View className="mt-2.5 flex-row items-center justify-between">
                  <MotionPressable
                    accessibilityRole="button"
                    accessibilityLabel="查看公告已读确认名单"
                    onPress={() => setAckSheetVisible(true)}
                    scaleTo={0.96}
                    className="flex-row items-center gap-0.5 py-1"
                  >
                    <Text className="text-[11px] font-semibold text-[#8C6B54]">
                      查看已读名单
                    </Text>
                    <ChevronRight size={12} color="#8C6B54" />
                  </MotionPressable>

                  {!announcementSummary.hasCurrentUserAcked &&
                  !permissions.isReadOnly ? (
                    <MotionPressable
                      accessibilityRole="button"
                      accessibilityLabel="我已阅读并确认收到"
                      disabled={ackAnnouncementMutation.isPending}
                      onPress={() => {
                        setAnnouncementExpanded(false);
                        ackAnnouncementMutation.mutate();
                      }}
                      scaleTo={0.95}
                      className="flex-row items-center gap-1 rounded-full bg-primary px-3.5 py-1.5"
                    >
                      {ackAnnouncementMutation.isPending ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <CheckCircle2 size={13} color="#FFFFFF" />
                      )}
                      <Text className="text-xs font-semibold text-white">
                        我已收到
                      </Text>
                    </MotionPressable>
                  ) : (
                    <MotionPressable
                      accessibilityRole="button"
                      accessibilityLabel="收起公告"
                      onPress={() => setAnnouncementExpanded(false)}
                      scaleTo={0.95}
                      className="rounded-full bg-white px-3 py-1"
                    >
                      <Text className="text-[11px] font-semibold text-inkMuted">
                        收起
                      </Text>
                    </MotionPressable>
                  )}
                </View>
              </View>
            ) : (
              <MotionPressable
                accessibilityRole="button"
                accessibilityLabel="展开房间公告"
                onPress={() => setAnnouncementExpanded(true)}
                scaleTo={0.985}
                className="mb-3.5 flex-row items-center justify-between gap-2 rounded-2xl border border-line bg-white px-3.5 py-2.5"
              >
                <View className="flex-1 flex-row items-center gap-2">
                  <CheckCircle2 size={14} color={THEME_COLORS.success} />
                  <Text
                    className="flex-1 text-xs text-inkMuted"
                    numberOfLines={1}
                  >
                    <Text className="font-semibold text-ink">
                      公告已确认 ({announcementSummary.ackedCount}/
                      {announcementSummary.totalCount})
                    </Text>
                    {' · '}
                    {room.announcement}
                  </Text>
                </View>
                <Text className="text-[11px] font-semibold text-inkSubtle">
                  展开
                </Text>
              </MotionPressable>
            )
          ) : permissions.isAdminOrHost && !permissions.isReadOnly ? (
            <MotionPressable
              accessibilityRole="button"
              accessibilityLabel="前往发布房间公告"
              onPress={() => router.push(`/room/${room.id}/settings` as Href)}
              scaleTo={0.985}
              className="mb-3.5 flex-row items-center justify-between rounded-2xl border border-dashed border-line bg-white/80 px-3.5 py-2.5"
            >
              <View className="flex-row items-center gap-2">
                <Megaphone size={13} color={THEME_COLORS.inkSubtle} />
                <Text className="text-xs text-inkMuted">
                  暂无房间公告，点此发布集合通知或活动规则
                </Text>
              </View>
              <ChevronRight size={14} color={THEME_COLORS.inkSubtle} />
            </MotionPressable>
          ) : null}

          {pendingBoardActions.length > 0 ? (
            <View className="mb-4 rounded-2xl border border-primaryBorder bg-[#FFF9F6] px-3.5 py-1">
              {pendingBoardActions.map((action, idx) => {
                const dotColor =
                  action.kind === 'poll'
                    ? BLOCK_ACCENTS.poll.accent
                    : BLOCK_ACCENTS.task.accent;
                const ctaBg =
                  action.kind === 'poll'
                    ? BLOCK_ACCENTS.poll.soft
                    : BLOCK_ACCENTS.task.soft;
                const ctaText =
                  action.kind === 'poll'
                    ? BLOCK_ACCENTS.poll.deep
                    : BLOCK_ACCENTS.task.deep;

                return (
                  <View
                    key={action.id}
                    className={`flex-row items-center justify-between gap-2 py-2.5 ${
                      idx > 0 ? 'border-t border-[#F7E5DD]' : ''
                    }`}
                  >
                    <View className="flex-1 flex-row items-center gap-2">
                      <View
                        style={{ backgroundColor: dotColor }}
                        className="h-2 w-2 rounded-full"
                      />
                      <Text
                        className="flex-1 text-xs font-medium text-ink"
                        numberOfLines={1}
                      >
                        {action.text}
                      </Text>
                    </View>
                    <MotionPressable
                      accessibilityRole="button"
                      accessibilityLabel={action.ctaLabel}
                      onPress={() => {
                        setReorderMode(false);
                        setSelectedBoardView(action.blockId);
                        boardScrollRef.current?.scrollTo({
                          y: 0,
                          animated: false,
                        });
                      }}
                      scaleTo={0.94}
                      style={{ backgroundColor: ctaBg }}
                      className="rounded-full px-2.5 py-1"
                    >
                      <Text
                        style={{ color: ctaText }}
                        className="text-[11px] font-semibold"
                      >
                        {action.ctaLabel}
                      </Text>
                    </MotionPressable>
                  </View>
                );
              })}
            </View>
          ) : null}

          {blocksLoading && blocks.length === 0 ? (
            <View className="items-center py-12">
              <ActivityIndicator size="large" color={THEME_COLORS.primary} />
              <Text className="mt-3 text-xs text-inkMuted">
                正在同步协作模块...
              </Text>
            </View>
          ) : blocks.length === 0 ? (
            <View
              style={CARD_SHADOW}
              className="items-center rounded-[22px] border border-line bg-white px-6 py-10"
            >
              <View className="mb-3 h-12 w-12 items-center justify-center rounded-full bg-primarySoft">
                <LayoutGrid size={22} color={THEME_COLORS.primary} />
              </View>
              <Text className="text-base font-bold text-ink">
                房间还没有协作模块
              </Text>
              <Text className="mt-1.5 text-center text-xs leading-5 text-inkMuted">
                {canOpenAddBlockSheet
                  ? '添加投票、分工、日程轴或 AA 分账，点击顶部胶囊即可专注协作'
                  : permissions.isArchived
                    ? '该活动已归档，当前处于只读复盘模式'
                    : '等待房主或管理员添加协作模块'}
              </Text>
              {canOpenAddBlockSheet ? (
                <View className="mt-4">
                  <Button
                    title={
                      permissions.canManageBlocks ? '添加第一个积木' : '发起新投票'
                    }
                    variant="primary"
                    size="sm"
                    leftIcon={<Plus size={15} color="#FFFFFF" strokeWidth={2.4} />}
                    onPress={handleOpenAddSheet}
                  />
                </View>
              ) : null}
            </View>
          ) : (
            <>
              <View className="mb-2 flex-row items-center justify-between px-1">
                <Text className="text-xs font-semibold text-inkMuted">
                  {reorderMode
                    ? '点击右侧箭头调整模块顺序'
                    : `当前协作结论 · ${blocks.length} 个模块`}
                </Text>
                {permissions.canReorderBlocks && blocks.length > 1 ? (
                  <MotionPressable
                    accessibilityRole="button"
                    accessibilityLabel={reorderMode ? '完成排序' : '调整顺序'}
                    onPress={() => setReorderMode((prev) => !prev)}
                    scaleTo={0.95}
                    className={`flex-row items-center gap-1 rounded-full px-2.5 py-1 ${
                      reorderMode
                        ? 'bg-primarySoft'
                        : 'bg-transparent'
                    }`}
                  >
                    <ArrowUpDown
                      size={12}
                      color={
                        reorderMode
                          ? THEME_COLORS.primaryDeep
                          : THEME_COLORS.inkMuted
                      }
                    />
                    <Text
                      className={`text-xs font-semibold ${
                        reorderMode ? 'text-primaryDeep' : 'text-inkMuted'
                      }`}
                    >
                      {reorderMode ? '完成排序' : '调整顺序'}
                    </Text>
                  </MotionPressable>
                ) : null}
              </View>

              <View
                style={CARD_SHADOW}
                className="overflow-hidden rounded-[22px] border border-line bg-white"
              >
                {blocks.map((block, index) => {
                  const palette = BLOCK_ACCENTS[block.type];
                  const summary = blockOverviewSummaries.get(block.id);
                  const canMoveUp = index > 0;
                  const canMoveDown = index < blocks.length - 1;
                  const reordering = reorderBlocksMutation.isPending;

                  const renderPreview = (preview?: BlockOverviewPreview) => {
                    if (!preview || reorderMode) {
                      return null;
                    }

                    switch (preview.kind) {
                      case 'schedule':
                        return (
                          <View className="mt-2.5 gap-1.5 pl-0.5">
                            {preview.nodes.map((node, nodeIdx) => (
                              <View
                                key={node.id}
                                className="flex-row items-center gap-2"
                              >
                                <Text className="w-10 text-[11px] font-semibold text-inkMuted">
                                  {node.time}
                                </Text>
                                <View
                                  style={{
                                    backgroundColor:
                                      nodeIdx === 0
                                        ? BLOCK_ACCENTS.schedule.accent
                                        : BLOCK_ACCENTS.schedule.border,
                                  }}
                                  className="h-1.5 w-1.5 rounded-full"
                                />
                                <Text
                                  className="flex-1 text-xs text-ink/90"
                                  numberOfLines={1}
                                >
                                  {node.title}
                                  {node.location ? (
                                    <Text className="text-inkSubtle">
                                      {' · '}
                                      {node.location}
                                    </Text>
                                  ) : null}
                                </Text>
                              </View>
                            ))}
                            {preview.remainingCount > 0 ? (
                              <Text className="pl-12 text-[11px] text-inkSubtle">
                                还有 {preview.remainingCount} 个日程节点
                              </Text>
                            ) : null}
                          </View>
                        );

                      case 'poll_options':
                        return (
                          <View className="mt-2.5 gap-1.5">
                            {preview.options.map((opt) => (
                              <View
                                key={opt.id}
                                className="relative overflow-hidden rounded-xl bg-surface px-2.5 py-1.5"
                              >
                                <AnimatedProgressBar
                                  percent={opt.percent}
                                  variant="backgroundFill"
                                  fillColor={
                                    opt.myVoted
                                      ? BLOCK_ACCENTS.poll.barFill
                                      : 'rgba(180, 170, 158, 0.22)'
                                  }
                                />
                                <View className="flex-row items-center justify-between gap-2">
                                  <Text
                                    className="flex-1 text-xs font-medium text-ink"
                                    numberOfLines={1}
                                  >
                                    {opt.label}
                                  </Text>
                                  <Text
                                    style={{
                                      color: opt.myVoted
                                        ? BLOCK_ACCENTS.poll.deep
                                        : THEME_COLORS.inkMuted,
                                    }}
                                    className="text-[11px] font-semibold"
                                  >
                                    {opt.votes} 票
                                  </Text>
                                </View>
                              </View>
                            ))}
                            {preview.remainingCount > 0 ? (
                              <Text className="text-[11px] text-inkSubtle">
                                另有 {preview.remainingCount} 个候选项
                              </Text>
                            ) : null}
                          </View>
                        );

                      case 'poll_slots':
                        return (
                          <View className="mt-2 flex-row flex-wrap gap-1.5">
                            {preview.slots.map((slot) => (
                              <View
                                key={slot.id}
                                style={{
                                  backgroundColor: BLOCK_ACCENTS.poll.soft,
                                }}
                                className="rounded-full px-2.5 py-1"
                              >
                                <Text
                                  style={{ color: BLOCK_ACCENTS.poll.deep }}
                                  className="text-[11px] font-semibold"
                                >
                                  {slot.label} · {slot.votes} 人有空
                                </Text>
                              </View>
                            ))}
                          </View>
                        );

                      case 'tasks':
                        return (
                          <View className="mt-2 gap-1.5">
                            {preview.items.map((task) => {
                              const isDone = task.status === 'done';
                              const isUnclaimed = task.status === 'unclaimed';
                              return (
                                <View
                                  key={task.id}
                                  className="flex-row items-center gap-2"
                                >
                                  <View
                                    style={{
                                      borderColor: isUnclaimed
                                        ? '#BEB8B0'
                                        : BLOCK_ACCENTS.task.accent,
                                      backgroundColor: isDone
                                        ? BLOCK_ACCENTS.task.accent
                                        : isUnclaimed
                                          ? 'transparent'
                                          : BLOCK_ACCENTS.task.soft,
                                      borderStyle: isUnclaimed
                                        ? 'dashed'
                                        : 'solid',
                                    }}
                                    className="h-3 w-3 rounded-full border-[1.5px]"
                                  />
                                  <Text
                                    className={`flex-1 text-xs ${
                                      isDone
                                        ? 'text-inkSubtle line-through'
                                        : 'text-ink/90'
                                    }`}
                                    numberOfLines={1}
                                  >
                                    {task.title}
                                  </Text>
                                  <Text
                                    style={{
                                      color: isUnclaimed
                                        ? BLOCK_ACCENTS.task.deep
                                        : THEME_COLORS.inkSubtle,
                                    }}
                                    className="text-[10px] font-medium"
                                  >
                                    {isDone
                                      ? '已完成'
                                      : isUnclaimed
                                        ? '待认领'
                                        : '进行中'}
                                  </Text>
                                </View>
                              );
                            })}
                            {preview.remainingCount > 0 ? (
                              <Text className="pl-5 text-[11px] text-inkSubtle">
                                还有 {preview.remainingCount} 项分工
                              </Text>
                            ) : null}
                          </View>
                        );

                      case 'expense_transfers':
                        return (
                          <View className="mt-2.5 gap-1 rounded-xl bg-[#FAF6EE] px-2.5 py-2">
                            {preview.transfers.map((tx, txIdx) => (
                              <View
                                key={`${tx.fromUserId}-${tx.toUserId}-${txIdx}`}
                                className="flex-row items-center justify-between gap-2"
                              >
                                <Text
                                  className="flex-1 text-xs text-inkMuted"
                                  numberOfLines={1}
                                >
                                  {memberNameById.get(tx.fromUserId) ?? '成员'}{' '}
                                  →{' '}
                                  {memberNameById.get(tx.toUserId) ?? '成员'}
                                </Text>
                                <Text
                                  style={{ color: BLOCK_ACCENTS.expense.deep }}
                                  className="text-xs font-bold"
                                >
                                  {tx.amountText}
                                </Text>
                              </View>
                            ))}
                            {preview.remainingCount > 0 ? (
                              <Text className="text-[10px] text-inkSubtle">
                                另有 {preview.remainingCount} 笔转账
                              </Text>
                            ) : null}
                          </View>
                        );
                    }
                  };

                  const hasRichPreview = Boolean(
                    summary?.preview && !reorderMode,
                  );

                  const rowBody = (
                    <View
                      className={`px-4 py-3.5 ${
                        index > 0 ? 'border-t border-lineSoft' : ''
                      }`}
                    >
                      <View className="flex-row items-center gap-3">
                        <View
                          style={{ backgroundColor: palette.soft }}
                          className="h-9 w-9 items-center justify-center rounded-full"
                        >
                          <BlockTypeIcon
                            type={block.type}
                            color={palette.accent}
                            size={17}
                          />
                        </View>

                        <View className="flex-1">
                          <View className="flex-row items-center justify-between gap-2">
                            <Text
                              className="flex-1 text-sm font-bold text-ink"
                              numberOfLines={1}
                            >
                              {block.title}
                            </Text>
                            {summary?.statText ? (
                              <Text
                                style={{
                                  color: summary.isAlert
                                    ? THEME_COLORS.danger
                                    : palette.deep,
                                }}
                                className="text-xs font-bold"
                              >
                                {summary.statText}
                              </Text>
                            ) : null}
                          </View>

                          {summary?.progressPercent !== undefined ? (
                            <View className="mt-1.5">
                              <AnimatedProgressBar
                                percent={summary.progressPercent}
                                height={5}
                                fillColor={
                                  summary.isAlert
                                    ? THEME_COLORS.danger
                                    : palette.accent
                                }
                                trackColor={palette.track}
                              />
                              {!hasRichPreview ? (
                                <Text
                                  className="mt-1 text-[11px] text-inkMuted"
                                  numberOfLines={1}
                                >
                                  {summary.conclusion}
                                </Text>
                              ) : null}
                            </View>
                          ) : !hasRichPreview ? (
                            <Text
                              className="mt-0.5 text-xs text-inkMuted"
                              numberOfLines={1}
                            >
                              {summary?.conclusion ?? ''}
                            </Text>
                          ) : null}
                        </View>

                        {reorderMode ? (
                          <View className="flex-row items-center gap-1">
                            <MotionPressable
                              accessibilityRole="button"
                              accessibilityLabel={`上移模块 ${block.title}`}
                              disabled={!canMoveUp || reordering}
                              onPress={() => handleMoveBlock(block.id, 'up')}
                              scaleTo={0.9}
                              className={`h-8 w-8 items-center justify-center rounded-full border ${
                                canMoveUp && !reordering
                                  ? 'border-primaryBorder bg-primarySoft'
                                  : 'border-line bg-surface opacity-40'
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
                              accessibilityLabel={`下移模块 ${block.title}`}
                              disabled={!canMoveDown || reordering}
                              onPress={() => handleMoveBlock(block.id, 'down')}
                              scaleTo={0.9}
                              className={`h-8 w-8 items-center justify-center rounded-full border ${
                                canMoveDown && !reordering
                                  ? 'border-primaryBorder bg-primarySoft'
                                  : 'border-line bg-surface opacity-40'
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
                          </View>
                        ) : (
                          <ChevronRight
                            size={16}
                            color={THEME_COLORS.inkSubtle}
                          />
                        )}
                      </View>

                      {hasRichPreview ? (
                        <View className="pl-12">
                          {renderPreview(summary?.preview)}
                        </View>
                      ) : null}
                    </View>
                  );

                  if (reorderMode) {
                    return <View key={block.id}>{rowBody}</View>;
                  }

                  return (
                    <MotionPressable
                      key={block.id}
                      accessibilityRole="button"
                      accessibilityLabel={`进入 ${block.title}`}
                      onPress={() => {
                        setSelectedBoardView(block.id);
                        boardScrollRef.current?.scrollTo({
                          y: 0,
                          animated: false,
                        });
                      }}
                      scaleTo={0.985}
                      pressOpacity={0.92}
                    >
                      {rowBody}
                    </MotionPressable>
                  );
                })}
              </View>
            </>
          )}

          {room.chat_enabled && !reorderMode ? (
            <View className="mt-4">
              <View className="mb-2 flex-row items-center justify-between px-1">
                <Text className="text-xs font-semibold text-inkMuted">
                  聊天室动态
                </Text>
                <MotionPressable
                  accessibilityRole="button"
                  accessibilityLabel="进入聊天室"
                  onPress={() => setActiveTab('chat')}
                  scaleTo={0.95}
                  className="flex-row items-center gap-0.5"
                >
                  <Text className="text-xs font-semibold text-primaryDeep">
                    去聊天
                  </Text>
                  <ChevronRight size={13} color={THEME_COLORS.primaryDeep} />
                </MotionPressable>
              </View>

              <MotionPressable
                accessibilityRole="button"
                accessibilityLabel="查看聊天室最新消息"
                onPress={() => setActiveTab('chat')}
                scaleTo={0.985}
                style={CARD_SHADOW}
                className="rounded-[20px] border border-line bg-white px-4 py-3"
              >
                {recentChatMessages.length === 0 ? (
                  <View className="flex-row items-center justify-between gap-2">
                    <View className="flex-row items-center gap-2">
                      <MessageCircle size={14} color={THEME_COLORS.inkSubtle} />
                      <Text className="text-xs text-inkMuted">
                        暂无讨论消息，发一条消息和大家打个招呼吧
                      </Text>
                    </View>
                    <ChevronRight size={14} color={THEME_COLORS.inkSubtle} />
                  </View>
                ) : (
                  <View>
                    {recentChatMessages.map((msg, msgIdx) => {
                      const senderName =
                        msg.profiles?.nickname ??
                        (msg.sender_id
                          ? memberNameById.get(msg.sender_id)
                          : undefined) ??
                        '成员';
                      const timeText = formatCompactChatTime(msg.created_at);
                      const snippet =
                        msg.msg_type === 'block_card'
                          ? `[催办提醒] ${msg.content}`
                          : msg.content;

                      return (
                        <View
                          key={msg.id}
                          className={`flex-row items-center gap-2.5 ${
                            msgIdx > 0
                              ? 'mt-2.5 border-t border-lineSoft pt-2.5'
                              : ''
                          }`}
                        >
                          <Avatar
                            nickname={senderName}
                            color={msg.profiles?.avatar_color}
                            imageUrl={msg.profiles?.avatar_url}
                            size="xs"
                          />
                          <View className="flex-1">
                            <View className="flex-row items-center justify-between gap-2">
                              <Text
                                className="text-xs font-semibold text-ink"
                                numberOfLines={1}
                              >
                                {senderName}
                              </Text>
                              {timeText ? (
                                <Text className="text-[10px] text-inkSubtle">
                                  {timeText}
                                </Text>
                              ) : null}
                            </View>
                            <Text
                              className="mt-0.5 text-xs text-inkMuted"
                              numberOfLines={1}
                            >
                              {snippet}
                            </Text>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )}
              </MotionPressable>
            </View>
          ) : null}

          <MotionPressable
            accessibilityRole="button"
            accessibilityLabel="查看房间成员与设置"
            onPress={() => router.push(`/room/${room.id}/settings` as Href)}
            scaleTo={0.985}
            className="mt-4 flex-row items-center justify-between px-1 py-1.5"
          >
            <View className="flex-1 flex-row items-center gap-2 pr-2">
              <View className="flex-row items-center">
                {activeMembers.slice(0, 6).map((member, index) => (
                  <View
                    key={member.id}
                    style={{ marginLeft: index === 0 ? 0 : -6 }}
                    className="rounded-full border-2 border-surface"
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
                  <View className="ml-1.5 rounded-full bg-primarySoft px-2 py-0.5">
                    <Text className="text-[10px] font-semibold text-primaryDeep">
                      +{activeMembers.length - 6}
                    </Text>
                  </View>
                ) : null}
              </View>
              <Text
                className="flex-1 text-xs text-inkMuted"
                numberOfLines={1}
              >
                {activeMembers.length} 人协作
                {eventWindow ? ` · ${eventWindow}` : ''}
              </Text>
            </View>
            <View className="flex-row items-center gap-0.5">
              <Text className="text-xs font-semibold text-inkMuted">管理</Text>
              <ChevronRight size={13} color={THEME_COLORS.inkMuted} />
            </View>
          </MotionPressable>
        </ScrollView>
      )}

      <SheetModal
        visible={addSheetVisible}
        onClose={() => setAddSheetVisible(false)}
        title="添加积木"
      >
        {!permissions.canManageBlocks && permissions.canCreatePollBlock ? (
          <View className="mb-3 rounded-2xl border border-primaryBorder bg-primarySoft px-3.5 py-2.5">
            <Text className="text-xs font-medium text-primaryDeep">
              房主已允许成员发起投票，你可以为当前房间新建一个投票积木
            </Text>
          </View>
        ) : null}

        <Text className="mb-2.5 text-xs font-semibold text-inkMuted">
          选择积木类型
        </Text>
        <View className="mb-4 gap-2.5">
          {allowedBlockTypes.map((type) => {
            const selected = selectedType === type;
            const palette = BLOCK_ACCENTS[type];
            return (
              <MotionPressable
                key={type}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                onPress={() => handleSelectBlockType(type)}
                scaleTo={0.975}
                style={{
                  borderColor: selected ? palette.accent : THEME_COLORS.line,
                  backgroundColor: selected
                    ? palette.soft
                    : THEME_COLORS.primaryMist,
                }}
                className="flex-row items-center gap-3 rounded-2xl border px-3.5 py-3"
              >
                <View
                  style={{
                    backgroundColor: selected ? '#FFFFFF' : palette.soft,
                  }}
                  className="h-10 w-10 items-center justify-center rounded-full"
                >
                  <BlockTypeIcon type={type} color={palette.accent} />
                </View>
                <View className="flex-1">
                  <Text
                    style={{
                      color: selected ? palette.deep : THEME_COLORS.ink,
                    }}
                    className="text-sm font-bold"
                  >
                    {BLOCK_TYPE_LABELS[type]}
                  </Text>
                  <Text className="mt-0.5 text-[11px] text-inkMuted">
                    {BLOCK_TYPE_DESCRIPTIONS[type]}
                  </Text>
                </View>
                <AnimatedCheckBadge
                  checked={selected}
                  size={20}
                  iconSize={12}
                  accentColor={palette.accent}
                />
              </MotionPressable>
            );
          })}
        </View>

        <View className="mb-4">
          <View className="mb-1.5 flex-row items-center justify-between">
            <Text className="text-xs font-semibold text-inkMuted">
              积木标题
            </Text>
            <Text className="text-xs text-inkSubtle">
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
            placeholderTextColor={THEME_COLORS.inkSubtle}
            className="rounded-2xl border border-line bg-surface px-4 py-3 text-sm text-ink"
          />
        </View>

        {selectedType === 'poll' ? (
          <AnimatedPanelReveal key="config-poll">
            <View className="mb-4 gap-3">
              <View>
                <Text className="mb-2 text-xs font-semibold text-inkMuted">
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
                      <MotionPressable
                        key={modeOption.key}
                        flex
                        scaleTo={0.96}
                        onPress={() => setPollMode(modeOption.key)}
                        className={`items-center rounded-xl border py-2.5 ${
                          selected
                            ? 'border-primary bg-primarySoft'
                            : 'border-line bg-surface'
                        }`}
                      >
                        <Text
                          className={`text-xs font-semibold ${
                            selected ? 'text-primaryDeep' : 'text-inkMuted'
                          }`}
                        >
                          {modeOption.label}
                        </Text>
                      </MotionPressable>
                    );
                  })}
                </View>
              </View>

              {pollMode === 'option' ? (
                <View className="flex-row items-center justify-between rounded-2xl border border-lineSoft bg-surface px-3.5 py-2.5">
                  <Text className="text-xs font-semibold text-ink">允许多选</Text>
                  <Switch
                    value={pollMultiple}
                    onValueChange={setPollMultiple}
                    trackColor={{
                      false: THEME_COLORS.switchOffTrack,
                      true: THEME_COLORS.primaryBorder,
                    }}
                    thumbColor={
                      pollMultiple ? THEME_COLORS.primary : THEME_COLORS.switchOffThumb
                    }
                  />
                </View>
              ) : null}

              <View className="flex-row items-center justify-between rounded-2xl border border-lineSoft bg-surface px-3.5 py-2.5">
                <Text className="text-xs font-semibold text-ink">
                  匿名投票（隐藏投票人头像）
                </Text>
                <Switch
                  value={pollAnonymous}
                  onValueChange={setPollAnonymous}
                  trackColor={{
                    false: THEME_COLORS.switchOffTrack,
                    true: THEME_COLORS.primaryBorder,
                  }}
                  thumbColor={
                    pollAnonymous ? THEME_COLORS.primary : THEME_COLORS.switchOffThumb
                  }
                />
              </View>
            </View>
          </AnimatedPanelReveal>
        ) : null}

        {selectedType === 'task' ? (
          <AnimatedPanelReveal key="config-task">
            <View className="mb-4 flex-row items-center justify-between rounded-2xl border border-lineSoft bg-surface px-3.5 py-2.5">
              <View className="flex-1 pr-3">
                <Text className="text-xs font-semibold text-ink">
                  允许普通成员新增任务
                </Text>
                <Text className="mt-0.5 text-[11px] text-inkMuted">
                  关闭后仅房主与管理员可发布任务条目
                </Text>
              </View>
              <Switch
                value={taskAllowMemberCreate}
                onValueChange={setTaskAllowMemberCreate}
                trackColor={{
                  false: THEME_COLORS.switchOffTrack,
                  true: THEME_COLORS.primaryBorder,
                }}
                thumbColor={
                  taskAllowMemberCreate
                    ? THEME_COLORS.primary
                    : THEME_COLORS.switchOffThumb
                }
              />
            </View>
          </AnimatedPanelReveal>
        ) : null}

        {selectedType === 'schedule' ? (
          <AnimatedPanelReveal key="config-schedule">
            <View className="mb-4">
              <Text className="mb-2 text-xs font-semibold text-inkMuted">
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
                    <MotionPressable
                      key={groupOpt.key}
                      flex
                      scaleTo={0.96}
                      onPress={() => setScheduleGroupBy(groupOpt.key)}
                      className={`items-center rounded-xl border py-2.5 ${
                        selected
                          ? 'border-primary bg-primarySoft'
                          : 'border-line bg-surface'
                      }`}
                    >
                      <Text
                        className={`text-xs font-semibold ${
                          selected ? 'text-primaryDeep' : 'text-inkMuted'
                        }`}
                      >
                        {groupOpt.label}
                      </Text>
                    </MotionPressable>
                  );
                })}
              </View>
            </View>
          </AnimatedPanelReveal>
        ) : null}

        {selectedType === 'expense' ? (
          <AnimatedPanelReveal key="config-expense">
            <View className="mb-4 gap-3">
              <View>
                <Text className="mb-2 text-xs font-semibold text-inkMuted">
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
                      <MotionPressable
                        key={expOpt.key}
                        flex
                        scaleTo={0.96}
                        onPress={() => setExpenseMode(expOpt.key)}
                        className={`items-center rounded-xl border py-2.5 ${
                          selected
                            ? 'border-primary bg-primarySoft'
                            : 'border-line bg-surface'
                        }`}
                      >
                        <Text
                          className={`text-xs font-semibold ${
                            selected ? 'text-primaryDeep' : 'text-inkMuted'
                          }`}
                        >
                          {expOpt.label}
                        </Text>
                      </MotionPressable>
                    );
                  })}
                </View>
              </View>

              {expenseMode === 'budget' ? (
                <View>
                  <Text className="mb-1.5 text-xs font-semibold text-inkMuted">
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
                    placeholderTextColor={THEME_COLORS.inkSubtle}
                    className="rounded-2xl border border-line bg-surface px-4 py-3 text-sm text-ink"
                  />
                </View>
              ) : null}
            </View>
          </AnimatedPanelReveal>
        ) : null}

        {addBlockError ? (
          <View className="mb-4 rounded-xl border border-[#FAD2D0] bg-[#FEF2F2] px-3.5 py-2.5">
            <Text className="text-xs font-medium text-[#C94545]">
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
        visible={ackSheetVisible}
        onClose={() => setAckSheetVisible(false)}
        title="公告收到情况"
      >
        <View className="mb-4 rounded-2xl border border-line bg-surface px-3.5 py-3">
          <Text className="text-xs font-semibold text-inkMuted">当前公告</Text>
          <Text className="mt-1 text-sm leading-5 text-ink">
            {room.announcement}
          </Text>
        </View>

        <View className="mb-4">
          <View className="mb-2 flex-row items-center justify-between">
            <Text className="text-xs font-bold text-ink">
              尚未确认 ({announcementSummary.unackedCount})
            </Text>
            {announcementSummary.unackedCount === 0 ? (
              <Badge label="全员已收到" variant="success" />
            ) : null}
          </View>

          {announcementSummary.unackedMembers.length === 0 ? (
            <View className="rounded-2xl border border-[#CBEAD9] bg-[#EEF8F3] px-3.5 py-3">
              <Text className="text-center text-xs font-medium text-[#247254]">
                太棒了，所有成员都已确认收到本条公告！
              </Text>
            </View>
          ) : (
            <View className="gap-2">
              {announcementSummary.unackedMembers.map((member) => (
                <View
                  key={member.id}
                  className="flex-row items-center justify-between rounded-2xl border border-line bg-white px-3 py-2.5"
                >
                  <View className="flex-row items-center gap-2.5">
                    <Avatar
                      nickname={member.profiles?.nickname}
                      color={member.profiles?.avatar_color}
                      imageUrl={member.profiles?.avatar_url}
                      size="sm"
                    />
                    <Text className="text-sm font-semibold text-ink">
                      {member.profiles?.nickname ?? '伙伴'}
                      {member.user_id === currentUserId ? '（我）' : ''}
                    </Text>
                  </View>
                  <Badge label="待确认" variant="warning" />
                </View>
              ))}
            </View>
          )}
        </View>

        {permissions.isAdminOrHost &&
        room.chat_enabled &&
        !permissions.isReadOnly &&
        announcementSummary.unackedCount > 0 ? (
          <View className="mb-4">
            <Button
              title={`在聊天室 @提醒这 ${announcementSummary.unackedCount} 人`}
              variant="secondary"
              size="md"
              fullWidth
              loading={remindingUnacked}
              onPress={() => void handleRemindUnackedInChat()}
            />
          </View>
        ) : null}

        <View className="mb-2">
          <Text className="mb-2 text-xs font-bold text-ink">
            已确认收到 ({announcementSummary.ackedCount})
          </Text>
          {announcementSummary.ackedMembers.length === 0 ? (
            <View className="rounded-2xl border border-dashed border-line bg-surface px-3.5 py-4">
              <Text className="text-center text-xs text-inkSubtle">
                还没有人点击确认收到
              </Text>
            </View>
          ) : (
            <View className="gap-2">
              {announcementSummary.ackedMembers.map(({ member, ackedAt }) => (
                <View
                  key={member.id}
                  className="flex-row items-center justify-between rounded-2xl border border-line bg-surface px-3 py-2.5"
                >
                  <View className="flex-row items-center gap-2.5">
                    <Avatar
                      nickname={member.profiles?.nickname}
                      color={member.profiles?.avatar_color}
                      imageUrl={member.profiles?.avatar_url}
                      size="sm"
                    />
                    <Text className="text-sm font-semibold text-ink">
                      {member.profiles?.nickname ?? '伙伴'}
                      {member.user_id === currentUserId ? '（我）' : ''}
                    </Text>
                  </View>
                  <View className="flex-row items-center gap-1">
                    <Clock size={11} color={THEME_COLORS.success} />
                    <Text className="text-[11px] font-medium text-[#2E8B67]">
                      {formatAckTimestamp(ackedAt) || '已确认'}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>
      </SheetModal>

      <SheetModal
        visible={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="确认移除积木模块？"
      >
        <Text className="mb-5 text-sm leading-6 text-inkMuted">
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
