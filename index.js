// app.js
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import express from 'express'
import { Telegraf, Markup } from 'telegraf'

/**
 *  — HTML Host Bot (to'liq, logs + confirm delete + owner metadata + update support + keepAlive)
 *  .env required:
 *    BOT_TOKEN=...
 *    BASE_URL=http://yourdomain.com   (default http://localhost:3000)
 *    PORT=3000
 *
 *  Foydalanish:
 *    npm i telegraf express node-cron
 *    node app.js
 */

// ENV
const {
  BOT_TOKEN,
  BASE_URL = 'http://localhost:3000',
  PORT = 3000
} = process.env
if (!BOT_TOKEN) throw new Error('BOT_TOKEN kerak!')

// Paths
const ROOT = process.cwd()
const SITES_DIR = path.join(ROOT, 'sites')
const META_FILE = path.join(SITES_DIR, 'sites.json') // metadata (owner, createdAt, updatedAt)
const LOG_FILE = path.join(SITES_DIR, 'logs.txt')

fs.mkdirSync(SITES_DIR, { recursive: true })

// Simple logger (append)
const log = (level, userId, action, details = '') => {
  try {
    const time = new Date().toISOString()
    const line = `[${time}] [${level}] user:${userId} action:${action} ${details}\n`
    fs.appendFileSync(LOG_FILE, line, 'utf8')
    console.log(line.trim())
  } catch (err) {
    console.error('Log error:', err)
  }
}

// Load/save metadata
let SITES_META = {}
const loadMeta = () => {
  try {
    if (fs.existsSync(META_FILE)) {
      SITES_META = JSON.parse(fs.readFileSync(META_FILE, 'utf8') || '{}')
    } else {
      SITES_META = {}
    }
  } catch (err) {
    console.error('Meta load error', err)
    SITES_META = {}
  }
}
const saveMeta = () => {
  try {
    fs.writeFileSync(META_FILE, JSON.stringify(SITES_META, null, 2), 'utf8')
  } catch (err) {
    console.error('Meta save error', err)
  }
}
loadMeta()

// Helpers
const genId = () => Math.random().toString(36).substring(2, 8)

const addSiteMeta = (id, userId, sizeKB) => {
  const now = new Date().toISOString()
  SITES_META[id] = {
    id,
    owner: userId,
    file: `${id}.html`,
    sizeKB,
    createdAt: now,
    updatedAt: now
  }
  saveMeta()
}

const updateSiteMeta = (id, sizeKB) => {
  if (!SITES_META[id]) return
  SITES_META[id].sizeKB = sizeKB
  SITES_META[id].updatedAt = new Date().toISOString()
  saveMeta()
}

const removeSiteMeta = id => {
  if (SITES_META[id]) {
    delete SITES_META[id]
    saveMeta()
  }
}

const getUserSites = userId => {
  return Object.values(SITES_META).filter(s => s.owner === userId)
}

// Telegraf & Express
const app = express()
const bot = new Telegraf(BOT_TOKEN)

// In-memory maps to track "waiting for upload" states per user
// pendingUpload[userId] = { type: 'create' }  -- waiting for new file
// pendingUpload[userId] = { type: 'update', id } -- waiting to replace existing
const pendingUpload = new Map()

