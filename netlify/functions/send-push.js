const webpush = require('web-push');
const { createClient } = require('@supabase/supabase-js');

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { user_id, title, body } = JSON.parse(event.body);

    webpush.setVapidDetails(
      'mailto:admin@fabulous-yeot-87b1a9.netlify.app',
      VAPID_PUBLIC_KEY,
      VAPID_PRIVATE_KEY
    );

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // 해당 유저의 구독 정보 가져오기
    const { data: subs, error } = await supabase
      .from('push_subscriptions')
      .select('*')
      .eq('user_id', user_id);

    if (error) throw error;
    if (!subs || subs.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ message: '구독 정보 없음' }) };
    }

    const payload = JSON.stringify({
      title: title || '⏳ 골든타임 절반 남았어요!',
      body: body || '45분이 지났어요. 아직 인증 안 하셨으면 서둘러요! 🔥'
    });

    // 모든 기기에 푸시 발송
    await Promise.all(subs.map(sub =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      ).catch(e => console.warn('발송 실패:', e.message))
    ));

    return { statusCode: 200, body: JSON.stringify({ message: '푸시 발송 완료' }) };

  } catch (e) {
    console.error(e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
