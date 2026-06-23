/**
 * Objective scoring for Reading and Listening sections.
 * Simple answer-key comparison — 1 mark per correct answer.
 */

export interface AnswerKeyEntry {
  question_id: string;
  correct_answer: string;
}

export interface StudentAnswerEntry {
  question_id: string;
  answer: string;
}

export interface ObjectiveScoreResult {
  score: number;
  total: number;
  percentage: number;
  breakdown: {
    question_id: string;
    student_answer: string;
    correct_answer: string;
    is_correct: boolean;
  }[];
  grade: string;
}

/**
 * Scores objective (Reading/Listening) answers against the answer key.
 * Comparison is case-insensitive and trims whitespace.
 */
export function scoreObjectiveAnswers(
  studentAnswers: StudentAnswerEntry[],
  answerKey: AnswerKeyEntry[],
): ObjectiveScoreResult {
  const keyMap = new Map(
    answerKey.map((k) => [k.question_id, k.correct_answer.trim().toLowerCase()]),
  );

  const breakdown = studentAnswers.map((sa) => {
    const correct = keyMap.get(sa.question_id) ?? null;
    const isCorrect = correct !== null && sa.answer.trim().toLowerCase() === correct;
    return {
      question_id: sa.question_id,
      student_answer: sa.answer,
      correct_answer: keyMap.get(sa.question_id) ?? 'N/A',
      is_correct: isCorrect,
    };
  });

  const score = breakdown.filter((b) => b.is_correct).length;
  const total = answerKey.length;
  const percentage = total > 0 ? Math.round((score / total) * 100) : 0;

  const grade = percentage >= 75 ? 'High Pass' : percentage >= 50 ? 'Pass' : 'Below Pass';

  return { score, total, percentage, breakdown, grade };
}
