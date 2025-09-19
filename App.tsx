import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Teacher, Shift } from './types';
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon, TrashIcon, XMarkIcon, StarIconOutline, StarIconSolid, ArrowDownTrayIcon, NoSymbolIcon, Bars3Icon, MagnifyingGlassIcon, LinkIcon } from './components/icons';

// Allow using pako from the script tag in index.html
declare const pako: any;

// Define the structure of the state we want to share/save
interface ShareableState {
    teachers: Teacher[];
    scheduleStartDate: string;
    manualChanges: Record<string, string>;
    dateColors: Record<string, string>;
}

// --- Data Compression & Encoding Helpers ---

// Converts a Uint8Array (from pako) to a Base64 string for the URL
function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

// Converts a Base64 string from the URL back to a Uint8Array for pako
function base64ToUint8Array(base64: string): Uint8Array {
  const binary_string = window.atob(base64);
  const len = binary_string.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes;
}

// --- State Loading Logic ---

// Tries to load and decode state from the URL hash
const loadStateFromUrl = (): ShareableState | null => {
    try {
        const hash = window.location.hash;
        if (hash.startsWith('#data=')) {
            const base64Data = hash.substring(6);
            const compressedData = base64ToUint8Array(base64Data);
            const jsonString = pako.inflate(compressedData, { to: 'string' });
            // Clear the hash after loading to prevent re-sharing old state
            window.history.replaceState(null, '', ' ');
            return JSON.parse(jsonString);
        }
    } catch (error) {
        console.error("Failed to load state from URL:", error);
        window.history.replaceState(null, '', ' '); // Also clear hash if it's corrupted
    }
    return null;
};

// Tries to load state from localStorage
const loadStateFromLocalStorage = (): Partial<ShareableState> => {
    try {
        const savedState = localStorage.getItem('teacherDutyRoster_appState');
        return savedState ? JSON.parse(savedState) : {};
    } catch (error) {
        console.error("Could not load state from localStorage", error);
        return {};
    }
};


const initialTeachersData = [
    { id: '1', name: 'Nguyễn Văn A' },
    { id: '2', name: 'Trần Thị B' },
    { id: '3', name: 'Lê Văn C' },
    { id: '4', name: 'Phạm Thị D' },
    { id: '5', name: 'Hoàng Văn E' },
    { id: '6', name: 'Vũ Thị F' },
];

const initialTeachers: Teacher[] = initialTeachersData.map((teacher) => ({
    ...teacher,
}));

// Helper to determine text color (black/white) based on background hex color
const getTextColorForBg = (hexColor: string | undefined): string => {
    if (!hexColor || hexColor.length < 7) return 'text-gray-900';
    try {
        const r = parseInt(hexColor.substr(1, 2), 16);
        const g = parseInt(hexColor.substr(3, 2), 16);
        const b = parseInt(hexColor.substr(5, 2), 16);
        const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
        return (yiq >= 128) ? 'text-black' : 'text-white';
    } catch (e) {
        return 'text-gray-900';
    }
};


// Helper function to get all dates in a month
const getDatesInMonth = (year: number, month: number): Date[] => {
    const date = new Date(year, month, 1);
    const dates: Date[] = [];
    while (date.getMonth() === month) {
        dates.push(new Date(date));
        date.setDate(date.getDate() + 1);
    }
    return dates;
};

