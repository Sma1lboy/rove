/** Join class names, skipping the falsy ones. */
export const cn = (...names: (string | false | null | undefined)[]): string => names.filter(Boolean).join(" ")
