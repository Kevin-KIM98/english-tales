// 학습 진도: 다시 열었을 때 어디서부터 이어볼지 계산 (화면·저장소와 무관한 순수 계산)

/**
 * 이어볼 문장 번호(0부터). 마지막으로 익힘 표시한 문장의 '다음' 문장에서 이어 간다.
 * - 익힘이 하나도 없으면 처음부터
 * - 마지막 문장까지 익혔으면 아직 안 익힌 첫 문장으로
 * - 다 익혔으면 처음부터 (복습)
 * @param {number} total 문장 수
 * @param {Iterable<number>} learned 익힘 표시한 문장 번호들
 */
export function resumeIndex(total, learned) {
  const done = learned instanceof Set ? learned : new Set(learned);
  if (!done.size || done.size >= total) return 0;
  const next = Math.max(...done) + 1;
  if (next < total) return next;
  for (let i = 0; i < total; i++) if (!done.has(i)) return i;
  return 0;
}
