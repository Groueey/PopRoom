import {
  ArrowRight,
  BarChart3,
  BellRing,
  CalendarClock,
  CheckSquare,
  Wallet,
} from 'lucide-react-native';
import React from 'react';
import { Text, View } from 'react-native';
import { BLOCK_ACCENTS, CARD_SHADOW, THEME_COLORS } from '../../lib/theme';
import type { ChatMessageMetadata } from '../../schemas/blocks';
import type { BlockType } from '../../types/database';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';

/** Props for the structured block reminder card rendered inside chat streams. */
export interface BlockReminderCardProps {
  metadata: ChatMessageMetadata;
  content: string;
  onPressBlock?: (blockId: string) => void;
}

function ReminderBlockIcon({ type }: { type?: BlockType }) {
  const color = type ? BLOCK_ACCENTS[type].deep : THEME_COLORS.primaryDeep;
  switch (type) {
    case 'poll':
      return <BarChart3 size={16} color={color} />;
    case 'task':
      return <CheckSquare size={16} color={color} />;
    case 'schedule':
      return <CalendarClock size={16} color={color} />;
    case 'expense':
      return <Wallet size={16} color={color} />;
    default:
      return <BellRing size={16} color={color} />;
  }
}

/**
 * Warm terracotta reminder card linking a chat notice directly back to an active
 * room collaboration block (poll, task, schedule, or expense).
 */
export function BlockReminderCard({
  metadata,
  content,
  onPressBlock,
}: BlockReminderCardProps) {
  const linkedBlockId = metadata.linkedBlockId;
  const linkedTitle = metadata.linkedTitle?.trim();
  const accent = metadata.linkedBlockType
    ? BLOCK_ACCENTS[metadata.linkedBlockType]
    : BLOCK_ACCENTS.poll;

  return (
    <View
      style={[
        CARD_SHADOW,
        {
          backgroundColor: accent.soft,
          borderColor: accent.border,
          borderWidth: 1,
        },
      ]}
      className="rounded-2xl p-3.5"
    >
      <View className="flex-row items-center gap-2">
        <View
          style={{ borderColor: accent.border }}
          className="h-7 w-7 items-center justify-center rounded-full border bg-white"
        >
          <ReminderBlockIcon type={metadata.linkedBlockType} />
        </View>
        <Badge
          label="催办提醒"
          variant={
            metadata.linkedBlockType === 'task'
              ? 'success'
              : metadata.linkedBlockType === 'schedule'
                ? 'info'
                : metadata.linkedBlockType === 'expense'
                  ? 'warning'
                  : 'primary'
          }
          size="sm"
        />
      </View>

      {linkedTitle ? (
        <Text
          numberOfLines={2}
          className="mt-2.5 text-[15px] font-bold leading-5 text-ink"
        >
          {linkedTitle}
        </Text>
      ) : null}

      <Text className="mt-1.5 text-[13px] leading-5 text-inkMuted">
        {content}
      </Text>

      {linkedBlockId ? (
        <Button
          variant="primary"
          size="sm"
          fullWidth
          disabled={!onPressBlock}
          accessibilityLabel="前往处理"
          onPress={() => onPressBlock?.(linkedBlockId)}
          className="mt-3"
        >
          <View className="flex-row items-center justify-center gap-1.5">
            <Text className="text-sm font-semibold text-white">前往处理</Text>
            <ArrowRight size={14} color="#FFFFFF" />
          </View>
        </Button>
      ) : null}
    </View>
  );
}
