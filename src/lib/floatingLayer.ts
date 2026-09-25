let highestFloatingZIndex = 10_000;

export function nextFloatingZIndex(): number {
  highestFloatingZIndex = Math.min(2_147_483_000, highestFloatingZIndex + 1);
  return highestFloatingZIndex;
}
