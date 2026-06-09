'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { supabase } from '../lib/supabase';

interface Room {
  id: string;
  room_number: string;
  room_type: string;
  kitchen_type: string;
  building?: string;
  floor?: number | string;
  view_direction?: string;
}

interface Contract {
  id: string;
  tenant_name: string;
  status: string;
  main_room_id: string;
  main_start_date: string;
  main_end_date: string;
  temp_room_id?: string;
  temp_start_date?: string;
  temp_end_date?: string;
  move_to_room_id?: string;
  move_start_date?: string;
  move_end_date?: string;
  contract_start_date?: string;
  contract_end_date?: string;
  actual_check_in_date?: string;
  monthly_rent?: number;
}

interface Block {
  type: 'MAIN' | 'TEMP' | 'MOVE';
  name: string;
  start: Date;
  end: Date;
  isCancelled?: boolean;
  contract: Contract;
}

const getDaysDiff = (start: Date, end: Date) => {
  const msPerDay = 1000 * 60 * 60 * 24;
  const d1 = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const d2 = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.round((d2.getTime() - d1.getTime()) / msPerDay);
};

export default function DashboardPage() {
  const [stats, setStats] = useState({ totalVacant: 0, frontKitchen: 0, backKitchen: 0 });
  const [waitlistCount, setWaitlistCount] = useState(0);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [allContracts, setAllContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBlockForDetail, setSelectedBlockForDetail] = useState<Block | null>(null);

  // Renewal intention for modal detail
  const [modalRenewalIntent, setModalRenewalIntent] = useState<string | null>(null);

  // State สำหรับตัวกรอง
  const [filterBuilding, setFilterBuilding] = useState('');
  const [filterFloor, setFilterFloor] = useState('');
  const [filterRoomType, setFilterRoomType] = useState('');
  const [filterKitchen, setFilterKitchen] = useState('');
  const [filterView, setFilterView] = useState('');
  const [filterGap, setFilterGap] = useState('');
  // Renewal filter: '', 'renew', 'not_renew', 'not_asked', 'pending', 'renew_no_room'
  const [filterRenewal, setFilterRenewal] = useState<string>('');

  // Map of contractId -> intention string
  const [renewalIntentsMap, setRenewalIntentsMap] = useState<Record<string, string | null>>({});

  const [dayWidth, setDayWidth] = useState(3);

  const defaultStart = new Date(); defaultStart.setMonth(defaultStart.getMonth() - 1);
  const defaultEnd = new Date(); defaultEnd.setMonth(defaultEnd.getMonth() + 11);

  const [searchStartDate, setSearchStartDate] = useState(defaultStart.toISOString().split('T')[0]);
  const [searchEndDate, setSearchEndDate] = useState(defaultEnd.toISOString().split('T')[0]);

  // States สำหรับโหมดตัวเลือกวันที่ (รายปี, รายเดือน, กำหนดเอง)
  const [filterMode, setFilterMode] = useState<'custom' | 'yearly' | 'monthly'>('yearly');
  const [startYear, setStartYear] = useState(new Date().getFullYear());
  const [endYear, setEndYear] = useState(new Date().getFullYear() + 1);
  const [selectedMonthStart, setSelectedMonthStart] = useState(new Date().getMonth() + 1);
  const [selectedYearStart, setSelectedYearStart] = useState(new Date().getFullYear());
  const [selectedMonthEnd, setSelectedMonthEnd] = useState(new Date().getMonth() + 1);
  const [selectedYearEnd, setSelectedYearEnd] = useState(new Date().getFullYear());

  // --- Virtual Scroll State ---
  const [scrollTop, setScrollTop] = useState(0);

  const handleStartYearChange = (year: number) => {
    setStartYear(year);
    if (year > endYear) {
      setEndYear(year);
    }
  };

  const handleEndYearChange = (year: number) => {
    setEndYear(year);
    if (year < startYear) {
      setStartYear(year);
    }
  };

  const handleMonthlyStartChange = (year: number, month: number) => {
    setSelectedYearStart(year);
    setSelectedMonthStart(month);
    if (year > selectedYearEnd || (year === selectedYearEnd && month > selectedMonthEnd)) {
      setSelectedYearEnd(year);
      setSelectedMonthEnd(month);
    }
  };

  const handleMonthlyEndChange = (year: number, month: number) => {
    setSelectedYearEnd(year);
    setSelectedMonthEnd(month);
    if (year < selectedYearStart || (year === selectedYearStart && month < selectedMonthStart)) {
      setSelectedYearStart(year);
      setSelectedMonthStart(month);
    }
  };

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const startX = useRef(0);
  const scrollLeft = useRef(0);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      // 🌟 แก้ไข: แปลงเฉพาะ vertical scroll (deltaY) เป็นแนวนอนเมื่อกด Shift เท่านั้น
      // ปล่อย deltaX ทำงานตามปกติเพื่อรองรับความสมูทของ Trackpad MacBook หรือ Touchscreen
      if (e.shiftKey && e.deltaY !== 0) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      }
    };
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    const el = scrollContainerRef.current;
    if (!el) return;
    isDragging.current = true;
    startX.current = e.pageX - el.offsetLeft;
    scrollLeft.current = el.scrollLeft;
    el.style.cursor = 'grabbing';
  };

  const handleMouseLeaveOrUp = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    isDragging.current = false;
    el.style.cursor = 'grab';
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging.current) return;
    e.preventDefault();
    const el = scrollContainerRef.current;
    if (!el) return;
    const x = e.pageX - el.offsetLeft;
    const walk = (x - startX.current) * 1.5;
    el.scrollLeft = scrollLeft.current - walk;
  };

  useEffect(() => {
    const pad = (n: number) => String(n).padStart(2, '0');

    if (filterMode === 'yearly') {
      const start = `${startYear}-01-01`;
      const end = `${endYear}-12-31`;
      setSearchStartDate(start);
      setSearchEndDate(end);
    } else if (filterMode === 'monthly') {
      const start = `${selectedYearStart}-${pad(selectedMonthStart)}-01`;
      const endDay = new Date(selectedYearEnd, selectedMonthEnd, 0).getDate();
      const end = `${selectedYearEnd}-${pad(selectedMonthEnd)}-${pad(endDay)}`;
      setSearchStartDate(start);
      setSearchEndDate(end);
    }
  }, [filterMode, startYear, endYear, selectedMonthStart, selectedYearStart, selectedMonthEnd, selectedYearEnd]);

  useEffect(() => {
    fetchDashboardData();
  }, [searchStartDate, searchEndDate]);

  useEffect(() => {
    if (!selectedBlockForDetail) {
      setModalRenewalIntent(null);
      return;
    }

    const fetchIntent = async () => {
      try {
        const { data } = await supabase.from('renewal_intentions').select('*').eq('contract_id', selectedBlockForDetail.contract.id).limit(1);
        if (data && Array.isArray(data) && data.length > 0) setModalRenewalIntent((data[0] as any).intention || null);
        else setModalRenewalIntent(null);
      } catch (err) {
        setModalRenewalIntent(null);
      }
    };

    fetchIntent();
  }, [selectedBlockForDetail]);

  const isDateOverlapping = (start1: string, end1: string, start2: string, end2: string) => {
    if (!start1 || !end1 || !start2 || !end2) return false;
    return new Date(start1) <= new Date(end2) && new Date(end1) >= new Date(start2);
  };

  async function fetchDashboardData() {
    setLoading(true);
    const { data: roomsData } = await supabase.from('rooms').select('*').order('room_number');
    if (roomsData) setRooms(roomsData);

    const { data: contractsData } = await supabase.from('contracts').select('*');
    if (contractsData) setAllContracts(contractsData);

    // Fetch renewal intentions and build a map for quick lookup
    try {
      const { data: intents } = await supabase.from('renewal_intentions').select('contract_id,intention');
      const map: Record<string, string | null> = {};
      if (intents && Array.isArray(intents)) {
        intents.forEach((it: any) => {
          map[it.contract_id] = it.intention || null;
        });
      }
      setRenewalIntentsMap(map);
    } catch (err) {
      setRenewalIntentsMap({});
    }

    const occupiedRoomIds = new Set<string>();
    contractsData?.forEach(c => {
      const mainEnd = c.contract_end_date || c.main_end_date;
      const tempEnd = c.contract_end_date || c.temp_end_date;
      const moveEnd = c.contract_end_date || c.move_end_date;

      if (c.main_room_id && c.main_start_date && mainEnd && isDateOverlapping(c.main_start_date, mainEnd, searchStartDate, searchEndDate)) occupiedRoomIds.add(c.main_room_id);
      if (c.temp_room_id && c.temp_start_date && tempEnd && isDateOverlapping(c.temp_start_date, tempEnd, searchStartDate, searchEndDate)) occupiedRoomIds.add(c.temp_room_id);
      if (c.move_to_room_id && c.move_start_date && moveEnd && isDateOverlapping(c.move_start_date, moveEnd, searchStartDate, searchEndDate)) occupiedRoomIds.add(c.move_to_room_id);
    });

    if (roomsData) {
      const vacantRooms = roomsData.filter(r => !occupiedRoomIds.has(r.id));
      setStats({
        totalVacant: vacantRooms.length,
        frontKitchen: vacantRooms.filter(r => r.kitchen_type === 'ครัวหน้า').length,
        backKitchen: vacantRooms.filter(r => r.kitchen_type === 'ครัวหลัง').length,
      });
    }

    const { count } = await supabase.from('waitlists').select('*', { count: 'exact', head: true }).eq('status', 'รอเลือกห้อง');
    if (count !== null) setWaitlistCount(count);
    setLoading(false);
  }

  const uniqueBuildings = Array.from(new Set(rooms.map(r => r.building).filter(Boolean)));
  const uniqueFloors = Array.from(new Set(rooms.map(r => r.floor).filter(Boolean))).sort((a, b) => Number(a) - Number(b));
  const uniqueKitchens = Array.from(new Set(rooms.map(r => r.kitchen_type).filter(Boolean)));
  const uniqueRoomTypes = Array.from(new Set(rooms.map(r => r.room_type).filter(Boolean)));
  const uniqueViews = Array.from(new Set(rooms.map(r => r.view_direction).filter(Boolean)));

  const filteredRooms = rooms.filter(room => {
    const matchBuilding = filterBuilding === '' || room.building === filterBuilding;
    const matchFloor = filterFloor === '' || String(room.floor || '') === filterFloor;
    const matchRoomType = filterRoomType === '' || room.room_type === filterRoomType;
    const matchKitchen = filterKitchen === '' || room.kitchen_type === filterKitchen;
    const matchView = filterView === '' || room.view_direction === filterView;
    return matchBuilding && matchFloor && matchRoomType && matchKitchen && matchView;
  });

  const occupancyData = useMemo(() => {
    const start = new Date(searchStartDate);
    const end = new Date(searchEndDate);
    const data: { monthLabel: string; occupiedRooms: number; bookingCount: number; totalRooms: number; occupancyRate: number; bookingRate: number }[] = [];
    const totalRoomsCount = rooms.length;

    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
      return data;
    }

    let curMonth = new Date(start.getFullYear(), start.getMonth(), 1);
    while (curMonth <= end) {
      const year = curMonth.getFullYear();
      const month = curMonth.getMonth();
      const monthStart = new Date(year, month, 1);
      const monthEnd = new Date(year, month + 1, 0);
      const monthLabel = curMonth.toLocaleDateString('th-TH', { month: 'short', year: '2-digit' });

      const occupiedRooms = new Set<string>();
      const bookedRooms = new Set<string>();

      allContracts.forEach(c => {
        if (c.status === 'cancelled' && !c.contract_end_date) return;

        const cancelledEnd = c.status === 'cancelled' ? c.contract_end_date : null;

        if (c.main_room_id && c.main_start_date) {
          const startBlock = new Date(c.main_start_date);
          const endBlock = new Date(cancelledEnd || c.main_end_date);
          if (startBlock <= monthEnd && endBlock >= monthStart) {
            occupiedRooms.add(c.main_room_id);
          }
          if (startBlock >= monthStart && startBlock <= monthEnd) {
            bookedRooms.add(c.main_room_id);
          }
        }
        if (c.temp_room_id && c.temp_start_date && c.temp_end_date) {
          const startBlock = new Date(c.temp_start_date);
          const endBlock = new Date(cancelledEnd || c.temp_end_date);
          if (startBlock <= monthEnd && endBlock >= monthStart) {
            occupiedRooms.add(c.temp_room_id);
          }
          if (startBlock >= monthStart && startBlock <= monthEnd) {
            bookedRooms.add(c.temp_room_id);
          }
        }
        if (c.move_to_room_id && c.move_start_date && c.move_end_date) {
          const startBlock = new Date(c.move_start_date);
          const endBlock = new Date(cancelledEnd || c.move_end_date);
          if (startBlock <= monthEnd && endBlock >= monthStart) {
            occupiedRooms.add(c.move_to_room_id);
          }
          if (startBlock >= monthStart && startBlock <= monthEnd) {
            bookedRooms.add(c.move_to_room_id);
          }
        }
      });

      const occupiedRoomsCount = occupiedRooms.size;
      const bookingCount = bookedRooms.size;
      const occupancyRate = totalRoomsCount > 0 ? (occupiedRoomsCount / totalRoomsCount) * 100 : 0;
      const bookingRate = totalRoomsCount > 0 ? (bookingCount / totalRoomsCount) * 100 : 0;

      data.push({
        monthLabel,
        occupiedRooms: occupiedRoomsCount,
        bookingCount,
        totalRooms: totalRoomsCount,
        occupancyRate,
        bookingRate,
      });

      curMonth = new Date(year, month + 1, 1);
    }

    return data;
  }, [rooms, allContracts, searchStartDate, searchEndDate]);

  const chartRange = useMemo(() => {
    if (filterMode === 'yearly') {
      return {
        start: new Date(startYear, 0, 1),
        end: new Date(endYear, 11, 31),
      };
    }

    if (filterMode === 'monthly' && selectedYearStart === selectedYearEnd) {
      return {
        start: new Date(selectedYearStart, 0, 1),
        end: new Date(selectedYearStart, 11, 31),
      };
    }

    return {
      start: new Date(searchStartDate),
      end: new Date(searchEndDate),
    };
  }, [filterMode, startYear, endYear, selectedYearStart, selectedMonthStart, selectedYearEnd, selectedMonthEnd, searchStartDate, searchEndDate]);

  const startDate = chartRange.start;
  const endDate = chartRange.end;
  const totalDays = getDaysDiff(startDate, endDate) + 1;

  const timelineMonths: { label: string, days: number }[] = [];
  let curMonthStart = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  while (curMonthStart <= endDate) {
    const monthEnd = new Date(curMonthStart.getFullYear(), curMonthStart.getMonth() + 1, 0);
    const actualStart = curMonthStart < startDate ? startDate : curMonthStart;
    const actualEnd = monthEnd > endDate ? endDate : monthEnd;
    timelineMonths.push({
      label: curMonthStart.toLocaleDateString('th-TH', { month: 'short', year: '2-digit' }),
      days: getDaysDiff(actualStart, actualEnd) + 1
    });
    curMonthStart = new Date(curMonthStart.getFullYear(), curMonthStart.getMonth() + 1, 1);
  }

  const daysArray = Array.from({ length: totalDays }, (_, i) => {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    return d.getDate();
  });

  const getBlocksForRoom = (roomId: string) => {
    const blocks: Block[] = [];

    allContracts.forEach(c => {
      const isCancelled = c.status === 'cancelled';
      const cancelledEnd = c.contract_end_date ? new Date(c.contract_end_date) : null;

      if (c.main_room_id === roomId && c.main_start_date && c.main_end_date) {
        const start = new Date(c.main_start_date);
        const defaultEnd = new Date(c.main_end_date);
        const end = (isCancelled && cancelledEnd) ? cancelledEnd : defaultEnd;
        if (start <= end) blocks.push({ type: 'MAIN', name: c.tenant_name, start, end, isCancelled, contract: c });
      }

      if (c.temp_room_id === roomId && c.temp_start_date && c.temp_end_date) {
        const start = new Date(c.temp_start_date);
        const defaultEnd = new Date(c.temp_end_date);
        const end = (isCancelled && cancelledEnd) ? cancelledEnd : defaultEnd;
        if (start <= end) blocks.push({ type: 'TEMP', name: c.tenant_name, start, end, isCancelled, contract: c });
      }

      if (c.move_to_room_id === roomId && c.move_start_date && c.move_end_date) {
        const start = new Date(c.move_start_date);
        const defaultEnd = new Date(c.move_end_date);
        const end = (isCancelled && cancelledEnd) ? cancelledEnd : defaultEnd;
        if (start <= end) blocks.push({ type: 'MOVE', name: c.tenant_name, start, end, isCancelled, contract: c });
      }
    });
    return blocks;
  };

  const todayOffset = getDaysDiff(startDate, new Date());
  const showTodayLine = todayOffset >= 0 && todayOffset <= totalDays;
  const showDayDetails = dayWidth >= 15;

  const displayedRooms = useMemo(() => {
    let baseRooms = filteredRooms;

    if (filterRenewal) {
      const desired = filterRenewal; 
      baseRooms = baseRooms.filter(room => {
        const contractsForRoom = allContracts.filter(c => {
          const isAssigned = c.main_room_id === room.id || c.temp_room_id === room.id || c.move_to_room_id === room.id;
          if (!isAssigned) return false;

          try {
              if (c.main_room_id === room.id && c.main_start_date && (c.main_end_date || c.contract_end_date)) {
                const s = new Date(c.main_start_date);
                const endStr = c.contract_end_date || c.main_end_date;
                if (!endStr) return false;
                const e = new Date(endStr);
                return s <= chartRange.end && e >= chartRange.start;
              }
              if (c.temp_room_id === room.id && c.temp_start_date && (c.temp_end_date || c.contract_end_date)) {
                const s = new Date(c.temp_start_date);
                const endStr = c.contract_end_date || c.temp_end_date;
                if (!endStr) return false;
                const e = new Date(endStr);
                return s <= chartRange.end && e >= chartRange.start;
              }
              if (c.move_to_room_id === room.id && c.move_start_date && (c.move_end_date || c.contract_end_date)) {
                const s = new Date(c.move_start_date);
                const endStr = c.contract_end_date || c.move_end_date;
                if (!endStr) return false;
                const e = new Date(endStr);
                return s <= chartRange.end && e >= chartRange.start;
              }
          } catch (err) {
            return false;
          }

          return false;
        });

        if (contractsForRoom.length === 0) return false;

        for (const c of contractsForRoom) {
          const intent = renewalIntentsMap[c.id] ?? null;
          if (desired === 'renew' && intent === 'renew') return true;
          if (desired === 'renew_no_room' && intent === 'renew_no_room') return true;
          if (desired === 'not_renew' && intent === 'not_renew') return true;
          if (desired === 'not_asked' && intent === 'not_asked') return true;
          if (desired === 'pending' && intent === 'pending') return true;
        }

        return false;
      });
    }

    if (!filterGap) return baseRooms;
    if (filterGap === 'shortGap') {
      const thresholdDays = 365;
      return baseRooms.filter(room => {
        const blocks = getBlocksForRoom(room.id)
          .map(b => ({ start: b.start, end: b.end }))
          .map(b => ({ start: b.start < chartRange.start ? chartRange.start : b.start, end: b.end > chartRange.end ? chartRange.end : b.end }))
          .filter(b => b.end >= b.start)
          .sort((a, b) => a.start.getTime() - b.start.getTime());

        if (blocks.length < 2) return false;

        for (let i = 0; i < blocks.length - 1; i++) {
          const prev = blocks[i];
          const next = blocks[i + 1];
          const gapDays = getDaysDiff(prev.end, next.start) - 1;
          if (gapDays > 0 && gapDays < thresholdDays) return true;
        }

        return false;
      });
    }

    return baseRooms;
  }, [filteredRooms, filterGap, allContracts, chartRange, filterRenewal, renewalIntentsMap]);


  // 🌟 Logic การทำ Windowing / Virtual Scroll เรนเดอร์เฉพาะแถวที่ปรากฏบนหน้าจอ
  const rowHeight = 48; // อ้างอิงจาก h-12 = 48px
  const overscan = 10; // สำรองบรรทัดไว้เรนเดอร์ล่วงหน้ากันกระตุก
  const containerViewportHeight = typeof window !== 'undefined' ? window.innerHeight : 1000; 
  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const endIndex = Math.min(displayedRooms.length - 1, Math.floor((scrollTop + containerViewportHeight) / rowHeight) + overscan);
  
  // ตัดข้อมูลเฉพาะห้องพักที่ต้องเรนเดอร์
  const visibleRooms = displayedRooms.slice(startIndex, endIndex + 1);


  return (
    <div className="flex-1 p-8 md:p-10 max-w-[1600px] mx-auto w-full space-y-8">
      {/* Header & Filters Section (ยังคงเดิมทั้งหมด) */}
      <section className="flex flex-col xl:flex-row xl:justify-between xl:items-end gap-6">
        <div className="bg-white p-2.5 rounded-2xl border border-slate-100 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] flex flex-wrap items-end gap-3">
          <div className="px-2">
            <label className="block text-[10px] font-bold text-slate-400 mb-1.5 uppercase tracking-wider">โหมดการเลือกช่วงเวลา</label>
            <select
              className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-[#4F81FF]/50 transition-all cursor-pointer"
              value={filterMode}
              onChange={(e) => setFilterMode(e.target.value as any)}
            >
              <option value="custom">กำหนดเอง (Custom)</option>
              <option value="yearly">รายปี (Yearly)</option>
              <option value="monthly">รายเดือน (Monthly)</option>
            </select>
          </div>

          {filterMode === 'yearly' && (
            <>
              <div className="px-2">
                <label className="block text-[10px] font-bold text-slate-400 mb-1.5 uppercase tracking-wider">ตั้งแต่ปี</label>
                <select
                  className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-[#4F81FF]/50 transition-all cursor-pointer"
                  value={startYear}
                  onChange={(e) => handleStartYearChange(Number(e.target.value))}
                >
                  {[2024, 2025, 2026, 2027, 2028, 2029, 2030].map(y => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
              <div className="px-2">
                <label className="block text-[10px] font-bold text-slate-400 mb-1.5 uppercase tracking-wider">ถึงปี</label>
                <select
                  className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-[#4F81FF]/50 transition-all cursor-pointer"
                  value={endYear}
                  onChange={(e) => handleEndYearChange(Number(e.target.value))}
                >
                  {[2024, 2025, 2026, 2027, 2028, 2029, 2030].map(y => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
            </>
          )}

          {filterMode === 'monthly' && (
            <>
              <div className="px-2">
                <label className="block text-[10px] font-bold text-slate-400 mb-1.5 uppercase tracking-wider">เดือนเริ่มต้น</label>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-[#4F81FF]/50 transition-all cursor-pointer"
                    value={selectedMonthStart}
                    onChange={(e) => handleMonthlyStartChange(selectedYearStart, Number(e.target.value))}
                  >
                    {[
                      { v: 1, l: "มกราคม" }, { v: 2, l: "กุมภาพันธ์" }, { v: 3, l: "มีนาคม" },
                      { v: 4, l: "เมษายน" }, { v: 5, l: "พฤษภาคม" }, { v: 6, l: "มิถุนายน" },
                      { v: 7, l: "กรกฎาคม" }, { v: 8, l: "สิงหาคม" }, { v: 9, l: "กันยายน" },
                      { v: 10, l: "ตุลาคม" }, { v: 11, l: "พฤศจิกายน" }, { v: 12, l: "ธันวาคม" }
                    ].map(m => (
                      <option key={m.v} value={m.v}>{m.l}</option>
                    ))}
                  </select>
                  <select
                    className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-[#4F81FF]/50 transition-all cursor-pointer"
                    value={selectedYearStart}
                    onChange={(e) => handleMonthlyStartChange(Number(e.target.value), selectedMonthStart)}
                  >
                    {[2024, 2025, 2026, 2027, 2028, 2029, 2030].map(y => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="px-2">
                <label className="block text-[10px] font-bold text-slate-400 mb-1.5 uppercase tracking-wider">เดือนสิ้นสุด</label>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-[#4F81FF]/50 transition-all cursor-pointer"
                    value={selectedMonthEnd}
                    onChange={(e) => handleMonthlyEndChange(selectedYearEnd, Number(e.target.value))}
                  >
                    {[
                      { v: 1, l: "มกราคม" }, { v: 2, l: "กุมภาพันธ์" }, { v: 3, l: "มีนาคม" },
                      { v: 4, l: "เมษายน" }, { v: 5, l: "พฤษภาคม" }, { v: 6, l: "มิถุนายน" },
                      { v: 7, l: "กรกฎาคม" }, { v: 8, l: "สิงหาคม" }, { v: 9, l: "กันยายน" },
                      { v: 10, l: "ตุลาคม" }, { v: 11, l: "พฤศจิกายน" }, { v: 12, l: "ธันวาคม" }
                    ].map(m => (
                      <option key={m.v} value={m.v}>{m.l}</option>
                    ))}
                  </select>
                  <select
                    className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-[#4F81FF]/50 transition-all cursor-pointer"
                    value={selectedYearEnd}
                    onChange={(e) => handleMonthlyEndChange(Number(e.target.value), selectedMonthEnd)}
                  >
                    {[2024, 2025, 2026, 2027, 2028, 2029, 2030].map(y => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
              </div>
            </>
          )}

          {filterMode === 'custom' && (
            <>
              <div className="px-2">
                <label className="block text-[10px] font-bold text-slate-400 mb-1.5 uppercase tracking-wider">แสดงตั้งแต่ (Start)</label>
                <input
                  type="date"
                  className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-[#4F81FF]/50 transition-all"
                  value={searchStartDate}
                  onChange={(e) => setSearchStartDate(e.target.value)}
                />
              </div>
              <div className="px-2">
                <label className="block text-[10px] font-bold text-slate-400 mb-1.5 uppercase tracking-wider">ถึงวันที่ (End)</label>
                <input
                  type="date"
                  className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-[#4F81FF]/50 transition-all"
                  value={searchEndDate}
                  onChange={(e) => setSearchEndDate(e.target.value)}
                />
              </div>
            </>
          )}

          <button
            onClick={fetchDashboardData}
            className="bg-[#4F81FF] hover:bg-[#3D6CE5] text-white px-5 py-2 rounded-xl text-sm font-bold transition-all shadow-md shadow-blue-500/20 active:scale-95 h-[38px] mb-0.5"
          >
            อัปเดตข้อมูล
          </button>
        </div>
      </section>

      {/* Stats Cards Section (ยังคงเดิมทั้งหมด) */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <div className="bg-emerald-500 rounded-3xl p-6 shadow-lg shadow-emerald-500/20 text-white relative overflow-hidden">
          <div className="relative z-10">
            <div className="text-emerald-100 font-medium text-sm mb-1">ห้องว่างช่วงที่เลือก</div>
            <div className="text-4xl font-extrabold">{loading ? '-' : stats.totalVacant} <span className="text-base font-medium opacity-80">ห้อง</span></div>
          </div>
          <div className="absolute -bottom-4 -right-4 opacity-20">
            <svg className="w-20 h-20 text-emerald-100" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 3v4M3 5h4M6 17v4M4 19h4M13 12l3 3-3 3M19 3l-3 3 3 3M11 5l1.5 1.5L11 8l-1.5-1.5L11 5z" />
            </svg>
          </div>
        </div>

        <div className="bg-white rounded-3xl p-6 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] border border-slate-50 flex items-center justify-between">
          <div>
            <div className="text-sm font-bold text-sky-500 mb-1">ว่าง: ครัวหน้า</div>
            <div className="text-3xl font-extrabold text-[#0A2647]">{loading ? '-' : stats.frontKitchen}</div>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-sky-50 text-sky-500 flex items-center justify-center">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          </div>
        </div>

        <div className="bg-white rounded-3xl p-6 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] border border-slate-50 flex items-center justify-between">
          <div>
            <div className="text-sm font-bold text-indigo-500 mb-1">ว่าง: ครัวหลัง</div>
            <div className="text-3xl font-extrabold text-[#0A2647]">{loading ? '-' : stats.backKitchen}</div>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-500 flex items-center justify-center">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4h12m0 0a2 2 0 100-4m0 4a2 2 0 110-4M6 14V6a2 2 0 012-2h8a2 2 0 012 2v8" />
            </svg>
          </div>
        </div>

        <div className="bg-white rounded-3xl p-6 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] border border-rose-100 flex flex-col justify-between relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-br from-rose-50 to-white opacity-50"></div>
          <div className="relative z-10 flex justify-between items-start mb-2">
            <div className="text-sm font-bold text-rose-500">Waitlist</div>
            <a href="/waitlists" className="bg-rose-100 text-rose-600 px-3 py-1 rounded-lg text-xs font-bold hover:bg-rose-500 hover:text-white transition-colors">
              จัดการคิว ➔
            </a>
          </div>
          <div className="relative z-10 text-3xl font-extrabold text-rose-600">
            {loading ? '-' : waitlistCount} <span className="text-sm font-medium opacity-70">คิว</span>
          </div>
        </div>
      </section>

      {/* Monthly Occupancy Rate Section (ยังคงเดิมทั้งหมด) */}
      <section className="bg-white border border-slate-100 rounded-[2rem] shadow-[0_8px_30px_-4px_rgba(0,0,0,0.04)] p-6">
        <h2 className="font-bold text-[#0A2647] text-lg mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <span className="flex items-center gap-2">
            <span className="p-1.5 bg-blue-50 rounded-lg text-[#4F81FF] flex items-center justify-center">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            </span>
            อัตราการเข้าพักและการจองรายเดือน
          </span>
          <span className="text-sm text-slate-500">Occupancy Rate + Booking Rate</span>
        </h2>
        {loading ? (
          <div className="flex justify-center py-6">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#4F81FF]"></div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex flex-wrap gap-4 mb-4">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-600">
                <span className="w-3 h-3 rounded-full bg-[#4F81FF]"></span> อัตราการเข้าพัก
              </div>
              <div className="flex items-center gap-2 text-sm font-bold text-slate-600">
                <span className="w-3 h-3 rounded-full bg-[#F59E0B]"></span> อัตราการจอง
              </div>
            </div>

            <div className="overflow-x-auto pb-2">
              <div className="min-w-[720px]">
                <svg width={Math.max(720, occupancyData.length * 120)} height={260} className="rounded-3xl bg-slate-50/80">
                  <defs>
                    <linearGradient id="occupancyGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                      <stop offset="0%" stopColor="#4F81FF" stopOpacity="0.25" />
                      <stop offset="100%" stopColor="#4F81FF" stopOpacity="0" />
                    </linearGradient>
                    <linearGradient id="bookingGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                      <stop offset="0%" stopColor="#F59E0B" stopOpacity="0.25" />
                      <stop offset="100%" stopColor="#F59E0B" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <g>
                    {[0, 20, 40, 60, 80, 100].map((gridValue) => {
                      const y = 220 - (gridValue / 100) * 160;
                      return (
                        <g key={gridValue}>
                          <line x1={40} y1={y} x2={Math.max(720, occupancyData.length * 120) - 20} y2={y} stroke="#CBD5E1" strokeWidth="1" strokeDasharray="4 4" />
                          <text x={10} y={y + 4} fill="#94A3B8" fontSize="10" fontWeight="600">{gridValue}%</text>
                        </g>
                      );
                    })}
                  </g>
                  <g>
                    {(() => {
                      const chartWidth = Math.max(720, occupancyData.length * 120);
                      const padding = 40;
                      const step = occupancyData.length > 1 ? (chartWidth - padding - 20) / (occupancyData.length - 1) : 0;
                      const lineHeight = 160;
                      const occupancyPoints = occupancyData.map((data, idx) => {
                        const x = padding + idx * step;
                        const y = 220 - (data.occupancyRate / 100) * lineHeight;
                        return `${x},${y}`;
                      }).join(' ');
                      const bookingPoints = occupancyData.map((data, idx) => {
                        const x = padding + idx * step;
                        const y = 220 - (data.bookingRate / 100) * lineHeight;
                        return `${x},${y}`;
                      }).join(' ');
                      return (
                        <>
                          <polyline points={occupancyPoints} fill="none" stroke="#4F81FF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                          <polyline points={bookingPoints} fill="none" stroke="#F59E0B" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                          {occupancyData.map((data, idx) => {
                            const x = padding + idx * step;
                            const occupancyY = 220 - (data.occupancyRate / 100) * lineHeight;
                            const bookingY = 220 - (data.bookingRate / 100) * lineHeight;
                            return (
                              <g key={idx}>
                                <circle cx={x} cy={occupancyY} r="5" fill="#4F81FF" stroke="#FFFFFF" strokeWidth="2" />
                                <circle cx={x} cy={bookingY} r="5" fill="#F59E0B" stroke="#FFFFFF" strokeWidth="2" />
                                <text x={x} y={240} fill="#334155" fontSize="11" textAnchor="middle">{data.monthLabel}</text>
                              </g>
                            );
                          })}
                        </>
                      );
                    })()}
                  </g>
                </svg>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Gantt Chart Section */}
      <section className="bg-white border border-slate-100 rounded-[2rem] shadow-[0_8px_30px_-4px_rgba(0,0,0,0.04)] overflow-hidden flex flex-col">

        {/* Room Filters Bar */}
        <div className="p-4 px-6 border-b border-slate-100 bg-slate-50/50 flex flex-wrap items-center gap-4 z-20">
          <span className="text-sm font-bold text-slate-500 flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"></path></svg>
            กรองห้องพัก:
          </span>
          <select value={filterBuilding} onChange={(e) => setFilterBuilding(e.target.value)} className="bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[#4F81FF]/50 min-w-[120px]">
            <option value="">ทุกตึก</option>
            {uniqueBuildings.map((b, i) => <option key={i} value={b}>{b}</option>)}
          </select>
          <select value={filterFloor} onChange={(e) => setFilterFloor(e.target.value)} className="bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[#4F81FF]/50 min-w-[100px]">
            <option value="">ทุกชั้น</option>
            {uniqueFloors.map((f, i) => <option key={i} value={String(f)}>ชั้น {f}</option>)}
          </select>
          <select value={filterRoomType} onChange={(e) => setFilterRoomType(e.target.value)} className="bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[#4F81FF]/50 min-w-[140px]">
            <option value="">ทุกประเภทห้อง</option>
            {uniqueRoomTypes.map((type, i) => <option key={i} value={type}>{type}</option>)}
          </select>
          <select value={filterKitchen} onChange={(e) => setFilterKitchen(e.target.value)} className="bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[#4F81FF]/50 min-w-[120px]">
            <option value="">ทุกประเภทครัว</option>
            {uniqueKitchens.map((k, i) => <option key={i} value={k}>{k}</option>)}
          </select>
          <select value={filterView} onChange={(e) => setFilterView(e.target.value)} className="bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[#4F81FF]/50 min-w-[120px]">
            <option value="">ทุกทิศ (View)</option>
            {uniqueViews.map((v, i) => <option key={i} value={v}>{v}</option>)}
          </select>
          <select value={filterGap} onChange={(e) => setFilterGap(e.target.value)} className="bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[#4F81FF]/50 min-w-[140px]">
            <option value="">ทุกช่องว่าง</option>
            <option value="shortGap">ช่องว่าง &lt; 1 ปี</option>
          </select>
          <select value={filterRenewal} onChange={(e) => setFilterRenewal(e.target.value)} className="bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[#4F81FF]/50 min-w-[160px]">
            <option value="">ทุกความประสงค์</option>
            <option value="renew">ต่อสัญญาห้องเดิม</option>
            <option value="renew_no_room">แต่สัญญาไม่ระบุห้อง</option>
            <option value="not_renew">ไม่ต่อสัญญา</option>
            <option value="not_asked">ยังไม่ได้สอบถาม</option>
            <option value="pending">รอตอบกลับ</option>
          </select>
          <span className="text-xs text-slate-400 font-medium ml-auto">พบ {displayedRooms.length} ห้อง</span>
        </div>

        {/* Toolbar (Zoom & Legend) */}
        <div className="p-4 px-6 border-b border-slate-100 bg-white flex flex-wrap gap-4 justify-between items-center z-20">
          <div className="flex items-center gap-6">
            <h2 className="font-bold text-[#0A2647] text-lg flex items-center gap-2">
              <span className="p-1.5 bg-indigo-50 rounded-lg text-indigo-500 flex items-center justify-center">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h7" />
                </svg>
              </span>
              ผังตารางห้องพัก
            </h2>

            <div className="flex items-center gap-3 bg-slate-50 px-4 py-2 rounded-xl border border-slate-100">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">ซูม</span>
              <button onClick={() => setDayWidth(Math.max(3, dayWidth - 5))} className="text-slate-400 hover:text-[#4F81FF] font-bold w-5 h-5 flex items-center justify-center rounded-md hover:bg-white transition-colors">-</button>
              <input
                type="range" min="3" max="40" value={dayWidth}
                onChange={(e) => setDayWidth(Number(e.target.value))}
                className="w-24 h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-[#4F81FF]"
              />
              <button onClick={() => setDayWidth(Math.min(40, dayWidth + 5))} className="text-slate-400 hover:text-[#4F81FF] font-bold w-5 h-5 flex items-center justify-center rounded-md hover:bg-white transition-colors">+</button>
            </div>
          </div>

          <div className="flex gap-4 text-xs font-bold text-slate-500 bg-slate-50 px-5 py-2.5 rounded-xl border border-slate-100">
            <div className="flex items-center gap-2"><span className="w-3 h-3 bg-gradient-to-r from-amber-400 to-orange-500 rounded-md shadow-sm"></span> ห้องชั่วคราว</div>
            <div className="flex items-center gap-2"><span className="w-3 h-3 bg-gradient-to-r from-[#4F81FF] to-[#3D6CE5] rounded-md shadow-sm"></span> ห้องหลัก</div>
            <div className="flex items-center gap-2"><span className="w-3 h-3 bg-gradient-to-r from-purple-500 to-indigo-500 rounded-md shadow-sm"></span> ห้องย้าย</div>
            <div className="flex items-center gap-2"><span className="w-3 h-3 bg-slate-200 border border-slate-300 rounded-md flex items-center justify-center overflow-hidden"><div className="w-full h-px bg-red-400 transform -rotate-45"></div></span> ยกเลิกสัญญา</div>
          </div>
        </div>

        {/* Chart Body 🌟 เพิ่ม onScroll เพื่อเก็บ state เตรียมทำ Windowing */}
        <div
          ref={scrollContainerRef}
          className="overflow-auto max-h-[100vh] relative select-none custom-scrollbar bg-[#F8FAFC]"
          style={{ cursor: 'grab' }}
          onMouseDown={handleMouseDown}
          onMouseLeave={handleMouseLeaveOrUp}
          onMouseUp={handleMouseLeaveOrUp}
          onMouseMove={handleMouseMove}
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        >
          <div style={{ width: `${110 + totalDays * dayWidth}px` }} className="flex relative min-w-full">

            {/* Sidebar Room Numbers */}
            <div className="w-[110px] shrink-0 sticky left-0 z-30 bg-white border-r border-slate-200 shadow-[4px_0_15px_-5px_rgba(0,0,0,0.05)]">
              <div className={`sticky top-0 z-40 border-b border-slate-200 bg-slate-50 flex items-center justify-center text-[10px] font-bold text-slate-400 uppercase tracking-widest ${showDayDetails ? 'h-[48px]' : 'h-[32px]'}`}>
                เลขห้อง
              </div>
              
              {/* 🌟 ประยุกต์ใช้ Virtual Scroll ปรับความสูงรวมและดันบรรทัดที่ไม่แสดงออก */}
              <div className="divide-y divide-slate-100 bg-white relative" style={{ height: displayedRooms.length * rowHeight }}>
                {startIndex > 0 && <div style={{ height: startIndex * rowHeight }} />}
                {visibleRooms.map(room => (
                  <div key={room.id} className="h-12 flex items-center justify-center font-bold text-sm text-[#0A2647] hover:bg-blue-50/50 transition-colors bg-white">
                    {room.room_number}
                  </div>
                ))}
              </div>
            </div>

            {/* Scrollable Timeline */}
            <div className="flex-1 relative">
              <div className="sticky top-0 z-30 shadow-sm">
                <div className={`flex bg-slate-100/95 backdrop-blur-md border-b border-slate-200 ${showDayDetails ? 'h-6' : 'h-[32px]'}`}>
                  {timelineMonths.map((m, idx) => (
                    <div key={idx} style={{ width: `${m.days * dayWidth}px` }} className="border-r border-slate-200 text-[10px] font-bold text-slate-500 flex items-center px-2 shrink-0 overflow-hidden">
                      {dayWidth < 5 ? m.label.split(' ')[0] : m.label}
                    </div>
                  ))}
                </div>

                {showDayDetails && (
                  <div className="flex h-6 bg-white/95 backdrop-blur-md border-b border-slate-200">
                    {daysArray.map((dayNum, idx) => (
                      <div key={idx} style={{ width: `${dayWidth}px` }} className="border-r border-slate-100 text-[9px] font-medium flex items-center justify-center shrink-0 text-slate-400">
                        {dayNum}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {showTodayLine && (
                <div style={{ left: `${todayOffset * dayWidth}px` }} className="absolute top-0 bottom-0 w-[2px] bg-rose-500 z-10 shadow-[0_0_10px_rgba(244,63,94,0.6)] pointer-events-none flex justify-center">
                  <div className="w-4 h-4 bg-rose-500 text-white text-[8px] font-bold rounded-full flex items-center justify-center mt-[10px]">วันนี้</div>
                </div>
              )}

              {/* Rooms Rows 🌟 ใช้ Virtual Scroll ในฝั่ง Timeline เช่นกัน */}
              <div className="divide-y divide-slate-100/60 relative" style={{ height: displayedRooms.length * rowHeight }}>
                {startIndex > 0 && <div style={{ height: startIndex * rowHeight }} />}
                {visibleRooms.map(room => {
                  const roomBlocks = getBlocksForRoom(room.id);
                  return (
                    <div key={room.id} className="h-12 relative group w-full hover:bg-white/50 overflow-hidden transition-colors">
                      {roomBlocks.map((block, idx) => {
                        const offsetDays = getDaysDiff(startDate, block.start);
                        const durationDays = getDaysDiff(block.start, block.end) + 1;

                        const leftPx = offsetDays * dayWidth;
                        const widthPx = durationDays * dayWidth;

                        if (block.end < startDate || block.start > endDate) return null;

                        return (
                          /* 🌟 เพิ่ม overflow-hidden ที่ปุ่ม และแก้ไข truncate */
                          <button
                            key={idx}
                            type="button"
                            onClick={() => setSelectedBlockForDetail(block)}
                            style={{ left: `${leftPx}px`, width: `${widthPx}px` }}
                            className={`absolute top-2 bottom-2 overflow-hidden rounded-md shadow-md text-xs text-white flex items-center px-2 cursor-pointer transition-all duration-200 hover:scale-[1.02] hover:brightness-110 hover:z-30 hover:shadow-lg border border-white/30
                            ${block.type === 'TEMP' ? 'bg-gradient-to-r from-orange-400 to-orange-500' : 
                              block.type === 'MOVE' ? 'bg-gradient-to-r from-purple-500 to-purple-600' : 
                              'bg-gradient-to-r from-blue-500 to-blue-600'}
                          `}
                            title={`คลิกเพื่อดูรายละเอียดคุณ ${block.name} ${block.isCancelled ? '(ยกเลิก)' : ''} | เข้า: ${block.start.toLocaleDateString('th-TH')} | ออก: ${block.end.toLocaleDateString('th-TH')}`}
                          >
                            {widthPx > 35 && <span className="truncate w-full text-left drop-shadow-sm pointer-events-none">{block.name}</span>}
                          </button>
                        );
                      })}

                      {showDayDetails && (
                        <div className="absolute inset-0 flex pointer-events-none opacity-40">
                          {daysArray.map((_, idx) => (
                            <div key={idx} style={{ width: `${dayWidth}px` }} className={`border-r h-full ${idx % 7 === 0 ? 'border-slate-300/50' : 'border-slate-200/30'}`}></div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                {displayedRooms.length === 0 && (
                  <div className="p-10 text-center text-slate-400 font-medium bg-slate-50/50">
                    ไม่พบห้องพักที่ตรงกับตัวกรองที่คุณเลือก
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Tenant & Contract Details Modal ─── (ยังคงเดิมทั้งหมด) */}
      {selectedBlockForDetail && (() => {
        const c = selectedBlockForDetail.contract;

        const formatDateTH = (dateStr?: string | Date) => {
          if (!dateStr) return null;
          const date = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
          if (date.getTime() === new Date('2000-01-01').getTime() || date.getTime() === new Date('2099-12-31').getTime()) return null;
          return date.toLocaleDateString('th-TH', {
            day: 'numeric',
            month: 'short',
            year: '2-digit'
          });
        };

        const getRoomNumber = (roomId?: string) => {
          if (!roomId) return null;
          const room = rooms.find(r => r.id === roomId);
          return room ? room.room_number : null;
        };

        const getStatusBadge = (status: string) => {
          switch (status) {
            case 'active':
              return <span className="px-3 py-1.5 rounded-lg text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200/60">ACTIVE</span>;
            case 'completed':
              return <span className="px-3 py-1.5 rounded-lg text-[10px] font-bold bg-slate-50 text-slate-500 border border-slate-200/60">COMPLETED</span>;
            case 'upcoming':
              return <span className="px-3 py-1.5 rounded-lg text-[10px] font-bold bg-sky-50 text-sky-700 border border-sky-200/60">UPCOMING</span>;
            case 'cancelled':
              return <span className="px-3 py-1.5 rounded-lg text-[10px] font-bold bg-red-50 text-red-600 border border-red-200/60">CANCELLED</span>;
            default:
              return <span className="px-3 py-1.5 rounded-lg text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200/60">{status.toUpperCase()}</span>;
          }
        };

        return (
          <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
            <div className="bg-white rounded-[2rem] w-full max-w-md overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
              {/* Modal Header */}
              <div className="px-8 py-6 border-b border-slate-100 flex justify-between items-center shrink-0">
                <div>
                  <h2 className="text-xl font-bold text-[#0A2647]">ข้อมูลผู้เช่าและสัญญา</h2>
                  <p className="text-sm text-slate-500 mt-0.5">ข้อมูลการเช่าและการจัดสรรห้องพัก</p>
                </div>
                <button
                  onClick={() => setSelectedBlockForDetail(null)}
                  className="text-slate-400 hover:text-slate-600 bg-slate-50 hover:bg-slate-100 w-8 h-8 rounded-full flex items-center justify-center transition-colors"
                >
                  ✕
                </button>
              </div>

              {/* Modal Body */}
              <div className="p-8 space-y-6 overflow-y-auto">
                {/* Visual Header */}
                <div className="flex items-center gap-5 bg-slate-50 border border-slate-100 rounded-3xl p-5">
                  <div className="w-16 h-16 bg-[#4F81FF] text-white rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/20">
                    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-xl font-bold text-[#0A2647] truncate" title={c.tenant_name}>คุณ {c.tenant_name}</h3>
                    <div className="mt-1.5 flex items-center gap-2">
                      {getStatusBadge(c.status)}
                    </div>
                  </div>
                </div>

                {/* Contract Meta Info */}
                <div className="space-y-4">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">รายละเอียดสัญญา</p>

                  <div className="grid grid-cols-1 gap-3">
                    {/* ระยะเวลาสัญญาหลัก */}
                    <div className="flex items-center justify-between p-3.5 bg-slate-50/50 border border-slate-100 rounded-2xl">
                      <div className="flex items-center gap-2.5">
                        <span className="flex items-center justify-center text-slate-500">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                        </span>
                        <span className="text-xs font-semibold text-slate-500">ระยะเวลาสัญญาหลัก</span>
                      </div>
                      <span className="text-xs font-bold text-slate-800">
                        {formatDateTH(c.contract_start_date) || '-'} - {formatDateTH(c.contract_end_date) || '-'}
                      </span>
                    </div>

                    {/* วันที่เช็คอินจริง */}
                    <div className="flex items-center justify-between p-3.5 bg-slate-50/50 border border-slate-100 rounded-2xl">
                      <div className="flex items-center gap-2.5">
                        <span className="flex items-center justify-center text-slate-500">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 7a3 3 0 11-6 0 3 3 0 016 0zm0 0v7a3 3 0 01-3 3H9v-2h2v-2H9v-2h6z" />
                          </svg>
                        </span>
                        <span className="text-xs font-semibold text-slate-500">วันเช็คอินจริง</span>
                      </div>
                      <span className="text-xs font-bold text-slate-800">
                        {formatDateTH(c.actual_check_in_date) || '-'}
                      </span>
                    </div>

                    {/* ค่าเช่ารายเดือน */}
                    <div className="flex items-center justify-between p-3.5 bg-slate-50/50 border border-slate-100 rounded-2xl">
                      <div className="flex items-center gap-2.5">
                        <span className="flex items-center justify-center text-slate-500">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </span>
                        <span className="text-xs font-semibold text-slate-500">ค่าเช่ารายเดือน</span>
                      </div>
                      <span className="text-xs font-extrabold text-indigo-600 bg-indigo-50 border border-indigo-100 px-2.5 py-1 rounded-xl">
                        {c.monthly_rent != null ? `${Number(c.monthly_rent).toLocaleString('th-TH')} บาท` : '-'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Renewal Status */}
                <div className="pt-2">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">สถานะการต่อสัญญา</p>
                  <div className="mt-2">
                    {modalRenewalIntent === null ? (
                      <span className="text-xs text-slate-500">ไม่มีข้อมูลการต่อสัญญา</span>
                    ) : modalRenewalIntent === 'pending' ? (
                      <span className="px-3 py-1.5 rounded-lg text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200/60">รอดำเนินการ</span>
                    ) : modalRenewalIntent === 'not_asked' ? (
                      <span className="px-3 py-1.5 rounded-lg text-[10px] font-bold bg-slate-50 text-slate-500 border border-slate-200/60">ยังไม่ได้สอบถาม</span>
                    ) : modalRenewalIntent === 'renew' ? (
                      <span className="px-3 py-1.5 rounded-lg text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200/60">ต่อสัญญาห้องเดิม</span>
                    ) : modalRenewalIntent === 'renew_no_room' ? (
                      <span className="px-3 py-1.5 rounded-lg text-[10px] font-bold bg-sky-50 text-sky-700 border border-sky-200/60">ต่อสัญญาไม่ระบุห้อง</span>
                    ) : modalRenewalIntent === 'not_renew' ? (
                      <span className="px-3 py-1.5 rounded-lg text-[10px] font-bold bg-red-50 text-red-600 border border-red-200/60">ไม่ต้องการต่อ</span>
                    ) : (
                      <span className="text-xs text-slate-500">{modalRenewalIntent}</span>
                    )}
                  </div>
                </div>

                {/* Allocated Rooms Breakdown */}
                <div className="pt-4 border-t border-slate-100 space-y-3.5">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">ห้องพักที่จัดสรรในสัญญานี้</p>

                  <div className="flex flex-row flex-nowrap gap-3 overflow-x-auto pb-1 scrollbar-hide min-w-0">
                    {/* ห้องพักชั่วคราว */}
                    {c.temp_room_id && (
                      <div className="shrink-0 w-[140px] rounded-xl border border-amber-200/70 bg-amber-50 p-3 min-h-[90px] flex flex-col justify-between">
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-wider text-amber-700 mb-0.5">ห้องพักชั่วคราว</div>
                          <div className="font-bold text-slate-900 text-sm">ห้อง {getRoomNumber(c.temp_room_id) || '-'}</div>
                        </div>
                        <div className="text-[10px] text-slate-600 mt-2 truncate">
                          {formatDateTH(c.temp_start_date) || '-'} - {formatDateTH(c.temp_end_date) || '-'}
                        </div>
                      </div>
                    )}

                    {/* ห้องพักหลัก */}
                    <div className="shrink-0 w-[140px] rounded-xl border border-slate-200 bg-slate-50 p-3 min-h-[90px] flex flex-col justify-between">
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-0.5">ห้องพักหลัก</div>
                        <div className="font-bold text-slate-900 text-sm truncate">
                          {c.main_room_id ? `ห้อง ${getRoomNumber(c.main_room_id)}` : 'ยังไม่ระบุห้อง'}
                        </div>
                      </div>
                      <div className="text-[10px] text-slate-600 mt-2 truncate">
                        {formatDateTH(c.main_start_date) || '-'} - {formatDateTH(c.main_end_date) || '-'}
                      </div>
                    </div>

                    {/* ย้ายห้องไปที่ */}
                    {c.move_to_room_id && (
                      <div className="shrink-0 w-[140px] rounded-xl border border-sky-200 bg-sky-50 p-3 min-h-[90px] flex flex-col justify-between">
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-wider text-sky-700 mb-0.5">ย้ายห้องไปที่</div>
                          <div className="font-bold text-slate-900 text-sm">ห้อง {getRoomNumber(c.move_to_room_id) || '-'}</div>
                        </div>
                        <div className="text-[10px] text-slate-600 mt-2 truncate">
                          {formatDateTH(c.move_start_date) || '-'} - {formatDateTH(c.move_end_date) || '-'}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="px-8 py-5 border-t border-slate-100 bg-slate-50 flex gap-3 shrink-0">
                <button
                  type="button"
                  onClick={() => setSelectedBlockForDetail(null)}
                  className="w-full px-6 py-3.5 text-sm font-bold text-slate-600 bg-white border-2 border-slate-200 rounded-2xl hover:bg-slate-50 hover:border-slate-300 transition-all text-center"
                >
                  ปิดหน้าต่าง
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}