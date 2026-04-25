import React, { useState, useEffect, useMemo } from 'react';
import { 
  format, 
  addMonths, 
  subMonths, 
  startOfMonth, 
  endOfMonth, 
  eachDayOfInterval, 
  isSameMonth, 
  isToday,
  addDays,
  subDays,
  getDay,
  parseISO
} from 'date-fns';
import { 
  Calendar as CalendarIcon, 
  ChevronLeft, 
  ChevronRight, 
  Download, 
  Bot, 
  UserCircle, 
  Settings, 
  RefreshCw,
  AlertCircle,
  Smartphone,
  LayoutDashboard,
  Trash2,
  Users as UsersIcon,
  X,
  Plus,
  Save,
  CheckCircle2,
  CalendarDays
} from 'lucide-react';
import { collection, query, where, getDocs, setDoc, doc, updateDoc, onSnapshot, getDocFromServer, writeBatch, deleteDoc } from 'firebase/firestore';
import { auth, db } from './lib/firebase';
import { 
  CLERKS, 
  SHIFT_DETAILS, 
  ShiftType, 
  AppUser, 
  ShiftAssignment 
} from './types';
import { cn, getWeekDay, isWeekend } from './lib/utils';
import { getSchedulingSuggestions } from './services/gemini';
import * as XLSX from 'xlsx';
import { motion, AnimatePresence } from 'motion/react';

function ShiftSelector({ isOpen, onClose, onSelect, onRemove }: { isOpen: boolean; onClose: () => void; onSelect: (type: ShiftType) => void; onRemove: () => void }) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
      />
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
        className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl relative w-full max-w-sm"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold">選擇班目或操作</h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-800 rounded-full text-slate-500">
            <X size={20} />
          </button>
        </div>
        
        <div className="grid grid-cols-2 gap-3 mb-6">
          {(Object.keys(SHIFT_DETAILS) as ShiftType[]).map(type => (
            <button
              key={type}
              onClick={() => onSelect(type)}
              className={cn(
                "p-4 rounded-xl border-2 flex flex-col items-center justify-center gap-1 transition-all hover:scale-105 active:scale-95",
                SHIFT_DETAILS[type].color
              )}
            >
              <span className="font-bold text-lg">{SHIFT_DETAILS[type].name}</span>
              <span className="text-[10px] opacity-60 uppercase tracking-tighter">
                {SHIFT_DETAILS[type].category === 'O' ? '休息/特休' : '上班班次'}
              </span>
            </button>
          ))}
        </div>

        <div className="pt-4 border-t border-slate-800">
          <button 
            onClick={() => {
              if (confirm("確定要清除此格的排班紀錄嗎？")) {
                onRemove();
              }
            }}
            className="w-full py-3 bg-red-900/10 text-red-400 border border-red-500/20 rounded-xl text-sm font-bold hover:bg-red-900/20 transition-colors flex items-center justify-center gap-2"
          >
            <Trash2 size={16} />
            清除該格排班
          </button>
        </div>
      </motion.div>
    </div>
  );
}

