import clsx, { type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Classes conditionnelles, les conflits Tailwind résolus au profit de la dernière. */
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
