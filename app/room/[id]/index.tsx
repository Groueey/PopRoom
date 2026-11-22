import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import {
  AlertTriangle,
  Archive,
  ArrowUpDown,
  BarChart3,
  Calendar,
  CalendarClock,
  CheckSquare,
  ChevronLeft,
  LayoutGrid,
  Megaphone,
  MessageCircle,
  Plus,
  Settings,
  Share2,
  Users,
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
  AnimatedBlockShell,
  AnimatedCheckBadge,
  AnimatedPanelReveal,
  LayoutAnimationConfig,
  MotionPressable,
} from '../../../src/components/ui/Motion';
import { OfflineSyncBanner } from '../../../src/components/ui/OfflineSyncBanner';
import { SheetModal } from '../../../src/components/ui/SheetModal';
import { useRoomPermissions } from '../../../src/hooks/useRoomPermissions';
import { useRoomRealtime } from '../../../src/hooks/useRoomRealtime';
import {
  type BlockMoveDirection,
  applyBlockOrderToList,
  moveBlockInOrder,
} from '../../../src/lib/blockOrderHelpers';
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
import { FLOATING_SHADOW, THEME_COLORS } from '../../../src/lib/theme';
import type { PollTally } from '../../../src/schemas/blocks';
import { useAuthStore } from '../../../src/stores/authStore';
import { useUiStore } from '../../../src/stores/uiStore';
import type { BlockType } from '../../../src/types/database';

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

  const { data: lastReadAt = null, isFetched: chatReadFetched } = useQuery({
    queryKey: QUERY_KEYS.roomChatRead(roomId, currentUserId ?? undefined),
    queryFn: () => fetchRoomChatRead(roomId, currentUserId ?? ''),
    enabled: Boolean(roomId && currentUserId && room?.chat_enabled),
  });

  const { data: blockedUsers = [], refetch: refetchBlockedUsers } = useQuery({
    queryKey: QUERY_KEYS.userBlocks(currentUserId ?? undefined),
    queryFn: () => fetchMyBlockedUsers(currentUserId ?? ''),
    enabled: Boolean(currentUserId),
  });

  const blockedUserIds = useMemo(
    () => new Set(blockedUsers.map((entry) => entry.blocked_id)),
    [blockedUsers],
  );

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
    chatEnabled: room?.chat_enabled ?? false,
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

  const [activeTab, setActiveTab] = useState<RoomActiveTab>('board');
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
  const blockOffsetsRef = useRef<Record<string, number>>({});
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastMarkedReadStampRef = useRef<string | null>(null);

  const [justAddedBlockId, setJustAddedBlockId] = useState<string | null>(null);
  const clearJustAddedBlock = useCallback(() => {
    setJustAddedBlockId(null);
  }, []);
  const clearPendingBlockDraft = useCallback(() => {
    setPendingBlockDraft(null);
  }, []);

  const unreadChatCount = useMemo(() => {
    if (!room?.chat_enabled) {
      return 0;
    }
    return countUnreadChatMessages(
      messages,
      lastReadAt,
      currentUserId,
      blockedUserIds,
    );
  }, [room?.chat_enabled, messages, lastReadAt, currentUserId, blockedUserIds]);

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
    setReorderMode(false);
    setHighlightedBlockId(null);
    setPendingBlockDraft(null);
    blockOffsetsRef.current = {};
    lastMarkedReadStampRef.current = null;
  }, [roomId]);

  useEffect(() => {
    lastMarkedReadStampRef.current = null;
  }, [currentUserId]);

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
      }
      if (scrollTimerRef.current) {
        clearTimeout(scrollTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (room && !room.chat_enabled && activeTab === 'chat') {
      setActiveTab('board');
      showToast('房主已关闭聊天室', 'info');
    }
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

    void markRoomChatRead(roomId, currentUserId)
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

  const scheduleScrollToBlock = useCallback((blockId: string, delayMs = 140) => {
    if (scrollTimerRef.current) {
      clearTimeout(scrollTimerRef.current);
    }
    scrollTimerRef.current = setTimeout(() => {
      requestAnimationFrame(() => {
        const targetY = blockOffsetsRef.current[blockId];
        if (typeof targetY === 'number') {
          boardScrollRef.current?.scrollTo({
            y: Math.max(0, targetY - 12),
            animated: true,
          });
        } else {
          boardScrollRef.current?.scrollToEnd({ animated: true });
        }
      });
    }, delayMs);
  }, []);

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
      triggerHighlightBlock(blockId);
      scheduleScrollToBlock(blockId, 140);
    },
    [blocks, scheduleScrollToBlock, showToast, triggerHighlightBlock],
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
          setJustAddedBlockId(created.id);
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
      triggerHighlightBlock(targetBlockId);
      scheduleScrollToBlock(targetBlockId, 180);
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
      scheduleScrollToBlock,
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
      const created = await createBlock(payload);
      setAddSheetVisible(false);
      setJustAddedBlockId(created.id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.roomBlocks(roomId) }),
        queryClient.invalidateQueries({
          queryKey: QUERY_KEYS.roomPollTallies(roomId),
        }),
      ]);
      setTimeout(() => {
        boardScrollRef.current?.scrollToEnd({ animated: true });
      }, 180);
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

  return (
    <SafeAreaView
      className="flex-1 bg-surface"
      edges={isChatVisible ? ['top'] : ['top', 'bottom']}
    >
      <View className="flex-row items-center justify-between border-b border-line bg-white px-4 py-3">
        <View className="flex-1 flex-row items-center gap-2.5 pr-2">
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
            <Text className="text-base font-bold text-ink" numberOfLines={1}>
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
                className="flex-row items-center gap-1 rounded-full border border-primaryBorder bg-primarySoft px-2 py-0.5"
              >
                <Text className="text-[11px] font-bold tracking-wider text-primaryDeep">
                  {room.room_code}
                </Text>
                <Share2 size={10} color={THEME_COLORS.primaryDeep} />
              </MotionPressable>
            </View>
          </View>
        </View>

        <View className="flex-row items-center gap-2">
          <MotionPressable
            accessibilityRole="button"
            accessibilityLabel="导出复盘"
            onPress={() => router.push(`/room/${room.id}/export` as Href)}
            scaleTo={0.92}
            className="h-9 w-9 items-center justify-center rounded-full bg-surface"
          >
            <Share2 size={17} color={THEME_COLORS.ink} />
          </MotionPressable>
          <MotionPressable
            accessibilityRole="button"
            accessibilityLabel="房间设置"
            onPress={() => router.push(`/room/${room.id}/settings` as Href)}
            scaleTo={0.92}
            className="h-9 w-9 items-center justify-center rounded-full bg-surface"
          >
            <Settings size={17} color={THEME_COLORS.ink} />
          </MotionPressable>
        </View>
      </View>

      {room.chat_enabled ? (
        <View className="border-b border-line bg-white px-4 py-2">
          <View className="flex-row gap-1 rounded-2xl border border-lineSoft bg-surface p-1">
            <MotionPressable
              accessibilityRole="tab"
              accessibilityState={{ selected: activeTab === 'board' }}
              accessibilityLabel="协作看板"
              onPress={() => setActiveTab('board')}
              flex
              scaleTo={0.97}
              className={`flex-row items-center justify-center gap-1.5 rounded-xl py-2 ${
                activeTab === 'board' ? 'bg-primary' : 'bg-transparent'
              }`}
            >
              <LayoutGrid
                size={14}
                color={
                  activeTab === 'board' ? '#FFFFFF' : THEME_COLORS.inkMuted
                }
              />
              <Text
                className={`text-xs font-bold ${
                  activeTab === 'board' ? 'text-white' : 'text-inkMuted'
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
              scaleTo={0.97}
              className={`flex-row items-center justify-center gap-1.5 rounded-xl py-2 ${
                activeTab === 'chat' ? 'bg-primary' : 'bg-transparent'
              }`}
            >
              <MessageCircle
                size={14}
                color={activeTab === 'chat' ? '#FFFFFF' : THEME_COLORS.inkMuted}
              />
              <Text
                className={`text-xs font-bold ${
                  activeTab === 'chat' ? 'text-white' : 'text-inkMuted'
                }`}
              >
                聊天室
              </Text>
              {activeTab === 'board' && unreadChatCount > 0 ? (
                <View
                  style={{ backgroundColor: THEME_COLORS.danger }}
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
      ) : (
        <>
          <ScrollView
            ref={boardScrollRef}
            className="flex-1 px-4 pt-4"
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
          <View className="mb-4 flex-row items-center gap-2.5 rounded-2xl border border-[#F5DFB3] bg-[#FEF7E8] px-4 py-3">
            <Archive size={18} color={THEME_COLORS.warning} />
            <View className="flex-1">
              <Text className="text-xs font-bold text-[#8C5210]">
                活动已归档 · 全员只读模式
              </Text>
              <Text className="mt-0.5 text-xs text-[#A66214]">
                归档后仅支持浏览记录与导出复盘长图 / PDF，不可再修改积木或条目
              </Text>
            </View>
          </View>
        ) : null}

        <Card className="mb-4 overflow-hidden">
          <View className="mb-2.5 flex-row items-center justify-between gap-2">
            <View className="flex-row items-center gap-2">
              <View className="h-6 w-6 items-center justify-center rounded-lg bg-primarySoft">
                <Megaphone size={13} color={THEME_COLORS.primary} />
              </View>
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
                <View className="flex-row items-center gap-1 rounded-full border border-line bg-surface px-2.5 py-0.5">
                  <Calendar size={11} color={THEME_COLORS.inkMuted} />
                  <Text className="text-[11px] font-medium text-inkMuted">
                    {eventWindow}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>

          <Text
            className={`text-sm leading-5 ${
              room.announcement ? 'text-ink/85' : 'text-inkSubtle'
            }`}
          >
            {room.announcement ||
              '暂无公告，房主或管理员可在右上角设置中发布集合通知与活动规则'}
          </Text>

          <MotionPressable
            accessibilityRole="button"
            accessibilityLabel="查看房间成员"
            onPress={() => router.push(`/room/${room.id}/settings` as Href)}
            scaleTo={0.985}
            className="mt-3.5 flex-row items-center justify-between border-t border-lineSoft pt-3"
          >
            <View className="flex-row items-center">
              {activeMembers.slice(0, 6).map((member, index) => (
                <View
                  key={member.id}
                  style={{ marginLeft: index === 0 ? 0 : -6 }}
                  className="rounded-full border-2 border-white"
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
            <View className="flex-row items-center gap-1">
              <Users size={13} color={THEME_COLORS.inkMuted} />
              <Text className="text-xs font-medium text-inkMuted">
                {activeMembers.length} 人协作中
              </Text>
            </View>
          </MotionPressable>
        </Card>

        {blocksLoading && blocks.length === 0 ? (
          <View className="items-center py-12">
            <ActivityIndicator size="large" color={THEME_COLORS.primary} />
            <Text className="mt-3 text-xs text-inkMuted">正在同步协作积木...</Text>
          </View>
        ) : blocks.length === 0 ? (
          <Card className="items-center py-10">
            <View className="mb-3 h-14 w-14 items-center justify-center rounded-2xl border border-primaryBorder bg-primarySoft">
              <LayoutGrid size={24} color={THEME_COLORS.primary} />
            </View>
            <Text className="text-base font-bold text-ink">
              房间还没有协作积木
            </Text>
            <Text className="mt-1.5 px-6 text-center text-xs leading-5 text-inkMuted">
              {canOpenAddBlockSheet
                ? '点击下方「添加积木」，自由拼装投票、分工、日程轴或 AA 分账模块'
                : permissions.isArchived
                  ? '该活动已归档，当前处于只读复盘模式'
                  : '等待房主或管理员添加协作积木'}
            </Text>
          </Card>
        ) : (
          <>
            <View className="mb-3 flex-row items-center justify-between gap-2 px-0.5">
              <Text className="text-xs font-semibold text-inkMuted">
                {reorderMode
                  ? '点击积木右上角箭头调整展示顺序'
                  : `协作积木 · ${blocks.length} 个模块`}
              </Text>
              {permissions.canReorderBlocks && blocks.length > 1 ? (
                <MotionPressable
                  accessibilityRole="button"
                  accessibilityLabel={reorderMode ? '完成排序' : '调整顺序'}
                  onPress={() => setReorderMode((prev) => !prev)}
                  scaleTo={0.95}
                  className={`flex-row items-center gap-1 rounded-full border px-3 py-1.5 ${
                    reorderMode
                      ? 'border-primary bg-primarySoft'
                      : 'border-line bg-white'
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

            <LayoutAnimationConfig skipEntering>
              {blocks.map((block, index) => {
                const isNewlyAdded = block.id === justAddedBlockId;
                const isHighlighted = highlightedBlockId === block.id;
                const canMoveUp = index > 0;
                const canMoveDown = index < blocks.length - 1;
                const reordering = reorderBlocksMutation.isPending;
                const blockContent = (() => {
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
                            permissions.canManageBlocks
                              ? setDeleteTarget
                              : undefined
                          }
                          highlighted={isHighlighted}
                          reorderMode={reorderMode}
                          canMoveUp={canMoveUp}
                          canMoveDown={canMoveDown}
                          reordering={reordering}
                          onMoveUp={() => handleMoveBlock(block.id, 'up')}
                          onMoveDown={() => handleMoveBlock(block.id, 'down')}
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
                            permissions.canManageBlocks
                              ? setDeleteTarget
                              : undefined
                          }
                          highlighted={isHighlighted}
                          reorderMode={reorderMode}
                          canMoveUp={canMoveUp}
                          canMoveDown={canMoveDown}
                          reordering={reordering}
                          onMoveUp={() => handleMoveBlock(block.id, 'up')}
                          onMoveDown={() => handleMoveBlock(block.id, 'down')}
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
                            permissions.canManageBlocks
                              ? setDeleteTarget
                              : undefined
                          }
                          highlighted={isHighlighted}
                          reorderMode={reorderMode}
                          canMoveUp={canMoveUp}
                          canMoveDown={canMoveDown}
                          reordering={reordering}
                          onMoveUp={() => handleMoveBlock(block.id, 'up')}
                          onMoveDown={() => handleMoveBlock(block.id, 'down')}
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
                            permissions.canManageBlocks
                              ? setDeleteTarget
                              : undefined
                          }
                          highlighted={isHighlighted}
                          reorderMode={reorderMode}
                          canMoveUp={canMoveUp}
                          canMoveDown={canMoveDown}
                          reordering={reordering}
                          onMoveUp={() => handleMoveBlock(block.id, 'up')}
                          onMoveDown={() => handleMoveBlock(block.id, 'down')}
                        />
                      );
                  }
                })();

                return (
                  <View
                    key={block.id}
                    onLayout={(event) => {
                      blockOffsetsRef.current[block.id] =
                        event.nativeEvent.layout.y;
                    }}
                  >
                    <AnimatedBlockShell
                      isNewlyAdded={isNewlyAdded}
                      onHighlightEnd={
                        isNewlyAdded ? clearJustAddedBlock : undefined
                      }
                    >
                      {blockContent}
                    </AnimatedBlockShell>
                  </View>
                );
              })}
            </LayoutAnimationConfig>
          </>
        )}
          </ScrollView>

          {canOpenAddBlockSheet && !reorderMode ? (
            <View
              style={FLOATING_SHADOW}
              className="border-t border-line bg-white px-4 pb-3 pt-2.5"
            >
              <Button
                title={permissions.canManageBlocks ? '添加积木' : '发起新投票'}
                variant="primary"
                size="lg"
                fullWidth
                leftIcon={<Plus size={18} color="#FFFFFF" strokeWidth={2.5} />}
                onPress={handleOpenAddSheet}
              />
            </View>
          ) : null}
        </>
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
            return (
              <MotionPressable
                key={type}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                onPress={() => handleSelectBlockType(type)}
                scaleTo={0.975}
                className={`flex-row items-center gap-3 rounded-2xl border px-3.5 py-3 ${
                  selected
                    ? 'border-primary bg-primarySoft'
                    : 'border-line bg-primaryMist'
                }`}
              >
                <View
                  className={`h-10 w-10 items-center justify-center rounded-xl ${
                    selected ? 'bg-white border border-primaryBorder' : 'bg-white border border-line'
                  }`}
                >
                  <BlockTypeIcon
                    type={type}
                    color={selected ? THEME_COLORS.primary : THEME_COLORS.inkMuted}
                  />
                </View>
                <View className="flex-1">
                  <Text
                    className={`text-sm font-bold ${
                      selected ? 'text-primaryDeep' : 'text-ink'
                    }`}
                  >
                    {BLOCK_TYPE_LABELS[type]}
                  </Text>
                  <Text className="mt-0.5 text-[11px] text-inkMuted">
                    {BLOCK_TYPE_DESCRIPTIONS[type]}
                  </Text>
                </View>
                <AnimatedCheckBadge checked={selected} size={20} iconSize={12} />
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