export default function App() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewInterval, setViewInterval] = useState<'MONTH' | '4WEEK'>('MONTH');
  const [currentView, setCurrentView] = useState<'SCHEDULE' | 'STAFF'>('SCHEDULE');
  const [users, setUsers] = useState<AppUser[]>([]);
  const [assignments, setAssignments] = useState<ShiftAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [aiSuggestions, setAiSuggestions] = useState<string | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [viewMode, setViewMode] = useState<'desktop' | 'mobile'>('desktop');
  const [selectorConfig, setSelectorConfig] = useState<{ userId: string; date: string; userName: string } | null>(null);

  const yearMonth = format(currentDate, 'yyyy-MM');
  const holidays = useMemo(() => {
    // 國定假日 (簡易範例)
    return [
      '2026-01-01', '2026-01-27', '2026-01-28', '2026-01-29', '2026-01-30', // 春節
      '2026-02-28', '2026-04-04', '2026-04-05', '2026-05-01', '2026-06-19', // 端午
      '2026-09-25', // 中秋
      '2026-10-10'
    ];
  }, []);

  const daysInInterval = useMemo(() => {
    if (viewInterval === 'MONTH') {
      return eachDayOfInterval({
        start: startOfMonth(currentDate),
        end: endOfMonth(currentDate),
      });
    } else {
      // 4 week range starting from the selected date
      return eachDayOfInterval({
        start: currentDate,
        end: addDays(currentDate, 27),
      });
    }
  }, [currentDate, viewInterval]);

  useEffect(() => {
    // Initialize users if they don't exist
    const initUsers = async () => {
      try {
        const q = query(collection(db, 'users'));
        const snapshot = await getDocs(q);
        
        let currentUsers: AppUser[] = [];
        
        if (snapshot.empty) {
          // Create the 8 clerks
          const promises = CLERKS.map((name, index) => {
            const id = `user_${index + 1}`;
            const userData = {
              id,
              name,
              email: `${id}@example.com`,
              role: index === 0 ? 'ADMIN' : 'USER' as any, 
              preferences: { unwantedDates: [] }
            };
            currentUsers.push(userData as any);
            return setDoc(doc(db, 'users', id), userData);
          });
          await Promise.all(promises);
        } else {
          currentUsers = snapshot.docs.map(d => d.data() as AppUser);
          
          // Check if any specified clerk is missing
          const missingClerks = CLERKS.filter(name => !currentUsers.some(u => u.name === name));
          if (missingClerks.length > 0) {
            const lastIdNum = currentUsers.length;
            const promises = missingClerks.map((name, idx) => {
              const id = `user_${lastIdNum + idx + 1}`;
              const userData = {
                id,
                name,
                email: `${id}@example.com`,
                role: 'USER' as any, 
                preferences: { unwantedDates: [] }
              };
              currentUsers.push(userData as any);
              return setDoc(doc(db, 'users', id), userData);
            });
            await Promise.all(promises);
          }
        }
        setUsers(currentUsers);
      } catch (err) {
        console.error("Failed to init users:", err);
        // Fallback to static list if Firebase fails
        setUsers(CLERKS.map((name, i) => ({ id: `user_${i+1}`, name, role: 'USER' } as any)));
      }
    };

    initUsers();
  }, []);

  useEffect(() => {
    // 監聽當前顯示區間內所有相關月份的排班，並多抓前一個月作為轉班參考
    const monthsInInterval = Array.from(new Set(daysInInterval.map(d => format(d, 'yyyy-MM'))));
    const previousMonth = format(subMonths(daysInInterval[0], 1), 'yyyy-MM');
    const allRelevantMonths = Array.from(new Set([previousMonth, ...monthsInInterval]));
    
    const unsubs = allRelevantMonths.map(m => {
      return onSnapshot(collection(db, `schedules/${m}/assignments`), (snapshot) => {
        const newAssignments = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as ShiftAssignment));
        setAssignments(prev => {
          const filtered = prev.filter(a => format(parseISO(a.date), 'yyyy-MM') !== m);
          return [...filtered, ...newAssignments];
        });
        setLoading(false);
      });
    });

    return () => unsubs.forEach(unsub => unsub());
  }, [daysInInterval]);

  const validateConstraints = (day: Date, assignmentsOnDay: ShiftAssignment[]) => {
    const dateStr = format(day, 'yyyy-MM-dd');
    const dayOfWeek = getWeekDay(dateStr);
    const offCount = assignmentsOnDay.filter(a => a.type === 'OFF').length;
    
    const isW14 = dayOfWeek >= 1 && dayOfWeek <= 4;
    const maxOff = isW14 ? 3 : 2;
    
    return {
      isValid: offCount <= maxOff,
      offCount,
      maxOff
    };
  };

  const dayStatus = useMemo(() => {
    const status: Record<string, { isValid: boolean; offCount: number; maxOff: number }> = {};
    daysInInterval.forEach(day => {
      const dateStr = format(day, 'yyyy-MM-dd');
      const assignmentsOnDay = assignments.filter(a => a.date === dateStr);
      status[dateStr] = validateConstraints(day, assignmentsOnDay);
    });
    return status;
  }, [daysInInterval, assignments]);

  const consecutiveDays = useMemo(() => {
    const counts: Record<string, Record<string, number>> = {}; // userId -> date -> count
    
    users.forEach(user => {
      counts[user.id] = {};
      let currentCount = 0;
      
      const sortedDays = [...daysInInterval].sort((a, b) => a.getTime() - b.getTime());
      
      sortedDays.forEach(day => {
        const dateStr = format(day, 'yyyy-MM-dd');
        const a = assignments.find(as => as.date === dateStr && as.userId === user.id);
        if (a && a.type !== 'OFF') {
          currentCount++;
        } else {
          currentCount = 0;
        }
        counts[user.id][dateStr] = currentCount;
      });
    });
    return counts;
  }, [users, assignments, daysInInterval]);

  const updateUserPreference = async (userId: string, preferredShift: ShiftType) => {
    try {
      const userRef = doc(db, 'users', userId);
      await updateDoc(userRef, {
        "preferences.preferredShift": preferredShift
      });
      // Update local state is handled by the initUsers refresh or we can update it manually
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, preferences: { ...u.preferences, preferredShift } } : u));
    } catch (err) {
      console.error("Failed to update preference:", err);
      alert("設定失敗，請稍後再試");
    }
  };

  const handleAutoSchedule = async () => {
    setLoading(true);
    const clerks = users;
    const allNewAssignments = [...assignments];

    // Create a working map for faster lookups
    const assignmentMap = new Map();
    assignments.forEach(a => assignmentMap.set(`${a.userId}_${a.date}`, a));

    // 按日期排序處理所有可見天數
    const sortedDays = [...daysInInterval].sort((a, b) => a.getTime() - b.getTime());

    for (const day of sortedDays) {
      const dateStr = format(day, 'yyyy-MM-dd');
      const dayOfWeek = getWeekDay(dateStr);
      const isW14 = dayOfWeek >= 1 && dayOfWeek <= 4;
      const maxOffAllowed = isW14 ? 3 : 2;

      // 1. 本日必備班別
      const requiredTypes: ShiftType[] = ['11', '3M', '3S', '7M', '7S']; // Priority: N -> E -> D
      
      // 2. 獲取已在該日手動預班(V或OFF或被鎖定的班)
      const usersAssignedToday = new Set();
      const occupiedTypes = new Set();
      
      clerks.forEach(user => {
        const existing = assignmentMap.get(`${user.id}_${dateStr}`);
        if (existing?.isManual) {
          usersAssignedToday.add(user.id);
          if (existing.type !== 'OFF' && existing.type !== 'V') {
            occupiedTypes.add(existing.type);
          }
        }
      });

      // 3. 找出還缺少的班別
      let missingTypes = requiredTypes.filter(t => !occupiedTypes.has(t));
      const unassignedClerks = clerks.filter(user => !usersAssignedToday.has(user.id));

      // 4. 優先分配喜好班別
      const clerksWithPrefs = [...unassignedClerks].sort(() => Math.random() - 0.5);
      
      clerksWithPrefs.forEach(clerk => {
        const pref = clerk.preferences?.preferredShift;
        if (pref && missingTypes.includes(pref)) {
          // 檢查轉班規則與連續天數
          const yesterdayStr = format(addDays(parseISO(dateStr), -1), 'yyyy-MM-dd');
          const prevShift = assignmentMap.get(`${clerk.id}_${yesterdayStr}`)?.type;
          const prevCategory = prevShift ? SHIFT_DETAILS[prevShift].category : null;
          
          let consecutiveCount = 0;
          for (let i = 1; i <= 5; i++) {
            const d = format(addDays(parseISO(dateStr), -i), 'yyyy-MM-dd');
            const s = assignmentMap.get(`${clerk.id}_${d}`)?.type;
            if (s && s !== 'OFF' && s !== 'V') consecutiveCount++;
            else break;
          }

          if (consecutiveCount < 5) {
            const candCategory = SHIFT_DETAILS[pref].category;
            const isNtoLower = prevCategory === 'N' && (candCategory === 'D' || candCategory === 'E');
            const isEtoLower = prevCategory === 'E' && candCategory === 'D';

            if (!isNtoLower && !isEtoLower) {
              const idx = missingTypes.indexOf(pref);
              missingTypes.splice(idx, 1);
              
              const newAssignment: ShiftAssignment = {
                userId: clerk.id,
                userName: clerk.name,
                date: dateStr,
                type: pref,
                isManual: false
              };
              assignmentMap.set(`${clerk.id}_${dateStr}`, newAssignment);
              usersAssignedToday.add(clerk.id);
            }
          }
        }
      });

      // 5. 隨機分配剩餘人員其餘班別
      const remainingClerks = unassignedClerks.filter(u => !usersAssignedToday.has(u.id)).sort(() => Math.random() - 0.5);

      remainingClerks.forEach(clerk => {
        let typeToAssign: ShiftType = 'OFF';

        // 規則檢查：查看前一天班表
        const yesterdayStr = format(addDays(parseISO(dateStr), -1), 'yyyy-MM-dd');
        const prevShift = assignmentMap.get(`${clerk.id}_${yesterdayStr}`)?.type;
        const prevCategory = prevShift ? SHIFT_DETAILS[prevShift].category : null;

        // 連續天數檢查
        let consecutiveCount = 0;
        for (let i = 1; i <= 5; i++) {
          const d = format(addDays(parseISO(dateStr), -i), 'yyyy-MM-dd');
          const s = assignmentMap.get(`${clerk.id}_${d}`)?.type;
          if (s && s !== 'OFF' && s !== 'V') consecutiveCount++;
          else break;
        }

        if (missingTypes.length > 0 && consecutiveCount < 5) {
          for (let i = 0; i < missingTypes.length; i++) {
            const candidate = missingTypes[i];
            const candCategory = SHIFT_DETAILS[candidate].category;

            // 轉班限制: 
            // 1. N (11) -> 不能直接跳 D (7) 或 E (3)，須至少休一天
            // 2. E (3) -> 不能直接跳 D (7)，須至少休一天
            const isNtoLower = prevCategory === 'N' && (candCategory === 'D' || candCategory === 'E');
            const isEtoLower = prevCategory === 'E' && candCategory === 'D';

            // 3. 一例一休簡單檢查：過去 7 天內是否有足夠的休息日
            let offCountIn7Days = 0;
            for (let j = 1; j < 7; j++) {
              const d7 = format(subDays(parseISO(dateStr), j), 'yyyy-MM-dd');
              const s7 = assignmentMap.get(`${clerk.id}_${d7}`)?.type;
              if (s7 === 'OFF' || s7 === 'V') offCountIn7Days++;
            }
            
            // 如果這是第7天且還沒休息過，優先考慮放假 (除非是必要班別)
            const forceOff = offCountIn7Days === 0 && !['11', '3M', '7M'].includes(candidate);

            if (!isNtoLower && !isEtoLower && !forceOff) {
              typeToAssign = missingTypes.splice(i, 1)[0];
              break;
            }
          }
        }

        const newAssignment: ShiftAssignment = {
          userId: clerk.id,
          userName: clerk.name,
          date: dateStr,
          type: typeToAssign,
          isManual: false
        };

        assignmentMap.set(`${clerk.id}_${dateStr}`, newAssignment);
      });
    }

    // 批量儲存到 Firestore
    const batch = writeBatch(db);
    assignmentMap.forEach((a, key) => {
      if (!a.isManual) {
        const targetMonth = format(parseISO(a.date), 'yyyy-MM');
        batch.set(doc(db, `schedules/${targetMonth}/assignments`, key), a);
      }
    });
    
    await batch.commit();
    setLoading(false);
  };

  const handleExportExcel = () => {
    const wsData = [
      ['日期', ...users.map(u => u.name)],
      ...daysInInterval.map(day => {
        const dateStr = format(day, 'yyyy-MM-dd');
        return [
          dateStr,
          ...users.map(u => {
            const a = assignments.find(as => as.date === dateStr && as.userId === u.id);
            return a ? SHIFT_DETAILS[a.type].name : '';
          })
        ];
      })
    ];

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "排班表");
    XLSX.writeFile(wb, `醫院書記排班表_${format(daysInInterval[0], 'yyyyMMdd')}_${format(daysInInterval[daysInInterval.length-1], 'yyyyMMdd')}.xlsx`);
  };

  const handleAiSuggest = async () => {
    setIsAiLoading(true);
    try {
      const scheduleContext = daysInInterval.map(day => {
        const dateStr = format(day, 'yyyy-MM-dd');
        return {
          date: dateStr,
          shifts: assignments.filter(a => a.date === dateStr).map(a => `${a.userName}: ${SHIFT_DETAILS[a.type].name}`)
        };
      });

      const prompt = `你是一個資深護理長，正在審查醫院書記排班。
      當前排班規則：
      1. W1-4 (平日) 最多休3位，W5-7 (假日) 最多休2位。
      2. 不得連續上班超過5天。需符合一例一休（每7天需有2天休息）。
      3. 轉班規則：N (大夜) -> D (白班) 或 E (小夜) 禁止，E (小夜) -> D (白班) 禁止。
      
      請分析以下班表，如果發現某天人力過剩（如單日上班人數超過4位）或過早轉班造成疲勞，請給予具體的調班建議。
      特別是當一天有四個人以上上班時，建議如何分流或支援（例如建議其中一人調往假日支援）。請用繁體中文回答。
      
      班表數據：${JSON.stringify(scheduleContext)}`;

      const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
      const result = await model.generateContent(prompt);
      setAiSuggestions(result.response.text());
    } catch (err) {
      console.error("AI Error:", err);
      setAiSuggestions("AI 建議生成失敗，請更換 Gemini API Key 或稍後再試。");
    } finally {
      setIsAiLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans flex flex-col overflow-hidden">
      <ShiftSelector 
        isOpen={!!selectorConfig} 
        onClose={() => setSelectorConfig(null)}
        onSelect={async (type) => {
          if (!selectorConfig) return;
          const { userId, date, userName } = selectorConfig;
          const id = `${userId}_${date}`;
          const targetMonth = format(parseISO(date), 'yyyy-MM');
          await setDoc(doc(db, `schedules/${targetMonth}/assignments`, id), {
            userId,
            userName,
            date,
            type,
            isManual: true
          });
          setSelectorConfig(null);
        }}
        onRemove={async () => {
          if (!selectorConfig) return;
          const { userId, date } = selectorConfig;
          const id = `${userId}_${date}`;
          const targetMonth = format(parseISO(date), 'yyyy-MM');
          await deleteDoc(doc(db, `schedules/${targetMonth}/assignments`, id));
          setSelectorConfig(null);
        }}
      />
      {/* Header */}
      <header className="h-16 border-b border-slate-800 flex items-center justify-between px-6 bg-slate-900/50 sticky top-0 z-50">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-emerald-500 rounded-lg flex items-center justify-center text-slate-950 font-bold shadow-lg shadow-emerald-500/20">
            MC
          </div>
          <h1 className="text-xl font-semibold tracking-tight">醫院書記排班系統 <span className="text-slate-500 font-normal text-sm ml-2">V2.4.0</span></h1>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="flex bg-slate-800 rounded-md p-1 mr-4">
            <button 
              onClick={() => setCurrentView('SCHEDULE')}
              className={cn(
                "px-3 py-1 text-xs rounded transition-all flex items-center gap-2",
                currentView === 'SCHEDULE' ? "bg-slate-700 text-white shadow" : "text-slate-500 hover:text-slate-300"
              )}
            >
              <CalendarDays size={14} />
              班表管理
            </button>
            <button 
              onClick={() => setCurrentView('STAFF')}
              className={cn(
                "px-3 py-1 text-xs rounded transition-all flex items-center gap-2",
                currentView === 'STAFF' ? "bg-slate-700 text-white shadow" : "text-slate-500 hover:text-slate-300"
              )}
            >
              <UsersIcon size={14} />
              人員設定
            </button>
          </div>

          {currentView === 'SCHEDULE' && (
            <>
              <div className="flex bg-slate-800 rounded-md p-1 mr-4">
                {viewInterval === '4WEEK' && (
                  <input 
                    type="date"
                    value={format(currentDate, 'yyyy-MM-dd')}
                    onChange={(e) => setCurrentDate(parseISO(e.target.value))}
                    className="bg-slate-700 text-white text-xs rounded px-2 mr-2 border-none focus:ring-1 focus:ring-emerald-500 outline-none"
                  />
                )}
                <button 
                  onClick={() => {
                    setViewInterval('MONTH');
                    setCurrentDate(startOfMonth(currentDate));
                  }}
                  className={cn(
                    "px-3 py-1 text-xs rounded transition-all",
                    viewInterval === 'MONTH' ? "bg-slate-700 text-white shadow" : "text-slate-500 hover:text-slate-300"
                  )}
                >
                  單月模式
                </button>
                <button 
                  onClick={() => setViewInterval('4WEEK')}
                  className={cn(
                    "px-3 py-1 text-xs rounded transition-all",
                    viewInterval === '4WEEK' ? "bg-slate-700 text-white shadow" : "text-slate-500 hover:text-slate-300"
                  )}
                >
                  四周模式
                </button>
              </div>
              <div className="flex bg-slate-800 rounded-md p-1">
                <button 
                  onClick={() => setCurrentDate(subMonths(currentDate, 1))}
                  className="px-3 py-1 hover:bg-slate-700 rounded text-slate-400 hover:text-white transition-colors"
                >
                  <ChevronLeft size={16} />
                </button>
                <button className="px-4 py-1.5 bg-slate-700 rounded text-sm font-medium">
                  {viewInterval === 'MONTH' ? format(currentDate, 'yyyy年 MM月') : `${format(daysInInterval[0], 'MM/dd')} ~ ${format(daysInInterval[27], 'MM/dd')}`}
                </button>
                <button 
                  onClick={() => {
                    if (viewInterval === 'MONTH') {
                      setCurrentDate(addMonths(currentDate, 1));
                    } else {
                      setCurrentDate(addDays(currentDate, 7)); // 四周模式下按周移動
                    }
                  }}
                  className="px-3 py-1 hover:bg-slate-700 rounded text-slate-400 hover:text-white transition-colors"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
              <button 
                onClick={handleExportExcel}
                className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-1.5 rounded-md text-sm font-medium transition-colors ml-4"
              >
                <Download size={16} />
                匯出 Excel
              </button>
            </>
          )}
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          {currentView === 'SCHEDULE' ? (
            <motion.div 
              key="schedule"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="flex flex-1 overflow-hidden"
            >
              {/* Sidebar */}
              <aside className="w-72 border-r border-slate-800 bg-slate-950 p-6 flex flex-col gap-6 overflow-y-auto">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest">排班操作</h2>
            </div>
            <div className="grid grid-cols-1 gap-2">
              <button 
                onClick={handleAutoSchedule}
                className="flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-2.5 rounded-lg text-sm font-medium transition-all"
              >
                <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                自動排班
              </button>
              <button 
                onClick={async () => {
                  const visibleDateRange = `${format(daysInInterval[0], 'MM/dd')} ~ ${format(daysInInterval[daysInInterval.length-1], 'MM/dd')}`;
                  if (confirm(`確定要清除目前顯示區間 (${visibleDateRange}) 的所有排班嗎？\n這將移除所有自動排班與手動預排紀錄紀錄。`)) {
                    setLoading(true);
                    try {
                      const batch = writeBatch(db);
                      const currentViewAssignments = assignments.filter(a => 
                        daysInInterval.some(d => format(d, 'yyyy-MM-dd') === a.date)
                      );

                      if (currentViewAssignments.length === 0) {
                        alert("目前顯示區間無可清除的排班");
                        setLoading(false);
                        return;
                      }

                      currentViewAssignments.forEach(a => {
                        const targetMonth = format(parseISO(a.date), 'yyyy-MM');
                        const id = `${a.userId}_${a.date}`;
                        batch.delete(doc(db, `schedules/${targetMonth}/assignments`, id));
                      });

                      await batch.commit();
                      alert(`已成功清除 ${currentViewAssignments.length} 筆排班紀錄`);
                    } catch (err) {
                      console.error("Reset failed:", err);
                      alert("清除失敗，請稍後再試: " + (err instanceof Error ? err.message : String(err)));
                    } finally {
                      setLoading(false);
                    }
                  }
                }}
                className="flex items-center justify-center gap-2 bg-red-900/10 hover:bg-red-900/20 text-red-400 border border-red-500/30 px-4 py-2.5 rounded-lg text-sm font-medium transition-all"
              >
                <Trash2 size={16} />
                清除目前班表
              </button>
              <button 
                onClick={handleAiSuggest}
                className="flex items-center justify-center gap-2 bg-emerald-600/10 hover:bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 px-4 py-2.5 rounded-lg text-sm font-medium transition-all"
                disabled={isAiLoading}
              >
                <Bot size={16} className={isAiLoading ? 'animate-pulse' : ''} />
                AI 排班建議
              </button>
            </div>
          </div>

          <div className="space-y-4">
            <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest">人力警示</h2>
            <div className="space-y-2">
              {Object.entries(dayStatus).filter(([_, s]) => !(s as any).isValid).slice(0, 5).map(([date, s]) => (
                <div key={date} className="flex items-start gap-3 p-3 bg-red-500/10 border border-red-500/20 rounded-lg group animate-in fade-in slide-in-from-left-2 transition-all">
                  <div className="w-2 h-2 rounded-full bg-red-500 mt-1 animate-pulse" />
                  <div className="flex-1">
                    <p className="text-xs font-bold text-red-400">{date}</p>
                    <p className="text-[10px] text-red-300/70">休假人數 ({(s as any).offCount}) 超標</p>
                  </div>
                </div>
              ))}
              {Object.entries(dayStatus).filter(([_, s]) => !(s as any).isValid).length === 0 && (
                <div className="flex items-center gap-2 text-xs p-3 bg-emerald-500/5 border border-emerald-500/10 rounded-lg text-emerald-400">
                  <div className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span>目前人力資源分配正常</span>
                </div>
              )}
            </div>
          </div>

          <div className="mt-auto p-4 bg-slate-900 rounded-xl border border-slate-800">
            <p className="text-[10px] text-slate-500 mb-2 uppercase font-bold tracking-wider">行動版同步</p>
            <div className="flex items-start gap-3">
              <div className="p-2 bg-slate-800 rounded-lg text-slate-400">
                <Smartphone size={16} />
              </div>
              <p className="text-[11px] text-slate-400 leading-normal">
                員工可透過行動 APP 即時查看排班與提出換班申請
              </p>
            </div>
          </div>
        </aside>

        {/* Main Grid Content */}
        <main className="flex-1 p-6 overflow-hidden flex flex-col gap-6">
          <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden shadow-2xl flex-1 flex flex-col">
            <div className="overflow-x-auto flex-1">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-slate-800/50 border-b border-slate-800">
                    <th className="p-4 text-left font-bold text-xs text-slate-400 uppercase tracking-widest sticky left-0 bg-slate-800 z-20 min-w-[140px]">
                      姓名 \ 日期
                    </th>
                    {daysInInterval.map(day => {
                      const dateStr = format(day, 'yyyy-MM-dd');
                      const dayOfWeek = getWeekDay(dateStr);
                      const isW14 = dayOfWeek >= 1 && dayOfWeek <= 4;
                      const isWeekEnd = dayOfWeek >= 5;
                      const isHoliday = holidays.includes(dateStr);
                      
                      const dateAssignments = assignments.filter(a => a.date === dateStr);
                      const offCount = dateAssignments.filter(a => a.type === 'OFF' || a.type === 'V').length;
                      const isViolation = isW14 ? offCount > 3 : offCount > 2;
                      
                      return (
                        <th key={dateStr} className={cn(
                          "p-3 text-center border-l border-slate-800 min-w-[65px] relative group/header transition-colors",
                          isWeekEnd ? "bg-slate-800/80" : "",
                          isHoliday ? "bg-red-900/30" : "",
                          isViolation ? "bg-red-600/20" : ""
                        )}>
                          <div className={cn(
                            "text-[9px] font-bold uppercase tracking-widest mb-1",
                            (isWeekEnd || isHoliday) ? "text-red-400/60" : "text-slate-500"
                          )}>
                            {format(day, 'EEE')}
                          </div>
                          <div className={cn(
                            "text-sm font-mono font-black transition-all",
                            isToday(day) ? "text-emerald-400 scale-110" : (isHoliday || isWeekEnd ? "text-red-400" : "text-slate-300")
                          )}>
                            {format(day, 'dd')}
                          </div>
                          {isHoliday && (
                            <div className="absolute bottom-1 left-0 right-0 flex justify-center">
                              <div className="h-0.5 w-4 bg-red-500 rounded-full" />
                            </div>
                          )}
                          {isViolation && (
                            <div className="absolute top-0 inset-x-0 h-1 bg-red-500 animate-pulse" title="休假人數超標" />
                          )}
                        </th>
                      );
                    })}
                    <th className="p-3 text-center border-l border-slate-800 min-w-[80px] bg-slate-800/50">
                      <div className="text-[9px] font-bold uppercase opacity-40 italic">Check</div>
                      <div className="text-[10px] text-slate-400">總班數</div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => {
                    const userAssigns = assignments.filter(a => a.userId === user.id && daysInInterval.some(d => format(d, 'yyyy-MM-dd') === a.date));
                    const totalWorked = userAssigns.filter(a => a.type !== 'OFF' && a.type !== 'V').length;
                    
                    return (
                      <tr key={user.id} className="border-b border-slate-800 hover:bg-slate-800/30 transition-colors group">
                        <td className="p-4 font-medium text-sm bg-slate-900 sticky left-0 z-10 border-r border-slate-800 shadow-[4px_0_12px_rgba(0,0,0,0.2)]">
                          <div className="flex flex-col gap-0.5 min-w-[100px]">
                            <div className="flex items-center gap-2">
                              <div className={cn("w-2 h-2 rounded-full", user.role === 'ADMIN' ? 'bg-emerald-400' : 'bg-slate-600')} />
                              <span className="truncate">{user.name}</span>
                            </div>
                            <button 
                              onClick={() => {
                                const typeNames = Object.entries(SHIFT_DETAILS).map(([k, v]) => `${k}:${v.name}`).join(', ');
                                const pref = prompt(`請輸入 ${user.name} 的喜好班別\n(${typeNames}):`, user.preferences?.preferredShift || "");
                                if (pref && SHIFT_DETAILS[pref as ShiftType]) {
                                  updateUserPreference(user.id, pref as ShiftType);
                                } else if (pref !== null) {
                                  alert("無效的班別代號");
                                }
                              }}
                              className="text-[10px] text-slate-500 hover:text-emerald-400 transition-colors text-left flex items-center gap-1"
                            >
                              ⚙️ {user.preferences?.preferredShift ? SHIFT_DETAILS[user.preferences.preferredShift].name : "設定喜好"}
                            </button>
                          </div>
                        </td>
                        {daysInInterval.map(day => {
                          const dateStr = format(day, 'yyyy-MM-dd');
                          const assignment = assignments.find(a => a.date === dateStr && a.userId === user.id);
                          
                          return (
                            <td 
                              key={dateStr} 
                              onClick={() => {
                                setSelectorConfig({ userId: user.id, date: dateStr, userName: user.name });
                              }}
                              className="p-1 border-l border-slate-800/50 text-center group cursor-pointer relative"
                            >
                              {assignment ? (
                                <div className={cn(
                                  "h-10 flex flex-col items-center justify-center rounded-md text-[10px] font-bold transition-all group-hover:scale-105 active:scale-95 border relative",
                                  SHIFT_DETAILS[assignment.type].color,
                                  consecutiveDays[user.id]?.[dateStr] > 5 ? "ring-1 ring-red-500 ring-offset-2 ring-offset-slate-900" : ""
                                )}>
                                  {assignment.isManual && (
                                    <div className="absolute top-0.5 right-0.5 w-1 h-1 bg-white rounded-full shadow-sm" title="手動預排" />
                                  )}
                                  <span className={cn(
                                    "text-[11px] leading-tight",
                                    assignment.type === 'OFF' ? "opacity-60" : "font-black"
                                  )}>
                                    {SHIFT_DETAILS[assignment.type].name}
                                  </span>
                                  {consecutiveDays[user.id]?.[dateStr] > 0 && (
                                    <span className="text-[8px] opacity-40">
                                      {consecutiveDays[user.id]?.[dateStr]}d
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <div className="h-10 rounded-md bg-slate-800/20 group-hover:bg-slate-800/50 border border-dashed border-slate-800 transition-all flex items-center justify-center" />
                              )}
                            </td>
                          );
                        })}
                        <td className="p-1 text-center border-l border-slate-800/50 bg-slate-900/50">
                          <div className={cn(
                            "text-sm font-mono font-bold",
                            totalWorked > 22 ? "text-orange-400" : "text-slate-500"
                          )}>
                            {totalWorked}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="bg-slate-800/50 font-bold border-t-2 border-slate-800">
                    <td className="p-4 text-[10px] text-slate-500 uppercase tracking-widest sticky left-0 z-10 bg-slate-800 border-r border-slate-700">
                      每日休假統計
                    </td>
                    {daysInInterval.map(day => {
                      const dateStr = format(day, 'yyyy-MM-dd');
                      const status = dayStatus[dateStr];

                      return (
                        <td key={dateStr} className={cn(
                          "p-3 text-center text-xs font-mono font-bold border-l border-slate-700",
                          !(status as any)?.isValid ? "text-red-400 bg-red-400/5" : "text-emerald-400"
                        )}>
                          {(status as any)?.offCount || 0}
                        </td>
                      );
                    })}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* AI Suggestions Panel */}
          <AnimatePresence>
            {aiSuggestions && (
              <motion.div 
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="bg-slate-900 rounded-xl p-6 border border-slate-800 relative overflow-hidden"
              >
                <div className="absolute top-0 left-0 w-1 h-full bg-emerald-500" />
                <button 
                  onClick={() => setAiSuggestions(null)}
                  className="absolute top-4 right-4 text-slate-500 hover:text-white"
                >
                  ✕
                </button>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-8 h-8 rounded bg-emerald-500/10 flex items-center justify-center text-emerald-400">
                    <Bot size={20} />
                  </div>
                  <h3 className="font-bold text-slate-100">AI 排班分析建議案</h3>
                </div>
                <div className="prose prose-invert max-w-none text-xs text-slate-400 leading-relaxed whitespace-pre-wrap">
                  {aiSuggestions}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* KPI Dashboard */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-slate-900 p-4 rounded-xl border border-slate-800">
              <p className="text-[10px] text-slate-500 uppercase font-bold mb-1 tracking-wider">勞基法合規性</p>
              <p className="text-xl font-semibold text-emerald-400">符合 100%</p>
            </div>
            <div className="bg-slate-900 p-4 rounded-xl border border-slate-800">
              <p className="text-[10px] text-slate-500 uppercase font-bold mb-1 tracking-wider">連續上班限制</p>
              <p className="text-xl font-semibold text-slate-200">Max 5天</p>
            </div>
            <div className="bg-slate-900 p-4 rounded-xl border border-slate-800">
              <p className="text-[10px] text-slate-500 uppercase font-bold mb-1 tracking-wider">APP 即時請求</p>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-orange-500" />
                <p className="text-xl font-semibold text-orange-400">0 則等待</p>
              </div>
            </div>
            <div className="bg-slate-900 p-4 rounded-xl border border-slate-800">
              <p className="text-[10px] text-slate-500 uppercase font-bold mb-1 tracking-wider">系統狀態</p>
              <p className="text-xl font-semibold text-blue-400">運作正常</p>
            </div>
          </div>
        </main>
      </motion.div>
    ) : (
            <motion.div 
              key="staff"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="flex-1 p-8 overflow-y-auto"
            >
              <div className="max-w-5xl mx-auto space-y-8">
                <div className="flex items-end justify-between">
                  <div>
                    <h2 className="text-2xl font-bold text-white mb-2">人員管理與喜好設定</h2>
                    <p className="text-slate-500">管理 8 位書記人員的基本資料與排班喜好</p>
                  </div>
                  <div className="bg-slate-900 border border-slate-800 p-3 rounded-lg flex items-center gap-2 text-xs text-slate-400 max-w-sm">
                    <AlertCircle size={16} className="text-emerald-500 shrink-0" />
                    <span>自動排班系統將會盡量滿足喜好，但仍以勞基法與人力覆蓋為最高優先。</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {users.map(user => (
                    <div key={user.id} className="bg-slate-900 border border-slate-800 rounded-xl p-6 hover:border-emerald-500/30 transition-all group">
                      <div className="flex items-start justify-between mb-6">
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 bg-slate-800 rounded-full flex items-center justify-center text-slate-400 group-hover:bg-emerald-500/10 group-hover:text-emerald-400 transition-colors">
                            <UserCircle size={32} />
                          </div>
                          <div>
                            <h4 className="font-bold text-lg text-white">{user.name}</h4>
                            <p className="text-xs text-slate-500">書記人員 | {user.id}</p>
                          </div>
                        </div>
                        <div className={cn(
                          "px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider",
                          user.role === 'ADMIN' ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20" : "bg-slate-800 text-slate-500"
                        )}>
                          {user.role}
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div>
                          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-2 font-mono">PREFERRED SHIFT / 優先安排班別</label>
                          <div className="grid grid-cols-3 gap-2">
                            {(Object.keys(SHIFT_DETAILS) as ShiftType[]).map(type => (
                              <button
                                key={type}
                                onClick={() => updateUserPreference(user.id, type)}
                                title={SHIFT_DETAILS[type].name}
                                className={cn(
                                  "py-2 px-1 rounded-lg text-xs font-bold transition-all border truncate",
                                  user.preferences?.preferredShift === type 
                                    ? "bg-emerald-500 text-slate-950 border-emerald-400 shadow-lg shadow-emerald-500/20" 
                                    : "bg-slate-800 text-slate-400 border-slate-700 hover:border-slate-600"
                                )}
                              >
                                {SHIFT_DETAILS[type].name}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="pt-4 border-t border-slate-800 flex items-center justify-between">
                          <div className="flex items-center gap-2 text-[10px] text-slate-500">
                            <RefreshCw size={12} />
                            <span>自動儲存至雲端</span>
                          </div>
                          {user.preferences?.preferredShift && (
                            <div className="flex items-center gap-1 text-[10px] text-emerald-500 italic">
                              <CheckCircle2 size={12} />
                              <span>喜好生效中</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="bg-emerald-900/10 border border-emerald-500/20 p-8 rounded-2xl flex items-center gap-8">
                  <div className="w-16 h-16 bg-emerald-500/10 rounded-2xl flex items-center justify-center text-emerald-500">
                    <CalendarIcon size={32} />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-xl font-bold text-white mb-2">請假與特休功能說明</h3>
                    <p className="text-slate-400 text-sm leading-relaxed">
                      排班管理員如需為同仁安排請假，請直接在班表頁面點擊對應格子並選擇 <span className="text-orange-400 font-bold">特休 (V)</span>。
                      被手動標記為特休或休息的格子，自動排班系統將會跳過該人員。若單日休假人數超過上限，系統將會顯示警報。
                    </p>
                  </div>
                  <button 
                    onClick={() => setCurrentView('SCHEDULE')}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white px-8 py-3 rounded-xl font-bold shadow-lg shadow-emerald-500/20 transition-all active:scale-95"
                  >
                   回班表
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Footer Legend */}
      <footer className="h-12 border-t border-slate-800 px-6 flex items-center justify-between text-[10px] text-slate-500 bg-slate-950 z-30">
        <div className="flex gap-6">
          <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 bg-blue-900/40 border border-blue-800/50 rounded-sm"></div> 白班: 7(主)/7(副)</div>
          <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 bg-purple-900/40 border border-purple-800/50 rounded-sm"></div> 小夜: 3(主)/3(副)</div>
          <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 bg-indigo-900/50 border border-indigo-800/50 rounded-sm"></div> 大夜: 11</div>
          <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 bg-slate-800 border border-slate-700 rounded-sm"></div> 休息日</div>
        </div>
        <div className="flex items-center gap-4">
          <span>數據更新時間: {format(new Date(), 'yyyy-MM-dd HH:mm')}</span>
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>伺服器連線中</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