// Localization (tuzatilgan versiya)
const L = {
  uz: {
    welcome: `🏠 <b>HTML Host Botga xush kelibsiz!</b>\n\nHTML fayl yuboring → darhol hosting qilamiz`,
    choose_lang: '🌐 <b>Tilni tanlang:</b>',
    file_only_html: '❌ Faqat .html fayl yuboring!',
    file_received: '📥 <b>Fayl qabul qilindi!</b>\n\nYaratilmoqda...',
    upload_new: '📤 Yangi HTML fayl yuboring',
    my_sites: '📁 Sizning saytlaringiz',
    no_sites: '📭 Hozircha saytlar mavjud emas.\n\nHTML fayl yuboring!',
    delete: '🗑 Oʻchirish',
    view: '👀 Koʻrish',
    new_upload: '🆕 Yangi yuklash',
    back: '🔙 Orqaga',
    help: `ℹ️ <b>Yordam</b>\n\n• HTML fayl yuboring → hosting\n• Yangi fayl = yangilash\n• Oʻchirish = tugma orqali\n\n/my — saytlar roʻyxati`,
    error: '❌ Faylni saqlashda xato',
    success: '✅ <b>Muvaffaqiyatli yaratildi!</b>',
    updated: '🔄 <b>Yangilandi!</b>',
    deleted: '🗑 <b>Oʻchirildi!</b>',
    confirm_delete: '⚠️ Ushbu saytni oʻchirmoqchimisiz?',
    update_prompt: '🔄 Yangilash',
    not_your_site: '❌ Bu sayt sizga tegishli emas',
    site_not_found: '❌ Sayt topilmadi',
    cancel: '❌ Bekor qilish',
    cancelled: '❎ Bekor qilindi'
  },
  en: {
    welcome: `🏠 <b>Welcome to HTML Host Bot!</b>\n\nSend HTML file → instant hosting`,
    choose_lang: '🌐 <b>Choose language:</b>',
    file_only_html: '❌ Only .html files!',
    file_received: '📥 <b>File received!</b>\n\nCreating...',
    upload_new: '📤 Send new HTML file',
    my_sites: '📁 Your sites',
    no_sites: '📭 No sites yet.\n\nSend HTML file!',
    delete: '🗑 Delete',
    view: '👀 View',
    new_upload: '🆕 Upload new',
    back: '🔙 Back',
    help: `ℹ️ <b>Help</b>\n\n• Send HTML file → hosting\n• New file = update\n• Delete = via button\n\n/my — sites list`,
    error: '❌ Error saving file',
    success: '✅ <b>Successfully created!</b>',
    updated: '🔄 <b>Updated!</b>',
    deleted: '🗑 <b>Deleted!</b>',
    confirm_delete: '⚠️ Are you sure you want to delete this site?',
    update_prompt: '🔄 Update',
    not_your_site: '❌ This site does not belong to you',
    site_not_found: '❌ Site not found',
    cancel: '❌ Cancel',
    cancelled: '❎ Cancelled'
  },
  ru: {
    welcome: `🏠 <b>Добро пожаловать в HTML Host Bot!</b>\n\nОтправьте HTML файл → мгновенный хостинг`,
    choose_lang: '🌐 <b>Выберите язык:</b>',
    file_only_html: '❌ Только .html файлы!',
    file_received: '📥 <b>Файл получен!</b>\n\nСоздаем...',
    upload_new: '📤 Отправить новый HTML файл',
    my_sites: '📁 Ваши сайты',
    no_sites: '📭 Сайтов пока нет.\n\nОтправьте HTML файл!',
    delete: '🗑 Удалить',
    view: '👀 Посмотреть',
    new_upload: '🆕 Загрузить новый',
    back: '🔙 Назад',
    help: `ℹ️ <b>Помощь</b>\n\n• Отправьте HTML файл → хостинг\n• Новый файл = обновление\n• Удалить = через кнопку\n\n/my — список сайтов`,
    error: '❌ Ошибка сохранения файла',
    success: '✅ <b>Успешно создано!</b>',
    updated: '🔄 <b>Обновлено!</b>',
    deleted: '🗑 <b>Удалено!</b>',
    confirm_delete: '⚠️ Вы уверены, что хотите удалить этот сайт?',
    update_prompt: '🔄 Обновить',
    not_your_site: '❌ Этот сайт вам не принадлежит',
    site_not_found: '❌ Сайт не найден',
    cancel: '❌ Отмена',
    cancelled: '❎ Отменено'
  }
}

const LANG_NAMES = { uz: '🇺🇿 Oʻzbek', ru: '🇷🇺 Русский', en: '🇺🇸 English' }
const userLang = new Map()
const t = (userId, key) => {
  const lang = userLang.get(userId) || 'en'
  return L[lang][key] ?? key
}