// Helper to format date to 'YYYY-MM-DD' without timezone issues
const formatDate = (date: Date): string => {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const App: React.FC = () => {
    // --- State Initialization with Priority: URL > LocalStorage > Defaults ---
    const initialUrlState = useMemo(() => loadStateFromUrl(), []);
    const initialStorageState = useMemo(() => loadStateFromLocalStorage(), []);

    const [teachers, setTeachers] = useState<Teacher[]>(() => 
        initialUrlState?.teachers ?? initialStorageState?.teachers ?? initialTeachers
    );
    const [scheduleStartDate, setScheduleStartDate] = useState(() => 
        initialUrlState?.scheduleStartDate ?? initialStorageState?.scheduleStartDate ?? formatDate(new Date())
    );
    const [manualChanges, setManualChanges] = useState<Record<string, string>>(() => 
        initialUrlState?.manualChanges ?? initialStorageState?.manualChanges ?? {}
    );
    const [dateColors, setDateColors] = useState<Record<string, string>>(() => 
        initialUrlState?.dateColors ?? initialStorageState?.dateColors ?? {}
    );
    
    // --- UI State ---
    const [shifts, setShifts] = useState<Shift[]>([]);
    const [currentDate, setCurrentDate] = useState(new Date());
    const [newTeacherName, setNewTeacherName] = useState('');
    const [activeColorPicker, setActiveColorPicker] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const dragTeacherId = useRef<string | null>(null);
    const dragOverTeacherId = useRef<string | null>(null);

    // --- Effects ---

    // Save all relevant state to localStorage on any change
    useEffect(() => {
        try {
            const appState: ShareableState = {
                teachers,
                scheduleStartDate,
                manualChanges,
                dateColors,
            };
            localStorage.setItem('teacherDutyRoster_appState', JSON.stringify(appState));
        } catch (error) {
            console.error("Could not save app state to localStorage", error);
        }
    }, [teachers, scheduleStartDate, manualChanges, dateColors]);


    // Regenerate the schedule when data changes
    useEffect(() => {
        if (teachers.length === 0) {
            const monthDates = getDatesInMonth(currentDate.getFullYear(), currentDate.getMonth());
            setShifts(monthDates.map(d => ({ date: formatDate(d), teacherId: null })));
            return;
        }

        const generateSchedule = () => {
            // FIX: Parse date string as local time to avoid timezone issues.
            // new Date('YYYY-MM-DD') can be interpreted as UTC midnight, causing off-by-one errors.
            const [startYear, startMonth, startDay] = scheduleStartDate.split('-').map(Number);
            const globalStartDate = new Date(startYear, startMonth - 1, startDay);

            const teacherIndexMap = new Map<string, number>();
            teachers.forEach((t, i) => teacherIndexMap.set(t.id, i));

            const fullSchedule = new Map<string, string | null>();
            const lastDayOfVisibleMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);

            if (globalStartDate > lastDayOfVisibleMonth) {
                 const monthDates = getDatesInMonth(currentDate.getFullYear(), currentDate.getMonth());
                 setShifts(monthDates.map(date => ({ date: formatDate(date), teacherId: null })));
                 return;
            }

            let currentDatePointer = new Date(globalStartDate);
            let teacherCycleIndex = 0;

            while (currentDatePointer <= lastDayOfVisibleMonth) {
                const dateStr = formatDate(currentDatePointer);
                const manualOverrideId = manualChanges[dateStr];
                let assignedTeacherId: string | null = null;
                
                if (manualOverrideId) {
                    if (manualOverrideId === '__EMPTY__') {
                        assignedTeacherId = null;
                    } else if (teacherIndexMap.has(manualOverrideId)) {
                        assignedTeacherId = manualOverrideId;
                        teacherCycleIndex = (teacherIndexMap.get(assignedTeacherId) ?? -1) + 1;
                    } else {
                        assignedTeacherId = null; // Teacher was deleted, treat as empty
                    }
                } else {
                    assignedTeacherId = teachers[teacherCycleIndex % teachers.length].id;
                    teacherCycleIndex++;
                }
                
                fullSchedule.set(dateStr, assignedTeacherId);

                currentDatePointer.setDate(currentDatePointer.getDate() + 1);
            }

            const monthDates = getDatesInMonth(currentDate.getFullYear(), currentDate.getMonth());
            const newShifts = monthDates.map(date => {
                const dateString = formatDate(date);
                if (date < globalStartDate) {
                    return { date: dateString, teacherId: null };
                }
                return { date: dateString, teacherId: fullSchedule.get(dateString) ?? null };
            });

            setShifts(newShifts);
        };

        generateSchedule();

    }, [currentDate, teachers, scheduleStartDate, manualChanges]);


    const handleMonthChange = (offset: number) => {
        setCurrentDate(prevDate => {
            const newDate = new Date(prevDate);
            newDate.setMonth(newDate.getMonth() + offset);
            return newDate;
        });
        setActiveColorPicker(null);
    };

    const handleAddTeacher = () => {
        if (newTeacherName.trim()) {
            const newTeacher: Teacher = {
                id: Date.now().toString(),
                name: newTeacherName.trim(),
            };
            setTeachers(prev => [...prev, newTeacher]);
            setNewTeacherName('');
        }
    };

    const handleDeleteTeacher = (teacherId: string) => {
        setManualChanges(prev => {
            const newChanges: Record<string, string> = {};
            Object.keys(prev).forEach(date => {
                if (prev[date] !== teacherId) {
                    newChanges[date] = prev[date];
                }
            });
            return newChanges;
        });
        setTeachers(prev => prev.filter(t => t.id !== teacherId));
    };
    
     const handleClearTeachers = () => {
        if (window.confirm('Bạn có chắc chắn muốn XÓA TOÀN BỘ danh sách giáo viên không? Lịch trực cũng sẽ bị xóa sạch.')) {
            setTeachers([]);
            setManualChanges({});
            setDateColors({});
        }
    };

    const handleUpdateShift = (date: string, newTeacherId: string | null) => {
        setManualChanges(prev => {
            const newChanges = { ...prev };
            if (newTeacherId) {
                newChanges[date] = newTeacherId;
            } else {
                newChanges[date] = '__EMPTY__';
            }
            return newChanges;
        });
    };
    
    const handleSetDateColor = (date: string, color: string | null) => {
        setDateColors(prev => {
            const newColors = { ...prev };
            if (color) {
                newColors[date] = color;
            } else {
                delete newColors[date];
            }
            return newColors;
        });
         setActiveColorPicker(null);
    };


    const handleClearShift = (date: string) => {
        handleUpdateShift(date, null);
    };

    const handleStartDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newDate = e.target.value;
        if (newDate) {
            setScheduleStartDate(newDate);
            setManualChanges({});
            setDateColors({});
        }
    };
    
    const handleResetSchedule = useCallback(() => {
        if (window.confirm('Bạn có chắc chắn muốn xóa tất cả các thay đổi thủ công và đánh dấu màu không? Hành động này không thể hoàn tác.')) {
            setManualChanges({});
            setDateColors({});
        }
    }, []);

    const handleExportToCSV = () => {
        const month = currentDate.getMonth();
        const year = currentDate.getFullYear();
        const monthName = `Lịch trực Tháng ${month + 1}, ${year}`;
        const dayNames = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
        
        const teacherMap = new Map(teachers.map(t => [t.id, t.name]));
    
        const firstDayOfMonth = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
    
        const calendarCells: string[] = [];
    
        // 1. Add empty cells for days before the 1st of the month
        for (let i = 0; i < firstDayOfMonth; i++) {
            calendarCells.push('');
        }
    
        // 2. Add cells for each day of the month
        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(year, month, day);
            const dateString = formatDate(date);
            
            const shift = shifts.find(s => s.date === dateString);
            const teacherName = shift?.teacherId ? teacherMap.get(shift.teacherId) || 'Không rõ' : 'Trống';
            
            const cellContent = `${day} - ${teacherName}`;
            calendarCells.push(`"${cellContent.replace(/"/g, '""')}"`);
        }
    
        // 3. Create grid rows from the flat cell array
        const gridRows: string[] = [];
        for (let i = 0; i < calendarCells.length; i += 7) {
            // Take a slice of 7 days for the week
            const week = calendarCells.slice(i, i + 7);
            // Pad the last week if it's not full
            while (week.length < 7) {
                week.push('');
            }
            gridRows.push(week.join(','));
        }
        
        const csvRows = [
            `"${monthName}"`,
            dayNames.join(','),
            ...gridRows
        ];
    
        const csvContent = "\uFEFF" + csvRows.join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        if (link.download !== undefined) {
            const url = URL.createObjectURL(blob);
            link.setAttribute('href', url);
            link.setAttribute('download', `Lich_truc_Thang_${month + 1}_${year}.csv`);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    };
    
    const handleDragSort = () => {
        if (!dragTeacherId.current || !dragOverTeacherId.current || dragTeacherId.current === dragOverTeacherId.current) {
            return;
        }

        const teachersClone = [...teachers];
        const dragIndex = teachers.findIndex(t => t.id === dragTeacherId.current);
        const dropIndex = teachers.findIndex(t => t.id === dragOverTeacherId.current);

        if (dragIndex === -1 || dropIndex === -1) return;

        const draggedItem = teachersClone.splice(dragIndex, 1)[0];
        teachersClone.splice(dropIndex, 0, draggedItem);
        
        setTeachers(teachersClone);
        
        dragTeacherId.current = null;
        dragOverTeacherId.current = null;
    };
    
    const filteredTeachers = useMemo(() => 
        teachers.filter(teacher => 
            teacher.name.toLowerCase().includes(searchQuery.toLowerCase())
        ), [teachers, searchQuery]);

    const highlightedTeacherIds = useMemo(() => 
        new Set(filteredTeachers.map(t => t.id)), 
    [filteredTeachers]);

    const handleShareLink = useCallback(() => {
        try {
            const stateToShare: ShareableState = {
                teachers,
                scheduleStartDate,
                manualChanges,
                dateColors,
            };
            const jsonString = JSON.stringify(stateToShare);
            const compressed = pako.deflate(jsonString);
            const base64String = uint8ArrayToBase64(compressed);
            
            const url = `${window.location.origin}${window.location.pathname}#data=${base64String}`;
            
            navigator.clipboard.writeText(url);

            return true; // Indicate success
        } catch (error) {
            console.error("Failed to create share link:", error);
            alert("Không thể tạo liên kết chia sẻ. Vui lòng thử lại.");
            return false; // Indicate failure
        }
    }, [teachers, scheduleStartDate, manualChanges, dateColors]);


    return (
        <div className="min-h-screen p-4 sm:p-6 lg:p-8 font-sans text-gray-800">
            <div className="max-w-7xl mx-auto">
                <header className="text-center mb-8">
                    <h1 className="text-4xl font-bold text-gray-900">Lịch Trực Giáo Viên</h1>
                    <p className="text-lg text-gray-600 mt-2">Tự động sắp xếp và quản lý lịch trực</p>
                </header>
                
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-1 bg-white p-6 rounded-xl shadow-lg no-print">
                        <TeacherManager
                            teachers={filteredTeachers}
                            allTeachers={teachers}
                            onAddTeacher={handleAddTeacher}
                            onDeleteTeacher={handleDeleteTeacher}
                            onResetSchedule={handleResetSchedule}
                            onClearTeachers={handleClearTeachers}
                            newTeacherName={newTeacherName}
                            setNewTeacherName={setNewTeacherName}
                            scheduleStartDate={scheduleStartDate}
                            onStartDateChange={handleStartDateChange}
                            onDragSort={handleDragSort}
                            dragTeacherId={dragTeacherId}
                            dragOverTeacherId={dragOverTeacherId}
                            searchQuery={searchQuery}
                            onSearchChange={setSearchQuery}
                        />
                    </div>
                    <div className="lg:col-span-2 bg-white p-6 rounded-xl shadow-lg">
                        <CalendarHeader
                            currentDate={currentDate}
                            onMonthChange={handleMonthChange}
                            onExport={handleExportToCSV}
                            onShare={handleShareLink}
                        />
                        <CalendarGrid
                            currentDate={currentDate}
                            shifts={shifts}
                            teachers={teachers}
                            onUpdateShift={handleUpdateShift}
                            onClearShift={handleClearShift}
                            dateColors={dateColors}
                            onSetDateColor={handleSetDateColor}
                            activeColorPicker={activeColorPicker}
                            setActiveColorPicker={setActiveColorPicker}
                            highlightedTeacherIds={searchQuery ? highlightedTeacherIds : new Set()}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};

