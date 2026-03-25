import type { SpriteFrame } from "./palette.js";

/** Shared head + body pixels (used by both frames) */
export const HAMSTER_BODY: SpriteFrame = [
	// Head
	[3, -5, "ear"],
	[2, -4, "ear"],
	[3, -4, "earInner"],
	[4, -4, "ear"],
	[1, -3, "body"],
	[2, -3, "body"],
	[3, -3, "body"],
	[4, -3, "body"],
	[5, -3, "body"],
	[0, -2, "body"],
	[1, -2, "bodyLight"],
	[2, -2, "bodyLight"],
	[3, -2, "bodyLight"],
	[4, -2, "bodyLight"],
	[5, -2, "body"],
	[6, -2, "bodyDark"],
	[-1, -1, "body"],
	[0, -1, "bodyLight"],
	[1, -1, "eye"],
	[2, -1, "bodyLight"],
	[3, -1, "bodyLight"],
	[4, -1, "body"],
	[5, -1, "body"],
	[6, -1, "bodyDark"],

	// Face
	[-2, 0, "earInner"],
	[-1, 0, "bodyLight"],
	[0, 0, "cheek"],
	[1, 0, "bodyLight"],
	[2, 0, "belly"],
	[3, 0, "belly"],
	[4, 0, "body"],
	[5, 0, "body"],
	[6, 0, "bodyDark"],

	// Body
	[0, 1, "body"],
	[1, 1, "belly"],
	[2, 1, "belly"],
	[3, 1, "belly"],
	[4, 1, "body"],
	[5, 1, "body"],
	[6, 1, "bodyDark"],
	[7, 1, "bodyDark"],
	[0, 2, "body"],
	[1, 2, "belly"],
	[2, 2, "belly"],
	[3, 2, "belly"],
	[4, 2, "body"],
	[5, 2, "body"],
	[6, 2, "bodyDark"],
	[7, 2, "bodyDark"],
	[8, 2, "tail"],
	[1, 3, "body"],
	[2, 3, "belly"],
	[3, 3, "belly"],
	[4, 3, "body"],
	[5, 3, "body"],
	[6, 3, "bodyDark"],
	[7, 3, "bodyDark"],

	// Tail
	[8, 3, "tail"],
	[9, 3, "tail"],
	[9, 2, "tail"],
];

/** Frame A leg pixels — front extended, back tucked */
export const FRAME_A_LEGS: SpriteFrame = [
	[0, 4, "feet"],
	[-1, 4, "feet"],
	[5, 4, "feet"],
	[6, 4, "feet"],
	[6, 5, "feet"],
	[7, 4, "bodyDark"],
];

/** Frame B leg pixels — front tucked, back extended */
export const FRAME_B_LEGS: SpriteFrame = [
	[1, 4, "feet"],
	[2, 4, "feet"],
	[5, 4, "feet"],
	[6, 4, "feet"],
	[7, 4, "feet"],
	[7, 5, "feet"],
	[-1, 5, "feet"],
	[8, 4, "bodyDark"],
];

/** Complete frame A = body + legs A */
export const FRAME_A: SpriteFrame = [...HAMSTER_BODY, ...FRAME_A_LEGS];

/** Complete frame B = body + legs B */
export const FRAME_B: SpriteFrame = [...HAMSTER_BODY, ...FRAME_B_LEGS];

/** Array of both frames, indexed by frame number (0 or 1) */
export const HAMSTER_FRAMES: [SpriteFrame, SpriteFrame] = [FRAME_A, FRAME_B];
