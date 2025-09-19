export interface Teacher {
  id: string;
  name: string;
}

export interface Shift {
  date: string; // YYYY-MM-DD format
  teacherId: string | null;
}