// Sub-components
interface TeacherManagerProps {
    teachers: Teacher[]; // This will be the filtered list
    allTeachers: Teacher[]; // The full list, for context if needed
    newTeacherName: string;
    setNewTeacherName: (name: string) => void;
    onAddTeacher: () => void;
    onDeleteTeacher: (id: string) => void;
    onResetSchedule: () => void;
    onClearTeachers: () => void;
    scheduleStartDate: string;
    onStartDateChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onDragSort: () => void;
    dragTeacherId: React.MutableRefObject<string | null>;
    dragOverTeacherId: React.MutableRefObject<string | null>;
    searchQuery: string;
    onSearchChange: (query: string) => void;
}

const TeacherManager: React.FC<TeacherManagerProps> = ({ teachers, newTeacherName, setNewTeacherName, onAddTeacher, onDeleteTeacher, onResetSchedule, onClearTeachers, scheduleStartDate, onStartDateChange, onDragSort, dragTeacherId, dragOverTeacherId, searchQuery, onSearchChange }) => {
    return (
        <div>
            <h2 className="text-2xl font-bold mb-4 text-indigo-700">Quản lý</h2>
            <div className="mb-6">
                 <label htmlFor="teacher-name" className="block text-sm font-medium text-gray-700 mb-1">Thêm Giáo Viên</label>
                <div className="flex space-x-2">
                    <input
                        id="teacher-name"
                        type="text"
                        value={newTeacherName}
                        onChange={(e) => setNewTeacherName(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && onAddTeacher()}
                        placeholder="Tên giáo viên mới"
                        className="flex-grow border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
                    />
                    <button
                        onClick={onAddTeacher}
                        className="bg-indigo-600 text-white p-2 rounded-lg hover:bg-indigo-700 transition-colors duration-200 flex items-center justify-center shrink-0"
                        aria-label="Thêm giáo viên"
                    >
                        <PlusIcon />
                    </button>
                </div>
            </div>

            <div className="mb-6">
                <label htmlFor="start-date" className="block text-sm font-medium text-gray-700 mb-1">Ngày Bắt Đầu Xếp Lịch</label>
                <input
                    type="date"
                    id="start-date"
                    value={scheduleStartDate}
                    onChange={onStartDateChange}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
                />
            </div>

            <div className="mb-6 grid grid-cols-2 gap-2">
                <button
                    onClick={onResetSchedule}
                    className="w-full bg-yellow-500 text-white px-4 py-2 rounded-lg hover:bg-yellow-600 transition-colors duration-200 flex items-center justify-center gap-2"
                    aria-label="Xóa các tùy chỉnh trên lịch"
                >
                    <XMarkIcon className="w-5 h-5"/>
                    <span>Xóa Tùy Chỉnh</span>
                </button>
                 <button
                    onClick={onClearTeachers}
                    className="w-full bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors duration-200 flex items-center justify-center gap-2"
                    aria-label="Xóa toàn bộ danh sách giáo viên"
                >
                    <TrashIcon />
                    <span>Xóa Danh Sách</span>
                </button>
            </div>
            
            <div className="mb-4">
                 <label htmlFor="search-teacher" className="block text-sm font-medium text-gray-700 mb-1">Tìm kiếm Giáo Viên</label>
                 <div className="relative">
                    <span className="absolute inset-y-0 left-0 flex items-center pl-3">
                        <MagnifyingGlassIcon className="w-5 h-5 text-gray-400" />
                    </span>
                    <input
                        id="search-teacher"
                        type="text"
                        value={searchQuery}
                        onChange={(e) => onSearchChange(e.target.value)}
                        placeholder="Gõ tên để tìm..."
                        className="w-full border border-gray-300 rounded-lg px-10 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
                    />
                 </div>
            </div>


            <div>
                 <h3 className="text-xl font-bold mb-3 text-gray-800">Danh Sách Giáo Viên</h3>
                <ul className="space-y-2 max-h-80 overflow-y-auto pr-2">
                    {teachers.length > 0 ? teachers.map((teacher) => (
                        <li 
                            key={teacher.id} 
                            className="flex items-center justify-between bg-gray-50 p-3 rounded-lg cursor-grab active:cursor-grabbing"
                            draggable
                            onDragStart={() => (dragTeacherId.current = teacher.id)}
                            onDragEnter={() => (dragOverTeacherId.current = teacher.id)}
                            onDragEnd={onDragSort}
                            onDragOver={(e) => e.preventDefault()}
                        >
                            <div className="flex items-center gap-2">
                                <Bars3Icon className="w-5 h-5 text-gray-400"/>
                                <span className="font-medium">
                                   {teacher.name}
                                </span>
                            </div>
                            <button
                                onClick={() => onDeleteTeacher(teacher.id)}
                                className="text-red-500 hover:text-red-700 transition-colors"
                                aria-label={`Xóa ${teacher.name}`}
                            >
                                <TrashIcon />
                            </button>
                        </li>
                    )) : (
                        <p className="text-gray-500 text-center py-4">{searchQuery ? 'Không tìm thấy giáo viên.' : 'Chưa có giáo viên nào.'}</p>
                    )}
                </ul>
            </div>
        </div>
    );
};

interface CalendarHeaderProps {
    currentDate: Date;
    onMonthChange: (offset: number) => void;
    onExport: () => void;
    onShare: () => boolean; // Returns true on success, false on failure
}

const CalendarHeader: React.FC<CalendarHeaderProps> = ({ currentDate, onMonthChange, onExport, onShare }) => {
    const [showCopyNotice, setShowCopyNotice] = useState(false);

    const handleShareClick = () => {
        if (onShare()) {
            setShowCopyNotice(true);
            setTimeout(() => setShowCopyNotice(false), 2500);
        }
    };

    return (
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <div className="flex items-center gap-2">
                <button onClick={() => onMonthChange(-1)} className="p-2 rounded-full hover:bg-gray-200 transition-colors" aria-label="Tháng trước"><ChevronLeftIcon /></button>
                <button onClick={() => onMonthChange(1)} className="p-2 rounded-full hover:bg-gray-200 transition-colors" aria-label="Tháng sau"><ChevronRightIcon /></button>
            </div>
            <h2 className="text-2xl font-bold text-indigo-700 order-first w-full text-center sm:order-none sm:w-auto">
                {`Tháng ${currentDate.getMonth() + 1}, ${currentDate.getFullYear()}`}
            </h2>
            <div className="flex items-center gap-2 relative">
                <button onClick={handleShareClick} className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors duration-200 flex items-center gap-2" aria-label="Chia sẻ lịch">
                    <LinkIcon />
                    <span>Chia sẻ</span>
                </button>
                 {showCopyNotice && (
                    <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-xs font-semibold rounded-md px-3 py-1.5 shadow-lg animate-fade-in-out">
                        Đã sao chép liên kết!
                    </div>
                )}
                <button onClick={onExport} className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors duration-200 flex items-center gap-2" aria-label="Xuất file CSV">
                    <ArrowDownTrayIcon />
                    <span>Xuất CSV</span>
                </button>
            </div>
        </div>
    );
};


interface CustomColorPickerProps {
    date: string;
    currentColor?: string;
    onSetColor: (date: string, color: string | null) => void;
}

const CustomColorPicker: React.FC<CustomColorPickerProps> = ({ date, currentColor, onSetColor }) => {
    const handleColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        onSetColor(date, e.target.value);
    };

    return (
        <div className="absolute top-8 right-0 z-10 bg-white shadow-lg rounded-lg p-2 flex items-center gap-2 border">
            <input
                type="color"
                value={currentColor || '#ffffff'}
                onChange={handleColorChange}
                className="w-8 h-8 border-none cursor-pointer"
                aria-label="Chọn màu tùy chỉnh"
            />
            <button
                onClick={() => onSetColor(date, null)}
                className="w-6 h-6 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 hover:ring-2 ring-gray-400 transition-all"
                aria-label="Bỏ chọn màu"
            >
                <NoSymbolIcon className="w-4 h-4" />
            </button>
        </div>
    );
};


