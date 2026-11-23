import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type Href, useRouter } from 'expo-router';
import {
  Archive,
  Check,
  ChevronRight,
  LogOut,
  UserX,
} from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { fetchMyBlockedUsers, unblockUser } from '../../src/api/chat';
import {
  fetchMyRooms,
  formatRoomEventWindow,
  mapRoomError,
  updateMyProfile,
} from '../../src/api/rooms';
import { Avatar } from '../../src/components/ui/Avatar';
import { Badge } from '../../src/components/ui/Badge';
import { Button } from '../../src/components/ui/Button';
import { Card } from '../../src/components/ui/Card';
import {
  AnimatedChevron,
  AnimatedPanelReveal,
  MotionPressable,
} from '../../src/components/ui/Motion';
import { SheetModal } from '../../src/components/ui/SheetModal';
import {
  clearCachedProfile,
  saveCachedProfile,
} from '../../src/lib/profileCache';
import { QUERY_KEYS } from '../../src/lib/queryClient';
import { supabase } from '../../src/lib/supabase';
import { ROOM_TEMPLATES } from '../../src/lib/templates';
import { THEME_COLORS } from '../../src/lib/theme';
import { AVATAR_COLORS, useAuthStore } from '../../src/stores/authStore';
import { useUiStore } from '../../src/stores/uiStore';

const MAX_NICKNAME_LENGTH = 20;

