import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import {
  AlertCircle,
  ChevronLeft,
  Clock,
  KeyRound,
  RefreshCw,
  XCircle,
} from 'lucide-react-native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  fetchMyRoomMembership,
  fetchMyRooms,
  findJoinedRoomByCode,
  joinRoomByCode,
  mapRoomError,
} from '../../src/api/rooms';
import { Badge } from '../../src/components/ui/Badge';
import { Button } from '../../src/components/ui/Button';
import { Card } from '../../src/components/ui/Card';
import { MotionPressable } from '../../src/components/ui/Motion';
import { QUERY_KEYS } from '../../src/lib/queryClient';
import {
  extractRoomCodeForInput,
  extractRoomCodeFromText,
  isValidRoomCode,
  normalizeRoomCode,
} from '../../src/lib/roomCode';
import { supabase } from '../../src/lib/supabase';
import { THEME_COLORS } from '../../src/lib/theme';
import { useAuthStore } from '../../src/stores/authStore';
import { useUiStore } from '../../src/stores/uiStore';
import type { MemberStatus, RoomMemberRow } from '../../src/types/database';

type JoinPhase = 'form' | 'pending' | 'rejected' | 'kicked';

interface PendingRoomTarget {
  roomId: string;
  title: string;
}

function readSingleParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? '';
  }
  return value ?? '';
}

