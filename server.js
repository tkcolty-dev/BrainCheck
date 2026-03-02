import express from 'express';
import session from 'express-session';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { chat } from './services/llm.js';
import { initDB, query } from './services/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 } // 1 week
}));
app.use(express.static(join(__dirname, 'public')));

// ---------- Auth ----------
app.post('/api/signup', async (req, res) => {
  try {
    const { username, password, displayName } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required.' });
    if (username.length < 3) return res.status(400).json({ error: 'Username must be at least 3 characters.' });
    if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters.' });

    const existing = await query('SELECT id FROM users WHERE username = $1', [username.toLowerCase()]);
    if (existing.rows.length > 0) return res.status(409).json({ error: 'Username already taken.' });

    const hash = await bcrypt.hash(password, 10);
    const result = await query(
      'INSERT INTO users (username, password_hash, display_name) VALUES ($1, $2, $3) RETURNING id, username, display_name',
      [username.toLowerCase(), hash, displayName || username]
    );
    const user = result.rows[0];
    req.session.userId = user.id;
    res.json({ id: user.id, username: user.username, displayName: user.display_name });
  } catch (err) {
    console.error('Signup error:', err.message);
    res.status(500).json({ error: 'Signup failed.' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required.' });

    const result = await query('SELECT id, username, display_name, password_hash FROM users WHERE username = $1', [username.toLowerCase()]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid username or password.' });

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid username or password.' });

    req.session.userId = user.id;
    res.json({ id: user.id, username: user.username, displayName: user.display_name });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Login failed.' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', async (req, res) => {
  if (!req.session.userId) return res.json(null);
  try {
    const result = await query('SELECT id, username, display_name FROM users WHERE id = $1', [req.session.userId]);
    if (result.rows.length === 0) return res.json(null);
    const u = result.rows[0];
    res.json({ id: u.id, username: u.username, displayName: u.display_name });
  } catch {
    res.json(null);
  }
});

// ---------- Save Results ----------
app.post('/api/save-quiz-result', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in.' });
  try {
    const { title, subject, totalQuestions, correctCount, score, difficulty, questions } = req.body;
    const result = await query(
      'INSERT INTO quiz_results (user_id, title, subject, total_questions, correct_count, score, difficulty, questions_json) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
      [req.session.userId, title, subject, totalQuestions, correctCount, score, difficulty, questions ? JSON.stringify(questions) : null]
    );
    res.json({ ok: true, id: result.rows[0].id });
  } catch (err) {
    console.error('Save quiz error:', err.message);
    res.status(500).json({ error: 'Failed to save.' });
  }
});

app.get('/api/quiz/:id', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in.' });
  try {
    const result = await query(
      'SELECT id, title, subject, questions_json, difficulty FROM quiz_results WHERE id = $1 AND user_id = $2',
      [req.params.id, req.session.userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Quiz not found.' });
    const row = result.rows[0];
    if (!row.questions_json) return res.status(404).json({ error: 'Quiz questions not available.' });
    res.json({ title: row.title, subject: row.subject, questions: row.questions_json, difficulty: row.difficulty });
  } catch (err) {
    console.error('Get quiz error:', err.message);
    res.status(500).json({ error: 'Failed to load quiz.' });
  }
});

app.post('/api/save-homework-result', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in.' });
  try {
    const { subject, totalProblems, correctCount, results } = req.body;
    await query(
      'INSERT INTO homework_results (user_id, subject, total_problems, correct_count, results_json) VALUES ($1,$2,$3,$4,$5)',
      [req.session.userId, subject, totalProblems, correctCount, JSON.stringify(results)]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Save homework error:', err.message);
    res.status(500).json({ error: 'Failed to save.' });
  }
});

app.get('/api/history', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in.' });
  try {
    const quizzes = await query(
      'SELECT id, title, subject, total_questions, correct_count, score, difficulty, created_at, (questions_json IS NOT NULL) AS has_questions FROM quiz_results WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
      [req.session.userId]
    );
    const homework = await query(
      'SELECT id, subject, total_problems, correct_count, created_at FROM homework_results WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
      [req.session.userId]
    );
    res.json({ quizzes: quizzes.rows, homework: homework.rows });
  } catch (err) {
    console.error('History error:', err.message);
    res.status(500).json({ error: 'Failed to load history.' });
  }
});

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

// Init DB then start server
initDB()
  .then(() => app.listen(PORT, () => console.log(`BrainCheck running on port ${PORT}`)))
  .catch(err => {
    console.warn('DB init failed (running without accounts):', err.message);
    app.listen(PORT, () => console.log(`BrainCheck running on port ${PORT} (no DB)`));
  });
