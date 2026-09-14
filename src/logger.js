'use strict';
// Strukturaviy logging. Production'da (NODE_ENV=production) JSON formatida
// chiqaradi — Railway kabi log yig'uvchilarda qidirish/filtrlash oson bo'lishi
// uchun. Lokal ishlab chiqishda odatdagidek o'qilishi oson formatda chiqadi.
//
// Eslatma: mavjud console.log/error chaqiriqlari (emoji bilan, inson o'qishi
// uchun qulay) ataylab o'zgartirilmagan — bu logger yangi/muhim
// xato-kuzatuv joylari uchun qo'shimcha vosita sifatida mo'ljallangan.

const isProd = process.env.NODE_ENV === 'production';

function write(level, message, meta) {
  if (isProd) {
    const entry = { level, message, time: new Date().toISOString(), ...meta };
    const line = JSON.stringify(entry);
    (level === 'error' ? console.error : console.log)(line);
  } else {
    const prefix = { info: 'ℹ️', warn: '⚠️', error: '❌' }[level] || '';
    const fn = level === 'error' ? console.error : console.log;
    fn(`${prefix} ${message}`, meta && Object.keys(meta).length ? meta : '');
  }
}

const log = {
  info: (message, meta) => write('info', message, meta),
  warn: (message, meta) => write('warn', message, meta),
  error: (message, meta) => write('error', message, meta),
};

module.exports = { log };
