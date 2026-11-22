import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  Camera,
  Check,
  ChevronDown,
  ChevronUp,
  Edit3,
  Image as ImageIcon,
  Plus,
  Receipt,
  Settings2,
  Trash2,
  Users,
  Wallet,
  X,
} from 'lucide-react-native';
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Text,
  View,
} from 'react-native';
import {
  type ParsedBlock,
  type ParsedBlockItem,
  createBlockItem,
  softDeleteBlockItem,
  updateBlockConfig,
  updateBlockItem,
} from '../../api/blocks';
import { RoomApiError, mapRoomError } from '../../api/rooms';
import type { RoomPermissions } from '../../hooks/useRoomPermissions';
import {
  MediaUploadError,
  getSignedMediaUrl,
  mapMediaUploadError,
  pickAndUploadRoomImage,
} from '../../lib/mediaUpload';
import { QUERY_KEYS } from '../../lib/queryClient';
import { computeMinimalTransfers, formatCents } from '../../lib/splitAlgorithm';
import type { ExpenseItemData } from '../../schemas/blocks';
import { useAuthStore } from '../../stores/authStore';
import { useUiStore } from '../../stores/uiStore';
import type { ProfileSummary, RoomMemberWithProfile } from '../../types/database';
import { Avatar } from '../ui/Avatar';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import {
  AnimatedItemRow,
  AnimatedProgressBar,
  LayoutAnimationConfig,
  MotionPressable,
} from '../ui/Motion';
import { SheetModal } from '../ui/SheetModal';
import { THEME_COLORS } from '../../lib/theme';

const MAX_EXPENSE_TITLE_LENGTH = 60;
const MAX_EXPENSE_AMOUNT_YUAN = 1_000_000;

/** Props for the Budget / AA Expense Collaborative Block. */
export interface ExpenseBlockProps {
  block: ParsedBlock<'expense'>;
  items: ParsedBlockItem<'expense'>[];
  members: RoomMemberWithProfile[];
  permissions: RoomPermissions;
  onRequestDeleteBlock?: (block: ParsedBlock<'expense'>) => void;
  highlighted?: boolean;
  reorderMode?: boolean;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  reordering?: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}

function padTwo(value: number): string {
  return String(value).padStart(2, '0');
}

function createDraftItemId(): string {
  const webCrypto = globalThis.crypto;
  if (webCrypto && typeof webCrypto.randomUUID === 'function') {
    return webCrypto.randomUUID();
  }
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `draft-${ts}-${rand}`;
}

function formatTodayDateInput(): string {
  const now = new Date();
  return `${now.getFullYear()}-${padTwo(now.getMonth() + 1)}-${padTwo(now.getDate())}`;
}

function formatExpenseDateForInput(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    return formatTodayDateInput();
  }
  const d = new Date(ms);
  return `${d.getFullYear()}-${padTwo(d.getMonth() + 1)}-${padTwo(d.getDate())}`;
}

function formatExpenseDateLabel(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    return '';
  }
  const d = new Date(ms);
  const currentYear = new Date().getFullYear();
  if (d.getFullYear() !== currentYear) {
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  }
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function parseExpenseDateInput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return new Date().toISOString();
  }

  const dateMatch = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(trimmed);
  if (dateMatch) {
    const year = Number(dateMatch[1]);
    const month = Number(dateMatch[2]);
    const day = Number(dateMatch[3]);
    const parsed = new Date(year, month - 1, day, 12, 0, 0, 0);
    if (
      parsed.getFullYear() !== year ||
      parsed.getMonth() !== month - 1 ||
      parsed.getDate() !== day
    ) {
      throw new RoomApiError('INVALID_INPUT', '消费日期无效，请检查年月日是否正确');
    }
    return parsed.toISOString();
  }

  const ms = Date.parse(trimmed);
  if (Number.isNaN(ms)) {
    throw new RoomApiError(
      'INVALID_INPUT',
      '消费日期格式无效，请使用 YYYY-MM-DD',
    );
  }
  return new Date(ms).toISOString();
}

function compareExpensesNewestFirst(
  a: ParsedBlockItem<'expense'>,
  b: ParsedBlockItem<'expense'>,
): number {
  const spentA = Date.parse(a.data.spentAt);
  const spentB = Date.parse(b.data.spentAt);
  if (!Number.isNaN(spentA) && !Number.isNaN(spentB) && spentA !== spentB) {
    return spentB - spentA;
  }
  const createdA = Date.parse(a.created_at);
  const createdB = Date.parse(b.created_at);
  if (
    !Number.isNaN(createdA) &&
    !Number.isNaN(createdB) &&
    createdA !== createdB
  ) {
    return createdB - createdA;
  }
  return b.sort_order - a.sort_order;
}

interface ReceiptThumbnailProps {
  canonicalUrl: string;
  size?: 'sm' | 'lg';
  canRemove?: boolean;
  onRemove?: () => void;
  onPress?: () => void;
}

