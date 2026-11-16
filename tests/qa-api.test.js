import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommunityServer } from '../server/app.mjs';

const credentials = { login: 'creator', password: 'StrongPass123!' };

async function request(port, path, { method = 'GET', body, cookie, csrfToken } = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
      ...(csrfToken ? { 'x-csrf-token': csrfToken } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json();
  return { status: response.status, data, cookie: response.headers.get('set-cookie') };
}

async function register(port, login) {
  const result = await request(port, '/api/auth/register', { method: 'POST', body: { login, password: 'password123', confirmPassword: 'password123' } });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  return { user: result.data.user, csrfToken: result.data.csrfToken, cookie: result.cookie };
}

async function login(port, loginName, password) {
  const result = await request(port, '/api/auth/login', { method: 'POST', body: { login: loginName, password } });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  return { user: result.data.user, csrfToken: result.data.csrfToken, cookie: result.cookie };
}

test('вопросы сообщества: вопрос, теги, ответы, комментарии, голоса и метка полезного', async (context) => {
  const app = await createCommunityServer({ dbPath: ':memory:', god: credentials });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const port = app.server.address().port;
  context.after(() => app.close());

  const alice = await register(port, 'alice');
  const bob = await register(port, 'bob');

  // Создание вопроса с тегами.
  const created = await request(port, '/api/questions', {
    method: 'POST',
    cookie: alice.cookie,
    csrfToken: alice.csrfToken,
    body: { title: 'Почему перманганат меняет цвет?', body: 'От чего зависят продукты восстановления KMnO4 в разных средах?', tags: ['овр', 'марганец'] }
  });
  assert.equal(created.status, 201);
  assert.deepEqual(created.data.question.tags, ['овр', 'марганец']);
  assert.equal(created.data.question.author_login, 'alice');
  assert.equal(created.data.question.score, 0);

  const questionId = created.data.question.id;

  // Список вопросов.
  const list = await request(port, '/api/questions');
  assert.equal(list.status, 200);
  assert.equal(list.data.questions.length, 1);
  assert.equal(list.data.questions[0].answers_count, 0);

  // Голосовать за свой вопрос нельзя.
  const selfVote = await request(port, `/api/questions/${questionId}/vote`, { method: 'POST', cookie: alice.cookie, csrfToken: alice.csrfToken, body: { value: 1 } });
  assert.equal(selfVote.status, 403);

  // Боб отвечает.
  const answer = await request(port, '/api/answers', {
    method: 'POST',
    cookie: bob.cookie,
    csrfToken: bob.csrfToken,
    body: { questionId, body: 'В кислой среде восстанавливается до Mn(II), в нейтральной — до MnO2, в щелочной — до манганата.' }
  });
  assert.equal(answer.status, 201);
  const answerId = answer.data.answer.id;

  // Детализация вопроса содержит ответ.
  const detail = await request(port, `/api/questions/${questionId}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.data.answers.length, 1);
  assert.equal(detail.data.question.answers_count, 1);

  // Комментарий к вопросу.
  const comment = await request(port, `/api/questions/${questionId}/comment`, {
    method: 'POST', cookie: bob.cookie, csrfToken: bob.csrfToken, body: { body: 'Уточните среду?' }
  });
  assert.equal(comment.status, 201);
  assert.equal(comment.data.comments.length, 1);
  const commentId = comment.data.comments[0].id;

  // Чужой комментарий удалить нельзя, автор — может, модератор — тоже.
  const charlie = await register(port, 'charlie_comments');
  const foreignDelete = await request(port, `/api/comments/${commentId}`, { method: 'DELETE', cookie: charlie.cookie, csrfToken: charlie.csrfToken });
  assert.equal(foreignDelete.status, 403);
  const authorDelete = await request(port, `/api/comments/${commentId}`, { method: 'DELETE', cookie: bob.cookie, csrfToken: bob.csrfToken });
  assert.equal(authorDelete.status, 200);
  const afterDelete = await request(port, `/api/questions/${questionId}`);
  assert.equal(afterDelete.data.question.comments.length, 0);
  const secondComment = await request(port, `/api/questions/${questionId}/comment`, {
    method: 'POST', cookie: bob.cookie, csrfToken: bob.csrfToken, body: { body: 'Комментарий для модератора' }
  });
  const creator = await login(port, credentials.login, credentials.password);
  const moderatorDelete = await request(port, `/api/comments/${secondComment.data.comments[0].id}`, {
    method: 'DELETE', cookie: creator.cookie, csrfToken: creator.csrfToken
  });
  assert.equal(moderatorDelete.status, 200);
  const preservedComment = await request(port, `/api/questions/${questionId}/comment`, {
    method: 'POST', cookie: charlie.cookie, csrfToken: charlie.csrfToken, body: { body: 'Останется после удаления аккаунта' }
  });
  const preservedId = preservedComment.data.comments[0].id;
  const deleteCharlie = await request(port, '/api/auth/account', {
    method: 'DELETE', cookie: charlie.cookie, csrfToken: charlie.csrfToken,
    body: { password: 'password123', confirm: 'УДАЛИТЬ' }
  });
  assert.equal(deleteCharlie.status, 200);
  const afterAccountDelete = await request(port, `/api/questions/${questionId}`);
  const preserved = afterAccountDelete.data.question.comments.find((item) => item.id === preservedId);
  assert.ok(preserved);
  assert.equal(preserved.author_login, 'Удалённый пользователь');

  // Алиса голосует за ответ Боба и отмечает его полезным.
  const vote = await request(port, `/api/answers/${answerId}/vote`, { method: 'POST', cookie: alice.cookie, csrfToken: alice.csrfToken, body: { value: 1 } });
  assert.equal(vote.status, 200);
  assert.equal(vote.data.answer.score, 1);

  const accept = await request(port, `/api/answers/${answerId}/accept`, { method: 'POST', cookie: alice.cookie, csrfToken: alice.csrfToken });
  assert.equal(accept.status, 200);
  assert.equal(accept.data.answer.accepted, true);

  // Репутация Боба: +1 голос на ответ и +1 за полезный ответ.
  const me = await request(port, '/api/auth/me', { cookie: bob.cookie });
  assert.equal(me.data.user.reputation, 2);

  // Отметить ответ может только автор вопроса.
  const badAccept = await request(port, `/api/answers/${answerId}/accept`, { method: 'POST', cookie: bob.cookie, csrfToken: bob.csrfToken });
  assert.equal(badAccept.status, 403);

  // Фильтр по тегу.
  const tagged = await request(port, '/api/questions?tag=овр');
  assert.equal(tagged.data.questions.length, 1);
  const taggedEmpty = await request(port, '/api/questions?tag=нет-тега');
  assert.equal(taggedEmpty.data.questions.length, 0);

  // Теги.
  const tags = await request(port, '/api/tags');
  assert.deepEqual(tags.data.tags.map((tag) => tag.name).sort(), ['марганец', 'овр']);
  assert.ok(tags.data.tags.every((tag) => tag.count === 1));
});

test('модерация вопросов: мультитеги, без ответов, просмотры, правки, жалобы, закрытие и удаление', async (context) => {
  const app = await createCommunityServer({ dbPath: ':memory:', god: credentials });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const port = app.server.address().port;
  context.after(() => app.close());

  const alice = await register(port, 'alice2');
  const bob = await register(port, 'bob2');
  const creator = await login(port, credentials.login, credentials.password);
  assert.equal(creator.user.privileges, 'GOD');

  const first = await request(port, '/api/questions', {
    method: 'POST', cookie: alice.cookie, csrfToken: alice.csrfToken,
    body: { title: 'Первый вопрос', body: 'Тело первого вопроса', tags: ['redox', 'acid'] }
  });
  const second = await request(port, '/api/questions', {
    method: 'POST', cookie: alice.cookie, csrfToken: alice.csrfToken,
    body: { title: 'Второй вопрос', body: 'Тело второго вопроса', tags: ['redox'] }
  });
  const firstId = first.data.question.id;
  const secondId = second.data.question.id;

  // Мультитег: только вопросы, где есть оба тега.
  const bothTags = await request(port, '/api/questions?tag=redox&tag=acid');
  assert.equal(bothTags.data.questions.length, 1);
  assert.equal(bothTags.data.questions[0].id, firstId);

  // Сортировка «без ответов»: второй вопрос без ответов.
  const unanswered = await request(port, '/api/questions?sort=unanswered');
  assert.equal(unanswered.data.questions.length, 2);

  // Просмотры считаются один раз на уникального пользователя.
  const beforeViews = await request(port, `/api/questions/${firstId}?view=0`, { cookie: alice.cookie });
  await request(port, `/api/questions/${firstId}`, { cookie: alice.cookie });
  const viewed = await request(port, `/api/questions/${firstId}`, { cookie: alice.cookie });
  assert.equal(viewed.data.question.views, beforeViews.data.question.views + 1);
  assert.equal(viewed.data.question.closed, false);

  // Ответ на первый вопрос.
  const answer = await request(port, '/api/answers', {
    method: 'POST', cookie: bob.cookie, csrfToken: bob.csrfToken,
    body: { questionId: firstId, body: 'Ответ Боба' }
  });
  const answerId = answer.data.answer.id;

  // Теперь «без ответов» остаётся только второй вопрос.
  const unansweredAfter = await request(port, '/api/questions?sort=unanswered');
  assert.deepEqual(unansweredAfter.data.questions.map((question) => question.id), [secondId]);

  // Жалоба Боба уходит модераторам.
  const shortComment = await request(port, `/api/questions/${firstId}/comment`, {
    method: 'POST', cookie: bob.cookie, csrfToken: bob.csrfToken, body: { body: 'abc' }
  });
  assert.equal(shortComment.status, 422);
  const flag = await request(port, `/api/questions/${firstId}/flag`, {
    method: 'POST', cookie: bob.cookie, csrfToken: bob.csrfToken, body: { reason: 'спам' }
  });
  assert.equal(flag.status, 201);
  const creatorNotifications = await request(port, '/api/notifications', { cookie: creator.cookie });
  assert.ok(creatorNotifications.data.notifications.some((notification) => notification.kind === 'question_flag' && notification.message.includes('спам')));

  // Модератор редактирует вопрос с причиной, автор получает уведомление.
  const edited = await request(port, `/api/questions/${firstId}`, {
    method: 'PATCH', cookie: creator.cookie, csrfToken: creator.csrfToken,
    body: { title: 'Первый вопрос (уточнён)', body: 'Уточнённое тело', tags: ['redox', 'acid'], reason: 'Уточнение формулировки' }
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.data.question.title, 'Первый вопрос (уточнён)');
  const detailAfterEdit = await request(port, `/api/questions/${firstId}`);
  assert.equal(detailAfterEdit.data.question.edits.length, 1);
  assert.equal(detailAfterEdit.data.question.edits[0].reason, 'Уточнение формулировки');
  const aliceNotifications = await request(port, '/api/notifications', { cookie: alice.cookie });
  assert.ok(aliceNotifications.data.notifications.some((notification) => notification.kind === 'question_edited' && notification.message.includes('Уточнение формулировки')));

  // Закрытие вопроса с указанием дубликата.
  const closed = await request(port, `/api/questions/${firstId}/close`, {
    method: 'POST', cookie: creator.cookie, csrfToken: creator.csrfToken,
    body: { reason: 'Дубликат', duplicateOf: secondId }
  });
  assert.equal(closed.status, 200);
  assert.equal(closed.data.question.closed, true);
  assert.equal(closed.data.question.duplicate_of, secondId);
  const answerClosed = await request(port, '/api/answers', {
    method: 'POST', cookie: bob.cookie, csrfToken: bob.csrfToken,
    body: { questionId: firstId, body: 'Попытка ответить в закрытый вопрос' }
  });
  assert.equal(answerClosed.status, 409);
  const reopened = await request(port, `/api/questions/${firstId}/reopen`, { method: 'POST', cookie: creator.cookie, csrfToken: creator.csrfToken });
  assert.equal(reopened.data.question.closed, false);

  // Удаление ответа и вопроса модератором с причиной.
  const deletedAnswer = await request(port, `/api/answers/${answerId}`, {
    method: 'DELETE', cookie: creator.cookie, csrfToken: creator.csrfToken, body: { reason: 'Не по теме' }
  });
  assert.equal(deletedAnswer.status, 200);
  const deletedQuestion = await request(port, `/api/questions/${secondId}`, {
    method: 'DELETE', cookie: creator.cookie, csrfToken: creator.csrfToken, body: { reason: 'Спам' }
  });
  assert.equal(deletedQuestion.status, 200);
  const missing = await request(port, `/api/questions/${secondId}`);
  assert.equal(missing.status, 404);
  const bobNotifications = await request(port, '/api/notifications', { cookie: bob.cookie });
  assert.ok(bobNotifications.data.notifications.some((notification) => notification.kind === 'answer_deleted' && notification.message.includes('Не по теме')));
  const aliceNotificationsAfter = await request(port, '/api/notifications', { cookie: alice.cookie });
  assert.ok(aliceNotificationsAfter.data.notifications.some((notification) => notification.kind === 'question_deleted' && notification.message.includes('Спам')));
});
