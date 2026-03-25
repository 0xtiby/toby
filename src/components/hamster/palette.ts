/** Color token name */
export type ColorToken =
	| "body"
	| "bodyLight"
	| "bodyDark"
	| "belly"
	| "ear"
	| "earInner"
	| "eye"
	| "eyeShine"
	| "cheek"
	| "feet"
	| "tail"
	| "wheelBright"
	| "wheelDim"
	| "wheelInner"
	| "wheelSpoke"
	| "wheelHub";

/** Map from token to hex color string */
export const PALETTE: Record<ColorToken, string> = {
	// Hamster colors
	body: "#d4883c",
	bodyLight: "#e8a85c",
	bodyDark: "#b06828",
	belly: "#f0d8b0",
	ear: "#ff8899",
	earInner: "#ff6680",
	eye: "#1a1a2e",
	eyeShine: "#ffffff",
	cheek: "#ff9977",
	feet: "#c47830",
	tail: "#b06828",
	// Wheel colors
	wheelBright: "#8888aa",
	wheelDim: "#555577",
	wheelInner: "#444466",
	wheelSpoke: "#3a3a55",
	wheelHub: "#7777aa",
};

/** A single pixel: [column offset, row offset, color token] */
export type SpritePixel = [col: number, row: number, color: ColorToken];

/** Complete sprite frame */
export type SpriteFrame = SpritePixel[];
