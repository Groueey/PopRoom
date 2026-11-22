import type {
  ExpenseConfig,
  PollConfig,
  ScheduleConfig,
  TaskConfig,
} from '../schemas/blocks';
import type { TemplateType } from '../types/database';

/** Strictly typed block preset entry aligned with `create_room_with_template` in `003_rpcs.sql`. */
export type TemplateBlockPreset =
  | { type: 'poll'; title: string; sortOrder: number; config: PollConfig }
  | { type: 'task'; title: string; sortOrder: number; config: TaskConfig }
  | { type: 'schedule'; title: string; sortOrder: number; config: ScheduleConfig }
  | { type: 'expense'; title: string; sortOrder: number; config: ExpenseConfig };

/** Scenario preset template metadata and default block list. */
export interface TemplatePreset {
  type: TemplateType;
  name: string;
  description: string;
  /** Whether the room chatroom is enabled by default for this scenario template. */
  chatEnabled: boolean;
  blocks: TemplateBlockPreset[];
}

/** Map of all 4 scenario preset templates keyed by `TemplateType`. */
export const ROOM_TEMPLATES: Record<TemplateType, TemplatePreset> = {
  campus: {
    type: 'campus',
    name: '校园 / 社团活动',
    description: '时间热力图投票 + 分工认领 + 活动日程轴 + 社团预算报销',
    chatEnabled: true,
    blocks: [
      {
        type: 'poll',
        title: '时间投票',
        sortOrder: 0,
        config: {
          mode: 'availability',
          multiple: true,
          anonymous: false,
          allowAddOption: true,
          deadline: null,
          isLocked: false,
          candidateDates: [],
          timeSlots: ['morning', 'afternoon', 'evening'],
        },
      },
      {
        type: 'task',
        title: '分工与物资认领',
        sortOrder: 1,
        config: {
          allowMemberCreate: true,
        },
      },
      {
        type: 'schedule',
        title: '活动当天日程轴',
        sortOrder: 2,
        config: {
          groupBy: 'day',
        },
      },
      {
        type: 'expense',
        title: '社团预算报销',
        sortOrder: 3,
        config: {
          mode: 'budget',
          totalBudget: null,
          currency: 'CNY',
        },
      },
    ],
  },
  travel: {
    type: 'travel',
    name: '多人出游 / 野营',
    description: '方案目的地投票 + 每日行程轴 + 行李物资分工 + AA 分账器',
    chatEnabled: true,
    blocks: [
      {
        type: 'poll',
        title: '方案/目的地投票',
        sortOrder: 0,
        config: {
          mode: 'option',
          multiple: false,
          anonymous: false,
          allowAddOption: true,
          deadline: null,
          isLocked: false,
        },
      },
      {
        type: 'schedule',
        title: '每日行程轴',
        sortOrder: 1,
        config: {
          groupBy: 'day',
        },
      },
      {
        type: 'task',
        title: '行李物资分工',
        sortOrder: 2,
        config: {
          allowMemberCreate: true,
        },
      },
      {
        type: 'expense',
        title: 'AA 分账器',
        sortOrder: 3,
        config: {
          mode: 'split',
          totalBudget: null,
          currency: 'CNY',
        },
      },
    ],
  },
  party: {
    type: 'party',
    name: '聚餐 / 团建',
    description: '时间与餐厅投票 + 费用 AA 分账',
    chatEnabled: false,
    blocks: [
      {
        type: 'poll',
        title: '时间与餐厅投票',
        sortOrder: 0,
        config: {
          mode: 'option',
          multiple: false,
          anonymous: false,
          allowAddOption: true,
          deadline: null,
          isLocked: false,
        },
      },
      {
        type: 'expense',
        title: '费用 AA 分账',
        sortOrder: 1,
        config: {
          mode: 'split',
          totalBudget: null,
          currency: 'CNY',
        },
      },
    ],
  },
  custom: {
    type: 'custom',
    name: '空白自定义',
    description: '不预装积木，进入房间后自由拼装所需模块',
    chatEnabled: false,
    blocks: [],
  },
};

/** Ordered array of scenario preset templates for creation UI selectors. */
export const TEMPLATE_LIST: TemplatePreset[] = [
  ROOM_TEMPLATES.campus,
  ROOM_TEMPLATES.travel,
  ROOM_TEMPLATES.party,
  ROOM_TEMPLATES.custom,
];