// Utility to send or edit messages
const editOrReply = async (ctx, text, keyboard = null) => {
  const userId = ctx.from?.id || (ctx.chat && ctx.chat.id) || 'unknown'
  const options = {
    parse_mode: 'HTML',
    disable_web_page_preview: true
  }
  if (keyboard) options.reply_markup = keyboard.reply_markup
  try {
    if (ctx.callbackQuery && ctx.callbackQuery.message) {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        ctx.callbackQuery.message.message_id,
        undefined,
        text,
        options
      )
    } else {
      await ctx.reply(text, options)
    }
  } catch (err) {
    // fallback to reply if edit failed (message could be too old)
    await ctx.reply(text, options)
  }
}

/* ===== Bot handlers ===== */

bot.start(async ctx => {
  const userId = ctx.from.id
  const lang = userLang.get(userId)
  log('INFO', userId, 'start', `lang=${lang || 'none'}`)
  if (lang) {
    return editOrReply(
      ctx,
      t(userId, 'welcome'),
      Markup.inlineKeyboard([
        [Markup.button.callback(t(userId, 'my_sites'), 'my_sites')],
        [Markup.button.callback('🌐 Language', 'change_lang')]
      ])
    )
  }
  await editOrReply(
    ctx,
    t(userId, 'choose_lang'),
    Markup.inlineKeyboard([
      [Markup.button.callback(LANG_NAMES.uz, 'lang_uz')],
      [Markup.button.callback(LANG_NAMES.ru, 'lang_ru')],
      [Markup.button.callback(LANG_NAMES.en, 'lang_en')]
    ])
  )
})

bot.action(/lang_(.+)/, async ctx => {
  const lang = ctx.match[1]
  const userId = ctx.from.id
  userLang.set(userId, lang)
  log('INFO', userId, 'lang_set', lang)
  await ctx.answerCbQuery()
  await editOrReply(
    ctx,
    t(userId, 'welcome'),
    Markup.inlineKeyboard([
      [Markup.button.callback(t(userId, 'my_sites'), 'my_sites')],
      [Markup.button.callback('🌐 Language', 'change_lang')]
    ])
  )
})

bot.action('change_lang', async ctx => {
  await ctx.answerCbQuery()
  await editOrReply(
    ctx,
    t(ctx.from.id, 'choose_lang'),
    Markup.inlineKeyboard([
      [Markup.button.callback(LANG_NAMES.uz, 'lang_uz')],
      [Markup.button.callback(LANG_NAMES.ru, 'lang_ru')],
      [Markup.button.callback(LANG_NAMES.en, 'lang_en')]
    ])
  )
})

bot.command('my', ctx => showSites(ctx))
bot.action('my_sites', ctx => showSites(ctx))

async function showSites (ctx) {
  const userId = ctx.from.id
  loadMeta()
  const sites = getUserSites(userId)
  log('INFO', userId, 'list_sites', `count=${sites.length}`)
  if (!sites.length) {
    return editOrReply(
      ctx,
      t(userId, 'no_sites'),
      Markup.inlineKeyboard([
        [Markup.button.callback(t(userId, 'new_upload'), 'upload')],
        [Markup.button.callback(t(userId, 'back'), 'back_start')]
      ])
    )
  }

  let text = `<b>${t(userId, 'my_sites')}</b>\n\n`
  const keyboard = []
  sites.forEach((site, index) => {
    const updated = new Date(site.updatedAt).toLocaleDateString()
    text += `${index + 1}. <code>${site.id}</code> — ${
      site.sizeKB
    } KB — <i>${updated}</i>\n`
    keyboard.push([
      Markup.button.url(t(userId, 'view'), `${BASE_URL}/sites/${site.file}`),
      Markup.button.callback(t(userId, 'delete'), `del_${site.id}`),
      Markup.button.callback(t(userId, 'update_prompt'), `update_${site.id}`)
    ])
  })

  keyboard.push([
    Markup.button.callback(t(userId, 'new_upload'), 'upload'),
    Markup.button.callback(t(userId, 'back'), 'back_start')
  ])

  await editOrReply(ctx, text, Markup.inlineKeyboard(keyboard))
}