interface CalendarGridProps {
    currentDate: Date;
    shifts: Shift[];
    teachers: Teacher[];
    onUpdateShift: (date: string, teacherId: string | null) => void;
    onClearShift: (date: string) => void;
    dateColors: Record<string, string>;
    onSetDateColor: (date: string, color: string | null) => void;
    activeColorPicker: string | null;
    setActiveColorPicker: (date: string | null) => void;
    highlightedTeacherIds: Set<string>;
}

const CalendarGrid: React.FC<CalendarGridProps> = ({ currentDate, shifts, teachers, onUpdateShift, onClearShift, dateColors, onSetDateColor, activeColorPicker, setActiveColorPicker, highlightedTeacherIds }) => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    const firstDayOfMonth = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const dayHeaders = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

    const getTeacher = (teacherId: string | null): Teacher | undefined => {
        if (!teacherId) return undefined;
        return teachers.find(t => t.id === teacherId);
    };

    const handleSelectChange = (date: string, e: React.ChangeEvent<HTMLSelectElement>) => {
        const newTeacherId = e.target.value;
        onUpdateShift(date, newTeacherId === "null" ? null : newTeacherId);
    };

    return (
        <>
            <div className="grid grid-cols-7 gap-1 text-center font-semibold text-gray-600">
                {dayHeaders.map(day => <div key={day} className="py-2">{day}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-2">
                {Array.from({ length: firstDayOfMonth }).map((_, i) => <div key={`empty-${i}`} className="border rounded-lg bg-gray-50"></div>)}
                {Array.from({ length: daysInMonth }).map((_, i) => {
                    const day = i + 1;
                    const date = new Date(year, month, day);
                    const dateString = formatDate(date);
                    const shift = shifts.find(s => s.date === dateString);
                    const teacher = getTeacher(shift?.teacherId ?? null);
                    
                    const colorHex = dateColors[dateString];
                    const cellBgStyle = colorHex ? { backgroundColor: colorHex } : {};
                    const cellTextClass = getTextColorForBg(colorHex);
                    const selectTextClass = colorHex && getTextColorForBg(colorHex) === 'text-white' ? 'text-black' : 'text-gray-800';
                    const isHighlighted = shift?.teacherId && highlightedTeacherIds.has(shift.teacherId);
                    
                    return (
                        <div 
                            key={dateString} 
                            style={cellBgStyle} 
                            className={`p-2 border rounded-lg h-32 flex flex-col transition-all duration-300 hover:shadow-md relative ${cellTextClass} ${isHighlighted ? 'ring-4 ring-offset-2 ring-blue-400' : ''}`}
                        >
                            <div className="flex justify-between items-center">
                                <span className="font-bold">{day}</span>
                                { shift &&
                                  <div className="relative">
                                      <button onClick={() => setActiveColorPicker(activeColorPicker === dateString ? null : dateString)} className="p-1 rounded-full hover:bg-black/10 transition-colors" aria-label={colorHex ? 'Đổi màu' : 'Đánh dấu ngày'}>
                                          {colorHex ? (
                                              <StarIconSolid className={`w-4 h-4 text-yellow-500`} />
                                          ) : (
                                              <StarIconOutline className="w-4 h-4 text-gray-400 hover:text-yellow-500" />
                                          )}
                                      </button>
                                      {activeColorPicker === dateString && (
                                         <CustomColorPicker date={dateString} currentColor={colorHex} onSetColor={onSetDateColor} />
                                      )}
                                  </div>
                                }
                            </div>
                            <div className="mt-1 text-xs flex-grow overflow-hidden">
                            {teacher ? (
                                <div className="group relative">
                                    <p className={`font-semibold truncate`}>{teacher.name}</p>
                                    <button onClick={() => onClearShift(dateString)} className="absolute top-0 right-0 p-0.5 bg-black/10 hover:bg-black/20 text-current rounded-full opacity-0 group-hover:opacity-100 transition-opacity" aria-label="Xóa người trực">
                                        <XMarkIcon className="w-3 h-3" />
                                    </button>
                                </div>
                            ) : (
                                shift && <p className="text-gray-400 italic">Trống</p>
                            )}
                            {shift && (
                                <select 
                                    value={shift?.teacherId || "null"} 
                                    onChange={(e) => handleSelectChange(dateString, e)} 
                                    className={`w-full mt-2 text-xs border-gray-300 rounded p-1 bg-gray-100/50 focus:bg-white ${selectTextClass}`}
                                    aria-label={`Chọn giáo viên cho ngày ${day}`}
                                >
                                    <option value="null">-- Đổi --</option>
                                    {teachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                                </select>
                            )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </>
    );
};

export default App;