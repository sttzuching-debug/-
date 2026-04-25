import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

export function getWeekDay(date: string): number {
  const d = new Date(date);
  let day = d.getDay(); // 0 is Sunday
  return day === 0 ? 7 : day;
}

export function isWeekend(date: string): boolean {
  const day = getWeekDay(date);
  return day >= 5; // Fri, Sat, Sun
}
