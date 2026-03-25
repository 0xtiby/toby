import React, { useState, useEffect, useMemo } from "react";
import { Box, Text, useStdout } from "ink";
import { PALETTE } from "./palette.js";
import { HAMSTER_FRAMES } from "./sprites.js";
import {
	generateWheelPixels,
	computeWheelGeometry,
} from "./wheel.js";

export interface HamsterWheelProps {
	/** Grid columns (logical pixels). Auto-computed from terminal width if omitted. */
	width?: number;
	/** Grid rows (logical pixels). Auto-computed if omitted. */
	height?: number;
	/** Animation speed multiplier. Default 1. Set to 0 to freeze. */
	speed?: number;
}

/** Internal grid buffer — 2D array of hex color strings or null */
type GridBuffer = (string | null)[][];

interface ColorRun {
	fg: string | undefined;
	bg: string | undefined;
	char: string;
	length: number;
}

function buildGrid(width: number, height: number): GridBuffer {
	return Array.from({ length: height }, () =>
		Array.from<string | null>({ length: width }).fill(null),
	);
}

function resolveHalfBlock(
	top: string | null,
	bottom: string | null,
): { char: string; fg: string | undefined; bg: string | undefined } {
	if (top && bottom) {
		return { char: "\u2580", fg: top, bg: bottom };
	}
	if (top) {
		return { char: "\u2580", fg: top, bg: undefined };
	}
	if (bottom) {
		return { char: "\u2584", fg: bottom, bg: undefined };
	}
	return { char: " ", fg: undefined, bg: undefined };
}

function buildColorRuns(
	grid: GridBuffer,
	width: number,
	height: number,
): ColorRun[][] {
	const charHeight = Math.ceil(height / 2);
	const rows: ColorRun[][] = [];

	for (let cy = 0; cy < charHeight; cy++) {
		const topRow = cy * 2;
		const bottomRow = cy * 2 + 1;
		const runs: ColorRun[] = [];
		let current: ColorRun | null = null;

		for (let x = 0; x < width; x++) {
			const top = grid[topRow]?.[x] ?? null;
			const bottom = bottomRow < height ? (grid[bottomRow]?.[x] ?? null) : null;
			const { char, fg, bg } = resolveHalfBlock(top, bottom);

			if (current && current.fg === fg && current.bg === bg && current.char === char) {
				current.length++;
			} else {
				if (current) runs.push(current);
				current = { fg, bg, char, length: 1 };
			}
		}
		if (current) runs.push(current);
		rows.push(runs);
	}

	return rows;
}

type SizeTier = "static" | "compact" | "full";

const SIZE_TIERS: Record<Exclude<SizeTier, "static">, { width: number; height: number }> = {
	compact: { width: 25, height: 13 },
	full: { width: 35, height: 18 },
};

const MIN_VIABLE_WIDTH = 15;

export function getSizeTier(columns: number): SizeTier {
	if (columns < 60) return "static";
	if (columns < 100) return "compact";
	return "full";
}

const HAMSTER_BASE_INTERVAL = 140;
const WHEEL_BASE_INTERVAL = 100;
const MIN_INTERVAL = 16;

function computeInterval(baseInterval: number, speed: number): number {
	return Math.max(MIN_INTERVAL, Math.round(baseInterval / speed));
}

function resolveDimensions(
	widthProp: number | undefined,
	heightProp: number | undefined,
	columns: number,
): { width: number; height: number; isStatic: boolean } {
	if (widthProp !== undefined && heightProp !== undefined) {
		return { width: widthProp, height: heightProp, isStatic: widthProp < MIN_VIABLE_WIDTH };
	}
	const tier = getSizeTier(columns);
	if (tier === "static") return { width: 0, height: 0, isStatic: true };
	return {
		width: widthProp ?? SIZE_TIERS[tier].width,
		height: heightProp ?? SIZE_TIERS[tier].height,
		isStatic: false,
	};
}

export default function HamsterWheel({
	width: widthProp,
	height: heightProp,
	speed = 1,
}: HamsterWheelProps): React.ReactElement {
	const { stdout } = useStdout();
	const columns = stdout?.columns ?? 80;

	const { width: resolvedWidth, height: resolvedHeight, isStatic } = resolveDimensions(
		widthProp,
		heightProp,
		columns,
	);

	const [frame, setFrame] = useState(0);
	const [spokeAngle, setSpokeAngle] = useState(0);

	// Hamster leg animation timer — guarded by static mode
	useEffect(() => {
		if (speed === 0 || isStatic) return;
		const interval = computeInterval(HAMSTER_BASE_INTERVAL, speed);
		const id = setInterval(() => {
			setFrame((f) => (f + 1) % 2);
		}, interval);
		return () => clearInterval(id);
	}, [speed, isStatic]);

	// Wheel spoke rotation timer — guarded by static mode
	useEffect(() => {
		if (speed === 0 || isStatic) return;
		const interval = computeInterval(WHEEL_BASE_INTERVAL, speed);
		const id = setInterval(() => {
			setSpokeAngle((a) => (a + 0.15) % (2 * Math.PI));
		}, interval);
		return () => clearInterval(id);
	}, [speed, isStatic]);

	const renderedRows = useMemo(() => {
		if (isStatic) return [];

		const grid = buildGrid(resolvedWidth, resolvedHeight);

		// Compute wheel geometry and stamp wheel pixels
		const { cx, cy, outerRadius, innerRadius } = computeWheelGeometry(
			resolvedWidth,
			resolvedHeight,
		);
		const wheelPixels = generateWheelPixels(
			cx,
			cy,
			outerRadius,
			innerRadius,
			spokeAngle,
		);
		for (const pixel of wheelPixels) {
			if (
				pixel.x >= 0 &&
				pixel.x < resolvedWidth &&
				pixel.y >= 0 &&
				pixel.y < resolvedHeight
			) {
				grid[pixel.y]![pixel.x] = pixel.color;
			}
		}

		// Stamp hamster sprite (overwrites wheel — correct z-order)
		const hamsterOriginX = cx - 2;
		const hamsterOriginY = cy + innerRadius - 5;
		const spriteFrame = HAMSTER_FRAMES[frame]!;
		for (const [col, row, colorToken] of spriteFrame) {
			const px = hamsterOriginX + col;
			const py = hamsterOriginY + row;
			if (px >= 0 && px < resolvedWidth && py >= 0 && py < resolvedHeight) {
				grid[py]![px] = PALETTE[colorToken];
			}
		}

		return buildColorRuns(grid, resolvedWidth, resolvedHeight);
	}, [resolvedWidth, resolvedHeight, frame, spokeAngle, isStatic]);

	if (isStatic) {
		return <Text>  🐹 toby</Text>;
	}

	return (
		<Box flexDirection="column">
			{renderedRows.map((runs, y) => (
				<Text key={y}>
					{runs.map((run, i) => (
						<Text key={i} color={run.fg} backgroundColor={run.bg}>
							{run.char.repeat(run.length)}
						</Text>
					))}
				</Text>
			))}
		</Box>
	);
}