function ReceiptThumbnail({
  canonicalUrl,
  size = 'sm',
  canRemove = false,
  onRemove,
  onPress,
}: ReceiptThumbnailProps) {
  const [imageLoadFailed, setImageLoadFailed] = useState(false);

  const {
    data: signedUrl,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['signedMediaUrl', canonicalUrl] as const,
    queryFn: () => getSignedMediaUrl(canonicalUrl),
    staleTime: 45 * 60 * 1000,
    gcTime: 50 * 60 * 1000,
    retry: 1,
  });

  const handleRetry = () => {
    setImageLoadFailed(false);
    void refetch();
  };

  const containerClass =
    size === 'lg'
      ? 'relative h-72 w-full overflow-hidden rounded-2xl border border-line bg-surface'
      : 'relative h-14 w-14 overflow-hidden rounded-xl border border-line bg-surface';

  return (
    <View className={containerClass}>
      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="small" color={THEME_COLORS.primary} />
        </View>
      ) : isError || imageLoadFailed || !signedUrl ? (
        <MotionPressable
          accessibilityRole="button"
          accessibilityLabel="重新加载票据图片"
          onPress={handleRetry}
          flex
          scaleTo={0.94}
          className="flex-1 items-center justify-center gap-0.5 px-1"
        >
          <ImageIcon size={size === 'lg' ? 24 : 15} color={THEME_COLORS.inkSubtle} />
          <Text className="text-[10px] font-medium text-inkSubtle">重试</Text>
        </MotionPressable>
      ) : onPress ? (
        <MotionPressable
          accessibilityRole="button"
          accessibilityLabel="放大查看票据照片"
          onPress={onPress}
          flex
          scaleTo={0.95}
          className="h-full w-full"
        >
          <Image
            source={{ uri: signedUrl }}
            className="h-full w-full"
            resizeMode="cover"
            onError={() => setImageLoadFailed(true)}
          />
        </MotionPressable>
      ) : (
        <Image
          source={{ uri: signedUrl }}
          className="h-full w-full"
          resizeMode={size === 'lg' ? 'contain' : 'cover'}
          onError={() => setImageLoadFailed(true)}
        />
      )}

      {canRemove && onRemove ? (
        <MotionPressable
          accessibilityRole="button"
          accessibilityLabel="移除票据照片"
          onPress={onRemove}
          scaleTo={0.88}
          containerStyle={{ position: 'absolute', right: 4, top: 4 }}
          className="h-5 w-5 items-center justify-center rounded-full bg-black/60"
        >
          <X size={11} color="#FFFFFF" />
        </MotionPressable>
      ) : null}
    </View>
  );
}

/**
 * Interactive Budget & AA Expense Split Block supporting:
 * - `'budget'` mode: total budget / spent / remaining progress bar with overspend warning & admin budget editor
 * - `'split'` mode: per-member net balance chips (`+应收 / -应付`) and minimal transfer settlement plan
 * - Expense ledger with signed-URL receipt previews, gated create/edit/soft-delete, and receipt photo uploads.
 */