bot.action('back_start', async ctx => {
  await ctx.answerCbQuery()
  const userId = ctx.from.id
  await editOrReply(
    ctx,
    t(userId, 'welcome'),
    Markup.inlineKeyboard([
      [Markup.button.callback(t(userId, 'my_sites'), 'my_sites')],
      [Markup.button.callback('🌐 Language', 'change_lang')]
    ])
  )
})

// Upload prompt
bot.action('upload', async ctx => {
  await ctx.answerCbQuery()
  const userId = ctx.from.id
  pendingUpload.set(userId, { type: 'create' })
  log('INFO', userId, 'awaiting_upload', 'create')
  await editOrReply(
    ctx,
    `<b>${t(userId, 'upload_new')}</b>\n\n<i>${t(
      userId,
      'file_only_html'
    )}</i>`,
    Markup.inlineKeyboard([
      [Markup.button.callback(t(userId, 'back'), 'my_sites')]
    ])
  )
})

// Update (replace) prompt: set pending to update id
bot.action(/update_(.+)/, async ctx => {
  await ctx.answerCbQuery()
  const userId = ctx.from.id
  const id = ctx.match[1]
  const meta = SITES_META[id]
  if (!meta) {
    await editOrReply(ctx, t(userId, 'site_not_found'))
    return
  }
  if (meta.owner !== userId) {
    await editOrReply(ctx, t(userId, 'not_your_site'))
    return
  }
  pendingUpload.set(userId, { type: 'update', id })
  log('INFO', userId, 'awaiting_upload', `update:${id}`)
  await editOrReply(
    ctx,
    `<b>${t(userId, 'update_prompt')}: <code>${id}</code></b>\n\n<i>${t(
      userId,
      'file_only_html'
    )}</i>`,
    Markup.inlineKeyboard([
      [Markup.button.callback(t(userId, 'back'), 'my_sites')]
    ])
  )
})

