import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Camera,
  Check,
  CheckSquare,
  Clock,
  Edit3,
  Image as ImageIcon,
  MessageSquare,
  Plus,
  RotateCcw,
  Send,
  Trash2,
  UserCheck,
  UserMinus,
  X,
} from 'lucide-react-native';
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  Text,
  View,
} from 'react-native';
import {
  MAX_COMMENT_LENGTH,
  MAX_TASK_IMAGES,
  type ParsedBlock,
  type ParsedBlockItem,
  createBlockItem,
  createItemComment,
  fetchItemComments,
  setTaskStatus,
  softDeleteBlockItem,
  toggleTaskClaim,
  updateBlockItem,
  updateTaskImages,
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
import {
  TASK_STATUS_LABELS,
  appendTaskImageUrl,
  applyOptimisticTaskClaim,
  applyOptimisticTaskStatus,
  computeTaskCompletionStats,
  findTaskItemInBlocks,
  formatCommentTimestamp,
  formatDueAtForInput,
  formatTaskDueAtLabel,
  mergeTaskContentEdit,
  parseTaskDueAtInput,
  removeTaskImageUrl,
  replaceTaskItemInBlocks,
  updateTaskItemDataInBlocks,
} from '../../lib/taskHelpers';
import type { TaskItemData, TaskStatus } from '../../schemas/blocks';
import { useAuthStore } from '../../stores/authStore';
import { useUiStore } from '../../stores/uiStore';
import type {
  ItemCommentWithProfile,
  ProfileSummary,
  RoomMemberWithProfile,
} from '../../types/database';
import { Avatar } from '../ui/Avatar';
import { Badge, type BadgeVariant } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { SheetModal } from '../ui/SheetModal';

const MAX_TASK_TITLE_LENGTH = 60;
const MAX_TASK_DESC_LENGTH = 400;

const STATUS_BADGE_VARIANT: Record<TaskStatus, BadgeVariant> = {
  unclaimed: 'neutral',
  in_progress: 'warning',
  done: 'success',
};

/** Props for the collaborative Task & Supply Claim block. */
export interface TaskBlockProps {
  block: ParsedBlock<'task'>;
  items: ParsedBlockItem<'task'>[];
  members: RoomMemberWithProfile[];
  permissions: RoomPermissions;
  onRequestDeleteBlock?: (block: ParsedBlock<'task'>) => void;
}

interface TaskItemMutationContext {
  previousBlocks: ParsedBlock[] | undefined;
}

interface TaskProofPhotoProps {
  canonicalUrl: string;
  canRemove: boolean;
  removing: boolean;
  onRemove: () => void;
}

function TaskProofPhoto({
  canonicalUrl,
  canRemove,
  removing,
  onRemove,
}: TaskProofPhotoProps) {
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

  return (
    <View className="relative h-24 w-24 overflow-hidden rounded-2xl border border-zinc-200 bg-surface">
      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="small" color="#F97316" />
        </View>
      ) : isError || imageLoadFailed || !signedUrl ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="重新加载凭证图"
          onPress={handleRetry}
          className="flex-1 items-center justify-center gap-1 px-2 active:bg-zinc-100"
        >
          <ImageIcon size={18} color="#A1A1AA" />
          <Text className="text-[10px] font-medium text-zinc-400">点击重试</Text>
        </Pressable>
      ) : (
        <Image
          source={{ uri: signedUrl }}
          className="h-full w-full"
          resizeMode="cover"
          onError={() => setImageLoadFailed(true)}
        />
      )}

      {canRemove ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="移除凭证图"
          disabled={removing}
          onPress={onRemove}
          className="absolute right-1.5 top-1.5 h-6 w-6 items-center justify-center rounded-full bg-black/65 active:bg-black/80"
        >
          <X size={13} color="#FFFFFF" />
        </Pressable>
      ) : null}
    </View>
  );
}

interface TaskItemCardProps {
  item: ParsedBlockItem<'task'>;
  currentUserId: string;
  memberProfileMap: Map<string, ProfileSummary>;
  canClaimTask: boolean;
  canSetStatus: boolean;
  claimPending: boolean;
  statusPending: boolean;
  onOpenDetail: () => void;
  onToggleClaim: () => void;
  onToggleStatus: () => void;
}