export function ExpenseBlock({
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
}: ExpenseBlockProps) {
  const queryClient = useQueryClient();
  const currentUserId = useAuthStore((s) => s.session?.user.id ?? '');
  const showToast = useUiStore((s) => s.showToast);

  const [budgetModalVisible, setBudgetModalVisible] = useState(false);
  const [budgetInput, setBudgetInput] = useState('');
  const [budgetError, setBudgetError] = useState<string | null>(null);

  const [formVisible, setFormVisible] = useState(false);
  const [editingItem, setEditingItem] =
    useState<ParsedBlockItem<'expense'> | null>(null);
  const [draftUploadItemId, setDraftUploadItemId] = useState<string>(() =>
    createDraftItemId(),
  );
  const [titleInput, setTitleInput] = useState('');
  const [amountInput, setAmountInput] = useState('');
  const [paidByUserIdInput, setPaidByUserIdInput] = useState('');
  const [participantIdsInput, setParticipantIdsInput] = useState<string[]>([]);
  const [spentAtInput, setSpentAtInput] = useState(formatTodayDateInput);
  const [receiptUrlInput, setReceiptUrlInput] = useState<string | null>(null);
  const [expandFormReceipt, setExpandFormReceipt] = useState(false);
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [previewReceiptUrl, setPreviewReceiptUrl] = useState<string | null>(
    null,
  );
  const [deleteItemTarget, setDeleteItemTarget] =
    useState<ParsedBlockItem<'expense'> | null>(null);

  const currency = block.config.currency;
  const isBudgetMode = block.config.mode === 'budget';
  const canCreateExpense = permissions.canCreateItem();

  const memberProfileMap = useMemo(() => {
    const map = new Map<string, ProfileSummary>();
    for (const member of members) {
      if (member.profiles) {
        map.set(member.user_id, member.profiles);
      }
    }
    return map;
  }, [members]);

  const splitSummary = useMemo(
    () => computeMinimalTransfers(items.map((item) => item.data)),
    [items],
  );

  const totalSpentCents = splitSummary.totalSpentCents;
  const totalBudgetCents =
    block.config.totalBudget !== null
      ? Math.round(block.config.totalBudget * 100)
      : null;
  const remainingCents =
    totalBudgetCents !== null ? totalBudgetCents - totalSpentCents : null;
  const isOverspent =
    totalBudgetCents !== null && totalSpentCents > totalBudgetCents;
  const budgetProgressPercent = useMemo(() => {
    if (totalBudgetCents === null) {
      return 0;
    }
    if (totalBudgetCents === 0) {
      return totalSpentCents > 0 ? 100 : 0;
    }
    return Math.min(100, Math.round((totalSpentCents / totalBudgetCents) * 100));
  }, [totalBudgetCents, totalSpentCents]);

  const sortedItems = useMemo(
    () => items.slice().sort(compareExpensesNewestFirst),
    [items],
  );

  const selectableMembers = useMemo(() => {
    const list: Array<{ userId: string; profile: ProfileSummary | null }> =
      members.map((member) => ({
        userId: member.user_id,
        profile: member.profiles,
      }));
    const seen = new Set(list.map((entry) => entry.userId));
    const extraIds = [
      paidByUserIdInput,
      ...participantIdsInput,
      ...(editingItem ? [editingItem.data.paidByUserId, ...editingItem.data.participantIds] : []),
    ];
    for (const userId of extraIds) {
      if (userId && !seen.has(userId)) {
        seen.add(userId);
        list.push({
          userId,
          profile: memberProfileMap.get(userId) ?? null,
        });
      }
    }
    return list;
  }, [
    editingItem,
    memberProfileMap,
    members,
    paidByUserIdInput,
    participantIdsInput,
  ]);

  const updateBudgetMutation = useMutation({
    mutationFn: (totalBudget: number | null) =>
      updateBlockConfig({
        blockId: block.id,
        type: 'expense',
        config: {
          ...block.config,
          totalBudget,
        },
      }),
    onSuccess: async () => {
      setBudgetModalVisible(false);
      setBudgetError(null);
      await queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.roomBlocks(block.room_id),
      });
      showToast('已更新活动预算', 'success');
    },
    onError: (err) => {
      setBudgetError(mapRoomError(err));
    },
  });

  const saveExpenseMutation = useMutation({
    mutationFn: async (payload: {
      mode: 'create' | 'edit';
      item: ParsedBlockItem<'expense'> | null;
      data: ExpenseItemData;
    }) => {
      if (payload.mode === 'edit' && payload.item) {
        return updateBlockItem({
          itemId: payload.item.id,
          type: 'expense',
          data: payload.data,
        });
      }

      return createBlockItem({
        blockId: block.id,
        roomId: block.room_id,
        type: 'expense',
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
        variables.mode === 'edit' ? '已更新消费账目' : '已记入消费账目',
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
      showToast('已删除该笔账目（可在操作日志恢复）', 'success');
    },
    onError: (err) => {
      showToast(mapRoomError(err), 'error');
    },
  });

  const handleOpenBudgetModal = () => {
    if (!permissions.canManageBlocks) {
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
    setBudgetInput(
      block.config.totalBudget !== null ? String(block.config.totalBudget) : '',
    );
    setBudgetError(null);
    setBudgetModalVisible(true);
  };

  const handleSubmitBudget = () => {
    if (!permissions.canManageBlocks) {
      setBudgetError(
        mapRoomError(
          new RoomApiError(
            permissions.isArchived ? 'ROOM_ARCHIVED' : 'FORBIDDEN',
          ),
        ),
      );
      return;
    }

    const trimmed = budgetInput.trim();
    if (!trimmed) {
      setBudgetError(null);
      updateBudgetMutation.mutate(null);
      return;
    }

    const parsed = Number(trimmed);
    if (
      !Number.isFinite(parsed) ||
      parsed < 0 ||
      parsed > MAX_EXPENSE_AMOUNT_YUAN * 10
    ) {
      setBudgetError('请输入有效的非负预算金额');
      return;
    }

    const normalizedBudget = Math.round(parsed * 100) / 100;
    setBudgetError(null);
    updateBudgetMutation.mutate(normalizedBudget);
  };

  const handleOpenCreateForm = () => {
    if (!canCreateExpense) {
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
    const activeIds = members.map((member) => member.user_id);
    const defaultPayer =
      currentUserId && activeIds.includes(currentUserId)
        ? currentUserId
        : (activeIds[0] ?? currentUserId);
    const defaultParticipants =
      activeIds.length > 0
        ? activeIds
        : defaultPayer
          ? [defaultPayer]
          : [];

    setEditingItem(null);
    setDraftUploadItemId(createDraftItemId());
    setTitleInput('');
    setAmountInput('');
    setPaidByUserIdInput(defaultPayer);
    setParticipantIdsInput(defaultParticipants);
    setSpentAtInput(formatTodayDateInput());
    setReceiptUrlInput(null);
    setExpandFormReceipt(false);
    setFormError(null);
    setFormVisible(true);
  };

  const handleOpenEditForm = (item: ParsedBlockItem<'expense'>) => {
    if (!permissions.canEditOrDeleteItem(item.created_by)) {
      return;
    }
    setEditingItem(item);
    setDraftUploadItemId(item.id);
    setTitleInput(item.data.title);
    setAmountInput(item.data.amount.toFixed(2));
    setPaidByUserIdInput(item.data.paidByUserId);
    setParticipantIdsInput([...item.data.participantIds]);
    setSpentAtInput(formatExpenseDateForInput(item.data.spentAt));
    setReceiptUrlInput(item.data.receiptUrl);
    setExpandFormReceipt(false);
    setFormError(null);
    setFormVisible(true);
  };

  const handleToggleParticipant = (userId: string) => {
    setParticipantIdsInput((prev) =>
      prev.includes(userId)
        ? prev.filter((id) => id !== userId)
        : [...prev, userId],
    );
    if (formError) {
      setFormError(null);
    }
  };

  const handleUploadReceipt = async (source: 'library' | 'camera') => {
    if (permissions.isReadOnly) {
      showToast(
        mapRoomError(
          new RoomApiError(
            permissions.isArchived ? 'ROOM_ARCHIVED' : 'FORBIDDEN',
          ),
        ),
        'error',
      );
      return;
    }
    const uploadItemId = editingItem ? editingItem.id : draftUploadItemId;
    setUploadingReceipt(true);
    try {
      const uploadedUrl = await pickAndUploadRoomImage({
        roomId: block.room_id,
        blockType: 'expense',
        itemId: uploadItemId,
        source,
      });
      if (!uploadedUrl) {
        return;
      }
      setReceiptUrlInput(uploadedUrl);
      showToast('票据照片已上传', 'success');
    } catch (err) {
      if (err instanceof MediaUploadError) {
        showToast(mapMediaUploadError(err), 'error');
      } else {
        showToast(mapRoomError(err), 'error');
      }
    } finally {
      setUploadingReceipt(false);
    }
  };

  const handleSubmitForm = () => {
    if (uploadingReceipt || saveExpenseMutation.isPending) {
      return;
    }
    if (permissions.isArchived) {
      setFormError(mapRoomError(new RoomApiError('ROOM_ARCHIVED')));
      return;
    }
    if (editingItem) {
      if (!permissions.canEditOrDeleteItem(editingItem.created_by)) {
        setFormError(mapRoomError(new RoomApiError('FORBIDDEN')));
        return;
      }
    } else if (!canCreateExpense) {
      setFormError(mapRoomError(new RoomApiError('FORBIDDEN')));
      return;
    }

    const trimmedTitle = titleInput.trim();
    if (!trimmedTitle) {
      setFormError('请输入消费项目名称');
      return;
    }
    if (Array.from(trimmedTitle).length > MAX_EXPENSE_TITLE_LENGTH) {
      setFormError(`消费名称不能超过 ${MAX_EXPENSE_TITLE_LENGTH} 个字`);
      return;
    }

    const parsedAmount = Number(amountInput.trim());
    const amountCents = Math.round(parsedAmount * 100);
    if (
      !Number.isFinite(parsedAmount) ||
      amountCents < 1 ||
      parsedAmount > MAX_EXPENSE_AMOUNT_YUAN
    ) {
      setFormError('请输入有效的大于 0 元的金额（精确到分）');
      return;
    }

    if (!paidByUserIdInput.trim()) {
      setFormError('请选择付款成员');
      return;
    }

    const uniqueParticipants = Array.from(
      new Set(participantIdsInput.filter((id) => id.trim().length > 0)),
    );
    if (uniqueParticipants.length === 0) {
      setFormError('请至少选择 1 位参与分摊的成员');
      return;
    }

    let parsedSpentAt: string;
    try {
      parsedSpentAt = parseExpenseDateInput(spentAtInput);
    } catch (err) {
      setFormError(mapRoomError(err));
      return;
    }

    const nextData: ExpenseItemData = {
      title: trimmedTitle,
      amount: amountCents / 100,
      paidByUserId: paidByUserIdInput.trim(),
      participantIds: uniqueParticipants,
      receiptUrl: receiptUrlInput,
      spentAt: parsedSpentAt,
    };

    setFormError(null);
    saveExpenseMutation.mutate({
      mode: editingItem ? 'edit' : 'create',
      item: editingItem,
      data: nextData,
    });
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
            <Wallet size={18} color={THEME_COLORS.primary} />
          </View>

          <View className="flex-1">
            <View className="mb-1 flex-row flex-wrap items-center gap-1.5">
              <Badge
                label={isBudgetMode ? '预算报销' : 'AA 分账'}
                variant="primary"
              />
              <Badge label={currency} variant="neutral" />
              {isBudgetMode && isOverspent ? (
                <Badge label="超支预警" variant="danger" />
              ) : null}
            </View>

            <Text className="text-base font-bold text-ink" numberOfLines={2}>
              {block.title}
            </Text>
            <Text className="mt-0.5 text-xs text-inkMuted">
              {items.length} 笔账目 · 累计消费{' '}
              {formatCents(totalSpentCents, currency)}
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

      {isBudgetMode ? (
        <View
          className={`mt-3.5 rounded-2xl border p-3.5 ${
            isOverspent
              ? 'border-[#FAD2D0] bg-[#FEF2F2]/80'
              : 'border-line bg-primaryMist'
          }`}
        >
          <View className="flex-row items-center justify-between gap-2">
            <Text className="text-xs font-bold text-ink">社团 / 活动预算总览</Text>
            {permissions.canManageBlocks ? (
              <MotionPressable
                accessibilityRole="button"
                accessibilityLabel={
                  totalBudgetCents !== null ? '编辑预算' : '设置预算'
                }
                onPress={handleOpenBudgetModal}
                scaleTo={0.94}
                className="flex-row items-center gap-1 rounded-xl border border-primaryBorder bg-white px-2.5 py-1"
              >
                <Settings2 size={12} color={THEME_COLORS.primaryDeep} />
                <Text className="text-[11px] font-semibold text-primaryDeep">
                  {totalBudgetCents !== null ? '编辑预算' : '设置预算'}
                </Text>
              </MotionPressable>
            ) : null}
          </View>

          <View className="mt-3 flex-row gap-2">
            <View className="flex-1 rounded-xl border border-lineSoft bg-white p-2.5">
              <Text className="text-[10px] text-inkSubtle">总预算</Text>
              <Text className="mt-0.5 text-sm font-bold text-ink">
                {totalBudgetCents !== null
                  ? formatCents(totalBudgetCents, currency)
                  : '未设置'}
              </Text>
            </View>
            <View className="flex-1 rounded-xl border border-lineSoft bg-white p-2.5">
              <Text className="text-[10px] text-inkSubtle">已支出</Text>
              <Text className="mt-0.5 text-sm font-bold text-ink">
                {formatCents(totalSpentCents, currency)}
              </Text>
            </View>
            <View className="flex-1 rounded-xl border border-lineSoft bg-white p-2.5">
              <Text className="text-[10px] text-inkSubtle">
                {isOverspent ? '超出预算' : '剩余预算'}
              </Text>
              <Text
                className={`mt-0.5 text-sm font-bold ${
                  remainingCents === null
                    ? 'text-inkSubtle'
                    : isOverspent
                      ? 'text-[#C94545]'
                      : 'text-[#287B5B]'
                }`}
              >
                {remainingCents === null
                  ? '—'
                  : isOverspent
                    ? formatCents(Math.abs(remainingCents), currency)
                    : formatCents(remainingCents, currency)}
              </Text>
            </View>
          </View>

          {totalBudgetCents !== null ? (
            <View className="mt-3">
              <AnimatedProgressBar
                percent={budgetProgressPercent}
                height={9}
                fillColor={
                  isOverspent
                    ? THEME_COLORS.danger
                    : budgetProgressPercent >= 85
                      ? THEME_COLORS.warning
                      : THEME_COLORS.primary
                }
                trackColor={THEME_COLORS.line}
              />
              <View className="mt-1.5 flex-row items-center justify-between">
                <Text
                  className={`text-[11px] font-medium ${
                    isOverspent ? 'text-[#C94545]' : 'text-inkMuted'
                  }`}
                >
                  {isOverspent
                    ? `已超出总预算 ${formatCents(Math.abs(remainingCents ?? 0), currency)}`
                    : totalBudgetCents > 0
                      ? `已使用 ${budgetProgressPercent}% 预算`
                      : '预算上限为 ¥0.00'}
                </Text>
                {isOverspent ? (
                  <View className="flex-row items-center gap-1">
                    <AlertTriangle size={12} color={THEME_COLORS.danger} />
                    <Text className="text-[11px] font-bold text-[#C94545]">
                      注意控费
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>
          ) : (
            <Text className="mt-2.5 text-[11px] text-inkMuted">
              {permissions.canManageBlocks
                ? '点击右上角「设置预算」配置经费上限与超支提醒'
                : '房主或管理员尚未设置预算上限'}
            </Text>
          )}
        </View>
      ) : (
        <View className="mt-3.5 rounded-2xl border border-line bg-primaryMist p-3.5">
          <View className="flex-row items-center justify-between">
            <Text className="text-xs font-bold text-ink">成员净收支（AA 汇总）</Text>
            <Text className="text-xs font-bold text-primaryDeep">
              共 {formatCents(totalSpentCents, currency)}
            </Text>
          </View>

          {splitSummary.balances.length === 0 ? (
            <Text className="mt-2 text-xs text-inkSubtle">
              记入第一笔账目后，将自动计算成员应收应付及最少转账方案
            </Text>
          ) : (
            <>
              <View className="mt-2.5 flex-row flex-wrap gap-2">
                {splitSummary.balances.map((balance) => {
                  const profile = memberProfileMap.get(balance.userId);
                  const nickname = profile?.nickname ?? '成员';
                  const isPositive = balance.netCents > 0;
                  const isNegative = balance.netCents < 0;

                  return (
                    <View
                      key={`bal-${balance.userId}`}
                      className={`flex-row items-center gap-1.5 rounded-full border px-2.5 py-1 ${
                        isPositive
                          ? 'border-[#CBEAD9] bg-[#EEF8F3]'
                          : isNegative
                            ? 'border-primaryBorder bg-primarySoft'
                            : 'border-line bg-white'
                      }`}
                    >
                      <Avatar
                        nickname={nickname}
                        color={profile?.avatar_color}
                        imageUrl={profile?.avatar_url}
                        size="xs"
                      />
                      <Text className="text-xs font-semibold text-ink">
                        {nickname}
                      </Text>
                      <Text
                        className={`text-xs font-bold ${
                          isPositive
                            ? 'text-[#287B5B]'
                            : isNegative
                              ? 'text-primaryDeep'
                              : 'text-inkMuted'
                        }`}
                      >
                        {isPositive
                          ? `+${formatCents(balance.netCents, currency)} 应收`
                          : isNegative
                            ? `${formatCents(balance.netCents, currency)} 应付`
                            : `${formatCents(0, currency)} 已平`}
                      </Text>
                    </View>
                  );
                })}
              </View>

              <View className="mt-3 border-t border-lineSoft pt-3">
                <Text className="mb-2 text-xs font-bold text-ink">
                  最少转账结算方案
                </Text>
                {splitSummary.transfers.length === 0 ? (
                  <Text className="text-xs text-[#287B5B]">
                    当前账目已全员平账，无需额外转账
                  </Text>
                ) : (
                  <View className="gap-2">
                    {splitSummary.transfers.map((transfer, idx) => {
                      const fromProfile = memberProfileMap.get(
                        transfer.fromUserId,
                      );
                      const toProfile = memberProfileMap.get(transfer.toUserId);
                      const fromName = fromProfile?.nickname ?? '成员';
                      const toName = toProfile?.nickname ?? '成员';
                      const amountText = formatCents(
                        transfer.amountCents,
                        currency,
                      );

                      return (
                        <View
                          key={`tx-${transfer.fromUserId}-${transfer.toUserId}-${idx}`}
                          className="flex-row items-center justify-between gap-2 rounded-xl border border-line bg-white px-3 py-2"
                        >
                          <View className="flex-1 flex-row items-center gap-1.5">
                            <Avatar
                              nickname={fromName}
                              color={fromProfile?.avatar_color}
                              imageUrl={fromProfile?.avatar_url}
                              size="xs"
                            />
                            <Text
                              className="flex-1 text-xs font-medium text-ink"
                              numberOfLines={2}
                            >
                              {fromName} 应向 {toName} 转账{' '}
                              <Text className="font-bold text-primaryDeep">
                                {amountText}
                              </Text>
                            </Text>
                          </View>
                          <ArrowRight size={13} color={THEME_COLORS.primary} />
                          <Avatar
                            nickname={toName}
                            color={toProfile?.avatar_color}
                            imageUrl={toProfile?.avatar_url}
                            size="xs"
                          />
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>
            </>
          )}
        </View>
      )}

      {sortedItems.length === 0 ? (
        <View className="mt-3 rounded-2xl border border-dashed border-line bg-primaryMist px-4 py-4">
          <Text className="text-center text-xs text-inkSubtle">
            暂无消费明细{canCreateExpense ? '，点击下方按钮记入第一笔账目' : ''}
          </Text>
        </View>
      ) : (
        <LayoutAnimationConfig skipEntering>
          <View className="mt-3 gap-2.5">
            {sortedItems.map((item) => {
              const payerProfile = memberProfileMap.get(item.data.paidByUserId);
              const payerName = payerProfile?.nickname ?? '成员';
              const dateLabel = formatExpenseDateLabel(item.data.spentAt);
              const canEditOrDelete = permissions.canEditOrDeleteItem(
                item.created_by,
              );
              const itemCents = Math.round(item.data.amount * 100);

              return (
                <AnimatedItemRow key={item.id}>
                  <View className="rounded-2xl border border-line bg-primaryMist p-3.5">
                    <View className="flex-row items-start justify-between gap-2.5">
                      <View className="flex-1">
                        <View className="flex-row items-center justify-between gap-2">
                          <Text
                            className="flex-1 text-sm font-bold text-ink"
                            numberOfLines={2}
                          >
                            {item.data.title}
                          </Text>
                          <Text className="text-base font-bold text-primaryDeep">
                            {formatCents(itemCents, currency)}
                          </Text>
                        </View>

                        <View className="mt-2 flex-row flex-wrap items-center gap-2">
                          <View className="flex-row items-center gap-1.5">
                            <Avatar
                              nickname={payerName}
                              color={payerProfile?.avatar_color}
                              imageUrl={payerProfile?.avatar_url}
                              size="xs"
                            />
                            <Text className="text-xs font-medium text-ink/80">
                              {payerName} 垫付
                            </Text>
                          </View>

                          <View className="flex-row items-center gap-1 rounded-full border border-line bg-white px-2 py-0.5">
                            <Users size={10} color={THEME_COLORS.inkMuted} />
                            <Text className="text-[10px] font-medium text-inkMuted">
                              {item.data.participantIds.length} 人分摊
                            </Text>
                          </View>

                          {dateLabel ? (
                            <Text className="text-[11px] text-inkSubtle">
                              {dateLabel}
                            </Text>
                          ) : null}
                        </View>
                      </View>

                      {item.data.receiptUrl ? (
                        <ReceiptThumbnail
                          key={item.data.receiptUrl}
                          canonicalUrl={item.data.receiptUrl}
                          onPress={() => setPreviewReceiptUrl(item.data.receiptUrl)}
                        />
                      ) : null}
                    </View>

                    {canEditOrDelete ? (
                      <View className="mt-2.5 flex-row justify-end gap-2 border-t border-lineSoft pt-2">
                        <MotionPressable
                          accessibilityRole="button"
                          accessibilityLabel={`编辑消费 ${item.data.title}`}
                          onPress={() => handleOpenEditForm(item)}
                          scaleTo={0.94}
                          className="flex-row items-center gap-1 rounded-lg border border-line bg-white px-2.5 py-1"
                        >
                          <Edit3 size={12} color={THEME_COLORS.inkMuted} />
                          <Text className="text-[11px] font-semibold text-inkMuted">
                            编辑
                          </Text>
                        </MotionPressable>
                        <MotionPressable
                          accessibilityRole="button"
                          accessibilityLabel={`删除消费 ${item.data.title}`}
                          onPress={() => setDeleteItemTarget(item)}
                          scaleTo={0.94}
                          className="flex-row items-center gap-1 rounded-lg border border-[#FAD2D0] bg-white px-2.5 py-1"
                        >
                          <Trash2 size={12} color={THEME_COLORS.danger} />
                          <Text className="text-[11px] font-semibold text-[#C94545]">
                            删除
                          </Text>
                        </MotionPressable>
                      </View>
                    ) : null}
                  </View>
                </AnimatedItemRow>
              );
            })}
          </View>
        </LayoutAnimationConfig>
      )}

      {canCreateExpense ? (
        <View className="mt-3.5 border-t border-lineSoft pt-3">
          <Button
            title="记一笔消费"
            variant="secondary"
            size="sm"
            fullWidth
            leftIcon={<Plus size={14} color={THEME_COLORS.primaryDeep} />}
            onPress={handleOpenCreateForm}
          />
        </View>
      ) : null}

      <SheetModal
        visible={budgetModalVisible}
        onClose={() => {
          setBudgetModalVisible(false);
          setBudgetError(null);
        }}
        title="设置活动总预算"
      >
        <View className="mb-4">
          <Text className="mb-1.5 text-xs font-semibold text-inkMuted">
            总预算金额（人民币 元，留空则清除预算上限）
          </Text>
          <BottomSheetTextInput
            value={budgetInput}
            onChangeText={(text) => {
              setBudgetInput(text);
              if (budgetError) {
                setBudgetError(null);
              }
            }}
            keyboardType="decimal-pad"
            placeholder="例如：1500"
            placeholderTextColor={THEME_COLORS.inkSubtle}
            className="rounded-2xl border border-line bg-surface px-4 py-3 text-sm text-ink"
          />
        </View>

        {budgetError ? (
          <View className="mb-4 rounded-xl border border-[#FAD2D0] bg-[#FEF2F2] px-3.5 py-2.5">
            <Text className="text-xs font-medium text-[#C94545]">{budgetError}</Text>
          </View>
        ) : null}

        <Button
          title="保存预算设置"
          variant="primary"
          size="lg"
          fullWidth
          loading={updateBudgetMutation.isPending}
          onPress={handleSubmitBudget}
        />
      </SheetModal>

      <SheetModal
        visible={formVisible}
        onClose={() => {
          setFormVisible(false);
          setEditingItem(null);
          setFormError(null);
        }}
        title={editingItem ? '编辑消费账目' : '记一笔消费'}
      >
        <View className="mb-3.5">
          <View className="mb-1.5 flex-row items-center justify-between">
            <Text className="text-xs font-semibold text-inkMuted">
              消费内容（必填）
            </Text>
            <Text className="text-xs text-inkSubtle">
              {Array.from(titleInput.trim()).length}/{MAX_EXPENSE_TITLE_LENGTH}
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
            maxLength={MAX_EXPENSE_TITLE_LENGTH}
            placeholder="例如：露营食材采购 / 景区门票"
            placeholderTextColor={THEME_COLORS.inkSubtle}
            className="rounded-2xl border border-line bg-surface px-4 py-3 text-sm text-ink"
          />
        </View>

        <View className="mb-3.5 flex-row gap-2.5">
          <View className="flex-1">
            <Text className="mb-1.5 text-xs font-semibold text-inkMuted">
              金额（元，CNY）
            </Text>
            <BottomSheetTextInput
              value={amountInput}
              onChangeText={(text) => {
                setAmountInput(text);
                if (formError) {
                  setFormError(null);
                }
              }}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={THEME_COLORS.inkSubtle}
              className="rounded-2xl border border-line bg-surface px-4 py-3 text-sm text-ink"
            />
          </View>
          <View className="flex-1">
            <Text className="mb-1.5 text-xs font-semibold text-inkMuted">
              消费日期（YYYY-MM-DD）
            </Text>
            <BottomSheetTextInput
              value={spentAtInput}
              onChangeText={(text) => {
                setSpentAtInput(text);
                if (formError) {
                  setFormError(null);
                }
              }}
              placeholder="2026-11-22"
              placeholderTextColor={THEME_COLORS.inkSubtle}
              className="rounded-2xl border border-line bg-surface px-4 py-3 text-sm text-ink"
            />
          </View>
        </View>

        <View className="mb-3.5">
          <Text className="mb-2 text-xs font-semibold text-inkMuted">
            付款人（谁垫付的）
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {selectableMembers.map((entry) => {
              const selected = paidByUserIdInput === entry.userId;
              const label = entry.profile?.nickname ?? '成员';
              return (
                <MotionPressable
                  key={`payer-${entry.userId}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  scaleTo={0.95}
                  onPress={() => {
                    setPaidByUserIdInput(entry.userId);
                    if (formError) {
                      setFormError(null);
                    }
                  }}
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

        <View className="mb-3.5">
          <View className="mb-2 flex-row items-center justify-between">
            <Text className="text-xs font-semibold text-inkMuted">
              参与分摊成员（已选 {participantIdsInput.length} 人）
            </Text>
            <View className="flex-row items-center gap-2">
              <MotionPressable
                accessibilityRole="button"
                scaleTo={0.94}
                onPress={() =>
                  setParticipantIdsInput(
                    selectableMembers.map((entry) => entry.userId),
                  )
                }
                className="rounded-lg bg-primarySoft px-2 py-1"
              >
                <Text className="text-[11px] font-semibold text-primaryDeep">
                  全选
                </Text>
              </MotionPressable>
              {paidByUserIdInput ? (
                <MotionPressable
                  accessibilityRole="button"
                  scaleTo={0.94}
                  onPress={() => setParticipantIdsInput([paidByUserIdInput])}
                  className="rounded-lg bg-surface px-2 py-1"
                >
                  <Text className="text-[11px] font-semibold text-inkMuted">
                    仅付款人
                  </Text>
                </MotionPressable>
              ) : null}
            </View>
          </View>

          <View className="flex-row flex-wrap gap-2">
            {selectableMembers.map((entry) => {
              const selected = participantIdsInput.includes(entry.userId);
              const label = entry.profile?.nickname ?? '成员';
              return (
                <MotionPressable
                  key={`part-${entry.userId}`}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selected }}
                  scaleTo={0.95}
                  onPress={() => handleToggleParticipant(entry.userId)}
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
                  {selected ? (
                    <Check size={12} color={THEME_COLORS.primaryDeep} strokeWidth={3} />
                  ) : null}
                </MotionPressable>
              );
            })}
          </View>
        </View>

        <View className="mb-4 rounded-2xl border border-line bg-primaryMist p-3.5">
          <View className="mb-2 flex-row items-center justify-between">
            <View className="flex-row items-center gap-1.5">
              <Receipt size={14} color={THEME_COLORS.primary} />
              <Text className="text-xs font-semibold text-inkMuted">
                票据 / 小票照片（选填）
              </Text>
            </View>
            <Text className="text-[11px] text-inkSubtle">单张不超过 5MB</Text>
          </View>

          {receiptUrlInput ? (
            <View className="mb-2.5 gap-2">
              {expandFormReceipt ? (
                <View className="gap-2">
                  <ReceiptThumbnail
                    key={`lg-${receiptUrlInput}`}
                    canonicalUrl={receiptUrlInput}
                    size="lg"
                    canRemove
                    onRemove={() => {
                      setReceiptUrlInput(null);
                      setExpandFormReceipt(false);
                    }}
                  />
                  <MotionPressable
                    accessibilityRole="button"
                    scaleTo={0.95}
                    onPress={() => setExpandFormReceipt(false)}
                    containerStyle={{ alignSelf: 'flex-end' }}
                    className="rounded-lg border border-line bg-white px-2.5 py-1"
                  >
                    <Text className="text-[11px] font-semibold text-inkMuted">
                      收起大图
                    </Text>
                  </MotionPressable>
                </View>
              ) : (
                <View className="flex-row items-center gap-3">
                  <ReceiptThumbnail
                    key={`sm-${receiptUrlInput}`}
                    canonicalUrl={receiptUrlInput}
                    canRemove
                    onRemove={() => {
                      setReceiptUrlInput(null);
                      setExpandFormReceipt(false);
                    }}
                    onPress={() => setExpandFormReceipt(true)}
                  />
                  <Text className="flex-1 text-xs text-inkMuted">
                    已关联票据照片，点击缩略图可展开预览或重新上传替换
                  </Text>
                </View>
              )}
            </View>
          ) : null}

          <View className="flex-row gap-2">
            <Button
              title={receiptUrlInput ? '更换相册照片' : '相册上传'}
              variant="secondary"
              size="sm"
              leftIcon={<ImageIcon size={14} color={THEME_COLORS.primaryDeep} />}
              loading={uploadingReceipt}
              onPress={() => void handleUploadReceipt('library')}
              className="flex-1"
            />
            <Button
              title="拍照上传"
              variant="ghost"
              size="sm"
              leftIcon={<Camera size={14} color={THEME_COLORS.ink} />}
              loading={uploadingReceipt}
              onPress={() => void handleUploadReceipt('camera')}
              className="flex-1 border border-line bg-white"
            />
          </View>
        </View>

        {formError ? (
          <View className="mb-4 rounded-xl border border-[#FAD2D0] bg-[#FEF2F2] px-3.5 py-2.5">
            <Text className="text-xs font-medium text-[#C94545]">{formError}</Text>
          </View>
        ) : null}

        <View className="gap-2.5">
          <Button
            title={editingItem ? '保存修改' : '确认记账'}
            variant="primary"
            size="lg"
            fullWidth
            disabled={uploadingReceipt}
            loading={saveExpenseMutation.isPending}
            onPress={handleSubmitForm}
          />
          {editingItem &&
          permissions.canEditOrDeleteItem(editingItem.created_by) ? (
            <Button
              title="删除该笔账目"
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
        visible={previewReceiptUrl !== null}
        onClose={() => setPreviewReceiptUrl(null)}
        title="消费票据照片"
      >
        {previewReceiptUrl ? (
          <ReceiptThumbnail
            key={`preview-${previewReceiptUrl}`}
            canonicalUrl={previewReceiptUrl}
            size="lg"
          />
        ) : null}
      </SheetModal>

      <SheetModal
        visible={deleteItemTarget !== null}
        onClose={() => setDeleteItemTarget(null)}
        title="确认删除该笔账目？"
      >
        <Text className="mb-5 text-sm leading-6 text-inkMuted">
          确定删除「{deleteItemTarget?.data.title ?? ''}
          」吗？管理员后续可在房间操作日志中恢复该记录。
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