// Document handler (uploads)
bot.on('document', async ctx => {
  const userId = ctx.from.id
  if (!userLang.has(userId)) {
    return ctx.reply(t(userId, 'choose_lang'), {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🌐 Tilni tanlash', 'change_lang')]
      ])
    })
  }

  const pending = pendingUpload.get(userId)
  if (!pending) {
    // if user didn't request upload, remind them
    return ctx.reply(
      `<b>❗ ${t(
        userId,
        'upload_new'
      )} tugmasini bosing yoki /my buyrug'ini yuboring.</b>`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback(t(userId, 'new_upload'), 'upload')]
        ])
      }
    )
  }

  const file = ctx.message.document
  if (!file.file_name?.endsWith('.html')) {
    return ctx.reply(`<b>${t(userId, 'file_only_html')}</b>`, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback(t(userId, 'back'), 'my_sites')]
      ])
    })
  }

  const loadingMsg = await ctx.reply(`<b>${t(userId, 'file_received')}</b>`, {
    parse_mode: 'HTML'
  })
  try {
    const fileInfo = await ctx.telegram.getFile(file.file_id)
    const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileInfo.file_path}`

    // fetch file (node 18+ has fetch); if not, user must polyfill
    const response = await fetch(fileUrl)
    const html = await response.text()

    if (!html.includes('<html') && !html.includes('<!DOCTYPE')) {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        loadingMsg.message_id,
        undefined,
        `<b>❌ ${t(userId, 'error')}:</b> Bu HTML fayl emas!\n\n${t(
          userId,
          'file_only_html'
        )}`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.callback(t(userId, 'back'), 'my_sites')]
          ])
        }
      )
      log(
        'WARN',
        userId,
        'upload_failed_not_html',
        `fileName=${file.file_name}`
      )
      pendingUpload.delete(userId)
      return
    }

    if (pending.type === 'create') {
      const id = genId()
      const filepath = path.join(SITES_DIR, `${id}.html`)
      fs.writeFileSync(filepath, html, 'utf8')
      const size = (html.length / 1024).toFixed(2)
      addSiteMeta(id, userId, size)
      const url = `${BASE_URL}/sites/${id}.html`
      const resultText =
        `✅ <b>${t(userId, 'success')}</b>\n\n` +
        `📝 <b>ID:</b> <code>${id}</code>\n` +
        `📦 <b>Hajmi:</b> ${size} KB\n\n` +
        `🔗 <a href="${url}"><b>${t(userId, 'view')}</b></a>`

      await ctx.telegram.editMessageText(
        ctx.chat.id,
        loadingMsg.message_id,
        undefined,
        resultText,
        {
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          ...Markup.inlineKeyboard([
            [Markup.button.url(t(userId, 'view'), url)],
            [Markup.button.callback(t(userId, 'my_sites'), 'my_sites')],
            [Markup.button.callback(t(userId, 'new_upload'), 'upload')]
          ])
        }
      )
      log('INFO', userId, 'create_site', `id=${id} sizeKB=${size}`)
      pendingUpload.delete(userId)
    } else if (pending.type === 'update') {
      const id = pending.id
      const meta = SITES_META[id]
      if (!meta) {
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          loadingMsg.message_id,
          undefined,
          t(userId, 'site_not_found'),
          { parse_mode: 'HTML' }
        )
        log('WARN', userId, 'update_failed_not_found', `id=${id}`)
        pendingUpload.delete(userId)
        return
      }
      if (meta.owner !== userId) {
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          loadingMsg.message_id,
          undefined,
          t(userId, 'not_your_site'),
          { parse_mode: 'HTML' }
        )
        log('WARN', userId, 'update_failed_not_owner', `id=${id}`)
        pendingUpload.delete(userId)
        return
      }

      const filepath = path.join(SITES_DIR, `${id}.html`)
      fs.writeFileSync(filepath, html, 'utf8')
      const size = (html.length / 1024).toFixed(2)
      updateSiteMeta(id, size)
      const url = `${BASE_URL}/sites/${id}.html`

      await ctx.telegram.editMessageText(
        ctx.chat.id,
        loadingMsg.message_id,
        undefined,
        `🔄 <b>${t(userId, 'updated')}</b>\n\n` +
          `🔗 <a href="${url}">${t(userId, 'view')}</a>`,
        {
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          ...Markup.inlineKeyboard([
            [Markup.button.url(t(userId, 'view'), url)],
            [Markup.button.callback(t(userId, 'my_sites'), 'my_sites')]
          ])
        }
      )
      log('INFO', userId, 'update_site', `id=${id} sizeKB=${size}`)
      pendingUpload.delete(userId)
    }
  } catch (err) {
    console.error('File processing error:', err)
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      loadingMsg.message_id,
      undefined,
      `<b>${t(userId, 'error')}</b>\n\n${err.message}`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback(t(userId, 'back'), 'my_sites')]
        ])
      }
    )
    log('ERROR', userId, 'upload_error', err.message)
    pendingUpload.delete(userId)
  }
})

// Delete confirmation flow
bot.action(/del_(.+)/, async ctx => {
  const id = ctx.match[1]
  const userId = ctx.from.id
  const meta = SITES_META[id]
  if (!meta) {
    await ctx.answerCbQuery(t(userId, 'site_not_found'), { show_alert: true })
    return
  }
  if (meta.owner !== userId) {
    await ctx.answerCbQuery(t(userId, 'not_your_site'), { show_alert: true })
    return
  }

  // show confirm keyboard
  await ctx.answerCbQuery()
  await editOrReply(
    ctx,
    `${t(userId, 'confirm_delete')}\n\nID: <code>${id}</code>`,
    Markup.inlineKeyboard([
      [
        Markup.button.callback('✅ Ha', `del_confirm_${id}`),
        Markup.button.callback(t(userId, 'cancel'), `del_cancel_${id}`)
      ]
    ])
  )
})

// Confirm delete
bot.action(/del_confirm_(.+)/, async ctx => {
  const id = ctx.match[1]
  const userId = ctx.from.id
  const meta = SITES_META[id]
  if (!meta) {
    await ctx.answerCbQuery(t(userId, 'site_not_found'), { show_alert: true })
    return
  }
  if (meta.owner !== userId) {
    await ctx.answerCbQuery(t(userId, 'not_your_site'), { show_alert: true })
    return
  }

  const file = path.join(SITES_DIR, `${id}.html`)
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file)
    removeSiteMeta(id)
    await ctx.answerCbQuery(t(userId, 'deleted'))
    await editOrReply(
      ctx,
      `🗑 <b>${t(userId, 'deleted')}</b>\n\nID: <code>${id}</code>`,
      Markup.inlineKeyboard([
        [
          Markup.button.callback(t(userId, 'my_sites'), 'my_sites'),
          Markup.button.callback(t(userId, 'back'), 'back_start')
        ]
      ])
    )
    log('INFO', userId, 'delete_site', `id=${id}`)
  } catch (err) {
    console.error('Delete error', err)
    await ctx.answerCbQuery(t(userId, 'error'), { show_alert: true })
    log('ERROR', userId, 'delete_error', `${id} ${err.message}`)
  }
})

// Cancel delete
bot.action(/del_cancel_(.+)/, async ctx => {
  await ctx.answerCbQuery()
  const userId = ctx.from.id
  await editOrReply(
    ctx,
    t(userId, 'cancelled'),
    Markup.inlineKeyboard([
      [Markup.button.callback(t(userId, 'my_sites'), 'my_sites')]
    ])
  )
  log('INFO', userId, 'delete_cancel', `id=${ctx.match[1]}`)
})

// Help
bot.help(ctx => {
  const userId = ctx.from.id
  if (!userLang.has(userId)) {
    return ctx.reply(t(userId, 'choose_lang'), {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🌐 Tilni tanlash', 'change_lang')]
      ])
    })
  }
  ctx.reply(t(userId, 'help'), {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      [
        Markup.button.callback(t(userId, 'my_sites'), 'my_sites'),
        Markup.button.callback(t(userId, 'back'), 'back_start')
      ]
    ])
  })
  log('INFO', userId, 'help')
})

// Keep Alive function for Render.com
const keepAlive = () => {
  if (BASE_URL.includes('render.com') || BASE_URL.includes('localhost')) {
    const url = BASE_URL.startsWith('http') ? BASE_URL : `https://${BASE_URL}`
    console.log(`🔄 Keep-alive ping: ${url}`)
    fetch(url).catch(err => console.log('Keep-alive ping failed:', err.message))
  }
}

// Launch bot & server
bot.launch().then(() => {
  console.log('✅ Bot ishlayapti!')
  log('INFO', 'server', 'bot_launch', `BASE_URL=${BASE_URL}`)
})

process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))

app.use('/sites', express.static(SITES_DIR))
app.get('/', (_, res) => res.send('<h1>HTML Host Bot ishlayapti</h1>'))
const keepServerAlive = () => {
  if (!process.env.RENDER_URL) {
    console.warn('⚠️ RENDER_URL is not set. Skipping ping.')
    return
  }

  setInterval(() => {
    axios
      .get(process.env.RENDER_URL)
      .then(() => console.log('🔄 Server active'))
      .catch(err => console.log('⚠️ Ping failed:', err.message))
  }, 10 * 60 * 1000)
}

keepServerAlive()
app.listen(PORT, () => {
  console.log(`🚀 Server: ${BASE_URL}`)
  console.log(`📁 Sites directory: ${SITES_DIR}`)
  log('INFO', 'server', 'express_listen', `PORT=${PORT}`)
})