/** 6-char room code entry screen with realtime waiting view for approval-gated rooms. */
export default function JoinRoomScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{
    code?: string | string[];
    pending?: string | string[];
    roomId?: string | string[];
    title?: string | string[];
  }>();

  const session = useAuthStore((s) => s.session);
  const showToast = useUiStore((s) => s.showToast);
  const userId = session?.user.id ?? '';

  const { data: myRooms } = useQuery({
    queryKey: QUERY_KEYS.rooms(userId),
    queryFn: () => fetchMyRooms(userId),
    enabled: Boolean(userId),
  });

  const paramCode = normalizeRoomCode(readSingleParam(params.code));
  const paramPending = readSingleParam(params.pending) === '1';
  const paramRoomId = readSingleParam(params.roomId);
  const paramTitle = readSingleParam(params.title);

  const [codeInput, setCodeInput] = useState(paramCode);
  const [applyNote, setApplyNote] = useState('');
  const [phase, setPhase] = useState<JoinPhase>(
    paramPending && paramRoomId ? 'pending' : 'form',
  );
  const [pendingTarget, setPendingTarget] = useState<PendingRoomTarget | null>(
    paramPending && paramRoomId
      ? { roomId: paramRoomId, title: paramTitle || '协作房间' }
      : null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const navigatedRef = useRef(false);
  const lastParamCodeRef = useRef(paramCode);

  useEffect(() => {
    if (paramCode && paramCode !== lastParamCodeRef.current) {
      lastParamCodeRef.current = paramCode;
      setCodeInput(paramCode);
      if (!paramPending) {
        setPhase('form');
        setPendingTarget(null);
        setErrorText(null);
        navigatedRef.current = false;
      }
    } else if (paramCode) {
      setCodeInput(paramCode);
    }
    if (paramPending && paramRoomId) {
      setPendingTarget({
        roomId: paramRoomId,
        title: paramTitle || '协作房间',
      });
      setPhase('pending');
      navigatedRef.current = false;
    }
  }, [paramCode, paramPending, paramRoomId, paramTitle]);

  const enterApprovedRoom = useCallback(
    async (roomId: string, toastMessage: string) => {
      if (navigatedRef.current) {
        return;
      }
      navigatedRef.current = true;
      if (userId) {
        await queryClient.invalidateQueries({
          queryKey: QUERY_KEYS.rooms(userId),
        });
      }
      showToast(toastMessage, 'success');
      router.replace(`/room/${roomId}` as Href);
    },
    [queryClient, router, showToast, userId],
  );

  const handleMembershipStatus = useCallback(
    (status: MemberStatus | undefined, roomId: string) => {
      if (!status) {
        return;
      }
      if (status === 'active') {
        void enterApprovedRoom(roomId, '审批已通过，欢迎进入房间！');
        return;
      }
      if (status === 'rejected') {
        setPhase('rejected');
        return;
      }
      if (status === 'kicked') {
        setPhase('kicked');
      }
    },
    [enterApprovedRoom],
  );

  const syncPendingStatus = useCallback(async () => {
    if (!pendingTarget || !userId) {
      return;
    }
    setCheckingStatus(true);
    try {
      const membership = await fetchMyRoomMembership(
        pendingTarget.roomId,
        userId,
      );
      if (membership) {
        handleMembershipStatus(membership.status, pendingTarget.roomId);
      }
    } catch (err) {
      showToast(mapRoomError(err), 'error');
    } finally {
      setCheckingStatus(false);
    }
  }, [handleMembershipStatus, pendingTarget, showToast, userId]);

  const pendingRoomId = pendingTarget?.roomId ?? '';

  useEffect(() => {
    if (phase !== 'pending' || !pendingRoomId || !userId) {
      return undefined;
    }

    let active = true;
    void fetchMyRoomMembership(pendingRoomId, userId)
      .then((membership) => {
        if (active && membership) {
          handleMembershipStatus(membership.status, pendingRoomId);
        }
      })
      .catch(() => undefined);

    const channel = supabase
      .channel(`join-wait:${pendingRoomId}:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'room_members',
          filter: `room_id=eq.${pendingRoomId}`,
        },
        (payload) => {
          const nextRow = payload.new as Partial<RoomMemberRow> | null;
          if (!nextRow || nextRow.user_id !== userId) {
            return;
          }
          handleMembershipStatus(nextRow.status, pendingRoomId);
        },
      )
      .subscribe();

    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [handleMembershipStatus, pendingRoomId, phase, userId]);

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)');
    }
  };

  const alreadyJoinedRoom = useMemo(
    () => findJoinedRoomByCode(myRooms, codeInput),
    [myRooms, codeInput],
  );

  const handleSubmitJoin = async () => {
    setErrorText(null);

    if (alreadyJoinedRoom) {
      showToast(`你已加入「${alreadyJoinedRoom.room.title}」，无需重复加入`, 'info');
      router.replace(`/room/${alreadyJoinedRoom.room.id}` as Href);
      return;
    }

    setSubmitting(true);
    navigatedRef.current = false;

    try {
      if (userId && !myRooms) {
        const latestRooms = await fetchMyRooms(userId);
        queryClient.setQueryData(QUERY_KEYS.rooms(userId), latestRooms);
        const existing = findJoinedRoomByCode(latestRooms, codeInput);
        if (existing) {
          showToast(`你已加入「${existing.room.title}」，无需重复加入`, 'info');
          router.replace(`/room/${existing.room.id}` as Href);
          return;
        }
      }

      const result = await joinRoomByCode(codeInput, applyNote);

      if (result.status === 'active') {
        await enterApprovedRoom(result.room_id, `已进入「${result.title}」`);
        return;
      }

      if (result.status === 'pending') {
        setPendingTarget({ roomId: result.room_id, title: result.title });
        setPhase('pending');
        return;
      }

      if (result.status === 'rejected') {
        setPendingTarget({ roomId: result.room_id, title: result.title });
        setPhase('rejected');
        return;
      }

      if (result.status === 'kicked') {
        setPendingTarget({ roomId: result.room_id, title: result.title });
        setPhase('kicked');
      }
    } catch (err) {
      setErrorText(mapRoomError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const normalizedPreview = normalizeRoomCode(codeInput);
  const codeReady = isValidRoomCode(normalizedPreview);

  return (
    <SafeAreaView className="flex-1 bg-surface" edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View className="flex-row items-center justify-between border-b border-line bg-white px-4 py-3">
          <MotionPressable
            accessibilityRole="button"
            accessibilityLabel="返回"
            scaleTo={0.92}
            onPress={handleBack}
            className="h-9 w-9 items-center justify-center rounded-full bg-surface"
          >
            <ChevronLeft size={20} color={THEME_COLORS.ink} />
          </MotionPressable>
          <Text className="text-base font-bold text-ink">加入协作房间</Text>
          <View className="w-9" />
        </View>

        <ScrollView
          className="flex-1 px-4 pt-6"
          contentContainerStyle={{ paddingBottom: 32 }}
          keyboardShouldPersistTaps="handled"
        >
          {phase === 'form' ? (
            <>
              <View className="mb-6 items-center">
                <View className="mb-3 h-14 w-14 items-center justify-center rounded-3xl border border-primaryBorder bg-primarySoft">
                  <KeyRound size={26} color={THEME_COLORS.primary} />
                </View>
                <Text className="text-xl font-bold text-ink">
                  输入 6 位房间码进房
                </Text>
                <Text className="mt-1 text-center text-xs text-inkMuted">
                  支持直接粘贴整段分享口令或邀请链接，自动提取 6 位房间码
                </Text>
              </View>

              <Card className="p-5">
                <View className="mb-4">
                  <View className="mb-1.5 flex-row items-center justify-between">
                    <Text className="text-xs font-semibold text-inkMuted">
                      6 位房间码
                    </Text>
                    {normalizedPreview.length > 0 ? (
                      <Badge
                        label={
                          alreadyJoinedRoom
                            ? '你已在该房间中'
                            : codeReady
                              ? `格式正确 · ${normalizedPreview}`
                              : '需 6 位有效字符（不含 0/O/1/I）'
                        }
                        variant={
                          alreadyJoinedRoom || codeReady ? 'success' : 'warning'
                        }
                      />
                    ) : null}
                  </View>
                  <TextInput
                    value={codeInput}
                    onChangeText={(text) => {
                      const extracted = extractRoomCodeFromText(text);
                      const nextVal = extractRoomCodeForInput(text);
                      setCodeInput(nextVal);
                      if (extracted && text.trim().length > 10) {
                        showToast(`已自动提取房间码 ${extracted}`, 'info');
                      }
                      if (errorText) {
                        setErrorText(null);
                      }
                    }}
                    placeholder="K7M3P9"
                    placeholderTextColor={THEME_COLORS.inkSubtle}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    returnKeyType="next"
                    className="rounded-2xl border border-line bg-surface px-4 py-3.5 text-center text-2xl font-bold tracking-[6px] text-ink"
                  />
                </View>

                {alreadyJoinedRoom ? (
                  <View className="mb-5 rounded-2xl border border-[#CBEAD9] bg-[#EEF8F3] px-3.5 py-3">
                    <Text className="text-xs font-semibold text-[#247254]">
                      你已经加入「{alreadyJoinedRoom.room.title}」，无需重复加入
                    </Text>
                    <Text className="mt-0.5 text-[11px] text-[#2E8B67]">
                      {alreadyJoinedRoom.room.status === 'archived'
                        ? '该活动已归档，点击下方按钮可直接查看只读复盘'
                        : '点击下方按钮可直接进入该协作房间'}
                    </Text>
                  </View>
                ) : (
                  <View className="mb-5">
                    <Text className="mb-1.5 text-xs font-semibold text-inkMuted">
                      进房备注（审批房间展示给房主，选填）
                    </Text>
                    <TextInput
                      value={applyNote}
                      onChangeText={setApplyNote}
                      placeholder="例如：我是小明，来参加周末出游"
                      placeholderTextColor={THEME_COLORS.inkSubtle}
                      maxLength={60}
                      returnKeyType="done"
                      onSubmitEditing={handleSubmitJoin}
                      className="rounded-2xl border border-line bg-surface px-4 py-3 text-sm text-ink"
                    />
                  </View>
                )}

                {errorText ? (
                  <View className="mb-4 rounded-xl border border-[#FAD2D0] bg-[#FEF2F2] px-3.5 py-2.5">
                    <Text className="text-xs font-medium text-[#C94545]">
                      {errorText}
                    </Text>
                  </View>
                ) : null}

                <Button
                  title={alreadyJoinedRoom ? '直接进入该房间' : '加入房间'}
                  loading={submitting}
                  fullWidth
                  size="lg"
                  onPress={handleSubmitJoin}
                />
              </Card>
            </>
          ) : null}

          {phase === 'pending' && pendingTarget ? (
            <Card className="items-center p-6">
              <View className="mb-4 h-16 w-16 items-center justify-center rounded-full border border-primaryBorder bg-primarySoft">
                <Clock size={30} color={THEME_COLORS.primary} />
              </View>
              <Badge label="等待房主审批" variant="warning" size="md" />
              <Text className="mt-3 text-center text-xl font-bold text-ink">
                {pendingTarget.title}
              </Text>
              <Text className="mt-2 text-center text-sm leading-6 text-inkMuted">
                你的入房申请已发送。房主或管理员点击通过后，本页面将自动为你跳转进入房间。
              </Text>

              <View className="mt-6 w-full gap-2.5">
                <Button
                  title="刷新审批状态"
                  variant="secondary"
                  fullWidth
                  loading={checkingStatus}
                  leftIcon={<RefreshCw size={16} color={THEME_COLORS.primaryDeep} />}
                  onPress={syncPendingStatus}
                />
                <Button
                  title="更换房间码"
                  variant="ghost"
                  fullWidth
                  onPress={() => {
                    setPhase('form');
                    setErrorText(null);
                  }}
                />
                <Button
                  title="返回活动大厅"
                  variant="ghost"
                  fullWidth
                  onPress={() => router.replace('/(tabs)')}
                />
              </View>
            </Card>
          ) : null}

          {phase === 'rejected' ? (
            <Card className="items-center p-6">
              <View className="mb-4 h-16 w-16 items-center justify-center rounded-full bg-[#FEF2F2]">
                <XCircle size={32} color={THEME_COLORS.danger} />
              </View>
              <Text className="text-lg font-bold text-ink">
                入房申请未通过
              </Text>
              <Text className="mt-2 text-center text-sm leading-6 text-inkMuted">
                房主或管理员暂未通过你加入「{pendingTarget?.title ?? '该房间'}
                」的申请。你可以补充备注后重新提交申请。
              </Text>

              <View className="mt-6 w-full gap-2.5">
                <Button
                  title="修改备注并重试"
                  variant="primary"
                  fullWidth
                  onPress={() => {
                    setErrorText(null);
                    setPhase('form');
                  }}
                />
                <Button
                  title="返回活动大厅"
                  variant="ghost"
                  fullWidth
                  onPress={() => router.replace('/(tabs)')}
                />
              </View>
            </Card>
          ) : null}

          {phase === 'kicked' ? (
            <Card className="items-center p-6">
              <View className="mb-4 h-16 w-16 items-center justify-center rounded-full bg-[#FEF2F2]">
                <AlertCircle size={32} color={THEME_COLORS.danger} />
              </View>
              <Text className="text-lg font-bold text-ink">无法加入房间</Text>
              <Text className="mt-2 text-center text-sm leading-6 text-inkMuted">
                你已被移出「{pendingTarget?.title ?? '该房间'}
                」，当前无法再次通过房间码进入。
              </Text>

              <View className="mt-6 w-full gap-2.5">
                <Button
                  title="返回活动大厅"
                  variant="primary"
                  fullWidth
                  onPress={() => router.replace('/(tabs)')}
                />
              </View>
            </Card>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
