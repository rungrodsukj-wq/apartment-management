'use client';

import { useState, useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// 🌟 อัปเดต Interface ให้มีฟิลด์สำหรับ Filter
interface Room { 
  id: string; 
  room_number: string; 
  kitchen_type: string; 
  building?: string; 
  floor?: number | string; 
  view_direction?: string; 
}

interface Contract { 
  id: string; 
  tenant_name: string; 
  status: string; 
  actual_end_date?: string; 
  main_room_id: string; 
  main_start_date: string; 
  main_end_date: string; 
  temp_room_id?: string; 
  temp_start_date?: string; 
  temp_end_date?: string; 
  move_to_room_id?: string; 
  move_start_date?: string; 
  move_end_date?: string; 
}
interface Block { 
  type: 'MAIN' | 'TEMP' | 'MOVE'; 
  name: string; 
  start: Date; 
  end: Date; 
  isCancelled?: boolean; 
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

  // 🌟 State สำหรับตัวกรอง
  const [filterBuilding, setFilterBuilding] = useState('');
  const [filterFloor, setFilterFloor] = useState('');
  const [filterKitchen, setFilterKitchen] = useState('');
  const [filterView, setFilterView] = useState('');

  const [dayWidth, setDayWidth] = useState(3);

  const defaultStart = new Date(); defaultStart.setMonth(defaultStart.getMonth() - 1);
  const defaultEnd = new Date(); defaultEnd.setMonth(defaultEnd.getMonth() + 11);

  const [searchStartDate, setSearchStartDate] = useState(defaultStart.toISOString().split('T')[0]);
  const [searchEndDate, setSearchEndDate] = useState(defaultEnd.toISOString().split('T')[0]);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const startX = useRef(0);
  const scrollLeft = useRef(0);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      if (e.shiftKey) {
        e.preventDefault();
        el.scrollLeft += (e.deltaX || e.deltaY);
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
    fetchDashboardData();
  }, []);

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

    const occupiedRoomIds = new Set<string>();
    contractsData?.forEach(c => {
      const isCancelled = c.status === 'cancelled';
      const actualEnd = isCancelled && c.actual_end_date ? c.actual_end_date : null;

      const mainEnd = actualEnd || c.main_end_date;
      const tempEnd = actualEnd || c.temp_end_date;
      const moveEnd = actualEnd || c.move_end_date;

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

  // 🌟 ประมวลผลข้อมูลสำหรับ Dropdown อัตโนมัติจากห้องที่มี
  const uniqueBuildings = Array.from(new Set(rooms.map(r => r.building).filter(Boolean)));
  const uniqueFloors = Array.from(new Set(rooms.map(r => r.floor).filter(Boolean))).sort((a, b) => Number(a) - Number(b));
  const uniqueKitchens = Array.from(new Set(rooms.map(r => r.kitchen_type).filter(Boolean)));
  const uniqueViews = Array.from(new Set(rooms.map(r => r.view_direction).filter(Boolean)));

  // 🌟 ฟิลเตอร์ห้องตาม State ที่ผู้ใช้เลือก
  const filteredRooms = rooms.filter(room => {
    const matchBuilding = filterBuilding === '' || room.building === filterBuilding;
    const matchFloor = filterFloor === '' || String(room.floor || '') === filterFloor;
    const matchKitchen = filterKitchen === '' || room.kitchen_type === filterKitchen;
    const matchView = filterView === '' || room.view_direction === filterView;
    return matchBuilding && matchFloor && matchKitchen && matchView;
  });

  const startDate = new Date(searchStartDate);
  const endDate = new Date(searchEndDate);
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
      const actualEnd = c.actual_end_date ? new Date(c.actual_end_date) : null;

      if (c.main_room_id === roomId && c.main_start_date && c.main_end_date) {
        const start = new Date(c.main_start_date);
        const defaultEnd = new Date(c.main_end_date);
        const end = (isCancelled && actualEnd) ? actualEnd : defaultEnd;
        if (start <= end) blocks.push({ type: 'MAIN', name: c.tenant_name, start, end, isCancelled });
      }
      
      if (c.temp_room_id === roomId && c.temp_start_date && c.temp_end_date) {
        const start = new Date(c.temp_start_date);
        const defaultEnd = new Date(c.temp_end_date);
        const end = (isCancelled && actualEnd) ? actualEnd : defaultEnd;
        if (start <= end) blocks.push({ type: 'TEMP', name: c.tenant_name, start, end, isCancelled });
      }
      
      if (c.move_to_room_id === roomId && c.move_start_date && c.move_end_date) {
        const start = new Date(c.move_start_date);
        const defaultEnd = new Date(c.move_end_date);
        const end = (isCancelled && actualEnd) ? actualEnd : defaultEnd;
        if (start <= end) blocks.push({ type: 'MOVE', name: c.tenant_name, start, end, isCancelled });
      }
    });
    return blocks;
  };

  const todayOffset = getDaysDiff(startDate, new Date());
  const showTodayLine = todayOffset >= 0 && todayOffset <= totalDays;
  const showDayDetails = dayWidth >= 15;

  return (
    <div className="flex-1 p-8 md:p-10 max-w-[1600px] mx-auto w-full space-y-8">
      {/* Header & Filters Section */}
      <section className="flex flex-col xl:flex-row xl:justify-between xl:items-end gap-6">
        <div>
          <h1 className="text-[28px] font-bold text-[#0A2647] tracking-tight">แผงควบคุมระบบ</h1>
          <p className="text-sm text-slate-500 mt-1">สรุปภาพรวมและผังการใช้ห้องพัก (Gantt Chart)</p>
        </div>
        <div className="bg-white p-2.5 rounded-2xl border border-slate-100 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] flex flex-wrap items-end gap-3">
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
          <button 
            onClick={fetchDashboardData} 
            className="bg-[#4F81FF] hover:bg-[#3D6CE5] text-white px-5 py-2 rounded-xl text-sm font-bold transition-all shadow-md shadow-blue-500/20 active:scale-95 h-[38px] mb-0.5"
          >
            อัปเดตข้อมูล
          </button>
        </div>
      </section>

      {/* Stats Cards Section */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <div className="bg-emerald-500 rounded-3xl p-6 shadow-lg shadow-emerald-500/20 text-white relative overflow-hidden">
          <div className="relative z-10">
            <div className="text-emerald-100 font-medium text-sm mb-1">ห้องว่างช่วงที่เลือก</div>
            <div className="text-4xl font-extrabold">{loading ? '-' : stats.totalVacant} <span className="text-base font-medium opacity-80">ห้อง</span></div>
          </div>
          <div className="absolute -bottom-4 -right-4 text-7xl opacity-20">✨</div>
        </div>
        
        <div className="bg-white rounded-3xl p-6 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] border border-slate-50 flex items-center justify-between">
          <div>
            <div className="text-sm font-bold text-sky-500 mb-1">ว่าง: ครัวหน้า</div>
            <div className="text-3xl font-extrabold text-[#0A2647]">{loading ? '-' : stats.frontKitchen}</div>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-sky-50 text-sky-500 flex items-center justify-center text-xl">🍳</div>
        </div>

        <div className="bg-white rounded-3xl p-6 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] border border-slate-50 flex items-center justify-between">
          <div>
            <div className="text-sm font-bold text-indigo-500 mb-1">ว่าง: ครัวหลัง</div>
            <div className="text-3xl font-extrabold text-[#0A2647]">{loading ? '-' : stats.backKitchen}</div>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-500 flex items-center justify-center text-xl">🔪</div>
        </div>

        <div className="bg-white rounded-3xl p-6 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] border border-rose-100 flex flex-col justify-between relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-br from-rose-50 to-white opacity-50"></div>
          <div className="relative z-10 flex justify-between items-start mb-2">
            <div className="text-sm font-bold text-rose-500">รอดำเนินการ (Waitlist)</div>
            <a href="/allocate" className="bg-rose-100 text-rose-600 px-3 py-1 rounded-lg text-xs font-bold hover:bg-rose-500 hover:text-white transition-colors">
              จัดการคิว ➔
            </a>
          </div>
          <div className="relative z-10 text-3xl font-extrabold text-rose-600">
            {loading ? '-' : waitlistCount} <span className="text-sm font-medium opacity-70">คิว</span>
          </div>
        </div>
      </section>

      {/* Gantt Chart Section */}
      <section className="bg-white border border-slate-100 rounded-[2rem] shadow-[0_8px_30px_-4px_rgba(0,0,0,0.04)] overflow-hidden flex flex-col">
        
        {/* 🌟 Room Filters Bar */}
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
          <select value={filterKitchen} onChange={(e) => setFilterKitchen(e.target.value)} className="bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[#4F81FF]/50 min-w-[120px]">
            <option value="">ทุกประเภทครัว</option>
            {uniqueKitchens.map((k, i) => <option key={i} value={k}>{k}</option>)}
          </select>
          <select value={filterView} onChange={(e) => setFilterView(e.target.value)} className="bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[#4F81FF]/50 min-w-[120px]">
            <option value="">ทุกทิศ (View)</option>
            {uniqueViews.map((v, i) => <option key={i} value={v}>{v}</option>)}
          </select>
          <span className="text-xs text-slate-400 font-medium ml-auto">พบ {filteredRooms.length} ห้อง</span>
        </div>

        {/* Toolbar (Zoom & Legend) */}
        <div className="p-4 px-6 border-b border-slate-100 bg-white flex flex-wrap gap-4 justify-between items-center z-20">
          <div className="flex items-center gap-6">
            <h2 className="font-bold text-[#0A2647] text-lg flex items-center gap-2">
              <span className="p-1.5 bg-indigo-50 rounded-lg text-indigo-500">📊</span> ผังตารางห้องพัก
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

        {/* Chart Body */}
        <div 
          ref={scrollContainerRef} 
          className="overflow-auto max-h-[65vh] relative select-none custom-scrollbar bg-[#F8FAFC]"
          style={{ cursor: 'grab' }}
          onMouseDown={handleMouseDown}
          onMouseLeave={handleMouseLeaveOrUp}
          onMouseUp={handleMouseLeaveOrUp}
          onMouseMove={handleMouseMove}
        >
          <div style={{ width: `${110 + totalDays * dayWidth}px` }} className="flex relative min-w-full">
            
            {/* Sidebar Room Numbers */}
            <div className="w-[110px] shrink-0 sticky left-0 z-30 bg-white border-r border-slate-200 shadow-[4px_0_15px_-5px_rgba(0,0,0,0.05)]">
              <div className={`sticky top-0 z-40 border-b border-slate-200 bg-slate-50 flex items-center justify-center text-[10px] font-bold text-slate-400 uppercase tracking-widest ${showDayDetails ? 'h-[48px]' : 'h-[32px]'}`}>
                เลขห้อง
              </div>
              <div className="divide-y divide-slate-100 bg-white">
                {/* 🌟 เปลี่ยนมา map จาก filteredRooms */}
                {filteredRooms.map(room => (
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

              {/* Rooms Rows */}
              <div className="divide-y divide-slate-100/60 relative">
                {/* 🌟 เปลี่ยนมา map จาก filteredRooms */}
                {filteredRooms.map(room => {
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
                          <div 
                            key={idx}
                            style={{ left: `${leftPx}px`, width: `${widthPx}px` }}
                            className={`absolute top-1.5 bottom-1.5 rounded-lg shadow-sm text-[10px] font-medium text-white flex items-center px-2.5 cursor-pointer transition-all hover:brightness-110 hover:shadow-md hover:z-20 border border-white/10
                              ${block.isCancelled
                                  ? 'bg-slate-200 !text-slate-500 line-through decoration-red-400/80 decoration-2 border-slate-300 border-dashed' 
                                  : block.type === 'TEMP' 
                                      ? 'bg-gradient-to-r from-amber-400 to-orange-500' 
                                      : block.type === 'MOVE' 
                                          ? 'bg-gradient-to-r from-purple-500 to-indigo-500' 
                                          : 'bg-gradient-to-r from-[#4F81FF] to-[#3D6CE5]'
                              }
                            `}
                            title={`คุณ ${block.name} ${block.isCancelled ? '(ยกเลิก)' : ''} | เข้า: ${block.start.toLocaleDateString('th-TH')} | ออก: ${block.end.toLocaleDateString('th-TH')}`}
                          >
                            {widthPx > 35 && <span className="truncate w-full drop-shadow-sm">{block.name}</span>}
                          </div>
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
                {/* 🌟 กรณีค้นหาแล้วไม่เจอ */}
                {filteredRooms.length === 0 && (
                  <div className="p-10 text-center text-slate-400 font-medium bg-slate-50/50">
                    ไม่พบห้องพักที่ตรงกับตัวกรองที่คุณเลือก
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}