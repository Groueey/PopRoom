import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { useFocusEffect } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type Href, useRouter } from 'expo-router';
import {
  Archive,
  Calendar,
  ChevronDown,
  ChevronRight,
  KeyRound,
  Plus,
  Sparkles,
  Users,
} from 'lucide-react-native';
import React, { useCallback, useState } from 'react';
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
  type LobbyRoomSummary,
  ROLE_LABELS,
  fetchMyRooms,
  formatRoomEventWindow,
  joinRoomByCode,
  mapRoomError,
} from '../../src/api/rooms';
import { Avatar } from '../../src/components/ui/Avatar';
import { Badge } from '../../src/components/ui/Badge';
import { Button } from '../../src/components/ui/Button';
import { Card } from '../../src/components/ui/Card';
import { SheetModal } from '../../src/components/ui/SheetModal';
import { QUERY_KEYS } from '../../src/lib/queryClient';
import { normalizeRoomCode } from '../../src/lib/roomCode';
import { ROOM_TEMPLATES } from '../../src/lib/templates';
import { useAuthStore } from '../../src/stores/authStore';
import { useUiStore } from '../../src/stores/uiStore';

interface RoomSummaryCardProps {
  summary: LobbyRoomSummary;
  onPress: () => void;
}

function RoomSummaryCard({ summary, onPress }: RoomSummaryCardProps) {
  const { room, myRole, memberCount } = summary;
  const isArchived = room.status === 'archived';
  const templateName = ROOM_TEMPLATES[room.template_type].name;
  const eventWindow = formatRoomEventWindow(
    room.event_start_at,
    room.event_end_at,
  );

  return (
    <Card
      onPress={onPress}
      className={isArchived ? 'mb-3 bg-zinc-50/90 opacity-90' : 'mb-3'}
    >
      <View className="flex-row items-start justify-between gap-2">
        <View className="flex-1">
          <View className="mb-2 flex-row flex-wrap items-center gap-1.5">
            <Badge
              label={templateName}
              variant={isArchived ? 'neutral' : 'primary'}
            />
            {isArchived ? <Badge label="已归档" variant="neutral" /> : null}
            {myRole !== 'member' ? (
              <Badge
                label={ROLE_LABELS[myRole]}
                variant={myRole === 'host' ? 'warning' : 'neutral'}
              />
            ) : null}
          </View>
          <Text className="text-base font-bold text-ink" numberOfLines={2}>
            {room.title}
          </Text>
        </View>
        <View className="rounded-xl bg-zinc-100 px-2.5 py-1">
          <Text className="text-xs font-semibold tracking-wider text-zinc-600">
            {room.room_code}
          </Text>
        </View>
      </View>

      {room.announcement ? (
        <Text className="mt-1.5 text-xs text-zinc-500" numberOfLines={1}>
          {room.announcement}
        </Text>
      ) : null}

      <View className="mt-3 flex-row flex-wrap items-center gap-4 border-t border-zinc-100 pt-2.5">
        <View className="flex-row items-center gap-1">
          <Users size={14} color="#71717A" />
          <Text className="text-xs font-medium text-zinc-600">
            {memberCount} 人参与
          </Text>
        </View>

        {eventWindow ? (
          <View className="flex-row items-center gap-1">
            <Calendar size={14} color="#71717A" />
            <Text className="text-xs text-zinc-500">{eventWindow}</Text>
          </View>
        ) : null}
      </View>
    </Card>
  );
}

