import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

/**
 * 合并 Tailwind CSS 类名
 * 
 * @param inputs 类名数组
 * @returns 合并后的类名
 */
export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
} 
