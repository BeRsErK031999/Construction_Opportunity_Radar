export const VERTICALS = ["CONSTRUCTION", "HORECA", "OTHER"] as const;
export type Vertical = (typeof VERTICALS)[number];

export const PROFILE_VERTICALS = ["CONSTRUCTION", "HORECA"] as const;
export type ProfileVertical = (typeof PROFILE_VERTICALS)[number];