/** Activity Lobby listing active collaboration rooms, collapsible archived rooms, and 6-char join drawer. */
export default function LobbyScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const session = useAuthStore((s) => s.session);
  const profile = useAuthStore((s) => s.profile);
  const showToast = useUiStore((s) => s.showToast);

  const userId = session?.user.id ?? '';

  const [archivedExpanded, setArchivedExpanded] = useState(false);
  const [joinSheetVisible, setJoinSheetVisible] = useState(false);
  const [codeInput, setCodeInput] = useState('');
  const [applyNoteInput, setApplyNoteInput] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  const {
    data,
    isLoading,
    isRefetching,
    error,
    refetch,
  } = useQuery({
    queryKey: QUERY_KEYS.rooms(userId),
    queryFn: () => fetchMyRooms(userId),
    enabled: Boolean(userId),
  });

  useFocusEffect(
    useCallback(() => {
      if (userId) {
        void refetch();
      }
    }, [userId, refetch]),
  );

  const activeRooms = data?.active ?? [];
  const archivedRooms = data?.archived ?? [];

  const handleOpenJoinSheet = () => {
    setJoinError(null);
    setJoinSheetVisible(true);
  };

  const handleCloseJoinSheet = () => {
    setJoinSheetVisible(false);
    setJoinError(null);
  };

  const handleJoinSubmit = async () => {
    setJoinError(null);
    setJoining(true);
    try {
      const normalized = normalizeRoomCode(codeInput);
      const result = await joinRoomByCode(codeInput, applyNoteInput);
      setJoinSheetVisible(false);
      setCodeInput('');
      setApplyNoteInput('');

      if (result.status === 'active') {
        await queryClient.invalidateQueries({
          queryKey: QUERY_KEYS.rooms(userId),
        });
        showToast(`已进入「${result.title}」`, 'success');
        router.push(`/room/${result.room_id}` as Href);
        return;
      }

      if (result.status === 'pending') {
        const encodedTitle = encodeURIComponent(result.title);
        router.push(
          `/room/join?code=${normalized}&pending=1&roomId=${result.room_id}&title=${encodedTitle}` as Href,
        );
        return;
      }

      router.push(`/room/join?code=${normalized}` as Href);
    } catch (err) {
      setJoinError(mapRoomError(err));
    } finally {
      setJoining(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-surface" edges={['top']}>
      <ScrollView
        className="flex-1 px-4"
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching && !isLoading}
            onRefresh={() => void refetch()}
            tintColor="#F97316"
            colors={['#F97316']}
          />
        }
      >
        <View className="mb-4 mt-3 flex-row items-center justify-between">
          <View className="flex-1 pr-3">
            <Text className="text-2xl font-bold text-ink">活动大厅</Text>
            <Text className="mt-0.5 text-xs text-zinc-500">
              一件事一个房间，协作结论不沉底
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="前往个人中心"
            onPress={() => router.push('/(tabs)/profile')}
          >
            <Avatar
              nickname={profile?.nickname}
              color={profile?.avatar_color}
              imageUrl={profile?.avatar_url}
              size="md"
            />
          </Pressable>
        </View>

        <View className="mb-5 flex-row gap-3">
          <View className="flex-1">
            <Button
              title="创建房间"
              variant="primary"
              size="md"
              fullWidth
              leftIcon={<Plus size={18} color="#FFFFFF" />}
              onPress={() => router.push('/room/create')}
            />
          </View>
          <View className="flex-1">
            <Button
              title="输码进房"
              variant="secondary"
              size="md"
              fullWidth
              leftIcon={<KeyRound size={18} color="#F97316" />}
              onPress={handleOpenJoinSheet}
            />
          </View>
        </View>

        {error ? (
          <Card className="mb-4 border-red-200 bg-red-50">
            <Text className="text-sm font-medium text-red-700">
              {mapRoomError(error)}
            </Text>
            <View className="mt-2 self-start">
              <Button
                title="重新加载"
                size="sm"
                variant="ghost"
                onPress={() => void refetch()}
              />
            </View>
          </Card>
        ) : null}

        <View className="mb-2.5 flex-row items-center justify-between">
          <Text className="text-sm font-bold text-zinc-700">
            进行中的活动 ({activeRooms.length})
          </Text>
        </View>

        {isLoading ? (
          <View className="items-center py-12">
            <ActivityIndicator size="large" color="#F97316" />
            <Text className="mt-3 text-xs text-zinc-500">正在同步你的房间...</Text>
          </View>
        ) : activeRooms.length === 0 ? (
          <Card className="mb-5 items-center py-8">
            <View className="mb-3 h-12 w-12 items-center justify-center rounded-2xl bg-primarySoft">
              <Sparkles size={24} color="#F97316" />
            </View>
            <Text className="text-base font-bold text-ink">
              还没有进行中的活动
            </Text>
            <Text className="mt-1 px-4 text-center text-xs leading-5 text-zinc-500">
              点击上方「创建房间」用模板秒开协作，或输入朋友发来的 6 位房间码加入
            </Text>
          </Card>
        ) : (
          <View className="mb-3">
            {activeRooms.map((summary) => (
              <RoomSummaryCard
                key={summary.room.id}
                summary={summary}
                onPress={() =>
                  router.push(`/room/${summary.room.id}` as Href)
                }
              />
            ))}
          </View>
        )}

        <View className="mt-2">
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: archivedExpanded }}
            onPress={() => setArchivedExpanded((prev) => !prev)}
            className="mb-3 flex-row items-center justify-between rounded-2xl border border-zinc-200/80 bg-white px-4 py-3 active:bg-zinc-50"
          >
            <View className="flex-row items-center gap-2">
              <Archive size={16} color="#71717A" />
              <Text className="text-sm font-semibold text-zinc-700">
                已归档活动 ({archivedRooms.length})
              </Text>
            </View>
            {archivedExpanded ? (
              <ChevronDown size={18} color="#71717A" />
            ) : (
              <ChevronRight size={18} color="#71717A" />
            )}
          </Pressable>

          {archivedExpanded ? (
            archivedRooms.length === 0 ? (
              <View className="rounded-2xl border border-dashed border-zinc-200 px-4 py-6">
                <Text className="text-center text-xs text-zinc-400">
                  暂无已归档活动，活动完成后房主可手动归档保留复盘记录
                </Text>
              </View>
            ) : (
              archivedRooms.map((summary) => (
                <RoomSummaryCard
                  key={summary.room.id}
                  summary={summary}
                  onPress={() =>
                    router.push(`/room/${summary.room.id}` as Href)
                  }
                />
              ))
            )
          ) : null}
        </View>
      </ScrollView>

      <SheetModal
        visible={joinSheetVisible}
        onClose={handleCloseJoinSheet}
        title="输码进房"
      >
        <Text className="mb-2 text-xs font-semibold text-zinc-600">
          6 位房间码（自动忽略空格与连字符）
        </Text>
        <BottomSheetTextInput
          value={codeInput}
          onChangeText={(text) => {
            setCodeInput(text);
            if (joinError) {
              setJoinError(null);
            }
          }}
          placeholder="例如：K7M3P9"
          placeholderTextColor="#A1A1AA"
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={12}
          returnKeyType="next"
          className="mb-4 rounded-2xl border border-zinc-200 bg-surface px-4 py-3 text-center text-xl font-bold tracking-widest text-ink"
        />

        <Text className="mb-2 text-xs font-semibold text-zinc-600">
          申请备注（若房间开启审批时展示，选填）
        </Text>
        <BottomSheetTextInput
          value={applyNoteInput}
          onChangeText={setApplyNoteInput}
          placeholder="例如：我是小明"
          placeholderTextColor="#A1A1AA"
          maxLength={60}
          returnKeyType="done"
          onSubmitEditing={handleJoinSubmit}
          className="mb-4 rounded-2xl border border-zinc-200 bg-surface px-4 py-3 text-sm text-ink"
        />

        {joinError ? (
          <View className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5">
            <Text className="text-xs font-medium text-red-700">
              {joinError}
            </Text>
          </View>
        ) : null}

        <Button
          title="立即进房"
          loading={joining}
          fullWidth
          size="lg"
          onPress={handleJoinSubmit}
        />

        <View className="mt-2">
          <Button
            title="前往完整进房页"
            variant="ghost"
            size="sm"
            fullWidth
            onPress={() => {
              const normalized = normalizeRoomCode(codeInput);
              setJoinSheetVisible(false);
              router.push(
                (normalized
                  ? `/room/join?code=${normalized}`
                  : '/room/join') as Href,
              );
            }}
          />
        </View>
      </SheetModal>
    </SafeAreaView>
  );
}
