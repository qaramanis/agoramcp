/** "1 source", "3 sources" — for the counts the catalogue pages print. */
export function count(n: number, noun: string): string {
  return `${n} ${n === 1 ? noun : `${noun}s`}`;
}
