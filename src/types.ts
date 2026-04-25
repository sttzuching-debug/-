export type ShiftType = '7M' | '7S' | '3M' | '3S' | '11' | 'OFF' | 'V';

export interface UserPreferences {
  preferredShift?: ShiftType;
  unwantedDates: string[]; // ISO date strings
}

export interface AppUser {
  id: string;
  name: string;
  email: string;
  role: 'ADMIN' | 'USER';
  preferences: UserPreferences;
}

export interface ShiftAssignment {
  id?: string;
  userId: string;
  userName: string;
  date: string; // YYYY-MM-DD
  type: ShiftType;
  isOvertime?: boolean;
  isManual?: boolean; // 新增：用於標記手動預班/預假
}

export interface SwapRequest {
  id: string;
  type: 'SWAP' | 'OVERTIME';
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  fromUserId: string;
  fromUserName: string;
  toUserId?: string;
  toUserName?: string;
  fromDate: string;
  toDate?: string;
  fromShiftType: ShiftType;
  toShiftType?: ShiftType;
  notes?: string;
  createdAt: string;
}

export const CLERKS = [
  "佩琪", "妮君", "佳怡", "宇文", "玉萍", "士峰", "勝祥", "孟君"
];

export type ShiftCategory = 'D' | 'E' | 'N' | 'O';
export const SHIFT_DETAILS: Record<ShiftType, { name: string; color: string; category: ShiftCategory }> = {
  '7M': { name: '白(主)', color: 'bg-blue-900/60 text-blue-100 border-blue-500/40', category: 'D' },
  '7S': { name: '白(副)', color: 'bg-cyan-900/60 text-cyan-100 border-cyan-500/40', category: 'D' },
  '3M': { name: '小(主)', color: 'bg-indigo-900/60 text-indigo-100 border-indigo-500/40', category: 'E' },
  '3S': { name: '小(副)', color: 'bg-violet-900/60 text-violet-100 border-violet-500/40', category: 'E' },
  '11': { name: '大夜', color: 'bg-slate-900/80 text-teal-300 border-teal-500/50', category: 'N' },
  'OFF': { name: '休息', color: 'bg-slate-800 text-slate-500 border-slate-700', category: 'O' },
  'V': { name: '特休', color: 'bg-orange-900/40 text-orange-200 border-orange-500/30', category: 'O' },
};
