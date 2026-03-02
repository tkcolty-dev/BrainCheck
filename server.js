import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { chat } from './services/llm.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(join(__dirname, 'public')));

// ---------- Check Homework (from OCR text) ----------
app.post('/api/check-homework', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'No text extracted from image.' });

    const prompt = `You are an expert homework checker. You can handle ALL subjects at ALL levels: arithmetic, algebra, geometry, calculus, physics, chemistry, biology, history, English, foreign languages, etc.

A student submitted their homework below. Each line has a problem number, the problem, and the student's answer.

--- HOMEWORK ---
${text}
--- END ---

INSTRUCTIONS:
1. Count EVERY problem in the homework. You MUST include ALL of them - do not skip any.
2. For each problem, carefully solve it yourself step by step.
3. Compare YOUR answer to the student's answer.
4. Mark it correct (true) or wrong (false).
5. If wrong, give a hint about what to review — NEVER reveal the correct answer.

CRITICAL RULES:
- Include EVERY single problem — if there are 15 problems, you must have 15 results
- Actually solve each problem — do the math, recall the facts, check the grammar
- NEVER reveal correct answers for wrong problems — only give hints
- Be encouraging

Respond ONLY with this JSON (no other text):
{
  "subject": "the subject",
  "totalProblems": <total count of ALL problems>,
  "results": [
    {
      "problem": "1",
      "studentAnswer": "what they wrote",
      "correct": true or false,
      "feedback": "Great job!" or "Hint: review [concept]..."
    }
  ],
  "summary": "Encouraging summary with score like X/Y"
}`;

    const result = await chat([{ role: 'user', content: prompt }], { temperature: 0.3 });
    if (!result) {
      return res.status(500).json({ error: 'AI service unavailable. Please try again.' });
    }

    let parsed;
    try {
      let cleaned = result.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '');
      }
      parsed = JSON.parse(cleaned);
    } catch {
      parsed = { raw: result };
    }

    res.json(parsed);
  } catch (err) {
    console.error('Check homework error:', err.message);
    res.status(500).json({ error: 'Failed to check homework.' });
  }
});

// ---------- Generate Test from OCR text ----------
app.post('/api/generate-test', async (req, res) => {
  try {
    const { text, count = 10 } = req.body;
    if (!text) return res.status(400).json({ error: 'No text extracted from image.' });

    const prompt = `You are a test/quiz generator for students. A student uploaded a photo of their study material and OCR extracted the following text:

--- STUDY MATERIAL ---
${text}
--- END ---

Based on this content, create a fun multiple-choice quiz with exactly ${count} questions.

Rules:
- Questions should test understanding of the material
- Each question has 4 answer choices (A, B, C, D)
- Mix easy, medium, and hard questions
- Make questions engaging and clear
- Only ONE correct answer per question

Respond in this exact JSON format:
{
  "title": "Quiz title based on the topic",
  "subject": "the subject area",
  "questions": [
    {
      "id": 1,
      "question": "What is...?",
      "choices": {
        "A": "first option",
        "B": "second option",
        "C": "third option",
        "D": "fourth option"
      },
      "correct": "B",
      "explanation": "Brief explanation of why B is correct"
    }
  ]
}`;

    const result = await chat([{ role: 'user', content: prompt }], { temperature: 0.7 });
    if (!result) {
      return res.status(500).json({ error: 'AI service unavailable.' });
    }

    let parsed;
    try {
      let cleaned = result.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '');
      }
      parsed = JSON.parse(cleaned);
    } catch {
      parsed = { raw: result };
    }

    res.json(parsed);
  } catch (err) {
    console.error('Generate test error:', err.message);
    res.status(500).json({ error: 'Failed to generate test.' });
  }
});

// ---------- Generate Test from Subject/Topic ----------
app.post('/api/generate-test-subject', async (req, res) => {
  try {
    const { subject, topic, difficulty = 'mixed', count = 10 } = req.body;
    if (!subject) return res.status(400).json({ error: 'No subject provided.' });

    const topicLine = topic ? `Focus specifically on: ${topic}` : 'Cover a broad range of topics within this subject.';
    const diffLine = difficulty === 'mixed'
      ? 'Mix easy, medium, and hard questions.'
      : `Make all questions ${difficulty} difficulty.`;

    const prompt = `You are a test/quiz generator for students. Create a fun multiple-choice quiz with exactly ${count} questions about ${subject}.

${topicLine}
${diffLine}

Rules:
- Questions should test real knowledge and understanding
- Each question has 4 answer choices (A, B, C, D)
- Make questions engaging, clear, and educational
- Only ONE correct answer per question
- Cover different aspects of the subject — don't repeat similar questions

Respond in this exact JSON format:
{
  "title": "Quiz title based on the topic",
  "subject": "${subject}",
  "questions": [
    {
      "id": 1,
      "question": "What is...?",
      "choices": {
        "A": "first option",
        "B": "second option",
        "C": "third option",
        "D": "fourth option"
      },
      "correct": "B",
      "explanation": "Brief explanation of why B is correct"
    }
  ]
}`;

    const result = await chat([{ role: 'user', content: prompt }], { temperature: 0.7 });
    if (!result) {
      return res.status(500).json({ error: 'AI service unavailable.' });
    }

    let parsed;
    try {
      let cleaned = result.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '');
      }
      parsed = JSON.parse(cleaned);
    } catch {
      parsed = { raw: result };
    }

    res.json(parsed);
  } catch (err) {
    console.error('Generate test from subject error:', err.message);
    res.status(500).json({ error: 'Failed to generate test.' });
  }
});

// ---------- Generate Test from Text (typed) ----------
app.post('/api/generate-test-text', async (req, res) => {
  try {
    const { text, count = 10 } = req.body;
    if (!text) return res.status(400).json({ error: 'No text provided.' });

    const prompt = `You are a test/quiz generator for students. Based on the following study material, create a fun multiple-choice quiz with exactly ${count} questions.

Study Material:
${text}

Rules:
- Questions should test understanding of the material
- Each question has 4 answer choices (A, B, C, D)
- Mix easy, medium, and hard questions
- Make questions engaging and clear
- Only ONE correct answer per question

Respond in this exact JSON format:
{
  "title": "Quiz title based on the topic",
  "subject": "the subject area",
  "questions": [
    {
      "id": 1,
      "question": "What is...?",
      "choices": {
        "A": "first option",
        "B": "second option",
        "C": "third option",
        "D": "fourth option"
      },
      "correct": "B",
      "explanation": "Brief explanation of why B is correct"
    }
  ]
}`;

    const result = await chat([{ role: 'user', content: prompt }], { temperature: 0.7 });
    if (!result) {
      return res.status(500).json({ error: 'AI service unavailable.' });
    }

    let parsed;
    try {
      let cleaned = result.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '');
      }
      parsed = JSON.parse(cleaned);
    } catch {
      parsed = { raw: result };
    }

    res.json(parsed);
  } catch (err) {
    console.error('Generate test from text error:', err.message);
    res.status(500).json({ error: 'Failed to generate test.' });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`BrainCheck running on port ${PORT}`));