function TaskItemCard({
  item,
  currentUserId,
  memberProfileMap,
  canClaimTask,
  canSetStatus,
  claimPending,
  statusPending,
  onOpenDetail,
  onToggleClaim,
  onToggleStatus,
}: TaskItemCardProps) {
  const { data: comments = [] } = useQuery({
    queryKey: QUERY_KEYS.itemComments(item.id),
    queryFn: () => fetchItemComments(item.id),
    enabled: Boolean(item.id),
  });

  const isClaimedByMe =
    Boolean(currentUserId) && item.data.assigneeIds.includes(currentUserId);
  const isDone = item.data.status === 'done';
  const dueLabel = formatTaskDueAtLabel(item.data.dueAt);
  const photoCount = item.data.imageUrls.length;
  const commentCount = comments.length;

  return (
    <View
      className={`rounded-2xl border p-3.5 ${
        isDone
          ? 'border-emerald-200/80 bg-emerald-50/40'
          : 'border-zinc-200 bg-surface'
      }`}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`查看任务详情 ${item.data.title}`}
        onPress={onOpenDetail}
        className="active:opacity-80"
      >
        <View className="flex-row items-start justify-between gap-2">
          <View className="flex-1">
            <View className="mb-1.5 flex-row flex-wrap items-center gap-1.5">
              <Badge
                label={TASK_STATUS_LABELS[item.data.status]}
                variant={STATUS_BADGE_VARIANT[item.data.status]}
              />
              {dueLabel ? (
                <View className="flex-row items-center gap-1 rounded-full bg-white px-2 py-0.5 border border-zinc-200">
                  <Clock size={10} color="#71717A" />
                  <Text className="text-[10px] font-medium text-zinc-600">
                    {dueLabel}
                  </Text>
                </View>
              ) : null}
            </View>

            <Text
              className={`text-sm font-bold ${
                isDone ? 'text-zinc-500 line-through' : 'text-ink'
              }`}
              numberOfLines={2}
            >
              {item.data.title}
            </Text>

            {item.data.description ? (
              <Text
                className="mt-1 text-xs leading-4 text-zinc-500"
                numberOfLines={2}
              >
                {item.data.description}
              </Text>
            ) : null}
          </View>
        </View>

        <View className="mt-2.5 flex-row items-center justify-between">
          <View className="flex-1 flex-row items-center gap-2 pr-2">
            {item.data.assigneeIds.length > 0 ? (
              <>
                <View className="flex-row items-center">
                  {item.data.assigneeIds.slice(0, 4).map((assigneeId, idx) => {
                    const profile = memberProfileMap.get(assigneeId);
                    return (
                      <View
                        key={`${item.id}-assignee-${assigneeId}`}
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
                  className="flex-1 text-[11px] text-zinc-600"
                  numberOfLines={1}
                >
                  {item.data.assigneeIds
                    .slice(0, 2)
                    .map((id) => memberProfileMap.get(id)?.nickname ?? '成员')
                    .join('、')}
                  {item.data.assigneeIds.length > 2
                    ? ` 等 ${item.data.assigneeIds.length} 人`
                    : ''}
                </Text>
              </>
            ) : (
              <Text className="text-[11px] text-zinc-400">暂无人认领</Text>
            )}
          </View>

          <View className="flex-row items-center gap-2.5">
            <View className="flex-row items-center gap-1">
              <ImageIcon size={12} color={photoCount > 0 ? '#F97316' : '#A1A1AA'} />
              <Text
                className={`text-[11px] font-medium ${
                  photoCount > 0 ? 'text-primary' : 'text-zinc-400'
                }`}
              >
                {photoCount}/{MAX_TASK_IMAGES}
              </Text>
            </View>
            <View className="flex-row items-center gap-1">
              <MessageSquare
                size={12}
                color={commentCount > 0 ? '#52525B' : '#A1A1AA'}
              />
              <Text
                className={`text-[11px] font-medium ${
                  commentCount > 0 ? 'text-zinc-600' : 'text-zinc-400'
                }`}
              >
                {commentCount}
              </Text>
            </View>
          </View>
        </View>
      </Pressable>

      {canClaimTask || canSetStatus ? (
        <View className="mt-2.5 flex-row items-center gap-2 border-t border-zinc-200/70 pt-2.5">
          {canClaimTask ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={isClaimedByMe ? '取消认领' : '认领任务'}
              disabled={claimPending}
              onPress={onToggleClaim}
              className={`flex-1 flex-row items-center justify-center gap-1.5 rounded-xl border py-2 ${
                isClaimedByMe
                  ? 'border-zinc-200 bg-white'
                  : 'border-orange-200 bg-primarySoft'
              } active:opacity-80`}
            >
              {isClaimedByMe ? (
                <UserMinus size={13} color="#52525B" />
              ) : (
                <UserCheck size={13} color="#F97316" />
              )}
              <Text
                className={`text-xs font-semibold ${
                  isClaimedByMe ? 'text-zinc-700' : 'text-primary'
                }`}
              >
                {isClaimedByMe ? '取消认领' : '认领'}
              </Text>
            </Pressable>
          ) : null}

          {canSetStatus ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={isDone ? '恢复进行中' : '标记完成'}
              disabled={statusPending}
              onPress={onToggleStatus}
              className={`flex-1 flex-row items-center justify-center gap-1.5 rounded-xl border py-2 ${
                isDone
                  ? 'border-amber-200 bg-amber-50'
                  : 'border-emerald-200 bg-emerald-50'
              } active:opacity-80`}
            >
              {isDone ? (
                <RotateCcw size={13} color="#B45309" />
              ) : (
                <Check size={13} color="#047857" strokeWidth={2.5} />
              )}
              <Text
                className={`text-xs font-semibold ${
                  isDone ? 'text-amber-800' : 'text-emerald-700'
                }`}
              >
                {isDone ? '恢复进行中' : '完成'}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/**
 * Interactive Task & Supply Claim Block supporting atomic `toggle_task_claim`,
 * `set_task_status` lifecycle transitions, up to 3 private signed-URL proof photos,
 * live `item_comments` threads, and gated item creation / editing / soft-delete.
 */
export function TaskBlock({
  block,
  items,
  members,
  permissions,
  onRequestDeleteBlock,
}: TaskBlockProps) {
  const queryClient = useQueryClient();
  const currentUserId = useAuthStore((s) => s.session?.user.id ?? '');
  const showToast = useUiStore((s) => s.showToast);

  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [formVisible, setFormVisible] = useState(false);
  const [editingItem, setEditingItem] =
    useState<ParsedBlockItem<'task'> | null>(null);
  const [titleInput, setTitleInput] = useState('');
  const [descriptionInput, setDescriptionInput] = useState('');
  const [dueAtInput, setDueAtInput] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const [deleteItemTarget, setDeleteItemTarget] =
    useState<ParsedBlockItem<'task'> | null>(null);
  const [commentInput, setCommentInput] = useState('');
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const memberProfileMap = useMemo(() => {
    const map = new Map<string, ProfileSummary>();
    for (const member of members) {
      if (member.profiles) {
        map.set(member.user_id, member.profiles);
      }
    }
    return map;
  }, [members]);

  const stats = useMemo(() => computeTaskCompletionStats(items), [items]);
  const selectedItem = useMemo(
    () => items.find((entry) => entry.id === selectedItemId) ?? null,
    [items, selectedItemId],
  );

  const canCreateTask = permissions.canCreateItem(block.config.allowMemberCreate);

  const { data: detailComments = [], isLoading: commentsLoading } = useQuery({
    queryKey: QUERY_KEYS.itemComments(selectedItem?.id ?? ''),
    queryFn: () => fetchItemComments(selectedItem?.id ?? ''),
    enabled: Boolean(selectedItem?.id),
  });

  const claimMutation = useMutation<
    ParsedBlockItem<'task'>,
    unknown,
    string,
    TaskItemMutationContext
  >({
    mutationFn: (itemId) => toggleTaskClaim(itemId),
    onMutate: async (itemId) => {
      const queryKey = QUERY_KEYS.roomBlocks(block.room_id);
      await queryClient.cancelQueries({ queryKey });
      const previousBlocks = queryClient.getQueryData<ParsedBlock[]>(queryKey);

      queryClient.setQueryData<ParsedBlock[]>(queryKey, (old = []) =>
        updateTaskItemDataInBlocks(old, block.id, itemId, (data) =>
          applyOptimisticTaskClaim(data, currentUserId),
        ),
      );

      return { previousBlocks };
    },
    onError: (err, _itemId, context) => {
      const queryKey = QUERY_KEYS.roomBlocks(block.room_id);
      if (context?.previousBlocks !== undefined) {
        queryClient.setQueryData(queryKey, context.previousBlocks);
      } else {
        void queryClient.invalidateQueries({ queryKey });
      }
      showToast(mapRoomError(err), 'error');
    },
    onSuccess: (updatedItem) => {
      const queryKey = QUERY_KEYS.roomBlocks(block.room_id);
      queryClient.setQueryData<ParsedBlock[]>(queryKey, (old = []) =>
        replaceTaskItemInBlocks(old, block.id, updatedItem),
      );
    },
  });

  const statusMutation = useMutation<
    ParsedBlockItem<'task'>,
    unknown,
    { itemId: string; status: TaskStatus },
    TaskItemMutationContext
  >({
    mutationFn: ({ itemId, status }) => setTaskStatus(itemId, status),
    onMutate: async ({ itemId, status }) => {
      const queryKey = QUERY_KEYS.roomBlocks(block.room_id);
      await queryClient.cancelQueries({ queryKey });
      const previousBlocks = queryClient.getQueryData<ParsedBlock[]>(queryKey);

      queryClient.setQueryData<ParsedBlock[]>(queryKey, (old = []) =>
        updateTaskItemDataInBlocks(old, block.id, itemId, (data) =>
          applyOptimisticTaskStatus(data, status),
        ),
      );

      return { previousBlocks };
    },
    onError: (err, _vars, context) => {
      const queryKey = QUERY_KEYS.roomBlocks(block.room_id);
      if (context?.previousBlocks !== undefined) {
        queryClient.setQueryData(queryKey, context.previousBlocks);
      } else {
        void queryClient.invalidateQueries({ queryKey });
      }
      showToast(mapRoomError(err), 'error');
    },
    onSuccess: (updatedItem) => {
      const queryKey = QUERY_KEYS.roomBlocks(block.room_id);
      queryClient.setQueryData<ParsedBlock[]>(queryKey, (old = []) =>
        replaceTaskItemInBlocks(old, block.id, updatedItem),
      );
    },
  });

  const imagesMutation = useMutation({
    mutationFn: ({
      itemId,
      imageUrls,
    }: {
      itemId: string;
      imageUrls: string[];
    }) => updateTaskImages(itemId, imageUrls),
    onSuccess: (updatedItem) => {
      const queryKey = QUERY_KEYS.roomBlocks(block.room_id);
      queryClient.setQueryData<ParsedBlock[]>(queryKey, (old = []) =>
        replaceTaskItemInBlocks(old, block.id, updatedItem),
      );
    },
    onError: (err) => {
      showToast(mapRoomError(err), 'error');
    },
  });

  const saveTaskMutation = useMutation({
    mutationFn: async (payload: {
      mode: 'create' | 'edit';
      item: ParsedBlockItem<'task'> | null;
      title: string;
      description: string;
      dueAt: string | null;
    }) => {
      if (payload.mode === 'edit' && payload.item) {
        const latestBlocks = queryClient.getQueryData<ParsedBlock[]>(
          QUERY_KEYS.roomBlocks(block.room_id),
        );
        const latestItem =
          findTaskItemInBlocks(latestBlocks, block.id, payload.item.id) ??
          payload.item;
        const nextData: TaskItemData = mergeTaskContentEdit(latestItem.data, {
          title: payload.title,
          description: payload.description,
          dueAt: payload.dueAt,
        });
        return updateBlockItem({
          itemId: latestItem.id,
          type: 'task',
          data: nextData,
        });
      }

      return createBlockItem({
        blockId: block.id,
        roomId: block.room_id,
        type: 'task',
        data: {
          title: payload.title,
          description: payload.description,
          status: 'unclaimed',
          assigneeIds: [],
          dueAt: payload.dueAt,
          imageUrls: [],
        },
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
        variables.mode === 'edit' ? '已更新任务内容' : '已添加新任务',
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
      showToast('已删除该任务（可在操作日志恢复）', 'success');
    },
    onError: (err) => {
      showToast(mapRoomError(err), 'error');
    },
  });

  const commentMutation = useMutation<
    ItemCommentWithProfile,
    unknown,
    { itemId: string; content: string }
  >({
    mutationFn: ({ itemId, content }) =>
      createItemComment(
        itemId,
        block.room_id,
        content,
        currentUserId || undefined,
      ),
    onSuccess: (createdComment, variables) => {
      setCommentInput('');
      queryClient.setQueryData<ItemCommentWithProfile[]>(
        QUERY_KEYS.itemComments(variables.itemId),
        (old = []) =>
          old.some((entry) => entry.id === createdComment.id)
            ? old
            : [...old, createdComment],
      );
      void queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.itemComments(variables.itemId),
      });
    },
    onError: (err) => {
      showToast(mapRoomError(err), 'error');
    },
  });

  const handleToggleClaim = (item: ParsedBlockItem<'task'>) => {
    if (permissions.isArchived) {
      showToast(mapRoomError(new RoomApiError('ROOM_ARCHIVED')), 'info');
      return;
    }
    if (!permissions.canClaimTask) {
      showToast(mapRoomError(new RoomApiError('FORBIDDEN')), 'error');
      return;
    }
    claimMutation.mutate(item.id);
  };

  const handleToggleStatus = (item: ParsedBlockItem<'task'>) => {
    if (permissions.isArchived) {
      showToast(mapRoomError(new RoomApiError('ROOM_ARCHIVED')), 'info');
      return;
    }
    if (!permissions.canSetTaskStatus(item.created_by, item.data.assigneeIds)) {
      showToast(mapRoomError(new RoomApiError('FORBIDDEN')), 'error');
      return;
    }
    const nextStatus: TaskStatus =
      item.data.status === 'done' ? 'in_progress' : 'done';
    statusMutation.mutate({ itemId: item.id, status: nextStatus });
  };

  const handleOpenCreateForm = () => {
    if (!canCreateTask) {
      return;
    }
    setEditingItem(null);
    setTitleInput('');
    setDescriptionInput('');
    setDueAtInput('');
    setFormError(null);
    setFormVisible(true);
  };

  const handleOpenEditForm = (item: ParsedBlockItem<'task'>) => {
    if (!permissions.canEditOrDeleteItem(item.created_by)) {
      return;
    }
    setSelectedItemId(null);
    setEditingItem(item);
    setTitleInput(item.data.title);
    setDescriptionInput(item.data.description);
    setDueAtInput(formatDueAtForInput(item.data.dueAt));
    setFormError(null);
    setFormVisible(true);
  };

  const handleSubmitForm = () => {
    const trimmedTitle = titleInput.trim();
    if (!trimmedTitle) {
      setFormError('请输入任务或物资名称');
      return;
    }
    if (Array.from(trimmedTitle).length > MAX_TASK_TITLE_LENGTH) {
      setFormError(`任务名称不能超过 ${MAX_TASK_TITLE_LENGTH} 个字`);
      return;
    }
    const trimmedDescription = descriptionInput.trim();
    if (Array.from(trimmedDescription).length > MAX_TASK_DESC_LENGTH) {
      setFormError(`任务说明不能超过 ${MAX_TASK_DESC_LENGTH} 个字`);
      return;
    }

    let parsedDueAt: string | null = null;
    try {
      parsedDueAt = parseTaskDueAtInput(dueAtInput);
    } catch (err) {
      setFormError(mapRoomError(err));
      return;
    }

    setFormError(null);
    saveTaskMutation.mutate({
      mode: editingItem ? 'edit' : 'create',
      item: editingItem,
      title: trimmedTitle,
      description: trimmedDescription,
      dueAt: parsedDueAt,
    });
  };

  const handleUploadProofPhoto = async (
    item: ParsedBlockItem<'task'>,
    source: 'library' | 'camera',
  ) => {
    if (uploadingPhoto || imagesMutation.isPending) {
      return;
    }

    const preUploadBlocks = queryClient.getQueryData<ParsedBlock[]>(
      QUERY_KEYS.roomBlocks(block.room_id),
    );
    const currentItem =
      findTaskItemInBlocks(preUploadBlocks, block.id, item.id) ?? item;

    if (
      !permissions.canManageTaskImages(
        currentItem.created_by,
        currentItem.data.assigneeIds,
      )
    ) {
      showToast(mapRoomError(new RoomApiError('FORBIDDEN')), 'error');
      return;
    }
    if (currentItem.data.imageUrls.length >= MAX_TASK_IMAGES) {
      showToast(mapRoomError(new RoomApiError('MAX_IMAGES_EXCEEDED')), 'info');
      return;
    }

    setUploadingPhoto(true);
    try {
      const uploadedUrl = await pickAndUploadRoomImage({
        roomId: block.room_id,
        blockType: 'task',
        itemId: currentItem.id,
        source,
      });
      if (!uploadedUrl) {
        return;
      }
      const latestBlocks = queryClient.getQueryData<ParsedBlock[]>(
        QUERY_KEYS.roomBlocks(block.room_id),
      );
      const latestItem =
        findTaskItemInBlocks(latestBlocks, block.id, currentItem.id) ??
        currentItem;
      const nextUrls = appendTaskImageUrl(
        latestItem.data.imageUrls,
        uploadedUrl,
      );
      await imagesMutation.mutateAsync({
        itemId: latestItem.id,
        imageUrls: nextUrls,
      });
      showToast('凭证图已上传', 'success');
    } catch (err) {
      if (err instanceof MediaUploadError) {
        showToast(mapMediaUploadError(err), 'error');
      } else {
        showToast(mapRoomError(err), 'error');
      }
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleRemoveProofPhoto = async (
    item: ParsedBlockItem<'task'>,
    targetUrl: string,
  ) => {
    if (uploadingPhoto || imagesMutation.isPending) {
      return;
    }
    const latestBlocks = queryClient.getQueryData<ParsedBlock[]>(
      QUERY_KEYS.roomBlocks(block.room_id),
    );
    const latestItem =
      findTaskItemInBlocks(latestBlocks, block.id, item.id) ?? item;

    if (
      !permissions.canManageTaskImages(
        latestItem.created_by,
        latestItem.data.assigneeIds,
      )
    ) {
      showToast(mapRoomError(new RoomApiError('FORBIDDEN')), 'error');
      return;
    }
    try {
      const nextUrls = removeTaskImageUrl(
        latestItem.data.imageUrls,
        targetUrl,
      );
      await imagesMutation.mutateAsync({
        itemId: latestItem.id,
        imageUrls: nextUrls,
      });
      showToast('已移除凭证图', 'success');
    } catch (err) {
      showToast(mapRoomError(err), 'error');
    }
  };

  const handleSubmitComment = () => {
    if (commentMutation.isPending) {
      return;
    }
    if (!selectedItem || !permissions.canComment) {
      return;
    }
    const trimmed = commentInput.trim();
    if (!trimmed) {
      return;
    }
    if (Array.from(trimmed).length > MAX_COMMENT_LENGTH) {
      showToast(`评论内容不能超过 ${MAX_COMMENT_LENGTH} 个字`, 'error');
      return;
    }
    commentMutation.mutate({ itemId: selectedItem.id, content: trimmed });
  };

  const selectedDueLabel = selectedItem
    ? formatTaskDueAtLabel(selectedItem.data.dueAt)
    : null;
  const selectedCanSetStatus = selectedItem
    ? permissions.canSetTaskStatus(
        selectedItem.created_by,
        selectedItem.data.assigneeIds,
      )
    : false;
  const selectedCanManageImages = selectedItem
    ? permissions.canManageTaskImages(
        selectedItem.created_by,
        selectedItem.data.assigneeIds,
      )
    : false;
  const selectedCanEditOrDelete = selectedItem
    ? permissions.canEditOrDeleteItem(selectedItem.created_by)
    : false;
  const selectedIsClaimedByMe =
    Boolean(selectedItem) &&
    Boolean(currentUserId) &&
    Boolean(selectedItem?.data.assigneeIds.includes(currentUserId));

  return (
    <Card className="mb-3.5">
      <View className="flex-row items-start justify-between gap-2">
        <View className="flex-1 flex-row items-start gap-2.5">
          <View className="mt-0.5 h-9 w-9 items-center justify-center rounded-xl bg-primarySoft">
            <CheckSquare size={18} color="#F97316" />
          </View>

          <View className="flex-1">
            <View className="mb-1 flex-row flex-wrap items-center gap-1.5">
              <Badge label="分工认领" variant="warning" />
              <Badge
                label={`已完成 ${stats.done}/${stats.total}`}
                variant={
                  stats.total > 0 && stats.done === stats.total
                    ? 'success'
                    : 'primary'
                }
              />
              <Badge
                label={block.config.allowMemberCreate ? '全员可新增' : '仅管理新增'}
                variant="neutral"
              />
            </View>

            <Text className="text-base font-bold text-ink" numberOfLines={2}>
              {block.title}
            </Text>
            <Text className="mt-0.5 text-xs text-zinc-500">
              {stats.total === 0
                ? '暂无分工或物资条目'
                : `共 ${stats.total} 项 · 进行中 ${stats.inProgress} · 待认领 ${stats.unclaimed}`}
            </Text>
          </View>
        </View>

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

      {items.length === 0 ? (
        <View className="mt-3 rounded-xl border border-dashed border-zinc-200 bg-surface/70 px-4 py-4">
          <Text className="text-center text-xs text-zinc-400">
            暂无分工任务{canCreateTask ? '，点击下方按钮添加第一项分工或物资' : ''}
          </Text>
        </View>
      ) : (
        <View className="mt-3 gap-2.5">
          {items.map((item) => (
            <TaskItemCard
              key={item.id}
              item={item}
              currentUserId={currentUserId}
              memberProfileMap={memberProfileMap}
              canClaimTask={permissions.canClaimTask}
              canSetStatus={permissions.canSetTaskStatus(
                item.created_by,
                item.data.assigneeIds,
              )}
              claimPending={
                claimMutation.isPending && claimMutation.variables === item.id
              }
              statusPending={
                statusMutation.isPending &&
                statusMutation.variables?.itemId === item.id
              }
              onOpenDetail={() => setSelectedItemId(item.id)}
              onToggleClaim={() => handleToggleClaim(item)}
              onToggleStatus={() => handleToggleStatus(item)}
            />
          ))}
        </View>
      )}

      {canCreateTask ? (
        <View className="mt-3 border-t border-zinc-100 pt-3">
          <Button
            title="新增任务 / 物资"
            variant="secondary"
            size="sm"
            fullWidth
            leftIcon={<Plus size={14} color="#F97316" />}
            onPress={handleOpenCreateForm}
          />
        </View>
      ) : null}

      <SheetModal
        visible={selectedItem !== null}
        onClose={() => {
          setSelectedItemId(null);
          setCommentInput('');
        }}
        title="任务详情"
      >
        {selectedItem ? (
          <View className="gap-4">
            <View>
              <View className="mb-2 flex-row flex-wrap items-center gap-2">
                <Badge
                  label={TASK_STATUS_LABELS[selectedItem.data.status]}
                  variant={STATUS_BADGE_VARIANT[selectedItem.data.status]}
                  size="md"
                />
                {selectedDueLabel ? (
                  <View className="flex-row items-center gap-1 rounded-full border border-zinc-200 bg-surface px-2.5 py-1">
                    <Clock size={12} color="#52525B" />
                    <Text className="text-xs font-medium text-zinc-600">
                      截止 {selectedDueLabel}
                    </Text>
                  </View>
                ) : null}
              </View>

              <Text className="text-lg font-bold text-ink">
                {selectedItem.data.title}
              </Text>
              <Text
                className={`mt-1.5 text-sm leading-5 ${
                  selectedItem.data.description
                    ? 'text-zinc-600'
                    : 'text-zinc-400'
                }`}
              >
                {selectedItem.data.description || '暂无补充说明'}
              </Text>
            </View>

            <View className="rounded-2xl border border-zinc-200/80 bg-surface p-3.5">
              <Text className="mb-2 text-xs font-semibold text-zinc-600">
                认领成员（{selectedItem.data.assigneeIds.length} 人）
              </Text>
              {selectedItem.data.assigneeIds.length === 0 ? (
                <Text className="text-xs text-zinc-400">
                  暂无人认领，点击下方按钮即可认领
                </Text>
              ) : (
                <View className="flex-row flex-wrap gap-2">
                  {selectedItem.data.assigneeIds.map((assigneeId) => {
                    const profile = memberProfileMap.get(assigneeId);
                    return (
                      <View
                        key={`detail-assignee-${assigneeId}`}
                        className="flex-row items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-2.5 py-1"
                      >
                        <Avatar
                          nickname={profile?.nickname}
                          color={profile?.avatar_color}
                          imageUrl={profile?.avatar_url}
                          size="xs"
                        />
                        <Text className="text-xs font-medium text-ink">
                          {profile?.nickname ?? '成员'}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              )}

              {permissions.canClaimTask || selectedCanSetStatus ? (
                <View className="mt-3 flex-row gap-2">
                  {permissions.canClaimTask ? (
                    <Button
                      title={selectedIsClaimedByMe ? '取消认领' : '认领任务'}
                      variant={selectedIsClaimedByMe ? 'ghost' : 'secondary'}
                      size="sm"
                      loading={
                        claimMutation.isPending &&
                        claimMutation.variables === selectedItem.id
                      }
                      onPress={() => handleToggleClaim(selectedItem)}
                      className="flex-1 border border-zinc-200"
                    />
                  ) : null}

                  {selectedCanSetStatus ? (
                    <Button
                      title={
                        selectedItem.data.status === 'done'
                          ? '恢复进行中'
                          : '标记已完成'
                      }
                      variant="primary"
                      size="sm"
                      loading={
                        statusMutation.isPending &&
                        statusMutation.variables?.itemId === selectedItem.id
                      }
                      onPress={() => handleToggleStatus(selectedItem)}
                      className="flex-1"
                    />
                  ) : null}
                </View>
              ) : null}
            </View>

            <View className="rounded-2xl border border-zinc-200/80 bg-surface p-3.5">
              <View className="mb-2 flex-row items-center justify-between">
                <Text className="text-xs font-semibold text-zinc-600">
                  实拍凭证（{selectedItem.data.imageUrls.length}/{MAX_TASK_IMAGES}）
                </Text>
                <Text className="text-[11px] text-zinc-400">
                  最多 3 张，单张不超过 5MB
                </Text>
              </View>

              {selectedItem.data.imageUrls.length > 0 ? (
                <View className="mb-3 flex-row flex-wrap gap-2.5">
                  {selectedItem.data.imageUrls.map((url) => (
                    <TaskProofPhoto
                      key={url}
                      canonicalUrl={url}
                      canRemove={selectedCanManageImages}
                      removing={uploadingPhoto || imagesMutation.isPending}
                      onRemove={() => void handleRemoveProofPhoto(selectedItem, url)}
                    />
                  ))}
                </View>
              ) : (
                <Text className="mb-2.5 text-xs text-zinc-400">
                  暂无实拍凭证图
                </Text>
              )}

              {selectedCanManageImages &&
              selectedItem.data.imageUrls.length < MAX_TASK_IMAGES ? (
                <View className="flex-row gap-2">
                  <Button
                    title="相册上传"
                    variant="secondary"
                    size="sm"
                    leftIcon={<ImageIcon size={14} color="#F97316" />}
                    loading={uploadingPhoto || imagesMutation.isPending}
                    onPress={() =>
                      void handleUploadProofPhoto(selectedItem, 'library')
                    }
                    className="flex-1"
                  />
                  <Button
                    title="拍照上传"
                    variant="ghost"
                    size="sm"
                    leftIcon={<Camera size={14} color="#18181B" />}
                    loading={uploadingPhoto || imagesMutation.isPending}
                    onPress={() =>
                      void handleUploadProofPhoto(selectedItem, 'camera')
                    }
                    className="flex-1 border border-zinc-200 bg-white"
                  />
                </View>
              ) : null}
            </View>

            <View className="rounded-2xl border border-zinc-200/80 bg-surface p-3.5">
              <Text className="mb-2.5 text-xs font-semibold text-zinc-600">
                任务讨论（{detailComments.length}）
              </Text>

              {commentsLoading ? (
                <View className="items-center py-3">
                  <ActivityIndicator size="small" color="#F97316" />
                </View>
              ) : detailComments.length === 0 ? (
                <Text className="py-1 text-xs text-zinc-400">
                  暂无留言，来同步进展或提问吧
                </Text>
              ) : (
                <View className="mb-3 gap-2.5">
                  {detailComments.map((comment) => {
                    const author =
                      comment.profiles ?? memberProfileMap.get(comment.user_id);
                    return (
                      <View
                        key={comment.id}
                        className="flex-row items-start gap-2 rounded-xl bg-white p-2.5"
                      >
                        <Avatar
                          nickname={author?.nickname}
                          color={author?.avatar_color}
                          imageUrl={author?.avatar_url}
                          size="xs"
                        />
                        <View className="flex-1">
                          <View className="flex-row items-center justify-between gap-2">
                            <Text className="text-xs font-semibold text-ink">
                              {author?.nickname ?? '成员'}
                            </Text>
                            <Text className="text-[10px] text-zinc-400">
                              {formatCommentTimestamp(comment.created_at)}
                            </Text>
                          </View>
                          <Text className="mt-0.5 text-xs leading-4 text-zinc-700">
                            {comment.content}
                          </Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}

              {permissions.canComment ? (
                <View className="mt-2 flex-row items-center gap-2">
                  <BottomSheetTextInput
                    value={commentInput}
                    onChangeText={setCommentInput}
                    maxLength={MAX_COMMENT_LENGTH}
                    placeholder="写一句进度同步或补充说明..."
                    placeholderTextColor="#A1A1AA"
                    returnKeyType="send"
                    onSubmitEditing={handleSubmitComment}
                    className="flex-1 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-ink"
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="发送评论"
                    disabled={commentMutation.isPending || !commentInput.trim()}
                    onPress={handleSubmitComment}
                    className={`h-9 w-9 items-center justify-center rounded-xl ${
                      commentInput.trim() ? 'bg-primary' : 'bg-zinc-200'
                    } active:opacity-80`}
                  >
                    {commentMutation.isPending ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Send size={15} color="#FFFFFF" />
                    )}
                  </Pressable>
                </View>
              ) : null}
            </View>

            {selectedCanEditOrDelete ? (
              <View className="flex-row gap-2.5 pt-1">
                <Button
                  title="编辑任务"
                  variant="secondary"
                  size="sm"
                  leftIcon={<Edit3 size={14} color="#F97316" />}
                  onPress={() => handleOpenEditForm(selectedItem)}
                  className="flex-1"
                />
                <Button
                  title="删除任务"
                  variant="danger"
                  size="sm"
                  leftIcon={<Trash2 size={14} color="#FFFFFF" />}
                  onPress={() => {
                    const target = selectedItem;
                    setSelectedItemId(null);
                    setDeleteItemTarget(target);
                  }}
                  className="flex-1"
                />
              </View>
            ) : null}
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
        title={editingItem ? '编辑任务 / 物资' : '新增任务 / 物资'}
      >
        <View className="mb-4">
          <View className="mb-1.5 flex-row items-center justify-between">
            <Text className="text-xs font-semibold text-zinc-600">任务名称</Text>
            <Text className="text-xs text-zinc-400">
              {Array.from(titleInput.trim()).length}/{MAX_TASK_TITLE_LENGTH}
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
            maxLength={MAX_TASK_TITLE_LENGTH}
            placeholder="例如：带 2 箱矿泉水 / 预订露营天幕"
            placeholderTextColor="#A1A1AA"
            className="rounded-2xl border border-zinc-200 bg-surface px-4 py-3 text-sm text-ink"
          />
        </View>

        <View className="mb-4">
          <View className="mb-1.5 flex-row items-center justify-between">
            <Text className="text-xs font-semibold text-zinc-600">
              补充说明（选填）
            </Text>
            <Text className="text-xs text-zinc-400">
              {Array.from(descriptionInput.trim()).length}/{MAX_TASK_DESC_LENGTH}
            </Text>
          </View>
          <BottomSheetTextInput
            value={descriptionInput}
            onChangeText={(text) => {
              setDescriptionInput(text);
              if (formError) {
                setFormError(null);
              }
            }}
            maxLength={MAX_TASK_DESC_LENGTH}
            multiline
            numberOfLines={3}
            placeholder="例如：规格、数量、集合交付地点等"
            placeholderTextColor="#A1A1AA"
            textAlignVertical="top"
            className="min-h-[84px] rounded-2xl border border-zinc-200 bg-surface px-4 py-3 text-sm text-ink"
          />
        </View>

        <View className="mb-4">
          <Text className="mb-1.5 text-xs font-semibold text-zinc-600">
            截止时间（选填，YYYY-MM-DD 或 YYYY-MM-DD HH:mm）
          </Text>
          <BottomSheetTextInput
            value={dueAtInput}
            onChangeText={(text) => {
              setDueAtInput(text);
              if (formError) {
                setFormError(null);
              }
            }}
            placeholder="例如：2026-11-28 18:00"
            placeholderTextColor="#A1A1AA"
            className="rounded-2xl border border-zinc-200 bg-surface px-4 py-3 text-sm text-ink"
          />
        </View>

        {formError ? (
          <View className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5">
            <Text className="text-xs font-medium text-red-700">{formError}</Text>
          </View>
        ) : null}

        <Button
          title={editingItem ? '保存修改' : '确认创建'}
          variant="primary"
          size="lg"
          fullWidth
          loading={saveTaskMutation.isPending}
          onPress={handleSubmitForm}
        />
      </SheetModal>

      <SheetModal
        visible={deleteItemTarget !== null}
        onClose={() => setDeleteItemTarget(null)}
        title="确认删除该任务？"
      >
        <Text className="mb-5 text-sm leading-6 text-zinc-600">
          确定删除「{deleteItemTarget?.data.title ?? ''}
          」吗？管理员后续可在房间操作日志中恢复该任务。
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