/** Profile tab allowing nickname/avatar editing, quick access to archived rooms, and sign-out. */
export default function ProfileScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const session = useAuthStore((s) => s.session);
  const profile = useAuthStore((s) => s.profile);
  const setProfile = useAuthStore((s) => s.setProfile);
  const showToast = useUiStore((s) => s.showToast);

  const userId = session?.user.id ?? '';

  const [nickname, setNickname] = useState(profile?.nickname ?? '');
  const [selectedColor, setSelectedColor] = useState<string>(
    profile?.avatar_color ?? AVATAR_COLORS[0],
  );
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [blockedOpen, setBlockedOpen] = useState(false);
  const [unblockingUserId, setUnblockingUserId] = useState<string | null>(null);
  const [signOutSheetVisible, setSignOutSheetVisible] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (profile) {
      setNickname(profile.nickname);
      setSelectedColor(profile.avatar_color);
    }
  }, [profile]);

  const { data: roomsData } = useQuery({
    queryKey: QUERY_KEYS.rooms(userId),
    queryFn: () => fetchMyRooms(userId),
    enabled: Boolean(userId),
  });

  const {
    data: blockedUsers = [],
    isLoading: blockedLoading,
    isError: blockedError,
    refetch: refetchBlockedUsers,
  } = useQuery({
    queryKey: QUERY_KEYS.userBlocks(userId),
    queryFn: () => fetchMyBlockedUsers(userId),
    enabled: Boolean(userId),
  });

  const activeCount = roomsData?.active.length ?? 0;
  const archivedRooms = roomsData?.archived ?? [];
  const trimmedNickname = nickname.trim();
  const nicknameLen = Array.from(trimmedNickname).length;

  const isDirty =
    profile !== null &&
    (trimmedNickname !== profile.nickname ||
      selectedColor !== profile.avatar_color);

  const handleSaveProfile = async () => {
    if (!userId) {
      return;
    }
    if (nicknameLen < 1 || nicknameLen > MAX_NICKNAME_LENGTH) {
      setProfileError('请输入 1–20 个字符的昵称');
      return;
    }

    setProfileError(null);
    setSavingProfile(true);
    try {
      const updated = await updateMyProfile(userId, {
        nickname: trimmedNickname,
        avatar_color: selectedColor,
      });
      await saveCachedProfile(updated);
      setProfile(updated);
      showToast('个人资料已更新', 'success');
    } catch (err) {
      setProfileError(mapRoomError(err));
    } finally {
      setSavingProfile(false);
    }
  };

  const handleUnblockUser = async (blockedId: string) => {
    if (!userId || unblockingUserId !== null) {
      return;
    }
    setUnblockingUserId(blockedId);
    try {
      await unblockUser(userId, blockedId);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: QUERY_KEYS.userBlocks(userId),
        }),
        queryClient.invalidateQueries({ queryKey: ['room'] }),
      ]);
      showToast('已解除屏蔽', 'success');
    } catch (err) {
      showToast(mapRoomError(err), 'error');
    } finally {
      setUnblockingUserId(null);
    }
  };

  const handleConfirmSignOut = async () => {
    setSigningOut(true);
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        throw error;
      }
      await clearCachedProfile(userId);
      queryClient.clear();
      setSignOutSheetVisible(false);
    } catch (err) {
      showToast(mapRoomError(err), 'error');
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-surface" edges={['top']}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          className="flex-1 px-4"
          contentContainerStyle={{ paddingBottom: 36 }}
          keyboardShouldPersistTaps="handled"
        >
          <View className="mb-4 mt-3.5">
            <Text className="text-2xl font-bold text-ink">我的</Text>
            <Text className="mt-0.5 text-xs text-inkMuted">
              管理协作名片与历史活动复盘
            </Text>
          </View>

          <Card className="mb-4 items-center py-6">
            <View className="rounded-full border-2 border-primaryBorder bg-primarySoft p-1.5">
              <Avatar
                nickname={trimmedNickname || profile?.nickname || '橘'}
                color={selectedColor}
                imageUrl={profile?.avatar_url}
                size="xl"
              />
            </View>
            <Text className="mt-3 text-lg font-bold text-ink">
              {profile?.nickname ?? '轻橘成员'}
            </Text>
            <Text className="mt-0.5 text-xs text-inkMuted">
              {session?.user.email ?? '已登录账号'}
            </Text>
            <View className="mt-3.5 flex-row items-center gap-2">
              <Badge label={`进行中 ${activeCount} 个`} variant="primary" size="md" />
              <Badge
                label={`已归档 ${archivedRooms.length} 个`}
                variant="neutral"
                size="md"
              />
            </View>
          </Card>

          <Card className="mb-4">
            <Text className="mb-4 text-base font-bold text-ink">
              编辑协作名片
            </Text>

            <View className="mb-4">
              <View className="mb-1.5 flex-row items-center justify-between">
                <Text className="text-xs font-semibold text-inkMuted">
                  显示昵称
                </Text>
                <Text className="text-xs text-inkSubtle">
                  {nicknameLen}/{MAX_NICKNAME_LENGTH}
                </Text>
              </View>
              <TextInput
                value={nickname}
                onChangeText={(text) => {
                  setNickname(text);
                  if (profileError) {
                    setProfileError(null);
                  }
                }}
                placeholder="请输入 1–20 个字符"
                placeholderTextColor={THEME_COLORS.inkSubtle}
                maxLength={MAX_NICKNAME_LENGTH}
                className="rounded-2xl border border-line bg-surface px-4 py-3 text-base text-ink"
              />
            </View>

            <View className="mb-4">
              <Text className="mb-2.5 text-xs font-semibold text-inkMuted">
                头像色块
              </Text>
              <View className="flex-row flex-wrap gap-3">
                {AVATAR_COLORS.map((color) => {
                  const selected = selectedColor === color;
                  return (
                    <MotionPressable
                      key={color}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      accessibilityLabel={`头像颜色 ${color}`}
                      scaleTo={0.88}
                      onPress={() => setSelectedColor(color)}
                      style={{ backgroundColor: color }}
                      className={`h-10 w-10 items-center justify-center rounded-full ${
                        selected ? 'border-2 border-ink' : ''
                      }`}
                    >
                      {selected ? <Check size={16} color="#FFFFFF" /> : null}
                    </MotionPressable>
                  );
                })}
              </View>
            </View>

            {profileError ? (
              <View className="mb-3 rounded-xl border border-[#FAD2D0] bg-[#FEF2F2] px-3 py-2">
                <Text className="text-xs font-medium text-[#C94545]">
                  {profileError}
                </Text>
              </View>
            ) : null}

            <Button
              title={isDirty ? '保存资料修改' : '资料已是最新'}
              variant={isDirty ? 'primary' : 'secondary'}
              loading={savingProfile}
              disabled={!isDirty && !savingProfile}
              fullWidth
              onPress={handleSaveProfile}
            />
          </Card>

          <Card className="mb-4">
            <MotionPressable
              accessibilityRole="button"
              accessibilityState={{ expanded: archivedOpen }}
              scaleTo={0.985}
              onPress={() => setArchivedOpen((prev) => !prev)}
              className="flex-row items-center justify-between"
            >
              <View className="flex-row items-center gap-2.5">
                <View className="h-9 w-9 items-center justify-center rounded-xl bg-primarySoft">
                  <Archive size={18} color={THEME_COLORS.primary} />
                </View>
                <View>
                  <Text className="text-sm font-bold text-ink">
                    已归档活动 ({archivedRooms.length})
                  </Text>
                  <Text className="text-xs text-inkMuted">
                    只读回顾历史记录与导出活动复盘
                  </Text>
                </View>
              </View>
              <AnimatedChevron
                expanded={archivedOpen}
                size={18}
                color={THEME_COLORS.inkMuted}
              />
            </MotionPressable>

            {archivedOpen ? (
              <AnimatedPanelReveal>
                <View className="mt-3 border-t border-lineSoft pt-3">
                  {archivedRooms.length === 0 ? (
                    <Text className="py-3 text-center text-xs text-inkSubtle">
                      还没有已归档的活动房间
                    </Text>
                  ) : (
                    archivedRooms.map(({ room, memberCount }) => {
                      const eventWindow = formatRoomEventWindow(
                        room.event_start_at,
                        room.event_end_at,
                      );
                      return (
                        <MotionPressable
                          key={room.id}
                          accessibilityRole="button"
                          scaleTo={0.98}
                          onPress={() =>
                            router.push(`/room/${room.id}` as Href)
                          }
                          className="mb-2 flex-row items-center justify-between rounded-xl border border-lineSoft bg-primaryMist px-3 py-2.5"
                        >
                          <View className="flex-1 pr-2">
                            <Text
                              className="text-sm font-semibold text-ink"
                              numberOfLines={1}
                            >
                              {room.title}
                            </Text>
                            <Text className="mt-0.5 text-xs text-inkMuted">
                              {ROOM_TEMPLATES[room.template_type].name} ·{' '}
                              {memberCount} 人
                              {eventWindow ? ` · ${eventWindow}` : ''}
                            </Text>
                          </View>
                          <ChevronRight size={16} color={THEME_COLORS.inkSubtle} />
                        </MotionPressable>
                      );
                    })
                  )}
                </View>
              </AnimatedPanelReveal>
            ) : null}
          </Card>

          <Card className="mb-4">
            <MotionPressable
              accessibilityRole="button"
              accessibilityState={{ expanded: blockedOpen }}
              scaleTo={0.985}
              onPress={() => setBlockedOpen((prev) => !prev)}
              className="flex-row items-center justify-between"
            >
              <View className="flex-row items-center gap-2.5">
                <View className="h-9 w-9 items-center justify-center rounded-xl bg-primarySoft">
                  <UserX size={18} color={THEME_COLORS.primary} />
                </View>
                <View>
                  <Text className="text-sm font-bold text-ink">
                    已屏蔽用户 ({blockedUsers.length})
                  </Text>
                  <Text className="text-xs text-inkMuted">
                    管理聊天室已屏蔽成员，随时可解除屏蔽
                  </Text>
                </View>
              </View>
              <AnimatedChevron
                expanded={blockedOpen}
                size={18}
                color={THEME_COLORS.inkMuted}
              />
            </MotionPressable>

            {blockedOpen ? (
              <AnimatedPanelReveal>
                <View className="mt-3 border-t border-lineSoft pt-3">
                  {blockedLoading ? (
                    <View className="flex-row items-center justify-center gap-2 py-4">
                      <ActivityIndicator
                        size="small"
                        color={THEME_COLORS.primary}
                      />
                      <Text className="text-xs text-inkMuted">
                        正在加载已屏蔽用户...
                      </Text>
                    </View>
                  ) : blockedError ? (
                    <View className="items-center py-3">
                      <Text className="text-center text-xs leading-5 text-[#C94545]">
                        加载已屏蔽用户失败，请重试
                      </Text>
                      <View className="mt-2.5">
                        <Button
                          title="重新加载"
                          size="sm"
                          variant="secondary"
                          onPress={() => void refetchBlockedUsers()}
                        />
                      </View>
                    </View>
                  ) : blockedUsers.length === 0 ? (
                    <Text className="py-3 text-center text-xs leading-5 text-inkSubtle">
                      暂无已屏蔽用户，在房间聊天室长按消息可屏蔽对应成员
                    </Text>
                  ) : (
                    blockedUsers.map((entry) => {
                      const displayName =
                        entry.profiles?.nickname ?? '已屏蔽用户';
                      const avatarColor =
                        entry.profiles?.avatar_color ?? THEME_COLORS.inkSubtle;
                      const isUnblocking =
                        unblockingUserId === entry.blocked_id;
                      return (
                        <View
                          key={entry.blocked_id}
                          className="mb-2 flex-row items-center justify-between gap-2.5 rounded-xl border border-lineSoft bg-primaryMist px-3 py-2.5"
                        >
                          <View className="flex-1 flex-row items-center gap-2.5">
                            <Avatar
                              nickname={displayName}
                              color={avatarColor}
                              imageUrl={entry.profiles?.avatar_url}
                              size="sm"
                            />
                            <Text
                              className="flex-1 text-sm font-semibold text-ink"
                              numberOfLines={1}
                            >
                              {displayName}
                            </Text>
                          </View>
                          <Button
                            title="解除屏蔽"
                            size="sm"
                            variant="secondary"
                            loading={isUnblocking}
                            disabled={
                              unblockingUserId !== null && !isUnblocking
                            }
                            onPress={() => handleUnblockUser(entry.blocked_id)}
                          />
                        </View>
                      );
                    })
                  )}
                </View>
              </AnimatedPanelReveal>
            ) : null}
          </Card>

          <Button
            title="退出登录"
            variant="ghost"
            fullWidth
            leftIcon={<LogOut size={18} color={THEME_COLORS.danger} />}
            textClassName="text-[#C94545] font-semibold"
            className="border border-[#FAD2D0] bg-white"
            onPress={() => setSignOutSheetVisible(true)}
          />
        </ScrollView>
      </KeyboardAvoidingView>

      <SheetModal
        visible={signOutSheetVisible}
        onClose={() => setSignOutSheetVisible(false)}
        title="确认退出登录？"
      >
        <Text className="mb-5 text-sm leading-6 text-inkMuted">
          退出登录将清除本机缓存并回到登录页，已同步到云端的房间与协作记录不会丢失。
        </Text>
        <View className="gap-2.5">
          <Button
            title="确认退出登录"
            variant="danger"
            fullWidth
            loading={signingOut}
            onPress={handleConfirmSignOut}
          />
          <Button
            title="取消"
            variant="ghost"
            fullWidth
            onPress={() => setSignOutSheetVisible(false)}
          />
        </View>
      </SheetModal>
    </SafeAreaView>
  );
}
